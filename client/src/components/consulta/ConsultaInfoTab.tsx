import { Kicker, pillStyle } from "./report-ui";

/**
 * Aba Informações — a documentação do método.
 *
 * O relatório entrega o número e a decisão; POR QUE o número é o que é vive
 * aqui, com os valores reais do motor (server/utils/isp-score.ts). Se o motor
 * mudar, esta tabela muda junto — documentar valor errado é pior que não
 * documentar.
 */

const CARD: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 10, padding: "18px 20px",
};

function LinhaValor({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 10,
      padding: "6px 0", borderBottom: "1px solid var(--border-faint)",
    }}>
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{rotulo}</span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        color: cor ?? "var(--text)",
      }}>
        {valor}
      </span>
    </div>
  );
}

/* Valores espelhados de server/utils/isp-score.ts — manter em sincronia. */

const DEDUCOES_TEMPO = [
  { rotulo: "Atraso ativo até 30 dias", valor: "−80" },
  { rotulo: "Atraso acima de 30 dias", valor: "−140" },
  { rotulo: "Atraso acima de 90 dias", valor: "−200" },
  { rotulo: "Atraso acima de 180 dias", valor: "−240" },
  { rotulo: "Atraso acima de 365 dias", valor: "−280" },
];

const DEDUCOES_VALOR = [
  { rotulo: "Dívida até R$ 200", valor: "−30" },
  { rotulo: "Acima de R$ 200", valor: "−60" },
  { rotulo: "Acima de R$ 500", valor: "−90" },
  { rotulo: "Acima de R$ 1.000", valor: "−120" },
  { rotulo: "Acima de R$ 2.000", valor: "−160" },
  { rotulo: "Acima de R$ 5.000", valor: "−200" },
  { rotulo: "Atraso sem valor informado", valor: "−40" },
];

const DEDUCOES_OUTRAS = [
  { rotulo: "3 faturas em atraso", valor: "−20" },
  { rotulo: "5 faturas em atraso", valor: "−30" },
  { rotulo: "7 ou mais faturas", valor: "−40" },
  { rotulo: "Cada credor extra na rede", valor: "−60 · máx −120" },
  { rotulo: "Atraso passado, hoje em dia", valor: "−30" },
  { rotulo: "Equipamento não devolvido", valor: "−150 · máx −250" },
  { rotulo: "1 inadimplente no endereço", valor: "−40" },
  { rotulo: "2 inadimplentes no endereço", valor: "−100" },
  { rotulo: "3+ CPFs inadimplentes no imóvel", valor: "−250" },
  { rotulo: "3+ consultas em 30 dias", valor: "−60" },
  { rotulo: "5+ consultas em 30 dias", valor: "−120" },
  { rotulo: "8+ consultas em 90 dias", valor: "−30" },
  { rotulo: "12+ consultas em 90 dias", valor: "−60" },
];

const BONUS = [
  { rotulo: "Cliente há mais de 6 meses", valor: "+30" },
  { rotulo: "Mais de 1 ano", valor: "+60" },
  { rotulo: "Mais de 2 anos", valor: "+100" },
  { rotulo: "Mais de 3 anos", valor: "+150" },
  { rotulo: "Mais de 5 anos", valor: "+200" },
  { rotulo: "Nunca atrasou", valor: "+60" },
  { rotulo: "Equipamentos sempre devolvidos", valor: "+40" },
];

const TETOS = [
  { rotulo: "Dívida ativa ≥ R$ 300 ou > 60 dias", valor: "máx 300" },
  { rotulo: "Qualquer dívida ativa", valor: "máx 450" },
  { rotulo: "Equipamento retido na rede", valor: "máx 400" },
  { rotulo: "3+ inadimplentes no imóvel", valor: "máx 300" },
];

const FAIXAS: Array<{ faixa: string; rotulo: string; leitura: string; cor: string }> = [
  { faixa: "851–1000", rotulo: "Excelente", leitura: "Aprovar", cor: "var(--ok)" },
  { faixa: "701–850", rotulo: "Bom", leitura: "Aprovar", cor: "var(--now)" },
  { faixa: "501–700", rotulo: "Risco médio", leitura: "Aprovar com atenção", cor: "var(--gated)" },
  { faixa: "301–500", rotulo: "Risco alto", leitura: "Análise manual", cor: "var(--past)" },
  { faixa: "0–300", rotulo: "Crítico", leitura: "Rejeitar", cor: "var(--danger)" },
];

export default function ConsultaInfoTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="tab-content-info">

      {/* ── Como o score é calculado ── */}
      <div style={CARD}>
        <Kicker>Como o score é calculado</Kicker>
        <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginTop: 10, maxWidth: "72ch" }}>
          Todo documento parte de <strong style={{ fontFamily: "var(--font-mono)" }}>700</strong> —
          nada consta na rede. A partir daí o motor <strong>deduz</strong> por cada sinal
          negativo encontrado nos ERPs dos provedores e <strong>soma bônus</strong> apenas com
          histórico positivo comprovado. O resultado fica entre 0 e 1000. Não existe ponto
          por ausência de informação: quem a rede não conhece fica na base, sem prêmio nem castigo.
        </p>

        <div className="ds-duo" style={{ gap: 24, marginTop: 16 }}>
          <div>
            <Kicker style={{ color: "var(--danger)" }}>Deduções · tempo de atraso</Kicker>
            <div style={{ marginTop: 6 }}>
              {DEDUCOES_TEMPO.map(d => <LinhaValor key={d.rotulo} {...d} cor="var(--danger)" />)}
            </div>
            <Kicker style={{ color: "var(--danger)", marginTop: 16 }}>Deduções · valor em aberto</Kicker>
            <div style={{ marginTop: 6 }}>
              {DEDUCOES_VALOR.map(d => <LinhaValor key={d.rotulo} {...d} cor="var(--danger)" />)}
            </div>
          </div>
          <div>
            <Kicker style={{ color: "var(--danger)" }}>Deduções · demais sinais</Kicker>
            <div style={{ marginTop: 6 }}>
              {DEDUCOES_OUTRAS.map(d => <LinhaValor key={d.rotulo} {...d} cor="var(--danger)" />)}
            </div>
          </div>
        </div>

        <div className="ds-duo" style={{ gap: 24, marginTop: 20 }}>
          <div>
            <Kicker style={{ color: "var(--ok)" }}>Bônus · só com histórico comprovado</Kicker>
            <div style={{ marginTop: 6 }}>
              {BONUS.map(d => <LinhaValor key={d.rotulo} {...d} cor="var(--ok)" />)}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 8 }}>
              Bônus somam no máximo +300 (700 + 300 = 1000: só chega ao topo quem comprova tudo)
              e ficam <strong>bloqueados enquanto existir dívida ativa</strong> — tempo de casa
              não lava calote em aberto.
            </p>
          </div>
          <div>
            <Kicker style={{ color: "var(--gated)" }}>Tetos · guard-rails da decisão</Kicker>
            <div style={{ marginTop: 6 }}>
              {TETOS.map(d => <LinhaValor key={d.rotulo} {...d} cor="var(--gated)" />)}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 8 }}>
              O teto vale sobre o resultado final: com uma pendência dessas, o score
              não passa do limite, independente de qualquer histórico positivo. O teto
              mais restritivo vence.
            </p>
          </div>
        </div>
      </div>

      {/* ── Faixas ── */}
      <div style={CARD}>
        <Kicker>Faixas e leitura</Kicker>
        <div style={{ marginTop: 10 }}>
          {FAIXAS.map(f => (
            <div key={f.faixa} style={{
              display: "grid", gridTemplateColumns: "110px 150px 1fr",
              gap: 12, alignItems: "center", padding: "8px 0",
              borderBottom: "1px solid var(--border-faint)",
            }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                fontVariantNumeric: "tabular-nums", color: "var(--text)",
              }}>
                {f.faixa}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: f.cor }} />
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "var(--track-wide)", color: f.cor,
                }}>
                  {f.rotulo}
                </span>
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{f.leitura}</span>
            </div>
          ))}
        </div>
        {/* Texto corrido nao acompanha a largura da tela: passando de ~75
            caracteres por linha o olho perde o inicio da linha seguinte. Os
            demais paragrafos desta aba ja sao contidos pelo card; este era o
            unico solto, e ficou com 1531px quando a pagina passou a usar a
            largura cheia. */}
        <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 10, maxWidth: "75ch" }}>
          A sugestão é um gate, não uma sentença: dívida ativa nunca sai como "aprovar" puro,
          e a decisão final é sempre do provedor.
        </p>
      </div>

      {/* ── Custos e base legal ── */}
      <div className="ds-duo" style={{ gap: 14, marginTop: 0 }}>
        <div style={CARD}>
          <Kicker>Custos</Kicker>
          <div style={{ marginTop: 10 }}>
            <LinhaValor rotulo="Registro do seu próprio ERP" valor="grátis" cor="var(--ok)" />
            <LinhaValor rotulo="Resultado nada consta" valor="grátis" cor="var(--ok)" />
            <LinhaValor rotulo="Ocorrência revelada de parceiro" valor="1 crédito" />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, marginTop: 10 }}>
            O custo aparece antes da consulta, no rodapé do formulário, e de novo dentro
            do relatório.
          </p>
        </div>
        <div style={CARD}>
          <Kicker>Base legal · LGPD</Kicker>
          <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginTop: 10 }}>
            Consultas amparadas na proteção ao crédito — LGPD art. 7º, X. Dados de
            terceiros chegam anonimizados e com valores em faixa; toda consulta gera
            registro de auditoria com protocolo, hash e finalidade declarada.
          </p>
          <div style={{ marginTop: 10 }}>
            <span style={pillStyle("ok")}>Dados mascarados</span>
          </div>
        </div>
      </div>
    </div>
  );
}
