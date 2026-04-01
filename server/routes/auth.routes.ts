import { Router } from "express";
import { storage } from "../storage";
import { loginSchema, registerSchema } from "@shared/schema";
import { hashPassword, verifyPassword } from "../password";
import { sendVerificationEmail } from "../email";
import crypto from "crypto";

export function registerAuthRoutes(): Router {
  const router = Router();

  router.post("/api/auth/login", async (req, res) => {
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
      if (!user.emailVerified) {
        return res.status(403).json({ message: "Email nao verificado. Verifique sua caixa de entrada.", code: "EMAIL_NOT_VERIFIED", email: user.email });
      }
      req.session.userId = user.id;
      req.session.providerId = user.providerId || 0;
      req.session.role = user.role;
      const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });
      return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/auth/check-subdomain", async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const existing = await storage.getProviderBySubdomain(subdomain);
    return res.json({ available: !existing });
  });

  router.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos: " + parsed.error.errors.map(e => e.message).join(", ") });
      }
      const { email, password, name, phone, providerName, cnpj, subdomain } = parsed.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Este email ja esta cadastrado. Utilize outro email ou faca login." });
      }

      const existingPhone = await storage.getUserByPhone(phone);
      if (existingPhone) {
        return res.status(409).json({ message: "Este telefone ja esta cadastrado no sistema. Utilize outro numero." });
      }

      const existingProvider = await storage.getProviderByCnpj(cnpj);
      if (existingProvider) {
        return res.status(409).json({ message: "Este CNPJ ja esta cadastrado no sistema." });
      }

      const existingSubdomain = await storage.getProviderBySubdomain(subdomain);
      if (existingSubdomain) {
        return res.status(409).json({ message: "Subdominio ja em uso. Escolha outro." });
      }

      const provider = await storage.createProvider({ name: providerName, cnpj, subdomain, plan: "free", status: "active" });
      const user = await storage.createUser({
        email,
        password: await hashPassword(password),
        name,
        phone,
        role: "admin",
        providerId: provider.id,
        emailVerified: false,
      });

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setVerificationToken(user.id, token, expiresAt);

      try {
        await sendVerificationEmail(email, name, token);
      } catch (emailError: any) {
        console.error("[email] Falha ao enviar email de verificacao:", emailError.message);
      }

      return res.status(201).json({ needsVerification: true, email });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/auth/verify-email", async (req, res) => {
    try {
      const { token } = req.query as { token?: string };
      if (!token) {
        return res.status(400).json({ message: "Token ausente" });
      }
      const user = await storage.getUserByVerificationToken(token);
      if (!user) {
        return res.status(400).json({ message: "Token invalido ou ja utilizado" });
      }
      if (user.verificationTokenExpiresAt && new Date() > user.verificationTokenExpiresAt) {
        return res.status(400).json({ message: "Token expirado. Solicite um novo email de verificacao.", code: "TOKEN_EXPIRED" });
      }
      await storage.setEmailVerified(user.id);
      req.session.userId = user.id;
      req.session.providerId = user.providerId || 0;
      req.session.role = user.role;
      const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });
      return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/auth/resend-verification", async (req, res) => {
    try {
      const { email } = req.body as { email?: string };
      if (!email) {
        return res.status(400).json({ message: "Email obrigatorio" });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.json({ message: "Se esse email existir, um novo link foi enviado." });
      }
      if (user.emailVerified) {
        return res.json({ message: "Email ja verificado. Faca o login normalmente." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setVerificationToken(user.id, token, expiresAt);
      try {
        await sendVerificationEmail(email, user.name, token);
      } catch (emailError: any) {
        console.error("[email] Falha ao reenviar email:", emailError.message);
      }
      return res.json({ message: "Novo link de verificacao enviado. Verifique sua caixa de entrada." });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Deslogado com sucesso" });
    });
  });

  router.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
    return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
  });

  return router;
}
