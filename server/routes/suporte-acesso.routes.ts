import { Router, type Request, type Response, type NextFunction } from "express";
import {
  requireAuth,
  requireProvider,
  requireAdmin,
  requireSuperAdmin,
  requireSuperAdminMesmoNoSuporte,
  travaDeAcessoDeSuporte,
  encerrarPersonificacao,
  marcarUsoDoAcesso,
} from "../auth";
import { storage } from "../storage";
import { DURACAO_PADRAO_DO_ACESSO_MS } from "../storage/suporte.storage";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";
import type { AcessoDeSuporte } from "@shared/schema";

/**
 * Acesso de suporte: o provedor abre uma janela de 2 horas e, dentro dela, um
 * superadmin entra na conta dele e faz tudo que o admin do provedor faz.
 *
 * Isto e personificacao de conta num bureau de credito sob LGPD: enquanto a
 * janela esta aberta, alguem de fora do tenant le CPF, nome, endereco e
 * telefone de titulares que nunca ouviram falar dele. O isolamento por
 * `providerId` e a invariante central do produto, e este arquivo a atravessa de
 * proposito — e o motivo de cada barreira aqui pesar mais do que a
 * funcionalidade.
 *
 * As barreiras, em ordem:
 *   1. so o ADMIN do provedor abre a janela (nem o operador dele, nem o
 *      suporte ja conectado);
 *   2. a janela nasce e morre pelo relogio do BANCO (server/storage/suporte.storage.ts);
 *   3. `travaDeAcessoDeSuporte` reconfere a janela a cada requisicao, e nao so
 *      na entrada — e a peca que faz "encerrar" alcancar quem ja esta dentro.
 */

/**
 * De quem e a conta que esta na tela.
 *
 * A faixa vermelha (client/src/components/FaixaSuporte.tsx) e o unico lugar do
 * sistema que precisa disto: ela desenha na tela de quem esta personificando, e
 * as telas de um provedor sao, pixel por pixel, iguais as de outro. Sem dizer
 * DE QUEM e a conta, o aviso fica em "voce esta em modo suporte" — verdadeiro e
 * inutil para alguem que atendeu tres provedores na mesma manha.
 *
 * O nome e opcional porque a leitura do provedor pode falhar, e a faixa precisa
 * aparecer de qualquer jeito: ela cai no numero. Anunciar a personificacao e
 * inegociavel; dizer o nome bonito, nao.
 */
interface IdentificacaoDoProvedor {
  providerId: number;
  providerNome?: string;
}

/** Corpo devolvido ao provedor. Nao carrega nome nem e-mail de PESSOA — ver a nota de log no fim do arquivo. */
interface EstadoDoAcesso extends IdentificacaoDoProvedor {
  liberado: boolean;
  expiraEm?: string;
  liberadoEm?: string;
  /** Ja houve pelo menos uma requisicao do suporte dentro desta janela. */
  conectado: boolean;
  primeiroUsoEm?: string;
  ultimoUsoEm?: string;
  /** Amostras de atividade, uma por minuto no maximo. Ver `marcarUsoDoAcesso`. */
  usos: number;
  /** Para a tela dizer "2 horas" sem repetir o numero num literal proprio. */
  duracaoPadraoMs: number;
  /**
   * O relogio do SERVIDOR no instante desta resposta, em ISO.
   *
   * A tela mostra uma contagem regressiva ate `expiraEm`, e sem este campo ela
   * so tem `Date.now()` da maquina do provedor para comparar. Relogio de
   * desktop erra: quem esta 8 minutos adiantado ve a janela fechando 8 minutos
   * antes da hora e conclui que a liberacao nao durou as 2 horas prometidas;
   * quem esta atrasado ve "ainda ha tempo" numa janela que o banco ja fechou —
   * e essa e a leitura perigosa, porque a contagem e o que diz ao provedor por
   * quanto tempo ainda ha gente de fora dentro da conta dele.
   *
   * `desvioDoRelogio` (client/src/components/painel/AbaSuporte.tsx) subtrai
   * este valor do relogio local e corrige a contagem inteira com a diferenca.
   *
   * Sai do relogio do PROCESSO, e nao do banco: `expiraEm` nasce de `now()` no
   * Postgres, entao a correcao supoe servidor e banco proximos — o que vale
   * enquanto os dois estao sob NTP. E uma aproximacao muito melhor que a
   * anterior, que era confiar no navegador. Quem DECIDE se a janela vale
   * continua sendo o banco, a cada requisicao, na trava.
   */
  agora: string;
}

function estado(acesso: AcessoDeSuporte | undefined, quem: IdentificacaoDoProvedor): EstadoDoAcesso {
  const agora = new Date().toISOString();
  if (!acesso) {
    return { ...quem, liberado: false, conectado: false, usos: 0, duracaoPadraoMs: DURACAO_PADRAO_DO_ACESSO_MS, agora };
  }
  return {
    ...quem,
    agora,
    liberado: true,
    expiraEm: new Date(acesso.expiraEm).toISOString(),
    liberadoEm: new Date(acesso.liberadoEm).toISOString(),
    conectado: acesso.primeiroUsoEm != null,
    primeiroUsoEm: acesso.primeiroUsoEm ? new Date(acesso.primeiroUsoEm).toISOString() : undefined,
    ultimoUsoEm: acesso.ultimoUsoEm ? new Date(acesso.ultimoUsoEm).toISOString() : undefined,
    usos: acesso.usos,
    duracaoPadraoMs: DURACAO_PADRAO_DO_ACESSO_MS,
  };
}

/**
 * O nome de exibicao do provedor, ou nada.
 *
 * Engole o erro de proposito: quem chama esta funcao esta respondendo o ESTADO
 * DO ACESSO, e trocar essa resposta por um 500 porque a linha do provedor nao
 * foi lida apagaria a faixa vermelha da tela — o unico sinal de que alguem de
 * fora esta dentro da conta. Um aviso sem nome continua sendo um aviso; a
 * ausencia dele nao e.
 */
async function nomeDoProvedor(providerId: number): Promise<string | undefined> {
  const provedor = await storage.getProvider(providerId).catch(() => undefined);
  // Mesma escolha de `GET /api/tenant/resolve`: o provedor e conhecido pelo
  // nome fantasia, e a razao social so aparece quando nao ha fantasia.
  return provedor?.tradeName || provedor?.name || undefined;
}

/**
 * Uma janela como a TRILHA DO SUPERADMIN a exibe.
 *
 * Sai o NOME de quem liberou, de quem encerrou e de quem entrou; nao sai o id.
 * A pergunta que esta tela responde e "quem olhou o dado deste provedor" — um
 * numero de linha da tabela `users` nao responde nada disso e so serviria para
 * montar consulta em cima de outro tenant a partir do que a tela devolveu.
 */
interface JanelaDaTrilha {
  id: number;
  liberadoEm: string;
  expiraEm: string;
  revogadoEm: string | null;
  liberadoPorNome: string | null;
  revogadoPorNome: string | null;
  usadoPorNome: string | null;
  primeiroUsoEm: string | null;
  ultimoUsoEm: string | null;
  usos: number;
}

/**
 * Os nomes das pessoas citadas nas janelas, em um mapa id -> nome.
 *
 * Resolve por id UNICO e nao por linha: uma trilha de 50 janelas de um provedor
 * cita, na pratica, o mesmo par de administradores e o mesmo punhado de gente do
 * suporte. Sem a deduplicacao seriam ate 150 leituras para responder uma aba que
 * quase ninguem abre.
 *
 * Nome que nao foi lido vira ausencia, nao erro: uma trilha de auditoria com uma
 * celula vazia continua contando quando e por quanto tempo a porta ficou aberta,
 * e e isso que ninguem pode perder. Trocar a trilha inteira por um 500 porque um
 * usuario foi apagado seria perder o registro junto com o nome.
 */
async function nomesDosEnvolvidos(janelas: AcessoDeSuporte[]): Promise<Map<number, string>> {
  // Array com `includes` em vez de `Set`: o projeto compila sem
  // `downlevelIteration`, entao espalhar um Set nao passa no `tsc`. A lista tem
  // um punhado de itens — a busca linear e mais barata que a alocacao do Set.
  const ids: number[] = [];
  for (const j of janelas) {
    for (const id of [j.liberadoPor, j.revogadoPor, j.usadoPor]) {
      if (typeof id === "number" && !ids.includes(id)) ids.push(id);
    }
  }

  const nomes = new Map<number, string>();
  await Promise.all(ids.map(async id => {
    const usuario = await storage.getUser(id).catch(() => undefined);
    if (usuario?.name) nomes.set(id, usuario.name);
  }));
  return nomes;
}

function janelaDaTrilha(j: AcessoDeSuporte, nomes: Map<number, string>): JanelaDaTrilha {
  const nome = (id: number | null) => (id != null ? nomes.get(id) ?? null : null);
  return {
    id: j.id,
    liberadoEm: new Date(j.liberadoEm).toISOString(),
    expiraEm: new Date(j.expiraEm).toISOString(),
    revogadoEm: j.revogadoEm ? new Date(j.revogadoEm).toISOString() : null,
    liberadoPorNome: nome(j.liberadoPor),
    revogadoPorNome: nome(j.revogadoPor),
    usadoPorNome: nome(j.usadoPor),
    primeiroUsoEm: j.primeiroUsoEm ? new Date(j.primeiroUsoEm).toISOString() : null,
    ultimoUsoEm: j.ultimoUsoEm ? new Date(j.ultimoUsoEm).toISOString() : null,
    usos: j.usos,
  };
}

/**
 * A barreira que `requireAdmin` nao da: quem esta personificando NAO autoriza.
 *
 * `requireAdmin` devolve `next()` na primeira linha para superadmin — e correto
 * em toda outra rota, mas aqui significaria que o suporte conectado consegue
 * renovar a propria autorizacao. A janela de 2 horas viraria permanente sem que
 * o provedor clicasse em nada, e "revogar" seria desfeito pelo proprio revogado.
 *
 * Sao duas checagens de proposito. A de `role` e a real: como a personificacao
 * NAO mexe em `role` (ver `PersonificacaoDeSuporte` em server/auth.ts), exigir
 * "admin" exato ja exclui o suporte. A de `session.suporte` e o cinto: se um dia
 * alguem resolver mapear `role` durante a personificacao, esta linha continua
 * de pe e o buraco nao reabre em silencio.
 */
function somenteAdminDoProvedor(req: Request, res: Response, next: NextFunction) {
  if (req.session.suporte) {
    return res.status(403).json({
      message: "O acesso de suporte nao pode ser liberado nem encerrado por quem esta conectado como suporte.",
      code: "SUPPORT_SESSION_FORBIDDEN",
    });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ message: "Somente o administrador do provedor pode liberar o acesso de suporte" });
  }
  next();
}

/**
 * Persiste a sessao ANTES de responder.
 *
 * Sem isto, a resposta diz "conectado" e a gravacao da sessao corre em paralelo
 * com a proxima requisicao do navegador — que pode chegar a uma sessao que
 * ainda nao tem `providerId`. E o mesmo cuidado que o login ja toma.
 */
function salvarSessao(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err: unknown) => (err ? reject(err) : resolve()));
  });
}

export function registerSuporteAcessoRoutes(): Router {
  const router = Router();

  // A trava vive aqui, no primeiro router da cadeia, e nao dentro de cada rota:
  // ela precisa valer para TODAS as rotas do sistema, inclusive as que este
  // arquivo nao conhece. Ver a nota de montagem em server/routes/index.ts.
  router.use(travaDeAcessoDeSuporte);

  // ── Lado do provedor: quem abre e fecha a porta ────────────────────────────

  router.get(
    "/api/provider/acesso-suporte",
    requireAuth,
    requireProvider,
    requireAdmin,
    async (req, res) => {
      const providerId = req.session.providerId!;
      try {
        // Sem `somenteAdminDoProvedor`: LER o estado e o que alimenta a faixa
        // vermelha, e a faixa aparece justamente na tela de quem esta
        // personificando. Ler nao autoriza nada.
        //
        // As duas leituras vao em paralelo porque a faixa e o primeiro pedido de
        // cada tela do suporte: encadea-las somaria uma ida ao banco ao tempo
        // ate o aviso aparecer, e o aviso atrasado e o aviso que nao existiu.
        const [acesso, providerNome] = await Promise.all([
          storage.acessoDeSuporteValido(providerId),
          nomeDoProvedor(providerId),
        ]);
        return res.json(estado(acesso, { providerId, providerNome }));
      } catch (err) {
        return res.status(500).json({ message: getSafeErrorMessage(err) });
      }
    },
  );

  router.post(
    "/api/provider/acesso-suporte/liberar",
    requireAuth,
    requireProvider,
    requireAdmin,
    somenteAdminDoProvedor,
    async (req, res) => {
      const providerId = req.session.providerId!;
      try {
        // A duracao NAO vem do corpo. As 2 horas foram a decisao, e um campo
        // aqui entregaria a escolha a quem chamar a rota — inclusive a uma tela
        // adulterada pedindo o teto de 24h.
        const acesso = await storage.liberarAcessoDeSuporte(providerId, req.session.userId!);
        logger.info(
          { providerId, liberadoPor: req.session.userId, acessoId: acesso.id },
          "[suporte] provedor liberou acesso de suporte",
        );
        // Mesma forma das outras duas respostas, de proposito: a tela guarda o
        // corpo da mutacao no lugar do estado, e um objeto com menos campos
        // faria a identificacao do provedor sumir ate a proxima leitura.
        return res.json(estado(acesso, { providerId, providerNome: await nomeDoProvedor(providerId) }));
      } catch (err: any) {
        if (typeof err?.message === "string" && err.message.startsWith("Duracao invalida")) {
          return res.status(400).json({ message: "Duracao invalida para o acesso de suporte" });
        }
        logger.error({ providerId, err: err?.message }, "[suporte] falha ao liberar acesso");
        return res.status(500).json({ message: getSafeErrorMessage(err) });
      }
    },
  );

  router.post(
    "/api/provider/acesso-suporte/revogar",
    requireAuth,
    requireProvider,
    requireAdmin,
    somenteAdminDoProvedor,
    async (req, res) => {
      const providerId = req.session.providerId!;
      try {
        // Zero janelas fechadas nao e erro: o provedor pode clicar em encerrar
        // numa janela que expirou sozinha enquanto a tela estava aberta. A
        // contagem vai no corpo para a tela dizer o que de fato aconteceu.
        const revogadas = await storage.revogarAcessoDeSuporte(providerId, req.session.userId!);
        logger.info(
          { providerId, revogadoPor: req.session.userId, revogadas },
          "[suporte] provedor encerrou o acesso de suporte",
        );
        return res.json({
          ...estado(undefined, { providerId, providerNome: await nomeDoProvedor(providerId) }),
          revogadas,
        });
      } catch (err: any) {
        logger.error({ providerId, err: err?.message }, "[suporte] falha ao revogar acesso");
        return res.status(500).json({ message: getSafeErrorMessage(err) });
      }
    },
  );

  // ── Lado do superadmin: quem atravessa o isolamento ────────────────────────

  /**
   * A trilha de um provedor: existe janela aberta agora, e quem ja entrou aqui.
   *
   * Sem esta rota a aba Suporte da ficha do provedor (client/src/pages/admin/
   * admin-provedor.tsx) caia no bloco de falha de leitura em toda abertura: a
   * consulta batia num 404 e o botao de entrar — o UNICO caminho de UI para a
   * personificacao — nunca chegava a desenhar. A funcionalidade estava inteira
   * no servidor e inalcancavel pela tela.
   *
   * POR QUE NAO SERVE O `GET /api/provider/acesso-suporte`: aquele responde
   * sobre o provedor que esta NA SESSAO e responde "ha alguem dentro". Este
   * responde sobre um provedor QUALQUER, escolhido por parametro, e a pergunta
   * dele e outra — "quem, quando, e autorizado por quem". Uma rota so teria de
   * misturar as duas audiencias, e a do provedor nao pode receber nome de
   * atendente da plataforma.
   *
   * `vigente` sai de `acessoDeSuporteValido` (prazo medido pelo relogio do
   * BANCO) e nao de uma varredura do historico em JavaScript: a tela usa esse
   * campo para decidir se oferece o botao, e a rota de entrar reconfere no banco
   * de qualquer jeito. Duas respostas diferentes para a mesma pergunta seriam um
   * botao que aparece e recusa.
   */
  router.get(
    "/api/admin/acesso-suporte/:providerId",
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
      const providerId = Number(req.params.providerId);
      if (!Number.isInteger(providerId) || providerId <= 0) {
        return res.status(400).json({ message: "Provedor invalido" });
      }
      try {
        const [vigente, historico] = await Promise.all([
          storage.acessoDeSuporteValido(providerId),
          storage.historicoDeAcessos(providerId),
        ]);

        // A vigente entra na busca de nomes por garantia: por construcao ela e a
        // mais recente e ja esta no historico, mas o historico tem limite e
        // depender disso deixaria a linha do topo da tela sem nome no dia em que
        // o limite encolher.
        const nomes = await nomesDosEnvolvidos(vigente ? [...historico, vigente] : historico);

        return res.json({
          vigente: vigente ? janelaDaTrilha(vigente, nomes) : null,
          historico: historico.map(j => janelaDaTrilha(j, nomes)),
        });
      } catch (err: any) {
        logger.error(
          { superadminId: req.session.userId, providerId, err: err?.message },
          "[suporte] falha ao ler a trilha de acesso",
        );
        return res.status(500).json({ message: getSafeErrorMessage(err) });
      }
    },
  );

  router.post(
    "/api/admin/acesso-suporte/:providerId/entrar",
    requireAuth,
    // Guarda tolerante porque a regra desta rota, logo abaixo, e mais precisa
    // que a generica: chamada de dentro de uma janela ela responde 409 dizendo
    // EM QUAL provedor a pessoa esta. Com `requireSuperAdmin` o 409 nunca seria
    // alcancado, e a resposta viraria um 403 que nao diz de onde sair.
    requireSuperAdminMesmoNoSuporte,
    async (req, res) => {
      // Sair antes de entrar noutro. Trocar de provedor sem sair deixaria a
      // janela anterior com `ultimo_uso_em` congelado no meio do atendimento, e
      // a trilha nao contaria a saida — que e metade da pergunta "ate quando
      // esteve dentro".
      if (req.session.suporte) {
        return res.status(409).json({
          message: "Ja existe um acesso de suporte em andamento. Encerre antes de entrar em outro provedor.",
          code: "SUPPORT_ALREADY_CONNECTED",
          providerId: req.session.suporte.providerId,
        });
      }

      const providerId = Number(req.params.providerId);
      if (!Number.isInteger(providerId) || providerId <= 0) {
        return res.status(400).json({ message: "Provedor invalido" });
      }

      try {
        const acesso = await storage.acessoDeSuporteValido(providerId);
        if (!acesso) {
          // Nao distingue "nunca liberou" de "expirou" de "revogou": as tres
          // respostas sao a mesma para quem esta do lado de fora, e a diferenca
          // esta na trilha, para quem tem direito de le-la.
          return res.status(403).json({
            message: "Este provedor nao tem acesso de suporte liberado.",
            code: "SUPPORT_ACCESS_MISSING",
          });
        }

        await marcarUsoDoAcesso(acesso.id, req.session.userId!);

        req.session.providerId = providerId;
        req.session.suporte = {
          acessoId: acesso.id,
          providerId,
          expiraEm: new Date(acesso.expiraEm).toISOString(),
        };
        await salvarSessao(req);

        logger.info(
          { superadminId: req.session.userId, providerId, acessoId: acesso.id },
          "[suporte] superadmin entrou no provedor",
        );

        return res.json({
          conectado: true,
          providerId,
          acessoId: acesso.id,
          expiraEm: req.session.suporte.expiraEm,
        });
      } catch (err: any) {
        logger.error(
          { superadminId: req.session.userId, providerId, err: err?.message },
          "[suporte] falha ao entrar no provedor",
        );
        return res.status(500).json({ message: getSafeErrorMessage(err) });
      }
    },
  );

  router.post(
    "/api/admin/acesso-suporte/sair",
    requireAuth,
    // A UNICA rota de plataforma que atende DENTRO da personificacao.
    // `requireSuperAdmin` recusa na janela — e tem de recusar, senao a
    // liberacao de um provedor abriria a lista de todos os outros. Aqui a
    // recusa prenderia o atendente dentro do provedor ate o prazo acabar.
    requireSuperAdminMesmoNoSuporte,
    async (req, res) => {
      // Idempotente de proposito: a trava pode ter derrubado a personificacao
      // segundos antes (liberacao revogada), e nesse caso o client cai aqui
      // para limpar a tela. Responder 404 obrigaria o client a tratar dois
      // caminhos para o mesmo desfecho — estar fora do provedor.
      const anterior = req.session.suporte;
      encerrarPersonificacao(req.session);
      await salvarSessao(req);

      if (anterior) {
        logger.info(
          { superadminId: req.session.userId, providerId: anterior.providerId, acessoId: anterior.acessoId },
          "[suporte] superadmin saiu do provedor",
        );
      }

      return res.json({ conectado: false });
    },
  );

  return router;
}

/**
 * NOTA SOBRE O LOG (server/utils/sanitize-log.ts).
 *
 * As rotas do LADO DO PROVEDOR continuam fora de `ROTAS_SEM_CORPO_NO_LOG`, e e
 * uma decisao, nao um esquecimento: o que elas devolvem sao carimbos de tempo,
 * contagens e a identificacao do PROPRIO provedor que perguntou. Nao ha nome,
 * e-mail nem telefone de PESSOA em nenhum desses corpos — o estado do acesso diz
 * "conectado desde as 14h07", nunca QUEM conectou. Foi por isso que
 * `EstadoDoAcesso` nao carrega `usadoPor`: seria um id de usuario de outro
 * tenant (a plataforma) exposto ao provedor, sem que a tela precise dele.
 *
 * `GET /api/admin/acesso-suporte/:providerId` E DIFERENTE, e a diferenca e o
 * ponto: ela devolve NOME DE PESSOA (`liberadoPorNome`, `revogadoPorNome`,
 * `usadoPorNome`), porque a pergunta dela e exatamente essa. Pelo criterio
 * escrito acima, essa resposta nao pode virar linha de log, e a censura por nome
 * de chave nao a cobre — `sanitizeForLog` conhece "nome", nao os tres sufixados.
 * Desde 04/09/2026 ela tem a entrada `/^\/api\/admin\/acesso-suporte\/\d+$/`
 * naquela lista — expressao regular com id no meio e `$` no fim, e nao prefixo:
 * cortar por prefixo apagaria tambem o log do POST de entrar e do POST de sair,
 * que sao a evidencia mais barata de quem atravessou o isolamento e quando.
 */
