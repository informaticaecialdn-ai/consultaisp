/**
 * Spec 003 — Meta WhatsApp Cloud API client
 *
 * Cliente fetch-nativo (Node 20) para Graph API v19.0.
 * Cada instância é amarrada a um tenant (1 phoneNumberId / 1 accessToken por provider).
 *
 * Princípio I (multi-tenant): nunca compartilhe instâncias entre tenants.
 * Princípio V (LGPD): tokens decriptografados ficam APENAS em memória dentro do client.
 *
 * Retry/backoff em 429 (rate limit) e 5xx. 4xx (exceto 429) não retenta.
 */

import { logger } from "../../logger";
import { decrypt } from "../../lib/crypto/encryption";
import { WhatsappAccountStorage } from "../../storage/whatsapp-account.storage";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";
const DEFAULT_LANGUAGE = "pt_BR";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export interface MetaClientConfig {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  /** Identifica o tenant nos logs (não é obrigatório no SDK Meta) */
  tenantId?: number | string;
}

export interface SendResult {
  messageId: string;
  status: "sent" | "queued" | "failed";
}

export interface TemplateParam {
  type: "text" | "currency" | "date_time";
  text?: string;
}

export interface InteractiveButton {
  /** ID do botão retornado no webhook quando clicado */
  id: string;
  /** Label exibido (máx 20 chars) */
  title: string;
}

export interface PhoneNumberQuality {
  quality: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  rawScore?: string;
}

/** Erro lançado em falha de chamada à Meta Graph API. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly metaErrorCode?: number,
    public readonly metaErrorSubcode?: number,
    public readonly fbtraceId?: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

interface MetaErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Sanitiza número para formato Meta (apenas dígitos, com DDI Brasil 55 se necessário).
 * Meta aceita E.164 SEM o "+".
 */
function normalizePhone(to: string): string {
  const digits = to.replace(/\D/g, "");
  if (!digits) throw new Error("Telefone vazio");
  // Heurística simples: 10-11 dígitos = celular brasileiro sem DDI → prefixar 55
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class MetaWhatsappClient {
  constructor(private readonly config: MetaClientConfig) {
    if (!config.phoneNumberId) throw new Error("phoneNumberId obrigatório");
    if (!config.accessToken) throw new Error("accessToken obrigatório");
    if (!config.wabaId) throw new Error("wabaId obrigatório");
  }

  // ------------------------------------------------------------ HTTP core

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${META_GRAPH_BASE}${path}`;
    const t0 = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            "Authorization": `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        const text = await res.text();
        let parsed: unknown = undefined;
        if (text) {
          try { parsed = JSON.parse(text); } catch { parsed = text; }
        }

        if (res.ok) {
          logger.debug({
            tenantId: this.config.tenantId,
            action: "meta_api_request",
            method, path, status: res.status,
            latencyMs: Date.now() - t0,
          }, "Meta API OK");
          return parsed as T;
        }

        const errPayload = (parsed && typeof parsed === "object") ? parsed as MetaErrorPayload : {};
        const metaErr = errPayload.error ?? {};
        const errorMessage = metaErr.message ?? `Meta API ${res.status}`;

        // Retry em 429 e 5xx — outros são fatais
        const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
        if (retryable && attempt < MAX_RETRIES) {
          const retryAfterHeader = res.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
          const backoff = retryAfterMs ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
          logger.warn({
            tenantId: this.config.tenantId,
            action: "meta_api_retry",
            method, path, status: res.status, attempt, backoffMs: backoff,
            metaCode: metaErr.code,
          }, "Meta API erro retentável — agendando retry");
          await sleep(backoff);
          continue;
        }

        const err = new MetaApiError(
          errorMessage,
          res.status,
          metaErr.code,
          metaErr.error_subcode,
          metaErr.fbtrace_id,
          parsed,
        );
        logger.error({
          tenantId: this.config.tenantId,
          action: "meta_api_error",
          method, path, status: res.status,
          metaCode: metaErr.code, fbtraceId: metaErr.fbtrace_id,
          latencyMs: Date.now() - t0,
        }, errorMessage);
        throw err;
      } catch (err) {
        if (err instanceof MetaApiError) throw err;
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
          logger.warn({
            tenantId: this.config.tenantId,
            action: "meta_api_network_retry",
            method, path, attempt, backoffMs: backoff,
            err: (err as Error).message,
          }, "Erro de rede — retry");
          await sleep(backoff);
          continue;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new MetaApiError("Falha desconhecida ao chamar Meta API", 0);
  }

  // ------------------------------------------------------------ Send helpers

  /**
   * Envia template HSM aprovado. Único método permitido fora da janela de 24h.
   */
  async sendTemplate(args: {
    to: string;
    templateName: string;
    language?: string;
    params?: TemplateParam[];
  }): Promise<SendResult> {
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(args.to),
      type: "template",
      template: {
        name: args.templateName,
        language: { code: args.language ?? DEFAULT_LANGUAGE },
        ...(args.params && args.params.length > 0
          ? { components: [{ type: "body", parameters: args.params }] }
          : {}),
      },
    };

    const res = await this.request<{ messages?: Array<{ id: string; message_status?: string }> }>(
      "POST",
      `/${this.config.phoneNumberId}/messages`,
      body,
    );

    const msg = res.messages?.[0];
    if (!msg?.id) throw new MetaApiError("Resposta Meta sem messageId", 0);
    return {
      messageId: msg.id,
      status: (msg.message_status as SendResult["status"]) ?? "sent",
    };
  }

  /** Envia texto livre (free-form). Só funciona dentro da janela de 24h após inbound. */
  async sendText(args: { to: string; text: string }): Promise<SendResult> {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(args.to),
      type: "text",
      text: { preview_url: false, body: args.text },
    };

    const res = await this.request<{ messages?: Array<{ id: string; message_status?: string }> }>(
      "POST",
      `/${this.config.phoneNumberId}/messages`,
      body,
    );
    const msg = res.messages?.[0];
    if (!msg?.id) throw new MetaApiError("Resposta Meta sem messageId", 0);
    return {
      messageId: msg.id,
      status: (msg.message_status as SendResult["status"]) ?? "sent",
    };
  }

  /** Envia mensagem interativa com botões (até 3). */
  async sendInteractive(args: {
    to: string;
    body: string;
    buttons: InteractiveButton[];
    footer?: string;
  }): Promise<SendResult> {
    if (args.buttons.length === 0 || args.buttons.length > 3) {
      throw new Error("sendInteractive aceita entre 1 e 3 botões");
    }

    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(args.to),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: args.body },
        action: {
          buttons: args.buttons.map(b => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
        ...(args.footer ? { footer: { text: args.footer } } : {}),
      },
    };

    const res = await this.request<{ messages?: Array<{ id: string; message_status?: string }> }>(
      "POST",
      `/${this.config.phoneNumberId}/messages`,
      payload,
    );
    const msg = res.messages?.[0];
    if (!msg?.id) throw new MetaApiError("Resposta Meta sem messageId", 0);
    return {
      messageId: msg.id,
      status: (msg.message_status as SendResult["status"]) ?? "sent",
    };
  }

  // ------------------------------------------------------------ Read helpers

  /** Lista templates HSM aprovados do WABA. */
  async getTemplates(): Promise<Array<{
    name: string;
    language: string;
    status: string;
    category: string;
    components?: unknown[];
  }>> {
    const res = await this.request<{ data?: any[] }>(
      "GET",
      `/${this.config.wabaId}/message_templates?limit=200`,
    );
    return (res.data ?? []).map(t => ({
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      components: t.components,
    }));
  }

  /** Quality rating do phone number (afeta limites de envio diário). */
  async getPhoneNumberQuality(): Promise<PhoneNumberQuality> {
    const res = await this.request<{ quality_rating?: string }>(
      "GET",
      `/${this.config.phoneNumberId}?fields=quality_rating`,
    );
    const raw = res.quality_rating?.toUpperCase() ?? "UNKNOWN";
    const quality: PhoneNumberQuality["quality"] =
      raw === "GREEN" || raw === "YELLOW" || raw === "RED" ? raw : "UNKNOWN";
    return { quality, rawScore: res.quality_rating };
  }
}

// -------------------------------------------------------------- Factory

const whatsappAccountStorage = new WhatsappAccountStorage();

/**
 * Cria um MetaWhatsappClient pronto para um tenant.
 * Decifra o accessToken e instancia. Lança se tenant não tem WABA configurado.
 */
export async function createMetaClient(providerId: number): Promise<MetaWhatsappClient> {
  const account = await whatsappAccountStorage.findByProviderId(providerId);
  if (!account) {
    throw new MetaApiError(
      `Provider ${providerId} não tem WhatsApp Business Account configurado`,
      404,
    );
  }
  const accessToken = decrypt(account.accessTokenEncrypted);
  return new MetaWhatsappClient({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    wabaId: account.wabaId,
    tenantId: providerId,
  });
}
