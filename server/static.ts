import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { resolverMarcaPorHost } from "./services/marca.service";
import { injetarMarca } from "./marca-html";
import { logger } from "./logger";

/**
 * Caminhos que NUNCA podem cair no index.html.
 *
 * O incidente de 04/09/2026: `npm run build` rodou com o processo no ar. O vite
 * reescreveu `index.html` e trocou os assets por outros, com hash novo, apagando
 * os antigos — e o servidor continuou servindo o HTML que tinha lido no boot,
 * apontando para um `.js` que nao existia mais.
 *
 * O catch-all entao respondeu ESSE PEDIDO com o proprio index.html: 200, 4 KB,
 * `Content-Type: text/html`. O navegador pediu um modulo JavaScript, recebeu
 * HTML, nao parseou, e a pagina ficou EM BRANCO — sem 404, sem erro de rede,
 * com todo pedido respondendo 200. O dono relatou como "o sistema caiu"; os dois
 * processos estavam online e a landing respondia normalmente.
 *
 * Arquivo que nao existe passa a dar 404. Um 404 no console diz o que houve em
 * dois segundos; um 200 com o corpo errado nao diz nada.
 */
const NUNCA_E_ROTA_DO_APP = [/^\/assets\//i, /^\/api\//i];

/** As URLs de `/assets/` que o index.html referencia. */
export function assetsReferenciados(html: string): string[] {
  return Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)).map(m => m[1]);
}

/**
 * O index.html do build, relido quando o arquivo muda no disco.
 *
 * Ler uma vez e guardar para sempre foi a metade silenciosa do incidente acima:
 * o processo servia um HTML de um build que ja nao existia, e nada — nem
 * reiniciar o nginx, nem limpar cache do navegador — corrigia sem restart do
 * node. Um `stat` por requisicao custa microssegundos e faz o processo se
 * corrigir sozinho no primeiro pedido depois do build.
 */
function lerIndexQuandoMudar(indexPath: string) {
  let cache = "";
  let carimbo = 0;

  return (): string => {
    const agora = fs.statSync(indexPath).mtimeMs;
    if (agora !== carimbo) {
      cache = fs.readFileSync(indexPath, "utf-8");
      if (carimbo !== 0) {
        logger.info({ indexPath }, "[static] index.html mudou no disco — recarregado");
      }
      carimbo = agora;
    }
    return cache;
  };
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  /**
   * `index: false` NAO e detalhe — sem ele o white label nao funciona.
   *
   * Por padrao o express.static serve `dist/public/index.html` direto do disco
   * para "/" e "/index.html", ANTES do catch-all abaixo. O resultado seria o
   * pior possivel: rota interna (/login, /dashboard) sairia com a marca certa,
   * e a URL DE ENTRADA — a que o cliente do revendedor digita — sairia com a
   * marca da plataforma.
   *
   * O ambiente de desenvolvimento nao mostra isso: la o Vite roda em
   * `appType: "custom"` e nao serve index.html sozinho. So aparece em producao.
   */
  app.use(express.static(distPath, { index: false }));

  const indexPath = path.resolve(distPath, "index.html");
  const indexAtual = lerIndexQuandoMudar(indexPath);

  /**
   * Confere no BOOT que o HTML e os assets sao do mesmo build.
   *
   * Nao derruba o processo: sem ele o site fica inteiro fora do ar, e um deploy
   * com um asset faltando ainda serve a API, a landing e todo o resto. Mas
   * grita no log, que e o que faltou em 04/09/2026 — o incidente passou
   * despercebido por horas justamente porque nada, em lugar nenhum, dizia que
   * algo estava errado.
   */
  const faltando = assetsReferenciados(indexAtual())
    .filter(url => !fs.existsSync(path.resolve(distPath, url.replace(/^\//, ""))));
  if (faltando.length > 0) {
    logger.error(
      { faltando, distPath },
      "[static] o index.html aponta para assets que NAO existem no disco — a tela vai ficar em branco. " +
      "Build pela metade, ou build feito com o processo no ar: rode `npm run build` e reinicie.",
    );
  }

  app.use("/{*path}", async (req, res) => {
    /**
     * `req.originalUrl`, e NAO `req.path`.
     *
     * Este handler esta montado com `app.use("/{*path}")`, e `app.use` TIRA o
     * prefixo casado de `req.path` — que aqui e o caminho inteiro. Medido em
     * producao no primeiro deploy desta guarda: `/assets/nao-existe.js`
     * continuou respondendo 200 com o index.html dentro, porque o teste rodava
     * contra um `req.path` que ja nao tinha `/assets/`.
     *
     * O mesmo cuidado esta escrito em `server/auth.ts`, pelo mesmo motivo. A
     * query sai fora: "/assets/x.js?v=2" e o mesmo arquivo.
     */
    const caminho = (req.originalUrl || "").replace(/[?#].*$/, "");

    // Ver `NUNCA_E_ROTA_DO_APP`: devolver a casca do app no lugar de um arquivo
    // que falta troca um 404 legivel por uma pagina em branco sem sintoma.
    if (NUNCA_E_ROTA_DO_APP.some(r => r.test(caminho))) {
      return res.status(404).type("text/plain").send("Arquivo nao encontrado");
    }

    try {
      const marca = await resolverMarcaPorHost(req.hostname);
      // no-store porque a resposta depende do host: um proxy que cacheasse sem
      // considerar isso serviria a marca de um revendedor no dominio de outro.
      res.status(200)
        .set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
        .end(injetarMarca(indexAtual(), marca));
    } catch {
      // Marca indisponivel nao pode significar pagina em branco.
      res.sendFile(indexPath);
    }
  });
}
