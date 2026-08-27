import { Kicker, MONO, CARD, brl, num } from "./ui";
import { FAIXAS_OCORRENCIA, type BairroRede } from "@/components/maps/MapaCarteira";

/**
 * Bairros da rede — onde a cidade inteira já tomou calote.
 *
 * O painel irmão do ranking da carteira, com uma diferença que muda a leitura:
 * aqui não existe taxa. Taxa exige denominador, e a rede não sabe quantos
 * clientes cada provedor tem em cada bairro — só quantos casos deixou. Então a
 * régua é o número absoluto de casos, e a barra compara os bairros entre si em
 * vez de com uma escala fixa.
 *
 * Nenhuma linha aqui é um cliente. Bairro com menos de três casos não aparece,
 * e isso é dito na tela — mapa vazio sem explicação faz o operador achar que a
 * ferramenta quebrou.
 */

function faixaDe(n: number) {
  return FAIXAS_OCORRENCIA.find(f => f.teste(n)) ?? FAIXAS_OCORRENCIA[0];
}

export default function RankingRede({
  bairros, selecionado, onSelect, ocultas, minPorBairro, carregando, semArea, altura,
}: {
  bairros: BairroRede[];
  selecionado: string | null;
  onSelect: (bairro: string | null) => void;
  ocultas: number;
  minPorBairro: number;
  carregando: boolean;
  semArea: boolean;
  altura?: number;
}) {
  const maior = Math.max(...bairros.map(b => b.ocorrencias), 1);

  return (
    <div style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden" }} data-testid="ranking-rede">
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-faint)" }}>
        <Kicker style={{ fontSize: 11 }}>Bairros por inadimplência · rede</Kicker>
        <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
          Ex-clientes com dívida de todos os provedores nas suas cidades. Clicar foca o mapa.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 10 }}>
          {FAIXAS_OCORRENCIA.map(f => (
            <span key={f.label} style={{ ...MONO, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: `var(${f.token})` }} />
              {f.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ overflowY: "auto", maxHeight: altura ?? 520 }}>
        {carregando && (
          <p style={{ padding: "24px 14px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
            Consultando a rede…
          </p>
        )}

        {!carregando && semArea && (
          <p style={{ padding: "24px 14px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
            Configure as cidades atendidas para ver a rede — sem recorte, isto seria a base
            inteira do país, não a sua região.
          </p>
        )}

        {!carregando && !semArea && bairros.length === 0 && (
          <p style={{ padding: "24px 14px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
            {ocultas > 0
              ? `Nenhum bairro chegou a ${minPorBairro} casos. A rede tem ${num(ocultas)} ${ocultas === 1 ? "ocorrência espalhada" : "ocorrências espalhadas"}, poucas demais para agregar por bairro.`
              : "Nenhum ex-cliente com dívida na rede, nas suas cidades."}
          </p>
        )}

        {!carregando && bairros.map((b, i) => {
          const f = faixaDe(b.ocorrencias);
          const ativo = selecionado === b.bairro;
          return (
            <button
              key={`${b.cidade}||${b.bairro}`}
              type="button"
              onClick={() => onSelect(ativo ? null : b.bairro)}
              className="ds-ctl"
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 14px", border: "none", cursor: "pointer",
                borderBottom: "1px solid var(--border-faint)",
                background: ativo ? "var(--brand-soft)" : "transparent",
              }}
              data-testid={`rede-bairro-${b.bairro}`}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.bairro}
                </span>
                <span style={{
                  ...MONO, fontSize: 10.5, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                  color: `var(${f.token})`, background: `var(${f.token}-bg)`,
                  border: `1px solid var(${f.token}-border)`, flexShrink: 0,
                }}>
                  {num(b.ocorrencias)} {b.ocorrencias === 1 ? "caso" : "casos"}
                </span>
              </div>

              <div style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 22, marginTop: 2 }}>
                {b.cidade}
              </div>

              {/* Escala relativa ao pior bairro: sem denominador de mercado, o
                  que dá para comparar é um bairro com o outro. */}
              <div style={{
                height: 3, borderRadius: 2, background: `var(${f.token}-bg)`,
                marginLeft: 22, marginTop: 6, overflow: "hidden",
              }}>
                <div style={{ height: "100%", width: `${(b.ocorrencias / maior) * 100}%`, background: `var(${f.token})` }} />
              </div>

              <div style={{ marginLeft: 22, marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
                <span style={{ ...MONO, fontSize: 11, fontWeight: 600, color: "var(--money-neg)" }}>
                  {brl(b.dividaTotal)}
                </span>
                <span style={{ ...MONO, fontSize: 11, color: "var(--text-muted)" }}>
                  · {num(b.provedores)} {b.provedores === 1 ? "provedor" : "provedores"}
                </span>
              </div>
            </button>
          );
        })}

        {!carregando && bairros.length > 0 && ocultas > 0 && (
          <p style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-faint)", background: "var(--surface-2)", lineHeight: 1.5 }}>
            Mais <span style={{ ...MONO }}>{num(ocultas)}</span>{" "}
            {ocultas === 1 ? "ocorrência ficou" : "ocorrências ficaram"} de fora, em bairros com
            menos de {minPorBairro} casos — poucos demais para agregar sem apontar alguém.
          </p>
        )}
      </div>
    </div>
  );
}
