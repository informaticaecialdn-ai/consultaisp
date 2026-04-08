import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  CheckCircle, Shield, AlertTriangle, AlertCircle, XCircle,
  Info, Lock, MapPin, Router, User, RotateCcw, Save, Download,
  FileText, Home, Globe,
} from "lucide-react";
import AddressMapMini from "@/components/consulta/AddressMapMini";
import ScoreBreakdownPanel from "./ScoreBreakdownPanel";
import type { ConsultaResult, ProviderDetail, AddressMatch } from "./types";
import { formatCpfCnpj } from "./utils";

interface Props {
  result: ConsultaResult;
  onShowDetail: (idx: number) => void;
  onNewConsulta: () => void;
  onSave: () => void;
  onGeneratePDF: () => void;
}

function ProviderCard({ detail, globalIdx, onShowDetail }: { detail: ProviderDetail; globalIdx: number; onShowDetail: (idx: number) => void }) {
  const isOwn = detail.isSameProvider;
  const debtStr = isOwn && detail.overdueAmount != null
    ? `R$ ${detail.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    : detail.overdueAmountRange || null;
  const maskedName = !isOwn
    ? (() => {
        const parts = detail.customerName.split(" ");
        return parts[0] + (parts[1] ? " " + parts[1][0] + "." : "") + (parts.length > 2 ? " " + parts[parts.length - 1][0] + "***" : "***");
      })()
    : detail.customerName;
  const locationStr = isOwn
    ? detail.address || (detail.addressCity ? `${detail.addressCity}${detail.addressState ? "/" + detail.addressState : ""}` : null)
    : detail.addressCity ? `${detail.addressCity}${detail.addressState ? "/" + detail.addressState : ""}` : null;
  const isDelinquent = detail.daysOverdue > 0;

  return (
    <div className="flex items-stretch" data-testid={`provider-card-${globalIdx}`}>
      <div className={`w-1 flex-shrink-0 ${isOwn ? "bg-[var(--color-success)]" : isDelinquent ? "bg-[var(--color-danger)]" : "bg-[var(--color-border)]"}`} />
      <div className="flex-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className={`text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${isOwn ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>
                {isOwn ? "Seu provedor" : "Provedor parceiro"}
              </span>
              {!isOwn && <Lock className="w-3 h-3 text-[var(--color-muted)]" />}
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-sm border ${isOwn ? "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-success)]" : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-navy)]"}`} data-testid={`cost-badge-${globalIdx}`}>
                {isOwn ? "Grátis" : "1 crédito"}
              </span>
            </div>
            <p className="text-base font-semibold text-[var(--color-ink)] truncate" data-testid={`customer-name-${globalIdx}`}>{maskedName}</p>
            {locationStr && (
              <p className="text-xs text-[var(--color-muted)] flex items-center gap-1 mt-0.5">
                <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                {locationStr}
                {!isOwn && <Lock className="w-2 h-2 text-[var(--color-muted)]" />}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0 space-y-1">
            <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-sm ${
              isDelinquent ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" :
              detail.contractStatus === "active" ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" :
              "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"
            }`} data-testid={`contract-status-${globalIdx}`}>
              {isDelinquent ? `${detail.daysOverdue} dias em atraso` :
               detail.contractStatus === "active" ? "Em dia" :
               detail.contractStatus === "cancelled" ? "Cancelado" :
               detail.contractStatus === "suspended" ? "Suspenso" : "Sem contrato"}
            </span>
            {debtStr && (
              <p className="text-sm font-semibold text-[var(--color-danger)]" data-testid={`debt-value-${globalIdx}`}>{debtStr}</p>
            )}
            {detail.overdueInvoicesCount > 0 && (
              <p className="text-xs text-[var(--color-danger)]">{detail.overdueInvoicesCount} fatura{detail.overdueInvoicesCount > 1 ? "s" : ""} em atraso</p>
            )}
            {detail.hasUnreturnedEquipment && (
              <p className="text-xs font-bold text-[var(--color-gold)] flex items-center justify-end gap-1">
                <Router className="w-2.5 h-2.5" />
                {detail.unreturnedEquipmentCount} equip. retido{detail.unreturnedEquipmentCount > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <button
          className="mt-2 text-xs font-semibold text-[var(--color-navy)] hover:text-[var(--color-steel)] flex items-center gap-1 transition-colors"
          onClick={() => onShowDetail(globalIdx)}
          data-testid={`button-ver-informacoes-${globalIdx}`}
        >
          <Info className="w-3 h-3" />
          Ver detalhes completos
        </button>
      </div>
    </div>
  );
}

function AddressMatchCard({ match, idx }: { match: AddressMatch; idx: number }) {
  return (
    <div
      className={`flex items-center gap-4 p-4 rounded border bg-[var(--color-surface)] ${match.hasDebt ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"}`}
      data-testid={`address-match-${idx}`}
    >
      <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${match.hasDebt ? "bg-[var(--color-danger)]" : "bg-[var(--color-border)]"}`} />
      <div className="w-10 h-10 rounded-full bg-[var(--color-gold-bg)] flex items-center justify-center flex-shrink-0">
        <User className="w-5 h-5 text-[var(--color-gold)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-[var(--color-ink)]" data-testid={`address-match-name-${idx}`}>
            {match.customerName}
          </span>
          {match.isSameProvider && (
            <Badge className="bg-[var(--color-navy-bg)] text-[var(--color-navy)] border-0 text-xs">Seu cliente</Badge>
          )}
          {match.hasDebt && (
            <Badge className="bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-0 text-xs">Inadimplente</Badge>
          )}
        </div>
        <p className="text-sm text-[var(--color-muted)] mt-0.5">
          {match.isSameProvider ? (
            <>Doc: {match.cpfCnpj} &nbsp;•&nbsp; {match.providerName}</>
          ) : (
            <span className="flex items-center gap-1">
              Doc: ••••••••••• <Lock className="w-2.5 h-2.5 text-[var(--color-muted)]" /> &nbsp;•&nbsp; {match.providerName}
            </span>
          )}
        </p>
        <p className="text-sm text-[var(--color-muted)] flex items-center gap-1 mt-0.5">
          <MapPin className="w-3 h-3" />
          {match.address}{match.city ? `, ${match.city}` : ""}{match.state ? `/${match.state}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className={`text-sm font-medium px-2 py-0.5 rounded-sm ${
          match.daysOverdue != null
            ? (match.daysOverdue === 0 ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : match.daysOverdue <= 30 ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]")
            : match.hasDebt ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" : "bg-[var(--color-success-bg)] text-[var(--color-success)]"
        }`}>
          {match.status}
        </span>
        {match.isSameProvider && match.totalOverdue !== undefined && match.totalOverdue > 0 && (
          <span className="text-xs text-[var(--color-danger)] font-medium">
            R$ {match.totalOverdue.toFixed(2)} em aberto
          </span>
        )}
        {!match.isSameProvider && match.totalOverdueRange && (
          <span className="text-xs text-[var(--color-danger)] font-medium">
            {match.totalOverdueRange} em aberto
          </span>
        )}
      </div>
    </div>
  );
}

export default function ConsultaResultSummary({ result, onShowDetail, onNewConsulta, onSave, onGeneratePDF }: Props) {
  const isNotFoundWithAddressDebt = result.notFound && result.addressMatches?.some(m => m.hasDebt);
  const dc = result.decisionReco;
  const score = Math.max(0, Math.min(1000, result.score));
  const totalEquipPending = result.providerDetails.reduce((s, d) => s + (d.hasUnreturnedEquipment ? d.unreturnedEquipmentCount : 0), 0);
  const totalEquipValue = result.providerDetails.reduce((s, d) => {
    if (!d.hasUnreturnedEquipment) return s;
    return s + (d.unreturnedEquipmentCount || 0) * 290;
  }, 0);
  const externalProviders = result.providerDetails.filter(d => !d.isSameProvider);
  const ownProviders = result.providerDetails.filter(d => d.isSameProvider);
  const now = new Date();
  const consultedAt = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const hasDebtMatches = result.addressMatches?.some(m => m.hasDebt) ?? false;
  const debtCount = result.addressMatches?.filter(m => m.hasDebt).length ?? 0;
  const cleanCross = result.autoAddressCrossRef === true && !hasDebtMatches;
  const unavailable = !result.autoAddressCrossRef && !hasDebtMatches;
  const addressOwnMatches = result.addressMatches?.filter(m => m.isSameProvider) ?? [];
  const addressExtMatches = result.addressMatches?.filter(m => !m.isSameProvider) ?? [];
  const addressExtHasDebt = addressExtMatches.some(m => m.hasDebt);

  const R = 72;
  const CX = 90;
  const CY = 88;
  const arcLen = Math.PI * R;
  const scoreOffset = arcLen * (1 - score / 1000);
  const gaugeColor = score >= 701 ? "#1A4A2E" : score >= 501 ? "#B8860B" : score >= 301 ? "#C45A1A" : "#8B1A1A";
  const decisionCfg = dc === "Accept"
    ? { bg: "bg-[var(--color-success)]", border: "border-[var(--color-success)]", label: "APROVAR", icon: CheckCircle, sub: "Sem restrições na rede ISP" }
    : dc === "Reject"
    ? { bg: "bg-[var(--color-danger)]", border: "border-[var(--color-danger)]", label: "REJEITAR", icon: XCircle, sub: totalEquipPending > 0 ? `${totalEquipPending} equip. retido${totalEquipPending > 1 ? "s" : ""} · R$ ${totalEquipValue.toLocaleString("pt-BR")} em risco` : result.recommendation }
    : { bg: "bg-[var(--color-gold)]", border: "border-[var(--color-gold)]", label: "ANALISAR", icon: AlertCircle, sub: result.recommendation };

  const docDefaultValues = ["doc-seu-provedor"];
  if (externalProviders.some(d => d.daysOverdue > 0)) docDefaultValues.push("doc-outros");
  const addrDefaultValues: string[] = [];
  if (addressOwnMatches.length > 0) addrDefaultValues.push("addr-seu-provedor");
  if (addressExtHasDebt) addrDefaultValues.push("addr-outros");

  return (
    <div className="space-y-3" data-testid="consultation-result-cards">
      {/* HERO CARD */}
      {!isNotFoundWithAddressDebt && (
      <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden">
        <div className={`h-1.5 w-full ${decisionCfg.bg}`} />
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-widest">Relatório de Crédito ISP</p>
            <p className="text-2xl font-semibold text-[var(--color-ink)] font-mono tracking-tight mt-0.5" data-testid="text-consulted-doc">
              {result.searchType === "cep"
                ? result.cpfCnpj.replace(/^(\d{5})(\d{3})$/, "$1-$2")
                : formatCpfCnpj(result.cpfCnpj)}
            </p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              {result.searchType === "cep" ? "CEP" : result.searchType === "cnpj" ? "CNPJ" : "CPF"} · Consultado em {consultedAt}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[var(--color-muted)] text-xs">
            <Shield className="w-3.5 h-3.5 text-[var(--color-navy)]" />
            <span className="font-semibold text-[var(--color-navy)]">Rede ISP Colaborativa</span>
          </div>
        </div>

        <div className="px-5 pb-5 grid grid-cols-[auto_1fr] gap-6 items-center">
          {/* GAUGE SVG */}
          <div className="flex flex-col items-center">
            <svg width="180" height="100" viewBox="0 0 180 100">
              <path d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`} fill="none" stroke="#EEE9E0" strokeWidth="14" strokeLinecap="round" />
              {[
                { from: 0, to: 30, color: "#fecaca" },
                { from: 30, to: 50, color: "#fed7aa" },
                { from: 50, to: 70, color: "#fef08a" },
                { from: 70, to: 100, color: "#bbf7d0" },
              ].map((z, zi) => {
                const startAngle = Math.PI * (1 - z.from / 100);
                const endAngle = Math.PI * (1 - z.to / 100);
                const x1 = CX - R * Math.cos(startAngle);
                const y1 = CY - R * Math.sin(startAngle);
                const x2 = CX - R * Math.cos(endAngle);
                const y2 = CY - R * Math.sin(endAngle);
                const large = z.to - z.from > 50 ? 1 : 0;
                return (
                  <path key={zi} d={`M${x1},${y1} A${R},${R} 0 ${large} 0 ${x2},${y2}`} fill="none" stroke={z.color} strokeWidth="14" strokeLinecap="butt" />
                );
              })}
              <path d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`} fill="none" stroke={gaugeColor} strokeWidth="14" strokeLinecap="round" strokeDasharray={arcLen} strokeDashoffset={scoreOffset} style={{ transition: "stroke-dashoffset 0.8s ease" }} />
              <text x={CX} y={CY - 10} textAnchor="middle" fontSize="34" fontWeight="900" fill="#0f172a" fontFamily="monospace">{score}</text>
              <text x={CX} y={CY + 6} textAnchor="middle" fontSize="11" fill="#94a3b8" fontWeight="700" letterSpacing="1">DE 1000</text>
              <text x={CX - R - 4} y={CY + 14} textAnchor="end" fontSize="9" fill="#94a3b8">Muito Baixo</text>
              <text x={CX + R + 4} y={CY + 14} textAnchor="start" fontSize="9" fill="#94a3b8">Excelente</text>
            </svg>
            <p className="text-sm font-bold mt-1 tracking-wide" style={{ color: gaugeColor }} data-testid="text-risk-badge">{result.riskLabel}</p>
          </div>

          {/* DECISION + KEY STATS */}
          <div className="space-y-3">
            <div className={`${decisionCfg.bg} rounded px-4 py-3 flex items-center gap-3`} data-testid="ai-suggestion-banner">
              <decisionCfg.icon className="w-7 h-7 text-white flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-white/70 uppercase tracking-widest">Sugestão IA</p>
                <p className="text-xl font-semibold text-white leading-none" data-testid="text-ai-recommendation">{decisionCfg.label}</p>
              </div>
              <div className="ml-auto border-l border-white/25 pl-3">
                <p className="text-xs text-white/80 leading-snug max-w-[130px]">{decisionCfg.sub}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-2.5 text-center">
                <p className="text-xs text-[var(--color-muted)] font-semibold">Provedores</p>
                <p className="text-lg font-semibold text-[var(--color-ink)]">{result.providersFound || result.providerDetails.length}</p>
              </div>
              <div className={`border rounded p-2.5 text-center ${totalEquipPending > 0 ? "bg-[var(--color-gold-bg)] border-[var(--color-border)]" : "bg-[var(--color-bg)] border-[var(--color-border)]"}`}>
                <p className="text-xs text-[var(--color-muted)] font-semibold">Equip. retidos</p>
                <p className={`text-lg font-semibold ${totalEquipPending > 0 ? "text-[var(--color-gold)]" : "text-[var(--color-ink)]"}`}>{totalEquipPending}</p>
              </div>
              <div className={`border rounded p-2.5 text-center ${externalProviders.length > 0 ? "bg-[var(--color-danger-bg)] border-[var(--color-border)]" : "bg-[var(--color-bg)] border-[var(--color-border)]"}`}>
                <p className="text-xs text-[var(--color-muted)] font-semibold">Externos</p>
                <p className={`text-lg font-semibold ${externalProviders.length > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}`}>{externalProviders.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* TWO-COLUMN GRID */}
      <div className={`grid grid-cols-1 ${result.searchType !== "cep" ? "lg:grid-cols-2" : ""} gap-4`}>
        {/* LEFT COLUMN: Por Documento */}
        {result.searchType !== "cep" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-[var(--color-navy)]">
            <FileText className="w-3.5 h-3.5 inline" />
            <span className="text-base font-semibold text-[var(--color-ink)]">Resultado por Documento</span>
            <span className="text-xs font-bold bg-[var(--color-success-bg)] text-[var(--color-success)] px-2 py-0.5 rounded-sm">
              {result.providerDetails.length} provedor{result.providerDetails.length !== 1 ? "es" : ""}
            </span>
          </div>

          {isNotFoundWithAddressDebt ? (
            <div className="bg-[var(--color-surface)] rounded border-2 border-[var(--color-border)] p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-success)]">Nada Consta por Documento</p>
                  <p className="text-xs text-[var(--color-success)] mt-0.5">
                    CPF/CNPJ {formatCpfCnpj(result.cpfCnpj)} sem restrições na rede ISP colaborativa.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {result.providerDetails.length > 0 && (
                <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden">
                  <Accordion type="multiple" defaultValue={docDefaultValues}>
                    {ownProviders.length > 0 && (
                      <AccordionItem value="doc-seu-provedor" className="border-b-0">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--color-ink)]"><Home className="w-3.5 h-3.5 inline" /> Seu Provedor</span>
                            <span className="text-[11px] font-bold bg-[var(--color-success-bg)] text-[var(--color-success)] px-1.5 py-0.5 rounded-sm">{ownProviders[0]?.providerName}</span>
                            {ownProviders.some(d => d.daysOverdue > 0) ? (
                              <span className="text-[11px] font-bold bg-[var(--color-danger-bg)] text-[var(--color-danger)] px-1.5 py-0.5 rounded-sm">Inadimplente</span>
                            ) : (
                              <span className="text-[11px] font-bold bg-[var(--color-success-bg)] text-[var(--color-success)] px-1.5 py-0.5 rounded-sm">Em dia</span>
                            )}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-0">
                          <div className="divide-y divide-[var(--color-border)]">
                            {ownProviders.map((detail, i) => {
                              const globalIdx = result.providerDetails.indexOf(detail);
                              return <ProviderCard key={i} detail={detail} globalIdx={globalIdx} onShowDetail={onShowDetail} />;
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                    {externalProviders.length > 0 && (
                      <AccordionItem value="doc-outros" className="border-b-0">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--color-ink)]"><Globe className="w-3.5 h-3.5 inline" /> Outros Provedores</span>
                            <span className="text-[11px] font-bold bg-[var(--color-tag-bg)] text-[var(--color-muted)] px-1.5 py-0.5 rounded-sm">{externalProviders.length}</span>
                            {externalProviders.some(d => d.daysOverdue > 0) && (
                              <span className="text-[11px] font-bold bg-[var(--color-danger-bg)] text-[var(--color-danger)] px-1.5 py-0.5 rounded-sm">Inadimplência</span>
                            )}
                            <span className="text-[11px] font-bold bg-[var(--color-navy-bg)] text-[var(--color-navy)] px-1.5 py-0.5 rounded-sm border border-[var(--color-border)]">
                              {externalProviders.length} crédito{externalProviders.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-0">
                          <div className="divide-y divide-[var(--color-border)]">
                            {externalProviders.map((detail, i) => {
                              const globalIdx = result.providerDetails.indexOf(detail);
                              return <ProviderCard key={i} detail={detail} globalIdx={globalIdx} onShowDetail={onShowDetail} />;
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </div>
              )}
            </>
          )}

          {result.fatoresScore && <ScoreBreakdownPanel fatores={result.fatoresScore} />}
        </div>
        )}

        {/* RIGHT COLUMN: Por Endereço */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-[var(--color-gold)]">
            <MapPin className="w-3.5 h-3.5 inline" />
            <span className="text-base font-semibold text-[var(--color-ink)]">Resultado por Endereço</span>
            {debtCount > 0 ? (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-sm ${debtCount >= 3 ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" : debtCount >= 2 ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"}`}>
                {debtCount} inadimpl.
              </span>
            ) : cleanCross ? (
              <span className="text-xs font-bold bg-[var(--color-success-bg)] text-[var(--color-success)] px-2 py-0.5 rounded-sm">Limpo</span>
            ) : (
              <span className="text-xs font-bold bg-[var(--color-tag-bg)] text-[var(--color-muted)] px-2 py-0.5 rounded-sm">N/D</span>
            )}
            {result.autoAddressCrossRef === true && (
              <span className="text-[11px] font-bold bg-[var(--color-navy-bg)] text-[var(--color-navy)] px-1.5 py-0.5 rounded-sm">AUTO</span>
            )}
          </div>

          {hasDebtMatches ? (
            <div className="bg-[var(--color-danger)] rounded p-4 border-l-[6px] border-[#5a1111]">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-6 h-6 text-white animate-pulse flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-white/70 uppercase tracking-widest">Alerta de Endereço</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-white leading-none">{debtCount}</span>
                    <span className="text-sm font-semibold text-white/90">inadimplente{debtCount !== 1 ? "s" : ""} neste endereço</span>
                  </div>
                </div>
              </div>
              {isNotFoundWithAddressDebt && (
                <div className="mt-3 bg-white/10 rounded p-3">
                  <p className="text-xs text-white font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 inline" /> CPF limpo, mas endereço comprometido — possível fraude por troca de documento.
                  </p>
                </div>
              )}
            </div>
          ) : cleanCross ? (
            <div className="bg-[var(--color-success-bg)] border border-[var(--color-border)] rounded p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" />
              <div>
                <p className="text-base font-semibold text-[var(--color-success)]">Nenhuma inadimplência neste endereço</p>
                {result.addressUsed && (
                  <p className="text-sm text-[var(--color-success)] mt-0.5">
                    CEP: {result.addressUsed}
                    {result.addressSource && (
                      <span> (fonte: {result.addressSource === "own" ? "seu cadastro" : "rede ISP"})</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : unavailable ? (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-4 flex items-center gap-3">
              <MapPin className="w-5 h-5 text-[var(--color-muted)] opacity-50 flex-shrink-0" />
              <div>
                <p className="text-base font-semibold text-[var(--color-muted)]">Endereço não disponível no ERP</p>
                <p className="text-sm text-[var(--color-muted)] mt-0.5">Use a busca manual por CEP para cruzamento de endereço.</p>
              </div>
            </div>
          ) : null}

          {(result.addressUsed || ownProviders[0]?.cep) && (
            <AddressMapMini cep={result.addressUsed || ownProviders[0]?.cep || ""} />
          )}

          {result.addressMatches && result.addressMatches.length > 0 && (
            <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden">
              <Accordion type="multiple" defaultValue={addrDefaultValues}>
                {addressOwnMatches.length > 0 && (
                  <AccordionItem value="addr-seu-provedor" className="border-b-0">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--color-ink)]"><Home className="w-3.5 h-3.5 inline" /> Seu Provedor</span>
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-sm bg-[var(--color-success-bg)] text-[var(--color-success)]">{addressOwnMatches.length}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-3">
                      <div className="space-y-3">
                        {addressOwnMatches.map((match, i) => <AddressMatchCard key={i} match={match} idx={i} />)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {addressExtMatches.length > 0 && (
                  <AccordionItem value="addr-outros" className="border-b-0">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--color-ink)]"><Globe className="w-3.5 h-3.5 inline" /> Outros Provedores</span>
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-sm ${addressExtHasDebt ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" : "bg-[var(--color-success-bg)] text-[var(--color-success)]"}`}>{addressExtMatches.length}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-3">
                      <div className="space-y-3">
                        {addressExtMatches.map((match, i) => <AddressMatchCard key={i} match={match} idx={addressOwnMatches.length + i} />)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-navy)] flex-shrink-0" />
            <p className="text-sm text-[var(--color-muted)]">Dados de terceiros anonimizados conforme LGPD</p>
          </div>
        </div>
      </div>

      {/* AÇÕES */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button variant="outline" className="gap-2" onClick={onNewConsulta} data-testid="button-nova-consulta">
          <RotateCcw className="w-4 h-4" />
          Nova Consulta
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onSave} data-testid="button-save-consulta">
            <Save className="w-3.5 h-3.5" />
            Salvar
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onGeneratePDF} data-testid="button-generate-pdf">
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
