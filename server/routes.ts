import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { sessionMiddleware, requireAuth, requireAdmin, requireSuperAdmin } from "./auth";
import { loginSchema, registerSchema } from "@shared/schema";
import { hashPassword, verifyPassword } from "./password";
import { sendVerificationEmail } from "./email";
import { slugifySubdomain, buildSubdomainUrl } from "./tenant";
import crypto from "crypto";

function calculateIspScore(params: {
  maxDaysOverdue: number;
  totalOverdueAmount: number;
  unreturnedEquipmentCount: number;
  contractAgeDays: number;
  recentConsultationsCount: number;
  providersWithDebt: number;
  clientYears: number;
  neverLate: boolean;
  allEquipmentReturned: boolean;
}): { score: number; penalties: { reason: string; points: number }[]; bonuses: { reason: string; points: number }[] } {
  let score = 100;
  const penalties: { reason: string; points: number }[] = [];
  const bonuses: { reason: string; points: number }[] = [];

  if (params.maxDaysOverdue > 90) {
    penalties.push({ reason: "Atraso superior a 90 dias", points: -40 });
    score -= 40;
  } else if (params.maxDaysOverdue > 60) {
    penalties.push({ reason: "Atraso de 61-90 dias", points: -30 });
    score -= 30;
  } else if (params.maxDaysOverdue > 30) {
    penalties.push({ reason: "Atraso de 31-60 dias", points: -20 });
    score -= 20;
  } else if (params.maxDaysOverdue > 0) {
    penalties.push({ reason: "Atraso de 1-30 dias", points: -10 });
    score -= 10;
  }

  const amountPenalty = Math.floor(params.totalOverdueAmount / 100) * 5;
  if (amountPenalty > 0) {
    penalties.push({ reason: `R$ ${params.totalOverdueAmount.toFixed(2)} em aberto (-5 a cada R$100)`, points: -amountPenalty });
    score -= amountPenalty;
  }

  if (params.unreturnedEquipmentCount > 0) {
    const eqPenalty = params.unreturnedEquipmentCount * 15;
    penalties.push({ reason: `${params.unreturnedEquipmentCount} equipamento(s) nao devolvido(s)`, points: -eqPenalty });
    score -= eqPenalty;
  }

  if (params.contractAgeDays < 90) {
    penalties.push({ reason: "Contrato com menos de 3 meses", points: -15 });
    score -= 15;
  } else if (params.contractAgeDays < 180) {
    penalties.push({ reason: "Contrato com menos de 6 meses", points: -10 });
    score -= 10;
  }

  if (params.recentConsultationsCount > 3) {
    penalties.push({ reason: `Consultado por ${params.recentConsultationsCount} provedores nos ultimos 30 dias`, points: -20 });
    score -= 20;
  }

  if (params.providersWithDebt > 1) {
    penalties.push({ reason: "Divida em multiplos provedores", points: -25 });
    score -= 25;
  }

  if (params.clientYears >= 2 && params.maxDaysOverdue === 0) {
    bonuses.push({ reason: "Cliente ha mais de 2 anos (em dia)", points: 10 });
    score += 10;
  }

  if (params.neverLate) {
    bonuses.push({ reason: "Nunca atrasou pagamento", points: 15 });
    score += 15;
  }

  if (params.allEquipmentReturned) {
    bonuses.push({ reason: "Equipamentos sempre devolvidos", points: 5 });
    score += 5;
  }

  return { score: Math.max(0, Math.min(100, score)), penalties, bonuses };
}

function getRiskTier(score: number): { tier: string; label: string; recommendation: string } {
  if (score >= 80) return { tier: "low", label: "BAIXO RISCO", recommendation: "Aprovar" };
  if (score >= 50) return { tier: "medium", label: "MEDIO RISCO", recommendation: "Aprovar com cautela" };
  if (score >= 25) return { tier: "high", label: "ALTO RISCO", recommendation: "Exigir garantias" };
  return { tier: "critical", label: "CRITICO", recommendation: "Rejeitar" };
}

function getDecisionReco(score: number): string {
  if (score >= 80) return "Accept";
  if (score >= 50) return "Review";
  return "Reject";
}

function getOverdueAmountRange(amount: number): string {
  if (amount === 0) return "Sem debito";
  if (amount <= 100) return "Ate R$ 100";
  if (amount <= 300) return "R$ 100 - R$ 300";
  if (amount <= 500) return "R$ 300 - R$ 500";
  if (amount <= 1000) return "R$ 500 - R$ 1.000";
  return "Acima de R$ 1.000";
}

function getRecommendedActions(score: number, hasUnreturnedEquipment: boolean): string[] {
  const actions: string[] = [];
  if (score < 25) {
    actions.push("Exigir pagamento antecipado (3-6 meses)");
    actions.push("Nao fornecer equipamento em comodato");
    actions.push("Contrato com multa de fidelidade");
    actions.push("Solicitar fiador/avalista");
  } else if (score < 50) {
    actions.push("Exigir pagamento antecipado (1-3 meses)");
    if (hasUnreturnedEquipment) actions.push("Nao fornecer equipamento em comodato");
    actions.push("Contrato com multa de fidelidade");
  } else if (score < 80) {
    actions.push("Monitorar pagamentos nos primeiros 3 meses");
    actions.push("Considerar contrato com fidelidade");
  }
  return actions;
}

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
      if (!user.emailVerified) {
        return res.status(403).json({ message: "Email nao verificado. Verifique sua caixa de entrada.", code: "EMAIL_NOT_VERIFIED", email: user.email });
      }
      req.session.userId = user.id;
      req.session.providerId = user.providerId || 0;
      req.session.role = user.role;
      const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
      return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/auth/check-subdomain", async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const existing = await storage.getProviderBySubdomain(subdomain);
    return res.json({ available: !existing });
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos: " + parsed.error.errors.map(e => e.message).join(", ") });
      }
      const { email, password, name, providerName, cnpj, subdomain } = parsed.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email ja cadastrado" });
      }

      const existingProvider = await storage.getProviderByCnpj(cnpj);
      if (existingProvider) {
        return res.status(409).json({ message: "CNPJ ja cadastrado" });
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

  app.get("/api/auth/verify-email", async (req, res) => {
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
      return res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, provider });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/resend-verification", async (req, res) => {
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
    const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
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

  app.get("/api/dashboard/defaulters", requireAuth, async (req, res) => {
    try {
      const list = await storage.getDefaultersList(req.session.providerId!);
      return res.json(list);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inadimplentes", requireAuth, async (req, res) => {
    try {
      const list = await storage.getInadimplentes(req.session.providerId!);
      return res.json(list);
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

      const cleaned = cpfCnpj.replace(/\D/g, "");
      let searchType = "cpf";
      if (cleaned.length === 14) searchType = "cnpj";
      else if (cleaned.length === 8) searchType = "cep";

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) {
        return res.status(400).json({ message: "Provedor nao encontrado" });
      }

      const allCustomerRecords = await storage.getCustomerByCpfCnpj(cleaned);

      const isOwnCustomer = allCustomerRecords.some(c => c.providerId === providerId);
      const hasOtherProviderRecords = allCustomerRecords.some(c => c.providerId !== providerId);
      const notFound = allCustomerRecords.length === 0;

      let cost = 0;
      if (!isOwnCustomer && !notFound) {
        cost = 1;
        if (provider.ispCredits <= 0) {
          return res.status(400).json({ message: "Creditos ISP insuficientes" });
        }
      }

      const recentConsultations = await storage.getRecentConsultationsForDocument(cleaned, 30);
      const distinctProviders = new Set(recentConsultations.map(c => c.providerId));
      const recentConsultationsCount = distinctProviders.size;

      const providerDetails: any[] = [];
      const alerts: string[] = [];
      let globalMaxDaysOverdue = 0;
      let globalTotalOverdue = 0;
      let providersWithDebtCount = 0;
      let hasUnreturnedEquipmentGlobal = false;

      for (const customer of allCustomerRecords) {
        const customerProvider = await storage.getProvider(customer.providerId);
        const customerContracts = await storage.getContractsByCustomer(customer.id);
        const customerEquipment = await storage.getEquipmentByCustomer(customer.id);
        const customerInvoices = await storage.getInvoicesByCustomer(customer.id);

        const overdueInvoices = customerInvoices.filter(inv => inv.status === "overdue");
        const totalOverdue = overdueInvoices.reduce((sum, inv) => sum + parseFloat(inv.value || "0"), 0);
        const overdueCount = overdueInvoices.length;

        let maxDays = 0;
        for (const inv of overdueInvoices) {
          const dueDate = new Date(inv.dueDate);
          const diffDays = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > maxDays) maxDays = diffDays;
        }

        const unreturnedEquipment = customerEquipment.filter(eq => eq.status === "not_returned");
        const unreturnedCount = unreturnedEquipment.length;

        if (totalOverdue > 0) providersWithDebtCount++;
        if (maxDays > globalMaxDaysOverdue) globalMaxDaysOverdue = maxDays;
        globalTotalOverdue += totalOverdue;
        if (unreturnedCount > 0) hasUnreturnedEquipmentGlobal = true;

        const oldestContract = customerContracts.reduce((oldest, ct) => {
          const start = ct.startDate ? new Date(ct.startDate) : new Date();
          return start < oldest ? start : oldest;
        }, new Date());
        const contractAgeDays = Math.floor((Date.now() - oldestContract.getTime()) / (1000 * 60 * 60 * 24));

        let paymentStatusLabel = "Em dia";
        if (maxDays > 90) paymentStatusLabel = "Inadimplente (90+ dias)";
        else if (maxDays > 60) paymentStatusLabel = "Inadimplente (61-90 dias)";
        else if (maxDays > 30) paymentStatusLabel = "Inadimplente (31-60 dias)";
        else if (maxDays > 0) paymentStatusLabel = "Inadimplente (1-30 dias)";

        const isSameProvider = customer.providerId === providerId;

        const detail: any = {
          providerName: customerProvider?.name || "Provedor desconhecido",
          isSameProvider,
          customerName: customer.name,
          status: paymentStatusLabel,
          daysOverdue: maxDays,
          overdueAmount: isSameProvider ? totalOverdue : undefined,
          overdueAmountRange: isSameProvider ? undefined : getOverdueAmountRange(totalOverdue),
          overdueInvoicesCount: overdueCount,
          contractStartDate: oldestContract.toISOString(),
          contractAgeDays,
          hasUnreturnedEquipment: unreturnedCount > 0,
          unreturnedEquipmentCount: unreturnedCount,
        };

        if (isSameProvider) {
          detail.equipmentDetails = unreturnedEquipment.map(eq => ({
            type: eq.type,
            brand: eq.brand,
            model: eq.model,
            value: eq.value,
            inRecoveryProcess: eq.inRecoveryProcess,
          }));
          const newestContract = customerContracts.length > 0 ? customerContracts[0] : null;
          if (newestContract?.endDate) {
            detail.cancelledDate = newestContract.endDate;
          }
        } else {
          detail.equipmentPendingSummary = unreturnedCount > 0
            ? `${unreturnedCount} equipamento(s) nao devolvido(s)`
            : "Todos devolvidos";
        }

        providerDetails.push(detail);

        if (customer.providerId !== providerId) {
          const equipmentValue = unreturnedEquipment.reduce((sum, eq) => sum + parseFloat(eq.value || "0"), 0);
          const totalConsultingProviders = recentConsultationsCount + 1;

          let riskScore = 0;
          const riskFactors: string[] = [];

          if (maxDays >= 90) { riskScore += 35; riskFactors.push("Atraso superior a 90 dias"); }
          else if (maxDays >= 60) { riskScore += 25; riskFactors.push("Atraso entre 60-90 dias"); }
          else if (maxDays >= 30) { riskScore += 15; riskFactors.push("Atraso entre 30-60 dias"); }
          else if (maxDays >= 1) { riskScore += 8; riskFactors.push("Atraso de 1-30 dias"); }

          if (totalOverdue >= 1000) { riskScore += 25; riskFactors.push(`Valor alto em aberto: R$ ${totalOverdue.toFixed(2)}`); }
          else if (totalOverdue >= 500) { riskScore += 18; riskFactors.push(`Valor medio em aberto: R$ ${totalOverdue.toFixed(2)}`); }
          else if (totalOverdue >= 200) { riskScore += 10; riskFactors.push(`Valor em aberto: R$ ${totalOverdue.toFixed(2)}`); }
          else if (totalOverdue > 0) { riskScore += 5; riskFactors.push(`Pequeno valor em aberto: R$ ${totalOverdue.toFixed(2)}`); }

          if (equipmentValue >= 500) { riskScore += 25; riskFactors.push(`Equipamento de alto valor: R$ ${equipmentValue.toFixed(2)}`); }
          else if (equipmentValue >= 200) { riskScore += 18; riskFactors.push(`Equipamento nao devolvido: R$ ${equipmentValue.toFixed(2)}`); }
          else if (unreturnedCount > 0) { riskScore += 10; riskFactors.push(`${unreturnedCount} equipamento(s) pendente(s)`); }

          if (totalConsultingProviders >= 5) { riskScore += 15; riskFactors.push(`Consultado por ${totalConsultingProviders} provedores recentemente`); }
          else if (totalConsultingProviders >= 3) { riskScore += 10; riskFactors.push(`Multiplas consultas recentes: ${totalConsultingProviders}`); }
          else if (totalConsultingProviders >= 2) { riskScore += 5; riskFactors.push("Consultado por 2 provedores nos ultimos 30 dias"); }

          if (contractAgeDays < 30) { riskScore += 10; riskFactors.push("Contrato muito recente (< 30 dias)"); }
          else if (contractAgeDays < 90) { riskScore += 5; riskFactors.push("Contrato recente (< 90 dias)"); }

          riskScore = Math.min(riskScore, 100);
          const riskLevel = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";
          const severity = riskLevel;

          if (maxDays >= 1 || unreturnedCount > 0 || contractAgeDays < 90) {
            const alertType = maxDays >= 1 ? "defaulter_consulted" : unreturnedCount > 0 ? "equipment_risk" : "recent_contract";
            const alertMessage = maxDays >= 1
              ? `Seu cliente ${customer.name} foi consultado por ${provider.name}. O cliente possui R$ ${totalOverdue.toFixed(2)} em atraso ha ${maxDays} dias.`
              : unreturnedCount > 0
              ? `Seu cliente ${customer.name} possui ${unreturnedCount} equipamento(s) nao devolvido(s) (R$ ${equipmentValue.toFixed(2)}) e foi consultado por ${provider.name}.`
              : `Seu cliente ${customer.name} (contrato recente: ${contractAgeDays} dias) foi consultado por ${provider.name}.`;

            alerts.push(alertMessage);
            await storage.createAlert({
              providerId: customer.providerId,
              customerId: customer.id,
              consultingProviderId: providerId,
              consultingProviderName: provider.name,
              customerName: customer.name,
              customerCpfCnpj: customer.cpfCnpj,
              type: alertType,
              severity,
              message: alertMessage,
              riskScore,
              riskLevel,
              riskFactors,
              daysOverdue: maxDays,
              overdueAmount: totalOverdue.toFixed(2),
              equipmentNotReturned: unreturnedCount,
              equipmentValue: equipmentValue.toFixed(2),
              recentConsultations: totalConsultingProviders,
              resolved: false,
              status: "new",
            });
          }
        }
      }

      if (recentConsultationsCount > 2) {
        alerts.push(`Consultado por ${recentConsultationsCount + 1} provedores nos ultimos 30 dias`);
        for (const customer of allCustomerRecords) {
          if (customer.providerId !== providerId) {
            await storage.createAlert({
              providerId: customer.providerId,
              customerId: customer.id,
              consultingProviderId: providerId,
              consultingProviderName: provider.name,
              customerName: customer.name,
              customerCpfCnpj: customer.cpfCnpj,
              type: "multiple_consultations",
              severity: "high",
              message: `Seu cliente ${customer.name} foi consultado por ${recentConsultationsCount + 1} provedores nos ultimos 30 dias. Possivel padrao de fraude.`,
              riskScore: 80,
              riskLevel: "high",
              riskFactors: [`Consultado por ${recentConsultationsCount + 1} provedores nos ultimos 30 dias`, "Possivel padrao de fraude"],
              daysOverdue: customer.maxDaysOverdue || 0,
              overdueAmount: customer.totalOverdueAmount || "0",
              equipmentNotReturned: 0,
              equipmentValue: "0",
              recentConsultations: recentConsultationsCount + 1,
              resolved: false,
              status: "new",
            });
          }
        }
      }

      if (providersWithDebtCount > 1) {
        alerts.push("Padrao de divida em multiplos provedores detectado");
      }

      let contractAgeDays = 365;
      let neverLate = true;
      let allEquipmentReturned = true;
      let clientYears = 0;
      let hasAnyContract = false;

      if (allCustomerRecords.length > 0) {
        for (const customer of allCustomerRecords) {
          const cts = await storage.getContractsByCustomer(customer.id);
          for (const ct of cts) {
            hasAnyContract = true;
            const start = ct.startDate ? new Date(ct.startDate) : new Date();
            const age = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
            if (age < contractAgeDays) contractAgeDays = age;
            const years = age / 365;
            if (years > clientYears) clientYears = years;
          }
          const invs = await storage.getInvoicesByCustomer(customer.id);
          if (invs.some(inv => inv.status === "overdue")) neverLate = false;
          const eqs = await storage.getEquipmentByCustomer(customer.id);
          if (eqs.some(eq => eq.status === "not_returned")) allEquipmentReturned = false;
        }
      }

      if (!hasAnyContract) {
        contractAgeDays = 365;
      }

      let actualUnreturnedCount = 0;
      for (const customer of allCustomerRecords) {
        const eqs = await storage.getEquipmentByCustomer(customer.id);
        actualUnreturnedCount += eqs.filter(eq => eq.status === "not_returned").length;
      }

      const recalculated = allCustomerRecords.length === 0
        ? { score: 100, penalties: [], bonuses: [] }
        : calculateIspScore({
            maxDaysOverdue: globalMaxDaysOverdue,
            totalOverdueAmount: globalTotalOverdue,
            unreturnedEquipmentCount: actualUnreturnedCount,
            contractAgeDays,
            recentConsultationsCount: recentConsultationsCount + 1,
            providersWithDebt: providersWithDebtCount,
            clientYears,
            neverLate,
            allEquipmentReturned,
          });

      const finalScore = recalculated.score;
      const risk = getRiskTier(finalScore);
      const decisionReco = getDecisionReco(finalScore);
      const recommendedActions = getRecommendedActions(finalScore, hasUnreturnedEquipmentGlobal);

      const result = {
        cpfCnpj: cleaned,
        searchType,
        notFound: allCustomerRecords.length === 0,
        score: finalScore,
        riskTier: risk.tier,
        riskLabel: risk.label,
        recommendation: risk.recommendation,
        decisionReco,
        providersFound: new Set(allCustomerRecords.map(c => c.providerId)).size,
        providerDetails,
        penalties: recalculated.penalties,
        bonuses: recalculated.bonuses,
        alerts,
        recommendedActions,
        creditsCost: cost,
        isOwnCustomer,
      };

      const customerIdForLog = allCustomerRecords.length > 0 ? allCustomerRecords[0].id : null;
      const consultation = await storage.createIspConsultation({
        providerId,
        userId: req.session.userId!,
        cpfCnpj: cleaned,
        searchType,
        result,
        score: finalScore,
        decisionReco,
        cost,
        approved: finalScore >= 50,
      });

      if (cost > 0) {
        await storage.updateProviderCredits(
          provider.id,
          provider.ispCredits - cost,
          provider.spcCredits,
        );
      }

      return res.json({ consultation, result });
    } catch (error: any) {
      console.error("ISP consultation error:", error);
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
      const isCpf = cleaned.length === 11;

      const hash = cleaned.split("").reduce((a, b) => a + parseInt(b), 0);
      const seed = hash % 100;

      let score: number;
      let situacaoRf: string;
      let obitoRegistrado = false;

      if (seed < 15) {
        score = Math.floor(Math.random() * 300) + 100;
        situacaoRf = seed < 5 ? "Irregular" : "Regular";
        obitoRegistrado = seed < 3;
      } else if (seed < 40) {
        score = Math.floor(Math.random() * 200) + 301;
        situacaoRf = "Regular";
      } else if (seed < 70) {
        score = Math.floor(Math.random() * 200) + 501;
        situacaoRf = "Regular";
      } else {
        score = Math.floor(Math.random() * 200) + 750;
        situacaoRf = "Regular";
      }

      const firstNames = ["Joao", "Maria", "Pedro", "Ana", "Carlos", "Fernanda", "Lucas", "Julia", "Rafael", "Camila"];
      const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Almeida", "Pereira", "Lima", "Costa"];
      const motherNames = ["Maria", "Ana", "Luisa", "Helena", "Teresa", "Rosa", "Carmen", "Lucia"];
      const nameIdx = hash % firstNames.length;
      const lastIdx = (hash + 3) % lastNames.length;
      const motherIdx = (hash + 7) % motherNames.length;

      const birthYear = 1960 + (hash % 40);
      const birthMonth = (hash % 12) + 1;
      const birthDay = (hash % 28) + 1;

      const cadastralData = isCpf ? {
        nome: `${firstNames[nameIdx]} ${lastNames[lastIdx]} dos Santos`.toUpperCase(),
        cpfCnpj: cleaned,
        dataNascimento: `${String(birthDay).padStart(2, "0")}/${String(birthMonth).padStart(2, "0")}/${birthYear}`,
        nomeMae: `${motherNames[motherIdx]} ${lastNames[(lastIdx + 2) % lastNames.length]}`.toUpperCase(),
        situacaoRf,
        obitoRegistrado,
        tipo: "PF" as const,
      } : {
        nome: `${firstNames[nameIdx].toUpperCase()} ${lastNames[lastIdx].toUpperCase()} TELECOMUNICACOES LTDA`,
        cpfCnpj: cleaned,
        dataFundacao: `${String(birthDay).padStart(2, "0")}/${String(birthMonth).padStart(2, "0")}/${birthYear + 20}`,
        situacaoRf,
        obitoRegistrado: false,
        tipo: "PJ" as const,
      };

      const restrictionTypes = [
        { type: "PEFIN", desc: "Pendencia Financeira", severity: "medium" as const },
        { type: "REFIN", desc: "Restricao Financeira", severity: "high" as const },
        { type: "CCF", desc: "Cheque sem Fundo", severity: "high" as const },
        { type: "Protesto", desc: "Titulo protestado em cartorio", severity: "high" as const },
        { type: "Acao Judicial", desc: "Processo de cobranca", severity: "critical" as const },
        { type: "Falencia", desc: "Processo falimentar", severity: "critical" as const },
      ];

      const creditors = [
        "Claro S.A.", "Banco Itau S.A.", "Vivo Telefonica", "Casas Bahia", "Magazine Luiza",
        "Banco do Brasil", "Caixa Economica", "Oi S.A.", "Tim S.A.", "Bradesco S.A.",
        "Lojas Americanas", "Santander S.A.", "Banco Pan", "Net Servicos", "Sky Brasil",
      ];

      const restrictions: any[] = [];
      if (score < 700) {
        const numRestrictions = score < 300 ? Math.floor(Math.random() * 3) + 3 : score < 500 ? Math.floor(Math.random() * 2) + 1 : Math.random() > 0.5 ? 1 : 0;
        for (let i = 0; i < numRestrictions; i++) {
          const rType = restrictionTypes[Math.floor(Math.random() * (score < 300 ? 6 : 4))];
          const value = Math.floor(Math.random() * 5000) + 100;
          const daysAgo = Math.floor(Math.random() * 365) + 30;
          const date = new Date();
          date.setDate(date.getDate() - daysAgo);
          restrictions.push({
            type: rType.type,
            description: rType.desc,
            severity: rType.severity,
            creditor: creditors[Math.floor(Math.random() * creditors.length)],
            value: value.toFixed(2),
            date: date.toISOString().split("T")[0],
            origin: i % 2 === 0 ? "SPC" : "Serasa",
          });
        }
      }

      const totalRestrictions = restrictions.reduce((sum, r) => sum + parseFloat(r.value), 0);

      const segments = ["Telecomunicacoes", "Varejo", "Financeiras", "Servicos", "Industria"];
      const previousConsultations: any[] = [];
      const numPrevConsultations = Math.floor(Math.random() * 10) + 1;
      for (let i = 0; i < numPrevConsultations; i++) {
        const daysAgo = Math.floor(Math.random() * 90) + 1;
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        previousConsultations.push({
          date: d.toISOString().split("T")[0],
          segment: segments[Math.floor(Math.random() * segments.length)],
        });
      }

      const segmentCounts: Record<string, number> = {};
      previousConsultations.forEach(c => {
        segmentCounts[c.segment] = (segmentCounts[c.segment] || 0) + 1;
      });

      const alerts: { type: string; message: string; severity: string }[] = [];
      if (numPrevConsultations > 5) {
        alerts.push({ type: "many_queries", message: `${numPrevConsultations} consultas nos ultimos 90 dias - possivel cliente "rodando" entre empresas`, severity: "high" });
      }
      if (restrictions.some(r => ["Claro S.A.", "Vivo Telefonica", "Oi S.A.", "Tim S.A.", "Net Servicos", "Sky Brasil"].includes(r.creditor))) {
        alerts.push({ type: "telecom_debt", message: "Dividas no segmento de telecomunicacoes detectadas", severity: "high" });
      }
      if (situacaoRf === "Irregular") {
        alerts.push({ type: "cpf_irregular", message: "CPF irregular na Receita Federal - documento com problema", severity: "critical" });
      }
      if (obitoRegistrado) {
        alerts.push({ type: "death_registered", message: "Obito registrado - possivel fraude de identidade", severity: "critical" });
      }
      if (score < 400 && restrictions.length > 0) {
        alerts.push({ type: "score_drop", message: "Score muito baixo com restricoes ativas - situacao financeira critica", severity: "medium" });
      }

      let riskLevel: string;
      let riskLabel: string;
      let recommendation: string;

      if (score >= 901) { riskLevel = "very_low"; riskLabel = "RISCO MUITO BAIXO"; recommendation = "Aprovar"; }
      else if (score >= 701) { riskLevel = "low"; riskLabel = "RISCO BAIXO"; recommendation = "Aprovar"; }
      else if (score >= 501) { riskLevel = "medium"; riskLabel = "RISCO MEDIO"; recommendation = "Aprovar com cautela"; }
      else if (score >= 301) { riskLevel = "high"; riskLabel = "RISCO ALTO"; recommendation = "Nao aprovar sem garantias"; }
      else { riskLevel = "very_high"; riskLabel = "RISCO MUITO ALTO"; recommendation = "Rejeitar"; }

      const result = {
        cpfCnpj: cleaned,
        cadastralData,
        score,
        riskLevel,
        riskLabel,
        recommendation,
        status: restrictions.length === 0 ? "clean" : "restricted",
        restrictions,
        totalRestrictions,
        previousConsultations: {
          total: numPrevConsultations,
          last90Days: numPrevConsultations,
          bySegment: segmentCounts,
        },
        alerts,
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

  app.patch("/api/anti-fraud/alerts/:id/status", requireAuth, async (req, res) => {
    try {
      const alertId = parseInt(req.params.id);
      const { status } = req.body;
      if (!["new", "resolved", "dismissed"].includes(status)) {
        return res.status(400).json({ message: "Status invalido" });
      }
      const updated = await storage.updateAlertStatus(alertId, req.session.providerId!, status);
      if (!updated) {
        return res.status(404).json({ message: "Alerta nao encontrado" });
      }
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/anti-fraud/customer-risk", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const allCustomers = await storage.getCustomersByProvider(providerId);
      const customerRisk = [];
      for (const customer of allCustomers) {
        const customerEquipment = await storage.getEquipmentByCustomer(customer.id);
        const unreturnedEquipment = customerEquipment.filter(eq => eq.status === "not_returned");
        const equipmentValue = unreturnedEquipment.reduce((sum, eq) => sum + parseFloat(eq.value || "0"), 0);
        const overdueAmount = parseFloat(customer.totalOverdueAmount || "0");
        const daysOverdue = customer.maxDaysOverdue || 0;
        const existingAlerts = await storage.getAlertsByCustomer(customer.id);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentAlertCount = existingAlerts.filter(a => a.createdAt && new Date(a.createdAt) >= thirtyDaysAgo).length;

        const customerContracts = await storage.getContractsByCustomer(customer.id);
        const oldestContract = customerContracts.reduce((oldest, ct) => {
          const start = ct.startDate ? new Date(ct.startDate) : new Date();
          return start < oldest ? start : oldest;
        }, new Date());
        const contractAgeDays = Math.floor((Date.now() - oldestContract.getTime()) / (1000 * 60 * 60 * 24));

        let riskScore = 0;
        const riskFactors: string[] = [];
        if (daysOverdue >= 90) { riskScore += 35; riskFactors.push("Atraso superior a 90 dias"); }
        else if (daysOverdue >= 60) { riskScore += 25; riskFactors.push("Atraso entre 60-90 dias"); }
        else if (daysOverdue >= 30) { riskScore += 15; riskFactors.push("Atraso entre 30-60 dias"); }
        else if (daysOverdue >= 1) { riskScore += 8; riskFactors.push("Atraso de 1-30 dias"); }

        if (overdueAmount >= 1000) { riskScore += 25; riskFactors.push(`Valor alto em aberto: R$ ${overdueAmount.toFixed(2)}`); }
        else if (overdueAmount >= 500) { riskScore += 18; riskFactors.push(`Valor medio em aberto: R$ ${overdueAmount.toFixed(2)}`); }
        else if (overdueAmount >= 200) { riskScore += 10; riskFactors.push(`Valor em aberto: R$ ${overdueAmount.toFixed(2)}`); }
        else if (overdueAmount > 0) { riskScore += 5; riskFactors.push(`Pequeno valor em aberto: R$ ${overdueAmount.toFixed(2)}`); }

        if (equipmentValue >= 500) { riskScore += 25; riskFactors.push(`Equipamento de alto valor: R$ ${equipmentValue.toFixed(2)}`); }
        else if (equipmentValue >= 200) { riskScore += 18; riskFactors.push(`Equipamento nao devolvido: R$ ${equipmentValue.toFixed(2)}`); }
        else if (unreturnedEquipment.length > 0) { riskScore += 10; riskFactors.push(`${unreturnedEquipment.length} equipamento(s) pendente(s)`); }

        if (recentAlertCount >= 5) { riskScore += 15; riskFactors.push(`Consultado por ${recentAlertCount} provedores`); }
        else if (recentAlertCount >= 3) { riskScore += 10; riskFactors.push(`Multiplas consultas: ${recentAlertCount}`); }
        else if (recentAlertCount >= 2) { riskScore += 5; riskFactors.push("Consultado por 2+ provedores"); }

        if (contractAgeDays < 30) { riskScore += 10; riskFactors.push("Contrato muito recente"); }
        else if (contractAgeDays < 90) { riskScore += 5; riskFactors.push("Contrato recente"); }

        riskScore = Math.min(riskScore, 100);
        const riskLevel = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";

        customerRisk.push({
          id: customer.id,
          name: customer.name,
          cpfCnpj: customer.cpfCnpj,
          riskScore,
          riskLevel,
          riskFactors,
          daysOverdue,
          overdueAmount,
          equipmentNotReturned: unreturnedEquipment.length,
          equipmentValue,
          recentConsultations: recentAlertCount,
          alertCount: existingAlerts.length,
        });
      }
      customerRisk.sort((a, b) => b.riskScore - a.riskScore);
      return res.json(customerRisk);
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

  app.get("/api/tenant/resolve", async (req, res) => {
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

  app.get("/api/provider/users", requireAuth, async (req, res) => {
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

  app.post("/api/provider/users", requireAuth, async (req, res) => {
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

  app.delete("/api/provider/users/:id", requireAuth, async (req, res) => {
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

  app.patch("/api/provider/settings", requireAuth, async (req, res) => {
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

  app.get("/api/provider/profile", requireAuth, async (req, res) => {
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

  app.patch("/api/provider/profile", requireAuth, async (req, res) => {
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

  app.get("/api/provider/partners", requireAuth, async (req, res) => {
    try {
      const partners = await storage.getProviderPartners(req.session.providerId!);
      return res.json(partners);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/provider/partners", requireAuth, async (req, res) => {
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

  app.patch("/api/provider/partners/:id", requireAuth, async (req, res) => {
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

  app.delete("/api/provider/partners/:id", requireAuth, async (req, res) => {
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

  app.get("/api/provider/documents", requireAuth, async (req, res) => {
    try {
      const docs = await storage.getProviderDocuments(req.session.providerId!);
      const docsNoData = docs.map(({ fileData, ...rest }) => rest);
      return res.json(docsNoData);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/provider/documents", requireAuth, async (req, res) => {
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

  app.delete("/api/provider/documents/:id", requireAuth, async (req, res) => {
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

  app.get("/api/provider/documents/:id/download", requireAuth, async (req, res) => {
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

  app.patch("/api/admin/providers/:id/documents/:docId/status", requireAuth, async (req, res) => {
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

  app.get("/api/admin/providers/:id/documents", requireAuth, async (req, res) => {
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

  app.get("/api/admin/providers/:id/documents/:docId/download", requireAuth, async (req, res) => {
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

  app.get("/api/config/maps-key", requireAuth, async (_req, res) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || "";
    return res.json({ key });
  });

  app.get("/api/heatmap/provider", requireAuth, async (req, res) => {
    try {
      const data = await storage.getHeatmapDataByProvider(req.session.providerId!);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/heatmap/regional", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getHeatmapDataAllProviders();
      const clusterMap = new Map<string, { lat: number; lng: number; city: string; count: number; totalOverdue: number }>();
      for (const item of data) {
        const lat = parseFloat(item.latitude);
        const lng = parseFloat(item.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        const roundedLat = parseFloat(lat.toFixed(2));
        const roundedLng = parseFloat(lng.toFixed(2));
        const key = `${roundedLat},${roundedLng}`;
        const existing = clusterMap.get(key);
        const overdue = parseFloat(item.totalOverdueAmount || "0");
        if (existing) {
          existing.count += 1;
          existing.totalOverdue += overdue;
          if (!existing.city && item.city) existing.city = item.city;
        } else {
          clusterMap.set(key, { lat: roundedLat, lng: roundedLng, city: item.city || "", count: 1, totalOverdue: overdue });
        }
      }
      const results = Array.from(clusterMap.values());
      return res.json(results);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/heatmap/city-ranking", requireAuth, async (_req, res) => {
    try {
      const data = await storage.getHeatmapDataAllProviders();
      const cityMap = new Map<string, { city: string; lat: number; lng: number; count: number; totalOverdue: number; maxDays: number }>();
      for (const item of data) {
        const city = (item.city || "").trim();
        if (!city) continue;
        const lat = parseFloat(item.latitude);
        const lng = parseFloat(item.longitude);
        const overdue = parseFloat(item.totalOverdueAmount || "0");
        const days = parseInt(item.maxDaysOverdue || "0", 10);
        const existing = cityMap.get(city);
        if (existing) {
          existing.count += 1;
          existing.totalOverdue += overdue;
          if (days > existing.maxDays) existing.maxDays = days;
        } else {
          cityMap.set(city, { city, lat: isNaN(lat) ? 0 : lat, lng: isNaN(lng) ? 0 : lng, count: 1, totalOverdue: overdue, maxDays: days });
        }
      }
      const results = Array.from(cityMap.values())
        .sort((a, b) => b.count - a.count || b.totalOverdue - a.totalOverdue);
      return res.json(results);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ============ SUPER ADMIN ROUTES ============

  app.get("/api/admin/stats", requireSuperAdmin, async (_req, res) => {
    try {
      const stats = await storage.getSystemStats();
      return res.json(stats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/providers", requireSuperAdmin, async (_req, res) => {
    try {
      const allProviders = await storage.getAllProviders();
      const withStats = await Promise.all(allProviders.map(async (p) => {
        const provUsers = await storage.getUsersByProvider(p.id);
        return { ...p, userCount: provUsers.length };
      }));
      return res.json(withStats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/providers", requireSuperAdmin, async (req, res) => {
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

  app.patch("/api/admin/providers/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.adminUpdateProvider(id, req.body);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/providers/:id/plan", requireSuperAdmin, async (req, res) => {
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

  app.post("/api/admin/providers/:id/credits", requireSuperAdmin, async (req, res) => {
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

  app.delete("/api/admin/providers/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.adminDeactivateProvider(id);
      return res.json({ message: "Provedor desativado" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/providers/:id/detail", requireSuperAdmin, async (req, res) => {
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

  app.get("/api/admin/users", requireSuperAdmin, async (_req, res) => {
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

  app.delete("/api/admin/users/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteUser(id);
      return res.json({ message: "Usuario removido" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/plan-history", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const changes = await storage.getPlanChanges(providerId);
      return res.json(changes);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- SUPPORT CHAT (Admin side) ----
  app.get("/api/admin/chat/threads", requireSuperAdmin, async (_req, res) => {
    try {
      const threads = await storage.getAllSupportThreads();
      return res.json(threads);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/chat/threads/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const messages = await storage.getSupportMessages(threadId);
      await storage.markMessagesRead(threadId, false);
      return res.json(messages);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/chat/threads/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem nao pode ser vazia" });
      const me = await storage.getUser(req.session.userId!);
      const msg = await storage.createSupportMessage({
        threadId, senderId: req.session.userId!, senderName: me?.name || "Admin",
        content: content.trim(), isFromAdmin: true, isRead: false,
      });
      return res.json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/chat/threads/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { status } = req.body;
      await storage.updateThreadStatus(threadId, status);
      return res.json({ message: "Status atualizado" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- SUPPORT CHAT (Provider side) ----
  app.get("/api/chat/thread", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getOrCreateSupportThread(req.session.providerId!);
      const messages = await storage.getSupportMessages(thread.id);
      await storage.markMessagesRead(thread.id, true);
      return res.json({ thread, messages });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/chat/thread/messages", requireAuth, async (req, res) => {
    try {
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem nao pode ser vazia" });
      const me = await storage.getUser(req.session.userId!);
      const thread = await storage.getOrCreateSupportThread(req.session.providerId!);
      const msg = await storage.createSupportMessage({
        threadId: thread.id, senderId: req.session.userId!, senderName: me?.name || "Usuario",
        content: content.trim(), isFromAdmin: false, isRead: false,
      });
      return res.json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/unread", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadCountForProvider(req.session.providerId!);
      return res.json({ count });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ============ ASAAS INTEGRATION ROUTES ============

  app.get("/api/admin/asaas/status", requireSuperAdmin, async (_req, res) => {
    try {
      const { isAsaasConfigured, getAsaasMode, getBalance } = await import("./asaas");
      const configured = isAsaasConfigured();
      const mode = getAsaasMode();
      let balance = null;
      if (configured) {
        try { balance = await getBalance(); } catch {}
      }
      return res.json({ configured, mode, balance });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { billingType = "UNDEFINED" } = req.body;
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.asaasChargeId) return res.status(409).json({ message: "Cobranca Asaas ja existe para esta fatura" });

      const { findOrCreateCustomer, createCharge } = await import("./asaas");

      const provider = await storage.getProvider(invoice.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const providerUsers = await storage.getUsersByProvider(invoice.providerId);
      const adminUser = providerUsers.find(u => u.role === "admin") || providerUsers[0];

      const customer = await findOrCreateCustomer({
        name: provider.name,
        cpfCnpj: provider.cnpj,
        email: provider.contactEmail || adminUser?.email,
        phone: provider.contactPhone || undefined,
      });

      const dueDate = new Date(invoice.dueDate).toISOString().split("T")[0];
      const charge = await createCharge({
        customerId: customer.id,
        value: parseFloat(invoice.amount),
        dueDate,
        description: `${invoice.invoiceNumber} - Plano ${invoice.planAtTime} - Periodo ${invoice.period}`,
        externalReference: `invoice_${invoice.id}`,
        billingType: billingType as any,
      });

      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: charge.id,
        asaasCustomerId: customer.id,
        asaasStatus: charge.status,
        asaasInvoiceUrl: charge.invoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl,
        asaasBillingType: charge.billingType,
      });

      return res.json({ invoice: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/invoices/:id/asaas/sync", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { getCharge, asaasStatusToLocal } = await import("./asaas");
      const charge = await getCharge(invoice.asaasChargeId);
      const newStatus = asaasStatusToLocal(charge.status);

      const updateData: any = {
        asaasStatus: charge.status,
        asaasInvoiceUrl: charge.invoiceUrl || invoice.asaasInvoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl || invoice.asaasBankSlipUrl,
        status: newStatus,
      };
      if (newStatus === "paid" && charge.paymentDate) {
        updateData.paidDate = new Date(charge.paymentDate);
        updateData.paidAmount = String(charge.value);
      }

      const updated = await storage.updateProviderInvoiceAsaas(id, updateData);
      return res.json({ invoice: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { cancelCharge } = await import("./asaas");
      await cancelCharge(invoice.asaasChargeId);
      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: undefined,
        asaasStatus: "DELETED",
        status: "cancelled",
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/invoices/:id/asaas/pix", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice || !invoice.asaasChargeId) return res.status(404).json({ message: "Cobranca Asaas nao encontrada" });

      const { getPixQrCode } = await import("./asaas");
      const pix = await getPixQrCode(invoice.asaasChargeId);
      return res.json(pix);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/asaas/webhook", async (req, res) => {
    try {
      const { event, payment } = req.body;
      if (!payment?.externalReference) return res.json({ ok: true });

      const { asaasStatusToLocal } = await import("./asaas");

      const creditOrderMatch = payment.externalReference.match(/^credit_order_(\d+)$/);
      if (creditOrderMatch) {
        const orderId = parseInt(creditOrderMatch[1]);
        const newStatus = asaasStatusToLocal(payment.status);
        if (newStatus === "paid") {
          try { await storage.releaseCreditOrder(orderId); } catch {}
        } else {
          await storage.updateCreditOrder(orderId, { asaasStatus: payment.status, status: newStatus });
        }
        return res.json({ ok: true });
      }

      const invoiceMatch = payment.externalReference.match(/^invoice_(\d+)$/);
      if (!invoiceMatch) return res.json({ ok: true });

      const invoiceId = parseInt(invoiceMatch[1]);
      const newStatus = asaasStatusToLocal(payment.status);

      const updateData: any = { asaasStatus: payment.status, status: newStatus };
      if (newStatus === "paid" && payment.paymentDate) {
        updateData.paidDate = new Date(payment.paymentDate);
        updateData.paidAmount = String(payment.value);
      }
      await storage.updateProviderInvoiceAsaas(invoiceId, updateData);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("Webhook Asaas error:", error.message);
      return res.json({ ok: true });
    }
  });

  // ============ FINANCIAL INVOICE ROUTES ============

  app.get("/api/admin/financial/saas-metrics", requireSuperAdmin, async (_req, res) => {
    try {
      const metrics = await storage.getSaasMetrics();
      return res.json(metrics);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/financial/summary", requireSuperAdmin, async (_req, res) => {
    try {
      const summary = await storage.getFinancialSummary();
      return res.json(summary);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const invoiceList = await storage.getAllProviderInvoices(providerId);
      return res.json(invoiceList);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const invoice = await storage.getProviderInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      return res.json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const { providerId, period, planAtTime, amount, ispCreditsIncluded, spcCreditsIncluded, dueDate, notes } = req.body;
      if (!providerId || !period || !planAtTime || !amount || !dueDate) {
        return res.status(400).json({ message: "Campos obrigatorios: providerId, period, planAtTime, amount, dueDate" });
      }
      const me = await storage.getUser(req.session.userId!);
      const invoiceNumber = await storage.getNextInvoiceNumber();
      const invoice = await storage.createProviderInvoice({
        invoiceNumber,
        providerId: parseInt(providerId),
        period,
        planAtTime,
        amount: amount.toString(),
        ispCreditsIncluded: ispCreditsIncluded || 0,
        spcCreditsIncluded: spcCreditsIncluded || 0,
        dueDate: new Date(dueDate),
        status: "pending",
        notes: notes || null,
        createdById: req.session.userId!,
        createdByName: me?.name || "Admin",
      });
      return res.status(201).json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/invoices/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const { status, paidAmount } = req.body;
      if (!status) return res.status(400).json({ message: "Status e obrigatorio" });
      const paidDate = status === "paid" ? new Date() : undefined;
      const updated = await storage.updateProviderInvoiceStatus(
        parseInt(req.params.id), status, paidDate, paidAmount?.toString()
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getProviderInvoice(parseInt(id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.status === "paid") return res.status(400).json({ message: "Nao e possivel cancelar uma fatura paga" });
      await storage.updateProviderInvoiceStatus(parseInt(id), "cancelled");
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/invoices/generate-monthly", requireSuperAdmin, async (req, res) => {
    try {
      const { period } = req.body;
      if (!period) return res.status(400).json({ message: "Period e obrigatorio (ex: 2026-03)" });
      const PLAN_PRICES: Record<string, number> = { free: 0, basic: 199, pro: 399, enterprise: 799 };
      const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
        free: { isp: 50, spc: 0 }, basic: { isp: 200, spc: 50 }, pro: { isp: 500, spc: 150 }, enterprise: { isp: 1500, spc: 500 }
      };
      const allProviders = await storage.getAllProviders();
      const me = await storage.getUser(req.session.userId!);
      const [year, month] = period.split("-").map(Number);
      const dueDate = new Date(year, month - 1, 10);
      let created = 0;
      let skipped = 0;
      for (const provider of allProviders) {
        if (PLAN_PRICES[provider.plan] === 0) { skipped++; continue; }
        const existingInvoices = await storage.getAllProviderInvoices(provider.id);
        if (existingInvoices.some(i => i.period === period && i.status !== "cancelled")) { skipped++; continue; }
        const invoiceNumber = await storage.getNextInvoiceNumber();
        const credits = PLAN_CREDITS[provider.plan] || { isp: 0, spc: 0 };
        await storage.createProviderInvoice({
          invoiceNumber, providerId: provider.id, period,
          planAtTime: provider.plan, amount: PLAN_PRICES[provider.plan].toString(),
          ispCreditsIncluded: credits.isp, spcCreditsIncluded: credits.spc,
          dueDate, status: "pending",
          createdById: req.session.userId!, createdByName: me?.name || "Admin",
        });
        created++;
      }
      return res.json({ created, skipped, message: `${created} faturas geradas para ${period}` });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ============ CREDIT ORDER ROUTES (PROVIDER) ============

  app.get("/api/credits/orders", requireAuth, async (req, res) => {
    try {
      if (!req.session.providerId) return res.status(403).json({ message: "Somente provedores" });
      const orders = await storage.getAllCreditOrders(req.session.providerId);
      return res.json(orders);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/credits/purchase", requireAuth, async (req, res) => {
    try {
      if (!req.session.providerId) return res.status(403).json({ message: "Somente provedores" });
      const { packageId, billingType } = req.body;
      const { CREDIT_PACKAGES } = await import("@shared/schema");
      const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
      if (!pkg) return res.status(400).json({ message: "Pacote invalido" });

      const provider = await storage.getProvider(req.session.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const me = await storage.getUser(req.session.userId!);

      const orderNumber = await storage.getNextOrderNumber();
      const order = await storage.createCreditOrder({
        orderNumber, providerId: provider.id, providerName: provider.name,
        packageName: pkg.name, ispCredits: pkg.ispCredits, spcCredits: pkg.spcCredits,
        amount: (pkg.price / 100).toFixed(2), status: "pending",
        createdById: req.session.userId!, createdByName: me?.name || "Provedor",
      });

      let chargeData: any = null;
      try {
        const { isAsaasConfigured, findOrCreateCustomer, createCharge } = await import("./asaas");
        if (isAsaasConfigured() && billingType) {
          const customer = await findOrCreateCustomer({ name: provider.name, cnpj: provider.cnpj, email: provider.contactEmail || me?.email || "" });
          const charge = await createCharge({
            customer: customer.id,
            billingType: billingType || "UNDEFINED",
            value: pkg.price / 100,
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            description: `Pacote de Creditos ${pkg.name} - ${pkg.ispCredits} ISP + ${pkg.spcCredits} SPC`,
            externalReference: `credit_order_${order.id}`,
          });
          await storage.updateCreditOrder(order.id, {
            asaasChargeId: charge.id, asaasCustomerId: customer.id,
            asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl,
            asaasBankSlipUrl: charge.bankSlipUrl, asaasBillingType: charge.billingType,
            paymentMethod: charge.billingType,
          });
          chargeData = charge;
        }
      } catch (asaasErr: any) {
        console.warn("Asaas charge creation failed:", asaasErr.message);
      }

      return res.json({ order, charge: chargeData });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/credits/orders/:id/asaas/pix", requireAuth, async (req, res) => {
    try {
      if (!req.session.providerId) return res.status(403).json({ message: "Somente provedores" });
      const order = await storage.getCreditOrder(parseInt(req.params.id));
      if (!order || order.providerId !== req.session.providerId) return res.status(404).json({ message: "Pedido nao encontrado" });
      if (!order.asaasChargeId) return res.status(400).json({ message: "Sem cobranca Asaas vinculada" });
      const { getPixQrCode } = await import("./asaas");
      const pixData = await getPixQrCode(order.asaasChargeId);
      return res.json(pixData);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ============ CREDIT ORDER ROUTES (ADMIN) ============

  app.get("/api/admin/credit-orders", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const orders = await storage.getAllCreditOrders(providerId);
      return res.json(orders);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/credit-orders", requireSuperAdmin, async (req, res) => {
    try {
      const { providerId, packageId, customIsp, customSpc, customAmount, notes, billingType } = req.body;
      const { CREDIT_PACKAGES } = await import("@shared/schema");
      const provider = await storage.getProvider(parseInt(providerId));
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const me = await storage.getUser(req.session.userId!);

      let ispCredits: number, spcCredits: number, amount: string, packageName: string;
      if (packageId && packageId !== "custom") {
        const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
        if (!pkg) return res.status(400).json({ message: "Pacote invalido" });
        ispCredits = pkg.ispCredits; spcCredits = pkg.spcCredits;
        amount = (pkg.price / 100).toFixed(2); packageName = pkg.name;
      } else {
        ispCredits = parseInt(customIsp) || 0; spcCredits = parseInt(customSpc) || 0;
        amount = parseFloat(customAmount || "0").toFixed(2); packageName = "Personalizado";
      }

      const orderNumber = await storage.getNextOrderNumber();
      const order = await storage.createCreditOrder({
        orderNumber, providerId: provider.id, providerName: provider.name,
        packageName, ispCredits, spcCredits, amount, status: "pending",
        notes, createdById: req.session.userId!, createdByName: me?.name || "Admin",
      });

      let chargeData: any = null;
      if (billingType) {
        try {
          const { isAsaasConfigured, findOrCreateCustomer, createCharge } = await import("./asaas");
          if (isAsaasConfigured()) {
            const customer = await findOrCreateCustomer({ name: provider.name, cnpj: provider.cnpj, email: provider.contactEmail || "" });
            const charge = await createCharge({
              customer: customer.id, billingType,
              value: parseFloat(amount),
              dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
              description: `Creditos ${packageName}: ${ispCredits} ISP + ${spcCredits} SPC`,
              externalReference: `credit_order_${order.id}`,
            });
            await storage.updateCreditOrder(order.id, {
              asaasChargeId: charge.id, asaasCustomerId: customer.id,
              asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl,
              asaasBankSlipUrl: charge.bankSlipUrl, asaasBillingType: charge.billingType,
              paymentMethod: charge.billingType,
            });
            chargeData = charge;
          }
        } catch (asaasErr: any) {
          console.warn("Asaas charge creation failed:", asaasErr.message);
        }
      }

      return res.json({ order, charge: chargeData });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/credit-orders/:id/release", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.releaseCreditOrder(id);
      return res.json({ order, message: `${order.ispCredits} ISP + ${order.spcCredits} SPC creditos liberados` });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/credit-orders/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, notes } = req.body;
      const order = await storage.updateCreditOrder(id, { status, notes });
      return res.json(order);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/credit-orders/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { billingType } = req.body;
      const order = await storage.getCreditOrder(id);
      if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });
      const provider = await storage.getProvider(order.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const { findOrCreateCustomer, createCharge } = await import("./asaas");
      const customer = await findOrCreateCustomer({ name: provider.name, cnpj: provider.cnpj, email: provider.contactEmail || "" });
      const charge = await createCharge({
        customer: customer.id, billingType: billingType || "UNDEFINED",
        value: parseFloat(order.amount),
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        description: `Creditos ${order.packageName}: ${order.ispCredits} ISP + ${order.spcCredits} SPC`,
        externalReference: `credit_order_${order.id}`,
      });
      const updated = await storage.updateCreditOrder(id, {
        asaasChargeId: charge.id, asaasCustomerId: customer.id,
        asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl, asaasBillingType: charge.billingType,
        paymentMethod: charge.billingType,
      });
      return res.json({ order: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/credit-orders/:id/asaas/sync", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getCreditOrder(id);
      if (!order || !order.asaasChargeId) return res.status(400).json({ message: "Sem cobranca Asaas" });
      const { getCharge, asaasStatusToLocal } = await import("./asaas");
      const charge = await getCharge(order.asaasChargeId);
      const newStatus = asaasStatusToLocal(charge.status);
      const updates: any = { asaasStatus: charge.status, asaasInvoiceUrl: charge.invoiceUrl, asaasBankSlipUrl: charge.bankSlipUrl };
      if (charge.pixTransaction?.payload) updates.asaasPixKey = charge.pixTransaction.payload;
      if (newStatus === "paid" && order.status !== "paid") {
        const released = await storage.releaseCreditOrder(id);
        return res.json({ order: released, message: "Pagamento confirmado e creditos liberados automaticamente" });
      }
      const updated = await storage.updateCreditOrder(id, { ...updates, status: newStatus !== "paid" ? newStatus : order.status });
      return res.json({ order: updated });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/credit-orders/:id/asaas/pix", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getCreditOrder(id);
      if (!order || !order.asaasChargeId) return res.status(400).json({ message: "Sem cobranca Asaas" });
      const { getPixQrCode } = await import("./asaas");
      const pixData = await getPixQrCode(order.asaasChargeId);
      return res.json(pixData);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
