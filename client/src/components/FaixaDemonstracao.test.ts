import { describe, expect, it } from "vitest";
import { ehInstanciaDeDemonstracao, tempoRestanteEmTexto } from "./FaixaDemonstracao";

/**
 * `ehInstanciaDeDemonstracao` — revisão final de segurança antes da
 * demonstração pública (item 6).
 *
 * Antes, `FaixaDemonstracao` decidia SÓ pelo prefixo `sandbox-` do
 * subdomínio. Isso funciona para o visitante do sandbox, mas dependia
 * inteiramente da reserva de namespace (`/api/auth/register`,
 * `/api/admin/providers`) nunca ter uma exceção — um provedor real cujo
 * subdomínio começasse por `sandbox-`, por qualquer caminho esquecido, veria
 * a faixa de demonstração na própria aplicação em produção. Agora a função
 * exige TAMBÉM o sinal do servidor (`demoMode`, projeção de `emModoDemo()`
 * via `GET /api/auth/me`) — e é exatamente essa exigência conjunta que este
 * arquivo prova.
 */
describe("ehInstanciaDeDemonstracao", () => {
  it("true quando os DOIS sinais batem: demoMode e subdominio sandbox-", () => {
    expect(ehInstanciaDeDemonstracao(true, "sandbox-abc123")).toBe(true);
  });

  it("false com subdominio sandbox- mas FORA do modo demo — o caso que a correção fecha", () => {
    // Um provedor de verdade em produção cujo subdominio comecasse por
    // "sandbox-" (a reserva falhando por algum caminho esquecido) NAO pode
    // ver a faixa: o servidor desta instancia diz que nao e demonstracao.
    expect(ehInstanciaDeDemonstracao(false, "sandbox-abc123")).toBe(false);
  });

  it("false em modo demo mas sem o prefixo sandbox- (ex.: o superadmin semeado por SUPERADMIN_EMAIL)", () => {
    expect(ehInstanciaDeDemonstracao(true, "nslink")).toBe(false);
  });

  it("false sem provedor nenhum (subdominio ausente)", () => {
    expect(ehInstanciaDeDemonstracao(true, undefined)).toBe(false);
    expect(ehInstanciaDeDemonstracao(true, null)).toBe(false);
  });

  it("demoMode undefined (resposta antiga do /me, sem o campo) nunca acende a faixa", () => {
    expect(ehInstanciaDeDemonstracao(undefined, "sandbox-abc123")).toBe(false);
  });
});

describe("tempoRestanteEmTexto", () => {
  it("nunca mostra negativo nem NaN", () => {
    expect(tempoRestanteEmTexto(-1000)).toBe("a qualquer momento");
  });
});
