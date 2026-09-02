/**
 * ERP Sync Service — Sincroniza inadimplentes do ERP para tabela customers
 * Roda periodicamente via scheduler. Dados ficam no banco local para:
 * - Mapa de calor (query instantanea)
 * - Consulta por endereco (cross-provider)
 */

import { storage } from "../storage";
import { pool } from "../db";
import type { PoolClient } from "pg";
import { getConnector, buildConnectorConfig, getProviderLimiter } from "../erp";
import type { ErpFetchResult } from "../erp/types";
import { agendaDoAmbiente, proximaExecucao, ultimaExecucaoAgendada, descreverAgenda } from "./erp-agenda";
import { geocodeCep, resolveIbgeCode } from "./geocoding";
import { coordenadaValida } from "./coordenada";
import { coordenadaDoErpCoerente } from "./coords-erp.service";

let _syncing = false;

/**
 * Syncs em voo NESTE processo, por `providerId:erpSource`.
 *
 * Serve so para o dreno do shutdown, que e local por natureza. A exclusao entre
 * chamadores mora no Postgres — ver `tentarTravar`.
 */
const _emVoo = new Set<string>();

export function isSyncing(): boolean {
  return _syncing || _emVoo.size > 0;
}

/**
 * Trava de varredura, por `providerId:erpSource`, no BANCO.
 *
 * Precisa ser no banco porque os dois chamadores vivem em processos pm2
 * SEPARADOS: o scheduler roda no `consulta-isp-worker` e o botao "Sincronizar
 * Agora" roda no `consulta-isp`. Um Set em memoria — que foi a primeira versao
 * disto — impede o duplo clique e nao impede o que realmente importa: a
 * varredura agendada e a manual rodando juntas. Sao milhares de chamadas
 * simultaneas na API do provedor, as duas gravando na mesma carteira.
 *
 * `pg_try_advisory_lock` nao espera: ou pega, ou diz que ja tem alguem. E o
 * mesmo padrao do backfill de geocodificacao
 * (server/services/geocode-backfill.service.ts). A trava e da CONEXAO, entao ela
 * fica segurada ate `liberar()` — e se o processo morrer, o Postgres a solta
 * sozinho ao fechar a conexao, que e a razao de nao usar uma linha de tabela.
 */
const CHAVE_SYNC = 4820_2001;

function chaveDoSync(providerId: number, erpSource: string): number {
  // Segunda chave do par: `providerId` e o ERP cabem num int32 com folga.
  let h = 0;
  for (const ch of erpSource) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((providerId * 1_000_003) ^ h) | 0;
}

async function tentarTravar(providerId: number, erpSource: string) {
  let conn: PoolClient | null = null;
  try {
    conn = await pool.connect();
    const k2 = chaveDoSync(providerId, erpSource);
    const r = await conn.query<{ ok: boolean }>(
      "select pg_try_advisory_lock($1, $2) as ok", [CHAVE_SYNC, k2],
    );
    if (!r.rows[0]?.ok) {
      conn.release();
      return { obtida: false, liberar: async () => {} };
    }
    const c = conn;
    return {
      obtida: true,
      liberar: async () => {
        try { await c.query("select pg_advisory_unlock($1, $2)", [CHAVE_SYNC, k2]); } catch {}
        c.release();
      },
    };
  } catch (err) {
    // Sem banco nao ha sync nenhum para proteger; deixa passar e falhar adiante
    // com a mensagem de verdade, em vez de virar "ja em andamento".
    conn?.release();
    console.warn(`[ERPSync] nao consegui travar (${(err as Error).message}) — seguindo sem trava`);
    return { obtida: true, liberar: async () => {} };
  }
}

/** Ha varredura em andamento para este provedor/ERP, em qualquer processo? */
export async function sincronizacaoEmAndamento(providerId: number, erpSource: string): Promise<boolean> {
  if (_emVoo.has(`${providerId}:${erpSource}`)) return true;
  const t = await tentarTravar(providerId, erpSource);
  if (!t.obtida) return true;
  await t.liberar();
  return false;
}

/**
 * Junta as duas listas de inadimplente em uma so, deduplicada por documento.
 *
 * Quem aparece nas duas fica com a entrada de CANCELADO: ela carrega o status
 * do contrato — o sinal que o anti-fraude usa para separar ex-cliente de cliente
 * em fuga — e e o calculo que ja rodava em producao. A lista de ativos em atraso
 * entra para cobrir quem a outra nao devolve.
 *
 * Documento vazio ou so com pontuacao e descartado: sem chave nao ha como
 * deduplicar, e um upsert por CPF em branco colidiria com outro.
 */
export function mesclarInadimplentes<T extends { cpfCnpj: string }>(
  cancelados: T[],
  emAtraso: T[],
): { customers: T[]; somenteAtivos: number } {
  const chave = (d: string) => (d || "").replace(/\D/g, "");
  const porDoc = new Map<string, T>();

  for (const c of emAtraso) {
    const k = chave(c.cpfCnpj);
    if (k) porDoc.set(k, c);
  }
  let somenteAtivos = porDoc.size;
  for (const c of cancelados) {
    const k = chave(c.cpfCnpj);
    if (!k) continue;
    if (porDoc.has(k)) somenteAtivos--;
    porDoc.set(k, c);
  }
  return { customers: Array.from(porDoc.values()), somenteAtivos };
}

async function syncProviderToDbInterno(
  providerId: number,
  providerName: string,
  erpSource: string,
  intg: {
    apiUrl: string | null;
    apiToken: string | null;
    apiUser?: string | null;
    clientId?: string | null;
    clientSecret?: string | null;
    // Sem este campo, o sync do MK dependia do conector cair em `apiUser`
    // (server/erp/connectors/mk.ts:82). Funcionava enquanto a contra-senha
    // morava la; depois da migracao 0006 ela tem coluna propria, e omitir aqui
    // faria "Testar Conexao" usar a contra-senha nova e "Sincronizar Agora"
    // usar a velha — duas telas discordando sobre a mesma credencial.
    mkContraSenha?: string | null;
    extraConfig?: Record<string, string> | null;
  },
  syncType: "auto" | "manual" = "auto",
): Promise<{ upserted: number; errors: number }> {
  const inicioMs = Date.now();

  /**
   * Toda saida desta funcao passa por aqui. Antes, os tres desfechos de falha
   * (conector ausente, credencial recusada, excecao) saiam por `return`/`throw`
   * sem gravar nada, e a unica pista era um console.warn perdido no journal.
   * Uma integracao que falhava todo dia as 03:00 era indistinguivel, na tela,
   * de uma que nunca tinha sido configurada.
   */
  const registrar = async (
    status: "success" | "partial" | "error",
    upserted: number,
    errors: number,
    mensagem?: string,
    recordsProcessed?: number,
  ) => {
    try {
      await storage.registrarResultadoSync(providerId, erpSource, {
        status, upserted, errors, recordsProcessed, syncType, mensagem,
        duracaoMs: Date.now() - inicioMs,
      });
      if (status === "error") {
        const seguidas = await storage.contarFalhasConsecutivas(providerId, erpSource);
        if (seguidas >= 3) {
          console.error(`[ERPSync] ${providerName} (${erpSource}): ${seguidas} falhas CONSECUTIVAS — ${mensagem ?? "sem detalhe"}`);
        }
      }
    } catch (e: any) {
      // Registrar e o que torna a falha visivel; falhar ao registrar nao pode
      // derrubar um sync que deu certo.
      console.warn(`[ERPSync] nao consegui registrar o resultado: ${e.message}`);
    }
  };

  const connector = getConnector(erpSource);
  if (!connector) {
    console.warn(`[ERPSync] Conector nao encontrado para ${erpSource}`);
    await registrar("error", 0, 0, `Conector "${erpSource}" nao existe no registry`);
    return { upserted: 0, errors: 0 };
  }

  const config = buildConnectorConfig(intg);
  console.log(`[ERPSync] Sincronizando ${providerName} (${erpSource}) id=${providerId}`);

  const limiter = getProviderLimiter(providerId, erpSource);

  // 1. Buscar TODOS os clientes (ativos + inativos) pra ter total por bairro.
  // SEM geocoding (so inadimplentes precisam de coords pro mapa). Resolve cidade FK.
  const hasFetchCustomers = typeof connector.fetchCustomers === "function";
  let falhaNaCarteira: string | undefined;
  if (hasFetchCustomers) {
    try {
      const allResult = await limiter(() => connector.fetchCustomers!(config));
      // Conector nenhum LANCA: todos terminam num catch proprio e devolvem
      // `{ok:false, message}`. Sem esta linha, o `catch` abaixo nunca via a
      // falha e a carteira nao lida passava por sync bem-sucedido.
      if (!allResult.ok) {
        falhaNaCarteira = allResult.message;
        console.warn(`[ERPSync] ${providerName}: fetchCustomers recusou: ${allResult.message}`);
      }
      if (allResult.ok && allResult.customers.length > 0) {
        console.log(`[ERPSync] ${providerName}: fetchCustomers retornou ${allResult.customers.length} clientes totais`);
        let activeUpserted = 0;
        let semDocumento = 0;
        let coordsForaDaCidade = 0;
        for (const customer of allResult.customers) {
          // Sem documento nao ha o que gravar: a tabela e chaveada por
          // (providerId, cpfCnpj) e todo o bureau pergunta por documento.
          // Descartado aqui, e nao no `catch`, para nao contar como erro de
          // sync — nao e falha de leitura, e linha que o ERP mandou sem
          // identidade.
          if (!customer.cpfCnpj?.trim()) { semDocumento++; continue; }
          try {
            let city = customer.city || "";
            let state = customer.state || "";

            if (/^\d+$/.test(city)) {
              const ibge = await resolveIbgeCode(city);
              if (ibge) { city = ibge.city; state = ibge.state; }
              else city = "";
            }
            if (customer.cep && (!city || !state)) {
              const loc = await geocodeCep(customer.cep);
              if (loc) { if (!city) city = loc.city; if (!state) state = loc.state; }
            }

            // A coordenada que o ERP já tem entra AQUI, no passo que varre a
            // carteira inteira — é o que faz o mapa nascer cheio no primeiro
            // sync. Não custa rede: veio junto do cadastro (a cidade é
            // cacheada). Só isso; nada de geocodificar no passo 1, que
            // percorre milhares de clientes. E só se ela combinar com a
            // cidade do cadastro — ver coordenadaDoErpCoerente.
            const doErp = await coordenadaDoErpCoerente(customer.latitude, customer.longitude, city, state);
            if (!doErp && coordenadaValida(customer.latitude, customer.longitude)) coordsForaDaCidade++;

            // Spec 012.5/fix atomicidade — skipPaymentStatus impede que esse
            // passo 1 zere paymentStatus de inadimplentes caso passo 2 falhe.
            // Só atualiza identidade (nome, endereco, telefone, etc).
            await storage.upsertFromErp({
              providerId,
              cpfCnpj: customer.cpfCnpj,
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
              address: customer.address,
              addressNumber: customer.addressNumber,
              complement: customer.complement,
              neighborhood: customer.neighborhood,
              city,
              state,
              cep: customer.cep,
              latitude: doErp ? String(doErp.lat) : undefined,
              longitude: doErp ? String(doErp.lng) : undefined,
              totalOverdueAmount: 0,
              maxDaysOverdue: 0,
              overdueInvoicesCount: 0,
              // O STATUS VEM POR AQUI, e e o unico caminho que alcanca a
              // carteira inteira. O passo 2 so ve quem tem fatura pendente
              // agora; quem foi cortado por calote e teve a fatura baixada no
              // ERP nunca mais passava por ele, e ficava marcado ativo para
              // sempre. `skipPaymentStatus` continua protegendo a DIVIDA, que e
              // o ativo do bureau — status e vinculo, nao dinheiro.
              status: customer.contractStatus,
              erpSource,
              skipPaymentStatus: true,
            });
            activeUpserted++;
          } catch {}
        }
        console.log(`[ERPSync] ${providerName}: ${activeUpserted} clientes totais upserted (sem geocoding)`);
        if (semDocumento > 0) {
          console.warn(`[ERPSync] ${providerName}: ${semDocumento} cliente(s) do ERP sem CPF/CNPJ — nao entram na base`);
        }
        if (coordsForaDaCidade > 0) {
          console.warn(`[ERPSync] ${providerName}: ${coordsForaDaCidade} coordenada(s) do ERP fora da cidade declarada — nao gravadas`);
        }
      }
    } catch (err: any) {
      console.warn(`[ERPSync] ${providerName}: fetchCustomers falhou: ${err.message}`);
      falhaNaCarteira = err.message;
    }
  }

  // 2. Inadimplentes — CANCELADOS *e* ATIVOS.
  //
  // Ate aqui, quando o conector tinha `fetchCancelledDelinquents`, so ele rodava
  // e `fetchDelinquents` nunca era chamado. No IXC da O L I isso significava
  // gravar divida de 6.038 pessoas enquanto a base deles tinha 42.883 faturas em
  // aberto: cliente ATIVO inadimplente jamais tinha o valor atualizado, porque o
  // passo 1 varre a carteira inteira com `skipPaymentStatus: true` e nao toca em
  // divida. Para um bureau esse e justamente o dado central — quem deve AGORA no
  // provedor vizinho —, e ele estava congelado no que veio do backup antigo.
  //
  // As duas fontes se somam, deduplicadas por documento. A entrada de cancelado
  // tem prioridade quando o mesmo CPF aparece nas duas: ela carrega o status do
  // contrato, e e o calculo que ja rodava em producao. `fetchDelinquents` entra
  // para cobrir quem ela nao devolve, que e o ativo em atraso.
  const hasCancelled = typeof (connector as any).fetchCancelledDelinquents === "function";
  const chaveDoc = (d: string) => (d || "").replace(/\D/g, "");

  const buscar = async (nome: string, fn: () => Promise<ErpFetchResult>): Promise<ErpFetchResult> => {
    try {
      // O tipo anotado importa: sem ele o limiter devolve `unknown` e todo
      // acesso a `.ok`/`.customers` vira erro de tsc.
      const r: ErpFetchResult = await limiter(fn);
      console.log(`[ERPSync] ${providerName}: ${nome} -> ${r.ok ? `${r.customers.length} registros` : `FALHOU (${r.message})`}`);
      return r;
    } catch (err: any) {
      console.warn(`[ERPSync] ${providerName}: ${nome} lancou: ${err.message}`);
      return { ok: false, message: err.message, customers: [] };
    }
  };

  // `null` quando o conector nao tem esse metodo. O placeholder que estava aqui
  // — `{ ok: true, customers: [] }` — era indistinguivel de "a fonte respondeu e
  // nao havia ninguem", e com isso o aborto abaixo nunca disparava para um ERP
  // que so tem `fetchDelinquents`: em 28/08/2026 uma sync do MK com autenticacao
  // recusada ficou gravada como "success", 0 registros, 166ms.
  const cancelados: ErpFetchResult | null = hasCancelled
    ? await buscar("fetchCancelledDelinquents", () => (connector as any).fetchCancelledDelinquents(config))
    : null;
  const emAtraso = await buscar("fetchDelinquents", () => connector.fetchDelinquents(config));

  // So aborta se nenhuma fonte TENTADA respondeu. Uma das duas falhando ainda
  // atualiza a parte que veio — melhor do que descartar tudo e deixar a base
  // envelhecer.
  const tentadas = [cancelados, emAtraso].filter(Boolean) as ErpFetchResult[];
  if (tentadas.every(r => !r.ok)) {
    const msg = `ERP recusou a busca: ${cancelados?.message || emAtraso.message}`;
    console.warn(`[ERPSync] Erro ao buscar ${providerName}: ${msg}`);
    await registrar("error", 0, 1, msg);
    return { upserted: 0, errors: 1 };
  }

  // A LEITURA FOI COMPLETA? E pergunta diferente de "alguma fonte respondeu".
  //
  // O passo 3 usa a lista de inadimplentes como prova NEGATIVA: quem esta na
  // carteira e fora dela tem a divida baixada. Isso so vale se a leitura cobriu
  // a base inteira. Uma fonte recusada, ou clientes que o ERP nao conseguiu
  // responder, tornam a lista curta — e baixar divida com lista curta apaga o
  // debito de quem de fato deve.
  //
  // Sao dois desfechos diferentes, e so um deles precisa parar tudo:
  //
  //   - o conector SABE quem nao leu (`docsNaoLidos`) — esses ficam protegidos
  //     um a um, e a limpeza roda normal para o resto. Um timeout em 3.226
  //     clientes nao pode desligar a limpeza do provedor inteiro; a base ficaria
  //     pintando de vermelho bairro ja resolvido por causa de um blip.
  //   - o conector NAO sabe o que perdeu (`leiturasFalhas`, `leituraParcial`) —
  //     ai nao ha quem proteger, e a baixa nao roda.
  const fonteRecusada = tentadas.find(r => !r.ok);
  const naoLidosAnonimos = tentadas.reduce((s, r) => s + (r.leiturasFalhas ?? 0), 0);
  const naoCobre = tentadas.find(r => r.leituraParcial);
  const docsProtegidos = tentadas.flatMap(r => r.docsNaoLidos ?? []);
  const leituraCompleta = !fonteRecusada && !naoCobre && naoLidosAnonimos === 0;

  if (!leituraCompleta) {
    console.warn(
      `[ERPSync] ${providerName}: leitura incompleta — `
      + `${fonteRecusada ? `fonte recusada (${fonteRecusada.message}); ` : ""}`
      + `${naoCobre ? "a fonte nao cobre a base inteira; " : ""}`
      + `${naoLidosAnonimos} cliente(s) nao lidos e nao identificados. `
      + `A baixa de divida quitada nao vai rodar.`,
    );
  } else if (docsProtegidos.length > 0) {
    console.log(
      `[ERPSync] ${providerName}: ${docsProtegidos.length} cliente(s) nao lidos — `
      + `divida deles preservada, limpeza segue para o resto`,
    );
  }

  const mesclado = mesclarInadimplentes(
    cancelados?.ok ? cancelados.customers : [],
    emAtraso.ok ? emAtraso.customers : [],
  );
  const result: ErpFetchResult = { ok: true, message: "", customers: mesclado.customers };
  console.log(`[ERPSync] ${providerName}: ${mesclado.customers.length} inadimplentes unicos (${mesclado.somenteAtivos} que so aparecem como ativos em atraso)`);

  let upserted = 0;
  let errors = 0;
  let coordsForaDaCidadeNoPasso2 = 0;
  const total = result.customers.length;
  const startMs = Date.now();

  for (let idx = 0; idx < total; idx++) {
    const customer = result.customers[idx];
    if (idx > 0 && idx % 100 === 0) {
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.log(`[ERPSync] ${providerName}: ${idx}/${total} upserted (${elapsed}s)`);
    }
    try {
      let city = customer.city || "";
      let state = customer.state || "";
      let lat: string | undefined;
      let lng: string | undefined;

      // IXC armazena cidade como codigo IBGE (numerico) — resolver via API IBGE
      if (/^\d+$/.test(city)) {
        const ibge = await resolveIbgeCode(city);
        if (ibge) {
          city = ibge.city;
          state = ibge.state;
        } else {
          city = "";
        }
      }

      // Resolver CEP → cidade/estado SOMENTE se o ERP nao forneceu.
      // ViaCEP serializa e pode levar 5s/req × 500+ clientes = 40+min de sync travado.
      if (customer.cep && (!city || !state)) {
        const loc = await geocodeCep(customer.cep);
        if (loc) {
          if (!city) city = loc.city;
          if (!state) state = loc.state;
        }
      }

      // Fallback: cidade do provedor
      if (!city || !state) {
        try {
          const prov = await storage.getProvider(providerId);
          if (prov?.addressCity && prov?.addressState) {
            city = prov.addressCity;
            state = prov.addressState;
          }
        } catch {}
      }

      /*
       * SO A COORDENADA DO ERP ENTRA PELO SYNC.
       *
       * O MK guarda a latitude e a longitude da instalacao por cliente — ponto
       * exato, custo zero, sem rede — e ela vence qualquer outra fonte, desde
       * que combine com a cidade do cadastro (coordenadaDoErpCoerente).
       *
       * O que havia aqui embaixo — geocodificar a rua SEM o numero, com o CEP
       * na frente da rua, aceitando a precisao que viesse, e cair no centro da
       * cidade com 2 km de ruido — era a origem dos pontos a quilometros da
       * casa. E como o upsert grava toda coordenada que recebe, cada sync
       * regravava esse ponto por cima do endereco exato que a plotagem do IBGE
       * tinha resolvido: o mapa piorava a cada passada.
       *
       * Quem nao tem coordenada no ERP fica sem ela AQUI e e resolvido pela
       * plotagem (geocode-backfill.service.ts), que tem a base local do IBGE,
       * exige precisao de rua e so escreve em quem esta sem ponto.
       */
      const doErp = await coordenadaDoErpCoerente(customer.latitude, customer.longitude, city, state);
      if (doErp) {
        lat = String(doErp.lat);
        lng = String(doErp.lng);
      } else if (coordenadaValida(customer.latitude, customer.longitude)) {
        coordsForaDaCidadeNoPasso2++;
      }

      const clienteSalvo = await storage.upsertFromErp({
        providerId,
        cpfCnpj: customer.cpfCnpj,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        addressNumber: customer.addressNumber,
        complement: customer.complement,
        neighborhood: customer.neighborhood,
        city,
        state,
        cep: customer.cep,
        latitude: lat,
        longitude: lng,
        totalOverdueAmount: customer.totalOverdueAmount,
        maxDaysOverdue: customer.maxDaysOverdue,
        overdueInvoicesCount: customer.overdueInvoicesCount ?? 1,
        // Spec 012.0 / connector v2 — status do contrato no ERP
        // "active" = contrato vigente, "cancelled" = ex-cliente (cobranca rescisoria)
        status: (customer as any).contractStatus,
        contractPlan: (customer as any).contractPlan,
        erpSource,
      });

      // O conector ja normaliza equipmentDetails (ver server/erp/types.ts).
      // Ate esta versao ninguem lia esse campo — o sync descartava.
      const detalhes = (customer as any).equipmentDetails as any[] | undefined;
      if (clienteSalvo?.id && detalhes?.length) {
        try {
          await storage.syncEquipmentFromErp(providerId, clienteSalvo.id, detalhes);

          const agregado = await storage.contarEquipamentoRetido(providerId, [clienteSalvo.id]);
          const a = agregado.get(clienteSalvo.id);
          await storage.updateCustomerEquipmentAggregate(
            providerId,
            clienteSalvo.id,
            a?.count ?? 0,
            String(a?.value ?? 0),
          );
        } catch (e: any) {
          // Falha de equipamento nao invalida o upsert do cliente: o dado de
          // divida e mais critico que o de comodato.
          console.warn(`[ERPSync] equipamento ${customer.cpfCnpj}: ${e.message}`);
        }
      }
      upserted++;
    } catch (err: any) {
      errors++;
      if (errors <= 3) {
        console.warn(`[ERPSync] Erro ao upsert ${customer.cpfCnpj}: ${err.message}`);
      }
    }
  }

  console.log(`[ERPSync] ${providerName}: ${upserted} upserted, ${errors} erros de ${result.customers.length} inadimplentes`);
  if (coordsForaDaCidadeNoPasso2 > 0) {
    console.warn(`[ERPSync] ${providerName}: ${coordsForaDaCidadeNoPasso2} inadimplente(s) com coordenada do ERP fora da cidade declarada — nao gravadas`);
  }

  // 3. Quem QUITOU sai da inadimplencia na base local.
  //
  // A varredura acabou de ler do ERP a lista completa de quem tem fatura vencida
  // em aberto. Quem esta na carteira e nao esta nessa lista nao tem fatura
  // vencida segundo o ERP — e leitura, nao deducao. Sem este passo a base so
  // acumula: a Localizacao seguiria pintando de vermelho bairro ja resolvido.
  //
  // So roda quando o passo 2 terminou inteiro: uma lista incompleta baixaria a
  // divida de quem de fato deve. `errors` conta apenas falha de UPSERT — nao
  // cobre fonte recusada nem cliente que o ERP deixou de responder, e e por isso
  // que `leituraCompleta` existe.
  let quitados = 0;
  let falhaNaBaixa: string | undefined;
  if (leituraCompleta && errors === 0 && result.customers.length > 0) {
    try {
      quitados = await storage.baixarDividaQuitada(
        providerId,
        // Quem nao foi lido entra na lista de "ainda devendo": nao aparece como
        // inadimplente, mas tambem nao tem a divida baixada. "Nao sei" preserva
        // o que ja havia, em vez de virar "nada consta".
        [...result.customers.map(c => c.cpfCnpj), ...docsProtegidos],
        new Date(inicioMs),
      );
      if (quitados > 0) {
        console.log(`[ERPSync] ${providerName}: ${quitados} cliente(s) quitaram desde a ultima varredura`);
      }
    } catch (e: any) {
      console.warn(`[ERPSync] ${providerName}: falha ao baixar divida quitada: ${e.message}`);
      falhaNaBaixa = e.message;
    }
  }

  // "success" so quando nada falhou. Um sync que grava 900 de 1000 e "partial":
  // atualizou a base, mas nao inteira — e essa diferenca precisa aparecer.
  //
  // A baixa de divida quitada conta aqui pelo mesmo motivo. Ela nasceu quebrada
  // por um bind de array e ninguem soube: o erro so ia para o console, e a tela
  // dizia "sucesso". Divida ja paga seguia constando no bureau.
  //
  // Leitura incompleta tambem: uma fonte recusada ou clientes nao lidos deixam a
  // base parcialmente atualizada, e o provedor precisa ver isso na tela para
  // saber que o numero ainda nao e o do ERP.
  const problema = errors > 0 || falhaNaBaixa || falhaNaCarteira || !leituraCompleta;
  await registrar(
    !problema ? "success" : upserted > 0 ? "partial" : "error",
    upserted,
    errors,
    errors > 0
      ? `${errors} de ${total} registros falharam no upsert`
      : !leituraCompleta
      ? (fonteRecusada
          ? `leitura incompleta: ${fonteRecusada.message}`
          : naoCobre
          ? "leitura incompleta: a fonte usada nao cobre a base inteira"
          : `leitura incompleta: ${naoLidosAnonimos} cliente(s) o ERP nao respondeu`)
      : falhaNaBaixa
        ? `divida quitada nao pode ser baixada: ${falhaNaBaixa}`
        : falhaNaCarteira
          ? `carteira nao pode ser lida: ${falhaNaCarteira}`
          : quitados > 0 ? `${quitados} quitaram desde a ultima varredura` : undefined,
  );
  return { upserted, errors };
}

/**
 * Varredura de um provedor, com trava de UMA por provedor+ERP.
 *
 * A trava vive aqui e nao na rota porque ha dois chamadores: o botao do painel
 * e o scheduler. Cada rodada faz milhares de chamadas a API do provedor; duas
 * ao mesmo tempo derrubam o ERP dele e as duas gravam na mesma carteira.
 *
 * Recusar e mais util do que enfileirar: quem pediu quer saber que ja esta
 * rodando, nao esperar 11 minutos por uma segunda passada identica.
 */
export async function syncProviderToDb(
  providerId: number,
  providerName: string,
  erpSource: string,
  intg: Parameters<typeof syncProviderToDbInterno>[3],
  syncType: "auto" | "manual" = "auto",
): Promise<{ upserted: number; errors: number; jaEmAndamento?: boolean }> {
  const chave = `${providerId}:${erpSource}`;
  const trava = await tentarTravar(providerId, erpSource);
  if (!trava.obtida) {
    console.log(`[ERPSync] ${providerName} (${erpSource}): ja ha varredura em andamento, ignorando`);
    return { upserted: 0, errors: 0, jaEmAndamento: true };
  }
  _emVoo.add(chave);
  try {
    return await syncProviderToDbInterno(providerId, providerName, erpSource, intg, syncType);
  } finally {
    _emVoo.delete(chave);
    await trava.liberar();
  }
}

export async function syncAllProviders(): Promise<void> {
  if (_syncing) {
    console.log("[ERPSync] Sync ja em andamento, pulando");
    return;
  }
  _syncing = true;

  try {
    const integrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
    if (integrations.length === 0) {
      // Nao e "tudo certo, nada a fazer": e o desfecho mais comum de uma base
      // restaurada de backup, onde as integracoes vieram com is_enabled = false
      // ou sem token. Sem esta linha o sync passa em silencio e a base envelhece
      // sem nenhum sinal.
      console.warn("[ERPSync] Nenhuma integracao habilitada COM url e token — nada foi sincronizado.");
      return;
    }
    console.log(`[ERPSync] ${integrations.length} integracao(oes) a sincronizar`);
    for (const intg of integrations) {
      if (!intg.apiUrl || !intg.apiToken) continue;
      try {
        await syncProviderToDb(
          intg.providerId,
          (intg as any).providerName || `Provider ${intg.providerId}`,
          intg.erpSource,
          {
            apiUrl: intg.apiUrl,
            apiToken: intg.apiToken,
            apiUser: intg.apiUser,
            mkContraSenha: (intg as any).mkContraSenha ?? null,
            clientId: intg.clientId,
            clientSecret: intg.clientSecret,
            extraConfig: intg.extraConfig as Record<string, string> | null,
          },
        );
      } catch (err: any) {
        console.warn(`[ERPSync] Erro no provider ${intg.providerId}: ${err.message}`);
        // A excecao ja saiu do syncProviderToDb sem passar pelo `registrar` dele,
        // entao o registro tem que ser feito aqui — senao o unico desfecho que
        // some do historico e justamente o pior.
        try {
          await storage.registrarResultadoSync(intg.providerId, intg.erpSource, {
            status: "error", upserted: 0, errors: 1,
            syncType: "auto", mensagem: err?.message || "excecao nao tratada",
          });
        } catch {}
      }
    }
  } catch (err: any) {
    // Sem este catch, uma falha na LEITURA das integracoes escapava por um
    // try/finally sem catch e virava um `console.warn` de uma linha no
    // agendador. Era o modo de falha mais silencioso que existia: nenhum
    // provedor sincronizava e nada no sistema dizia por que.
    console.error(`[ERPSync] Sync abortado antes de comecar: ${err?.message}`);
  } finally {
    _syncing = false;
  }
}

/**
 * O boot so sincroniza se a ultima janela agendada foi PERDIDA.
 *
 * Comparar com "sincronizou nas ultimas N horas" errava dos dois lados agora que
 * a varredura e 3x por semana: um restart um dia depois do sync dispararia uma
 * varredura nova sem necessidade, e um processo que ficou fora do ar na
 * madrugada agendada so voltaria a rodar na janela seguinte, dias depois.
 * Comparando com a agenda, o comportamento e o do `Persistent=true` do systemd.
 *
 * Medido em producao em 27/08/2026, antes desta trava: o worker reiniciou 14
 * vezes num dia e cada restart disparava o sync de boot — 11 varreduras
 * completas, 29.124 clientes puxados do IXC por vez, ~30 min cada, martelando a
 * API do provedor o dia inteiro. Um deploy virava carga que o provedor sente.
 *
 * A primeira execucao apos esta versao nao encontra historico e sincroniza — e
 * ela que grava a primeira linha de erp_sync_logs.
 */
async function precisaSincronizarNoBoot(dias: number[], hora: number): Promise<boolean> {
  try {
    const ultimo = await storage.ultimoSyncBemSucedido();
    if (!ultimo) return true;
    const janela = ultimaExecucaoAgendada(new Date(), dias, hora);
    if (ultimo >= janela) {
      console.log(
        `[ERPSync] Sync de boot dispensado — a varredura de ${janela.toLocaleString("pt-BR")} ja foi feita.`,
      );
      return false;
    }
    console.log(
      `[ERPSync] Janela de ${janela.toLocaleString("pt-BR")} foi perdida (ultimo sync ${ultimo.toLocaleString("pt-BR")}) — recuperando agora.`,
    );
    return true;
  } catch (err: any) {
    // Sem conseguir consultar o historico, sincroniza: perder uma atualizacao e
    // pior do que repetir uma.
    console.warn(`[ERPSync] Nao consegui ler o historico (${err.message}); sincronizando por precaucao.`);
    return true;
  }
}

export function startErpSyncScheduler(): void {
  const { dias, hora } = agendaDoAmbiente();
  console.log(`[ERPSync] Scheduler iniciado — varredura da base local: ${descreverAgenda(dias, hora)}`);

  // Sync de boot 15s apos subir, so se a janela agendada foi perdida.
  setTimeout(async () => {
    try {
      if (!(await precisaSincronizarNoBoot(dias, hora))) return;
      console.log("[ERPSync] Sync de recuperacao...");
      await syncAllProviders();
    } catch (err: any) {
      console.warn("[ERPSync] Erro na sync inicial:", err.message);
    }
  }, 15000);

  const scheduleNext = () => {
    const agora = new Date();
    const proxima = proximaExecucao(agora, dias, hora);
    const ms = proxima.getTime() - agora.getTime();
    console.log(`[ERPSync] Proxima varredura em ${proxima.toLocaleString("pt-BR")} (em ${Math.round(ms / 3_600_000)}h)`);

    setTimeout(async () => {
      try {
        console.log("[ERPSync] Varredura agendada da base local iniciada...");
        await syncAllProviders();
      } catch (err: any) {
        console.warn("[ERPSync] Erro na varredura agendada:", err.message);
      }
      scheduleNext();
    }, ms);
  };

  scheduleNext();
}
