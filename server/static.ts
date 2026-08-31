import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { resolverMarcaPorHost } from "./services/marca.service";
import { injetarMarca } from "./marca-html";

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

  // O index.html do build, lido uma vez. E o mesmo para todo mundo; o que muda
  // por host e a faixa da marca, escrita a cada resposta.
  const indexPath = path.resolve(distPath, "index.html");
  const template = fs.readFileSync(indexPath, "utf-8");

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", async (req, res) => {
    try {
      const marca = await resolverMarcaPorHost(req.hostname);
      // no-store porque a resposta depende do host: um proxy que cacheasse sem
      // considerar isso serviria a marca de um revendedor no dominio de outro.
      res.status(200)
        .set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
        .end(injetarMarca(template, marca));
    } catch {
      // Marca indisponivel nao pode significar pagina em branco.
      res.sendFile(indexPath);
    }
  });
}
