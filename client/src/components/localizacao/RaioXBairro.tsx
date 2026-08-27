import { useMemo } from "react";
import { Crosshair, TrendingDown, Banknote, Store, ScanSearch } from "lucide-react";
import { Kicker, MONO, CARD, brl, num, pct, TRACO } from "./ui";
import type { BairroRanking } from "./RankingBairros";

/**
 * Raio-X do bairro — o funil que liga o território à carteira.
 *
 * Lê da esquerda para a direita: quantos domicílios existem no bairro, quantos
 * têm energia ligada, quantos são seus, e quantos desses devem. Cada seta é uma
 * divisão, e o número embaixo dela é a taxa daquela passagem.
 *
 * A regra que sustenta o bloco: **número que não dá para calcular vira "—",
 * nunca zero e nunca um palpite.** Enquanto as bases públicas (IBGE CNEFE e
 * ANEEL BDGD) não estiverem carregadas, as duas primeiras caixas e a penetração
 * ficam em "—" e o bairro exibe o aviso de que não há base. É a diferença entre
 * "não sei" e "é zero", e ela decide investimento comercial.
 */

const MIN_CLIENTES_CAMPEAO = 3;

const TITULO_SEM_HPS = "Sem match no IBGE CNEFE 2022 para este bairro — não há contagem de domicílios.";
const TITULO_SEM_UCS = "Sem match na ANEEL/Copel BDGD 2024 — não há contagem de unidades consumidoras vivas.";
const TITULO_SEM_PENETRACAO = "Sem denominador territorial, a penetração não é calculável. Números impossíveis são suprimidos no servidor, nunca estimados.";
const TITULO_BENCHMARK = "Benchmark disponível a partir de 3 provedores na região.";

function Caixa({
  kicker, valor, rotulo, sub, cor, dot, titulo,
}: {
  kicker: string; valor: number | null; rotulo: string; sub?: string;
  cor?: string; dot: string; titulo?: string;
}) {
  const semDado = valor === null;
  return (
    <div
      title={semDado ? titulo : undefined}
      style={{
        ...CARD,
        background: "var(--surface-2)",
        borderStyle: semDado ? "dashed" : "solid",
        padding: "12px 14px", minWidth: 0,
      }}
    >
      <Kicker>{kicker}</Kicker>
      <p style={{
        ...MONO, fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 6,
        color: semDado ? "var(--text-faint)" : (cor ?? "var(--text)"),
      }}>
        {semDado ? TRACO : num(valor)}
      </p>
      <p style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: dot, flexShrink: 0 }} />
        {rotulo}
      </p>
      {sub && <p style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.45 }}>{sub}</p>}
    </div>
  );
}

function Conector({
  rotulo, valor, formula, media, rotuloMedia, heroi, cor, titulo,
}: {
  rotulo: string; valor: number | null; formula: string;
  media?: number | null; rotuloMedia?: string;
  heroi?: boolean; cor?: string; titulo?: string;
}) {
  const semDado = valor === null;
  return (
    <div title={semDado ? titulo : undefined} style={{ textAlign: "center", minWidth: 0, padding: "0 2px" }}>
      <div style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1 }}>→</div>
      <Kicker style={{ display: "block", marginTop: 6, color: heroi && !semDado ? "var(--brand)" : "var(--text-muted)" }}>
        {rotulo}
      </Kicker>
      <p style={{
        ...MONO, fontSize: heroi ? 20 : 15, fontWeight: 600, marginTop: 4,
        display: "inline-block", padding: heroi ? "3px 9px" : 0, borderRadius: 4,
        color: semDado ? "var(--text-faint)" : (cor ?? "var(--text)"),
        background: heroi ? (semDado ? "var(--surface-2)" : "var(--brand-soft)") : undefined,
        border: heroi ? `1px solid ${semDado ? "var(--border)" : "var(--brand-soft)"}` : undefined,
      }}>
        {semDado ? TRACO : pct(valor)}
      </p>
      <p style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.4 }}>{formula}</p>
      {media !== null && media !== undefined && (
        <p style={{ ...MONO, fontSize: 9.5, color: "var(--text-faint)", marginTop: 3 }}>
          {rotuloMedia} {pct(media)}
        </p>
      )}
    </div>
  );
}

/** Trilho de comparação com a média — o traço marca onde a carteira está. */
function Bullet({ valor, media, cor, rotuloMedia }: {
  valor: number | null; media: number | null; cor: string; rotuloMedia: string;
}) {
  if (valor === null) {
    return <p style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 8 }}>sem dado para comparar</p>;
  }
  const escala = Math.max(valor, media ?? 0) * 1.15 || 1;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: "relative", height: 3, borderRadius: 2, background: "var(--surface-3)", marginTop: 4, overflow: "visible" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2, width: `${Math.min(100, (valor / escala) * 100)}%`, background: cor }} />
        {media !== null && (
          <span
            title={`${rotuloMedia}: ${pct(media)}`}
            style={{ position: "absolute", top: -3, width: 2, height: 9, borderRadius: 1, background: "var(--text-muted)", left: `${Math.min(98, (media / escala) * 100)}%` }}
          />
        )}
      </div>
      {media !== null && (
        <p style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>
          │ {rotuloMedia} · {pct(media)}
        </p>
      )}
    </div>
  );
}

/** A seta diz a direção; a cor diz o julgamento. Inadimplência abaixo da média
 *  é um chip verde com seta para baixo. */
function Delta({ valor, media, melhorMenor }: { valor: number | null; media: number | null; melhorMenor: boolean }) {
  if (valor === null || media === null) return null;
  const d = valor - media;
  const neutro = Math.abs(d) < 0.05;
  const bom = melhorMenor ? d < 0 : d > 0;
  const tom = neutro
    ? { color: "var(--text-muted)", background: "var(--surface-2)", borderColor: "var(--border-faint)" }
    : bom
      ? { color: "var(--ok)", background: "var(--ok-bg)", borderColor: "var(--ok-border)" }
      : { color: "var(--danger)", background: "var(--danger-bg)", borderColor: "var(--danger-border)" };
  return (
    <span style={{
      ...MONO, display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8,
      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
      border: "1px solid", ...tom,
    }}>
      {d < 0 ? "▾" : "▴"} {Math.abs(d).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp vs média
    </span>
  );
}

function KpiBaixo({
  icone, rotulo, valor, sub, cor, comparacao, titulo, tracejado,
}: {
  icone: React.ReactNode; rotulo: string; valor: string; sub: string;
  cor?: string; comparacao?: React.ReactNode; titulo?: string; tracejado?: boolean;
}) {
  return (
    <div title={titulo} style={{
      ...CARD, padding: "13px 15px",
      borderStyle: tracejado ? "dashed" : "solid",
      background: tracejado ? "var(--surface-2)" : "var(--surface)",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
        {icone}
        <Kicker style={{ flex: 1 }}>{rotulo}</Kicker>
      </span>
      <p style={{
        ...(tracejado ? null : MONO),
        fontSize: tracejado ? 15 : 21,
        fontWeight: 600, letterSpacing: "-0.01em", margin: "7px 0 2px",
        color: tracejado ? "var(--text-faint)" : (cor ?? "var(--text)"),
      }}>
        {valor}
      </p>
      <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.45 }}>{sub}</p>
      {comparacao && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-faint)" }}>
          {comparacao}
        </div>
      )}
    </div>
  );
}

export default function RaioXBairro({
  bairros, selecionado, onSelect, cidade,
}: {
  bairros: BairroRanking[];
  selecionado: string | null;
  onSelect: (b: string) => void;
  /** Cidade filtrada, quando houver — muda o rótulo da média. */
  cidade: string | null;
}) {
  const validos = useMemo(() => bairros.filter(b => b.clientes > 0), [bairros]);

  const campeao = useMemo(() => {
    const elegiveis = validos.filter(b => b.clientes >= MIN_CLIENTES_CAMPEAO);
    return elegiveis.reduce<BairroRanking | null>(
      (m, b) => (m === null || b.pctInadimplencia > m.pctInadimplencia ? b : m), null,
    );
  }, [validos]);

  /* Abre num funil cheio quando der: bairro com match territorial completo,
     carteira viva e hierarquia coerente (HPs >= UCs >= atuais). Match invertido
     é denominador divergente, não funil — abrir ali ensina a ler errado. */
  const padrao = useMemo(() => {
    const comMatch = validos.filter(b => b.hps !== null && b.ucsVivas !== null && b.atuais > 0);
    const coerentes = comMatch.filter(b => b.hps! >= b.ucsVivas! && b.ucsVivas! >= b.atuais);
    const pool = coerentes.length > 0 ? coerentes : comMatch;
    return pool.reduce<BairroRanking | null>((m, b) => (m === null || b.atuais > m.atuais ? b : m), null);
  }, [validos]);

  const nomeSel = useMemo(() => {
    if (selecionado && validos.some(b => b.bairro === selecionado)) return selecionado;
    return padrao?.bairro ?? campeao?.bairro ?? validos[0]?.bairro ?? null;
  }, [selecionado, validos, padrao, campeao]);

  const b = useMemo(() => validos.find(x => x.bairro === nomeSel) ?? null, [validos, nomeSel]);

  /* Médias simples do recorte atual. Bairro sem match não puxa a média para
     baixo — ele simplesmente não participa dela. */
  const mediaPenetracao = useMemo(() => {
    const v = validos.map(x => x.pctPenetracao).filter((n): n is number => n !== null);
    return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
  }, [validos]);
  const mediaInadimplencia = useMemo(
    () => (validos.length ? validos.reduce((s, x) => s + x.pctInadimplencia, 0) / validos.length : null),
    [validos],
  );
  const rotuloMedia = cidade ? `média de ${cidade}` : "média da carteira";

  const ocupacao = b && b.hps !== null && b.ucsVivas !== null && b.hps > 0
    ? (b.ucsVivas / b.hps) * 100
    : null;
  const semBases = b !== null && b.hps === null && b.ucsVivas === null;
  const divergente = b !== null && b.hps !== null && b.ucsVivas !== null && b.ucsVivas > b.hps;

  return (
    <div style={{ ...CARD, padding: "16px 18px" }} data-testid="raiox-bairro">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <Kicker>Funil territorial · IBGE CNEFE 2022 × ANEEL BDGD 2024 × carteira</Kicker>
          <h2 style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 500, letterSpacing: "var(--track-tight)", color: "var(--text)", marginTop: 5 }}>
            <ScanSearch size={15} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
            Raio-X do bairro
          </h2>
        </div>
        {validos.length > 0 && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Bairro</span>
            <select
              className="ds-input"
              value={nomeSel ?? ""}
              onChange={e => onSelect(e.target.value)}
              style={{ fontSize: 12.5, padding: "5px 8px", minWidth: 190 }}
              data-testid="select-bairro-raiox"
            >
              {validos.map(x => (
                <option key={`${x.cidade}||${x.bairro}`} value={x.bairro}>
                  {x.bairro} · {num(x.clientes)} clientes
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!b ? (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 16 }}>
          Nenhum bairro com cliente na carteira — o cadastro do ERP não traz bairro.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <Kicker>Território · bases públicas</Kicker>
            {semBases && (
              <span title="O bairro não casou com as bases do IBGE e da ANEEL, então não há denominador territorial." style={{
                ...MONO, fontSize: 10, padding: "2px 6px", borderRadius: 4,
                border: "1px dashed var(--border-strong)", color: "var(--text-muted)",
              }}>
                sem bases públicas para este bairro
              </span>
            )}
            {divergente && (
              <span title="Mais unidades com energia do que domicílios: o bairro do ERP casou com um recorte diferente nas duas bases." style={{
                ...MONO, fontSize: 10, padding: "2px 6px", borderRadius: 4,
                background: "var(--gated-bg)", border: "1px solid var(--gated-border)", color: "var(--gated)",
              }}>
                match divergente · UCs &gt; HPs
              </span>
            )}
            <div style={{ flex: 1 }} />
            <Kicker>Sua carteira · verdade contratual</Kicker>
          </div>

          <div className="ds-funil" style={{ marginTop: 10 }}>
            <Caixa
              kicker="IBGE CNEFE 2022" valor={b.hps} rotulo="HPs · domicílios"
              dot="var(--text-faint)" titulo={TITULO_SEM_HPS}
            />
            <Conector
              rotulo="ocupação" valor={ocupacao} formula="UCs ÷ HPs" titulo={TITULO_SEM_UCS}
            />
            <Caixa
              kicker="ANEEL/Copel BDGD 2024" valor={b.ucsVivas} rotulo="UCs vivas · residenciais"
              dot="var(--brand)" titulo={TITULO_SEM_UCS}
            />
            <Conector
              rotulo="sua penetração" valor={b.pctPenetracao} formula="atuais ÷ UCs vivas (fallback HPs)"
              media={mediaPenetracao} rotuloMedia={rotuloMedia} heroi cor="var(--brand-ink)"
              titulo={TITULO_SEM_PENETRACAO}
            />
            <Caixa
              kicker="carteira · ativos + suspensos" valor={b.atuais} rotulo="Seus clientes atuais"
              dot="var(--ok)" cor="var(--ok)"
            />
            <Conector
              rotulo="inadimplência" valor={b.pctInadimplencia} formula="vencida ÷ clientes"
              media={mediaInadimplencia} rotuloMedia={rotuloMedia} cor="var(--danger)"
            />
            <Caixa
              kicker="verdade contratual" valor={b.inadimplentes} rotulo="Com fatura vencida"
              dot="var(--danger)" cor="var(--danger)"
              sub={`inclui ${num(b.exComDivida)} ex-clientes com dívida · ${num(b.clientes)} clientes no bairro`}
            />
          </div>

          <div className="ds-quadra" style={{ marginTop: 16 }}>
            <KpiBaixo
              icone={<Crosshair size={13} strokeWidth={1.5} />}
              rotulo="Penetração no bairro"
              valor={b.pctPenetracao === null ? TRACO : pct(b.pctPenetracao)}
              sub={b.pctPenetracao === null
                ? "sem bases públicas para calcular"
                : `${num(b.atuais)} atuais ÷ ${num(b.ucsVivas ?? b.hps)} UCs vivas`}
              cor="var(--brand-ink)"
              titulo={b.pctPenetracao === null ? TITULO_SEM_PENETRACAO : undefined}
              comparacao={
                <>
                  <Bullet valor={b.pctPenetracao} media={mediaPenetracao} cor="var(--brand)" rotuloMedia={rotuloMedia} />
                  <Delta valor={b.pctPenetracao} media={mediaPenetracao} melhorMenor={false} />
                </>
              }
            />
            <KpiBaixo
              icone={<TrendingDown size={13} strokeWidth={1.5} />}
              rotulo="Inadimplência sua"
              valor={pct(b.pctInadimplencia)}
              sub={`${num(b.inadimplentes)} inad. · ${num(b.clientes)} clientes no bairro`}
              cor="var(--danger)"
              comparacao={
                <>
                  <Bullet valor={b.pctInadimplencia} media={mediaInadimplencia} cor="var(--danger)" rotuloMedia={rotuloMedia} />
                  <Delta valor={b.pctInadimplencia} media={mediaInadimplencia} melhorMenor />
                </>
              }
            />
            <KpiBaixo
              icone={<Banknote size={13} strokeWidth={1.5} />}
              rotulo="Dívida no bairro"
              valor={brl(b.dividaTotal)}
              sub={`${num(b.exComDivida)} ex-clientes com dívida`}
              cor="var(--money-neg)"
            />
            {b.benchmarkPct !== null ? (
              <KpiBaixo
                icone={<Store size={13} strokeWidth={1.5} />}
                rotulo="Mercado · inadimplência"
                valor={pct(b.benchmarkPct)}
                sub="benchmark regional entre provedores"
              />
            ) : (
              <KpiBaixo
                tracejado
                icone={<Store size={13} strokeWidth={1.5} />}
                rotulo="Mercado · inadimplência"
                valor="aguardando benchmark"
                sub="disponível quando ≥3 provedores da região estiverem na plataforma — nenhum número é fabricado até lá"
                titulo={TITULO_BENCHMARK}
              />
            )}
          </div>

          <p style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 14, lineHeight: 1.5 }}>
            Fontes: IBGE CNEFE 2022 (domicílios) · ANEEL/Copel BDGD 2024 (UCs residenciais ativas) ·
            carteira (verdade contratual). “—” = sem match nas bases públicas; números impossíveis
            são suprimidos no servidor.
          </p>
        </>
      )}
    </div>
  );
}
