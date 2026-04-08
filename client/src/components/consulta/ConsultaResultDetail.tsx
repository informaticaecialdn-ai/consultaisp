import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, AlertCircle, XCircle, AlertTriangle, Lightbulb,
  CreditCard, Clock, Building2, Router, Lock, MapPin,
  ArrowRight, RotateCcw, Download, Save,
} from "lucide-react";
import ScoreGaugeSvg from "./ScoreGaugeSvg";
import AiAnalysisSection from "./AiAnalysisSection";
import type { ConsultaResult } from "./types";
import { formatCpfCnpj, getInitials } from "./utils";

interface Props {
  result: ConsultaResult;
  selectedProviderIdx: number;
  onBack: () => void;
  onNewConsulta: () => void;
  onSave: () => void;
  onGeneratePDF: () => void;
  onShowHistory: () => void;
}

export default function ConsultaResultDetail({ result, selectedProviderIdx, onBack, onNewConsulta, onSave, onGeneratePDF, onShowHistory }: Props) {
  const selectedDetail = result.providerDetails[selectedProviderIdx ?? 0];
  const isOwnSelected = selectedDetail?.isSameProvider ?? false;
  const heroName = selectedDetail?.customerName ?? null;
  const detailCost = isOwnSelected ? 0 : 1;
  const dc = result.decisionReco;
  const heroBg = dc === "Accept" ? "bg-[var(--color-success-bg)] border-[var(--color-border)]"
    : dc === "Review" ? "bg-[var(--color-gold-bg)] border-[var(--color-border)]"
    : "bg-[var(--color-danger-bg)] border-[var(--color-border)]";
  const decisionBg = dc === "Accept" ? "bg-[var(--color-success)]"
    : dc === "Review" ? "bg-[var(--color-gold)]" : "bg-[var(--color-danger)]";
  const decisionLabel = dc === "Accept" ? "APROVAR" : dc === "Review" ? "ANALISAR" : "REJEITAR";
  const riskCls = (result.corIndicador === "verde" || result.riskTier === "low" || result.nivelRisco === "baixo") ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
    : (result.corIndicador === "amarelo" || result.riskTier === "medium" || result.nivelRisco === "moderado") ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
    : (result.corIndicador === "laranja" || result.riskTier === "high" || result.nivelRisco === "alto") ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
    : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]";
  const now = new Date();
  const dataConsulta = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-5">
      <button
        className="flex items-center gap-1.5 text-sm text-[var(--color-navy)] hover:text-[var(--color-steel)] font-medium transition-colors"
        onClick={onBack}
        data-testid="button-voltar-lista"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Voltar para a lista
      </button>

      {/* HERO */}
      <Card className={`overflow-hidden rounded-md border ${heroBg}`} data-testid="hero-result-card">
        <div className="p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="flex-shrink-0">
              <ScoreGaugeSvg score={result.score} size="sm" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-11 h-11 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center flex-shrink-0">
                  <span className={`text-sm font-bold ${isOwnSelected ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>{heroName ? getInitials(heroName) : "?"}</span>
                </div>
                <div>
                  <p className="font-bold text-[var(--color-ink)] text-lg leading-tight" data-testid="text-customer-name">
                    {heroName || "Desconhecido"}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {isOwnSelected
                      ? formatCpfCnpj(result.cpfCnpj)
                      : (() => {
                          const d = result.cpfCnpj.replace(/\D/g, "");
                          if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
                          if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
                          return "***.***.***-**";
                        })()
                    }
                    {" — "}{selectedDetail?.providerName}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-bold px-2 py-1 rounded ${isOwnSelected ? "bg-[var(--color-navy-bg)] text-[var(--color-navy)]" : "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>
                  {isOwnSelected ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
                </span>
                <span className={`text-sm font-semibold px-2 py-1 rounded ${riskCls}`} data-testid="text-risk-tier">{result.riskLabel}</span>
                <span className="text-sm text-[var(--color-muted)]">{dataConsulta}</span>
              </div>
            </div>
            <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div className={`${decisionBg} text-white px-6 py-3 rounded text-center min-w-[7rem]`} data-testid="badge-decision">
                <p className="text-xs font-semibold opacity-80 uppercase tracking-widest">Sugestao</p>
                <p className="text-xl font-semibold tracking-wide">{decisionLabel}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-sm ${detailCost === 0 ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-navy-bg)] text-[var(--color-navy)]"}`} data-testid="detail-cost-badge">
                {detailCost === 0 ? "Gratuita" : "1 Credito"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* PROVIDER DETAIL */}
      {selectedDetail && <ProviderDetailSection detail={selectedDetail} idx={selectedProviderIdx} />}

      {/* ALERTS */}
      {result.alerts.length > 0 && (
        <div className="rounded-lg border-l-4 border-l-[var(--color-gold)] border border-[var(--color-border)] bg-[var(--color-gold-bg)] p-5" data-testid="section-fatores-risco">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-[var(--color-gold)]" />
            <h4 className="text-sm font-bold text-[var(--color-gold)] uppercase tracking-wide">Alertas do Sistema</h4>
          </div>
          <ul className="space-y-2">
            {result.alerts.map((alert, i) => (
              <li key={i} className="flex items-start gap-2 text-sm" data-testid={`alert-${i}`}>
                <span className="text-[var(--color-gold)] font-semibold flex-shrink-0 mt-0.5">•</span>
                <span className="text-[var(--color-ink)]">{alert}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* RECOMMENDATIONS */}
      {result.recommendedActions.length > 0 && (
        <div className={`rounded p-4 border ${
          result.decisionReco === "Accept" ? "bg-[var(--color-success-bg)] border-[var(--color-border)]"
          : result.decisionReco === "Review" ? "bg-[var(--color-gold-bg)] border-[var(--color-border)]"
          : "bg-[var(--color-danger-bg)] border-[var(--color-border)]"
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className={`w-5 h-5 ${
              result.decisionReco === "Accept" ? "text-[var(--color-success)]"
              : result.decisionReco === "Review" ? "text-[var(--color-gold)]" : "text-[var(--color-danger)]"
            }`} />
            <h4 className={`text-sm font-bold uppercase tracking-wide ${
              result.decisionReco === "Accept" ? "text-[var(--color-success)]"
              : result.decisionReco === "Review" ? "text-[var(--color-gold)]" : "text-[var(--color-danger)]"
            }`} data-testid="text-decision-summary">
              {result.decisionReco === "Accept" ? "Condicoes para Aprovacao"
                : result.decisionReco === "Review" ? "Pontos para Revisao"
                : "Condicoes Obrigatorias"}
            </h4>
          </div>
          <div className="space-y-2">
            {result.recommendedActions.map((action, i) => (
              <div key={i} className="flex items-start gap-2">
                <ArrowRight className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                  result.decisionReco === "Accept" ? "text-[var(--color-success)]"
                  : result.decisionReco === "Review" ? "text-[var(--color-gold)]" : "text-[var(--color-danger)]"
                }`} />
                <span className="text-sm text-[var(--color-ink)]">{action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI ANALYSIS */}
      <AiAnalysisSection result={result} />

      {/* BUTTONS */}
      <div className="flex flex-wrap gap-3">
        <Button className="bg-[var(--color-navy)] hover:bg-[var(--color-steel)] text-white gap-2" onClick={onGeneratePDF} data-testid="button-gerar-relatorio">
          <Download className="w-4 h-4" />
          Gerar Relatorio
        </Button>
        <Button variant="outline" className="gap-2" onClick={onSave} data-testid="button-salvar-consulta">
          <Save className="w-4 h-4" />
          Salvar Consulta
        </Button>
        <Button variant="outline" className="gap-2" onClick={onShowHistory} data-testid="button-ver-historico">
          <Clock className="w-4 h-4" />
          Ver Historico
        </Button>
        <Button variant="outline" className="gap-2" onClick={onNewConsulta} data-testid="button-nova-consulta">
          <RotateCcw className="w-4 h-4" />
          Nova Consulta
        </Button>
      </div>
    </div>
  );
}

function ProviderDetailSection({ detail, idx }: { detail: any; idx: number }) {
  const isOwn = detail.isSameProvider;
  const contractMonths = detail.contractAgeDays != null && !isNaN(detail.contractAgeDays) ? Math.max(1, Math.round(detail.contractAgeDays / 30)) : null;
  const statusContrato = detail.cancelledDate ? "Cancelado" : "Ativo";
  const totalEqp = detail.equipmentDetails?.reduce((s: number, e: any) => s + parseFloat(e.value || "0"), 0) || 0;
  const isDelinquent = detail.daysOverdue > 0 || !!detail.overdueAmountRange || detail.status?.toLowerCase().includes("inadimplente");
  const statusCls = isDelinquent
    ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
    : "bg-[var(--color-success-bg)] text-[var(--color-success)]";

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="w-5 h-5 text-[var(--color-muted)]" />
        <h3 className="text-base font-bold text-[var(--color-ink)]">Detalhes — {detail.providerName}</h3>
        <span className={`text-sm font-bold px-2 py-1 rounded ${isOwn ? "bg-[var(--color-navy-bg)] text-[var(--color-navy)]" : "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>
          {isOwn ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
        </span>
      </div>
      <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-hidden" data-testid={`provider-detail-${idx}`}>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--color-border)]">
          {/* Financeiro */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <CreditCard className="w-4 h-4 text-[var(--color-muted)]" />
              <span className="text-sm font-bold text-[var(--color-muted)] uppercase tracking-wider">Financeiro</span>
            </div>
            <div className="space-y-2.5">
              <div>
                <p className="text-sm text-[var(--color-muted)] mb-0.5">Status de pagamento</p>
                <span className={`text-sm font-semibold px-2 py-1 rounded ${statusCls}`}>{detail.status}</span>
              </div>
              {detail.daysOverdue > 0 && (
                <div>
                  <p className="text-sm text-[var(--color-muted)]">Dias em atraso</p>
                  <p className="text-base font-bold text-[var(--color-danger)]">{detail.daysOverdue} dias</p>
                </div>
              )}
              {isOwn && (detail.overdueAmount || 0) > 0 && (
                <div>
                  <p className="text-sm text-[var(--color-muted)]">Valor em aberto</p>
                  <p className="text-base font-semibold text-[var(--color-danger)]">
                    R$ {(detail.overdueAmount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
              {!isOwn && detail.overdueAmountRange && (
                <div>
                  <p className="text-sm text-[var(--color-muted)]">Faixa de valor</p>
                  <p className="text-base font-semibold text-[var(--color-danger)]">{detail.overdueAmountRange}</p>
                </div>
              )}
              {detail.overdueInvoicesCount > 0 && (
                <div>
                  <p className="text-sm text-[var(--color-muted)]">Faturas em atraso</p>
                  <p className="text-base font-semibold text-[var(--color-ink)]">{detail.overdueInvoicesCount} fatura(s)</p>
                </div>
              )}
            </div>
          </div>

          {/* Contrato */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="w-4 h-4 text-[var(--color-muted)]" />
              <span className="text-sm font-bold text-[var(--color-muted)] uppercase tracking-wider">Contrato</span>
            </div>
            <div className="space-y-2.5">
              <div>
                <p className="text-sm text-[var(--color-muted)]">Tempo de servico</p>
                <p className="text-base font-semibold text-[var(--color-ink)]">
                  {contractMonths != null ? `${contractMonths} ${contractMonths === 1 ? "mes" : "meses"}` : (isOwn ? "Sem dados" : "Dado restrito")}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--color-muted)]">Status do contrato</p>
                <span className={`text-sm font-semibold px-2 py-1 rounded ${statusContrato === "Ativo" ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>{statusContrato}</span>
              </div>
              <div>
                <p className="text-sm text-[var(--color-muted)]">Cliente</p>
                {isOwn
                  ? <p className="text-base font-semibold text-[var(--color-ink)]">{detail.customerName}</p>
                  : <span className="flex items-center gap-1 text-sm text-[var(--color-muted)]"><Lock className="w-3.5 h-3.5" /> Dado restrito</span>
                }
              </div>
              {(detail.address || detail.cep) && (
                <div>
                  <p className="text-sm text-[var(--color-muted)]">Endereco</p>
                  {isOwn ? (
                    <div className="space-y-0.5">
                      {detail.cep && <p className="text-xs font-mono text-[var(--color-muted)]">CEP {detail.cep}</p>}
                      <p className="text-xs text-[var(--color-ink)] break-words">{detail.address}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {detail.cep && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-[var(--color-muted)] uppercase tracking-wide">CEP</span>
                          <span className="text-xs font-mono text-[var(--color-muted)] bg-[var(--color-tag-bg)] px-1.5 py-0.5 rounded-sm">{detail.cep}</span>
                        </div>
                      )}
                      {detail.address && (
                        <span className="flex items-start gap-1 text-xs text-[var(--color-muted)]">
                          <MapPin className="w-3 h-3 text-[var(--color-muted)] mt-0.5 flex-shrink-0" />
                          <span>
                            {detail.address}
                            <span className="text-xs text-[var(--color-muted)] ml-1 italic">dados restritos</span>
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {detail.cancelledDate && (
                <div>
                  <p className="text-xs text-[var(--color-muted)]">Data cancelamento</p>
                  <p className="text-xs text-[var(--color-muted)]">{new Date(detail.cancelledDate).toLocaleDateString("pt-BR")}</p>
                </div>
              )}
            </div>
          </div>

          {/* Equipamentos */}
          <div className={`p-4 ${detail.hasUnreturnedEquipment ? "bg-[var(--color-gold-bg)]" : ""}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <Router className={`w-4 h-4 ${detail.hasUnreturnedEquipment ? "text-[var(--color-gold)]" : "text-[var(--color-muted)]"}`} />
              <span className="text-sm font-bold text-[var(--color-muted)] uppercase tracking-wider">Equipamentos</span>
            </div>
            {detail.hasUnreturnedEquipment ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-gold)]" />
                  <p className="text-xs font-bold text-[var(--color-gold)]">{detail.unreturnedEquipmentCount} nao devolvido(s)</p>
                </div>
                {detail.equipmentDetails ? (
                  <div className="space-y-1.5 mt-2">
                    {detail.equipmentDetails.map((eq: any, j: number) => (
                      <div key={j} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--color-ink)] flex-1 truncate">{eq.type} {eq.brand} {eq.model}</span>
                        <span className="text-xs font-semibold text-[var(--color-ink)] flex-shrink-0">
                          R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                    <div className="pt-1.5 border-t border-[var(--color-border)] flex justify-between">
                      <span className="text-xs font-bold text-[var(--color-gold)]">Total</span>
                      <span className="text-xs font-semibold text-[var(--color-gold)]">
                        R$ {totalEqp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-muted)]">{detail.equipmentPendingSummary}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
                <span className="text-sm text-[var(--color-success)] font-medium">Todos devolvidos</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
