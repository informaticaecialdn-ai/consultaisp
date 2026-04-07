import type { ReactNode } from "react";
import { createElement } from "react";
import { CheckCircle, AlertCircle, XCircle } from "lucide-react";

export function formatCpfCnpj(value: string): string {
  const cleaned = value.replace(/\D/g, "");
  if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) =>
      d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
    );
  }
  return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, (_, a, b, c, d, e) =>
    e ? `${a}.${b}.${c}/${d}-${e}` : d ? `${a}.${b}.${c}/${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
  );
}

export function getInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export function getPaymentStatusLabel(daysOverdue: number, cancelledDate?: string): string {
  if (daysOverdue === 0 && !cancelledDate) return "Em dia";
  if (daysOverdue === 0 && cancelledDate) return "Cancelado (quitado)";
  if (daysOverdue <= 30) return "Inadimplente (1-30d)";
  if (daysOverdue <= 60) return "Inadimplente (31-60d)";
  if (daysOverdue <= 90) return "Inadimplente (61-90d)";
  return "Inadimplente (90+d)";
}

export function getPaymentStatusColor(daysOverdue: number): string {
  if (daysOverdue === 0) return "bg-green-100 text-green-700";
  if (daysOverdue <= 30) return "bg-red-100 text-red-700";
  if (daysOverdue <= 60) return "bg-red-100 text-red-700";
  return "bg-red-100 text-red-700";
}

export function renderAIText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return createElement("div", { key: i, className: "h-2" });
    const isHeader = /^[A-ZÁÉÍÓÚÂÊÔÀÃÕ\s]{4,}$/.test(trimmed) && trimmed === trimmed.toUpperCase() && trimmed.length > 3;
    if (isHeader) {
      return createElement("p", {
        key: i,
        className: "font-bold text-slate-800 mt-4 mb-1 text-sm uppercase tracking-wide border-b border-slate-200 pb-1",
      }, trimmed);
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      return createElement("p", {
        key: i,
        className: "text-sm text-slate-700 pl-3 flex gap-2",
      },
        createElement("span", { className: "text-indigo-400 mt-0.5" }, "•"),
        createElement("span", null, trimmed.replace(/^[-•]\s+/, "")),
      );
    }
    return createElement("p", { key: i, className: "text-sm text-slate-700" }, trimmed);
  });
}

export function escHtml(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function getDetectedType(val: string): "CEP" | "CPF" | "CNPJ" | null {
  const cleaned = val.replace(/\D/g, "");
  if (cleaned.length === 8) return "CEP";
  if (cleaned.length === 11) return "CPF";
  if (cleaned.length === 14) return "CNPJ";
  return null;
}

export function riskDecisionBadge(decision: string): string {
  if (decision === "Accept") return "bg-green-100 text-green-700";
  if (decision === "Review") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export function scoreColor(score: number): string {
  return score >= 75 ? "text-emerald-600" : score >= 50 ? "text-gray-600" : "text-red-600";
}

export function scoreBg(score: number): string {
  return score >= 75 ? "bg-green-100 text-green-800 border-green-300" :
    score >= 50 ? "bg-yellow-100 text-yellow-800 border-yellow-300" :
    "bg-red-100 text-red-800 border-red-300";
}

export function decisionIcon(decision: string) {
  return decision === "Accept" ? CheckCircle : decision === "Review" ? AlertCircle : XCircle;
}

export function decisionCardStyle(decision: string) {
  return decision === "Accept"
    ? { border: "border-green-200", header: "bg-green-50", iconClass: "text-green-600" }
    : decision === "Review"
    ? { border: "border-yellow-200", header: "bg-yellow-50", iconClass: "text-yellow-600" }
    : { border: "border-red-200", header: "bg-red-50", iconClass: "text-red-600" };
}
