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
 *   Quem fala primeiro é a funcionária digital do perfil (Clara, Leonora ou
 *   Eduarda), na voz da spec 2026-09-16: a abertura do servidor pede os 4
 *   últimos dígitos do CPF, e só depois deles ela diz o assunto e passa à
 *   equipe o que é da equipe. O teste roda o verificador sobre cada fala dela.
 *   O roteiro é congelado na primeira leitura: assumir ou encerrar a conversa
 *   muda o status no banco, e o histórico não pode se reescrever por isso.
 * - O que o VISITANTE faz (mensagens, conversas novas, agentes, skills) vive
 *   num `Map` em memória por organização (`demo-org-<providerId>`), no
 *   processo da API — o único que o preenche. Some quando o sandbox é apagado:
 *   pela varredura deste próprio módulo (a limpeza roda no WORKER, outro
 *   processo, e não alcança este `Map`) ou por `limparChatSimuladoDoProvedor`.
 * - O CATÁLOGO do console (os três perfis, as skills que o prompt deles cita,
 *   a conexão e a automação de retorno) nasce pronto na primeira requisição da
 *   organização, no mesmo `Map` — sem banco e sem comer o teto do visitante.
 *   As EXECUÇÕES e o resumo não são guardados: saem, a cada leitura, dos
 *   roteiros das conversas semeadas, e por isso contam a mesma história.
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
import { AutomacaoChatSchema, janelaDoChat, type AutomacaoChat } from "@shared/cobranca/automacao-chat";
import { POLITICA_PADRAO } from "@shared/cobranca/politica";
import { CATALOGO_DE_AGENTES, TIPOS_DE_AGENTE, type AgenteDoChat, type TipoDeAgente } from "@shared/chat-agentes";
import type { AcaoDaRodada, SituacaoDaRodada } from "@shared/chat-funcionaria-digital";
import {
  avisoDeTransferencia, confirmacaoDaIdentidade, formatarReais, nomeDoProvedorSeguro, textoPreIdentidade, type CategoriaDeTransferencia,
} from "@shared/chat-funcionaria-textos";
import { normalizarTelefoneParaChat, type Canal, type Conversa, type Mensagem, type StatusConversa } from "../services/chat/chat-bullq.client";

export const URL_DO_CHAT_SIMULADO = "http://chat-simulado.demo.invalid";

export const CANAL_DA_DEMO: Canal = { id: "demo-canal", type: "WHATSAPP_ZAPPFY", name: "WhatsApp da Demonstração", isActive: true };

export function organizacaoDaDemo(providerId: number): string {
  return `demo-org-${providerId}`;
}

// ---------------------------------------------------------------------------
// Os perfis da demonstração — o contrato com a semeadura do sandbox
// ---------------------------------------------------------------------------

/** Um dos modelos que `/ai-agents/first-contact/models` deste simulado lista. */
export const MODELO_DOS_AGENTES_DA_DEMO = "openai/gpt-4o-mini";

export interface AgenteDaDemo { tipo: TipoDeAgente; id: string; nome: string; modelo: string }

/**
 * Os três perfis do Painel já provisionados, um por tipo. O id é o MESMO nas
 * duas pontas: a coleção `agentes` desta organização (o "fork") e o
 * `agenteConfig` que a semeadura grava na integração (`agenteConfigDaDemo`).
 * É essa igualdade que o primeiro contato confere (`exigirAgentesProntos` exige
 * id, modelo e etapa "pronto"; a abertura sai controlada, com o id do agente e
 * sem modelo antes da identificação) e que marca os três como `daPonte` no
 * console. Antes a coleção nascia vazia e o rascunho respondia 404.
 */
export const AGENTES_DA_DEMO: Readonly<Record<TipoDeAgente, AgenteDaDemo>> = Object.fromEntries(
  TIPOS_DE_AGENTE.map((tipo) => [tipo, { tipo, id: `demo-agente-${tipo}`, nome: CATALOGO_DE_AGENTES[tipo].nome, modelo: MODELO_DOS_AGENTES_DA_DEMO }]),
) as Record<TipoDeAgente, AgenteDaDemo>;

/**
 * O nome com que cada funcionária digital se apresenta na demonstração: os que o dono escolheu em 16/09/2026
 * (`NOMES_DO_DONO` em `server/services/chat/personas-provedor-ai.ts` — Clara, Leonora e Eduarda). Copiados, e não
 * importados: aquele módulo é o montador das personas, que o servidor não carrega. O teste confere que continuam
 * os mesmos. É o nome da abertura ("Aqui é a Clara, da Rede Demo"), do `senderName` das falas dela e do
 * `nomeDaPersona` dos perfis semeados.
 */
export const NOMES_DAS_FUNCIONARIAS_DA_DEMO: Readonly<Record<TipoDeAgente, string>> = {
  cobranca_ativos: "Clara",
  cobranca_ex_clientes: "Leonora",
  recuperacao_equipamentos: "Eduarda",
};

/** O perfil de um agente semeado pelo id; agente criado pelo visitante não tem perfil (fala a equipe). */
function tipoDoAgenteDaDemo(id: unknown): TipoDeAgente | null {
  return TIPOS_DE_AGENTE.find((tipo) => AGENTES_DA_DEMO[tipo].id === id) ?? null;
}

/**
 * A automação de retorno (resposta do cliente → fila da equipe). A ponte a
 * procura por ESTE nome e gatilho antes de criar outra (`chat-ponte.service.ts`,
 * automação de primeira resposta humana); semeada, e com o id já no
 * `agenteConfig`, ninguém cria uma segunda.
 */
const AUTOMACAO_DE_RETORNO = { id: "demo-automacao-resposta-humana", nome: "Consulta ISP · resposta para humano" };

/** As preferências de escrita do provedor nos três perfis — o campo que o Painel mostra e o prompt final acrescenta. */
const PREFERENCIAS_DOS_PERFIS_DA_DEMO = "Seja cordial e objetivo. Trate o cliente pelo primeiro nome e, se ele pedir, passe a conversa para um atendente.";

export interface AgenteConfigDaDemo {
  agentes: Record<TipoDeAgente, AgenteDoChat>;
  primeiroContato: AutomacaoChat;
  modoAtendimento: "primeira_resposta_humana";
  respostaHumanaAutomacaoId: string;
}

/**
 * O `agenteConfig` da integração do sandbox: os três perfis PRONTOS, como
 * `provisionarAgenteDoChat` os deixa depois de aplicar cada um; a automação do
 * primeiro contato LIGADA (padrões da política: cobrança, 10 por dia, as duas
 * carteiras), porque o diário de envios da semeadura mostra contatos dos
 * últimos dias e "desligada" ao lado deles é a incoerência que a auditoria
 * achou; e a automação de retorno já resolvida para a semeada. Ligada não
 * envia nada: o worker não roda o primeiro contato na demonstração (Frente A).
 *
 * Objeto novo a cada chamada: quem grava pode mexer sem sujar a próxima.
 */
export function agenteConfigDaDemo(): AgenteConfigDaDemo {
  const agentes = Object.fromEntries(TIPOS_DE_AGENTE.map((tipo): [TipoDeAgente, AgenteDoChat] => [tipo, {
    ...CATALOGO_DE_AGENTES[tipo], tipo, id: AGENTES_DA_DEMO[tipo].id, modelo: AGENTES_DA_DEMO[tipo].modelo,
    nomeDaPersona: NOMES_DAS_FUNCIONARIAS_DA_DEMO[tipo], instrucoes: PREFERENCIAS_DOS_PERFIS_DA_DEMO, descricao: "", contextoOperacional: "", habilitado: true, temperatura: 0.3, maxTokens: 600,
    importadoDe: null, etapa: "pronto", erro: null, atualizadoEm: null, criacaoIniciada: false,
  }])) as Record<TipoDeAgente, AgenteDoChat>;
  return {
    agentes,
    primeiroContato: AutomacaoChatSchema.parse({ ligada: true }),
    modoAtendimento: "primeira_resposta_humana",
    respostaHumanaAutomacaoId: AUTOMACAO_DE_RETORNO.id,
  };
}

// ---------------------------------------------------------------------------
// Estado em memória do visitante
// ---------------------------------------------------------------------------

type Registro = Record<string, unknown> & { id: string };

interface EstadoDaOrganizacao {
  sequencia: number;
  /** Conversas abertas pelo visitante (`demo-conv-<providerId>-n<sufixo>`) — o contato e a abertura só existem aqui. */
  criadas: Map<string, Conversa>;
  /** Roteiro das conversas semeadas (com a rodada de cada fala da funcionária), congelado na primeira leitura. */
  roteiros: Map<string, FalaDoRoteiro[]>;
  /** Mensagens que o visitante mandou (e a abertura das conversas criadas), por conversa. */
  enviadas: Map<string, Mensagem[]>;
  /** Status que o visitante mudou (assumir, encerrar), por conversa. */
  status: Map<string, StatusConversa>;
  /** Agentes, tools, skills e automações: o catálogo semeado e o que o visitante criou. */
  colecoes: Map<string, Map<string, Registro>>;
  /** Ids do catálogo semeado — não contam no teto do que o visitante cria. */
  semeados: Set<string>;
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
    estado = { sequencia: 0, criadas: new Map(), roteiros: new Map(), enviadas: new Map(), status: new Map(), colecoes: new Map(), semeados: new Set() };
    // O catálogo nasce aqui, na primeira requisição da organização, e some com
    // ela: a limpeza e a varredura apagam o estado inteiro de uma vez.
    if (providerIdDaOrganizacao(org) !== null) semearCatalogo(org, estado, Date.now());
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
  // O instante da semeadura: `tentarCriarSandbox` grava o provedor e as
  // conversas com o mesmo `agora` — ver `roteiroCongelado`.
  semeadaEm: providers.createdAt,
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
  provedorNome: string; provedorFantasia: string | null; semeadaEm: Date | null; atendenteNome: string | null;
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

/**
 * Quem fala. `funcionaria` é a funcionária digital do perfil (Clara, Leonora ou Eduarda), com o nome dela — nunca
 * "assistente virtual" (spec 2026-09-16, D1). `equipe` é o atendente que abriu a conversa: entra DEPOIS de ela passar a
 * conversa com o aviso de transferência (§3.4), ou para encerrar pelo inbox.
 */
type Autor = "funcionaria" | "equipe" | "cliente";

/**
 * O que o servidor sabia quando deixou a funcionária escrever uma fala depois da identidade: a ação e a situação que
 * `verificarMensagens` recebe em produção (§6). Os FATOS (saldo, datas) não vão aqui — o teste os tira da própria linha
 * e do instante da fala, como o servidor os lê. A promessa leva só o dia do mês que o cliente disse ("no dia 20"): a
 * data inteira depende do instante da fala, que o roteiro só conhece depois de encaixar os horários.
 */
export interface RodadaDaFuncionaria {
  acao: AcaoDaRodada;
  situacao: SituacaoDaRodada;
  promessa?: { diaDoMes: number; gravada: boolean };
}

interface Passo { autor: Autor; texto: string; rodada?: RodadaDaFuncionaria }

/**
 * Uma cena: a conversa como ela anda e a fala da equipe quando a conversa foi ENCERRADA. O fecho é da cena, e não um
 * texto único: encerrar uma negociação não é "pagamento localizado", e encerrar uma contestação não é "recebemos o
 * equipamento".
 */
interface Cena { passos: Passo[]; fechoSeEncerrada: string }

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

const brl = (valor: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
const diaEMes = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

const doCliente = (texto: string): Passo => ({ autor: "cliente", texto });
const daEquipe = (texto: string): Passo => ({ autor: "equipe", texto });
const daFuncionaria = (texto: string, rodada: RodadaDaFuncionaria): Passo => ({ autor: "funcionaria", texto, rodada });
/** A primeira fala dela depois dos dígitos: o turno em que a identidade acabou de ser confirmada (§3.3). */
const logoDepoisDosDigitos = (texto: string) => daFuncionaria(texto, { acao: "responder", situacao: "identidade_recem_confirmada" });

/** Quem fala por cada conversa e o que a fala pode citar — lido uma vez da linha. */
interface VozDaCena {
  tipo: TipoDeAgente;
  carteira: "ativo" | "ex_cliente" | "equipamentos";
  persona: string;
  provedor: string;
  nomeDoCliente: string;
  /** O saldo que a funcionária cita, em centavos; `null` sem valor — ela não fala número que não leu. */
  saldoCentavos: number | null;
  conversationId: string;
  /** Os 4 últimos dígitos do CPF que o cliente manda: fictícios e fixos por conversa. */
  final: string;
}

function vozDaCena(l: LinhaDaConversa): VozDaCena {
  const tipo = perfilDaConversa(l);
  const seq = Number(/-(\d+)$/.exec(l.conversationId)?.[1] ?? 0);
  const centavos = Math.round(Number(l.casoValor ?? l.clienteDivida ?? 0) * 100);
  return {
    tipo,
    carteira: tipo === "recuperacao_equipamentos" ? "equipamentos" : tipo === "cobranca_ex_clientes" ? "ex_cliente" : "ativo",
    persona: NOMES_DAS_FUNCIONARIAS_DA_DEMO[tipo],
    provedor: l.provedorFantasia || l.provedorNome,
    nomeDoCliente: l.clienteNome,
    saldoCentavos: Number.isInteger(centavos) && centavos > 0 ? centavos : null,
    conversationId: l.conversationId,
    final: String(1000 + ((seq * 7919) % 9000)),
  };
}

/**
 * O começo da primeira fala dela depois dos dígitos: `confirmacaoDaIdentidade`, a MESMA função da reserva do servidor
 * nesse turno (§3.3) — obrigada pelo nome e, sem valor na frase, o assunto da carteira. Escrito à parte aqui, o roteiro
 * contava uma conversa que a produção não tinha (revisão final).
 */
const confirmacaoDaCena = (v: VozDaCena, comAssunto: boolean) =>
  confirmacaoDaIdentidade({ nomeDaPersona: v.persona, nomeDoCliente: v.nomeDoCliente, carteira: v.carteira }, { comAssunto });

/**
 * O relógio que escolhe a versão "dentro do horário" do aviso (quarta, 10h em São Paulo). O roteiro só põe fala do
 * provedor dentro da janela de contato (`encaixarNaJanela`), então "a equipe te responde a partir de…" nunca é a
 * verdade de uma fala semeada; nenhuma data deste instante entra na frase.
 */
const DENTRO_DA_JANELA = new Date("2026-09-16T13:00:00.000Z");

/**
 * O aviso de transferência é a frase do SERVIDOR (`avisoDeTransferencia`, §3.4), a mesma que sai em produção — sem
 * prazo prometido. A conversa segue com a equipe.
 */
function avisoDaFuncionaria(v: VozDaCena, categoria: CategoriaDeTransferencia, mensagemDoCliente: string): Passo {
  const baloes = avisoDeTransferencia(categoria, {
    nomeDaPersona: v.persona, nomeDoProvedor: v.provedor, nomeDoCliente: v.nomeDoCliente, identidadeConfirmada: true,
    agora: DENTRO_DA_JANELA, janela: POLITICA_PADRAO.janelaContato, ultimaMensagemDoCliente: mensagemDoCliente, carteira: v.carteira,
  }, { conversationId: v.conversationId });
  return daFuncionaria(baloes.join("\n\n"), { acao: "transferir", situacao: "conversa" });
}

/** D1: perguntada, ela confirma o atendimento automatizado, oferece alguém da equipe e segue — nunca nega. */
function confirmaAutomacao(v: VozDaCena): string {
  const nome = nomeDoProvedorSeguro(v.provedor);
  return `É um atendimento automatizado ${nome ? `da ${nome}` : "do seu provedor"}, com supervisão da nossa equipe. Se preferir falar com alguém da equipe, é só me dizer.`;
}

/**
 * Retirada de equipamento: a fala segue o status da recuperação — contestação e recolhimento nunca se misturam. A
 * funcionária não fala de valor, multa nem dívida (§6.14), e o modelo do aparelho fica com a equipe: "EG8145" é
 * número que ela não leu.
 */
function cenaDoEquipamento(l: LinhaDaConversa, v: VozDaCena, abertura: Passo): Cena {
  const aparelho = [l.equipamentoMarca, l.equipamentoModelo].filter(Boolean).join(" ") || l.equipamentoTipo || "";
  const oAparelho = aparelho ? `o ${aparelho}` : "o equipamento";
  // O aparelho só aparece DEPOIS da identidade: na abertura, ele revelaria o contrato a quem recebeu o número reciclado.
  const assunto = `${confirmacaoDaCena(v, true)} Fica melhor alguém buscar aí ou você prefere entregar na loja?`;
  if (l.recuperacaoStatus === "contestado") {
    const devolvi = "Esse aparelho eu já devolvi na loja.";
    return {
      passos: [
        abertura,
        doCliente(`Sou eu, final ${v.final}. Do que se trata?`),
        logoDepoisDosDigitos(assunto),
        doCliente(devolvi),
        avisoDaFuncionaria(v, "devolucao_informada", devolvi),
        daEquipe(`Você ainda tem o comprovante da devolução d${oAparelho}?`),
        doCliente("Não achei o papel, mas entreguei na loja do centro."),
        daEquipe("Vou conferir o registro da devolução na loja e te retorno por aqui."),
      ],
      fechoSeEncerrada: "Tudo bem. Vamos conferir o registro da devolução na loja; vou encerrar este atendimento e te avisamos por aqui quando concluir.",
    };
  }
  // A equipe combina a retirada e registra a recuperação (o papel do perfil): a funcionária passa a conversa.
  const podeBuscar = "Pode vir buscar, sim. Durante a semana, depois das 18h.";
  const inicio: Passo[] = [
    abertura,
    doCliente(`Sou eu, final ${v.final}.`),
    logoDepoisDosDigitos(assunto),
    doCliente(podeBuscar),
    avisoDaFuncionaria(v, "generica", podeBuscar),
  ];
  const combinado = `Combinado: o técnico passa depois das 18h para retirar ${oAparelho}. É só entregar o aparelho com a fonte.`;
  if (l.recuperacaoStatus === "nova_tentativa") {
    // A linha do tempo registra a visita frustrada (ninguém em casa no horário
    // combinado): a conversa conta essa visita e o novo horário, e não para no
    // "qual o melhor dia" de quem nunca agendou.
    return {
      passos: [
        ...inicio,
        daEquipe(combinado),
        daEquipe("O técnico passou no horário combinado e não encontrou ninguém em casa. Podemos marcar uma nova tentativa? Qual dia fica melhor para você?"),
        doCliente("Desculpe, tive um imprevisto naquele dia. Pode ser outro dia, no fim da tarde?"),
        daEquipe("Pode, sim: vou pedir a nova tentativa para o fim da tarde e te confirmo o dia por aqui."),
      ],
      fechoSeEncerrada: "Vou encerrar este atendimento por aqui; para marcar a nova tentativa de retirada, é só chamar.",
    };
  }
  if (l.recuperacaoStatus === "concluido") {
    return {
      passos: [...inicio, daEquipe(combinado), doCliente("O técnico passou hoje e levou o aparelho."), daEquipe("Recebemos o equipamento, obrigado!")],
      fechoSeEncerrada: "Recebemos o equipamento, obrigado! Vou encerrar este atendimento.",
    };
  }
  const fecho: Record<string, string> = {
    agendado: `Agendado: o técnico passa${l.recuperacaoAgendadaEm ? ` no dia ${diaEMes(l.recuperacaoAgendadaEm)}` : ""} depois das 18h para retirar ${oAparelho}. É só entregar o aparelho com a fonte.`,
    notificacao_formal: "Como não conseguimos combinar a retirada, enviamos a notificação formal de devolução. Ainda dá para agendar por aqui.",
  };
  return {
    passos: [...inicio, daEquipe(fecho[l.recuperacaoStatus ?? ""] ?? "Perfeito, vou ver a agenda do técnico e te passo as opções.")],
    fechoSeEncerrada: "Vou encerrar este atendimento por aqui; para agendar a retirada, é só chamar.",
  };
}

/**
 * Cobrança: a fala segue o STATUS do caso (e, sem caso, a etapa da régua para
 * os dias de atraso) — é o que o kanban, a ficha e a linha do tempo mostram do
 * mesmo cliente. O ex-cliente muda o assunto e o jeito de falar do valor.
 *
 * A funcionária confirma a identidade, diz o assunto — com valor só quando o
 * cliente pergunta (§3.3) — e, no que é da equipe (negociação, contestação,
 * pagamento informado, PIX que o simulado não tem), passa a conversa com o
 * aviso. Ela anota sozinha a promessa de valor integral com o dia dito pelo
 * cliente, como a autonomia faz.
 */
function cenaDaCobranca(l: LinhaDaConversa, v: VozDaCena, abertura: Passo): Cena {
  const ex = v.carteira === "ex_cliente";
  const valor = brl(Number(l.casoValor ?? l.clienteDivida ?? 0));
  const dias = l.clienteDias || l.casoDias || 0;
  // Fala da EQUIPE: o atendente cita o que o caso mostra, dias de atraso inclusive.
  const oValor = ex
    ? `ficou um valor de ${valor} da fatura de saída, de antes do cancelamento`
    : `consta uma fatura de ${valor} em aberto${dias > 0 ? ` há ${dias} dias` : ""}`;
  // Fala da FUNCIONÁRIA: obrigada e o assunto sem número — ou obrigada e o saldo, com a frase que o servidor usa para "informar a dívida".
  const assunto = confirmacaoDaCena(v, true);
  const saldo = v.saldoCentavos ? formatarReais(v.saldoCentavos) : null;
  const comValor = !saldo ? assunto : `${confirmacaoDaCena(v, false)} ${ex ? `Do contrato que foi encerrado, ficou ${saldo} em aberto.` : `Tem ${saldo} em aberto aqui com a gente.`}`;

  switch (l.casoStatus) {
    case "pago": {
      const paguei = "Já paguei hoje cedo, segue o comprovante.";
      return {
        passos: [
          abertura,
          doCliente(`Sou eu, final ${v.final}.`),
          logoDepoisDosDigitos(`${assunto} Se quiser, posso te mandar a segunda via, ou a gente combina um dia pra você pagar. Como prefere?`),
          doCliente(paguei),
          avisoDaFuncionaria(v, "pagamento_informado", paguei),
          daEquipe("Pagamento localizado, obrigado!"),
        ],
        fechoSeEncerrada: "Pagamento localizado, obrigado! Vou encerrar este atendimento.",
      };
    }
    case "negativado": {
      const naoVouPagar = "Não concordo com esse valor e não vou pagar agora.";
      return {
        passos: [
          abertura,
          doCliente(`Sou eu, final ${v.final}. Do que se trata?`),
          logoDepoisDosDigitos(`${assunto} Podemos ver juntos uma forma de resolver?`),
          doCliente(naoVouPagar),
          avisoDaFuncionaria(v, "contestacao", naoVouPagar),
          // O registro nos órgãos de proteção ao crédito é da equipe: a funcionária nunca fala nisso (§6.5).
          daEquipe(`Entendido, registrei a sua posição. Para constar: por essa pendência de ${valor}, o seu CPF está registrado nos órgãos de proteção ao crédito. Se quiser rever, vemos uma forma de quitar e pedir a baixa do registro; é só chamar por aqui.`),
        ],
        fechoSeEncerrada: "Entendido, registrei a sua posição e vou encerrar este atendimento. Se quiser rever, é só chamar por aqui.",
      };
    }
    case "negociando":
    case "acordo_ativo": {
      const fechado = l.casoStatus === "acordo_ativo";
      const tresVezes = "Se fosse em três vezes eu conseguiria.";
      return {
        passos: [
          abertura,
          doCliente(`Sou eu, final ${v.final}. Sei que estou devendo, mas não consigo pagar tudo de uma vez.`),
          logoDepoisDosDigitos(`${comValor} O que fica melhor pra você resolver?`),
          doCliente(tresVezes),
          // Parcelar é negociação: sem as ofertas do servidor, ela não fala em condição nenhuma (§6.7) e passa.
          avisoDaFuncionaria(v, "generica", tresVezes),
          daEquipe(fechado ? "Consultei a política e te mandei a proposta aqui. Confere e me diz se podemos registrar." : "Vou montar a proposta dentro da política e te envio aqui para você conferir antes de confirmar."),
          doCliente(fechado ? "Conferi. Pode registrar, obrigado." : "Tá bom, fico aguardando."),
          daEquipe(fechado ? "Acordo registrado. Te mando o boleto por aqui; qualquer dúvida, é só chamar." : "Proposta enviada. Assim que você confirmar, registro o acordo."),
        ],
        fechoSeEncerrada: fechado
          ? "Acordo registrado. Te mando o boleto por aqui e vou encerrar este atendimento; qualquer dúvida, é só chamar."
          : "Proposta enviada. Vou encerrar este atendimento; quando quiser confirmar, é só chamar por aqui.",
      };
    }
    case "em_contato":
      if (ex) {
        const detalhe = "Achei que estava tudo pago. Pode me mandar o detalhe dessa fatura?";
        return {
          passos: [
            abertura,
            doCliente(`Sou eu, final ${v.final}. Isso é robô? Cancelei a internet faz tempo.`),
            logoDepoisDosDigitos(`${confirmaAutomacao(v)}\n\n${assunto} Podemos ver uma forma de resolver que caiba pra você?`),
            doCliente(detalhe),
            avisoDaFuncionaria(v, "contestacao", detalhe),
            daEquipe("Mando sim: a fatura, o período de uso e o vencimento."),
          ],
          fechoSeEncerrada: "Mando sim: a fatura, o período de uso e o vencimento. Vou encerrar este atendimento; depois de conferir, é só chamar por aqui.",
        };
      }
      return {
        passos: [
          abertura,
          doCliente(`Sou eu, final ${v.final}. É sobre a fatura atrasada? Quanto ficou?`),
          logoDepoisDosDigitos(`${comValor} Se ficar melhor, a gente combina um dia pra você pagar. Qual dia seria bom?`),
          doCliente("Consigo pagar no dia 20, quando recebo."),
          // A promessa de valor integral com o dia dito pelo cliente: ela pergunta, o cliente confirma, o servidor grava.
          daFuncionaria(saldo ? `Posso anotar o pagamento de ${saldo} pro dia 20?` : "Posso anotar o pagamento pro dia 20?", { acao: "promessa", situacao: "conversa", promessa: { diaDoMes: 20, gravada: false } }),
          doCliente("Pode, obrigado."),
          daFuncionaria(
            saldo ? `Anotado! Pagamento de ${saldo} pro dia 20. Até o pagamento ser confirmado, o valor continua em aberto.` : "Anotado! Pagamento pro dia 20.",
            { acao: "responder", situacao: "promessa_registrada", promessa: { diaDoMes: 20, gravada: true } },
          ),
        ],
        fechoSeEncerrada: "Vou encerrar este atendimento por aqui. Se precisar da segunda via antes do dia 20, é só chamar.",
      };
  }

  // Sem caso (ou caso ainda aberto): a etapa da régua para os dias de atraso
  // decide o tom — "esquecimento" só vale no lembrete (até 14 dias); depois
  // disso a conversa é de negociação.
  if (!ex && etapaParaAtraso(dias, "ativo").etapa?.id === "lembrete_atraso") {
    const pix = "Nossa, passou batido. Manda o PIX, por favor.";
    return {
      passos: [
        abertura,
        doCliente(`Oi, sou eu sim, final ${v.final}. É sobre a mensalidade? Quanto ficou?`),
        logoDepoisDosDigitos(`${comValor} Pode ter sido só um esquecimento. Se quiser, posso te mandar a segunda via, é só me dizer.`),
        doCliente(pix),
        // A segunda via só sai com o instrumento que o ERP devolve, e o simulado não tem ERP: sem ele, a equipe gera.
        avisoDaFuncionaria(v, "generica", pix),
        daEquipe("Claro! Vou gerar o PIX e te mando aqui em seguida."),
      ],
      fechoSeEncerrada: "Claro! Te mandei o PIX aqui e vou encerrar este atendimento.",
    };
  }
  const parcelar = "Estou apertado este mês. Tem como parcelar?";
  return {
    passos: [
      abertura,
      doCliente(`Oi, sou eu sim, final ${v.final}. Aconteceu alguma coisa?`),
      logoDepoisDosDigitos(`${assunto} Podemos ver juntos uma forma de resolver?`),
      doCliente(parcelar),
      avisoDaFuncionaria(v, "generica", parcelar),
      daEquipe(`${maiuscula(oValor)}. Vou ver as condições que a política permite e te envio a proposta aqui para você conferir.`),
    ],
    fechoSeEncerrada: "Vou ver as condições que a política permite e te envio a proposta aqui. Vou encerrar este atendimento; quando quiser seguir, é só chamar.",
  };
}

/**
 * Os passos da conversa. Conversa do ROBÔ (BOT) é só a abertura automática:
 * ninguém respondeu — é o que a linha do tempo grava dela (contato sem
 * resultado, tentativa sem resposta, sem usuário).
 *
 * A abertura é a do SERVIDOR, a mesma que a ponte manda (spec 2026-09-16,
 * §3.1): a funcionária se apresenta e pede os 4 últimos dígitos do CPF, sem
 * assunto, contrato, equipamento nem valor. A primeira resposta do cliente traz
 * os dígitos, e só DEPOIS dela a conversa fala do assunto (D10). Cada turno sai
 * numa mensagem só, com os balões separados por linha em branco — como pelo
 * envio comum; o lote do agente (vps/010) não existe no simulado.
 *
 * Encerrada: o atendente fecha pelo inbox. O fecho da cena troca a última fala
 * da equipe; se a última fala é da funcionária (a promessa que ela anotou), vem
 * depois dela.
 */
function passosDaCena(l: LinhaDaConversa): Passo[] {
  const status = statusDaLinha(l.status);
  const v = vozDaCena(l);
  const abertura: Passo = { autor: "funcionaria", texto: aberturaDaDemo(v.tipo, l.clienteNome, v.provedor, l.conversationId) };
  if (status === "BOT") return [abertura];

  const cena = l.origem === "equipamentos" ? cenaDoEquipamento(l, v, abertura) : cenaDaCobranca(l, v, abertura);
  if (status !== "CLOSED") return cena.passos;
  const fecho = daEquipe(cena.fechoSeEncerrada);
  return cena.passos.at(-1)?.autor === "equipe" ? [...cena.passos.slice(0, -1), fecho] : [...cena.passos, fecho];
}

/**
 * A abertura da funcionária na demonstração: `textoPreIdentidade("abertura")` com o nome da funcionária do perfil
 * (sem perfil, fala a equipe do provedor), os dois balões numa fala só, separados por linha em branco. Exportada para o
 * teste passar cada balão pelo verificador de pré-identidade.
 */
export function aberturaDaDemo(tipo: TipoDeAgente | null, nomeDoCliente: string | null, nomeDoProvedor: string | null, conversationId: string): string {
  const nomeDaPersona = tipo ? NOMES_DAS_FUNCIONARIAS_DA_DEMO[tipo] : null;
  return textoPreIdentidade("abertura", { nomeDaPersona, nomeDoProvedor, nomeDoCliente, funcionariaJaFalou: false }, { conversationId }).join("\n\n");
}

/** O nome com que a funcionária da conversa assina as falas dela (`senderName`). */
export function funcionariaDaConversa(l: LinhaDaConversa): string {
  return NOMES_DAS_FUNCIONARIAS_DA_DEMO[perfilDaConversa(l)];
}

/**
 * A janela de contato da política, hora a hora. `janelaDoChat` é a regra que
 * segura o primeiro contato do worker (fuso de São Paulo, sábado até 14h,
 * nunca domingo nem feriado), aqui com a janela PADRÃO da política
 * compartilhada. Ela decide pela hora cheia — São Paulo não tem horário de
 * verão —, então a resposta vale para a hora inteira e fica memorizada: um
 * roteiro consulta dezenas de horas, e cada chamada monta um
 * `Intl.DateTimeFormat` (~0,2 ms), o que pesaria na semeadura do sandbox.
 */
const janelaPorHora = new Map<number, boolean>();

function podeFalar(ms: number): boolean {
  const hora = Math.floor(ms / HORA);
  let permitida = janelaPorHora.get(hora);
  if (permitida === undefined) {
    if (janelaPorHora.size >= 50_000) janelaPorHora.clear();
    permitida = janelaDoChat(new Date(hora * HORA), POLITICA_PADRAO.janelaContato).permitida;
    janelaPorHora.set(hora, permitida);
  }
  return permitida;
}

/** Duas semanas: mais do que qualquer fim de semana emendado com feriado. */
const BUSCA_MAXIMA_HORAS = 14 * 24;

/** O primeiro instante permitido a partir de `ms` (ele mesmo, se já é). */
function proximoNaJanela(ms: number): number {
  let t = ms;
  for (let i = 0; i < BUSCA_MAXIMA_HORAS && !podeFalar(t); i++) t = (Math.floor(t / HORA) + 1) * HORA;
  return t;
}

/** O último instante permitido até `ms` (ele mesmo, se já é): o minuto final da hora permitida anterior. */
function anteriorNaJanela(ms: number): number {
  let t = ms;
  for (let i = 0; i < BUSCA_MAXIMA_HORAS && !podeFalar(t); i++) t = Math.floor(t / HORA) * HORA - MINUTO;
  return t;
}

/**
 * Os horários de cada fala dentro de `[piso, teto]`, em ordem, com um minuto
 * entre uma e outra, e as falas do provedor só em hora permitida. A ida acha o
 * mais cedo possível de cada fala e a volta o mais tarde; se algum "mais cedo"
 * passa do "mais tarde", não cabe (`null`). Cabendo, cada fala fica o mais
 * perto possível do horário repartido — o cliente só se move quando a equipe
 * precisa passar por ele.
 */
function encaixarNaJanela(horarios: number[], doProvedor: boolean[], piso: number[], teto: number[]): number[] | null {
  const n = horarios.length;
  const cedo: number[] = [];
  for (let i = 0; i < n; i++) {
    let t = i === 0 ? piso[0] : Math.max(piso[i], cedo[i - 1] + MINUTO);
    if (doProvedor[i]) t = proximoNaJanela(t);
    if (doProvedor[i] && !podeFalar(t)) return null;
    cedo.push(t);
  }
  const tarde: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let t = i === n - 1 ? teto[i] : Math.min(teto[i], tarde[i + 1] - MINUTO);
    if (doProvedor[i]) t = anteriorNaJanela(t);
    if (t < cedo[i] || (doProvedor[i] && !podeFalar(t))) return null;
    tarde[i] = t;
  }
  const encaixados: number[] = [];
  for (let i = 0; i < n; i++) {
    const de = i === 0 ? cedo[0] : Math.max(cedo[i], encaixados[i - 1] + MINUTO);
    let t = Math.min(Math.max(horarios[i], de), tarde[i]);
    if (doProvedor[i] && !podeFalar(t)) {
      // `tarde[i]` é permitido e vem depois de `t`: o próximo instante permitido nunca passa dele.
      const depois = proximoNaJanela(t);
      const antes = anteriorNaJanela(t);
      t = antes >= de && t - antes <= depois - t ? antes : depois;
    }
    encaixados.push(t);
  }
  return encaixados;
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
 * Quem fala pelo provedor (funcionária e equipe) só fala dentro da janela de
 * contato da política; o cliente escreve quando quer. A auditoria achou a
 * equipe às 00:21 e às 04:21, com a tela anunciando a janela logo abaixo. Se a
 * vida da conversa não tem hora permitida bastante (aberta de madrugada, fim
 * de semana), o fim pode chegar até agora e, se ainda faltar, o começo recua;
 * a regra de 24 h do status não afrouxa nunca. A semeadura grava o evento de
 * contato no instante da última fala da equipe calculado AQUI: ela chama esta
 * função, nunca refaz a regra.
 *
 * Exportada para o teste da semeadura cruzar o texto com o caso e a
 * recuperação que o sandbox grava.
 */
export function roteiroDaConversa(linha: LinhaDaConversa, agora: number, antesDe = Number.POSITIVE_INFINITY): Mensagem[] {
  return falasDoRoteiro(linha, agora, antesDe).map(f => f.mensagem);
}

/** Uma mensagem do roteiro e, quando é da funcionária depois da identidade, a rodada em que ela a escreveu. */
export interface FalaDoRoteiro { mensagem: Mensagem; rodada: RodadaDaFuncionaria | null }

/**
 * O roteiro com a rodada de cada fala da funcionária: as execuções do console
 * leem dela quem passou a conversa, e o teste do §10 passa cada fala pelo
 * verificador com a ação e a situação da rodada (`roteiroDaConversa` é esta
 * lista sem as rodadas).
 */
export function falasDoRoteiro(linha: LinhaDaConversa, agora: number, antesDe = Number.POSITIVE_INFINITY): FalaDoRoteiro[] {
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
    passos = passos.slice(0, passos.map(p => p.autor).lastIndexOf("cliente") + 1);
  } else if (Math.min(abertaEm, fim) > limite) {
    // Parada e aberta há menos de 25 h: não houve tempo de o cliente responder há mais de 24 h — só a abertura.
    passos = passos.slice(0, 1);
  }

  const n = passos.length;
  // Nunca antes de a conversa existir; `fim` só fica antes de `abertaEm` numa linha semeada incoerente.
  const inicio = Math.min(abertaEm, fim);
  const ultimaDoCliente = passos.map(p => p.autor).lastIndexOf("cliente");
  let horarios = repartir(inicio, fim, n);
  if (!ativa && ultimaDoCliente >= 0 && horarios[ultimaDoCliente] > limite) {
    horarios = [...repartir(inicio, limite, ultimaDoCliente + 1), ...repartir(limite, fim, n - ultimaDoCliente).slice(1)];
  }

  // A regra de 24 h vira limite da fala: a ÚLTIMA do cliente de uma ativa fica
  // nas últimas 24 h; a última do cliente de uma parada, antes de 25 h atrás.
  const doProvedor = passos.map(p => p.autor !== "cliente");
  const encaixar = (piso: number, teto: number) => encaixarNaJanela(
    horarios,
    doProvedor,
    passos.map((_, i) => (ativa && i === n - 1 ? Math.max(piso, agora - 24 * HORA + MINUTO) : piso)),
    passos.map((_, i) => (!ativa && i === ultimaDoCliente ? Math.min(teto, limite) : teto)),
  );
  const tetoDuro = Math.min(agora, antesDe - MINUTO);
  horarios = encaixar(inicio, fim) ?? encaixar(inicio, tetoDuro) ?? encaixar(inicio - BUSCA_MAXIMA_HORAS * HORA, tetoDuro) ?? horarios;

  const provedor = linha.provedorFantasia || linha.provedorNome;
  const funcionaria = funcionariaDaConversa(linha);
  return passos.map(({ autor, texto, rodada }, i): FalaDoRoteiro => {
    const doCliente = autor === "cliente";
    const respondida = passos.slice(i + 1).some(p => p.autor === "cliente");
    return {
      mensagem: {
        id: `demo-msg-${linha.conversationId}-${i + 1}`,
        direction: doCliente ? "INBOUND" : "OUTBOUND",
        type: "TEXT",
        content: { text: texto },
        status: doCliente ? (ativa && i === n - 1 ? "DELIVERED" : "READ") : respondida ? "READ" : "DELIVERED",
        ...(doCliente ? {} : { senderName: autor === "funcionaria" ? funcionaria : linha.atendenteNome || `Equipe ${provedor}` }),
        createdAt: new Date(Math.round(horarios[i])).toISOString(),
      },
      rodada: rodada ?? null,
    };
  });
}

/**
 * O roteiro da conversa no instante da SEMEADURA (`semeadaEm`, o `createdAt`
 * do provedor que `tentarCriarSandbox` grava com o mesmo `agora` das
 * conversas): o histórico, as execuções e o resumo leem o mesmo.
 *
 * Até 13/09/2026 o instante era o `Date.now()` da primeira leitura, guardado
 * num `Map` que zera quando a API reinicia. A semeadura grava o contato da
 * última fala da equipe com o `agora` da criação; aberta horas depois, a
 * conversa pendente movia o fim para perto do novo agora, e a equipe aparecia
 * no chat numa hora que a linha do tempo do caso não tinha (revisão da fase B:
 * 3 de 16 conversas mudavam com +20 h). A regra de 24 h vale a partir da
 * semeadura; depois dela, o relógio é o do visitante — a janela do WhatsApp se
 * fecha como fecharia de verdade. O `Map` fica só como memória de cálculo.
 */
function roteiroCongelado(estado: EstadoDaOrganizacao, linha: LinhaDaConversa, antesDe?: number): FalaDoRoteiro[] {
  let roteiro = estado.roteiros.get(linha.conversationId);
  if (!roteiro) {
    roteiro = falasDoRoteiro(linha, linha.semeadaEm ? new Date(linha.semeadaEm).getTime() : Date.now(), antesDe);
    estado.roteiros.set(linha.conversationId, roteiro);
  }
  return roteiro;
}

// ---------------------------------------------------------------------------
// O catálogo semeado do console
// ---------------------------------------------------------------------------

const DIA = 24 * HORA;

/**
 * A conexão dos perfis com a API do agente, no endereço que a ponte usa em
 * produção (`urlDaApiDoAgente` fora da demonstração). Só registro: o simulado
 * não chama skill nenhuma.
 *
 * AIDEV-QUESTION: na demonstração o console só marca `daPonte` a conexão cuja
 * base é o `urlDaApiDoAgente()` da demo (o host `.invalid` do simulado) e só
 * libera esse host (`hostsPermitidosDasTools`). Esta conexão aparece então
 * editável, e salvar a edição é recusado com "Host não liberado", citando o
 * host do simulado. Marcar como da ponte ou liberar consultaisp.com.br na
 * demonstração é mudança em chat-console.service.ts, fora deste pacote.
 */
const TOOL_DA_DEMO = {
  id: "demo-tool-consulta-isp",
  name: "API do Consulta ISP",
  description: "Conexão dos perfis de cobrança e de equipamentos com o caso do cliente no Consulta ISP.",
  httpBaseUrl: "https://consultaisp.com.br/api/chat-bullq/agente",
};

/**
 * As skills que o prompt dos perfis cita pelo nome (o console as marca como da
 * ponte, `SKILLS_DA_PONTE`), com as rotas que a API do agente de fato tem
 * (`chat-bullq-agente.routes.ts`). Nenhuma inventada: "agendar retirada" e
 * "segunda via" não têm rota lá, e uma skill sem rota seria promessa da tela.
 */
const SKILLS_DA_DEMO = [
  { name: "consultarCaso", description: "Lê o caso do cliente no Consulta ISP — valor, vencimento e etapa da régua — antes de citar qualquer informação do contrato.", category: "cobrança", httpMethod: "GET", httpPath: "/caso" },
  { name: "registrarPromessa", description: "Registra no caso a promessa de pagamento com o valor integral e a data que o cliente confirmou.", category: "cobrança", httpMethod: "POST", httpPath: "/promessa" },
  { name: "registrarTransferencia", description: "Passa a conversa para a equipe e registra no caso o motivo e um resumo factual do que o cliente disse.", category: "atendimento", httpMethod: "POST", httpPath: "/transferencia" },
  { name: "consultarEquipamento", description: "Lê a devolução de equipamento pendente do cliente — aparelho, prazo e retirada combinada, sem valor — antes de combinar qualquer coisa.", category: "equipamentos", httpMethod: "GET", httpPath: "/equipamento" },
] as const;

type NomeDaSkillDaDemo = (typeof SKILLS_DA_DEMO)[number]["name"];

const idDaSkillDaDemo = (nome: NomeDaSkillDaDemo) => `demo-skill-${nome}`;

/** Equipamento não registra promessa nem lê dívida: a conversa dele é devolução, e a leitura é a do caso de equipamento. */
const SKILLS_DO_PERFIL: Record<TipoDeAgente, NomeDaSkillDaDemo[]> = {
  cobranca_ativos: ["consultarCaso", "registrarPromessa", "registrarTransferencia"],
  cobranca_ex_clientes: ["consultarCaso", "registrarPromessa", "registrarTransferencia"],
  recuperacao_equipamentos: ["consultarEquipamento", "registrarTransferencia"],
};

/** O `systemPrompt` que o console mostra: papel do perfil e as regras que citam as skills. Sem nome de provedor — o catálogo não lê o banco. */
function promptDoPerfilDaDemo(tipo: TipoDeAgente): string {
  return [
    `Você é a ${NOMES_DAS_FUNCIONARIAS_DA_DEMO[tipo]} e atende pelo provedor, na primeira pessoa da empresa. Papel: ${CATALOGO_DE_AGENTES[tipo].nome}. Perguntada, confirme que o atendimento é automatizado, com supervisão da equipe.`,
    CATALOGO_DE_AGENTES[tipo].papel,
    "O que é da equipe — negociação, contestação, pagamento ou devolução informados, pedido de falar com alguém — você passa: chame registrarTransferencia com o motivo e um resumo factual, e deixe a conversa com a equipe.",
    tipo === "recuperacao_equipamentos"
      ? "Antes de combinar qualquer coisa, consulte consultarEquipamento. Não fale em valor do aparelho, multa ou dívida; não prometa dia, horário ou técnico por conta própria."
      : "Antes de citar qualquer informação do contrato, consulte consultarCaso. Não invente valores, PIX, links, descontos, prazos nem promessas.",
  ].join("\n");
}

/**
 * Semeia o catálogo da organização: os três perfis (parados e DISABLED no
 * canal, como `provisionarAgenteDoChat` os deixa — criar não é ligar), as
 * skills ligadas a eles, a conexão e a automação de retorno. Determinístico: o
 * único relógio é o `agora` da requisição reduzido ao dia, então limpar e
 * semear de novo no mesmo dia devolve o mesmo catálogo.
 */
function semearCatalogo(org: string, estado: EstadoDaOrganizacao, agora: number): void {
  // Um mês antes de hoje: antes de toda conversa semeada, que não passa de dez dias.
  const quando = new Date(Math.floor(agora / DIA) * DIA - 30 * DIA).toISOString();
  const guardar = (nome: string, registro: Registro) => {
    colecaoDoEstado(estado, nome).set(registro.id, { ...registro, organizationId: org, createdAt: quando, updatedAt: quando });
    estado.semeados.add(registro.id);
  };
  guardar("tools", { ...TOOL_DA_DEMO, source: "CUSTOM_HTTP", httpHeaders: {}, isActive: true });
  for (const s of SKILLS_DA_DEMO) {
    guardar("skills", {
      ...s, id: idDaSkillDaDemo(s.name), promptInstructions: null, source: "HTTP", parameters: { type: "object", properties: {} },
      toolId: TOOL_DA_DEMO.id, httpBodyTemplate: null, timeoutMs: 10_000, currentVersion: 1, isActive: true,
    });
  }
  for (const tipo of TIPOS_DE_AGENTE) {
    const a = AGENTES_DA_DEMO[tipo];
    guardar("agentes", {
      id: a.id, name: a.nome, description: CATALOGO_DE_AGENTES[tipo].papel, kind: "WORKER", category: tipo === "recuperacao_equipamentos" ? "equipamentos" : "cobrança",
      capabilities: [tipo, "primeiro_contato_sem_envio", "autonomia_cobranca_controlada"], modelId: a.modelo, systemPrompt: promptDoPerfilDaDemo(tipo),
      operationalContext: null, temperature: 0.3, maxTokens: 600, canRespondDirectly: false, isActive: false, parentAgentId: null, department: "COBRANCA", squad: null,
      channels: [{ id: `demo-vinculo-${a.id}-${CANAL_DA_DEMO.id}`, channelId: CANAL_DA_DEMO.id, mode: "DISABLED", trigger: "ALWAYS", channel: { name: CANAL_DA_DEMO.name } }],
      skills: SKILLS_DO_PERFIL[tipo].map(nome => ({ skillId: idDaSkillDaDemo(nome), requiresApproval: false, skill: { name: nome } })),
    });
  }
  // A ponte ADOTA esta automação quando o `agenteConfig` ainda não tem o id, então
  // ela carrega o mesmo webhook local e inerte que a ponte gravaria na demonstração
  // (`urlDoWebhookDeVolta`) — nunca um endereço de produção.
  guardar("automacoes", {
    id: AUTOMACAO_DE_RETORNO.id, name: AUTOMACAO_DE_RETORNO.nome, description: "Devolve ao Consulta ISP a primeira resposta do cliente, que entra na fila da equipe.",
    trigger: "MESSAGE_RECEIVED", conditions: null, actions: [{ type: "call_webhook", params: { url: `${URL_DO_CHAT_SIMULADO}/api/webhooks/chat-bullq` } }], enabled: true,
  });
}

// ---------------------------------------------------------------------------
// Execuções e resumo do console, contados das conversas semeadas
// ---------------------------------------------------------------------------

interface Execucao {
  id: string; agentId: string; conversationId: string; modelId: string;
  status: "COMPLETED" | "SKIPPED"; finalAction: "REPLIED" | "TRANSFERRED_TO_HUMAN" | "NO_ACTION"; errorMessage: null;
  inputTokens: number; outputTokens: number; costUsd: number; durationMs: number; startedAt: string;
  agent: { name: string };
  toolCalls: Array<{ id: string; toolName: string; error: null; durationMs: number; output: { ok: true } }>;
}

const PERIODOS_EM_MS: Record<string, number> = { "24h": DIA, "7d": 7 * DIA, "30d": 30 * DIA };

/** O perfil que fala com o cliente da conversa: equipamento, ex-cliente ou cliente ativo. */
function perfilDaConversa(l: LinhaDaConversa): TipoDeAgente {
  if (l.origem === "equipamentos") return "recuperacao_equipamentos";
  return l.casoCarteira === "ex_cliente" ? "cobranca_ex_clientes" : "cobranca_ativos";
}

/** US$ 0,15 por milhão de tokens de entrada e US$ 0,60 de saída (gpt-4o-mini), no micro-dólar: a soma do resumo bate com a lista. */
const custoEmUsd = (entrada: number, saida: number) => Math.round(entrada * 0.15 + saida * 0.6) / 1e6;

/**
 * As execuções de UMA conversa, lidas do roteiro dela. A abertura da
 * funcionária é uma execução concluída ("respondeu"). Cada mensagem do cliente
 * que ela responde é outra: dentro da janela de contato a execução é concluída
 * — "passou para a equipe" quando a resposta é o aviso de transferência, com a
 * chamada de `registrarTransferencia`, e "respondeu" nas outras —; fora da
 * janela ela é pulada sem chamar o modelo, e a resposta sai quando a janela
 * abre, que é o que o roteiro mostra. Mensagem do cliente que a equipe responde
 * não é execução. Tokens, custo e tempo são fixos pela posição.
 */
function execucoesDaConversa(l: LinhaDaConversa, falas: FalaDoRoteiro[]): Execucao[] {
  const funcionaria = funcionariaDaConversa(l);
  const abertura = falas[0]?.mensagem;
  if (!abertura || abertura.direction !== "OUTBOUND" || abertura.senderName !== funcionaria) return [];
  const seq = Number(/-(\d+)$/.exec(l.conversationId)?.[1] ?? 0);
  const perfil = AGENTES_DA_DEMO[perfilDaConversa(l)];
  const comum = { agentId: perfil.id, conversationId: l.conversationId, modelId: perfil.modelo, errorMessage: null, agent: { name: perfil.nome } };
  const entrada = 1100 + ((seq * 37) % 300);
  const saida = 40 + ((seq * 11) % 30);
  const execucoes: Execucao[] = [{
    ...comum, id: `demo-run-${l.conversationId}-abertura`, status: "COMPLETED", finalAction: "REPLIED",
    inputTokens: entrada, outputTokens: saida, costUsd: custoEmUsd(entrada, saida), durationMs: 900 + ((seq * 53) % 700), startedAt: abertura.createdAt, toolCalls: [],
  }];
  falas.forEach(({ mensagem: doCliente }, i) => {
    const dela = falas[i + 1];
    if (doCliente.direction !== "INBOUND" || !dela?.rodada || dela.mensagem.senderName !== funcionaria) return;
    const id = `demo-run-${l.conversationId}-resposta-${i + 1}`;
    if (!podeFalar(Date.parse(doCliente.createdAt))) {
      execucoes.push({ ...comum, id, status: "SKIPPED", finalAction: "NO_ACTION", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 8 + ((seq + i) % 10), startedAt: doCliente.createdAt, toolCalls: [] });
      return;
    }
    const transferiu = dela.rodada.acao === "transferir";
    const entradaDaResposta = 1600 + ((seq * 29 + i * 61) % 500);
    const saidaDaResposta = 70 + ((seq * 17 + i * 13) % 60);
    execucoes.push({
      ...comum, id, status: "COMPLETED", finalAction: transferiu ? "TRANSFERRED_TO_HUMAN" : "REPLIED",
      inputTokens: entradaDaResposta, outputTokens: saidaDaResposta, costUsd: custoEmUsd(entradaDaResposta, saidaDaResposta),
      durationMs: 1400 + ((seq * 71 + i * 97) % 900), startedAt: doCliente.createdAt,
      toolCalls: transferiu ? [{ id: `${id}-registrarTransferencia`, toolName: "registrarTransferencia", error: null, durationMs: 180 + ((seq * 13 + i) % 120), output: { ok: true } }] : [],
    });
  });
  return execucoes;
}

/** Todas as execuções da organização, da mais recente para a mais antiga. Conversa aberta pelo visitante não entra: não tem roteiro. */
async function execucoesDaOrganizacao(org: string): Promise<Execucao[]> {
  const providerId = providerIdDaOrganizacao(org);
  if (providerId === null) return [];
  const estado = estadoDe(org);
  const linhas = (await conversasSemeadas(providerId)).filter(l => !CONVERSA_CRIADA.test(l.conversationId));
  return linhas.flatMap(l => execucoesDaConversa(l, roteiroCongelado(estado, l)))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
}

function noPeriodo(execucoes: Execucao[], periodo: string | null, agora: number): Execucao[] {
  const janela = PERIODOS_EM_MS[periodo ?? ""];
  return janela ? execucoes.filter(e => Date.parse(e.startedAt) >= agora - janela) : execucoes;
}

/** O `stats/overview` do fork, somado da MESMA lista que o feed devolve naquele período — o resumo nunca diz um número que a lista não mostra. */
function resumoDasExecucoes(period: string, lista: Execucao[]) {
  const noMicro = (usd: number) => Math.round(usd * 1e6) / 1e6;
  const concluidas = lista.filter(e => e.status === "COMPLETED");
  const usd = noMicro(lista.reduce((s, e) => s + e.costUsd, 0));
  const tempos = concluidas.map(e => e.durationMs).sort((a, b) => a - b);
  const percentil = (q: number) => (tempos.length ? tempos[Math.ceil(q * tempos.length) - 1] : null);
  const porAgente = new Map<string, { agentId: string; runs: number; tokens: number; cost: number }>();
  const porDesfecho: Record<string, number> = {};
  const chamadas = new Map<string, number>();
  for (const e of lista) {
    const a = porAgente.get(e.agentId) ?? { agentId: e.agentId, runs: 0, tokens: 0, cost: 0 };
    a.runs++;
    a.tokens += e.inputTokens + e.outputTokens;
    a.cost = noMicro(a.cost + e.costUsd);
    porAgente.set(e.agentId, a);
    porDesfecho[e.finalAction] = (porDesfecho[e.finalAction] ?? 0) + 1;
    for (const c of e.toolCalls) chamadas.set(c.toolName, (chamadas.get(c.toolName) ?? 0) + 1);
  }
  return {
    period,
    runs: { total: lista.length, completed: concluidas.length, failed: 0, skipped: lista.length - concluidas.length, successRate: concluidas.length ? 1 : null },
    tokens: { total: lista.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0) },
    cost: { usd, avgPerRun: lista.length ? noMicro(usd / lista.length) : 0 },
    latency: { p50: percentil(0.5), p95: percentil(0.95) },
    byAgent: [...porAgente.values()],
    byFinalAction: porDesfecho,
    tools: [...chamadas].map(([name, calls]) => ({ name, calls })),
  };
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

function colecaoDoEstado(estado: EstadoDaOrganizacao, nome: string): Map<string, Registro> {
  let c = estado.colecoes.get(nome);
  if (!c) { c = new Map(); estado.colecoes.set(nome, c); }
  return c;
}

function colecao(p: Pedido, nome: string): Map<string, Registro> {
  return colecaoDoEstado(estadoDe(p.org), nome);
}

/** Quantos itens da coleção o VISITANTE criou: o catálogo semeado não come o teto dele. */
function criadosPeloVisitante(p: Pedido, nome: string): number {
  const estado = estadoDe(p.org);
  return [...colecao(p, nome).keys()].filter(id => !estado.semeados.has(id)).length;
}

/**
 * O item como o fork o devolve na leitura, com as relações montadas na hora:
 * a skill traz a conexão e os agentes que a usam; a conexão, quantas skills a
 * usam. Montar na leitura, e não guardar, mantém a contagem certa depois que o
 * visitante troca as skills de um agente ou apaga uma skill.
 */
function vista(p: Pedido, nome: string, r: Registro): Registro {
  if (nome === "skills") {
    const tool = typeof r.toolId === "string" ? colecao(p, "tools").get(r.toolId) : undefined;
    const agentes = [...colecao(p, "agentes").values()].filter(a => Array.isArray(a.skills) && (a.skills as Array<{ skillId?: unknown }>).some(s => s.skillId === r.id));
    return { ...r, tool: tool ? { id: tool.id, name: tool.name } : null, agents: agentes.map(a => ({ agent: { id: a.id, name: a.name } })) };
  }
  if (nome === "tools") return { ...r, _count: { skills: [...colecao(p, "skills").values()].filter(s => s.toolId === r.id).length } };
  return r;
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
    ["GET", new RegExp(`^${base}$`), p => ok([...colecao(p, nome).values()].map(r => vista(p, nome, r)))],
    ["POST", new RegExp(`^${base}$`), p => (criadosPeloVisitante(p, nome) >= MAXIMO_DE_REGISTROS_POR_COLECAO
      ? noLimite("Limite de itens desta demonstração atingido: apague algum antes de criar outro")
      : criado(criarRegistro(p, nome, nome === "agentes" ? { channels: [], skills: [] } : {})))],
    ["GET", umItem, p => { const r = colecao(p, nome).get(p.params[0]); return r ? ok(vista(p, nome, r)) : naoEncontrado("Registro não encontrado na demonstração"); }],
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
  if (achada.linha) roteiro = roteiroCongelado(estado, achada.linha, enviadas.length ? Date.parse(enviadas[0].createdAt) : undefined).map(f => f.mensagem);
  return [...roteiro, ...enviadas].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function guardarEnviada(estado: EstadoDaOrganizacao, conversationId: string, mensagem: Mensagem): void {
  const lista = [...(estado.enviadas.get(conversationId) ?? []), mensagem];
  estado.enviadas.set(conversationId, lista.slice(-MAXIMO_DE_ENVIADAS_POR_CONVERSA));
}

/**
 * Quem assina a abertura de uma conversa que o visitante abriu. A ponte não diz o perfil ao abrir a conversa, mas a
 * abertura diz quem fala ("Aqui é a Clara, da Rede Demo"): a funcionária que se apresenta assina. Sem nome — o
 * template, ou a abertura sem perfil —, assina o atendimento automatizado; "Assistente virtual" saiu (D1).
 */
function remetenteDaAbertura(texto: string | undefined): string {
  const nome = Object.values(NOMES_DAS_FUNCIONARIAS_DA_DEMO).find(n => typeof texto === "string" && texto.includes(` é a ${n},`));
  return nome ?? "Atendimento automatizado";
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
  // Zappfy e o WhatsApp da plataforma (Evolution): os dois pareiam por QR, e o
  // canal único da demonstração serve aos dois. Datafy exige template aprovado
  // para abrir conversa, e o simulado não tem template — um canal Datafy salvo
  // ficaria "ativo" com todo envio falhando. Sem a capability, a ponte recusa
  // antes de gravar qualquer coisa.
  ["GET", /^\/channels\/capabilities$/, () => ok({ whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: false, datafy: false, evolution: true, templateFirstContact: false })],
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
    // Como o fork de verdade: `search` é um "contém" sobre os dígitos do telefone
    // do contato (a ponte busca pelos oito dígitos finais e filtra por chave depois).
    const alvo = String(p.query.get("search") ?? "").replace(/\D/g, "");
    return ok({ conversations: [...semeadas, ...criadas].filter(c => !alvo || String(c.contact.phone ?? "").replace(/\D/g, "").includes(alvo)) });
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
    guardarEnviada(estado, conversationId, { id: messageId, direction: "OUTBOUND", type: mensagem.type ?? "TEXT", content: mensagem.content ?? {}, status: "SENT", senderName: remetenteDaAbertura(mensagem.content?.text), createdAt: agora });
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
  ["GET", /^\/ai-agents\/runs\/feed$/, async p => {
    // Nenhuma execução semeada falha nem tem skill com erro: "só com erro" é vazio de verdade.
    if (p.query.get("hasErrors") === "1") return ok([]);
    const agente = p.query.get("agentId");
    const status = p.query.get("status");
    const limite = Math.min(200, Math.max(1, Number(p.query.get("limit")) || 50));
    const lista = noPeriodo(await execucoesDaOrganizacao(p.org), p.query.get("period"), Date.now())
      .filter(e => (!agente || e.agentId === agente) && (!status || e.status === status));
    return ok(lista.slice(0, limite));
  }],
  ["GET", /^\/ai-agents\/stats\/overview$/, async p => {
    const pedido = p.query.get("period") ?? "";
    const periodo = PERIODOS_EM_MS[pedido] ? pedido : "7d";
    return ok(resumoDasExecucoes(periodo, noPeriodo(await execucoesDaOrganizacao(p.org), periodo, Date.now())));
  }],
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
    // Texto fixo, sem modelo: a abertura do servidor (§3.1), o que se permite antes de o cliente se identificar.
    return ok({
      texto: aberturaDaDemo(tipoDoAgenteDaDemo(agente.id), contexto.nomeCliente || null, contexto.nomeProvedor || null, String(agente.id)),
      agenteId: agente.id, modelo: agente.modelId, runId: `demo-run-${++estado.sequencia}`,
    });
  }],
  // A autonomia não roda na demonstração (a Frente A a desliga no worker); a recusa é local e explica o porquê.
  ["POST", /^\/ai-agents\/([^/]+)\/autonomous-plan$/, () => ({ status: 403, corpo: { message: "O assistente automático fica desligado na demonstração" } })],

  // ── catálogo e automações
  ...crud("/ai-catalog/tools", "tools"),
  ["GET", /^\/ai-catalog\/skills\/([^/]+)\/versions$/, p => {
    const s = colecao(p, "skills").get(p.params[0]);
    // A versão 1 é a da criação; o simulado não guarda o histórico das edições.
    return ok(s ? [{ id: `${s.id}-v1`, version: 1, name: s.name, description: s.description, httpMethod: s.httpMethod, httpPath: s.httpPath, changeNote: null, createdAt: s.createdAt }] : []);
  }],
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
