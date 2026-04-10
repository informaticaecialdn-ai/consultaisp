# Anti-Fraude por Endereco + Benchmark Regional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar alerta de risco por endereco na Consulta ISP + reescrever Benchmark Regional com ranking CEPs, tendencia 6 meses e mapa de risco.

**Architecture:** O alerta de endereco e injetado no fluxo existente da Consulta ISP (POST /api/isp-consultations) cruzando CEP do consultado com tabela `customers` local. Benchmark Regional usa 3 novos endpoints que agregam dados da mesma tabela `customers`. Frontend usa componentes existentes (Card, Badge, Recharts, MapLibre).

**Tech Stack:** Express routes, Drizzle ORM (tabela customers), React, Recharts, MapLibre GL JS, TanStack Query.

---

## File Structure

### Backend — Criar
- `server/routes/benchmark.routes.ts` — 3 endpoints de benchmark (cep-ranking, trend, map-points)

### Backend — Modificar
- `server/storage/customers.storage.ts` — novos metodos: `getCustomersByAddressForAlert()`, `getCepRanking()`, `getTrend()`, `getMapPoints()`
- `server/routes/consultas.routes.ts:384-390` — injetar alerta de endereco no resultado
- `server/routes/index.ts` — registrar benchmark routes

### Frontend — Criar
- `client/src/components/consulta/AddressRiskAlert.tsx` — componente de alerta visual

### Frontend — Modificar
- `client/src/components/consulta/ConsultaResultSummary.tsx` — renderizar AddressRiskAlert
- `client/src/pages/provedor/benchmark-regional.tsx` — reescrever com 3 secoes

---

## Task 1: Storage — metodo getCustomersByAddressForAlert

**Files:**
- Modify: `server/storage/customers.storage.ts`
- Modify: `server/storage/index.ts`

- [ ] **Step 1: Adicionar metodo no CustomersStorage**

Em `server/storage/customers.storage.ts`, adicionar antes do `}` final:

```typescript
  /** Buscar inadimplentes no mesmo CEP (5 digitos) para alerta de endereco */
  async getCustomersByAddressForAlert(cep5: string, excludeCpfCnpj: string): Promise<{
    cpfMasked: string;
    overdueRange: string;
    maxDaysOverdue: number;
    status: string;
  }[]> {
    if (!cep5 || cep5.length < 5) return [];
    const prefix = cep5.replace(/\D/g, "").slice(0, 5);
    const cleanExclude = excludeCpfCnpj.replace(/\D/g, "");

    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const matches = rows.filter(c => {
      if (!c.cep) return false;
      if (!c.cep.replace(/\D/g, "").startsWith(prefix)) return false;
      if (c.cpfCnpj.replace(/\D/g, "") === cleanExclude) return false;
      return true;
    });

    // Mascarar CPF pra LGPD: ***456-**
    const maskCpf = (cpf: string): string => {
      const clean = cpf.replace(/\D/g, "");
      if (clean.length === 11) return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
      if (clean.length === 14) return `**.***.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
      return "***";
    };

    // Faixa de valor pra LGPD
    const overdueRange = (val: number): string => {
      if (val <= 200) return "R$ 0-200";
      if (val <= 500) return "R$ 200-500";
      if (val <= 1000) return "R$ 500-1.000";
      if (val <= 2000) return "R$ 1.000-2.000";
      return "R$ 2.000+";
    };

    return matches.map(c => ({
      cpfMasked: maskCpf(c.cpfCnpj),
      overdueRange: overdueRange(parseFloat(c.totalOverdueAmount || "0")),
      maxDaysOverdue: c.maxDaysOverdue || 0,
      status: c.status === "cancelled" ? "inativo" : "inadimplente",
    }));
  }
```

- [ ] **Step 2: Expor no storage/index.ts**

Em `server/storage/index.ts`, adicionar na interface IStorage (apos `getCustomersByCepPrefix`):

```typescript
  getCustomersByAddressForAlert(cep5: string, excludeCpfCnpj: string): ReturnType<CustomersStorage["getCustomersByAddressForAlert"]>;
```

E na classe DatabaseStorage (apos `getCustomersByCepPrefix = ...`):

```typescript
  getCustomersByAddressForAlert = (cep5: string, excludeCpfCnpj: string) => this._customers.getCustomersByAddressForAlert(cep5, excludeCpfCnpj);
```

- [ ] **Step 3: Commit**

```bash
git add server/storage/customers.storage.ts server/storage/index.ts
git commit -m "feat: getCustomersByAddressForAlert — busca inadimplentes por CEP mascarado LGPD"
```

---

## Task 2: Backend — Injetar alerta de endereco na Consulta ISP

**Files:**
- Modify: `server/routes/consultas.routes.ts:380-395`

- [ ] **Step 1: Adicionar import do storage no topo (se nao existir)**

Verificar se `storage` ja esta importado. Se nao, adicionar:
```typescript
import { storage } from "../storage";
```

- [ ] **Step 2: Injetar alerta de endereco antes de montar o resultado**

Em `server/routes/consultas.routes.ts`, encontrar o bloco onde o `result` eh montado (por volta da linha 364). Antes dele, adicionar:

```typescript
      // Alerta de risco por endereco — cruza CEP com inadimplentes da rede
      let addressRiskAlerts: { cpfMasked: string; overdueRange: string; maxDaysOverdue: number; status: string }[] = [];
      try {
        // Pegar CEP do resultado do ERP (proprio provedor ou primeiro da rede)
        const erpCep = scoreInput?.endereco?.cep || "";
        if (erpCep && erpCep.length >= 5) {
          addressRiskAlerts = await storage.getCustomersByAddressForAlert(
            erpCep.slice(0, 5),
            cleanDoc,
          );
        }
      } catch (err) {
        console.warn("[ConsultaISP] Erro ao buscar alerta de endereco:", err);
      }
```

- [ ] **Step 3: Incluir no objeto result**

No objeto `result` (por volta da linha 384-395), adicionar o campo `addressRiskAlerts`:

Encontrar a linha com `addressSearch:` e adicionar logo depois:

```typescript
        addressRiskAlerts: addressRiskAlerts.length > 0 ? {
          type: "address_risk",
          message: `Este endereco tem ${addressRiskAlerts.length} registro(s) de inadimplencia na rede ISP`,
          matches: addressRiskAlerts,
        } : null,
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/consultas.routes.ts
git commit -m "feat: alerta de risco por endereco na Consulta ISP — cruza CEP com rede"
```

---

## Task 3: Frontend — Componente AddressRiskAlert

**Files:**
- Create: `client/src/components/consulta/AddressRiskAlert.tsx`

- [ ] **Step 1: Criar componente**

```tsx
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AddressRiskAlertProps {
  data: {
    type: string;
    message: string;
    matches: {
      cpfMasked: string;
      overdueRange: string;
      maxDaysOverdue: number;
      status: string;
    }[];
  };
}

export default function AddressRiskAlert({ data }: AddressRiskAlertProps) {
  return (
    <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-orange-600" />
        <h3 className="font-semibold text-sm text-orange-800 dark:text-orange-300">
          Alerta de Endereco
        </h3>
        <Badge className="bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-300 text-xs ml-auto">
          {data.matches.length} registro(s)
        </Badge>
      </div>
      <p className="text-sm text-orange-700 dark:text-orange-400">{data.message}</p>
      <div className="space-y-2">
        {data.matches.map((match, i) => (
          <div key={i} className="flex items-center justify-between text-sm bg-white/60 dark:bg-black/20 rounded px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted-foreground">{match.cpfMasked}</span>
              <Badge variant="outline" className="text-xs">
                {match.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-right">
              <span className="text-xs text-muted-foreground">{match.maxDaysOverdue}d atraso</span>
              <span className="font-semibold text-sm">{match.overdueRange}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/consulta/AddressRiskAlert.tsx
git commit -m "feat: componente AddressRiskAlert — alerta visual de inadimplencia por endereco"
```

---

## Task 4: Frontend — Renderizar alerta no resultado da Consulta ISP

**Files:**
- Modify: `client/src/components/consulta/ConsultaResultSummary.tsx`

- [ ] **Step 1: Importar componente**

No topo de `ConsultaResultSummary.tsx`, adicionar:

```typescript
import AddressRiskAlert from "./AddressRiskAlert";
```

- [ ] **Step 2: Renderizar antes do resumo de score**

Encontrar onde o componente renderiza o resultado (logo apos o header/titulo do resultado). Adicionar antes do score/provider cards:

```tsx
{result.addressRiskAlerts && (
  <AddressRiskAlert data={result.addressRiskAlerts} />
)}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/consulta/ConsultaResultSummary.tsx
git commit -m "feat: renderizar AddressRiskAlert no resultado da Consulta ISP"
```

---

## Task 5: Backend — Endpoints de Benchmark Regional

**Files:**
- Create: `server/routes/benchmark.routes.ts`
- Modify: `server/routes/index.ts`

- [ ] **Step 1: Adicionar metodos de agregacao no storage**

Em `server/storage/customers.storage.ts`, adicionar antes do `}` final:

```typescript
  /** Ranking de CEPs por risco — agrega todos os provedores */
  async getCepRanking(): Promise<{
    cep5: string; city: string; count: number; totalOverdue: number; avgDaysOverdue: number; riskLevel: string;
  }[]> {
    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const cepMap = new Map<string, { city: string; count: number; totalOverdue: number; totalDays: number }>();
    for (const r of rows) {
      if (!r.cep) continue;
      const cep5 = r.cep.replace(/\D/g, "").slice(0, 5);
      if (cep5.length < 5) continue;
      const existing = cepMap.get(cep5);
      const overdue = parseFloat(r.totalOverdueAmount || "0");
      const days = r.maxDaysOverdue || 0;
      if (existing) {
        existing.count++;
        existing.totalOverdue += overdue;
        existing.totalDays += days;
        if (!existing.city && r.city) existing.city = r.city;
      } else {
        cepMap.set(cep5, { city: r.city || "", count: 1, totalOverdue: overdue, totalDays: days });
      }
    }

    return Array.from(cepMap.entries())
      .map(([cep5, data]) => ({
        cep5,
        city: data.city,
        count: data.count,
        totalOverdue: data.totalOverdue,
        avgDaysOverdue: Math.round(data.totalDays / data.count),
        riskLevel: data.count >= 11 ? "critico" : data.count >= 6 ? "alto" : data.count >= 3 ? "medio" : "baixo",
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Tendencia regional — inadimplentes por mes (ultimos 6 meses) */
  async getTrend(): Promise<{ month: string; count: number; totalOverdue: number }[]> {
    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const now = new Date();
    const months: { month: string; count: number; totalOverdue: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });

      // Contar clientes cuja divida ja existia naquele mes (maxDaysOverdue > dias desde aquele mes)
      const daysFromMonth = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      const count = rows.filter(r => (r.maxDaysOverdue || 0) >= daysFromMonth).length;
      const totalOverdue = rows
        .filter(r => (r.maxDaysOverdue || 0) >= daysFromMonth)
        .reduce((s, r) => s + parseFloat(r.totalOverdueAmount || "0"), 0);

      months.push({ month: label, count, totalOverdue });
    }

    return months;
  }

  /** Pontos para mapa de risco — agrega por CEP com lat/lng medio */
  async getMapPoints(): Promise<{
    lat: number; lng: number; cep5: string; city: string; count: number; totalOverdue: number; riskLevel: string;
  }[]> {
    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const cepMap = new Map<string, { lats: number[]; lngs: number[]; city: string; count: number; totalOverdue: number }>();
    for (const r of rows) {
      if (!r.cep || !r.latitude || !r.longitude) continue;
      const cep5 = r.cep.replace(/\D/g, "").slice(0, 5);
      if (cep5.length < 5) continue;
      const lat = parseFloat(r.latitude);
      const lng = parseFloat(r.longitude);
      if (isNaN(lat) || isNaN(lng)) continue;

      const existing = cepMap.get(cep5);
      if (existing) {
        existing.lats.push(lat);
        existing.lngs.push(lng);
        existing.count++;
        existing.totalOverdue += parseFloat(r.totalOverdueAmount || "0");
        if (!existing.city && r.city) existing.city = r.city;
      } else {
        cepMap.set(cep5, { lats: [lat], lngs: [lng], city: r.city || "", count: 1, totalOverdue: parseFloat(r.totalOverdueAmount || "0") });
      }
    }

    return Array.from(cepMap.entries()).map(([cep5, data]) => ({
      lat: data.lats.reduce((s, v) => s + v, 0) / data.lats.length,
      lng: data.lngs.reduce((s, v) => s + v, 0) / data.lngs.length,
      cep5,
      city: data.city,
      count: data.count,
      totalOverdue: data.totalOverdue,
      riskLevel: data.count >= 11 ? "critico" : data.count >= 6 ? "alto" : data.count >= 3 ? "medio" : "baixo",
    }));
  }
```

- [ ] **Step 2: Expor no storage/index.ts**

Adicionar na interface IStorage e na classe DatabaseStorage:

```typescript
// Interface
getCepRanking(): ReturnType<CustomersStorage["getCepRanking"]>;
getTrend(): ReturnType<CustomersStorage["getTrend"]>;
getMapPoints(): ReturnType<CustomersStorage["getMapPoints"]>;

// Implementacao
getCepRanking = () => this._customers.getCepRanking();
getTrend = () => this._customers.getTrend();
getMapPoints = () => this._customers.getMapPoints();
```

- [ ] **Step 3: Criar benchmark.routes.ts**

```typescript
import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

export function registerBenchmarkRoutes(): Router {
  const router = Router();

  router.get("/api/benchmark/cep-ranking", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getCepRanking();
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/trend", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getTrend();
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/benchmark/map-points", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getMapPoints();
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Registrar rotas em index.ts**

Em `server/routes/index.ts`, adicionar import:
```typescript
import { registerBenchmarkRoutes } from "./benchmark.routes";
```

E no bloco de montagem:
```typescript
app.use(registerBenchmarkRoutes());
```

- [ ] **Step 5: Commit**

```bash
git add server/storage/customers.storage.ts server/storage/index.ts server/routes/benchmark.routes.ts server/routes/index.ts
git commit -m "feat: endpoints de Benchmark Regional — cep-ranking, trend, map-points"
```

---

## Task 6: Frontend — Reescrever Benchmark Regional

**Files:**
- Modify: `client/src/pages/provedor/benchmark-regional.tsx`

- [ ] **Step 1: Reescrever pagina com 3 secoes**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  MapPin,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type CepRanking = {
  cep5: string;
  city: string;
  count: number;
  totalOverdue: number;
  avgDaysOverdue: number;
  riskLevel: string;
};

type TrendPoint = {
  month: string;
  count: number;
  totalOverdue: number;
};

type MapPoint = {
  lat: number;
  lng: number;
  cep5: string;
  city: string;
  count: number;
  totalOverdue: number;
  riskLevel: string;
};

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const riskColor: Record<string, string> = {
  critico: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  alto: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medio: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  baixo: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const riskMapColor: Record<string, string> = {
  critico: "#ef4444",
  alto: "#f97316",
  medio: "#eab308",
  baixo: "#22c55e",
};

export default function BenchmarkRegionalPage() {
  const { data: ranking = [], isLoading: rankingLoading } = useQuery<CepRanking[]>({
    queryKey: ["/api/benchmark/cep-ranking"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: trend = [], isLoading: trendLoading } = useQuery<TrendPoint[]>({
    queryKey: ["/api/benchmark/trend"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: mapPoints = [] } = useQuery<MapPoint[]>({
    queryKey: ["/api/benchmark/map-points"],
    staleTime: 5 * 60 * 1000,
  });

  // Tendencia: comparar ultimo mes vs penultimo
  const trendDirection =
    trend.length >= 2 && trend[trend.length - 1].count > trend[trend.length - 2].count
      ? "up"
      : trend.length >= 2 && trend[trend.length - 1].count < trend[trend.length - 2].count
      ? "down"
      : "stable";

  const totalInadimplentes = ranking.reduce((s, r) => s + r.count, 0);
  const totalValor = ranking.reduce((s, r) => s + r.totalOverdue, 0);
  const cidadesAfetadas = new Set(ranking.map((r) => r.city).filter(Boolean)).size;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">Benchmark Regional</h1>
        <p className="text-sm text-muted-foreground">
          Analise de inadimplencia por regiao — dados da rede de provedores
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Inadimplentes na Rede</p>
          <p className="text-2xl font-bold mt-1">{totalInadimplentes}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Valor em Aberto</p>
          <p className="text-2xl font-bold mt-1">R$ {fmt(totalValor)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">CEPs com Risco</p>
          <p className="text-2xl font-bold mt-1">{ranking.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Tendencia</p>
          <div className="flex items-center gap-2 mt-1">
            {trendDirection === "up" ? (
              <TrendingUp className="w-5 h-5 text-red-500" />
            ) : trendDirection === "down" ? (
              <TrendingDown className="w-5 h-5 text-green-500" />
            ) : (
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            )}
            <span className="text-2xl font-bold">
              {trendDirection === "up" ? "Subindo" : trendDirection === "down" ? "Descendo" : "Estavel"}
            </span>
          </div>
        </Card>
      </div>

      {/* Tendencia 6 meses */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Tendencia Regional — Ultimos 6 Meses</h2>
        </div>
        {trendLoading ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground">Carregando...</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number, name: string) => [name === "count" ? value : `R$ ${fmt(value)}`, name === "count" ? "Inadimplentes" : "Valor"]} />
              <Line yAxisId="left" type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} name="Inadimplentes" />
              <Line yAxisId="right" type="monotone" dataKey="totalOverdue" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} name="Valor" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Ranking de CEPs */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-sm">Ranking de CEPs por Risco</h2>
          <span className="ml-auto text-xs text-muted-foreground">{ranking.length} CEPs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">CEP</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Cidade</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Inadimplentes</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Valor Total</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Media Atraso</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Risco</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ranking.slice(0, 30).map((row) => (
                <tr key={row.cep5} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono">{row.cep5}-***</td>
                  <td className="px-4 py-3">{row.city || "—"}</td>
                  <td className="px-4 py-3 font-semibold">{row.count}</td>
                  <td className="px-4 py-3">R$ {fmt(row.totalOverdue)}</td>
                  <td className="px-4 py-3">{row.avgDaysOverdue}d</td>
                  <td className="px-4 py-3">
                    <Badge className={`text-xs ${riskColor[row.riskLevel] || ""}`}>
                      {row.riskLevel}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mapa de risco */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Mapa de Risco por Bairro</h2>
        </div>
        <BenchmarkMap points={mapPoints} />
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Baixo</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500" /> Medio</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500" /> Alto</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> Critico</span>
        </div>
      </Card>
    </div>
  );
}

function BenchmarkMap({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["/api/tiles/{z}/{x}/{y}.png"], tileSize: 256, attribution: "&copy; OpenStreetMap" },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-51.0, -23.3],
      zoom: 8,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    const map = mapRef.current;

    // Esperar o mapa carregar
    const addPoints = () => {
      if (map.getSource("risk-points")) {
        (map.getSource("risk-points") as any).setData({
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
            properties: { count: p.count, riskLevel: p.riskLevel, city: p.city, cep5: p.cep5, totalOverdue: p.totalOverdue },
          })),
        });
        return;
      }

      map.addSource("risk-points", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
            properties: { count: p.count, riskLevel: p.riskLevel, city: p.city, cep5: p.cep5, totalOverdue: p.totalOverdue },
          })),
        },
      });

      map.addLayer({
        id: "risk-circles",
        type: "circle",
        source: "risk-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 6, 5, 12, 10, 18, 20, 28],
          "circle-color": [
            "match", ["get", "riskLevel"],
            "critico", "#ef4444",
            "alto", "#f97316",
            "medio", "#eab308",
            "baixo", "#22c55e",
            "#999",
          ],
          "circle-opacity": 0.7,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
        },
      });

      // Popup ao clicar
      map.on("click", "risk-circles", (e) => {
        if (!e.features?.[0]) return;
        const p = e.features[0].properties!;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${p.cep5}-***</strong> ${p.city}<br/>${p.count} inadimplentes<br/>R$ ${Number(p.totalOverdue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)
          .addTo(map);
      });

      map.on("mouseenter", "risk-circles", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "risk-circles", () => { map.getCanvas().style.cursor = ""; });

      // Fit bounds
      if (points.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        points.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 12 });
      }
    };

    if (map.loaded()) addPoints();
    else map.on("load", addPoints);
  }, [points]);

  return <div ref={containerRef} style={{ height: 400 }} className="w-full rounded-lg border" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/provedor/benchmark-regional.tsx
git commit -m "feat: Benchmark Regional — ranking CEPs, tendencia 6 meses, mapa de risco"
```

---

## Task 7: Deploy

- [ ] **Step 1: Push**

```bash
git push origin heatmap-fix:main
```

- [ ] **Step 2: Deploy na VPS**

```bash
cd /var/www/consulta-isp && git stash && git pull origin main && npm install && npm run build && pm2 restart consulta-isp
```
