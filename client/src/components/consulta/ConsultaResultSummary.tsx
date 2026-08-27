import { Lock, AlertTriangle, CornerDownRight, Download, Save, RotateCcw, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import AddressMapMini from "@/components/consulta/AddressMapMini";
import ScoreBreakdownPanel from "./ScoreBreakdownPanel";
import AiAnalysisSection from "./AiAnalysisSection";
import AddressRiskAlert from "./AddressRiskAlert";
import type { ConsultaResult, ProviderDetail } from "./types";
import { formatCpfCnpj } from "./utils";
import {
  Kicker, pillStyle, ReportSection, ScoreBar, ProvTag, Th,
  bandOf, ReportButton, type Tone,
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
 * A frase que sustenta a decisão — escrita a partir dos sinais que pesaram,
 * nunca o eco de um alerta que já aparece na seção 07.
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
  return partes.join(" · ") + ". A decisão considera o seu apetite de risco e as garantias que você pode exigir na ativação.";
}

/* Linha da tabela de ocorrências (03). */
interface OcorrenciaRow {
  cliente: string;
  sub?: string;
  fonte: string;
  situacao: string;
  situacaoTone: Tone;
  atraso: string;
  valor: string;
  valorNegativo: boolean;
  custo: string;
}

/* Linha das tabelas de 3 colunas (04 e 05). */
interface FonteRow {
  kicker: string;
  fonte: string;
  chip: string;
  chipTone: Tone;
  nome: string;
  linha: string;
}

const GRID_OCORRENCIAS = "minmax(110px, 1.5fr) minmax(110px, 1.3fr) 120px 90px minmax(120px, 150px) 70px";
const GRID_FONTE = "minmax(140px, 1.2fr) 170px 2fr";

/* ════════════════════════════════════════════════════════════
   RELATÓRIO DE CRÉDITO v2 — um card, seções numeradas por hairline.
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

  // erpSummary.total conta todos os ERPs varridos na mesorregião, o seu incluído
  // SE você tiver um. O rótulo diz o que o número é: provedores consultados.
  const provedoresConsultados = result.erpSummary?.total ?? result.erpLatencies?.length ?? 0;
  const parceirosConsultados = Math.max(0, provedoresConsultados - (proprios.length > 0 ? 1 : 0));

  const dt = consultation?.createdAt ? new Date(consultation.createdAt) : new Date();
  const dataHora = dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const protocolo = consultation?.id
    ? `#CI-${dt.getFullYear()}-${String(consultation.id).padStart(5, "0")}`
    : null;
  const provKind = result.source === "cache" ? "cache" : result.source === "no_erp" ? "sem-rede" : "real";
  const custoLabel = result.creditsCost > 0
    ? `custo ${result.creditsCost} crédito${result.creditsCost > 1 ? "s" : ""}`
    : "sem custo";

  const meta = [
    result.searchType.toUpperCase(),
    dataHora,
    "Rede ISP colaborativa",
    `${provedoresConsultados} provedor${provedoresConsultados === 1 ? "" : "es"} consultado${provedoresConsultados === 1 ? "" : "s"}`,
    custoLabel,
  ].join(" · ");

  /* ── 02 · Sugestão ── */
  const decisao = result.decisionReco === "Accept"
    ? { short: "Aprovar", tone: "ok" as Tone, Icon: CheckCircle, title: "Aprovar ativação." }
    : result.decisionReco === "Reject"
    ? { short: "Rejeitar", tone: "danger" as Tone, Icon: XCircle, title: "Rejeitar ou exigir caução integral." }
    : { short: "Analisar", tone: "gated" as Tone, Icon: AlertCircle, title: "Analisar manualmente antes de ativar." };

  /* Débito estimado: o TOTAL em risco, não um recorte.
     O seu ERP dá valor exato; parceiros dão faixa (LGPD). Quando os dois
     existem, os limites das faixas são somados ao valor próprio e o resultado
     continua sendo faixa — descartar um dos lados subestimava o risco. Faixa
     que não parseia derruba a soma para o comportamento conservador. */
  const debitoProprio = proprios.reduce((s, d) => s + (d.overdueAmount ?? 0), 0);
  const faixasParceiros = parceiros.map(d => d.overdueAmountRange).filter(Boolean) as string[];
  const parseFaixa = (f: string): [number, number] | null => {
    const nums = f.match(/[\d.,]+/g)?.map(n => parseFloat(n.replace(/\./g, "").replace(",", ".")))
      .filter(n => Number.isFinite(n)) ?? [];
    if (nums.length === 2) return [nums[0], nums[1]];
    if (nums.length === 1) return [nums[0], nums[0]];
    return null;
  };
  const brlCurto = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  let debitoEstimado: string;
  const parsed = faixasParceiros.map(parseFaixa);
  if (faixasParceiros.length > 0 && parsed.every(Boolean)) {
    const min = (parsed as [number, number][]).reduce((s, [a]) => s + a, debitoProprio);
    const max = (parsed as [number, number][]).reduce((s, [, b]) => s + b, debitoProprio);
    debitoEstimado = min === max ? brlCurto(min) : `${brlCurto(min)} – ${brlCurto(max)}`;
  } else if (faixasParceiros.length > 0) {
    debitoEstimado = faixasParceiros[0];
  } else {
    debitoEstimado = debitoProprio > 0 ? brl(debitoProprio) : "R$ 0,00";
  }
  const temDebito = faixasParceiros.length > 0 || debitoProprio > 0;

  /* ── 03 · Ocorrências: seu ERP primeiro, depois cada parceiro ── */
  const rows: OcorrenciaRow[] = [];

  if (proprios.length > 0) {
    for (const d of proprios) {
      const mau = isDelinquent(d);
      rows.push({
        cliente: d.customerName || "— nada consta —",
        sub: d.hasUnreturnedEquipment
          ? `${d.unreturnedEquipmentCount} equipamento${d.unreturnedEquipmentCount > 1 ? "s" : ""} em comodato pendente`
          : undefined,
        fonte: `Seu ERP · ${d.providerName}`,
        // O status do ERP é mais rico que um binário: "Cancelado (débito)" e
        // "Inadimplente (90+ dias)" contam histórias diferentes.
        situacao: d.status || (mau ? "Inadimplente" : "Em dia"),
        situacaoTone: mau ? "past" : "ok",
        atraso: d.daysOverdue > 0 ? `${d.daysOverdue} dias` : "—",
        valor: d.overdueAmount != null && d.overdueAmount > 0 ? brl(d.overdueAmount) : "—",
        valorNegativo: mau,
        custo: "grátis",
      });
    }
  } else {
    rows.push({
      cliente: "— nada consta —",
      fonte: "Seu ERP",
      situacao: "Sem registro",
      situacaoTone: "neutral",
      atraso: "—", valor: "—", valorNegativo: false, custo: "grátis",
    });
  }

  if (parceiros.length > 0) {
    for (const d of parceiros) {
      const mau = isDelinquent(d);
      const local = d.addressCity ? ` · ${d.addressCity}${d.addressState ? "/" + d.addressState : ""}` : "";
      rows.push({
        cliente: d.customerName || "Dados restritos",
        sub: d.hasUnreturnedEquipment
          ? `${d.unreturnedEquipmentCount >= 2 ? "2+" : d.unreturnedEquipmentCount} equipamento${d.unreturnedEquipmentCount > 1 ? "s" : ""} retido${d.unreturnedEquipmentCount > 1 ? "s" : ""}${d.equipmentSignalValidated ? " · ocorrência validada" : ""}`
          : undefined,
        fonte: `${d.providerName}${local}`,
        situacao: d.status || (mau ? "Inadimplente" : "Em dia"),
        situacaoTone: mau ? "past" : "ok",
        atraso: d.daysOverdueRange || (d.daysOverdue > 0 ? `${d.daysOverdue} dias` : "—"),
        valor: d.overdueAmountRange || "—",
        valorNegativo: mau,
        custo: "1 crédito",
      });
    }
  } else {
    rows.push({
      cliente: "— nada consta na rede —",
      fonte: `Rede ISP · ${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"}`,
      situacao: "Sem registro",
      situacaoTone: "neutral",
      atraso: "—", valor: "—", valorNegativo: false, custo: "grátis",
    });
  }

  /* ── 04 · Equipamento ── */
  const equipProprio = proprios.find(d => d.hasUnreturnedEquipment);
  const equipParceiro = parceiros.find(d => d.hasUnreturnedEquipment);
  const equipRows: FonteRow[] = [
    equipProprio
      ? {
          kicker: "Seu provedor", fonte: `Seu ERP · ${equipProprio.providerName}`,
          chip: "Ocorrência ativa", chipTone: "danger",
          nome: `${equipProprio.unreturnedEquipmentCount} equipamento${equipProprio.unreturnedEquipmentCount > 1 ? "s" : ""} não devolvido${equipProprio.unreturnedEquipmentCount > 1 ? "s" : ""}`,
          linha: equipProprio.equipmentValueRange || equipProprio.equipmentPendingSummary || "Comodato pendente no seu ERP",
        }
      : {
          kicker: "Seu provedor", fonte: "Seu ERP",
          chip: "Sem ocorrência", chipTone: "ok",
          nome: "Nenhum equipamento retido",
          linha: "Sem registro de comodato pendente no seu ERP",
        },
    equipParceiro
      ? {
          kicker: "Provedor parceiro", fonte: `Rede ISP · ${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"}`,
          chip: equipParceiro.equipmentSignalValidated ? "Ocorrência validada" : "Sinal não validado",
          chipTone: equipParceiro.equipmentSignalValidated ? "gated" : "neutral",
          nome: `${equipParceiro.unreturnedEquipmentCount >= 2 ? "2+" : equipParceiro.unreturnedEquipmentCount} equipamento${equipParceiro.unreturnedEquipmentCount > 1 ? "s" : ""} retido${equipParceiro.unreturnedEquipmentCount > 1 ? "s" : ""}`,
          linha: [
            equipParceiro.equipmentSignalValidated ? "Ocorrência validada" : "Pendência operacional",
            equipParceiro.equipmentValueRange ? `${equipParceiro.equipmentValueRange} em risco` : null,
          ].filter(Boolean).join(" · "),
        }
      : {
          kicker: "Provedor parceiro", fonte: `Rede ISP · ${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"}`,
          chip: "Sem ocorrência", chipTone: "ok",
          nome: "Nenhum equipamento retido",
          linha: "Sem ocorrência validada no bureau",
        },
  ];

  /* ── 05 · Endereço ── */
  const matchesProprios = result.addressMatches?.filter(m => m.isSameProvider) ?? [];
  const matchesParceiros = result.addressMatches?.filter(m => !m.isSameProvider) ?? [];
  const inadProprios = matchesProprios.filter(m => m.hasDebt).length;
  const inadParceiros = matchesParceiros.filter(m => m.hasDebt).length;
  const cepUsado = result.addressUsed || proprios[0]?.cep || "";
  const cruzou = result.autoAddressCrossRef === true || !!result.addressSearch;

  const addrRows: FonteRow[] = [
    {
      kicker: "Seu provedor", fonte: `Seu ERP${cepUsado ? " · CEP " + fmtCep(cepUsado) : ""}`,
      chip: inadProprios > 0 ? `${inadProprios} inadimplente${inadProprios > 1 ? "s" : ""}` : "Nada consta",
      chipTone: inadProprios > 0 ? "danger" : "ok",
      nome: inadProprios > 0 ? `${inadProprios} inadimplente${inadProprios > 1 ? "s" : ""} no endereço` : "Nada consta",
      linha: inadProprios > 0
        ? "Possível fraude por troca de documento"
        : matchesProprios.length > 0
          ? `${matchesProprios.length} cadastro${matchesProprios.length > 1 ? "s" : ""} ativo${matchesProprios.length > 1 ? "s" : ""} na sua base · em dia`
          : "Nenhum outro cadastro seu neste endereço",
    },
    {
      kicker: "Provedor parceiro", fonte: `Rede ISP${cepUsado ? " · CEP " + fmtCep(cepUsado) : ""}`,
      chip: inadParceiros > 0 ? `${inadParceiros} inadimplente${inadParceiros > 1 ? "s" : ""}` : cruzou ? "Nada consta" : "Indisponível",
      chipTone: inadParceiros > 0 ? "danger" : cruzou ? "ok" : "neutral",
      nome: inadParceiros > 0
        ? `${inadParceiros} inadimplente${inadParceiros > 1 ? "s" : ""} no endereço`
        : cruzou ? "Nada consta" : "Cruzamento não realizado",
      linha: inadParceiros > 0
        ? "Possível fraude por troca de documento"
        : cruzou
          ? `${matchesParceiros.length} cadastro${matchesParceiros.length === 1 ? "" : "s"} em parceiros · nenhum inadimplente`
          : "Faltam CEP e número para cruzar o imóvel na rede",
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
      {/* ═══ CABEÇALHO ═══ */}
      <div style={{
        padding: "20px 24px 18px", display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Kicker>Relatório de crédito ISP</Kicker>
            {protocolo && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                {protocolo}
              </span>
            )}
            <ProvTag kind={provKind} />
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 600,
            fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em",
            marginTop: 6, color: "var(--text)",
          }} data-testid="text-consulted-doc">
            {result.searchType === "cep"
              ? fmtCep(result.cpfCnpj)
              : formatCpfCnpj(result.cpfCnpj)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{meta}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
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

      {/* ═══ 01 · SCORE | 02 · SUGESTÃO ═══ */}
      <div className="ds-score-grid" style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ padding: "20px 24px", borderRight: "1px solid var(--border)" }}>
          <Kicker>01 · Score de crédito</Kicker>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 46, fontWeight: 600,
              lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--text)",
            }} data-testid="score-numero">
              {score}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>/1000</span>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: band.color }} />
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "var(--track-wide)", color: band.color,
            }} data-testid="score-faixa">
              {band.label}
            </span>
          </div>
          <ScoreBar score={score} />
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Kicker>02 · Sugestão de ação</Kicker>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase",
              letterSpacing: "var(--track-wide)", color: "var(--text-faint)", whiteSpace: "nowrap",
            }}>
              A decisão final é sua
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ ...pillStyle(decisao.tone), fontSize: 11, padding: "5px 11px" }} data-testid="text-ai-recommendation">
              <decisao.Icon size={14} />
              {decisao.short}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "var(--track-tight)", color: "var(--text)" }}>
              {decisao.title}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, marginTop: 10, maxWidth: 520 }}>
            {decisionSubtitle(result, ativas, equipamentos)}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            borderTop: "1px solid var(--border-faint)", marginTop: 16, paddingTop: 14, gap: 12,
          }}>
            {[
              { valor: String(result.providersFound || result.providerDetails.length), rotulo: "Provedores com registro", ruim: false, mono18: true },
              { valor: String(ativas), rotulo: "Ocorrências ativas", ruim: ativas > 0, mono18: true },
              { valor: String(equipamentos), rotulo: "Equip. retidos", ruim: equipamentos > 0, mono18: true },
              { valor: debitoEstimado, rotulo: "Débito estimado", ruim: temDebito, mono18: false },
            ].map(sin => (
              <div key={sin.rotulo}>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: sin.mono18 ? 18 : 15, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" as const,
                  paddingTop: sin.mono18 ? 0 : 3,
                  // Contagem ruim em --past (mockup); só o débito, que é
                  // dinheiro, leva --money-neg.
                  color: sin.ruim ? (sin.mono18 ? "var(--past)" : "var(--money-neg)") : "var(--text)",
                }}>
                  {sin.valor}
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase",
                  letterSpacing: "var(--track-wide)", color: "var(--text-muted)", marginTop: 2,
                }}>
                  {sin.rotulo}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ COMPOSIÇÃO DO SCORE ═══
          O handoff manda a composição para a aba Informações. Aqui ela fica:
          um score que decide contrato mostra a conta ao lado do número — foi o
          furo que o motor v2 corrigiu. Sem número de seção de propósito: é um
          anexo do 01, não um passo da leitura. */}
      {(result.composicaoScore || result.fatoresScore) && result.searchType !== "cep" && (
        <ReportSection>
          <ScoreBreakdownPanel
            composicao={result.composicaoScore}
            fatores={result.fatoresScore}
            score={result.score}
          />
        </ReportSection>
      )}

      {/* ═══ 03 · OCORRÊNCIAS NA REDE ISP ═══ */}
      {result.searchType !== "cep" && (
        <ReportSection
          title="03 · Ocorrências na rede ISP"
          trailing={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-faint)" }}>
              <Lock size={10} />
              <span style={{ fontSize: 10 }}>Terceiros anonimizados · valores em faixa (LGPD)</span>
            </div>
          }
          style={{ paddingBottom: 6 }}
        >
          {/* Seis colunas não cabem num celular: a tabela rola dentro do
              próprio contêiner — a página nunca rola na horizontal. */}
          <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
          <div style={{
            display: "grid", gridTemplateColumns: GRID_OCORRENCIAS, gap: 10,
            padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
          }}>
            <Th>Cliente</Th><Th>Fonte</Th><Th>Situação</Th><Th>Atraso</Th>
            <Th right>Em aberto</Th><Th right>Custo</Th>
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: GRID_OCORRENCIAS, gap: 10,
              alignItems: "center", padding: "11px 0",
              borderBottom: "1px solid var(--border-faint)",
            }} data-testid={`ocorrencia-row-${i}`}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)",
                }}>
                  {row.cliente}
                </div>
                {row.sub && (
                  <div style={{ fontSize: 11, color: "var(--gated)", marginTop: 2 }}>{row.sub}</div>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.fonte}</div>
              <div><span style={pillStyle(row.situacaoTone)}>{row.situacao}</span></div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 12,
                fontVariantNumeric: "tabular-nums", color: "var(--text-2)",
              }}>
                {row.atraso}
              </div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                fontVariantNumeric: "tabular-nums", textAlign: "right",
                color: row.valorNegativo ? "var(--money-neg)" : "var(--text-2)",
              }}>
                {row.valor}
              </div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
                letterSpacing: "var(--track-wide)", color: "var(--text-muted)", textAlign: "right",
              }}>
                {row.custo}
              </div>
            </div>
          ))}
          </div>
          </div>
          <div style={{ height: 12 }} />
        </ReportSection>
      )}

      {/* ═══ 04 · EQUIPAMENTO EM COMODATO ═══ */}
      {result.searchType !== "cep" && (
        <ReportSection
          title="04 · Equipamento em comodato"
          trailing={
            <span style={pillStyle(equipamentos > 0
              ? (equipParceiro?.equipmentSignalValidated ? "gated" : "danger")
              : "ok")}>
              {equipamentos === 0 ? "Sem ocorrência"
                : equipParceiro?.equipmentSignalValidated ? "Ocorrência validada" : "Ocorrência registrada"}
            </span>
          }
        >
          <div style={{
            display: "grid", gridTemplateColumns: GRID_FONTE, gap: 10,
            padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
          }}>
            <Th>Fonte</Th><Th>Situação</Th><Th>Registro</Th>
          </div>
          {equipRows.map((c, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: GRID_FONTE, gap: 10,
              alignItems: "center", padding: "11px 0",
              borderBottom: "1px solid var(--border-faint)",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.kicker}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{c.fonte}</div>
              </div>
              <div><span style={pillStyle(c.chipTone)}>{c.chip}</span></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.nome}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{c.linha}</div>
              </div>
            </div>
          ))}
        </ReportSection>
      )}

      {/* ═══ 05 · VERIFICAÇÃO POR ENDEREÇO ═══ */}
      <ReportSection
        title="05 · Verificação por endereço"
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
        <div style={{
          display: "grid", gridTemplateColumns: GRID_FONTE, gap: 10,
          padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
        }}>
          <Th>Fonte</Th><Th>Situação</Th><Th>Cadastros no endereço</Th>
        </div>
        {addrRows.map((c, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: GRID_FONTE, gap: 10,
            alignItems: "center", padding: "11px 0",
            borderBottom: "1px solid var(--border-faint)",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.kicker}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{c.fonte}</div>
            </div>
            <div><span style={pillStyle(c.chipTone)}>{c.chip}</span></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.nome}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{c.linha}</div>
            </div>
          </div>
        ))}

        {/* Inadimplência de OUTROS documentos no mesmo imóvel — sinal de troca de CPF. */}
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
                {proprios[0]?.addressCity
                  ? ` · ${proprios[0].addressCity}${proprios[0].addressState ? "/" + proprios[0].addressState : ""}`
                  : ""}
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

      {/* ═══ 06 · ALERTAS | 07 · AÇÕES RECOMENDADAS ═══ */}
      {((result.alerts?.length ?? 0) > 0 || (result.recommendedActions?.length ?? 0) > 0) && (
        <div className="ds-duo" style={{
          borderTop: "1px solid var(--border)", padding: "18px 24px",
          marginTop: 0, gap: 28,
        }}>
          <div>
            <Kicker>06 · Alertas</Kicker>
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
            <Kicker>07 · Ações recomendadas</Kicker>
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

      {/* ═══ PARECER DO AGENTE ═══ */}
      {result.searchType !== "cep" && <AiAnalysisSection result={result} />}

      {/* ═══ RODAPÉ DE AUDITORIA ═══ */}
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
