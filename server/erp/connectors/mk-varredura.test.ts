/**
 * A varredura por faixa não pode devolver carteira parcial com cara de completa.
 *
 * A primeira versão contava timeout e HTTP 500 no mesmo contador de "lote
 * vazio", com o argumento de que "o resto da base vale mais do que nada". Vale
 * menos: três blips seguidos devolviam meia carteira sem nenhuma marca, e o
 * passo 3 do sync usa essa lista como prova NEGATIVA — quem está na base e fora
 * dela tem a dívida baixada. Lista curta apaga o débito de devedor real, que num
 * bureau é o erro que entrega o caloteiro limpo ao provedor vizinho.
 *
 * O teste que dá nome ao arquivo é o terceiro: falha no meio precisa LANÇAR.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MkConnector } from "./mk";

const CONFIG = {
  apiUrl: "http://mk.local:8080/mk",
  apiToken: "token-de-teste",
  mkContraSenha: "contra-de-teste",
  extra: {},
} as any;

/** Um cliente do jeito que o MK devolve, com o mínimo que o conector lê. */
const cliente = (cd: number) => ({
  CodigoPessoa: cd,
  CPF_CNPJ: String(10000000000 + cd),
  Nome: `Cliente ${cd}`,
  Situacao: "Ativo",
  endereco: [{ logradouro: "Rua Teste", numero: cd, cidade: "Ibiporã", estado: "PR", cep: "86200000" }],
});

/**
 * Responde como o MK: autenticação, faixas de clientes e contratos.
 * `faixas` mapeia o código inicial da faixa para a resposta desejada —
 * um array de clientes, ou o literal "falha" para simular o ERP engasgando.
 */
function servidorFake(faixas: Record<number, any[] | "falha">) {
  return vi.fn(async (url: string) => {
    const u = String(url);

    if (u.includes("WSAutenticacao")) {
      return { ok: true, status: 200, json: async () => ({ Token: "sessao-fake" }) } as any;
    }

    if (u.includes("WSMKConsultaClientes")) {
      const ini = Number(new URL(u).searchParams.get("cd_cliente_inicio"));
      const resposta = faixas[ini] ?? [];
      if (resposta === "falha") {
        return { ok: false, status: 500, json: async () => ({}) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ Clientes: resposta }) } as any;
    }

    if (u.includes("WSMKContratosPorCliente")) {
      return { ok: true, status: 200, json: async () => ({ ContratosAtivos: [] }) } as any;
    }

    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

let fetchOriginal: typeof globalThis.fetch;

beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe("varredura por faixa de codigo", () => {
  it("le a carteira inteira e para nos lotes vazios", async () => {
    globalThis.fetch = servidorFake({
      1: [cliente(1), cliente(2)],
      501: [cliente(501)],
      // 1001 em diante vazio — a base acabou
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(3);
  });

  it("falha NO MEIO derruba a varredura — nao devolve meia carteira", async () => {
    // O caso caro: os dois primeiros lotes vieram, o terceiro engasgou. Seguir
    // em frente devolveria 3 de 4 clientes com `ok: true`, e o sync baixaria a
    // divida do quarto por ele "nao estar na lista de inadimplentes".
    globalThis.fetch = servidorFake({
      1: [cliente(1)],
      501: [cliente(501)],
      1001: "falha",
      1501: [cliente(1501)],
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(false);
    expect(r.customers).toHaveLength(0);
    expect(r.message).toMatch(/1001-1500/);
    expect(r.message).toMatch(/parcial/i);
  });

  it("falha no PRIMEIRO lote tambem falha, em vez de devolver base vazia", async () => {
    // Base vazia com `ok: true` seria lida como "este provedor nao tem cliente".
    globalThis.fetch = servidorFake({ 1: "falha" }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(false);
    expect(r.customers).toHaveLength(0);
  });

  it("nao para no primeiro lote vazio — buraco de codigos nao encerra a base", async () => {
    // Cadastro apagado deixa faixa inteira sem ninguem. Só três seguidas
    // significam fim; uma sozinha, não.
    globalThis.fetch = servidorFake({
      1: [cliente(1)],
      501: [],
      1001: [cliente(1001)],
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(2);
  });
});

describe("contrato vigente so e afirmado com envelope legivel", () => {
  it("corpo de ERRO com HTTP 200 nao vira 'sem contrato'", async () => {
    // O MK responde erro com status 200 — foi o que ele devolveu para uma
    // chamada sem parametro. Lido como `ContratosAtivos ?? []`, esse corpo
    // rebaixaria cliente pagante a ex-cliente com divida.
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("WSAutenticacao")) {
        return { ok: true, status: 200, json: async () => ({ Token: "sessao-fake" }) } as any;
      }
      if (u.includes("WSMKConsultaClientes")) {
        const ini = Number(new URL(u).searchParams.get("cd_cliente_inicio"));
        return { ok: true, status: 200, json: async () => ({ Clientes: ini === 1 ? [cliente(1)] : [] }) } as any;
      }
      if (u.includes("WSMKContratosPorCliente")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ CODIGO_ERRO: "004", Mensagem: "Pelo menos um parametro deve ser informado.", status: "ERRO" }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(1);
    // Sem prova, nao se afirma nada: o upsert so grava status quando ele vem.
    // "Ativo" no cadastro nao serve de reserva porque nao prova contrato.
    expect(r.customers[0].contractStatus).toBeUndefined();
  });

  it("lista de contratos vazia — ai sim e ex-cliente", async () => {
    globalThis.fetch = servidorFake({ 1: [cliente(1)] }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.customers[0].contractStatus).toBe("cancelled");
  });

  it("contrato presente devolve ativo", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("WSAutenticacao")) {
        return { ok: true, status: 200, json: async () => ({ Token: "sessao-fake" }) } as any;
      }
      if (u.includes("WSMKConsultaClientes")) {
        const ini = Number(new URL(u).searchParams.get("cd_cliente_inicio"));
        return { ok: true, status: 200, json: async () => ({ Clientes: ini === 1 ? [cliente(1)] : [] }) } as any;
      }
      if (u.includes("WSMKContratosPorCliente")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ContratosAtivos: [{ codcontrato: 1, plano_acesso: "Smart 500MB" }] }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }) as any;

    const r = await new MkConnector().fetchCustomers(CONFIG);

    expect(r.customers[0].contractStatus).toBe("active");
  });
});
