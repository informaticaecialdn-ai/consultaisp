import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, CheckCircle, AlertTriangle, Network, BarChart3, Router, MapPin, Shield,
} from "lucide-react";

import type { ConsultaResult } from "@/components/consulta/types";
import { formatCpfCnpj } from "@/components/consulta/utils";
import { generatePDF } from "@/components/consulta/PdfReportGenerator";
import { Kicker } from "@/components/consulta/report-ui";
import LoadingCard from "@/components/consulta/LoadingCard";
import ConsultaIdleState from "@/components/consulta/ConsultaIdleState";
import ConsultaSearchBar from "@/components/consulta/ConsultaSearchBar";
import ConsultaResultSummary from "@/components/consulta/ConsultaResultSummary";
import ConsultaHistoryTab from "@/components/consulta/ConsultaHistoryTab";
import TimelineTab from "@/components/consulta/TimelineTab";
import ConsultaReportsTab from "@/components/consulta/ConsultaReportsTab";
import ConsultaInfoTab from "@/components/consulta/ConsultaInfoTab";
import LgpdDisclaimerModal from "@/components/consulta/LgpdDisclaimerModal";

const ABAS = [
  ["nova", "Nova consulta"],
  ["historico", "Histórico"],
  ["timeline", "Timeline"],
  ["relatorios", "Relatórios"],
  ["info", "Informações"],
] as const;

type Aba = (typeof ABAS)[number][0];

/** O que a Consulta ISP entrega — fica visível enquanto não há resultado. */
const CARDS_OCIOSO = [
  { icon: Network, title: "Rede colaborativa.", text: "Ocorrências reais dos ERPs de provedores parceiros, anonimizadas." },
  { icon: BarChart3, title: "Score 0–1000.", text: "Base 700 e deduções nomeadas, com a conta aberta no relatório." },
  { icon: Router, title: "Equipamentos retidos.", text: "Ocorrências de comodato não devolvido, validadas no bureau." },
  { icon: MapPin, title: "Cruzamento por endereço.", text: "Inadimplência no mesmo imóvel, mesmo com CPF limpo." },
];

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const [result, setResult] = useState<ConsultaResult | null>(null);
  const [consultation, setConsultation] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Aba>("nova");
  const [documentoEmConsulta, setDocumentoEmConsulta] = useState("");

  // LGPD
  const [lgpdDisclaimerOpen, setLgpdDisclaimerOpen] = useState(false);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [pendingSearchPayload, setPendingSearchPayload] = useState<any>(null);

  // Queries
  const { data } = useQuery<any>({ queryKey: ["/api/isp-consultations"] });
  const consultations = data?.consultations || [];
  const approvedCount = consultations.filter((c: any) => c.approved).length;
  const rejectedCount = consultations.filter((c: any) => !c.approved).length;
  const avgScore = consultations.length > 0
    ? Math.round(consultations.reduce((acc: number, c: any) => acc + (c.score || 0), 0) / consultations.length)
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
      const res = await apiRequest("POST", "/api/isp-consultations", { ...payload, lgpdAccepted: payload.lgpdAccepted ?? false });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.result);
      setConsultation(data.consultation ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/isp-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

      const ownCount = (data.result?.providerDetails || []).filter((d: any) => d.isSameProvider).length;
      const otherCount = (data.result?.providerDetails || []).filter((d: any) => !d.isSameProvider).length;

      if (data.result?.notFound) {
        toast(data.result?.source === "no_erp"
          ? { title: "Sem cobertura na região", description: "Nenhum ERP ativo para consultar. Nada foi varrido." }
          : { title: "Nada consta", description: "Nenhum registro na rede ISP. Consulta gratuita." });
      } else if (otherCount > 0) {
        toast({
          title: "Consulta registrada",
          description: `${ownCount > 0 ? `${ownCount} registro do seu ERP (grátis) · ` : ""}${otherCount} em parceiro${otherCount > 1 ? "s" : ""} · ${otherCount} crédito${otherCount > 1 ? "s" : ""}.`,
        });
      } else if (ownCount > 0) {
        toast({ title: "Consulta gratuita", description: `${ownCount} registro${ownCount > 1 ? "s" : ""} do seu próprio ERP.` });
      }
    },
    onError: (err: any) => {
toast({ title: "Não foi possível consultar", description: err.message, variant: "destructive" });
    },
  });

  // Handlers
  const executeSearch = (payload: any) => {
    const dig = (payload.cpfCnpj || "").replace(/\D/g, "");
    setDocumentoEmConsulta(
      dig.length === 8
        ? `${dig.slice(0, 5)}-${dig.slice(5)}`   // formatCpfCnpj não sabe CEP
        : formatCpfCnpj(payload.cpfCnpj || ""),
    );
    mutation.mutate(payload);
  };

  /* O aceite vale para UMA consulta, não para a sessão.
     Antes, o primeiro "declaro" liberava todas as consultas seguintes até o
     próximo F5 — o registro de auditoria do servidor recebia lgpdAccepted:true
     em buscas que o operador nunca declarou. Cada consulta é um tratamento de
     dado de um titular diferente e pede o seu próprio aceite. */
  const handleSearch = (payload: any) => {
    setPendingSearchPayload(payload);
    setLgpdAccepted(false);
    setLgpdDisclaimerOpen(true);
  };

  const handleLgpdAcceptAndSearch = () => {
    setLgpdDisclaimerOpen(false);
    if (pendingSearchPayload) {
      executeSearch({ ...pendingSearchPayload, lgpdAccepted: true });
      setPendingSearchPayload(null);
    }
  };

  const handleSaveConsulta = () => {
    toast({ title: "Consulta salva", description: "Esta consulta foi registrada automaticamente no histórico." });
    setTimeout(() => setActiveTab("historico"), 1200);
  };

  const handleGeneratePDF = () => {
    if (!result) return;
    const html = generatePDF(result);
    if (!html) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast({ title: "Relatório não abriu", description: "Permita pop-ups neste site para gerar o PDF.", variant: "destructive" }); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const handleClear = () => { setResult(null); setConsultation(null); };

  /* "Nada consta" tem card próprio: sem ocorrência não há o que compor, e um
     relatório completo cheio de zeros faria o operador procurar problema onde
     não tem. Ainda assim não é aprovação automática — o texto diz isso. */
  const nadaConsta = result?.notFound && !(result.addressMatches?.some(m => m.hasDebt));
  /* Sem ERP na regiao a rede nao foi varrida: nao e "nada consta", e ausencia
     de cobertura. Verde aqui seria um falso alivio. */
  const semCobertura = result?.source === "no_erp";

  return (
    <div style={{ background: "var(--bg)", minHeight: "100%" }} data-testid="consulta-isp-page">
      <div style={{
        maxWidth: 1080, margin: "0 auto", padding: "26px 32px 56px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>

        {/* ── CABEÇALHO ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1
              style={{ fontSize: 19, fontWeight: 600, letterSpacing: "var(--track-tight)", lineHeight: 1.2, color: "var(--text)" }}
              data-testid="text-consulta-isp-title"
            >
              Consulta ISP
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
              Análise de crédito colaborativa entre provedores
            </p>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            borderRadius: 8, padding: "7px 12px",
          }}>
            <CreditCard size={15} style={{ color: "var(--text-2)" }} />
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: (data?.credits ?? 1) === 0 ? "var(--danger)" : "var(--text)",
              }}
              data-testid="text-isp-credits"
            >
              {data?.credits ?? "…"}
            </span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase",
              letterSpacing: "var(--track-wide)", color: "var(--text-muted)",
            }}>
              créditos
            </span>
          </div>
        </div>

        {/* ── ABAS ── */}
        <div role="tablist" aria-label="Seções da Consulta ISP" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)", width: "100%", flexWrap: "wrap" }}>
          {ABAS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`aba-${id}`}
              aria-selected={activeTab === id}
              aria-controls={`painel-${id}`}
              onClick={() => setActiveTab(id)}
              className="ds-ctl"
              data-testid={`tab-${id}`}
              style={{
                padding: "9px 14px", fontSize: 13, cursor: "pointer", marginBottom: -1,
                background: "none", fontFamily: "var(--font-sans)",
                border: "none", borderBottom: `2px solid ${activeTab === id ? "var(--action)" : "transparent"}`,
                color: activeTab === id ? "var(--text)" : "var(--text-muted)",
                fontWeight: activeTab === id ? 600 : 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── ABA: NOVA CONSULTA ── */}
        {activeTab === "nova" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ConsultaSearchBar
              onSearch={handleSearch}
              isLoading={mutation.isPending}
              hasResult={!!result}
              autoAddressCrossRef={result?.autoAddressCrossRef}
              onClear={handleClear}
            />

            {mutation.isPending && <LoadingCard documento={documentoEmConsulta} />}

            {!mutation.isPending && !result && (
              <ConsultaIdleState
                totalConsultas={consultations.length}
                cards={CARDS_OCIOSO}
                emptyTitle="Nenhuma consulta ainda"
                emptyDescription="Digite o CPF de um candidato antes de liberar a instalação. Você recebe o score de risco e o histórico dele em toda a rede de provedores."
                emptyCta="Fazer primeira consulta"
                searchInputTestId="input-isp-search"
              />
            )}

            {!mutation.isPending && result && (
              <div data-testid="consultation-result">
                {nadaConsta ? (
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 10, overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "18px 24px", display: "flex", alignItems: "center", gap: 14,
                      background: semCobertura ? "var(--gated-bg)" : "var(--ok-bg)",
                      borderBottom: `1px solid ${semCobertura ? "var(--gated-border)" : "var(--ok-border)"}`,
                    }}>
                      {semCobertura
                        ? <AlertTriangle size={20} style={{ color: "var(--gated)", flexShrink: 0 }} />
                        : <CheckCircle size={20} style={{ color: "var(--ok)", flexShrink: 0 }} />}
                      <div>
                        <Kicker style={{ color: semCobertura ? "var(--gated)" : "var(--ok)" }}>
                          {semCobertura ? "Sem cobertura na região" : "Nada consta"}
                        </Kicker>
                        <div style={{
                          fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700,
                          fontVariantNumeric: "tabular-nums", marginTop: 2, color: "var(--text)",
                        }}>
                          {result.searchType === "cep"
                            ? result.cpfCnpj.replace(/^(\d{5})(\d{3})$/, "$1-$2")
                            : formatCpfCnpj(result.cpfCnpj)}
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                      {/* Sem ERP na região, ninguém foi consultado — dizer "nada
                          consta na rede" seria afirmar uma varredura que não houve. */}
                      <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
                        {semCobertura
                          ? "Nenhum provedor da sua região tem integração de ERP ativa, então não houve o que consultar. Isto não é um \"nada consta\": a rede não foi varrida. Configure a integração em Painel do Provedor para que a consulta passe a valer."
                          : "Nenhum registro na rede ISP colaborativa: nem no seu ERP, nem nos provedores parceiros da sua região. Ausência de ocorrência não é histórico de bom pagamento — significa apenas que a rede não tem o que informar sobre este documento."}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                          textTransform: "uppercase", letterSpacing: "var(--track-wide)",
                          padding: "3px 9px", borderRadius: 6, background: "var(--ok-bg)",
                          color: "var(--ok)", border: "1px solid var(--ok-border)",
                        }}>
                          <Shield size={11} /> Consulta gratuita
                        </span>
                        <Kicker>Gate · decisão final é sua</Kicker>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ConsultaResultSummary
                    result={result}
                    consultation={consultation}
                    onShowDetail={() => {}}
                    onNewConsulta={handleClear}
                    onSave={handleSaveConsulta}
                    onGeneratePDF={handleGeneratePDF}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "historico" && <div role="tabpanel" id="painel-historico" aria-labelledby="aba-historico"><ConsultaHistoryTab consultations={consultations} /></div>}
        {activeTab === "timeline" && <div role="tabpanel" id="painel-timeline" aria-labelledby="aba-timeline"><TimelineTab timelineData={timelineData} cpfCnpj={timelineCpf} isLoading={timelineLoading} /></div>}
        {activeTab === "relatorios" && <div role="tabpanel" id="painel-relatorios" aria-labelledby="aba-relatorios"><ConsultaReportsTab consultations={consultations} approvedCount={approvedCount} rejectedCount={rejectedCount} avgScore={avgScore} /></div>}
        {activeTab === "info" && <div role="tabpanel" id="painel-info" aria-labelledby="aba-info"><ConsultaInfoTab /></div>}

        <LgpdDisclaimerModal
          open={lgpdDisclaimerOpen}
          accepted={lgpdAccepted}
          onAccept={handleLgpdAcceptAndSearch}
          onCancel={() => { setLgpdDisclaimerOpen(false); setPendingSearchPayload(null); }}
          onToggle={setLgpdAccepted}
        />
      </div>
    </div>
  );
}
