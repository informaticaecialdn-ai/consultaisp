import { ListOrdered, X } from "lucide-react";
import { Kicker, MONO, CARD, brl, num } from "./ui";
import { FAIXAS_OCORRENCIA, type BairroRede } from "@/components/maps/MapaCarteira";

/**
 * Bairros da rede — onde a cidade inteira já tomou calote.
 *
 * O painel irmão do ranking da carteira, com a mesma anatomia e uma diferença
 * que muda a leitura: aqui não existe taxa. Taxa exige denominador, e a rede
 * não sabe quantos clientes cada provedor tem em cada bairro — só quantos
 * casos deixou. Então a régua é o número absoluto de casos, e a barra compara
 * os bairros entre si em vez de com uma escala fixa.
 *
 * Nenhuma linha aqui é um cliente. Bairro com menos de três casos não aparece,
 * e isso é dito na tela — mapa vazio sem explicação faz o operador achar que a
 * ferramenta quebrou.
 */

function faixaDe(n: number) {
  return FAIXAS_OCORRENCIA.find(f => f.teste(n)) ?? FAIXAS_OCORRENCIA[0];
}

export default function RankingRede({
  bairros, selecionado, onSelect, ocultas, minPorBairro, carregando, semArea, mostrarCidade,
}: {
  bairros: BairroRede[];
  selecionado: string | null;
  onSelect: (bairro: string | null) => void;
  ocultas: number;
  minPorBairro: number;
  carregando: boolean;
  semArea: boolean;
  mostrarCidade: boolean;
}) {
  const maior = Math.max(...bairros.map(b => b.ocorrencias), 1);

  return (
    <div
      style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}
      data-testid="ranking-rede"
    >
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-faint)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <ListOrdered size={14} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
            <Kicker style={{ fontSize: 11 }}>Bairros por inadimplência · rede</Kicker>
          </span>
          {selecionado && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="ds-ctl"
              data-variant="ghost"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 8px",
                border: "1px solid var(--border)", borderRadius: 4, background: "var(--surface)",
                color: "var(--text-2)", fontSize: 11, fontWeight: 500, cursor: "pointer",
              }}
            >
              <X size={12} strokeWidth={2} /> Limpar
            </button>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
          Ex-clientes com dívida de todos os provedores nas suas cidades. Clicar foca o mapa.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 }}>
          {FAIXAS_OCORRENCIA.map(f => (
            <span key={f.label} style={{ ...MONO, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-faint)" }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: `var(${f.token})` }} />
              {f.label}
            </span>
          ))}
        </div>
      </div>

      <div className="ds-ranking-lista" style={{ padding: "4px 6px" }}>
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
              aria-pressed={ativo}
              className="ds-ctl ds-rk"
              style={{
                display: "grid", gridTemplateColumns: "26px 1fr", gap: "0 10px",
                width: "100%", textAlign: "left", padding: "10px 8px 11px",
                border: `1px solid ${ativo ? "var(--brand)" : "transparent"}`,
                borderBottom: `1px solid ${ativo ? "var(--brand)" : "var(--border-faint)"}`,
                borderRadius: 4, background: ativo ? "var(--brand-soft)" : "transparent",
                cursor: "pointer",
              }}
              data-testid={`rede-bairro-${b.bairro}`}
            >
              <span style={{ ...MONO, fontSize: 11, fontWeight: 500, color: "var(--text-faint)", paddingTop: 2 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ display: "block", minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.bairro}
                    {mostrarCidade && <span style={{ fontWeight: 400, color: "var(--text-faint)" }}> · {b.cidade}</span>}
                  </span>
                  <span style={{
                    ...MONO, fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4, flexShrink: 0,
                    color: `var(${f.token})`, background: `var(${f.token}-bg)`, border: `1px solid var(${f.token}-border)`,
                  }}>
                    {num(b.ocorrencias)} {b.ocorrencias === 1 ? "caso" : "casos"}
                  </span>
                </span>

                {/* Escala relativa ao pior bairro: sem denominador de mercado, o
                    que dá para comparar é um bairro com o outro. */}
                <span style={{ display: "block", height: 4, borderRadius: 2, margin: "7px 0", overflow: "hidden", background: `var(${f.token}-bg)` }}>
                  <span style={{ display: "block", height: "100%", borderRadius: 2, width: `${(b.ocorrencias / maior) * 100}%`, background: `var(${f.token})` }} />
                </span>

                <span style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                  <span style={{ ...MONO, fontWeight: 600, color: "var(--money-neg)" }}>{brl(b.dividaTotal)}</span>
                  <span style={{ ...MONO }}>· {num(b.provedores)} {b.provedores === 1 ? "provedor" : "provedores"}</span>
                </span>
              </span>
            </button>
          );
        })}

        {!carregando && bairros.length > 0 && ocultas > 0 && (
          <p style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
            Mais <span style={{ ...MONO }}>{num(ocultas)}</span>{" "}
            {ocultas === 1 ? "ocorrência ficou" : "ocorrências ficaram"} de fora, em bairros com
            menos de {minPorBairro} casos — poucos demais para agregar sem apontar alguém.
          </p>
        )}
      </div>
    </div>
  );
}
