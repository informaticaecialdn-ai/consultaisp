/**
 * Spec 008.5 Batch 2 — PII masking helpers.
 *
 * Aplicado por default em respostas das tools MCP. Quando o token tem
 * scope `read_pii` E o caller passa `unmasked: true`, retorna sem
 * mascarar. Caso contrário, sempre mascarado.
 *
 * Padrão de masking alinhado com DESIGN.md §3 e LGPD Art. 6º (princípio
 * da minimização — retorna apenas o necessário pra contexto do agente).
 */

/** Mask CPF/CNPJ: mantém últimos 4 + verificação. "***.***.789-01" */
export function maskCpf(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) {
    // CPF: ***.***.789-01
    return `***.***.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    // CNPJ: **.***.***/0001-89
    return `**.***.***/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return "***";
}

/** Mask nome: primeiro nome + "***". "João Silva Santos" → "João ***" */
export function maskName(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return trimmed;
  return `${trimmed.slice(0, firstSpace)} ***`;
}

/** Mask telefone: mantém últimos 4. "+55 11 98765-4321" → "+55 ** **** -4321" */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const last4 = digits.slice(-4);
  // Detecta DDI 55 (Brasil) — formato típico de cliente final ISP
  if (digits.length >= 12 && digits.startsWith("55")) {
    return `+55 ** **** -${last4}`;
  }
  return `**** ${last4}`;
}

/**
 * Mask endereço: retorna apenas cidade/estado, omite rua/número/CEP.
 * Aceita string solta ou objeto estruturado.
 */
export interface AddressLike {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

export function maskAddress(raw: string | AddressLike | null | undefined): string {
  if (!raw) return "";
  if (typeof raw === "string") {
    // Heurística: tenta extrair cidade/estado se vier no padrão "Rua X, 123 - Bairro - Cidade/UF"
    const match = raw.match(/[—–-]\s*([^,—–-]+?)\s*\/\s*([A-Z]{2})\s*$/);
    if (match) return `${match[1].trim()}/${match[2]}`;
    return "*** (endereço omitido)";
  }
  const city = raw.city?.trim() || "";
  const state = raw.state?.trim() || "";
  if (city && state) return `${city}/${state}`;
  if (city) return city;
  if (state) return state;
  return "*** (endereço omitido)";
}

/** Mask email: "user@example.com" → "u***@example.com" */
export function maskEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const at = raw.indexOf("@");
  if (at <= 1) return raw; // muito curto pra mascarar
  return `${raw[0]}***${raw.slice(at)}`;
}

/**
 * Aplica masking a um cliente normalizado (vide NormalizedErpCustomer
 * em server/erp/types.ts). Retorna cópia com PII masked.
 *
 * Os campos não-PII (totalOverdueAmount, maxDaysOverdue,
 * overdueInvoicesCount, hasUnreturnedEquipment, erpSource) ficam intactos
 * — o agente precisa deles pra raciocínio de cobrança.
 */
export function maskCustomerPii<T extends {
  cpfCnpj?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}>(customer: T): T {
  return {
    ...customer,
    cpfCnpj: customer.cpfCnpj ? maskCpf(customer.cpfCnpj) : customer.cpfCnpj,
    name: customer.name ? maskName(customer.name) : customer.name,
    email: customer.email ? maskEmail(customer.email) : customer.email,
    phone: customer.phone ? maskPhone(customer.phone) : customer.phone,
    address: null,
    addressNumber: null,
    complement: null,
    neighborhood: null,
    cep: null,
    // Mantém city/state pra contexto regional (não é PII direta)
  };
}
