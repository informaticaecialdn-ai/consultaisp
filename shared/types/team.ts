/**
 * Provedor.ai Digital Team — shared types (client + server).
 *
 * Referência canônica: C:\Provedor.ai\Ecossistema\TEAM.md §4
 * Estados de cada agente são derivados em runtime via server/services/team.service.ts
 * a partir de audit_logs / outbound_attempts / compliance_checks por providerId.
 */

export const AGENT_IDS = [
  "marcos",  // Gerente de Operações (orquestrador) — em treinamento
  "julia",   // Analista de Conformidade — online ✓
  "bruno",   // Lembrador Sênior — online ✓ (toggle controla disparo)
  "helena",  // Atendente Master — online ✓
  "rafael",  // Negociador D+1 a D+14 — em treinamento
  "carla",   // Esp. Suspensão/Reconexão — em treinamento
  "daniel",  // Cobrador Sênior D+60+ — em treinamento
  "lucas",   // Logística Reversa — em treinamento
  "sofia",   // Customer Care — online ✓ (toggle controla disparo)
  "pedro",   // Pesquisa & Insights — em treinamento
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

/**
 * Stack canônico (TEAM.md §2). Quando o Plano B (Marcos Direct API) virar
 * Plano A (Managed Agents), apenas a função `getAgentStack(id)` muda — UI
 * continua reusando.
 */
export type AgentStack = "direct-api" | "managed-agents";

/**
 * Status visível no UI. "online" = agente registrado e configurado.
 * "training" = previsto pelo TEAM.md mas ainda não implementado.
 * "offline" = implementado mas toggle desligado (apenas Bruno/Sofia hoje).
 */
export type AgentStatus = "online" | "training" | "offline";

/**
 * KPI exibido no card e na página de detalhe. Cada agente reporta UMA
 * métrica primária no roster (mais detalhes vivem em /time/:agentId).
 */
export interface AgentKpi {
  label: string;     // "Lembretes enviados", "Taxa de bloqueio", etc.
  value: number;     // valor numérico do mês corrente
  unit?: string;     // "msgs", "%", "R$" (omitido = unidade implícita)
  trend?: "up" | "down" | "flat";  // opcional, comparativo com mês anterior
}

export interface AgentProfile {
  id: AgentId;
  name: string;             // "Bruno"
  role: string;             // "Lembrador Sênior"
  description: string;      // 1-2 linhas do TEAM.md §4
  stack: AgentStack;
  model: string;            // "Claude Haiku 4.5", "Claude Sonnet 4.6", "Claude Opus 4.7"
  status: AgentStatus;
  kpi: AgentKpi | null;     // null = agente em training ou sem dados ainda
  /** Quando previsto entrar em produção (referência: roadmap Q3/2026 etc). */
  plannedSpec?: string;     // "Spec 009 (Q3/2026)" para Rafael, etc.
}

/**
 * Catálogo estático com persona + cores (DESIGN.md §5.1). Source-of-truth
 * para tudo que NÃO depende de runtime (cor do badge, nome, role, descrição).
 *
 * Cores referenciadas via CSS vars do tokens.css adicionado em Spec 006.
 */
export interface AgentCatalogEntry {
  id: AgentId;
  name: string;
  initials: string;          // 2 letras Fraunces no badge
  role: string;
  description: string;
  stack: AgentStack;
  model: string;
  /** Cor de fundo do avatar — usa CSS var. */
  bgVar: string;             // "var(--color-brand-green-700)"
  /** Cor do texto (iniciais) — usa CSS var ou nome literal. */
  fgVar: string;             // "var(--color-brand-cream-50)"
  plannedSpec?: string;
}

export const AGENT_CATALOG: Record<AgentId, AgentCatalogEntry> = {
  marcos: {
    id: "marcos",
    name: "Marcos",
    initials: "MA",
    role: "Gerente de Operações",
    description: "Orquestrador: decide quem do time atua sobre qual cliente, quando e com qual tom.",
    stack: "direct-api",  // Plano B — migra para managed-agents pós-DPA
    model: "Claude Opus 4.7",
    bgVar: "var(--color-brand-navy-700)",
    fgVar: "var(--color-brand-cream-50)",
    plannedSpec: "Spec 011",
  },
  julia: {
    id: "julia",
    name: "Júlia",
    initials: "JU",
    role: "Analista de Conformidade",
    description: "Valida em <500ms toda comunicação outbound. Anatel 765, CDC, LGPD. Tem poder de veto.",
    stack: "direct-api",
    model: "Claude Haiku 4.5",
    bgVar: "var(--color-brand-navy-900)",
    fgVar: "var(--color-shield-gold)",
  },
  bruno: {
    id: "bruno",
    name: "Bruno",
    initials: "BR",
    role: "Lembrador Sênior",
    description: "Lembretes pré-vencimento (D-5/D-3/D-1) personalizados por perfil A1-C3.",
    stack: "direct-api",
    model: "Claude Haiku 4.5",
    bgVar: "var(--color-brand-green-500)",
    fgVar: "var(--color-brand-cream-50)",
  },
  helena: {
    id: "helena",
    name: "Helena",
    initials: "HE",
    role: "Atendente Master",
    description: "Atendimento inbound 24/7 com memória persistente. Resolve dúvidas, gera 2ª via, confirma pagamento.",
    stack: "direct-api",
    model: "Claude Sonnet 4.6",
    bgVar: "var(--color-brand-green-700)",
    fgVar: "var(--color-brand-cream-50)",
  },
  rafael: {
    id: "rafael",
    name: "Rafael",
    initials: "RA",
    role: "Negociador",
    description: "Recupera valor entre D+1 e D+14 negociando desconto, prorrogação, parcelamento.",
    stack: "direct-api",
    model: "Claude Sonnet 4.6",
    bgVar: "var(--color-brand-amber-500)",
    fgVar: "var(--color-brand-navy-900)",
    plannedSpec: "Spec 009",
  },
  carla: {
    id: "carla",
    name: "Carla",
    initials: "CA",
    role: "Especialista em Suspensão e Reconexão",
    description: "Executa ciclo Anatel 765 (D+15/D+30/D+60). Religamento automático em <60s pós-pagamento.",
    stack: "direct-api",
    model: "Claude Sonnet 4.6",
    bgVar: "var(--color-danger)",
    fgVar: "var(--color-brand-cream-50)",
    plannedSpec: "Spec 010",
  },
  daniel: {
    id: "daniel",
    name: "Daniel",
    initials: "DA",
    role: "Cobrador Sênior",
    description: "Recupera dívidas pós-cancelamento (D+60+) via acordo amigável, SPC/Serasa, protesto.",
    stack: "managed-agents",
    model: "Claude Opus 4.7",
    bgVar: "var(--color-brand-navy-900)",
    fgVar: "var(--color-shield-gold)",
    plannedSpec: "Spec 012",
  },
  lucas: {
    id: "lucas",
    name: "Lucas",
    initials: "LU",
    role: "Logística Reversa",
    description: "Recupera equipamentos em comodato pós-cancelamento. Roteirização inteligente de coleta.",
    stack: "managed-agents",
    model: "Claude Sonnet 4.6",
    bgVar: "var(--color-brand-amber-700)",
    fgVar: "var(--color-brand-cream-50)",
    plannedSpec: "Spec 013",
  },
  sofia: {
    id: "sofia",
    name: "Sofia",
    initials: "SO",
    role: "Customer Care",
    description: "Agradece pagamentos confirmados de forma humanizada e seletiva. Anti-fadiga.",
    stack: "direct-api",
    model: "Claude Haiku 4.5",
    bgVar: "var(--color-brand-green-100)",
    fgVar: "var(--color-brand-green-900)",
  },
  pedro: {
    id: "pedro",
    name: "Pedro",
    initials: "PE",
    role: "Pesquisa & Insights",
    description: "NPS, pulse check, pós-acordo. Classifica respostas e escala detratores em <1h.",
    stack: "managed-agents",
    model: "Claude Sonnet 4.6",
    bgVar: "var(--color-brand-navy-500)",
    fgVar: "var(--color-brand-cream-50)",
    plannedSpec: "Spec 014",
  },
};

/** Helpers de pesquisa. */
export function getAgent(id: AgentId): AgentCatalogEntry {
  return AGENT_CATALOG[id];
}

export function listAllAgents(): AgentCatalogEntry[] {
  return AGENT_IDS.map((id) => AGENT_CATALOG[id]);
}

/** Subset dos 4 implementados — usado pelo team service pra calcular KPIs reais. */
export const ACTIVE_AGENT_IDS: AgentId[] = ["julia", "bruno", "helena", "sofia"];

export function isActive(id: AgentId): boolean {
  return ACTIVE_AGENT_IDS.includes(id);
}
