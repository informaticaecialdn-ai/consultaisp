import { storage } from "../../storage";
import { logger } from "../../logger";
import {
  lerAutomacaoChat,
  janelaDoChat,
} from "@shared/cobranca/automacao-chat";
import { orientarContato } from "@shared/cobranca/contato";
import { resolverEtapas } from "@shared/cobranca/regua";
import {
  enviarCasoParaCobranca,
  enviarRecuperacaoParaChat,
} from "./chat-ponte.service";
import { comTravaDoChat } from "./chat-trava";
import { CobrancaPreventivoStorage } from "../../storage/cobranca-preventivo.storage";
import { executarPreAviso } from "./chat-preventivo.service";

let encerrando = false;
let passada: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Só primeiro contato. Nunca recontata quem já tem conversa, nem negocia ou agenda sozinho. */
export async function executarPrimeirosContatos(
  agora = new Date(),
): Promise<void> {
  const inicio = Date.now();
  const integracoes = await storage.integracoesComContatoAutomatico();
  for (const intg of integracoes) {
    if (encerrando) break;
    try { await comTravaDoChat(`agenda:${intg.providerId}`, async () => {
      const atual = await storage.getIntegracaoDoChat(intg.providerId);
      const config = (atual?.agenteConfig ?? {}) as Record<string, unknown>;
      const automacao = lerAutomacaoChat(config.primeiroContato);
      if (!automacao.ligada) return;
      const userId = Number(config.primeiroContatoUserId);
      const equipe = await storage.getUsersByProvider(intg.providerId);
      if (!equipe.some((u) => u.id === userId && u.role === "admin")) return;
      const politica = await storage.getPoliticaDeCobranca(intg.providerId);
      const janela = janelaDoChat(
        agora,
        politica?.janelaContato,
        automacao.diasPausados,
      );
      if (!janela.permitida) return;
      const preventivo = new CobrancaPreventivoStorage();
      const usadosNoDia = async () => (await storage.contatosIniciadosNoDia(intg.providerId, janela.inicioDoDia)) +
        (await preventivo.contatosReservadosNoDia(intg.providerId, janela.dia));
      let restantes = Math.min(
        5,
        automacao.limiteDiario -
          (await usadosNoDia()),
      );
      if (restantes <= 0) return;
      const candidatos = await storage.candidatosAoPrimeiroContato(
        intg.providerId,
      );
      const etapas = resolverEtapas(politica);
      if (automacao.preventivo && !politica?.pausada && automacao.carteiras.includes("ativo")) {
        await preventivo.prepararPreAvisos(intg.providerId, agora, etapas);
      }
      const preAvisos = automacao.preventivo && !politica?.pausada && automacao.carteiras.includes("ativo")
        ? await preventivo.listarPreAvisosPendentes(intg.providerId, janela.dia) : [];
      const tarefas = [
        ...preAvisos.map(p => ({ origem: "preventivo" as const, carteira: "ativo", executar: () => executarPreAviso(intg.providerId, p.id, userId, janela.dia) })),
        ...(automacao.cobranca && !politica?.pausada
          ? candidatos.cobranca
              .filter(
                (c) =>
                  automacao.carteiras.some(
                    (carteira) => carteira === c.carteira,
                  ) &&
                  orientarContato({
                    ...c,
                    diasAtraso: c.diasAtraso ?? 0,
                    etapas,
                  }).automatizavel,
              )
              .map((c) => ({ origem: "cobranca" as const, carteira: c.carteira,
                executar: () => enviarCasoParaCobranca(intg.providerId, c.id, userId) }))
          : []),
        ...(automacao.equipamentos
          ? candidatos.equipamentos.map((c) => ({ origem: "equipamentos" as const, carteira: null,
              executar: () => enviarRecuperacaoParaChat(intg.providerId, c.id, userId) }))
          : []),
      ];
      for (const tarefa of tarefas) {
        if (encerrando || restantes <= 0) break;
        const vigente = await storage.getIntegracaoDoChat(intg.providerId);
        const configVigente = lerAutomacaoChat(
          (vigente?.agenteConfig as Record<string, unknown> | null)
            ?.primeiroContato,
        );
        const horaAtual = new Date(agora.getTime() + Date.now() - inicio);
        const politicaVigente = await storage.getPoliticaDeCobranca(intg.providerId);
        if (janelaDoChat(horaAtual, politicaVigente?.janelaContato, configVigente.diasPausados).dia !== janela.dia) break;
        if (
          !configVigente.ligada ||
          !janelaDoChat(
            horaAtual,
            politicaVigente?.janelaContato,
            configVigente.diasPausados,
          ).permitida
        )
          break;
        if (tarefa.origem === "preventivo") {
          if (!configVigente.preventivo || politicaVigente?.pausada || !configVigente.carteiras.includes("ativo") || !resolverEtapas(politicaVigente).some(e => e.id === "lembrete_pre_vencimento" && e.ativa)) continue;
        } else if (tarefa.origem === "cobranca" ? (!configVigente.cobranca || politicaVigente?.pausada || !configVigente.carteiras.some(c => c === tarefa.carteira)) : !configVigente.equipamentos) continue;
        if (
          (await usadosNoDia()) >= configVigente.limiteDiario
        )
          break;
        try {
          // Conversa reaproveitada (`enviado: false`) = nenhuma mensagem saiu.
          // Contato que não aconteceu não consome a cota do dia.
          const resultado = await tarefa.executar();
          if (resultado.enviado) restantes--;
        } catch {
          logger.warn(
            { providerId: intg.providerId },
            "Primeiro contato não confirmado; interrompendo a rodada deste provedor",
          );
          break;
        }
      }
    }); } catch (err) {
      logger.error({ err, providerId: intg.providerId }, "Falha nos primeiros contatos deste provedor; seguindo para os demais");
    }
  }
}

export function iniciarPrimeirosContatos() {
  if (timer) return;
  encerrando = false;
  timer = setInterval(() => {
    if (passada || encerrando) return;
    passada = executarPrimeirosContatos()
      .catch((err) =>
        logger.error({ err }, "Falha na agenda de primeiros contatos"),
      )
      .finally(() => {
        passada = null;
      });
  }, 60_000);
  timer.unref();
}
export async function pararPrimeirosContatos() {
  encerrando = true;
  if (timer) clearInterval(timer);
  timer = null;
  await passada;
}
