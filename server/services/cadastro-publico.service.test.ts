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

import { emitirPasse, conferirPasse, contaDeBusca, buscaAutomaticaDisponivel } from "./cadastro-publico.service";

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
