import {
  Download, Save, CheckCircle, AlertCircle, XCircle, HelpCircle, Lock, Building2,
} from "lucide-react";
import {
  Kicker, pillStyle, ReportSection, ScoreBar, Th, bandOf, ReportButton, type Tone,
} from "./report-ui";
import type { ResultadoCadastral, SocioEmpresa } from "./cadastral-tipos";
import {
  fmtDoc, fmtData, fmtBrl, fmtTelefone, enderecoEmLinha,
  decisaoCadastral, sinaisCadastrais, LEGENDA_CAPACIDADE, faixaCapacidade,
} from "./cadastral-dados";

/**
 * RELATÓRIO CADASTRAL — mesmo desenho do relatório de crédito ISP.
 *
 * Um card só, seções numeradas separadas por hairline, primitivas de
 * `report-ui`. A consulta cadastral tinha uma linguagem visual própria — seis
 * cards soltos, pílulas arredondadas, arco de score — e o operador alternava
 * entre as duas telas no mesmo minuto. Duas gramáticas para a mesma tarefa é o
 * tipo de coisa que faz um produto parecer dois.
 *
 * Atende CPF e CNPJ. As seções de pessoa (capacidade, domicílio, rastro) e as
 * de empresa (quadro societário, atividade) são exclusivas; o resto é comum.
 */

interface Props {
  r: ResultadoCadastral;
  onSave?: () => void;
  onGeneratePDF?: () => void;
}

const ICONE = {
  APROVAR: CheckCircle, RECUSAR: XCircle, ATENCAO: AlertCircle, NAO_ENCONTRADO: HelpCircle,
} as const;

const GRID_PROCESSOS = "88px minmax(120px,1.4fr) minmax(90px,1fr) 110px 100px";
const GRID_SOCIOS = "minmax(150px,2fr) minmax(120px,1.3fr) 96px 92px";

export default function CadastralResultReport({ r, onSave, onGeneratePDF }: Props) {
  const ehEmpresa = r.tipoDocumento === "cnpj";
  const d = decisaoCadastral(r);
  const Icon = ICONE[r.veredito];
  const sinais = sinaisCadastrais(r);

  const dt = r.createdAt ? new Date(r.createdAt) : new Date();
  const protocolo = r.id
    ? `#CC-${dt.getFullYear()}-${String(r.id).padStart(5, "0")}`
    : null;

  const meta = [
    ehEmpresa ? "CNPJ" : "CPF",
    dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    "Base cadastral nacional",
    `${r.creditosCobrados ?? 1} crédito${(r.creditosCobrados ?? 1) > 1 ? "s" : ""}`,
    `${r.latenciaMs} ms`,
  ].join(" · ");

  /* A capacidade financeira é score 0-1000 da BigData — mesma régua da
     ScoreBar. Só existe para pessoa física. */
  const score = ehEmpresa ? null : r.risco?.score ?? null;
  const band = score != null ? bandOf(score) : null;

  const socios = r.empresa?.socios ?? [];
  const sociosAtuais = socios.filter(s => s.atual);
  const processos = r.processos ?? [];

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}
      className="ds-report-card"
      data-testid="cadastral-result"
    >
      {/* ═══ CABEÇALHO ═══ */}
      <div style={{
        padding: "20px 24px 18px", display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Kicker>{ehEmpresa ? "Relatório cadastral · empresa" : "Relatório cadastral"}</Kicker>
            {protocolo && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                {protocolo}
              </span>
            )}
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 600,
            fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em",
            marginTop: 6, color: "var(--text)",
          }} data-testid="text-consulted-doc">
            {fmtDoc(r.cpfCnpj)}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, fontWeight: 500 }}>
            {ehEmpresa
              ? (r.empresa?.razaoSocial ?? "Razão social não informada")
              : (r.identidade?.nome ?? "Nome não informado")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{meta}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {onGeneratePDF && (
            <ReportButton onClick={onGeneratePDF} testId="button-cadastral-pdf">
              <Download size={14} /> PDF
            </ReportButton>
          )}
          {onSave && (
            <ReportButton onClick={onSave} testId="button-cadastral-save">
              <Save size={14} /> Salvar
            </ReportButton>
          )}
        </div>
      </div>

      {/* ═══ 01 · CAPACIDADE | 02 · VEREDITO ═══ */}
      <div className="ds-score-grid" style={{ borderTop: "1px solid var(--border)" }}>
        {/* A hairline entre as colunas e do CSS (.ds-score-grid), nao inline:
            inline venceria a regra que a remove quando o card empilha. */}
        <div style={{ padding: "20px 24px" }}>
          {/* NÃO se chama "score de risco", e a diferença não é cosmética: o
              CPF com R$ 10.103 em aberto no provedor tirou 1000 aqui. A régua
              da BigData mede vínculo formal e crédito de mercado — dívida de
              ISP não entra em bureau nenhum. Chamar isso de risco faria a tela
              recomendar exatamente quem a rede já sabe que não paga. */}
          <Kicker>01 · {ehEmpresa ? "Situação na Receita" : "Capacidade financeira"}</Kicker>

          {ehEmpresa ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <span style={pillStyle(
                  r.empresa?.situacao?.toUpperCase() === "ATIVA" ? "ok" : "danger",
                )}>
                  {r.empresa?.situacao ?? "desconhecida"}
                </span>
                {r.empresa?.situacaoEspecial && (
                  <span style={pillStyle("danger")}>{r.empresa.situacaoEspecial}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 16 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 42, fontWeight: 600,
                  lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--text)",
                }}>
                  {r.empresa?.idadeAnos ?? "—"}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" }}>
                  {r.empresa?.idadeAnos === 1 ? "ano de atividade" : "anos de atividade"}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
                Aberta em {fmtData(r.empresa?.aberturaEm)}
                {r.empresa?.porte ? ` · porte ${r.empresa.porte}` : ""}
                {r.empresa?.regime ? ` · ${r.empresa.regime}` : ""}
                {r.empresa?.optanteSimples ? " · optante pelo Simples" : ""}
              </div>
            </>
          ) : score != null && band ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 46, fontWeight: 600,
                  lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--text)",
                }} data-testid="cadastral-score">
                  {score}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>/1000</span>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: band.color }} />
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "var(--track-wide)", color: band.color,
                }}>
                  {faixaCapacidade(score)}
                </span>
              </div>
              <ScoreBar score={score} />
              <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 14 }}>
                {LEGENDA_CAPACIDADE}
              </p>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 14, lineHeight: 1.55 }}>
              Sem vínculo formal ou histórico de crédito suficiente para estimar
              capacidade. Ausência de rastro não é indício de inadimplência.
            </p>
          )}
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: "4px 10px", flexWrap: "wrap",
          }}>
            <Kicker>02 · Sugestão de ação</Kicker>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase",
              letterSpacing: "var(--track-wide)", color: "var(--text-faint)",
            }}>
              A decisão final é sua
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ ...pillStyle(d.tom), fontSize: 11, padding: "5px 11px" }} data-testid="cadastral-veredito">
              <Icon size={14} />
              {d.curto}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "var(--track-tight)", color: "var(--text)" }}>
              {d.titulo}
            </span>
          </div>

          {r.motivos.length > 0 && (
            <ul style={{
              listStyle: "none", padding: 0, margin: "12px 0 0",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              {r.motivos.map((m, i) => (
                <li key={i} style={{
                  fontSize: 13, color: "var(--text-2)", lineHeight: 1.5,
                  paddingLeft: 13, position: "relative",
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 8, width: 4, height: 4,
                    borderRadius: 999, background: d.tom === "ok" ? "var(--ok)" : "var(--gated)",
                  }} />
                  {m}
                </li>
              ))}
            </ul>
          )}

          <div style={{ flex: 1 }} />
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
            borderTop: "1px solid var(--border-faint)", marginTop: 16, paddingTop: 14, gap: "14px 12px",
          }}>
            {sinais.map(s => (
              <div key={s.rotulo}>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: s.grande ? 18 : 15, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere",
                  paddingTop: s.grande ? 0 : 3,
                  color: s.ruim ? (s.grande ? "var(--past)" : "var(--money-neg)") : "var(--text)",
                }}>
                  {s.valor}
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase",
                  letterSpacing: "var(--track-wide)", color: "var(--text-muted)", marginTop: 2,
                }}>
                  {s.rotulo}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ 03 · IDENTIFICAÇÃO ═══ */}
      <ReportSection title={ehEmpresa ? "03 · A empresa" : "03 · Identificação"}>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "14px 24px", marginTop: 14,
        }}>
          {(ehEmpresa
            ? [
                ["Nome fantasia", r.empresa?.nomeFantasia ?? "—"],
                ["Natureza jurídica", r.empresa?.naturezaJuridica ?? "—"],
                ["Atividade principal", r.empresa?.atividadePrincipal ?? "—"],
                ["Matriz ou filial", r.empresa?.matriz == null ? "—" : r.empresa.matriz ? `Matriz · ${r.empresa.ufMatriz ?? ""}`.trim() : "Filial"],
              ]
            : [
                ["Nascimento", r.identidade?.nascimento ? `${fmtData(r.identidade.nascimento)}${r.identidade.idade ? ` · ${r.identidade.idade} anos` : ""}` : "—"],
                ["Nome da mãe", r.identidade?.nomeMae ?? "—"],
                ["Situação na Receita", r.dados?.taxIdStatus ?? "—"],
                ["Homônimos no país", r.dados?.homonimos != null ? String(r.dados.homonimos) : "—"],
              ]
          ).map(([rot, val]) => (
            <div key={rot as string}>
              <Kicker style={{ marginBottom: 4 }}>{rot}</Kicker>
              <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.45 }}>{val}</div>
            </div>
          ))}
        </div>

        {ehEmpresa && (r.empresa?.atividadesSecundarias?.length ?? 0) > 0 && (
          <div style={{ marginTop: 16 }}>
            <Kicker style={{ marginBottom: 7 }}>Atividades secundárias</Kicker>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.empresa!.atividadesSecundarias.map((a, i) => (
                <span key={i} style={pillStyle("neutral")}>{a}</span>
              ))}
            </div>
          </div>
        )}
      </ReportSection>

      {/* ═══ 04 · QUADRO SOCIETÁRIO (CNPJ) ═══ */}
      {ehEmpresa && socios.length > 0 && (
        <ReportSection
          title="04 · Quadro societário"
          trailing={
            <span style={pillStyle(sociosAtuais.length > 0 ? "neutral" : "gated")}>
              {sociosAtuais.length} atual{sociosAtuais.length === 1 ? "" : "is"} de {socios.length}
            </span>
          }
        >
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 520 }}>
              <div style={{
                display: "grid", gridTemplateColumns: GRID_SOCIOS, gap: 10,
                padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
              }}>
                <Th>Sócio</Th><Th>Cargo</Th><Th>Desde</Th><Th>Situação</Th>
              </div>
              {socios.map((s: SocioEmpresa, i: number) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: GRID_SOCIOS, gap: 10,
                  alignItems: "center", padding: "11px 0",
                  borderBottom: "1px solid var(--border-faint)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: 0 }}>
                    {s.nome}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.cargo ?? s.vinculo ?? "—"}</div>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 12,
                    fontVariantNumeric: "tabular-nums", color: "var(--text-2)",
                  }}>
                    {fmtData(s.desde)}
                  </div>
                  <div>
                    <span style={pillStyle(s.atual ? "ok" : "neutral")}>
                      {s.atual ? "no quadro" : "saiu"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ReportSection>
      )}

      {/* ═══ 04 · CAPACIDADE DE PAGAR (CPF) ═══ */}
      {!ehEmpresa && r.capacidade && (
        <ReportSection
          title="04 · O que sobra para a mensalidade"
          trailing={<Kicker>Faixas estatísticas · não é comprovação de renda</Kicker>}
        >
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "14px 24px", marginTop: 14,
          }}>
            {[
              ["Sobra por mês", r.capacidade.sobraMensal ?? "sem informação"],
              ["Despesa da casa", r.capacidade.despesaMensal ?? "sem informação"],
              ["Renda da casa", r.capacidade.rendaFamiliar ?? r.capacidade.rendaMediaFamiliar ?? "sem informação"],
              ["Pessoas na casa", r.capacidade.pessoasNaCasa > 0 ? String(r.capacidade.pessoasNaCasa) : "sem informação"],
              ["Dependentes", String(r.capacidade.dependentes)],
              ["Origem da renda", r.capacidade.origemRenda ?? "sem informação"],
            ].map(([rot, val]) => (
              <div key={rot}>
                <Kicker style={{ marginBottom: 4 }}>{rot}</Kicker>
                <div style={{
                  fontSize: 13.5, color: "var(--text)", lineHeight: 1.45,
                  fontFamily: /^\d+$/.test(String(val)) ? "var(--font-mono)" : undefined,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {val}
                </div>
              </div>
            ))}
          </div>

          {/* Benefício social em REAIS, não em faixa: a faixa
              (AssistanceIncomePercentageRange) vem "SEM INFORMACAO" sempre. O
              histórico de valores é o que a API preenche de verdade. */}
          {(r.capacidade.recebeBeneficio || r.capacidade.beneficioUltimos12m > 0) && (
            <div style={{
              marginTop: 16, padding: "12px 14px", borderRadius: 8,
              background: "var(--surface-2)", border: "1px solid var(--border)",
              display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 18px",
            }}>
              <span style={pillStyle(r.capacidade.recebeBeneficio ? "info" : "neutral")}>
                {r.capacidade.recebeBeneficio
                  ? `${r.capacidade.beneficiariosNaFamilia} recebendo hoje`
                  : "não recebe hoje"}
              </span>
              {r.capacidade.beneficioUltimos3m > 0 && (
                <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                  {fmtBrl(r.capacidade.beneficioUltimos3m)} nos últimos 3 meses
                </span>
              )}
              {r.capacidade.beneficioUltimos12m > 0 && (
                <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                  {fmtBrl(r.capacidade.beneficioUltimos12m)} em 12 meses
                </span>
              )}
              {r.capacidade.beneficiariosHistoricos > 0 && !r.capacidade.recebeBeneficio && (
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {r.capacidade.beneficiariosHistoricos} já recebeu em algum momento
                </span>
              )}
            </div>
          )}
        </ReportSection>
      )}

      {/* ═══ 05 · INADIMPLÊNCIA E JUDICIAL ═══ */}
      <ReportSection
        title="05 · Cobrança e judicial"
        trailing={
          r.inadimplencia.emCobrancaAgora
            ? <span style={pillStyle("past")}>em cobrança agora</span>
            : <span style={pillStyle("ok")}>sem cobrança ativa</span>
        }
      >
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "14px 24px", marginTop: 14,
        }}>
          {[
            { rot: "Cobranças em 12 meses", val: String(r.inadimplencia.cobrancas365d), ruim: r.inadimplencia.cobrancas365d > 0 },
            { rot: "Credores distintos", val: String(r.inadimplencia.credores365d), ruim: r.inadimplencia.credores365d > 1 },
            { rot: "Processos como réu", val: String(r.inadimplencia.processosComoReu), ruim: r.inadimplencia.processosComoReu > 0 },
            { rot: "Dívida ativa da União", val: fmtBrl(r.inadimplencia.dividaAtiva), ruim: r.inadimplencia.dividaAtiva > 0 },
          ].map(s => (
            <div key={s.rot}>
              <Kicker style={{ marginBottom: 4 }}>{s.rot}</Kicker>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: s.ruim ? "var(--money-neg)" : "var(--text)",
              }}>
                {s.val}
              </div>
            </div>
          ))}
        </div>

        {r.inadimplencia.temExecucao && (
          <div style={{
            marginTop: 14, padding: "10px 13px", borderRadius: 8,
            background: "var(--past-bg)", border: "1px solid var(--past-border)",
            fontSize: 13, color: "var(--past)", lineHeight: 1.5,
          }}>
            Execução judicial de dívida no histórico — inclui cumprimento de
            sentença e execução de título extrajudicial.
          </div>
        )}

        {processos.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <div style={{ minWidth: 560 }}>
              <div style={{
                display: "grid", gridTemplateColumns: GRID_PROCESSOS, gap: 10,
                padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
              }}>
                <Th>Data</Th><Th>Assunto</Th><Th>Tribunal</Th><Th>Papel</Th><Th right>Valor</Th>
              </div>
              {processos.slice(0, 12).map((p, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: GRID_PROCESSOS, gap: 10,
                  alignItems: "center", padding: "11px 0",
                  borderBottom: "1px solid var(--border-faint)",
                }}>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 12,
                    fontVariantNumeric: "tabular-nums", color: "var(--text-2)",
                  }}>
                    {fmtData(p.data)}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text)", minWidth: 0 }}>
                    {p.assunto ?? p.tipo ?? "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {[p.tribunal, p.uf].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div>
                    <span style={pillStyle(p.papel === "réu" ? "gated" : "neutral")}>{p.papel}</span>
                  </div>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600,
                    fontVariantNumeric: "tabular-nums", textAlign: "right",
                    color: p.valor ? "var(--money-neg)" : "var(--text-muted)",
                  }}>
                    {p.valor ? fmtBrl(p.valor) : "—"}
                  </div>
                </div>
              ))}
              {processos.length > 12 && (
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", paddingTop: 10 }}>
                  Mais {processos.length - 12} processo(s) não listados.
                </div>
              )}
            </div>
          </div>
        )}
      </ReportSection>

      {/* ═══ 06 · ENDEREÇOS ═══ */}
      {r.enderecos.length > 0 && (
        <ReportSection
          title="06 · Endereços"
          trailing={<span style={pillStyle("neutral")}>{r.enderecos.length} encontrado{r.enderecos.length === 1 ? "" : "s"}</span>}
        >
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {r.enderecos.slice(0, 6).map((e, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                gap: 12, padding: "11px 0", borderBottom: "1px solid var(--border-faint)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.45 }}>
                    {enderecoEmLinha(e)}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                    {[
                      e.cep ? `CEP ${e.cep}` : null,
                      e.ultimaPassagem ? `visto em ${fmtData(e.ultimaPassagem)}` : null,
                      e.passagensRuins > 0 ? `${e.passagensRuins} passagem(ns) ruim(ns)` : null,
                    ].filter(Boolean).join(" · ") || "sem histórico de passagem"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {e.naReceita && <span style={pillStyle("ok")}>na Receita</span>}
                  {e.ratificado && <span style={pillStyle("info")}>ratificado</span>}
                  {e.principal && <span style={pillStyle("neutral")}>principal</span>}
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {/* ═══ 07 · CONTATO ═══ */}
      {(r.telefones.length > 0 || r.emails.length > 0) && (
        <ReportSection title="07 · Contato">
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20, marginTop: 12,
          }}>
            <div>
              <Kicker style={{ marginBottom: 8 }}>Telefones · {r.telefones.length}</Kicker>
              {r.telefones.length === 0
                ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>nenhum</div>
                : r.telefones.slice(0, 6).map((t, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-faint)",
                    }}>
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: 13,
                        fontVariantNumeric: "tabular-nums", color: "var(--text)",
                      }}>
                        {fmtTelefone(t)}
                      </span>
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {t.operadora && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.operadora}</span>
                        )}
                        {t.naoPerturbe && <span style={pillStyle("gated")}>não perturbe</span>}
                      </span>
                    </div>
                  ))}
            </div>
            <div>
              <Kicker style={{ marginBottom: 8 }}>E-mails · {r.emails.length}</Kicker>
              {r.emails.length === 0
                ? <div style={{ fontSize: 13, color: "var(--text-muted)" }}>nenhum</div>
                : r.emails.slice(0, 6).map((e, i) => (
                    <div key={i} style={{
                      fontSize: 12.5, color: "var(--text-2)", padding: "7px 0",
                      borderBottom: "1px solid var(--border-faint)",
                      overflowWrap: "anywhere",
                    }}>
                      {e}
                    </div>
                  ))}
            </div>
          </div>
        </ReportSection>
      )}

      {/* ═══ 08 · DOMICÍLIO E REDE (CPF) ═══ */}
      {!ehEmpresa && r.domicilio && r.domicilio.totalRelacionados > 0 && (
        <ReportSection
          title="08 · Domicílio e rede próxima"
          trailing={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-faint)" }}>
              <Lock size={10} />
              <span style={{ fontSize: 10 }}>
                {r.domicilio.nomesLiberados
                  ? "Nomes abertos por ocorrência no domicílio (LGPD)"
                  : "Contagem apenas · nomes só com ocorrência (LGPD)"}
              </span>
            </div>
          }
        >
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "14px 20px", marginTop: 14,
          }}>
            {[
              ["Pessoas na casa", r.domicilio.noDomicilio],
              ["Parentes", r.domicilio.parentes],
              ["Cônjuges", r.domicilio.conjuges],
              ["Sócios", r.domicilio.socios],
              ["Colegas de trabalho", r.domicilio.colegasTrabalho],
            ].map(([rot, val]) => (
              <div key={rot as string}>
                <Kicker style={{ marginBottom: 4 }}>{rot}</Kicker>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", color: "var(--text)",
                }}>
                  {val}
                </div>
              </div>
            ))}
          </div>

          {r.riscoFamiliar && r.riscoFamiliar.emCobranca > 0 && (
            <div style={{
              marginTop: 14, padding: "10px 13px", borderRadius: 8,
              background: "var(--gated-bg)", border: "1px solid var(--gated-border)",
              fontSize: 13, color: "var(--gated)", lineHeight: 1.5,
            }}>
              {r.riscoFamiliar.emCobranca} pessoa(s) do domicílio em cobrança —
              é o que libera os nomes abaixo.
            </div>
          )}

          {r.domicilio.nomesLiberados && r.domicilio.nomes.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
              {r.domicilio.nomes.map((n, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-faint)",
                }}>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{n.nome}</span>
                  <span style={pillStyle("neutral")}>{n.vinculo}</span>
                </div>
              ))}
            </div>
          )}
        </ReportSection>
      )}

      {/* ═══ 09 · RASTRO NO MERCADO (CPF) ═══ */}
      {!ehEmpresa && (
        <ReportSection
          title="09 · Rastro no mercado"
          trailing={<Kicker>Intensidade de A (alta) a H (sem rastro)</Kicker>}
        >
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "14px 24px", marginTop: 14,
          }}>
            {[
              { rot: "Consultas em 30 dias", val: String(r.rastro.consultas30d), ruim: r.rastro.consultas30d > 10 },
              { rot: "Busca por crédito", val: r.rastro.buscaCredito ?? "—", ruim: ["A", "B"].includes((r.rastro.buscaCredito ?? "").toUpperCase()) },
              { rot: "Uso de cartão", val: r.rastro.usoCartao ?? "—", ruim: false },
              { rot: "Trocas de emprego (10a)", val: String(r.ocupacao?.trocas10Anos ?? 0), ruim: (r.ocupacao?.trocas10Anos ?? 0) > 5 },
            ].map(s => (
              <div key={s.rot}>
                <Kicker style={{ marginBottom: 4 }}>{s.rot}</Kicker>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: s.ruim ? "var(--past)" : "var(--text)",
                }}>
                  {s.val}
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      )}

      {/* ═══ RODAPÉ ═══ */}
      <ReportSection style={{ paddingTop: 14, paddingBottom: 16 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-faint)" }}>
            {ehEmpresa && <Building2 size={11} />}
            <span style={{ fontSize: 10.5 }}>
              Legítimo interesse · LGPD Art. 7º, IX · Análise de risco para contratação
            </span>
          </div>
          {r.consultasComFalha > 0 && (
            <span style={pillStyle("gated")}>
              {r.consultasComFalha} fonte(s) sem resposta
            </span>
          )}
        </div>
      </ReportSection>
    </div>
  );
}
