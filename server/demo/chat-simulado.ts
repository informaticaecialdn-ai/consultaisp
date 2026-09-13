/**
 * O Chat BullQ de mentira da demonstração pública.
 *
 * As telas de conversa (cobrança, ex-cliente, equipamentos) só existem com um
 * chat ligado, e o chat de verdade é o fork NestJS que fala com o WhatsApp.
 * Um visitante anônimo nunca pode alcançá-lo: a conversa simulada nasce e
 * morre AQUI, no processo e no banco local do sandbox — nunca no fork, nunca
 * no WhatsApp.
 *
 * Por que imitar o HTTP em vez de trocar o cliente: `ChatBullqClient` faz toda
 * chamada por `fetchImpl` (base normalizada para `/api/v1`, corpo JSON, `data`
 * desembrulhado, erro = status não-ok com `message`). Entregando a ele este
 * `fetch` local, a demonstração exercita o cliente REAL, com os mesmos
 * formatos de resposta e as mesmas recusas — e um método que alguém
 * acrescente amanhã ao cliente cai no roteador (404 local) em vez de achar a
 * rede. Aqui nada chama `globalThis.fetch` nem lê `CHAT_BULLQ_*`.
 *
 * De onde vem cada coisa:
 * - O HISTÓRICO de uma conversa semeada (`demo-conv-<providerId>-<seq>`) é
 *   montado da linha de `chat_bullq_conversas` + cliente + caso/recuperação,
 *   como um roteiro coerente com o STATUS do caso ou da recuperação (lembrete,
 *   atraso longo, promessa, negociação, acordo, negativado, retirada,
 *   contestação) e com o status da conversa (robô, ativa, parada, encerrada).
 *   O roteiro é congelado na primeira leitura: assumir ou encerrar a conversa
 *   muda o status no banco, e o histórico não pode se reescrever por isso.
 * - O que o VISITANTE faz (mensagens, conversas novas, agentes, skills) vive
 *   num `Map` em memória por organização (`demo-org-<providerId>`), no
 *   processo da API — o único que o preenche. Some quando o sandbox é apagado:
 *   pela varredura deste próprio módulo (a limpeza roda no WORKER, outro
 *   processo, e não alcança este `Map`) ou por `limparChatSimuladoDoProvedor`.
 *
 * Isolamento: o provedor sai do `x-organization-id` e toda leitura do banco
 * filtra por ele — um sandbox pedindo a conversa de outro recebe 404.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import {
  chatBullqConversas,
  cobrancaCasos,
  customers,
  equipment,
  equipmentRecoveryCases,
  providers,
  users,
} from "@shared/schema";
import { etapaParaAtraso } from "@shared/cobranca/regua";
import { normalizarTelefoneParaChat, type Canal, type Conversa, type Mensagem, type StatusConversa } from "../services/chat/chat-bullq.client";

export const URL_DO_CHAT_SIMULADO = "http://chat-simulado.demo.invalid";

export const CANAL_DA_DEMO: Canal = { id: "demo-canal", type: "WHATSAPP_ZAPPFY", name: "WhatsApp da Demonstração", isActive: true };

export function organizacaoDaDemo(providerId: number): string {
  return `demo-org-${providerId}`;
}

// ---------------------------------------------------------------------------
// Estado em memória do visitante
// ---------------------------------------------------------------------------

type Registro = Record<string, unknown> & { id: string };

interface EstadoDaOrganizacao {
  sequencia: number;
  /** Conversas abertas pelo visitante (`demo-conv-<providerId>-n<sufixo>`) — o contato e a abertura só existem aqui. */
  criadas: Map<string, Conversa>;
  /** Roteiro das conversas semeadas, congelado na primeira leitura. */
  roteiros: Map<string, Mensagem[]>;
  /** Mensagens que o visitante mandou (e a abertura das conversas criadas), por conversa. */
  enviadas: Map<string, Mensagem[]>;
  /** Status que o visitante mudou (assumir, encerrar), por conversa. */
  status: Map<string, StatusConversa>;
  /** Agentes, tools, skills e automações criados pelo visitante. */
  colecoes: Map<string, Map<string, Registro>>;
}

const organizacoes = new Map<string, EstadoDaOrganizacao>();

/**
 * Teto por conversa do que o visitante manda: a demonstração é pública e a
 * memória é do processo — sem teto, um script repetindo POST /messages cresce
 * o `Map` até o sandbox morrer. Duzentas mensagens é mais do que qualquer
 * demonstração humana escreve.
 */
const MAXIMO_DE_ENVIADAS_POR_CONVERSA = 200;

/**
 * O mesmo raciocínio para conversas novas e para agentes, tools, skills e
 * automações: sem teto, um laço de POST crescia o `Map` até o
 * `max_memory_restart` derrubar a API da demonstração inteira. Os números
 * passam folgado de qualquer demonstração feita por uma pessoa.
 */
export const MAXIMO_DE_CONVERSAS_CRIADAS = 300;
export const MAXIMO_DE_REGISTROS_POR_COLECAO = 100;

/**
 * De quanto em quanto tempo a varredura confere se os provedores do `Map`
 * ainda existem. A limpeza de sandboxes roda de hora em hora no worker; um
 * quarto de hora aqui deixa o estado de um sandbox apagado sobrar no máximo
 * esse tempo na memória da API.
 */
export const INTERVALO_DA_VARREDURA_MS = 15 * 60_000;

let varredura: ReturnType<typeof setInterval> | null = null;

function estadoDe(org: string): EstadoDaOrganizacao {
  let estado = organizacoes.get(org);
  if (!estado) {
    estado = { sequencia: 0, criadas: new Map(), roteiros: new Map(), enviadas: new Map(), status: new Map(), colecoes: new Map() };
    organizacoes.set(org, estado);
    garantirVarredura();
  }
  return estado;
}

/** Esvazia tudo que o visitante daquele provedor criou no chat simulado. Chamado por `apagarSandbox`. */
export function limparChatSimuladoDoProvedor(providerId: number): void {
  organizacoes.delete(organizacaoDaDemo(providerId));
}

function providerIdDaOrganizacao(org: string): number | null {
  const m = /^demo-org-(\d+)$/.exec(org);
  return m ? Number(m[1]) : null;
}

/**
 * Descarta o estado de toda organização cujo provedor não existe mais no
 * banco (ou que nem é de um provedor). É ela, e não `apagarSandbox`, que de
 * fato limpa a demonstração publicada: `apagarSandbox` roda no processo do
 * WORKER (a limpeza horária só liga lá), e este `Map` vive no processo da API,
 * que é quem atende as rotas de chat do visitante. Devolve quantas saíram.
 */
export async function varrerOrganizacoesSemProvedor(): Promise<number> {
  const orgs = [...organizacoes.keys()];
  if (orgs.length === 0) return 0;
  const ids = orgs.map(providerIdDaOrganizacao).filter((id): id is number => id !== null);
  const existentes = new Set(ids.length === 0 ? [] : (await db.select({ id: providers.id }).from(providers).where(inArray(providers.id, ids))).map((p) => p.id));
  let removidas = 0;
  for (const org of orgs) {
    const id = providerIdDaOrganizacao(org);
    if (id === null || !existentes.has(id)) {
      organizacoes.delete(org);
      removidas++;
    }
  }
  if (removidas > 0) logger.info({ removidas }, "chat-simulado: estado de sandboxes apagados descartado da memória");
  return removidas;
}

/**
 * Liga a varredura no primeiro uso. Só este módulo decide, e só quando há
 * estado a vigiar — o `fetch` simulado só é montado na demonstração, então
 * fora dela o timer nunca existe. `unref()`: não segura o desligamento da API.
 */
function garantirVarredura(): void {
  if (varredura) return;
  varredura = setInterval(() => {
    varrerOrganizacoesSemProvedor().catch((erro) => {
      logger.warn({ causa: (erro as { name?: string })?.name ?? "erro" }, "chat-simulado: varredura da memória falhou; tenta de novo na próxima");
    });
  }, INTERVALO_DA_VARREDURA_MS);
  varredura.unref?.();
}

function semDdi(telefone: string | null | undefined): string {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  return (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55") ? digitos.slice(2) : digitos;
}

/**
 * Conversa aberta pelo visitante: `demo-conv-<providerId>-n<sufixo>`. O sufixo
 * não vem de contador do processo — a linha da conversa fica 24 h no banco, e
 * um contador zerado por um reinício da API repetiria o id de uma conversa já
 * vinculada a OUTRO cliente (`registrarConversaDoChat` recusa, e o "enviar
 * para cobrança" quebrava até o sandbox expirar).
 */
const CONVERSA_CRIADA = /^demo-conv-\d+-n/;

function idDeConversaCriada(providerId: number): string {
  return `demo-conv-${providerId}-n${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Leitura do banco: a conversa semeada com o que a cena precisa
// ---------------------------------------------------------------------------

const camposDaConversa = {
  conversationId: chatBullqConversas.conversationId,
  status: chatBullqConversas.status,
  origem: chatBullqConversas.origem,
  canalId: chatBullqConversas.canalId,
  abertaEm: chatBullqConversas.abertaEm,
  ultimoEventoEm: chatBullqConversas.ultimoEventoEm,
  clienteNome: customers.name,
  clienteTelefone: customers.phone,
  clienteDivida: customers.totalOverdueAmount,
  clienteDias: customers.maxDaysOverdue,
  provedorNome: providers.name,
  provedorFantasia: providers.tradeName,
  atendenteNome: users.name,
  casoStatus: cobrancaCasos.status,
  casoCarteira: cobrancaCasos.carteira,
  casoValor: cobrancaCasos.valorAtual,
  casoDias: cobrancaCasos.diasAtrasoAbertura,
  recuperacaoStatus: equipmentRecoveryCases.status,
  recuperacaoAgendadaEm: equipmentRecoveryCases.scheduledAt,
  equipamentoTipo: equipment.type,
  equipamentoMarca: equipment.brand,
  equipamentoModelo: equipment.model,
};

export type LinhaDaConversa = {
  conversationId: string; status: string; origem: string; canalId: string; abertaEm: Date; ultimoEventoEm: Date | null;
  clienteNome: string; clienteTelefone: string | null; clienteDivida: string | null; clienteDias: number | null;
  provedorNome: string; provedorFantasia: string | null; atendenteNome: string | null;
  casoStatus: string | null; casoCarteira: string | null; casoValor: string | null; casoDias: number | null;
  recuperacaoStatus: string | null; recuperacaoAgendadaEm: Date | null;
  equipamentoTipo: string | null; equipamentoMarca: string | null; equipamentoModelo: string | null;
};

/** As conversas do provedor gravadas no banco (ou só uma). Caso, recuperação e cliente filtrados pelo MESMO provedor. */
async function conversasSemeadas(providerId: number, conversationId?: string): Promise<LinhaDaConversa[]> {
  const doProvedor = eq(chatBullqConversas.providerId, providerId);
  return db.select(camposDaConversa)
    .from(chatBullqConversas)
    .innerJoin(customers, and(eq(customers.id, chatBullqConversas.customerId), eq(customers.providerId, chatBullqConversas.providerId)))
    .innerJoin(providers, eq(providers.id, chatBullqConversas.providerId))
    .leftJoin(users, eq(users.id, chatBullqConversas.abertaPorUserId))
    .leftJoin(cobrancaCasos, and(eq(cobrancaCasos.id, chatBullqConversas.casoId), eq(cobrancaCasos.providerId, chatBullqConversas.providerId)))
    .leftJoin(equipmentRecoveryCases, and(eq(equipmentRecoveryCases.id, chatBullqConversas.recuperacaoId), eq(equipmentRecoveryCases.providerId, chatBullqConversas.providerId)))
    .leftJoin(equipment, eq(equipment.id, equipmentRecoveryCases.equipmentId))
    .where(conversationId ? and(doProvedor, eq(chatBullqConversas.conversationId, conversationId)) : doProvedor);
}

const STATUS_VALIDOS = new Set<StatusConversa>(["PENDING", "BOT", "OPEN", "WAITING", "CLOSED"]);

function statusDaLinha(status: string): StatusConversa {
  return STATUS_VALIDOS.has(status as StatusConversa) ? (status as StatusConversa) : "BOT";
}

function conversaDaLinha(linha: LinhaDaConversa, estado: EstadoDaOrganizacao): Conversa {
  return {
    id: linha.conversationId,
    status: estado.status.get(linha.conversationId) ?? statusDaLinha(linha.status),
    contact: { name: linha.clienteNome, phone: normalizarTelefoneParaChat(linha.clienteTelefone) },
    channel: { id: linha.canalId, type: CANAL_DA_DEMO.type, name: CANAL_DA_DEMO.name },
    assignedTo: null,
    aiEnabled: false,
    activeAgentId: null,
    lastMessageAt: (linha.ultimoEventoEm ?? linha.abertaEm).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Roteiros
// ---------------------------------------------------------------------------

type Autor = "assistente" | "equipe" | "cliente";
type Passo = [Autor, string];

/**
 * Uma cena: a conversa como ela anda, sempre terminando na equipe, e a última
 * fala da equipe quando a conversa foi ENCERRADA. O fecho é da cena, e não um
 * texto único: encerrar uma negociação não é "pagamento localizado", e
 * encerrar uma contestação não é "recebemos o equipamento".
 */
interface Cena { passos: Passo[]; fechoSeEncerrada: string }

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

const brl = (valor: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
const diaEMes = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** Retirada de equipamento: a fala segue o status da recuperação — contestação e recolhimento nunca se misturam. */
function cenaDoEquipamento(l: LinhaDaConversa, abertura: Passo): Cena {
  if (l.recuperacaoStatus === "contestado") {
    return {
      passos: [
        abertura,
        ["cliente", "Sou eu, mas esse aparelho eu já devolvi na loja."],
        ["equipe", "Obrigado por avisar. Você ainda tem o comprovante da devolução?"],
        ["cliente", "Não achei o papel, mas entreguei na loja do centro."],
        ["equipe", "Vou conferir o registro da devolução na loja e te retorno por aqui."],
      ],
      fechoSeEncerrada: "Tudo bem. Vamos conferir o registro da devolução na loja; vou encerrar este atendimento e te avisamos por aqui quando concluir.",
    };
  }
  const inicio: Passo[] = [
    abertura,
    ["cliente", "Sou eu. Pode vir buscar, sim."],
    ["equipe", "Ótimo! Qual o melhor dia e horário para o técnico passar?"],
  ];
  if (l.recuperacaoStatus === "concluido") {
    return {
      passos: [...inicio, ["cliente", "O técnico passou hoje e levou o aparelho."], ["equipe", "Recebemos o equipamento, obrigado!"]],
      fechoSeEncerrada: "Recebemos o equipamento, obrigado! Vou encerrar este atendimento.",
    };
  }
  const fecho: Record<string, string> = {
    agendado: `Agendado: o técnico passa${l.recuperacaoAgendadaEm ? ` no dia ${diaEMes(l.recuperacaoAgendadaEm)}` : ""} depois das 18h. É só entregar o aparelho com a fonte.`,
    nova_tentativa: "O técnico passou e não encontrou ninguém. Vamos marcar uma nova tentativa — qual dia fica melhor?",
    notificacao_formal: "Como não conseguimos combinar a retirada, enviamos a notificação formal de devolução. Ainda dá para agendar por aqui.",
  };
  return {
    passos: [...inicio, ["cliente", "Durante a semana, depois das 18h."], ["equipe", fecho[l.recuperacaoStatus ?? ""] ?? "Perfeito, vou ver a agenda do técnico e te passo as opções."]],
    fechoSeEncerrada: "Vou encerrar este atendimento por aqui; para agendar a retirada, é só chamar.",
  };
}

/**
 * Cobrança: a fala segue o STATUS do caso (e, sem caso, a etapa da régua para
 * os dias de atraso) — é o que o kanban, a ficha e a linha do tempo mostram do
 * mesmo cliente. O ex-cliente muda a abertura e o jeito de falar do valor.
 */
function cenaDaCobranca(l: LinhaDaConversa, abertura: Passo, primeiro: string): Cena {
  const ex = l.casoCarteira === "ex_cliente";
  const valor = brl(Number(l.casoValor ?? l.clienteDivida ?? 0));
  const dias = l.clienteDias || l.casoDias || 0;
  const oValor = ex
    ? `ficou um valor de ${valor} da fatura de saída, de antes do cancelamento`
    : `consta uma fatura de ${valor} em aberto${dias > 0 ? ` há ${dias} dias` : ""}`;

  switch (l.casoStatus) {
    case "pago":
      return {
        passos: [abertura, ["cliente", "Sou eu."], ["equipe", `Obrigado por confirmar, ${primeiro}. ${maiuscula(oValor)}. Posso te mandar a segunda via?`],
          ["cliente", "Já paguei hoje cedo, segue o comprovante."], ["equipe", "Pagamento localizado, obrigado!"]],
        fechoSeEncerrada: "Pagamento localizado, obrigado! Vou encerrar este atendimento.",
      };
    case "negativado":
      return {
        passos: [
          abertura,
          ["cliente", "Sou eu. Do que se trata?"],
          ["equipe", `Obrigado por confirmar, ${primeiro}. ${maiuscula(oValor)}, e o seu CPF está registrado nos órgãos de proteção ao crédito por essa pendência. Se quiser, vemos uma forma de quitar e pedir a baixa do registro.`],
          ["cliente", "Não concordo com esse valor e não vou pagar agora."],
          ["equipe", "Entendido, registrei a sua posição. Se quiser rever, é só chamar por aqui."],
        ],
        fechoSeEncerrada: "Entendido, registrei a sua posição e vou encerrar este atendimento. Se quiser rever, é só chamar por aqui.",
      };
    case "negociando":
    case "acordo_ativo": {
      const fechado = l.casoStatus === "acordo_ativo";
      return {
        passos: [
          abertura,
          ["cliente", "Sou eu. Sei que estou devendo, mas não consigo pagar tudo de uma vez."],
          ["equipe", `Entendo, ${primeiro}. ${maiuscula(oValor)}. Vamos ver uma condição dentro da política que caiba no seu orçamento.`],
          ["cliente", "Se fosse em três vezes eu conseguiria."],
          ["equipe", fechado ? "Consultei a política e te mandei a proposta aqui. Confere e me diz se podemos registrar." : "Vou montar a proposta dentro da política e te envio aqui para você conferir antes de confirmar."],
          ["cliente", fechado ? "Conferi. Pode registrar, obrigado." : "Tá bom, fico aguardando."],
          ["equipe", fechado ? "Acordo registrado. Te mando o boleto por aqui; qualquer dúvida, é só chamar." : "Proposta enviada. Assim que você confirmar, registro o acordo."],
        ],
        fechoSeEncerrada: fechado
          ? "Acordo registrado. Te mando o boleto por aqui e vou encerrar este atendimento; qualquer dúvida, é só chamar."
          : "Proposta enviada. Vou encerrar este atendimento; quando quiser confirmar, é só chamar por aqui.",
      };
    }
    case "em_contato":
      if (ex) {
        return {
          passos: [
            abertura,
            ["cliente", "Sou eu, mas cancelei a internet faz tempo."],
            ["equipe", `Isso mesmo, ${primeiro}. ${maiuscula(oValor)}. Podemos ver uma forma de quitar que caiba para você?`],
            ["cliente", "Achei que estava tudo pago. Pode me mandar o detalhe dessa fatura?"],
            ["equipe", "Mando sim: a fatura, o período de uso e o vencimento."],
          ],
          fechoSeEncerrada: "Mando sim: a fatura, o período de uso e o vencimento. Vou encerrar este atendimento; depois de conferir, é só chamar por aqui.",
        };
      }
      return {
        passos: [
          abertura,
          ["cliente", "Sou eu. É sobre a fatura atrasada?"],
          ["equipe", `Isso, ${primeiro}: são ${valor}${dias > 0 ? `, vencida há ${dias} dias` : ""}. Consegue regularizar esta semana?`],
          ["cliente", "Recebo na sexta. Consigo pagar no sábado de manhã."],
          ["equipe", "Combinado, anotei o pagamento para sábado. Se precisar da segunda via antes, é só pedir por aqui."],
          ["cliente", "Pode deixar, obrigado."],
          ["equipe", "Por nada! Fico no aguardo."],
        ],
        fechoSeEncerrada: "Por nada! Anotei o pagamento para sábado e vou encerrar este atendimento.",
      };
  }

  // Sem caso (ou caso ainda aberto): a etapa da régua para os dias de atraso
  // decide o tom — "esquecimento" só vale no lembrete (até 14 dias); depois
  // disso a conversa é de negociação.
  if (!ex && etapaParaAtraso(dias, "ativo").etapa?.id === "lembrete_atraso") {
    return {
      passos: [
        abertura,
        ["cliente", "Oi, sou eu sim. Aconteceu alguma coisa?"],
        ["equipe", `Obrigado por confirmar, ${primeiro}. ${maiuscula(oValor)}. Pode ter sido só um esquecimento — quer que eu mande a segunda via ou o PIX?`],
        ["cliente", "Nossa, passou batido. Manda o PIX, por favor."],
        ["equipe", "Claro! Vou gerar o PIX e te mando aqui em seguida."],
      ],
      fechoSeEncerrada: "Claro! Te mandei o PIX aqui e vou encerrar este atendimento.",
    };
  }
  return {
    passos: [
      abertura,
      ["cliente", "Oi, sou eu sim. Aconteceu alguma coisa?"],
      ["equipe", `Obrigado por confirmar, ${primeiro}. ${maiuscula(oValor)}. Podemos ver juntos uma forma de regularizar dentro da política?`],
      ["cliente", "Estou apertado este mês. Tem como parcelar?"],
      ["equipe", "Vou ver as condições que a política permite e te envio a proposta aqui para você conferir."],
    ],
    fechoSeEncerrada: "Vou ver as condições que a política permite e te envio a proposta aqui. Vou encerrar este atendimento; quando quiser seguir, é só chamar.",
  };
}

/**
 * Os passos da conversa. Conversa do ROBÔ (BOT) é só a abertura automática:
 * ninguém respondeu — é o que a linha do tempo grava dela (contato sem
 * resultado, tentativa sem resposta, sem usuário). Encerrada troca a última
 * fala da equipe pelo fecho da própria cena.
 */
function passosDaCena(l: LinhaDaConversa): Passo[] {
  const primeiro = l.clienteNome.trim().split(/\s+/)[0] || "cliente";
  const provedor = l.provedorFantasia || l.provedorNome;
  const status = statusDaLinha(l.status);

  let abertura: Passo;
  if (l.origem === "equipamentos") {
    const aparelho = [l.equipamentoMarca, l.equipamentoModelo].filter(Boolean).join(" ") || l.equipamentoTipo || "";
    abertura = ["assistente", `Olá, ${primeiro}! Sou o assistente virtual da ${provedor}. Com o encerramento do contrato, precisamos combinar a devolução do equipamento${aparelho ? ` (${aparelho})` : ""} que ficou com você. Confirma que é você?`];
  } else if (l.casoCarteira === "ex_cliente") {
    abertura = ["assistente", `Olá, ${primeiro}! Sou o assistente virtual da ${provedor}. Podemos falar por aqui sobre o contrato que você teve conosco? Confirma que é você?`];
  } else {
    // Antes da identificação, só saudação e provedor — a mesma regra que a ponte impõe à abertura real.
    abertura = ["assistente", `Olá, ${primeiro}! Sou o assistente virtual da ${provedor}. Podemos falar sobre o seu contrato por aqui? Confirma que é você?`];
  }
  if (status === "BOT") return [abertura];

  const cena = l.origem === "equipamentos" ? cenaDoEquipamento(l, abertura) : cenaDaCobranca(l, abertura, primeiro);
  return status === "CLOSED" ? [...cena.passos.slice(0, -1), ["equipe", cena.fechoSeEncerrada]] : cena.passos;
}

/** n instantes igualmente espaçados de `de` até `ate`. */
function repartir(de: number, ate: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (n === 1 ? de : de + ((ate - de) * i) / (n - 1)));
}

/**
 * O roteiro com horários e status. A regra que a tela e o WhatsApp carregam:
 * conversa ATIVA (OPEN/PENDING) termina numa fala do cliente das últimas
 * 24 h — é o que deixa o atendente responder; conversa do ROBÔ (BOT) tem só a
 * abertura automática, sem resposta; conversa PARADA (WAITING/CLOSED) termina
 * na equipe e a última fala do cliente tem mais de 24 h. Os horários ficam
 * entre `abertaEm` e `ultimoEventoEm`; só quando a linha semeada já contradiz
 * a regra (a conversa ativa envelheceu além de 24 h) o fim é trazido para
 * perto de agora — preferimos mover o relógio a mentir o status.
 *
 * Exportada para o teste da semeadura cruzar o texto com o caso e a
 * recuperação que o sandbox grava.
 */
export function roteiroDaConversa(linha: LinhaDaConversa, agora: number, antesDe = Number.POSITIVE_INFINITY): Mensagem[] {
  const status = statusDaLinha(linha.status);
  const ativa = status === "OPEN" || status === "PENDING";
  const seq = Number(/-(\d+)$/.exec(linha.conversationId)?.[1] ?? 0);
  const abertaEm = linha.abertaEm.getTime();

  let fim = Math.min((linha.ultimoEventoEm ?? new Date(agora)).getTime(), agora);
  if (ativa && agora - fim >= 24 * HORA) fim = agora - (20 + ((seq * 37) % 300)) * MINUTO;
  // O que o visitante já mandou vem depois do roteiro, nunca no meio dele.
  fim = Math.min(fim, antesDe - MINUTO);

  const limite = agora - 25 * HORA;
  let passos = passosDaCena(linha);
  if (ativa) {
    passos = passos.slice(0, passos.map(p => p[0]).lastIndexOf("cliente") + 1);
  } else if (Math.min(abertaEm, fim) > limite) {
    // Parada e aberta há menos de 25 h: não houve tempo de o cliente responder há mais de 24 h — só a abertura.
    passos = passos.slice(0, 1);
  }

  const n = passos.length;
  // Nunca antes de a conversa existir; `fim` só fica antes de `abertaEm` numa linha semeada incoerente.
  const inicio = Math.min(abertaEm, fim);
  const ultimaDoCliente = passos.map(p => p[0]).lastIndexOf("cliente");
  let horarios = repartir(inicio, fim, n);
  if (!ativa && ultimaDoCliente >= 0 && horarios[ultimaDoCliente] > limite) {
    horarios = [...repartir(inicio, limite, ultimaDoCliente + 1), ...repartir(limite, fim, n - ultimaDoCliente).slice(1)];
  }

  const provedor = linha.provedorFantasia || linha.provedorNome;
  return passos.map(([autor, texto], i): Mensagem => {
    const doCliente = autor === "cliente";
    const respondida = passos.slice(i + 1).some(p => p[0] === "cliente");
    return {
      id: `demo-msg-${linha.conversationId}-${i + 1}`,
      direction: doCliente ? "INBOUND" : "OUTBOUND",
      type: "TEXT",
      content: { text: texto },
      status: doCliente ? (ativa && i === n - 1 ? "DELIVERED" : "READ") : respondida ? "READ" : "DELIVERED",
      ...(doCliente ? {} : { senderName: autor === "assistente" ? "Assistente virtual" : linha.atendenteNome || `Equipe ${provedor}` }),
      createdAt: new Date(Math.round(horarios[i])).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------

interface Pedido {
  metodo: string;
  caminho: string;
  query: URLSearchParams;
  org: string;
  corpo: Record<string, unknown>;
  params: string[];
}
type Resposta = { status: number; corpo: unknown };
type Tratador = (p: Pedido) => Resposta | Promise<Resposta>;

const ok = (corpo: unknown): Resposta => ({ status: 200, corpo });
const criado = (corpo: unknown): Resposta => ({ status: 201, corpo });
const naoEncontrado = (message: string): Resposta => ({ status: 404, corpo: { message } });
const noLimite = (message: string): Resposta => ({ status: 429, corpo: { message } });
const CONFIRMADO = { success: true };

const TOKENS_DA_DEMO = { accessToken: "demo-acesso", refreshToken: "demo-renovacao" };

const CONEXAO_DA_DEMO = {
  provider: "ZAPPFY", status: "connected", connected: true, loggedIn: true, phone: null, qrCode: null, pairCode: null,
  aviso: "Conexão simulada da demonstração: nenhum WhatsApp real está ligado a este número.",
};

function colecao(p: Pedido, nome: string): Map<string, Registro> {
  const estado = estadoDe(p.org);
  let c = estado.colecoes.get(nome);
  if (!c) { c = new Map(); estado.colecoes.set(nome, c); }
  return c;
}

function criarRegistro(p: Pedido, nome: string, extra: Record<string, unknown> = {}): Registro {
  const estado = estadoDe(p.org);
  const agora = new Date().toISOString();
  const registro: Registro = { ...p.corpo, ...extra, id: `demo-${nome}-${++estado.sequencia}`, organizationId: p.org, createdAt: agora, updatedAt: agora };
  colecao(p, nome).set(registro.id, registro);
  return registro;
}

/** O CRUD que agentes, tools, skills e automações compartilham: o que o visitante criou, ele relê. */
function crud(base: string, nome: string): Array<[string, RegExp, Tratador]> {
  const umItem = new RegExp(`^${base}/([^/]+)$`);
  return [
    ["GET", new RegExp(`^${base}$`), p => ok([...colecao(p, nome).values()])],
    ["POST", new RegExp(`^${base}$`), p => (colecao(p, nome).size >= MAXIMO_DE_REGISTROS_POR_COLECAO
      ? noLimite("Limite de itens desta demonstração atingido: apague algum antes de criar outro")
      : criado(criarRegistro(p, nome, nome === "agentes" ? { channels: [], skills: [] } : {})))],
    ["GET", umItem, p => { const r = colecao(p, nome).get(p.params[0]); return r ? ok(r) : naoEncontrado("Registro não encontrado na demonstração"); }],
    ["PATCH", umItem, p => {
      const r = colecao(p, nome).get(p.params[0]);
      if (!r) return naoEncontrado("Registro não encontrado na demonstração");
      Object.assign(r, p.corpo, { id: r.id, organizationId: r.organizationId, updatedAt: new Date().toISOString() });
      return ok(r);
    }],
    ["DELETE", umItem, p => (colecao(p, nome).delete(p.params[0]) ? ok(CONFIRMADO) : naoEncontrado("Registro não encontrado na demonstração"))],
  ];
}

async function localizarConversa(p: Pedido, conversationId: string): Promise<{ conversa: Conversa; linha: LinhaDaConversa | null } | null> {
  const estado = estadoDe(p.org);
  const criada = estado.criadas.get(conversationId);
  if (criada) return { conversa: { ...criada, status: estado.status.get(conversationId) ?? criada.status }, linha: null };
  const providerId = providerIdDaOrganizacao(p.org);
  // A conversa semeada carrega o provedor no id; outro provedor pedindo não chega nem a ler o banco.
  if (providerId === null || !conversationId.startsWith(`demo-conv-${providerId}-`)) return null;
  const [linha] = await conversasSemeadas(providerId, conversationId);
  if (!linha) return null;
  // Conversa aberta pelo visitante antes de um reinício da API: o vínculo
  // ficou no banco, a abertura e as mensagens ficaram na memória que se foi.
  // Sem roteiro — inventar falas do cliente seria pior que o histórico vazio.
  return { conversa: conversaDaLinha(linha, estado), linha: CONVERSA_CRIADA.test(conversationId) ? null : linha };
}

async function historico(p: Pedido, conversationId: string): Promise<Mensagem[] | null> {
  const achada = await localizarConversa(p, conversationId);
  if (!achada) return null;
  const estado = estadoDe(p.org);
  const enviadas = estado.enviadas.get(conversationId) ?? [];
  let roteiro: Mensagem[] = [];
  if (achada.linha) {
    roteiro = estado.roteiros.get(conversationId) ?? roteiroDaConversa(achada.linha, Date.now(), enviadas.length ? Date.parse(enviadas[0].createdAt) : undefined);
    estado.roteiros.set(conversationId, roteiro);
  }
  return [...roteiro, ...enviadas].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function guardarEnviada(estado: EstadoDaOrganizacao, conversationId: string, mensagem: Mensagem): void {
  const lista = [...(estado.enviadas.get(conversationId) ?? []), mensagem];
  estado.enviadas.set(conversationId, lista.slice(-MAXIMO_DE_ENVIADAS_POR_CONVERSA));
}

const ROTAS: Array<[string, RegExp, Tratador]> = [
  // ── plataforma e sessão
  ["POST", /^\/platform\/organizations$/, p => {
    const providerId = Number(p.corpo.externalId);
    const slug = String(p.corpo.slug ?? "");
    return criado({
      organizationId: Number.isInteger(providerId) && providerId > 0 ? organizacaoDaDemo(providerId) : `demo-org-${slug || "sem-provedor"}`,
      slug, ownerUserId: `demo-owner-${p.corpo.externalId ?? slug}`, ownerEmail: String(p.corpo.ownerEmail ?? ""), created: false,
    });
  }],
  ["POST", /^\/platform\/organizations\/([^/]+)\/token$/, () => ok(TOKENS_DA_DEMO)],
  ["POST", /^\/auth\/refresh$/, () => ok(TOKENS_DA_DEMO)],
  // Não existe inbox externo na demonstração: responder "ok" deixava a tela
  // mandar o visitante entrar em chat.consultaisp.com.br com uma senha que
  // ninguém guardou. A recusa é local e diz o porquê.
  ["POST", /^\/platform\/organizations\/([^/]+)\/owner-password$/, () => ({ status: 403, corpo: { message: "O inbox externo não existe na demonstração: nenhuma senha foi gravada" } })],

  // ── canais
  ["GET", /^\/channels$/, () => ok([CANAL_DA_DEMO])],
  // Só Zappfy: Datafy exige template aprovado para abrir conversa, e o simulado
  // não tem template — um canal Datafy salvo ficaria "ativo" com todo envio
  // falhando. Sem a capability, a ponte recusa antes de gravar qualquer coisa.
  ["GET", /^\/channels\/capabilities$/, () => ok({ whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: false, datafy: false, templateFirstContact: false })],
  // Um canal só, sempre o mesmo id: as conversas semeadas apontam para ele, e a limpeza de "canais antigos" da ponte não tem o que apagar.
  ["POST", /^\/channels$/, p => criado({ ...CANAL_DA_DEMO, name: typeof p.corpo.name === "string" && p.corpo.name ? p.corpo.name : CANAL_DA_DEMO.name })],
  ["DELETE", /^\/channels\/([^/]+)$/, () => ok(CONFIRMADO)],
  ["POST", /^\/channels\/([^/]+)\/test$/, () => ok(CONFIRMADO)],
  ["GET", /^\/channels\/([^/]+)\/connection-status$/, () => ok(CONEXAO_DA_DEMO)],
  ["POST", /^\/channels\/([^/]+)\/connect$/, () => ok(CONEXAO_DA_DEMO)],
  ["GET", /^\/channels\/([^/]+)\/templates$/, () => ok([])],

  // ── conversas
  ["GET", /^\/conversations$/, async p => {
    const estado = estadoDe(p.org);
    const providerId = providerIdDaOrganizacao(p.org);
    // As criadas pelo visitante também estão no banco (a ponte registra toda
    // conversa nova): a versão da memória, que tem o contato e o status que ele
    // mudou, vale — a do banco não entra em dobro.
    const semeadas = providerId === null ? [] : (await conversasSemeadas(providerId)).filter(l => !estado.criadas.has(l.conversationId)).map(l => conversaDaLinha(l, estado));
    const criadas = [...estado.criadas.values()].map(c => ({ ...c, status: estado.status.get(c.id) ?? c.status }));
    const alvo = semDdi(p.query.get("search"));
    return ok({ conversations: [...semeadas, ...criadas].filter(c => !alvo || semDdi(c.contact.phone) === alvo) });
  }],
  ["POST", /^\/conversations$/, p => {
    const providerId = providerIdDaOrganizacao(p.org);
    if (providerId === null) return { status: 400, corpo: { message: "Organização fora da demonstração" } };
    const estado = estadoDe(p.org);
    if (estado.criadas.size >= MAXIMO_DE_CONVERSAS_CRIADAS) return noLimite("Limite de conversas novas desta demonstração atingido");
    const conversationId = idDeConversaCriada(providerId);
    const contato = (p.corpo.contact ?? {}) as { phone?: string; name?: string };
    const mensagem = (p.corpo.message ?? {}) as { type?: string; content?: Mensagem["content"] };
    const agora = new Date().toISOString();
    estado.criadas.set(conversationId, {
      id: conversationId, status: "WAITING",
      contact: { name: contato.name ?? null, phone: contato.phone ?? null },
      channel: { id: String(p.corpo.channelId ?? CANAL_DA_DEMO.id), type: CANAL_DA_DEMO.type, name: CANAL_DA_DEMO.name },
      assignedTo: null, aiEnabled: p.corpo.aiEnabled === true, activeAgentId: typeof p.corpo.activeAgentId === "string" ? p.corpo.activeAgentId : null,
      lastMessageAt: agora,
    });
    const messageId = `demo-msg-${conversationId}-1`;
    guardarEnviada(estado, conversationId, { id: messageId, direction: "OUTBOUND", type: mensagem.type ?? "TEXT", content: mensagem.content ?? {}, status: "SENT", senderName: "Assistente virtual", createdAt: agora });
    return criado({ id: messageId, conversationId, status: "WAITING" });
  }],
  ["PATCH", /^\/conversations\/([^/]+)$/, async p => {
    const achada = await localizarConversa(p, p.params[0]);
    if (!achada) return naoEncontrado("Conversa não encontrada");
    const status = p.corpo.status as StatusConversa;
    if (STATUS_VALIDOS.has(status)) estadoDe(p.org).status.set(p.params[0], status);
    return ok({ ...achada.conversa, status: STATUS_VALIDOS.has(status) ? status : achada.conversa.status });
  }],
  ["POST", /^\/conversations\/([^/]+)\/ai\/engage$/, async p => ((await localizarConversa(p, p.params[0])) ? ok(CONFIRMADO) : naoEncontrado("Conversa não encontrada"))],
  ["PATCH", /^\/conversations\/([^/]+)\/ai$/, async p => ((await localizarConversa(p, p.params[0])) ? ok(CONFIRMADO) : naoEncontrado("Conversa não encontrada"))],
  ["POST", /^\/conversations\/([^/]+)\/close$/, async p => {
    if (!(await localizarConversa(p, p.params[0]))) return naoEncontrado("Conversa não encontrada");
    estadoDe(p.org).status.set(p.params[0], "CLOSED");
    return ok(CONFIRMADO);
  }],

  // ── mensagens
  ["GET", /^\/messages$/, async p => {
    const conversationId = p.query.get("conversationId") ?? "";
    const todas = await historico(p, conversationId);
    if (!todas) return naoEncontrado("Conversa não encontrada");
    const limite = Math.max(1, Number(p.query.get("limit")) || 50);
    const pagina = Math.max(1, Number(p.query.get("page")) || 1);
    // Página 1 = as mais recentes, em ordem cronológica — a autonomia e a tela leem "as últimas N".
    const fim = Math.max(0, todas.length - (pagina - 1) * limite);
    return ok({ messages: todas.slice(Math.max(0, fim - limite), fim), pagination: { page: pagina, limit: limite, total: todas.length } });
  }],
  ["POST", /^\/messages$/, async p => {
    const conversationId = String(p.corpo.conversationId ?? "");
    // Ler o histórico antes congela o roteiro: o que o visitante escreve entra depois dele.
    if (!(await historico(p, conversationId))) return naoEncontrado("Conversa não encontrada");
    const estado = estadoDe(p.org);
    const agora = new Date().toISOString();
    const id = `demo-msg-${conversationId}-v${++estado.sequencia}`;
    guardarEnviada(estado, conversationId, { id, direction: "OUTBOUND", type: String(p.corpo.type ?? "TEXT"), content: (p.corpo.content ?? {}) as Mensagem["content"], status: "SENT", senderName: "Atendente da demonstração", createdAt: agora });
    const criada = estado.criadas.get(conversationId);
    if (criada) criada.lastMessageAt = agora;
    return criado({ id, status: "SENT" });
  }],
  ["GET", /^\/messages\/([^/]+)\/media$/, () => naoEncontrado("As mensagens da demonstração não têm anexo")],

  // ── agentes de IA (rotas fixas antes de /ai-agents/:id)
  ["GET", /^\/ai-agents\/first-contact\/models$/, () => ok({ configured: true, models: [{ id: "openai/gpt-4o-mini" }, { id: "openai/gpt-4.1-mini" }] })],
  ["GET", /^\/ai-agents\/runs\/feed$/, () => ok([])],
  ["GET", /^\/ai-agents\/stats\/overview$/, p => ok({
    period: p.query.get("period") ?? "7d", runs: { total: 0, completed: 0, failed: 0, skipped: 0, successRate: null },
    tokens: { total: 0 }, cost: { usd: 0, avgPerRun: 0 }, latency: { p50: null, p95: null }, byAgent: [], byFinalAction: {}, tools: [],
  })],
  ...crud("/ai-agents", "agentes"),
  ["POST", /^\/ai-agents\/([^/]+)\/channels$/, p => {
    const agente = colecao(p, "agentes").get(p.params[0]);
    if (!agente) return naoEncontrado("Agente não encontrado");
    const canalId = String(p.corpo.channelId ?? "");
    const canais = (agente.channels as Record<string, unknown>[]).filter(c => c.channelId !== canalId);
    agente.channels = [...canais, { id: `demo-vinculo-${p.params[0]}-${canalId}`, channelId: canalId, mode: p.corpo.mode ?? "DISABLED", trigger: p.corpo.trigger ?? "ALWAYS", channel: { name: CANAL_DA_DEMO.name } }];
    return criado(CONFIRMADO);
  }],
  ["DELETE", /^\/ai-agents\/([^/]+)\/channels\/([^/]+)$/, p => {
    const agente = colecao(p, "agentes").get(p.params[0]);
    if (!agente) return naoEncontrado("Agente não encontrado");
    agente.channels = (agente.channels as Record<string, unknown>[]).filter(c => c.channelId !== p.params[1]);
    return ok(CONFIRMADO);
  }],
  ["GET", /^\/ai-agents\/([^/]+)\/skills$/, p => {
    const agente = colecao(p, "agentes").get(p.params[0]);
    return agente ? ok(agente.skills) : naoEncontrado("Agente não encontrado");
  }],
  ["PATCH", /^\/ai-agents\/([^/]+)\/skills\/([^/]+)\/approval$/, p => {
    const agente = colecao(p, "agentes").get(p.params[0]);
    const vinculo = (agente?.skills as Record<string, unknown>[] | undefined)?.find(s => s.skillId === p.params[1]);
    if (!vinculo) return naoEncontrado("Skill não ligada a este agente");
    vinculo.requiresApproval = p.corpo.requiresApproval === true;
    return ok(CONFIRMADO);
  }],
  ["POST", /^\/ai-agents\/([^/]+)\/first-contact-draft$/, p => {
    const agente = colecao(p, "agentes").get(p.params[0]);
    if (!agente) return naoEncontrado("Agente não encontrado");
    const contexto = (p.corpo.context ?? {}) as { nomeCliente?: string; nomeProvedor?: string };
    const estado = estadoDe(p.org);
    // Texto fixo, sem modelo: só saudação e identificação, que é o que a abertura permite antes de o cliente se identificar.
    return ok({
      texto: `Olá, ${contexto.nomeCliente || "cliente"}! Sou o assistente virtual da ${contexto.nomeProvedor || "sua operadora"}. Podemos conversar por aqui?`,
      agenteId: agente.id, modelo: agente.modelId, runId: `demo-run-${++estado.sequencia}`,
    });
  }],
  // A autonomia não roda na demonstração (a Frente A a desliga no worker); a recusa é local e explica o porquê.
  ["POST", /^\/ai-agents\/([^/]+)\/autonomous-plan$/, () => ({ status: 403, corpo: { message: "O assistente automático fica desligado na demonstração" } })],

  // ── catálogo e automações
  ...crud("/ai-catalog/tools", "tools"),
  ["GET", /^\/ai-catalog\/skills\/([^/]+)\/versions$/, () => ok([])],
  ...crud("/ai-catalog/skills", "skills"),
  ["PUT", /^\/ai-catalog\/agents\/([^/]+)\/skills$/, p => {
    const agente = colecao(p, "agentes").get(p.params[0]);
    if (!agente) return naoEncontrado("Agente não encontrado");
    const skills = colecao(p, "skills");
    const ids = Array.isArray(p.corpo.skillIds) ? p.corpo.skillIds.map(String) : [];
    agente.skills = ids.map(skillId => ({ skillId, requiresApproval: false, skill: { name: String(skills.get(skillId)?.name ?? "") } }));
    return ok(CONFIRMADO);
  }],
  ...crud("/automations", "automacoes"),
];

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

function lerCorpo(body: unknown): Record<string, unknown> {
  if (typeof body !== "string" || !body) return {};
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** O `fetch` que o `ChatBullqClient` recebe na demonstração. Nunca lança e nunca sai do processo. */
export const fetchDoChatSimulado: typeof fetch = async (entrada, init) => {
  const metodo = (init?.method ?? "GET").toUpperCase();
  let caminho = "?";
  try {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    caminho = url.pathname.replace(/^\/api\/v1(?=\/|$)/, "") || "/";
    const org = new Headers(init?.headers).get("x-organization-id") ?? "";
    for (const [verbo, padrao, tratar] of ROTAS) {
      if (verbo !== metodo) continue;
      const m = padrao.exec(caminho);
      if (!m) continue;
      const r = await tratar({ metodo, caminho, query: url.searchParams, org, corpo: lerCorpo(init?.body), params: m.slice(1).map(decodeURIComponent) });
      return resposta(r.status, r.corpo);
    }
    return resposta(404, { message: "Esta rota não existe no chat simulado da demonstração" });
  } catch (erro) {
    // Só método, caminho e o nome do erro: a query carrega telefone e o corpo carrega a mensagem.
    logger.warn({ metodo, caminho, causa: (erro as { name?: string })?.name ?? "erro" }, "chat-simulado: falha ao montar a resposta");
    return resposta(500, { message: "O chat simulado da demonstração não conseguiu responder" });
  }
};
