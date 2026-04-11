import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, Shield, AlertTriangle, XCircle,
  Lock, MapPin, Router, User, RotateCcw, Save, Download,
  FileText, Home, Globe, ChevronDown, AlertCircle, Info,
} from "lucide-react";
import { useState } from "react";
import AddressMapMini from "@/components/consulta/AddressMapMini";
import AddressRiskAlert from "./AddressRiskAlert";
import ScoreGaugeSvg from "./ScoreGaugeSvg";
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

/* ── Provider Row ─────────────────────────────────────────── */
function ProviderRow({ detail, globalIdx, onShowDetail }: { detail: ProviderDetail; globalIdx: number; onShowDetail: (idx: number) => void }) {
  const isOwn = detail.isSameProvider;
  // For external providers, daysOverdue is undefined (LGPD) — use overdueAmountRange or status as fallback
  const isDelinquent = detail.daysOverdue > 0
    || (!isOwn && !!detail.overdueAmountRange)
    || (detail.status?.toLowerCase().includes("inadimplente"));
  const debtStr = isOwn && detail.overdueAmount != null
    ? `R$ ${detail.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    : detail.overdueAmountRange || null;
  const maskedName = !isOwn
    ? (() => { const p = detail.customerName.split(" "); return p[0] + (p[1] ? " " + p[1][0] + "." : "") + (p.length > 2 ? " " + p[p.length - 1][0] + "***" : "***"); })()
    : detail.customerName;
  const locationStr = isOwn
    ? detail.address || (detail.addressCity ? `${detail.addressCity}${detail.addressState ? "/" + detail.addressState : ""}` : null)
    : detail.addressCity ? `${detail.addressCity}${detail.addressState ? "/" + detail.addressState : ""}` : null;

  return (
    <div
      className="flex items-center gap-3 py-3 px-4 transition-colors hover:bg-[var(--color-tag-bg)] cursor-pointer group"
      onClick={() => onShowDetail(globalIdx)}
      data-testid={`provider-card-${globalIdx}`}
    >
      {/* Status indicator */}
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isDelinquent ? "bg-[#C44040]" : "bg-[#2E8B57]"}`} />

      {/* Provider info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate" style={{ color: "var(--color-ink)" }} data-testid={`customer-name-${globalIdx}`}>
            {maskedName}
          </span>
          {isOwn ? (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-success-bg)", color: "var(--color-success)" }}>
              Seu provedor
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-muted)" }}>
              <Lock className="w-2.5 h-2.5" /> Parceiro
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {detail.providerName && (
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{detail.providerName}</span>
          )}
          {locationStr && (
            <span className="text-xs flex items-center gap-0.5" style={{ color: "var(--color-muted)" }}>
              <MapPin className="w-2.5 h-2.5" /> {locationStr}
            </span>
          )}
        </div>
      </div>

      {/* Status + debt */}
      <div className="text-right flex-shrink-0 space-y-0.5">
        <span
          className="inline-block text-xs font-bold px-2 py-0.5 rounded"
          style={{
            backgroundColor: isDelinquent ? "var(--color-danger-bg)" : "var(--color-success-bg)",
            color: isDelinquent ? "var(--color-danger)" : "var(--color-success)",
          }}
          data-testid={`contract-status-${globalIdx}`}
        >
          {isDelinquent
            ? (detail.daysOverdue > 0 ? `${detail.daysOverdue}d em atraso` : "Inadimplente")
            : "Em dia"}
        </span>
        {debtStr && (
          <p className="text-sm font-semibold" style={{ color: "var(--color-danger)" }} data-testid={`debt-value-${globalIdx}`}>{debtStr}</p>
        )}
        {detail.hasUnreturnedEquipment && (
          <p className="text-xs font-bold flex items-center justify-end gap-0.5" style={{ color: "var(--color-gold)" }}>
            <Router className="w-2.5 h-2.5" />
            {detail.unreturnedEquipmentCount} equip.
          </p>
        )}
      </div>

      {/* Cost badge */}
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
        style={{
          backgroundColor: isOwn ? "var(--color-success-bg)" : "var(--color-navy-bg)",
          color: isOwn ? "var(--color-success)" : "var(--color-navy)",
        }}
        data-testid={`cost-badge-${globalIdx}`}
      >
        {isOwn ? "Gratis" : "1 cred."}
      </span>
    </div>
  );
}

/* ── Address Match Row ────────────────────────────────────── */
function AddressRow({ match, idx }: { match: AddressMatch; idx: number }) {
  return (
    <div
      className="flex items-center gap-3 py-2.5 px-4"
      data-testid={`address-match-${idx}`}
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${match.hasDebt ? "bg-[#C44040]" : "bg-[#2E8B57]"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }} data-testid={`address-match-name-${idx}`}>
            {match.customerName}
          </span>
          {match.isSameProvider && (
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-navy-bg)", color: "var(--color-navy)" }}>Seu cliente</span>
          )}
          {match.hasDebt && (
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger)" }}>Inadimplente</span>
          )}
        </div>
        <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--color-muted)" }}>
          {match.isSameProvider ? (
            <>{match.cpfCnpj} · {match.providerName}</>
          ) : (
            <span className="flex items-center gap-0.5">••••••••••• <Lock className="w-2.5 h-2.5" /> · {match.providerName}</span>
          )}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded"
          style={{
            backgroundColor: match.hasDebt ? "var(--color-danger-bg)" : "var(--color-success-bg)",
            color: match.hasDebt ? "var(--color-danger)" : "var(--color-success)",
          }}
        >
          {match.status}
        </span>
        {match.isSameProvider && match.totalOverdue !== undefined && match.totalOverdue > 0 && (
          <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-danger)" }}>
            R$ {match.totalOverdue.toFixed(2)}
          </p>
        )}
        {!match.isSameProvider && match.totalOverdueRange && (
          <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-danger)" }}>
            {match.totalOverdueRange}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Section wrapper ──────────────────────────────────────── */
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, trailing }: { icon: React.ComponentType<any>; title: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: "var(--color-muted)" }} />
        <span className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--color-ink)" }}>{title}</span>
      </div>
      {trailing}
    </div>
  );
}

/* ── Collapsible group ────────────────────────────────────── */
function CollapsibleGroup({ label, icon: Icon, count, badge, defaultOpen = false, children }: {
  label: string;
  icon: React.ComponentType<any>;
  count: number;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="w-full flex items-center gap-2 px-5 py-2.5 hover:bg-[var(--color-tag-bg)] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: "var(--color-muted)" }} />
        <span className="text-xs font-bold" style={{ color: "var(--color-ink)" }}>{label}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-muted)" }}>{count}</span>
        {badge}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`} style={{ color: "var(--color-muted)" }} />
      </button>
      {open && <div className="divide-y divide-[var(--color-border)]">{children}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════ */
export default function ConsultaResultSummary({ result, onShowDetail, onNewConsulta, onSave, onGeneratePDF }: Props) {
  const isNotFoundWithAddressDebt = result.notFound && result.addressMatches?.some(m => m.hasDebt);
  const dc = result.decisionReco;
  const score = Math.max(0, Math.min(1000, result.score));
  const totalEquipPending = result.providerDetails.reduce((s, d) => s + (d.hasUnreturnedEquipment ? d.unreturnedEquipmentCount : 0), 0);
  const externalProviders = result.providerDetails.filter(d => !d.isSameProvider);
  const hasExternalDelinquent = externalProviders.some(d => d.daysOverdue > 0 || !!d.overdueAmountRange || d.status?.toLowerCase().includes("inadimplente"));
  const ownProviders = result.providerDetails.filter(d => d.isSameProvider);
  const now = new Date();
  const consultedAt = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const hasDebtMatches = result.addressMatches?.some(m => m.hasDebt) ?? false;
  const debtCount = result.addressMatches?.filter(m => m.hasDebt).length ?? 0;
  const cleanCross = result.autoAddressCrossRef === true && !hasDebtMatches;
  const unavailable = !result.autoAddressCrossRef && !hasDebtMatches;
  const addressOwnMatches = result.addressMatches?.filter(m => m.isSameProvider) ?? [];
  const addressExtMatches = result.addressMatches?.filter(m => !m.isSameProvider) ?? [];

  const decisionCfg = dc === "Accept"
    ? { color: "#2E8B57", bg: "#2E8B57", label: "APROVAR", icon: CheckCircle, sub: "Sem restricoes na rede ISP" }
    : dc === "Reject"
    ? { color: "#C44040", bg: "#C44040", label: "REJEITAR", icon: XCircle, sub: result.recommendation }
    : { color: "#C9A820", bg: "#C9A820", label: "ANALISAR", icon: AlertCircle, sub: result.recommendation };

  return (
    <div className="space-y-4" data-testid="consultation-result-cards">

      {/* ═══ SECTION 1: SCORE HERO ═══ */}
      {!isNotFoundWithAddressDebt && (
        <Section>
          {/* Top bar */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Relatorio de Credito ISP
              </p>
              <p className="text-xl font-bold tracking-tight mt-0.5 tabular-nums" style={{ color: "var(--color-ink)", fontFamily: "'Inter', system-ui, sans-serif" }} data-testid="text-consulted-doc">
                {result.searchType === "cep"
                  ? result.cpfCnpj.replace(/^(\d{5})(\d{3})$/, "$1-$2")
                  : formatCpfCnpj(result.cpfCnpj)}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                {result.searchType === "cep" ? "CEP" : result.searchType === "cnpj" ? "CNPJ" : "CPF"} · {consultedAt}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" style={{ color: "var(--color-navy)" }} />
              <span className="text-xs font-semibold" style={{ color: "var(--color-navy)" }}>Rede ISP Colaborativa</span>
            </div>
          </div>

          {/* Score gauge centered */}
          <div className="flex justify-center py-2">
            <ScoreGaugeSvg score={score} size="lg" />
          </div>

          {/* Decision banner */}
          <div className="mx-5 mb-4 rounded-lg px-4 py-3 flex items-center gap-3" style={{ backgroundColor: decisionCfg.bg }} data-testid="ai-suggestion-banner">
            <decisionCfg.icon className="w-6 h-6 text-white flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Sugestao IA</p>
              <p className="text-lg font-bold text-white leading-tight" data-testid="text-ai-recommendation">{decisionCfg.label}</p>
            </div>
            <p className="text-xs text-white/80 max-w-[160px] text-right leading-snug">{decisionCfg.sub}</p>
          </div>

          {/* Quick stats row */}
          <div className="grid grid-cols-3 border-t border-[var(--color-border)]">
            <div className="text-center py-3 border-r border-[var(--color-border)]">
              <p className="text-xl font-bold tabular-nums" style={{ color: "var(--color-ink)" }}>{result.providersFound || result.providerDetails.length}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Provedores</p>
            </div>
            <div className="text-center py-3 border-r border-[var(--color-border)]">
              <p className="text-xl font-bold tabular-nums" style={{ color: totalEquipPending > 0 ? "var(--color-gold)" : "var(--color-ink)" }}>{totalEquipPending}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Equip. retidos</p>
            </div>
            <div className="text-center py-3">
              <p className="text-xl font-bold tabular-nums" style={{ color: externalProviders.length > 0 ? "var(--color-danger)" : "var(--color-ink)" }}>{externalProviders.length}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Externos</p>
            </div>
          </div>

          {/* ── ADDRESS RISK ALERT ── */}
          {result.addressRiskAlerts && (
            <AddressRiskAlert data={result.addressRiskAlerts} />
          )}

          {/* ── PROVIDER RESULTS (inline, not separate section) ── */}
          {result.searchType !== "cep" && result.providerDetails.length > 0 && !isNotFoundWithAddressDebt && (
            <div className="border-t border-[var(--color-border)]">
              {ownProviders.length > 0 && (
                <CollapsibleGroup label="Seu Provedor" icon={Home} count={ownProviders.length} defaultOpen={true}
                  badge={
                    ownProviders.some(d => d.daysOverdue > 0)
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger)" }}>Inadimplente</span>
                      : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-success-bg)", color: "var(--color-success)" }}>Em dia</span>
                  }
                >
                  {ownProviders.map((detail, i) => {
                    const globalIdx = result.providerDetails.indexOf(detail);
                    return <ProviderRow key={i} detail={detail} globalIdx={globalIdx} onShowDetail={onShowDetail} />;
                  })}
                </CollapsibleGroup>
              )}
              {externalProviders.length > 0 && (
                <CollapsibleGroup
                  label="Outros Provedores"
                  icon={Globe}
                  count={externalProviders.length}
                  defaultOpen={true}
                  badge={
                    <>
                      {hasExternalDelinquent && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger)" }}>
                          Inadimplente
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-navy-bg)", color: "var(--color-navy)" }}>
                        {externalProviders.length} credito{externalProviders.length !== 1 ? "s" : ""}
                      </span>
                    </>
                  }
                >
                  {externalProviders.map((detail, i) => {
                    const globalIdx = result.providerDetails.indexOf(detail);
                    return <ProviderRow key={i} detail={detail} globalIdx={globalIdx} onShowDetail={onShowDetail} />;
                  })}
                </CollapsibleGroup>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ═══ SECTION 2: SCORE BREAKDOWN ═══ */}
      {result.fatoresScore && result.searchType !== "cep" && (
        <Section>
          <div className="p-5">
            <ScoreBreakdownPanel fatores={result.fatoresScore} />
          </div>
        </Section>
      )}

      {/* ═══ SECTION 4: POR ENDERECO ═══ */}
      <Section>
        <SectionHeader
          icon={MapPin}
          title="Verificacao por Endereco"
          trailing={
            <div className="flex items-center gap-1.5">
              {debtCount > 0 ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger)" }}>
                  {debtCount} inadimpl.
                </span>
              ) : cleanCross ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "var(--color-success-bg)", color: "var(--color-success)" }}>Limpo</span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: "var(--color-tag-bg)", color: "var(--color-muted)" }}>N/D</span>
              )}
              {result.autoAddressCrossRef === true && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-navy-bg)", color: "var(--color-navy)" }}>AUTO</span>
              )}
            </div>
          }
        />

        {/* Status alert */}
        <div className="p-4">
          {hasDebtMatches ? (
            <div className="rounded-lg p-4 flex items-start gap-3" style={{ backgroundColor: "var(--color-danger-bg)" }}>
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "var(--color-danger)" }} />
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--color-danger)" }}>
                  {debtCount} inadimplente{debtCount !== 1 ? "s" : ""} neste endereco
                </p>
                {isNotFoundWithAddressDebt && (
                  <p className="text-xs mt-1" style={{ color: "var(--color-danger)" }}>
                    CPF limpo, mas endereco comprometido — possivel fraude por troca de documento.
                  </p>
                )}
              </div>
            </div>
          ) : cleanCross ? (
            <div className="rounded-lg p-4 flex items-center gap-3" style={{ backgroundColor: "var(--color-success-bg)" }}>
              <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--color-success)" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-success)" }}>Nenhuma inadimplencia neste endereco</p>
                {result.addressUsed && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-success)" }}>
                    CEP: {result.addressUsed}
                    {result.addressSource && (
                      <span> (fonte: {result.addressSource === "own" ? "seu cadastro" : "rede ISP"})</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : unavailable ? (
            <div className="rounded-lg p-4 flex items-center gap-3" style={{ backgroundColor: "var(--color-tag-bg)" }}>
              <MapPin className="w-5 h-5 flex-shrink-0" style={{ color: "var(--color-muted)" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-muted)" }}>Cruzamento por endereco nao realizado</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {ownProviders[0]?.address
                    ? "Cliente tem endereco no ERP, mas faltam CEP/numero para buscar outras inadimplencias no mesmo imovel."
                    : "Cliente sem endereco cadastrado no ERP. Use a busca manual por CEP."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Map */}
        {(result.addressUsed || ownProviders[0]?.cep || ownProviders[0]?.address || ownProviders[0]?.latitude) && (
          <div className="px-4 pb-3">
            <AddressMapMini
              cep={result.addressUsed || ownProviders[0]?.cep || ""}
              address={ownProviders[0]?.address}
              city={ownProviders[0]?.addressCity}
              state={ownProviders[0]?.addressState}
              neighborhood={ownProviders[0]?.neighborhood}
              addressNumber={ownProviders[0]?.addressNumber}
              latitude={ownProviders[0]?.latitude}
              longitude={ownProviders[0]?.longitude}
            />
          </div>
        )}

        {/* Address matches */}
        {result.addressMatches && result.addressMatches.length > 0 && (
          <div className="border-t border-[var(--color-border)]">
            {addressOwnMatches.length > 0 && (
              <CollapsibleGroup label="Seu Provedor" icon={Home} count={addressOwnMatches.length} defaultOpen={true}>
                {addressOwnMatches.map((match, i) => <AddressRow key={i} match={match} idx={i} />)}
              </CollapsibleGroup>
            )}
            {addressExtMatches.length > 0 && (
              <CollapsibleGroup label="Outros Provedores" icon={Globe} count={addressExtMatches.length} defaultOpen={addressExtMatches.some(m => m.hasDebt)}>
                {addressExtMatches.map((match, i) => <AddressRow key={i} match={match} idx={addressOwnMatches.length + i} />)}
              </CollapsibleGroup>
            )}
          </div>
        )}

        {/* LGPD footer */}
        <div className="px-5 py-2.5 border-t border-[var(--color-border)] flex items-center gap-2">
          <Lock className="w-3 h-3" style={{ color: "var(--color-muted)" }} />
          <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>Dados de terceiros anonimizados conforme LGPD</p>
        </div>
      </Section>

      {/* ═══ ACTIONS ═══ */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
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
