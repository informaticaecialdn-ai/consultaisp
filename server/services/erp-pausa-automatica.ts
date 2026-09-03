/**
 * O corte automatico da integracao ERP: 3 falhas seguidas pausam a varredura.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 * Ate aqui, `erp-sync.service.ts` contava as falhas consecutivas e IMPRIMIA um
 * `console.error` quando passavam de tres. Nada desligava. Nenhum conector usa
 * o CircuitBreaker de `server/erp/resilience.ts` (ele so e importado pelo
 * BigData), entao um ERP fora do ar seguia sendo martelado 3x por semana para
 * sempre, e o unico freio era um humano virando `is_enabled` na mao — foi o que
 * aconteceu no incidente da NG em 31/08/2026.
 *
 * Esse humano acabou de deixar de existir do lado do provedor: a configuracao
 * do ERP saiu do painel dele e passou a ser so exibicao. Sem um freio
 * automatico, a base envelheceria em silencio e ninguem com botao na mao
 * saberia disso.
 *
 * ── O que o corte faz, e o que ele nao faz ─────────────────────────────────
 * Pausa (`is_enabled = false`, `status = "pausado_por_falhas"`) e AVISA por
 * e-mail o provedor, que e quem pode consertar o proprio ERP. Nao apaga
 * credencial, nao mexe em dado de cliente e nao religa sozinho: religar passa
 * pelo suporte, porque a credencial hoje so se edita no painel da plataforma.
 *
 * O status separado de um `is_enabled = false` qualquer e o que distingue "o
 * superadmin desligou" de "o sistema desligou por mim".
 */
import { storage } from "../storage";
import { logger } from "../logger";
import { getConnector } from "../erp";
import { avisarProvedor } from "./email-destinatario";
import { sendErpPausadoEmail } from "./email";

/**
 * Tres, e nao uma.
 *
 * Uma falha isolada e ruido de rede — queda de link do provedor, timeout de um
 * ERP que voltou no minuto seguinte. Pausar na primeira transformaria blip em
 * chamado de suporte. Tres seguidas ja e um padrao: e o mesmo limiar que o log
 * de erro usava antes desta versao, agora com consequencia.
 */
export const FALHAS_PARA_PAUSAR = 3;

/**
 * A decisao, isolada do efeito: da para conferi-la sem banco e sem e-mail.
 *
 * `jaPausado` e o que impede o provedor de receber um e-mail por falha para
 * sempre. Uma integracao ja parada nao tem o que pausar de novo.
 */
export function devePausar(falhasSeguidas: number, jaPausado: boolean): boolean {
  if (jaPausado) return false;
  return falhasSeguidas >= FALHAS_PARA_PAUSAR;
}

export interface PausaAvaliada {
  providerId: number;
  erpSource: string;
  providerName: string;
  falhasSeguidas: number;
  /** A integracao ja esta parada (desligada ou com `pausado_por_falhas`). */
  jaPausado: boolean;
  /** A mensagem da ultima falha, para o provedor saber o que procurar. */
  ultimoErro?: string;
}

/** "IXC Soft" em vez de "ixc". Sem conector registrado, o proprio codigo serve. */
function rotuloDoErp(erpSource: string): string {
  return getConnector(erpSource)?.label || erpSource.toUpperCase();
}

/**
 * O aviso ao provedor. NUNCA propaga: o corte ja aconteceu quando ele sai.
 *
 * `avisarProvedor` resolve destinatario, marca e endereco de entrada e engole a
 * falha de envio; o try/catch aqui cobre o resto (provedor sumido, banco fora
 * do ar na leitura do cadastro). Deixar qualquer um dos dois escapar derrubaria
 * o registro do sync — e o registro e o que torna a falha visivel.
 */
async function avisarPausa(args: PausaAvaliada): Promise<void> {
  try {
    const provedor = await storage.getProvider(args.providerId);
    if (!provedor) {
      logger.warn(
        { providerId: args.providerId, erpSource: args.erpSource },
        "[ERPPausa] Integracao pausada de provedor inexistente: aviso nao enviado",
      );
      return;
    }
    await avisarProvedor(provedor, async (para, ctx) => {
      await sendErpPausadoEmail(para, ctx.nome, {
        erp: rotuloDoErp(args.erpSource),
        falhasSeguidas: args.falhasSeguidas,
        ultimoErro: args.ultimoErro,
      }, ctx.marca, ctx.urlBase);
    }, "erp-pausado");
  } catch (err: any) {
    logger.error(
      { providerId: args.providerId, erpSource: args.erpSource, err: err?.message },
      "[ERPPausa] Falha ao preparar o aviso de integracao pausada",
    );
  }
}

/**
 * Aplica o corte quando ele e devido. Chamada pelo `registrar` do sync, dentro
 * do try/catch dele: pausar nao pode derrubar a varredura que a disparou.
 */
export async function avaliarPausaAutomatica(args: PausaAvaliada): Promise<{ pausou: boolean }> {
  if (!devePausar(args.falhasSeguidas, args.jaPausado)) return { pausou: false };

  await storage.pausarPorFalhas(args.providerId, args.erpSource);
  logger.error(
    {
      providerId: args.providerId,
      erpSource: args.erpSource,
      provedor: args.providerName,
      falhasSeguidas: args.falhasSeguidas,
      ultimoErro: args.ultimoErro,
    },
    "[ERPPausa] Integracao PAUSADA por falhas consecutivas — religar so pelo painel da plataforma",
  );

  await avisarPausa(args);
  return { pausou: true };
}
