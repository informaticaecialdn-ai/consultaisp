import "./consulta-spc.css";
import "./consulta-isp.css";
import { useState, useEffect, useRef } from "react";
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

import ConsultaSearchBar from "@/components/consulta/ConsultaSearchBar";
import ChipsDeExemplo from "@/components/consulta/ChipsDeExemplo";
import ConsultaResultSummary from "@/components/consulta/ConsultaResultSummary";
import ConsultaHistoryTab from "@/components/consulta/ConsultaHistoryTab";
import TimelineTab from "@/components/consulta/TimelineTab";
import ConsultaReportsTab from "@/components/consulta/ConsultaReportsTab";
import ConsultaInfoTab from "@/components/consulta/ConsultaInfoTab";
import LgpdDisclaimerModal from "@/components/consulta/LgpdDisclaimerModal";
import IdentificacaoConsulta from "@/components/consulta/IdentificacaoConsulta";
import ConsultaErroCard from "@/components/consulta/ConsultaErroCard";
import {
  lerIdentificacao, lerErroDeConsulta,
  type IdentificacaoDaConsulta, type ErroDeConsulta,
} from "@/components/consulta/identificacao";

const ABAS = [
  ["nova", "Consultar documento"],
  ["historico", "Histórico"],
  ["timeline", "Linha do tempo"],
  ["relatorios", "Relatórios"],
  ["info", "Guia de leitura"],
] as const;

type Aba = (typeof ABAS)[number][0];

/** O que a Consulta ISP entrega — fica visível enquanto não há resultado. */
const CARDS_OCIOSO = [
  { icon: Network, title: "Rede colaborativa.", text: "Registros compartilhados pelos provedores participantes da rede." },
  { icon: BarChart3, title: "Score 0–1000.", text: "Base 700 e deduções por sinal — o método completo está no Guia de leitura." },
  { icon: Router, title: "Equipamentos retidos.", text: "Ocorrências de comodato não devolvido, validadas no bureau." },
  { icon: MapPin, title: "Cruzamento por endereço.", text: "Verifique registros associados ao endereço e confira o vínculo com o cliente." },
];

export default function ConsultaISPPage() {
  const { toast } = useToast();
  const resultRef = useRef<HTMLDivElement>(null);

  const [result, setResult] = useState<ConsultaResult | null>(null);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [result]);
  const [consultation, setConsultation] = useState<any>(null);
  /* O identificador é da REQUISIÇÃO, não do registro: existe também quando não
     houve linha gravada (nada consta, sem cobertura) e quando a consulta falhou.
     Por isso mora aqui, em estado próprio, e não dentro de `consultation`. */
  const [identificacao, setIdentificacao] = useState<IdentificacaoDaConsulta | null>(null);
  const [erro, setErro] = useState<ErroDeConsulta | null>(null);
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
      setIdentificacao(lerIdentificacao(data));
      setErro(null);
      queryClient.invalidateQueries({ queryKey: ["/api/isp-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

      const ownCount = (data.result?.providerDetails || []).filter((d: any) => d.isSameProvider).length;
      const otherCount = (data.result?.providerDetails || []).filter((d: any) => !d.isSameProvider).length;

      if (data.result?.notFound) {
        toast(data.result?.source === "no_erp"
          ? { title: "Sem cobertura na região", description: "Não há integrações ativas disponíveis. O histórico não pôde ser verificado." }
          : { title: "Nenhum registro encontrado", description: "Sem registros nas fontes consultadas. Nenhum crédito foi cobrado." });
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
      // O toast avisa e some; o card fica com o código, que é o que o provedor
      // leva ao suporte. A mensagem sai desembrulhada — antes ia para a tela
      // com o status colado no JSON ("500: {"message":...").
      const falha = lerErroDeConsulta(err);
      setResult(null);
      setConsultation(null);
      setIdentificacao(null);
      setErro(falha);
      toast({
        title: "Não foi possível consultar",
        description: falha.consultaId ? `${falha.mensagem} · ${falha.consultaId}` : falha.mensagem,
        variant: "destructive",
      });
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
    // `consultation` entra pela data da consulta e pelo hash de auditoria: sem
    // passa-la, o papel carimbava a hora da IMPRESSAO como se fosse a da
    // consulta. O identificador vai separado — ele existe mesmo sem registro.
    const html = generatePDF(result, consultation, identificacao);
    if (!html) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast({ title: "Relatório não abriu", description: "Permita pop-ups neste site para gerar o PDF.", variant: "destructive" }); return; }
    w.document.write(html);
    w.document.close();
    w.focus();

    // Espera as fontes carregarem antes do dialogo. Com o `setTimeout` fixo de
    // 400ms a impressao disparava antes de Inter e IBM Plex Mono chegarem, e o
    // documento saia em fonte de sistema — sem o mono tabular, que e o que
    // alinha as colunas de numero. `document.fonts.ready` resolve quando as
    // duas familias estao prontas; o timeout vira so a rede de seguranca.
    const imprimir = () => { try { w.focus(); w.print(); } catch { /* janela fechada */ } };
    const fontes = (w.document as Document & { fonts?: FontFaceSet }).fonts;
    if (fontes?.ready) {
      Promise.race([fontes.ready, new Promise(r => setTimeout(r, 3000))]).then(imprimir);
    } else {
      setTimeout(imprimir, 400);
    }
  };

  const handleClear = () => {
    setResult(null); setConsultation(null); setIdentificacao(null); setErro(null);
  };

  /* "Nada consta" tem card próprio: sem ocorrência não há o que compor, e um
     relatório completo cheio de zeros faria o operador procurar problema onde
     não tem. Ainda assim não é aprovação automática — o texto diz isso. */
  const nadaConsta = result?.notFound && !(result.addressMatches?.some(m => m.hasDebt));
  /* Sem ERP na regiao a rede nao foi varrida: nao e "nada consta", e ausencia
     de cobertura. Verde aqui seria um falso alivio. */
  const semCobertura = result?.source === "no_erp";

  return (
    <div className="spc-page isp-page" data-testid="consulta-isp-page">
      <div className="isp-content">
        <header className="spc-hero">
          <div className="spc-hero-main"><span className="spc-symbol"><Network size={26}/></span><div><span className="spc-kicker">ANÁLISE DE CRÉDITO · REDE COLABORATIVA</span><h1 data-testid="text-consulta-isp-title">Consulta ISP</h1><p>Histórico em provedores para apoiar sua decisão.</p></div></div>
          <div className="spc-balance"><CreditCard size={19}/><div><span>Seu saldo</span><strong data-testid="text-isp-credits">{data?.credits ?? "—"} <small>créditos</small></strong></div></div>
        </header>
        <div className="spc-activity"><span><Network size={14}/>Rede de provedores de internet</span><span className="spc-source"><Shield size={14}/>Fonte: rede ISP</span></div>

        {/* ── ABAS ── */}
        <div role="tablist" aria-label="Seções da Consulta ISP" className="isp-tabs">
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

            >
              {label}
            </button>
          ))}
        </div>

        {/* ── ABA: NOVA CONSULTA ── */}
        {activeTab === "nova" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ChipsDeExemplo onEscolher={(cpf) => handleSearch({ cpfCnpj: cpf })} />

            <ConsultaSearchBar
              heading="Quem você deseja consultar?"
              description="Informe um CPF ou CNPJ. Para pesquisar um imóvel, use o CEP e o número."
              kicker="CONSULTA NA REDE ISP"
              initialDocument={(() => {
                const doc = new URLSearchParams(window.location.search).get("doc")?.replace(/\D/g, "") ?? "";
                return [11, 14].includes(doc.length) ? doc : "";
              })()}
              onSearch={handleSearch}
              isLoading={mutation.isPending}
              hasResult={!!result}
              autoAddressCrossRef={result?.autoAddressCrossRef}
              onClear={handleClear}
            />

            {mutation.isPending && <LoadingCard documento={documentoEmConsulta} />}

            {!mutation.isPending && erro && <ConsultaErroCard erro={erro} testId="consulta-isp-erro" />}

            {!mutation.isPending && !result && !erro && <div className="spc-included"><h3>Uma visão do cliente na rede de provedores</h3><div>{CARDS_OCIOSO.map(item => <section key={item.title}><item.icon size={20}/><h4>{item.title}</h4><p>{item.text}</p></section>)}</div><p className="spc-included-foot">A cobertura depende dos provedores integrados. Ausência de registros não é aprovação automática.</p></div>}

            {!mutation.isPending && result && (
              <div ref={resultRef} style={{ scrollMarginTop: 64 }} data-testid="consultation-result">
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
                          {semCobertura ? "Consulta indisponível nesta rede" : "Nenhum registro encontrado"}
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
                          ? "Não há integrações ativas disponíveis para esta consulta. Não foi possível verificar o histórico. Fale com o suporte para conferir a cobertura da rede."
                          : "Não encontramos registros deste documento nas fontes consultadas. Isso não comprova bom histórico de pagamento. Considere outras informações antes de decidir."}
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
                        <Kicker>A decisão de crédito é sua</Kicker>
                      </div>
                      {/* O código aparece TAMBÉM aqui, e é neste caminho que ele
                          mais faz falta: "consultei e não veio nada" é a
                          reclamação mais comum, e até agora não havia número
                          nenhum para o suporte procurar — o protocolo derivado
                          dependia de uma linha gravada que este caminho não tem. */}
                      <IdentificacaoConsulta
                        consultaId={identificacao?.consultaId}
                        protocoloDaOrigem={identificacao?.protocoloDaOrigem}
                        style={{ marginTop: 2 }}
                        testIdPrefixo="identificacao-nada-consta"
                      />
                    </div>
                  </div>
                ) : (
                  <ConsultaResultSummary
                    result={result}
                    consultation={consultation}
                    consultaId={identificacao?.consultaId}
                    protocoloDaOrigem={identificacao?.protocoloDaOrigem}
                    onShowDetail={() => {}}
                    onSave={handleSaveConsulta}
                    onGeneratePDF={handleGeneratePDF}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "historico" && <div role="tabpanel" id="painel-historico" aria-labelledby="aba-historico"><ConsultaHistoryTab consultations={consultations} onOpen={(id) => {
          const saved = consultations.find((entry: { id: number }) => entry.id === id);
          if (!saved?.result || typeof saved.result !== "object") return;
          setResult(saved.result);
          setConsultation(saved);
          setIdentificacao(lerIdentificacao({ consultation: saved, result: saved.result }));
          setErro(null);
          setActiveTab("nova");
        }} /></div>}
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
