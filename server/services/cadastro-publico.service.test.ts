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

vi.mock("../storage", () => ({ storage: { getProviderByCnpj: vi.fn(async () => undefined) } }));

import { emitirPasse, conferirPasse, credencialDaPlataforma, buscaAutomaticaDisponivel } from "./cadastro-publico.service";

const CNPJ = "33000167000101";
const segredoOriginal = process.env.SESSION_SECRET;

beforeEach(() => { process.env.SESSION_SECRET = "segredo-de-teste-do-cadastro"; });
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

describe("credencial da plataforma", () => {
  it("ausente = busca automatica desligada, e o cadastro cai no manual", () => {
    expect(credencialDaPlataforma()).toBeNull();
    expect(buscaAutomaticaDisponivel()).toBe(false);
  });

  it("so vale com login E senha — meia credencial nao liga a busca paga", () => {
    process.env.BIGDATA_PLATAFORMA_LOGIN = "conta-da-casa";
    expect(credencialDaPlataforma()).toBeNull();

    process.env.BIGDATA_PLATAFORMA_SENHA = "senha-da-casa";
    expect(credencialDaPlataforma()).toEqual({ login: "conta-da-casa", password: "senha-da-casa" });
    expect(buscaAutomaticaDisponivel()).toBe(true);
  });
});
