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
import { POLITICA_PADRAO, ROTULO_STATUS_DE_CASO, type Economia, type Etapa, type MotivoSemEtapa } from "@shared/cobranca";
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
export const ROTA_FILA = "/cobranca/fila";
export const ROTA_REGUA = "/cobranca/regua";
export const ROTA_POLITICA = "/cobranca/politica";
export const rotaDoCliente = (customerId: number) => `/cobranca/cliente/${customerId}`;

export const API_CARTEIRA = "/api/cobranca/carteira";
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
  ultimoContatoEm: string | null;
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
  casosVivos: number | null;
  paraHoje: number | null;
  vencidos: number | null;
  agendados: number | null;
  emAberto: number | null;
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
        casosVivos: numero(kpisCrus.casosVivos),
        paraHoje: numero(kpisCrus.paraHoje),
        vencidos: numero(kpisCrus.vencidos),
        agendados: numero(kpisCrus.agendados),
        emAberto: numero(kpisCrus.emAberto),
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
  return { colunas, total: numero(r.total), pausada: pausa.pausada, pausadaMotivo: pausa.motivo };
}
