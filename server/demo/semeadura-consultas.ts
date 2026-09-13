/**
 * O HISTÓRICO de consultas do sandbox e os alertas de anti-fraude que faltavam.
 *
 * Auditoria de telas da demo (13/09/2026): o painel abria com "Consultas hoje
 * 0 · no mês 0"; os Históricos e os Relatórios da Consulta ISP, do SPC e da
 * cadastral, vazios; e o Anti-Fraude com três alertas iguais (só dívida, sem
 * equipamento, sem "Situação atualizada") e as abas Resolvidos e Descartados
 * vazias. Um visitante via cada tela de consulta pela primeira vez sem nada
 * para abrir.
 *
 * Módulo PURO, no molde de `semeadura-faturas.ts`: recebe a carteira que
 * `tentarCriarSandbox` já inseriu (com id) e devolve linhas para inserir na
 * mesma transação. Nada de banco aqui — e por isso nada de
 * `notifyOwnerProviders`, que além do banco grava o alerta no provedor DONO do
 * cliente consultado: chamado na semeadura, gravaria linha sob provedor base.
 *
 * Três regras que valem para o arquivo inteiro:
 *
 * 1. O MOTOR É O REAL. O score sai de `calcularScoreISP`, a máscara do parceiro
 *    de `maskCrossProviderDetail`, o SPC e a cadastral de `spcSimulado` e
 *    `cadastralSimulado` (os mesmos da consulta ao vivo na demo), o veredito de
 *    `decidirVeredito`, e cada alerta passa por `avaliarRiscoDeFuga` e
 *    `severidadeDoAlerta`. "Ver resultado" reabre o que a consulta ao vivo teria
 *    gravado sobre a mesma carteira — e o mesmo CPF consultado de novo pelo
 *    visitante dá o mesmo score.
 * 2. A REDE NÃO É INVENTADA. Consulta que custa crédito é a que acha registro
 *    em parceiro, e só sai para CPF que a fiação trouxe da base (`rede`). O
 *    mundo base muda por outro caminho; um registro de parceiro de imaginação
 *    contradiria a consulta ao vivo do mesmo documento.
 * 3. A DATA É DO MÊS. Toda consulta nasce entre o dia 1 e `agora` (o "no mês"
 *    do painel), parte delas hoje. A única exceção é a primeira consulta do CPF
 *    repetido: ela é de antes da dívida — é o que dá delta à linha do tempo —,
 *    e nos primeiros dias do mês isso cai no mês anterior.
 */
import {
  CUSTO_EM_CREDITOS,
  type Customer,
  type InsertCustomer,
  type InsertEquipment,
  type antiFraudAlerts,
  type antiFraudRules,
  type bigdataConsultations,
  type ispConsultations,
  type spcConsultations,
} from "@shared/schema";
import { avaliarRiscoDeFuga, diasDesde, parseDataContrato, severidadeDoAlerta, type MotivoFuga } from "@shared/antifraude-avaliacao";
import { REGRAS_PADRAO, desmontarRegras, type RegrasAntiFraude } from "@shared/antifraude-regras";
import { decidirVeredito } from "../services/bigdata-veredito";
import { FORMATO_DO_IDENTIFICADOR, PREFIXO } from "../services/identificador-consulta";
import { maskCrossProviderDetail } from "../services/lgpd-masking";
import { calcularScoreISP, type ISPScoreInput } from "../utils/isp-score";
import { cadastralSimulado, spcSimulado } from "./bureaus-simulados";

const DIA_MS = 86_400_000;

// ── Contrato com a fiação (tentarCriarSandbox) ──────────────────────────────

export type LinhaDeConsultaIsp = typeof ispConsultations.$inferInsert;
export type LinhaDeConsultaSpc = typeof spcConsultations.$inferInsert;
export type LinhaDeConsultaCadastral = typeof bigdataConsultations.$inferInsert;
export type LinhaDeAlerta = typeof antiFraudAlerts.$inferInsert;
export type LinhaDeRegra = typeof antiFraudRules.$inferInsert;

/** Um cliente da carteira JÁ inserido: a linha de `linhaDoCliente` com o id devolvido. */
export type ClienteDaConsulta = Pick<
  InsertCustomer,
  | "name" | "cpfCnpj" | "status" | "totalOverdueAmount" | "maxDaysOverdue" | "overdueInvoicesCount"
  | "contractStartDate" | "equipmentCount" | "address" | "addressNumber" | "neighborhood"
  | "city" | "state" | "cep" | "latitude" | "longitude"
> & {
  id: number;
  /** A mensalidade do plano (`valorMensalidade` da semeadura). */
  mensalidade?: number;
  /**
   * As faturas que venceram sem pagamento — as abertas de hoje e as que a
   * recuperação dos últimos 30 dias quitou (`quitadaEm`). Dão a dívida NO
   * INSTANTE de um aviso antigo, e é por elas que sai o alerta "pagou depois do
   * aviso". Sem elas, vale a dívida de hoje com o atraso recuado.
   */
  faturasVencidas?: readonly { valor: number; vencimento: Date; quitadaEm?: Date }[];
};

/**
 * Uma consulta de provedor do MUNDO BASE sobre um CPF da carteira — as linhas
 * que `complementarMundoBase` grava sobre os CPFs compartilhados. É o que a
 * consulta ao vivo conta (`getRecentConsultationsForDocument`) e o único motivo
 * legítimo de um aviso "consultado por outro provedor".
 */
export interface ConsultaDaRede {
  providerId: number;
  cpfCnpj: string;
  createdAt: Date;
}

/** As consultas por CPF, da mais recente à mais antiga. */
function consultasPorCpf(consultas: readonly ConsultaDaRede[]): Map<string, ConsultaDaRede[]> {
  const mapa = new Map<string, ConsultaDaRede[]>();
  for (const c of consultas) mapa.set(c.cpfCnpj, [...(mapa.get(c.cpfCnpj) ?? []), c]);
  for (const lista of mapa.values()) lista.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return mapa;
}

/** Um registro de provedor do MUNDO BASE com CPF que também está na carteira do sandbox. */
export type ClienteDaRede = Pick<
  Customer,
  "providerId" | "name" | "cpfCnpj" | "status" | "totalOverdueAmount" | "maxDaysOverdue" | "overdueInvoicesCount" | "contractStartDate" | "city" | "state"
>;

export type EquipamentoDoAlerta = Pick<InsertEquipment, "customerId" | "status" | "value">;

export interface ConsultasDoSandbox {
  isp: LinhaDeConsultaIsp[];
  spc: LinhaDeConsultaSpc[];
  cadastral: LinhaDeConsultaCadastral[];
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const numero = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const diasDeAtraso = (c: { maxDaysOverdue?: number | null }) => numero(c.maxDaysOverdue);
const valorEmAberto = (c: { totalOverdueAmount?: string | null }) => numero(c.totalOverdueAmount);
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Meia-noite LOCAL de hoje e dia 1 do mês — os mesmos cortes de `getDashboardStats` (dashboard.storage.ts). */
function inicioDoDia(agora: Date): Date {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d;
}
function inicioDoMes(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

/** Um instante na fração `f` (0..1) do trecho [de, ate]. */
function entre(de: Date, ate: Date, f: number): Date {
  return new Date(de.getTime() + Math.floor((ate.getTime() - de.getTime()) * f));
}

/**
 * `quantos` instantes em ordem, dentro do mês e nunca depois de `agora`: os
 * `hoje` últimos caem hoje; os demais, entre o dia 1 e ontem — ou também hoje,
 * quando o mês começou hoje.
 *
 * Nos dias anteriores a consulta vai para o horário de balcão (9h a 17h): a
 * fração pura do intervalo caía sempre em 23h59, que nenhum provedor usa para
 * consultar candidato. Hoje continua entre a meia-noite e `agora`, para nunca
 * passar do relógio.
 */
function instantesDoMes(agora: Date, quantos: number, hoje: number): Date[] {
  const dia = inicioDoDia(agora);
  const mes = inicioDoMes(agora);
  const antes = quantos - hoje;
  const haDiasAntes = dia > mes;
  const noBalcao = (d: Date, i: number): Date => {
    if (!haDiasAntes) return d;
    const x = new Date(d);
    x.setHours(9 + ((i * 5) % 9), (i * 17) % 60, 0, 0);
    return x;
  };
  const fimDoAntes = haDiasAntes ? new Date(dia.getTime() - 1) : agora;
  return [
    ...Array.from({ length: antes }, (_, i) => noBalcao(entre(mes, fimDoAntes, (i + 0.5) / antes), i)),
    ...Array.from({ length: hoje }, (_, i) => entre(dia, agora, (i + 1) / (hoje + 1))),
  ];
}

/** A lista começando num ponto que depende do provedor: sandboxes diferentes contam histórias com clientes diferentes. */
function rotacionar<T>(lista: readonly T[], semente: number): T[] {
  if (lista.length === 0) return [];
  const k = Math.abs(semente) % lista.length;
  return [...lista.slice(k), ...lista.slice(0, k)];
}

/** Tira da lista o primeiro que ainda não foi usado e atende ao critério. */
function pegar<T extends { id: number }>(lista: readonly T[], usados: Set<number>, criterio: (c: T) => boolean = () => true): T | undefined {
  const achado = lista.find(c => !usados.has(c.id) && criterio(c));
  if (achado) usados.add(achado.id);
  return achado;
}

const ALFABETO_DO_IDENTIFICADOR = "23456789ABCDEFGHJKLMNPQRSTVWXYZ";

/**
 * O código da consulta semeada, no formato do produto (`CI-AAMM-XXXXXX`).
 *
 * `gerarIdentificadorDeConsulta` sorteia, e com razão: o código não pode
 * carregar nada da PESSOA consultada. Aqui ele sai do provedor e da posição da
 * consulta na semeadura — nada da pessoa também —, o que o torna
 * determinístico e distinto entre sandboxes (o índice único do banco vale para
 * todos). Colidir com um código sorteado ao vivo exigiria acertar 6 símbolos
 * em 31⁶ no mesmo mês; se acontecer, é violação de unicidade, e `criarSandbox`
 * já tenta de novo com outro provedor.
 */
function identificadorDaSemeadura(providerId: number, sequencia: number, quando: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "2-digit", month: "2-digit" }).formatToParts(quando);
  const aamm = `${partes.find(p => p.type === "year")?.value ?? "00"}${partes.find(p => p.type === "month")?.value ?? "00"}`;
  let n = providerId * 100 + sequencia;
  let sufixo = "";
  for (let i = 0; i < 6; i++) {
    sufixo = ALFABETO_DO_IDENTIFICADOR[n % ALFABETO_DO_IDENTIFICADOR.length] + sufixo;
    n = Math.floor(n / ALFABETO_DO_IDENTIFICADOR.length);
  }
  const codigo = `${PREFIXO}-${aamm}-${sufixo}`;
  if (n > 0 || !FORMATO_DO_IDENTIFICADOR.test(codigo)) {
    throw new Error(`identificadorDaSemeadura: provedor ${providerId} não cabe no código de 6 símbolos`);
  }
  return codigo;
}

/** Faixas de sequência por tabela: códigos distintos também entre as três telas. */
const SEQUENCIA_ISP = 0;
const SEQUENCIA_SPC = 40;
const SEQUENCIA_CADASTRAL = 60;

// ── Consulta ISP ────────────────────────────────────────────────────────────

type StatusDoContrato = "active" | "cancelled" | "suspended" | undefined;
const statusDoContrato = (s: unknown): StatusDoContrato =>
  s === "active" ? "active" : s === "cancelled" ? "cancelled" : s === "suspended" ? "suspended" : undefined;

/** O que o conector devolve de um cliente — a forma de `allCustomers` em consultas.routes.ts. */
interface RegistroDaConsulta {
  providerId: number;
  providerName: string;
  isSameProvider: boolean;
  name: string;
  cpfCnpj: string;
  contractStatus: StatusDoContrato;
  maxDaysOverdue: number;
  totalOverdueAmount: number;
  overdueInvoicesCount: number;
  unreturnedEquipmentCount: number;
  address?: string | null;
  addressNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
  latitude?: string | null;
  longitude?: string | null;
}

/** A dívida do cliente como o conector a leria NAQUELE momento — a de hoje, ou a foto de antes dela. */
type Foto = Pick<RegistroDaConsulta, "maxDaysOverdue" | "totalOverdueAmount" | "overdueInvoicesCount">;

interface AlvoIsp {
  cliente: ClienteDaConsulta;
  rede: readonly ClienteDaRede[];
  quando: Date;
  foto?: Foto;
}

/** Mesma escada de consultas.routes.ts — "Em dia" só para quem ainda é cliente. */
function situacaoDoPagamento(r: RegistroDaConsulta): string {
  return r.maxDaysOverdue > 90 ? "Inadimplente (90+ dias)"
    : r.maxDaysOverdue > 60 ? "Inadimplente (61-90 dias)"
    : r.maxDaysOverdue > 30 ? "Inadimplente (31-60 dias)"
    : r.maxDaysOverdue > 0 ? "Inadimplente (1-30 dias)"
    : r.contractStatus === "cancelled" ? "Contrato encerrado"
    : "Em dia";
}

function atrasoDeParceiro(dias: number): string {
  return dias > 365 ? "mais de 1 ano" : dias > 180 ? "mais de 6 meses" : dias > 90 ? "mais de 90 dias" : dias > 30 ? "mais de 30 dias" : "menos de 30 dias";
}

function resultadoDaConsultaIsp(
  entrada: { providerId: number; nomeDoProvedor: string },
  alvo: AlvoIsp,
  consultasAnteriores: { em30d: number; em90d: number },
): { result: Record<string, unknown>; score: number; decisionReco: string; cost: number } {
  const { cliente, quando } = alvo;
  const proprio: RegistroDaConsulta = {
    providerId: entrada.providerId,
    providerName: entrada.nomeDoProvedor,
    isSameProvider: true,
    name: cliente.name,
    cpfCnpj: cliente.cpfCnpj,
    contractStatus: statusDoContrato(cliente.status),
    maxDaysOverdue: diasDeAtraso(cliente),
    totalOverdueAmount: valorEmAberto(cliente),
    overdueInvoicesCount: numero(cliente.overdueInvoicesCount),
    unreturnedEquipmentCount: numero(cliente.equipmentCount),
    address: cliente.address, addressNumber: cliente.addressNumber, neighborhood: cliente.neighborhood,
    city: cliente.city, state: cliente.state, cep: cliente.cep, latitude: cliente.latitude, longitude: cliente.longitude,
    ...alvo.foto,
  };
  const parceiros: RegistroDaConsulta[] = alvo.rede.map(r => ({
    providerId: r.providerId,
    // Nunca aparece: `maskCrossProviderDetail` troca pelo código pareado.
    providerName: "Provedor parceiro",
    isSameProvider: false,
    name: r.name,
    cpfCnpj: r.cpfCnpj,
    contractStatus: statusDoContrato(r.status),
    maxDaysOverdue: diasDeAtraso(r),
    totalOverdueAmount: valorEmAberto(r),
    overdueInvoicesCount: numero(r.overdueInvoicesCount),
    unreturnedEquipmentCount: 0,
    city: r.city, state: r.state,
  }));
  const todos = [proprio, ...parceiros];

  const providerDetails = todos.map(c => {
    const pendente = c.isSameProvider && c.unreturnedEquipmentCount > 0;
    const bruto: Record<string, unknown> = {
      providerName: c.providerName,
      providerId: c.providerId,
      isSameProvider: c.isSameProvider,
      customerName: c.name || "Desconhecido",
      cpfCnpj: c.cpfCnpj,
      status: situacaoDoPagamento(c),
      contractStatus: c.contractStatus,
      daysOverdue: c.maxDaysOverdue,
      overdueAmount: c.totalOverdueAmount,
      overdueInvoicesCount: c.overdueInvoicesCount,
      address: c.address || [c.address, c.addressNumber, c.neighborhood, c.city, c.state, c.cep].filter(Boolean).join(", "),
      addressNumber: c.addressNumber || undefined,
      neighborhood: c.neighborhood || undefined,
      addressCity: c.city || undefined,
      addressState: c.state || undefined,
      cep: c.cep || undefined,
      latitude: c.latitude || undefined,
      longitude: c.longitude || undefined,
      hasUnreturnedEquipment: pendente,
      unreturnedEquipmentCount: pendente ? c.unreturnedEquipmentCount : 0,
      equipmentStatus: pendente ? "operational_pending" : "unknown",
      equipmentSignalValidated: false,
      equipmentPendingSummary: pendente
        ? `${c.unreturnedEquipmentCount} equipamento${c.unreturnedEquipmentCount > 1 ? "s" : ""} pendente${c.unreturnedEquipmentCount > 1 ? "s" : ""} no seu ERP`
        : undefined,
    };
    return maskCrossProviderDetail(bruto, c.isSameProvider, entrada.providerId);
  });
  providerDetails.sort((a, b) =>
    (a.isSameProvider === b.isSameProvider ? 0 : a.isSameProvider ? -1 : 1)
    || String(a.providerName || "").localeCompare(String(b.providerName || "")));

  const alertas = todos
    .filter(c => c.maxDaysOverdue > 0)
    .map(c => c.isSameProvider
      ? `[${c.providerName}] Inadimplente: ${c.maxDaysOverdue} dias em atraso`
      : `[Rede ISP] Inadimplente: ${atrasoDeParceiro(c.maxDaysOverdue)} em atraso`);

  const entradaDoScore: ISPScoreInput = {
    proprio: {
      // O conector da demo não informa tempo de serviço: a consulta ao vivo
      // pontua 0 meses, e a semeada também — senão o score reaberto e o de uma
      // consulta nova do mesmo CPF divergiriam.
      mesesComoCliente: 0,
      diasAtrasoAtual: proprio.maxDaysOverdue,
      valorAtrasoAtual: proprio.totalOverdueAmount,
      faturasAtrasadasTotal: proprio.overdueInvoicesCount,
      faturasTotal: 0,
      equipamentosDevolvidos: proprio.unreturnedEquipmentCount > 0 ? false : undefined,
      statusContrato: proprio.contractStatus === "cancelled"
        ? "cancelado"
        : proprio.contractStatus === "suspended" || proprio.maxDaysOverdue > 0
        ? "suspenso"
        : proprio.contractStatus === "active"
        ? "ativo"
        : "desconhecido",
    },
    rede: {
      ocorrencias: parceiros.map(c => ({
        diasAtraso: c.maxDaysOverdue,
        valorAtraso: c.totalOverdueAmount,
        faturasAtraso: c.overdueInvoicesCount,
        statusContrato: c.contractStatus || "unknown",
      })),
      totalProvedores: new Set(parceiros.map(c => c.providerId)).size,
      consultasRecentes30d: consultasAnteriores.em30d,
      consultasRecentes90d: consultasAnteriores.em90d,
    },
    cadastro: {
      nomeCompleto: !!cliente.name, cpfValido: true, emailValido: false, telefoneValido: false,
      enderecoCompleto: !!(cliente.cep && cliente.address),
    },
  };
  const s = calcularScoreISP(entradaDoScore);
  const decisionReco = s.sugestaoIA === "APROVAR" ? "Accept" : s.sugestaoIA === "REJEITAR" ? "Reject" : "Review";
  // Um crédito quando há registro em parceiro (decisão do dono, 10/09/2026).
  const cost = parceiros.length > 0 ? CUSTO_EM_CREDITOS.isp : 0;

  const result: Record<string, unknown> = {
    cpfCnpj: cliente.cpfCnpj,
    searchType: "cpf",
    notFound: false,
    baseLegal: "Legitimo Interesse (LGPD Art. 7, IX)",
    finalidadeConsulta: "Analise de credito e protecao ao credito no ambito de servicos de telecomunicacoes",
    controlador: entrada.nomeDoProvedor,
    score: s.score,
    score100: s.score100,
    faixa: s.faixa,
    nivelRisco: s.nivelRisco,
    corIndicador: s.corIndicador,
    sugestaoIA: s.sugestaoIA,
    composicaoScore: s.composicao,
    riskTier: s.nivelRisco,
    riskLabel: s.faixa === "excelente" ? "RISCO BAIXO" : s.faixa === "bom" ? "RISCO MODERADO" : s.faixa === "baixo" ? "RISCO ALTO" : "RISCO CRITICO",
    recommendation: s.sugestaoIA,
    decisionReco,
    providersFound: new Set(todos.map(c => c.providerId)).size,
    providerDetails,
    alerts: [...alertas, ...s.alertas],
    recommendedActions: s.condicoesSugeridas,
    creditsCost: cost,
    isOwnCustomer: true,
    // O cruzamento por endereço chama os ERPs da região na hora — não há como
    // reproduzi-lo sem rede. O endereço do próprio cliente vai para o mapa, e
    // o relatório não diz que houve cruzamento automático.
    addressSearch: null,
    addressRiskAlerts: null,
    addressMatches: [],
    migratorAlert: null,
    addressSource: null,
    addressUsed: null,
    addressParts: {
      logradouro: cliente.address || undefined,
      numero: cliente.addressNumber || undefined,
      bairro: cliente.neighborhood || undefined,
      cidade: cliente.city || undefined,
      uf: cliente.state || undefined,
      cep: (cliente.cep || "").replace(/\D/g, "") || undefined,
    },
    autoAddressCrossRef: false,
    source: "erp_direct",
    simulado: true,
    frescor: { origem: "erp_ao_vivo", sincronizadoEm: quando.toISOString(), idadeHoras: 0, descricao: "consultado ao vivo no ERP" },
    erpSummary: { total: 1 + new Set(parceiros.map(c => c.providerId)).size, responded: 1 + new Set(parceiros.map(c => c.providerId)).size, failed: 0, timedOut: 0 },
    lgpdAccepted: true,
    lgpdAcceptedAt: quando.toISOString(),
    lgpdSource: "api_request",
  };
  return { result, score: s.score, decisionReco, cost };
}

const ehAtivo = (c: ClienteDaConsulta) => c.status === "active";
const ehEmDia = (c: ClienteDaConsulta) => ehAtivo(c) && diasDeAtraso(c) === 0 && valorEmAberto(c) === 0;
const ehInadimplente = (c: ClienteDaConsulta) => ehAtivo(c) && diasDeAtraso(c) > 0;

/**
 * Quem a Consulta ISP do sandbox consultou, e quando. Cada cliente cobre uma
 * pílula do parecer pela conta real do motor (ver os comentários de cada um).
 */
function alvosDaConsultaIsp(clientes: readonly ClienteDaConsulta[], rede: readonly ClienteDaRede[], providerId: number, agora: Date): AlvoIsp[] {
  const redePorCpf = new Map<string, ClienteDaRede[]>();
  for (const r of rede) {
    if (r.providerId === providerId) continue;
    redePorCpf.set(r.cpfCnpj, [...(redePorCpf.get(r.cpfCnpj) ?? []), r]);
  }
  const semRede = clientes.filter(c => !redePorCpf.has(c.cpfCnpj));
  const usados = new Set<number>();

  // O par da linha do tempo: o inadimplente de dívida mais nova. Consultado
  // antes de a fatura vencer, estava em dia (aprovar); hoje, com a fatura em
  // aberto, o teto de dívida ativa derruba o score (analisar).
  const par = [...semRede.filter(ehInadimplente)].sort((a, b) => diasDeAtraso(a) - diasDeAtraso(b) || a.id - b.id)[0];
  if (par) usados.add(par.id);

  const emDia = rotacionar(semRede.filter(ehEmDia), providerId);
  const inadimplentes = rotacionar(semRede.filter(ehInadimplente), providerId);
  const cancelados = rotacionar(semRede.filter(c => c.status === "cancelled"), providerId);

  const escolhidos = [
    pegar(emDia, usados),                                                                // em dia: aprovar
    pegar(inadimplentes, usados, c => diasDeAtraso(c) > 60),                              // dívida relevante: rejeitar
    pegar(cancelados, usados, c => valorEmAberto(c) > 0),                                 // ex-cliente devendo: rejeitar
    pegar(emDia, usados),
    pegar(inadimplentes, usados, c => diasDeAtraso(c) <= 60 && valorEmAberto(c) < 300),   // dívida leve: analisar
    pegar(cancelados, usados, c => valorEmAberto(c) === 0),                               // ex-cliente sem dívida: analisar
    ...rotacionar(clientes.filter(c => redePorCpf.has(c.cpfCnpj)), providerId).slice(0, 2), // com registro em parceiro: 1 crédito
    pegar(emDia, usados),
  ].filter((c): c is ClienteDaConsulta => !!c);

  const quantos = escolhidos.length + (par ? 1 : 0);
  const instantes = instantesDoMes(agora, quantos, Math.min(3, quantos));
  const alvos: AlvoIsp[] = escolhidos.map((cliente, i) => ({ cliente, rede: redePorCpf.get(cliente.cpfCnpj) ?? [], quando: instantes[i] }));
  if (par) {
    alvos.push({
      cliente: par,
      rede: [],
      // Três dias antes de a fatura vencer: nada em aberto.
      quando: new Date(agora.getTime() - (diasDeAtraso(par) + 3) * DIA_MS),
      foto: { maxDaysOverdue: 0, totalOverdueAmount: 0, overdueInvoicesCount: 0 },
    });
    alvos.push({ cliente: par, rede: [], quando: instantes[instantes.length - 1] });
  }
  return alvos.sort((a, b) => a.quando.getTime() - b.quando.getTime());
}

// ── SPC e cadastral ─────────────────────────────────────────────────────────

function consultasSpc(providerId: number, adminId: number, clientes: readonly ClienteDaConsulta[], agora: Date): LinhaDeConsultaSpc[] {
  // Duas limpas e duas com restrição — a situação é do hash do documento, não
  // do instante. Para na quarta: simular a carteira inteira custava meio
  // segundo da fila de `criarSandbox`.
  const limpos: ClienteDaConsulta[] = [];
  const restritos: ClienteDaConsulta[] = [];
  for (const c of rotacionar(clientes, providerId * 7 + 1)) {
    if (limpos.length === 2 && restritos.length === 2) break;
    const lista = spcSimulado(c.cpfCnpj, agora).restricao ? restritos : limpos;
    if (lista.length < 2) lista.push(c);
  }
  const escolhidos = [limpos[0], restritos[0], limpos[1], restritos[1]].filter((c): c is ClienteDaConsulta => !!c);
  const instantes = instantesDoMes(agora, escolhidos.length, Math.min(1, escolhidos.length));
  return escolhidos.map((c, i) => {
    const quando = instantes[i];
    const r = spcSimulado(c.cpfCnpj, quando);
    return {
      providerId,
      userId: adminId,
      cpfCnpj: c.cpfCnpj,
      consultaId: identificadorDaSemeadura(providerId, SEQUENCIA_SPC + i, quando),
      // Mesma forma que POST /api/spc-consultations grava (sem o XML: o simulado não tem).
      result: { ...r, creditosCobrados: CUSTO_EM_CREDITOS.spc },
      score: r.score,
      createdAt: quando,
    };
  });
}

function consultasCadastrais(providerId: number, adminId: number, clientes: readonly ClienteDaConsulta[], agora: Date): LinhaDeConsultaCadastral[] {
  // Um que aprova, um que pede atenção e um terceiro qualquer — parando assim
  // que os três aparecem, pelo mesmo motivo do SPC acima.
  const escolhidos: ClienteDaConsulta[] = [];
  const faltam = new Set<string>(["APROVAR", "ATENCAO"]);
  let terceiro: ClienteDaConsulta | undefined;
  for (const c of rotacionar(clientes.filter(x => x.cpfCnpj.replace(/\D/g, "").length === 11), providerId * 11 + 3)) {
    if (faltam.size === 0 && terceiro) break;
    if (faltam.delete(decidirVeredito(cadastralSimulado(c.cpfCnpj, agora).dados).veredito)) escolhidos.push(c);
    else terceiro ??= c;
  }
  if (terceiro) escolhidos.push(terceiro);
  const instantes = instantesDoMes(agora, escolhidos.length, Math.min(1, escolhidos.length));
  return escolhidos.map((cliente, i) => {
    const quando = instantes[i];
    const r = cadastralSimulado(cliente.cpfCnpj, quando);
    const v = decidirVeredito(r.dados);
    return {
      providerId,
      userId: adminId,
      cpfCnpj: cliente.cpfCnpj,
      consultaId: identificadorDaSemeadura(providerId, SEQUENCIA_CADASTRAL + i, quando),
      // Os mesmos campos que POST /api/bigdata-consultations grava.
      result: {
        dados: r.dados, identidade: r.identidade, enderecos: r.enderecos, telefones: r.telefones, emails: r.emails,
        renda: r.renda, risco: r.risco, inadimplencia: r.inadimplencia, processos: r.processos, rastro: r.rastro,
        ocupacao: r.ocupacao, perfil: r.perfil, mercado: r.mercado, capacidade: r.capacidade,
        domicilio: r.domicilio, cruzamentoDomicilio: r.cruzamentoDomicilio, riscoFamiliar: r.riscoFamiliar,
        validacaoTelefone: r.validacaoTelefone, imovel: r.imovel,
        datasetsIndisponiveis: r.datasetsIndisponiveis, veredito: v.veredito, motivos: v.motivos,
        datasetsComFalha: r.datasetsComFalha, latenciaMs: r.latenciaMs, bruto: r.bruto,
        nivel: "padrao", nivelPedido: "padrao", creditosCobrados: CUSTO_EM_CREDITOS.cadastral, bureauIndisponivel: false,
        simulado: true,
        baseLegal: "Legítimo interesse (LGPD Art. 7, IX)",
        finalidadeConsulta: "Análise de risco de crédito para contratação de serviço",
        lgpdAccepted: true,
      },
      datasets: [...r.datasetsChamados],
      veredito: v.veredito,
      createdAt: quando,
    };
  });
}

/**
 * As consultas que o sandbox "já fez" no mês: ~10 na Consulta ISP, 4 no SPC e
 * 3 na cadastral, todas do PRÓPRIO sandbox, pelo administrador, sobre CPFs da
 * carteira. `rede` são os registros do mundo base com CPF da carteira (os
 * compartilhados); sem ela nenhuma consulta custa crédito.
 */
export function consultasDoSandbox(entrada: {
  providerId: number;
  /** `providers.name` do sandbox — o `providerName` e o `controlador` que a consulta ao vivo grava. */
  nomeDoProvedor: string;
  adminId: number;
  clientes: readonly ClienteDaConsulta[];
  rede?: readonly ClienteDaRede[];
  /** As consultas dos provedores da rede sobre CPFs da carteira — entram na contagem de 30 e 90 dias do motor. */
  consultasDaRede?: readonly ConsultaDaRede[];
  agora: Date;
}): ConsultasDoSandbox {
  const { providerId, adminId, clientes, agora } = entrada;
  const alvos = alvosDaConsultaIsp(clientes, entrada.rede ?? [], providerId, agora);
  const daRedePorCpf = consultasPorCpf(entrada.consultasDaRede ?? []);

  const isp = alvos.map((alvo, i): LinhaDeConsultaIsp => {
    // O motor pesa quantos provedores DISTINTOS consultaram o CPF antes (30 e
    // 90 dias) — a conta de consultas.routes.ts sobre `isp_consultations`: as da
    // rede e as do próprio sandbox que vieram antes desta. Até 13/09/2026 só as
    // do sandbox entravam, e o mesmo CPF compartilhado dava alertas diferentes
    // no histórico e na consulta refeita (revisão da fase B).
    const quando = alvo.quando.getTime();
    const anteriores = [
      ...(daRedePorCpf.get(alvo.cliente.cpfCnpj) ?? []).map(c => ({ providerId: c.providerId, em: c.createdAt.getTime() })),
      ...alvos.slice(0, i).filter(a => a.cliente.cpfCnpj === alvo.cliente.cpfCnpj).map(a => ({ providerId, em: a.quando.getTime() })),
    ].filter(c => c.em < quando);
    const em = (dias: number) => new Set(anteriores.filter(c => quando - c.em <= dias * DIA_MS).map(c => c.providerId)).size;
    const { result, score, decisionReco, cost } = resultadoDaConsultaIsp(entrada, alvo, { em30d: em(30), em90d: em(90) });
    return {
      providerId,
      userId: adminId,
      cpfCnpj: alvo.cliente.cpfCnpj,
      searchType: "cpf",
      consultaId: identificadorDaSemeadura(providerId, SEQUENCIA_ISP + i, alvo.quando),
      result,
      score,
      decisionReco,
      cost,
      // A mesma coluna legada da rota (score >= 500): os relatórios contam pela decisão.
      approved: score >= 500,
      createdAt: alvo.quando,
    };
  });

  return {
    isp,
    spc: consultasSpc(providerId, adminId, clientes, agora),
    cadastral: consultasCadastrais(providerId, adminId, clientes, agora),
  };
}

// ── Anti-fraude ─────────────────────────────────────────────────────────────

/**
 * As regras do anti-fraude do sandbox: o padrão (cliente ativo com dívida)
 * mais "contrato novo" e "consultado por vários provedores". Sem elas gravadas,
 * a tela de regras diria "desligado" ao lado de alertas que só essas regras
 * produzem.
 */
export const REGRAS_DA_DEMO: RegrasAntiFraude = {
  combinacao: "qualquer",
  ativo_inadimplente: { ...REGRAS_PADRAO.ativo_inadimplente },
  contrato_novo: { ativo: true, diasMaximo: REGRAS_PADRAO.contrato_novo.diasMaximo },
  consultas_repetidas: { ativo: true, provedoresMinimos: REGRAS_PADRAO.consultas_repetidas.provedoresMinimos },
  ativo_qualquer: { ativo: false },
};

/** `REGRAS_DA_DEMO` em linhas de `anti_fraud_rules` (uma por tipo, como a tela salva). */
export function regrasAntiFraudeDaDemo(providerId: number): LinhaDeRegra[] {
  return desmontarRegras(REGRAS_DA_DEMO).map(l => ({ providerId, ...l }));
}

/** Mesmo texto de `textoDoAlerta` (proactive-alert.service.ts, que não se importa aqui: carrega o banco). */
function textoDoAlerta(motivos: MotivoFuga[], foto: { totalOverdueAmount: number; maxDaysOverdue: number }, consultasDeOutros: number, diasDeContrato?: number): string {
  switch (MOTIVOS_EM_ORDEM.find(m => motivos.includes(m))) {
    case "divida_ativa":
      return `Seu cliente ativo com ${reais(foto.totalOverdueAmount)} vencidos há ${foto.maxDaysOverdue} dia${foto.maxDaysOverdue === 1 ? "" : "s"} foi consultado por outro provedor da rede`;
    case "consultas_repetidas":
      return `Seu cliente ativo foi consultado por ${consultasDeOutros} provedores diferentes nos últimos 30 dias`;
    case "contrato_novo":
      return `Seu cliente novo, com ${diasDeContrato ?? 0} dia${diasDeContrato === 1 ? "" : "s"} de contrato, foi consultado por outro provedor da rede`;
    default:
      return "Seu cliente ativo foi consultado por outro provedor da rede";
  }
}
const MOTIVOS_EM_ORDEM: MotivoFuga[] = ["divida_ativa", "consultas_repetidas", "contrato_novo", "cliente_ativo"];

/** O aviso nasce logo depois da consulta: `notifyOwnerProviders` roda no `setImmediate` da rota que a gravou. */
const ATRASO_DO_AVISO_MS = 60_000;
/** A janela de `provedoresConsultando` (consultas.routes.ts): quem consultou o CPF nos últimos 30 dias. */
const JANELA_DAS_CONSULTAS_MS = 30 * DIA_MS;
/** Um aviso ainda não tratado tem até 30 dias; os tratados, de uma semana a dois meses. */
const IDADE_MAXIMA_DO_ABERTO_DIAS = 30;
const IDADE_DO_TRATADO_DIAS = { minimo: 7, maximo: 60 } as const;

interface FotoDoAviso {
  totalOverdueAmount: number;
  maxDaysOverdue: number;
}

/** Um aviso possível: a consulta de um provedor da rede sobre o CPF, e o que a regra leria naquele instante. */
interface MomentoDoAviso {
  consulta: ConsultaDaRede;
  em: Date;
  /** Há quantos dias (fração vale) o aviso nasceu. */
  diasAtras: number;
  /** Provedores DISTINTOS da rede que consultaram o CPF nos 30 dias até esta consulta, ela inclusive. */
  consultasDeOutros: number;
  foto: FotoDoAviso;
  diasDeContrato?: number;
}

interface HistoriaDeAlerta {
  cliente: ClienteDaConsulta;
  momento: MomentoDoAviso;
  status: "new" | "resolved" | "dismissed";
  origem: "base_sincronizada" | "erp_ao_vivo";
  equipamento?: EquipamentoDoAlerta;
}

/**
 * A dívida do cliente no instante `em`: as faturas vencidas até ali (ao menos
 * um dia) e ainda não quitadas, com o atraso da mais antiga. Sem
 * `faturasVencidas`, a dívida de hoje com o atraso recuado.
 */
function fotoNoInstante(c: ClienteDaConsulta, em: Date, agora: Date): FotoDoAviso {
  if (!c.faturasVencidas) {
    const dias = diasDeAtraso(c) - Math.ceil((agora.getTime() - em.getTime()) / DIA_MS);
    return dias >= 1 ? { totalOverdueAmount: valorEmAberto(c), maxDaysOverdue: dias } : { totalOverdueAmount: 0, maxDaysOverdue: 0 };
  }
  let total = 0;
  let dias = 0;
  for (const f of c.faturasVencidas) {
    const atraso = Math.floor((em.getTime() - f.vencimento.getTime()) / DIA_MS);
    if (atraso < 1 || (f.quitadaEm && f.quitadaEm.getTime() <= em.getTime())) continue;
    total += f.valor;
    dias = Math.max(dias, atraso);
  }
  return { totalOverdueAmount: Number(total.toFixed(2)), maxDaysOverdue: dias };
}

/**
 * Os alertas de fuga do PRÓPRIO sandbox, na forma que `notifyOwnerProviders`
 * grava: dívida em três severidades, consultas repetidas, contrato novo, ONU em
 * comodato com valor, um cliente que pagou depois do aviso (a tela mostra
 * "Situação atualizada") e, no passado, resolvidos e descartados.
 *
 * Cada aviso nasce de UMA consulta de verdade (`consultasDaRede`): o consulente
 * é o provedor da rede que consultou o CPF, o aviso vem um minuto depois dela,
 * `recentConsultations` é a contagem que a rota faria naquele instante e a
 * dívida é a daquele dia. Até 13/09/2026 o aviso escolhia qualquer cliente da
 * carteira — inclusive CPF que só o sandbox tem, que nenhum provedor pode ter
 * consultado — e o 360 do mesmo cliente contava zero consultas de outros
 * provedores ao lado de "consultado por 3 provedores" (revisão da fase B). Sem
 * consulta da rede sobre o CPF, não há aviso. Nada é gravado SOB provedor base.
 */
export function alertasExtrasDoSandbox(entrada: {
  providerId: number;
  clientes: readonly ClienteDaConsulta[];
  /** As ONUs da carteira (`linhaDoEquipamento`) — só as em comodato com valor entram. */
  equipamentos: readonly EquipamentoDoAlerta[];
  /** Os provedores do mundo base, com o nome que a semeadura grava em `consultingProviderName`. */
  provedoresDaRede: readonly { id: number; nome: string }[];
  /** As consultas dos provedores da rede sobre CPFs da carteira. */
  consultasDaRede: readonly ConsultaDaRede[];
  agora: Date;
}): LinhaDeAlerta[] {
  const { providerId, agora } = entrada;
  const nomeDaRede = new Map(entrada.provedoresDaRede.map(p => [p.id, p.nome]));
  const daRedePorCpf = consultasPorCpf(entrada.consultasDaRede.filter(c =>
    nomeDaRede.has(c.providerId) && c.createdAt.getTime() + ATRASO_DO_AVISO_MS <= agora.getTime()));
  const candidatos = rotacionar(entrada.clientes.filter(c => ehAtivo(c) && daRedePorCpf.has(c.cpfCnpj)), providerId);
  const comodato = new Map(entrada.equipamentos
    .filter(e => e.status === "em_comodato" && numero(e.value) > 0 && e.customerId != null)
    .map(e => [e.customerId as number, e]));

  const momentosPorCliente = new Map<number, MomentoDoAviso[]>();
  const momentos = (c: ClienteDaConsulta): MomentoDoAviso[] => {
    let lista = momentosPorCliente.get(c.id);
    if (lista) return lista;
    const consultas = daRedePorCpf.get(c.cpfCnpj) ?? [];
    const inicio = parseDataContrato(c.contractStartDate ?? undefined);
    lista = consultas.map(consulta => {
      const t = consulta.createdAt.getTime();
      const em = new Date(t + ATRASO_DO_AVISO_MS);
      const idade = inicio ? diasDesde(inicio, em) : undefined;
      return {
        consulta,
        em,
        diasAtras: (agora.getTime() - em.getTime()) / DIA_MS,
        consultasDeOutros: new Set(consultas.filter(x => x.createdAt.getTime() <= t && t - x.createdAt.getTime() <= JANELA_DAS_CONSULTAS_MS).map(x => x.providerId)).size,
        foto: fotoNoInstante(c, em, agora),
        diasDeContrato: idade !== undefined && idade >= 0 ? idade : undefined,
      };
    });
    momentosPorCliente.set(c.id, lista);
    return lista;
  };
  const avaliar = (c: ClienteDaConsulta, m: MomentoDoAviso) => avaliarRiscoDeFuga(
    { contractStatus: "active", contractStartDate: c.contractStartDate ?? undefined, ...m.foto },
    { consultanteEhDono: false, regras: REGRAS_DA_DEMO, consultasDeOutros: m.consultasDeOutros, agora: m.em },
  );

  type Criterio<T> = (x: T) => boolean;
  const e = <T>(...criterios: Array<Criterio<T>>): Criterio<T> => (x) => criterios.every(f => f(x));
  const aberto: Criterio<MomentoDoAviso> = m => m.diasAtras <= IDADE_MAXIMA_DO_ABERTO_DIAS;
  const tratado: Criterio<MomentoDoAviso> = m => m.diasAtras >= IDADE_DO_TRATADO_DIAS.minimo && m.diasAtras <= IDADE_DO_TRATADO_DIAS.maximo;
  const devia: Criterio<MomentoDoAviso> = m => m.foto.totalOverdueAmount > 0 && m.foto.maxDaysOverdue >= 1;
  const semDivida: Criterio<MomentoDoAviso> = m => m.foto.totalOverdueAmount === 0;
  const novo: Criterio<MomentoDoAviso> = m => m.diasDeContrato !== undefined && m.diasDeContrato <= REGRAS_DA_DEMO.contrato_novo.diasMaximo;
  const antigo: Criterio<MomentoDoAviso> = m => m.diasDeContrato !== undefined && m.diasDeContrato > REGRAS_DA_DEMO.contrato_novo.diasMaximo;
  const repetidas: Criterio<MomentoDoAviso> = m => m.consultasDeOutros >= REGRAS_DA_DEMO.consultas_repetidas.provedoresMinimos;
  const severidade = (s: ReturnType<typeof severidadeDoAlerta>): Criterio<MomentoDoAviso> => m => devia(m) && severidadeDoAlerta(["divida_ativa"], m.foto) === s;
  const deveHoje: Criterio<ClienteDaConsulta> = ehInadimplente;
  const emDiaHoje: Criterio<ClienteDaConsulta> = ehEmDia;
  const comOnu: Criterio<ClienteDaConsulta> = c => comodato.has(c.id);

  const usados = new Set<number>();
  const historias: HistoriaDeAlerta[] = [];
  /** O primeiro cliente livre com uma consulta (a mais recente) em que a história cabe e a regra real dispara. */
  const historia = (quem: Criterio<ClienteDaConsulta>, quando: Criterio<MomentoDoAviso>, resto: Pick<HistoriaDeAlerta, "status" | "origem"> & { comEquipamento?: boolean }) => {
    for (const c of candidatos) {
      if (usados.has(c.id) || !quem(c)) continue;
      // O contrato já existia no aviso, e a dívida não é mais velha que ele — a
      // revisão achou "57 dias de contrato" no mesmo card de "145 dias vencidos".
      const momento = momentos(c).find(m => m.diasDeContrato !== undefined && m.foto.maxDaysOverdue <= m.diasDeContrato && quando(m) && avaliar(c, m).alerta);
      if (!momento) continue;
      usados.add(c.id);
      historias.push({ cliente: c, momento, status: resto.status, origem: resto.origem, equipamento: resto.comEquipamento ? comodato.get(c.id) : undefined });
      return;
    }
  };

  // As histórias com menos candidatos primeiro. Dívida nas três severidades de
  // `severidadeDoAlerta`, e as que só a rede conta: vários provedores, contrato
  // novo, a ONU em comodato na casa de quem deve.
  historia(deveHoje, e(aberto, severidade("medium")), { status: "new", origem: "base_sincronizada" });
  historia(deveHoje, e(aberto, devia, novo), { status: "new", origem: "erp_ao_vivo" });
  historia(e(deveHoje, comOnu), e(aberto, devia), { status: "new", origem: "erp_ao_vivo", comEquipamento: true });
  historia(deveHoje, e(aberto, devia, repetidas), { status: "new", origem: "erp_ao_vivo" });
  // Devia no aviso e pagou depois: a foto mostra a dívida, a situação de hoje não.
  historia(emDiaHoje, e(aberto, devia), { status: "new", origem: "erp_ao_vivo" });
  // Em dia: contrato novo, e consultado por vários provedores.
  historia(emDiaHoje, e(aberto, semDivida, novo), { status: "new", origem: "erp_ao_vivo" });
  historia(emDiaHoje, e(aberto, semDivida, antigo, repetidas), { status: "new", origem: "base_sincronizada" });
  historia(deveHoje, e(aberto, severidade("high")), { status: "new", origem: "erp_ao_vivo" });
  historia(deveHoje, e(aberto, severidade("critical")), { status: "new", origem: "erp_ao_vivo" });
  historia(deveHoje, e(aberto, severidade("critical")), { status: "new", origem: "base_sincronizada" });
  historia(deveHoje, e(aberto, severidade("high")), { status: "new", origem: "base_sincronizada" });
  historia(deveHoje, e(aberto, severidade("medium")), { status: "new", origem: "erp_ao_vivo" });
  // O histórico tratado: resolvidos e descartados, de uma semana a dois meses atrás.
  historia(deveHoje, e(tratado, devia), { status: "resolved", origem: "erp_ao_vivo" });
  historia(emDiaHoje, e(tratado, semDivida, novo), { status: "resolved", origem: "erp_ao_vivo" });
  historia(emDiaHoje, e(tratado, semDivida, antigo, repetidas), { status: "dismissed", origem: "base_sincronizada" });
  historia(deveHoje, e(tratado, devia), { status: "dismissed", origem: "erp_ao_vivo" });

  return historias.map((h) => {
    const { momento: m } = h;
    const avaliacao = avaliar(h.cliente, m);
    // `historia` só aceita momento em que a regra dispara; chegar aqui sem
    // alerta é o plano derivando — falha alto, como os outros semeadores.
    if (!avaliacao.alerta) {
      throw new Error(`alertasExtrasDoSandbox: a regra não dispara para o cliente ${h.cliente.id} (${avaliacao.descartadoPor})`);
    }
    const severidade = severidadeDoAlerta(avaliacao.motivos, m.foto);
    return {
      providerId,
      customerId: h.cliente.id,
      consultingProviderId: m.consulta.providerId,
      consultingProviderName: nomeDaRede.get(m.consulta.providerId)!,
      customerName: h.cliente.name,
      customerCpfCnpj: h.cliente.cpfCnpj,
      type: "defaulter_consulted",
      severity: severidade,
      message: textoDoAlerta(avaliacao.motivos, m.foto, m.consultasDeOutros, avaliacao.diasDeContrato),
      riskScore: severidade === "critical" ? 90 : severidade === "high" ? 70 : 50,
      riskLevel: severidade === "critical" ? "critico" : severidade === "high" ? "alto" : "medio",
      riskFactors: [
        "consulta_outro_provedor",
        ...avaliacao.motivos,
        ...(avaliacao.diasDeContrato !== undefined ? [`dias_contrato:${avaliacao.diasDeContrato}`] : []),
        `combinacao:${REGRAS_DA_DEMO.combinacao ?? "qualquer"}`,
        h.origem,
      ],
      daysOverdue: m.foto.maxDaysOverdue,
      overdueAmount: m.foto.totalOverdueAmount.toFixed(2),
      equipmentNotReturned: h.equipamento ? 1 : 0,
      equipmentValue: h.equipamento ? numero(h.equipamento.value).toFixed(2) : "0",
      recentConsultations: m.consultasDeOutros,
      resolved: h.status !== "new",
      status: h.status,
      createdAt: m.em,
    };
  });
}
