/**
 * ERP Sync Service — Sincroniza inadimplentes do ERP para tabela customers
 * Roda periodicamente via scheduler. Dados ficam no banco local para:
 * - Mapa de calor (query instantanea)
 * - Consulta por endereco (cross-provider)
 */

import { storage } from "../storage";
import { getConnector, buildConnectorConfig, getProviderLimiter } from "../erp";
import type { ErpFetchResult } from "../erp/types";
import { geocodeCity, geocodeCep, geocodeAddress, resolveIbgeCode } from "./geocoding";
import { coordenadaValida } from "./coordenada";

let _syncing = false;

export function isSyncing(): boolean {
  return _syncing;
}

export async function syncProviderToDb(
  providerId: number,
  providerName: string,
  erpSource: string,
  intg: {
    apiUrl: string | null;
    apiToken: string | null;
    apiUser?: string | null;
    clientId?: string | null;
    clientSecret?: string | null;
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
  if (hasFetchCustomers) {
    try {
      const allResult = await limiter(() => connector.fetchCustomers!(config));
      if (allResult.ok && allResult.customers.length > 0) {
        console.log(`[ERPSync] ${providerName}: fetchCustomers retornou ${allResult.customers.length} clientes totais`);
        let activeUpserted = 0;
        for (const customer of allResult.customers) {
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
            // sync. Não custa rede: veio junto do cadastro. Só isso; nada de
            // geocodificar no passo 1, que percorre milhares de clientes.
            const doErp = coordenadaValida(customer.latitude, customer.longitude);

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
              erpSource,
              skipPaymentStatus: true,
            });
            activeUpserted++;
          } catch {}
        }
        console.log(`[ERPSync] ${providerName}: ${activeUpserted} clientes totais upserted (sem geocoding)`);
      }
    } catch (err: any) {
      console.warn(`[ERPSync] ${providerName}: fetchCustomers falhou: ${err.message}`);
    }
  }

  // 2. Buscar inadimplentes (sobrescreve os ativos com dados de divida + geocoding)
  const hasCancelled = typeof (connector as any).fetchCancelledDelinquents === "function";
  // O tipo anotado importa: o ramo `as any` do ternario fazia o limiter devolver
  // `unknown`, e todo acesso a `result.ok` / `.customers` virava erro de tsc —
  // seis dos ~110 erros pre-existentes do projeto saiam daqui.
  const result: ErpFetchResult = await limiter(() =>
    hasCancelled
      ? (connector as any).fetchCancelledDelinquents(config)
      : connector.fetchDelinquents(config)
  );
  console.log(`[ERPSync] ${providerName}: usando ${hasCancelled ? "fetchCancelledDelinquents" : "fetchDelinquents"}`);

  if (!result.ok) {
    console.warn(`[ERPSync] Erro ao buscar ${providerName}: ${result.message}`);
    await registrar("error", 0, 1, `ERP recusou a busca: ${result.message}`);
    return { upserted: 0, errors: 1 };
  }

  let upserted = 0;
  let errors = 0;
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
      let address = customer.address || "";
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
          if (!address && loc.street) address = loc.street;
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

      // 1. A COORDENADA DO PROPRIO ERP vem primeiro. O MK guarda a latitude e a
      // longitude da instalacao por cliente — ponto exato, custo zero, sem rede.
      // O conector ja normalizava esses campos (server/erp/types.ts) e o sync os
      // descartava: geocodificava o endereco a 1 req/s para chegar a uma
      // aproximacao PIOR do mesmo lugar. Numa carteira de mil clientes isso e a
      // diferenca entre plotar tudo no sync e nao plotar quase nada.
      const doErp = coordenadaValida(customer.latitude, customer.longitude);
      if (doErp) {
        lat = String(doErp.lat);
        lng = String(doErp.lng);
      }

      // 2. Geocodificar por ENDERECO (rua + cidade + estado) — cache por rua unica.
      // Londrina tem ~300 ruas unicas de inadimplentes, nao 3928.
      // Fallback: cidade-level com jitter.
      // LGPD: jitter ±100m no endereco, ±2km na cidade.
      if (!lat && address && city && state) {
        const addrCoords = await geocodeAddress(address, city, state, customer.cep);
        if (addrCoords) {
          lat = String(addrCoords[0] + (Math.random() - 0.5) * 0.002);
          lng = String(addrCoords[1] + (Math.random() - 0.5) * 0.002);
        }
      }
      if (!lat && city && state) {
        const cityCoords = await geocodeCity(city, state);
        if (cityCoords) {
          lat = String(cityCoords[0] + (Math.random() - 0.5) * 0.02);
          lng = String(cityCoords[1] + (Math.random() - 0.5) * 0.02);
        }
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
  // "success" so quando nada falhou. Um sync que grava 900 de 1000 e "partial":
  // atualizou a base, mas nao inteira — e essa diferenca precisa aparecer.
  await registrar(
    errors === 0 ? "success" : upserted > 0 ? "partial" : "error",
    upserted,
    errors,
    errors === 0 ? undefined : `${errors} de ${total} registros falharam no upsert`,
    total,
  );
  return { upserted, errors };
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

/** Janela em que um sync recente dispensa o sync de boot. */
const HORAS_PARA_DISPENSAR_BOOT = Number(process.env.ERP_SYNC_BOOT_SKIP_HORAS ?? 12);

/**
 * O sync de boot so roda se ninguem sincronizou ha pouco.
 *
 * Medido em producao em 27/08/2026: o worker reiniciou 14 vezes num dia e cada
 * restart disparava "sync inicial em 15s" — 11 varreduras COMPLETAS da carteira,
 * 29.124 clientes puxados do IXC por vez, ~35 min cada. Isso nao atualiza nada
 * que o sync das 03:00 nao tivesse atualizado, e martela a API do ERP do
 * provedor o dia inteiro. Um deploy vira uma carga que o provedor sente.
 *
 * A primeira execucao apos esta versao nao encontra historico e sincroniza —
 * que e o desejado: e ela que grava a primeira linha de erp_sync_logs.
 */
async function precisaSincronizarNoBoot(): Promise<boolean> {
  try {
    const ultimo = await storage.ultimoSyncBemSucedido();
    if (!ultimo) return true;
    const horas = (Date.now() - ultimo.getTime()) / 3_600_000;
    if (horas < HORAS_PARA_DISPENSAR_BOOT) {
      console.log(`[ERPSync] Sync de boot dispensado — houve sync ha ${horas.toFixed(1)}h. Proximo as 03:00.`);
      return false;
    }
    return true;
  } catch (err: any) {
    // Sem conseguir consultar o historico, sincroniza: perder uma atualizacao e
    // pior do que repetir uma.
    console.warn(`[ERPSync] Nao consegui ler o historico (${err.message}); sincronizando por precaucao.`);
    return true;
  }
}

export function startErpSyncScheduler(): void {
  console.log("[ERPSync] Scheduler iniciado — sync inicial em 15s, depois todo dia as 03:00");

  // Sync inicial 15s apos boot
  setTimeout(async () => {
    try {
      if (!(await precisaSincronizarNoBoot())) return;
      console.log("[ERPSync] Sync inicial...");
      await syncAllProviders();
    } catch (err: any) {
      console.warn("[ERPSync] Erro na sync inicial:", err.message);
    }
  }, 15000);

  // Agendar proximo sync para 03:00 da madrugada
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    console.log(`[ERPSync] Proximo sync agendado para ${next.toLocaleString("pt-BR")} (em ${Math.round(ms / 60000)} min)`);

    setTimeout(async () => {
      try {
        console.log("[ERPSync] Sync diario das 03:00 iniciado...");
        await syncAllProviders();
      } catch (err: any) {
        console.warn("[ERPSync] Erro no sync diario:", err.message);
      }
      scheduleNext(); // Agendar proximo dia
    }, ms);
  };

  scheduleNext();
}
