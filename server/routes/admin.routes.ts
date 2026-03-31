import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { hashPassword } from "../password";
import { sendVerificationEmail } from "../email";
import crypto from "crypto";

export function registerAdminRoutes(): Router {
  const router = Router();

  router.get("/api/admin/stats", requireSuperAdmin, async (_req, res) => {
    try {
      const stats = await storage.getSystemStats();
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/providers", requireSuperAdmin, async (_req, res) => {
    try {
      const allProviders = await storage.getAllProviders();
      const withStats = await Promise.all(allProviders.map(async (p) => {
        const provUsers = await storage.getUsersByProvider(p.id);
        const adminUser = provUsers.find(u => u.role === "admin");
        return {
          ...p,
          userCount: provUsers.length,
          adminEmailVerified: adminUser ? adminUser.emailVerified : false,
        };
      }));
      return res.json(withStats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/providers", requireSuperAdmin, async (req, res) => {
    try {
      const { name, cnpj, subdomain, plan, adminName, adminEmail, adminPassword } = req.body;
      if (!name || !cnpj || !subdomain || !adminName || !adminEmail || !adminPassword) {
        return res.status(400).json({ message: "Todos os campos sao obrigatorios" });
      }
      const existingCnpj = await storage.getProviderByCnpj(cnpj);
      if (existingCnpj) return res.status(409).json({ message: "CNPJ ja cadastrado" });
      const existingSubdomain = await storage.getProviderBySubdomain(subdomain);
      if (existingSubdomain) return res.status(409).json({ message: "Subdominio ja em uso" });
      const existingEmail = await storage.getUserByEmail(adminEmail);
      if (existingEmail) return res.status(409).json({ message: "Email do admin ja cadastrado" });

      const provider = await storage.createProvider({ name, cnpj, subdomain, plan: plan || "free", status: "active" });
      const user = await storage.createUser({
        name: adminName, email: adminEmail,
        password: await hashPassword(adminPassword),
        role: "admin", providerId: provider.id, emailVerified: true,
      });
      return res.status(201).json({ provider, user: { id: user.id, name: user.name, email: user.email } });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/admin/providers/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.adminUpdateProvider(id, req.body);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/admin/providers/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      await storage.deleteProvider(id);
      return res.json({ message: "Provedor excluido com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/providers/:id/resend-verification", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const users = await storage.getUsersByProvider(id);
      const adminUser = users.find(u => u.role === "admin");
      if (!adminUser) return res.status(404).json({ message: "Usuario administrador do provedor nao encontrado" });
      if (adminUser.emailVerified) return res.json({ message: "Email ja verificado." });
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setVerificationToken(adminUser.id, token, expiresAt);
      await sendVerificationEmail(adminUser.email, adminUser.name, token);
      return res.json({ message: "Email de verificacao reenviado com sucesso." });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/providers/:id/plan", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { plan, notes } = req.body;
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const updated = await storage.updateProviderPlan(id, plan);
      await storage.createPlanChange({
        providerId: id, oldPlan: provider.plan, newPlan: plan,
        ispCreditsAdded: 0, spcCreditsAdded: 0,
        changedById: req.session.userId, changedByName: "Administrador do Sistema",
        notes: notes || null,
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/admin/providers/:id/credits", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { ispCredits = 0, spcCredits = 0, notes } = req.body;
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const updated = await storage.addCredits(id, ispCredits, spcCredits);
      if (ispCredits !== 0 || spcCredits !== 0) {
        await storage.createPlanChange({
          providerId: id, oldPlan: null, newPlan: null,
          ispCreditsAdded: ispCredits, spcCreditsAdded: spcCredits,
          changedById: req.session.userId, changedByName: "Administrador do Sistema",
          notes: notes || `Creditos adicionados: ISP +${ispCredits}, SPC +${spcCredits}`,
        });
      }
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/providers/:id/detail", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const [users, customers, equipmentList, ispList, spcList, invoices, planHistory] = await Promise.all([
        storage.getUsersByProvider(id),
        storage.getCustomersByProvider(id),
        storage.getEquipmentByProvider(id),
        storage.getIspConsultationsByProvider(id),
        storage.getSpcConsultationsByProvider(id),
        storage.getAllProviderInvoices(id),
        storage.getPlanChanges(id),
      ]);

      const safeUsers = users.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));

      const now = new Date();
      const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const ispMonth = ispList.filter(c => new Date(c.createdAt) >= firstDayMonth).length;
      const spcMonth = spcList.filter(c => new Date(c.createdAt) >= firstDayMonth).length;

      const totalPaid = invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.amount), 0);
      const totalPending = invoices.filter(i => i.status === "pending").reduce((s, i) => s + parseFloat(i.amount), 0);
      const totalOverdue = invoices.filter(i => i.status === "overdue").reduce((s, i) => s + parseFloat(i.amount), 0);

      return res.json({
        provider,
        users: safeUsers,
        stats: {
          customers: customers.length,
          equipment: equipmentList.length,
          ispConsultations: ispList.length,
          spcConsultations: spcList.length,
          ispConsultationsMonth: ispMonth,
          spcConsultationsMonth: spcMonth,
        },
        invoices,
        planHistory,
        financial: { totalPaid, totalPending, totalOverdue },
        recentIsp: ispList.slice(0, 20),
        recentSpc: spcList.slice(0, 20),
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/providers/:id/integration", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const [token, integrations, logs] = await Promise.all([
        storage.getProviderWebhookToken(id),
        storage.getErpIntegrations(id),
        storage.getErpSyncLogs(id, undefined, 20),
      ]);
      return res.json({ token, integrations, logs });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.put("/api/admin/providers/:id/erp/:source", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const source = req.params.source;
      const ALLOWED = ["ixc", "sgp", "mk", "tiacos", "hubsoft", "flyspeed", "netflash"];
      if (!ALLOWED.includes(source)) return res.status(400).json({ message: "ERP invalido" });
      const provider = await storage.getProvider(id);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const { apiUrl, apiToken, apiUser, isEnabled } = req.body;
      const integration = await storage.upsertErpIntegration(id, source, {
        apiUrl: apiUrl ?? null,
        apiToken: apiToken ?? null,
        apiUser: apiUser ?? null,
        isEnabled: isEnabled ?? true,
      });
      return res.json(integration);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/users", requireSuperAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const safe = allUsers.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        providerId: u.providerId, emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));
      return res.json(safe);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/admin/users/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteUser(id);
      return res.json({ message: "Usuario removido" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/admin/users/:id/email", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { email } = req.body;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ message: "Email invalido" });
      }
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "Usuario nao encontrado" });
      }
      const existing = await storage.getUserByEmail(email.trim().toLowerCase());
      if (existing && existing.id !== id) {
        return res.status(409).json({ message: "Este email ja esta em uso por outro usuario" });
      }
      await storage.updateUserEmail(id, email.trim().toLowerCase());
      return res.json({ message: "Email atualizado com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/plan-history", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const changes = await storage.getPlanChanges(providerId);
      return res.json(changes);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- Admin document review ----

  router.patch("/api/admin/providers/:id/documents/:docId/status", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "superadmin") {
        return res.status(403).json({ message: "Apenas superadmin pode revisar documentos" });
      }
      const docId = parseInt(req.params.docId);
      const { status, rejectionReason } = req.body;
      if (!["approved", "rejected", "pending"].includes(status)) {
        return res.status(400).json({ message: "Status invalido" });
      }
      const reviewer = await storage.getUser(req.session.userId!);
      const updated = await storage.updateProviderDocumentStatus(
        docId, status,
        req.session.userId!, reviewer?.name || "Admin",
        rejectionReason
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/providers/:id/documents", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "superadmin") {
        return res.status(403).json({ message: "Acesso negado" });
      }
      const providerId = parseInt(req.params.id);
      const docs = await storage.getProviderDocuments(providerId);
      const docsNoData = docs.map(({ fileData, ...rest }) => rest);
      return res.json(docsNoData);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/providers/:id/documents/:docId/download", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "superadmin") {
        return res.status(403).json({ message: "Acesso negado" });
      }
      const docId = parseInt(req.params.docId);
      const doc = await storage.getProviderDocument(docId);
      if (!doc) return res.status(404).json({ message: "Documento nao encontrado" });
      const buffer = Buffer.from(doc.fileData.split(",")[1] || doc.fileData, "base64");
      res.setHeader("Content-Type", doc.documentMimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${doc.documentName}"`);
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- ERP Catalog admin CRUD ----

  router.post("/api/admin/erp-catalog", requireSuperAdmin, async (req, res) => {
    try {
      const { insertErpCatalogSchema } = await import("@shared/schema");
      const data = insertErpCatalogSchema.parse(req.body);
      const item = await storage.createErpCatalogItem(data);
      return res.status(201).json(item);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  });

  router.patch("/api/admin/erp-catalog/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.updateErpCatalogItem(id, req.body);
      return res.json(item);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/admin/erp-catalog/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteErpCatalogItem(id);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
