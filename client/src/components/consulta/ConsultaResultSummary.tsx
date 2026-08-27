import { Search, Lock, AlertTriangle, CornerDownRight, Download, Save, RotateCcw } from "lucide-react";
import AddressMapMini from "@/components/consulta/AddressMapMini";
import ScoreBreakdownPanel from "./ScoreBreakdownPanel";
import AiAnalysisSection from "./AiAnalysisSection";
import AddressRiskAlert from "./AddressRiskAlert";
import type { ConsultaResult, ProviderDetail } from "./types";
import { formatCpfCnpj } from "./utils";
import {
  Kicker, Pill, pillStyle, ReportSection, TintCard, DuoGrid, ScoreRing,
  bandOf, ReportButton, type TintCardData, type Tone,
} from "./report-ui";

interface Props {
  result: ConsultaResult;
  /** Registro gravado da consulta — origem do protocolo e do hash de auditoria. */
  consultation?: { id?: number; cpfCnpjHash?: string; createdAt?: string } | null;
  onShowDetail: (idx: number) => void;
  onNewConsulta: () => void;
  onSave: () => void;
  onGeneratePDF: () => void;
}

/* ── Leitura dos dados ──────────────────────────────────────── */

/** Máscara do documento consultado: mostra o suficiente para conferir, esconde o resto. */
function maskDoc(doc: string, searchType: string): string {
  const d = doc.replace(/\D/g, "");
  if (searchType === "cep") return d.replace(/^(\d{5})(\d{3})$/, "$1-$2");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.***/${d.slice(8, 12)}-${d.slice(12)}`;
  return formatCpfCnpj(doc);
}

function isDelinquent(d: ProviderDetail): boolean {
  return d.daysOverdue > 0
    || (!d.isSameProvider && !!d.overdueAmountRange)
    || !!d.status?.toLowerCase().includes("inadimplente");
}

function brl(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function fmtCep(cep: string): string {
  const d = (cep || "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

/**
 * A frase que sustenta a decisão. O backend manda `recommendation` como um
 * verbo solto ("REJEITAR") — sozinho não justifica nada, e repetir aqui o
 * primeiro alerta duplicaria a seção de Alertas logo abaixo. A frase é
 * escrita a partir dos sinais que realmente pesaram.
 */
function decisionSubtitle(result: ConsultaResult, ativas: number, equipamentos: number): string {
  const partes: string[] = [];

  if (ativas > 0) {
    const comValor = result.providerDetails.find(d => isDelinquent(d) && (d.overdueAmountRange || d.overdueAmount != null));
    const valor = comValor?.isSameProvider && comValor.overdueAmount != null
      ? brl(comValor.overdueAmount)
      : comValor?.overdueAmountRange;
    partes.push(
      `${ativas} ocorrência${ativas > 1 ? "s" : ""} de inadimplência ativa na rede`
      + (valor ? `, com débito de ${valor}` : ""),
    );
  }
  if (equipamentos > 0) {
    partes.push(`${equipamentos} equipamento${equipamentos > 1 ? "s" : ""} em comodato não devolvido`);
  }
  if (result.migratorAlert?.detected) {
    partes.push("padrão de migração entre provedores");
  }

  if (partes.length === 0) {
    return "Sem restrições na rede ISP colaborativa: nenhuma ocorrência de inadimplência, de equipamento ou de endereço registrada pelos provedores consultados.";
  }
  return partes.join(" · ") + ". A decisão final considera o seu apetite de risco e as garantias que você pode exigir na ativação.";
}

/** Cards "Seu provedor" / "Provedor parceiro" da seção de registros. */
function registroCard(d: ProviderDetail, parceirosConsultados: number): TintCardData {
  const own = d.isSameProvider;
  const mau = isDelinquent(d);

  if (own) {
    const valor = d.overdueAmount != null ? brl(d.overdueAmount) : null;
    const dias = d.daysOverdue > 0 ? `${d.daysOverdue} dias` : null;
    return {
      kicker: "Seu provedor",
      tone: mau ? "danger" : "ok",
      nome: d.customerName || "Nada consta",
      linha: [dias, valor].filter(Boolean).join(" · ") || d.status || "Em dia",
      linhaNegativa: mau,
      sub: d.hasUnreturnedEquipment
        ? `${d.unreturnedEquipmentCount} equipamento${d.unreturnedEquipmentCount > 1 ? "s" : ""} em comodato pendente`
        : undefined,
      chip: "Grátis",
      chipTone: "ok",
      fonte: `Seu ERP · ${d.providerName}`,
    };
  }

  const local = d.addressCity ? ` · ${d.addressCity}${d.addressState ? "/" + d.addressState : ""}` : "";
  return {
    kicker: "Provedor parceiro",
    tone: "neutral",
    nome: "Dados restritos",
    linha: [d.daysOverdueRange, d.overdueAmountRange].filter(Boolean).join(" · ")
      || d.status
      || `${parceirosConsultados} parceiros consultados · nada consta`,
    linhaNegativa: mau,
    chip: "1 crédito",
    chipTone: "neutral",
    fonte: `${d.providerName}${local}`,
  };
}

/* ════════════════════════════════════════════════════════════
   RELATÓRIO DE CRÉDITO — um card, seções separadas por hairline.
   ════════════════════════════════════════════════════════════ */
export default function ConsultaResultSummary({
  result, consultation, onNewConsulta, onSave, onGeneratePDF,
}: Props) {
  const score = Math.max(0, Math.min(1000, result.score));
  const band = bandOf(score);

  const proprios = result.providerDetails.filter(d => d.isSameProvider);
  const parceiros = result.providerDetails.filter(d => !d.isSameProvider);
  const ativas = result.providerDetails.filter(isDelinquent).length;
  const equipamentos = result.providerDetails.reduce(
    (s, d) => s + (d.hasUnreturnedEquipment ? d.unreturnedEquipmentCount : 0), 0,
  );

  // erpSummary.total conta todos os ERPs varridos na mesorregião — o seu incluído,
  // SE você tiver um. Não dá para subtrair 1 às cegas: um provedor sem integração
  // própria consulta N parceiros e o total já é N. Então o rótulo diz o que o
  // número realmente é: provedores consultados.
  const provedoresConsultados = result.erpSummary?.total ?? result.erpLatencies?.length ?? 0;
  // Para a copy dos cards, "parceiros" é o que existe fora da sua própria base.
  const parceirosConsultados = Math.max(0, provedoresConsultados - (proprios.length > 0 ? 1 : 0));

  const dt = consultation?.createdAt ? new Date(consultation.createdAt) : new Date();
  const dataHora = dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const protocolo = consultation?.id
    ? `#CI-${dt.getFullYear()}-${String(consultation.id).padStart(5, "0")}`
    : null;
  const origemDado = result.source === "cache" ? "dado em cache"
    : result.source === "no_erp" ? "sem ERP na região"
    : "dado REAL";
  const custoLabel = result.creditsCost > 0
    ? `custo ${result.creditsCost} crédito${result.creditsCost > 1 ? "s" : ""}`
    : "sem custo";

  const meta = [
    protocolo,
    dataHora,
    "rede ISP colaborativa",
    `${provedoresConsultados} provedor${provedoresConsultados === 1 ? "" : "es"} consultado${provedoresConsultados === 1 ? "" : "s"}`,
    origemDado,
    custoLabel,
  ].filter(Boolean).join(" · ");

  // O bloco é preenchimento sólido, não texto: usa os tokens -solid, que são
  // escurecidos o bastante para o texto por cima passar em AA.
  const decisao = result.decisionReco === "Accept"
    ? { short: "Aprovar", color: "var(--ok-solid)" }
    : result.decisionReco === "Reject"
    ? { short: "Rejeitar", color: "var(--danger-solid)" }
    : { short: "Analisar", color: "var(--gated-solid)" };

  /* ── Cards de registro ── */
  const registros: TintCardData[] = [
    proprios.length > 0
      ? registroCard(proprios[0], parceirosConsultados)
      : {
          kicker: "Seu provedor", tone: "ok" as Tone, nome: "Nada consta",
          linha: "Sem registro no seu ERP", chip: "Grátis", chipTone: "ok" as Tone,
          fonte: "Seu ERP",
        },
    ...(parceiros.length > 0
      ? parceiros.map(d => registroCard(d, parceirosConsultados))
      : [{
          kicker: "Provedor parceiro", tone: "ok" as Tone, nome: "Nada consta na rede",
          linha: `${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"} consultado${parceirosConsultados === 1 ? "" : "s"} · nada consta`,
          chip: "Grátis", chipTone: "ok" as Tone, fonte: "Rede ISP colaborativa",
        }]),
    ...proprios.slice(1).map(d => registroCard(d, parceirosConsultados)),
  ];

  /* ── Cards de equipamento ──
     "unknown" nunca vira "devolvido": ausência de sinal não é prova de devolução. */
  const equipProprio = proprios.find(d => d.hasUnreturnedEquipment);
  const equipParceiro = parceiros.find(d => d.hasUnreturnedEquipment);
  const equipCards: TintCardData[] = [
    equipProprio
      ? {
          kicker: "Seu provedor", tone: "danger",
          nome: `${equipProprio.unreturnedEquipmentCount} equipamento${equipProprio.unreturnedEquipmentCount > 1 ? "s" : ""} não devolvido${equipProprio.unreturnedEquipmentCount > 1 ? "s" : ""}`,
          linha: equipProprio.equipmentValueRange || equipProprio.equipmentPendingSummary || "Comodato pendente no seu ERP",
          chip: "Ocorrência ativa", chipTone: "danger",
          fonte: `Seu ERP · ${equipProprio.providerName}`,
        }
      : {
          kicker: "Seu provedor", tone: "ok", nome: "Nenhum equipamento retido",
          linha: "Sem registro de comodato pendente no seu ERP",
          chip: "Sem ocorrência", chipTone: "ok", fonte: "Seu ERP",
        },
    equipParceiro
      ? {
          kicker: "Provedor parceiro",
          tone: equipParceiro.equipmentSignalValidated ? "gated" : "neutral",
          nome: `${equipParceiro.unreturnedEquipmentCount >= 2 ? "2+" : equipParceiro.unreturnedEquipmentCount} equipamento${equipParceiro.unreturnedEquipmentCount > 1 ? "s" : ""} retido${equipParceiro.unreturnedEquipmentCount > 1 ? "s" : ""}`,
          linha: [
            equipParceiro.equipmentSignalValidated ? "Ocorrência validada" : "Pendência operacional",
            equipParceiro.equipmentValueRange,
          ].filter(Boolean).join(" · "),
          chip: equipParceiro.equipmentSignalValidated ? "Ocorrência validada" : "Sinal não validado",
          chipTone: equipParceiro.equipmentSignalValidated ? "gated" : "neutral",
          fonte: equipParceiro.providerName,
        }
      : {
          kicker: "Provedor parceiro", tone: "ok", nome: "Nenhum equipamento retido",
          linha: "Sem ocorrência validada no bureau",
          chip: "Sem ocorrência", chipTone: "ok", fonte: "Rede ISP colaborativa",
        },
  ];

  /* ── Cards de endereço ── */
  const matchesProprios = result.addressMatches?.filter(m => m.isSameProvider) ?? [];
  const matchesParceiros = result.addressMatches?.filter(m => !m.isSameProvider) ?? [];
  const inadProprios = matchesProprios.filter(m => m.hasDebt).length;
  const inadParceiros = matchesParceiros.filter(m => m.hasDebt).length;
  const cepUsado = result.addressUsed || proprios[0]?.cep || "";
  const cruzou = result.autoAddressCrossRef === true || !!result.addressSearch;

  const addrCards: TintCardData[] = [
    {
      kicker: "Seu provedor",
      tone: inadProprios > 0 ? "danger" : "ok",
      nome: inadProprios > 0 ? `${inadProprios} inadimplente${inadProprios > 1 ? "s" : ""} no endereço` : "Nada consta",
      linha: inadProprios > 0
        ? "Possível fraude por troca de documento"
        : matchesProprios.length > 0
          ? `${matchesProprios.length} cadastro${matchesProprios.length > 1 ? "s" : ""} ativo${matchesProprios.length > 1 ? "s" : ""} na sua base · em dia`
          : "Nenhum outro cadastro seu neste endereço",
      chip: inadProprios > 0 ? `${inadProprios} inadimplentes` : "Nada consta",
      chipTone: inadProprios > 0 ? "danger" : "ok",
      fonte: `Seu ERP${cepUsado ? " · CEP " + fmtCep(cepUsado) : ""}`,
    },
    {
      kicker: "Provedor parceiro",
      tone: inadParceiros > 0 ? "danger" : cruzou ? "ok" : "neutral",
      nome: inadParceiros > 0
        ? `${inadParceiros} inadimplente${inadParceiros > 1 ? "s" : ""} no endereço`
        : cruzou ? "Nada consta" : "Cruzamento não realizado",
      linha: inadParceiros > 0
        ? "Possível fraude por troca de documento"
        : cruzou
          ? `${matchesParceiros.length} cadastro${matchesParceiros.length === 1 ? "" : "s"} em parceiros · nenhum inadimplente`
          : "Faltam CEP e número para cruzar o imóvel na rede",
      chip: inadParceiros > 0 ? `${inadParceiros} inadimplentes` : cruzou ? "Nada consta" : "Indisponível",
      chipTone: inadParceiros > 0 ? "danger" : cruzou ? "ok" : "neutral",
      fonte: `Rede ISP${cepUsado ? " · CEP " + fmtCep(cepUsado) : ""}`,
    },
  ];

  const linhasEndereco = (result.addressMatches ?? []).filter(m => m.hasDebt);
  const temMapa = !!(cepUsado || proprios[0]?.address || proprios[0]?.latitude);

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}
      data-testid="consultation-result-cards"
    >
      {/* ═══ 1 · CABEÇALHO ═══ */}
      <div style={{
        padding: "18px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: "var(--surface-2)",
            border: "1px solid var(--border)", display: "flex", alignItems: "center",
            justifyContent: "center", color: "var(--text-2)", flexShrink: 0,
          }}>
            <Search size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {result.searchType.toUpperCase()} consultado · {meta}
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700,
              fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em",
              marginTop: 2, color: "var(--text)",
            }} data-testid="text-consulted-doc">
              {maskDoc(result.cpfCnpj, result.searchType)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "var(--track-wide)",
            padding: "5px 12px", borderRadius: 7, whiteSpace: "nowrap",
            background: `var(--${band.tone === "info" ? "now" : band.tone}-bg)`,
            color: band.color,
            border: `1px solid var(--${band.tone === "info" ? "now" : band.tone}-border)`,
          }} data-testid="badge-faixa-score">
            {band.label}
          </span>
          <ReportButton onClick={onGeneratePDF} testId="button-generate-pdf">
            <Download size={14} /> PDF
          </ReportButton>
          <ReportButton onClick={onSave} testId="button-save-consulta">
            <Save size={14} /> Salvar
          </ReportButton>
          <ReportButton onClick={onNewConsulta} variant="primary" testId="button-nova-consulta">
            <RotateCcw size={14} /> Nova consulta
          </ReportButton>
        </div>
      </div>

      {/* ═══ 2 · SCORE E SUGESTÃO ═══ */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "16px 24px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <ScoreRing score={score} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              Score ISP <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/ 1000</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
              <Pill tone={ativas > 0 ? "past" : "ok"}>
                {result.providersFound || result.providerDetails.length} provedores
              </Pill>
              <Pill tone={ativas > 0 ? "danger" : "ok"}>
                {ativas} {ativas === 1 ? "ocorrência ativa" : "ocorrências ativas"}
              </Pill>
              <Pill tone={equipamentos > 0 ? "gated" : "neutral"}>
                {equipamentos} equip. retidos
              </Pill>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            background: decisao.color, color: "var(--text-on-brand)", borderRadius: 9,
            padding: "10px 20px", textAlign: "center", minWidth: 120,
          }} data-testid="ai-suggestion-banner">
            {/* Sem opacity: 9px já é pequeno, e .78 derrubava o contraste abaixo de AA. */}
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "var(--track-wide)",
            }}>
              Sugestão
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.02em", marginTop: 2,
            }} data-testid="text-ai-recommendation">
              {decisao.short}
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, marginTop: 14,
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          gap: 14, flexWrap: "wrap",
        }}>
          <span style={{ maxWidth: 640 }}>{decisionSubtitle(result, ativas, equipamentos)}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "var(--track-wide)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>Gate · decisão final é sua</span>
        </div>
      </div>

      {/* ═══ 3 · COMPOSIÇÃO DO SCORE ═══
          O handoff manda a composição para a aba Informações. Aqui ela fica:
          um score que decide contrato precisa mostrar a conta no mesmo lugar
          em que mostra o número — foi exatamente o furo que o motor v2 corrigiu. */}
      {(result.composicaoScore || result.fatoresScore) && result.searchType !== "cep" && (
        <ReportSection>
          <ScoreBreakdownPanel
            composicao={result.composicaoScore}
            fatores={result.fatoresScore}
            score={result.score}
          />
        </ReportSection>
      )}

      {/* ═══ 4 · REGISTROS POR PROVEDOR ═══ */}
      {result.searchType !== "cep" && (
        <ReportSection
          title="Registros por provedor"
          trailing={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-faint)" }}>
              <Lock size={10} />
              <span style={{ fontSize: 10 }}>Terceiros anonimizados · valores em faixa (LGPD)</span>
            </div>
          }
        >
          <DuoGrid>
            {registros.map((c, i) => <TintCard key={i} data={c} />)}
          </DuoGrid>
        </ReportSection>
      )}

      {/* ═══ 5 · EQUIPAMENTO EM COMODATO ═══ */}
      {result.searchType !== "cep" && (
        <ReportSection
          title="Equipamento em comodato"
          trailing={
            <Pill tone={equipamentos > 0 ? "gated" : "ok"}>
              {equipamentos === 0 ? "Sem ocorrência" : equipParceiro?.equipmentSignalValidated ? "Ocorrência validada" : "Ocorrência registrada"}
            </Pill>
          }
        >
          <DuoGrid>
            {equipCards.map((c, i) => <TintCard key={i} data={c} />)}
          </DuoGrid>
        </ReportSection>
      )}

      {/* ═══ 6 · VERIFICAÇÃO POR ENDEREÇO ═══ */}
      <ReportSection
        title="Verificação por endereço"
        trailing={
          result.autoAddressCrossRef === true ? (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "var(--track-wide)",
              color: "var(--brand-ink)", background: "var(--brand-soft)",
              padding: "3px 7px", borderRadius: 5,
            }}>
              Cruzamento automático
            </span>
          ) : undefined
        }
      >
        <DuoGrid>
          {addrCards.map((c, i) => <TintCard key={i} data={c} />)}
        </DuoGrid>

        {/* Outros documentos inadimplentes no mesmo imóvel — o backend calcula
            e ninguém mais mostra. É o sinal de fraude por troca de documento. */}
        {result.addressRiskAlerts && <AddressRiskAlert data={result.addressRiskAlerts} />}

        {temMapa && (
          <div style={{ position: "relative", marginTop: 12 }}>
            <AddressMapMini
              cep={cepUsado}
              address={proprios[0]?.address}
              city={proprios[0]?.addressCity}
              state={proprios[0]?.addressState}
              neighborhood={proprios[0]?.neighborhood}
              addressNumber={proprios[0]?.addressNumber}
              latitude={proprios[0]?.latitude}
              longitude={proprios[0]?.longitude}
            />
            {cepUsado && (
              <span style={{
                position: "absolute", left: 10, bottom: 10,
                fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "4px 9px", color: "var(--text)",
                boxShadow: "0 1px 4px rgba(12,17,26,.12)", pointerEvents: "none",
              }}>
                CEP {fmtCep(cepUsado)}
                {proprios[0]?.addressCity ? ` · ${proprios[0].addressCity}/${proprios[0].addressState ?? ""}` : ""}
              </span>
            )}
          </div>
        )}

        {linhasEndereco.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {linhasEndereco.map((m, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1.5fr 1.3fr 140px 170px",
                gap: 10, alignItems: "center", padding: "10px 0",
                borderBottom: "1px solid var(--border-faint)",
              }} data-testid={`address-match-${i}`}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{m.customerName}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.providerName}</div>
                <div><span style={pillStyle("past")}>{m.status}</span></div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", color: "var(--money-neg)", textAlign: "right",
                }}>
                  {m.isSameProvider && m.totalOverdue != null ? brl(m.totalOverdue) : m.totalOverdueRange || "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </ReportSection>

      {/* ═══ 7 · ALERTAS | AÇÕES ═══ */}
      {((result.alerts?.length ?? 0) > 0 || (result.recommendedActions?.length ?? 0) > 0) && (
        <div style={{
          borderTop: "1px solid var(--border)", padding: "18px 24px",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 28,
        }}>
          <div>
            <Kicker>Alertas</Kicker>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {(result.alerts?.length ?? 0) > 0
                ? result.alerts.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <AlertTriangle size={13} style={{ color: "var(--gated)", flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{a}</span>
                    </div>
                  ))
                : <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Nenhum alerta ativo para este documento.</span>}
            </div>
          </div>
          <div>
            <Kicker>Ações recomendadas</Kicker>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {(result.recommendedActions?.length ?? 0) > 0
                ? result.recommendedActions.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <CornerDownRight size={13} style={{ color: "var(--brand-ink)", flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{a}</span>
                    </div>
                  ))
                : <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Prosseguir conforme a política do provedor.</span>}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 8 · PARECER DO AGENTE ═══ */}
      {result.searchType !== "cep" && <AiAnalysisSection result={result} />}

      {/* ═══ 9 · RODAPÉ DE AUDITORIA ═══ */}
      <div style={{
        borderTop: "1px solid var(--border)", background: "var(--surface-2)",
        padding: "12px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--text-muted)" }}>
          <Lock size={11} />
          <span style={{ fontSize: 11 }}>
            Dados de terceiros anonimizados conforme LGPD
            {result.controlador ? ` · Controlador: ${result.controlador}` : ""}
            {" · Finalidade: proteção ao crédito"}
          </span>
        </div>
        {consultation?.cpfCnpjHash && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)" }}>
            hash de auditoria {consultation.cpfCnpjHash.slice(0, 4)}…{consultation.cpfCnpjHash.slice(-4)}
          </span>
        )}
      </div>
    </div>
  );
}
