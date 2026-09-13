import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * VERIFICAÇÃO PELO CAMINHO REAL dos três CPFs de exemplo (item 1 do plano de
 * 2026-09-11): a tela promete um clique por história, e este arquivo prova
 * que cada chip ENTREGA a história prometida — não só que o endpoint tem o
 * formato certo.
 *
 * Roda `criarSandbox()` e `cpfsDeExemplo()` de VERDADE (nenhum dos dois é
 * mockado) contra o mesmo banco de mentira (`drizzle-orm/pg-proxy`) que
 * `server/demo/sandbox.service.test.ts` usa — o compilador SQL real do
 * Drizzle fala com o callback abaixo, que acumula as linhas em memória. Cada
 * um dos três CPFs devolvidos é então consultado pelo CONECTOR "demo" de
 * verdade (`server/erp/connectors/demo.ts`, via `getConnector`), o mesmo
 * caminho que `POST /api/isp-consultations` usa em produção — não uma
 * suposição sobre o que os dados deveriam conter.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-exemplos-caminho-real";
  process.env.DEMO_MODE = "true";
});

const banco = vi.hoisted(() => ({
  linhas: new Map<string, Record<string, unknown>[]>(),
  proximoId: new Map<string, number>(),
  db: null as any,
  /**
   * Devolve `customers` na ordem INVERSA da inserção. Postgres não garante
   * ordem num SELECT sem ORDER BY — na demo publicada o chip "limpo" caiu num
   * cliente com ONU em comodato, que por inserção nunca seria o primeiro.
   */
  inverterClientes: false,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  providers, users, customers, invoices, equipment, erpIntegrations,
  cobrancaCasos, antiFraudAlerts,
  cobrancaPolitica, cobrancaEventos, equipmentRecoveryCases, equipmentRecoveryEvents,
  chatBullqIntegracoes, chatBullqConversas,
  cobrancaNegociacoes, cobrancaParcelas, ispConsultations, spcConsultations, bigdataConsultations, antiFraudRules,
  providerPartners, providerDocuments, erpSyncLogs, creditOrders,
} from "@shared/schema";
import { cobrancaQuitacoes } from "@shared/schema-cobranca-faturas";
import { criarSandbox } from "./sandbox.service";
import { semearMundoBase, PROVEDORES_DA_DEMO } from "./mundo-base";
import { cpfsDeExemplo } from "./exemplos.service";
import { spcSimulado, cadastralSimulado } from "./bureaus-simulados";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
import { detectMigrator } from "../services/migrator-detection.service";
import { calcularScoreISP } from "../utils/isp-score";
import { decryptField } from "../utils/crypto";
// Efeito colateral: com DEMO_MODE=true (acima), registra o conector "demo" no registry.
import "../erp/connectors/demo";

/**
 * As tabelas que `semearMundoBase()` + `criarSandbox()` escrevem — ver os dois
 * arquivos. As seis da segunda linha entraram com a semeadura de "todos os
 * recursos" (política com custos, recuperações, chat): este arquivo não as lê,
 * mas sem o mapa de colunas o INSERT delas estoura antes de o sandbox existir.
 * A terceira e a quarta linhas são as da fiação da Leva 2 (fase B do P2):
 * negociações, quitações, consultas e alertas, ficha do provedor — e as
 * consultas cruzadas que `complementarMundoBase` grava na rede.
 */
const TABELAS = [
  providers, users, customers, invoices, equipment, erpIntegrations, cobrancaCasos, antiFraudAlerts,
  cobrancaPolitica, cobrancaEventos, equipmentRecoveryCases, equipmentRecoveryEvents, chatBullqIntegracoes, chatBullqConversas,
  cobrancaNegociacoes, cobrancaParcelas, cobrancaQuitacoes, ispConsultations, spcConsultations, bigdataConsultations, antiFraudRules,
  providerPartners, providerDocuments, erpSyncLogs, creditOrders,
];
const chavePorColuna = new Map(
  TABELAS.map((t) => [
    getTableName(t),
    new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave])),
  ]),
);

function proximoId(tabela: string): number {
  const atual = (banco.proximoId.get(tabela) ?? 0) + 1;
  banco.proximoId.set(tabela, atual);
  return atual;
}

function nomesDeColuna(textoDeColunas: string): string[] {
  return textoDeColunas.split(", ").map((c) => {
    const m = c.match(/^(?:"(\w+)"\.)?"(\w+)"$/);
    if (!m) throw new Error(`Coluna nao reconhecida: ${c}`);
    return m[2];
  });
}

/** Mesma razão de `sandbox.service.test.ts`: o decoder de TIMESTAMP do drizzle exige a data SEM sufixo de fuso na leitura. */
function paraFormatoDeDriverReal(valor: unknown): unknown {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valor)) {
    return valor.slice(0, -1);
  }
  return valor;
}

function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => paraFormatoDeDriverReal(mapa.get(c) ? linha[mapa.get(c)!] ?? null : null)));
}

function processarInsert(sqlTexto: string, params: unknown[]): { tabela: string; linhasCriadas: Record<string, unknown>[] } {
  const m = sqlTexto.match(/^insert into "(\w+)" \(([^)]*)\) values (.+?)(?: returning (.+))?$/s);
  if (!m) throw new Error(`INSERT nao reconhecido: ${sqlTexto}`);
  const tabela = m[1];
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = m[2].split(", ").map((c) => c.replace(/"/g, ""));
  const tuplas = Array.from(m[3].matchAll(/\(([^()]*)\)/g)).map((t) => t[1].split(", "));

  const acumulado = banco.linhas.get(tabela) ?? [];
  const linhasCriadas: Record<string, unknown>[] = [];
  for (const tupla of tuplas) {
    const linha: Record<string, unknown> = {};
    colunas.forEach((coluna, idx) => {
      const chave = mapa.get(coluna);
      if (!chave) throw new Error(`Coluna "${coluna}" nao mapeada em "${tabela}"`);
      const valorBruto = tupla[idx];
      if (valorBruto === "default") {
        linha[chave] = coluna === "id" ? proximoId(tabela) : null;
        return;
      }
      const ref = valorBruto?.match(/^\$(\d+)$/);
      if (!ref) throw new Error(`Valor inesperado em ${tabela}.${coluna}: ${valorBruto}`);
      linha[chave] = params[Number(ref[1]) - 1];
    });
    acumulado.push(linha);
    linhasCriadas.push(linha);
  }
  banco.linhas.set(tabela, acumulado);
  return { tabela, linhasCriadas };
}

/** Compilado uma vez por comando, e não a cada linha — ver a mesma função em `sandbox.service.test.ts`. */
function compilarCondicoes(whereTexto: string, mapa: Map<string, string>, params: unknown[]): (linha: Record<string, unknown>) => boolean {
  if (whereTexto.trim() === "false") return () => false;
  const igualdades = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" = \$(\d+)/g), (c) => [mapa.get(c[1])!, params[Number(c[2]) - 1]] as const);
  const listas = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" in \(([^)]*)\)/g), (c) =>
    [mapa.get(c[1])!, new Set(c[2].split(", ").map((ref) => params[Number(ref.replace("$", "")) - 1]))] as const);
  return (linha) => igualdades.every(([chave, valor]) => linha[chave] === valor) && listas.every(([chave, permitidos]) => permitidos.has(linha[chave]));
}

function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    linhas = linhas.filter(compilarCondicoes(whereTexto, mapa, params));
  }
  if (tabela === "customers" && banco.inverterClientes) linhas = [...linhas].reverse();
  return projetar(tabela, linhas, textoDeColunas);
}

/**
 * `update "t" set "a" = $1 where ...` só com valores simples — o de
 * `tentarCriarSandbox` que zera a dívida de quem pagou nos últimos 30 dias.
 * Mesma forma de `sandbox.service.test.ts`.
 */
function processarUpdate(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^update "(\w+)" set (.+?) where (.+)$/s);
  if (!m) throw new Error(`UPDATE nao reconhecido: ${sqlTexto}`);
  const [, tabela, textoDoSet, whereTexto] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const atribuicoes = textoDoSet.split(", ").map((trecho) => {
    const a = trecho.match(/^"(\w+)" = \$(\d+)$/);
    if (!a || !mapa.get(a[1])) throw new Error(`SET nao reconhecido: ${trecho}`);
    return [mapa.get(a[1])!, params[Number(a[2]) - 1]] as const;
  });
  const passa = compilarCondicoes(whereTexto, mapa, params);
  for (const linha of banco.linhas.get(tabela) ?? []) {
    if (!passa(linha)) continue;
    for (const [chave, valor] of atribuicoes) linha[chave] = valor;
  }
}

/**
 * `insert into "t" (...) select * from unnest($1::tipo[], ...)` — a escrita por
 * coluna de clientes e faturas (`inserirPorColunas`). Mesma forma de
 * `sandbox.service.test.ts`; aqui o default de coluna fora da lista é nulo, como
 * no INSERT deste arquivo.
 */
function processarInsertPorColunas(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^insert into "(\w+)" \(([^)]*)\) select \* from unnest\((.+)\)$/s);
  if (!m) throw new Error(`INSERT por colunas nao reconhecido: ${sqlTexto}`);
  const [, tabela, textoDeColunas, textoDasListas] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const chaves = textoDeColunas.split(", ").map((c) => {
    const chave = mapa.get(c.replace(/"/g, ""));
    if (!chave) throw new Error(`Coluna ${c} nao mapeada em "${tabela}"`);
    return chave;
  });
  const listas = Array.from(textoDasListas.matchAll(/\$(\d+)::/g), (r) => params[Number(r[1]) - 1] as unknown[]);
  if (listas.length !== chaves.length) throw new Error(`INSERT por colunas com ${chaves.length} colunas e ${listas.length} listas em "${tabela}"`);
  const acumulado = banco.linhas.get(tabela) ?? [];
  for (let i = 0; i < listas[0].length; i++) {
    const linha: Record<string, unknown> = {};
    for (const chave of mapa.values()) {
      if (!chaves.includes(chave)) linha[chave] = chave === "id" ? proximoId(tabela) : null;
    }
    chaves.forEach((chave, j) => { linha[chave] = listas[j][i]; });
    acumulado.push(linha);
  }
  banco.linhas.set(tabela, acumulado);
}

beforeAll(() => {
  const proxy = drizzle(async (sqlTexto: string, params: unknown[]) => {
    if (/^insert into "\w+" \([^)]*\) select \* from unnest\(/.test(sqlTexto)) {
      processarInsertPorColunas(sqlTexto, params);
      return { rows: [] };
    }
    // O lock do complemento do mundo base (`complementarMundoBase`): aqui não há concorrência a travar.
    if (sqlTexto.startsWith("select pg_advisory_xact_lock(")) {
      return { rows: [] };
    }
    if (sqlTexto.startsWith("update ")) {
      processarUpdate(sqlTexto, params);
      return { rows: [] };
    }
    if (sqlTexto.startsWith("insert into")) {
      const retorno = sqlTexto.match(/ returning (.+)$/s);
      const { tabela, linhasCriadas } = processarInsert(sqlTexto, params);
      return { rows: retorno ? projetar(tabela, linhasCriadas, retorno[1]) : [] };
    }
    if (sqlTexto.startsWith("select")) {
      return { rows: processarSelect(sqlTexto, params) };
    }
    throw new Error(`SQL nao suportado pelo banco de mentira: ${sqlTexto}`);
  });
  banco.db = Object.assign(proxy, {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxy),
  });
});

/** Um provedor consultando `cpf`, pelo CONECTOR "demo" de verdade — o mesmo caminho que a rota de consulta usa. */
async function consultarNoProvedor(providerId: number, cpf: string) {
  const config = buildConnectorConfig({
    apiUrl: "demo://mundo-base", apiToken: "x", apiUser: null,
    clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
  });
  config.extra = { ...config.extra, providerId: String(providerId) };
  const conector = getConnector(FONTE_ERP_DEMO)!;
  const resultado = await conector.fetchCustomerByCpf!(config, cpf);
  const achou = resultado.ok && resultado.customers.length > 0;
  return {
    providerId,
    achou,
    cliente: achou ? resultado.customers[0] : null,
  };
}

/**
 * A decisão que `POST /api/isp-consultations` tomaria com estes resultados: o
 * MESMO recorte de `server/routes/consultas.routes.ts` (cliente do consultante
 * -> `proprio`, os demais provedores -> `rede.ocorrencias`, `sugestaoIA` ->
 * `decisionReco`) sobre o motor de score de verdade (`calcularScoreISP`). Fica
 * de fora o que a rota lê de OUTRAS tabelas — sinal de recuperação validado,
 * cruzamento de endereço, consultas recentes —, que este banco de mentira não
 * semeia para o CPF limpo.
 */
function decisaoDaConsulta(consultante: number, resultados: Array<Awaited<ReturnType<typeof consultarNoProvedor>>>): string {
  const achados = resultados.filter((r) => r.achou).map((r) => ({ ...r.cliente!, providerId: r.providerId }));
  const proprio = achados.find((c) => c.providerId === consultante);
  const rede = achados.filter((c) => c.providerId !== consultante);
  const { sugestaoIA } = calcularScoreISP({
    proprio: proprio
      ? {
          // `serviceAgeMonths || 0` na rota: o conector demo não devolve o campo.
          mesesComoCliente: 0,
          diasAtrasoAtual: proprio.maxDaysOverdue,
          valorAtrasoAtual: proprio.totalOverdueAmount,
          faturasAtrasadasTotal: proprio.overdueInvoicesCount || 0,
          faturasTotal: 0,
          equipamentosDevolvidos: proprio.hasUnreturnedEquipment === true ? false : undefined,
          statusContrato: proprio.contractStatus === "cancelled"
            ? "cancelado"
            : proprio.contractStatus === "suspended" || proprio.maxDaysOverdue > 0
              ? "suspenso"
              : proprio.contractStatus === "active" ? "ativo" : "desconhecido",
        }
      : undefined,
    rede: {
      ocorrencias: rede.map((c) => ({
        diasAtraso: c.maxDaysOverdue,
        valorAtraso: c.totalOverdueAmount,
        faturasAtraso: c.overdueInvoicesCount || 0,
        statusContrato: c.contractStatus || "unknown",
      })),
      totalProvedores: new Set(rede.map((c) => c.providerId)).size,
      consultasRecentes30d: 0,
      consultasRecentes90d: 0,
    },
  });
  return sugestaoIA === "APROVAR" ? "Accept" : sugestaoIA === "REJEITAR" ? "Reject" : "Review";
}

describe("o chip 'CPF limpo' sai Aprovar pela consulta real (rodada 2, 13/09/2026)", () => {
  it("LIMPO sai decisionReco Accept — em qualquer ordem que o banco devolva a carteira", async () => {
    const mundoBase = await semearMundoBase();
    const sandbox = await criarSandbox();
    const todosOsProvedores = [sandbox.providerId, ...mundoBase.provedores];
    const escolhidos: string[] = [];
    try {
      for (const invertida of [false, true]) {
        banco.inverterClientes = invertida;
        const limpo = (await cpfsDeExemplo(sandbox.providerId)).find((e) => e.situacao === "limpo")!;
        escolhidos.push(limpo.cpf);
        const resultados = await Promise.all(todosOsProvedores.map((id) => consultarNoProvedor(id, limpo.cpf)));
        expect(
          decisaoDaConsulta(sandbox.providerId, resultados),
          `${invertida ? "ordem invertida" : "ordem de insercao"}: ${JSON.stringify(resultados)}`,
        ).toBe("Accept");
      }
    } finally {
      banco.inverterClientes = false;
    }

    // A ordem invertida põe primeiro os últimos "em dia" — os que têm ONU em
    // comodato. É exatamente o cliente que o conector acusava de não devolver
    // equipamento; sem esta conferência o teste poderia passar sem exercitar o caso.
    const cliente = (banco.linhas.get("customers") ?? []).find(
      (c) => c.providerId === sandbox.providerId && c.cpfCnpj === escolhidos[1],
    )!;
    const aparelhos = (banco.linhas.get("equipment") ?? []).filter((e) => e.customerId === cliente.id);
    expect(aparelhos.map((e) => e.status)).toEqual(["em_comodato"]);
  }, 30_000);

  it("LIMPO nunca é cliente com equipamento de retirada pendente (customers.equipment_count)", async () => {
    await semearMundoBase();
    const sandbox = await criarSandbox();
    const antes = (await cpfsDeExemplo(sandbox.providerId)).find((e) => e.situacao === "limpo")!;
    const linha = (banco.linhas.get("customers") ?? []).find(
      (c) => c.providerId === sandbox.providerId && c.cpfCnpj === antes.cpf,
    )!;

    linha.equipmentCount = 1;
    try {
      const depois = (await cpfsDeExemplo(sandbox.providerId)).find((e) => e.situacao === "limpo")!;
      expect(depois.cpf).not.toBe(antes.cpf);
    } finally {
      linha.equipmentCount = 0;
    }
  }, 30_000);
});

describe("os tres CPFs de exemplo entregam a historia prometida (item 1, verificacao pelo caminho real)", () => {
  it("LIMPO: cliente do proprio sandbox, sem divida em NENHUM provedor da rede", async () => {
    const mundoBase = await semearMundoBase();
    const sandbox = await criarSandbox();
    const exemplos = await cpfsDeExemplo(sandbox.providerId);
    const limpo = exemplos.find((e) => e.situacao === "limpo")!;
    expect(limpo, JSON.stringify(exemplos)).toBeTruthy();

    const todosOsProvedores = [sandbox.providerId, ...mundoBase.provedores];
    const resultados = await Promise.all(todosOsProvedores.map((id) => consultarNoProvedor(id, limpo.cpf)));

    const proprio = resultados.find((r) => r.providerId === sandbox.providerId)!;
    expect(proprio.achou, "o 'limpo' deveria ser cliente do proprio sandbox").toBe(true);
    expect(proprio.cliente!.totalOverdueAmount, JSON.stringify(proprio.cliente)).toBe(0);

    const comDivida = resultados.filter((r) => r.achou && r.cliente!.totalOverdueAmount > 0);
    expect(comDivida, `deveria estar limpo em toda a rede: ${JSON.stringify(resultados)}`).toHaveLength(0);
    // Timeout explicito e generoso (nao o default de 5s do vitest): este teste
    // e o PRIMEIRO do arquivo a rodar, entao paga sozinho o custo de semear o
    // mundo base inteiro (7.502 clientes) MAIS um sandbox (1.500) com cache
    // frio — medido em ~2,4s isolado, margem de ~2x sobre o default, que ja
    // se mostrou insuficiente numa rodada da suite inteira sob carga (passou
    // 5x seguidas e depois deu timeout). Sem isto, o teste que prova a
    // historia de venda mais importante da demonstracao vira bode expiatorio
    // de maquina lenta, nao de regressao real.
  }, 30_000);

  it("DEVENDO NA REDE: em dia no proprio sandbox, mas inadimplente em pelo menos DOIS provedores parceiros", async () => {
    const mundoBase = await semearMundoBase();
    const sandbox = await criarSandbox();
    const exemplos = await cpfsDeExemplo(sandbox.providerId);
    const devendoNaRede = exemplos.find((e) => e.situacao === "devendo_na_rede")!;
    expect(devendoNaRede, JSON.stringify(exemplos)).toBeTruthy();

    const todosOsProvedores = [sandbox.providerId, ...mundoBase.provedores];
    const resultados = await Promise.all(todosOsProvedores.map((id) => consultarNoProvedor(id, devendoNaRede.cpf)));

    const proprio = resultados.find((r) => r.providerId === sandbox.providerId)!;
    expect(proprio.achou, "deveria ser cliente do proprio sandbox tambem").toBe(true);
    expect(proprio.cliente!.totalOverdueAmount, "em dia no PROPRIO sandbox — essa e a historia").toBe(0);

    const parceirosComDivida = resultados.filter(
      (r) => r.providerId !== sandbox.providerId && r.achou && r.cliente!.totalOverdueAmount > 0,
    );
    expect(
      parceirosComDivida.length,
      `esperava >=2 provedores parceiros com divida: ${JSON.stringify(resultados)}`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("IDENTIDADE COMPARTILHADA: um CPF que a rede compartilha e a MESMA pessoa no relatorio ISP, no SPC e no cadastral", async () => {
    // Regressao do defeito medido na verificacao final da demonstracao: dos
    // 150 CPFs que o sandbox reaproveita da rede (CPFS_COMPARTILHADOS), a
    // IDENTIDADE (nome, telefone, endereco) vinha do INDICE LOCAL do sandbox,
    // e so o documento vinha do indice compartilhado — server/demo/sandbox.service.ts
    // chamava `pessoaFicticia(indiceLocal)` e sobrescrevia so `cpfCnpj`. Os
    // bureaus simulados (server/demo/bureaus-simulados.ts) decodificam
    // identidade a partir do proprio CPF, entao mostravam OUTRA pessoa para o
    // mesmo documento que a Consulta ISP acabara de exibir. Medido: 150 de
    // 150 CPFs compartilhados divergiam (o chip "Devendo na rede" incluido).
    const mundoBase = await semearMundoBase();
    const sandbox = await criarSandbox();
    const exemplos = await cpfsDeExemplo(sandbox.providerId);
    const devendoNaRede = exemplos.find((e) => e.situacao === "devendo_na_rede")!;
    expect(devendoNaRede, JSON.stringify(exemplos)).toBeTruthy();

    // Superficie 1: o relatorio da Consulta ISP, pelo MESMO conector "demo"
    // que POST /api/isp-consultations usa em producao (ver o topo do arquivo).
    const noProprioSandbox = await consultarNoProvedor(sandbox.providerId, devendoNaRede.cpf);
    expect(noProprioSandbox.achou, "deveria ser cliente do proprio sandbox").toBe(true);
    const nomeNoRelatorioIsp = noProprioSandbox.cliente!.name as string;

    // Superficies 2 e 3: os bureaus simulados de verdade (nao mockados) —
    // mesmas funcoes que server/services/spc.service.ts e bigdata.service.ts
    // chamam no lugar da rede quando emModoDemo().
    const spc = spcSimulado(devendoNaRede.cpf);
    const cadastral = cadastralSimulado(devendoNaRede.cpf);

    expect(spc.cadastralData.nome, "SPC deveria mostrar a MESMA pessoa que a Consulta ISP").toBe(nomeNoRelatorioIsp);
    expect(
      cadastral.identidade.nome,
      "cadastral (BigDataCorp) deveria mostrar a MESMA pessoa que a Consulta ISP",
    ).toBe(nomeNoRelatorioIsp);

    // E a identidade certa, nao so consistente entre si: o mesmo nome que o
    // provedor DONO deste CPF na rede (o mundo base) ja conhece.
    const naRede = await Promise.all(mundoBase.provedores.map((id) => consultarNoProvedor(id, devendoNaRede.cpf)));
    const dono = naRede.find((r) => r.achou && r.cliente!.totalOverdueAmount > 0);
    expect(dono, `esperava um dono na rede com divida: ${JSON.stringify(naRede)}`).toBeTruthy();
    expect(dono!.cliente!.name, "o provedor dono na rede deveria conhecer a MESMA pessoa").toBe(nomeNoRelatorioIsp);
  });

  it("MIGRADOR SERIAL: detectado por detectMigrator, pelo caminho real (conector + deteccao)", async () => {
    const mundoBase = await semearMundoBase();
    const sandbox = await criarSandbox(); // o migrador vive no MUNDO BASE, mas so aparece quando ha um sandbox consultando
    const exemplos = await cpfsDeExemplo(sandbox.providerId);
    const migrador = exemplos.find((e) => e.situacao === "migrador_serial")!;
    expect(migrador, JSON.stringify(exemplos)).toBeTruthy();

    const resultados = await Promise.all(mundoBase.provedores.map((id) => consultarNoProvedor(id, migrador.cpf)));
    const erpResults = resultados.map((r, i) => ({
      providerId: r.providerId,
      providerName: PROVEDORES_DA_DEMO[i].nome,
      erpSource: FONTE_ERP_DEMO,
      ok: true,
      customers: r.achou
        ? [{
            ...r.cliente,
            // Mesmo operador de normalizeCustomer (server/services/realtime-query.service.ts):
            // `||`, nao `??`.
            status: r.cliente!.contractStatus || (r.cliente as any).status,
            registrationDate: r.cliente!.contractStartDate || (r.cliente as any).registrationDate,
          }]
        : [],
    }));

    const deteccao = detectMigrator({
      cpfCnpj: migrador.cpf,
      consultingProviderId: sandbox.providerId,
      consultingProviderName: "Provedor Demonstração",
      erpResults: erpResults as any,
      recentConsultationsByDistinctProviders: 1,
    });

    expect(deteccao?.detected, JSON.stringify(erpResults)).toBe(true);
  });
});
