import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { hashPassword } from "../password";
import crypto from "crypto";

export function registerProviderRoutes(): Router {
  const router = Router();

  router.get("/api/tenant/resolve", async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const provider = await storage.getProviderBySubdomain(subdomain);
    if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
    return res.json({
      id: provider.id,
      name: provider.name,
      subdomain: provider.subdomain,
      plan: provider.plan,
      status: provider.status,
    });
  });

  router.get("/api/provider/users", requireAuth, async (req, res) => {
    try {
      const providerUsers = await storage.getUsersByProvider(req.session.providerId!);
      const safe = providerUsers.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));
      return res.json(safe);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/provider/users", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem convidar usuarios" });
      }
      const { name, email, password, role } = req.body as { name: string; email: string; password: string; role: string };
      if (!name || !email || !password) {
        return res.status(400).json({ message: "Nome, email e senha sao obrigatorios" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "Email ja cadastrado" });

      const newUser = await storage.createUser({
        name, email,
        password: await hashPassword(password),
        role: role === "admin" ? "admin" : "user",
        providerId: req.session.providerId!,
        emailVerified: true,
      });
      return res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/provider/users/:id", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem remover usuarios" });
      }
      const userId = parseInt(req.params.id);
      if (userId === req.session.userId) {
        return res.status(400).json({ message: "Voce nao pode remover sua propria conta" });
      }
      const targetUser = await storage.getUser(userId);
      if (!targetUser || targetUser.providerId !== req.session.providerId) {
        return res.status(404).json({ message: "Usuario nao encontrado" });
      }
      await storage.deleteUser(userId);
      return res.json({ message: "Usuario removido com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/provider/settings", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem alterar configuracoes" });
      }
      const { updateProviderSchema } = await import("@shared/schema");
      const parsed = updateProviderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos" });
      const updated = await storage.updateProvider(req.session.providerId!, parsed.data);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/profile", requireAuth, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const partners = await storage.getProviderPartners(req.session.providerId!);
      const documents = await storage.getProviderDocuments(req.session.providerId!);
      return res.json({ ...provider, partners, documents });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/integration", requireAuth, async (req, res) => {
    try {
      const token = await storage.getProviderWebhookToken(req.session.providerId!);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({ token, webhookUrl: `${baseUrl}/api/webhooks/erp-sync` });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/provider/integration/regenerate-token", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") return res.status(403).json({ message: "Apenas administradores" });
      const token = await storage.regenerateWebhookToken(req.session.providerId!);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({ token, webhookUrl: `${baseUrl}/api/webhooks/erp-sync` });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/n8n-config", requireAuth, async (req, res) => {
    try {
      const config = await storage.getN8nConfig(req.session.providerId!);
      return res.json(config);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/provider/n8n-config", requireAuth, async (req, res) => {
    try {
      const { n8nWebhookUrl, n8nAuthToken, n8nEnabled, n8nErpProvider } = req.body;
      await storage.saveN8nConfig(req.session.providerId!, { n8nWebhookUrl, n8nAuthToken, n8nEnabled, n8nErpProvider });
      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/provider/n8n-config/test", requireAuth, async (req, res) => {
    try {
      const config = await storage.getN8nConfig(req.session.providerId!);
      if (!config.n8nWebhookUrl) {
        return res.json({ ok: false, message: "URL do webhook nao configurada" });
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.n8nAuthToken) {
        headers["Authorization"] = `Basic ${config.n8nAuthToken}`;
      }
      const testPayload = {
        searchType: "document",
        document: "00000000000",
        providerId: String(req.session.providerId),
        test: true,
      };
      try {
        const response = await fetch(config.n8nWebhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(testPayload),
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          return res.json({ ok: false, message: "Erro 401: Token de autenticacao invalido" });
        }
        if (response.ok || response.status === 404) {
          return res.json({ ok: true, message: `Conexao estabelecida (HTTP ${response.status})` });
        }
        return res.json({ ok: false, message: `Erro HTTP ${response.status}` });
      } catch (fetchErr: any) {
        return res.json({ ok: false, message: `Falha na conexao: ${fetchErr.message}` });
      }
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/provider/profile", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem alterar o perfil" });
      }
      const allowedFields = [
        "name", "tradeName", "cnpj", "legalType", "openingDate", "businessSegment",
        "contactEmail", "contactPhone", "website",
        "addressZip", "addressStreet", "addressNumber", "addressComplement",
        "addressNeighborhood", "addressCity", "addressState",
      ];
      const data: any = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) data[field] = req.body[field];
      }
      const updated = await storage.updateProviderProfile(req.session.providerId!, data);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/partners", requireAuth, async (req, res) => {
    try {
      const partners = await storage.getProviderPartners(req.session.providerId!);
      return res.json(partners);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/provider/partners", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem adicionar socios" });
      }
      const { name, cpf, birthDate, email, phone, role, sharePercentage } = req.body;
      if (!name || !cpf) return res.status(400).json({ message: "Nome e CPF sao obrigatorios" });
      const partner = await storage.createProviderPartner({
        providerId: req.session.providerId!,
        name, cpf, birthDate, email, phone, role,
        sharePercentage: sharePercentage ? String(sharePercentage) : undefined,
      });
      return res.json(partner);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/provider/partners/:id", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem editar socios" });
      }
      const id = parseInt(req.params.id);
      const { name, cpf, birthDate, email, phone, role, sharePercentage } = req.body;
      const updated = await storage.updateProviderPartner(id, req.session.providerId!, {
        name, cpf, birthDate, email, phone, role,
        sharePercentage: sharePercentage ? String(sharePercentage) : undefined,
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/provider/partners/:id", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem remover socios" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteProviderPartner(id, req.session.providerId!);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/documents", requireAuth, async (req, res) => {
    try {
      const docs = await storage.getProviderDocuments(req.session.providerId!);
      const docsNoData = docs.map(({ fileData, ...rest }) => rest);
      return res.json(docsNoData);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/provider/documents", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem enviar documentos" });
      }
      const { documentType, documentName, documentMimeType, documentSize, fileData } = req.body;
      if (!documentType || !documentName || !fileData) {
        return res.status(400).json({ message: "Dados do documento incompletos" });
      }
      const doc = await storage.createProviderDocument({
        providerId: req.session.providerId!,
        documentType, documentName, documentMimeType, documentSize,
        fileData,
        status: "pending",
        uploadedById: req.session.providerId,
      });
      const { fileData: _, ...docNoData } = doc;
      return res.json(docNoData);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.delete("/api/provider/documents/:id", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem remover documentos" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteProviderDocument(id, req.session.providerId!);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/provider/documents/:id/download", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const doc = await storage.getProviderDocument(id);
      if (!doc || doc.providerId !== req.session.providerId!) {
        return res.status(404).json({ message: "Documento nao encontrado" });
      }
      const buffer = Buffer.from(doc.fileData.split(",")[1] || doc.fileData, "base64");
      res.setHeader("Content-Type", doc.documentMimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${doc.documentName}"`);
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
