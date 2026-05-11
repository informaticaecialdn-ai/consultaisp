/**
 * Spec 004 — Wrapper Asaas multi-tenant.
 *
 * Decifra a chave Asaas do provedor (asaas_accounts) e expõe operações
 * Bruno-friendly: createPixForInvoice, cancelPix, getPaymentStatus.
 *
 * Use este wrapper SEMPRE que a cobrança for tenant → cliente-final
 * (Bruno). Para cobranças plataforma → provedor (creditOrders), use
 * funções diretas em `./asaas.ts` que recaem na chave global do env.
 */
import {
  createDynamicPix,
  findOrCreateCustomer,
  getCharge,
  getPixQrCode,
  cancelCharge,
  validateApiKey,
  asaasStatusToLocal,
  type AsaasPayment,
  type AsaasCustomer,
} from "./asaas";
import { storage } from "../storage";
import type { PixCharge } from "@shared/schema";

export interface PixForInvoiceResult {
  pixCharge: PixCharge;
  asaasPaymentId: string;
  qrCodeBase64: string;
  copyPaste: string;
  expiresAt: Date | null;
}

/**
 * Constrói o `externalReference` que carrega tenant + invoice + attempt.
 * Formato: "provider:42:invoice:9876:attempt:551" — parseado de volta no webhook.
 */
export function buildExternalRef(providerId: number, invoiceId: number, attemptId: number): string {
  return `provider:${providerId}:invoice:${invoiceId}:attempt:${attemptId}`;
}

const EXTERNAL_REF_REGEX = /^provider:(\d+):invoice:(\d+):attempt:(\d+)$/;

export function parseExternalReference(ref: string | null | undefined): {
  providerId: number;
  invoiceId: number;
  attemptId: number;
} | null {
  if (!ref) return null;
  const m = ref.match(EXTERNAL_REF_REGEX);
  if (!m) return null;
  return {
    providerId: Number(m[1]),
    invoiceId: Number(m[2]),
    attemptId: Number(m[3]),
  };
}

/**
 * Recupera a chave Asaas do provedor. Lança erro com mensagem clara se não
 * configurado ou revogado.
 */
async function getProviderApiKey(providerId: number): Promise<string> {
  const apiKey = await storage.asaasAccount.getApiKey(providerId);
  if (!apiKey) {
    throw new Error(
      `Provedor ${providerId} não possui chave Asaas configurada ou está revogada. ` +
      `Configure via /api/asaas/account.`,
    );
  }
  return apiKey;
}

/**
 * Cria cobrança Pix dinâmica no Asaas do provedor e persiste em pix_charges.
 *
 * Fluxo:
 *  1. Decifra apiKey do provider
 *  2. findOrCreateCustomer no Asaas do provider (CPF/CNPJ do cliente final)
 *  3. createDynamicPix com externalReference vinculado a invoice+attempt
 *  4. getPixQrCode para obter QR Code base64 + copia-e-cola
 *  5. Persiste pix_charges com tudo cacheado
 */
export async function createPixForInvoice(params: {
  providerId: number;
  invoiceId: number;
  customerId: number;
  attemptId: number;
  customerCpfCnpj: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  invoiceValue: number;
  invoiceDueDate: string; // YYYY-MM-DD
  providerName: string;
  invoiceNumber: string;
}): Promise<PixForInvoiceResult> {
  const apiKey = await getProviderApiKey(params.providerId);

  // 1. Cliente Asaas (idempotente: se já existir com mesmo CPF/CNPJ, retorna)
  const asaasCustomer: AsaasCustomer = await findOrCreateCustomer(
    {
      name: params.customerName,
      cpfCnpj: params.customerCpfCnpj,
      email: params.customerEmail,
      phone: params.customerPhone,
    },
    apiKey,
  );

  // 2. Cobrança Pix dinâmica
  const externalReference = buildExternalRef(
    params.providerId,
    params.invoiceId,
    params.attemptId,
  );
  const payment: AsaasPayment = await createDynamicPix(
    {
      customerId: asaasCustomer.id,
      value: params.invoiceValue,
      dueDate: params.invoiceDueDate,
      description: `Fatura ${params.invoiceNumber} - ${params.providerName}`,
      externalReference,
    },
    apiKey,
  );

  // 3. QR Code (base64 + copia-e-cola)
  const qrCode = await getPixQrCode(payment.id, apiKey);
  const expiresAt = qrCode.expirationDate ? new Date(qrCode.expirationDate) : null;

  // 4. Persiste
  const pixCharge = await storage.pixCharge.create(params.providerId, {
    invoiceId: params.invoiceId,
    customerId: params.customerId,
    asaasPaymentId: payment.id,
    value: String(params.invoiceValue) as any, // numeric col
    dueDate: params.invoiceDueDate as any, // date col
    pixQrCodeBase64: qrCode.encodedImage,
    pixCopyPaste: qrCode.payload,
    pixExpiresAt: expiresAt,
    status: "pending",
  });

  // 5. Touch lastUsedAt
  await storage.asaasAccount.touchLastUsed(params.providerId);

  return {
    pixCharge,
    asaasPaymentId: payment.id,
    qrCodeBase64: qrCode.encodedImage,
    copyPaste: qrCode.payload,
    expiresAt,
  };
}

export async function cancelPix(providerId: number, asaasPaymentId: string): Promise<void> {
  const apiKey = await getProviderApiKey(providerId);
  await cancelCharge(asaasPaymentId, apiKey);
  await storage.pixCharge.updateStatus(asaasPaymentId, "cancelled", { cancelledAt: new Date() });
}

export async function getPaymentStatus(
  providerId: number,
  asaasPaymentId: string,
): Promise<{ asaasStatus: string; localStatus: string; raw: AsaasPayment }> {
  const apiKey = await getProviderApiKey(providerId);
  const raw = await getCharge(asaasPaymentId, apiKey);
  return {
    asaasStatus: raw.status,
    localStatus: asaasStatusToLocal(raw.status),
    raw,
  };
}

/**
 * Valida chave Asaas e detecta sandbox/production. Usado em POST /api/asaas/account.
 * Não persiste nada; apenas confirma que a chave funciona.
 */
export async function validateAndDetectMode(apiKey: string): Promise<{
  mode: "sandbox" | "production";
  account: any;
}> {
  const result = await validateApiKey(apiKey);
  return { mode: result.mode, account: result.account };
}
