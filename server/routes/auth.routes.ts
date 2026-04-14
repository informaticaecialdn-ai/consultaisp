import { Router } from "express";
import { storage } from "../storage";
import { loginSchema, registerSchema } from "@shared/schema";
import { hashPassword, verifyPassword } from "../password";
import { sendVerificationEmail } from "../services/email";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import crypto from "crypto";

export function registerAuthRoutes(): Router {
  const router = Router();

  const loginLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 5 });
  const registerLimiter = createRateLimiter({ windowMs: 3_600_000, maxRequests: 3 });
  const resendLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 3 });

  router.post("/api/auth/login", loginLimiter, async (req, res) => {
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
      // Validar isolamento de tenant: usuario so pode logar no subdominio do seu provedor
      // Superadmins podem logar em qualquer subdominio (ou no dominio principal)
      if (user.role !== "superadmin" && user.providerId) {
        const { extractSubdomainFromHost } = await import("../tenant");
        const requestSubdomain = extractSubdomainFromHost(req.hostname);
        if (requestSubdomain) {
          const provider = await storage.getProvider(user.providerId);
          if (provider?.subdomain && provider.subdomain !== requestSubdomain) {
            return res.status(401).json({
              message: "Email ou senha incorretos",
            });
          }
        }
      }

      req.session.userId = user.id;
      req.session.providerId = user.providerId || 0;
      req.session.role = user.role;
      // Gravar subdomain na sessao pra validacao no requireAuth
      const { extractSubdomainFromHost } = await import("../tenant");
      req.session.subdomain = extractSubdomainFromHost(req.hostname) || undefined;
      const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });
      return res.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        provider,
        mustChangePassword: user.mustChangePassword || false,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const subdomainLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

  router.get("/api/auth/check-subdomain", subdomainLimiter, async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const existing = await storage.getProviderBySubdomain(subdomain);
    return res.json({ available: !existing });
  });

  router.post("/api/auth/register", registerLimiter, async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos: " + parsed.error.errors.map(e => e.message).join(", ") });
      }
      const { email, password, name, phone, providerName, cnpj, subdomain } = parsed.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const existingPhone = await storage.getUserByPhone(phone);
      if (existingPhone) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const existingProvider = await storage.getProviderByCnpj(cnpj);
      if (existingProvider) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const existingSubdomain = await storage.getProviderBySubdomain(subdomain);
      if (existingSubdomain) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
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
        lgpdAcceptedAt: new Date(),
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
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
      // Do NOT auto-login on GET — return success and let the frontend redirect to login
      return res.json({ verified: true, email: user.email });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/auth/resend-verification", resendLimiter, async (req, res) => {
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Deslogado com sucesso" });
    });
  });

  // Esqueci minha senha
  router.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email obrigatorio" });

      // Sempre retorna sucesso (nao revela se email existe)
      const user = await storage.getUserByEmail(email);
      if (user) {
        const crypto = await import("crypto");
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
        const { users } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { db } = await import("../db");
        await db.update(users).set({ resetToken: token, resetTokenExpiresAt: expiresAt }).where(eq(users.id, user.id));
        const { sendPasswordResetEmail } = await import("../services/email");
        await sendPasswordResetEmail(user.email, user.name, token).catch(err =>
          console.warn(`[auth] Erro ao enviar email de reset: ${err.message}`)
        );
      }
      return res.json({ message: "Se o email estiver cadastrado, voce recebera instrucoes para redefinir sua senha." });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Redefinir senha com token
  router.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ message: "Token e nova senha obrigatorios" });
      if (newPassword.length < 6) return res.status(400).json({ message: "Senha deve ter no minimo 6 caracteres" });

      const { users } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("../db");

      const [user] = await db.select().from(users).where(eq(users.resetToken, token)).limit(1);
      if (!user) return res.status(400).json({ message: "Link invalido ou expirado" });
      if (user.resetTokenExpiresAt && new Date(user.resetTokenExpiresAt) < new Date()) {
        return res.status(400).json({ message: "Link expirado. Solicite uma nova redefinicao." });
      }

      const { hashPassword } = await import("../password");
      const hashed = await hashPassword(newPassword);
      await db.update(users).set({
        password: hashed,
        resetToken: null,
        resetTokenExpiresAt: null,
        mustChangePassword: false,
      }).where(eq(users.id, user.id));

      return res.json({ message: "Senha alterada com sucesso. Faca login com a nova senha." });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
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
    const partnerCode = provider ? (await import("../utils/provider-anonymizer.js")).generatePartnerCode(provider.id, provider.tradeName || provider.name) : null;
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      provider,
      partnerCode,
      mustChangePassword: user.mustChangePassword || false,
    });
  });

  router.post("/api/auth/change-password", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Senha deve ter no minimo 6 caracteres" });
    }
    try {
      const { hashPassword } = await import("../password");
      const hashed = await hashPassword(newPassword);
      const { users } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("../db");
      await db.update(users).set({ password: hashed, mustChangePassword: false }).where(eq(users.id, req.session.userId));
      return res.json({ message: "Senha alterada com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
