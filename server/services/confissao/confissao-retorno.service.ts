/**
 * O retorno da assinatura (spec §6.3–§6.5): UMA função para o webhook, o
 * worker e o cancelar. Nunca acredita no payload: reconsulta `GET /docs/{token}/`
 * no host do ambiente DA LINHA, com o token do provedor, e só a transição
 * atômica (`WHERE status = 'enviada'`) decide quem grava o evento — webhook e
 * worker chegando juntos não duplicam.
 *
 * Recusa e expiração não são confirmáveis pelo detalhe: ficam "informadas",
 * a confissão segue `enviada`, e o admin conclui pelo cancelar (que prova
 * `deleted`) ou o worker expira pela data limite.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { clienteZapSign, type DocumentoDoZapSign } from "../../assinatura/zapsign";
import { LIMITE_DO_PDF_BYTES } from "../../assinatura/pdf";
import { ErroDeConfissao } from "../../assinatura/erro";
import { registrarEventoDaConfissao, signatariosGravaveis } from "./confissao-emissao.service";
import type { AmbienteDeAssinatura, SignatarioDaConfissao, StatusDeConfissao } from "@shared/cobranca/confissao";
import type { CobrancaConfissao } from "@shared/schema";

export type OrigemDoRetorno = "webhook" | "worker" | "cancelar";
/** `linha` vem preenchida quando ESTE processo aplicou a transição (cancelar devolve-a sem reler). */
export interface ResultadoDoRetorno { status: StatusDeConfissao; mudou: boolean; motivo: string | null; linha?: CobrancaConfissao }

export const RECONSULTA_APOS_FALHA_MS = 10 * 60_000;
export const JANELA_DE_REENVIO_MS = 30 * 60_000;

/** Janela de reenvio por confissão (memória do processo: a API é uma só; o worker não reenvia). */
const ultimoReenvio = new Map<number, number>();
export function _reiniciarJanelasParaTestes(): void { ultimoReenvio.clear(); }

function papeisDe(confissao: CobrancaConfissao): Map<string, "cliente" | "provedor"> {
  const mapa = new Map<string, "cliente" | "provedor">();
  for (const s of (confissao.zapsignSigners as SignatarioDaConfissao[] | null) ?? []) mapa.set(s.token, s.papel);
  return mapa;
}

async function zapDaLinha(providerId: number, confissao: CobrancaConfissao) {
  const cred = await storage.getIntegracaoComCredencial(providerId);
  if (!cred) throw new ErroDeConfissao("NAO_CONFIGURADA", "A integração com o ZapSign não está configurada para este provedor", 409);
  return { zap: clienteZapSign({ apiToken: cred.apiToken, ambiente: confissao.ambiente as AmbienteDeAssinatura }), cred };
}

async function reconsultar(providerId: number, confissao: CobrancaConfissao): Promise<DocumentoDoZapSign> {
  const { zap } = await zapDaLinha(providerId, confissao);
  try {
    return await zap.detalharDocumento(confissao.zapsignDocToken!);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await storage.atualizarConfissao(providerId, confissao.id, { erroUltimo: mensagem, reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    throw e;
  }
}

async function aplicarAssinatura(providerId: number, confissao: CobrancaConfissao, detalhe: DocumentoDoZapSign, signers: SignatarioDaConfissao[]): Promise<ResultadoDoRetorno> {
  const { zap } = await zapDaLinha(providerId, confissao);
  if (!detalhe.signed_file) {
    await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, erroUltimo: "assinado sem arquivo — reconsultar", reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    return { status: "enviada", mudou: false, motivo: "assinado sem arquivo — reconsultar" };
  }
  let bytes: Buffer;
  try {
    bytes = await zap.baixarArquivo(detalhe.signed_file, LIMITE_DO_PDF_BYTES);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, erroUltimo: mensagem, reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    return { status: "enviada", mudou: false, motivo: mensagem };
  }
  await storage.guardarPdf(providerId, confissao.id, "assinado", bytes);
  const assinadaEm = detalhe.signed_at ? new Date(detalhe.signed_at) : new Date();
  const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "assinada", { assinadaEm, zapsignSigners: signers, zapsignSandbox: detalhe.sandbox, erroUltimo: null, reconciliarEm: null });
  if (!linha) return { status: "enviada", mudou: false, motivo: "outro processo aplicou antes" };
  await storage.marcarSubstituidas(providerId, confissao.customerId, confissao.id);
  const sandbox = confissao.ambiente === "sandbox";
  await registrarEventoDaConfissao(providerId, linha, "assinada", null, sandbox ? "Confissão de dívida assinada em AMBIENTE DE TESTES — sem validade jurídica" : `Confissão de dívida assinada eletronicamente — título executivo extrajudicial (CPC 784, III) de R$ ${Number(linha.valorTotal).toFixed(2).replace(".", ",")}`);
  if (!sandbox) await storage.atualizarCasoDeCobranca(providerId, confissao.casoId, { proximaAcao: "título assinado — acompanhar as parcelas confessadas", proximoContatoEm: new Date(Date.now() + 7 * 86_400_000) }, null).catch(err => logger.warn({ err, providerId, confissaoId: confissao.id }, "CONFISSAO follow-up de título assinado não gravado"));
  return { status: "assinada", mudou: true, motivo: null, linha };
}

export async function aplicarRetorno(providerId: number, confissaoId: number, origem: OrigemDoRetorno): Promise<ResultadoDoRetorno> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status !== "enviada") return { status: confissao.status as StatusDeConfissao, mudou: false, motivo: "fora de enviada" };
  if (!confissao.zapsignDocToken) return { status: "enviada", mudou: false, motivo: "sem documento no ZapSign" };
  const detalhe = await reconsultar(providerId, confissao);
  const signers = signatariosGravaveis(detalhe.signers, papeisDe(confissao));
  const sandboxDaLinha = confissao.ambiente === "sandbox";
  if (detalhe.sandbox !== sandboxDaLinha) {
    await storage.atualizarConfissao(providerId, confissao.id, { erroUltimo: "ambiente divergente", zapsignSigners: signers });
    logger.warn({ providerId, confissaoId, origem, sandboxDoZapSign: detalhe.sandbox, ambiente: confissao.ambiente }, "CONFISSAO retorno de outro ambiente — não aplicado");
    return { status: "enviada", mudou: false, motivo: "ambiente divergente" };
  }
  if (detalhe.deleted) {
    const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "cancelada", { encerradaEm: new Date(), zapsignSigners: signers, erroUltimo: null, reconciliarEm: null });
    if (linha) await registrarEventoDaConfissao(providerId, linha, "cancelada", null, "Confissão de dívida apagada na conta ZapSign do provedor");
    return { status: "cancelada", mudou: !!linha, motivo: "apagado no ZapSign", linha: linha ?? undefined };
  }
  if (detalhe.status === "signed") return aplicarAssinatura(providerId, confissao, detalhe, signers);
  await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, reconciliarEm: null, erroUltimo: null, zapsignSandbox: detalhe.sandbox });
  return { status: "enviada", mudou: false, motivo: null };
}

export async function registrarInformadoPeloWebhook(providerId: number, confissaoId: number, tipo: "recusa" | "expiracao", eventType: string): Promise<void> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao || confissao.status !== "enviada") return;
  const jaInformado = tipo === "recusa" ? confissao.recusaInformadaEm : confissao.expiracaoInformadaEm;
  const agora = new Date();
  await storage.atualizarConfissao(providerId, confissaoId, {
    ...(tipo === "recusa" ? { recusaInformadaEm: agora } : { expiracaoInformadaEm: agora }),
    erroUltimo: `${eventType} informado pelo ZapSign — confirme na conta do provedor`,
  });
  if (jaInformado) return;
  if (tipo === "recusa") {
    await registrarEventoDaConfissao(providerId, confissao, "recusa_informada", null, "O ZapSign informou que o cliente recusou a confissão de dívida — confirme na conta e decida o próximo passo");
    await storage.atualizarCasoDeCobranca(providerId, confissao.casoId, { proximaAcao: "cliente recusou a confissão — ligar", proximoContatoEm: agora }, null).catch(() => undefined);
  } else {
    await registrarEventoDaConfissao(providerId, confissao, "expiracao_informada", null, "O ZapSign informou que o prazo de assinatura da confissão expirou");
  }
}

export async function cancelarConfissao(providerId: number, confissaoId: number, userId: number): Promise<CobrancaConfissao> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status === "assinada") throw new ErroDeConfissao("JA_ASSINADA", "O cliente já assinou — uma confissão assinada não se cancela; emita outra se o valor mudou", 409);
  if (confissao.status === "rascunho") {
    const linha = await storage.transicionarConfissao(providerId, confissaoId, "rascunho", "cancelada", { encerradaEm: new Date() });
    if (!linha) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão mudou de estado", 409);
    await registrarEventoDaConfissao(providerId, linha, "cancelada", userId, "Rascunho da confissão de dívida cancelado");
    return linha;
  }
  if (confissao.status !== "enviada") throw new ErroDeConfissao("ESTADO_INVALIDO", `Uma confissão ${confissao.status} não se cancela`, 409);
  const retorno = await aplicarRetorno(providerId, confissaoId, "cancelar");
  if (retorno.status === "assinada") throw new ErroDeConfissao("JA_ASSINADA", "O cliente já assinou — não se cancela", 409);
  if (retorno.status === "cancelada") return retorno.linha ?? (await storage.obterConfissao(providerId, confissaoId))!;
  const { zap } = await zapDaLinha(providerId, confissao);
  await zap.excluirDocumento(confissao.zapsignDocToken!);
  if (confissao.webhookZapsignId) await zap.excluirWebhook(confissao.webhookZapsignId).catch(() => undefined);
  const linha = await storage.transicionarConfissao(providerId, confissaoId, "enviada", "cancelada", { encerradaEm: new Date(), erroUltimo: null, reconciliarEm: null });
  if (!linha) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão mudou de estado durante o cancelamento", 409);
  await registrarEventoDaConfissao(providerId, linha, "cancelada", userId, "Confissão de dívida cancelada antes da assinatura (documento apagado no ZapSign)");
  return linha;
}

export async function reenviarNotificacoes(providerId: number, confissaoId: number): Promise<{ enviados: number; falhas: number }> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status !== "enviada" || !confissao.zapsignDocToken) throw new ErroDeConfissao("ESTADO_INVALIDO", "Só uma confissão aguardando assinatura pode ser reenviada", 409);
  if (confissao.ambiente === "sandbox") throw new ErroDeConfissao("ESTADO_INVALIDO", "Em ambiente de testes nada é enviado ao cliente — copie o link", 409);
  const ultimo = ultimoReenvio.get(confissaoId) ?? 0;
  if (Date.now() - ultimo < JANELA_DE_REENVIO_MS) {
    throw new ErroDeConfissao("REENVIO_CEDO", `Aguarde ${Math.ceil((JANELA_DE_REENVIO_MS - (Date.now() - ultimo)) / 60_000)} min para reenviar`, 429);
  }
  const { zap } = await zapDaLinha(providerId, confissao);
  const r = await zap.reenviarNotificacoes(confissao.zapsignDocToken);
  ultimoReenvio.set(confissaoId, Date.now());
  return r;
}

/** Worker: passada a data limite sem assinatura (reconsultada agora), marca expirada. */
export async function expirarSeVencida(providerId: number, confissaoId: number, hoje: string): Promise<boolean> {
  const retorno = await aplicarRetorno(providerId, confissaoId, "worker");
  if (retorno.status !== "enviada") return false;
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao || confissao.dataLimiteAssinatura >= hoje) return false;
  const linha = await storage.transicionarConfissao(providerId, confissaoId, "enviada", "expirada", { encerradaEm: new Date(), reconciliarEm: null });
  if (!linha) return false;
  await registrarEventoDaConfissao(providerId, linha, "expirada", null, "Prazo de assinatura da confissão de dívida expirado sem assinatura");
  return true;
}
