/**
 * LGPD da confissão de dívida (spec §8, Retenção).
 *
 * Papéis: provedor = controlador; Consulta ISP = operador; ZapSign = operador
 * contratado pelo provedor. Base legal do tratamento: LGPD art. 7, V
 * (execução de contrato), VI (exercício regular de direitos) e X (proteção do
 * crédito).
 *
 * Retenção: `assinada` em produção é TÍTULO — fica até 5 anos após o último
 * vencimento das parcelas ou a quitação (CC art. 206, §5º, I), e o pedido de
 * exclusão do titular não a anonimiza (LGPD art. 16, I). O resto (rascunho,
 * cancelada, expirada e tudo de sandbox) perde PDFs e dados pessoais 90 dias
 * depois da última mudança, mantendo status, hashes e datas — ou na hora, se o
 * titular pedir a exclusão (`anonimizarConfissoesDoTitular`).
 */
import { storage } from "../storage";
import { logger } from "../logger";
import type { ConfissaoDoTitular } from "../storage/assinatura.storage";

export const RETENCAO_SEM_TITULO_DIAS = 90;
export const BASE_LEGAL_DA_PRESERVACAO = "Confissão de dívida assinada em produção é título executivo extrajudicial e é conservada para o exercício regular de direitos em processo (LGPD art. 16, I; art. 7, VI) pelo prazo prescricional de cinco anos (CC art. 206, §5º, I) contado do último vencimento ou da quitação; não é anonimizada por pedido do titular dentro desse prazo.";
export const MOTIVO_DA_CONFISSAO_EM_ANDAMENTO = "Confissão de dívida aguardando assinatura: o documento está vivo na conta ZapSign do provedor e ainda pode ser assinado — apagá-la no meio deixaria a linha sem dados e a assinatura que viesse depois traria de volta o PDF assinado, com os dados pessoais. Se o prazo vencer ou ela for cancelada, perde os dados pessoais 90 dias depois; se for assinada em produção, passa a ser título e segue a base legal das preservadas.";

/**
 * Status que só existem DEPOIS da assinatura do devedor: `quitada` e
 * `substituida` nascem de `assinada` (TRANSICOES_DE_CONFISSAO) — a linha
 * continua sendo o título que ele assinou.
 */
const STATUS_QUE_PROVAM_A_ASSINATURA = new Set(["assinada", "quitada", "substituida"]);
/** Título = produção (sandbox não tem validade jurídica) com a assinatura provada pelo status. */
export const ehTitulo = (c: { status: string; ambiente: string }) => c.ambiente === "producao" && STATUS_QUE_PROVAM_A_ASSINATURA.has(c.status);
/**
 * `enviada`, em QUALQUER ambiente: o devedor ainda pode assinar — não é título,
 * mas também não é descarte. A de sandbox também: o documento e o webhook
 * seguem vivos no ZapSign, e uma assinatura depois da anonimização baixaria de
 * novo o PDF assinado, com os dados pessoais, para a linha "apagada".
 */
const emAndamento = (c: { status: string; ambiente: string }) => c.status === "enviada";

export async function apagarConfissoesSemTitulo(agora: Date = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - RETENCAO_SEM_TITULO_DIAS * 86_400_000);
  const alvos = await storage.confissoesParaRetencao(limite);
  let apagadas = 0;
  for (const c of alvos) {
    try {
      await storage.anonimizarConfissao(c.providerId, c.id);
      apagadas++;
    } catch (err) {
      logger.error({ err, providerId: c.providerId, confissaoId: c.id }, "[LGPD-RETENTION] confissão não anonimizada");
    }
  }
  if (apagadas > 0) logger.info({ apagadas }, "[LGPD-RETENTION] confissões sem título anonimizadas");
  return apagadas;
}

export interface ConfissaoNoRelatorio { id: number; providerId: number; status: string; valor: number; ambiente: string; assinadaEm: string | null; emitidaEm: string | null; prazoAssinatura: string }

const paraRelatorio = (l: ConfissaoDoTitular): ConfissaoNoRelatorio => ({
  id: l.id, providerId: l.providerId, status: l.status, valor: l.valorTotal, ambiente: l.ambiente,
  assinadaEm: l.assinadaEm ? l.assinadaEm.toISOString() : null, emitidaEm: l.createdAt ? l.createdAt.toISOString() : null, prazoAssinatura: l.dataLimiteAssinatura,
});

export async function confissoesDoTitularParaRelatorio(cpf: string): Promise<{ confissoes: ConfissaoNoRelatorio[]; preservadas: ConfissaoNoRelatorio[]; baseLegal: string }> {
  const confissoes = (await storage.confissoesDoTitular(cpf)).map(paraRelatorio);
  return { confissoes, preservadas: confissoes.filter(ehTitulo), baseLegal: BASE_LEGAL_DA_PRESERVACAO };
}

/**
 * Pedido de EXCLUSÃO do titular: tudo daquele CPF que não é título perde PDFs
 * e dados pessoais agora — em qualquer provedor, o mesmo escopo que o pedido
 * aplica às consultas ISP e SPC. Fica o título (com a base legal) e toda
 * enviada, de qualquer ambiente (documento vivo; ver MOTIVO_DA_CONFISSAO_EM_ANDAMENTO). Antes só
 * se reportava a preservada: rascunho, cancelada e sandbox guardavam nome, CPF,
 * contato, Anexo I e os PDFs até a varredura de 90 dias, apesar do pedido.
 *
 * Uma anonimização que falha PROPAGA: o pedido volta a "pendente" e o
 * processador tenta de novo na próxima hora (o que já foi feito não se refaz —
 * a linha anonimizada perde o CPF e sai da busca), em vez de responder ao
 * titular que apagou o que ficou.
 */
export async function anonimizarConfissoesDoTitular(cpf: string): Promise<{ anonimizadas: number; preservadas: ConfissaoNoRelatorio[]; emAndamento: ConfissaoNoRelatorio[] }> {
  const linhas = await storage.confissoesDoTitular(cpf);
  let anonimizadas = 0;
  for (const l of linhas) {
    if (ehTitulo(l) || emAndamento(l)) continue;
    await storage.anonimizarConfissao(l.providerId, l.id);
    anonimizadas++;
  }
  return { anonimizadas, preservadas: linhas.filter(ehTitulo).map(paraRelatorio), emAndamento: linhas.filter(emAndamento).map(paraRelatorio) };
}
