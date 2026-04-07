import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  CheckCircle, Shield, AlertTriangle, AlertCircle, XCircle,
  Info, Lock, MapPin, Router, User, RotateCcw, Save, Download,
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
      <div className={`w-1 flex-shrink-0 ${isOwn ? "bg-emerald-400" : isDelinquent ? "bg-red-400" : "bg-slate-300"}`} />
      <div className="flex-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded ${isOwn ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {isOwn ? "Seu provedor" : "Provedor parceiro"}
              </span>
              {!isOwn && <Lock className="w-3 h-3 text-slate-300" />}
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${isOwn ? "bg-white border-emerald-200 text-emerald-600" : "bg-white border-blue-100 text-blue-500"}`} data-testid={`cost-badge-${globalIdx}`}>
                {isOwn ? "Grátis" : "1 crédito"}
              </span>
            </div>
            <p className="text-sm font-black text-slate-900 truncate" data-testid={`customer-name-${globalIdx}`}>{maskedName}</p>
            {locationStr && (
              <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                {locationStr}
                {!isOwn && <Lock className="w-2 h-2 text-slate-300" />}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0 space-y-1">
            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
              isDelinquent ? "bg-red-100 text-red-700" :
              detail.contractStatus === "active" ? "bg-emerald-100 text-emerald-700" :
              "bg-slate-100 text-slate-500"
            }`} data-testid={`contract-status-${globalIdx}`}>
              {isDelinquent ? `${detail.daysOverdue} dias em atraso` :
               detail.contractStatus === "active" ? "Em dia" :
               detail.contractStatus === "cancelled" ? "Cancelado" :
               detail.contractStatus === "suspended" ? "Suspenso" : "Sem contrato"}
            </span>
            {debtStr && (
              <p className="text-sm font-black text-red-600" data-testid={`debt-value-${globalIdx}`}>{debtStr}</p>
            )}
            {detail.overdueInvoicesCount > 0 && (
              <p className="text-[10px] text-red-500">{detail.overdueInvoicesCount} fatura{detail.overdueInvoicesCount > 1 ? "s" : ""} em atraso</p>
            )}
            {detail.hasUnreturnedEquipment && (
              <p className="text-[10px] font-bold text-amber-600 flex items-center justify-end gap-1">
                <Router className="w-2.5 h-2.5" />
                {detail.unreturnedEquipmentCount} equip. retido{detail.unreturnedEquipmentCount > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <button
          className="mt-2 text-[10px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
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
      className={`flex items-center gap-4 p-4 rounded-xl border bg-white ${match.hasDebt ? "border-red-200" : "border-slate-200"}`}
      data-testid={`address-match-${idx}`}
    >
      <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${match.hasDebt ? "bg-red-400" : "bg-slate-300"}`} />
      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
        <User className="w-5 h-5 text-orange-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-900" data-testid={`address-match-name-${idx}`}>
            {match.customerName}
          </span>
          {match.isSameProvider && (
            <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">Seu cliente</Badge>
          )}
          {match.hasDebt && (
            <Badge className="bg-red-100 text-red-700 border-0 text-xs">Inadimplente</Badge>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {match.isSameProvider ? (
            <>Doc: {match.cpfCnpj} &nbsp;•&nbsp; {match.providerName}</>
          ) : (
            <span className="flex items-center gap-1">
              Doc: ••••••••••• <Lock className="w-2.5 h-2.5 text-slate-300" /> &nbsp;•&nbsp; {match.providerName}
            </span>
          )}
        </p>
        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
          <MapPin className="w-3 h-3" />
          {match.address}{match.city ? `, ${match.city}` : ""}{match.state ? `/${match.state}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          match.daysOverdue != null
            ? (match.daysOverdue === 0 ? "bg-emerald-100 text-emerald-700" : match.daysOverdue <= 30 ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700")
            : match.hasDebt ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
        }`}>
          {match.status}
        </span>
        {match.isSameProvider && match.totalOverdue !== undefined && match.totalOverdue > 0 && (
          <span className="text-xs text-red-600 font-medium">
            R$ {match.totalOverdue.toFixed(2)} em aberto
          </span>
        )}
        {!match.isSameProvider && match.totalOverdueRange && (
          <span className="text-xs text-red-600 font-medium">
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
  const gaugeColor = score >= 701 ? "#22c55e" : score >= 501 ? "#eab308" : score >= 301 ? "#f97316" : "#dc2626";
  const decisionCfg = dc === "Accept"
    ? { bg: "bg-emerald-600", border: "border-emerald-700", label: "APROVAR", icon: CheckCircle, sub: "Sem restrições na rede ISP" }
    : dc === "Reject"
    ? { bg: "bg-red-600", border: "border-red-700", label: "REJEITAR", icon: XCircle, sub: totalEquipPending > 0 ? `${totalEquipPending} equip. retido${totalEquipPending > 1 ? "s" : ""} · R$ ${totalEquipValue.toLocaleString("pt-BR")} em risco` : result.recommendation }
    : { bg: "bg-amber-500", border: "border-amber-600", label: "ANALISAR", icon: AlertCircle, sub: result.recommendation };

  const docDefaultValues = ["doc-seu-provedor"];
  if (externalProviders.some(d => d.daysOverdue > 0)) docDefaultValues.push("doc-outros");
  const addrDefaultValues: string[] = [];
  if (addressOwnMatches.length > 0) addrDefaultValues.push("addr-seu-provedor");
  if (addressExtHasDebt) addrDefaultValues.push("addr-outros");

  return (
    <div className="space-y-3" data-testid="consultation-result-cards">
      {/* HERO CARD */}
      {!isNotFoundWithAddressDebt && (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className={`h-1.5 w-full ${decisionCfg.bg}`} />
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Relatório de Crédito ISP</p>
            <p className="text-xl font-black text-slate-900 font-mono tracking-tight mt-0.5" data-testid="text-consulted-doc">
              {result.searchType === "cep"
                ? result.cpfCnpj.replace(/^(\d{5})(\d{3})$/, "$1-$2")
                : formatCpfCnpj(result.cpfCnpj)}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {result.searchType === "cep" ? "CEP" : result.searchType === "cnpj" ? "CNPJ" : "CPF"} · Consultado em {consultedAt}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
            <Shield className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-semibold text-blue-500">Rede ISP Colaborativa</span>
          </div>
        </div>

        <div className="px-5 pb-5 grid grid-cols-[auto_1fr] gap-6 items-center">
          {/* GAUGE SVG */}
          <div className="flex flex-col items-center">
            <svg width="180" height="100" viewBox="0 0 180 100">
              <path d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`} fill="none" stroke="#f1f5f9" strokeWidth="14" strokeLinecap="round" />
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
              <text x={CX} y={CY - 10} textAnchor="middle" fontSize="28" fontWeight="900" fill="#0f172a" fontFamily="monospace">{score}</text>
              <text x={CX} y={CY + 6} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700" letterSpacing="1">DE 1000</text>
              <text x={CX - R - 4} y={CY + 14} textAnchor="end" fontSize="7.5" fill="#94a3b8">Muito Baixo</text>
              <text x={CX + R + 4} y={CY + 14} textAnchor="start" fontSize="7.5" fill="#94a3b8">Excelente</text>
            </svg>
            <p className="text-xs font-bold mt-1 tracking-wide" style={{ color: gaugeColor }} data-testid="text-risk-badge">{result.riskLabel}</p>
          </div>

          {/* DECISION + KEY STATS */}
          <div className="space-y-3">
            <div className={`${decisionCfg.bg} rounded-xl px-4 py-3 flex items-center gap-3`} data-testid="ai-suggestion-banner">
              <decisionCfg.icon className="w-7 h-7 text-white flex-shrink-0" />
              <div>
                <p className="text-[9px] font-bold text-white/70 uppercase tracking-widest">Sugestão IA</p>
                <p className="text-lg font-black text-white leading-none" data-testid="text-ai-recommendation">{decisionCfg.label}</p>
              </div>
              <div className="ml-auto border-l border-white/25 pl-3">
                <p className="text-[10px] text-white/80 leading-snug max-w-[130px]">{decisionCfg.sub}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
                <p className="text-[10px] text-slate-400 font-semibold">Provedores</p>
                <p className="text-lg font-black text-slate-800">{result.providersFound || result.providerDetails.length}</p>
              </div>
              <div className={`border rounded-xl p-2.5 text-center ${totalEquipPending > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
                <p className="text-[10px] text-slate-400 font-semibold">Equip. retidos</p>
                <p className={`text-lg font-black ${totalEquipPending > 0 ? "text-amber-600" : "text-slate-800"}`}>{totalEquipPending}</p>
              </div>
              <div className={`border rounded-xl p-2.5 text-center ${externalProviders.length > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                <p className="text-[10px] text-slate-400 font-semibold">Externos</p>
                <p className={`text-lg font-black ${externalProviders.length > 0 ? "text-red-600" : "text-slate-800"}`}>{externalProviders.length}</p>
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
          <div className="flex items-center gap-2 pb-2 border-b-2 border-blue-500">
            <span className="text-sm font-black text-slate-700">📄 Resultado por Documento</span>
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
              {result.providerDetails.length} provedor{result.providerDetails.length !== 1 ? "es" : ""}
            </span>
          </div>

          {isNotFoundWithAddressDebt ? (
            <div className="bg-white rounded-2xl border-2 border-green-200 shadow-sm p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800">Nada Consta por Documento</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    CPF/CNPJ {formatCpfCnpj(result.cpfCnpj)} sem restrições na rede ISP colaborativa.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {result.providerDetails.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <Accordion type="multiple" defaultValue={docDefaultValues}>
                    {ownProviders.length > 0 && (
                      <AccordionItem value="doc-seu-provedor" className="border-b-0">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">🏠 Seu Provedor</span>
                            <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{ownProviders[0]?.providerName}</span>
                            {ownProviders.some(d => d.daysOverdue > 0) ? (
                              <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Inadimplente</span>
                            ) : (
                              <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Em dia</span>
                            )}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-0">
                          <div className="divide-y divide-slate-100">
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
                            <span className="text-xs font-bold text-slate-700">🌐 Outros Provedores</span>
                            <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{externalProviders.length}</span>
                            {externalProviders.some(d => d.daysOverdue > 0) && (
                              <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Inadimplência</span>
                            )}
                            <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">
                              {externalProviders.length} crédito{externalProviders.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-0">
                          <div className="divide-y divide-slate-100">
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
          <div className="flex items-center gap-2 pb-2 border-b-2 border-orange-500">
            <span className="text-sm font-black text-slate-700">📍 Resultado por Endereço</span>
            {debtCount > 0 ? (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${debtCount >= 3 ? "bg-red-100 text-red-700" : debtCount >= 2 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                {debtCount} inadimpl.
              </span>
            ) : cleanCross ? (
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Limpo</span>
            ) : (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">N/D</span>
            )}
            {result.autoAddressCrossRef === true && (
              <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">AUTO</span>
            )}
          </div>

          {hasDebtMatches ? (
            <div className="bg-red-600 rounded-2xl p-4 shadow-sm border-l-[6px] border-red-800">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-6 h-6 text-white animate-pulse flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest">Alerta de Endereço</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[32px] font-black text-white leading-none">{debtCount}</span>
                    <span className="text-sm font-semibold text-white/90">inadimplente{debtCount !== 1 ? "s" : ""} neste endereço</span>
                  </div>
                </div>
              </div>
              {isNotFoundWithAddressDebt && (
                <div className="mt-3 bg-white/10 rounded-lg p-3">
                  <p className="text-xs text-white font-semibold">
                    ⚠️ CPF limpo, mas endereço comprometido — possível fraude por troca de documento.
                  </p>
                </div>
              )}
            </div>
          ) : cleanCross ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">Nenhuma inadimplência neste endereço</p>
                {result.addressUsed && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    CEP: {result.addressUsed}
                    {result.addressSource && (
                      <span> (fonte: {result.addressSource === "own" ? "seu cadastro" : "rede ISP"})</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : unavailable ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
              <MapPin className="w-5 h-5 text-slate-400 opacity-50 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-600">Endereço não disponível no ERP</p>
                <p className="text-xs text-slate-500 mt-0.5">Use a busca manual por CEP para cruzamento de endereço.</p>
              </div>
            </div>
          ) : null}

          {(result.addressUsed || ownProviders[0]?.cep) && (
            <AddressMapMini cep={result.addressUsed || ownProviders[0]?.cep || ""} />
          )}

          {result.addressMatches && result.addressMatches.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <Accordion type="multiple" defaultValue={addrDefaultValues}>
                {addressOwnMatches.length > 0 && (
                  <AccordionItem value="addr-seu-provedor" className="border-b-0">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">🏠 Seu Provedor</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{addressOwnMatches.length}</span>
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
                        <span className="text-xs font-bold text-slate-700">🌐 Outros Provedores</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${addressExtHasDebt ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{addressExtMatches.length}</span>
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
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            <p className="text-xs text-slate-400">Dados de terceiros anonimizados conforme LGPD</p>
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
