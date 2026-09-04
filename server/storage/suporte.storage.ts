import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { acessosSuporte, type AcessoDeSuporte } from "@shared/schema";

/**
 * Duracao padrao da liberacao: 2 horas a partir do clique do provedor.
 *
 * Mora aqui, e nao na rota, porque o numero aparece em tres lugares que precisam
 * concordar — a rota que libera, a faixa que mostra quanto falta e o texto que o
 * provedor le antes de clicar. Tres literais de "2 horas" divergem no primeiro
 * dia em que alguem muda um deles.
 */
export const DURACAO_PADRAO_DO_ACESSO_MS = 2 * 60 * 60 * 1000;

/**
 * Teto de duracao: 24 horas.
 *
 * Nenhuma tela oferece isso hoje — o teto existe para o caso em que a duracao
 * chegue de fora um dia (um campo novo, um parametro de rota, um erro de
 * unidade que mande segundos como milissegundos). Uma janela de personificacao
 * concedida por engano por um ano nao seria notada por ninguem: ela nao quebra
 * nada, so fica aberta.
 */
const DURACAO_MAXIMA_MS = 24 * 60 * 60 * 1000;

/**
 * A trilha do acesso de suporte: quem olhou o dado de quem, quando, autorizado
 * por quem, e por quanto tempo.
 *
 * Duas decisoes explicam quase todo o codigo abaixo.
 *
 * 1. O PRAZO E CONTADO PELO BANCO, NUNCA PELO NODE.
 *
 *    Nem a validade (`expira_em > now()`) nem o proprio `expira_em` passam pelo
 *    relogio do processo: a expiracao e calculada como `now() + intervalo` no
 *    proprio INSERT. Com o relogio do Node no meio, a duracao real da janela
 *    passaria a depender de qual maquina atendeu a requisicao — duas instancias
 *    atras de um balanceador, ou um container com o relogio derivado, e a mesma
 *    liberacao valeria tempos diferentes conforme quem respondesse. Como a
 *    janela e o que separa um estranho do dado pessoal de milhares de titulares,
 *    ela precisa de UM relogio so, e o unico compartilhado e o do Postgres.
 *
 * 2. NO MAXIMO UMA JANELA VALIDA POR PROVEDOR, GARANTIDA POR TRANSACAO.
 *
 *    Ver `liberarAcessoDeSuporte`. Nao da para exigir isso por indice: "valida"
 *    depende de `now()`, e indice parcial exige expressao imutavel.
 */
export class SuporteStorage {
  /**
   * Abre uma janela de acesso para o provedor, a pedido dele.
   *
   * O provedor clicando de novo com uma janela ainda valida REVOGA a anterior e
   * abre outra, na mesma transacao. As tres saidas possiveis foram consideradas:
   *
   *   · criar outra sem mexer na primeira deixaria duas janelas validas ao mesmo
   *     tempo, e ai "revogar o acesso" vira pergunta sem resposta — revoga qual?
   *     O provedor clica em "encerrar", uma some, o suporte continua dentro.
   *   · renovar a linha existente (so empurrar `expira_em`) manteria uma linha
   *     so, mas apagaria por cima quanto tempo a primeira janela realmente
   *     durou, que e exatamente o que esta tabela existe para guardar.
   *   · ignorar o clique devolveria ao provedor o resto da janela velha. Ele
   *     clicou porque quer 2 horas agora; receber 4 minutos porque clicou uma
   *     vez ha quase 2 horas e um comportamento que ninguem consegue prever.
   *
   * Revogar-e-recriar preserva as duas coisas: o historico conta a verdade
   * ("a janela A foi cortada em T, a janela B abriu em T") e sobra sempre uma
   * so valida. Quem revoga aqui e o proprio provedor — foi o clique dele.
   */
  async liberarAcessoDeSuporte(
    providerId: number,
    liberadoPor: number,
    duracaoMs: number = DURACAO_PADRAO_DO_ACESSO_MS,
  ): Promise<AcessoDeSuporte> {
    const duracao = Math.trunc(duracaoMs);
    if (!Number.isFinite(duracao) || duracao <= 0 || duracao > DURACAO_MAXIMA_MS) {
      throw new Error(
        `Duracao invalida para acesso de suporte: ${duracaoMs}ms (limite ${DURACAO_MAXIMA_MS}ms)`,
      );
    }

    return db.transaction(async (tx) => {
      await tx
        .update(acessosSuporte)
        .set({ revogadoEm: sql`now()`, revogadoPor: liberadoPor })
        .where(
          and(
            eq(acessosSuporte.providerId, providerId),
            isNull(acessosSuporte.revogadoEm),
            gt(acessosSuporte.expiraEm, sql`now()`),
          ),
        );

      const [criado] = await tx
        .insert(acessosSuporte)
        .values({
          providerId,
          liberadoPor,
          // `now()` do banco, e nao `new Date(Date.now() + duracao)`: ver nota 1
          // da classe. `liberado_em` vem do DEFAULT NOW() pelo mesmo motivo.
          expiraEm: sql`now() + ${duracao} * interval '1 millisecond'`,
        })
        .returning();

      return criado;
    });
  }

  /**
   * Fecha as janelas ainda vivas do provedor. Devolve quantas foram fechadas.
   *
   * Alcanca somente as VALIDAS. Carimbar `revogado_em` numa janela que ja tinha
   * expirado sozinha contaria uma mentira na auditoria: "alguem interrompeu"
   * quando na verdade o prazo acabou. O par `revogado_em IS NULL` + prazo
   * vencido e o que distingue as duas historias, e ele so se mantem se ninguem
   * escrever em janela morta.
   *
   * A contagem devolvida e util para quem chama: zero significa que nao havia
   * nada aberto, e a tela pode dizer isso em vez de fingir que cortou algo.
   */
  async revogarAcessoDeSuporte(providerId: number, revogadoPor: number): Promise<number> {
    const fechadas = await db
      .update(acessosSuporte)
      .set({ revogadoEm: sql`now()`, revogadoPor })
      .where(
        and(
          eq(acessosSuporte.providerId, providerId),
          isNull(acessosSuporte.revogadoEm),
          gt(acessosSuporte.expiraEm, sql`now()`),
        ),
      )
      .returning({ id: acessosSuporte.id });

    return fechadas.length;
  }

  /**
   * A pergunta quente, feita a cada requisicao de uma sessao de suporte:
   * existe liberacao valida para este provedor AGORA?
   *
   * Valida = nao revogada E ainda dentro do prazo. As duas metades sao avaliadas
   * pelo banco: `revogado_em IS NULL` e `expira_em > now()`. Comparar o prazo em
   * JavaScript (`linha.expiraEm > new Date()`) daria a resposta certa quase
   * sempre — e o "quase" e o problema: bastaria o relogio de um container
   * derivar para a mesma janela estar aberta numa instancia e fechada na outra.
   *
   * `limit(1)` sobre `expira_em` desc: por construcao ha no maximo uma valida
   * (ver `liberarAcessoDeSuporte`), mas se um dia houver duas, a de prazo mais
   * longo e a resposta menos surpreendente — e a ordem fica determinada em vez
   * de depender do plano do Postgres.
   */
  async acessoDeSuporteValido(providerId: number): Promise<AcessoDeSuporte | undefined> {
    const [valido] = await db
      .select()
      .from(acessosSuporte)
      .where(
        and(
          eq(acessosSuporte.providerId, providerId),
          isNull(acessosSuporte.revogadoEm),
          gt(acessosSuporte.expiraEm, sql`now()`),
        ),
      )
      .orderBy(desc(acessosSuporte.expiraEm))
      .limit(1);

    return valido;
  }

  /**
   * Marca que o suporte de fato entrou. Chamado por requisicao, nao por login.
   *
   * `usado_por` e `primeiro_uso_em` so sao escritos na PRIMEIRA vez — dai o
   * `coalesce` em vez de uma atribuicao seca. Sobrescrever apagaria quem abriu a
   * porta, que e o dado mais caro da linha inteira. A consequencia assumida:
   * dois superadmins na mesma janela aparecem aqui como o primeiro deles mais
   * uma contagem; separar por pessoa e papel do log da requisicao.
   *
   * Nao filtra por validade de proposito. Quem decide se a janela vale e o
   * middleware, ANTES de deixar a requisicao passar; se uma chamada chegou ate
   * aqui, ela ja aconteceu, e um uso fora do prazo e justamente o que uma
   * auditoria precisa enxergar em vez de ver descartado em silencio.
   */
  async registrarUsoDoAcesso(acessoId: number, usadoPor: number): Promise<void> {
    await db
      .update(acessosSuporte)
      .set({
        usadoPor: sql`coalesce(${acessosSuporte.usadoPor}, ${usadoPor})`,
        primeiroUsoEm: sql`coalesce(${acessosSuporte.primeiroUsoEm}, now())`,
        ultimoUsoEm: sql`now()`,
        usos: sql`${acessosSuporte.usos} + 1`,
      })
      .where(eq(acessosSuporte.id, acessoId));
  }

  /**
   * A trilha do provedor, da liberacao mais recente para tras.
   *
   * Devolve a linha inteira, inclusive as janelas revogadas e as que ninguem
   * usou: o valor de uma trilha esta em nao ter buraco. Filtrar "so as que
   * importam" e decisao de quem exibe, com a lista completa na mao.
   */
  async historicoDeAcessos(providerId: number, limite = 50): Promise<AcessoDeSuporte[]> {
    return db
      .select()
      .from(acessosSuporte)
      .where(eq(acessosSuporte.providerId, providerId))
      .orderBy(desc(acessosSuporte.liberadoEm))
      .limit(limite);
  }
}
