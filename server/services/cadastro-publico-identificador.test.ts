/**
 * O identificador das consultas pagas do onboarding.
 *
 * Estas sao as unicas consultas do sistema que saem por rota SEM SESSAO, nao
 * gravam linha e nao tem provedor dono. Custam dinheiro real (R$ 0,21 no CNPJ,
 * R$ 0,72 no CPF) e ate esta versao o log dizia apenas "onboarding consultou
 * CNPJ na BigDataCorp" — sem nada que ligasse essa linha a uma chamada
 * especifica, e portanto sem nada para o suporte procurar.
 *
 * Aqui o codigo NAO vai para o banco nem para a resposta, de proposito: nao ha
 * a quem devolve-lo e inventar tabela seria guardar consulta de visitante. Ele
 * vive no log, e e o unico fio entre as linhas de uma mesma tentativa.
 *
 * O passe e a economia de custo tem testes proprios em
 * `cadastro-publico.service.test.ts`; este arquivo mede so o rastro.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FORMATO_DO_IDENTIFICADOR } from "./identificador-consulta";

const CNPJ = "33000167000101";
const CPF = "52998224725";
const QUERY_ID = "aa11bb22-cc33-dd44-ee55-ff6677889900";

const getBigdataIntegration = vi.fn();
vi.mock("../storage", () => ({
  storage: {
    getProviderByCnpj: vi.fn(async () => undefined),
    getBigdataIntegration: (id: number) => getBigdataIntegration(id),
  },
}));

const logMock = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));
vi.mock("../logger", () => ({ logger: logMock }));

const bureauMock = vi.hoisted(() => ({ consultarCnpj: vi.fn(), consultarCpf: vi.fn() }));
vi.mock("./bigdata-empresa", async (importOriginal) => {
  const real = await importOriginal<typeof import("./bigdata-empresa")>();
  return { ...real, consultarCnpj: bureauMock.consultarCnpj };
});
vi.mock("./bigdata.service", async (importOriginal) => {
  const real = await importOriginal<typeof import("./bigdata.service")>();
  return { ...real, consultarCpf: bureauMock.consultarCpf };
});

import { emitirPasse, buscarBureauEmpresa, buscarResponsavel } from "./cadastro-publico.service";

const segredoOriginal = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "segredo-de-teste-do-cadastro";
  vi.clearAllMocks();
  getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "conta", password: "senha" });
  bureauMock.consultarCnpj.mockResolvedValue({
    encontrado: true, inadimplencia: { cobrancas365d: 0, naturezas: [] },
    bruto: { QueryId: QUERY_ID },
  });
  bureauMock.consultarCpf.mockResolvedValue({
    dados: { encontrado: true },
    identidade: { nome: "FULANO DE TAL", nascimento: "1980-01-01", situacaoReceita: "REGULAR" },
    bruto: { QueryId: QUERY_ID },
  });
  // A porteira do quadro societario consulta a Receita antes do CPF.
  globalThis.fetch = (async () => ({
    ok: true, status: 200,
    json: async () => ({ razao_social: "EMPRESA TESTE", qsa: [] }),
  })) as any;
});

afterEach(() => {
  process.env.SESSION_SECRET = segredoOriginal;
  vi.useRealTimers();
});

/** Todo objeto de contexto que foi para o log, em qualquer nivel. */
function contextos(): any[] {
  return [logMock.info, logMock.warn, logMock.error, logMock.debug]
    .flatMap(fn => fn.mock.calls.map(c => c[0]))
    .filter(c => c && typeof c === "object");
}

function codigosLogados(): string[] {
  return Array.from(new Set(contextos().map(c => c.consultaId).filter(Boolean)));
}

describe("bureau da empresa no onboarding", () => {
  it("a chamada paga sai com um codigo, do inicio ao fim", async () => {
    const r = await buscarBureauEmpresa(CNPJ, emitirPasse(CNPJ));
    expect(r.ok).toBe(true);

    const codigos = codigosLogados();
    // Um so: inicio e conclusao sao a MESMA consulta.
    expect(codigos).toHaveLength(1);
    expect(codigos[0]).toMatch(FORMATO_DO_IDENTIFICADOR);

    const inicio = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.consulta");
    const fim = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.consulta.fim");
    expect(inicio?.[0].consultaId).toBe(codigos[0]);
    expect(fim?.[0].consultaId).toBe(codigos[0]);
    // O QueryId da BigDataCorp so existe no log: aqui nao ha linha no banco.
    expect(fim?.[0].protocoloOrigem).toBe(QUERY_ID);
  });

  it("o CNPJ sai mascarado — o redact do pino nunca cobriu a chave `cnpj`", async () => {
    await buscarBureauEmpresa(CNPJ, emitirPasse(CNPJ));
    const texto = JSON.stringify(contextos());
    expect(texto).not.toContain(CNPJ);
    expect(texto).toContain(CNPJ.slice(0, 4) + "***");
  });

  it("a recusa gratuita tambem loga, com o motivo e o codigo", async () => {
    // Sem passe nada e gasto, mas o visitante ve o bloco sumir e liga para o
    // suporte. Ate aqui essa tentativa era invisivel.
    const r = await buscarBureauEmpresa(CNPJ, undefined);
    expect(r).toEqual({ ok: false });

    const recusa = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.recusa");
    expect(recusa?.[0].motivo).toBe("passe");
    expect(recusa?.[0].consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
  });

  it("passe de OUTRO CNPJ vira recusa por documento, com codigo", async () => {
    await buscarBureauEmpresa(CNPJ, emitirPasse("11222333000181"));
    const recusa = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.recusa");
    expect(recusa?.[0].motivo).toBe("documento");
  });

  it("busca desligada e recusa, nao erro — e leva codigo", async () => {
    getBigdataIntegration.mockResolvedValue(undefined);
    await buscarBureauEmpresa(CNPJ, emitirPasse(CNPJ));
    const recusa = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.recusa");
    expect(recusa?.[0].motivo).toBe("desligado");
    expect(recusa?.[0].consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
  });

  it("falha do bureau leva o codigo — foi a chamada que gastou e nao entregou", async () => {
    bureauMock.consultarCnpj.mockRejectedValue(new Error("ECONNRESET"));
    const r = await buscarBureauEmpresa(CNPJ, emitirPasse(CNPJ));
    expect(r).toEqual({ ok: false });

    const falha = logMock.warn.mock.calls.at(-1);
    expect(falha?.[0].consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
    // O mesmo codigo do "consulta iniciada": e uma tentativa so.
    expect(codigosLogados()).toHaveLength(1);
  });
});

describe("CPF do responsavel no onboarding", () => {
  it("a consulta mais cara do cadastro fica rastreavel", async () => {
    const r = await buscarResponsavel(CPF, emitirPasse(CNPJ));
    expect(r.ok).toBe(true);

    const codigos = codigosLogados();
    expect(codigos).toHaveLength(1);
    expect(codigos[0]).toMatch(FORMATO_DO_IDENTIFICADOR);

    const fim = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.consulta.fim");
    expect(fim?.[0].encontrado).toBe(true);
    expect(fim?.[0].protocoloOrigem).toBe(QUERY_ID);
  });

  it("CPF nao sai inteiro no log", async () => {
    await buscarResponsavel(CPF, emitirPasse(CNPJ));
    const texto = JSON.stringify(contextos());
    expect(texto).not.toContain(CPF);
    expect(texto).toContain(CPF.slice(0, 4) + "***");
  });

  it("as recusas gratuitas dizem por que nao gastaram", async () => {
    const casos: Array<[() => Promise<unknown>, string]> = [
      [() => buscarResponsavel(CPF, undefined), "passe"],
      [() => buscarResponsavel("11111111111", emitirPasse(CNPJ)), "documento"],
    ];
    for (const [chamar, motivo] of casos) {
      logMock.info.mockClear();
      await chamar();
      const recusa = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.recusa");
      expect(recusa?.[0].motivo, `motivo ${motivo}`).toBe(motivo);
      expect(recusa?.[0].consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
    }
    expect(bureauMock.consultarCpf).not.toHaveBeenCalled();
  });

  it("CPF fora do quadro societario: recusa registrada, consulta nao disparada", async () => {
    globalThis.fetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ razao_social: "EMPRESA TESTE", qsa: [{ nome_socio: "OUTRA", cnpj_cpf_do_socio: "***111111**" }] }),
    })) as any;

    const r = await buscarResponsavel(CPF, emitirPasse(CNPJ));
    expect(r.ok).toBe(false);
    const recusa = logMock.info.mock.calls.find(c => c[0]?.evento === "cadastro.recusa");
    expect(recusa?.[0].motivo).toBe("nao-socio");
    expect(bureauMock.consultarCpf).not.toHaveBeenCalled();
  });

  it("duas tentativas seguidas nao compartilham codigo", async () => {
    await buscarResponsavel(CPF, emitirPasse(CNPJ));
    await buscarResponsavel(CPF, emitirPasse(CNPJ));
    expect(codigosLogados()).toHaveLength(2);
  });
});
