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

export interface TrabalhoAutonomia { id: number; provider_id: number; conversation_id: string; message_id: string; status: string }
export interface EstadoAutonomia { turnos: number; humano: boolean; proposta: PropostaAutonomia | null; motivo: string | null }
export type ResumoDaFila = Record<StatusDaFila, number>;

const TABELAS_DA_0028 = ["chat_autonomia_config", "chat_autonomia_estado", "chat_autonomia_fila"] as const;

export const autonomiaStorage = {
  /** As tres tabelas da 0028 existem? Uma leitura so, no boot — a fila nao pode girar sobre um banco sem elas. */
  async tabelasExistem(): Promise<{ ok: boolean; faltam: string[] }> {
    const r = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${sql.join(TABELAS_DA_0028.map(t => sql`${t}`), sql`, `)})`);
    const linhas = (Array.isArray(r) ? r : (r as { rows?: { table_name: string }[] }).rows ?? []) as { table_name: string }[];
    const achadas = new Set(linhas.map(l => l.table_name));
    const faltam = TABELAS_DA_0028.filter(t => !achadas.has(t));
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
  async proximos(): Promise<TrabalhoAutonomia[]> {
    // Trabalho interrompido nunca é reenviado: o transporte pode ter aceitado.
    const linhas = await db.select({ id: chatAutonomiaFila.id, provider_id: chatAutonomiaFila.providerId, conversation_id: chatAutonomiaFila.conversationId, message_id: chatAutonomiaFila.messageId, status: chatAutonomiaFila.status })
      .from(chatAutonomiaFila)
      .where(or(eq(chatAutonomiaFila.status, "pendente"), and(inArray(chatAutonomiaFila.status, ["processando", "enviando"]), lt(chatAutonomiaFila.updatedAt, sql`now() - interval '5 minutes'`))))
      .orderBy(asc(chatAutonomiaFila.id)).limit(20);
    return linhas.map(l => ({ ...l, id: Number(l.id) }));
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
    const [linha] = await db.select({ turnos: chatAutonomiaEstado.turnos, humano: chatAutonomiaEstado.humano, proposta: chatAutonomiaEstado.proposta, motivo: chatAutonomiaEstado.motivo })
      .from(chatAutonomiaEstado)
      .where(and(eq(chatAutonomiaEstado.providerId, providerId), eq(chatAutonomiaEstado.conversationId, conversationId))).limit(1);
    if (!linha) return { turnos: 0, humano: false, proposta: null, motivo: null };
    return { turnos: linha.turnos, humano: linha.humano, proposta: (linha.proposta as PropostaAutonomia | null) ?? null, motivo: linha.motivo ?? null };
  },
  async turno(providerId: number, conversationId: string) {
    await db.insert(chatAutonomiaEstado).values({ providerId, conversationId, turnos: 1 })
      .onConflictDoUpdate({ target: [chatAutonomiaEstado.providerId, chatAutonomiaEstado.conversationId], set: { turnos: sql`${chatAutonomiaEstado.turnos} + 1`, updatedAt: sql`now()` } });
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
