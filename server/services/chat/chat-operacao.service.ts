import { storage } from "../../storage";
import { lerAutomacaoChat, janelaDoChat } from "@shared/cobranca/automacao-chat";
import { avaliarCandidatoAoContato } from "@shared/cobranca/elegibilidade-chat";
import { resolverEtapas } from "@shared/cobranca/regua";
import { autonomiaStorage } from "../../storage/chat-autonomia.storage";
import type { OperacaoChat } from "@shared/chat-operacao";
import { CobrancaPreventivoStorage } from "../../storage/cobranca-preventivo.storage";
import { listarCandidatosDoChat } from "./chat-elegibilidade.service";
import { estadoDoProcessoChat } from "./chat-worker-presenca";
import { listarAgentesDoChat } from "./chat-agentes.service";
import { provedorWhatsapp } from "./chat-templates.service";
import { CATALOGO_DE_AGENTES, type TipoDeAgente } from "@shared/chat-agentes";
import { TemplatesDeAberturaSchema } from "@shared/chat-whatsapp";

/** Só leitura: não cria conversa, não executa LLM e não dispara contato. */
export async function consultarOperacaoChat(providerId: number, agora = new Date()): Promise<OperacaoChat> {
  const [intg, politica, candidatos, processo, autonomia] = await Promise.all([
    storage.getIntegracaoDoChat(providerId), storage.getPoliticaDeCobranca(providerId), listarCandidatosDoChat(providerId), estadoDoProcessoChat(), autonomiaStorage.config(providerId),
  ]);
  const cfg = (intg?.agenteConfig ?? {}) as Record<string, unknown>;
  const automacao = lerAutomacaoChat(cfg.primeiroContato);
  const janela = janelaDoChat(agora, politica?.janelaContato, automacao.diasPausados);
  const [envios, reservados, equipe] = await Promise.all([
    storage.contatosIniciadosNoDia(providerId, janela.inicioDoDia),
    new CobrancaPreventivoStorage().contatosReservadosNoDia(providerId, janela.dia),
    storage.getUsersByProvider(providerId),
  ]);
  const usadosHoje = envios + reservados;
  const bloqueios: string[] = [];
  if (!processo.online) bloqueios.push("Motor de atendimento sem atividade detectada");
  else if (processo.modo === "ensaio") bloqueios.push("Motor em ensaio: nenhum contato será enviado por este processo");
  if (!automacao.ligada) bloqueios.push("Primeiro contato automático desligado");
  if (!automacao.cobranca) bloqueios.push("Cobrança automática desativada");
  if (!intg?.canalId || intg.status !== "ativo") bloqueios.push("WhatsApp ainda não está conectado");
  if (politica?.pausada) bloqueios.push("Política de cobrança pausada");
  if (!janela.permitida) bloqueios.push("Fora do horário ou dos dias permitidos para contato");
  if (usadosHoje >= automacao.limiteDiario) bloqueios.push("Limite diário de contatos atingido");
  if (!equipe.some(u => u.id === Number(cfg.primeiroContatoUserId) && u.role === "admin")) bloqueios.push("Salve a automação com um administrador do provedor");
  const tipos = new Set<TipoDeAgente>();
  if (automacao.cobranca) for (const carteira of automacao.carteiras) tipos.add(carteira === "ativo" ? "cobranca_ativos" : "cobranca_ex_clientes");
  if (automacao.equipamentos) tipos.add("recuperacao_equipamentos");
  if (provedorWhatsapp(cfg) === "DATAFY") {
    // A aprovação e o catálogo continuam sendo verificados no envio; aqui só configuração local.
    if (automacao.preventivo && automacao.carteiras.includes("ativo")) tipos.add("cobranca_ativos");
    const templates = TemplatesDeAberturaSchema.safeParse({ templates: cfg.templatesDatafy ?? {} });
    for (const tipo of tipos) {
      if (!templates.success || !templates.data.templates[tipo]) bloqueios.push(`Configure o template Datafy de “${CATALOGO_DE_AGENTES[tipo].nome}” no Painel do Provedor`);
    }
  } else if (tipos.size) {
    // Esta leitura só interpreta os perfis persistidos; não consulta modelos nem provisiona agentes.
    const { agentes } = await listarAgentesDoChat(providerId);
    for (const tipo of tipos) {
      const a = agentes.find(item => item.tipo === tipo);
      if (!a?.habilitado || !a.id || !a.modelo || a.etapa !== "pronto") bloqueios.push(`Configure e provisione o agente “${CATALOGO_DE_AGENTES[tipo].nome}” antes de iniciar contatos`);
    }
  }
  const carteiras = ["ativo", "ex_cliente"].map(carteira => ({ carteira, pendentes: 0, elegiveis: 0, revisao: 0 }));
  const motivos = new Map<string, number>();
  const etapas = new Map<string, OperacaoChat["etapas"][number]>();
  const catalogo = resolverEtapas(politica);
  for (const c of candidatos.cobranca) {
    const decisao = avaliarCandidatoAoContato(c, automacao.carteiras, catalogo, agora);
    const grupo = carteiras.find(g => g.carteira === c.carteira);
    if (grupo) { grupo.pendentes++; if (decisao.elegivel) grupo.elegiveis++; else grupo.revisao++; }
    if (decisao.motivo) motivos.set(decisao.motivo, (motivos.get(decisao.motivo) ?? 0) + 1);
    if (decisao.elegivel) {
      const etapa = decisao.orientacao.etapa!.rotulo;
      const chave = `${c.carteira}:${etapa}`;
      const item = etapas.get(chave) ?? { carteira: c.carteira!, etapa, agente: decisao.orientacao.agente, quantidade: 0 };
      item.quantidade++; etapas.set(chave, item);
    }
  }
  return { verificadoEm: agora.toISOString(), processo, bloqueios, limiteDiario: automacao.limiteDiario, usadosHoje,
    respostaAutonoma: autonomia.ativa, limitado: candidatos.limitado, carteiras,
    motivos: [...motivos].map(([motivo, quantidade]) => ({ motivo, quantidade })), etapas: [...etapas.values()] };
}
