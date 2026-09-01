/**
 * O passe da etapa 1 e o que impede a rota de CPF de virar um consultor de
 * bureau aberto na internet.
 *
 * Sem ele, `POST /api/public/cadastro/responsavel` seria um laco de graca sobre
 * uma consulta que custa R$ 1,09 por chamada na conta da plataforma. Com ele,
 * cada CPF custa antes um CNPJ que passou por tres filtros gratuitos.
 *
 * Estes testes cobrem a assinatura e a expiracao. A economia de custo em si
 * (digito verificador -> banco -> Receita -> BigDataCorp) esta documentada no
 * proprio servico.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const getBigdataIntegration = vi.fn();
vi.mock("../storage", () => ({
  storage: {
    getProviderByCnpj: vi.fn(async () => undefined),
    getBigdataIntegration: (id: number) => getBigdataIntegration(id),
  },
}));

import { emitirPasse, conferirPasse, contaDeBusca, buscaAutomaticaDisponivel, buscarBureauEmpresa, buscarResponsavel } from "./cadastro-publico.service";

const CNPJ = "33000167000101";
const segredoOriginal = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "segredo-de-teste-do-cadastro";
  getBigdataIntegration.mockReset();
  getBigdataIntegration.mockResolvedValue(undefined);
});
afterEach(() => {
  process.env.SESSION_SECRET = segredoOriginal;
  delete process.env.BIGDATA_PLATAFORMA_LOGIN;
  delete process.env.BIGDATA_PLATAFORMA_SENHA;
  vi.useRealTimers();
});

describe("passe da etapa 1", () => {
  it("o passe emitido e aceito, e devolve o CNPJ que o gerou", () => {
    const r = conferirPasse(emitirPasse(CNPJ));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cnpj).toBe(CNPJ);
  });

  it("passe ausente ou malformado nao passa", () => {
    for (const lixo of [undefined, "", "abc", "a.b", "a.b.c.d", `${CNPJ}.999`]) {
      expect(conferirPasse(lixo as any).ok, `entrada ${JSON.stringify(lixo)}`).toBe(false);
    }
  });

  it("trocar o CNPJ dentro do passe invalida a assinatura", () => {
    // O ataque obvio: pegar um passe legitimo e usar com outro CNPJ.
    const passe = emitirPasse(CNPJ);
    const [, expira, assinatura] = passe.split(".");
    expect(conferirPasse(`11222333000181.${expira}.${assinatura}`).ok).toBe(false);
  });

  it("esticar a validade dentro do passe invalida a assinatura", () => {
    const passe = emitirPasse(CNPJ);
    const [cnpj, , assinatura] = passe.split(".");
    const daquiAUmAno = Date.now() + 365 * 24 * 3600_000;
    expect(conferirPasse(`${cnpj}.${daquiAUmAno}.${assinatura}`).ok).toBe(false);
  });

  it("passe de outro segredo nao passa", () => {
    const passe = emitirPasse(CNPJ);
    process.env.SESSION_SECRET = "outro-segredo-completamente-diferente";
    expect(conferirPasse(passe).ok).toBe(false);
  });

  it("passe expira", () => {
    vi.useFakeTimers();
    const passe = emitirPasse(CNPJ);
    expect(conferirPasse(passe).ok).toBe(true);
    vi.advanceTimersByTime(31 * 60_000);   // a validade e de 30 minutos
    expect(conferirPasse(passe).ok).toBe(false);
  });

  it("sem SESSION_SECRET nao valida nada — falha FECHADA", () => {
    const passe = emitirPasse(CNPJ);
    delete process.env.SESSION_SECRET;
    expect(conferirPasse(passe).ok).toBe(false);
  });
});

describe("conta que paga as buscas do cadastro", () => {
  it("sem integracao cadastrada, a busca fica desligada e o cadastro cai no manual", async () => {
    expect(await contaDeBusca()).toBeNull();
    expect(await buscaAutomaticaDisponivel()).toBe(false);
  });

  it("usa a credencial guardada do provedor de onboarding", async () => {
    getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "conta", password: "senha" });
    const c = await contaDeBusca();
    expect(c).toEqual({ providerId: 1, cred: { login: "conta", password: "senha" } });
    // O providerId acompanha a credencial de proposito: e a chave do cache de
    // token da BigDataCorp, e uma sessao so por conta evita a anterior ser
    // invalidada no meio das consultas pagas do provedor.
    expect(c!.providerId).toBe(1);
  });

  it("integracao DESLIGADA nao serve — respeita o botao do painel", async () => {
    getBigdataIntegration.mockResolvedValue({ isEnabled: false, login: "conta", password: "senha" });
    expect(await contaDeBusca()).toBeNull();
  });

  it("integracao pela metade nao liga a busca paga", async () => {
    getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "conta", password: null });
    expect(await contaDeBusca()).toBeNull();
  });

  it("banco fora do ar cai no manual em vez de derrubar o cadastro", async () => {
    getBigdataIntegration.mockRejectedValue(new Error("conexao recusada"));
    expect(await contaDeBusca()).toBeNull();
  });

  it("conta propria no ambiente tem precedencia sobre a do provedor", async () => {
    getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "do-provedor", password: "x" });
    process.env.BIGDATA_PLATAFORMA_LOGIN = "conta-da-casa";
    process.env.BIGDATA_PLATAFORMA_SENHA = "senha-da-casa";
    expect((await contaDeBusca())!.cred).toEqual({ login: "conta-da-casa", password: "senha-da-casa" });
  });
});

/**
 * O bloco de bureau da empresa sai por rota PUBLICA. Sem o passe, o cadastro
 * viraria consulta de bureau empresarial de graca para qualquer visitante que
 * digitasse um CNPJ — e cada uma custa R$ 0,39 na conta configurada.
 */
describe("bureau da empresa", () => {
  it("sem passe nao consulta", async () => {
    getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "c", password: "s" });
    expect(await buscarBureauEmpresa(CNPJ, undefined)).toEqual({ ok: false });
    expect(await buscarBureauEmpresa(CNPJ, "passe-inventado")).toEqual({ ok: false });
  });

  it("passe de OUTRO CNPJ nao serve — um passe, um CNPJ", async () => {
    // Senao bastava um passe legitimo para varrer a base de empresas do pais.
    getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "c", password: "s" });
    const passeDeOutro = emitirPasse("11222333000181");
    expect(await buscarBureauEmpresa(CNPJ, passeDeOutro)).toEqual({ ok: false });
  });

  it("sem credencial configurada nao consulta", async () => {
    getBigdataIntegration.mockResolvedValue(undefined);
    expect(await buscarBureauEmpresa(CNPJ, emitirPasse(CNPJ))).toEqual({ ok: false });
  });
});

/**
 * O quadro societario da Receita e a ultima porteira GRATUITA antes da consulta
 * de R$ 1,09. Ela transforma "quem tiver um passe consulta qualquer CPF" em
 * "so socio daquele CNPJ dispara a consulta".
 */
describe("responsavel precisa constar no quadro societario", () => {
  const CPF_DO_SOCIO = "52998224725";   // valido no digito verificador

  function receitaCom(qsa: any[]) {
    globalThis.fetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ razao_social: "EMPRESA TESTE", qsa }),
    })) as any;
  }

  it("CPF fora do quadro societario NAO vira consulta paga", async () => {
    getBigdataIntegration.mockResolvedValue({ isEnabled: true, login: "c", password: "s" });
    // mascara de outra pessoa: os digitos do meio nao batem
    receitaCom([{ nome_socio: "OUTRA PESSOA", cnpj_cpf_do_socio: "***111111**" }]);

    const r = await buscarResponsavel(CPF_DO_SOCIO, emitirPasse(CNPJ));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao-socio");
  });

  it("empresa SEM quadro societario passa — MEI nao pode ficar de fora", async () => {
    // Sem credencial, para o teste parar antes da BigDataCorp e provar que a
    // porteira do QSA deixou passar.
    getBigdataIntegration.mockResolvedValue(undefined);
    receitaCom([]);

    const r = await buscarResponsavel(CPF_DO_SOCIO, emitirPasse(CNPJ));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("desligado");   // e nao "nao-socio"
  });

  it("CPF invalido nem chega a consultar a Receita", async () => {
    let chamou = false;
    globalThis.fetch = (async () => { chamou = true; return { ok: false, status: 500, json: async () => ({}) }; }) as any;
    const r = await buscarResponsavel("11111111111", emitirPasse(CNPJ));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("documento");
    expect(chamou).toBe(false);
  });
});
