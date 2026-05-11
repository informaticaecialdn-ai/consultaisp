/**
 * Tool definitions + dispatcher for Helena (Spec 003).
 *
 * Tools follow the Anthropic tool-use schema. The `executeTool` dispatcher
 * receives the JSON `input` Anthropic produced for a tool_use block, runs the
 * appropriate side effect (ERP / storage / WhatsApp client), and returns a
 * JSON-serializable result. Helena's loop will feed that result back as the
 * `tool_result` content for the next turn.
 *
 * IMPORTANT: every outbound channel call goes through invokeJulia() first.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../logger";
import { contracts, customers, invoices } from "@shared/schema";
import { AgentMemoryStorage } from "../../storage/agent-memory.storage";
import { CommunicationsStorage } from "../../storage/communications.storage";
import { invokeJulia, JuliaBlockedError } from "../julia";

// Storage layer / WhatsApp client are owned by sibling agents — we import them
// dynamically so missing files don't break this module at import time during
// parallel implementation.
//
// Expected runtime signatures (per task spec):
//   createMetaClient(providerId: number) -> { sendText({to, body}): Promise<{messageId}>;
//                                              sendTemplate({to, name, language, components?}): Promise<{messageId}> }

const memStorage = new AgentMemoryStorage();
const commStorage = new CommunicationsStorage();

export interface ToolContext {
  tenantId: number;
  customerId: number;
  /** WhatsApp wamid being replied to (for storing outbound communications). */
  senderPhone?: string;
  agentId?: string;
  correlationId?: string;
  /** Captures every compliance_check id produced during this Helena run. */
  complianceCheckIds: string[];
}

// ============================================================
// Tool schemas
// ============================================================

export const helenaTools: Tool[] = [
  {
    name: "consultar_fatura",
    description:
      "Consulta as faturas recentes do cliente (banco local + ERP se disponível). Use para responder dúvidas sobre valor, vencimento e situação.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Quantas faturas retornar (padrão 5)" },
      },
    },
  },
  {
    name: "gerar_segunda_via",
    description: "Gera 2ª via de boleto/Pix para uma fatura específica do cliente atual.",
    input_schema: {
      type: "object",
      properties: { invoiceId: { type: "number" } },
      required: ["invoiceId"],
    },
  },
  {
    name: "gerar_pix",
    description: "Gera código Pix copia-e-cola para uma fatura específica.",
    input_schema: {
      type: "object",
      properties: { invoiceId: { type: "number" } },
      required: ["invoiceId"],
    },
  },
  {
    name: "consultar_pagamento",
    description: "Consulta status de pagamento de uma fatura (confirma se já foi pago e quando).",
    input_schema: {
      type: "object",
      properties: { invoiceId: { type: "number" } },
      required: ["invoiceId"],
    },
  },
  {
    name: "registrar_promessa",
    description: "Registra uma promessa de pagamento do cliente em sua memória persistente.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Data prometida em ISO YYYY-MM-DD" },
        value: { type: "number", description: "Valor prometido em reais (opcional)" },
      },
      required: ["date"],
    },
  },
  {
    name: "handoff_humano",
    description: "Escala o atendimento para um humano. Use em casos sensíveis: cancel, dispute, vulnerabilidade, 8 turnos.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        priority: { type: "string", enum: ["urgent", "normal"] },
      },
      required: ["reason", "priority"],
    },
  },
  {
    name: "handoff_rafael",
    description: "Escala para o agente Negociador (Rafael) quando o cliente pede parcelamento ou desconto > 5%.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "enviar_whatsapp",
    description:
      "Envia uma mensagem WhatsApp ao cliente. SEMPRE valida via Júlia antes de enviar. Use apenas no fim do raciocínio quando a resposta estiver pronta.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        templateName: { type: "string", description: "Opcional: nome do template HSM" },
      },
      required: ["content"],
    },
  },
];

// ============================================================
// Dispatcher
// ============================================================

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** When true, Helena loop should break and surface escalation. */
  escalation?: {
    type: "humano" | "rafael" | "julia_blocked";
    reason: string;
    priority?: "urgent" | "normal";
  };
  /** When tool produced an outbound wamid. */
  outboundMessageId?: string;
}

async function lazyMetaClient(tenantId: number): Promise<
  | {
      sendText: (args: { to: string; body: string }) => Promise<{ messageId: string }>;
      sendTemplate: (args: { to: string; name: string; language?: string; components?: unknown[] }) => Promise<{ messageId: string }>;
    }
  | null
> {
  try {
    // Resolved at runtime so the sibling implementation can land later.
    const mod = (await import("../../communications/whatsapp/index.js" as string)) as unknown as {
      createMetaClient?: (providerId: number) => Promise<unknown> | unknown;
    };
    if (typeof mod.createMetaClient !== "function") return null;
    const client = (await mod.createMetaClient(tenantId)) as Awaited<ReturnType<typeof lazyMetaClient>>;
    return client as Awaited<ReturnType<typeof lazyMetaClient>>;
  } catch (err) {
    logger.warn({ action: "meta_client_unavailable", err: (err as Error)?.message }, "WhatsApp client not yet wired");
    return null;
  }
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    case "consultar_fatura": {
      const limit = Math.min(20, Number(args.limit ?? 5) || 5);
      const rows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.customerId, ctx.customerId))
        .orderBy(desc(invoices.dueDate))
        .limit(limit);
      return { ok: true, data: rows };
    }

    case "gerar_segunda_via":
    case "gerar_pix": {
      const invoiceId = Number(args.invoiceId);
      if (!Number.isFinite(invoiceId)) return { ok: false, error: "invoiceId inválido" };
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.customerId, ctx.customerId)))
        .limit(1);
      if (!inv) return { ok: false, error: "Fatura não encontrada" };
      // TODO: integrar com gateway Pix/boleto real do tenant — placeholder determinístico.
      return {
        ok: true,
        data: {
          invoiceId: inv.id,
          value: inv.value,
          dueDate: inv.dueDate,
          status: inv.status,
          pixCopyPaste: `00020126360014BR.GOV.BCB.PIX0114+55${ctx.tenantId}0000${inv.id}5204000053039865802BR5908Provedor6009Sao Paulo62070503***6304TODO`,
          downloadUrl: `/api/invoices/${inv.id}/pdf`,
        },
      };
    }

    case "consultar_pagamento": {
      const invoiceId = Number(args.invoiceId);
      if (!Number.isFinite(invoiceId)) return { ok: false, error: "invoiceId inválido" };
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.customerId, ctx.customerId)))
        .limit(1);
      if (!inv) return { ok: false, error: "Fatura não encontrada" };
      return {
        ok: true,
        data: {
          invoiceId: inv.id,
          status: inv.status,
          paid: inv.status === "paid",
          paidAt: inv.paidDate ?? null,
        },
      };
    }

    case "registrar_promessa": {
      const date = String(args.date ?? "");
      const value = args.value !== undefined ? Number(args.value) : undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "date deve ser YYYY-MM-DD" };
      const agentId = ctx.agentId ?? "agt_reativo_v1";
      await memStorage.addPromise(ctx.customerId, agentId, {
        promise: `pagamento em ${date}${value !== undefined ? ` (R$ ${value})` : ""}`,
        dueDate: date,
        status: "pending",
        recordedAt: new Date().toISOString(),
      });
      return { ok: true, data: { date, value } };
    }

    case "handoff_humano": {
      const reason = String(args.reason ?? "sem motivo informado");
      const priority = (args.priority === "urgent" ? "urgent" : "normal") as "urgent" | "normal";
      // TODO: criar task em fila de atendimento (placeholder).
      logger.info(
        { tenantId: ctx.tenantId, customerId: ctx.customerId, action: "handoff_humano", reason, priority },
        "Helena handoff humano",
      );
      return { ok: true, data: { reason, priority }, escalation: { type: "humano", reason, priority } };
    }

    case "handoff_rafael": {
      const reason = String(args.reason ?? "negociação fora do escopo de Helena");
      // TODO: enfileirar para Rafael (placeholder).
      logger.info({ tenantId: ctx.tenantId, customerId: ctx.customerId, action: "handoff_rafael", reason }, "Helena handoff rafael");
      return { ok: true, data: { reason }, escalation: { type: "rafael", reason } };
    }

    case "enviar_whatsapp": {
      const content = String(args.content ?? "").trim();
      const templateName = args.templateName ? String(args.templateName) : undefined;
      if (!content) return { ok: false, error: "content vazio" };

      const decision = await invokeJulia({
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        agentId: ctx.agentId ?? "agt_reativo_v1",
        actionType: "send_message",
        channel: "whatsapp",
        content,
        correlationId: ctx.correlationId,
      });
      if (decision.complianceCheckId) ctx.complianceCheckIds.push(decision.complianceCheckId);

      if (decision.decision === "BLOCKED") {
        return {
          ok: false,
          error: `BLOCKED: ${decision.blockingReasons?.join("; ") ?? "compliance"}`,
          escalation: {
            type: "julia_blocked",
            reason: decision.blockingReasons?.join("; ") ?? "compliance",
            priority: "urgent",
          },
        };
      }

      // Resolve recipient phone.
      const [cust] = await db
        .select({ phone: customers.phone })
        .from(customers)
        .where(eq(customers.id, ctx.customerId))
        .limit(1);
      const to = ctx.senderPhone ?? cust?.phone ?? null;
      if (!to) return { ok: false, error: "Sem telefone para envio" };

      const client = await lazyMetaClient(ctx.tenantId);
      if (!client) {
        return { ok: false, error: "Meta WhatsApp client indisponível (será implementado por sibling agent)" };
      }

      let messageId: string;
      try {
        if (templateName) {
          const r = await client.sendTemplate({ to, name: templateName, language: "pt_BR" });
          messageId = r.messageId;
        } else {
          const r = await client.sendText({ to, body: content });
          messageId = r.messageId;
        }
      } catch (err) {
        logger.error({ action: "whatsapp_send_failed", err: (err as Error)?.message }, "WhatsApp send failed");
        return { ok: false, error: `Falha ao enviar WhatsApp: ${(err as Error)?.message}` };
      }

      // Persist outbound communication.
      try {
        await commStorage.create(ctx.tenantId, {
          customerId: ctx.customerId,
          channel: "whatsapp",
          direction: "outbound",
          content,
          status: "sent",
          externalMessageId: messageId,
          sentAt: new Date(),
          agentId: ctx.agentId ?? "agt_reativo_v1",
          ...(templateName ? { templateName } : {}),
        } as Parameters<CommunicationsStorage["create"]>[1]);
      } catch (err) {
        logger.warn({ action: "outbound_persist_failed", err: (err as Error)?.message }, "outbound persist failed");
      }

      return { ok: true, data: { messageId }, outboundMessageId: messageId };
    }

    default:
      return { ok: false, error: `Tool desconhecida: ${name}` };
  }
}

// Re-export for callers that want to know the type without hitting Anthropic types directly.
export type { Tool };
export { JuliaBlockedError };
