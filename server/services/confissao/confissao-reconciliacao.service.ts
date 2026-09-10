/**
 * Reconciliação das confissões (spec §6.3, último parágrafo; §6.6 "quitada").
 * Só o WORKER a roda (server/worker.ts). Uma passada a cada 10 min cobre
 * `reconciliar_em` vencido; a cada 6 h a passada é completa (toda `enviada`
 * há mais de 1 h). A mesma `aplicarRetorno` do webhook — transição atômica,
 * então webhook e worker não duplicam evento.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { aplicarRetorno, expirarSeVencida } from "./confissao-retorno.service";
import { registrarEventoDaConfissao } from "./confissao-emissao.service";
import type { FaturaDoAnexo, SignatarioDaConfissao } from "@shared/cobranca/confissao";
import type { CobrancaConfissao } from "@shared/schema";

export const PASSADA_CURTA_MS = 10 * 60_000;
export const PASSADA_COMPLETA_MS = 6 * 60 * 60_000;
export const ENVIADA_HA_MAIS_DE_MS = 60 * 60_000;
export const MARCA_AGUARDANDO_PROVEDOR = "aguardando a assinatura do provedor";

export interface ResumoDaReconciliacao { reconsultadas: number; falhas: number; expiradas: number; avisosDeProvedor: number; quitadas: number }

let ultimaCompleta = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let timerDoBoot: ReturnType<typeof setTimeout> | null = null;
let emAndamento = false;
export function _reiniciarReconciliacaoParaTestes(): void {
  ultimaCompleta = 0;
  if (timer) clearInterval(timer);
  if (timerDoBoot) clearTimeout(timerDoBoot);
  timer = null;
  timerDoBoot = null;
  emAndamento = false;
}

const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function avisarProvedorPendente(c: CobrancaConfissao): Promise<boolean> {
  const signers = (c.zapsignSigners as SignatarioDaConfissao[] | null) ?? [];
  const cliente = signers.find(s => s.papel === "cliente");
  const provedor = signers.find(s => s.papel === "provedor");
  if (!cliente || cliente.status !== "signed" || !provedor || provedor.status === "signed") return false;
  if (c.erroUltimo === MARCA_AGUARDANDO_PROVEDOR) return false;
  const integracao = await storage.getIntegracaoComCredencial(c.providerId).catch(() => undefined);
  if (!integracao?.provedorAssina) return false;
  await registrarEventoDaConfissao(c.providerId, c, "aguardando_provedor", null, "O cliente assinou a confissão de dívida; falta a assinatura do representante do provedor");
  await storage.atualizarCasoDeCobranca(c.providerId, c.casoId, { proximaAcao: "falta a assinatura do provedor na confissão — assinar pelo link do ZapSign", proximoContatoEm: new Date() }, null).catch(() => undefined);
  await storage.atualizarConfissao(c.providerId, c.id, { erroUltimo: MARCA_AGUARDANDO_PROVEDOR });
  return true;
}

async function quitarSeCabe(c: CobrancaConfissao): Promise<boolean> {
  let quitada = false;
  if (c.origem === "acordo" && c.negociacaoId) {
    const n = await storage.obterNegociacao(c.providerId, c.negociacaoId);
    quitada = n?.status === "cumprida";
  } else if (c.origem === "saldo_integral" && c.erpSource) {
    const refs = [...new Set(((c.erpFaturas as FaturaDoAnexo[] | null) ?? []).map(f => f.erpRef))];
    if (refs.length === 0) return false;
    const status = await storage.statusDasFaturasPorRef(c.providerId, c.erpSource, refs);
    quitada = refs.every(r => status.get(r) === "paid" || status.get(r) === "baixada_no_erp");
  }
  if (!quitada) return false;
  const linha = await storage.transicionarConfissao(c.providerId, c.id, "assinada", "quitada", { encerradaEm: new Date() });
  if (linha) await registrarEventoDaConfissao(c.providerId, linha, "quitada", null, "Dívida confessada quitada — as parcelas foram pagas");
  return !!linha;
}

export async function rodarReconciliacao(agora: Date = new Date()): Promise<ResumoDaReconciliacao> {
  const resumo: ResumoDaReconciliacao = { reconsultadas: 0, falhas: 0, expiradas: 0, avisosDeProvedor: 0, quitadas: 0 };
  const completa = agora.getTime() - ultimaCompleta >= PASSADA_COMPLETA_MS;
  if (completa) ultimaCompleta = agora.getTime();
  const pendentes = await storage.confissoesParaReconciliar(agora, completa ? ENVIADA_HA_MAIS_DE_MS : null);
  for (const c of pendentes) {
    resumo.reconsultadas++;
    try {
      const r = await aplicarRetorno(c.providerId, c.id, "worker");
      if (r.status === "enviada" && await avisarProvedorPendente(c)) resumo.avisosDeProvedor++;
    } catch (e) {
      resumo.falhas++;
      logger.warn({ providerId: c.providerId, confissaoId: c.id, err: e }, "CONFISSAO reconciliação: reconsulta falhou");
    }
  }
  const hoje = isoDia(agora);
  for (const c of await storage.confissoesParaExpirar(hoje)) {
    try {
      if (await expirarSeVencida(c.providerId, c.id, hoje)) resumo.expiradas++;
    } catch (e) {
      resumo.falhas++;
      logger.warn({ providerId: c.providerId, confissaoId: c.id, err: e }, "CONFISSAO reconciliação: expirar falhou");
    }
  }
  for (const c of await storage.confissoesAssinadasParaQuitacao()) {
    try {
      if (await quitarSeCabe(c)) resumo.quitadas++;
    } catch (e) {
      resumo.falhas++;
      logger.warn({ providerId: c.providerId, confissaoId: c.id, err: e }, "CONFISSAO reconciliação: quitação falhou");
    }
  }
  logger.info(resumo, "CONFISSAO reconciliação concluída");
  return resumo;
}

export function iniciarReconciliacaoDeConfissoes(): void {
  if (timer) return;
  const rodar = () => {
    if (emAndamento) return;
    emAndamento = true;
    rodarReconciliacao().catch(err => logger.warn({ err }, "CONFISSAO reconciliação: passada falhou")).finally(() => { emAndamento = false; });
  };
  timerDoBoot = setTimeout(rodar, 60_000);
  timerDoBoot.unref?.();
  timer = setInterval(rodar, PASSADA_CURTA_MS);
  timer.unref?.();
}
