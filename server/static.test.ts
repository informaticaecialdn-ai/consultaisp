/**
 * O SERVIDOR DE ARQUIVOS ESTATICOS — e o incidente de 04/09/2026.
 *
 * `npm run build` rodou com o processo no ar. O vite reescreveu o index.html e
 * trocou os assets por outros, com hash novo, apagando os antigos. O servidor
 * continuou servindo o HTML que tinha lido no BOOT, apontando para um `.js` que
 * ja nao existia — e o catch-all respondeu esse pedido com o proprio index.html:
 * 200, 4 KB, `Content-Type: text/html`.
 *
 * O navegador pediu um modulo JavaScript, recebeu HTML, nao parseou, e a pagina
 * ficou EM BRANCO. Sem 404, sem erro de rede, com todo pedido respondendo 200.
 * O dono relatou como "o sistema caiu"; os dois processos estavam online e a
 * landing respondia normalmente.
 *
 * Os dois casos abaixo sao as duas metades do conserto.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assetsReferenciados } from "./static";

describe("assetsReferenciados", () => {
  it("acha o js e o css que o index.html pede", () => {
    // A conferencia de boot compara esta lista com o que existe no disco. Sem
    // ela, um build pela metade so aparece como tela branca na frente do dono.
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-DZ_Hvi9L.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/index-rgr1MbRP.css">
    </head><body><div id="root"></div></body></html>`;

    expect(assetsReferenciados(html)).toEqual([
      "/assets/index-DZ_Hvi9L.js",
      "/assets/index-rgr1MbRP.css",
    ]);
  });

  it("ignora o que nao e de /assets/", () => {
    // Favicon, logo da marca e URL externa nao vem do build e nao dizem nada
    // sobre ele estar completo.
    const html = `<link rel="icon" href="/favicon.ico">
      <script src="https://cdn.exemplo.com/x.js"></script>
      <img src="/api/marca/3/logo">
      <script src="/assets/index-A.js"></script>`;

    expect(assetsReferenciados(html)).toEqual(["/assets/index-A.js"]);
  });

  it("html sem asset nenhum devolve lista vazia, sem quebrar", () => {
    expect(assetsReferenciados("<html></html>")).toEqual([]);
    expect(assetsReferenciados("")).toEqual([]);
  });
});

/**
 * A regra que transforma "arquivo sumiu" em erro visivel.
 *
 * Reproduz a decisao do catch-all sem subir o express: o que importa e QUAIS
 * caminhos nunca podem receber a casca do app.
 */
describe("caminhos que nunca sao rota do app", () => {
  // Espelha `NUNCA_E_ROTA_DO_APP` em static.ts. Duplicado de proposito: se
  // alguem afrouxar a regra la, este teste tem de falhar, e um teste que importa
  // a propria constante que ele confere nao falha nunca.
  const bloqueado = (caminho: string) => /^\/assets\//i.test(caminho) || /^\/api\//i.test(caminho);

  it("asset que nao existe da 404, e nao a casca do app", () => {
    // Era exatamente este pedido que voltava 200 com HTML dentro.
    expect(bloqueado("/assets/index-BaNEj89-.js")).toBe(true);
    expect(bloqueado("/assets/index-rgr1MbRP.css")).toBe(true);
    expect(bloqueado("/assets/qualquer/coisa.woff2")).toBe(true);
  });

  it("api que nao existe tambem nao devolve HTML", () => {
    // Um cliente que recebe HTML no lugar de JSON quebra com "Unexpected token
    // '<'", que nao diz a ninguem que a rota nao existe.
    expect(bloqueado("/api/rota/que/nao/existe")).toBe(true);
  });

  it("rota do app continua caindo no index.html", () => {
    // Estas SAO do wouter: elas nao existem como arquivo e tem de servir a casca.
    for (const rota of ["/", "/login", "/localizacao", "/painel-provedor", "/admin/provedor/6"]) {
      expect(bloqueado(rota)).toBe(false);
    }
  });

  it("a comparacao ignora caixa — o roteador do Express tambem ignora", () => {
    // Mesmo furo que este repositorio ja teve no log de rotas sensiveis e na
    // guarda do acesso de suporte.
    expect(bloqueado("/ASSETS/index-A.js")).toBe(true);
    expect(bloqueado("/Api/auth/me")).toBe(true);
  });
});
