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
export interface ResultadoDoRetorno { status: StatusDeConfissao; mudou: boolean; motivo: string | null; confirmado: boolean; linha?: CobrancaConfissao }

export const RECONSULTA_APOS_FALHA_MS = 10 * 60_000;
export const JANELA_DE_REENVIO_MS = 30 * 60_000;
export const MOTIVO_CANCELADA_SEM_DOCUMENTO = "documento não encontrado no ZapSign — token trocado ou documento excluído; cancelada sem consulta ao ZapSign";

/** Janela de reenvio por confissão (memória do processo: a API é uma só; o worker não reenvia). */
const ultimoReenvio = new Map<number, number>();
export function _reiniciarJanelasParaTestes(): void { ultimoReenvio.clear(); }
export function _tamanhoDaJanelaDeReenvioParaTestes(): number { return ultimoReenvio.size; }

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
    return { status: "enviada", mudou: false, motivo: "assinado sem arquivo — reconsultar", confirmado: false };
  }
  let bytes: Buffer;
  try {
    bytes = await zap.baixarArquivo(detalhe.signed_file, LIMITE_DO_PDF_BYTES);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, erroUltimo: mensagem, reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    return { status: "enviada", mudou: false, motivo: mensagem, confirmado: false };
  }
  await storage.guardarPdf(providerId, confissao.id, "assinado", bytes);
  const assinadaEm = detalhe.signed_at ? new Date(detalhe.signed_at) : new Date();
  const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "assinada", { assinadaEm, zapsignSigners: signers, zapsignSandbox: detalhe.sandbox, erroUltimo: null, reconciliarEm: null });
  if (!linha) return { status: "enviada", mudou: false, motivo: "outro processo aplicou antes", confirmado: false };
  await storage.marcarSubstituidas(providerId, confissao.customerId, confissao.id, confissao.ambiente as AmbienteDeAssinatura);
  const sandbox = confissao.ambiente === "sandbox";
  const vivo = await registrarEventoDaConfissao(providerId, linha, "assinada", null, sandbox ? "Confissão de dívida assinada em AMBIENTE DE TESTES — sem validade jurídica" : `Confissão de dívida assinada eletronicamente — título executivo extrajudicial (CPC 784, III) de R$ ${Number(linha.valorTotal).toFixed(2).replace(".", ",")}`);
  if (!sandbox && vivo) await storage.atualizarCasoDeCobranca(providerId, confissao.casoId, { proximaAcao: "título assinado — acompanhar as parcelas confessadas", proximoContatoEm: new Date(Date.now() + 7 * 86_400_000) }, null).catch(err => logger.warn({ err, providerId, confissaoId: confissao.id }, "CONFISSAO follow-up de título assinado não gravado"));
  return { status: "assinada", mudou: true, motivo: null, confirmado: true, linha };
}

export async function aplicarRetorno(providerId: number, confissaoId: number, origem: OrigemDoRetorno): Promise<ResultadoDoRetorno> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status !== "enviada") return { status: confissao.status as StatusDeConfissao, mudou: false, motivo: "fora de enviada", confirmado: false };
  if (!confissao.zapsignDocToken) return { status: "enviada", mudou: false, motivo: "sem documento no ZapSign", confirmado: false };
  const detalhe = await reconsultar(providerId, confissao);
  const signers = signatariosGravaveis(detalhe.signers, papeisDe(confissao));
  const sandboxDaLinha = confissao.ambiente === "sandbox";
  if (detalhe.sandbox !== sandboxDaLinha) {
    await storage.atualizarConfissao(providerId, confissao.id, { erroUltimo: "ambiente divergente", zapsignSigners: signers });
    logger.warn({ providerId, confissaoId, origem, sandboxDoZapSign: detalhe.sandbox, ambiente: confissao.ambiente }, "CONFISSAO retorno de outro ambiente — não aplicado");
    return { status: "enviada", mudou: false, motivo: "ambiente divergente", confirmado: false };
  }
  if (detalhe.deleted) {
    const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "cancelada", { encerradaEm: new Date(), zapsignSigners: signers, erroUltimo: null, reconciliarEm: null });
    if (linha) await registrarEventoDaConfissao(providerId, linha, "cancelada", null, "Confissão de dívida apagada na conta ZapSign do provedor");
    return { status: "cancelada", mudou: !!linha, motivo: "apagado no ZapSign", confirmado: !!linha, linha: linha ?? undefined };
  }
  if (detalhe.status === "signed") return aplicarAssinatura(providerId, confissao, detalhe, signers);
  await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, reconciliarEm: null, erroUltimo: null, zapsignSandbox: detalhe.sandbox });
  return { status: "enviada", mudou: false, motivo: null, confirmado: true };
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
    const vivo = await registrarEventoDaConfissao(providerId, confissao, "recusa_informada", null, "O ZapSign informou que o cliente recusou a confissão de dívida — confirme na conta e decida o próximo passo");
    if (vivo) await storage.atualizarCasoDeCobranca(providerId, confissao.casoId, { proximaAcao: "cliente recusou a confissão — ligar", proximoContatoEm: agora }, null).catch(() => undefined);
  } else {
    await registrarEventoDaConfissao(providerId, confissao, "expiracao_informada", null, "O ZapSign informou que o prazo de assinatura da confissão expirou");
  }
}

export interface OpcoesDoCancelamento {
  /**
   * Com a reconsulta em 404, cancela LOCALMENTE (`cancelarSemDocumentoNoZapSign`)
   * em vez de propagar o erro. Depois de uma troca de token, o 404 não prova que
   * o cliente não assinou na conta antiga: abrir mão desse título é decisão
   * explícita do admin, e SÓ a rota de cancelar a confissão
   * (`POST /api/cobranca/confissoes/:id/cancelar`, admin) passa isto. Romper o
   * acordo — que qualquer operador faz — nunca passa, e recebe o erro.
   */
  permitirSemDocumentoNoZapSign?: boolean;
}

export async function cancelarConfissao(providerId: number, confissaoId: number, userId: number, opcoes: OpcoesDoCancelamento = {}): Promise<CobrancaConfissao> {
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
  let retorno: ResultadoDoRetorno;
  try {
    retorno = await aplicarRetorno(providerId, confissaoId, "cancelar");
  } catch (e) {
    if (opcoes.permitirSemDocumentoNoZapSign && e instanceof ErroDeConfissao && e.codigo === "NAO_ENCONTRADA") return cancelarSemDocumentoNoZapSign(providerId, confissao, userId);
    throw e;
  }
  if (retorno.status === "assinada") throw new ErroDeConfissao("JA_ASSINADA", "O cliente já assinou — não se cancela", 409);
  if (retorno.status === "cancelada") return retorno.linha ?? (await storage.obterConfissao(providerId, confissaoId))!;
  if (!retorno.confirmado) throw new ErroDeConfissao("ESTADO_INVALIDO", "Não foi possível confirmar o estado do documento no ZapSign — tente de novo em instantes", 409);
  const { zap } = await zapDaLinha(providerId, confissao);
  await zap.excluirDocumento(confissao.zapsignDocToken!);
  if (confissao.webhookZapsignId) await zap.excluirWebhook(confissao.webhookZapsignId).catch(() => undefined);
  const linha = await storage.transicionarConfissao(providerId, confissaoId, "enviada", "cancelada", { encerradaEm: new Date(), erroUltimo: null, reconciliarEm: null });
  if (!linha) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão mudou de estado durante o cancelamento", 409);
  await registrarEventoDaConfissao(providerId, linha, "cancelada", userId, "Confissão de dívida cancelada antes da assinatura (documento apagado no ZapSign)");
  return linha;
}

/**
 * A reconsulta deu 404: o ZapSign não conhece mais o documento — o superadmin
 * trocou o token para OUTRA conta, ou o ZapSign expurgou. Sem esta saída a
 * linha ficava `enviada` para sempre (a reconciliação tenta sem fim, o expirar
 * e o cancelar passam pela reconsulta) e segurava a vaga de "uma confissão viva
 * por cliente": esse cliente nunca mais teria outra sem update no banco.
 *
 * Só chega aqui quem passa `permitirSemDocumentoNoZapSign` — e só a rota de
 * cancelar a confissão passa, atrás de `exigirAdminDoProvedor`: é a decisão
 * humana e explícita do admin de abrir mão do documento. O DELETE ainda é
 * tentado (se a conta for a certa, apaga) e o 404 dele é tolerado; qualquer
 * outra falha deixa tudo como está.
 */
async function cancelarSemDocumentoNoZapSign(providerId: number, confissao: CobrancaConfissao, userId: number): Promise<CobrancaConfissao> {
  const { zap } = await zapDaLinha(providerId, confissao);
  await zap.excluirDocumento(confissao.zapsignDocToken!).catch(e => {
    if (!(e instanceof ErroDeConfissao && e.codigo === "NAO_ENCONTRADA")) throw e;
  });
  if (confissao.webhookZapsignId) await zap.excluirWebhook(confissao.webhookZapsignId).catch(() => undefined);
  const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "cancelada", { encerradaEm: new Date(), erroUltimo: MOTIVO_CANCELADA_SEM_DOCUMENTO, reconciliarEm: null });
  if (!linha) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão mudou de estado durante o cancelamento", 409);
  logger.warn({ providerId, confissaoId: confissao.id, userId }, "CONFISSAO cancelada pelo admin sem o documento no ZapSign (404)");
  await registrarEventoDaConfissao(providerId, linha, "cancelada", userId, "Confissão de dívida cancelada pelo administrador: o documento não foi encontrado no ZapSign (token trocado ou documento excluído)");
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
  // A cada reenvio, varre as janelas que já passaram — sem isso o mapa só
  // cresce (uma confissão reenviada uma vez nunca mais sairia dele), como era o
  // `ultimaReconsulta` do webhook antes da poda.
  const agora = Date.now();
  for (const [id, quando] of ultimoReenvio) if (agora - quando >= JANELA_DE_REENVIO_MS) ultimoReenvio.delete(id);
  ultimoReenvio.set(confissaoId, agora);
  return r;
}

/**
 * Worker: passada a data limite sem assinatura (reconsultada agora), marca expirada.
 *
 * Um 404 na reconsulta NÃO expira nem cancela nada aqui — propaga, e a linha
 * segue `enviada`. Não "complete" isto com a saída que o cancelar tem: depois
 * de uma troca de token, o 404 não prova que o cliente não assinou na conta
 * antiga, e só um humano pode decidir abrir mão desse título (o admin, pelo
 * cancelar — `cancelarSemDocumentoNoZapSign`).
 */
export async function expirarSeVencida(providerId: number, confissaoId: number, hoje: string): Promise<boolean> {
  const retorno = await aplicarRetorno(providerId, confissaoId, "worker");
  if (retorno.status !== "enviada" || !retorno.confirmado) return false;
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao || confissao.dataLimiteAssinatura >= hoje) return false;
  const linha = await storage.transicionarConfissao(providerId, confissaoId, "enviada", "expirada", { encerradaEm: new Date(), reconciliarEm: null });
  if (!linha) return false;
  await registrarEventoDaConfissao(providerId, linha, "expirada", null, "Prazo de assinatura da confissão de dívida expirado sem assinatura");
  return true;
}
