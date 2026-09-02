import { useMemo, useState } from "react";
import { ListOrdered, ChevronDown, ChevronRight, X } from "lucide-react";
import {
  Kicker, Segmentado, MONO, CARD, TRILHO_REGUA,
  brl, num, pct, zonaDaTaxa, ZONA_META, ZONAS_LEGENDA,
} from "./ui";

/**
 * Bairros por inadimplência — o painel ao lado do mapa.
 *
 * Anatomia da referência (Provedor.ai · Cobrança · Localização v3): controle
 * segmentado de ordenação, pill de % por severidade, barra de 4px em escala
 * ABSOLUTA sobre o trilho-régua das zonas, rank 01/02, chips territoriais
 * condicionais. Bairros com menos de 3 clientes viram a linha "Outros",
 * expansível — 100% com um cliente é ruído, não bússola, mas nada é escondido.
 *
 * O card preenche a altura que o pai der: no grid ao lado do mapa ele fecha na
 * altura do mapa e a lista rola por dentro.
 */

export interface BairroRanking {
  bairro: string; cidade: string;
  clientes: number; inadimplentes: number; exComDivida: number; atuais: number;
  pctInadimplencia: number; dividaTotal: number;
  hps: number | null; ucsVivas: number | null;
  pctPenetracao: number | null; benchmarkPct: number | null;
}

export type OrdemRanking = "menor" | "maior" | "divida" | "clientes";

const ORDENS: Array<{ k: OrdemRanking; rotulo: string }> = [
  { k: "menor",    rotulo: "Menor %" },
  { k: "maior",    rotulo: "Maior %" },
  { k: "divida",   rotulo: "Dívida" },
  { k: "clientes", rotulo: "Clientes" },
];

/** Piso do ranking. 100% de inadimplência com um cliente é ruído, não bússola. */
export const MIN_CLIENTES_RANKING = 3;

export function ordenarBairros(lista: BairroRanking[], ordem: OrdemRanking): BairroRanking[] {
  const desempate = (a: BairroRanking, b: BairroRanking) => a.bairro.localeCompare(b.bairro, "pt-BR");
  const copia = [...lista];
  switch (ordem) {
    case "menor":    return copia.sort((a, b) => a.pctInadimplencia - b.pctInadimplencia || desempate(a, b));
    case "maior":    return copia.sort((a, b) => b.pctInadimplencia - a.pctInadimplencia || desempate(a, b));
    case "divida":   return copia.sort((a, b) => b.dividaTotal - a.dividaTotal || desempate(a, b));
    case "clientes": return copia.sort((a, b) => b.clientes - a.clientes || desempate(a, b));
  }
}

/* Tooltips honestos — a regra de ouro da referência: null nunca vira número. */
const TIP_SEM_BASES =
  "Sem correspondência nas bases públicas (IBGE CNEFE 2022 / ANEEL BDGD 2024) para este bairro — nenhum número é exibido para não fabricar penetração.";
const TIP_PEN_SUPRIMIDA =
  "Penetração suprimida: o cálculo passou de 100% — o bairro do ERP casou com uma localidade menor nas bases públicas. Número impossível não é exibido.";
const TIP_FONTES =
  "HPs = domicílios (IBGE CNEFE 2022) · UCs vivas = unidades consumidoras residenciais ativas (ANEEL/Copel BDGD 2024)";
const TIP_PEN_FORMULA = "penetração = clientes atuais ÷ UCs vivas (reserva: HPs)";
const TIP_MERCADO = "benchmark disponível a partir de 3 provedores na região";

/** Chip territorial da linha: pen (marca) · base (neutro) · none (tracejado,
 *  só quando NENHUMA base casou). */
function TagTerritorial({
  tipo, texto, titulo,
}: {
  tipo: "pen" | "base" | "none"; texto: string; titulo: string;
}) {
  const visual =
    tipo === "pen"
      ? { color: "var(--brand-ink)", background: "var(--brand-soft)", border: "1px solid var(--brand-soft)" }
      : tipo === "base"
        ? { color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border-faint)" }
        : { color: "var(--text-faint)", background: "transparent", border: "1px dashed var(--border)" };
  return (
    <span title={titulo} style={{
      ...MONO, display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px",
      borderRadius: 4, fontSize: 10, fontWeight: tipo === "none" ? 400 : 500, whiteSpace: "nowrap",
      ...visual,
    }}>
      {texto}
    </span>
  );
}

/** Chips CONDICIONAIS: null é omissão ou tracejado honesto, nunca "—". */
function ChipsTerritoriais({ b }: { b: BairroRanking }) {
  const semBases = b.hps === null && b.ucsVivas === null;
  const partesBase: string[] = [];
  if (b.hps !== null) partesBase.push(`${num(b.hps)} HPs`);
  if (b.ucsVivas !== null) partesBase.push(`${num(b.ucsVivas)} UCs vivas`);
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
      {b.pctPenetracao !== null && (
        <TagTerritorial tipo="pen" titulo={TIP_PEN_FORMULA} texto={`penetração ${pct(b.pctPenetracao)}`} />
      )}
      {partesBase.length > 0 && (
        <TagTerritorial
          tipo="base"
          titulo={b.pctPenetracao === null ? `${TIP_FONTES} · ${TIP_PEN_SUPRIMIDA}` : TIP_FONTES}
          texto={partesBase.join(" · ")}
        />
      )}
      {semBases && <TagTerritorial tipo="none" titulo={TIP_SEM_BASES} texto="sem bases públicas" />}
      {b.benchmarkPct !== null && (
        <TagTerritorial tipo="base" titulo={TIP_MERCADO} texto={`mercado ${pct(b.benchmarkPct)}`} />
      )}
    </span>
  );
}

function LinhaBairro({
  b, pos, ativo, mostrarCidade, onClick,
}: {
  b: BairroRanking; pos: number; ativo: boolean; mostrarCidade: boolean; onClick: () => void;
}) {
  const zona = ZONA_META[zonaDaTaxa(b.pctInadimplencia)];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="ds-ctl ds-rk"
      data-testid={`bairro-${b.bairro}`}
      style={{
        display: "grid", gridTemplateColumns: "26px 1fr", gap: "0 10px",
        width: "100%", textAlign: "left", padding: "10px 8px 11px",
        // Linha ativa fala a mesma língua de "selecionado" do chip de cidade.
        border: `1px solid ${ativo ? "var(--brand)" : "transparent"}`,
        borderBottom: `1px solid ${ativo ? "var(--brand)" : "var(--border-faint)"}`,
        borderRadius: 4,
        background: ativo ? "var(--brand-soft)" : "transparent",
        cursor: "pointer",
      }}
    >
      {/* rank da ordenação atual */}
      <span style={{ ...MONO, fontSize: 11, fontWeight: 500, color: "var(--text-faint)", paddingTop: 2 }}>
        {String(pos).padStart(2, "0")}
      </span>

      <span style={{ display: "block", minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {b.bairro}
            {mostrarCidade && (
              <span style={{ fontWeight: 400, color: "var(--text-faint)" }}> · {b.cidade}</span>
            )}
          </span>
          <span style={{
            ...MONO, fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4, flexShrink: 0,
            color: zona.cor, background: zona.bg, border: `1px solid ${zona.borda}`,
          }}>
            {pct(b.pctInadimplencia)}
          </span>
        </span>

        {/* Escala absoluta 0–100% sobre o trilho-régua das zonas: 13,9% desenha
            13,9% da largura sempre, seja qual for o resto do ranking. */}
        <span style={{
          display: "block", height: 4, borderRadius: 2, margin: "7px 0",
          overflow: "hidden", background: TRILHO_REGUA,
        }}>
          <span style={{
            display: "block", height: "100%", borderRadius: 2,
            width: `${Math.min(100, b.pctInadimplencia)}%`, background: zona.cor,
          }} />
        </span>

        <span style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ ...MONO, fontWeight: 600, color: "var(--money-neg)" }}>{brl(b.dividaTotal)}</span>
          <span style={{ ...MONO }}>
            · {num(b.clientes)} clientes · {num(b.inadimplentes)} inad. · {num(b.exComDivida)} ex
          </span>
        </span>

        <ChipsTerritoriais b={b} />
      </span>
    </button>
  );
}

export default function RankingBairros({
  bairros, selecionado, onSelect, ordem, onOrdem, cidade,
}: {
  bairros: BairroRanking[];
  selecionado: string | null;
  onSelect: (bairro: string | null) => void;
  ordem: OrdemRanking;
  onOrdem: (o: OrdemRanking) => void;
  /** Cidade filtrada, quando houver — muda o texto do universo e esconde a cidade nas linhas. */
  cidade: string | null;
}) {
  const [verOutros, setVerOutros] = useState(false);

  const { principais, outros } = useMemo(() => {
    const validos = bairros.filter(b => b.clientes > 0);
    return {
      principais: ordenarBairros(validos.filter(b => b.clientes >= MIN_CLIENTES_RANKING), ordem),
      outros: ordenarBairros(validos.filter(b => b.clientes < MIN_CLIENTES_RANKING), ordem),
    };
  }, [bairros, ordem]);

  const dividaOutros = useMemo(() => outros.reduce((s, b) => s + b.dividaTotal, 0), [outros]);
  const alternar = (b: BairroRanking) => onSelect(selecionado === b.bairro ? null : b.bairro);

  return (
    <div
      style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}
      data-testid="ranking-bairros"
    >
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-faint)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <ListOrdered size={14} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
            <Kicker style={{ fontSize: 11 }}>Bairros por inadimplência</Kicker>
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
              data-testid="limpar-bairro"
            >
              <X size={12} strokeWidth={2} /> Limpar
            </button>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
          Universo = carteira {cidade ? `de ${cidade}` : "inteira"} (inclui clientes sem coordenada).
          Clicar foca o mapa e o raio-X.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
          <Segmentado opcoes={ORDENS} valor={ordem} onChange={onOrdem} rotulo="Ordenação dos bairros" />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto", whiteSpace: "nowrap" }}>
            {ZONAS_LEGENDA.map(z => (
              <span key={z.rotulo} style={{ ...MONO, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-faint)" }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: z.cor }} />
                {z.rotulo}
              </span>
            ))}
          </span>
        </div>
      </div>

      <div className="ds-ranking-lista" style={{ padding: "4px 6px" }}>
        {principais.length === 0 && outros.length === 0 && (
          <p style={{ padding: "24px 14px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
            Sem agregado de bairros — o cadastro do ERP não traz bairro.
          </p>
        )}

        {principais.map((b, i) => (
          <LinhaBairro
            key={`${b.cidade}||${b.bairro}`}
            b={b}
            pos={i + 1}
            ativo={selecionado === b.bairro}
            mostrarCidade={cidade === null}
            onClick={() => alternar(b)}
          />
        ))}

        {/* Nada é escondido: bairro com menos de 3 clientes sai da régua para
            não distorcer o topo, mas continua acessível aqui. */}
        {outros.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setVerOutros(v => !v)}
              aria-expanded={verOutros}
              className="ds-ctl ds-rk"
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                padding: "11px 8px", border: 0, borderRadius: 4, background: "transparent",
                cursor: "pointer", fontSize: 12, fontWeight: 500, color: "var(--text-2)",
              }}
              data-testid="ver-outros-bairros"
            >
              {verOutros
                ? <ChevronDown size={14} strokeWidth={1.75} style={{ color: "var(--text-faint)" }} />
                : <ChevronRight size={14} strokeWidth={1.75} style={{ color: "var(--text-faint)" }} />}
              Outros{" "}
              <span style={{ ...MONO, fontWeight: 400, color: "var(--text-faint)" }}>
                ({num(outros.length)} {outros.length === 1 ? "bairro" : "bairros"}, &lt;{MIN_CLIENTES_RANKING} clientes cada)
              </span>
              <span style={{ ...MONO, marginLeft: "auto", fontWeight: 500, color: "var(--text-faint)" }}>
                {brl(dividaOutros)}
              </span>
            </button>
            {verOutros && outros.map((b, i) => (
              <LinhaBairro
                key={`${b.cidade}||${b.bairro}`}
                b={b}
                pos={principais.length + i + 1}
                ativo={selecionado === b.bairro}
                mostrarCidade={cidade === null}
                onClick={() => alternar(b)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
