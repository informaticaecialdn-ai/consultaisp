/**
 * Integration tests para os 4 preview endpoints das Specs 009-014.
 *
 * Sem DB, sem chamadas externas — todos operam sobre inputs puros.
 * Auth mocked para simular operador logado.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth — operador autenticado, sem validar sessão real.
vi.mock("../auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!req.session) req.session = {};
    req.session.userId = 1;
    req.session.providerId = 1;
    next();
  },
  sessionMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { registerCustomerHealthRoutes } from "./customer-health.routes";
import { registerPixDynamicRoutes } from "./pix-dynamic.routes";
import { registerSilentExitRoutes } from "./silent-exit.routes";
import { registerCompetitorMonitorRoutes } from "./competitor-monitor.routes";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(registerCustomerHealthRoutes());
  app.use(registerPixDynamicRoutes());
  app.use(registerSilentExitRoutes());
  app.use(registerCompetitorMonitorRoutes());
});

/* ─────────────── customer-health ─────────────── */

describe("POST /api/customer-health/calculate-preview", () => {
  const baseInput = {
    contractMonths: 24,
    invoicesTotal: 24,
    invoicesPaid: 24,
    invoicesLate: 0,
    invoicesOverdueCurrent: 0,
    avgDaysLate30d: 0,
    avgDaysLate90d: 0,
    avgDaysLate365d: 0,
    totalRevenueAccumulatedCents: 240_000,
    brokenAgreementsCount: 0,
    ticketCount30d: 0,
    ticketCount90d: 1,
    lastInteractionDays: 15,
    avgSentimentScore90d: 0.5,
    consultaIspScore: 800,
  };

  it("retorna 200 com healthScore e tier para cliente saudável", async () => {
    const res = await request(app)
      .post("/api/customer-health/calculate-preview")
      .send(baseInput);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.healthScore).toBeGreaterThan(0);
    expect(res.body.data.healthScore).toBeLessThanOrEqual(100);
    expect(["gold", "healthy", "warning", "critical"]).toContain(res.body.data.healthTier);
    expect(res.body.data.components).toHaveProperty("punctuality");
    expect(res.body.data.predictions).toHaveProperty("inadimplenciaRisk30dPercent");
    expect(res.body.data.recommendation).toHaveProperty("recommendedAgent");
  });

  it("retorna 400 com erro detalhado se body é inválido", async () => {
    const res = await request(app)
      .post("/api/customer-health/calculate-preview")
      .send({ contractMonths: -5 });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("invalid_input");
  });

  it("aceita inputs nulláveis (cliente sem histórico)", async () => {
    const res = await request(app)
      .post("/api/customer-health/calculate-preview")
      .send({
        contractMonths: 0,
        invoicesTotal: 0,
        invoicesPaid: 0,
        invoicesLate: 0,
        invoicesOverdueCurrent: 0,
        avgDaysLate30d: null,
        avgDaysLate90d: null,
        avgDaysLate365d: null,
        totalRevenueAccumulatedCents: 0,
        brokenAgreementsCount: 0,
        ticketCount30d: 0,
        ticketCount90d: 0,
        lastInteractionDays: null,
        avgSentimentScore90d: null,
        consultaIspScore: null,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("GET /api/customer-health/health", () => {
  it("retorna status público sem auth", async () => {
    const res = await request(app).get("/api/customer-health/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("customer-health");
  });
});

/* ─────────────── pix-dynamic ─────────────── */

describe("POST /api/pix-dynamic/preview-offer", () => {
  it("usa default tiers quando body não passa tiers", async () => {
    const res = await request(app)
      .post("/api/pix-dynamic/preview-offer")
      .send({ baseAmountCents: 9990 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.resolvedTiers).toHaveLength(3);
    expect(res.body.data.state.currentTier).not.toBeNull();
    expect(res.body.data.customerText).toHaveLength(3);
  });

  it("calcula amountCents com decay correto", async () => {
    const res = await request(app)
      .post("/api/pix-dynamic/preview-offer")
      .send({ baseAmountCents: 10000 });

    expect(res.body.data.resolvedTiers[0].amountCents).toBe(9000);   // 10% off
    expect(res.body.data.resolvedTiers[1].amountCents).toBe(9500);   // 5% off
    expect(res.body.data.resolvedTiers[2].amountCents).toBe(10000);  // 0% off
  });

  it("aceita createdAt + now para simulação temporal", async () => {
    const res = await request(app)
      .post("/api/pix-dynamic/preview-offer")
      .send({
        baseAmountCents: 9990,
        createdAt: "2026-05-15T10:00:00Z",
        now: "2026-05-15T15:00:00Z",  // 5h depois → tier 1 (4h)
      });

    expect(res.status).toBe(200);
    expect(res.body.data.state.currentTier?.index).toBe(1);
  });

  it("isExpired=true quando now > finalExpiresAt", async () => {
    const res = await request(app)
      .post("/api/pix-dynamic/preview-offer")
      .send({
        baseAmountCents: 9990,
        createdAt: "2026-05-15T10:00:00Z",
        now: "2026-05-17T10:00:00Z",  // 48h depois — oferta expirou (janela default 24h)
      });

    expect(res.body.data.state.isExpired).toBe(true);
    expect(res.body.data.state.currentTier).toBeNull();
  });

  it("rejeita baseAmountCents abaixo do mínimo", async () => {
    const res = await request(app)
      .post("/api/pix-dynamic/preview-offer")
      .send({ baseAmountCents: 50 });  // < 100 (R$ 1,00 mínimo)

    expect(res.status).toBe(400);
  });
});

/* ─────────────── silent-exit ─────────────── */

describe("POST /api/silent-exit/preview-risk", () => {
  it("retorna noise para cliente sem sinais", async () => {
    const res = await request(app)
      .post("/api/silent-exit/preview-risk")
      .send({
        bandwidthDropPercent: null,
        portalLoginCount30d: null,
        portalLoginCountBaseline: null,
        secondViaSearches30d: 0,
        ticketCount30d: 2,
        ticketCountBaseline: 3,
        utmCompetitorReferrer: false,
        daysWithoutLogin: 10,
        recentPlanDowngrade: false,
        healthScoreTrend: "stable",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.riskLevel).toBe("noise");
    expect(res.body.data.riskScore).toBe(0);
  });

  it("retorna high para cliente com múltiplos sinais", async () => {
    const res = await request(app)
      .post("/api/silent-exit/preview-risk")
      .send({
        bandwidthDropPercent: 80,
        portalLoginCount30d: 30,
        portalLoginCountBaseline: 5,
        secondViaSearches30d: 3,
        ticketCount30d: 0,
        ticketCountBaseline: 5,
        utmCompetitorReferrer: true,
        daysWithoutLogin: 120,
        recentPlanDowngrade: true,
        healthScoreTrend: "declining",
      });

    expect(res.body.data.riskLevel).toBe("high");
    expect(res.body.data.riskScore).toBeGreaterThanOrEqual(70);
    expect(Object.keys(res.body.data.contributions).length).toBeGreaterThan(3);
  });

  it("rejeita inputs inválidos", async () => {
    const res = await request(app)
      .post("/api/silent-exit/preview-risk")
      .send({ bandwidthDropPercent: 150 });

    expect(res.status).toBe(400);
  });
});

/* ─────────────── competitor-monitor ─────────────── */

describe("POST /api/competitor-monitor/preview-classify", () => {
  const context = {
    cities: ["Londrina", "Ibiporã"],
    state: "PR",
    knownCompetitors: ["Sercomtel", "Copel Telecom"],
  };

  it("classifica Facebook como unrelated com alta confidence", async () => {
    const res = await request(app)
      .post("/api/competitor-monitor/preview-classify")
      .send({
        results: [
          {
            title: "Provedor X Londrina",
            url: "https://facebook.com/provedor-x",
            snippet: "Anúncio fibra",
          },
        ],
        context,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.classified[0].heuristic.classification).toBe("unrelated");
    expect(res.body.data.classified[0].heuristic.confidence).toBeGreaterThanOrEqual(0.9);
    expect(res.body.data.classified[0].needsLlm).toBe(false);
  });

  it("classifica Sercomtel como existing_provider", async () => {
    const res = await request(app)
      .post("/api/competitor-monitor/preview-classify")
      .send({
        results: [
          {
            title: "Sercomtel novo plano",
            url: "https://sercomtel.com.br/planos",
            snippet: "Planos de internet fibra em Londrina",
          },
        ],
        context,
      });

    expect(res.body.data.classified[0].heuristic.classification).toBe("existing_provider");
  });

  it("classifica novo provedor com ISP + cidade + cobertura como new_provider", async () => {
    const res = await request(app)
      .post("/api/competitor-monitor/preview-classify")
      .send({
        results: [
          {
            title: "FibraX agora em Londrina",
            url: "https://fibrax-internet.com.br",
            snippet:
              "Provedor de internet fibra óptica chegamos em Londrina com cobertura total.",
          },
        ],
        context,
      });

    expect(res.body.data.classified[0].heuristic.classification).toBe("new_provider");
  });

  it("retorna stats agregados", async () => {
    const res = await request(app)
      .post("/api/competitor-monitor/preview-classify")
      .send({
        results: [
          { title: "T1", url: "https://facebook.com/x", snippet: "y" },
          { title: "T2", url: "https://mercadolivre.com.br", snippet: "roteador" },
          { title: "T3", url: "https://random.com.br", snippet: "nada relevante" },
        ],
        context,
      });

    expect(res.body.data.stats.total).toBe(3);
    expect(res.body.data.stats.unrelated).toBeGreaterThanOrEqual(2);
  });

  it("rejeita state com mais de 2 caracteres", async () => {
    const res = await request(app)
      .post("/api/competitor-monitor/preview-classify")
      .send({
        results: [{ title: "t", url: "https://x.com", snippet: "y" }],
        context: { cities: ["Londrina"], state: "ParanÁ", knownCompetitors: [] },
      });

    expect(res.status).toBe(400);
  });
});
