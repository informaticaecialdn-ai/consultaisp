import { Router } from "express";
import pLimit from "p-limit";
import { contarSandboxesVivos, criarSandbox, TETO_DE_SANDBOXES_VIVOS } from "../demo/sandbox.service";
import { emModoDemo } from "../demo/modo-demo";
import { normalizarHost } from "../tenant";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import { storage } from "../storage";

/**
 * A demonstração pública roda como UM processo só (`exec_mode: "fork"` em
 * `ecosystem.demo.config.cjs`) — por isso serializar AQUI, dentro do
 * processo, fecha a corrida por inteiro, não só reduz a janela.
 *
 * Revisão final de segurança antes da demonstração pública (item 3): a
 * conferência do teto (`contarSandboxesVivos`) e a criação (`criarSandbox`)
 * eram um check-then-create SEM trava — duas (ou cem) requisições
 * concorrentes liam a mesma contagem, abaixo do teto, ANTES de qualquer uma
 * commitar a própria criação, e cada uma monta uma carteira inteira (~5 mil
 * linhas, dezenas de queries) num processo de 512 MB. `p-limit(1)` faz a
 * checagem e a criação de CADA requisição rodarem em SÉRIE — a próxima só
 * começa a conferir o teto depois que a anterior já commitou (ou falhou).
 */
const filaDeCriacaoDoSandbox = pLimit(1);

/** Sinaliza "no teto" para fora de `filaDeCriacaoDoSandbox` sem confundir com qualquer outra falha (500 genérico). */
class TetoDeSandboxesAtingidoError extends Error {}

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

  // 2 por IP a cada 10 min — nao 5. Criar um sandbox grava a carteira inteira
  // (provedor, usuario administrador, 1.500 clientes, faturas, equipamentos,
  // casos de cobranca — ~5 mil linhas), e duas requisicoes CONCORRENTES (duplo
  // clique, prefetch do navegador) chegam sem cookie nenhum — cada uma cria o
  // seu proprio sandbox antes do primeiro Set-Cookie valer. O teto baixo limita
  // quantos sandboxes um unico visitante consegue gerar nessa janela de corrida;
  // travar por chave de idempotencia eliminaria a corrida de vez, mas e
  // maquinaria demais para o ganho (decisao do revisor, rodada de correcao).
  const limiteDemo = createRateLimiter({ windowMs: 600_000, maxRequests: 2 });

  router.get("/demo", limiteDemo, async (req, res) => {
    if (!emModoDemo()) {
      return res.status(404).json({ message: "Nao encontrado" });
    }

    try {
      // Sessao ja aberta por uma visita anterior a esta mesma porta: reaproveita
      // o sandbox que ja existe em vez de fabricar outro a cada acesso — MAS so
      // depois de confirmar no banco que ele ainda existe. O cookie sozinho nao
      // prova isso: ele sobrevive ate 24h (ver o comentario sobre `cookie.maxAge`
      // abaixo), e a limpeza horaria (Tarefa 7) pode ter apagado o provedor e o
      // usuario antes disso — um relogio de navegador atrasado, ou a limpeza
      // atrasando por qualquer motivo, e o suficiente para o cookie "valer"
      // depois que o sandbox já morreu. Sem esta conferencia, o reaproveitamento
      // redirecionaria para "/" apontando para dado que nao existe mais — a
      // exata promessa que esta rota existe para cumprir, quebrada.
      if (req.session.userId && req.session.providerId) {
        const sandboxAindaExiste = await storage.getProvider(req.session.providerId);
        if (sandboxAindaExiste) {
          return res.redirect("/");
        }
        // Sessao orfa: cai para criar um sandbox novo abaixo, do zero.
      }

      // Teto de sandboxes VIVOS ao mesmo tempo — ver a justificativa de
      // `TETO_DE_SANDBOXES_VIVOS` em sandbox.service.ts. Depois da checagem de
      // reaproveitamento acima: um visitante que VOLTA nunca é barrado por um
      // teto que existe para conter CRIAÇÃO nova.
      //
      // A checagem e a criação rodam DENTRO do mesmo `filaDeCriacaoDoSandbox`
      // — não cada uma no seu próprio `limit(...)` — porque é a DUPLA
      // (conferir E criar como uma coisa só) que precisa ser atômica dentro
      // do processo. Duas chamadas separadas ainda deixariam a requisição B
      // conferir o teto entre o "conferiu" e o "criou" da requisição A.
      let sandbox: Awaited<ReturnType<typeof criarSandbox>>;
      try {
        sandbox = await filaDeCriacaoDoSandbox(async () => {
          if ((await contarSandboxesVivos()) >= TETO_DE_SANDBOXES_VIVOS) {
            throw new TetoDeSandboxesAtingidoError();
          }
          return criarSandbox();
        });
      } catch (error) {
        if (error instanceof TetoDeSandboxesAtingidoError) {
          return res.status(503).json({
            message: "A demonstração está muito concorrida agora. Tente novamente em alguns minutos.",
          });
        }
        throw error;
      }

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

      // O COOKIE NAO PODE SOBREVIVER AO SANDBOX. Sem isto, a sessao herda o
      // padrao global (`SESSAO_PADRAO_MS`, 48h — server/auth.ts) em vez das 24h
      // de `VIDA_DO_SANDBOX_MS`: um visitante que volta entre 25h e 48h depois
      // apresenta um cookie que o Express ainda aceita, mas cuja limpeza horaria
      // ja apagou o provedor e o usuario por baixo. `expiraEm` e quem manda —
      // e o mesmo instante que `sandboxesExpirados()` usa para decidir o que
      // apagar, entao o cookie nunca promete mais tempo de vida do que o
      // registro no banco tem de fato.
      if (req.session.cookie) {
        req.session.cookie.maxAge = sandbox.expiraEm.getTime() - Date.now();
      }

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
