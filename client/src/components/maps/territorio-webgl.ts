/**
 * PontosWebGL — L.Layer que desenha N pontos fixos com WebGL puro
 * (gl.POINTS de um Float32Array estático na GPU).
 *
 * Por que não leaflet.glify: embute hit-testing por ponto, polígonos GeoJSON
 * e re-upload de buffer que não precisamos. Aqui o buffer sobe para a GPU uma
 * vez no addTo; pan e zoom são atualização de uniforms e um draw call — a CPU
 * não cresce com o número de pontos, e 500 mil seguem fluidos.
 *
 * Precisão: as coordenadas viram Web Mercator normalizado [0..1] RELATIVO ao
 * centro dos dados, calculado em float64. Em float32 absoluto o jitter chega a
 * ~3 px no zoom 18; relativo fica abaixo de 0,01 px.
 *
 * O padrão de canvas e de animação de zoom é o do leaflet.heat, que já roda
 * neste mapa: canvas do tamanho do viewport reposicionado em 'move', e CSS
 * transform via zoomanim durante a animação.
 */

import L from "leaflet";

export const PANE_TERRITORIO = "territorio";
/* Entre tilePane (200) e overlayPane (400): fundo fixo SOB os clientes. */
export const PANE_TERRITORIO_Z = "350";

const VERT_SRC = `
attribute vec2 a_pos;
uniform float u_scale;
uniform vec2 u_translate;
uniform vec2 u_resolution;
uniform float u_size;
void main() {
  vec2 px = a_pos * u_scale + u_translate;
  vec2 clip = px / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const FRAG_SRC = `
precision mediump float;
uniform vec4 u_cor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = u_cor;
}`;

export interface PontosWebGLOptions {
  /** RGB 0–255. */
  cor: [number, number, number];
  /** Alpha em zoom de cidade — o acúmulo desenha a malha urbana (padrão 0,5). */
  alpha?: number;
  /** Diâmetro em px CSS em zoom de cidade (padrão 2). */
  tamanho?: number;
}

/* Rampa de zoom: em zoom de rua os pontos de 2 px somem. Até ZOOM_CIDADE
   valem o tamanho e o alpha base — discretos, em massa desenham a malha;
   crescem linear até ZOOM_RUA, onde ficam visíveis um a um mas SEMPRE menores
   que os marcadores de clientes (Ø 12 px com anel branco, no pane acima). */
const ZOOM_CIDADE = 13;
const ZOOM_RUA = 16;
const TAMANHO_RUA = 7;
const ALPHA_RUA = 0.8;

function rampaZoom(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - ZOOM_CIDADE) / (ZOOM_RUA - ZOOM_CIDADE)));
}

/* Métodos internos do Leaflet usados pelo padrão de zoom-anim do leaflet.heat. */
interface MapInterna extends L.Map {
  _getCenterOffset(c: L.LatLng): L.Point;
  _getMapPanePos(): L.Point;
}

interface ZoomAnimEvento extends L.LeafletEvent {
  center: L.LatLng;
  zoom: number;
}

function compilar(gl: WebGLRenderingContext, tipo: number, src: string): WebGLShader {
  const sh = gl.createShader(tipo);
  if (!sh) throw new Error("WebGL: createShader falhou");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`WebGL: shader não compilou — ${gl.getShaderInfoLog(sh) ?? "?"}`);
  }
  return sh;
}

/** Cria o pane do território uma vez por mapa. Sem eventos de mouse: é fundo. */
export function garantirPaneTerritorio(map: L.Map): HTMLElement {
  let pane = map.getPane(PANE_TERRITORIO);
  if (!pane) {
    pane = map.createPane(PANE_TERRITORIO);
    pane.style.zIndex = PANE_TERRITORIO_Z;
    pane.style.pointerEvents = "none";
  }
  return pane;
}

export class PontosWebGL extends L.Layer {
  private readonly _relativos: Float32Array; // mercator [0..1] − origem, intercalado x,y
  private readonly _origemX: number;
  private readonly _origemY: number;
  private readonly _n: number;
  private readonly _corBase: [number, number, number]; // RGB normalizado 0–1
  private readonly _alphaBase: number;
  private readonly _tamanhoBase: number;

  private _canvas: HTMLCanvasElement | null = null;
  private _gl: WebGLRenderingContext | null = null;
  private _programa: WebGLProgram | null = null;
  private _uniforms: Record<string, WebGLUniformLocation | null> = {};

  /** latlons = Float32Array intercalado [lat, lon, ...] (formato da rota). */
  constructor(latlons: Float32Array, opts: PontosWebGLOptions) {
    super();
    this._alphaBase = opts.alpha ?? 0.5;
    this._tamanhoBase = opts.tamanho ?? 2;
    this._corBase = [opts.cor[0] / 255, opts.cor[1] / 255, opts.cor[2] / 255];

    this._n = Math.floor(latlons.length / 2);

    // Passo 1: bounds em mercator (float64) → origem = centro dos dados.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const PI = Math.PI;
    for (let i = 0; i < this._n; i++) {
      const lat = Math.max(-85, Math.min(85, latlons[i * 2]));
      const lon = latlons[i * 2 + 1];
      const x = lon / 360 + 0.5;
      const s = Math.sin((lat * PI) / 180);
      const y = 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / PI;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this._origemX = this._n > 0 ? (minX + maxX) / 2 : 0.5;
    this._origemY = this._n > 0 ? (minY + maxY) / 2 : 0.5;

    // Passo 2: coordenadas relativas (extensão municipal ~1e-3 → float32 sobra).
    this._relativos = new Float32Array(this._n * 2);
    for (let i = 0; i < this._n; i++) {
      const lat = Math.max(-85, Math.min(85, latlons[i * 2]));
      const lon = latlons[i * 2 + 1];
      const s = Math.sin((lat * PI) / 180);
      this._relativos[i * 2] = lon / 360 + 0.5 - this._origemX;
      this._relativos[i * 2 + 1] = 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / PI - this._origemY;
    }
  }

  get contagem(): number {
    return this._n;
  }

  override onAdd(map: L.Map): this {
    const pane = garantirPaneTerritorio(map);
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._canvas.style.transformOrigin = "50% 50%";
      this._canvas.style.position = "absolute";
      this._initGl();
    }
    pane.appendChild(this._canvas);
    this._reset();
    return this;
  }

  override onRemove(): this {
    // O canvas sai do DOM, mas contexto e buffer ficam: religar a pill é barato.
    this._canvas?.remove();
    return this;
  }

  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } {
    const eventos: { [name: string]: L.LeafletEventHandlerFn } = {
      move: this._reset,
      moveend: this._reset,
      zoomend: this._reset,
      viewreset: this._reset,
      resize: this._reset,
    };
    if (this._map && this._map.options.zoomAnimation && L.Browser.any3d) {
      eventos.zoomanim = this._animateZoom as L.LeafletEventHandlerFn;
    }
    return eventos;
  }

  /* ---- internos ---- */

  private _initGl(): void {
    if (!this._canvas) return;
    const gl = this._canvas.getContext("webgl", {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: true,
    });
    if (!gl) return; // sem WebGL a camada vira no-op; a pill já está desabilitada

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, compilar(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compilar(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`WebGL: link falhou — ${gl.getProgramInfoLog(prog) ?? "?"}`);
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, this._relativos, gl.STATIC_DRAW); // GPU, uma vez
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // cor premultiplicada

    for (const u of ["u_scale", "u_translate", "u_resolution", "u_size", "u_cor"]) {
      this._uniforms[u] = gl.getUniformLocation(prog, u);
    }
    this._gl = gl;
    this._programa = prog;
  }

  private readonly _reset = (): void => {
    const map = this._map;
    const canvas = this._canvas;
    if (!map || !canvas) return;

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    const sz = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(sz.x * dpr);
    const h = Math.round(sz.y * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${sz.x}px`;
      canvas.style.height = `${sz.y}px`;
    }
    this._draw();
  };

  private _draw(): void {
    const gl = this._gl;
    const map = this._map;
    const canvas = this._canvas;
    if (!gl || !map || !canvas || !this._programa || this._n === 0) return;

    const sz = map.getSize();
    const scale = map.options.crs?.scale(map.getZoom()) ?? 256 * 2 ** map.getZoom();
    const viewMin = map.getPixelBounds().min;
    if (!viewMin) return;
    // A translação sai em float64 na CPU; só o resíduo pequeno vai ao shader.
    const tx = this._origemX * scale - viewMin.x;
    const ty = this._origemY * scale - viewMin.y;

    const t = rampaZoom(map.getZoom());
    const tamanho = this._tamanhoBase + (TAMANHO_RUA - this._tamanhoBase) * t;
    const alpha = this._alphaBase + (ALPHA_RUA - this._alphaBase) * t;
    const [r, g, b] = this._corBase;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(this._uniforms.u_scale, scale);
    gl.uniform2f(this._uniforms.u_translate, tx, ty);
    gl.uniform2f(this._uniforms.u_resolution, sz.x, sz.y);
    gl.uniform1f(this._uniforms.u_size, tamanho * (window.devicePixelRatio || 1));
    gl.uniform4f(this._uniforms.u_cor, r * alpha, g * alpha, b * alpha, alpha); // premultiplicado
    gl.drawArrays(gl.POINTS, 0, this._n);
  }

  /* Transform CSS durante a animação de zoom — o mesmo padrão do leaflet.heat. */
  private readonly _animateZoom = (e: L.LeafletEvent): void => {
    const map = this._map as MapInterna | undefined;
    const canvas = this._canvas;
    if (!map || !canvas) return;
    const ev = e as ZoomAnimEvento;
    const scale = map.getZoomScale(ev.zoom);
    const offset = map
      ._getCenterOffset(ev.center)
      .multiplyBy(-scale)
      .subtract(map._getMapPanePos());
    L.DomUtil.setTransform(canvas, offset, scale);
  };
}
