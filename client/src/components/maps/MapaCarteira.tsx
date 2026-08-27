import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

export type PontoMapa = {
  id: number; lat: number; lon: number;
  estado: 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';
  emAberto: number; atraso: number;
  bairro: string | null; cidade: string;
};

/** Le o token da pele em runtime — o mapa acompanha a troca de tema. */
function corDoEstado(estado: PontoMapa['estado']): string {
  const mapa: Record<PontoMapa['estado'], string> = {
    em_dia: '--ok', em_cobranca: '--gated', suspenso: '--brand', ex_divida: '--danger',
  };
  const v = getComputedStyle(document.documentElement).getPropertyValue(mapa[estado]).trim();
  return v || '#6B6878';
}

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

export type PontoRede = { lat: number; lng: number; count: number };

/** Ex-cliente com dívida de qualquer provedor. Sem nome, sem documento, sem
 *  provedor, sem valor exato — e com a coordenada deslocada no servidor. */
export type PontoRedeRegional = {
  ref: string; lat: number; lon: number; cidade: string;
  faixa: 'ate300' | 'de300a1000' | 'acima1000';
  atraso: 'ate6m' | 'de6ma1a' | 'acima1a';
};

export const FAIXA_REDE: Record<PontoRedeRegional['faixa'], { label: string; token: string }> = {
  ate300:      { label: 'até R$ 300',     token: '--gated' },
  de300a1000:  { label: 'R$ 300–1.000',   token: '--past' },
  acima1000:   { label: 'R$ 1.000+',      token: '--danger' },
};

const ATRASO_REDE: Record<PontoRedeRegional['atraso'], string> = {
  ate6m: 'até 6 meses', de6ma1a: '6 meses a 1 ano', acima1a: 'mais de 1 ano',
};

export type CidadeMapa = {
  cidade: string; clientes: number; inadimplentes: number;
  dividaTotal: number; lat: number | null; lon: number | null;
};

export type ModoMapa = 'carteira' | 'regionalizacao';

export type SedeMapa = { cidade: string; uf: string | null; lat: number; lon: number };

export default function MapaCarteira({
  pontos, cidades = [], sede, modo = 'carteira', rede, height,
  calor = false, bairroFoco = null, pontosRede = [],
}: {
  pontos: PontoMapa[];
  /** Ex-clientes com dívida de toda a rede — o desenho do modo regionalização. */
  pontosRede?: PontoRedeRegional[];
  cidades?: CidadeMapa[];
  sede?: SedeMapa | null;
  modo?: ModoMapa;
  rede?: PontoRede[];
  /** Altura fixa em px. Sem ela, a altura acompanha a largura (ver abaixo). */
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
  const camadaRede = useRef<L.LayerGroup | null>(null);
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
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(mapa.current);
    renderer.current = L.canvas({ padding: 0.5 });
    camada.current = L.layerGroup().addTo(mapa.current);

    // Com altura amarrada a largura, redimensionar a janela muda o quadro. Sem
    // avisar o Leaflet, ele segue com o tamanho antigo e o mapa fica cortado.
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
      ? pontosRede
      : pontos;
    // Sem ponto, mantem o enquadramento atual: geocodificar so para posicionar
    // um mapa vazio custaria uma volta de rede sem entregar nada.
    if (plotaveis.length === 0) return;

    // Calor e marcador nunca coexistem: sobrepostos, o marcador esconde
    // justamente a mancha que o operador ligou para ver.
    if (calor && modo === 'carteira') {
      const comDivida = pontos.filter(p => p.emAberto > 0);
      if (comDivida.length > 0) {
        const maior = Math.max(...comDivida.map(p => p.emAberto));
        camadaCalor.current = L.heatLayer(
          comDivida.map(p => [p.lat, p.lon, maior > 0 ? p.emAberto / maior : 1] as [number, number, number]),
          { radius: 28, blur: 22, maxZoom: 16, max: 1, minOpacity: 0.25 },
        );
        // O leaflet.heat dimensiona o canvas no onAdd: container ainda sem
        // medida produz mancha invisivel.
        const tam = mapa.current.getSize();
        if (tam.x === 0 || tam.y === 0) mapa.current.invalidateSize({ animate: false });
        camadaCalor.current.addTo(mapa.current);
      }
    } else if (modo === 'regionalizacao') {
      // A rede: um ponto por ex-cliente com dívida, de qualquer provedor. Sem
      // contorno branco — não é um cliente seu, e a distinção visual importa.
      for (const p of pontosRede) {
        const token = FAIXA_REDE[p.faixa].token;
        const cor = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#8C2F39';
        L.circleMarker([p.lat, p.lon], {
          renderer: renderer.current!,
          radius: 4.5, weight: 0,
          fillColor: cor, fillOpacity: 0.7,
        })
          .bindPopup(
            `<b>Ex-cliente com dívida</b><br>${p.cidade}<br>` +
            `${FAIXA_REDE[p.faixa].label} · atraso de ${ATRASO_REDE[p.atraso]}<br>` +
            `<span style="opacity:.7">local aproximado · provedor não identificado</span>`,
          )
          .addTo(camada.current!);
      }
    } else {
      for (const p of pontos) {
        L.circleMarker([p.lat, p.lon], {
          renderer: renderer.current!,
          radius: 5, weight: 1, color: "#fff",
          fillColor: corDoEstado(p.estado), fillOpacity: 0.9,
        })
          .bindPopup(
            `<b>${p.bairro || "Sem bairro"}</b><br>${p.cidade}<br>` +
            (p.emAberto > 0
              ? `${brl(p.emAberto)} em aberto · ${p.atraso}d`
              : "sem dívida em aberto"),
          )
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
        .bindPopup(`<b>Sede</b><br>${sede.cidade}${sede.uf ? ` · ${sede.uf}` : ""}`)
        .bindTooltip(`Sede · ${sede.cidade}`, { direction: "top", offset: [0, -10] })
        .addTo(camada.current!);
    }

    // No modo carteira o quadro fecha nos clientes: a sede fica fora da area
    // atendida e puxaria o mapa para longe de quem paga. Na regionalizacao ela
    // entra, porque ali a pergunta e "onde eu atuo" e a matriz faz parte disso.
    // Bairro selecionado no ranking: o quadro fecha nele. Sem isto, clicar
    // numa linha mudava a lista e deixava o mapa exatamente onde estava — o
    // operador nao via para onde olhar.
    const doFoco = bairroFoco
      ? pontos.filter(p => p.bairro === bairroFoco)
      : [];
    const base = doFoco.length > 0 ? doFoco : plotaveis;

    const coords: Array<[number, number]> = base.map(
      p => [p.lat as number, ('lon' in p ? p.lon : 0) as number],
    );
    if (sede && modo === 'regionalizacao' && doFoco.length === 0) coords.push([sede.lat, sede.lon]);
    ultimoBounds.current = L.latLngBounds(coords);

    // O dado chega antes de a altura por proporcao se resolver, entao o Leaflet
    // enquadrava para um container menor e ficava com zoom baixo demais — a
    // carteira parecia um punhado de pontos num mapa vazio. invalidateSize
    // atualiza o tamanho antes de medir, e o rAF repete depois do layout final.
    const enquadrar = () => {
      if (!mapa.current || !ultimoBounds.current) return;
      mapa.current.invalidateSize({ animate: false });
      // setView em vez de fitBounds: o fitBounds soma o padding dos dois lados
      // antes de medir e ainda arredonda por dentro, e sobrava ~40% de folga —
      // a carteira ficava pequena no meio de um mapa vazio. Calculando o zoom
      // aqui, o padding e exatamente o que esta escrito. Medido: a carteira
      // passou a ocupar 76% da largura e 95% da altura do quadro.
      const zoom = mapa.current.getBoundsZoom(ultimoBounds.current, false, L.point(24, 24));
      mapa.current.setView(
        ultimoBounds.current.getCenter(),
        Math.min(zoom, 14),
        { animate: false },
      );
    };
    reenquadrar.current = enquadrar;
    enquadrar();
    // O dado chega antes de a altura por proporcao se resolver; a segunda
    // passada pega o layout ja assentado.
    requestAnimationFrame(enquadrar);
  }, [pontos, pontosRede, cidades, modo, sede, calor, bairroFoco]);

  // Camada separada: liga e desliga sem redesenhar os pontos da carteira.
  useEffect(() => {
    if (!mapa.current) return;
    camadaRede.current?.remove();
    camadaRede.current = null;
    if (!rede?.length) return;

    camadaRede.current = L.layerGroup(
      rede.map(r => L.circle([r.lat, r.lng], {
        // Raio proporcional a concentracao, com teto para nao cobrir a cidade.
        radius: Math.min(4000, 400 + r.count * 40),
        weight: 0,
        fillColor: corDoEstado('suspenso'),
        fillOpacity: 0.14,
      })),
    ).addTo(mapa.current);
  }, [rede]);

  // Altura fixa deixava o mapa em faixa larga no monitor grande: fitBounds
  // preenche a altura e sobra vazio nas laterais, dando a impressao de que a
  // carteira e um punhado de pontos perdidos. Amarrando altura a largura, a
  // proporcao do quadro fica perto da proporcao da regiao e a area atendida
  // ocupa o mapa. Os limites evitam faixa fina no celular e mapa gigante no 4K.
  return (
    <div
      ref={div}
      style={height
        ? { height }
        : { aspectRatio: "3 / 2", minHeight: 420, maxHeight: 680 }}
      className="w-full rounded-lg overflow-hidden"
      data-testid="mapa-carteira"
    />
  );
}
