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
  const heroBg = dc === "Accept" ? "from-emerald-50 to-white border-emerald-200"
    : dc === "Review" ? "from-amber-50 to-white border-amber-200"
    : "from-red-50 to-white border-red-200";
  const decisionBg = dc === "Accept" ? "bg-emerald-500"
    : dc === "Review" ? "bg-amber-500" : "bg-red-500";
  const decisionLabel = dc === "Accept" ? "APROVAR" : dc === "Review" ? "ANALISAR" : "REJEITAR";
  const riskCls = (result.corIndicador === "verde" || result.riskTier === "low" || result.nivelRisco === "baixo") ? "bg-emerald-100 text-emerald-700"
    : (result.corIndicador === "amarelo" || result.riskTier === "medium" || result.nivelRisco === "moderado") ? "bg-amber-100 text-amber-700"
    : (result.corIndicador === "laranja" || result.riskTier === "high" || result.nivelRisco === "alto") ? "bg-orange-100 text-orange-700"
    : "bg-red-100 text-red-700";
  const now = new Date();
  const dataConsulta = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-5">
      <button
        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        onClick={onBack}
        data-testid="button-voltar-lista"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Voltar para a lista
      </button>

      {/* HERO */}
      <Card className={`overflow-hidden rounded-2xl border bg-gradient-to-r ${heroBg}`} data-testid="hero-result-card">
        <div className="p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="flex-shrink-0 flex flex-col items-center gap-1">
              <div className="relative w-24 h-24">
                <ScoreGaugeSvg score={result.score} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-slate-900 leading-none" data-testid="text-score-value">{result.score}</span>
                  <span className="text-[9px] text-slate-500 font-medium">/ 100</span>
                </div>
              </div>
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Score ISP</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center flex-shrink-0">
                  <span className={`text-xs font-bold ${isOwnSelected ? "text-slate-700" : "text-slate-400"}`}>{heroName ? getInitials(heroName) : "?"}</span>
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-base leading-tight" data-testid="text-customer-name">
                    {heroName || "Desconhecido"}
                  </p>
                  <p className="text-xs text-slate-500">{formatCpfCnpj(result.cpfCnpj)} — {selectedDetail?.providerName}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isOwnSelected ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                  {isOwnSelected ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${riskCls}`} data-testid="text-risk-tier">{result.riskLabel}</span>
                <span className="text-xs text-slate-400">{dataConsulta}</span>
              </div>
            </div>
            <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div className={`${decisionBg} text-white px-6 py-3 rounded-xl text-center min-w-[7rem]`} data-testid="badge-decision">
                <p className="text-[10px] font-semibold opacity-80 uppercase tracking-widest">Sugestao</p>
                <p className="text-xl font-black tracking-wide">{decisionLabel}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${detailCost === 0 ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`} data-testid="detail-cost-badge">
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
        <div className="rounded-xl border-l-4 border-l-amber-400 border border-amber-200 bg-amber-50 p-4" data-testid="section-fatores-risco">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wide">Alertas do Sistema</h4>
          </div>
          <ul className="space-y-1.5">
            {result.alerts.map((alert, i) => (
              <li key={i} className="flex items-start gap-2 text-xs" data-testid={`alert-${i}`}>
                <span className="text-amber-500 font-black flex-shrink-0 mt-0.5">•</span>
                <span className="text-amber-800">{alert}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* RECOMMENDATIONS */}
      {result.recommendedActions.length > 0 && (
        <div className={`rounded-xl p-4 border ${
          result.decisionReco === "Accept" ? "bg-emerald-50 border-emerald-200"
          : result.decisionReco === "Review" ? "bg-amber-50 border-amber-200"
          : "bg-red-50 border-red-200"
        }`}>
          <div className="flex items-center gap-1.5 mb-3">
            <Lightbulb className={`w-4 h-4 ${
              result.decisionReco === "Accept" ? "text-emerald-600"
              : result.decisionReco === "Review" ? "text-amber-600" : "text-red-600"
            }`} />
            <h4 className={`text-xs font-bold uppercase tracking-wide ${
              result.decisionReco === "Accept" ? "text-emerald-700"
              : result.decisionReco === "Review" ? "text-amber-700" : "text-red-700"
            }`} data-testid="text-decision-summary">
              {result.decisionReco === "Accept" ? "Condicoes para Aprovacao"
                : result.decisionReco === "Review" ? "Pontos para Revisao"
                : "Condicoes Obrigatorias"}
            </h4>
          </div>
          <div className="space-y-1.5">
            {result.recommendedActions.map((action, i) => (
              <div key={i} className="flex items-start gap-2">
                <ArrowRight className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                  result.decisionReco === "Accept" ? "text-emerald-500"
                  : result.decisionReco === "Review" ? "text-amber-500" : "text-red-500"
                }`} />
                <span className="text-xs text-slate-700">{action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI ANALYSIS */}
      <AiAnalysisSection result={result} />

      {/* BUTTONS */}
      <div className="flex flex-wrap gap-3">
        <Button className="bg-blue-600 hover:bg-blue-700 text-white gap-2" onClick={onGeneratePDF} data-testid="button-gerar-relatorio">
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
  const contractMonths = Math.max(1, Math.round(detail.contractAgeDays / 30));
  const statusContrato = detail.cancelledDate ? "Cancelado" : "Ativo";
  const totalEqp = detail.equipmentDetails?.reduce((s: number, e: any) => s + parseFloat(e.value || "0"), 0) || 0;
  const statusCls = detail.daysOverdue === 0
    ? "bg-emerald-100 text-emerald-700"
    : detail.daysOverdue <= 30 ? "bg-orange-100 text-orange-700"
    : "bg-red-100 text-red-700";

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Detalhes — {detail.providerName}</h3>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isOwn ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
          {isOwn ? "SEU PROVEDOR" : "OUTRO PROVEDOR"}
        </span>
      </div>
      <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden" data-testid={`provider-detail-${idx}`}>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          {/* Financeiro */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <CreditCard className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Financeiro</span>
            </div>
            <div className="space-y-2.5">
              <div>
                <p className="text-[10px] text-slate-400 mb-0.5">Status de pagamento</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>{detail.status}</span>
              </div>
              {detail.daysOverdue > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400">Dias em atraso</p>
                  <p className="text-sm font-bold text-red-600">{detail.daysOverdue} dias</p>
                </div>
              )}
              {isOwn && (detail.overdueAmount || 0) > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400">Valor em aberto</p>
                  <p className="text-base font-black text-red-600">
                    R$ {(detail.overdueAmount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
              {!isOwn && detail.overdueAmountRange && (
                <div>
                  <p className="text-[10px] text-slate-400">Faixa de valor</p>
                  <p className="text-sm text-slate-700">{detail.overdueAmountRange}</p>
                </div>
              )}
              {detail.overdueInvoicesCount > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400">Faturas em atraso</p>
                  <p className="text-sm font-semibold text-slate-700">{detail.overdueInvoicesCount} fatura(s)</p>
                </div>
              )}
            </div>
          </div>

          {/* Contrato */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contrato</span>
            </div>
            <div className="space-y-2.5">
              <div>
                <p className="text-[10px] text-slate-400">Tempo de servico</p>
                <p className="text-sm font-semibold text-slate-800">{contractMonths} {contractMonths === 1 ? "mes" : "meses"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">Status do contrato</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusContrato === "Ativo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{statusContrato}</span>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">Cliente</p>
                {isOwn
                  ? <p className="text-sm font-semibold text-slate-800">{detail.customerName}</p>
                  : <span className="flex items-center gap-1 text-xs text-slate-400"><Lock className="w-3 h-3" /> Dado restrito</span>
                }
              </div>
              {(detail.address || detail.cep) && (
                <div>
                  <p className="text-[10px] text-slate-400">Endereço</p>
                  {isOwn ? (
                    <div className="space-y-0.5">
                      {detail.cep && <p className="text-[10px] font-mono text-slate-500">CEP {detail.cep}</p>}
                      <p className="text-xs text-slate-700 break-words">{detail.address}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {detail.cep && (
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-400 uppercase tracking-wide">CEP</span>
                          <span className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{detail.cep}</span>
                        </div>
                      )}
                      {detail.address && (
                        <span className="flex items-start gap-1 text-xs text-slate-600">
                          <MapPin className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                          <span>
                            {detail.address}
                            <span className="text-[9px] text-slate-400 ml-1 italic">dados restritos</span>
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {detail.cancelledDate && (
                <div>
                  <p className="text-[10px] text-slate-400">Data cancelamento</p>
                  <p className="text-xs text-slate-600">{new Date(detail.cancelledDate).toLocaleDateString("pt-BR")}</p>
                </div>
              )}
            </div>
          </div>

          {/* Equipamentos */}
          <div className={`p-4 ${detail.hasUnreturnedEquipment ? "bg-amber-50/60" : ""}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <Router className={`w-3.5 h-3.5 ${detail.hasUnreturnedEquipment ? "text-amber-500" : "text-slate-400"}`} />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Equipamentos</span>
            </div>
            {detail.hasUnreturnedEquipment ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <p className="text-xs font-bold text-amber-700">{detail.unreturnedEquipmentCount} nao devolvido(s)</p>
                </div>
                {detail.equipmentDetails ? (
                  <div className="space-y-1.5 mt-2">
                    {detail.equipmentDetails.map((eq: any, j: number) => (
                      <div key={j} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-700 flex-1 truncate">{eq.type} {eq.brand} {eq.model}</span>
                        <span className="text-xs font-semibold text-slate-800 flex-shrink-0">
                          R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                    <div className="pt-1.5 border-t border-amber-200 flex justify-between">
                      <span className="text-xs font-bold text-amber-700">Total</span>
                      <span className="text-xs font-black text-amber-700">
                        R$ {totalEqp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">{detail.equipmentPendingSummary}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-emerald-700 font-medium">Todos devolvidos</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
