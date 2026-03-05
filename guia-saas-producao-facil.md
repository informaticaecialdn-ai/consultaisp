# Guia Completo: Estrutura SaaS para Producao Facil

Dominio: `producaofacil.com`
Stack: Node.js + Express + PostgreSQL + Drizzle ORM + React + Vite + TanStack Query + shadcn/ui

Este guia transforma um sistema existente de controle de producao para confeitaria em uma plataforma SaaS multi-tenant.

---

## Indice

1. [Visao Geral da Arquitetura](#1-visao-geral)
2. [Segredos Necessarios](#2-segredos)
3. [Schema do Banco de Dados](#3-schema)
4. [server/password.ts](#4-password)
5. [server/auth.ts](#5-auth)
6. [server/tenant.ts](#6-tenant)
7. [server/email.ts](#7-email)
8. [server/storage.ts (Interface)](#8-storage)
9. [Rotas de Autenticacao](#9-rotas)
10. [client/src/lib/auth.tsx](#10-auth-frontend)
11. [Protecao de Rotas no Frontend](#11-protecao-frontend)
12. [Sidebar Diferenciada por Role](#12-sidebar)
13. [Sistema de Planos e Cobranca](#13-planos)
14. [Checklist de Implementacao](#14-checklist)

---

## 1. Visao Geral da Arquitetura <a id="1-visao-geral"></a>

```
┌─────────────────────────────────────────────────────┐
│                   PRODUCAO FACIL                     │
│              (SaaS Multi-Tenant)                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  FRONTEND (React + Vite)                             │
│  ├── Landing Page (publica)                          │
│  ├── Login / Registro                                │
│  ├── Painel do Tenant (confeitaria)                  │
│  │   ├── Dashboard                                   │
│  │   ├── Producao, Receitas, Pedidos, etc.           │
│  │   └── Configuracoes                               │
│  └── Painel do Superadmin                            │
│      ├── Gerenciar Confeitarias                      │
│      ├── Financeiro                                  │
│      └── Suporte                                     │
│                                                      │
│  BACKEND (Express)                                   │
│  ├── Middlewares: requireAuth, requireAdmin,          │
│  │   requireSuperAdmin                               │
│  ├── Sessao: express-session + PostgreSQL store       │
│  ├── Storage: todas queries filtram por tenant_id     │
│  └── Rotas: /api/auth/*, /api/admin/*, /api/*        │
│                                                      │
│  BANCO DE DADOS (PostgreSQL)                         │
│  ├── tenants (confeitarias)                          │
│  ├── users (com tenant_id e role)                    │
│  ├── [suas tabelas existentes com tenant_id]         │
│  ├── tenant_invoices                                 │
│  └── session (express-session)                       │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Principio fundamental:** TODA tabela que guarda dados de uma confeitaria deve ter uma coluna `tenant_id` que referencia `tenants.id`. TODA query deve filtrar por `tenant_id`.

---

## 2. Segredos Necessarios <a id="2-segredos"></a>

Configure estes segredos no seu projeto Replit:

| Segredo | Descricao |
|---------|-----------|
| `DATABASE_URL` | URL do PostgreSQL (ja vem com o Replit) |
| `SESSION_SECRET` | String aleatoria para assinar cookies de sessao |
| `RESEND_API_KEY` | API key do Resend para envio de emails |
| `ASAAS_API_KEY` | API key do Asaas para cobrancas (quando implementar) |

Para gerar um SESSION_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Schema do Banco de Dados <a id="3-schema"></a>

Adicione estas tabelas ao seu `shared/schema.ts`. Adapte os nomes para seu contexto (confeitaria ao inves de provedor).

```typescript
// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ========================================
// TABELA DE TENANTS (CONFEITARIAS)
// ========================================
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cnpj: text("cnpj").notNull().unique(),
  subdomain: text("subdomain").unique(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

// ========================================
// TABELA DE USUARIOS
// ========================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  // Roles: "user" (operador), "admin" (admin da confeitaria), "superadmin" (dono da plataforma)
  tenantId: integer("tenant_id").references(() => tenants.id),
  // superadmin tem tenantId = null
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationTokenExpiresAt: timestamp("verification_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true, createdAt: true, emailVerified: true,
  verificationToken: true, verificationTokenExpiresAt: true
});
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ========================================
// SCHEMAS DE VALIDACAO PARA AUTH
// ========================================
export const loginSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

export const registerSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  tenantName: z.string().min(2, "Nome da confeitaria deve ter pelo menos 2 caracteres"),
  cnpj: z.string().min(14, "CNPJ invalido"),
  subdomain: z.string().min(3, "Subdominio deve ter pelo menos 3 caracteres").optional(),
});

// ========================================
// PLANOS E PRECOS
// ========================================
export const PLANS = {
  free: { name: "Gratuito", price: 0, maxUsers: 2, maxRecipes: 50 },
  basic: { name: "Basico", price: 49.90, maxUsers: 5, maxRecipes: 200 },
  pro: { name: "Profissional", price: 99.90, maxUsers: 15, maxRecipes: -1 },
  enterprise: { name: "Empresa", price: 199.90, maxUsers: -1, maxRecipes: -1 },
} as const;

// ========================================
// FATURAS DA PLATAFORMA
// ========================================
export const tenantInvoices = pgTable("tenant_invoices", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  // status: pending, paid, overdue, cancelled
  referenceMonth: text("reference_month").notNull(),
  // formato: "2025-03"
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  asaasChargeId: text("asaas_charge_id"),
  asaasStatus: text("asaas_status"),
  paymentMethod: text("payment_method"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTenantInvoiceSchema = createInsertSchema(tenantInvoices).omit({ id: true, createdAt: true });
export type TenantInvoice = typeof tenantInvoices.$inferSelect;
export type InsertTenantInvoice = z.infer<typeof insertTenantInvoiceSchema>;

// ========================================
// SUAS TABELAS EXISTENTES
// ========================================
// IMPORTANTE: Adicione `tenantId` a TODAS as tabelas que guardam dados de confeitarias.
// Exemplo de como adaptar uma tabela existente:
//
// ANTES (sem multi-tenant):
// export const recipes = pgTable("recipes", {
//   id: serial("id").primaryKey(),
//   name: text("name").notNull(),
//   ...
// });
//
// DEPOIS (com multi-tenant):
// export const recipes = pgTable("recipes", {
//   id: serial("id").primaryKey(),
//   tenantId: integer("tenant_id").notNull().references(() => tenants.id),  // <-- ADICIONAR
//   name: text("name").notNull(),
//   ...
// });
```

---

## 4. server/password.ts <a id="4-password"></a>

Crie este arquivo para hash e verificacao de senhas. Usa `scrypt` nativo do Node.js (sem dependencias externas).

```typescript
// server/password.ts
import crypto from "crypto";

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString("hex"));
    });
  });
}
```

---

## 5. server/auth.ts <a id="5-auth"></a>

Configuracao de sessao e middlewares de autorizacao.

**Pacotes necessarios:** `express-session`, `connect-pg-simple`, `pg`

```typescript
// server/auth.ts
import { Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

const PgSession = ConnectPgSimple(session);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // mude para true em producao com HTTPS
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    httpOnly: true,
    sameSite: "lax",
  },
});

// Extende o tipo da sessao para incluir dados do usuario
declare module "express-session" {
  interface SessionData {
    userId: number;
    tenantId: number;
    role: string;
  }
}

// Middleware: usuario deve estar logado
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Autenticacao necessaria" });
  }
  next();
}

// Middleware: usuario deve ser admin do tenant
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || req.session.role !== "admin") {
    return res.status(403).json({ message: "Acesso negado" });
  }
  next();
}

// Middleware: usuario deve ser superadmin da plataforma
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || req.session.role !== "superadmin") {
    return res.status(403).json({ message: "Acesso restrito ao administrador do sistema" });
  }
  next();
}
```

---

## 6. server/tenant.ts <a id="6-tenant"></a>

Funcoes utilitarias para subdominios.

```typescript
// server/tenant.ts
const MAIN_DOMAIN = "producaofacil.com";

export function slugifySubdomain(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

export function buildSubdomainUrl(subdomain: string): string {
  return `https://${subdomain}.${MAIN_DOMAIN}`;
}

export function extractSubdomainFromHost(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length >= 3) {
    const sub = parts[0];
    if (sub && sub !== "www") return sub;
  }
  return null;
}
```

---

## 7. server/email.ts <a id="7-email"></a>

Envio de email de verificacao via Resend.

**Pacote necessario:** `resend`

```typescript
// server/email.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";
const APP_URL = process.env.APP_URL || "http://localhost:5000";

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/verificar-email?token=${token}`;

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Confirme seu cadastro no Producao Facil",
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:36px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:24px;font-weight:700;">Producao Facil</span>
              <p style="color:#e9d5ff;margin:8px 0 0;font-size:13px;">Sistema de Controle de Producao para Confeitarias</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1e293b;font-size:20px;font-weight:700;margin:0 0 8px;">Confirme seu email, ${name}</h2>
              <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 28px;">
                Obrigado por criar sua conta no Producao Facil. Para ativar seu acesso, confirme seu endereco de email clicando no botao abaixo.
              </p>
              <div style="text-align:center;margin:0 0 28px;">
                <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;">
                  Confirmar Email
                </a>
              </div>
              <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 16px;">
                Se o botao nao funcionar, copie e cole este link no seu navegador:
              </p>
              <div style="background:#f1f5f9;border-radius:6px;padding:12px 16px;word-break:break-all;">
                <a href="${verifyUrl}" style="color:#7c3aed;font-size:12px;text-decoration:none;">${verifyUrl}</a>
              </div>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;" />
              <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:14px 16px;">
                <p style="color:#854d0e;font-size:13px;margin:0;line-height:1.5;">
                  <strong>Este link expira em 24 horas.</strong> Se voce nao criou uma conta, ignore este email.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">Producao Facil - Sistema de Controle de Producao para Confeitarias</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  });
}
```

---

## 8. server/storage.ts (Interface) <a id="8-storage"></a>

O padrao e: crie uma interface `IStorage` e uma implementacao `DatabaseStorage`. Toda funcao que acessa dados de tenant DEVE receber `tenantId` e filtrar por ele.

```typescript
// server/storage.ts

import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  tenants, users,
  type Tenant, type InsertTenant,
  type User, type InsertUser,
} from "@shared/schema";

export interface IStorage {
  // === USERS ===
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByVerificationToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  setEmailVerified(userId: number): Promise<void>;
  setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void>;
  getUsersByTenant(tenantId: number): Promise<User[]>;
  deleteUser(id: number): Promise<void>;

  // === TENANTS ===
  getTenant(id: number): Promise<Tenant | undefined>;
  getTenantByCnpj(cnpj: string): Promise<Tenant | undefined>;
  getTenantBySubdomain(subdomain: string): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: number, data: Partial<Tenant>): Promise<Tenant>;
  getAllTenants(): Promise<Tenant[]>;

  // === SUAS TABELAS (exemplo com receitas) ===
  // getRecipesByTenant(tenantId: number): Promise<Recipe[]>;
  // createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  // ... sempre com tenantId
}

export class DatabaseStorage implements IStorage {
  // === USERS ===
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.verificationToken, token));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async setEmailVerified(userId: number): Promise<void> {
    await db.update(users)
      .set({ emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null })
      .where(eq(users.id, userId));
  }

  async setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await db.update(users)
      .set({ verificationToken: token, verificationTokenExpiresAt: expiresAt })
      .where(eq(users.id, userId));
  }

  async getUsersByTenant(tenantId: number): Promise<User[]> {
    return db.select().from(users).where(eq(users.tenantId, tenantId));
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // === TENANTS ===
  async getTenant(id: number): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant;
  }

  async getTenantByCnpj(cnpj: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.cnpj, cnpj));
    return tenant;
  }

  async getTenantBySubdomain(subdomain: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.subdomain, subdomain));
    return tenant;
  }

  async createTenant(data: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(data).returning();
    return tenant;
  }

  async updateTenant(id: number, data: Partial<Tenant>): Promise<Tenant> {
    const [tenant] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();
    return tenant;
  }

  async getAllTenants(): Promise<Tenant[]> {
    return db.select().from(tenants).orderBy(desc(tenants.createdAt));
  }

  // === EXEMPLO: RECEITAS (adapte para suas tabelas) ===
  // OBSERVE: sempre filtra por tenantId!
  //
  // async getRecipesByTenant(tenantId: number): Promise<Recipe[]> {
  //   return db.select().from(recipes)
  //     .where(eq(recipes.tenantId, tenantId))
  //     .orderBy(desc(recipes.createdAt));
  // }
  //
  // async createRecipe(recipe: InsertRecipe): Promise<Recipe> {
  //   const [created] = await db.insert(recipes).values(recipe).returning();
  //   return created;
  // }
}

export const storage = new DatabaseStorage();
```

---

## 9. Rotas de Autenticacao <a id="9-rotas"></a>

Adicione estas rotas ao seu `server/routes.ts`. Sao as rotas essenciais para o SaaS funcionar.

```typescript
// Adicione no seu server/routes.ts

import crypto from "crypto";
import { storage } from "./storage";
import { hashPassword, verifyPassword } from "./password";
import { sessionMiddleware, requireAuth, requireAdmin, requireSuperAdmin } from "./auth";
import { sendVerificationEmail } from "./email";
import { slugifySubdomain } from "./tenant";
import { loginSchema, registerSchema } from "@shared/schema";

// IMPORTANTE: Adicione o middleware de sessao ANTES de todas as rotas
app.use(sessionMiddleware);

// ========================================
// ROTAS DE AUTENTICACAO
// ========================================

// Verificar sessao atual
app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Nao autenticado" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Usuario nao encontrado" });
  }
  const tenant = user.tenantId ? await storage.getTenant(user.tenantId) : null;
  res.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    tenant,
  });
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await storage.getUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ message: "Email ou senha incorretos" });
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        message: "Email nao verificado",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
    }
    // Popula a sessao
    req.session.userId = user.id;
    req.session.tenantId = user.tenantId || 0;
    req.session.role = user.role;

    const tenant = user.tenantId ? await storage.getTenant(user.tenantId) : null;
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant,
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Dados invalidos" });
  }
});

// Registro (cria tenant + usuario admin)
app.post("/api/auth/register", async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const cnpjDigits = data.cnpj.replace(/\D/g, "");

    // Verifica se CNPJ ja existe
    const existingTenant = await storage.getTenantByCnpj(cnpjDigits);
    if (existingTenant) {
      return res.status(400).json({ message: "CNPJ ja cadastrado" });
    }

    // Verifica se email ja existe
    const existingUser = await storage.getUserByEmail(data.email);
    if (existingUser) {
      return res.status(400).json({ message: "Email ja cadastrado" });
    }

    // Gera subdominio
    const subdomain = data.subdomain || slugifySubdomain(data.tenantName);

    // Verifica se subdominio esta disponivel
    const existingSub = await storage.getTenantBySubdomain(subdomain);
    if (existingSub) {
      return res.status(400).json({ message: "Subdominio ja em uso" });
    }

    // Cria o tenant (confeitaria)
    const tenant = await storage.createTenant({
      name: data.tenantName,
      cnpj: cnpjDigits,
      subdomain,
      plan: "free",
      status: "active",
      contactEmail: data.email,
    });

    // Cria o usuario admin
    const hashedPassword = await hashPassword(data.password);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await storage.createUser({
      email: data.email,
      password: hashedPassword,
      name: data.name,
      role: "admin",
      tenantId: tenant.id,
    });

    // Salva token de verificacao
    await storage.setVerificationToken(user.id, verificationToken, tokenExpiresAt);

    // Envia email de verificacao (async, nao bloqueia)
    sendVerificationEmail(data.email, data.name, verificationToken).catch(console.error);

    res.status(201).json({
      needsVerification: true,
      email: data.email,
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao cadastrar" });
  }
});

// Verificacao de email
app.get("/api/auth/verify-email", async (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ message: "Token ausente" });

  const user = await storage.getUserByVerificationToken(token);
  if (!user) return res.status(400).json({ message: "Token invalido" });

  if (user.verificationTokenExpiresAt && new Date() > user.verificationTokenExpiresAt) {
    return res.status(400).json({ message: "Token expirado" });
  }

  await storage.setEmailVerified(user.id);

  // Login automatico apos verificacao
  req.session.userId = user.id;
  req.session.tenantId = user.tenantId || 0;
  req.session.role = user.role;

  res.json({ success: true, message: "Email verificado com sucesso" });
});

// Reenviar email de verificacao
app.post("/api/auth/resend-verification", async (req, res) => {
  const { email } = req.body;
  const user = await storage.getUserByEmail(email);
  if (!user) return res.json({ message: "Se o email existir, enviaremos um novo link" });

  if (user.emailVerified) return res.json({ message: "Email ja verificado" });

  const newToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await storage.setVerificationToken(user.id, newToken, expiresAt);
  sendVerificationEmail(email, user.name, newToken).catch(console.error);

  res.json({ message: "Novo link de verificacao enviado" });
});

// Verificar disponibilidade de subdominio
app.get("/api/auth/check-subdomain", async (req, res) => {
  const subdomain = req.query.subdomain as string;
  if (!subdomain || subdomain.length < 3) {
    return res.json({ available: false });
  }
  const existing = await storage.getTenantBySubdomain(subdomain);
  res.json({ available: !existing });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logout realizado" });
  });
});

// ========================================
// EXEMPLO DE ROTA PROTEGIDA (DADOS DO TENANT)
// ========================================

// Lista receitas da confeitaria logada
app.get("/api/recipes", requireAuth, async (req, res) => {
  const tenantId = req.session.tenantId!;
  // const recipes = await storage.getRecipesByTenant(tenantId);
  // res.json(recipes);
});

// ========================================
// ROTAS DO SUPERADMIN
// ========================================

// Lista todas as confeitarias
app.get("/api/admin/tenants", requireSuperAdmin, async (req, res) => {
  const allTenants = await storage.getAllTenants();
  res.json(allTenants);
});

// Desativar/ativar confeitaria
app.patch("/api/admin/tenants/:id/status", requireSuperAdmin, async (req, res) => {
  const { status } = req.body;
  const tenant = await storage.updateTenant(parseInt(req.params.id), { status });
  res.json(tenant);
});
```

---

## 10. client/src/lib/auth.tsx <a id="10-auth-frontend"></a>

Provider de autenticacao para o frontend.

```tsx
// client/src/lib/auth.tsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { Tenant } from "@shared/schema";
import { apiRequest } from "./queryClient";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  tenant: Tenant | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    cnpj: string;
    subdomain?: string;
  }) => Promise<{ needsVerification: boolean; email: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setTenant(data.tenant);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || "Erro ao fazer login") as any;
      err.code = data.code;
      err.email = data.email;
      throw err;
    }
    setUser(data.user);
    setTenant(data.tenant);
  };

  const register = async (data: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    cnpj: string;
    subdomain?: string;
  }) => {
    const res = await apiRequest("POST", "/api/auth/register", data);
    const d = await res.json();
    if (!res.ok) throw new Error(d.message || "Erro ao cadastrar");
    return { needsVerification: d.needsVerification as boolean, email: d.email as string };
  };

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    setTenant(null);
  };

  return (
    <AuthContext.Provider value={{ user, tenant, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
```

---

## 11. Protecao de Rotas no Frontend <a id="11-protecao-frontend"></a>

No seu `App.tsx`, proteja as rotas baseado no estado de autenticacao e role do usuario.

```tsx
// client/src/App.tsx (estrutura principal)
import { Switch, Route, useLocation } from "wouter";
import { AuthProvider, useAuth } from "@/lib/auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";

// Paginas publicas
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import VerifyEmailPage from "@/pages/verificar-email";

// Paginas do tenant
import DashboardPage from "@/pages/dashboard";
// ... suas outras paginas

// Pagina do superadmin
import AdminPage from "@/pages/admin-sistema";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  // Rotas publicas
  if (location === "/login") return <LoginPage />;
  if (location === "/verificar-email") return <VerifyEmailPage />;
  if (location === "/") {
    if (!user) return <LandingPage />;
  }

  // Se nao esta logado, mostra landing
  if (!user) return <LandingPage />;

  // Superadmin so acessa /admin-sistema
  if (user.role === "superadmin") {
    if (location !== "/admin-sistema") {
      window.location.href = "/admin-sistema";
      return null;
    }
    return <AdminPage />;
  }

  // Rotas do tenant (admin e user)
  return (
    <div className="flex min-h-screen">
      {/* <AppSidebar /> */}
      <main className="flex-1">
        <Switch>
          <Route path="/" component={DashboardPage} />
          {/* Adicione suas rotas aqui */}
          <Route>Pagina nao encontrada</Route>
        </Switch>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthenticatedApp />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

---

## 12. Sidebar Diferenciada por Role <a id="12-sidebar"></a>

Renderize itens de menu diferentes conforme o role do usuario.

```tsx
// client/src/components/app-sidebar.tsx (trecho conceitual)
import { useAuth } from "@/lib/auth";

export function AppSidebar() {
  const { user } = useAuth();

  // Itens para admin/user do tenant (confeitaria)
  const tenantMenuItems = [
    { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
    { label: "Producao", href: "/producao", icon: "ChefHat" },
    { label: "Receitas", href: "/receitas", icon: "BookOpen" },
    { label: "Pedidos", href: "/pedidos", icon: "ShoppingCart" },
    { label: "Estoque", href: "/estoque", icon: "Package" },
    { label: "Configuracoes", href: "/configuracoes", icon: "Settings" },
  ];

  // Itens para superadmin
  const superadminMenuItems = [
    { label: "Painel Geral", href: "/admin-sistema#painel", icon: "BarChart3" },
    { label: "Confeitarias", href: "/admin-sistema#confeitarias", icon: "Store" },
    { label: "Usuarios", href: "/admin-sistema#usuarios", icon: "Users" },
    { label: "Financeiro", href: "/admin-sistema#financeiro", icon: "DollarSign" },
    { label: "Suporte", href: "/admin-sistema#suporte", icon: "MessageSquare" },
  ];

  const menuItems = user?.role === "superadmin" ? superadminMenuItems : tenantMenuItems;

  return (
    <aside className="w-64 border-r bg-white min-h-screen p-4">
      <div className="font-bold text-lg mb-8">Producao Facil</div>
      <nav className="space-y-1">
        {menuItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-gray-100"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
```

---

## 13. Sistema de Planos e Cobranca (Asaas) <a id="13-planos"></a>

Quando estiver pronto para implementar cobrancas:

```typescript
// server/asaas.ts
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_BASE_URL = "https://api.asaas.com/v3"; // producao
// const ASAAS_BASE_URL = "https://sandbox.asaas.com/api/v3"; // sandbox

async function asaasRequest(method: string, path: string, body?: any) {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "access_token": ASAAS_API_KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export async function findOrCreateCustomer(cnpj: string, name: string, email: string) {
  // Busca cliente pelo CNPJ
  const search = await asaasRequest("GET", `/customers?cpfCnpj=${cnpj}`);
  if (search.data?.length > 0) return search.data[0];

  // Cria novo cliente
  return asaasRequest("POST", "/customers", {
    name,
    cpfCnpj: cnpj,
    email,
  });
}

export async function createCharge(customerId: string, value: number, description: string, externalReference: string) {
  return asaasRequest("POST", "/payments", {
    customer: customerId,
    billingType: "UNDEFINED", // aceita Pix, Boleto, Cartao
    value,
    description,
    externalReference,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 7 dias
  });
}

// Webhook do Asaas (adicione no routes.ts):
// app.post("/api/asaas/webhook", async (req, res) => {
//   const { event, payment } = req.body;
//   if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
//     const ref = payment.externalReference;
//     if (ref?.startsWith("invoice_")) {
//       const invoiceId = parseInt(ref.replace("invoice_", ""));
//       // Marcar fatura como paga
//     }
//   }
//   res.json({ ok: true });
// });
```

---

## 14. Checklist de Implementacao <a id="14-checklist"></a>

Siga esta ordem para adicionar SaaS ao seu projeto existente:

### Fase 1: Infraestrutura (faca primeiro)
- [ ] Instalar pacotes: `express-session`, `connect-pg-simple`, `pg`, `resend`
- [ ] Configurar segredos: `SESSION_SECRET`, `RESEND_API_KEY`
- [ ] Criar `server/password.ts`
- [ ] Criar `server/auth.ts`
- [ ] Criar `server/tenant.ts`
- [ ] Criar `server/email.ts`

### Fase 2: Banco de Dados
- [ ] Adicionar tabela `tenants` ao schema
- [ ] Adicionar tabela `users` (com `tenantId` e `role`) ao schema
- [ ] Adicionar tabela `tenant_invoices` ao schema
- [ ] **CRUCIAL:** Adicionar coluna `tenant_id` a TODAS as tabelas existentes
- [ ] Rodar `npm run db:push` para aplicar mudancas

### Fase 3: Backend
- [ ] Atualizar `storage.ts` com a interface IStorage e DatabaseStorage
- [ ] **CRUCIAL:** Atualizar TODAS as funcoes existentes de storage para filtrar por `tenantId`
- [ ] Adicionar `sessionMiddleware` no Express (antes de todas as rotas)
- [ ] Adicionar rotas de autenticacao (login, register, verify, logout, me)
- [ ] Proteger todas as rotas existentes com `requireAuth`
- [ ] Em cada rota, usar `req.session.tenantId!` para filtrar dados
- [ ] Adicionar rotas do superadmin com `requireSuperAdmin`

### Fase 4: Frontend
- [ ] Criar `client/src/lib/auth.tsx`
- [ ] Envolver o App com `AuthProvider`
- [ ] Criar pagina de login
- [ ] Criar pagina de registro
- [ ] Criar pagina de verificacao de email
- [ ] Adaptar `App.tsx` para proteger rotas e redirecionar por role
- [ ] Criar sidebar diferenciada (tenant vs superadmin)
- [ ] Criar pagina de admin do sistema (superadmin)

### Fase 5: Criar Superadmin
- [ ] Criar o usuario superadmin manualmente no banco:
```sql
-- Primeiro, gere o hash da senha no Node.js:
-- node -e "require('./server/password').hashPassword('SuaSenha123').then(h => console.log(h))"

INSERT INTO users (email, password, name, role, email_verified)
VALUES ('admin@producaofacil.com', 'HASH_GERADO', 'Administrador', 'superadmin', true);
```

### Fase 6: Planos e Cobranca (opcional, pode fazer depois)
- [ ] Criar `server/asaas.ts`
- [ ] Adicionar webhook do Asaas
- [ ] Implementar pagina de planos no frontend
- [ ] Implementar geracao de faturas no superadmin

---

## Resumo dos Pacotes Necessarios

```
express-session       → gerenciamento de sessao
connect-pg-simple     → armazenar sessoes no PostgreSQL
pg                    → driver PostgreSQL (pool para sessoes)
resend                → envio de emails transacionais
```

Se o projeto ja tem `express`, `drizzle-orm`, `drizzle-zod`, `zod`, `@tanstack/react-query`, `wouter` e `shadcn/ui`, voce ja tem a base. Caso contrario, instale-os tambem.

---

## Duvidas Frequentes

**P: Preciso criar um banco separado por tenant?**
R: Nao. O padrao aqui e "banco compartilhado, dados isolados por tenant_id". E mais simples e funciona bem para ate milhares de tenants.

**P: O superadmin tem tenant_id?**
R: Nao. O superadmin tem `tenantId = null`. Ele acessa todas as confeitarias via rotas `/api/admin/*`.

**P: Como migrar dados existentes?**
R: Crie o tenant primeiro, depois atualize todos os registros existentes com o `tenant_id` desse tenant. Isso converte seu sistema single-tenant em multi-tenant.

**P: Posso ter mais de um admin por confeitaria?**
R: Sim. Basta criar mais usuarios com `role: "admin"` e o mesmo `tenantId`.
