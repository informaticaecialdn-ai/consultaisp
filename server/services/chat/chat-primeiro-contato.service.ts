import { storage } from "../../storage";
import { logger } from "../../logger";
import {
  lerAutomacaoChat,
  janelaDoChat,
} from "@shared/cobranca/automacao-chat";
import { avaliarCandidatoAoContato } from "@shared/cobranca/elegibilidade-chat";
import { listarCandidatosDoChat, ordenarCandidatosComoOKanban } from "./chat-elegibilidade.service";
import { recusaDefinitivaDoContato } from "./recusa-do-contato";
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

interface Tarefa {
  origem: "preventivo" | "cobranca" | "equipamentos";
  carteira: string | null;
  casoId?: number;
  executar: () => Promise<{ enviado: boolean }>;
  /** Recusa definitiva do chat para este candidato: tira-o da rodada de hoje e deixa a próxima ação no caso. */
  adiar?: (motivo: string) => Promise<void>;
}

/**
 * O caso recusado pelo chat (número sem WhatsApp, telefone inválido) ganha a
 * próxima ação para a equipe — conferir o telefone — e a data de amanhã: sai
 * da elegibilidade de hoje ("Aguardando a data do próximo contato"), aparece
 * no Kanban como agendado com o motivo na linha do tempo, e amanhã volta a
 * concorrer. Não é exclusão permanente: telefone corrigido, contato sai.
 */
async function adiarCasoRecusado(providerId: number, casoId: number, motivo: string, userId: number, inicioDoDia: Date): Promise<void> {
  const amanha = new Date(inicioDoDia.getTime() + 24 * 60 * 60 * 1000);
  await storage.atualizarCasoDeCobranca(providerId, casoId, {
    proximaAcao: "Conferir o telefone/WhatsApp do cliente — contato automático recusado",
    proximoContatoEm: amanha,
  }, userId);
  await storage.registrarEventoDeCobranca(providerId, {
    casoId, userId: null, tipo: "nota", canal: "whatsapp", resultado: "recusado",
    notas: `Contato automático não realizado: ${motivo} Adiado para amanhã; confira o telefone do cliente.`,
  });
}

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
      const candidatos = await listarCandidatosDoChat(
        intg.providerId,
      );
      const etapas = resolverEtapas(politica);
      if (automacao.preventivo && !politica?.pausada && automacao.carteiras.includes("ativo")) {
        await preventivo.prepararPreAvisos(intg.providerId, agora, etapas);
      }
      const preAvisos = automacao.preventivo && !politica?.pausada && automacao.carteiras.includes("ativo")
        ? await preventivo.listarPreAvisosPendentes(intg.providerId, janela.dia) : [];
      // A ordem é a da coluna "A iniciar" do Kanban (pedido do dono, 16/09/2026): clientes
      // ativos antes de ex-clientes, contato vencido antes do sem data, prioridade e valor —
      // não a ordem de criação do caso, que começava pelos ex-clientes mais antigos.
      const cobrancaElegivel = ordenarCandidatosComoOKanban(
        candidatos.cobranca.filter((c) => avaliarCandidatoAoContato(c, automacao.carteiras, etapas, agora).elegivel),
        janela.inicioDoDia,
      );
      const tarefas: Tarefa[] = [
        ...preAvisos.map(p => ({ origem: "preventivo" as const, carteira: "ativo", executar: () => executarPreAviso(intg.providerId, p.id, userId, janela.dia) })),
        ...(automacao.cobranca && !politica?.pausada
          ? cobrancaElegivel.map((c) => ({ origem: "cobranca" as const, carteira: c.carteira, casoId: c.id,
                executar: () => enviarCasoParaCobranca(intg.providerId, c.id, userId),
                adiar: (motivo: string) => adiarCasoRecusado(intg.providerId, c.id, motivo, userId, janela.inicioDoDia) }))
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
        } catch (erro) {
          const recusa = recusaDefinitivaDoContato(erro);
          if (recusa === null) {
            logger.warn(
              { providerId: intg.providerId, origem: tarefa.origem, casoId: tarefa.casoId ?? null, err: erro },
              "Primeiro contato não confirmado; interrompendo a rodada deste provedor",
            );
            break;
          }
          // O chat disse não a ESTE candidato (número sem WhatsApp, telefone inválido): ele sai
          // da rodada de hoje com a próxima ação no caso e a fila segue. Antes a rodada inteira
          // parava aqui — e voltava a parar no mesmo caso a cada minuto (16/09/2026).
          logger.warn(
            { providerId: intg.providerId, origem: tarefa.origem, casoId: tarefa.casoId ?? null, motivo: recusa },
            "Primeiro contato recusado para este candidato; adiado e a rodada segue",
          );
          try {
            await tarefa.adiar?.(recusa);
          } catch (err) {
            logger.warn({ providerId: intg.providerId, casoId: tarefa.casoId ?? null, err }, "Não foi possível adiar o caso recusado");
          }
          continue;
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
