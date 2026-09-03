import { getCharge, isAsaasConfigured, asaasStatusToLocal } from "./asaas";

/**
 * Confere um pagamento anunciado pelo webhook do Asaas ANTES de liberar
 * credito ou dar fatura por paga.
 *
 * O webhook e um POST publico. O token no header prova que quem chamou conhece
 * o segredo, mas nao prova nada sobre o CONTEUDO: o corpo continua sendo texto
 * que alguem escreveu. Se o valor vier do proprio corpo, um pedido de R$ 500
 * "pago" com value 1 credita 500 creditos por R$ 1.
 *
 * Por isso nada aqui confia no corpo: o id da cobranca e reconsultado na API do
 * Asaas e a resposta dela e que decide. Sao quatro provas, todas necessarias:
 *   1. a cobranca reconsultada aponta para ESTE pedido/fatura
 *      (`externalReference`) — senao um pagamento real de outro cliente
 *      liberaria o pedido de quem forjou o corpo;
 *   2. o id bate com o que foi gravado quando a cobranca nasceu, quando existe;
 *   3. o Asaas diz que esta paga;
 *   4. o valor pago cobre o valor devido.
 *
 * Falha de rede, Asaas fora do ar ou chave ausente tambem recusam: nao liberar
 * um pagamento verdadeiro custa uma retentativa do Asaas; liberar um falso
 * custa credito.
 */

export interface PedidoConferido {
  /** `credit_order_12` ou `invoice_12` — o que a cobranca deve referenciar. */
  referencia: string;
  /** Valor devido, em reais. */
  valorEsperado: number;
  /** Id da cobranca gravado no pedido/fatura, se houver. */
  chargeIdGravado?: string | null;
}

export type Conferencia =
  | { ok: true; valorPago: number; chargeId: string }
  | { ok: false; motivo: string };

/** Centavo de tolerancia: `parseFloat("199.90")` nao e exato em ponto flutuante. */
const TOLERANCIA_REAIS = 0.005;

export async function conferirPagamento(
  paymentDoWebhook: { id?: string; value?: unknown },
  pedido: PedidoConferido,
): Promise<Conferencia> {
  const chargeId = typeof paymentDoWebhook?.id === "string" ? paymentDoWebhook.id.trim() : "";
  if (!chargeId) return { ok: false, motivo: "webhook sem id de cobranca" };

  if (pedido.chargeIdGravado && pedido.chargeIdGravado !== chargeId) {
    return { ok: false, motivo: `cobranca ${chargeId} nao e a que foi gravada (${pedido.chargeIdGravado})` };
  }

  if (!isAsaasConfigured()) {
    return { ok: false, motivo: "Asaas nao configurado: sem como reconsultar a cobranca" };
  }

  let cobranca;
  try {
    cobranca = await getCharge(chargeId);
  } catch (err: any) {
    return { ok: false, motivo: `falha ao reconsultar a cobranca ${chargeId}: ${err?.message ?? "erro desconhecido"}` };
  }

  if (cobranca?.externalReference !== pedido.referencia) {
    return { ok: false, motivo: `cobranca ${chargeId} referencia ${cobranca?.externalReference ?? "nada"}, nao ${pedido.referencia}` };
  }

  if (asaasStatusToLocal(cobranca.status) !== "paid") {
    return { ok: false, motivo: `Asaas nao confirma pagamento da cobranca ${chargeId} (status ${cobranca.status})` };
  }

  const valorPago = Number(cobranca.value);
  if (!Number.isFinite(valorPago)) {
    return { ok: false, motivo: `cobranca ${chargeId} sem valor numerico` };
  }
  if (valorPago + TOLERANCIA_REAIS < pedido.valorEsperado) {
    return {
      ok: false,
      motivo: `valor divergente: Asaas confirma R$ ${valorPago.toFixed(2)} e o devido e R$ ${pedido.valorEsperado.toFixed(2)}`,
    };
  }

  return { ok: true, valorPago, chargeId };
}

/**
 * Acrescenta a recusa as observacoes, sem repetir a mesma linha a cada
 * retentativa do Asaas (que reenvia o mesmo evento por horas).
 */
export function anotarRecusa(notasAtuais: string | null | undefined, motivo: string): string | null {
  const linha = `Webhook Asaas recusado: ${motivo}`;
  const atuais = notasAtuais ?? "";
  if (atuais.includes(linha)) return null;
  return atuais ? `${atuais}\n${linha}` : linha;
}
