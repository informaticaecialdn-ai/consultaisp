/**
 * Spec 012.5 — Cliente 360 routes
 *
 * GET /api/customers/:id/cliente-360
 *   Retorna payload completo (Cobranca + Recuperacao usam o mesmo, frontend
 *   decide qual tela mostrar baseado em contractStatus).
 *
 * Multi-tenant strict via storage.getCustomerByIdAndProvider.
 */
import express, { type Request, type Response, type Router } from "express";
import { requireAuth } from "../auth";
import { logger } from "../logger";
import { buildCliente360 } from "../services/cliente-360-builder";

export function registerCliente360Routes(): Router {
  const router: Router = express.Router();

  router.get("/api/customers/:id/cliente-360", requireAuth, async (req: Request, res: Response) => {
    const providerId = req.session.providerId;
    if (!providerId) {
      return res.status(401).json({ ok: false, error: "no_provider_context" });
    }
    const customerId = Number(req.params.id);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_customer_id" });
    }

    const started = Date.now();
    try {
      const payload = await buildCliente360(providerId, customerId);
      logger.debug(
        { action: "cliente_360_built", providerId, customerId, latencyMs: Date.now() - started, contractStatus: payload.cliente.contractStatus },
        "Cliente 360 payload computed",
      );
      return res.json({ ok: true, data: payload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "customer_not_found") {
        return res.status(404).json({ ok: false, error: "customer_not_found" });
      }
      logger.error({ action: "cliente_360_error", providerId, customerId, err: msg }, "Cliente 360 build failed");
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  return router;
}
