import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { hashPassword } from "../password";
import { sendVerificationEmail } from "../email";
import { getConnector } from "../erp/registry";
import "../erp/index";
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
        const erpIntegrations = await storage.getErpIntegrations(p.id);
        const activeErp = erpIntegrations.find(i => i.isEnabled && i.apiUrl);
        return {
          ...p,
          userCount: provUsers.length,
          adminEmailVerified: adminUser ? adminUser.emailVerified : false,
          erpSource: activeErp?.erpSource || null,
          erpUrl: activeErp?.apiUrl || null,
          erpToken: activeErp ? `${activeErp.apiUser || ""}:${activeErp.apiToken || ""}`.replace(/^:/, "") : null,
          erpEnabled: activeErp?.isEnabled || false,
        };
      }));
      return res.json(withStats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // CNPJ lookup with 3 fallback sources
  router.get("/api/admin/cnpj/:cnpj", requireSuperAdmin, async (req, res) => {
    try {
      const cnpj = String(req.params.cnpj).replace(/\D/g, "");
      if (cnpj.length !== 14) return res.status(400).json({ message: "CNPJ invalido" });

      // Try sources in order: ReceitaWS → BrasilAPI → CNPJ.ws
      const sources = [
        {
          name: "ReceitaWS",
          url: `https://receitaws.com.br/v1/cnpj/${cnpj}`,
          parse: (d: any) => ({
            razaoSocial: d.nome || "",
            nomeFantasia: d.fantasia || "",
            cnpj: d.cnpj?.replace(/\D/g, "") || cnpj,
            naturezaJuridica: d.natureza_juridica || "",
            dataAbertura: d.abertura || "",
            atividadePrincipal: d.atividade_principal?.[0]?.text || "",
            telefone: d.telefone || "",
            email: d.email || "",
            cep: d.cep?.replace(/\D/g, "") || "",
            logradouro: d.logradouro || "",
            numero: d.numero || "",
            complemento: d.complemento || "",
            bairro: d.bairro || "",
            cidade: d.municipio || "",
            uf: d.uf || "",
            situacao: d.situacao || "",
            socios: (d.qsa || []).map((s: any) => ({
              nome: s.nome || "",
              qualificacao: s.qual || "",
              cpf: "",
            })),
          }),
        },
        {
          name: "BrasilAPI",
          url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
          parse: (d: any) => ({
            razaoSocial: d.razao_social || "",
            nomeFantasia: d.nome_fantasia || "",
            cnpj: d.cnpj || cnpj,
            naturezaJuridica: d.natureza_juridica || "",
            dataAbertura: d.data_inicio_atividade || "",
            atividadePrincipal: d.cnae_fiscal_descricao || "",
            telefone: d.ddd_telefone_1 ? `(${d.ddd_telefone_1.slice(0, 2)}) ${d.ddd_telefone_1.slice(2)}` : "",
            email: d.email || "",
            cep: d.cep || "",
            logradouro: d.logradouro || "",
            numero: d.numero || "",
            complemento: d.complemento || "",
            bairro: d.bairro || "",
            cidade: d.municipio || "",
            uf: d.uf || "",
            situacao: d.descricao_situacao_cadastral || "",
            socios: (d.qsa || []).map((s: any) => ({
              nome: s.nome_socio || "",
              qualificacao: s.qualificacao_socio || "",
              cpf: s.cnpj_cpf_do_socio || "",
            })),
          }),
        },
        {
          name: "Publica",
          url: `https://publica.cnpj.ws/cnpj/${cnpj}`,
          parse: (d: any) => ({
            razaoSocial: d.razao_social || "",
            nomeFantasia: d.estabelecimento?.nome_fantasia || "",
            cnpj: cnpj,
            naturezaJuridica: d.natureza_juridica?.descricao || "",
            dataAbertura: d.estabelecimento?.data_inicio_atividade || "",
            atividadePrincipal: d.estabelecimento?.atividade_principal?.descricao || "",
            telefone: d.estabelecimento?.ddd1 && d.estabelecimento?.telefone1 ? `(${d.estabelecimento.ddd1}) ${d.estabelecimento.telefone1}` : "",
            email: d.estabelecimento?.email || "",
            cep: d.estabelecimento?.cep || "",
            logradouro: d.estabelecimento?.logradouro || "",
            numero: d.estabelecimento?.numero || "",
            complemento: d.estabelecimento?.complemento || "",
            bairro: d.estabelecimento?.bairro || "",
            cidade: d.estabelecimento?.cidade?.nome || "",
            uf: d.estabelecimento?.estado?.sigla || "",
            situacao: d.estabelecimento?.situacao_cadastral || "",
            socios: (d.socios || []).map((s: any) => ({
              nome: s.nome || "",
              qualificacao: s.qualificacao?.descricao || "",
              cpf: s.cpf_cnpj_socio || "",
            })),
          }),
        },
      ];

      for (const source of sources) {
        try {
          const response = await fetch(source.url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) continue;
          const data = await response.json();
          if (data.status === "ERROR" || data.error) continue;
          const parsed = source.parse(data);
          if (!parsed.razaoSocial) continue;
          console.log(`[CNPJ] ${cnpj} found via ${source.name}`);
          return res.json(parsed);
        } catch {
          continue;
        }
      }

      return res.status(404).json({ message: "CNPJ nao encontrado em nenhuma fonte" });
    } catch (error: any) {
      return res.status(500).json({ message: "Erro ao consultar CNPJ: " + error.message });
    }
  });

  router.post("/api/admin/providers", requireSuperAdmin, async (req, res) => {
    try {
      const { name, tradeName, cnpj, subdomain, plan, adminName, adminEmail, adminPassword,
        contactEmail, contactPhone, addressZip, addressStreet, addressNumber,
        addressComplement, addressNeighborhood, addressCity, addressState,
        legalType, openingDate, businessSegment } = req.body;
      if (!name || !cnpj || !subdomain || !adminName || !adminEmail || !adminPassword) {
        return res.status(400).json({ message: "Todos os campos obrigatorios devem ser preenchidos" });
      }
      const existingCnpj = await storage.getProviderByCnpj(cnpj);
      if (existingCnpj) return res.status(409).json({ message: "CNPJ ja cadastrado" });
      const existingSubdomain = await storage.getProviderBySubdomain(subdomain);
      if (existingSubdomain) return res.status(409).json({ message: "Subdominio ja em uso" });
      const existingEmail = await storage.getUserByEmail(adminEmail);
      if (existingEmail) return res.status(409).json({ message: "Email do admin ja cadastrado" });

      const provider = await storage.createProvider({
        name, tradeName, cnpj, subdomain, plan: plan || "free", status: "active",
        contactEmail, contactPhone, addressZip, addressStreet, addressNumber,
        addressComplement, addressNeighborhood, addressCity, addressState,
        legalType, openingDate, businessSegment,
      });
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

  // Superadmin creates user for a specific provider (CRUD-02)
  router.post("/api/admin/providers/:id/users", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = parseInt(req.params.id);
      const { name, email, password, role } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ message: "Nome, email e senha sao obrigatorios" });
      }

      const validRoles = ["admin", "user"];
      const userRole = validRoles.includes(role) ? role : "user";

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email ja cadastrado" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        name,
        email,
        password: hashedPassword,
        role: userRole,
        providerId,
      });

      const { password: _, ...userWithoutPassword } = user;
      return res.status(201).json(userWithoutPassword);
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

  // ── ERP Connection Test ──
  router.post("/api/admin/providers/:id/erp-test", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const integrations = await storage.getErpIntegrations(id);
      const erpIntg = integrations.find(i => i.isEnabled && i.apiUrl && i.apiToken);

      if (!erpIntg) {
        return res.json({ ok: false, message: "ERP nao configurado. Salve a URL e credenciais primeiro." });
      }

      const connector = getConnector(erpIntg.erpSource);
      if (!connector) {
        return res.json({ ok: false, message: `Conector ${erpIntg.erpSource} nao disponivel` });
      }

      const testResult = await connector.testConnection({
        apiUrl: erpIntg.apiUrl!,
        apiToken: erpIntg.apiToken!,
        apiUser: erpIntg.apiUser || undefined,
        extra: {},
      });
      return res.json(testResult);
    } catch (error: any) {
      return res.json({ ok: false, message: `Erro: ${error.message}` });
    }
  });

  // ── ERP Config Save (per provider) ──
  router.put("/api/admin/providers/:id/erp-config", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { erpSource, apiUrl, apiToken } = req.body;

      if (!erpSource || !apiUrl || !apiToken) {
        return res.status(400).json({ message: "erpSource, apiUrl e apiToken sao obrigatorios" });
      }

      // Parse IXC-style "userId:token" format
      let apiUser: string | undefined;
      let cleanToken = apiToken;
      if (cleanToken.includes(":")) {
        const parts = cleanToken.split(":", 2);
        apiUser = parts[0];
        cleanToken = parts[1];
      }

      const url = apiUrl.startsWith("http") ? apiUrl : `https://${apiUrl}`;
      await storage.upsertErpIntegration(id, erpSource, {
        apiUrl: url,
        apiToken: cleanToken,
        apiUser: apiUser || null,
        isEnabled: true,
      } as any);

      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
