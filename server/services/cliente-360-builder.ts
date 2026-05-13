/**
 * Spec 012.5 — Cliente 360 Builder
 *
 * Monta o payload das telas Cliente 360 Cobrança / Recuperação com:
 * - DADOS REAIS do DB (customer + equipment + contracts)
 * - HEURÍSTICAS calculadas (perfil DNA inferido, ROI estimado, predições básicas)
 * - PLACEHOLDER honesto pra dados não-disponíveis (Spec X ainda não implementada)
 *
 * Princípio: nunca mockar fake. Se não temos audit_logs ainda, retorna lista
 * vazia com flag `_pending: "Spec 003 aguardando autorização schema"`.
 * UI mostra "N/A" ou esconde a seção, sem mentir.
 */
import { storage } from "../storage";
import { calculateHealthScore } from "./customer-health/score-calculator";
import { recommendAction } from "./customer-health/recommendation-engine";
import { buildCustomerHealthInputs } from "./customer-health/snapshot-builder";

export interface Cliente360Payload {
  cliente: {
    id: number;
    nome: string;
    cpfMasked: string;
    phoneMasked: string | null;
    email: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    enderecoCompleto: string | null;
    contractStatus: "active" | "cancelled" | "suspended";
    erpSource: string | null;
    clienteDesdeIso: string | null;
    tempoRelacaoMeses: number;
    diasDesdeCancelamento: number | null;
  };
  financeiro: {
    saldoDevedor: number;
    faturasAberto: number;
    maxDiasAtraso: number;
    ultimoSync: string | null;
  };
  equipamentos: Array<{
    id: number;
    tipo: string;
    marca: string | null;
    modelo: string | null;
    serial: string | null;
    mac: string | null;
    status: string;
    valorReposicao: number | null;
    inRecoveryProcess: boolean;
  }>;
  contratos: Array<{
    id: number;
    plano: string;
    valor: number;
    status: string;
    inicio: string | null;
    fim: string | null;
  }>;
  // Heurísticas calculadas a partir dos dados reais
  perfilDna: {
    atual: string; // A1-C3 inferido
    anterior30d: string | null;
    quedaFiel: boolean;
    tom: string;
    canalPrimario: string;
    descontoMax: number;
    humanoObrigatorio: boolean;
    confianca: "alta" | "media" | "baixa_heuristica";
  };
  healthScore: {
    score: number;
    tier: string;
    components: Record<string, number>;
    inadimplenciaRisk30d: number;
    churnRisk60d: number;
    recommendation: {
      action: string;
      agent: string;
      severity: string;
    };
  };
  roi: {
    valorRecuperar: number;
    probEstimada: number;
    valorEsperado: number;
    custoEstimado: number;
    estimado: number;
    decisao: string;
  };
  // Dados que dependem de specs ainda não implementadas
  _pending: {
    auditJulia: string;
    predicoesMl: string;
    statusTecnicoNms: string;
    timelineComunicacao: string;
    consultaIspScore: string;
    reguaExecucao: string;
    alertasCriticos: string;
  };
}

/**
 * Infere perfil DNA A1-C3 baseado em dados disponíveis.
 *
 * Eixo A/B/C (atraso): A = nunca/pouco, B = médio, C = crônico
 * Eixo 1/2/3 (relação): 1 = novo, 2 = médio, 3 = fiel
 *
 * Esta é heurística. Modelo treinado virá na Spec 010A Fase B.
 */
function inferirPerfilDna(opts: {
  diasAtraso: number;
  taxaAtraso12m: number;
  tempoRelacaoMeses: number;
  faturasAberto: number;
}): string {
  // Eixo atraso
  let atrasoLetra: "A" | "B" | "C";
  if (opts.diasAtraso <= 7 && opts.taxaAtraso12m < 0.1) atrasoLetra = "A";
  else if (opts.diasAtraso <= 30 && opts.taxaAtraso12m < 0.3) atrasoLetra = "B";
  else atrasoLetra = "C";

  // Eixo relação
  let relacaoNum: "1" | "2" | "3";
  if (opts.tempoRelacaoMeses < 6) relacaoNum = "1";
  else if (opts.tempoRelacaoMeses < 24) relacaoNum = "2";
  else relacaoNum = "3";

  return `${atrasoLetra}${relacaoNum}`;
}

function policyPorPerfil(perfil: string): {
  tom: string;
  canalPrimario: string;
  descontoMax: number;
  humanoObrigatorio: boolean;
} {
  const policies: Record<string, ReturnType<typeof policyPorPerfil>> = {
    A1: { tom: "gentle", canalPrimario: "WhatsApp", descontoMax: 5, humanoObrigatorio: false },
    A2: { tom: "gentle", canalPrimario: "WhatsApp", descontoMax: 5, humanoObrigatorio: false },
    A3: { tom: "gentle", canalPrimario: "WhatsApp", descontoMax: 10, humanoObrigatorio: false },
    B1: { tom: "balanced", canalPrimario: "WhatsApp", descontoMax: 10, humanoObrigatorio: false },
    B2: { tom: "balanced", canalPrimario: "WhatsApp", descontoMax: 15, humanoObrigatorio: false },
    B3: { tom: "extra-gentle", canalPrimario: "WhatsApp", descontoMax: 25, humanoObrigatorio: true },
    C1: { tom: "firm", canalPrimario: "WhatsApp", descontoMax: 20, humanoObrigatorio: false },
    C2: { tom: "firm", canalPrimario: "WhatsApp", descontoMax: 30, humanoObrigatorio: false },
    C3: { tom: "respeitoso", canalPrimario: "WhatsApp + Voz", descontoMax: 40, humanoObrigatorio: true },
  };
  return policies[perfil] ?? policies.B2;
}

/**
 * ROI estimado heurístico baseado em valor + risco + estágio.
 * Modelo treinado virá com Specs 010A/011.
 */
function estimarRoi(opts: {
  valorAberto: number;
  diasAtraso: number;
  contractStatus: string;
  healthScore: number;
}): { prob: number; valorEsperado: number; custoEstimado: number; roi: number; decisao: string } {
  // Probabilidade base inversa ao tier de risco
  let prob = Math.max(0.05, Math.min(0.95, opts.healthScore / 100));

  // Penalidade dias atraso pra cancelados
  if (opts.contractStatus === "cancelled") {
    if (opts.diasAtraso > 365) prob *= 0.4; // dívida velha, prob baixa
    else if (opts.diasAtraso > 180) prob *= 0.6;
    else if (opts.diasAtraso > 90) prob *= 0.8;
  }

  const valorEsperado = opts.valorAberto * prob;

  // Custo estimado (Bruno R$ 0.50, Rafael R$ 2, Daniel R$ 5 negativação, Lucas R$ 25 logística)
  let custo = 5; // base
  if (opts.contractStatus === "cancelled") custo = opts.diasAtraso > 90 ? 67 : 30; // estágios

  const roi = custo > 0 ? valorEsperado / custo : 0;

  let decisao = "PROSSEGUIR";
  if (roi < 0.3) decisao = "ARQUIVAR (ROI muito baixo)";
  else if (roi < 1.0) decisao = "MARGINAL — avaliar caso a caso";
  else if (roi < 3.0) decisao = "PROSSEGUIR até estágio 3";
  else decisao = "PROSSEGUIR (ROI alto)";

  return {
    prob: Math.round(prob * 100),
    valorEsperado: Math.round(valorEsperado * 100) / 100,
    custoEstimado: custo,
    roi: Math.round(roi * 100) / 100,
    decisao,
  };
}

function maskCpf(raw: string | null): string {
  if (!raw) return "—";
  const clean = raw.replace(/\D/g, "");
  if (clean.length === 11) return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
  if (clean.length === 14) return `**.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
  return clean;
}

function maskPhone(raw: string | null): string | null {
  if (!raw) return null;
  const clean = raw.replace(/\D/g, "");
  if (clean.length < 4) return raw;
  return `(${clean.slice(0, 2)}) ****-${clean.slice(-4)}`;
}

function monthsBetween(from: Date | string | null, to: Date): number {
  if (!from) return 0;
  const fromDate = from instanceof Date ? from : new Date(from);
  if (isNaN(fromDate.getTime())) return 0;
  const yearDiff = to.getFullYear() - fromDate.getFullYear();
  const monthDiff = to.getMonth() - fromDate.getMonth();
  return Math.max(0, yearDiff * 12 + monthDiff);
}

function daysSince(date: Date | string | null): number | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

export async function buildCliente360(providerId: number, customerId: number): Promise<Cliente360Payload> {
  // 1. Customer (multi-tenant strict via storage)
  const customer = await storage.getCustomerByIdAndProvider(customerId, providerId);
  if (!customer) {
    throw new Error("customer_not_found");
  }

  // 2. Equipment + Contracts (ownership já garantida pelo customer check acima)
  let equipment: any[] = [];
  try { equipment = await storage.getEquipmentByCustomer(customerId); } catch {}
  let contracts: any[] = [];
  try { contracts = await storage.getContractsByCustomer(customerId); } catch {}

  // 3. Health Score (já existe, faz on-the-fly)
  const healthInputs = await buildCustomerHealthInputs(providerId, customerId);
  const score = calculateHealthScore(healthInputs);
  const recommendation = recommendAction(healthInputs, score);

  // 4. Inferências
  const contractStatus = (customer.status === "cancelled" ? "cancelled" : customer.status === "suspended" ? "suspended" : "active") as "active" | "cancelled" | "suspended";
  const tempoRelacaoMeses = monthsBetween(customer.createdAt, new Date());
  const diasDesdeCancelamento = contractStatus === "cancelled" ? daysSince(customer.updatedAt ?? customer.lastSyncAt) : null;

  const taxaAtraso12m = healthInputs.invoicesTotal > 0
    ? healthInputs.invoicesLate / healthInputs.invoicesTotal
    : (customer.maxDaysOverdue ?? 0) > 0 ? 0.5 : 0;

  const perfilDna = inferirPerfilDna({
    diasAtraso: customer.maxDaysOverdue ?? 0,
    taxaAtraso12m,
    tempoRelacaoMeses,
    faturasAberto: customer.overdueInvoicesCount ?? 0,
  });
  const policy = policyPorPerfil(perfilDna);

  const valorAberto = Number(customer.totalOverdueAmount ?? 0);
  const roi = estimarRoi({
    valorAberto,
    diasAtraso: customer.maxDaysOverdue ?? 0,
    contractStatus,
    healthScore: score.healthScore,
  });

  // Endereço completo
  const enderecoCompleto = [
    customer.address,
    customer.addressNumber ? `nº ${customer.addressNumber}` : null,
    customer.complement,
    customer.neighborhood,
    customer.city && customer.state ? `${customer.city}/${customer.state}` : customer.city || customer.state,
    customer.cep ? `CEP ${customer.cep}` : null,
  ].filter(Boolean).join(" · ");

  return {
    cliente: {
      id: customer.id,
      nome: customer.name,
      cpfMasked: maskCpf(customer.cpfCnpj),
      phoneMasked: maskPhone(customer.phone),
      email: customer.email,
      bairro: customer.neighborhood,
      cidade: customer.city,
      uf: customer.state,
      enderecoCompleto: enderecoCompleto || null,
      contractStatus,
      erpSource: customer.erpSource,
      clienteDesdeIso: customer.createdAt instanceof Date ? customer.createdAt.toISOString() : (customer.createdAt as any) ?? null,
      tempoRelacaoMeses,
      diasDesdeCancelamento,
    },
    financeiro: {
      saldoDevedor: valorAberto,
      faturasAberto: customer.overdueInvoicesCount ?? 0,
      maxDiasAtraso: customer.maxDaysOverdue ?? 0,
      ultimoSync: customer.lastSyncAt instanceof Date ? customer.lastSyncAt.toISOString() : (customer.lastSyncAt as any) ?? null,
    },
    equipamentos: equipment.map(eq => ({
      id: eq.id,
      tipo: eq.type ?? "—",
      marca: eq.brand,
      modelo: eq.model,
      serial: eq.serialNumber,
      mac: eq.mac,
      status: eq.status,
      valorReposicao: eq.value ? Number(eq.value) : null,
      inRecoveryProcess: !!eq.inRecoveryProcess,
    })),
    contratos: contracts.map(c => ({
      id: c.id,
      plano: c.plan,
      valor: Number(c.value),
      status: c.status,
      inicio: c.startDate instanceof Date ? c.startDate.toISOString() : c.startDate,
      fim: c.endDate instanceof Date ? c.endDate.toISOString() : c.endDate,
    })),
    perfilDna: {
      atual: perfilDna,
      anterior30d: null, // requer snapshot histórico (Spec 010A Fase B)
      quedaFiel: false, // idem
      tom: policy.tom,
      canalPrimario: policy.canalPrimario,
      descontoMax: policy.descontoMax,
      humanoObrigatorio: policy.humanoObrigatorio,
      confianca: tempoRelacaoMeses > 6 && healthInputs.invoicesTotal > 3 ? "media" : "baixa_heuristica",
    },
    healthScore: {
      score: score.healthScore,
      tier: score.healthTier,
      components: score.components as unknown as Record<string, number>,
      inadimplenciaRisk30d: score.inadimplenciaRisk30dPercent,
      churnRisk60d: score.churnRisk60dPercent,
      recommendation: {
        action: recommendation.recommendedAction,
        agent: recommendation.recommendedAgent,
        severity: recommendation.severity,
      },
    },
    roi: {
      valorRecuperar: valorAberto,
      probEstimada: roi.prob,
      valorEsperado: roi.valorEsperado,
      custoEstimado: roi.custoEstimado,
      estimado: roi.roi,
      decisao: roi.decisao,
    },
    _pending: {
      auditJulia: "Spec 003 — tabela compliance_checks aguardando autorização schema",
      predicoesMl: "Spec 010A Fase C — modelos ML treinados (regressão → gradient boosting)",
      statusTecnicoNms: "Integração NMS (Zabbix/SmartOLT/LibreNMS) não implementada",
      timelineComunicacao: "Spec 003 — tabela communications aguardando autorização schema",
      consultaIspScore: "Consulta ISP API existe — integração pendente",
      reguaExecucao: "Spec 004 — outbound_attempts aguardando + Bruno/Sofia ligados em prod",
      alertasCriticos: "Marcos Spec 011 — orquestrador detecta queda fiel/POP/geo-cluster",
    },
  };
}
