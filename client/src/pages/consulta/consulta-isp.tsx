import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Activity, Calendar, CheckCircle, BarChart3,
  CreditCard, Shield,
} from "lucide-react";

import type { ConsultaResult } from "@/components/consulta/types";
import { formatCpfCnpj } from "@/components/consulta/utils";
import { generatePDF } from "@/components/consulta/PdfReportGenerator";
import LoadingCard from "@/components/consulta/LoadingCard";
import ConsultaSearchBar from "@/components/consulta/ConsultaSearchBar";
import ConsultaResultSummary from "@/components/consulta/ConsultaResultSummary";
import ConsultaResultDetail from "@/components/consulta/ConsultaResultDetail";
import ConsultaHistoryTab from "@/components/consulta/ConsultaHistoryTab";
import TimelineTab from "@/components/consulta/TimelineTab";
import ConsultaReportsTab from "@/components/consulta/ConsultaReportsTab";
import ConsultaInfoTab from "@/components/consulta/ConsultaInfoTab";
import LgpdDisclaimerModal from "@/components/consulta/LgpdDisclaimerModal";
import ProviderDetailModals from "@/components/consulta/ProviderDetailModals";

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const [result, setResult] = useState<ConsultaResult | null>(null);
  const [activeTab, setActiveTab] = useState<"nova" | "historico" | "timeline" | "relatorios" | "info">("nova");
  const [selectedProviderIdx, setSelectedProviderIdx] = useState<number | null>(0);
  const [showFullResult, setShowFullResult] = useState(false);
  const [freeDialogOpen, setFreeDialogOpen] = useState(false);
  const [paidDialogOpen, setPaidDialogOpen] = useState(false);
  const [selectedFreeDetail, setSelectedFreeDetail] = useState<any>(null);
  const [selectedPaidDetail, setSelectedPaidDetail] = useState<any>(null);

  // LGPD
  const [lgpdDisclaimerOpen, setLgpdDisclaimerOpen] = useState(false);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [lgpdSessionAccepted, setLgpdSessionAccepted] = useState(false);
  const [pendingSearchPayload, setPendingSearchPayload] = useState<any>(null);

  // Queries
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/isp-consultations"] });
  const consultations = data?.consultations || [];
  const approvedCount = consultations.filter((c: any) => c.approved).length;
  const rejectedCount = consultations.filter((c: any) => !c.approved).length;
  const avgScore = consultations.length > 0
    ? Math.round(consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / consultations.length)
    : 0;
  const approvalRate = consultations.length > 0
    ? Math.round((approvedCount / consultations.length) * 100)
    : 0;

  const timelineCpf = result?.cpfCnpj?.replace(/\D/g, "") || "";
  const { data: timelineData, isLoading: timelineLoading } = useQuery<{ timeline: Array<{ date: string; score: number | null; decision: string | null; searchType: string; provider: string; alerts: string[]; isSameProvider: boolean }> }>({
    queryKey: ["/api/isp-consultations/timeline", timelineCpf],
    queryFn: async () => {
      const res = await fetch(`/api/isp-consultations/timeline/${timelineCpf}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao buscar timeline");
      return res.json();
    },
    enabled: !!timelineCpf,
    staleTime: 60_000,
  });

  // Mutation
  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/isp-consultations", { ...payload, lgpdAccepted: payload.lgpdAccepted ?? lgpdSessionAccepted });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.result);
      setShowFullResult(false);
      setSelectedProviderIdx(0);
      queryClient.invalidateQueries({ queryKey: ["/api/isp-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      const ownCount = (data.result?.providerDetails || []).filter((d: any) => d.isSameProvider).length;
      const otherCount = (data.result?.providerDetails || []).filter((d: any) => !d.isSameProvider).length;

      if (data.result?.notFound) {
        toast({ title: "Nada consta", description: <span>Nenhum registro encontrado. <span className="font-bold text-emerald-600">Gratuita.</span></span> });
      } else if (ownCount > 0 && otherCount > 0) {
        toast({ title: "Consulta gratuita", description: <span>{ownCount} registro{ownCount > 1 ? "s" : ""} do seu provedor. <span className="font-bold text-emerald-600">Gratuita.</span></span> });
        setTimeout(() => {
          toast({ title: "Consulta paga", description: <span>{otherCount} Em outros provedores: <span className="font-bold text-red-600">{otherCount} Credito{otherCount > 1 ? "s" : ""}.</span></span> });
        }, 3500);
      } else if (ownCount > 0) {
        toast({ title: "Consulta gratuita", description: <span>{ownCount} registro{ownCount > 1 ? "s" : ""} do seu provedor. <span className="font-bold text-emerald-600">Gratuita.</span></span> });
      } else if (otherCount > 0) {
        toast({ title: "Consulta paga", description: <span>{otherCount} Em outros provedores: <span className="font-bold text-red-600">{otherCount} Credito{otherCount > 1 ? "s" : ""}.</span></span> });
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  // Handlers
  const executeSearch = (payload: any) => mutation.mutate(payload);

  const handleSearch = (payload: any) => {
    if (!lgpdSessionAccepted) {
      setPendingSearchPayload(payload);
      setLgpdAccepted(false);
      setLgpdDisclaimerOpen(true);
      return;
    }
    executeSearch(payload);
  };

  const handleLgpdAcceptAndSearch = () => {
    setLgpdSessionAccepted(true);
    setLgpdDisclaimerOpen(false);
    if (pendingSearchPayload) {
      executeSearch({ ...pendingSearchPayload, lgpdAccepted: true });
      setPendingSearchPayload(null);
    }
  };

  const handleSaveConsulta = () => {
    toast({ title: "Consulta salva", description: "Esta consulta foi registrada automaticamente no historico." });
    setTimeout(() => setActiveTab("historico"), 1200);
  };

  const handleGeneratePDF = () => {
    if (!result) return;
    const html = generatePDF(result);
    if (!html) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast({ title: "Erro", description: "Permita pop-ups para gerar o relatorio.", variant: "destructive" }); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const handleClear = () => { setResult(null); setShowFullResult(false); };

  return (
    <div className="bg-[var(--color-bg)] p-4 lg:p-5" data-testid="consulta-isp-page">
      <div className="space-y-4">

        {/* HEADER — compact */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[var(--color-navy)] flex items-center justify-center flex-shrink-0">
              <Search className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-display font-semibold text-[var(--color-ink)] leading-tight" data-testid="text-consulta-isp-title">
                Consulta ISP
              </h1>
              <p className="text-sm text-[var(--color-muted)]">análise de crédito para provedores</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Inline stats */}
            <div className="hidden md:flex items-center gap-4 text-[var(--color-muted)]">
              <span className="font-mono text-sm" data-testid="text-isp-today">hoje <strong className="text-[var(--color-ink)]">{data?.todayCount ?? 0}</strong></span>
              <span className="font-mono text-sm" data-testid="text-isp-month">mês <strong className="text-[var(--color-ink)]">{data?.monthCount ?? 0}</strong></span>
              <span className="font-mono text-sm" data-testid="text-isp-approval">aprovação <strong className="text-[var(--color-ink)]">{approvalRate}%</strong></span>
              <span className="font-mono text-sm" data-testid="text-isp-avg-score">score <strong className="text-[var(--color-ink)]">{avgScore}</strong></span>
            </div>
            {/* Credits */}
            <div className="border-[0.5px] border-[var(--color-border)] rounded px-3 py-1.5 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[var(--color-navy)]" />
              <span className={`font-mono text-sm font-semibold ${(data?.credits ?? 1) === 0 ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}`} data-testid="text-isp-credits">
                {data?.credits ?? "..."}
              </span>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="flex gap-0 border-b-[0.5px] border-[var(--color-border)] w-fit">
          {(["nova", "historico", "timeline", "relatorios", "info"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`tab-${tab}`}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab ? "border-b-2 border-[var(--color-navy)] text-[var(--color-ink)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {tab === "nova" ? "Nova Consulta" : tab === "historico" ? "Histórico" : tab === "timeline" ? "Timeline" : tab === "relatorios" ? "Relatórios" : "Informações"}
            </button>
          ))}
        </div>

        {/* TAB: NOVA CONSULTA */}
        {activeTab === "nova" && (
          <div className="space-y-5">
            <ConsultaSearchBar
              onSearch={handleSearch}
              isLoading={mutation.isPending}
              hasResult={!!result}
              autoAddressCrossRef={result?.autoAddressCrossRef}
              onClear={handleClear}
            />

            {mutation.isPending && <LoadingCard />}

            {!mutation.isPending && result && (
              <div className="space-y-4" data-testid="consultation-result">
                {/* Nada Consta CEP */}
                {result.notFound && result.searchType === "cep" ? (
                  <Card className="overflow-hidden border-[0.5px] border-[var(--color-border)] rounded">
                    <div className="bg-[var(--color-success-bg)] px-6 py-4 flex items-center gap-3">
                      <CheckCircle className="w-6 h-6 text-[var(--color-success)]" />
                      <div>
                        <h3 className="text-lg font-display font-semibold text-[var(--color-ink)]">Nenhum Resultado para este CEP</h3>
                        <p className="text-sm text-[var(--color-muted)]">CEP: {result.cpfCnpj.replace(/^(\d{5})(\d{3})$/, "$1-$2")}</p>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="bg-[var(--color-success-bg)] border-[0.5px] border-[var(--color-border)] rounded p-4 flex items-center gap-3">
                        <Shield className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" />
                        <p className="text-sm text-[var(--color-success)]">Nenhum cliente encontrado nesse CEP na rede ISP colaborativa.</p>
                      </div>
                    </div>
                  </Card>
                ) : result.notFound && !(result.addressMatches?.some(m => m.hasDebt)) ? (
                  <Card className="overflow-hidden border-[0.5px] border-[var(--color-border)] rounded">
                    <div className="bg-[var(--color-success-bg)] px-6 py-4 flex items-center gap-3">
                      <CheckCircle className="w-6 h-6 text-[var(--color-success)]" />
                      <div>
                        <h3 className="text-lg font-display font-semibold text-[var(--color-ink)]">Nada Consta</h3>
                        <p className="text-sm text-[var(--color-muted)]">Documento: {formatCpfCnpj(result.cpfCnpj)}</p>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="bg-[var(--color-success-bg)] border-[0.5px] border-[var(--color-border)] rounded p-4 flex items-center gap-3">
                        <Shield className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" />
                        <p className="text-sm text-[var(--color-success)]">Nenhum cliente encontrado na base de dados. Documento sem restricoes na rede ISP colaborativa.</p>
                      </div>
                      <p className="text-xs text-[var(--color-muted)] mt-3 text-center">
                        Sugestao de Decisao: Aprovar — Prosseguir para Consulta SPC para verificacao completa
                      </p>
                    </div>
                  </Card>
                ) : !showFullResult ? (
                  <ConsultaResultSummary
                    result={result}
                    onShowDetail={(idx) => { setShowFullResult(true); setSelectedProviderIdx(idx); }}
                    onNewConsulta={handleClear}
                    onSave={handleSaveConsulta}
                    onGeneratePDF={handleGeneratePDF}
                  />
                ) : (
                  <ConsultaResultDetail
                    result={result}
                    selectedProviderIdx={selectedProviderIdx ?? 0}
                    onBack={() => setShowFullResult(false)}
                    onNewConsulta={handleClear}
                    onSave={handleSaveConsulta}
                    onGeneratePDF={handleGeneratePDF}
                    onShowHistory={() => setActiveTab("historico")}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "historico" && <ConsultaHistoryTab consultations={consultations} />}
        {activeTab === "timeline" && <TimelineTab timelineData={timelineData} cpfCnpj={timelineCpf} isLoading={timelineLoading} />}
        {activeTab === "relatorios" && <ConsultaReportsTab consultations={consultations} approvedCount={approvedCount} rejectedCount={rejectedCount} avgScore={avgScore} />}
        {activeTab === "info" && <ConsultaInfoTab />}

        <LgpdDisclaimerModal
          open={lgpdDisclaimerOpen}
          accepted={lgpdAccepted}
          onAccept={handleLgpdAcceptAndSearch}
          onCancel={() => { setLgpdDisclaimerOpen(false); setPendingSearchPayload(null); }}
          onToggle={setLgpdAccepted}
        />

        <ProviderDetailModals
          freeDialogOpen={freeDialogOpen}
          paidDialogOpen={paidDialogOpen}
          selectedFreeDetail={selectedFreeDetail}
          selectedPaidDetail={selectedPaidDetail}
          onCloseFree={() => setFreeDialogOpen(false)}
          onClosePaid={() => setPaidDialogOpen(false)}
        />

      </div>
    </div>
  );
}
