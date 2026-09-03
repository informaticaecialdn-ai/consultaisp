/**
 * A lista de provedores do superadmin nao pode carregar credencial de ERP.
 *
 * GET /api/admin/providers devolvia, por provedor, `erpUrl` e um `erpToken` no
 * formato "usuario:token" — DECIFRADO. Esse caminho nao esta em
 * SENSITIVE_ROUTES, entao o middleware de log grava o corpo da resposta; e
 * `sanitizeForLog` censura por NOME de chave, e a lista tinha "apiToken", nunca
 * "erpToken". Toda abertura do painel escrevia a credencial de todo provedor
 * integrado em texto puro no log do pm2 — e em cada copia rotacionada.
 *
 * Os dois testes abaixo fecham a porta pelos dois lados: o campo nao existe
 * mais no retorno, e se voltar por outro caminho a censura pega pelo nome.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SEGREDOS = {
  apiToken: "token-real-do-provedor",
  apiUser: "usuario-real",
  mkContraSenha: "contra-senha-real",
  clientSecret: "segredo-oauth-real",
  apiUrl: "https://erp-interno.provedor.invalido:8080",
};

const chamadas = vi.hoisted(() => ({ decifrou: 0 }));

/**
 * O banco de mentira devolve, em QUALQUER `execute`, uma linha que ja carrega
 * as credenciais. Nao e realismo: e a armadilha. Se alguem reintroduzir a
 * consulta a `erp_integrations` (ou qualquer outra que traga segredo), as
 * linhas chegam contaminadas e a assercao sobre o JSON final acusa.
 */
const dbMock = vi.hoisted(() => ({
  db: {
    select: () => ({
      from: async () => [
        { id: 1, name: "Provedor Alfa", cnpj: "11222333000181", plan: "pro", ispCredits: 50 },
        { id: 2, name: "Provedor Beta", cnpj: "44555666000199", plan: "free", ispCredits: 10 },
      ],
    }),
    execute: async () => ({
      rows: [
        {
          provider_id: 1, user_count: 3, admin_email_verified: 1,
          erp_source: "mk", is_enabled: true,
          api_url: "https://erp-interno.provedor.invalido:8080",
          api_user: "usuario-real", api_token: "token-real-do-provedor",
          mk_contra_senha: "contra-senha-real", client_secret: "segredo-oauth-real",
        },
      ],
    }),
  },
  pool: {},
}));
vi.mock("../db", () => dbMock);

vi.mock("../utils/crypto", () => ({
  decryptField: (v: string) => { chamadas.decifrou++; return `decifrado:${v}`; },
  encryptField: (v: string) => v,
  isEncrypted: () => true,
}));

import { ProvidersStorage } from "./providers.storage";
import { sanitizeForLog } from "../utils/sanitize-log";

beforeEach(() => { chamadas.decifrou = 0; });

describe("getAllProvidersWithStats", () => {
  it("o JSON devolvido nao contem NENHUM segredo de ERP", async () => {
    const lista = await new ProvidersStorage().getAllProvidersWithStats();
    const serializado = JSON.stringify(lista);

    // Assercao sobre o corpo inteiro, e nao campo a campo: assim um campo novo
    // que alguem acrescente amanha cai neste mesmo teste.
    for (const segredo of Object.values(SEGREDOS)) {
      expect(serializado).not.toContain(segredo);
    }
    // O sufixo do mock de decifragem: se um segredo passar decifrado, aparece.
    expect(serializado).not.toContain("decifrado:");
  });

  it("nao decifra nada — credencial sem consumidor nem sai do banco", async () => {
    await new ProvidersStorage().getAllProvidersWithStats();
    expect(chamadas.decifrou).toBe(0);
  });

  it("ainda entrega o que a lista existe para mostrar", async () => {
    const lista = await new ProvidersStorage().getAllProvidersWithStats();
    expect(lista).toHaveLength(2);
    expect(lista[0].name).toBe("Provedor Alfa");
    expect(lista[0].userCount).toBe(3);
    expect(lista[0].adminEmailVerified).toBe(true);
    // Provedor sem linha de estatistica nao pode quebrar nem virar NaN.
    expect(lista[1].userCount).toBe(0);
    expect(lista[1].adminEmailVerified).toBe(false);
  });
});

describe("sanitizeForLog cobre o nome que vazou", () => {
  it("censura erpToken e erpUrl — o vazamento reproduzido", () => {
    const r = sanitizeForLog([
      { id: 1, name: "Provedor Alfa", erpSource: "mk", erpEnabled: true,
        erpUrl: SEGREDOS.apiUrl, erpToken: `${SEGREDOS.apiUser}:${SEGREDOS.apiToken}` },
    ]);
    expect(r[0].erpToken).toBe("[REDACTED]");
    expect(r[0].erpUrl).toBe("[REDACTED]");
    expect(JSON.stringify(r)).not.toContain(SEGREDOS.apiToken);
    // O que nao e segredo continua legivel — senao o log perde a utilidade.
    expect(r[0].name).toBe("Provedor Alfa");
    expect(r[0].erpSource).toBe("mk");
  });
});
