import { describe, expect, it } from "vitest";
import { estadoAposLogin } from "./auth";

/**
 * `estadoAposLogin` — revisão final de segurança antes da demonstração
 * pública (item 6): `login()` não lia `demoMode` do corpo de
 * `POST /api/auth/login`, então um login feito DENTRO da página da
 * demonstração (em vez de cair no sandbox por `GET /demo`) só mostrava a
 * faixa de aviso no próximo `checkAuth()` — nunca no instante em que a
 * pessoa acabou de entrar.
 *
 * Testado como função PURA porque este projeto não configura jsdom
 * (`vitest.config.ts` só coleta `.test.ts`) — renderizar o `AuthProvider`
 * não é uma opção aqui.
 */
const USUARIO = { id: 1, email: "dono@nslink.com.br", name: "Dono", role: "admin" as const };

describe("estadoAposLogin", () => {
  it("liga demoMode quando o servidor informa true — sem esperar o proximo /me", () => {
    const r = estadoAposLogin({ user: USUARIO, provider: null, demoMode: true });
    expect(r.demoMode).toBe(true);
  });

  it("demoMode false (ou ausente, resposta de login antiga) nunca acende a faixa", () => {
    expect(estadoAposLogin({ user: USUARIO, provider: null, demoMode: false }).demoMode).toBe(false);
    expect(estadoAposLogin({ user: USUARIO, provider: null }).demoMode).toBe(false);
  });

  it("zera marca quando a resposta nao traz uma (login de provedor por cima de sessao de revendedor)", () => {
    expect(estadoAposLogin({ user: USUARIO, provider: null }).marca).toBeNull();
  });

  it("preserva a marca quando a resposta traz uma (login de revendedor)", () => {
    const marca = { id: 3, nomeProduto: "CredNet", slug: "crednet", dominio: "app.crednet.com.br", dominioStatus: "ativo", revendaAtiva: true, comissaoPercentual: 20 };
    expect(estadoAposLogin({ user: USUARIO, provider: null, marca }).marca).toEqual(marca);
  });

  it("sempre encerra personificacao — login novo nao pode herdar janela de suporte da sessao anterior", () => {
    expect(estadoAposLogin({ user: USUARIO, provider: null }).personificando).toBe(false);
  });

  it("preserva mustChangePassword quando o servidor manda true", () => {
    expect(estadoAposLogin({ user: USUARIO, provider: null, mustChangePassword: true }).mustChangePassword).toBe(true);
  });

  it("mustChangePassword ausente vira false, nunca undefined", () => {
    expect(estadoAposLogin({ user: USUARIO, provider: null }).mustChangePassword).toBe(false);
  });

  it("repassa user e provider sem transformar", () => {
    const provider = { id: 7 } as any;
    const r = estadoAposLogin({ user: USUARIO, provider });
    expect(r.user).toBe(USUARIO);
    expect(r.provider).toBe(provider);
  });
});
