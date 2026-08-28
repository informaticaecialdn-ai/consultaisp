import { Lock, AlertTriangle, CornerDownRight, Download, Save, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import AddressMapMini from "@/components/consulta/AddressMapMini";
import AiAnalysisSection from "./AiAnalysisSection";
import AddressRiskAlert from "./AddressRiskAlert";
import type { ConsultaResult, ProviderDetail } from "./types";
import { formatCpfCnpj } from "./utils";
import {
  derivarRelatorio, isDelinquent, brl, fmtCep, situacaoCurta,
} from "./relatorio-dados";
import {
  Kicker, pillStyle, ReportSection, ScoreBar, ProvTag, Th,
  bandOf, ReportButton, type Tone,
} from "./report-ui";

interface Props {
  result: ConsultaResult;
  /** Registro gravado da consulta — origem do protocolo e do hash de auditoria. */
  consultation?: { id?: number; cpfCnpjHash?: string; createdAt?: string } | null;
  onShowDetail: (idx: number) => void;
  onSave: () => void;
  onGeneratePDF: () => void;
}

/* ── Leitura dos dados ──────────────────────────────────────── */

/* Linha da tabela de ocorrências (03). */
interface OcorrenciaRow {
  cliente: string;
  sub?: string;
  fonte: string;
  situacao: string;
  situacaoTom: Tone;
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
  chipTom: Tone;
  nome: string;
  linha: string;
}

const GRID_OCORRENCIAS = "minmax(110px, 1.5fr) minmax(110px, 1.3fr) 120px 90px minmax(120px, 150px) 70px";
const GRID_FONTE = "minmax(140px, 1.2fr) 170px 2fr";

/* ════════════════════════════════════════════════════════════
   RELATÓRIO DE CRÉDITO v2 — um card, seções numeradas por hairline.
   ════════════════════════════════════════════════════════════ */
export default function ConsultaResultSummary({
  result, consultation, onSave, onGeneratePDF,
}: Props) {
  // Todas as contas vêm de relatorio-dados.ts — o MESMO módulo que o PDF usa.
  // Estavam aqui dentro, e o gerador de PDF tinha a sua própria cópia: o papel
  // saía dizendo outra coisa que a tela. Aqui fica só o desenho.
  const d = derivarRelatorio(result);
  const {
    score, proprios, parceiros, ativas, equipamentos,
    provedoresConsultados, parceirosConsultados,
    ocorrencias: rows, equipamentoLinhas: equipRows, enderecoLinhas: addrRows,
    cepUsado,
  } = d;
  const band = bandOf(score);
  const debitoEstimado = d.debito.texto;
  const temDebito = d.debito.temDebito;
  const subtitulo = d.subtitulo;

  // O pill da secao 04 depende do parceiro com equipamento — mesmo criterio
  // usado pelo modulo para montar a linha.
  const equipParceiro = parceiros.find(x => x.hasUnreturnedEquipment);

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

  /* 02 · Sugestão — o ícone é assunto da tela; o texto vem do módulo. */
  const ICONE = { Aprovar: CheckCircle, Rejeitar: XCircle, Analisar: AlertCircle } as const;
  const decisao = {
    short: d.decisao.curto,
    tone: d.decisao.tom as Tone,
    Icon: ICONE[d.decisao.curto as keyof typeof ICONE] ?? AlertCircle,
    title: d.decisao.titulo,
  };

  const linhasEndereco = (result.addressMatches ?? []).filter(m => m.hasDebt);
  const temMapa = !!(cepUsado || proprios[0]?.address || proprios[0]?.latitude);

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}
      className="ds-report-card"
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
          {/* "Nova consulta" saiu daqui: a aba de mesmo nome, no topo, ja faz
              isso — dois caminhos para a mesma acao a dois centimetros um do
              outro. O que sobra e o que so existe aqui: levar o relatorio
              embora (PDF) e guarda-lo (Salvar). */}
          <ReportButton onClick={onSave} testId="button-save-consulta">
            <Save size={14} /> Salvar
          </ReportButton>
        </div>
      </div>

      {/* ═══ 01 · SCORE | 02 · SUGESTÃO ═══ */}
      <div className="ds-score-grid" style={{ borderTop: "1px solid var(--border)" }}>
        {/* A hairline entre as colunas e do CSS (.ds-score-grid), nao inline:
            inline venceria a regra que a remove quando o card empilha. */}
        <div style={{ padding: "20px 24px" }}>
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
            {subtitulo}
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

      {/* ═══ 03 · OCORRÊNCIAS NA REDE ISP ═══
          A composição do score (extrato de deduções) NÃO aparece aqui, por
          decisão do dono do produto: o relatório entrega o número e a decisão;
          o MÉTODO do cálculo vive documentado na aba Informações. */}
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
              <div><span style={pillStyle(row.situacaoTom)}>{row.situacao}</span></div>
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
              <div><span style={pillStyle(c.chipTom)}>{c.chip}</span></div>
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
            <div><span style={pillStyle(c.chipTom)}>{c.chip}</span></div>
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
