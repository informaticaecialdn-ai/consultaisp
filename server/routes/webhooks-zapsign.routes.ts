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
export const JANELA_DO_AVISO_DE_RECUSA_MS = 10 * 60_000;
const LIMITE_POR_PROVEDOR = { janelaMs: 60_000, maximo: 60 };

const SEGREDO_FICTICIO = randomBytes(32).toString("base64url");
const ultimaReconsulta = new Map<number, number>();
const contagemPorProvedor = new Map<number, { count: number; resetAt: number }>();
const ultimoAvisoDeRecusa = new Map<number, number>();
export function _reiniciarJanelasParaTestes(): void { ultimaReconsulta.clear(); contagemPorProvedor.clear(); ultimoAvisoDeRecusa.clear(); }

/**
 * O segredo vai no cabeçalho registrado junto com o webhook de cada documento —
 * e ninguém conferiu na API real que o ZapSign o manda de volta. Se ele não
 * mandar, TODO retorno cai aqui no 401 e a volta degrada em silêncio para só a
 * reconciliação (até 6 h; `doc_refused`/`doc_expired` nunca chegam). Este warn
 * é o que torna isso visível num grep de produção — só para integração LIGADA
 * (onde o 401 significa isso; um id qualquer não entra no mapa), no máximo um
 * por provedor a cada 10 min, e nunca com o valor recebido nem o esperado.
 */
function avisarRecusa(providerId: number, cabecalho: string | undefined): void {
  const agora = Date.now();
  for (const [id, quando] of ultimoAvisoDeRecusa) if (agora - quando >= JANELA_DO_AVISO_DE_RECUSA_MS) ultimoAvisoDeRecusa.delete(id);
  if (ultimoAvisoDeRecusa.has(providerId)) return;
  ultimoAvisoDeRecusa.set(providerId, agora);
  const motivo = cabecalho ? "divergente" : "ausente";
  logger.warn({ providerId, motivo }, `[zapsign] webhook recusado: cabeçalho ${CABECALHO_DO_WEBHOOK} ${motivo} — se continuar, o ZapSign não está mandando o cabeçalho; rodar o teste ponta a ponta em sandbox`);
}

function cabecalhoConfere(recebido: string | undefined, esperado: string | null): boolean {
  const a = Buffer.from(recebido ?? "", "utf8");
  const b = Buffer.from(esperado ?? SEGREDO_FICTICIO, "utf8");
  // Comprimentos diferentes também comparam (contra um buffer do mesmo tamanho) para o tempo não denunciar.
  const iguais = a.length === b.length && timingSafeEqual(a, b);
  if (a.length !== b.length) timingSafeEqual(b, b);
  // Segredo vazio NÃO autentica: dois buffers de comprimento zero são "iguais",
  // e a coluna é `text` sem NOT NULL — a única defesa deste endpoint não pode
  // depender de um invariante que mora em outro arquivo.
  return iguais && !!esperado;
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
    if (!cabecalhoConfere(cabecalho, esperado)) {
      res.status(401).json({ message: "Nao autorizado" });
      // Depois da resposta: o 401 sai no mesmo tempo com ou sem integração ligada.
      if (esperado) avisarRecusa(providerId, cabecalho);
      return;
    }
    if (excedeuLimiteDoProvedor(providerId)) return res.status(429).json({ message: "Muitos eventos para este provedor" });

    const parsed = CorpoSchema.safeParse(req.body ?? {});
    const token = parsed.success ? (parsed.data.token ?? parsed.data.doc_token) : undefined;
    if (!parsed.success || !token) return res.status(400).json({ message: "Corpo invalido" });
    const eventType = parsed.data.event_type;
    logger.info({ providerId, eventType, token }, "ZAPSIGN webhook");

    let confissaoId: number | null = null;
    try {
      const confissao = await storage.obterConfissaoPorToken(providerId, token);
      if (!confissao) return res.json({ ok: true, ignorado: true });
      confissaoId = confissao.id;
      if (EVENTOS_INFORMATIVOS.has(eventType)) return res.json({ ok: true });
      if (confissao.status !== "enviada") return res.json({ ok: true, ignorado: "fora de enviada" });
      if (eventType === "doc_refused" || eventType === "doc_expired") {
        await registrarInformadoPeloWebhook(providerId, confissao.id, eventType === "doc_refused" ? "recusa" : "expiracao", eventType);
        return res.json({ ok: true, informado: true });
      }
      const agora = Date.now();
      const ultima = ultimaReconsulta.get(confissao.id) ?? 0;
      if (agora - ultima < JANELA_DE_RECONSULTA_MS) return res.json({ ok: true, ignorado: "dentro da janela" });
      // A cada reconsulta nova, aproveita para varrer entradas já expiradas —
      // sem isso o mapa só cresce (uma confissão nunca mais reconsultada nunca sai dele).
      for (const [id, quando] of ultimaReconsulta) if (agora - quando >= JANELA_DE_RECONSULTA_MS) ultimaReconsulta.delete(id);
      ultimaReconsulta.set(confissao.id, agora);
      const r = await aplicarRetorno(providerId, confissao.id, "webhook");
      return res.json({ ok: true, status: r.status, mudou: r.mudou });
    } catch (e) {
      // A janela de 30 s existe para não martelar o ZapSign, não para engolir a
      // próxima entrega: se a reconsulta falhou, o próximo evento tem de tentar.
      if (confissaoId !== null) ultimaReconsulta.delete(confissaoId);
      if (e instanceof ErroDeConfissao) {
        logger.warn({ providerId, eventType, token, code: e.codigo, erro: e.message }, "ZAPSIGN webhook: reconsulta falhou");
        return res.status(502).json({ message: "Falha ao processar o evento", code: e.codigo });
      }
      logger.error({ providerId, eventType, token, err: e }, "ZAPSIGN webhook falhou");
      return res.status(502).json({ message: "Falha ao processar o evento" });
    }
  });

  return router;
}
