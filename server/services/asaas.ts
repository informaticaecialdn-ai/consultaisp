/**
 * Asaas API client.
 *
 * Spec 004: refatorado para aceitar `apiKey` por parâmetro (multi-tenant).
 * Quando `apiKey` não é fornecido, recai no `ASAAS_API_KEY` do env — esta
 * compatibilidade é mantida APENAS para `creditOrders` (cobrança SaaS→provedor
 * da própria plataforma). Para cobranças tenant→cliente-final (Bruno), use
 * `server/services/asaas-multi-tenant.ts` que decifra a chave do provedor.
 */

const PLATFORM_ASAAS_API_KEY = process.env.ASAAS_API_KEY || "";

function detectSandbox(apiKey: string): boolean {
  return apiKey.includes("_hmlg_") || apiKey.includes("_sandbox_") || apiKey.includes("_test_");
}

function baseUrlFor(apiKey: string): string {
  return detectSandbox(apiKey)
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
}

function resolveKey(apiKey?: string): string {
  const key = apiKey ?? PLATFORM_ASAAS_API_KEY;
  if (!key || key.length < 10) {
    throw new Error("Asaas nao configurado. Verifique a chave de API.");
  }
  return key;
}

export function isAsaasConfigured(): boolean {
  return !!PLATFORM_ASAAS_API_KEY && PLATFORM_ASAAS_API_KEY.length > 10;
}

export function getAsaasMode(apiKey?: string): "sandbox" | "production" | "not_configured" {
  const key = apiKey ?? PLATFORM_ASAAS_API_KEY;
  if (!key || key.length < 10) return "not_configured";
  return detectSandbox(key) ? "sandbox" : "production";
}

async function asaasRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: object,
): Promise<any> {
  const url = `${baseUrlFor(apiKey)}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "access_token": apiKey,
      "Content-Type": "application/json",
      "User-Agent": "ConsultaISP/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || data?.message || `Erro Asaas: ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; asaasBody?: unknown };
    err.status = res.status;
    err.asaasBody = data;
    throw err;
  }
  return data;
}

export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  value: number;
  netValue?: number;
  billingType: string;
  status: string;
  dueDate: string;
  description?: string;
  externalReference?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  pixQrCodeId?: string;
  pixKey?: string;
  nossoNumero?: string;
  paymentDate?: string;
}

export async function findOrCreateCustomer(
  params: {
    name: string;
    cpfCnpj: string;
    email?: string;
    phone?: string;
  },
  apiKey?: string,
): Promise<AsaasCustomer> {
  const key = resolveKey(apiKey);
  const existing = await asaasRequest(key, "GET", `/customers?cpfCnpj=${params.cpfCnpj}&limit=1`);
  if (existing.data && existing.data.length > 0) {
    return existing.data[0];
  }
  return await asaasRequest(key, "POST", "/customers", {
    name: params.name,
    cpfCnpj: params.cpfCnpj,
    email: params.email,
    phone: params.phone,
    notificationDisabled: false,
  });
}

export async function createCharge(
  params: {
    customerId: string;
    value: number;
    dueDate: string;
    description: string;
    externalReference?: string;
    billingType?: "BOLETO" | "PIX" | "UNDEFINED";
  },
  apiKey?: string,
): Promise<AsaasPayment> {
  const key = resolveKey(apiKey);
  return await asaasRequest(key, "POST", "/payments", {
    customer: params.customerId,
    billingType: params.billingType || "UNDEFINED",
    value: params.value,
    dueDate: params.dueDate,
    description: params.description,
    externalReference: params.externalReference,
    fine: { value: 2.0 },
    interest: { value: 1.0 },
  });
}

/**
 * Spec 004: cobrança Pix dinâmico (billingType="PIX" fixo).
 * Diferencia-se de `createCharge` por não setar fine/interest (Pix vence e expira;
 * cobranças com encargos são tratadas pela régua pós-vencimento, fora de escopo).
 */
export async function createDynamicPix(
  params: {
    customerId: string;
    value: number;
    dueDate: string;
    description: string;
    externalReference: string;
  },
  apiKey: string,
): Promise<AsaasPayment> {
  return await asaasRequest(apiKey, "POST", "/payments", {
    customer: params.customerId,
    billingType: "PIX",
    value: params.value,
    dueDate: params.dueDate,
    description: params.description,
    externalReference: params.externalReference,
  });
}

export async function getCharge(chargeId: string, apiKey?: string): Promise<AsaasPayment> {
  return await asaasRequest(resolveKey(apiKey), "GET", `/payments/${chargeId}`);
}

export async function cancelCharge(chargeId: string, apiKey?: string): Promise<void> {
  await asaasRequest(resolveKey(apiKey), "DELETE", `/payments/${chargeId}`);
}

export async function getPixQrCode(
  chargeId: string,
  apiKey?: string,
): Promise<{ encodedImage: string; payload: string; expirationDate: string }> {
  return await asaasRequest(resolveKey(apiKey), "GET", `/payments/${chargeId}/pixQrCode`);
}

export async function listCharges(
  params?: {
    customer?: string;
    externalReference?: string;
    status?: string;
    offset?: number;
    limit?: number;
  },
  apiKey?: string,
): Promise<{ data: AsaasPayment[]; totalCount: number }> {
  const qs = new URLSearchParams();
  if (params?.customer) qs.set("customer", params.customer);
  if (params?.externalReference) qs.set("externalReference", params.externalReference);
  if (params?.status) qs.set("status", params.status);
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  qs.set("limit", String(params?.limit || 20));
  return await asaasRequest(resolveKey(apiKey), "GET", `/payments?${qs.toString()}`);
}

/**
 * Valida a chave Asaas chamando /myAccount. Lança erro com message clara.
 * Usado em POST /api/asaas/account (Phase 5).
 */
export async function validateApiKey(apiKey: string): Promise<{ ok: boolean; mode: "sandbox" | "production"; account: any }> {
  const mode = detectSandbox(apiKey) ? "sandbox" : "production";
  const account = await asaasRequest(apiKey, "GET", "/myAccount");
  return { ok: true, mode, account };
}

export async function getBalance(apiKey?: string): Promise<{ balance: number; totalOutstandingCredits?: number }> {
  return await asaasRequest(resolveKey(apiKey), "GET", "/finance/balance");
}

export function asaasStatusToLocal(asaasStatus: string): string {
  const map: Record<string, string> = {
    PENDING: "pending",
    RECEIVED: "paid",
    CONFIRMED: "paid",
    OVERDUE: "overdue",
    REFUNDED: "cancelled",
    RECEIVED_IN_CASH: "paid",
    REFUND_REQUESTED: "cancelled",
    DELETED: "cancelled",
  };
  return map[asaasStatus] || "pending";
}
