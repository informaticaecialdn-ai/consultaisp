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
} from "@shared/schema";
import { criarSandbox } from "./sandbox.service";
import { semearMundoBase, PROVEDORES_DA_DEMO } from "./mundo-base";
import { cpfsDeExemplo } from "./exemplos.service";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
import { detectMigrator } from "../services/migrator-detection.service";
import { decryptField } from "../utils/crypto";
// Efeito colateral: com DEMO_MODE=true (acima), registra o conector "demo" no registry.
import "../erp/connectors/demo";

/** As oito tabelas que `semearMundoBase()` + `criarSandbox()` escrevem — ver os dois arquivos. */
const TABELAS = [providers, users, customers, invoices, equipment, erpIntegrations, cobrancaCasos, antiFraudAlerts];
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

function avaliarCondicoes(whereTexto: string, mapa: Map<string, string>, params: unknown[], linha: Record<string, unknown>): boolean {
  if (whereTexto.trim() === "false") return false;
  const igualdades = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" = \$(\d+)/g));
  for (const c of igualdades) {
    if (linha[mapa.get(c[1])!] !== params[Number(c[2]) - 1]) return false;
  }
  const listas = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" in \(([^)]*)\)/g));
  for (const c of listas) {
    const indices = c[2].split(", ").map((ref) => Number(ref.replace("$", "")) - 1);
    const permitidos = indices.map((i) => params[i]);
    if (!permitidos.includes(linha[mapa.get(c[1])!])) return false;
  }
  return true;
}

function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    linhas = linhas.filter((linha) => avaliarCondicoes(whereTexto, mapa, params, linha));
  }
  return projetar(tabela, linhas, textoDeColunas);
}

beforeAll(() => {
  const proxy = drizzle(async (sqlTexto: string, params: unknown[]) => {
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
  });

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
