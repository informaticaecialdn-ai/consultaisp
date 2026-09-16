import { Router } from "express";
import { requireAuth, requireProvider, requireAdmin } from "../auth";
import { dispatchSchema, routeSchema, visitSchema } from "@shared/recovery-field";
import { recoveryFieldService, FieldError, storedVisitSchema, type FieldActor } from "../services/recovery-field.service";
import { storage } from "../storage";
import { consultationCache } from "../services/consultation-cache.service";
import { getSafeErrorMessage } from "../utils/safe-error";
import type { Request, Response } from "express";

const actor = (req: Request): FieldActor => ({ providerId: req.session.providerId!, userId: req.session.userId!, manager: req.session.role === "admin" || req.session.role === "superadmin" });
const id = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new FieldError(400, "Identificador inválido"); return n; };
function fail(res: Response, error: unknown) { return res.status(error instanceof FieldError ? error.status : 500).json({ message: error instanceof FieldError ? error.message : getSafeErrorMessage(error) }); }
export function registerRecoveryFieldRoutes() {
  const router = Router();
  const root = "/api/equipment/field";
  router.use(root, requireAuth, requireProvider, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get(`${root}/cases`, async (req, res) => {
    try { return res.json({ cases: await recoveryFieldService.list(req.query.scope === "mine" ? { ...actor(req), manager: false } : actor(req)), limit: 2000 }); } catch (e) { return fail(res, e); }
  });
  router.get(`${root}/team`, requireAdmin, async (req, res) => {
    try { return res.json((await storage.getUsersByProvider(req.session.providerId!)).filter(u => ["admin", "user"].includes(u.role)).map(u => ({ id: u.id, name: u.name }))); } catch (e) { return fail(res, e); }
  });
  router.post(`${root}/route-preview`, requireAdmin, async (req, res) => {
    const parsed = routeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    try { return res.json(await recoveryFieldService.preview(actor(req), parsed.data)); } catch (e) { return fail(res, e); }
  });
  router.post(`${root}/dispatch`, requireAdmin, async (req, res) => {
    const parsed = dispatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    try { return res.status(201).json(await recoveryFieldService.dispatch(actor(req), parsed.data)); } catch (e) { return fail(res, e); }
  });
  router.post(`${root}/cases/:id/visits`, async (req, res) => {
    const parsed = visitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    try {
      const result = await recoveryFieldService.visit(actor(req), id(req.params.id), parsed.data);
      await storage.recalculateCustomerEquipmentAggregate(req.session.providerId!, result.customerId);
      consultationCache.invalidateAll();
      return res.status(result.replayed ? 200 : 201).json({ eventId: result.eventId, replayed: result.replayed });
    } catch (e) { return fail(res, e); }
  });
  router.get(`${root}/cases/:id/visits`, async (req, res) => {
    try {
      const rows = await recoveryFieldService.evidence(actor(req), id(req.params.id));
      return res.json(rows.flatMap(row => {
        const parsed = storedVisitSchema.safeParse(row.metadata);
        if (!parsed.success) return [];
        const visit = parsed.data.visit;
        return [{ id: row.id, caseId: row.caseId, result: row.result, occurredAt: row.occurredAt, technician: row.technician, notes: row.notes,
          nextAction: visit.nextAction, location: visit.location, locationReason: visit.locationReason,
          photos: visit.photos.map((p, index) => ({ name: p.name, url: `${root}/cases/${row.caseId}/visits/${row.id}/photos/${index}` })),
        }];
      }));
    } catch (e) { return fail(res, e); }
  });
  router.get(`${root}/cases/:id/visits/:eventId/photos/:index`, async (req, res) => {
    try {
      const rows = await recoveryFieldService.evidence(actor(req), id(req.params.id), id(req.params.eventId));
      const data = storedVisitSchema.safeParse(rows[0]?.metadata);
      const index = Number(req.params.index);
      const photo = data.success && Number.isInteger(index) && index >= 0 ? data.data.visit.photos[index] : undefined;
      if (!photo) return res.status(404).json({ message: "Evidência não encontrada" });
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      return res.type(photo.mime).send(Buffer.from(photo.base64, "base64"));
    } catch (e) { return fail(res, e); }
  });
  return router;
}
