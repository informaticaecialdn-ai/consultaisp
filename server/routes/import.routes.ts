import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

const MAX_IMPORT_ROWS = 5000;

export function registerImportRoutes(): Router {
  const router = Router();

  router.post("/api/import/customers", requireAuth, async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha enviada" });
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ message: `Limite de ${MAX_IMPORT_ROWS} registros por importacao excedido.` });
      }
      const providerId = req.session.providerId!;
      const result = await storage.bulkImportCustomers(rows, providerId);
      if (result.errors.length > 0) {
        return res.status(400).json({ message: "Lote rejeitado: corrija os erros e reenvie.", ...result });
      }
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: `Importacao falhou (nenhum registro salvo): ${getSafeErrorMessage(error)}` });
    }
  });

  router.post("/api/import/invoices", requireAuth, async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha enviada" });
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ message: `Limite de ${MAX_IMPORT_ROWS} registros por importacao excedido.` });
      }
      const providerId = req.session.providerId!;
      const result = await storage.bulkImportInvoices(rows, providerId);
      if (result.errors.length > 0) {
        return res.status(400).json({ message: "Lote rejeitado: corrija os erros e reenvie.", ...result });
      }
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: `Importacao falhou (nenhum registro salvo): ${getSafeErrorMessage(error)}` });
    }
  });

  router.post("/api/import/equipment", requireAuth, async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha enviada" });
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ message: `Limite de ${MAX_IMPORT_ROWS} registros por importacao excedido.` });
      }
      const providerId = req.session.providerId!;
      const result = await storage.bulkImportEquipment(rows, providerId);
      if (result.errors.length > 0) {
        return res.status(400).json({ message: "Lote rejeitado: corrija os erros e reenvie.", ...result });
      }
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ message: `Importacao falhou (nenhum registro salvo): ${getSafeErrorMessage(error)}` });
    }
  });

  return router;
}
