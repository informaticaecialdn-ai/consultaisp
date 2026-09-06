/**
 * Contrato das telas de cobrança — o que o client ESPERA de `/api/cobranca/*`.
 *
 * As rotas foram escritas em paralelo com estas telas; o que amarra as duas
 * frentes é a lista de caminhos e formas combinada em 05/09/2026. Onde a
 * forma de resposta não estava no acordo (o 360, a fila, a régua, o DNA), o
 * tipo aqui documenta a leitura que a tela faz — e toda leitura é tolerante:
 * campo ausente vira "—", nunca zero, nunca chute (regra do dono, integridade
 * do dado). Os `ler*` deste arquivo são a única porta por onde JSON cru entra.
 *
 * Nada de React aqui: o módulo é importado pelos `.ts` puros e pelos testes.
 */
import { POLITICA_PADRAO, ROTULO_CANAL, ROTULO_STATUS_DE_CASO, type Economia, type Etapa, type MotivoSemEtapa } from "@shared/cobranca";
import type { EntradaDaFicha360, Ficha360 } from "@shared/cobranca";

/** O que a rota leu para montar a ficha; o navegador remonta com o plano e a data do ERP ao vivo. */
export type FichaEntrada = Omit<EntradaDaFicha360, "hoje" | "economia" | "historicoPagamento">;

/* ── Status de caso ──────────────────────────────────────────────────── */

/**
 * Os dois status que o dono pediu em 05/09/2026 — `em_contato` (o operador já
 * falou e aguarda) e `cancelamento` (terminal: o contrato entrou em
 * cancelamento) — entram aqui com rótulo próprio ANTES de o vocabulário
 * compartilhado tê-los: a tela não pode mostrar `em_contato` cru a quem lê
 * "Negociando" ao lado. Quando `shared/cobranca` os declarar, o rótulo de lá
 * vence (vem por último no spread).
 */
const ROTULO_DOS_STATUS_NOVOS: Record<string, string> = {
  em_contato: "Em contato",
  cancelamento: "Cancelamento",
};

export const ROTULO_STATUS_DE_CASO_DA_TELA: Record<string, string> = {
  ...ROTULO_DOS_STATUS_NOVOS,
  ...ROTULO_STATUS_DE_CASO,
};

export function rotuloDoStatusDeCaso(status: string | null | undefined): string | null {
  if (!status) return null;
  return ROTULO_STATUS_DE_CASO_DA_TELA[status] ?? status;
}

/* ── Vocabulário de rota ─────────────────────────────────────────────── */

export const ROTA_CARTEIRA = "/cobranca";
/** Os dois espacos da carteira (Provedor.ai): /cobranca redireciona para o de ativos. */
export const ROTA_CARTEIRA_ATIVOS = "/cobranca/ativos";
export const ROTA_CARTEIRA_EX = "/cobranca/ex-clientes";
/**
 * O endereco antigo da fila do dia. A TELA saiu em 06/09/2026 (o quadro passou
 * a ser o unico lugar do trabalho diario); a rota sobrevive como
 * redirecionamento para o Kanban da mesma carteira, para link salvo e favorito
 * nao darem em pagina vazia. Nao aponte nada novo para ca.
 */
export const ROTA_FILA = "/cobranca/fila";
export const ROTA_REGUA = "/cobranca/regua";
export const ROTA_POLITICA = "/cobranca/politica";
export const rotaDoCliente = (customerId: number, carteira?: string) => `/cobranca/cliente/${customerId}${carteira === "ativo" || carteira === "ex_cliente" ? `?carteira=${carteira}` : ""}`;

export const API_CARTEIRA = "/api/cobranca/carteira";
/** Realidade mensal do espaco de ativos: GET ?mes=AAAA-MM. */
export const API_CARTEIRA_MES = "/api/cobranca/carteira/mes";
/**
 * A rota da fila continua no servidor — nenhuma tela a consome desde 06/09/2026,
 * mas remover API e irreversivel para quem tiver integracao. `lerRespostaDaFila`
 * segue sendo o leitor dela.
 */
export const API_FILA = "/api/cobranca/fila";
export const API_REGUA = "/api/cobranca/regua";
export const API_DNA = "/api/cobranca/dna";
export const API_POLITICA = "/api/cobranca/politica";
export const API_EQUIPE = "/api/cobranca/equipe";
export const API_CASOS = "/api/cobranca/casos";
export const api360 = (customerId: number | string) => `/api/cobranca/clientes/${customerId}/360`;
export const api360AoVivo = (customerId: number, forcar = false) => `/api/cobranca/clientes/${customerId}/360/ao-vivo${forcar ? "?forcar=1" : ""}`;

/* ── Carteira ────────────────────────────────────────────────────────── */

export interface ResponsavelResumo {
  id: number;
  nome: string;
}

export interface CasoResumo {
  id: number;
  status: string;
  etapa: string | null;
  responsavel: ResponsavelResumo | null;
  proximoContatoEm: string | null;
  /** Follow-up: a proxima acao escrita; ausente ou nula = caso sem proxima acao. */
  proximaAcao?: string | null;
  prioridade?: string | null;
}

/** A etapa que a régua dá para o atraso de HOJE — não a gravada no caso. */
export interface ReguaDeHoje {
  etapa: string | null;
  rotulo: string | null;
  acao?: string | null;
  motivo: MotivoSemEtapa | string | null;
}

export interface ItemDaCarteira {
  customerId: number;
  nome: string;
  documentoMascarado: string;
  telefone?: string | null;
  cidade: string | null;
  bairro: string | null;
  /** Sempre null na fase 1: `customers` não guarda o plano. */
  plano: string | null;
  statusErp: string;
  carteira: string;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas?: number;
  mesesComoCliente?: number | null;
  quadrante: string | null;
  tom: string | null;
  fidelidade: string | null;
  confiabilidade: string | null;
  regua?: ReguaDeHoje;
  caso: CasoResumo | null;
  /**
   * `null` quando a rota não tem score CALCULADO. A coluna `customers.isp_score`
   * tem DEFAULT 100 e nada a escreve — lido cru, todo cliente saía "crítico"
   * (achado A2). A tela nunca deriva faixa nem saúde de um score nulo.
   */
  ispScore: number | null;
  /** `low` · `medium` · `high` · `critical` — o rótulo em português sai de `rotuloDoRiskTier`. */
  riskTier?: string | null;
  /** Sempre null hoje: o sync não traz o valor do plano (MRR) — o card diz "—". */
  mrr?: number | null;
  /** Sempre null hoje: propensão a pagar é modelo a criar — o card diz "—". */
  propensao?: number | null;
}

/** O mês de vencimento resumido — a mesma régua do scoring do Provedor.ai (safra mensal). */
export interface ResumoDoMes {
  mes: string;
  /** false = o provedor não tem fatura vinda do ERP: a faixa mostra "—". */
  base: boolean;
  faturado: number;
  recebido: number;
  recebidoConfirmado: boolean;
  emConciliacao: number;
  inadimplente: number;
  numInadimplentes: number;
  aVencer: number;
  numAVencer: number;
  semFatura: number;
  clientes: { emDia: number; inadimplentes: number };
  atualizadoEm: string | null;
}

export interface RespostaDoMes {
  live: boolean;
  motivo: string | null;
  resumo: ResumoDoMes | null;
}

export interface KpisDaCobranca {
  ativosComDivida: number | null;
  exClientesComDivida: number | null;
  emAberto: number | null;
  contatadosHoje: number | null;
  recuperado30d: number | null;
}

export interface ComposicaoDaCarteira {
  emDia: number;
  emCobranca: number;
  exComDivida: number;
}

export interface RespostaDaCarteira {
  kpis: KpisDaCobranca | null;
  composicao: ComposicaoDaCarteira | null;
  itens: ItemDaCarteira[];
  total: number;
  /** `bairrosDaCarteira` do storage (top 40). Sem ele o filtro lista os bairros da página. */
  bairros?: Array<{ bairro: string; total: number }>;
  totais?: { casos: number; semCaso: number };
  pausada?: boolean;
}

/* ── Caso, eventos, negociações ──────────────────────────────────────── */

export interface CasoDetalhe {
  id: number;
  status: string;
  carteira: string;
  abertoEm: string;
  etapaAtual: string | null;
  diasAtrasoAbertura: number;
  valorAbertura: number;
  valorAtual: number;
  responsavelUserId: number | null;
  responsavelNome: string | null;
  prioridade: string;
  proximoContatoEm: string | null;
  /** Follow-up: a proxima acao escrita; ausente ou nula = caso sem proxima acao. */
  proximaAcao?: string | null;
  ultimoContatoEm: string | null;
  /**
   * Esteira: desde quando o caso está NESTE status, e há quantos dias. Os dois
   * são OPCIONAIS — a rota pode ainda não medir (a coluna nasce agora, e
   * `updatedAt` muda por qualquer motivo, então não serve de substituto). Sem
   * eles a tela mostra "—" com o motivo, nunca zero.
   */
  statusDesde?: string | null;
  diasNoStatus?: number | null;
  quadranteDna: string | null;
  tom: string | null;
  encerradoEm: string | null;
  motivoEncerramento: string | null;
}

export interface EventoDeCobranca {
  id: number;
  casoId: number;
  userId: number | null;
  /** Quando a rota junta o nome do usuário; sem ele a linha mostra "sistema" ou "—". */
  usuarioNome?: string | null;
  tipo: string;
  canal: string | null;
  resultado: string | null;
  notas: string | null;
  metadata: Record<string, unknown> | null;
  ocorridoEm: string;
}

export interface ParcelaDeCobranca {
  id: number;
  numero: number;
  valor: number;
  vencimento: string;
  pagoEm: string | null;
  valorPago: number | null;
  status: string;
}

export interface NegociacaoDeCobranca {
  id: number;
  casoId: number;
  tipo: string;
  valorOriginal: number;
  valorNegociado: number;
  descontoPct: number;
  entrada: number;
  parcelas: number;
  valorParcela: number | null;
  primeiroVencimento: string | null;
  status: string;
  criadoPorUserId: number | null;
  aceitaEm: string | null;
  quebradaEm: string | null;
  createdAt: string;
  parcelamento: ParcelaDeCobranca[];
}

/* ── Cliente 360 ─────────────────────────────────────────────────────── */

export interface EquipamentoDoCliente {
  id: number;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  mac: string | null;
  status: string;
  valor: number | null;
}

export interface ClienteDo360 {
  id: number;
  nome: string;
  /** Em claro só na ficha: é onde o operador confere a identidade. */
  documento?: string;
  documentoMascarado: string;
  telefone: string | null;
  /** Só dígitos com 55 na frente, quando a rota o deriva. */
  whatsapp: string | null;
  email: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  plano: string | null;
  statusErp: string;
  carteira: string;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number | null;
  contractStartDate: string | null;
  ispScore: number | null;
  riskTier: string | null;
  motivoCorte: string | null;
  cortadoEm: string | null;
}

export interface DnaDo360 {
  quadrante: string;
  fidelidade: string;
  confiabilidade: string;
  abordagem: string;
  tom: string | null;
  diretiva?: string | null;
  fraseExemplo?: string | null;
  mesesComoCliente: number | null;
  historicoInsuficiente: boolean;
}

export interface ReguaDo360 {
  etapa: Etapa | null;
  motivo: MotivoSemEtapa | string | null;
  motivoRotulo?: string | null;
  pausada?: boolean;
}

/** A dívida com multa e juros da política — o que se cobra, não só o principal. */
export interface DividaDo360 {
  valor: number;
  diasAtraso: number;
  faturasAbertas: number;
  atualizado: { principal: number; multa: number; juros: number; total: number };
  prescrita: boolean;
}

/** Caso de recuperação de equipamento em curso — o outro CRM do mesmo cliente. */
export interface RecuperacaoDoCliente {
  id: number;
  status: string;
  prioridade: string;
  rescisaoEm: string | null;
  prazoEm: string | null;
  equipamento: { tipo: string | null; marca: string | null; modelo: string | null; serie: string | null };
}

/** O sinal do bureau sobre este documento: só contagens e datas, nunca quem. */
export interface RedeDo360 {
  consultasOutros90d: number;
  consultasOutros30d: number;
  provedoresDistintos90d: number;
  ultimaConsultaEm: string | null;
}

/** Alerta anti-fraude do próprio provedor sobre este cliente, sem o nome de quem consultou. */
export interface AlertaDo360 {
  id: number;
  tipo: string;
  severidade: string;
  status: string;
  resolvido: boolean;
  criadoEm: string | null;
  diasAtraso: number | null;
  valorEmAberto: number | null;
  equipamentoNaoDevolvido: boolean;
}

export interface EquipamentoAoVivo {
  tipo: string | null;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  mac: string | null;
  valor: number | null;
  emRecuperacao: boolean;
}

export interface ClienteAoVivo {
  autenticacoes?: import("@shared/equipamentos/identificacao").AutenticacaoCliente[];
  nome: string | null;
  plano: string | null;
  statusContrato: "active" | "cancelled" | "suspended" | null;
  motivoCorte: string | null;
  cortadoEm: string | null;
  contractStartDate: string | null;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number | null;
  telefone: string | null;
  email: string | null;
  equipamentos: EquipamentoAoVivo[];
}

/** `GET /api/cobranca/clientes/:id/360/ao-vivo` — o que o ERP do próprio provedor disse agora. */
export interface SnapshotAoVivo {
  ok: boolean;
  erpSource: string | null;
  encontrado: boolean;
  cliente: ClienteAoVivo | null;
  erro: string | null;
  latenciaMs: number;
  lidoEm: string;
  doCache: boolean;
}

export interface Cliente360 {
  cliente: ClienteDo360;
  divida?: DividaDo360;
  dna: DnaDo360 | null;
  regua: ReguaDo360 | null;
  caso: CasoDetalhe | null;
  casosAnteriores: CasoDetalhe[];
  negociacoes: NegociacaoDeCobranca[];
  eventos: EventoDeCobranca[];
  equipamentos: EquipamentoDoCliente[];
  /** Os blocos calculados do Provedor.ai (selo, scores, prescrição, economia, resumo) — `montarFicha360`. */
  ficha?: Ficha360;
  fichaEntrada?: FichaEntrada;
  chat?: ChatDoCaso | null;
  rede?: RedeDo360;
  alertas?: AlertaDo360[];
  recuperacao?: RecuperacaoDoCliente[];
  /** O que a ficha do Provedor.ai tem e esta base não: nomeado pela rota, não fabricado. */
  pendentes?: Array<{ campo: string; motivo: string }>;
}

/* ── Fila ────────────────────────────────────────────────────────────── */

export interface ClienteDaFila {
  id: number;
  nome: string;
  cpfCnpj: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  bairro: string | null;
  statusErp: string;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number;
  plano: string | null;
  contractStartDate: string | null;
}

/** Uma linha de `filaDeCobranca` do storage, como a rota a devolve — mais o tom de AGORA e a etapa de hoje. */
export interface ItemDaFila extends CasoDetalhe {
  /** Presente quando o caso foi enviado para cobranca pelo chat. */
  chat?: ChatDoCaso | null;
  /** O acordo vivo, quando ha — vem no kanban. */
  negociacao?: NegociacaoResumo | null;
  cliente: ClienteDaFila;
  quadrante?: string | null;
  tomSugerido?: string | null;
  diretiva?: string | null;
  regua?: ReguaDeHoje;
}

/**
 * Os números do topo da fila, contados pela rota sobre TODOS os casos vivos
 * — não sobre a página que veio (achado A3: os KPIs somavam os 100 primeiros
 * e se rotulavam "todos os casos vivos"). `null` = a rota não contou; a tela
 * mostra "—" e nunca soma os itens da página no lugar.
 */
export interface KpisDaFila {
  criticos?: number | null;
  casosVivos: number | null;
  paraHoje: number | null;
  /** Follow-up (kanban): casos vivos sem data de proximo contato — caso parado. */
  semProximaAcao?: number | null;
  vencidos: number | null;
  agendados: number | null;
  emAberto: number | null;
  /**
   * O FLUXO DO DIA da esteira (kanban): quantos casos entraram e quantos foram
   * resolvidos hoje, no mesmo recorte do quadro. Opcionais — enquanto a rota
   * não mandar, a tela mostra "—" com o motivo; somar nada e escrever 0 seria
   * dizer que o dia não rendeu.
   */
  entraramHoje?: number | null;
  resolvidosHoje?: number | null;
}

export interface RespostaDaFila {
  itens: ItemDaFila[];
  /** Total de casos vivos no recorte, independente do `limite` da página. `null` = a rota não mandou. */
  total: number | null;
  kpis: KpisDaFila | null;
  pausada: boolean;
  pausadaMotivo: string | null;
}

/* ── Política · economia (R24) ───────────────────────────────────────── */

/**
 * Os custos por provedor que alimentam a "Economia do cliente" do 360 —
 * decisão (d) do dono em 05/09/2026: entram na política como JSONB `economia`,
 * com a tela "Confirmar custos". O tipo é o do vocabulário compartilhado
 * (`Economia`, porte de `CustoParametrosEconomia` do Provedor.ai em camelCase);
 * aqui só ganha o nome da tela e a ordem das caixas. Valores em R$ por
 * assinante (OPEX por mês; CAC e CAPEX uma vez); `impostoReceitaPct` em
 * pontos percentuais (12 = 12%).
 *
 * Sem `confirmado`, a Economia mostra o selo "≈ parâmetros padrão", como lá:
 * os números aparecem, mas rotulados como estimativa.
 */
export type EconomiaDaPolitica = Economia;

/** As nove caixas numéricas, na ordem em que a tela as desenha. */
export const CAMPOS_DE_CUSTO = [
  "opexLink", "opexRedePop", "opexSuporte", "opexManutencaoNoc",
  "cac", "capexInstalacao", "equipamentoResidual",
  "impostoReceitaPct", "cicloMeses",
] as const satisfies ReadonlyArray<Exclude<keyof EconomiaDaPolitica, "confirmado">>;
export type CampoDeCusto = (typeof CAMPOS_DE_CUSTO)[number];

/** Custo zero e não confirmado até o provedor dizer o dele; ciclo de 36 meses (o do Provedor.ai). */
export const ECONOMIA_PADRAO: EconomiaDaPolitica = POLITICA_PADRAO.economia;

/** Permanência média na base — o horizonte do LTV. */
export const CICLO_MESES_PADRAO = ECONOMIA_PADRAO.cicloMeses;

/* ── Erros da API ────────────────────────────────────────────────────── */

/**
 * Todas as frases que a API mandou para o operador ler, na ordem: a mensagem
 * e depois `erros` (o `apiRequest` já achata `errors`, `erros` e `violacoes`
 * em `ErroDaApi.erros`). Nunca repete a mensagem quando ela é a primeira
 * violação — a rota de negociação manda `message = violacoes[0]`.
 */
export function frasesDoErro(erro: unknown): string[] {
  const frases: string[] = [];
  if (erro instanceof Error) {
    if (erro.message) frases.push(erro.message);
    const extras = (erro as { erros?: unknown }).erros;
    if (Array.isArray(extras)) for (const f of extras) if (typeof f === "string" && f.trim()) frases.push(f.trim());
  } else if (typeof erro === "string" && erro.trim()) {
    frases.push(erro.trim());
  }
  const unicas = Array.from(new Set(frases));
  return unicas.length > 0 ? unicas : ["Falha desconhecida"];
}

/* ── Régua e DNA ─────────────────────────────────────────────────────── */

export interface ContagemPorEtapa {
  etapa: string | null;
  carteira: string;
  casos: number;
  valor: number;
}

export interface ContagemPorQuadrante {
  quadrante: string | null;
  carteira: string;
  casos: number;
  valor: number;
}

export interface RespostaDaRegua {
  etapas: Etapa[];
  /** Já com a regra de cada carteira aplicada (ex-cliente sem aviso de suspensão). */
  porCarteira?: { ativo: Etapa[]; ex_cliente: Etapa[] };
  pausada: boolean;
  pausadaMotivo: string | null;
  contagens: ContagemPorEtapa[];
  fonte?: "politica" | "padrao";
}

export interface RespostaDoDna {
  contagens: ContagemPorQuadrante[];
  /** Casos vivos sem `quadrante_dna` (cliente sem data de contrato). */
  semClassificacao: number | null;
}

/* ── Equipe ──────────────────────────────────────────────────────────── */

export interface MembroDaEquipe {
  id: number;
  nome: string;
  role?: string;
}

/* ── Leitores tolerantes ─────────────────────────────────────────────── */

/** DECIMAL do Postgres chega como string; `null` quando não há número. */
export function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** A lista pode vir crua ou embrulhada em `{ itens }` / `{ contagens }` / `{ usuarios }`. */
export function listaDe<T>(resposta: unknown, ...chaves: string[]): T[] {
  if (Array.isArray(resposta)) return resposta as T[];
  if (resposta && typeof resposta === "object") {
    for (const chave of chaves) {
      const v = (resposta as Record<string, unknown>)[chave];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export function lerEquipe(resposta: unknown): MembroDaEquipe[] {
  return listaDe<Record<string, unknown>>(resposta, "usuarios", "equipe", "itens")
    .map(u => ({
      id: Number(u.id),
      nome: String(u.nome ?? u.name ?? ""),
      role: typeof u.role === "string" ? u.role : undefined,
    }))
    .filter(u => Number.isFinite(u.id) && u.nome !== "");
}

export function lerDna(resposta: unknown): RespostaDoDna {
  const contagens = listaDe<ContagemPorQuadrante>(resposta, "contagens", "quadrantes");
  const semClassificacao =
    resposta && typeof resposta === "object" && !Array.isArray(resposta)
      ? numero((resposta as Record<string, unknown>).semClassificacao)
      : null;
  return { contagens, semClassificacao };
}

export function lerFila(resposta: unknown): ItemDaFila[] {
  return listaDe<ItemDaFila>(resposta, "itens", "fila", "casos");
}

/** A fila inteira: itens, o total do recorte e os KPIs contados pela rota — `null` no que ela não mandou. */
export function lerRespostaDaFila(resposta: unknown): RespostaDaFila {
  const itens = lerFila(resposta);
  const r = resposta && typeof resposta === "object" && !Array.isArray(resposta) ? (resposta as Record<string, unknown>) : {};
  const kpisCrus = r.kpis && typeof r.kpis === "object" ? (r.kpis as Record<string, unknown>) : null;
  const kpis: KpisDaFila | null = kpisCrus
    ? {
        criticos: numero(kpisCrus.criticos),
        // A rota da fila escreve `casos`/`valor`; a do kanban, `casosVivos`/`emAberto`. Os dois valem.
        casosVivos: numero(kpisCrus.casosVivos) ?? numero(kpisCrus.casos),
        paraHoje: numero(kpisCrus.paraHoje),
        vencidos: numero(kpisCrus.vencidos),
        agendados: numero(kpisCrus.agendados),
        emAberto: numero(kpisCrus.emAberto) ?? numero(kpisCrus.valor),
      }
    : null;
  const pausa = pausaDaResposta(resposta);
  return { itens, total: numero(r.total), kpis, pausada: pausa.pausada, pausadaMotivo: pausa.motivo };
}

/** A pausa da régua, que a carteira e a fila também recebem. */
export function pausaDaResposta(resposta: unknown): { pausada: boolean; motivo: string | null } {
  if (!resposta || typeof resposta !== "object" || Array.isArray(resposta)) return { pausada: false, motivo: null };
  const r = resposta as { pausada?: unknown; pausadaMotivo?: unknown };
  return { pausada: r.pausada === true, motivo: typeof r.pausadaMotivo === "string" ? r.pausadaMotivo : null };
}

/* ── Kanban ──────────────────────────────────────────────────────────────── */

export const API_KANBAN = "/api/cobranca/kanban";
export const API_CHAT_BULLQ = "/api/chat-bullq";
export const apiEnviarCasoParaChat = (casoId: number) => `${API_CHAT_BULLQ}/cobranca/casos/${casoId}/enviar`;
export const apiConversaDoCaso = (casoId: number) => `${API_CHAT_BULLQ}/cobranca/casos/${casoId}/conversa`;

/** A conversa do Chat BullQ ligada ao caso, quando o caso foi enviado para cobranca pelo chat. */
export interface ChatDoCaso { conversationId: string; status: string }

/** O acordo vivo do caso (proposta, aceita ou ativa), resumido para o card. */
export interface NegociacaoResumo {
  id: number;
  tipo: string;
  status: string;
  valorNegociado: number;
  entrada: number;
  parcelas: number;
  valorParcela: number | null;
  parcelasPagas: number;
  proximaParcela: { numero: number; vencimento: string; valor: number; atrasada: boolean } | null;
  aceitaEm: string | null;
}

export interface IntegracaoDoChat {
  webhookDatafyUrl?: string | null;
  ligado: boolean;
  provisionado: boolean;
  organizationId: string | null;
  /** O e-mail com que a equipe entra no inbox. */
  ownerEmail: string | null;
  canal: { id: string; nome: string | null; provider?: "ZAPPFY" | "UAZAPI" | "DATAFY" } | null;
  /** O agente de cobranca criado na organizacao do provedor, quando existe. */
  agente: { id: string; modelo: string | null } | null;
  status: string | null;
  ultimoErro: string | null;
  inboxUrl: string;
}

export function lerIntegracaoDoChat(resposta: unknown): IntegracaoDoChat | null {
  if (!resposta || typeof resposta !== "object") return null;
  const r = resposta as Record<string, unknown>;
  const canal = r.canal && typeof r.canal === "object" ? (r.canal as Record<string, unknown>) : null;
  return {
    ligado: r.ligado === true,
    provisionado: r.provisionado === true,
    organizationId: typeof r.organizationId === "string" ? r.organizationId : null,
    ownerEmail: typeof r.ownerEmail === "string" ? r.ownerEmail : null,
    canal: canal ? { id: String(canal.id), nome: typeof canal.nome === "string" ? canal.nome : null, ...(["ZAPPFY", "UAZAPI", "DATAFY"].includes(String(canal.provider)) ? { provider: canal.provider as "ZAPPFY" | "UAZAPI" | "DATAFY" } : {}) } : null,
    agente: r.agente && typeof r.agente === "object" && typeof (r.agente as Record<string, unknown>).id === "string"
      ? { id: String((r.agente as Record<string, unknown>).id), modelo: typeof (r.agente as Record<string, unknown>).modelo === "string" ? String((r.agente as Record<string, unknown>).modelo) : null }
      : null,
    status: typeof r.status === "string" ? r.status : null,
    ultimoErro: typeof r.ultimoErro === "string" ? r.ultimoErro : null,
    inboxUrl: typeof r.inboxUrl === "string" ? r.inboxUrl : "https://chat.consultaisp.com.br/inbox",
    ...(typeof r.webhookDatafyUrl === "string" ? { webhookDatafyUrl: r.webhookDatafyUrl } : {}),
  };
}

/** O chat esta pronto para mandar mensagem: ligado nesta instalacao e com o numero do provedor ativo. */
export const chatProntoParaEnviar = (i: IntegracaoDoChat | null | undefined): boolean => !!i && i.ligado && i.status === "ativo" && !!i.canal;
export const ROTA_KANBAN = "/cobranca/kanban";

/** Uma coluna do quadro: o status, os casos que a rota mandou e o total do recorte. */
export interface ColunaDoKanban {
  status: string;
  rotulo: string;
  fechada: boolean;
  casos: ItemDaFila[];
  total: number;
  /** true quando a coluna tem mais casos do que `casos` carrega (porColuna). */
  truncado: boolean;
}

export interface RespostaDoKanban {
  colunas: ColunaDoKanban[];
  total: number | null;
  /** Sobre o MESMO recorte das colunas; `null` quando o quadro e grande demais para varrer. */
  kpis: KpisDaFila | null;
  pausada: boolean;
  pausadaMotivo: string | null;
}

/**
 * O quadro inteiro, tolerante: coluna sem `casos` vira lista vazia, sem
 * `total` vira o tamanho da lista, sem `rotulo` cai no dicionário de status.
 * Rota velha (sem `colunas`) devolve quadro vazio — a tela mostra o estado
 * vazio, nunca inventa coluna.
 */
export function lerKanban(resposta: unknown): RespostaDoKanban {
  const r = resposta && typeof resposta === "object" && !Array.isArray(resposta) ? (resposta as Record<string, unknown>) : {};
  const cruas = Array.isArray(r.colunas) ? (r.colunas as Array<Record<string, unknown>>) : [];
  const colunas: ColunaDoKanban[] = cruas
    .filter(c => c && typeof c === "object" && typeof c.status === "string")
    .map(c => {
      const casos = Array.isArray(c.casos) ? (c.casos as ItemDaFila[]) : [];
      const status = String(c.status);
      return {
        status,
        rotulo: typeof c.rotulo === "string" && c.rotulo ? c.rotulo : rotuloDoStatusDeCaso(status) ?? status,
        fechada: c.fechada === true,
        casos,
        total: numero(c.total) ?? casos.length,
        truncado: c.truncado === true,
      };
    });
  const pausa = pausaDaResposta(resposta);
  const kpisCrus = r.kpis && typeof r.kpis === "object" ? (r.kpis as Record<string, unknown>) : null;
  const kpis: KpisDaFila | null = kpisCrus ? { casosVivos: numero(kpisCrus.casosVivos), paraHoje: numero(kpisCrus.paraHoje), vencidos: numero(kpisCrus.vencidos), agendados: numero(kpisCrus.agendados), emAberto: numero(kpisCrus.emAberto), semProximaAcao: numero(kpisCrus.semProximaAcao), criticos: numero(kpisCrus.criticos), entraramHoje: numero(kpisCrus.entraramHoje), resolvidosHoje: numero(kpisCrus.resolvidosHoje) } : null;
  return { colunas, kpis, total: numero(r.total), pausada: pausa.pausada, pausadaMotivo: pausa.motivo };
}

/* ── Indicadores: automação e recuperação (fase 3) ───────────────────── */

export const API_INDICADOR_AUTOMACAO = "/api/cobranca/indicadores/automacao";
export const API_INDICADOR_RECUPERACAO = "/api/cobranca/indicadores/recuperacao";
/** O KPI do kanban olha os últimos `dias`; o período vai escrito na tela. */
export const apiRecuperacao = (dias: number) => `${API_INDICADOR_RECUPERACAO}?dias=${dias}`;
export const DIAS_DA_RECUPERACAO = 30;

/** Uma linha do diário de envios do primeiro contato. O nome já vem mascarado. */
export interface EnvioDoPrimeiroContato {
  em: string;
  origem: string;
  canal: string | null;
  cliente: string;
  resultado: string | null;
}

/**
 * O contador da automação. `hoje` e `limiteDiario` são `null` quando não há de
 * onde contar (chat não provisionado, rota antiga) — a tela mostra "—" com o
 * `motivo`, nunca zero.
 */
export interface AutomacaoDoPrimeiroContato {
  provisionado: boolean;
  ligada: boolean;
  dia: string | null;
  hoje: number | null;
  limiteDiario: number | null;
  motivo: string | null;
  /** Teto por rodada e intervalo dela, ditos pelo servidor (o worker é a fonte). */
  porRodada: number | null;
  segundosEntreRodadas: number | null;
  envios: EnvioDoPrimeiroContato[];
}

export function lerAutomacaoDoPrimeiroContato(resposta: unknown): AutomacaoDoPrimeiroContato {
  const r = resposta && typeof resposta === "object" && !Array.isArray(resposta) ? (resposta as Record<string, unknown>) : {};
  const envios = Array.isArray(r.envios) ? (r.envios as Array<Record<string, unknown>>) : [];
  return {
    provisionado: r.provisionado === true,
    ligada: r.ligada === true,
    dia: typeof r.dia === "string" ? r.dia : null,
    hoje: numero(r.hoje),
    limiteDiario: numero(r.limiteDiario),
    motivo: typeof r.motivo === "string" && r.motivo ? r.motivo : null,
    porRodada: numero(r.porRodada),
    segundosEntreRodadas: numero(r.segundosEntreRodadas),
    envios: envios
      .filter(e => e && typeof e === "object" && typeof e.em === "string")
      .map(e => ({
        em: String(e.em),
        origem: typeof e.origem === "string" ? e.origem : "cobranca",
        canal: typeof e.canal === "string" && e.canal ? e.canal : null,
        cliente: typeof e.cliente === "string" && e.cliente ? e.cliente : "—",
        resultado: typeof e.resultado === "string" && e.resultado ? e.resultado : null,
      })),
  };
}

/**
 * Quem conduziu o contato. O rótulo diz o que o dado permite afirmar: o
 * assistente ESCREVEU a mensagem — pela rodada automática ou pelo botão do
 * operador, que o banco não separa.
 */
export const ROTULO_ORIGEM_DO_CONTATO: Record<string, string> = {
  assistente: "Assistente",
  operador: "Operador",
  indefinido: "Não identificado",
};

export interface RecorteDaRecuperacao {
  chave: string;
  rotulo: string;
  valor: number;
  faturas: number;
  clientes: number;
}

/**
 * O recuperado depois do contato. `base: false` = não há do que falar (nenhuma
 * fatura do ERP, ou nenhuma varredura completa fechou fatura ainda): valores
 * nulos e o `motivo` escrito, jamais R$ 0,00.
 */
export interface RecuperacaoDaCobranca {
  base: boolean;
  motivo: string | null;
  dias: number | null;
  janelaDias: number | null;
  valor: number | null;
  faturas: number | null;
  clientes: number | null;
  porOrigem: RecorteDaRecuperacao[];
  porCanal: RecorteDaRecuperacao[];
}

function recorte(cru: unknown, rotulos: Record<string, string>): RecorteDaRecuperacao[] {
  const lista = Array.isArray(cru) ? (cru as Array<Record<string, unknown>>) : [];
  return lista
    .filter(l => l && typeof l === "object" && typeof l.chave === "string")
    .map(l => ({
      chave: String(l.chave),
      rotulo: rotulos[String(l.chave)] ?? String(l.chave),
      valor: numero(l.valor) ?? 0,
      faturas: numero(l.faturas) ?? 0,
      clientes: numero(l.clientes) ?? 0,
    }));
}

export function lerRecuperacao(resposta: unknown): RecuperacaoDaCobranca {
  const r = resposta && typeof resposta === "object" && !Array.isArray(resposta) ? (resposta as Record<string, unknown>) : {};
  const valor = numero(r.valor);
  return {
    // Sem valor não há base, mesmo que a rota diga que sim: o "—" é o padrão.
    base: r.base === true && valor !== null,
    motivo: typeof r.motivo === "string" && r.motivo ? r.motivo : null,
    dias: numero(r.dias),
    janelaDias: numero(r.janelaDias),
    valor,
    faturas: numero(r.faturas),
    clientes: numero(r.clientes),
    porOrigem: recorte(r.porOrigem, ROTULO_ORIGEM_DO_CONTATO),
    porCanal: recorte(r.porCanal, ROTULO_CANAL),
  };
}

/* ── Detalhe do caso — o painel que o card abre ──────────────────────── */

/**
 * Pedido do dono (06/09/2026): "quando clicar no card, mostrar um card na tela
 * com todas as informações da dívida, todos os boletos, e histórico da
 * cobrança". O card do quadro ficou com nome, documento e o valor vencido; o
 * resto mora aqui.
 *
 * A rota é `GET /api/cobranca/casos/:id/detalhe` e devolve
 * `{ caso, divida, faturas, eventos, negociacoes }`. CADA BLOCO É OPCIONAL, e
 * a distinção é a regra do dono: `null` = a rota não mandou o bloco (a tela
 * mostra "—" com o motivo), `[]` = mandou e não há nada (a tela diz que não
 * há). Lista vazia e bloco ausente NÃO são a mesma coisa, e escrever zero no
 * lugar do ausente diria que o cliente não deve fatura nenhuma.
 */
export const apiDetalheDoCaso = (casoId: number) => `${API_CASOS}/${casoId}/detalhe`;

/**
 * O status de uma fatura como o sync a grava (migração 0027) mais o legado do
 * CSV. Nada aqui afirma pagamento confirmado além de `paid`, que só a
 * importação por CSV produz.
 */
export const ROTULO_STATUS_DE_FATURA: Record<string, string> = {
  aberta: "aberta",
  pending: "aberta",
  overdue: "aberta",
  baixada_no_erp: "baixada no ERP",
  paid: "paga",
  cancelada: "cancelada",
};

export const MOTIVO_FATURA_ABERTA =
  "Aberta: continua na lista de pendentes do ERP na última varredura.";
export const MOTIVO_BAIXADA_NO_ERP =
  "Baixada no ERP: a fatura sumiu da lista de pendentes numa varredura completa — pagamento provável, SEM confirmação de valor. Nenhum ERP nos diz quanto foi pago.";
export const MOTIVO_FATURA_PAGA =
  "Paga: baixa com valor confirmado. Hoje só a importação por CSV afirma isso — o ERP não confirma pagamento.";

export const MOTIVO_SEM_FATURAS =
  "A rota não devolveu as faturas deste caso. O sync grava fatura a fatura desde 05/09/2026 (MK, IXC e SGP); listar zero aqui diria que o cliente não tem boleto nenhum.";
export const MOTIVO_NENHUMA_FATURA =
  "Nenhuma fatura deste cliente veio do ERP. A dívida acima é o agregado que o sync grava por cliente — a fatura a fatura só existe para os ERPs que a devolvem.";
export const MOTIVO_SEM_HISTORICO =
  "A rota não devolveu os eventos deste caso. O histórico existe em `cobranca_eventos`; sem o bloco a tela não inventa uma linha do tempo vazia.";
export const MOTIVO_SEM_ACORDOS =
  "A rota não devolveu as negociações deste caso. Sem o bloco não dá para afirmar que não há acordo.";
export const MOTIVO_SEM_DIVIDA_DETALHADA =
  "A rota não devolveu o bloco da dívida. Os números abaixo são o agregado por cliente do último sync, o mesmo que o card do quadro mostra.";

/** Uma fatura como a migração 0027 a guarda: o que o ERP devolveu, sem interpretação. */
export interface FaturaDoCaso {
  id: number;
  /** O id da fatura no ERP (`erp_ref`); `null` nas linhas legadas do CSV. */
  erpRef: string | null;
  erpSource: string | null;
  vencimento: string | null;
  valor: number | null;
  descricao: string | null;
  status: string;
  /** Quando a varredura completa deixou de ver a fatura nos pendentes. */
  baixadaEm: string | null;
}

/** A dívida do caso, como a rota a resume. `base: false` = não há fatura vinda do ERP. */
export interface DividaDoCaso {
  total: number | null;
  diasAtraso: number | null;
  faturasAbertas: number | null;
  faturasVencidas: number | null;
  faturasAVencer: number | null;
  vencimentoMaisAntigo: string | null;
  base: boolean;
  motivo: string | null;
}

export interface DetalheDoCaso {
  caso: ItemDaFila | null;
  divida: DividaDoCaso | null;
  faturas: FaturaDoCaso[] | null;
  eventos: EventoDeCobranca[] | null;
  negociacoes: NegociacaoDeCobranca[] | null;
}

/** Pendente no ERP — os três nomes que convivem (`aberta` do sync, `pending`/`overdue` do CSV). */
export function faturaEstaAberta(status: string | null | undefined): boolean {
  return status === "aberta" || status === "pending" || status === "overdue";
}

/** A soma do que ainda está PENDENTE no ERP; fatura sem valor não entra (não vira zero). */
export function somaDasFaturasAbertas(faturas: readonly FaturaDoCaso[]): number | null {
  const abertas = faturas.filter(f => faturaEstaAberta(f.status) && f.valor !== null);
  if (abertas.length === 0) return null;
  return Math.round(abertas.reduce((s, f) => s + (f.valor ?? 0), 0) * 100) / 100;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Uma linha de fatura, tolerante aos dois vocabulários (o do storage e o da coluna do banco). */
export function lerFaturaDoCaso(cru: unknown): FaturaDoCaso | null {
  if (!cru || typeof cru !== "object" || Array.isArray(cru)) return null;
  const f = cru as Record<string, unknown>;
  const id = numero(f.id);
  if (id === null) return null;
  return {
    id,
    erpRef: textoOuNulo(f.erpRef) ?? textoOuNulo(f.erp_ref),
    erpSource: textoOuNulo(f.erpSource) ?? textoOuNulo(f.erp_source),
    vencimento: textoOuNulo(f.vencimento) ?? textoOuNulo(f.dueDate) ?? textoOuNulo(f.due_date),
    valor: numero(f.valor) ?? numero(f.value),
    descricao: textoOuNulo(f.descricao) ?? textoOuNulo(f.description),
    status: textoOuNulo(f.status) ?? "",
    baixadaEm: textoOuNulo(f.baixadaEm) ?? textoOuNulo(f.baixada_em),
  };
}

/**
 * O detalhe inteiro. Bloco que não veio fica `null` — nunca `[]`, nunca zero:
 * a tela precisa poder dizer "a rota não mandou" com outras palavras que
 * "não há".
 */
/**
 * A lista de um bloco do detalhe, venha ela como array puro ou dentro do
 * envelope `{ linhas, total, limite }` que a rota usa quando ha teto.
 * `null` = o bloco nao veio (diferente de veio vazio).
 */
function linhasDaLista(valor: unknown): unknown[] | null {
  if (Array.isArray(valor)) return valor;
  if (valor && typeof valor === "object" && Array.isArray((valor as { linhas?: unknown }).linhas)) {
    return (valor as { linhas: unknown[] }).linhas;
  }
  return null;
}

export function lerDetalheDoCaso(resposta: unknown): DetalheDoCaso {
  const r = resposta && typeof resposta === "object" && !Array.isArray(resposta) ? (resposta as Record<string, unknown>) : {};
  const cru = r.caso && typeof r.caso === "object" && !Array.isArray(r.caso) ? (r.caso as Record<string, unknown>) : null;
  const d = r.divida && typeof r.divida === "object" && !Array.isArray(r.divida) ? (r.divida as Record<string, unknown>) : null;
  return {
    caso: cru as ItemDaFila | null,
    divida: d
      ? {
          total: numero(d.total) ?? numero(d.valorAtual),
          diasAtraso: numero(d.diasAtraso),
          faturasAbertas: numero(d.faturasAbertas),
          faturasVencidas: numero(d.faturasVencidas) ?? numero(d.vencidas),
          faturasAVencer: numero(d.faturasAVencer) ?? numero(d.aVencer),
          vencimentoMaisAntigo: textoOuNulo(d.vencimentoMaisAntigo) ?? textoOuNulo(d.maisAntiga),
          base: d.base === true,
          motivo: textoOuNulo(d.motivo),
        }
      : null,
    /*
     * A rota manda lista COM ENVELOPE (`{ linhas, total, limite }`), porque as
     * duas listas tem teto e a tela precisa saber quantas ficaram de fora.
     * Aceitamos as duas formas: array puro (contrato antigo) e envelope. Sem
     * isto o painel abria sempre vazio dizendo "a rota nao devolveu" — as duas
     * frentes combinaram formas diferentes e nenhum teste cruzava a costura
     * (achado da revisao de 06/09/2026).
     */
    faturas: linhasDaLista(r.faturas)
      ? linhasDaLista(r.faturas)!.map(lerFaturaDoCaso).filter((f): f is FaturaDoCaso => f !== null)
      : null,
    eventos: (linhasDaLista(r.eventos) as EventoDeCobranca[] | null),
    negociacoes: Array.isArray(r.negociacoes) ? (r.negociacoes as NegociacaoDeCobranca[]) : null,
  };
}
