/**
 * Os creditos que o plano inclui, concedidos quando a fatura do mes e paga.
 *
 * ── O que existia antes ────────────────────────────────────────────────────
 * `PLAN_CREDITS` era so o que a fatura ESCREVIA. Nada somava aquilo ao saldo:
 * quem creditava era o superadmin, na mao, todo mes, para cada provedor. Na
 * pratica a promessa "N creditos inclusos por mes" ficava por conta da memoria
 * de uma pessoa — e o `pro` estava com zero credito justamente para nao
 * prometer o que o sistema nao cumpria.
 *
 * Decisao do dono em 03/09/2026: o Profissional inclui 30 creditos por mes, e
 * eles entram QUANDO A FATURA E PAGA. Nao quando e gerada: credito antes do
 * dinheiro e credito consumido por quem pode nao pagar.
 *
 * ── A trava contra creditar duas vezes ─────────────────────────────────────
 * Esta funcao NAO decide se a fatura mudou de estado — quem decide e o
 * chamador, e ela so pode ser chamada DENTRO da transicao "nao paga -> paga",
 * que ja e idempotente desde a fase 0 (o webhook do Asaas reentrega o mesmo
 * evento, e o codigo preserva fatura ja paga em vez de reescrever). Fora
 * dessa transicao, dois PAYMENT_RECEIVED do mesmo pagamento dariam 60 creditos
 * por uma fatura de 30.
 *
 * A quantidade sai da FATURA (`ispCreditsIncluded`), nao da tabela de planos:
 * a fatura e a foto do que foi vendido naquele mes. Se o catalogo mudar depois,
 * quem pagou recebe o que estava escrito na conta dele.
 */
import { storage } from "../storage";
import { logger } from "../logger";

/** O minimo da fatura que esta regra precisa. */
export interface FaturaParaCredito {
  id: number;
  providerId: number;
  invoiceNumber?: string | null;
  planAtTime?: string | null;
  ispCreditsIncluded?: number | null;
  spcCreditsIncluded?: number | null;
}

export interface CreditoConcedido {
  concedeu: boolean;
  isp: number;
  spc: number;
  /** Saldo do provedor depois da concessao; null quando nada foi concedido. */
  saldo: number | null;
}

/** Quanto a fatura promete. Negativo ou lixo vira zero — nunca subtrai saldo. */
export function creditosDaFatura(fatura: FaturaParaCredito): { isp: number; spc: number } {
  const positivo = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return { isp: positivo(fatura.ispCreditsIncluded), spc: positivo(fatura.spcCreditsIncluded) };
}

/**
 * Concede o que a fatura declara. Chame SOMENTE dentro da transicao para paga.
 *
 * Nao lanca: a fatura ja foi quitada quando isto roda, e derrubar a rota por
 * uma falha de credito deixaria o pagamento registrado como erro. O que se
 * perde vai para o log com o numero da fatura, que e o que permite corrigir
 * na mao depois.
 */
export async function creditarPlanoDaFatura(fatura: FaturaParaCredito): Promise<CreditoConcedido> {
  const { isp, spc } = creditosDaFatura(fatura);
  if (isp + spc === 0) return { concedeu: false, isp: 0, spc: 0, saldo: null };

  try {
    const provedor = await storage.addCredits(fatura.providerId, isp, spc);
    const saldo = Number(provedor?.ispCredits ?? 0);
    logger.info(
      { providerId: fatura.providerId, fatura: fatura.invoiceNumber ?? fatura.id, plano: fatura.planAtTime, isp, spc, saldo },
      "[creditos] Creditos do plano concedidos pela fatura paga",
    );
    return { concedeu: true, isp, spc, saldo };
  } catch (err: any) {
    logger.error(
      { providerId: fatura.providerId, fatura: fatura.invoiceNumber ?? fatura.id, isp, spc, err: err?.message },
      "[creditos] Falha ao conceder os creditos do plano — a fatura CONTINUA paga, o credito precisa ser lancado a mao",
    );
    return { concedeu: false, isp, spc, saldo: null };
  }
}
