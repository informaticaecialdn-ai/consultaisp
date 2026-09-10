/**
 * POST /api/webhooks/zapsign/:providerId — o retorno do ZapSign (spec §6.3).
 *
 * Público, sem HMAC (o ZapSign não assina). O que autentica é o cabeçalho
 * `X-Consulta-ISP-Assinatura`, registrado por DOCUMENTO na emissão, comparado
 * em tempo constante ao `webhook_secret` do provedor — e a um segredo
 * fictício quando não há integração, para não vazar por tempo. Toda recusa é
 * o MESMO 401. Nada do payload vira estado: quem decide é `aplicarRetorno`,
 * que reconsulta o ZapSign. Do corpo só se lê `event_type` e o token.
 */
import { Router } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { storage } from "../storage";
import { logger } from "../logger";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { ErroDeConfissao } from "../assinatura/erro";
import { CABECALHO_DO_WEBHOOK } from "../services/confissao/confissao-emissao.service";
import { aplicarRetorno, registrarInformadoPeloWebhook } from "../services/confissao/confissao-retorno.service";

export const EVENTOS_INFORMATIVOS = new Set(["doc_created", "created_signer", "signature_notification_sent", "doc_read_confirmation", "doc_expiration_alert", "email_bounce", "doc_viewed", "request_signature", "reading_confirmation", "authentication_failure"]);
export const JANELA_DE_RECONSULTA_MS = 30_000;
const LIMITE_POR_PROVEDOR = { janelaMs: 60_000, maximo: 60 };

const SEGREDO_FICTICIO = randomBytes(32).toString("base64url");
const ultimaReconsulta = new Map<number, number>();
const contagemPorProvedor = new Map<number, { count: number; resetAt: number }>();
export function _reiniciarJanelasParaTestes(): void { ultimaReconsulta.clear(); contagemPorProvedor.clear(); }

function cabecalhoConfere(recebido: string | undefined, esperado: string | null): boolean {
  const a = Buffer.from(recebido ?? "", "utf8");
  const b = Buffer.from(esperado ?? SEGREDO_FICTICIO, "utf8");
  // Comprimentos diferentes também comparam (contra um buffer do mesmo tamanho) para o tempo não denunciar.
  const iguais = a.length === b.length && timingSafeEqual(a, b);
  if (a.length !== b.length) timingSafeEqual(b, b);
  return iguais && esperado !== null;
}

function excedeuLimiteDoProvedor(providerId: number): boolean {
  const agora = Date.now();
  const atual = contagemPorProvedor.get(providerId);
  if (!atual || agora >= atual.resetAt) {
    contagemPorProvedor.set(providerId, { count: 1, resetAt: agora + LIMITE_POR_PROVEDOR.janelaMs });
    return false;
  }
  atual.count++;
  return atual.count > LIMITE_POR_PROVEDOR.maximo;
}

const CorpoSchema = z.object({
  event_type: z.string().min(1).max(60),
  token: z.string().min(1).max(200).optional(),
  doc_token: z.string().min(1).max(200).optional(),
}).passthrough();

export function registerWebhooksZapSignRoutes(): Router {
  const router = Router();
  const limitePorIp = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });

  router.post("/api/webhooks/zapsign/:providerId", limitePorIp, async (req, res) => {
    const providerId = Number(req.params.providerId);
    const cabecalho = req.header(CABECALHO_DO_WEBHOOK);
    const integracao = Number.isInteger(providerId) && providerId > 0 ? await storage.webhookSecretDoProvedor(providerId).catch(() => undefined) : undefined;
    const esperado = integracao?.isEnabled ? integracao.webhookSecret : null;
    if (!cabecalhoConfere(cabecalho, esperado)) return res.status(401).json({ message: "Nao autorizado" });
    if (excedeuLimiteDoProvedor(providerId)) return res.status(429).json({ message: "Muitos eventos para este provedor" });

    const parsed = CorpoSchema.safeParse(req.body ?? {});
    const token = parsed.success ? (parsed.data.token ?? parsed.data.doc_token) : undefined;
    if (!parsed.success || !token) return res.status(400).json({ message: "Corpo invalido" });
    const eventType = parsed.data.event_type;
    logger.info({ providerId, eventType, token }, "ZAPSIGN webhook");

    try {
      const confissao = await storage.obterConfissaoPorToken(providerId, token);
      if (!confissao) return res.json({ ok: true, ignorado: true });
      if (EVENTOS_INFORMATIVOS.has(eventType)) return res.json({ ok: true });
      if (confissao.status !== "enviada") return res.json({ ok: true, ignorado: "fora de enviada" });
      if (eventType === "doc_refused" || eventType === "doc_expired") {
        await registrarInformadoPeloWebhook(providerId, confissao.id, eventType === "doc_refused" ? "recusa" : "expiracao", eventType);
        return res.json({ ok: true, informado: true });
      }
      const ultima = ultimaReconsulta.get(confissao.id) ?? 0;
      if (Date.now() - ultima < JANELA_DE_RECONSULTA_MS) return res.json({ ok: true, ignorado: "dentro da janela" });
      ultimaReconsulta.set(confissao.id, Date.now());
      const r = await aplicarRetorno(providerId, confissao.id, "webhook");
      return res.json({ ok: true, status: r.status, mudou: r.mudou });
    } catch (e) {
      if (e instanceof ErroDeConfissao) return res.status(e.http >= 500 ? 502 : e.http).json({ message: e.message, code: e.codigo });
      logger.error({ providerId, eventType, token, err: e }, "ZAPSIGN webhook falhou");
      return res.status(502).json({ message: "Falha ao processar o evento" });
    }
  });

  return router;
}
