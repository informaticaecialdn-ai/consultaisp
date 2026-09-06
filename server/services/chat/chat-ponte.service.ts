/**
 * A PONTE entre a cobranca/equipamentos daqui e o Chat BullQ de la.
 *
 * Pedido do dono (05/09/2026): "chat para que o usuario consiga enviar e
 * conversar com o cliente que ele vai cobrar ou buscar o equipamento, direto
 * aqui no sistema". Decisao de arquitetura: o Chat BullQ roda a parte e este
 * servico e o unico que fala com ele — uma Organization de la por provedor
 * daqui (criada pela chave de plataforma na primeira vez), um Channel de
 * WhatsApp por numero, e uma conversa por cliente.
 *
 * "Enviar para cobranca" e o gesto do kanban e da ficha: abre (ou reaproveita)
 * a conversa do cliente no WhatsApp do provedor com a primeira mensagem — a
 * acao da etapa da regua, no tom que o DNA sugere — e registra aqui o evento
 * de contato, ligando a conversa ao caso. Dai em diante a conversa vive no
 * inbox do Chat BullQ (o agente de IA faz o primeiro atendimento quando estiver
 * ligado no canal; o funcionario assume de la).
 *
 * Nada de segredo aqui: o token do canal vai direto para o Chat BullQ; o
 * Consulta ISP guarda so ids. Telefone nunca vai para o log.
 */
import { logger } from "../../logger";
import { storage } from "../../storage";
import { ChatBullqClient, normalizarTelefoneParaChat, type Resultado } from "./chat-bullq.client";

export const URL_DO_INBOX_PADRAO = "https://chat.consultaisp.com.br/inbox";

let clienteSingleton: ChatBullqClient | null | undefined;

/** O cliente HTTP, montado do ambiente uma vez. `null` = chat desligado nesta instalacao. */
export function clienteDoChat(): ChatBullqClient | null {
  if (clienteSingleton !== undefined) return clienteSingleton;
  const baseUrl = (process.env.CHAT_BULLQ_URL || "").trim();
  const platformKey = (process.env.CHAT_BULLQ_PLATFORM_KEY || "").trim();
  clienteSingleton = baseUrl && platformKey ? new ChatBullqClient({ baseUrl, platformKey }) : null;
  return clienteSingleton;
}

/** So para os testes. */
export function _usarClienteDoChatParaTestes(c: ChatBullqClient | null | undefined): void {
  clienteSingleton = c;
}

export function urlDoInbox(): string {
  return (process.env.CHAT_BULLQ_INBOX_URL || URL_DO_INBOX_PADRAO).replace(/\/+$/, "");
}

export class ErroDaPonteDoChat extends Error {
  constructor(public readonly codigo: "CHAT_DESLIGADO" | "SEM_CANAL" | "SEM_TELEFONE" | "CASO_NAO_ENCONTRADO" | "CHAT_FALHOU", mensagem: string) {
    super(mensagem);
  }
}

const desligado = () => new ErroDaPonteDoChat("CHAT_DESLIGADO", "O chat nao esta configurado nesta instalacao (CHAT_BULLQ_URL / CHAT_BULLQ_PLATFORM_KEY)");

function falhou<T>(r: Resultado<T>): r is { ok: false; erro: string; status?: number } {
  return !r.ok;
}

export interface EstadoDaIntegracaoDoChat {
  ligado: boolean;
  provisionado: boolean;
  organizationId: string | null;
  /** O e-mail com que a equipe entra no inbox (o owner da organizacao la). */
  ownerEmail: string | null;
  canal: { id: string; nome: string | null } | null;
  /** O agente de cobranca criado na organizacao do provedor, quando existe. */
  agente: { id: string; modelo: string | null } | null;
  status: string | null;
  ultimoErro: string | null;
  inboxUrl: string;
}

export async function estadoDaIntegracao(providerId: number): Promise<EstadoDaIntegracaoDoChat> {
  const ligado = clienteDoChat() !== null;
  const intg = await storage.getIntegracaoDoChat(providerId);
  return {
    ligado,
    provisionado: !!intg,
    organizationId: intg?.organizationId ?? null,
    ownerEmail: intg?.ownerEmail ?? null,
    canal: intg?.canalId ? { id: intg.canalId, nome: intg.canalNome ?? null } : null,
    agente: intg?.agenteId ? { id: intg.agenteId, modelo: typeof (intg.agenteConfig as Record<string, unknown> | null)?.modelo === "string" ? String((intg.agenteConfig as Record<string, unknown>).modelo) : null } : null,
    status: intg?.status ?? null,
    ultimoErro: intg?.ultimoErro ?? null,
    inboxUrl: urlDoInbox(),
  };
}

/**
 * A Organization do provedor no Chat BullQ — criada na primeira vez, pela chave
 * de plataforma, e nunca mais. Idempotente dos dois lados (la por externalId,
 * aqui pela linha unica por provedor).
 */
export async function garantirIntegracao(providerId: number) {
  const cliente = clienteDoChat();
  if (!cliente) throw desligado();
  const existente = await storage.getIntegracaoDoChat(providerId);
  if (existente) return existente;

  const provedor = await storage.getProvider(providerId);
  if (!provedor) throw new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Provedor nao encontrado");
  const slug = `isp-${providerId}`;
  const ownerEmail = (provedor.contactEmail || "").trim().toLowerCase() || `provedor-${providerId}@consultaisp.com.br`;
  const r = await cliente.provisionarOrganizacao({
    name: provedor.tradeName || provedor.name,
    slug,
    ownerEmail,
    ownerName: provedor.tradeName || provedor.name,
    externalId: String(providerId),
  });
  if (falhou(r)) {
    logger.warn({ providerId, erro: r.erro, status: r.status }, "Chat: nao foi possivel provisionar a organizacao do provedor");
    throw new ErroDaPonteDoChat("CHAT_FALHOU", `O chat nao respondeu ao provisionar o provedor: ${r.erro}`);
  }
  return storage.upsertIntegracaoDoChat(providerId, {
    organizationId: r.valor.organizationId,
    slug: r.valor.slug || slug,
    ownerEmail: r.valor.ownerEmail || ownerEmail,
    status: "provisionado",
  });
}

/**
 * O numero de WhatsApp do provedor: cria o canal (Zappfy/Uazapi) na
 * organizacao dele e testa a conexao. O token vai direto para o Chat BullQ.
 */
export async function configurarCanalWhatsapp(providerId: number, dados: { nome: string; token: string; webhookSecret?: string }) {
  const cliente = clienteDoChat();
  if (!cliente) throw desligado();
  const intg = await garantirIntegracao(providerId);
  const criado = await cliente.criarCanalZappfy(intg.organizationId, { nome: dados.nome, token: dados.token, webhookSecret: dados.webhookSecret });
  if (falhou(criado)) {
    await storage.marcarEstadoDaIntegracaoDoChat(providerId, { status: "erro", ultimoErro: criado.erro });
    throw new ErroDaPonteDoChat("CHAT_FALHOU", `O chat recusou o canal: ${criado.erro}`);
  }
  const teste = await cliente.testarCanal(intg.organizationId, criado.valor.id);
  const ok = !falhou(teste) && teste.valor.ok;
  // O Chat BullQ so liga o agente aos canais que EXISTIAM quando ele foi criado.
  // Numero ligado depois do agente precisa do vinculo explicito, senao a IA
  // nunca responde neste canal.
  if (intg.agenteId) {
    const vinculo = await cliente.ligarAgenteAoCanal(intg.organizationId, intg.agenteId, criado.valor.id, "AUTONOMOUS");
    if (falhou(vinculo)) logger.warn({ providerId, erro: vinculo.erro }, "Chat: canal criado, mas o agente de cobranca nao foi ligado a ele");
  }
  const atualizada = await storage.marcarEstadoDaIntegracaoDoChat(providerId, {
    status: ok ? "ativo" : "erro",
    ultimoErro: ok ? null : falhou(teste) ? teste.erro : teste.valor.message ?? "O teste do canal falhou",
    canalId: criado.valor.id,
    canalNome: dados.nome,
  });
  return { integracao: atualizada!, canalOk: ok };
}

/**
 * A senha do inbox: o owner da organizacao e o e-mail de contato do provedor,
 * e a senha e a que o admin escolher — vai direto para o Chat BullQ, nunca
 * fica aqui. E o que deixa a equipe entrar em chat.consultaisp.com.br.
 */
export async function definirSenhaDoInbox(providerId: number, senha: string): Promise<{ ownerEmail: string }> {
  const cliente = clienteDoChat();
  if (!cliente) throw desligado();
  const intg = await garantirIntegracao(providerId);
  const r = await cliente.definirSenhaDoOwner(intg.organizationId, senha);
  if (falhou(r)) throw new ErroDaPonteDoChat("CHAT_FALHOU", `O chat nao aceitou a senha: ${r.erro}`);
  return { ownerEmail: r.valor.ownerEmail || intg.ownerEmail };
}

/* ── O agente de cobranca do provedor (no Chat BullQ) ──────────────────── */

export function urlDaApiDoAgente(): string {
  return (process.env.CHAT_BULLQ_AGENTE_URL || "https://consultaisp.com.br/api/chat-bullq/agente").replace(/\/+$/, "");
}

export function urlDoWebhookDeVolta(): string {
  return (process.env.CHAT_BULLQ_WEBHOOK_URL || "https://consultaisp.com.br/api/webhooks/chat-bullq").replace(/\/+$/, "");
}

/**
 * O prompt do agente de cobranca de um provedor de internet. Curto e de
 * regras: o que ele pode e o que nao pode; os numeros (valor, dias, teto de
 * desconto, parcelas) vem SEMPRE da skill consultarCaso — nunca do texto.
 */
export function promptDoAgenteDeCobranca(nomeProvedor: string): string {
  return [
    `Voce e o assistente de cobranca de ${nomeProvedor}, um provedor de internet. Fala por WhatsApp, em portugues do Brasil, com educacao e objetividade — frases curtas, sem juridiques, sem ameaca, sem exclamacao.`,
    "",
    "O QUE VOCE FAZ: lembra o cliente de uma fatura vencida, entende a situacao dele, oferece o que a politica do provedor permite (a vista com desconto ate o teto, ou parcelado ate o maximo), registra a promessa de pagamento e passa ao atendente humano quando sair do seu alcance.",
    "",
    "REGRAS QUE NAO SE QUEBRAM:",
    "1. Antes de falar de valor, dias de atraso, desconto ou parcelas, chame consultarCaso com o telefone do cliente (o campo Telefone do contexto, so digitos). Use SO os numeros que ela devolver e siga o campo `instrucao` dela ao pe da letra. Se `encontrado` for false, nao cobre nada.",
    "2. Nunca invente valor, boleto, PIX, link, prazo, desconto ou consequencia. Nao diga que o servico sera cortado ou que o nome sera negativado.",
    "3. Nao ofereca desconto acima de `politica.descontoMaxPct` nem mais parcelas que `politica.maxParcelas`. Pedido fora disso: diga que vai encaminhar e chame transferToHuman com o motivo.",
    "4. Quando o cliente confirmar uma data (e o valor, se combinado), repita o combinado, espere o 'sim' e chame registrarPromessa. Nao registre duas vezes.",
    "5. Chame transferToHuman (e registrarTransferencia com o motivo) quando: o cliente pedir uma pessoa; contestar a divida; falar de cancelamento, doenca, desemprego ou luto; pedir algo fora da politica; ou voce nao entender depois de duas tentativas.",
    "6. Uma mensagem por vez; responda o que foi perguntado; nao repita a cobranca inteira a cada resposta. Se o cliente disser que ja pagou, agradeca, peca o comprovante por aqui e transfira ao atendente para conferir.",
    "7. Respeite a lei: sem contato fora do horario comercial, sem expor a divida a terceiros, sem insistir com quem pediu para parar (ai transfira e encerre com educacao).",
    "",
    "COMO FALAR: use o primeiro nome do cliente; agradeca quando ele responder; ofereca ajuda antes de cobrar; ao propor pagamento, uma opcao por vez (primeiro a vista com o desconto permitido, depois o parcelamento). Nunca se apresente como robo nem como pessoa: voce e 'o atendimento de " + nomeProvedor + "'.",
  ].join("\n");
}

function segredoAleatorio(): string {
  return `whs_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Cria (uma vez) o agente de cobranca do provedor no Chat BullQ: a chave do
 * agente (o Consulta ISP guarda so o hash), a tool HTTP apontando para a API
 * do agente aqui, as tres skills, o AiAgent WORKER com o prompt do ISP, o
 * vinculo das skills, e as automacoes que avisam de volta (call_webhook).
 * Idempotente: com `agenteId` gravado, so devolve.
 */
export async function garantirAgenteDeCobranca(providerId: number): Promise<{ agenteId: string; criado: boolean }> {
  const cliente = clienteDoChat();
  if (!cliente) throw desligado();
  const intg = await garantirIntegracao(providerId);
  if (intg.agenteId) return { agenteId: intg.agenteId, criado: false };

  const provedor = await storage.getProvider(providerId);
  const nomeProvedor = provedor?.tradeName || provedor?.name || "seu provedor";
  const { gerarChaveDoAgente, hashDaChave } = await import("./chat-agente.service");
  const chave = gerarChaveDoAgente();
  const webhookSecret = segredoAleatorio();
  // A chave e o segredo primeiro: se o Chat BullQ falhar no meio, o proximo
  // clique recomeca com uma chave nova e nada fica pela metade.
  await storage.guardarAgenteDoChat(providerId, { chaveAgenteHash: hashDaChave(chave), webhookSecret });

  const org = intg.organizationId;
  const falha = (etapa: string, r: { ok: false; erro: string }) => new ErroDaPonteDoChat("CHAT_FALHOU", `O chat nao criou o agente (${etapa}): ${r.erro}`);

  const tool = await cliente.criarTool(org, {
    nome: "Consulta ISP",
    descricao: "API de cobranca do Consulta ISP deste provedor: o caso do cliente pelo telefone, promessa de pagamento e transferencia.",
    httpBaseUrl: urlDaApiDoAgente(),
    httpHeaders: { "x-chave-agente": chave, Accept: "application/json" },
  });
  if (falhou(tool)) throw falha("tool", tool);

  const telefone = { type: "string", description: "Telefone do cliente com DDD, so digitos (ex.: 5543999990000). Copie do campo Telefone do contexto.", minLength: 10, maxLength: 15 };
  const skills = await Promise.all([
    cliente.criarSkill(org, {
      nome: "consultarCaso",
      descricao: "Consulta no Consulta ISP a situacao de cobranca do cliente pelo telefone: valor vencido, dias de atraso, etapa da regua, tom, o que a politica permite e a instrucao do que fazer. Chame SEMPRE antes de falar de valor.",
      categoria: "cobranca",
      promptInstructions: "Use consultarCaso com o telefone do contexto (so digitos). Siga o campo `instrucao` da resposta. Se `encontrado` for false, nao cobre.",
      toolId: tool.valor.id,
      parameters: { type: "object", additionalProperties: false, required: ["telefone"], properties: { telefone } },
      httpMethod: "GET",
      httpPath: "/caso?telefone={{input.telefone}}&conversaId={{ctx.conversationId}}",
      responseMap: { ok: "$.ok", encontrado: "$.encontrado", cliente: "$.cliente", caso: "$.caso", tom: "$.tom", politica: "$.politica", promessaAberta: "$.promessaAberta", instrucao: "$.instrucao" },
    }),
    cliente.criarSkill(org, {
      nome: "registrarPromessa",
      descricao: "Registra no Consulta ISP a promessa de pagamento que o cliente confirmou nesta conversa (data e, se combinado, valor). Chame so depois do 'sim' do cliente.",
      categoria: "cobranca",
      promptInstructions: "Antes de registrarPromessa, repita data e valor e espere o cliente confirmar. Data no formato AAAA-MM-DD. Nao registre a mesma promessa duas vezes.",
      toolId: tool.valor.id,
      parameters: {
        type: "object", additionalProperties: false, required: ["telefone", "dataPrometida"],
        properties: {
          telefone,
          dataPrometida: { type: "string", description: "Data prometida no formato AAAA-MM-DD.", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          valor: { type: "string", description: "Valor prometido em reais, so digitos e ponto (ex.: 149.90). Vazio se nao combinado.", pattern: "^(\\d+(\\.\\d{1,2})?)?$" },
          observacao: { type: "string", description: "Resumo curto do combinado, sem aspas.", maxLength: 200 },
        },
      },
      httpMethod: "POST",
      httpPath: "/promessa",
      httpBodyTemplate: "{\"telefone\":\"{{input.telefone}}\",\"dataPrometida\":\"{{input.dataPrometida}}\",\"valor\":\"{{input.valor}}\",\"observacao\":\"{{input.observacao}}\",\"conversaId\":\"{{ctx.conversationId}}\"}",
      responseMap: { ok: "$.ok", mensagem: "$.mensagem" },
    }),
    cliente.criarSkill(org, {
      nome: "registrarTransferencia",
      descricao: "Registra no caso do Consulta ISP que voce esta passando a conversa ao atendente humano, com o motivo e um resumo. Chame junto com transferToHuman.",
      categoria: "cobranca",
      toolId: tool.valor.id,
      parameters: {
        type: "object", additionalProperties: false, required: ["telefone", "motivo"],
        properties: { telefone, motivo: { type: "string", description: "Por que esta transferindo, em uma frase, sem aspas.", maxLength: 300 }, resumo: { type: "string", description: "O que foi conversado ate aqui, em ate tres frases, sem aspas.", maxLength: 600 } },
      },
      httpMethod: "POST",
      httpPath: "/transferencia",
      httpBodyTemplate: "{\"telefone\":\"{{input.telefone}}\",\"motivo\":\"{{input.motivo}}\",\"resumo\":\"{{input.resumo}}\",\"conversaId\":\"{{ctx.conversationId}}\"}",
      responseMap: { ok: "$.ok", mensagem: "$.mensagem" },
    }),
  ]);
  for (const s of skills) if (falhou(s)) throw falha("skill", s);
  const skillIds = skills.map(s => (s as { ok: true; valor: { id: string } }).valor.id);

  const agente = await cliente.criarAgente(org, {
    name: "Cobrança",
    kind: "WORKER",
    systemPrompt: promptDoAgenteDeCobranca(nomeProvedor),
    modelId: process.env.CHAT_BULLQ_AGENTE_MODELO || "openai/gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 1024,
    capabilities: ["primeiro contato de cobranca", "negociacao dentro da politica", "promessa de pagamento", "transferencia ao atendente"],
  } as never);
  if (falhou(agente)) throw falha("agente", agente);
  const agenteId = (agente.valor as { id: string }).id;

  const ligadas = await cliente.ligarSkillsAoAgente(org, agenteId, skillIds);
  if (falhou(ligadas)) throw falha("skills do agente", ligadas);

  // A volta: o Chat BullQ avisa quando a IA transfere (status muda) e quando alguem assume.
  const acao = [{ type: "call_webhook", params: { url: urlDoWebhookDeVolta(), secret: webhookSecret } }];
  const automacoes = await Promise.all([
    cliente.criarAutomacao(org, { nome: "Consulta ISP · conversa mudou de status", trigger: "CONVERSATION_STATUS_CHANGED", actions: acao }),
    cliente.criarAutomacao(org, { nome: "Consulta ISP · atendente assumiu", trigger: "CONVERSATION_ASSIGNED", actions: acao }),
  ]);
  const automacaoIds = automacoes.map(a => (a.ok ? a.valor.id : null));
  if (automacoes.some(a => !a.ok)) logger.warn({ providerId, erros: automacoes.filter(a => !a.ok).map(a => (a as { erro: string }).erro) }, "Chat: agente criado, mas a automacao de volta falhou (o fork precisa do patch call_webhook)");

  await storage.guardarAgenteDoChat(providerId, { agenteId, agenteConfig: { toolId: tool.valor.id, skillIds, automacaoIds, modelo: process.env.CHAT_BULLQ_AGENTE_MODELO || "openai/gpt-4o-mini", criadoEm: new Date().toISOString() } });
  logger.info({ providerId, agenteId }, "Chat: agente de cobranca criado na organizacao do provedor");
  return { agenteId, criado: true };
}

/** A primeira mensagem da cobranca: a acao da etapa, com nome, valor e dias — sem juridiques. */
export function mensagemDeCobranca(d: { nomeCliente: string; nomeProvedor: string; valor: number; diasAtraso: number; acaoDaEtapa?: string | null }): string {
  const primeiro = d.nomeCliente.trim().split(/\s+/)[0] || "cliente";
  const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(d.valor);
  const atraso = d.diasAtraso > 0 ? ` vencida ha ${d.diasAtraso} dia${d.diasAtraso === 1 ? "" : "s"}` : "";
  const acao = d.acaoDaEtapa?.trim() ? ` ${d.acaoDaEtapa.trim()}` : " Podemos ajudar a regularizar?";
  return `Ola, ${primeiro}! Aqui e ${d.nomeProvedor}. Identificamos uma pendencia de ${valor}${atraso} no seu contrato.${acao} Responda por aqui que a gente resolve junto.`;
}

/** A primeira mensagem da retirada de equipamento. */
export function mensagemDeRecuperacao(d: { nomeCliente: string; nomeProvedor: string; equipamento: string | null }): string {
  const primeiro = d.nomeCliente.trim().split(/\s+/)[0] || "cliente";
  const oque = d.equipamento?.trim() ? `o ${d.equipamento.trim()}` : "o equipamento";
  return `Ola, ${primeiro}! Aqui e ${d.nomeProvedor}. Com o encerramento do contrato, precisamos combinar a retirada d${oque} que ficou com voce. Qual o melhor dia e horario para o tecnico passar? Responda por aqui.`;
}

export interface ConversaAberta {
  conversationId: string;
  reaproveitada: boolean;
  messageId: string | null;
  inboxUrl: string;
}

/**
 * Abre (ou reaproveita) a conversa do cliente e manda o texto. O que amarra
 * tudo e o telefone: e assim que o Chat BullQ identifica o contato.
 */
async function abrirOuMandar(providerId: number, telefone: string | null | undefined, nome: string, texto: string): Promise<{ conversationId: string; messageId: string | null; reaproveitada: boolean; canalId: string }> {
  const cliente = clienteDoChat();
  if (!cliente) throw desligado();
  const intg = await storage.getIntegracaoDoChat(providerId);
  if (!intg?.canalId || intg.status !== "ativo") throw new ErroDaPonteDoChat("SEM_CANAL", "O provedor ainda nao tem um numero de WhatsApp ligado ao chat");
  const fone = normalizarTelefoneParaChat(telefone);
  if (!fone) throw new ErroDaPonteDoChat("SEM_TELEFONE", "O cliente nao tem telefone valido no cadastro");

  const existente = await cliente.buscarConversaPorTelefone(intg.organizationId, fone, intg.canalId);
  if (!falhou(existente) && existente.valor && existente.valor.status !== "CLOSED") {
    const enviada = await cliente.enviarTexto(intg.organizationId, existente.valor.id, texto);
    if (falhou(enviada)) throw new ErroDaPonteDoChat("CHAT_FALHOU", `O chat nao aceitou a mensagem: ${enviada.erro}`);
    return { conversationId: existente.valor.id, messageId: enviada.valor.messageId, reaproveitada: true, canalId: intg.canalId };
  }
  // Com agente de cobranca criado, a conversa nasce com a IA ligada e ele fixado:
  // e o agente que faz o primeiro atendimento quando o cliente responder.
  const nova = await cliente.iniciarConversa(intg.organizationId, {
    canalId: intg.canalId, telefone: fone, nome, texto,
    ...(intg.agenteId ? { aiEnabled: true, activeAgentId: intg.agenteId } : {}),
  });
  if (falhou(nova)) throw new ErroDaPonteDoChat("CHAT_FALHOU", `O chat nao abriu a conversa: ${nova.erro}`);
  return { conversationId: nova.valor.conversationId, messageId: nova.valor.messageId, reaproveitada: false, canalId: intg.canalId };
}

/**
 * O gesto do kanban: manda o caso para o chat. Registra o evento de contato
 * (canal whatsapp), liga a conversa ao caso e, se o caso ainda estava
 * "aberto", passa a "em contato" — e o que a coluna do kanban espera.
 */
export async function enviarCasoParaCobranca(providerId: number, casoId: number, userId: number, texto?: string | null, acaoDaEtapa?: string | null): Promise<ConversaAberta> {
  const caso = await storage.obterCasoDeCobranca(providerId, casoId);
  if (!caso) throw new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Caso nao encontrado");
  const provedor = await storage.getProvider(providerId);
  const nomeProvedor = provedor?.tradeName || provedor?.name || "seu provedor";
  const mensagem = texto?.trim() || mensagemDeCobranca({
    nomeCliente: caso.cliente.nome,
    nomeProvedor,
    valor: caso.valorAtual,
    diasAtraso: caso.cliente.diasAtraso,
    acaoDaEtapa,
  });

  const conversa = await abrirOuMandar(providerId, caso.cliente.telefone, caso.cliente.nome, mensagem);
  await storage.registrarConversaDoChat(providerId, {
    customerId: caso.cliente.id,
    origem: "cobranca",
    casoId: caso.id,
    conversationId: conversa.conversationId,
    canalId: conversa.canalId,
    abertaPorUserId: userId,
    status: "BOT",
  });
  await storage.registrarEventoDeCobranca(providerId, {
    casoId: caso.id,
    userId,
    tipo: "contato",
    canal: "whatsapp",
    resultado: null,
    notas: conversa.reaproveitada ? "Mensagem enviada pelo chat (conversa ja existente)" : "Enviado para cobranca pelo chat",
    metadata: { chat: { conversationId: conversa.conversationId, messageId: conversa.messageId } },
  });
  if (caso.status === "aberto") {
    await storage.atualizarCasoDeCobranca(providerId, caso.id, { status: "em_contato" }, userId);
  }
  logger.info({ providerId, casoId: caso.id, reaproveitada: conversa.reaproveitada }, "Chat: caso enviado para cobranca");
  return { conversationId: conversa.conversationId, reaproveitada: conversa.reaproveitada, messageId: conversa.messageId, inboxUrl: urlDoInbox() };
}

/** O mesmo gesto para a retirada de equipamento. */
export async function enviarRecuperacaoParaChat(providerId: number, recuperacaoId: number, userId: number, texto?: string | null): Promise<ConversaAberta> {
  const casos = await storage.getRecoveryCases(providerId);
  const r = casos.find(c => c.id === recuperacaoId);
  if (!r) throw new ErroDaPonteDoChat("CASO_NAO_ENCONTRADO", "Caso de recuperacao nao encontrado");
  const provedor = await storage.getProvider(providerId);
  const nomeProvedor = provedor?.tradeName || provedor?.name || "seu provedor";
  const equipamento = [r.equipmentType, r.equipmentBrand, r.equipmentModel].filter(Boolean).join(" ") || null;
  const mensagem = texto?.trim() || mensagemDeRecuperacao({ nomeCliente: r.customerName ?? "cliente", nomeProvedor, equipamento });

  const conversa = await abrirOuMandar(providerId, r.customerPhone, r.customerName ?? "cliente", mensagem);
  await storage.registrarConversaDoChat(providerId, {
    customerId: r.customerId,
    origem: "equipamentos",
    recuperacaoId: r.id,
    conversationId: conversa.conversationId,
    canalId: conversa.canalId,
    abertaPorUserId: userId,
    status: "BOT",
  });
  logger.info({ providerId, recuperacaoId: r.id, reaproveitada: conversa.reaproveitada }, "Chat: retirada enviada para o chat");
  return { conversationId: conversa.conversationId, reaproveitada: conversa.reaproveitada, messageId: conversa.messageId, inboxUrl: urlDoInbox() };
}

/** A conversa do caso com as ultimas mensagens — para o 360 e o kanban mostrarem sem sair. */
export async function conversaDoCaso(providerId: number, casoId: number, limite = 20) {
  const vinculo = await storage.getConversaDoChatPorCaso(providerId, casoId);
  if (!vinculo) return null;
  const cliente = clienteDoChat();
  const intg = await storage.getIntegracaoDoChat(providerId);
  let mensagens: Array<{ id: string; direcao: "INBOUND" | "OUTBOUND"; texto: string | null; status: string | null; quem: string | null; em: string }> = [];
  let erro: string | null = null;
  if (cliente && intg) {
    const r = await cliente.listarMensagens(intg.organizationId, vinculo.conversationId, { limit: limite });
    if (falhou(r)) erro = r.erro;
    else mensagens = r.valor.map(m => ({ id: m.id, direcao: m.direction, texto: m.content?.text ?? null, status: m.status ?? null, quem: m.senderName ?? null, em: m.createdAt }));
  }
  return { conversationId: vinculo.conversationId, status: vinculo.status, abertaEm: vinculo.abertaEm, ultimoEventoEm: vinculo.ultimoEventoEm, inboxUrl: urlDoInbox(), mensagens, erro };
}
