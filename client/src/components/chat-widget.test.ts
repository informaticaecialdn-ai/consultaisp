import { describe, it, expect } from "vitest";
import { ocultaChat } from "./chat-widget";

/**
 * Quem ve o widget de chat.
 *
 * A pergunta e "quem tem provedor para assinar a mensagem". A thread nasce
 * amarrada ao `providerId` da sessao; papel sem provedor nao tem o que dizer por
 * aqui, e a rota `/api/chat/*` recusa a sessao dele de qualquer forma.
 */
describe("ocultaChat", () => {
  it("provedor fala com a plataforma por aqui", () => {
    expect(ocultaChat("admin")).toBe(false);
    expect(ocultaChat("user")).toBe(false);
  });

  /* Ele e o outro lado da conversa — atende pelo Chat com Provedores, com o
     proprio nome. Vale inclusive personificando: teclar aqui assinaria a
     mensagem com o nome do provedor num chamado que o provedor nao abriu. */
  it("superadmin nao", () => {
    expect(ocultaChat("superadmin")).toBe(true);
  });

  /* Decisao 13 do dono: nesta fase quem atende o provedor continua sendo a
     plataforma, em nome da marca, e o revendedor nao ve thread de suporte. */
  it("revendedor tambem nao", () => {
    expect(ocultaChat("revendedor")).toBe(true);
  });

  /**
   * Sem sessao o widget nem chega a montar (App.tsx troca a casca inteira pela
   * tela de login). Erra para o lado de MOSTRAR de proposito: a alternativa
   * seria esconder o canal de suporte de um provedor durante o piscar em que o
   * `/api/auth/me` ainda nao respondeu.
   */
  it("sem papel conhecido, mostra", () => {
    expect(ocultaChat(undefined)).toBe(false);
  });
});
