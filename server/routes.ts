import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { sessionMiddleware, requireAuth, requireAdmin } from "./auth";
import { loginSchema, registerSchema } from "@shared/schema";
import { hashPassword, verifyPassword } from "./password";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(sessionMiddleware);

  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const { email, password } = parsed.data;
      const user = await storage.getUserByEmail(email);
      const valid = user ? await verifyPassword(password, user.password) : false;
      if (!user || !valid) {
        return res.status(401).json({ message: "Email ou senha incorretos" });
      }
      req.session.userId = user.id;
      req.session.providerId = user.providerId!;
      req.session.role = user.role;
      const provider = await storage.getProvider(user.providerId!);
      return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const { email, password, name, providerName, cnpj } = parsed.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email ja cadastrado" });
      }

      const existingProvider = await storage.getProviderByCnpj(cnpj);
      if (existingProvider) {
        return res.status(409).json({ message: "CNPJ ja cadastrado" });
      }

      const provider = await storage.createProvider({ name: providerName, cnpj, plan: "free", status: "active" });
      const user = await storage.createUser({
        email,
        password: await hashPassword(password),
        name,
        role: "admin",
        providerId: provider.id,
      });

      req.session.userId = user.id;
      req.session.providerId = provider.id;
      req.session.role = user.role;
      return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Deslogado com sucesso" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const provider = await storage.getProvider(user.providerId!);
    return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats(req.session.providerId!);
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers", requireAuth, async (req, res) => {
    try {
      const custs = await storage.getCustomersByProvider(req.session.providerId!);
      return res.json(custs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/customers", requireAuth, async (req, res) => {
    try {
      const customer = await storage.createCustomer({
        ...req.body,
        providerId: req.session.providerId!,
      });
      return res.json(customer);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/defaulters", requireAuth, async (req, res) => {
    try {
      const defaulters = await storage.getDefaultersByProvider(req.session.providerId!);
      return res.json(defaulters);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const invs = await storage.getInvoicesByProvider(req.session.providerId!);
      return res.json(invs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/equipment", requireAuth, async (req, res) => {
    try {
      const eqs = await storage.getEquipmentByProvider(req.session.providerId!);
      return res.json(eqs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/isp-consultations", requireAuth, async (req, res) => {
    try {
      const consultations = await storage.getIspConsultationsByProvider(req.session.providerId!);
      const today = await storage.getIspConsultationCountToday(req.session.providerId!);
      const month = await storage.getIspConsultationCountMonth(req.session.providerId!);
      const provider = await storage.getProvider(req.session.providerId!);
      return res.json({ consultations, todayCount: today, monthCount: month, credits: provider?.ispCredits || 0 });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/isp-consultations", requireAuth, async (req, res) => {
    try {
      const { cpfCnpj } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio" });
      }

      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider || provider.ispCredits <= 0) {
        return res.status(400).json({ message: "Creditos ISP insuficientes" });
      }

      const cleaned = cpfCnpj.replace(/\D/g, "");
      let searchType = "cpf";
      if (cleaned.length === 14) searchType = "cnpj";
      else if (cleaned.length === 8) searchType = "cep";

      const records = await storage.getCustomerByCpfCnpj(cleaned);

      const hasOverdue = records.some(r => r.status === "inactive");
      const score = records.length === 0 ? 750 : hasOverdue ? 250 : 650;
      const approved = score >= 400;

      const result = {
        cpfCnpj: cleaned,
        recordsFound: records.length,
        providersFound: [...new Set(records.map(r => r.providerId))].length,
        hasDefaultHistory: hasOverdue,
        details: records.map(r => ({
          providerName: "Provedor Regional",
          status: r.status,
          city: r.city,
        })),
      };

      const consultation = await storage.createIspConsultation({
        providerId: req.session.providerId!,
        userId: req.session.userId!,
        cpfCnpj: cleaned,
        searchType,
        result,
        score,
        approved,
      });

      await storage.updateProviderCredits(
        provider.id,
        provider.ispCredits - 1,
        provider.spcCredits,
      );

      return res.json({ consultation, result: { ...result, score, approved } });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/spc-consultations", requireAuth, async (req, res) => {
    try {
      const consultations = await storage.getSpcConsultationsByProvider(req.session.providerId!);
      const today = await storage.getSpcConsultationCountToday(req.session.providerId!);
      const month = await storage.getSpcConsultationCountMonth(req.session.providerId!);
      const provider = await storage.getProvider(req.session.providerId!);
      return res.json({ consultations, todayCount: today, monthCount: month, credits: provider?.spcCredits || 0 });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/spc-consultations", requireAuth, async (req, res) => {
    try {
      const { cpfCnpj } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio" });
      }

      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider || provider.spcCredits <= 0) {
        return res.status(400).json({ message: "Creditos SPC insuficientes" });
      }

      const cleaned = cpfCnpj.replace(/\D/g, "");
      const score = Math.floor(Math.random() * 600) + 200;

      const result = {
        cpfCnpj: cleaned,
        score,
        status: score >= 500 ? "regular" : "irregular",
        restrictions: score < 400 ? [
          { type: "Divida bancaria", value: "R$ 2.350,00", date: "2024-06-15" },
        ] : [],
        protests: [],
        bouncedChecks: [],
      };

      const consultation = await storage.createSpcConsultation({
        providerId: req.session.providerId!,
        userId: req.session.userId!,
        cpfCnpj: cleaned,
        result,
        score,
      });

      await storage.updateProviderCredits(
        provider.id,
        provider.ispCredits,
        provider.spcCredits - 1,
      );

      return res.json({ consultation, result });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/anti-fraud/alerts", requireAuth, async (req, res) => {
    try {
      const alerts = await storage.getAlertsByProvider(req.session.providerId!);
      return res.json(alerts);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/providers", requireAuth, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Acesso negado" });
      }
      const allProviders = await storage.getAllProviders();
      return res.json(allProviders);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const ctrs = await storage.getContractsByProvider(req.session.providerId!);
      return res.json(ctrs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
