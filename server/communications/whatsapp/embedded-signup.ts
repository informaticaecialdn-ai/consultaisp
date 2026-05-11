/**
 * Spec 003 — Meta WhatsApp Embedded Signup (OAuth flow)
 *
 * 1. Provedor clica "Conectar WhatsApp" no painel.
 * 2. GET /auth/whatsapp/initiate?providerId=X  → redireciona pra Meta dialog.
 * 3. Provedor autoriza e Meta redireciona pra /auth/whatsapp/callback?code=...&state=...
 * 4. Trocamos `code` por short-lived token → busca WABA → busca phone number
 *    → exchange para long-lived token (60d) → salva criptografado.
 * 5. Subscreve webhook do app no WABA: POST /{wabaId}/subscribed_apps.
 *
 * Princípio I (multi-tenant): cada provider tem seu próprio WABA + accessToken.
 * Princípio V (LGPD): token salvo via storage.whatsappAccount (AES-256-GCM).
 */

import express, { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import { logger } from "../../logger";
import { WhatsappAccountStorage } from "../../storage/whatsapp-account.storage";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";
const META_OAUTH_DIALOG = "https://www.facebook.com/v19.0/dialog/oauth";
const REQUIRED_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"];
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

interface StateEntry {
  providerId: number;
  createdAt: number;
}

const stateStore = new Map<string, StateEntry>();

/** GC do stateStore — roda a cada 5 min. */
const stateCleanup = setInterval(() => {
  const now = Date.now();
  stateStore.forEach((entry, state) => {
    if (now - entry.createdAt > STATE_TTL_MS) stateStore.delete(state);
  });
}, 5 * 60 * 1000);
stateCleanup.unref();

const whatsappAccountStorage = new WhatsappAccountStorage();

function buildRedirectUri(req: Request): string {
  const configured = process.env.META_OAUTH_REDIRECT_URI;
  if (configured) return configured;
  // Fallback: deriva de req — útil em dev
  const proto = req.protocol;
  const host = req.get("host");
  return `${proto}://${host}/auth/whatsapp/callback`;
}

async function metaGet<T>(path: string, accessToken: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${META_GRAPH_BASE}${path}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const errMsg = (parsed as any)?.error?.message ?? `Meta GET ${res.status}`;
    throw new Error(`Meta API erro em ${path}: ${errMsg}`);
  }
  return parsed as T;
}

async function metaPost<T>(path: string, accessToken: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${META_GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const errMsg = (parsed as any)?.error?.message ?? `Meta POST ${res.status}`;
    throw new Error(`Meta API erro em ${path}: ${errMsg}`);
  }
  return parsed as T;
}

/** Troca `code` por short-lived access token. */
async function exchangeCodeForToken(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn?: number; tokenType?: string }> {
  const params = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
  });
  const res = await fetch(`${META_GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const errMsg = parsed?.error?.message ?? `oauth/access_token ${res.status}`;
    throw new Error(`Falha no OAuth exchange: ${errMsg}`);
  }
  return {
    accessToken: parsed.access_token,
    expiresIn: parsed.expires_in,
    tokenType: parsed.token_type,
  };
}

/** Faz upgrade do short-lived (1h) para long-lived (~60 dias). */
async function exchangeForLongLivedToken(args: {
  shortLivedToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    fb_exchange_token: args.shortLivedToken,
  });
  const res = await fetch(`${META_GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const errMsg = parsed?.error?.message ?? `long-lived exchange ${res.status}`;
    throw new Error(`Falha no long-lived exchange: ${errMsg}`);
  }
  return {
    accessToken: parsed.access_token,
    expiresIn: parsed.expires_in,
  };
}

export function registerWhatsAppOAuthRoutes(): Router {
  const router: Router = express.Router();

  // -------------------------------------------------- INITIATE
  router.get("/auth/whatsapp/initiate", (req: Request, res: Response): void => {
    const t0 = Date.now();
    const providerIdRaw = req.query.providerId;
    const sessionProviderId = (req as any).session?.providerId as number | undefined;
    const providerId = providerIdRaw !== undefined
      ? Number(providerIdRaw)
      : sessionProviderId;

    if (!providerId || Number.isNaN(providerId)) {
      logger.warn({ action: "whatsapp_oauth_initiate", reason: "missing_provider_id" },
        "providerId ausente");
      res.status(400).json({ error: "providerId obrigatório" });
      return;
    }

    const clientId = process.env.META_APP_ID;
    if (!clientId) {
      logger.error({ action: "whatsapp_oauth_initiate", reason: "missing_app_id" },
        "META_APP_ID não configurado");
      res.status(500).json({ error: "server_misconfigured" });
      return;
    }

    const state = crypto.randomBytes(24).toString("hex");
    stateStore.set(state, { providerId, createdAt: Date.now() });

    const redirectUri = buildRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: REQUIRED_SCOPES.join(","),
      state,
      response_type: "code",
    });
    const dialogUrl = `${META_OAUTH_DIALOG}?${params.toString()}`;

    logger.info({
      tenantId: providerId,
      action: "whatsapp_oauth_initiate",
      latencyMs: Date.now() - t0,
    }, "Redirecionando para Meta dialog");

    res.redirect(dialogUrl);
  });

  // -------------------------------------------------- CALLBACK
  router.get("/auth/whatsapp/callback", async (req: Request, res: Response): Promise<void> => {
    const t0 = Date.now();
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const errorParam = typeof req.query.error === "string" ? req.query.error : undefined;

    if (errorParam) {
      logger.warn({ action: "whatsapp_oauth_callback", error: errorParam },
        "Meta retornou erro no callback");
      res.status(400).json({ error: "oauth_denied", details: errorParam });
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: "missing_code_or_state" });
      return;
    }

    const stateEntry = stateStore.get(state);
    if (!stateEntry) {
      logger.warn({ action: "whatsapp_oauth_callback", reason: "invalid_state" },
        "State token inválido ou expirado");
      res.status(400).json({ error: "invalid_state" });
      return;
    }
    stateStore.delete(state);

    if (Date.now() - stateEntry.createdAt > STATE_TTL_MS) {
      res.status(400).json({ error: "state_expired" });
      return;
    }

    const providerId = stateEntry.providerId;
    const clientId = process.env.META_APP_ID;
    const clientSecret = process.env.META_APP_SECRET;
    if (!clientId || !clientSecret) {
      logger.error({ tenantId: providerId, action: "whatsapp_oauth_callback", reason: "missing_creds" },
        "META_APP_ID / META_APP_SECRET não configurados");
      res.status(500).json({ error: "server_misconfigured" });
      return;
    }

    try {
      const redirectUri = buildRedirectUri(req);

      // 1) Code → short-lived token
      const short = await exchangeCodeForToken({ code, clientId, clientSecret, redirectUri });

      // 2) Short-lived → long-lived (60d)
      const long = await exchangeForLongLivedToken({
        shortLivedToken: short.accessToken,
        clientId,
        clientSecret,
      });
      const accessToken = long.accessToken;
      const tokenExpiresAt = long.expiresIn
        ? new Date(Date.now() + long.expiresIn * 1000)
        : undefined;

      // 3) Descobrir WABAs do usuário
      const wabasRes = await metaGet<{ data?: Array<{ id: string; name?: string }> }>(
        "/me/whatsapp_business_accounts",
        accessToken,
      );
      const waba = wabasRes.data?.[0];
      if (!waba?.id) {
        throw new Error("Nenhum WABA encontrado para a conta");
      }
      const wabaId = waba.id;

      // 4) Descobrir phone number do WABA
      const phonesRes = await metaGet<{
        data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }>;
      }>(`/${wabaId}/phone_numbers`, accessToken);
      const phone = phonesRes.data?.[0];
      if (!phone?.id) {
        throw new Error(`WABA ${wabaId} não tem phone number provisionado`);
      }
      const phoneNumberId = phone.id;
      const displayName = phone.verified_name ?? waba.name;

      // 5) Persistir (criptografado via storage)
      const account = await whatsappAccountStorage.upsertFromOAuth(providerId, {
        wabaId,
        phoneNumberId,
        displayName,
        accessToken,
        tokenExpiresAt,
      });

      // 6) Subscrever webhook do app no WABA
      try {
        await metaPost(`/${wabaId}/subscribed_apps`, accessToken);
        logger.info({ tenantId: providerId, action: "whatsapp_oauth_subscribed", wabaId },
          "App subscrito no WABA");
      } catch (err) {
        // Não fatal — provedor pode subscrever depois manualmente
        logger.warn({
          tenantId: providerId,
          action: "whatsapp_oauth_subscribe_failed",
          wabaId,
          err: (err as Error).message,
        }, "Falha ao subscrever app no WABA — provedor precisará reconectar");
      }

      logger.info({
        tenantId: providerId,
        action: "whatsapp_oauth_callback",
        result: "ok",
        wabaId,
        phoneNumberId,
        accountId: account.id,
        latencyMs: Date.now() - t0,
      }, "Embedded signup concluído");

      // Redireciona pra UI do painel — provedor verá "WhatsApp conectado"
      const successUrl = process.env.META_OAUTH_SUCCESS_REDIRECT
        ?? "/admin?whatsapp=connected";
      res.redirect(successUrl);
    } catch (err) {
      logger.error({
        tenantId: providerId,
        action: "whatsapp_oauth_callback",
        result: "error",
        err: (err as Error).message,
        latencyMs: Date.now() - t0,
      }, "Embedded signup falhou");
      const failUrl = process.env.META_OAUTH_FAIL_REDIRECT
        ?? "/admin?whatsapp=error";
      res.redirect(failUrl);
    }
  });

  return router;
}
