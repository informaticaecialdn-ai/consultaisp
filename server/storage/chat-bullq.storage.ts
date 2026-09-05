/**
 * A ponte com o Chat BullQ, do lado do banco: a organizacao de la que e do
 * provedor daqui, e cada conversa aberta a partir de um caso de cobranca ou
 * de recuperacao de equipamento.
 *
 * Tudo filtra por `provider_id` — a conversa e sobre um cliente (nome,
 * telefone, divida), e o id de conversa de um provedor nao pode aparecer para
 * outro. Nenhum segredo mora aqui: token de canal fica no Chat BullQ, e o
 * acesso do Consulta ISP e pela chave de plataforma (env).
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  chatBullqConversas, chatBullqIntegracoes,
  type ChatBullqConversa, type ChatBullqIntegracao,
} from "@shared/schema";

export const STATUS_DE_INTEGRACAO_DO_CHAT = ["provisionado", "ativo", "erro"] as const;
export type StatusDeIntegracaoDoChat = (typeof STATUS_DE_INTEGRACAO_DO_CHAT)[number];

export const ORIGENS_DE_CONVERSA = ["cobranca", "equipamentos"] as const;
export type OrigemDeConversa = (typeof ORIGENS_DE_CONVERSA)[number];

export interface DadosDaIntegracaoDoChat {
  organizationId: string;
  slug: string;
  ownerEmail: string;
  canalId?: string | null;
  canalNome?: string | null;
  status?: StatusDeIntegracaoDoChat;
  ultimoErro?: string | null;
}

export interface NovaConversaDoChat {
  customerId: number;
  origem: OrigemDeConversa;
  casoId?: number | null;
  recuperacaoId?: number | null;
  conversationId: string;
  canalId: string;
  abertaPorUserId?: number | null;
  status?: string;
}

export class ChatBullqStorage {
  async getIntegracaoDoChat(providerId: number): Promise<ChatBullqIntegracao | undefined> {
    const [linha] = await db.select().from(chatBullqIntegracoes).where(eq(chatBullqIntegracoes.providerId, providerId)).limit(1);
    return linha;
  }

  /** Uma por provedor: cria na primeira vez, depois so atualiza o que veio. */
  async upsertIntegracaoDoChat(providerId: number, dados: DadosDaIntegracaoDoChat): Promise<ChatBullqIntegracao> {
    const atual = await this.getIntegracaoDoChat(providerId);
    if (!atual) {
      const [criada] = await db.insert(chatBullqIntegracoes).values({
        providerId,
        organizationId: dados.organizationId,
        slug: dados.slug,
        ownerEmail: dados.ownerEmail,
        canalId: dados.canalId ?? null,
        canalNome: dados.canalNome ?? null,
        status: dados.status ?? "provisionado",
        ultimoErro: dados.ultimoErro ?? null,
      }).returning();
      return criada;
    }
    const [atualizada] = await db.update(chatBullqIntegracoes)
      .set({
        organizationId: dados.organizationId,
        slug: dados.slug,
        ownerEmail: dados.ownerEmail,
        ...(dados.canalId !== undefined ? { canalId: dados.canalId } : {}),
        ...(dados.canalNome !== undefined ? { canalNome: dados.canalNome } : {}),
        ...(dados.status !== undefined ? { status: dados.status } : {}),
        ...(dados.ultimoErro !== undefined ? { ultimoErro: dados.ultimoErro } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(chatBullqIntegracoes.id, atual.id), eq(chatBullqIntegracoes.providerId, providerId)))
      .returning();
    return atualizada;
  }

  /** O canal e o estado, sem mexer no resto. */
  async marcarEstadoDaIntegracaoDoChat(providerId: number, estado: { status: StatusDeIntegracaoDoChat; ultimoErro?: string | null; canalId?: string | null; canalNome?: string | null }): Promise<ChatBullqIntegracao | undefined> {
    const [linha] = await db.update(chatBullqIntegracoes)
      .set({
        status: estado.status,
        ultimoErro: estado.ultimoErro ?? null,
        ...(estado.canalId !== undefined ? { canalId: estado.canalId } : {}),
        ...(estado.canalNome !== undefined ? { canalNome: estado.canalNome } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chatBullqIntegracoes.providerId, providerId))
      .returning();
    return linha;
  }

  /**
   * Registra a conversa aberta la. Se o Chat BullQ devolveu uma conversa que
   * ja existia (mesmo telefone), a linha e reaproveitada e ganha o caso novo.
   */
  async registrarConversaDoChat(providerId: number, dados: NovaConversaDoChat): Promise<ChatBullqConversa> {
    const [existente] = await db.select().from(chatBullqConversas)
      .where(and(eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.conversationId, dados.conversationId)))
      .limit(1);
    if (existente) {
      const [atualizada] = await db.update(chatBullqConversas)
        .set({
          customerId: dados.customerId,
          origem: dados.origem,
          casoId: dados.casoId ?? existente.casoId,
          recuperacaoId: dados.recuperacaoId ?? existente.recuperacaoId,
          canalId: dados.canalId,
          status: dados.status ?? existente.status,
          ultimoEventoEm: new Date(),
        })
        .where(and(eq(chatBullqConversas.id, existente.id), eq(chatBullqConversas.providerId, providerId)))
        .returning();
      return atualizada;
    }
    const [criada] = await db.insert(chatBullqConversas).values({
      providerId,
      customerId: dados.customerId,
      origem: dados.origem,
      casoId: dados.casoId ?? null,
      recuperacaoId: dados.recuperacaoId ?? null,
      conversationId: dados.conversationId,
      canalId: dados.canalId,
      abertaPorUserId: dados.abertaPorUserId ?? null,
      status: dados.status ?? "BOT",
      ultimoEventoEm: new Date(),
    }).returning();
    return criada;
  }

  async getConversaDoChatPorCaso(providerId: number, casoId: number): Promise<ChatBullqConversa | undefined> {
    const [linha] = await db.select().from(chatBullqConversas)
      .where(and(eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.casoId, casoId)))
      .orderBy(desc(chatBullqConversas.abertaEm))
      .limit(1);
    return linha;
  }

  async getConversaDoChatPorRecuperacao(providerId: number, recuperacaoId: number): Promise<ChatBullqConversa | undefined> {
    const [linha] = await db.select().from(chatBullqConversas)
      .where(and(eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.recuperacaoId, recuperacaoId)))
      .orderBy(desc(chatBullqConversas.abertaEm))
      .limit(1);
    return linha;
  }

  async listarConversasDoChatDoCliente(providerId: number, customerId: number): Promise<ChatBullqConversa[]> {
    return db.select().from(chatBullqConversas)
      .where(and(eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.customerId, customerId)))
      .orderBy(desc(chatBullqConversas.abertaEm));
  }

  /** Para a listagem do kanban: os casos deste provedor que tem conversa, com o id dela. */
  async conversasDoChatPorCaso(providerId: number): Promise<Map<number, ChatBullqConversa>> {
    const linhas = await db.select().from(chatBullqConversas)
      .where(and(eq(chatBullqConversas.providerId, providerId), isNotNull(chatBullqConversas.casoId)))
      .orderBy(desc(chatBullqConversas.abertaEm));
    const mapa = new Map<number, ChatBullqConversa>();
    for (const l of linhas) if (l.casoId !== null && !mapa.has(l.casoId)) mapa.set(l.casoId, l);
    return mapa;
  }

  async atualizarConversaDoChat(providerId: number, conversationId: string, mudanca: { status?: string; ultimoEventoEm?: Date }): Promise<ChatBullqConversa | undefined> {
    const [linha] = await db.update(chatBullqConversas)
      .set({ ...(mudanca.status !== undefined ? { status: mudanca.status } : {}), ultimoEventoEm: mudanca.ultimoEventoEm ?? new Date() })
      .where(and(eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.conversationId, conversationId)))
      .returning();
    return linha;
  }
}
