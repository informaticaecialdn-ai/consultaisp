import {
  BarChart3, Activity, Building2, Users, Database, DollarSign,
  MessageSquare, RefreshCw, Settings, ClipboardList, Target,
} from "lucide-react";

export const VALID_TABS = [
  "painel",
  "cadastros",
  "provedores",
  "financeiro",
  "suporte",
  "configuracoes",
  "crm",
] as const;

export type AdminTabKey = (typeof VALID_TABS)[number];

export const PAGE_META: Record<string, { title: string; desc: string; icon: any; color: string }> = {
  painel: { title: "Painel Geral", desc: "Visao geral do sistema", icon: BarChart3, color: "from-red-600 to-rose-700" },
  cadastros: { title: "Cadastros", desc: "Cadastros realizados pela landing page", icon: Activity, color: "from-amber-600 to-orange-700" },
  provedores: { title: "Provedores", desc: "Gerencie todos os provedores", icon: Building2, color: "from-blue-600 to-indigo-700" },
  financeiro: { title: "Faturas e Cobrancas", desc: "Receita, faturas e pagamentos", icon: DollarSign, color: "from-emerald-600 to-teal-700" },
  suporte: { title: "Suporte", desc: "Chat direto com provedores e visitantes", icon: MessageSquare, color: "from-orange-500 to-amber-600" },
  configuracoes: { title: "Configuracoes", desc: "Catalogo de ERPs e configuracoes do sistema", icon: Settings, color: "from-teal-600 to-emerald-700" },
  crm: { title: "CRM Vendas", desc: "Gestao de leads, pipeline e agentes de vendas", icon: Target, color: "from-pink-600 to-rose-700" },
  // Legacy aliases (still referenced by deep links / internals)
  usuarios: { title: "Usuarios", desc: "Contas e acessos do sistema", icon: Users, color: "from-violet-600 to-purple-700" },
  erps: { title: "ERPs Cadastrados", desc: "Gerencie os sistemas ERP suportados", icon: Database, color: "from-teal-600 to-emerald-700" },
  integracoes: { title: "Integracoes", desc: "Configuracao ERP por provedor", icon: Database, color: "from-blue-500 to-violet-600" },
  sincronizacao: { title: "Sincronizacao Automatica", desc: "Agendamento e monitoramento do auto-sync de ERPs", icon: RefreshCw, color: "from-cyan-600 to-teal-700" },
};

export const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: "Gratuito", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  basic: { label: "Basico", color: "bg-[var(--color-navy-bg)] text-[var(--color-navy)] dark:bg-blue-900 dark:text-blue-300" },
  pro: { label: "Pro", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" },
  enterprise: { label: "Enterprise", color: "bg-amber-100 text-[var(--color-gold)] dark:bg-amber-900 dark:text-amber-300" },
};

export const ERP_OPTIONS = [
  { key: "ixc", name: "iXC Soft", desc: "iXC Provedor", grad: "from-blue-500 to-blue-600" },
  { key: "sgp", name: "SGP", desc: "Solucao Gestao", grad: "from-purple-500 to-purple-600" },
  { key: "mk", name: "MK Solutions", desc: "MK-AUTH/ERP", grad: "from-green-500 to-green-600" },
  { key: "tiacos", name: "Tiacos", desc: "Tiacos ISP", grad: "from-orange-500 to-orange-600" },
  { key: "hubsoft", name: "Hubsoft", desc: "Hubsoft ERP", grad: "from-indigo-500 to-indigo-600" },
  { key: "flyspeed", name: "Fly Speed", desc: "Fly Speed ISP", grad: "from-cyan-500 to-cyan-600" },
  { key: "netflash", name: "Netflash", desc: "Netflash ISP", grad: "from-rose-500 to-pink-600" },
  { key: "voalle", name: "Voalle", desc: "Voalle ERP", grad: "from-amber-500 to-yellow-600" },
  { key: "rbx", name: "RBX ISP", desc: "RBXSoft", grad: "from-red-500 to-red-600" },
  { key: "topsapp", name: "TopSApp", desc: "TopSApp ERP", grad: "from-emerald-500 to-teal-600" },
  { key: "radiusnet", name: "RadiusNet", desc: "RadiusNet ERP", grad: "from-sky-500 to-blue-600" },
  { key: "gere", name: "Gere", desc: "Gere ERP", grad: "from-lime-500 to-green-600" },
  { key: "receitanet", name: "ReceitaNet", desc: "ReceitaNet ERP", grad: "from-fuchsia-500 to-purple-600" },
];

export const ERP_MAP: Record<string, string> = Object.fromEntries(ERP_OPTIONS.map(e => [e.key, e.name]));

export const QUICK_REPLIES = [
  "Olá! Como posso ajudar?",
  "Obrigado pelo contato. Vamos verificar isso para você.",
  "Seu pedido foi registrado e será processado em breve.",
  "Para resolver isso, precisamos de mais informações. Poderia detalhar melhor?",
  "O problema foi identificado e está sendo resolvido.",
  "Sua conta foi atualizada com sucesso!",
  "Por favor, acesse o painel e verifique se o problema persiste.",
];

export function chatRelTime(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function chatFullTime(d: string): string {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function chatDayLabel(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function providerInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export const VERIFICATION_LABELS: Record<string, { label: string; color: string; icon: any }> = {};
// VERIFICATION_LABELS populated at use-site to avoid circular icon imports;
// kept here only as a type marker. Consumers inline their own constants.
