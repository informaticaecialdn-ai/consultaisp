/**
 * Spec 008.6 Batch 2 — Custom HTTP Tools endpoints.
 *
 * Endpoints que agents na plataforma Anthropic chamam pra fazer MUTATIONS
 * + leituras complexas no domínio Provedor.ai. Pattern: MCP é read-only do
 * ERP (Spec 008.5); custom HTTP aqui é tudo que envolve escrita ou banco
 * local (invoices, agent_memories, communications, agreements).
 *
 * Auth: reusa `requireMcpAuth` da Spec 008.5 — mesmo bearer token, validado
 * por hash, providerId resolvido implicitamente. Anthropic Platform tem o
 * bearer no Vault e injeta automaticamente em todo request HTTP feito por
 * agents que declaram esses endpoints como custom tools.
 *
 * Pattern de cada endpoint:
 *   1. Body validado por Zod (input contract)
 *   2. Multi-tenant: providerId vem do req.mcpAuth (NÃO do body)
 *   3. Reusa services existentes onde possível (asaas-multi-tenant, etc.)
 *   4. audit_logs entry com actor_type="agent_tool", actor_id=tokenPrefix
 *   5. Resposta JSON consistente: { ok: true, data: {...} } ou { ok: false, error: "..." }
 *
 * Endpoints (10):
 *   - POST /agent-tools/gerar_pix              (Bruno, Helena)
 *   - POST /agent-tools/consultar_fatura       (Helena)
 *   - POST /agent-tools/gerar_segunda_via      (Helena)
 *   - POST /agent-tools/consultar_pagamento    (Helena)
 *   - POST /agent-tools/registrar_promessa     (Helena)
 *   - POST /agent-tools/handoff_humano         (Helena)
 *   - POST /agent-tools/handoff_rafael         (Helena → Rafael, MVP audit-only)
 *   - POST /agent-tools/enviar_whatsapp        (Bruno, Helena, Sofia — Júlia gate)
 *   - POST /agent-tools/consultar_memoria_cliente (Sofia)
 *   - POST /agent-tools/julia_validate         (inline Júlia, p/ agents que não estão em managed yet)
 */

import express, { type Router, type Request, type Response } from "express";
import { z, type ZodSchema } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import {
  invoices,
  customers,
  agentMemories,
  pixCharges,
  paymentEvents,
  outboundAttempts,
} from "@shared/schema";
import { requireMcpAuth } from "../mcp/auth-middleware";
import { rateLimitByProvider } from "../mcp/rate-limit";
import { logger } from "../logger";
import { storage } from "../storage";
import { createPixForInvoice, getPaymentStatus } from "../services/asaas-multi-tenant";
import { invokeJulia } from "../agents/julia";

/* ────────────────────────── Helpers ────────────────────────── */

interface AgentToolContext {
  providerId: number;
  tokenPrefix: string;
  tokenName: string;
}

function getContext(req: Request): AgentToolContext | null {
  if (!req.mcpAuth) return null;
  return {
    providerId: req.mcpAuth.providerId,
    tokenPrefix: req.mcpAuth.tokenPrefix,
    tokenName: req.mcpAuth.tokenName,
  };
}

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function fail(message: string, code = 400) {
  return { ok: false as const, error: message, code };
}

/**
 * Validates body with a Zod schema and short-circuits 400 on failure.
 * Returns parsed body or null (response already sent).
 */
function parse<T>(schema: ZodSchema<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json(fail(`invalid_body: ${result.error.message}`));
    return null;
  }
  return result.data;
}

/**
 * Append-only audit entry for each agent-tool call. Fire-and-forget — not
 * blocking on insert failures. actor_type="agent_tool" distingue de
 * actor_type="mcp" (Spec 008.5).
 */
async function audit(
  ctx: AgentToolContext,
  toolName: string,
  resource: string,
  resourceId: string,
  payload: Record<string, unknown>,
  legalBasis = "Execução de contrato (LGPD art. 7º V)",
): Promise<void> {
  try {
    await storage.auditLog.registrarAcao(ctx.providerId, {
      action: `agent_tool_${toolName}`,
      resource,
      resourceId,
      actorType: "agent_tool",
      actorId: ctx.tokenPrefix,
      actorName: ctx.tokenName,
      payload,
      legalBasis,
    });
  } catch (err) {
    logger.warn(
      { err, toolName, providerId: ctx.providerId, tokenPrefix: ctx.tokenPrefix },
      "[agent-tools] failed to write audit log (non-blocking)",
    );
  }
}

/**
 * Wraps a handler with try/catch + structured logging + Audit fire-and-forget.
 * Each tool implements pure logic; this fn provides the cross-cutting concerns.
 */
type ToolHandler<TBody, TResult> = (
  body: TBody,
  ctx: AgentToolContext,
) => Promise<TResult>;

function wrap<TBody, TResult>(
  toolName: string,
  schema: ZodSchema<TBody>,
  handler: ToolHandler<TBody, TResult>,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const ctx = getContext(req);
    if (!ctx) {
      res.status(500).json(fail("missing_mcp_auth_context", 500));
      return;
    }
    const body = parse(schema, req, res);
    if (body === null) return;

    const started = Date.now();
    try {
      const data = await handler(body, ctx);
      logger.info(
        {
          action: "agent_tool_call",
          tool: toolName,
          providerId: ctx.providerId,
          tokenPrefix: ctx.tokenPrefix,
          latencyMs: Date.now() - started,
        },
        `agent-tool ${toolName} ok`,
      );
      res.json(ok(data));
    } catch (err) {
      const msg = (err as Error)?.message ?? "internal_error";
      logger.error(
        {
          action: "agent_tool_error",
          tool: toolName,
          providerId: ctx.providerId,
          tokenPrefix: ctx.tokenPrefix,
          err: msg,
        },
        `agent-tool ${toolName} failed`,
      );
      res.status(500).json(fail(msg, 500));
    }
  };
}

/* ────────────────────────── Schemas ────────────────────────── */

const gerarPixSchema = z.object({
  customerId: z.number().int().positive(),
  invoiceId: z.number().int().positive(),
});

const consultarFaturaSchema = z.object({
  customerId: z.number().int().positive(),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const gerarSegundaViaSchema = z.object({
  invoiceId: z.number().int().positive(),
});

const consultarPagamentoSchema = z.object({
  invoiceId: z.number().int().positive(),
});

const registrarPromessaSchema = z.object({
  customerId: z.number().int().positive(),
  date: z.string(), // ISO 8601 YYYY-MM-DD
  amount: z.number().positive(),
  channel: z.enum(["whatsapp", "sms", "email", "telefone"]),
});

const handoffHumanoSchema = z.object({
  customerId: z.number().int().positive(),
  reason: z.string().min(3).max(500),
  urgent: z.boolean().optional(),
});

const handoffRafaelSchema = z.object({
  customerId: z.number().int().positive(),
  conversationSummary: z.string().min(10),
  sentimentScore: z.number().min(-1).max(1).optional(),
});

const enviarWhatsappSchema = z.object({
  customerId: z.number().int().positive(),
  content: z.string().min(1).max(2000),
  templateName: z.string().optional(),
  variables: z.record(z.string()).optional(),
  agentId: z.string().min(1), // who's sending: agt_lembrador_v1, agt_atendente_v1, etc.
});

const consultarMemoriaSchema = z.object({
  customerId: z.number().int().positive(),
  agentId: z.string().optional(), // filtra por 1 agent específico; default = todos
});

const juliaValidateSchema = z.object({
  customerId: z.number().int().positive(),
  agentId: z.string().min(1),
  actionType: z.enum(["send_message", "suspender_parcial", "suspender_total", "cancelar"]),
  channel: z.enum(["whatsapp", "sms", "email"]).optional(),
  content: z.string().optional(),
  correlationId: z.string().optional(),
});

/* ────────────────────────── Router ────────────────────────── */

export function registerAgentToolsRoutes(): Router {
  const router = express.Router();
  const jsonParser = express.json({ limit: "1mb" });

  // gerar_pix — cria charge Pix dinâmica via Asaas pro invoice
  router.post(
    "/agent-tools/gerar_pix",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 60 }),
    wrap("gerar_pix", gerarPixSchema, async (body, ctx) => {
      // Carrega invoice + customer (multi-tenant)
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, body.invoiceId), eq(invoices.providerId, ctx.providerId)))
        .limit(1);
      if (!inv) throw new Error(`invoice_not_found_or_not_owned`);

      const [cust] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, body.customerId), eq(customers.providerId, ctx.providerId)))
        .limit(1);
      if (!cust) throw new Error(`customer_not_found_or_not_owned`);

      const provider = await storage.getProvider(ctx.providerId);
      if (!provider) throw new Error("provider_not_found");

      // Cria outbound attempt sintético — agent-tools usa step="ON_DEMAND"
      // (distingue de Bruno D-3/D-1 e Sofia THANK_YOU em outbound_attempts).
      const [attempt] = await db.insert(outboundAttempts).values({
        providerId: ctx.providerId,
        customerId: body.customerId,
        invoiceId: body.invoiceId,
        agentId: "agent_tool",
        step: "ON_DEMAND",
        scheduledFor: new Date(),
        status: "scheduled",
      }).returning();

      const result = await createPixForInvoice({
        providerId: ctx.providerId,
        invoiceId: body.invoiceId,
        customerId: body.customerId,
        attemptId: attempt.id,
        customerCpfCnpj: cust.cpfCnpj,
        customerName: cust.name,
        customerEmail: cust.email ?? undefined,
        customerPhone: cust.phone ?? undefined,
        invoiceValue: Number(inv.value),
        invoiceDueDate: inv.dueDate.toISOString().slice(0, 10),
        providerName: provider.name,
        invoiceNumber: `INV-${inv.id}`,
      });

      await audit(ctx, "gerar_pix", "invoice", String(body.invoiceId), {
        customerId: body.customerId,
        asaasPaymentId: result.asaasPaymentId,
        value: Number(inv.value),
      });

      return {
        asaasPaymentId: result.asaasPaymentId,
        qrCodeBase64: result.qrCodeBase64,
        copyPaste: result.copyPaste,
        expiresAt: result.expiresAt?.toISOString() ?? null,
      };
    }),
  );

  // consultar_fatura — lista faturas filtradas
  router.post(
    "/agent-tools/consultar_fatura",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 120 }),
    wrap("consultar_fatura", consultarFaturaSchema, async (body, ctx) => {
      const whereClauses = [
        eq(invoices.providerId, ctx.providerId),
        eq(invoices.customerId, body.customerId),
      ];
      if (body.status) whereClauses.push(eq(invoices.status, body.status));

      const rows = await db
        .select()
        .from(invoices)
        .where(and(...whereClauses))
        .orderBy(desc(invoices.dueDate))
        .limit(body.limit ?? 20);

      await audit(ctx, "consultar_fatura", "customer", String(body.customerId), {
        filterStatus: body.status,
        count: rows.length,
      });

      return {
        customerId: body.customerId,
        count: rows.length,
        invoices: rows.map((r) => ({
          id: r.id,
          value: Number(r.value),
          dueDate: r.dueDate.toISOString().slice(0, 10),
          paidDate: r.paidDate?.toISOString().slice(0, 10) ?? null,
          status: r.status,
        })),
      };
    }),
  );

  // gerar_segunda_via — recria charge Pix pra invoice existente
  router.post(
    "/agent-tools/gerar_segunda_via",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 30 }),
    wrap("gerar_segunda_via", gerarSegundaViaSchema, async (body, ctx) => {
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, body.invoiceId), eq(invoices.providerId, ctx.providerId)))
        .limit(1);
      if (!inv) throw new Error("invoice_not_found_or_not_owned");

      // Reusa gerar_pix com mesmo customerId
      const [cust] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, inv.customerId), eq(customers.providerId, ctx.providerId)))
        .limit(1);
      if (!cust) throw new Error("customer_not_found");

      const provider = await storage.getProvider(ctx.providerId);
      if (!provider) throw new Error("provider_not_found");

      const [attempt] = await db.insert(outboundAttempts).values({
        providerId: ctx.providerId,
        customerId: inv.customerId,
        invoiceId: inv.id,
        agentId: "agent_tool",
        step: "ON_DEMAND",
        scheduledFor: new Date(),
        status: "scheduled",
      }).returning();

      const result = await createPixForInvoice({
        providerId: ctx.providerId,
        invoiceId: inv.id,
        customerId: inv.customerId,
        attemptId: attempt.id,
        customerCpfCnpj: cust.cpfCnpj,
        customerName: cust.name,
        customerEmail: cust.email ?? undefined,
        customerPhone: cust.phone ?? undefined,
        invoiceValue: Number(inv.value),
        invoiceDueDate: inv.dueDate.toISOString().slice(0, 10),
        providerName: provider.name,
        invoiceNumber: `INV-${inv.id}`,
      });

      await audit(ctx, "gerar_segunda_via", "invoice", String(inv.id), {
        asaasPaymentId: result.asaasPaymentId,
      });

      return {
        asaasPaymentId: result.asaasPaymentId,
        qrCodeBase64: result.qrCodeBase64,
        copyPaste: result.copyPaste,
        expiresAt: result.expiresAt?.toISOString() ?? null,
      };
    }),
  );

  // consultar_pagamento — status atual de uma fatura (local + Asaas se houver pix charge)
  router.post(
    "/agent-tools/consultar_pagamento",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 120 }),
    wrap("consultar_pagamento", consultarPagamentoSchema, async (body, ctx) => {
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, body.invoiceId), eq(invoices.providerId, ctx.providerId)))
        .limit(1);
      if (!inv) throw new Error("invoice_not_found_or_not_owned");

      const [pix] = await db
        .select()
        .from(pixCharges)
        .where(and(eq(pixCharges.invoiceId, inv.id), eq(pixCharges.providerId, ctx.providerId)))
        .orderBy(desc(pixCharges.createdAt))
        .limit(1);

      const events = pix?.asaasPaymentId
        ? await db
            .select()
            .from(paymentEvents)
            .where(and(
              eq(paymentEvents.asaasPaymentId, pix.asaasPaymentId),
              eq(paymentEvents.providerId, ctx.providerId),
            ))
            .orderBy(desc(paymentEvents.receivedAt))
            .limit(10)
        : [];

      let asaasStatus: string | null = null;
      if (pix?.asaasPaymentId) {
        try {
          const live = await getPaymentStatus(ctx.providerId, pix.asaasPaymentId);
          asaasStatus = live.asaasStatus;
        } catch (err) {
          logger.warn({ err, asaasPaymentId: pix.asaasPaymentId }, "[agent-tools] live status fetch failed");
        }
      }

      await audit(ctx, "consultar_pagamento", "invoice", String(inv.id), {
        invoiceStatus: inv.status,
        asaasStatus,
        eventCount: events.length,
      });

      return {
        invoiceId: inv.id,
        invoiceStatus: inv.status,
        paidDate: inv.paidDate?.toISOString() ?? null,
        asaasPaymentId: pix?.asaasPaymentId ?? null,
        asaasStatus,
        recentEvents: events.map((e) => ({
          eventType: e.eventType,
          receivedAt: e.receivedAt.toISOString(),
          processingStatus: e.processingStatus,
        })),
      };
    }),
  );

  // registrar_promessa — escreve em agent_memories.promises
  router.post(
    "/agent-tools/registrar_promessa",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 60 }),
    wrap("registrar_promessa", registrarPromessaSchema, async (body, ctx) => {
      // Carrega memória existente (Helena scope)
      const [existing] = await db
        .select()
        .from(agentMemories)
        .where(and(eq(agentMemories.customerId, body.customerId), eq(agentMemories.agentId, "helena")))
        .limit(1);

      const promiseRecord = {
        date: body.date,
        amount: body.amount,
        channel: body.channel,
        createdAt: new Date().toISOString(),
        status: "pending" as const,
      };

      const promises = [
        ...((existing?.promises as Array<Record<string, unknown>>) ?? []),
        promiseRecord,
      ];

      if (existing) {
        await db
          .update(agentMemories)
          .set({ promises, updatedAt: new Date(), lastInteractionAt: new Date() })
          .where(eq(agentMemories.id, existing.id));
      } else {
        await db.insert(agentMemories).values({
          customerId: body.customerId,
          agentId: "helena",
          promises,
          lastInteractionAt: new Date(),
        });
      }

      await audit(ctx, "registrar_promessa", "customer", String(body.customerId), promiseRecord);

      return { promiseId: `promise_${ctx.providerId}_${body.customerId}_${Date.now()}` };
    }),
  );

  // handoff_humano — cria task humana (MVP: log estruturado em audit)
  router.post(
    "/agent-tools/handoff_humano",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 30 }),
    wrap("handoff_humano", handoffHumanoSchema, async (body, ctx) => {
      const taskId = `task_${ctx.providerId}_${body.customerId}_${Date.now()}`;
      await audit(
        ctx,
        "handoff_humano",
        "customer",
        String(body.customerId),
        {
          taskId,
          reason: body.reason,
          urgent: body.urgent ?? false,
        },
        "Direito do consumidor à atenção humana (CDC art. 6º III)",
      );
      logger.info(
        { action: "handoff_humano", taskId, customerId: body.customerId, urgent: body.urgent },
        "[agent-tools] handoff humano criado",
      );
      return { taskId, status: "queued" };
    }),
  );

  // handoff_rafael — prepara contexto pra Rafael (MVP: audit-only, Rafael não existe ainda)
  router.post(
    "/agent-tools/handoff_rafael",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 30 }),
    wrap("handoff_rafael", handoffRafaelSchema, async (body, ctx) => {
      const handoffId = `handoff_rafael_${ctx.providerId}_${body.customerId}_${Date.now()}`;
      await audit(ctx, "handoff_rafael", "customer", String(body.customerId), {
        handoffId,
        conversationSummary: body.conversationSummary,
        sentimentScore: body.sentimentScore ?? null,
        note: "Rafael ainda não existe — handoff registrado em audit_logs para Spec 009",
      });
      return { handoffId, status: "queued_for_rafael" };
    }),
  );

  // enviar_whatsapp — gate Júlia + envio Meta + persistência
  // MVP: faz a validação Júlia mas NÃO envia ainda (envio Meta requer outbound integration completa).
  // Quando integração Meta+HSM estiver ligada (Spec 008), troca o stub pelo envio real.
  router.post(
    "/agent-tools/enviar_whatsapp",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 60 }),
    wrap("enviar_whatsapp", enviarWhatsappSchema, async (body, ctx) => {
      // 1. Júlia gate (in-process Direct API call — Júlia ainda é direct durante 008.6)
      const juliaDecision = await invokeJulia({
        tenantId: ctx.providerId,
        customerId: body.customerId,
        agentId: body.agentId,
        actionType: "send_message",
        channel: "whatsapp",
        content: body.content,
      });

      if (juliaDecision.decision === "BLOCKED") {
        await audit(ctx, "enviar_whatsapp_blocked", "customer", String(body.customerId), {
          juliaDecision: juliaDecision.decision,
          blockingReasons: juliaDecision.blockingReasons,
          requestedBy: body.agentId,
        });
        return {
          sent: false,
          juliaDecision: juliaDecision.decision,
          blockingReasons: juliaDecision.blockingReasons,
        };
      }

      // 2. (TODO Spec 008) — chamar Meta Cloud API
      // Por enquanto: persiste em communications como "scheduled" + retorna ok
      // pra agent saber que foi aprovado mas ainda não dispatch'ed.
      const finalContent = juliaDecision.decision === "APPROVED_WITH_ADJUSTMENT"
        ? `[ajustado por Júlia] ${body.content}`
        : body.content;

      const comm = await storage.communications.create(ctx.providerId, {
        customerId: body.customerId,
        agentId: body.agentId,
        channel: "whatsapp",
        direction: "outbound",
        status: "pending",
        content: finalContent,
        templateName: body.templateName,
      });

      await audit(ctx, "enviar_whatsapp", "customer", String(body.customerId), {
        communicationId: comm.id,
        juliaDecision: juliaDecision.decision,
        adjustments: juliaDecision.ajustesSugeridos,
        agentId: body.agentId,
      });

      return {
        sent: false, // será true quando Spec 008 ligar o envio Meta
        scheduled: true,
        communicationId: comm.id,
        juliaDecision: juliaDecision.decision,
        adjustments: juliaDecision.ajustesSugeridos,
      };
    }),
  );

  // consultar_memoria_cliente — lê agent_memories
  router.post(
    "/agent-tools/consultar_memoria_cliente",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 120 }),
    wrap("consultar_memoria_cliente", consultarMemoriaSchema, async (body, ctx) => {
      // Verifica que o customer pertence ao tenant
      const [cust] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, body.customerId), eq(customers.providerId, ctx.providerId)))
        .limit(1);
      if (!cust) throw new Error("customer_not_found_or_not_owned");

      const clauses = [eq(agentMemories.customerId, body.customerId)];
      if (body.agentId) clauses.push(eq(agentMemories.agentId, body.agentId));

      const rows = await db.select().from(agentMemories).where(and(...clauses));

      await audit(ctx, "consultar_memoria_cliente", "customer", String(body.customerId), {
        agentFilter: body.agentId ?? "*",
        memoriesCount: rows.length,
      });

      return {
        customerId: body.customerId,
        memories: rows.map((r) => ({
          agentId: r.agentId,
          facts: r.facts,
          promises: r.promises,
          topics: r.topics,
          summary: r.summary,
          lastInteractionAt: r.lastInteractionAt?.toISOString() ?? null,
        })),
      };
    }),
  );

  // julia_validate — agent pede validação Júlia inline (útil enquanto Júlia
  // não está em managed; substituído por Júlia como agent na plataforma depois)
  router.post(
    "/agent-tools/julia_validate",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 300 }),
    wrap("julia_validate", juliaValidateSchema, async (body, ctx) => {
      const decision = await invokeJulia({
        tenantId: ctx.providerId,
        customerId: body.customerId,
        agentId: body.agentId,
        actionType: body.actionType,
        channel: body.channel,
        content: body.content,
        correlationId: body.correlationId,
      });

      await audit(ctx, "julia_validate", "customer", String(body.customerId), {
        decision: decision.decision,
        actionType: body.actionType,
        latencyMs: decision.latencyMs,
      });

      return {
        decision: decision.decision,
        fundamentacaoLegal: decision.fundamentacaoLegal,
        ajustesSugeridos: decision.ajustesSugeridos,
        blockingReasons: decision.blockingReasons,
        camadasValidadas: decision.camadasValidadas,
        validUntil: decision.validUntil,
      };
    }),
  );

  // Health endpoint público pra Anthropic Platform pingar
  router.get("/agent-tools/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "provedor-ai-agent-tools",
      version: "0.1.0",
      tools: [
        "gerar_pix",
        "consultar_fatura",
        "gerar_segunda_via",
        "consultar_pagamento",
        "registrar_promessa",
        "handoff_humano",
        "handoff_rafael",
        "enviar_whatsapp",
        "consultar_memoria_cliente",
        "julia_validate",
      ],
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
