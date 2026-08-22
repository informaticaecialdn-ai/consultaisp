import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

/**
 * Rotas de equipamento. Dono unico de /api/equipment desde que o handler
 * duplicado saiu de dashboard.routes.ts.
 */

const equipamentoSchema = z.object({
  customerId: z.number().int().positive().optional(),
  // required_error alem do min(1): faltando o campo inteiro, o Zod emite
  // invalid_type e a mensagem do min() nunca aparece — o erro sairia "Required".
  type: z.string({ required_error: "Informe o tipo do equipamento" })
    .min(1, "Informe o tipo do equipamento"),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  mac: z.string().optional(),
  status: z.enum(["installed", "devolvido", "retido", "em_cobranca", "baixado"]).default("installed"),
  inRecoveryProcess: z.boolean().default(false),
  value: z.string().optional(),
});

export function registerEquipamentosRoutes(): Router {
  const router = Router();

  router.get("/api/equipment", requireAuth, async (req, res) => {
    try {
      const eqs = await storage.getEquipmentByProvider(req.session.providerId!);
      return res.json(eqs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/equipment", requireAuth, async (req, res) => {
    try {
      const parsed = equipamentoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }
      // providerId vem da sessao, nunca do corpo: aceitar do cliente deixaria
      // um provedor cadastrar equipamento na base de outro.
      const criado = await storage.createEquipment({
        ...parsed.data,
        providerId: req.session.providerId!,
      } as any);
      return res.status(201).json(criado);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/equipment/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id invalido" });

      const parsed = equipamentoSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }
      const atualizado = await storage.updateEquipment(id, req.session.providerId!, parsed.data as any);
      if (!atualizado) return res.status(404).json({ message: "Equipamento nao encontrado" });
      return res.json(atualizado);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/equipment/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id invalido" });

      const ok = await storage.removeEquipment(id, req.session.providerId!);
      if (!ok) return res.status(404).json({ message: "Equipamento nao encontrado" });
      return res.status(204).end();
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
