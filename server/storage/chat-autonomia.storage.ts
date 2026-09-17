/**
 * A fila e o estado do motor autonomo do chat, do lado do banco (migracao 0028).
 *
 * Tudo que recebe um provedor filtra por `provider_id`: a conversa e sobre um
 * cliente, e o id de conversa de um provedor nunca cruza para outro. A unica
 * leitura sem provedor e `proximos()`, a varredura do worker sobre a fila
 * inteira — cada trabalho carrega o seu `provider_id`, e toda operacao seguinte
 * o exige de novo.
 *
 * Transicoes de estado sao CAS (compare-and-set): `assumir` so leva o trabalho
 * de `pendente` a `processando` se ninguem chegou antes; a linha devolvida e a
 * prova. Trabalho interrompido em `processando`/`enviando` nunca e reenviado —
 * o transporte pode ter aceitado a mensagem.
 */
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { chatAutonomiaConfig, chatAutonomiaEstado, chatAutonomiaFila, equipmentRecoveryCases, equipmentRecoveryEvents } from "@shared/schema";
import { lerConfigAutonomia, STATUS_DA_FILA, type ConfigAutonomia, type PropostaAutonomia, type StatusDaFila } from "@shared/chat-autonomia";

export interface TrabalhoAutonomia {
  id: number; provider_id: number; conversation_id: string; message_id: string; status: string;
  /** Quando a mensagem entrou na fila — só para o log da idade do trabalho. */
  criado_em?: Date | string | null;
}
/** Quantos trabalhos uma varredura devolve. */
export const LOTE_DA_FILA = 20;
/**
 * `turnos` conta as rodadas do EPISÓDIO (achado f16): a conversa é reaproveitada por telefone, e um cliente de
 * vários dias chegava ao limite no meio do combinado. O episódio termina com 6 h sem rodada — a mesma janela da
 * identidade (D10) —, e a leitura devolve zero quando ele terminou. `episodioNovo` diz ao serviço que o próximo
 * `turno` recomeça a contagem; a decisão sai desta leitura, e não do `updated_at` na hora de gravar, porque
 * outras escritas da mesma rodada (a proposta que cai, por exemplo) o renovam antes.
 */
export interface EstadoAutonomia { turnos: number; humano: boolean; proposta: PropostaAutonomia | null; motivo: string | null; episodioNovo?: boolean }
/** Sem rodada há tanto tempo, o episódio da conversa acabou: as rodadas voltam a contar do zero (f16). */
export const EPISODIO_DA_CONVERSA_HORAS = 6;
export type ResumoDaFila = Record<StatusDaFila, number>;

const TABELAS_DA_AUTONOMIA = ["chat_autonomia_config", "chat_autonomia_estado", "chat_autonomia_fila", "chat_autonomia_seguranca", "chat_autonomia_autorizacao", "cobranca_quitacoes"] as const;

export const autonomiaStorage = {
  /** Uma leitura no boot: fila, identidade e quitações (0028/0034/0035) devem existir. */
  async tabelasExistem(): Promise<{ ok: boolean; faltam: string[] }> {
    const r = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${sql.join(TABELAS_DA_AUTONOMIA.map(t => sql`${t}`), sql`, `)})`);
    const linhas = (Array.isArray(r) ? r : (r as { rows?: { table_name: string }[] }).rows ?? []) as { table_name: string }[];
    const achadas = new Set(linhas.map(l => l.table_name));
    const faltam = TABELAS_DA_AUTONOMIA.filter(t => !achadas.has(t));
    return { ok: faltam.length === 0, faltam };
  },
  async config(providerId: number): Promise<ConfigAutonomia> {
    const [linha] = await db.select({ config: chatAutonomiaConfig.config }).from(chatAutonomiaConfig).where(eq(chatAutonomiaConfig.providerId, providerId)).limit(1);
    return lerConfigAutonomia(linha?.config);
  },
  async salvarConfig(providerId: number, config: ConfigAutonomia) {
    await db.insert(chatAutonomiaConfig).values({ providerId, config })
      .onConflictDoUpdate({ target: chatAutonomiaConfig.providerId, set: { config, updatedAt: sql`now()` } });
  },
  async enfileirar(providerId: number, conversationId: string, messageId: string) {
    await db.insert(chatAutonomiaFila).values({ providerId, conversationId, messageId })
      .onConflictDoNothing({ target: [chatAutonomiaFila.providerId, chatAutonomiaFila.messageId] });
  },
  /**
   * A próxima leva, em RODÍZIO entre provedores (achado e4): o 1º trabalho de
   * cada provedor, depois o 2º de cada um, e assim por diante — dentro do
   * provedor, na ordem de chegada. Em ordem de id pura, um provedor com cem
   * mensagens na fila deixava todos os outros esperando atrás dele.
   *
   * Trabalho interrompido (`processando`/`enviando` há mais de 5 min) volta na
   * leva para ser TRANSFERIDO, nunca reenviado: o transporte pode ter aceitado.
   */
  async proximos(): Promise<TrabalhoAutonomia[]> {
    const candidatos = db.select({
      id: chatAutonomiaFila.id, provider_id: chatAutonomiaFila.providerId, conversation_id: chatAutonomiaFila.conversationId,
      message_id: chatAutonomiaFila.messageId, status: chatAutonomiaFila.status, criado_em: chatAutonomiaFila.createdAt,
      posicao: sql<number>`row_number() over (partition by ${chatAutonomiaFila.providerId} order by ${chatAutonomiaFila.id})`.as("posicao"),
    }).from(chatAutonomiaFila)
      .where(or(eq(chatAutonomiaFila.status, "pendente"), and(inArray(chatAutonomiaFila.status, ["processando", "enviando"]), lt(chatAutonomiaFila.updatedAt, sql`now() - interval '5 minutes'`))))
      .as("candidatos");
    const linhas = await db.select({ id: candidatos.id, provider_id: candidatos.provider_id, conversation_id: candidatos.conversation_id, message_id: candidatos.message_id, status: candidatos.status, criado_em: candidatos.criado_em })
      .from(candidatos).orderBy(asc(candidatos.posicao), asc(candidatos.id)).limit(LOTE_DA_FILA);
    return linhas.map(l => ({ ...l, id: Number(l.id), provider_id: Number(l.provider_id) }));
  },
  /**
   * Parada do worker: a rodada que AINDA NÃO começou a enviar devolve o
   * trabalho a `pendente` (CAS a partir de `processando`) e ele é refeito no
   * próximo boot. `enviando` nunca volta — o transporte pode ter aceitado.
   */
  async devolverParaPendente(job: TrabalhoAutonomia): Promise<boolean> {
    const linhas = await db.update(chatAutonomiaFila).set({ status: "pendente", motivo: null, updatedAt: sql`now()` })
      .where(and(eq(chatAutonomiaFila.id, job.id), eq(chatAutonomiaFila.providerId, job.provider_id), eq(chatAutonomiaFila.status, "processando")))
      .returning({ id: chatAutonomiaFila.id });
    return linhas.length === 1;
  },
  /** CAS: só quem encontra o trabalho ainda `pendente` o assume. */
  async assumir(job: TrabalhoAutonomia): Promise<boolean> {
    const linhas = await db.update(chatAutonomiaFila).set({ status: "processando", updatedAt: sql`now()` })
      .where(and(eq(chatAutonomiaFila.id, job.id), eq(chatAutonomiaFila.providerId, job.provider_id), eq(chatAutonomiaFila.status, "pendente")))
      .returning({ id: chatAutonomiaFila.id });
    return linhas.length === 1;
  },
  async marcar(job: TrabalhoAutonomia, status: StatusDaFila, motivo: string | null = null) {
    await db.update(chatAutonomiaFila).set({ status, motivo, updatedAt: sql`now()` })
      .where(and(eq(chatAutonomiaFila.id, job.id), eq(chatAutonomiaFila.providerId, job.provider_id)));
  },
  async estado(providerId: number, conversationId: string): Promise<EstadoAutonomia> {
    const [linha] = await db.select({
      turnos: chatAutonomiaEstado.turnos, humano: chatAutonomiaEstado.humano, proposta: chatAutonomiaEstado.proposta, motivo: chatAutonomiaEstado.motivo,
      // O relógio é o do banco, o mesmo que grava `updated_at`: servidor e banco com horas diferentes não mudam o episódio.
      episodioVencido: sql<boolean>`${chatAutonomiaEstado.updatedAt} < now() - make_interval(hours => ${EPISODIO_DA_CONVERSA_HORAS}::int)`,
    })
      .from(chatAutonomiaEstado)
      .where(and(eq(chatAutonomiaEstado.providerId, providerId), eq(chatAutonomiaEstado.conversationId, conversationId))).limit(1);
    if (!linha) return { turnos: 0, humano: false, proposta: null, motivo: null, episodioNovo: true };
    const vencido = linha.episodioVencido === true;
    return { turnos: vencido ? 0 : linha.turnos, humano: linha.humano, proposta: (linha.proposta as PropostaAutonomia | null) ?? null, motivo: linha.motivo ?? null, episodioNovo: vencido };
  },
  /** Uma rodada a mais no episódio; `novoEpisodio` (lido em `estado` no começo da rodada) recomeça a contagem em 1. */
  async turno(providerId: number, conversationId: string, novoEpisodio = false) {
    await db.insert(chatAutonomiaEstado).values({ providerId, conversationId, turnos: 1 })
      .onConflictDoUpdate({ target: [chatAutonomiaEstado.providerId, chatAutonomiaEstado.conversationId], set: { turnos: novoEpisodio ? 1 : sql`${chatAutonomiaEstado.turnos} + 1`, updatedAt: sql`now()` } });
  },
  async proposta(providerId: number, conversationId: string, proposta: PropostaAutonomia | null) {
    const valor = proposta ? (proposta as unknown as Record<string, unknown>) : null;
    await db.insert(chatAutonomiaEstado).values({ providerId, conversationId, proposta: valor })
      .onConflictDoUpdate({ target: [chatAutonomiaEstado.providerId, chatAutonomiaEstado.conversationId], set: { proposta: valor, updatedAt: sql`now()` } });
  },
  /** Um humano assumiu: o estado trava (`humano=true`), a oferta em aberto cai e o que ainda estava `pendente` é cancelado. */
  async cancelar(providerId: number, conversationId: string, motivo: string) {
    await db.transaction(async tx => {
      await tx.insert(chatAutonomiaEstado).values({ providerId, conversationId, humano: true, motivo })
        .onConflictDoUpdate({ target: [chatAutonomiaEstado.providerId, chatAutonomiaEstado.conversationId], set: { humano: true, proposta: null, motivo, updatedAt: sql`now()` } });
      await tx.update(chatAutonomiaFila).set({ status: "cancelado", motivo, updatedAt: sql`now()` })
        .where(and(eq(chatAutonomiaFila.providerId, providerId), eq(chatAutonomiaFila.conversationId, conversationId), eq(chatAutonomiaFila.status, "pendente")));
    });
  },
  /**
   * O atendente devolve a conversa ao assistente: `humano=false`, sem oferta
   * pendente e com as rodadas zeradas — o ciclo recomeça do zero, senão o
   * limite de rodadas gasto pelo humano transferiria de volta na primeira
   * mensagem. Nada é enfileirado aqui: a próxima mensagem do cliente entra
   * pelo webhook, como sempre.
   */
  async devolver(providerId: number, conversationId: string, motivo: string) {
    await db.insert(chatAutonomiaEstado).values({ providerId, conversationId, humano: false, motivo })
      .onConflictDoUpdate({ target: [chatAutonomiaEstado.providerId, chatAutonomiaEstado.conversationId], set: { humano: false, proposta: null, turnos: 0, motivo, updatedAt: sql`now()` } });
  },
  /** Contagem por status. Todo status aparece — zero é zero de verdade, contado no banco. */
  async resumo(providerId: number): Promise<ResumoDaFila> {
    const linhas = await db.select({ status: chatAutonomiaFila.status, total: count() }).from(chatAutonomiaFila)
      .where(eq(chatAutonomiaFila.providerId, providerId)).groupBy(chatAutonomiaFila.status);
    const resumo = Object.fromEntries(STATUS_DA_FILA.map(s => [s, 0])) as ResumoDaFila;
    for (const l of linhas) if ((STATUS_DA_FILA as readonly string[]).includes(l.status)) resumo[l.status as StatusDaFila] = Number(l.total);
    return resumo;
  },
  /** Agendamento LOCAL de devolução: só marca `scheduled_at` num caso vivo, sem agenda, e registra o evento. Não confirma retirada nem baixa. */
  async agendar(providerId: number, caseId: number, customerId: number, data: string, messageId: string): Promise<boolean> {
    return db.transaction(async tx => {
      const linhas = await tx.update(equipmentRecoveryCases).set({ scheduledAt: new Date(data), updatedAt: sql`now()` })
        .where(and(eq(equipmentRecoveryCases.providerId, providerId), eq(equipmentRecoveryCases.id, caseId), eq(equipmentRecoveryCases.customerId, customerId), isNull(equipmentRecoveryCases.closedAt), isNull(equipmentRecoveryCases.disputedAt), isNull(equipmentRecoveryCases.scheduledAt)))
        .returning({ id: equipmentRecoveryCases.id });
      // O caso não estava livre (fechado, contestado ou já agendado): o update não tocou linha, e nada é gravado.
      if (linhas.length !== 1) return false;
      await tx.insert(equipmentRecoveryEvents).values({
        providerId, caseId, type: "caso_atualizado", channel: "whatsapp",
        notes: `Agendamento local confirmado pelo cliente para ${data}. Não confirma retirada nem baixa do equipamento.`,
        metadata: { origem: "autonomia_chat", messageId, agendadoEm: data },
      });
      return true;
    });
  },
};
