/**
 * Spec 003 — Opt-out WhatsApp ("PARAR")
 *
 * LGPD + Anatel: cliente que diz "PARAR" / "CANCELAR" / "SAIR" deve ser
 * removido de campanhas IMEDIATAMENTE e em caráter PERMANENTE.
 *
 * Princípio V (LGPD): opt-out é direito do titular (LGPD art. 18 II).
 * Princípio I (multi-tenant): opt-out é por (providerId × phoneNumber).
 *   Mesmo número pode estar opt-out no provedor A e ativo no B.
 */

import { logger } from "../../logger";
import { WhatsappOptoutStorage } from "../../storage/whatsapp-optout.storage";
import { createMetaClient } from "./client";

/** Palavras-chave reconhecidas como opt-out. Case-insensitive, palavra inteira. */
const OPT_OUT_KEYWORDS = ["PARAR", "CANCELAR", "PARE", "SAIR", "STOP"];

const optOutStorage = new WhatsappOptoutStorage();

/**
 * Detecta se o texto recebido representa pedido de opt-out.
 *
 * Critérios:
 *  - Case-insensitive
 *  - Palavra inteira (não match em "parar de pagar")
 *  - Aceita pontuação ao redor ("PARAR.", "PARAR!", "PARAR ")
 *
 * Retorna true se qualquer keyword de opt-out aparece como palavra isolada.
 */
export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const cleaned = text.trim();
  if (!cleaned) return false;

  // Regex word boundary + flag i. Inclui acentos opcionais.
  // \b funciona com ASCII; usamos lookarounds com caracteres não-alfanuméricos
  // pra dar segurança com acentos.
  const upper = cleaned.toUpperCase();
  for (const kw of OPT_OUT_KEYWORDS) {
    const re = new RegExp(`(^|[^A-ZÁÉÍÓÚÂÊÔÃÕÇ])${kw}([^A-ZÁÉÍÓÚÂÊÔÃÕÇ]|$)`, "i");
    if (re.test(upper)) return true;
  }
  return false;
}

/**
 * Processa opt-out completo:
 *  1. Marca em whatsapp_optouts (idempotente por unique constraint)
 *  2. Envia confirmação ao cliente (free-form — assume janela 24h ativa,
 *     pois cliente acabou de mandar inbound)
 *
 * Erros em qualquer etapa são logados mas não relançados — o registro
 * em storage é a fonte de verdade legal, e a confirmação é cortesia.
 */
export async function handleOptOut(args: {
  providerId: number;
  phoneNumber: string;
  reason?: string;
}): Promise<{ marked: boolean; confirmationSent: boolean }> {
  const t0 = Date.now();
  let marked = false;
  let confirmationSent = false;

  try {
    await optOutStorage.markOptedOut(
      args.providerId,
      args.phoneNumber,
      args.reason ?? "Cliente solicitou via WhatsApp",
    );
    marked = true;
    logger.info({
      tenantId: args.providerId,
      action: "whatsapp_optout_marked",
      latencyMs: Date.now() - t0,
    }, "Opt-out registrado");
  } catch (err) {
    logger.error({
      tenantId: args.providerId,
      action: "whatsapp_optout_mark_failed",
      err: (err as Error).message,
    }, "Falha ao marcar opt-out");
  }

  try {
    const client = await createMetaClient(args.providerId);
    await client.sendText({
      to: args.phoneNumber,
      text:
        "Recebido. Você foi removido de nossa lista de comunicações automáticas.\n" +
        "Caso queira voltar a receber, basta nos enviar uma mensagem.",
    });
    confirmationSent = true;
    logger.info({
      tenantId: args.providerId,
      action: "whatsapp_optout_confirmed",
      latencyMs: Date.now() - t0,
    }, "Confirmação de opt-out enviada");
  } catch (err) {
    logger.warn({
      tenantId: args.providerId,
      action: "whatsapp_optout_confirm_failed",
      err: (err as Error).message,
    }, "Falha ao enviar confirmação de opt-out — registro já está salvo");
  }

  return { marked, confirmationSent };
}

/** Verifica se um phoneNumber está em opt-out no provedor. */
export async function isOptedOut(providerId: number, phoneNumber: string): Promise<boolean> {
  return optOutStorage.isOptedOut(providerId, phoneNumber);
}
