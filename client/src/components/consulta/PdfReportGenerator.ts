/**
 * O relatório de crédito em papel.
 *
 * Reescrito porque a versão anterior imprimia um documento DIFERENTE do que a
 * tela mostra: das sete seções, saíam cinco — e duas delas pela metade. Faltava
 * a 02 (o raciocínio por trás do Aprovar/Rejeitar) e a 04 inteira (equipamento
 * em comodato), justamente os dois pontos que um provedor arquiva para
 * justificar a decisão. O visual também era de outro produto: Arial e a paleta
 * padrão do Tailwind (#2563eb, #16a34a, #dc2626), que o DESIGN_SYSTEM.md lista
 * como proibida, com badge redondo e nenhum número tabular.
 *
 * As contas NÃO moram aqui. Vêm de `relatorio-dados.ts`, o mesmo módulo que a
 * tela usa — era a duplicação que deixava os dois divergirem em silêncio.
 *
 * Duas coisas que este arquivo não faz, de propósito:
 *  - não gera PDF: monta HTML e chama o diálogo de impressão do navegador, de
 *    onde sai "Salvar como PDF". É o que funciona sem dependência nova;
 *  - não traz o parecer do agente. O texto vive em estado local de
 *    `AiAnalysisSection` e nunca chega ao `ConsultaResult` — incluí-lo exige
 *    passá-lo por fora, e inventar um resumo seria pior que omitir.
 */
import type { ConsultaResult } from "./types";
import { formatCpfCnpj, escHtml } from "./utils";
import { derivarRelatorio, fmtCep, type Tom, type LinhaFonte } from "./relatorio-dados";
import { marcaAtual } from "@/lib/marca";

/* ── Tokens, com valor literal ──────────────────────────────────
   A janela de impressão é um documento novo: não herda o index.css, então
   var(--token) não resolve. Os hexes abaixo são os do :root, copiados na mão —
   se o index.css mudar, este bloco muda junto.

   EXCEÇÃO: os dois de MARCA vêm de `window.__MARCA__`. Sob white label um
   literal aqui faria o relatório do revendedor — o artefato que vai para o
   arquivo dele — sair com a cor da plataforma. É a paleta CLARA de propósito:
   o papel é sempre branco, e ler a cor do documento vivo devolveria a do tema
   ativo (no escuro, um lilás claro sobre fundo branco). Literais = fallback. */
function daMarca(qual: "ink" | "soft", reserva: string): string {
  const p = marcaAtual().paletaClara;
  return p ? p[qual] : reserva;
}

const T = {
  surface: "#FFFFFF",
  surface2: "#FAFAFC",
  border: "#EAEAF0",
  borderFaint: "#F2F2F6",
  text: "#1F1D29",
  text2: "#45414F",
  muted: "#6B6878",
  faint: "#726E80",
  brandInk: daMarca("ink", "#3A3658"),
  brandSoft: daMarca("soft", "#EDECF3"),
} as const;

/** Cada tom com a trinca cor/fundo/borda, como as pills da tela. */
const TOM: Record<Tom, { cor: string; bg: string; borda: string }> = {
  ok: { cor: "#1F7A4C", bg: "#E6F3EC", borda: "#B9DECB" },
  gated: { cor: "#A9741B", bg: "#FBF1DF", borda: "#E8D2A3" },
  past: { cor: "#8C2F39", bg: "#F9E8EA", borda: "#E4BCC1" },
  danger: { cor: "#B3261E", bg: "#FBE7E5", borda: "#F0C4BF" },
  info: { cor: "#3B6E96", bg: "#E9EFF5", borda: "#C3D5E4" },
  neutral: { cor: "#6B6878", bg: "#F1F1F5", borda: "#EAEAF0" },
};

/** As cinco faixas da barra de score, na ordem da régua. */
const FAIXAS = [
  { cor: TOM.danger.cor, largura: 30 },
  { cor: TOM.past.cor, largura: 20 },
  { cor: TOM.gated.cor, largura: 20 },
  { cor: TOM.info.cor, largura: 15 },
  { cor: TOM.ok.cor, largura: 15 },
];

const esc = (s: unknown) => escHtml(String(s ?? ""));

function pill(texto: string, tom: Tom): string {
  const t = TOM[tom];
  return `<span class="pill" style="color:${t.cor};background:${t.bg};border-color:${t.borda}">${esc(texto)}</span>`;
}

function kicker(texto: string): string {
  return `<div class="kicker">${esc(texto)}</div>`;
}

/** Tabela de 3 colunas das seções 04 e 05 — o mesmo desenho nas duas. */
function tabelaFonte(linhas: LinhaFonte[], colunas: [string, string, string]): string {
  return `<table class="t3">
    <thead><tr>${colunas.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${linhas.map(l => `<tr>
      <td><div class="mini">${esc(l.kicker)}</div><div class="forte">${esc(l.fonte)}</div></td>
      <td>${pill(l.chip, l.chipTom)}</td>
      <td><div class="forte">${esc(l.nome)}</div><div class="sub">${esc(l.linha)}</div></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

export function generatePDF(
  result: ConsultaResult,
  consultation?: { id?: number; cpfCnpjHash?: string; createdAt?: string } | null,
): string | null {
  const d = derivarRelatorio(result);

  const dt = consultation?.createdAt ? new Date(consultation.createdAt) : new Date();
  const dataHora = dt.toLocaleDateString("pt-BR") + " "
    + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const protocolo = consultation?.id
    ? `#CI-${dt.getFullYear()}-${String(consultation.id).padStart(5, "0")}`
    : null;
  const documento = result.searchType === "cep"
    ? fmtCep(result.cpfCnpj)
    : formatCpfCnpj(result.cpfCnpj);
  const custoLabel = result.creditsCost > 0
    ? `custo ${result.creditsCost} crédito${result.creditsCost > 1 ? "s" : ""}`
    : "sem custo";

  // A tela imprimia só o numerador ("1 provedor encontrado") e o papel perdia a
  // medida de cobertura: 1 em 2 e 1 em 12 são leituras muito diferentes, e é o
  // denominador que dá peso ao "nada consta" dos outros.
  const cobertura = `${d.provedoresComRegistro} de ${d.provedoresConsultados} provedor${d.provedoresConsultados === 1 ? "" : "es"} com registro`;

  const meta = [
    (result.searchType || "").toUpperCase(),
    dataHora,
    "Rede ISP colaborativa",
    cobertura,
    custoLabel,
  ].filter(Boolean).join(" · ");

  const marcador = Math.max(0, Math.min(100, d.score / 10));
  const tomFaixa = TOM[d.faixa.tom];

  /* ── 03 · Ocorrências (some na busca por CEP) ── */
  const secao03 = d.ehBuscaPorCep ? "" : `
  <section class="sec">
    <div class="sec-topo">${kicker("03 · Ocorrências na rede ISP")}
      <span class="trailing">Terceiros anonimizados · valores em faixa (LGPD)</span></div>
    <table class="t6">
      <!-- Larguras fixas: no automatico o navegador dava a coluna de valor so o
           espaco que sobrava, e o mono nao cabia. Espelham a grade da tela. -->
      <colgroup>
        <col style="width:24%"/><col style="width:20%"/><col style="width:15%"/>
        <col style="width:11%"/><col style="width:19%"/><col style="width:11%"/>
      </colgroup>
      <thead><tr>
        <th>Cliente</th><th>Fonte</th><th>Situação</th>
        <th>Atraso</th><th class="dir">Em aberto</th><th class="dir">Custo</th>
      </tr></thead>
      <tbody>${d.ocorrencias.map(o => `<tr>
        <td><div class="forte">${esc(o.cliente)}</div>${o.sub ? `<div class="sub aviso">${esc(o.sub)}</div>` : ""}</td>
        <td class="sub">${esc(o.fonte)}</td>
        <td>${pill(o.situacao, o.situacaoTom)}</td>
        <td class="num">${esc(o.atraso)}</td>
        <td class="num dir${o.valorNegativo ? " neg" : ""}">${esc(o.valor)}</td>
        <td class="num dir sub">${esc(o.custo)}</td>
      </tr>`).join("")}</tbody>
    </table>
  </section>`;

  /* ── 04 · Equipamento (some na busca por CEP) ── */
  const pillEquip: [string, Tom] = d.equipamentos === 0
    ? ["Sem ocorrência", "ok"]
    : d.parceiros.find(p => p.hasUnreturnedEquipment)?.equipmentSignalValidated
      ? ["Ocorrência validada", "gated"]
      : ["Ocorrência registrada", "danger"];

  const secao04 = d.ehBuscaPorCep ? "" : `
  <section class="sec">
    <div class="sec-topo">${kicker("04 · Equipamento em comodato")}
      ${pill(pillEquip[0], pillEquip[1])}</div>
    ${tabelaFonte(d.equipamentoLinhas, ["Fonte", "Situação", "Registro"])}
  </section>`;

  /* ── 05 · Endereço (sempre aparece) ── */
  const listaEndereco = d.enderecoComDivida.length > 0 ? `
    <ul class="lista">${d.enderecoComDivida.map(m => {
      const atraso = m.daysOverdue != null ? `${m.daysOverdue} dias` : (m.daysOverdueRange || "Inadimplente");
      const local = [m.address, m.city, m.state].filter(Boolean).map(esc).join(", ");
      return `<li><span class="forte">${esc(m.customerName)}</span> — ${local} — <span class="num neg">${esc(atraso)}</span></li>`;
    }).join("")}</ul>` : "";

  const secao05 = `
  <section class="sec">
    <div class="sec-topo">${kicker("05 · Verificação por endereço")}
      ${result.autoAddressCrossRef ? `<span class="chip-marca">Cruzamento automático</span>` : ""}</div>
    ${tabelaFonte(d.enderecoLinhas, ["Fonte", "Situação", "Cadastros no endereço"])}
    ${listaEndereco}
  </section>`;

  /* ── 06 / 07 — no papel são incondicionais: um relatório arquivado precisa
        dizer "nenhum alerta" em vez de simplesmente não ter a seção. ── */
  const alertas = (result.alerts ?? []).length > 0
    ? (result.alerts ?? []).map(a => `<li>${esc(a)}</li>`).join("")
    : `<li class="sub">Nenhum alerta ativo para este documento.</li>`;
  const acoes = (result.recommendedActions ?? []).length > 0
    ? (result.recommendedActions ?? []).map(a => `<li>${esc(a)}</li>`).join("")
    : `<li class="sub">Prosseguir conforme a política do provedor.</li>`;

  const rodape = [
    "Dados de terceiros anonimizados conforme LGPD",
    result.controlador ? `Controlador: ${esc(result.controlador)}` : null,
    "Finalidade: proteção ao crédito",
  ].filter(Boolean).join(" · ");
  const hash = consultation?.cpfCnpjHash
    ? `hash de auditoria ${esc(consultation.cpfCnpjHash.slice(0, 4))}…${esc(consultation.cpfCnpjHash.slice(-4))}`
    : "";

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Relatório de crédito ISP — ${esc(documento)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* A folha nunca segue o tema do sistema: relatório impresso é sempre claro. */
  :root { color-scheme: light; }
  *{box-sizing:border-box;margin:0;padding:0}

  /* Sem isto o navegador descarta TODO fundo tintado na impressão — o cabeçalho
     de tabela, as pills de estado e a barra de score sairiam brancos, e um
     relatório que comunica risco por cor viraria uma folha ilegível. */
  html,body,*{-webkit-print-color-adjust:exact;print-color-adjust:exact}

  body{
    font-family:"Inter",ui-sans-serif,system-ui,sans-serif;
    font-size:12px;line-height:1.5;color:${T.text};background:${T.surface};
    padding:0;
  }
  .doc{max-width:820px;margin:0 auto;padding:24px}

  /* Todo numero e mono e tabular — coluna desalinhada destroi a leitura.
     O nowrap existe porque o mono e largo: sem ele "90+ dias" partia em duas
     linhas e "R$ 500 - R$ 1.000" tambem, desalinhando a coluna inteira. */
  .num,.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .num{white-space:nowrap}

  .kicker{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;font-weight:600;
    text-transform:uppercase;letter-spacing:.06em;color:${T.faint}}
  .trailing{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:500;
    text-transform:uppercase;letter-spacing:.06em;color:${T.muted}}

  header{border-bottom:1px solid ${T.border};padding-bottom:14px;margin-bottom:0}
  .topo-linha{display:flex;align-items:center;gap:10px}
  .protocolo{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;
    font-variant-numeric:tabular-nums;color:${T.muted}}
  .documento{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:26px;font-weight:600;
    font-variant-numeric:tabular-nums;letter-spacing:.01em;margin-top:6px;color:${T.text}}
  .meta{font-size:11px;color:${T.muted};margin-top:4px}

  .sec{border-top:1px solid ${T.border};padding:16px 0}
  .sec-topo{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}

  /* Badge de status é RETANGULAR — 4-6px. Pill redonda é anti-padrão do DS. */
  .pill{display:inline-block;font-family:"IBM Plex Mono",ui-monospace,monospace;
    font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
    font-variant-numeric:tabular-nums;padding:3px 8px;border-radius:6px;border:1px solid}
  .chip-marca{display:inline-block;font-family:"IBM Plex Mono",ui-monospace,monospace;
    font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
    padding:3px 8px;border-radius:5px;background:${T.brandSoft};color:${T.brandInk}}

  /* 01 · Score */
  .score-linha{display:flex;align-items:baseline;gap:6px;margin-top:10px}
  .score{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:42px;font-weight:600;
    line-height:1;font-variant-numeric:tabular-nums;color:${T.text}}
  .score-de{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;color:${T.muted}}
  .faixa{display:inline-flex;align-items:center;gap:7px;margin-top:8px;
    font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
    text-transform:uppercase;letter-spacing:.06em;color:${T.text2}}
  .dot{width:8px;height:8px;border-radius:9999px;display:inline-block}
  .barra{position:relative;display:flex;gap:2px;height:6px;margin-top:12px}
  .barra i{display:block;height:6px;border-radius:2px}
  .marcador{position:absolute;top:-4px;width:2px;height:14px;background:${T.text}}
  .regua{display:flex;justify-content:space-between;margin-top:5px;
    font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;
    font-variant-numeric:tabular-nums;color:${T.faint}}

  /* 02 · Sugestão */
  .decisao{display:flex;align-items:center;gap:9px;margin-top:10px}
  .decisao b{font-size:14px;font-weight:600;letter-spacing:-.02em;color:${T.text}}
  .subtitulo{font-size:12px;color:${T.text2};margin-top:7px;max-width:62ch}
  .tiles{display:flex;gap:20px;margin-top:12px;flex-wrap:wrap}
  .tile .k{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:600;
    text-transform:uppercase;letter-spacing:.06em;color:${T.faint}}
  .tile .v{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:16px;font-weight:600;
    font-variant-numeric:tabular-nums;color:${T.text};margin-top:3px}

  table{width:100%;border-collapse:collapse;font-size:11.5px}
  th{background:${T.surface2};text-align:left;padding:7px 9px;
    font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:600;
    text-transform:uppercase;letter-spacing:.06em;color:${T.muted};
    border-top:1px solid ${T.border};border-bottom:1px solid ${T.border}}
  td{padding:8px 9px;border-bottom:1px solid ${T.borderFaint};color:${T.text2};vertical-align:top}
  .dir{text-align:right}
  .forte{font-size:12.5px;font-weight:600;color:${T.text}}
  .mini{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:600;
    text-transform:uppercase;letter-spacing:.06em;color:${T.faint};margin-bottom:2px}
  .sub{font-size:11px;color:${T.muted}}
  .aviso{color:${TOM.gated.cor}}
  .neg{color:${TOM.past.cor}}

  .duo{display:flex;gap:28px;border-top:1px solid ${T.border};padding-top:16px;margin-top:16px}
  .duo>div{flex:1}
  .lista{list-style:none;margin-top:10px}
  .lista li,.duo li{font-size:12px;color:${T.text2};margin-bottom:5px;padding-left:14px;position:relative}
  .lista li:before,.duo li:before{content:"·";position:absolute;left:3px;color:${T.brandInk};font-weight:700}

  footer{border-top:1px solid ${T.border};background:${T.surface2};
    margin-top:18px;padding:11px 14px;display:flex;justify-content:space-between;
    gap:12px;font-size:10.5px;color:${T.muted}}
  footer .mono{font-size:10px;color:${T.faint}}

  @page{size:A4;margin:14mm}
  @media print{
    .doc{max-width:none;padding:0}
    /* Uma seção nunca começa no fim da folha nem parte a tabela ao meio. */
    .sec,footer{break-inside:avoid;page-break-inside:avoid}
    tr,li{break-inside:avoid;page-break-inside:avoid}
    thead{display:table-header-group}
  }
</style></head><body><div class="doc">

<header>
  <div class="topo-linha">
    ${kicker("Relatório de crédito ISP")}
    ${protocolo ? `<span class="protocolo">${esc(protocolo)}</span>` : ""}
  </div>
  <div class="documento">${esc(documento)}</div>
  <div class="meta">${esc(meta)}</div>
</header>

<section class="sec" style="border-top:none">
  ${kicker("01 · Score de crédito")}
  <div class="score-linha"><span class="score">${d.score}</span><span class="score-de">/1000</span></div>
  <div class="faixa"><span class="dot" style="background:${tomFaixa.cor}"></span>${esc(d.faixa.label)}</div>
  <div class="barra">
    ${FAIXAS.map((f, i) => `<i style="width:${f.largura}%;background:${f.cor};opacity:${i === d.faixa.indice ? 1 : 0.22}"></i>`).join("")}
    <span class="marcador" style="left:${marcador}%"></span>
  </div>
  <div class="regua"><span>0</span><span>300</span><span>500</span><span>700</span><span>850</span><span>1000</span></div>
</section>

<section class="sec">
  <div class="sec-topo">${kicker("02 · Sugestão de ação")}
    <span class="trailing">A decisão final é sua</span></div>
  <div class="decisao">${pill(d.decisao.curto, d.decisao.tom)}<b>${esc(d.decisao.titulo)}</b></div>
  <div class="subtitulo">${esc(d.subtitulo)}</div>
  <div class="tiles">
    <div class="tile"><div class="k">Provedores com registro</div><div class="v">${d.provedoresComRegistro}</div></div>
    <div class="tile"><div class="k">Ocorrências ativas</div><div class="v">${d.ativas}</div></div>
    <div class="tile"><div class="k">Equipamentos pendentes</div><div class="v">${d.equipamentos}</div></div>
    <div class="tile"><div class="k">Débito estimado</div><div class="v${d.debito.temDebito ? " neg" : ""}">${esc(d.debito.texto)}</div></div>
  </div>
</section>
${secao03}
${secao04}
${secao05}

<div class="duo">
  <div>${kicker("06 · Alertas")}<ul class="lista">${alertas}</ul></div>
  <div>${kicker("07 · Ações recomendadas")}<ul class="lista">${acoes}</ul></div>
</div>

<footer>
  <span>${rodape}</span>
  ${hash ? `<span class="mono">${hash}</span>` : ""}
</footer>

</div></body></html>`;
}
