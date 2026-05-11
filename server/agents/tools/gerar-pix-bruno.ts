/**
 * Spec 004 — Tool `gerar_pix_dinamico` (Bruno).
 *
 * Bruno chama esta tool exatamente uma vez por execução. Ela:
 *   1. Carrega fatura + cliente do tenant (multi-tenant gate).
 *   2. Reaproveita Pix vigente do mesmo dia (idempotência defensiva).
 *   3. Caso contrário, chama `asaas-multi-tenant.createPixForInvoice` que:
 *      - decifra a apiKey do provider
 *      - cria/recupera customer no Asaas
 *      - cria a cobrança Pix dinâmica
 *      - persiste em `pix_charges`
 *   4. Retorna `{asaasPaymentId, qrCodeBase64, copyPaste}` para o agente.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../logger";
import { customers, invoices, providers } from "@shared/schema";
import { storage } from "../../storage";
import { createPixForInvoice } from "../../services/asaas-multi-tenant";

export const gerarPixBrunoTool: Tool = {
  name: "gerar_pix_dinamico",
  description:
    "Cria (ou recupera) uma cobrança Pix dinâmica no Asaas do provedor para uma fatura específica do cliente. Retorna QR Code base64 + copia-e-cola. Idempotente por (providerId, invoiceId, dia).",
  input_schema: {
    type: "object",
    properties: {
      invoiceId: { type: "integer", description: "ID interno da fatura (não o número formatado)" },
      value: { type: "number", description: "Valor em reais (ex: 149.90)" },
      dueDate: { type: "string", description: "Data de vencimento YYYY-MM-DD" },
    },
    required: ["invoiceId", "value", "dueDate"],
  },
};

export interface GerarPixBrunoArgs {
  invoiceId: number;
  value: number;
  dueDate: string;
}

export interface GerarPixBrunoResult {
  ok: boolean;
  asaasPaymentId?: string;
  qrCodeBase64?: string;
  copyPaste?: string;
  pixChargeId?: number;
  error?: string;
  reused?: boolean;
}

export interface GerarPixBrunoContext {
  providerId: number;
  customerId: number;
  /** ID do outbound_attempts reservado pelo scheduler — vira parte do externalReference. */
  attemptId: number;
  correlationId?: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function executeGerarPixBruno(
  ctx: GerarPixBrunoContext,
  rawArgs: unknown,
): Promise<GerarPixBrunoResult> {
  const args = (rawArgs ?? {}) as Partial<GerarPixBrunoArgs>;

  const invoiceId = Number(args.invoiceId);
  const value = Number(args.value);
  const dueDate = String(args.dueDate ?? "");

  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return { ok: false, error: "invoiceId inválido" };
  }
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "value inválido" };
  }
  if (!DATE_REGEX.test(dueDate)) {
    return { ok: false, error: "dueDate deve ser YYYY-MM-DD" };
  }

  // Multi-tenant gate: a fatura + cliente devem pertencer ao provider e bater entre si.
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(
      eq(invoices.id, invoiceId),
      eq(invoices.providerId, ctx.providerId),
      eq(invoices.customerId, ctx.customerId),
    ))
    .limit(1);

  if (!inv) {
    return { ok: false, error: "Fatura não encontrada para este provider/cliente" };
  }

  if (inv.status === "paid") {
    return { ok: false, error: "Fatura já paga — Bruno não deve enviar lembrete" };
  }

  // Idempotência defensiva: já há Pix vigente para esta fatura no mesmo dia?
  try {
    const today = new Date();
    const existing = await storage.pixCharge.byInvoiceAndDay(ctx.providerId, invoiceId, today);
    if (existing && existing.status !== "cancelled" && existing.pixQrCodeBase64 && existing.pixCopyPaste) {
      logger.info(
        {
          action: "bruno_pix_reused",
          providerId: ctx.providerId,
          invoiceId,
          asaasPaymentId: existing.asaasPaymentId,
          correlationId: ctx.correlationId,
        },
        "Bruno reusou Pix vigente do mesmo dia",
      );
      return {
        ok: true,
        reused: true,
        asaasPaymentId: existing.asaasPaymentId,
        qrCodeBase64: existing.pixQrCodeBase64,
        copyPaste: existing.pixCopyPaste,
        pixChargeId: existing.id,
      };
    }
  } catch (err) {
    logger.warn(
      { action: "bruno_pix_lookup_failed", err: (err as Error)?.message, correlationId: ctx.correlationId },
      "Falha ao buscar Pix vigente — seguindo para criar novo",
    );
  }

  // Carrega cliente + provider para os campos exigidos pelo Asaas.
  const [cust] = await db
    .select({
      id: customers.id,
      name: customers.name,
      cpfCnpj: customers.cpfCnpj,
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(and(
      eq(customers.id, ctx.customerId),
      eq(customers.providerId, ctx.providerId),
    ))
    .limit(1);

  if (!cust) {
    return { ok: false, error: "Cliente não encontrado para este provider" };
  }
  if (!cust.cpfCnpj) {
    return { ok: false, error: "Cliente sem CPF/CNPJ — não é possível criar Pix" };
  }

  const [prov] = await db
    .select({ name: providers.name })
    .from(providers)
    .where(eq(providers.id, ctx.providerId))
    .limit(1);

  if (!prov) {
    return { ok: false, error: "Provider não encontrado" };
  }

  try {
    const result = await createPixForInvoice({
      providerId: ctx.providerId,
      invoiceId,
      customerId: cust.id,
      attemptId: ctx.attemptId,
      customerCpfCnpj: cust.cpfCnpj,
      customerName: cust.name,
      customerEmail: cust.email ?? undefined,
      customerPhone: cust.phone ?? undefined,
      invoiceValue: value,
      invoiceDueDate: dueDate,
      providerName: prov.name,
      invoiceNumber: inv.id ? `INV-${inv.id}` : "fatura",
    });

    logger.info(
      {
        action: "bruno_pix_created",
        providerId: ctx.providerId,
        invoiceId,
        asaasPaymentId: result.asaasPaymentId,
        correlationId: ctx.correlationId,
      },
      "Bruno criou Pix dinâmico no Asaas",
    );

    return {
      ok: true,
      asaasPaymentId: result.asaasPaymentId,
      qrCodeBase64: result.qrCodeBase64,
      copyPaste: result.copyPaste,
      pixChargeId: result.pixCharge.id,
    };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    logger.error(
      {
        action: "bruno_pix_failed",
        providerId: ctx.providerId,
        invoiceId,
        err: msg,
        correlationId: ctx.correlationId,
      },
      "Falha ao criar Pix no Asaas",
    );
    return { ok: false, error: msg };
  }
}
