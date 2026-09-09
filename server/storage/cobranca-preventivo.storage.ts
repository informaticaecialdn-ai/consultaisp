import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, invoices } from "@shared/schema";
import { cobrancaPreAvisos } from "@shared/schema-cobranca-faturas";
import { planejarPreAviso } from "@shared/cobranca/preventivo";
import { ETAPAS_PADRAO, type Etapa } from "@shared/cobranca/regua";

export function diaDoPreAviso(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const p = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export class CobrancaPreventivoStorage {
  async prepararPreAvisos(providerId: number, agora: Date, etapas: readonly Etapa[] = ETAPAS_PADRAO): Promise<number> {
    if (!etapas.some(e => e.id === "lembrete_pre_vencimento" && e.ativa)) return 0;
    const dia = diaDoPreAviso(agora);
    const fim = new Date(`${dia}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + 8);
    const faturas = await db.select({ id: invoices.id, customerId: invoices.customerId, status: invoices.status, vencimento: invoices.dueDate, valor: invoices.value })
      .from(invoices).innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.providerId, providerId)))
      .where(and(eq(invoices.providerId, providerId), inArray(invoices.status, ["aberta", "pending", "overdue"]),
        eq(customers.status, "active"), sql`coalesce(${customers.totalOverdueAmount}, 0) <= 0`, isNotNull(invoices.erpRef),
        gte(invoices.dueDate, new Date(`${dia}T00:00:00Z`)), lt(invoices.dueDate, fim)));
    const preparadas = faturas.flatMap(f => {
      const plano = planejarPreAviso(providerId, { ...f, valor: Number(f.valor) }, dia, etapas);
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
        inArray(invoices.status, ["aberta", "pending", "overdue"]), eq(customers.status, "active"), sql`coalesce(${customers.totalOverdueAmount}, 0) <= 0`,
        sql`${invoices.dueDate}::date = ${cobrancaPreAvisos.vencimento}`))
      .orderBy(asc(cobrancaPreAvisos.id)).limit(Math.max(1, Math.min(500, limite)));
  }

  /** CAS antes do gateway: timeout ou crash nunca ocasiona reenvio automático. */
  async reservarPreAviso(providerId: number, id: number, dia: string): Promise<boolean> {
    const atualizadas = await db.update(cobrancaPreAvisos).set({ status: "enviando", atualizadoEm: new Date() })
      .where(and(eq(cobrancaPreAvisos.providerId, providerId), eq(cobrancaPreAvisos.id, id), eq(cobrancaPreAvisos.diaContato, dia), eq(cobrancaPreAvisos.status, "pendente"),
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
