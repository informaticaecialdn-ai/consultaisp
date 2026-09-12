import { Router } from "express";
import pLimit from "p-limit";
import { contarSandboxesVivos, criarSandbox, PREFIXO_SANDBOX, TETO_DE_SANDBOXES_VIVOS } from "../demo/sandbox.service";
import { emModoDemo } from "../demo/modo-demo";
import { cpfsDeExemplo } from "../demo/exemplos.service";
import { normalizarHost } from "../tenant";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { paginaDeErroDaPorta } from "./demo-porta-html";

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
 *
 * Exportada (rodada seguinte) só para o teste conseguir encher a fila
 * diretamente — sem passar pelo limitador de taxa da rota — e prometer o
 * item 5 abaixo sem esperar de verdade ~20s (10 tarefas de ~2s cada) a cada
 * `it()`.
 */
export const filaDeCriacaoDoSandbox = pLimit(1);

/**
 * Item 5 da rodada seguinte: a fila acima é FIFO e ILIMITADA, e cada criação
 * leva ~2s (a carteira inteira: provedor, usuário, ~5 mil linhas). Com o
 * nginx da demo em `proxy_read_timeout 60s`, por volta do 30º visitante
 * enfileirado estoura esse teto — recebe um 504 OPACO da nginx (nunca a
 * mensagem desta rota) enquanto o servidor termina de montar o sandbox dele
 * de qualquer jeito, ao FUNDO, queimando uma das `TETO_DE_SANDBOXES_VIVOS`
 * vagas por 24h com alguém que nunca chegou a ver a demonstração.
 *
 * Recusar CEDO — antes mesmo de entrar na fila — mantém a pior espera real
 * (`PROFUNDIDADE_MAXIMA_DA_FILA` × ~2s ≈ 20s) bem dentro do timeout do
 * proxy. `p-limit` v7 expõe `pendingCount` (quantas tarefas esperam, sem
 * contar a que já está rodando) — é exatamente o que precisamos aqui, sem
 * inventar contador próprio.
 */
const PROFUNDIDADE_MAXIMA_DA_FILA = 10;

/** A mesma frase para as DUAS recusas de "demonstração concorrida" (fila funda e teto de vivos) — nunca duas mensagens para o mesmo motivo. */
const MENSAGEM_DEMO_CONCORRIDA = "A demonstração está muito concorrida agora. Tente novamente em alguns minutos.";

/** Sinaliza "no teto" para fora de `filaDeCriacaoDoSandbox` sem confundir com qualquer outra falha (500 genérico). */
class TetoDeSandboxesAtingidoError extends Error {}

/**
 * `/demo` é a PORTA: quem chega aqui é sempre uma pessoa clicando num link,
 * nunca um cliente de API — as duas respostas que podiam falhar sem virar o
 * redirecionamento de sempre (o limite de tentativas e uma falha ao criar o
 * sandbox) respondiam `{"message":"..."}` cru (item 5 do plano de
 * 2026-09-11). Um estranho que clica duas vezes rápido demais via um blob de
 * JSON no lugar de qualquer coisa que pareça um site.
 *
 * Este middleware intercepta só o `res.json` DESTA requisição (o `res` é por
 * requisição — nada vaza para outra rota nem para outro pedido) e, quando o
 * corpo é o 429 que `createRateLimiter` (middleware genérico, usado por
 * dezenas de outras rotas — nunca mexido) emite, troca por uma página HTML no
 * visual da landing. Qualquer outro `res.json` desta requisição (o 404 de
 * fora do modo demo, o 503 de teto atingido) passa direto, sem mudança —
 * só o 429 e, mais abaixo no handler, o 500 do catch-all viram página.
 */
function paginaNoLimiteDaPorta(_req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const jsonOriginal = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode === 429) {
      const retryAfterHeader = res.getHeader("Retry-After");
      const segundos = Number(retryAfterHeader);
      const minutos = Number.isFinite(segundos) && segundos > 0 ? Math.ceil(segundos / 60) : null;
      res.type("html");
      return res.send(paginaDeErroDaPorta({
        titulo: "Muita gente testando ao mesmo tempo",
        mensagem: "Este link libera poucas tentativas a cada poucos minutos, para a demonstração não travar para ninguém.",
        proximoPasso: minutos
          ? `Espere cerca de ${minutos} minuto${minutos === 1 ? "" : "s"} e clique de novo em "Ver demonstração".`
          : "Espere alguns minutos e clique de novo em \"Ver demonstração\".",
      }));
    }
    return jsonOriginal(body as never);
  }) as typeof res.json;
  next();
}

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

  router.get("/demo", paginaNoLimiteDaPorta, limiteDemo, async (req, res) => {
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

      // Item 5 da rodada seguinte: recusa CEDO, antes de entrar na fila, se
      // ela já estiver funda demais — nunca deixa o pedido esperar perto do
      // timeout do proxy só para descobrir "demonstração concorrida" no
      // fim. Ver a justificativa completa em `PROFUNDIDADE_MAXIMA_DA_FILA`.
      if (filaDeCriacaoDoSandbox.pendingCount > PROFUNDIDADE_MAXIMA_DA_FILA) {
        return res.status(503).json({ message: MENSAGEM_DEMO_CONCORRIDA });
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
          return res.status(503).json({ message: MENSAGEM_DEMO_CONCORRIDA });
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
      // A mesma troca do 429 acima: quem chega em "/demo" é sempre uma pessoa
      // clicando num link, e uma falha ao montar o sandbox merece uma página,
      // não um blob de JSON. `getSafeErrorMessage` continua sendo quem decide
      // o texto seguro — só a embalagem muda.
      return res.status(500).type("html").send(paginaDeErroDaPorta({
        titulo: "Não foi possível abrir sua demonstração agora",
        mensagem: getSafeErrorMessage(error),
        proximoPasso: "Tente novamente em instantes. Se persistir, fale com a gente pelo site.",
      }));
    }
  });

  /**
   * Os três CPFs de exemplo (item 1 do plano de 2026-09-11): a tela de
   * Consulta ISP mostra um chip por situação (limpo / devendo na rede /
   * migrador serial), cada um levando direto à história que a demonstração
   * promete — sem isto o visitante digita um CPF que inventou, recebe "nada
   * consta" e conclui que o produto não faz nada.
   *
   * Gated pelos MESMOS dois sinais que `FaixaDemonstracao`
   * (client/src/components/FaixaDemonstracao.tsx) exige para mostrar o aviso
   * de demonstração: `emModoDemo()` E o subdomínio do PRÓPRIO provedor da
   * sessão começando por `PREFIXO_SANDBOX`. Um provedor de verdade nunca tem
   * exemplo nenhum para sugerir — 404, não um array vazio, para o client não
   * ter que decidir entre "sem exemplos" e "não é uma demonstração".
   *
   * `cpfsDeExemplo` já lê SÓ a carteira do `providerId` da própria sessão
   * (`storage.getCustomersByProvider`) — não existe parâmetro de sandbox
   * alheio para um visitante pedir.
   */
  router.get("/api/demo/exemplos-cpf", requireAuth, requireProvider, async (req, res) => {
    if (!emModoDemo()) {
      return res.status(404).json({ message: "Nao encontrado" });
    }
    const subdomain = (req.session.subdomain ?? "").toLowerCase();
    if (!subdomain.startsWith(PREFIXO_SANDBOX)) {
      return res.status(404).json({ message: "Nao encontrado" });
    }

    try {
      const exemplos = await cpfsDeExemplo(req.session.providerId!);
      return res.json({ exemplos });
    } catch (error) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
