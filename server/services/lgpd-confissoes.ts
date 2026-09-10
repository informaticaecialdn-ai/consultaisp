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
 * depois da última mudança, mantendo status, hashes e datas.
 */
import { storage } from "../storage";
import { logger } from "../logger";

export const RETENCAO_SEM_TITULO_DIAS = 90;
export const BASE_LEGAL_DA_PRESERVACAO = "Confissão de dívida assinada em produção é título executivo extrajudicial e é conservada para o exercício regular de direitos em processo (LGPD art. 16, I; art. 7, VI) pelo prazo prescricional de cinco anos (CC art. 206, §5º, I) contado do último vencimento ou da quitação; não é anonimizada por pedido do titular dentro desse prazo.";

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

export async function confissoesDoTitularParaRelatorio(cpf: string): Promise<{ confissoes: ConfissaoNoRelatorio[]; preservadas: ConfissaoNoRelatorio[]; baseLegal: string }> {
  const linhas = await storage.confissoesDoTitular(cpf);
  const confissoes = linhas.map(l => ({
    id: l.id, providerId: l.providerId, status: l.status, valor: l.valorTotal, ambiente: l.ambiente,
    assinadaEm: l.assinadaEm ? l.assinadaEm.toISOString() : null, emitidaEm: l.createdAt ? l.createdAt.toISOString() : null, prazoAssinatura: l.dataLimiteAssinatura,
  }));
  const preservadas = confissoes.filter(c => c.status === "assinada" && c.ambiente === "producao");
  return { confissoes, preservadas, baseLegal: BASE_LEGAL_DA_PRESERVACAO };
}
