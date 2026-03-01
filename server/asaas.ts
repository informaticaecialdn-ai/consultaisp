const ASAAS_API_KEY = process.env.ASAAS_API_KEY || "";
const IS_SANDBOX = ASAAS_API_KEY.includes("_hmlg_") || ASAAS_API_KEY.includes("_sandbox_");
const BASE_URL = IS_SANDBOX
  ? "https://sandbox.asaas.com/api/v3"
  : "https://api.asaas.com/v3";

export function isAsaasConfigured(): boolean {
  return !!ASAAS_API_KEY && ASAAS_API_KEY.length > 10;
}

export function getAsaasMode(): "sandbox" | "production" | "not_configured" {
  if (!isAsaasConfigured()) return "not_configured";
  return IS_SANDBOX ? "sandbox" : "production";
}

async function asaasRequest(method: string, path: string, body?: object): Promise<any> {
  if (!isAsaasConfigured()) {
    throw new Error("Asaas nao configurado. Verifique a chave de API.");
  }
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "access_token": ASAAS_API_KEY,
      "Content-Type": "application/json",
      "User-Agent": "ConsultaISP/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || data?.message || `Erro Asaas: ${res.status}`;
    throw new Error(msg);
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

export async function findOrCreateCustomer(params: {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
}): Promise<AsaasCustomer> {
  const existing = await asaasRequest("GET", `/customers?cpfCnpj=${params.cpfCnpj}&limit=1`);
  if (existing.data && existing.data.length > 0) {
    return existing.data[0];
  }
  return await asaasRequest("POST", "/customers", {
    name: params.name,
    cpfCnpj: params.cpfCnpj,
    email: params.email,
    phone: params.phone,
    notificationDisabled: false,
  });
}

export async function createCharge(params: {
  customerId: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference?: string;
  billingType?: "BOLETO" | "PIX" | "UNDEFINED";
}): Promise<AsaasPayment> {
  return await asaasRequest("POST", "/payments", {
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

export async function getCharge(chargeId: string): Promise<AsaasPayment> {
  return await asaasRequest("GET", `/payments/${chargeId}`);
}

export async function cancelCharge(chargeId: string): Promise<void> {
  await asaasRequest("DELETE", `/payments/${chargeId}`);
}

export async function getPixQrCode(chargeId: string): Promise<{ encodedImage: string; payload: string; expirationDate: string }> {
  return await asaasRequest("GET", `/payments/${chargeId}/pixQrCode`);
}

export async function listCharges(params?: {
  customer?: string;
  externalReference?: string;
  status?: string;
  offset?: number;
  limit?: number;
}): Promise<{ data: AsaasPayment[]; totalCount: number }> {
  const qs = new URLSearchParams();
  if (params?.customer) qs.set("customer", params.customer);
  if (params?.externalReference) qs.set("externalReference", params.externalReference);
  if (params?.status) qs.set("status", params.status);
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  qs.set("limit", String(params?.limit || 20));
  return await asaasRequest("GET", `/payments?${qs.toString()}`);
}

export async function getBalance(): Promise<{ balance: number; totalOutstandingCredits?: number }> {
  return await asaasRequest("GET", "/finance/balance");
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
