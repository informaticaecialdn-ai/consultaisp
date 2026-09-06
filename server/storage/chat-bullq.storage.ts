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
import { and, asc, desc, eq, isNotNull, isNull, ilike, ne, notExists, gt, count, gte, sql, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  chatBullqConversas, chatBullqIntegracoes, customers, cobrancaCasos, equipmentRecoveryCases, equipmentRecoveryEvents, cobrancaEventos, invoices, contracts,
  type ChatBullqConversa, type ChatBullqIntegracao,
} from "@shared/schema";

/**
 * provisionado (organizacao criada, sem canal) · aguardando_conexao (o canal
 * existe e o token vale, mas o numero ainda nao foi pareado — o QR nao foi
 * lido) · ativo (numero conectado E logado) · erro (a consulta ao chat falhou
 * ou o servico recusou). `aguardando_conexao` e a mesma situacao fisica que a
 * ponte grava ao salvar o canal: sem ele, "Verificar conexao" a rebatizava de
 * erro.
 */
export const STATUS_DE_INTEGRACAO_DO_CHAT = ["provisionado", "aguardando_conexao", "ativo", "erro"] as const;
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

/** O follow-up que fechou o contato pelo chat — vai no metadata do evento de cobrança. */
export interface FollowUpDoEventoDoChat {
  proximaAcao: string;
  proximoContatoEm: Date;
}

/** Uma linha do diario de envios do primeiro contato — ver `ultimosPrimeirosContatos`. */
export interface EnvioDePrimeiroContato {
  em: Date;
  origem: OrigemDeConversa;
  canal: string | null;
  clienteId: number;
  /** Cru; a rota mascara antes de responder. */
  clienteNome: string;
  resultado: string | null;
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
  /**
   * A varredura do worker: por desenho ela e CROSS-TENANT — o worker roda uma
   * vez para a instalacao inteira e precisa da lista de todos os provedores com
   * o primeiro contato ligado. Nao ha `provider_id` na sessao aqui (nao ha
   * sessao). Cada linha devolvida carrega o seu `providerId`, e TUDO o que vem
   * depois (candidatos, cota do dia, envio) filtra por ele — nunca use esta
   * lista para responder a um pedido de um provedor.
   */
  async integracoesComContatoAutomatico() {
    return db.select().from(chatBullqIntegracoes).where(and(eq(chatBullqIntegracoes.status, "ativo"), sql`${chatBullqIntegracoes.agenteConfig}->'primeiroContato'->>'ligada' = 'true'`));
  }

  /**
   * A cota do dia conta contato QUE SAIU, nao conversa aberta: quando a ponte
   * reaproveita a conversa que ja existia no Chat BullQ, nenhuma mensagem e
   * enviada e o vinculo e gravado do mesmo jeito — contar essa linha gastava a
   * cota de um contato que nunca aconteceu. O que prova o envio e o evento:
   * `contato` na cobranca (o mesmo que grava `ultimo_contato_em` no caso) e o
   * evento marcado `enviado` na recuperacao de equipamento.
   */
  async contatosIniciadosNoDia(providerId: number, inicio: Date) {
    const [cobranca, equipamentos] = await Promise.all([
      db.select({ total: count() }).from(cobrancaEventos).where(and(
        eq(cobrancaEventos.providerId, providerId), eq(cobrancaEventos.tipo, "contato"), eq(cobrancaEventos.canal, "whatsapp"), gte(cobrancaEventos.ocorridoEm, inicio),
      )),
      db.select({ total: count() }).from(equipmentRecoveryEvents).where(and(
        eq(equipmentRecoveryEvents.providerId, providerId), eq(equipmentRecoveryEvents.channel, "whatsapp"), gte(equipmentRecoveryEvents.occurredAt, inicio),
        sql`${equipmentRecoveryEvents.metadata}->>'enviado' = 'true'`,
      )),
    ]);
    return (cobranca[0]?.total ?? 0) + (equipamentos[0]?.total ?? 0);
  }

  /**
   * O DIARIO DA AUTOMACAO: os ultimos contatos que SAIRAM, na mesma definicao
   * que a cota do dia usa (`contatosIniciadosNoDia`, acima) — evento `contato`
   * por whatsapp na cobranca, evento marcado `enviado` na recuperacao. Conversa
   * reaproveitada nao aparece aqui porque nao existe como envio: nenhuma
   * mensagem saiu.
   *
   * As duas fontes sao tabelas diferentes; sao duas consultas com o mesmo teto
   * e a juncao e feita aqui, em ordem de tempo. `union all` no banco exigiria
   * as duas com o mesmo formato de coluna e nao economizaria nada nesta escala.
   *
   * O NOME VAI CRU. Quem mascara e a rota (LGPD), como no resto do sistema —
   * o storage entrega dado, a borda decide quanto dele aparece.
   */
  async ultimosPrimeirosContatos(providerId: number, limite = 20): Promise<EnvioDePrimeiroContato[]> {
    const teto = Math.max(1, Math.min(Math.trunc(limite) || 20, 100));
    const [cobranca, equipamentos] = await Promise.all([
      db.select({
        em: cobrancaEventos.ocorridoEm,
        canal: cobrancaEventos.canal,
        clienteId: customers.id,
        clienteNome: customers.name,
        resultado: cobrancaEventos.resultado,
      })
        .from(cobrancaEventos)
        .innerJoin(customers, and(eq(customers.id, cobrancaEventos.customerId), eq(customers.providerId, providerId)))
        .where(and(
          eq(cobrancaEventos.providerId, providerId),
          eq(cobrancaEventos.tipo, "contato"),
          eq(cobrancaEventos.canal, "whatsapp"),
        ))
        .orderBy(desc(cobrancaEventos.ocorridoEm), desc(cobrancaEventos.id))
        .limit(teto),
      db.select({
        em: equipmentRecoveryEvents.occurredAt,
        canal: equipmentRecoveryEvents.channel,
        clienteId: customers.id,
        clienteNome: customers.name,
        resultado: equipmentRecoveryEvents.result,
      })
        .from(equipmentRecoveryEvents)
        .innerJoin(equipmentRecoveryCases, and(
          eq(equipmentRecoveryCases.id, equipmentRecoveryEvents.caseId),
          eq(equipmentRecoveryCases.providerId, providerId),
        ))
        .innerJoin(customers, and(eq(customers.id, equipmentRecoveryCases.customerId), eq(customers.providerId, providerId)))
        .where(and(
          eq(equipmentRecoveryEvents.providerId, providerId),
          eq(equipmentRecoveryEvents.channel, "whatsapp"),
          sql`${equipmentRecoveryEvents.metadata}->>'enviado' = 'true'`,
        ))
        .orderBy(desc(equipmentRecoveryEvents.occurredAt), desc(equipmentRecoveryEvents.id))
        .limit(teto),
    ]);

    const linhas: EnvioDePrimeiroContato[] = [
      ...cobranca.map(l => ({ ...l, origem: "cobranca" as const })),
      ...equipamentos.map(l => ({ ...l, origem: "equipamentos" as const })),
    ]
      // Sem data nao ha o que ordenar nem o que mostrar: `occurred_em` e
      // `ocorrido_em` tem default, mas a coluna aceita nulo.
      .filter((l): l is EnvioDePrimeiroContato => l.em instanceof Date);
    return linhas.sort((a, b) => b.em.getTime() - a.em.getTime()).slice(0, teto);
  }

  async candidatosAoPrimeiroContato(providerId: number) {
    // Conversa ABERTA no chat: a ponte reaproveita a conversa do telefone e nada
    // sai. Enquanto ela viver o caso nao e candidato; encerrada, volta a ser —
    // antes a exclusao olhava QUALQUER linha e o caso ficava sem primeiro
    // contato para sempre, mesmo depois que a conversa terminou.
    const semConversaAberta = (customerId: typeof cobrancaCasos.customerId | typeof equipmentRecoveryCases.customerId) => notExists(
      db.select({ id: chatBullqConversas.id }).from(chatBullqConversas).where(and(
        eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.customerId, customerId), ne(chatBullqConversas.status, "CLOSED"),
      )),
    );
    // Quem ja foi contatado de verdade sai pelo rastro do envio: na cobranca,
    // `ultimo_contato_em` (so o evento tipo `contato` a grava); na recuperacao,
    // o evento marcado `enviado`.
    const semContatoEnviado = notExists(
      db.select({ id: equipmentRecoveryEvents.id }).from(equipmentRecoveryEvents).where(and(
        eq(equipmentRecoveryEvents.providerId, providerId), eq(equipmentRecoveryEvents.caseId, equipmentRecoveryCases.id),
        sql`${equipmentRecoveryEvents.metadata}->>'enviado' = 'true'`,
      )),
    );
    const cobranca = await db.select({ id: cobrancaCasos.id, diasAtraso: customers.maxDaysOverdue, carteira: cobrancaCasos.carteira, tom: cobrancaCasos.tom, quadrante: cobrancaCasos.quadranteDna })
      .from(cobrancaCasos).innerJoin(customers, and(eq(customers.id, cobrancaCasos.customerId), eq(customers.providerId, providerId)))
      .where(and(eq(cobrancaCasos.providerId, providerId), eq(cobrancaCasos.status, "aberto"), isNull(cobrancaCasos.ultimoContatoEm), gt(customers.totalOverdueAmount, "0"), isNotNull(customers.phone), semConversaAberta(cobrancaCasos.customerId)))
      .orderBy(asc(cobrancaCasos.abertoEm), asc(cobrancaCasos.id)).limit(100);
    const equipamentos = await db.select({ id: equipmentRecoveryCases.id }).from(equipmentRecoveryCases)
      .where(and(eq(equipmentRecoveryCases.providerId, providerId), isNull(equipmentRecoveryCases.closedAt), isNull(equipmentRecoveryCases.disputedAt), eq(equipmentRecoveryCases.status, "pre_recuperacao"), semConversaAberta(equipmentRecoveryCases.customerId), semContatoEnviado))
      .orderBy(asc(equipmentRecoveryCases.createdAt), asc(equipmentRecoveryCases.id)).limit(100);
    return { cobranca, equipamentos };
  }
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
      if (existente.customerId !== dados.customerId) throw new Error("Conversa já vinculada a outro cliente");
      const [atualizada] = await db.update(chatBullqConversas)
        .set({
          customerId: dados.customerId,
          origem: dados.origem,
          casoId: dados.casoId ?? sql`${chatBullqConversas.casoId}`,
          recuperacaoId: dados.recuperacaoId ?? sql`${chatBullqConversas.recuperacaoId}`,
          canalId: dados.canalId,
          status: sql`case when ${chatBullqConversas.status} = 'CLOSED' then ${dados.status ?? "PENDING"} else ${chatBullqConversas.status} end`,
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

  /** A integracao pela organizacao do Chat BullQ: e assim que o webhook de volta se identifica. */
  async getIntegracaoDoChatPorOrganizacao(organizationId: string): Promise<ChatBullqIntegracao | undefined> {
    const [linha] = await db.select().from(chatBullqIntegracoes).where(eq(chatBullqIntegracoes.organizationId, organizationId)).limit(1);
    return linha;
  }

  /** A integracao pela CHAVE do agente (SHA-256): e assim que a skill do Chat BullQ se identifica. */
  async getIntegracaoDoChatPorChave(chaveAgenteHash: string): Promise<ChatBullqIntegracao | undefined> {
    const [linha] = await db.select().from(chatBullqIntegracoes).where(eq(chatBullqIntegracoes.chaveAgenteHash, chaveAgenteHash)).limit(1);
    return linha;
  }

  /** O que o agente de cobranca criado la deixa aqui: a chave (hash), o id do agente, os ids da config e o segredo do webhook. */
  async guardarAgenteDoChat(providerId: number, dados: { chaveAgenteHash?: string | null; agenteId?: string | null; agenteConfig?: Record<string, unknown> | null; webhookSecret?: string | null }): Promise<ChatBullqIntegracao | undefined> {
    const [linha] = await db.update(chatBullqIntegracoes)
      .set({
        ...(dados.chaveAgenteHash !== undefined ? { chaveAgenteHash: dados.chaveAgenteHash } : {}),
        ...(dados.agenteId !== undefined ? { agenteId: dados.agenteId } : {}),
        ...(dados.agenteConfig !== undefined ? { agenteConfig: dados.agenteConfig } : {}),
        ...(dados.webhookSecret !== undefined ? { webhookSecret: dados.webhookSecret } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chatBullqIntegracoes.providerId, providerId))
      .returning();
    return linha;
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

  async getConversaDoChat(providerId: number, conversationId: string): Promise<ChatBullqConversa | undefined> {
    const [linha] = await db.select().from(chatBullqConversas).where(and(
      eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.conversationId, conversationId),
    )).limit(1);
    return linha;
  }

  async clienteDoAtendimento(providerId: number, customerId: number) {
    const [cliente] = await db.select({ id: customers.id, nome: customers.name, documento: customers.cpfCnpj, telefone: customers.phone, email: customers.email, endereco: customers.address, numero: customers.addressNumber, complemento: customers.complement, bairro: customers.neighborhood, cidade: customers.city, uf: customers.state, cep: customers.cep, statusContrato: customers.status, clienteDesde: customers.contractStartDate, credito: customers.ispScore, risco: customers.riskTier, divida: customers.totalOverdueAmount, diasAtraso: customers.maxDaysOverdue, sincronizadoEm: customers.lastSyncAt })
      .from(customers).where(and(eq(customers.id, customerId), eq(customers.providerId, providerId))).limit(1);
    return cliente;
  }

  async contextoFinanceiroDoChat(providerId: number, customerId: number) {
    const escopo = and(eq(invoices.providerId, providerId), eq(invoices.customerId, customerId));
    const [faturas, pagamentos, contrato, ordens] = await Promise.all([
      db.select({ ref: invoices.erpRef, id: invoices.id, fonte: invoices.erpSource, valor: invoices.value, vencimento: invoices.dueDate, descricao: invoices.descricao }).from(invoices).where(and(escopo, inArray(invoices.status, ["aberta", "pending", "overdue"]))).orderBy(asc(invoices.dueDate)).limit(51),
      db.select({ pagas: count(), comData: sql<number>`count(*) filter (where ${invoices.paidDate} is not null)`.mapWith(Number), pontuais: sql<number>`count(*) filter (where ${invoices.paidDate}::date <= ${invoices.dueDate}::date)`.mapWith(Number) }).from(invoices).where(and(escopo, eq(invoices.status, "paid"))),
      db.select({ plano: contracts.plan, mensalidade: contracts.value }).from(contracts).where(and(eq(contracts.providerId, providerId), eq(contracts.customerId, customerId), eq(contracts.status, "active"))).orderBy(desc(contracts.id)).limit(2),
      db.select({ id: equipmentRecoveryCases.id, status: equipmentRecoveryCases.status, agendadoEm: equipmentRecoveryCases.scheduledAt }).from(equipmentRecoveryCases).where(and(eq(equipmentRecoveryCases.providerId, providerId), eq(equipmentRecoveryCases.customerId, customerId), isNull(equipmentRecoveryCases.closedAt))).orderBy(desc(equipmentRecoveryCases.createdAt)).limit(20),
    ]);
    return { faturas: faturas.slice(0, 50), temMaisFaturas: faturas.length > 50, pagamentos: pagamentos[0] ?? { pagas: 0, comData: 0, pontuais: 0 }, contrato: contrato.length === 1 ? contrato[0] : null, ordens };
  }

  /** Compare-and-set: webhooks concorrentes não transferem duas vezes nem desfazem um humano que acabou de assumir. */
  async moverConversaDoChat(providerId: number, conversationId: string, de: string, para: string): Promise<ChatBullqConversa | undefined> {
    const [linha] = await db.update(chatBullqConversas).set({ status: para, ultimoEventoEm: new Date() })
      .where(and(eq(chatBullqConversas.providerId, providerId), eq(chatBullqConversas.conversationId, conversationId), eq(chatBullqConversas.status, de))).returning();
    return linha;
  }

  async listarAtendimentosDoChat(providerId: number, filtro: { origem: OrigemDeConversa; carteira?: string; status?: string; busca?: string; pagina: number }) {
    const c = chatBullqConversas;
    const linhas = await db.select({ conversa: c, nome: customers.name, telefone: customers.phone, carteira: cobrancaCasos.carteira })
      .from(c)
      .innerJoin(customers, and(eq(customers.id, c.customerId), eq(customers.providerId, providerId)))
      .leftJoin(cobrancaCasos, and(eq(cobrancaCasos.id, c.casoId), eq(cobrancaCasos.providerId, providerId)))
      .where(and(eq(c.providerId, providerId),
        filtro.origem === "cobranca" ? isNotNull(c.casoId) : isNotNull(c.recuperacaoId),
        filtro.origem === "cobranca" && filtro.carteira ? eq(cobrancaCasos.carteira, filtro.carteira) : undefined,
        filtro.status ? eq(c.status, filtro.status) : undefined,
        filtro.busca ? or(ilike(customers.name, `%${filtro.busca.replace(/[%_\\]/g, "\\$&")}%`), filtro.busca.replace(/\D/g, "").length >= 3 ? sql`regexp_replace(${customers.phone}, '[^0-9]', '', 'g') like ${`%${filtro.busca.replace(/\D/g, "")}%`}` : undefined) : undefined,
      )).orderBy(desc(c.ultimoEventoEm), desc(c.id)).limit(31).offset((filtro.pagina - 1) * 30);
    return { itens: linhas.slice(0, 30).map(l => ({ ...l.conversa, nome: l.nome, telefone: l.telefone, carteira: l.carteira })), temMais: linhas.length > 30, pagina: filtro.pagina };
  }

  /**
   * Uma ação no chat também pertence à linha do tempo do caso, sem alterar seu
   * desfecho. Quando a ação fechou o follow-up (regra do dono: todo contato
   * termina com a próxima ação e o quando), ele vai no metadata do evento de
   * cobrança — a ficha 360 lê dali o que foi combinado naquele contato. As
   * colunas do caso (`proxima_acao`, `proximo_contato_em`) são gravadas por
   * `atualizarCasoDeCobranca`, que é quem sabe deixar o evento de responsável.
   *
   * `contatoEnviado` marca no metadata que uma mensagem REALMENTE saiu (o
   * primeiro contato da recuperação de equipamento). É esse rastro que a cota
   * do dia e a lista de candidatos leem — conversa reaproveitada não o ganha.
   */
  async registrarEventoDoChat(providerId: number, conversa: ChatBullqConversa, userId: number | null, notas: string, followUp?: FollowUpDoEventoDoChat, contatoEnviado = false): Promise<void> {
    const metadata: Record<string, unknown> = { origem: "chat_integrado", conversationId: conversa.conversationId, ...(contatoEnviado ? { enviado: true } : {}) };
    const metadataDaCobranca = followUp
      ? { ...metadata, proximaAcao: followUp.proximaAcao, proximoContatoEm: followUp.proximoContatoEm.toISOString() }
      : metadata;
    await db.transaction(async tx => {
      if (conversa.casoId) await tx.insert(cobrancaEventos).values({ providerId, customerId: conversa.customerId, casoId: conversa.casoId, userId, tipo: "nota", canal: "whatsapp", notas, metadata: metadataDaCobranca });
      if (conversa.recuperacaoId) await tx.insert(equipmentRecoveryEvents).values({ providerId, caseId: conversa.recuperacaoId, userId, type: "nota", channel: "whatsapp", notes: notas, metadata });
    });
  }
}
