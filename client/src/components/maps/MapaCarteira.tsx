import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import { ESTADO_META, type EstadoPonto } from "./estado-ponto";
import { geoAproximada, GEO_PRECISAO_ROTULO, type GeoPrecisao } from "@shared/geo-precisao";

export type PontoMapa = {
  id: number; nome: string; lat: number; lon: number;
  /** Procedência da coordenada; `bairro` é aproximação (translúcido). */
  precisao?: GeoPrecisao | null;
  estado: EstadoPonto;
  emAberto: number; atraso: number;
  bairro: string | null; cidade: string;
};

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Nome e bairro vêm do banco — escapar antes de injetar no HTML do popup.
 *  Tolera ausência: resposta em cache de antes de o ponto carregar nome. */
function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;");
}

/* Blindagem de um bug do próprio Leaflet 1.9, que só aparece com renderer de
   canvas: `Canvas._updatePaths` roda `_redraw` síncrono no moveend e zera
   `_redrawRequest` SEM cancelar o requestAnimationFrame já agendado. Se o mapa
   for desmontado nesse intervalo — trocar de aba enquanto o fitBounds anima —,
   o frame órfão dispara com `_ctx` já apagado e estoura
   "Cannot read properties of undefined (reading 'save')".
   O guard é idempotente e vive no prototype: frame que chega depois do destroy
   vira no-op. */
const canvasProto = L.Canvas.prototype as unknown as {
  _redraw(this: { _ctx?: CanvasRenderingContext2D }): void;
  __redrawSeguro?: true;
};
if (!canvasProto.__redrawSeguro) {
  const redrawOriginal = canvasProto._redraw;
  canvasProto._redraw = function (this: { _ctx?: CanvasRenderingContext2D }) {
    if (!this._ctx) return;
    redrawOriginal.call(this);
  };
  canvasProto.__redrawSeguro = true;
}

/** Bolha da rede — onde e quantos. Sem nome de bairro, valor ou provedor:
 *  regra do dono (02/09/2026), dados da rede são só o ponto no mapa. */
export type BairroRede = {
  /** Só para o filtro de cidade; nunca exibida por ponto. */
  cidade: string;
  ocorrencias: number;
  lat: number | null; lon: number | null;
};

/** Ponto individual da rede — só a posição, já deslocada no servidor. */
export type PontoRedeItem = { cidade: string; lat: number; lon: number };

/** Escala de concentração da rede no bairro. */
export const FAIXAS_OCORRENCIA = [
  { label: '3 a 9 casos',   token: '--gated',  teste: (n: number) => n < 10 },
  { label: '10 a 24 casos', token: '--past',   teste: (n: number) => n >= 10 && n < 25 },
  { label: '25+ casos',     token: '--danger', teste: (n: number) => n >= 25 },
];

function corDoToken(token: string, reserva: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || reserva;
}

function corDaOcorrencia(n: number): string {
  const f = FAIXAS_OCORRENCIA.find(x => x.teste(n)) ?? FAIXAS_OCORRENCIA[0];
  return corDoToken(f.token, '#8C2F39');
}

export type CidadeMapa = {
  cidade: string; clientes: number; inadimplentes: number;
  dividaTotal: number; lat: number | null; lon: number | null;
};

export type ModoMapa = 'carteira' | 'regionalizacao';

export type SedeMapa = { cidade: string; uf: string | null; lat: number; lon: number };

/** Popup do ponto da carteira: quem é, em que estado, quanto deve. */
function popupDoPonto(p: PontoMapa): string {
  const meta = ESTADO_META[p.estado];
  const local = [p.bairro ? esc(p.bairro) : null, esc(p.cidade)].filter(Boolean).join(" · ");
  // Aproximação SEMPRE rotulada, como na referência: um endereço do bairro não
  // é a casa, e o operador que for até lá precisa saber disso antes de sair.
  const aproximacao = geoAproximada(p.precisao)
    ? `<div style="font-size:11px;color:var(--gated);margin:0 0 6px">⌖ localização aproximada (${GEO_PRECISAO_ROTULO.bairro.split(" ·")[0]})</div>`
    : "";
  return (
    `<div style="font-family:var(--font-sans);min-width:180px">` +
      `<div style="font-weight:600;font-size:13px;color:var(--text)">${esc(p.nome || "Sem nome")}</div>` +
      `<div style="font-size:11px;color:var(--text-2);margin:3px 0 7px;display:flex;align-items:center;gap:5px">` +
        `<span style="width:8px;height:8px;border-radius:50%;background:${meta.cor};display:inline-block;flex:none"></span>` +
        `${meta.label}</div>` +
      aproximacao +
      `<div style="font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--text)">` +
        `Dívida vencida: <b>${brl(p.emAberto)}</b></div>` +
      (p.atraso > 0
        ? `<div style="font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--text-2)">Atraso: ${p.atraso} d</div>`
        : "") +
      `<div style="font-size:11px;color:var(--text-faint);margin-top:5px">${local}</div>` +
    `</div>`
  );
}

export default function MapaCarteira({
  pontos, cidades = [], sede, modo = 'carteira', height = 480,
  calor = false, bairroFoco = null, bairrosRede = [], pontosRede = [], redePorPonto = false,
}: {
  pontos: PontoMapa[];
  /** Bairros agregados da rede — o desenho padrão do modo regionalização. */
  bairrosRede?: BairroRede[];
  /** Pontos individuais da rede, para quem quer ver a distribuição interna. */
  pontosRede?: PontoRedeItem[];
  /** Alterna o desenho da rede entre bolha por bairro e ponto por ocorrência. */
  redePorPonto?: boolean;
  cidades?: CidadeMapa[];
  sede?: SedeMapa | null;
  modo?: ModoMapa;
  /** Altura fixa. A referência usa 480 e o ranking ao lado fecha na mesma altura. */
  height?: number;
  /** Troca os marcadores por mancha de calor ponderada pela divida em aberto. */
  calor?: boolean;
  /** Bairro selecionado no ranking — o quadro fecha nele. */
  bairroFoco?: string | null;
}) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  // Renderer de canvas. Sem ele o Leaflet desenha um <path> SVG por ponto: com
  // a carteira inteira plotada são milhares de nós no DOM, e o mapa engasga a
  // cada zoom. Em canvas é um elemento só, e o custo para de crescer com o
  // número de clientes.
  const renderer = useRef<L.Canvas | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const camadaCalor = useRef<L.Layer | null>(null);
  const ultimoBounds = useRef<L.LatLngBounds | null>(null);
  const reenquadrar = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!div.current || mapa.current) return;
    // zoomSnap padrao e 1: o fitBounds so pode parar em zoom inteiro, e cada
    // passo dobra a escala, entao sobra ate 40% de folga e a carteira fica
    // pequena no meio do mapa. Com 0.1 o quadro encosta na regiao.
    mapa.current = L.map(div.current, { zoomControl: true, zoomSnap: 0.1 })
      .setView([-23.31, -50.16], 9);
    L.tileLayer("/api/tiles/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(mapa.current);
    renderer.current = L.canvas({ padding: 0.5 });
    camada.current = L.layerGroup().addTo(mapa.current);

    // Redimensionar a janela muda o quadro. Sem avisar o Leaflet, ele segue
    // com o tamanho antigo e o mapa fica cortado.
    const ro = new ResizeObserver(() => reenquadrar.current?.());
    ro.observe(div.current);

    return () => {
      ro.disconnect();
      // O calor sai ANTES do mapa: o plugin desenha no canvas do proprio mapa.
      camadaCalor.current?.remove();
      camadaCalor.current = null;
      mapa.current?.remove();
      mapa.current = null;
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapa.current || !camada.current) return;
    camada.current.clearLayers();
    camadaCalor.current?.remove();
    camadaCalor.current = null;

    const plotaveis: Array<{ lat: number | null; lon: number | null }> = modo === 'regionalizacao'
      ? (redePorPonto ? pontosRede : bairrosRede.filter(b => b.lat !== null && b.lon !== null))
      : pontos;
    // Sem ponto, mantem o enquadramento atual: geocodificar so para posicionar
    // um mapa vazio custaria uma volta de rede sem entregar nada.
    if (plotaveis.length === 0) return;

    // Calor e marcador nunca coexistem: sobrepostos, o marcador esconde
    // justamente a mancha que o operador ligou para ver.
    if (calor) {
      // Na carteira o peso é o valor em aberto de cada cliente; na rede é
      // quantos casos o bairro acumulou. Os dois desenham a mesma pergunta —
      // onde dói mais — com o dado que cada visão tem.
      const fonte: Array<[number, number, number]> = modo === 'regionalizacao'
        ? bairrosRede
            .filter(b => b.lat !== null && b.lon !== null)
            .map(b => [b.lat as number, b.lon as number, b.ocorrencias])
        : pontos.filter(p => p.emAberto > 0).map(p => [p.lat, p.lon, p.emAberto]);
      if (fonte.length > 0) {
        const maior = Math.max(...fonte.map(f => f[2]));
        camadaCalor.current = L.heatLayer(
          fonte.map(([la, lo, peso]) => [la, lo, maior > 0 ? peso / maior : 1] as [number, number, number]),
          // Raio maior na rede: cada ponto representa um bairro inteiro, não
          // uma casa, e um borrão apertado mentiria sobre a área coberta.
          { radius: modo === 'regionalizacao' ? 42 : 28, blur: modo === 'regionalizacao' ? 34 : 22, maxZoom: 16, max: 1, minOpacity: 0.25 },
        );
        // O leaflet.heat dimensiona o canvas no onAdd: container ainda sem
        // medida produz mancha invisivel.
        const tam = mapa.current.getSize();
        if (tam.x === 0 || tam.y === 0) mapa.current.invalidateSize({ animate: false });
        camadaCalor.current.addTo(mapa.current);
      }
    } else if (modo === 'regionalizacao' && redePorPonto) {
      // Um ponto por ocorrência: mostra como os casos se distribuem DENTRO do
      // bairro, que a bolha agregada esconde. Sem contorno branco — não é um
      // cliente seu, e a distinção visual importa.
      // Só o ponto: sem popup, sem faixa de valor, sem bairro. O que não sai
      // do servidor não pode ser lido aqui.
      const corPonto = corDoToken('--past', '#8C2F39');
      for (const p of pontosRede) {
        L.circleMarker([p.lat, p.lon], {
          renderer: renderer.current!,
          radius: 4.5, weight: 0,
          fillColor: corPonto, fillOpacity: 0.7,
          interactive: false,
        }).addTo(camada.current!);
      }
    } else if (modo === 'regionalizacao') {
      // A rede: uma bolha por BAIRRO, área proporcional ao número de casos.
      // Área e não raio — o olho compara área, e escalar o raio exagera o
      // bairro grande. Nenhum ponto individual: o centroide de três ou mais
      // ocorrências não é a casa de ninguém.
      const maior = Math.max(...bairrosRede.map(b => b.ocorrencias), 1);
      for (const b of bairrosRede) {
        if (b.lat === null || b.lon === null) continue;
        // Sem popup nem tooltip: a bolha é o dado inteiro — onde e quanto pesa.
        L.circleMarker([b.lat, b.lon], {
          renderer: renderer.current!,
          radius: 7 + Math.sqrt(b.ocorrencias / maior) * 16,
          weight: 1.5, color: "#fff",
          fillColor: corDaOcorrencia(b.ocorrencias), fillOpacity: 0.7,
          interactive: false,
        }).addTo(camada.current!);
      }
    } else {
      // Ponto FIXO de alto contraste, com traço branco — a magnitude da dívida
      // é papel do mapa de calor, não do raio (raio ∝ dívida virava mancha na
      // referência). A cor é o hex de ESTADO_META: o canvas não resolve var().
      for (const p of pontos) {
        L.circleMarker([p.lat, p.lon], {
          renderer: renderer.current!,
          radius: 6, weight: 1.5, color: "#FFFFFF",
          fillColor: ESTADO_META[p.estado].cor,
          // Aproximação de bairro é translúcida de propósito: rotulada, nunca
          // disfarçada de endereço exato.
          fillOpacity: geoAproximada(p.precisao) ? 0.55 : 0.95,
        })
          .bindPopup(popupDoPonto(p), { maxWidth: 280 })
          .addTo(camada.current!);
      }
    }

    // Sede: losango vazado, forma distinta dos circulos da carteira — ela nao e
    // um cliente e nao pode ser lida como um.
    if (sede) {
      L.marker([sede.lat, sede.lon], {
        icon: L.divIcon({
          className: "",
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          html:
            `<div style="width:14px;height:14px;transform:rotate(45deg);` +
            `background:var(--surface);border:2.5px solid var(--brand);` +
            `box-shadow:0 0 0 2px var(--surface)"></div>`,
        }),
        // Acima dos pontos: e a referencia, nao pode ficar soterrada.
        zIndexOffset: 1000,
      })
        .bindPopup(`<b>Sede</b><br>${esc(sede.cidade)}${sede.uf ? ` · ${esc(sede.uf)}` : ""}`)
        .bindTooltip(`Sede · ${sede.cidade}`, { direction: "top", offset: [0, -10] })
        .addTo(camada.current!);
    }

    // No modo carteira o quadro fecha nos clientes: a sede fica fora da area
    // atendida e puxaria o mapa para longe de quem paga. Na regionalizacao ela
    // entra, porque ali a pergunta e "onde eu atuo" e a matriz faz parte disso.
    // Bairro selecionado no ranking: o quadro fecha nele. Sem isto, clicar
    // numa linha do ranking mudava a lista e deixava o mapa exatamente onde
    // estava — o operador nao via para onde olhar.
    const doFoco = bairroFoco
      ? pontos.filter(p => p.bairro === bairroFoco)
      : [];
    const base = doFoco.length > 0 ? doFoco : plotaveis;

    const coords: Array<[number, number]> = base.map(
      p => [p.lat as number, ('lon' in p ? p.lon : 0) as number],
    );
    if (sede && modo === 'regionalizacao' && doFoco.length === 0) coords.push([sede.lat, sede.lon]);
    ultimoBounds.current = L.latLngBounds(coords);

    const enquadrar = () => {
      if (!mapa.current || !ultimoBounds.current) return;
      mapa.current.invalidateSize({ animate: false });
      // setView em vez de fitBounds: o fitBounds soma o padding dos dois lados
      // antes de medir e ainda arredonda por dentro, e sobrava ~40% de folga —
      // a carteira ficava pequena no meio de um mapa vazio. Calculando o zoom
      // aqui, o padding e exatamente o que esta escrito.
      const zoom = mapa.current.getBoundsZoom(ultimoBounds.current, false, L.point(24, 24));
      mapa.current.setView(
        ultimoBounds.current.getCenter(),
        Math.min(zoom, bairroFoco ? 16 : 14),
        { animate: false },
      );
    };
    reenquadrar.current = enquadrar;
    enquadrar();
    // A segunda passada pega o layout ja assentado.
    requestAnimationFrame(enquadrar);
  }, [pontos, bairrosRede, pontosRede, redePorPonto, cidades, modo, sede, calor, bairroFoco]);

  return (
    <div
      ref={div}
      style={{ height }}
      className="ds-mapa w-full rounded-lg overflow-hidden"
      data-testid="mapa-carteira"
    />
  );
}
