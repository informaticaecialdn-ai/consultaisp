/**
 * As duas regras que as telas de verificacao erravam.
 *
 * 1. O 429 do limitador nao e falha do sistema: e o limitador dizendo que o
 *    pedido anterior SAIU. Tratado como erro generico ("nao foi possivel
 *    reenviar, tente novamente"), ele vira convite a clicar de novo — e cada
 *    clique empurra a espera para mais longe.
 *
 * 2. Depois de confirmar o e-mail, o destino tem de ser o endereco por onde
 *    ESTE provedor entra, e esse endereco so o servidor sabe. Como ele chega
 *    por resposta HTTP, a funcao trata o que recebe com desconfianca: se um dia
 *    alguem passar aqui algo lido da URL da pagina, o pior caso continua sendo
 *    uma tela de login — nunca um redirecionamento para onde o atacante quiser.
 */
import { describe, it, expect } from "vitest";
import {
  enderecoDeLoginDoServidor,
  mensagemDeReenvio,
  minutosDoRetryAfter,
} from "./verificacao-email";

describe("mensagemDeReenvio", () => {
  it("sucesso usa a mensagem do servidor", () => {
    expect(mensagemDeReenvio(200, { message: "Novo link enviado." })).toEqual({
      ok: true,
      mensagem: "Novo link enviado.",
    });
  });

  it("sucesso sem mensagem ainda diz algo util", () => {
    for (const corpo of [null, {}, { message: "  " }, "texto solto"]) {
      const r = mensagemDeReenvio(200, corpo);
      expect(r.ok).toBe(true);
      expect(r.mensagem).toBe("Novo link de verificação enviado. Confira sua caixa de entrada.");
    }
  });

  it("429 explica que o pedido anterior saiu, e nao que deu erro", () => {
    const r = mensagemDeReenvio(429, { message: "Muitas tentativas. Tente novamente em 12 minuto(s)." }, 12);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toBe("Você já pediu um link há pouco. Tente de novo em 12 minutos.");
  });

  it("429 sem Retry-After nao inventa numero", () => {
    expect(mensagemDeReenvio(429, null).mensagem).toBe(
      "Você já pediu um link há pouco. Tente de novo em alguns minutos.",
    );
  });

  it("429 de um minuto fala no singular", () => {
    expect(mensagemDeReenvio(429, null, 1).mensagem).toBe(
      "Você já pediu um link há pouco. Tente de novo em 1 minuto.",
    );
  });

  it("erro de verdade usa a mensagem do servidor quando houver", () => {
    expect(mensagemDeReenvio(400, { message: "Email obrigatorio" })).toEqual({
      ok: false,
      mensagem: "Email obrigatorio",
    });
  });

  it("erro sem mensagem nao deixa a tela muda", () => {
    const r = mensagemDeReenvio(500, null);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toBe("Não foi possível reenviar agora. Tente de novo em instantes.");
  });
});

describe("minutosDoRetryAfter", () => {
  it("converte segundos para minutos, arredondando para cima", () => {
    expect(minutosDoRetryAfter("60")).toBe(1);
    expect(minutosDoRetryAfter("61")).toBe(2);
    expect(minutosDoRetryAfter("900")).toBe(15);
  });

  it("o que nao e numero util vira nulo, e nao NaN na tela", () => {
    for (const v of [null, "", "  ", "logo", "0", "-30"]) {
      expect(minutosDoRetryAfter(v), `entrada ${v}`).toBeNull();
    }
  });
});

describe("enderecoDeLoginDoServidor", () => {
  it("monta o login sobre a origem que o servidor mandou", () => {
    expect(enderecoDeLoginDoServidor("https://nslink.consultaisp.com.br")).toBe(
      "https://nslink.consultaisp.com.br/login",
    );
    expect(enderecoDeLoginDoServidor("https://app.crednet.com.br")).toBe(
      "https://app.crednet.com.br/login",
    );
  });

  /** O destino e sempre uma tela de login — caminho e query do valor caem. */
  it("descarta caminho, query e fragmento do que recebe", () => {
    expect(enderecoDeLoginDoServidor("https://nslink.com.br/qualquer/coisa?x=1#y")).toBe(
      "https://nslink.com.br/login",
    );
  });

  it("recusa esquema que nao seja http nem https", () => {
    for (const v of ["javascript:alert(1)", "data:text/html,<b>", "file:///etc/passwd"]) {
      expect(enderecoDeLoginDoServidor(v), `entrada ${v}`).toBeNull();
    }
  });

  it("recusa o que nao e endereco absoluto", () => {
    for (const v of ["/login", "nslink.com.br", "", "   ", null, undefined, 42, {}]) {
      expect(enderecoDeLoginDoServidor(v), `entrada ${JSON.stringify(v)}`).toBeNull();
    }
  });
});
