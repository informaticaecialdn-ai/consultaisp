import { Router } from "express";
import { criarSandbox } from "../demo/sandbox.service";
import { emModoDemo } from "../demo/modo-demo";
import { normalizarHost } from "../tenant";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";

/**
 * A PORTA da demonstracao publica: um clique em "Ver demonstracao" cai aqui e
 * sai logado, dentro de um sandbox proprio (server/demo/sandbox.service.ts).
 *
 * Registrada SEMPRE — nunca condicionada a `emModoDemo()`. Fora da demo este
 * caminho nao pode sumir atras do catch-all da SPA: `server/static.ts` so
 * devolve 404 de verdade para `/assets/*` e `/api/*` (`NUNCA_E_ROTA_DO_APP`);
 * qualquer outro caminho sem rota nenhuma casando — `/demo` incluido — cai no
 * `app.use("/{*path}", ...)` e volta 200 com o index.html dentro. Pular o
 * registro faria a rota "sumir" atras de um 200 silenciosamente errado em vez
 * de um 404 honesto; por isso e o HANDLER, e nao a ausencia de rota, quem
 * decide — e assim o 404 vale nos dois ambientes.
 */
export function registerDemoRoutes(): Router {
  const router = Router();

  // 5 por IP a cada 10 min: criar um sandbox grava a carteira inteira (provedor,
  // usuario administrador, 1.500 clientes, faturas, equipamentos, casos de
  // cobranca — ~5 mil linhas). Sem limite, a porta vira gerador de lixo no banco.
  const limiteDemo = createRateLimiter({ windowMs: 600_000, maxRequests: 5 });

  router.get("/demo", limiteDemo, async (req, res) => {
    if (!emModoDemo()) {
      return res.status(404).json({ message: "Nao encontrado" });
    }

    try {
      // Sessao ja aberta por uma visita anterior a esta mesma porta: reaproveita
      // o sandbox que ja existe em vez de fabricar outro a cada acesso.
      if (req.session.userId && req.session.providerId) {
        return res.redirect("/");
      }

      const sandbox = await criarSandbox();

      // Os mesmos cinco campos que o login de verdade grava
      // (auth.routes.ts:262-268). Sem `hostLogin`/`subdomain`, `requireAuth`
      // expulsaria este visitante com 403 ("Sessao invalida para este
      // endereco") no primeiro acesso seguinte — o vinculo de host ficaria vazio.
      req.session.userId = sandbox.userId;
      req.session.providerId = sandbox.providerId;
      req.session.role = "admin";
      req.session.hostLogin = normalizarHost(req.hostname);
      // O subdominio e o do PROPRIO sandbox recem-criado, nao o do host: a
      // demonstracao roda num host unico (demo.consultaisp.com.br), sem
      // subdominio real por visitante. `requireAuth` so cai no ramo que confere
      // este campo quando falta `hostLogin` — que aqui esta sempre presente.
      req.session.subdomain = sandbox.subdomain;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      return res.redirect("/");
    } catch (error) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
