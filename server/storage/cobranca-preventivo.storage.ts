import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, invoices } from "@shared/schema";
import { cobrancaPreAvisos } from "@shared/schema-cobranca-faturas";
import { AvisosFaturasSchema, planejarPreAviso, type ConfigAvisosFaturas } from "@shared/cobranca/preventivo";
import { ETAPAS_PADRAO, type Etapa } from "@shared/cobranca/regua";

export function diaDoPreAviso(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const p = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export class CobrancaPreventivoStorage {
  async obterConfigAvisos(providerId: number): Promise<ConfigAvisosFaturas | null> {
    const r = await db.execute<{ config: unknown }>(sql`select config from cobranca_avisos_config where provider_id = ${providerId}`);
    if (!r.rows[0]) return null;
    // Configuração inválida falha fechada: não ativa disparos por fallback.
    const parsed = AvisosFaturasSchema.safeParse(r.rows[0].config);
    return parsed.success ? parsed.data : AvisosFaturasSchema.parse({});
  }

  async salvarConfigAvisos(providerId: number, config: ConfigAvisosFaturas): Promise<ConfigAvisosFaturas> {
    const validada = AvisosFaturasSchema.parse(config);
    await db.execute(sql`insert into cobranca_avisos_config (provider_id, config, updated_at)
      values (${providerId}, ${JSON.stringify(validada)}::jsonb, now())
      on conflict (provider_id) do update set config = excluded.config, updated_at = now()`);
    return validada;
  }

  /** Simulação somente leitura do espelho ERP. Não cria reservas nem chama canais. */
  async simularAvisos(providerId: number, dia: string, config: ConfigAvisosFaturas) {
    const agora = new Date();
    const instanteSimulacao = dia === diaDoPreAviso(agora) ? agora : new Date(`${dia}T12:00:00-03:00`);
    const inicio = new Date(`${dia}T00:00:00Z`);
    inicio.setUTCDate(inicio.getUTCDate() - 30);
    const fim = new Date(`${dia}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + 31);
    const faturas = await db.select({ id: invoices.id, customerId: customers.id, nome: customers.name,
      telefone: customers.phone, email: customers.email, situacaoCliente: customers.status,
      atrasoCliente: customers.totalOverdueAmount, ultimaSincronizacao: customers.lastSyncAt,
      erpRef: invoices.erpRef, status: invoices.status, vencimento: invoices.dueDate, valor: invoices.value,
      reserva: sql<string | null>`(select p.status from ${cobrancaPreAvisos} p where p.provider_id = ${providerId}
        and p.fatura_id = ${invoices.id} and p.dia_contato = ${dia} limit 1)`,
      contatoBloqueado: sql<boolean>`exists(select 1 from cobranca_preferencias_contato p where p.provider_id=${providerId}
        and p.customer_id=${customers.id} and (p.nao_contatar or p.pausa_ate>${instanteSimulacao}))`,
      contatoRecente: sql<boolean>`exists(select 1 from cobranca_comunicacoes m where m.provider_id=${providerId}
        and m.customer_id=${customers.id} and m.status in ('enviando','enviado','incerto')
        and m.criado_em>${instanteSimulacao}::timestamp-interval '24 hours'
        and m.criado_em<=${instanteSimulacao})`,
    }).from(invoices).innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.providerId, providerId)))
      .where(and(eq(invoices.providerId, providerId), gte(invoices.dueDate, inicio), lt(invoices.dueDate, fim)))
      .orderBy(asc(invoices.dueDate), asc(invoices.id)).limit(1001);
    const itens = faturas.slice(0, 1000).map(f => {
      const motivos: string[] = [];
      if (!config.ligada) motivos.push("Avisos desligados para este provedor");
      if (f.contatoBloqueado) motivos.push("Contato automático desativado ou pausado para este cliente");
      if (f.contatoRecente) motivos.push("Cliente já possui contato enviado, reservado ou incerto nas últimas 24 horas");
      if (!f.erpRef) motivos.push("Fatura sem referência no ERP");
      if (f.situacaoCliente !== "active") motivos.push("Cliente não está ativo");
      if (Number(f.atrasoCliente) > 0) motivos.push("Cliente possui valores em atraso; pertence à cobrança");
      if (!["aberta", "pending", "overdue"].includes(f.status)) motivos.push("Fatura paga, cancelada ou fechada");
      if (!(Number(f.valor) > 0)) motivos.push("Fatura sem saldo positivo");
      if (!planejarPreAviso(providerId, { ...f, valor: Number(f.valor) }, dia, [], config.diasAntes)) motivos.push("Fora dos dias de aviso configurados ou fatura vencida");
      if (config.canal === "email" ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email ?? "") : !/^\d{10,13}$/.test((f.telefone ?? "").replace(/\D/g, ""))) motivos.push(config.canal === "email" ? "E-mail ausente ou inválido" : "Telefone ausente ou inválido");
      if (f.reserva && f.reserva !== "pendente") motivos.push(`Aviso já processado ou reservado (${f.reserva})`);
      return { faturaId: f.id, customerId: f.customerId, nome: f.nome, vencimento: f.vencimento.toISOString().slice(0, 10),
        valor: Number(f.valor), ultimaSincronizacao: f.ultimaSincronizacao?.toISOString() ?? null, elegivel: motivos.length === 0, motivos };
    });
    const elegiveis = itens.filter(i => i.elegivel).length;
    return { dia, config, analisadas: itens.length, elegiveis, excluidas: itens.length - elegiveis,
      limitada: faturas.length > 1000, itens,
      fonte: "Espelho ERP sincronizado; os dados serão relidos antes do envio. Disponibilidade do canal e janela de contato são verificadas na execução." };
  }

  async prepararPreAvisos(providerId: number, agora: Date, etapas: readonly Etapa[] = ETAPAS_PADRAO, diasAntes?: readonly number[]): Promise<number> {
    if (!diasAntes && !etapas.some(e => e.id === "lembrete_pre_vencimento" && e.ativa)) return 0;
    const dia = diaDoPreAviso(agora);
    const fim = new Date(`${dia}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + (diasAntes ? Math.max(...diasAntes, 0) + 1 : 8));
    const faturas = await db.select({ id: invoices.id, customerId: invoices.customerId, status: invoices.status, vencimento: invoices.dueDate, valor: invoices.value })
      .from(invoices).innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.providerId, providerId)))
      .where(and(eq(invoices.providerId, providerId), inArray(invoices.status, ["aberta", "pending", "overdue"]),
        eq(customers.status, "active"), sql`coalesce(${customers.totalOverdueAmount}, 0) <= 0`, isNotNull(invoices.erpRef),
        gte(invoices.dueDate, new Date(`${dia}T00:00:00Z`)), lt(invoices.dueDate, fim)));
    const preparadas = faturas.flatMap(f => {
      const plano = planejarPreAviso(providerId, { ...f, valor: Number(f.valor) }, dia, etapas, diasAntes);
      return plano ? [{ providerId, customerId: f.customerId, faturaId: f.id, diaContato: dia, vencimento: plano.vencimento, diasAtraso: plano.diasAtraso }] : [];
    });
    let novas = 0;
    for (let i = 0; i < preparadas.length; i += 500) {
      const inseridas = await db.insert(cobrancaPreAvisos).values(preparadas.slice(i, i + 500))
        .onConflictDoNothing({ target: [cobrancaPreAvisos.providerId, cobrancaPreAvisos.faturaId, cobrancaPreAvisos.diaContato] }).returning({ id: cobrancaPreAvisos.id });
      novas += inseridas.length;
    }
    return novas;
  }

  /** Elegibilidade relida no instante do envio: atrasados não voltam à prevenção. */
  async listarPreAvisosPendentes(providerId: number, dia: string, limite = 100) {
    return db.select({ id: cobrancaPreAvisos.id, faturaId: invoices.id, customerId: customers.id, nome: customers.name,
      telefone: customers.phone, vencimento: invoices.dueDate, status: invoices.status, valor: invoices.value, diasAtraso: cobrancaPreAvisos.diasAtraso })
      .from(cobrancaPreAvisos)
      .innerJoin(invoices, and(eq(invoices.id, cobrancaPreAvisos.faturaId), eq(invoices.providerId, providerId), eq(invoices.customerId, cobrancaPreAvisos.customerId)))
      .innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.providerId, providerId)))
      .where(and(eq(cobrancaPreAvisos.providerId, providerId), eq(cobrancaPreAvisos.diaContato, dia), eq(cobrancaPreAvisos.status, "pendente"),
        sql`not exists(select 1 from cobranca_preferencias_contato p where p.provider_id=${providerId}
          and p.customer_id=${customers.id} and (p.nao_contatar or p.pausa_ate>now()))`,
        sql`not exists(select 1 from cobranca_comunicacoes m where m.provider_id=${providerId}
          and m.customer_id=${customers.id} and m.status in ('enviando','enviado','incerto') and m.criado_em>now()-interval '24 hours')`,
        inArray(invoices.status, ["aberta", "pending", "overdue"]), eq(customers.status, "active"), sql`coalesce(${customers.totalOverdueAmount}, 0) <= 0`,
        sql`${invoices.dueDate}::date = ${cobrancaPreAvisos.vencimento}`))
      .orderBy(asc(cobrancaPreAvisos.id)).limit(Math.max(1, Math.min(500, limite)));
  }

  /** CAS antes do gateway: timeout ou crash nunca ocasiona reenvio automático. */
  async reservarPreAviso(providerId: number, id: number, dia: string): Promise<boolean> {
    const atualizadas = await db.update(cobrancaPreAvisos).set({ status: "enviando", atualizadoEm: new Date() })
      .where(and(eq(cobrancaPreAvisos.providerId, providerId), eq(cobrancaPreAvisos.id, id), eq(cobrancaPreAvisos.diaContato, dia), eq(cobrancaPreAvisos.status, "pendente"),
        sql`not exists(select 1 from cobranca_preferencias_contato p where p.provider_id=${providerId}
          and p.customer_id=${cobrancaPreAvisos.customerId} and (p.nao_contatar or p.pausa_ate>now()))`,
        sql`exists (select 1 from ${invoices} inner join ${customers}
          on ${customers.id} = ${invoices.customerId} and ${customers.providerId} = ${providerId}
          where ${invoices.providerId} = ${providerId} and ${invoices.id} = ${cobrancaPreAvisos.faturaId}
            and ${invoices.customerId} = ${cobrancaPreAvisos.customerId}
            and ${invoices.status} in ('aberta', 'pending', 'overdue')
            and ${invoices.dueDate}::date = ${cobrancaPreAvisos.vencimento}
            and ${customers.status} = 'active' and coalesce(${customers.totalOverdueAmount}, 0) <= 0)`))
      .returning({ id: cobrancaPreAvisos.id });
    return atualizadas.length === 1;
  }

  async concluirPreAviso(providerId: number, id: number, resultado: { status: "enviado" | "ignorado" | "incerto"; motivo?: string; conversationId?: string; messageId?: string | null }) {
    await db.update(cobrancaPreAvisos).set({ ...resultado, atualizadoEm: new Date() })
      .where(and(eq(cobrancaPreAvisos.providerId, providerId), eq(cobrancaPreAvisos.id, id), eq(cobrancaPreAvisos.status, "enviando")));
  }

  async contatosReservadosNoDia(providerId: number, dia: string): Promise<number> {
    const [r] = await db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(cobrancaPreAvisos)
      .where(and(eq(cobrancaPreAvisos.providerId, providerId), eq(cobrancaPreAvisos.diaContato, dia), inArray(cobrancaPreAvisos.status, ["enviando", "enviado", "incerto"])));
    return r?.total ?? 0;
  }
}
