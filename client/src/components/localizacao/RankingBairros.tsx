import { useMemo, useState } from "react";
import { Kicker, Chip, MONO, brl, num, pct, zonaDaTaxa, ZONA_META, ZONAS_LEGENDA, CARD } from "./ui";

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

/** Chip territorial. Enquanto as bases públicas não estiverem carregadas, o
 *  bairro diz que não tem base — não inventa uma penetração. */
function TagTerritorial({ b }: { b: BairroRanking }) {
  const tags: Array<{ texto: string; titulo?: string }> = [];
  if (b.pctPenetracao !== null) tags.push({ texto: `penetração ${pct(b.pctPenetracao)}` });
  if (b.hps !== null) tags.push({ texto: `${num(b.hps)} HPs`, titulo: "domicílios no bairro, IBGE CNEFE 2022" });
  if (tags.length === 0) {
    tags.push({
      texto: "sem bases públicas",
      titulo: "Este bairro não casou com IBGE CNEFE / ANEEL BDGD — sem denominador, a penetração não é calculada.",
    });
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {tags.map(t => (
        <span key={t.texto} title={t.titulo} style={{
          ...MONO, fontSize: 10, padding: "2px 6px", borderRadius: 4,
          background: "var(--surface-inset)", color: "var(--text-muted)",
        }}>
          {t.texto}
        </span>
      ))}
    </div>
  );
}

function LinhaBairro({
  b, pos, selecionado, onSelect,
}: {
  b: BairroRanking; pos: number; selecionado: boolean; onSelect: () => void;
}) {
  const zona = ZONA_META[zonaDaTaxa(b.pctInadimplencia)];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="ds-ctl"
      data-testid={`bairro-${b.bairro}`}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "10px 14px", border: "none", cursor: "pointer",
        borderBottom: "1px solid var(--border-faint)",
        background: selecionado ? "var(--brand-soft)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}>
          {String(pos).padStart(2, "0")}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {b.bairro}
        </span>
        <span style={{
          ...MONO, fontSize: 10.5, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
          color: zona.cor, background: zona.bg, border: `1px solid ${zona.borda}`, flexShrink: 0,
        }}>
          {pct(b.pctInadimplencia)}
        </span>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 22, marginTop: 2 }}>
        {b.cidade}
      </div>

      {/* Escala absoluta 0–100%, nunca normalizada pelo máximo da lista: 13,9%
          desenha 13,9% da largura sempre, seja qual for o resto do ranking. */}
      <div style={{
        height: 3, borderRadius: 2, background: zona.bg,
        marginLeft: 22, marginTop: 6, overflow: "hidden",
      }}>
        <div style={{ height: "100%", width: `${Math.min(100, b.pctInadimplencia)}%`, background: zona.cor }} />
      </div>

      <div style={{ marginLeft: 22, marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...MONO, fontSize: 11, fontWeight: 600, color: "var(--money-neg)" }}>
          {brl(b.dividaTotal)}
        </span>
        <span style={{ ...MONO, fontSize: 11, color: "var(--text-muted)" }}>
          · {num(b.clientes)} clientes · {num(b.inadimplentes)} inad. · {num(b.exComDivida)} ex
        </span>
      </div>

      <div style={{ marginLeft: 22 }}><TagTerritorial b={b} /></div>
    </button>
  );
}

export default function RankingBairros({
  bairros, selecionado, onSelect, ordem, onOrdem, altura,
}: {
  bairros: BairroRanking[];
  selecionado: string | null;
  onSelect: (bairro: string | null) => void;
  ordem: OrdemRanking;
  onOrdem: (o: OrdemRanking) => void;
  altura?: number;
}) {
  const [verOutros, setVerOutros] = useState(false);

  const { principais, outros } = useMemo(() => {
    const validos = bairros.filter(b => b.clientes > 0);
    return {
      principais: ordenarBairros(validos.filter(b => b.clientes >= MIN_CLIENTES_RANKING), ordem),
      outros: ordenarBairros(validos.filter(b => b.clientes < MIN_CLIENTES_RANKING), ordem),
    };
  }, [bairros, ordem]);

  return (
    <div style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-faint)" }}>
        <Kicker style={{ fontSize: 11 }}>Bairros por inadimplência</Kicker>
        <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
          Universo = carteira inteira (inclui clientes sem coordenada). Clicar foca o mapa e o raio-X.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 }}>
          {ORDENS.map(o => (
            <Chip key={o.k} ativo={ordem === o.k} onClick={() => onOrdem(o.k)}>{o.rotulo}</Chip>
          ))}
        </div>
        {/* Legenda das zonas em linha própria: espremida ao lado dos chips ela
            quebrava no meio e virava ruído em vez de chave de leitura. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 8 }}>
          {ZONAS_LEGENDA.map(z => (
            <span key={z.rotulo} style={{ ...MONO, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: z.cor }} />
              {z.rotulo}
            </span>
          ))}
        </div>
      </div>

      <div style={{ overflowY: "auto", maxHeight: altura ?? 520 }}>
        {principais.length === 0 && outros.length === 0 && (
          <p style={{ padding: "24px 14px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
            Nenhum bairro na carteira — o cadastro do ERP não traz bairro.
          </p>
        )}

        {principais.map((b, i) => (
          <LinhaBairro
            key={`${b.cidade}||${b.bairro}`}
            b={b}
            pos={i + 1}
            selecionado={selecionado === b.bairro}
            onSelect={() => onSelect(selecionado === b.bairro ? null : b.bairro)}
          />
        ))}

        {/* Nada é escondido: bairro com menos de 3 clientes sai da régua para
            não distorcer o topo, mas continua acessível aqui. */}
        {outros.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setVerOutros(v => !v)}
              className="ds-ctl"
              style={{
                display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                padding: "10px 14px", border: "none", background: "var(--surface-2)",
                fontSize: 11.5, color: "var(--text-muted)",
              }}
              data-testid="ver-outros-bairros"
            >
              {verOutros ? "Ocultar" : "Ver"} outros{" "}
              <span style={{ ...MONO }}>{num(outros.length)}</span> bairros com menos de {MIN_CLIENTES_RANKING} clientes
            </button>
            {verOutros && outros.map((b, i) => (
              <LinhaBairro
                key={`${b.cidade}||${b.bairro}`}
                b={b}
                pos={principais.length + i + 1}
                selecionado={selecionado === b.bairro}
                onSelect={() => onSelect(selecionado === b.bairro ? null : b.bairro)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
