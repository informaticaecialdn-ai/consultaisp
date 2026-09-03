import {
  BarChart3, Activity, Building2, Users, Database, DollarSign,
  MessageSquare, RefreshCw, Settings, ClipboardList,
} from "lucide-react";
import { rotuloDoPlano } from "@/lib/planos";

export const VALID_TABS = [
  "painel",
  "cadastros",
  "provedores",
  "financeiro",
  "suporte",
  "configuracoes",
] as const;

export type AdminTabKey = (typeof VALID_TABS)[number];

/**
 * Meta das abas do admin. Sem cor por aba: no Bureau a identidade vem da
 * tipografia, e sete gradientes diferentes eram exatamente a bagunca.
 */
export const PAGE_META: Record<string, { title: string; desc: string; icon: any }> = {
  painel: { title: "Painel Geral", desc: "Visao geral do sistema", icon: BarChart3 },
  cadastros: { title: "Cadastros", desc: "Cadastros realizados pela landing page", icon: Activity },
  provedores: { title: "Provedores", desc: "Gerencie todos os provedores", icon: Building2 },
  financeiro: { title: "Faturas e Cobrancas", desc: "Receita, faturas e pagamentos", icon: DollarSign },
  suporte: { title: "Suporte", desc: "Chat direto com provedores e visitantes", icon: MessageSquare },
  configuracoes: { title: "Configuracoes", desc: "Catalogo de ERPs e configuracoes do sistema", icon: Settings },
  // Legacy aliases (still referenced by deep links / internals)
  usuarios: { title: "Usuarios", desc: "Contas e acessos do sistema", icon: Users },
  erps: { title: "ERPs Cadastrados", desc: "Gerencie os sistemas ERP suportados", icon: Database },
  integracoes: { title: "Integracoes", desc: "Configuracao ERP por provedor", icon: Database },
  sincronizacao: { title: "Sincronizacao Automatica", desc: "Agendamento e monitoramento do auto-sync de ERPs", icon: RefreshCw },
};

/**
 * Badge de plano no padrao Bureau: retangular, tokens do sistema, mesmos pares
 * nos dois temas. Gratuito e neutro; pago sobe em intensidade de marca.
 *
 * O ROTULO vem de `@/lib/planos` — fonte unica. So a cor mora aqui, porque e
 * decisao desta tela. Os dois legados ficam em cinza: nao sao oferecidos, e
 * destacar um plano que nao existe mais confunde quem le a lista.
 */
export const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: rotuloDoPlano("free"), color: "bg-[var(--color-tag-bg)] text-[var(--color-muted)]" },
  pro: { label: rotuloDoPlano("pro"), color: "bg-[var(--color-brand-bg)] text-[var(--color-steel)] font-semibold" },
  basic: { label: rotuloDoPlano("basic"), color: "bg-[var(--color-tag-bg)] text-[var(--color-muted)]" },
  enterprise: { label: rotuloDoPlano("enterprise"), color: "bg-[var(--color-tag-bg)] text-[var(--color-muted)]" },
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
