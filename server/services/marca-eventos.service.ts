/**
 * A trilha de auditoria da revenda — quem fez o que, sob qual marca.
 *
 * Obrigatoria desde a fase 1 (decisao 15 do dono) pelo poder que o revendedor
 * recebe: ele suspende provedores que nao sao dele, cria e remove usuarios de
 * terceiros e mexe em preco que vira dinheiro de outra pessoa. Sem esta tabela,
 * "quem suspendeu meu provedor as 3 da manha?" nao tem resposta — e o
 * superadmin, que pode reverter qualquer ato do revendedor, tambem grava aqui
 * (por isso `atorRole`).
 *
 * TRES REGRAS QUE ESTE MODULO SUSTENTA:
 *
 * 1. APPEND-ONLY. Nada aqui atualiza ou apaga linha. Uma trilha que pode ser
 *    reescrita nao e prova de nada.
 *
 * 2. BEST-EFFORT. Falhar ao gravar o evento NUNCA derruba a acao que o gerou. A
 *    suspensao ja aconteceu; devolver 500 ao revendedor faria com que ele
 *    clicasse de novo numa acao que ja tinha surtido efeito. A falha vai para o
 *    log estruturado e a vida segue.
 *
 *    Consequencia disso, e nao acidente: o INSERT sai na conexao do POOL, nunca
 *    na transacao de quem chamou. Dentro da transacao do chamador um INSERT que
 *    falhasse abortaria a transacao inteira no Postgres — a acao seria desfeita
 *    pelo registro dela. Por isso este modulo nao aceita `tx`.
 *
 * 3. REDACAO ANTES DO INSERT. O `detalhe` carrega o antes/depois de edicoes que
 *    passam perto de credencial (dados de repasse, senha temporaria de usuario
 *    novo, token de convite). Chave sensivel nunca chega ao banco.
 *
 * Modulo autonomo, importado direto por quem precisa: NAO entra no barril
 * `server/storage/index.ts`. A trilha e append-only e tem duas operacoes; a
 * generalidade do repositorio nao acrescenta nada, e o barril e territorio
 * compartilhado com outras frentes.
 */
import { db } from "../db";
import { marcaEventos, type MarcaEvento } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { logger } from "../logger";

/**
 * As acoes que a trilha reconhece — a lista do desenho da fase 2, em ordem de
 * fase: provedor, marca, preco, equipe, comissao, cadastro publico.
 *
 * Array `as const` e nao enum porque o valor gravado no banco e a propria
 * string: o que o leitor da tabela ve e exatamente o que esta escrito aqui.
 */
export const ACOES_DE_MARCA = [
  "criar_provedor",
  "editar_provedor",
  "suspender",
  "reativar",
  "criar_usuario_provedor",
  "remover_usuario_provedor",
  "vincular_por_convite",
  "editar_marca",
  "editar_preco",
  "criar_usuario_revenda",
  "remover_usuario_revenda",
  "alterar_comissao",
  "fechar_fechamento",
  "aprovar_fechamento",
  "pagar_fechamento",
  "cancelar_fechamento",
  "ajuste_comissao",
  "cadastro_publico",
] as const;

export type AcaoDeMarca = (typeof ACOES_DE_MARCA)[number];

const ACOES_CONHECIDAS: ReadonlySet<string> = new Set(ACOES_DE_MARCA);

/** Quem agiu. Sai da sessao, nunca de string escrita a mao no chamador. */
export type PapelDoAtor = "revendedor" | "superadmin";

export type EventoDaMarca = {
  marcaId: number;
  userId: number;
  atorRole: PapelDoAtor;
  acao: AcaoDeMarca;
  /** Provedor alvo, quando a acao tem um. Ausente em acoes sobre a propria marca. */
  providerId?: number | null;
  /** Antes/depois, motivo, ids. Passa pela redacao antes do INSERT. */
  detalhe?: Record<string, unknown>;
};

/**
 * Nome de chave que jamais e gravado, em qualquer profundidade.
 *
 * ── POR QUE NAO REAPROVEITAR `sanitizeForLog` (server/utils/sanitize-log.ts) ──
 * As duas funcoes parecem a mesma coisa e respondem a perguntas opostas.
 *
 * Aquela protege uma LINHA DE LOG e casa por nome EXATO num conjunto fechado
 * (`CHAVES_SENSIVEIS.has(chave)`). O que esta trilha carrega sao nomes de
 * COLUNA num diff de edicao — `repasseChavePix`, `senhaTemporaria`,
 * `apiTokenNovo`. Nenhum desses tres esta no conjunto, e os tres sao
 * exatamente o que a decisao 15 manda esconder: com a comparacao exata a chave
 * PIX do revendedor iria inteira para o banco.
 *
 * E aquela erra tambem para o outro lado: o conjunto inclui `nome`, `email`,
 * `phone`, `cpfCnpj` e `address` — certo para um log, destrutivo aqui. Um
 * evento `editar_provedor` existe para provar que o e-mail de contato mudou de
 * X para Y; gravado como "[REDACTED] → [REDACTED]" ele nao prova nada, e a
 * auditoria vira enfeite.
 *
 * Dai a regra propria: casa por PADRAO (substring, sem caixa) e so em
 * credencial. Segredo fica de fora; o resto do diff fica legivel.
 */
const PADRAO_DE_SEGREDO = /senha|password|token|secret|pix/i;

const CENSURADO = "[REDACTED]";

/**
 * Substitui o valor de toda chave sensivel, a qualquer profundidade.
 *
 * Array entra na recursao: um diff de usuarios chega como lista de objetos, e
 * uma versao que parasse nos arrays deixaria passar a senha temporaria de cada
 * um deles.
 *
 * `Date` vira ISO antes da recursao porque um Date e `typeof "object"` — sem
 * este ramo ele seria percorrido como objeto sem chaves proprias e gravado como
 * `{}`, apagando a data em silencio.
 */
function redigir(valor: unknown): unknown {
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map(redigir);
  if (valor === null || typeof valor !== "object") return valor;

  const limpo: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    limpo[chave] = PADRAO_DE_SEGREDO.test(chave) ? CENSURADO : redigir(v);
  }
  return limpo;
}

/**
 * Grava um evento. Nao lanca, nunca — nem por banco fora, nem por detalhe
 * malformado (objeto ciclico incluido: a redacao roda dentro do mesmo try).
 *
 * Devolve `void` de proposito. Quem chama nao deve ramificar no resultado: a
 * acao de negocio ja terminou quando este INSERT e tentado, e um `if` aqui
 * convidaria alguem a desfaze-la por causa da auditoria.
 */
export async function registrarEventoDaMarca(evento: EventoDaMarca): Promise<void> {
  try {
    // Acao fora do catalogo e bug de quem chamou, e o tipo `AcaoDeMarca` ja
    // barra isso em compilacao. Em execucao a linha e RECUSADA em vez de
    // gravada: um verbo que nenhuma tela sabe renderizar poluiria a trilha para
    // sempre, e trilha e append-only — nao ha como limpar depois. Alto no log,
    // porque e defeito; sem excecao, porque a acao ja aconteceu (regra 2).
    if (!ACOES_CONHECIDAS.has(evento.acao)) {
      logger.error(
        { marcaId: evento.marcaId, acao: evento.acao },
        "marca_eventos: acao desconhecida, evento descartado",
      );
      return;
    }

    await db.insert(marcaEventos).values({
      marcaId: evento.marcaId,
      userId: evento.userId,
      atorRole: evento.atorRole,
      acao: evento.acao,
      providerId: evento.providerId ?? null,
      detalhe: (evento.detalhe ? redigir(evento.detalhe) : {}) as Record<string, unknown>,
    });
  } catch (erro) {
    logger.error(
      { err: erro, marcaId: evento.marcaId, acao: evento.acao, providerId: evento.providerId ?? null },
      "marca_eventos: falha ao gravar o evento; a acao que o gerou seguiu valida",
    );
  }
}

/** Teto de linhas por leitura — `?limite=999999` nao arrasta a tabela inteira. */
const LIMITE_MAXIMO = 200;
const LIMITE_PADRAO = 50;

/**
 * Os eventos mais recentes da marca. Diferente do INSERT, esta funcao PROPAGA
 * erro: quem le uma tela de auditoria precisa saber que a leitura falhou, em
 * vez de ver uma lista vazia e concluir que ninguem mexeu em nada.
 *
 * O desempate por `id` nao e decoracao: `created_at` tem `DEFAULT now()`, e
 * `now()` no Postgres e o instante de inicio da TRANSACAO. Dois eventos
 * gravados na mesma transacao saem com o timestamp identico, e sem o desempate
 * a ordem entre eles ficaria por conta do plano de execucao.
 */
export async function listarEventosDaMarca(
  marcaId: number,
  limite: number = LIMITE_PADRAO,
): Promise<MarcaEvento[]> {
  const quantas = Math.min(Math.max(Math.trunc(limite) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  return db
    .select()
    .from(marcaEventos)
    .where(eq(marcaEventos.marcaId, marcaId))
    .orderBy(desc(marcaEventos.createdAt), desc(marcaEventos.id))
    .limit(quantas);
}
