/**
 * Memory + context helpers for Helena (Spec 003).
 *
 * - loadEnrichedContext: consolidates customer + contract + invoices + memory + score
 * - extractFactsFromTurn: heuristic detection of relevant facts from a client message
 * - detectPromise: detects payment promises ("vou pagar dia 15", "pago sexta")
 * - compactSummary: Haiku-summarized rolling summary of the conversation
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  contracts,
  customers,
  invoices,
  ispConsultations,
  type AgentMemory,
} from "@shared/schema";
import { AgentMemoryStorage, type MemoryFact, type MemoryPromise } from "../storage/agent-memory.storage";
import { createMessage } from "./anthropic-client";

const memStorage = new AgentMemoryStorage();
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

export interface EnrichedContext {
  customer: typeof customers.$inferSelect | null;
  contract: typeof contracts.$inferSelect | null;
  recentInvoices: Array<typeof invoices.$inferSelect>;
  paymentHistory: {
    onTimeCount: number;
    overdueCount: number;
    avgDaysLate: number;
  };
  memory: AgentMemory | null;
  score: number | null;
  technicalStatus: string | null;
}

export async function loadEnrichedContext(
  tenantId: number,
  customerId: number,
  agentId = "agt_reativo_v1",
): Promise<EnrichedContext> {
  const [cust] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.providerId, tenantId)))
    .limit(1);

  const [contract] = cust
    ? await db.select().from(contracts).where(eq(contracts.customerId, customerId)).orderBy(desc(contracts.startDate)).limit(1)
    : [];

  const recentInvoices = cust
    ? await db.select().from(invoices).where(eq(invoices.customerId, customerId)).orderBy(desc(invoices.dueDate)).limit(10)
    : [];

  let onTime = 0;
  let overdue = 0;
  let daysLateSum = 0;
  for (const inv of recentInvoices) {
    if (inv.status === "paid") onTime++;
    else if (inv.status === "overdue") {
      overdue++;
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      if (due) daysLateSum += Math.max(0, Math.floor((Date.now() - due.getTime()) / (24 * 3600 * 1000)));
    }
  }
  const paymentHistory = {
    onTimeCount: onTime,
    overdueCount: overdue,
    avgDaysLate: overdue > 0 ? Math.round(daysLateSum / overdue) : 0,
  };

  const memory = (await memStorage.load(customerId, agentId)) ?? null;

  let score: number | null = null;
  if (cust?.cpfCnpj) {
    const [latest] = await db
      .select({ score: ispConsultations.score })
      .from(ispConsultations)
      .where(eq(ispConsultations.cpfCnpj, cust.cpfCnpj))
      .orderBy(desc(ispConsultations.createdAt))
      .limit(1);
    score = latest?.score ?? null;
  }

  return {
    customer: cust ?? null,
    contract: contract ?? null,
    recentInvoices,
    paymentHistory,
    memory,
    score,
    technicalStatus: null, // TODO: integrate ERP technical status when available.
  };
}

// ============================================================
// Heuristic fact extraction
// ============================================================

const FACT_PATTERNS: Array<{ pattern: RegExp; tag: string; vulnerabilidade?: boolean }> = [
  { pattern: /\bperdi (o )?emprego\b|\bfui demitido\b|\bestou desempregad[oa]\b/i, tag: "desemprego", vulnerabilidade: true },
  { pattern: /\bminha m[ãa]e\b|\bmeu pai\b|\bfilh[oa]\s+doente\b/i, tag: "familia_proxima_doente", vulnerabilidade: true },
  { pattern: /\bhospital\b|\binternad[oa]\b|\bdoen[çc]a grave\b|\bc[aâ]ncer\b/i, tag: "doenca_grave", vulnerabilidade: true },
  { pattern: /\bviaj(ei|ando|arei|o)\b/i, tag: "viagem" },
  { pattern: /\bmudei (de )?(número|numero|telefone|celular)\b/i, tag: "mudanca_numero" },
  { pattern: /\bmudei (de )?(endere[çc]o|casa)\b/i, tag: "mudanca_endereco" },
  { pattern: /\baposentad[oa]\b|\b65 anos\b|\bsou idos[oa]\b/i, tag: "idoso", vulnerabilidade: true },
  { pattern: /\bbpc\b|\bbolsa fam[ií]lia\b/i, tag: "beneficio_social", vulnerabilidade: true },
];

export interface ExtractedFact extends MemoryFact {
  tag: string;
  vulnerabilidade?: boolean;
}

export function extractFactsFromTurn(text: string, source = "helena_inbound"): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const now = new Date().toISOString();
  for (const { pattern, tag, vulnerabilidade } of FACT_PATTERNS) {
    if (pattern.test(text)) {
      out.push({
        fact: `[${tag}] ${text.slice(0, 200)}`,
        source,
        recordedAt: now,
        tag,
        ...(vulnerabilidade ? { vulnerabilidade: true } : {}),
      });
    }
  }
  return out;
}

// ============================================================
// Payment promise detection
// ============================================================

const MONTH_MAP: Record<string, number> = {
  janeiro: 0, fevereiro: 1, "março": 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};
const WEEKDAY_MAP: Record<string, number> = {
  domingo: 0, "segunda": 1, "segunda-feira": 1, "terça": 2, "terca": 2, "terça-feira": 2,
  "quarta": 3, "quarta-feira": 3, "quinta": 4, "quinta-feira": 4,
  "sexta": 5, "sexta-feira": 5, "sábado": 6, sabado: 6,
};

function nextWeekday(target: number, from: Date): Date {
  const d = new Date(from);
  const cur = d.getDay();
  let delta = (target - cur + 7) % 7;
  if (delta === 0) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export interface DetectedPromise {
  date: string; // ISO YYYY-MM-DD
  value?: number;
}

export function detectPromise(text: string, now: Date = new Date()): DetectedPromise | null {
  const lower = text.toLowerCase();
  const hasPay = /\b(pago|pagar|pagamento|deposit[oa]|deposito|transfir[oa]|quito)\b/.test(lower);
  if (!hasPay) return null;

  // Value: R$ 123,45 or just "150 reais"
  let value: number | undefined;
  const valueMatch = lower.match(/r\$\s*([\d.,]+)/) ?? lower.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s*reais\b/);
  if (valueMatch) {
    const n = Number(valueMatch[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) value = n;
  }

  // "dia 18" / "dia 18 de junho"
  const dayMonth = lower.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-zçãéí]+))?/i);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    let month = now.getMonth();
    let year = now.getFullYear();
    if (dayMonth[2] && MONTH_MAP[dayMonth[2]] !== undefined) {
      month = MONTH_MAP[dayMonth[2]];
      if (month < now.getMonth()) year++;
    } else if (day < now.getDate()) {
      // assume next month if day already passed
      month = (month + 1) % 12;
      if (month === 0) year++;
    }
    const dt = new Date(year, month, day);
    return { date: dt.toISOString().slice(0, 10), ...(value !== undefined ? { value } : {}) };
  }

  // Weekday: "pago sexta", "na segunda"
  for (const [name, idx] of Object.entries(WEEKDAY_MAP)) {
    const re = new RegExp(`\\b(?:na |no |essa |proxima |próxima |pr[óo]xima )?${name.replace(/\\/g, "")}\\b`, "i");
    if (re.test(lower)) {
      const dt = nextWeekday(idx, now);
      return { date: dt.toISOString().slice(0, 10), ...(value !== undefined ? { value } : {}) };
    }
  }

  // "amanhã" / "hoje"
  if (/\bamanh[ãa]\b/.test(lower)) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + 1);
    return { date: dt.toISOString().slice(0, 10), ...(value !== undefined ? { value } : {}) };
  }
  if (/\bhoje\b/.test(lower)) {
    return { date: now.toISOString().slice(0, 10), ...(value !== undefined ? { value } : {}) };
  }

  return null;
}

// ============================================================
// Rolling summary via Haiku
// ============================================================

export async function compactSummary(memory: AgentMemory): Promise<string> {
  const recentFacts = ((memory.facts ?? []) as MemoryFact[]).slice(-10);
  const recentPromises = ((memory.promises ?? []) as MemoryPromise[]).slice(-5);
  const topics = (memory.topics ?? []).slice(-10);

  const userPayload = JSON.stringify({ facts: recentFacts, promises: recentPromises, topics });

  const { message } = await createMessage({
    model: SUMMARY_MODEL,
    max_tokens: 200,
    temperature: 0,
    system: "Você resume contexto de cliente para um atendente. Gere um resumo factual em PT-BR com no máximo 100 tokens, em 2-3 frases curtas. Sem emojis, sem cumprimentos.",
    messages: [{ role: "user", content: userPayload }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join(" ")
    .trim();
  return text.slice(0, 800);
}
