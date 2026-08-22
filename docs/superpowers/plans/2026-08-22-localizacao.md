# Localização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela só de Localização — mapa da carteira colorido por estado do cliente, filtros, legenda e ranking de bairros — recortada pela região que o provedor declara atender.

**Architecture:** Uma cascata resolve a área atendida (cidades → mesorregião → UF → tudo) e vira a única fonte do recorte territorial. O estado do ponto sai do valor da dívida, não de string de status, porque a coluna `payment_status` tem dois vocabulários. Um endpoint devolve pontos, bairros, cidades e contagem sem coordenada numa varredura; os filtros são estado local na tela.

**Tech Stack:** Express 5, Drizzle ORM, PostgreSQL, React 18 + TanStack Query, Leaflet 1.9 + leaflet.heat, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-22-localizacao-design.md`

## Global Constraints

- **NÃO alterar `shared/schema.ts`.** Regra do CLAUDE.md. `providers.cidadesAtendidas`, `providers.mesorregioes`, `customers.neighborhood`, `latitude`, `longitude`, `status`, `totalOverdueAmount` já existem.
- **Multi-tenant:** toda query filtra por `providerId` da sessão.
- **NUNCA derivar estado de `paymentStatus`.** A coluna tem dois vocabulários: `current`/`overdue` escritos por `upsertFromErp` e faixas `31-60`/`61-90`/`90+` escritas pelo seed. Use `totalOverdueAmount > 0`.
- **Sem penetração, HPs ou UCs.** Dependem de IBGE CNEFE e ANEEL BDGD, ausentes no projeto. Omitir campo, nunca estimar.
- **Testes são de função pura** — o repo não tem integração com banco. Lógica arriscada vira função pura; a camada de banco fica fina.
- **Português brasileiro** na interface.
- Testes: `npm test`. Typecheck: `npm run check` — baseline **112 erros pré-existentes**; acima disso é regressão sua.

---

### Task 1: Cascata da área atendida

**Files:**
- Create: `server/services/area-atendida.ts`
- Test: `server/services/area-atendida.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `escolherArea(...)` (pura) e `resolverAreaAtendida(providerId)` (com banco). Tasks 3 e 4 usam.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// server/services/area-atendida.test.ts
import { describe, it, expect } from 'vitest';
import { escolherArea } from './area-atendida';

const cidadesDaMeso = (m: string[]) => m.includes('Norte Central Paranaense')
  ? ['Londrina', 'Ibiporã', 'Cambé'] : [];

describe('escolherArea', () => {
  it('usa cidadesAtendidas quando preenchido', () => {
    const r = escolherArea(['Londrina', 'Ibiporã'], ['Norte Central Paranaense'], 'PR', cidadesDaMeso);
    expect(r).toEqual({ cidades: ['Londrina', 'Ibiporã'], origem: 'cidades' });
  });

  it('cai para as cidades da mesorregiao quando cidadesAtendidas esta vazio', () => {
    const r = escolherArea([], ['Norte Central Paranaense'], 'PR', cidadesDaMeso);
    expect(r.origem).toBe('meso');
    expect(r.cidades).toEqual(['Londrina', 'Ibiporã', 'Cambé']);
  });

  it('cai para a UF quando nao ha cidade nem mesorregiao', () => {
    expect(escolherArea([], [], 'PR', cidadesDaMeso)).toEqual({ cidades: null, uf: 'PR', origem: 'uf' });
  });

  it('nao filtra quando nao ha cidade, meso nem UF — caso da NsLink hoje', () => {
    expect(escolherArea([], [], null, cidadesDaMeso)).toEqual({ cidades: null, uf: null, origem: 'nenhuma' });
  });

  it('trata null como vazio', () => {
    expect(escolherArea(null, null, null, cidadesDaMeso).origem).toBe('nenhuma');
  });

  it('cai para UF quando a mesorregiao nao resolve nenhuma cidade', () => {
    expect(escolherArea([], ['Mesorregiao Inexistente'], 'PR', cidadesDaMeso).origem).toBe('uf');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run server/services/area-atendida.test.ts`
Expected: FAIL — `Failed to resolve import "./area-atendida"`

- [ ] **Step 3: Implementar**

```ts
// server/services/area-atendida.ts
import citiesData from "../../shared/data/cidades-brasil.json";
import { storage } from "../storage";

/**
 * Recorte territorial do provedor.
 *
 * O sistema e regional: o dado tem aderencia regional. Antes disto as queries
 * de territorio filtravam por providers.addressState — e a NsLink tem UF NULA,
 * entao nao filtrava nada, apesar de ter 46 cidades atendidas configuradas.
 *
 * `cidades: null` significa "sem filtro por cidade". `origem` alimenta o aviso
 * na tela, para o provedor entender o recorte que esta vendo.
 */

export type OrigemArea = 'cidades' | 'meso' | 'uf' | 'nenhuma';

export interface AreaAtendida {
  cidades: string[] | null;
  uf?: string | null;
  origem: OrigemArea;
}

/** Cidades de uma lista de mesorregioes, a partir de cidades-brasil.json. */
export function cidadesDasMesorregioes(mesos: string[]): string[] {
  if (!mesos.length) return [];
  const alvo = new Set(mesos.map(m => m.trim().toLowerCase()));
  return (citiesData as Array<{ nome: string; mesorregiao: string }>)
    .filter(c => alvo.has((c.mesorregiao || "").trim().toLowerCase()))
    .map(c => c.nome);
}

/** A cascata, isolada do banco para ser testavel. */
export function escolherArea(
  cidadesAtendidas: string[] | null | undefined,
  mesorregioes: string[] | null | undefined,
  uf: string | null | undefined,
  resolverMeso: (m: string[]) => string[] = cidadesDasMesorregioes,
): AreaAtendida {
  const cidades = (cidadesAtendidas || []).filter(Boolean);
  if (cidades.length > 0) return { cidades, origem: 'cidades' };

  const mesos = (mesorregioes || []).filter(Boolean);
  if (mesos.length > 0) {
    const daMeso = resolverMeso(mesos);
    if (daMeso.length > 0) return { cidades: daMeso, origem: 'meso' };
  }

  if (uf) return { cidades: null, uf, origem: 'uf' };

  return { cidades: null, uf: null, origem: 'nenhuma' };
}

export async function resolverAreaAtendida(providerId: number): Promise<AreaAtendida> {
  const p = await storage.getProvider(providerId);
  return escolherArea(p?.cidadesAtendidas, p?.mesorregioes, p?.addressState);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run server/services/area-atendida.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 5: Commit**

```bash
git add server/services/area-atendida.ts server/services/area-atendida.test.ts
git commit -m "feat(localizacao): cascata da area atendida (cidades > meso > uf)"
```

---

### Task 2: Estado do ponto

**Files:**
- Create: `server/services/estado-ponto.ts`
- Test: `server/services/estado-ponto.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `estadoDoPonto(c): EstadoPonto` e `ESTADO_META`. Tasks 4 e 6 usam.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// server/services/estado-ponto.test.ts
import { describe, it, expect } from 'vitest';
import { estadoDoPonto } from './estado-ponto';

const c = (o: Record<string, any> = {}) => ({
  status: 'active', totalOverdueAmount: '0', ...o,
});

describe('estadoDoPonto', () => {
  it('ativo sem divida e em dia', () => {
    expect(estadoDoPonto(c())).toBe('em_dia');
  });

  it('ativo com divida esta em cobranca', () => {
    expect(estadoDoPonto(c({ totalOverdueAmount: '150.00' }))).toBe('em_cobranca');
  });

  it('inativo com divida e ex-cliente com divida', () => {
    expect(estadoDoPonto(c({ status: 'inactive', totalOverdueAmount: '900' }))).toBe('ex_divida');
  });

  it('cancelled com divida tambem e ex-cliente com divida', () => {
    expect(estadoDoPonto(c({ status: 'cancelled', totalOverdueAmount: '900' }))).toBe('ex_divida');
  });

  it('inativo sem divida nao vira ex_divida', () => {
    expect(estadoDoPonto(c({ status: 'inactive' }))).toBe('em_dia');
  });

  it('suspenso tem estado proprio', () => {
    expect(estadoDoPonto(c({ status: 'suspended' }))).toBe('suspenso');
  });

  // O bug que motivou derivar de valor: payment_status tem dois vocabularios.
  it('ignora payment_status em faixa e usa o valor da divida', () => {
    expect(estadoDoPonto(c({ paymentStatus: '90+', totalOverdueAmount: '500' }))).toBe('em_cobranca');
    expect(estadoDoPonto(c({ paymentStatus: '90+', totalOverdueAmount: '0' }))).toBe('em_dia');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run server/services/estado-ponto.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

```ts
// server/services/estado-ponto.ts

/**
 * Estado visual do cliente no mapa.
 *
 * Derivado do VALOR da divida, nunca de payment_status: aquela coluna tem dois
 * vocabularios — 'current'/'overdue' escritos por upsertFromErp e faixas
 * '31-60'/'61-90'/'90+' escritas pelo seed. Filtrar por string quebra para
 * metade das linhas; o valor e verdade unica.
 */

export type EstadoPonto = 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';

const INATIVOS = ['inactive', 'cancelled'];

export function estadoDoPonto(c: {
  status?: string | null;
  totalOverdueAmount?: string | number | null;
}): EstadoPonto {
  const divida = Number(c.totalOverdueAmount || 0);
  const temDivida = !Number.isNaN(divida) && divida > 0;
  const st = (c.status || "").toLowerCase();

  if (INATIVOS.includes(st) && temDivida) return 'ex_divida';
  if (st === 'suspended') return 'suspenso';
  return temDivida ? 'em_cobranca' : 'em_dia';
}

/** Rotulo e token de cor. Alto contraste entre si — a referencia alerta que
    tons quentes proximos viram o mesmo borrao no mapa. */
export const ESTADO_META: Record<EstadoPonto, { label: string; token: string }> = {
  em_dia:      { label: 'Ativo em dia',          token: '--ok' },
  em_cobranca: { label: 'Em cobrança',           token: '--gated' },
  suspenso:    { label: 'Suspenso',              token: '--brand' },
  ex_divida:   { label: 'Ex-cliente com dívida', token: '--danger' },
};

export const ESTADO_ORDEM: EstadoPonto[] = ['em_dia', 'em_cobranca', 'suspenso', 'ex_divida'];
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run server/services/estado-ponto.test.ts`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
git add server/services/estado-ponto.ts server/services/estado-ponto.test.ts
git commit -m "feat(localizacao): estado do ponto derivado do valor da divida"
```

---

### Task 3: Query única do território

**Files:**
- Create: `server/storage/localizacao.storage.ts`
- Modify: `server/storage/index.ts` (interface + delegação)

**Interfaces:**
- Consumes: `resolverAreaAtendida` (Task 1), `estadoDoPonto` (Task 2)
- Produces: `storage.getLocalizacao(providerId)` devolvendo `{ origemArea, semCoordenada, cidades, pontos, bairros }`. Task 4 usa.

- [ ] **Step 1: Criar o storage**

```ts
// server/storage/localizacao.storage.ts
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { resolverAreaAtendida, type OrigemArea } from "../services/area-atendida";
import { estadoDoPonto, type EstadoPonto } from "../services/estado-ponto";

export interface LocalizacaoPonto {
  id: number; lat: number; lon: number;
  estado: EstadoPonto; emAberto: number; atraso: number;
  bairro: string | null; cidade: string;
}

export interface LocalizacaoBairro {
  bairro: string; cidade: string;
  clientes: number; inadimplentes: number; exComDivida: number;
  pctInadimplencia: number; dividaTotal: number;
}

export interface LocalizacaoResposta {
  origemArea: OrigemArea;
  semCoordenada: number;
  cidades: Array<{ cidade: string; clientes: number }>;
  pontos: LocalizacaoPonto[];
  bairros: LocalizacaoBairro[];
}

export class LocalizacaoStorage {
  /**
   * Uma varredura da carteira produz os quatro conjuntos que a tela precisa.
   * O recorte territorial vem da cascata — nunca mais de providers.addressState
   * sozinho, que nao filtrava nada quando a UF era nula.
   */
  async getLocalizacao(providerId: number): Promise<LocalizacaoResposta> {
    const area = await resolverAreaAtendida(providerId);

    const todos = await db.select().from(customers)
      .where(eq(customers.providerId, providerId));

    const cidadesAlvo = area.cidades
      ? new Set(area.cidades.map(c => c.trim().toLowerCase()))
      : null;
    const ufAlvo = area.uf ? area.uf.toUpperCase() : null;

    const naArea = todos.filter(c => {
      if (cidadesAlvo) return cidadesAlvo.has((c.city || "").trim().toLowerCase());
      if (ufAlvo) return (c.state || "").toUpperCase() === ufAlvo;
      return true;
    });

    const pontos: LocalizacaoPonto[] = [];
    let semCoordenada = 0;
    const porCidade = new Map<string, number>();
    const porBairro = new Map<string, LocalizacaoBairro>();

    for (const c of naArea) {
      const cidade = (c.city || "").trim() || "Sem cidade";
      porCidade.set(cidade, (porCidade.get(cidade) || 0) + 1);

      const estado = estadoDoPonto(c);
      const emAberto = Number(c.totalOverdueAmount || 0) || 0;
      const bairro = (c.neighborhood || "").trim() || "Sem bairro";

      const chave = `${cidade.toUpperCase()}||${bairro.toUpperCase()}`;
      const b = porBairro.get(chave) || {
        bairro, cidade, clientes: 0, inadimplentes: 0, exComDivida: 0,
        pctInadimplencia: 0, dividaTotal: 0,
      };
      b.clientes++;
      if (emAberto > 0) { b.inadimplentes++; b.dividaTotal += emAberto; }
      if (estado === 'ex_divida') b.exComDivida++;
      porBairro.set(chave, b);

      const lat = c.latitude ? parseFloat(c.latitude) : NaN;
      const lon = c.longitude ? parseFloat(c.longitude) : NaN;
      if (Number.isNaN(lat) || Number.isNaN(lon)) { semCoordenada++; continue; }

      // LGPD: sem nome e sem CPF — a tela nao precisa deles.
      pontos.push({
        id: c.id, lat, lon, estado, emAberto,
        atraso: c.maxDaysOverdue || 0, bairro: c.neighborhood, cidade,
      });
    }

    const bairros = [...porBairro.values()].map(b => ({
      ...b,
      pctInadimplencia: b.clientes > 0 ? (b.inadimplentes / b.clientes) * 100 : 0,
    }));

    return {
      origemArea: area.origem,
      semCoordenada,
      cidades: [...porCidade.entries()]
        .map(([cidade, clientes]) => ({ cidade, clientes }))
        .sort((a, b) => b.clientes - a.clientes),
      pontos,
      bairros,
    };
  }
}
```

- [ ] **Step 2: Declarar e delegar em `server/storage/index.ts`**

Importar no topo:

```ts
import { LocalizacaoStorage } from "./localizacao.storage";
```

Na interface `IStorage`:

```ts
  getLocalizacao(providerId: number): ReturnType<LocalizacaoStorage["getLocalizacao"]>;
```

Na classe, junto das outras instâncias privadas e delegações:

```ts
  private _localizacao = new LocalizacaoStorage();
  getLocalizacao = (providerId: number) => this._localizacao.getLocalizacao(providerId);
```

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `112`

- [ ] **Step 4: Commit**

```bash
git add server/storage/localizacao.storage.ts server/storage/index.ts
git commit -m "feat(localizacao): varredura unica do territorio com recorte regional"
```

---

### Task 4: Endpoint `GET /api/localizacao`

**Files:**
- Create: `server/routes/localizacao.routes.ts`
- Modify: `server/routes/index.ts` (import + `app.use`)

**Interfaces:**
- Consumes: `storage.getLocalizacao` (Task 3)
- Produces: `GET /api/localizacao`. Task 6 consome.

- [ ] **Step 1: Criar a rota**

```ts
// server/routes/localizacao.routes.ts
import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerLocalizacaoRoutes(): Router {
  const router = Router();

  router.get("/api/localizacao", requireAuth, async (req, res) => {
    try {
      const data = await storage.getLocalizacao(req.session.providerId!);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
```

- [ ] **Step 2: Montar em `server/routes/index.ts`**

```ts
import { registerLocalizacaoRoutes } from "./localizacao.routes";
```

E junto dos outros `app.use`, depois de `registerHeatmapRoutes()`:

```ts
  app.use(registerLocalizacaoRoutes());
```

- [ ] **Step 3: Verificar**

Run: `curl -s http://localhost:5000/api/localizacao -w "\n%{http_code}\n"`
Expected: `401` sem sessão. Com sessão da NsLink: JSON com `origemArea: "cidades"` (ela tem 46 cidades configuradas), `pontos`, `bairros`, `cidades`, `semCoordenada`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/localizacao.routes.ts server/routes/index.ts
git commit -m "feat(localizacao): endpoint unico da tela"
```

---

### Task 5: Componente de mapa com marcador colorido

Os cinco componentes em `client/src/components/maps/` são todos de **calor** — nenhum plota marcador por estado. Este é novo, com responsabilidade única.

**Files:**
- Create: `client/src/components/maps/MapaCarteira.tsx`

**Interfaces:**
- Consumes: `leaflet`, `leaflet.heat` (já nas deps)
- Produces: `<MapaCarteira pontos={} heat={} height={} />`. Task 6 usa.

- [ ] **Step 1: Criar o componente**

```tsx
// client/src/components/maps/MapaCarteira.tsx
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@/lib/leaflet-patch";

export type PontoMapa = {
  id: number; lat: number; lon: number;
  estado: 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';
  emAberto: number; bairro: string | null; cidade: string;
};

/** Le o token da pele em runtime — o mapa acompanha a troca de tema. */
function corDoEstado(estado: PontoMapa['estado']): string {
  const mapa: Record<PontoMapa['estado'], string> = {
    em_dia: '--ok', em_cobranca: '--gated', suspenso: '--brand', ex_divida: '--danger',
  };
  const v = getComputedStyle(document.documentElement).getPropertyValue(mapa[estado]).trim();
  return v || '#6B6878';
}

export default function MapaCarteira({
  pontos, heat = false, height = 520,
}: { pontos: PontoMapa[]; heat?: boolean; height?: number }) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!div.current || mapa.current) return;
    mapa.current = L.map(div.current, { zoomControl: true }).setView([-23.31, -51.16], 11);
    L.tileLayer("/api/tiles/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(mapa.current);
    camada.current = L.layerGroup().addTo(mapa.current);
    return () => { mapa.current?.remove(); mapa.current = null; };
  }, []);

  useEffect(() => {
    if (!mapa.current || !camada.current) return;
    camada.current.clearLayers();
    if (pontos.length === 0) return;

    for (const p of pontos) {
      L.circleMarker([p.lat, p.lon], {
        radius: 5, weight: 1, color: "#fff", fillColor: corDoEstado(p.estado), fillOpacity: 0.9,
      })
        .bindPopup(
          `<b>${p.bairro || "Sem bairro"}</b><br>${p.cidade}<br>` +
          (p.emAberto > 0
            ? `R$ ${p.emAberto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em aberto`
            : "sem dívida em aberto"),
        )
        .addTo(camada.current!);
    }

    // Enquadra pelos proprios pontos: cidades-brasil.json nao tem coordenada.
    const bounds = L.latLngBounds(pontos.map(p => [p.lat, p.lon] as [number, number]));
    mapa.current.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  }, [pontos]);

  return <div ref={div} style={{ height }} className="w-full rounded-lg overflow-hidden" data-testid="mapa-carteira" />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `112`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/maps/MapaCarteira.tsx
git commit -m "feat(localizacao): mapa com marcador colorido por estado do cliente"
```

---

### Task 6: Tela `/localizacao` — KPIs, mapa e legenda

**Files:**
- Create: `client/src/pages/operacional/localizacao.tsx`
- Modify: `client/src/App.tsx` (lazy + rota + `PROVIDER_ONLY_PATHS`)

**Interfaces:**
- Consumes: `GET /api/localizacao` (Task 4), `MapaCarteira` (Task 5)
- Produces: rota `/localizacao`. Tasks 7, 8 e 10 estendem esta tela.

- [ ] **Step 1: Criar a tela**

```tsx
// client/src/pages/operacional/localizacao.tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import MapaCarteira, { type PontoMapa } from "@/components/maps/MapaCarteira";

type Resposta = {
  origemArea: 'cidades' | 'meso' | 'uf' | 'nenhuma';
  semCoordenada: number;
  cidades: Array<{ cidade: string; clientes: number }>;
  pontos: PontoMapa[];
  bairros: Array<{
    bairro: string; cidade: string; clientes: number;
    inadimplentes: number; exComDivida: number;
    pctInadimplencia: number; dividaTotal: number;
  }>;
};

const ESTADOS = [
  { k: 'em_dia',      label: 'Ativo em dia',          token: '--ok' },
  { k: 'em_cobranca', label: 'Em cobrança',           token: '--gated' },
  { k: 'suspenso',    label: 'Suspenso',              token: '--brand' },
  { k: 'ex_divida',   label: 'Ex-cliente com dívida', token: '--danger' },
] as const;

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Kpi({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg px-[14px] py-3 border border-[var(--border)]">
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</span>
      <p className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">{valor}</p>
      {sub && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

export default function LocalizacaoPage() {
  const { data, isLoading } = useQuery<Resposta>({ queryKey: ["/api/localizacao"] });

  const pontos = data?.pontos ?? [];
  const bairros = data?.bairros ?? [];
  const contagem = ESTADOS.map(e => ({ ...e, n: pontos.filter(p => p.estado === e.k).length }));
  const totalVencido = bairros.reduce((s, b) => s + b.dividaTotal, 0);
  const campeao = [...bairros].filter(b => b.clientes > 0)
    .sort((a, b) => b.pctInadimplencia - a.pctInadimplencia)[0];

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="localizacao-page">
      <div>
        <h1 className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
          Localização
        </h1>
        <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
          Mapa da carteira, calor de inadimplência e ranking de bairros
        </p>
      </div>

      {data?.origemArea === 'nenhuma' && (
        <div className="rounded-lg bg-[var(--gated-bg)] px-4 py-3 text-[13px] text-[var(--gated)]">
          Você ainda não configurou as cidades atendidas, então o mapa mostra toda a base.{" "}
          <Link href="/configuracoes/regionalizacao">
            <a className="underline font-medium">Configurar Regionalização</a>
          </Link>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-[74px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <Kpi label="Bairro campeão" valor={campeao ? `${campeao.pctInadimplencia.toFixed(1)}%` : "—"} sub={campeao?.bairro} />
          <Kpi label="R$ vencido no mapa" valor={brl(totalVencido)} sub={`${bairros.reduce((s,b)=>s+b.inadimplentes,0)} devedores`} />
          <Kpi label="Clientes plotados" valor={String(pontos.length)} />
          <Kpi label="Sem coordenada" valor={String(data?.semCoordenada ?? 0)} sub="fora do mapa" />
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-faint)]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Mapa real da carteira · OpenStreetMap
          </span>
          <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
            {pontos.length} pontos
          </span>
        </div>
        <div className="p-3">
          {isLoading ? <Skeleton className="h-[520px] w-full" /> : <MapaCarteira pontos={pontos} />}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 border-t border-[var(--border-faint)]">
          {contagem.map(e => (
            <span key={e.k} className="flex items-center gap-2 text-[12px] text-[var(--text-2)]">
              <i className="w-2 h-2 rounded-full" style={{ background: `var(${e.token})` }} />
              {e.label}
              <b className="font-mono tabular-nums text-[var(--text)]">{e.n}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `client/src/App.tsx`:

```tsx
const LocalizacaoPage = lazy(() => import("@/pages/operacional/localizacao"));
```

```tsx
        <Route path="/localizacao" component={LocalizacaoPage} />
```

E `"/localizacao"` em `PROVIDER_ONLY_PATHS`.

- [ ] **Step 3: Verificar no navegador**

Run: abrir `http://localhost:5000/localizacao`
Expected: 4 KPIs, mapa com os pontos da NsLink, legenda com contagem por estado, nenhum erro no console. Com 7 clientes na base local o mapa fica esparso — isso é esperado, não defeito.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/operacional/localizacao.tsx client/src/App.tsx
git commit -m "feat(localizacao): tela com KPIs, mapa e legenda"
```

---

### Task 7: Filtros de cidade, estado e faixa de dívida

Filtros são estado local sobre os dados já carregados — não geram requisição.

**Files:**
- Modify: `client/src/pages/operacional/localizacao.tsx`

**Interfaces:**
- Consumes: os dados da Task 6
- Produces: `pontosFiltrados`, consumido pelo mapa e pela legenda

- [ ] **Step 1: Adicionar o estado dos filtros**

```tsx
  const [fCidade, setFCidade] = useState<string>("todas");
  const [fEstado, setFEstado] = useState<string>("todos");
  const [fDivida, setFDivida] = useState<string>("todas");

  const FAIXAS: Record<string, (v: number) => boolean> = {
    todas: () => true,
    em_dia: v => v === 0,
    ate100: v => v > 0 && v <= 100,
    de100a300: v => v > 100 && v <= 300,
    de300a1000: v => v > 300 && v <= 1000,
    acima1000: v => v > 1000,
  };

  const pontosFiltrados = pontos.filter(p =>
    (fCidade === "todas" || p.cidade === fCidade) &&
    (fEstado === "todos" || p.estado === fEstado) &&
    FAIXAS[fDivida](p.emAberto)
  );
```

Trocar `<MapaCarteira pontos={pontos} />` por `pontos={pontosFiltrados}` e a legenda por `pontosFiltrados.filter(...)`.

- [ ] **Step 2: Adicionar os chips**

Acima do mapa, três linhas de chips. Cada chip:

```tsx
function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[12px] px-2.5 py-1 rounded border motion-safe:transition-colors ${
        ativo
          ? "border-[var(--brand)] text-[var(--brand-ink)] bg-[var(--brand-soft)] font-medium"
          : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]"
      }`}
    >
      {children}
    </button>
  );
}
```

Linha CIDADE: `todas` + um chip por item de `data.cidades` (que já vem ordenado por volume). Linha ESTADO: `todos` + os quatro de `ESTADOS`. Linha DÍVIDA: os seis de `FAIXAS`.

- [ ] **Step 3: Verificar**

Run: abrir `/localizacao`, clicar em "Em cobrança" e depois numa cidade
Expected: a contagem de pontos no cabeçalho do mapa cai, o mapa reenquadra nos pontos restantes, e a legenda reflete o filtro.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/operacional/localizacao.tsx
git commit -m "feat(localizacao): filtros de cidade, estado e faixa de divida"
```

---

### Task 8: Ranking de bairros

**Files:**
- Modify: `client/src/pages/operacional/localizacao.tsx`

**Interfaces:**
- Consumes: `data.bairros` (Task 4)
- Produces: nada

- [ ] **Step 1: Adicionar o painel lateral**

Envolver mapa e ranking num grid `lg:grid-cols-[1fr_380px] gap-4`. O painel:

```tsx
  const [ordem, setOrdem] = useState<'menor'|'maior'|'divida'|'clientes'>('maior');

  const bairrosOrdenados = [...bairros].sort((a, b) => {
    if (ordem === 'menor') return a.pctInadimplencia - b.pctInadimplencia;
    if (ordem === 'maior') return b.pctInadimplencia - a.pctInadimplencia;
    if (ordem === 'divida') return b.dividaTotal - a.dividaTotal;
    return b.clientes - a.clientes;
  });
```

```tsx
<div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col">
  <div className="px-4 py-2.5 border-b border-[var(--border-faint)]">
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
      Bairros por inadimplência
    </span>
    <p className="text-[11px] text-[var(--text-muted)] mt-1">
      Universo = carteira na área atendida, incluindo quem está sem coordenada.
    </p>
  </div>
  <div className="flex gap-1.5 px-4 py-2 border-b border-[var(--border-faint)]">
    <Chip ativo={ordem==='menor'} onClick={()=>setOrdem('menor')}>Menor %</Chip>
    <Chip ativo={ordem==='maior'} onClick={()=>setOrdem('maior')}>Maior %</Chip>
    <Chip ativo={ordem==='divida'} onClick={()=>setOrdem('divida')}>Dívida</Chip>
    <Chip ativo={ordem==='clientes'} onClick={()=>setOrdem('clientes')}>Clientes</Chip>
  </div>
  <ul className="overflow-y-auto max-h-[560px]">
    {bairrosOrdenados.map((b, i) => (
      <li key={`${b.cidade}-${b.bairro}`} className="px-4 py-3 border-b border-[var(--border-faint)] last:border-b-0">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] text-[var(--text-faint)] tabular-nums">{String(i+1).padStart(2,'0')}</span>
            <span className="text-[13.5px] font-medium text-[var(--text)] truncate">{b.bairro}</span>
          </span>
          <span className={`font-mono text-[11px] tabular-nums px-2 py-0.5 rounded ${
            b.pctInadimplencia >= 18 ? "bg-[var(--danger-bg)] text-[var(--danger)]"
            : b.pctInadimplencia >= 8 ? "bg-[var(--gated-bg)] text-[var(--gated)]"
            : "bg-[var(--ok-bg)] text-[var(--ok)]"
          }`}>
            {b.pctInadimplencia.toFixed(1)}%
          </span>
        </div>
        <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
          {brl(b.dividaTotal)} · {b.clientes} clientes · {b.inadimplentes} inad. · {b.exComDivida} ex
        </p>
      </li>
    ))}
  </ul>
</div>
```

- [ ] **Step 2: Verificar**

Run: abrir `/localizacao` e alternar a ordenação
Expected: a lista reordena; nenhum bairro com `pctInadimplencia` acima de 100 ou negativo; "Sem bairro" aparece se houver cliente sem bairro.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/operacional/localizacao.tsx
git commit -m "feat(localizacao): ranking de bairros com ordenacao"
```

---

### Task 9: Menu e redirects

**Files:**
- Modify: `client/src/components/app-sidebar.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/provedor/dashboard.tsx` (card de funcionalidade)

**Interfaces:**
- Consumes: rota `/localizacao` (Task 6)
- Produces: nada

- [ ] **Step 1: Apontar o menu para a tela nova**

Em `app-sidebar.tsx`, o item já se chama "Localização" e aponta para `/benchmark-regional`. Trocar a URL para `/localizacao` e o `testId` continua `link-localizacao`.

- [ ] **Step 2: Redirecionar as duas rotas antigas**

Em `App.tsx`, substituir os dois `<Route>` por redirects, para não quebrar link salvo:

```tsx
        <Route path="/mapa-calor">{() => { window.location.replace("/localizacao"); return null; }}</Route>
        <Route path="/benchmark-regional">{() => { window.location.replace("/localizacao"); return null; }}</Route>
```

Remover os `lazy` de `MapaCalorPage` e `BenchmarkRegionalPage`, e as duas entradas de `PROVIDER_ONLY_PATHS` podem continuar (o redirect roda antes).

- [ ] **Step 3: Atualizar o card do dashboard**

Em `FUNCIONALIDADES`, trocar as duas entradas ("Mapa de Calor" → `/mapa-calor` e "Localização" → `/benchmark-regional`) por uma só:

```tsx
  { url: "/localizacao", titulo: "Localização", Icone: MapPin, desc: "Mapa da carteira, calor de inadimplência e ranking de bairros" },
```

- [ ] **Step 4: Verificar**

Run: abrir `/mapa-calor` e `/benchmark-regional`
Expected: ambas redirecionam para `/localizacao`. O menu tem um item Localização, e o dashboard um card só.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/app-sidebar.tsx client/src/App.tsx client/src/pages/provedor/dashboard.tsx
git commit -m "feat(localizacao): consolida as duas telas antigas com redirect"
```

---

### Task 10: Camada de rede opcional

O diferencial do bureau: concentração anonimizada dos outros provedores da região. Desligada por padrão — a leitura do dia a dia é a carteira própria.

**Files:**
- Modify: `client/src/pages/operacional/localizacao.tsx`
- Modify: `client/src/components/maps/MapaCarteira.tsx`

**Interfaces:**
- Consumes: `GET /api/heatmap/regional` (já existe, anonimizado)
- Produces: nada

- [ ] **Step 1: Aceitar a camada no componente**

Em `MapaCarteira`, adicionar a prop `rede?: Array<{ lat: number; lng: number; count: number }>` e, num `useEffect` próprio, desenhar círculos translúcidos proporcionais a `count`, numa `L.layerGroup` separada — para ligar e desligar sem redesenhar os pontos:

```tsx
  const camadaRede = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapa.current) return;
    camadaRede.current?.remove();
    if (!rede?.length) return;
    camadaRede.current = L.layerGroup(
      rede.map(r => L.circle([r.lat, r.lng], {
        radius: Math.min(4000, 400 + r.count * 40),
        weight: 0, fillColor: corDoEstado('suspenso'), fillOpacity: 0.14,
      }))
    ).addTo(mapa.current);
  }, [rede]);
```

- [ ] **Step 2: Toggle na tela**

```tsx
  const [verRede, setVerRede] = useState(false);
  const { data: rede = [] } = useQuery<Array<{ lat: number; lng: number; count: number }>>({
    queryKey: ["/api/heatmap/regional"],
    enabled: verRede,
  });
```

Um `Chip` no cabeçalho do mapa alternando `verRede`. Quando `verRede && rede.length === 0`, mostrar ao lado: `"nenhum provedor parceiro com dados na sua região"` — em vez de ligar e não mostrar nada.

Passar `rede={verRede ? rede : undefined}` para o `MapaCarteira`.

- [ ] **Step 3: Verificar**

Run: abrir `/localizacao` e ligar o toggle
Expected: com provedor parceiro na região, aparecem círculos translúcidos; sem parceiro, aparece a mensagem. Desligar remove a camada sem piscar os pontos da carteira.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/operacional/localizacao.tsx client/src/components/maps/MapaCarteira.tsx
git commit -m "feat(localizacao): camada de rede opcional, desligada por padrao"
```

---

## Verificação final

- [ ] `npm test` — passam, incluindo os 14 novos (6 de área + 8 de estado)
- [ ] `npm run check 2>&1 | grep -c "error TS"` → `112`
- [ ] `npm run build` → passa
- [ ] `/mapa-calor` e `/benchmark-regional` redirecionam para `/localizacao`
- [ ] `curl /api/localizacao` com sessão NsLink → `origemArea: "cidades"` (ela tem 46 configuradas)
- [ ] Menu tem um item Localização; dashboard tem um card Localização
- [ ] Nenhuma menção a penetração, HPs ou UCs na tela
- [ ] Trocar o tema no header muda a cor dos pontos do mapa

---

### Task 11: Remover o que a consolidação tornou morto

Depois da Task 9, `benchmark-regional.tsx` e `mapa-calor.tsx` viram redirect. Os endpoints que só elas consumiam ficam sem consumidor — e carregam dois defeitos conhecidos (filtro por UF que não filtra quando a UF é nula, e `paymentStatus === "overdue"` que não casa com dado semeado). Deixar código morto e defeituoso no repositório é pior que removê-lo.

**Files:**
- Delete: `client/src/pages/provedor/benchmark-regional.tsx`
- Delete: `client/src/pages/operacional/mapa-calor.tsx`
- Modify: `server/routes/benchmark.routes.ts`
- Modify: `server/routes/heatmap.routes.ts`
- Modify: `server/storage/customers.storage.ts` e `server/storage/index.ts`

**Interfaces:**
- Consumes: nada
- Produces: nada — só remoção

- [ ] **Step 1: Confirmar que ninguém mais consome**

```bash
grep -rn "api/benchmark" client/src server --include=*.tsx --include=*.ts | grep -v "benchmark.routes.ts"
grep -rn "api/heatmap" client/src --include=*.tsx
```

Expected: a primeira busca não retorna nada; a segunda retorna apenas `localizacao.tsx` com `/api/heatmap/regional`, que **permanece** (camada de rede da Task 10).

Se aparecer outro consumidor, **pare** e reavalie — a premissa desta task caiu.

- [ ] **Step 2: Apagar as duas páginas**

```bash
git rm client/src/pages/provedor/benchmark-regional.tsx
git rm client/src/pages/operacional/mapa-calor.tsx
```

Os `lazy` já saíram na Task 9.

- [ ] **Step 3: Remover os endpoints sem consumidor**

Em `server/routes/benchmark.routes.ts`, remover os cinco handlers (`cep-ranking`, `trend`, `map-points`, `defaulters-map`, `neighborhood-stats`) e o registro em `server/routes/index.ts`.

Em `server/routes/heatmap.routes.ts`, **manter** `/api/tiles/:z/:x/:y.png` (usado pelo `MapaCarteira`) e `/api/heatmap/regional` (camada de rede). Remover `/api/heatmap/provider`, `/api/heatmap/city-ranking`, `/api/heatmap/sync-info` e `POST /api/heatmap/refresh`.

- [ ] **Step 4: Remover os métodos de storage órfãos**

De `server/storage/customers.storage.ts` e das declarações/delegações em `server/storage/index.ts`: `getMapPoints`, `getDefaultersMapPoints`, `getNeighborhoodStats`, `getCepRanking`, `getTrend`, `getHeatmapByProvider`.

**Manter** `getHeatmapAll` se `/api/heatmap/regional` depender dele — conferir antes de apagar.

- [ ] **Step 5: Typecheck e build**

Run: `npm run check 2>&1 | grep -c "error TS"` → `112`
Run: `npm run build` → passa
Run: `npm test` → passa

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(localizacao): remove telas e endpoints superados pela consolidacao

benchmark-regional e mapa-calor viraram redirect; os endpoints que so elas
consumiam ficaram sem consumidor. Carregavam dois defeitos conhecidos: filtro
por address_state que nao filtra quando a UF e nula, e paymentStatus ===
'overdue', valor que nenhuma linha semeada possui.

Mantidos: /api/tiles (usado pelo mapa) e /api/heatmap/regional (camada de rede)."
```

---

## Correções da autorrevisão

Três coisas que a revisão contra a spec encontrou, registradas aqui em vez de deixadas como surpresa para quem implementar:

**1. A spec diz "aplicar a cascata nas três queries de território". Está errado.**
Essas queries (`getMapPoints`, `getNeighborhoodStats`, `getDefaultersMapPoints`)
perdem o único consumidor na Task 9 e são removidas na Task 11. A cascata vive
apenas em `getLocalizacao`. Aplicá-la às três seria trabalho jogado fora.

**2. Falta o fallback de enquadramento sem pontos.**
A spec prevê "sem cliente geocodificado → enquadra na cidade do provedor via
`geocodeCity`". A Task 5 apenas retorna cedo quando `pontos.length === 0`.
Ao implementar a Task 5, acrescentar: quando não houver ponto, manter o
`setView` inicial e exibir na tela o estado vazio com o total de "sem
coordenada" — sem chamada extra de geocodificação, que custaria uma volta de
rede para posicionar um mapa vazio. Se depois quiser centrar na cidade do
provedor, `geocodeCity` já existe em `server/services`.

**3. Tipos divergentes entre Task 3 e Task 5.**
`LocalizacaoPonto` (storage) tem `atraso`; `PontoMapa` (componente) não.
A Task 6 tipa a resposta com `PontoMapa[]` e perderia o campo. Ao implementar a
Task 5, incluir `atraso: number` em `PontoMapa` para os dois coincidirem — o
popup pode usá-lo depois.
