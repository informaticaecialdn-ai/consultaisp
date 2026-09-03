import { Router } from "express";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { hashPassword } from "../password";
import { getSafeErrorMessage } from "../utils/safe-error";
import { sanitizeFilename } from "../utils/filename-sanitizer";
import { logger } from "../logger";
import { anonymizeProvider } from "../utils/provider-anonymizer";
import { sendUsuarioAdicionadoEmail } from "../services/email";
import { contextoDeEmail } from "../services/email-destinatario";
import crypto from "crypto";

/**
 * Avisa a PESSOA que acabou de ganhar acesso ao provedor.
 *
 * O destinatario e um endereco especifico — o do usuario criado — e por isso
 * `avisarProvedor` (que resolve o contato do provedor) nao serve. O que se
 * aproveita dele e a resolucao de marca e de endereco de entrada, via
 * `contextoDeEmail`: quem entra por uma marca revendedora precisa do link
 * daquela marca, senao cai numa tela onde o login dele e recusado.
 *
 * A SENHA NAO VAI NO E-MAIL — quem cria a entrega por outro canal, ou o novo
 * usuario define a dele por "Esqueci minha senha".
 *
 * Nao lanca: a conta ja esta criada quando este aviso sai. Envio de e-mail nao
 * derruba a operacao que o disparou.
 */
async function avisarUsuarioCriado(
  provedor: { id: number; name: string; contactEmail?: string | null; marcaId?: number | null; subdomain?: string | null },
  usuario: { name: string; email: string },
  quemAdicionou: string,
): Promise<void> {
  try {
    const ctx = await contextoDeEmail(provedor);
    await sendUsuarioAdicionadoEmail(
      usuario.email, usuario.name, provedor.name, quemAdicionou, usuario.email, ctx.marca, ctx.urlBase,
    );
  } catch (err: any) {
    logger.error(
      { providerId: provedor.id, rotulo: "usuario-adicionado", err: err?.message },
      "[email] Falha ao avisar o usuario criado",
    );
  }
}

export function registerProviderRoutes(): Router {
  const router = Router();

  router.get("/api/tenant/resolve", async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const provider = await storage.getProviderBySubdomain(subdomain);
    if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
    return res.json({
      id: provider.id,
      name: provider.tradeName || provider.name,
      subdomain: provider.subdomain,
      plan: provider.plan,
      status: provider.status,
    });
  });

  router.get("/api/provider/users", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerUsers = await storage.getUsersByProvider(req.session.providerId!);
      const safe = providerUsers.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));
      return res.json(safe);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/users", requireAuth, requireProvider, async (req, res) => {
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

      // Quem foi adicionado nao recebia nada: descobria a conta quando alguem
      // avisava por fora. O aviso sai depois da criacao e nao pode derruba-la.
      const provedor = await storage.getProvider(req.session.providerId!).catch(() => null);
      if (provedor) {
        const autor = await storage.getUser(req.session.userId!).catch(() => null);
        await avisarUsuarioCriado(provedor, newUser, autor?.name || provedor.name);
      }

      return res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/provider/users/:id", requireAuth, requireProvider, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem remover usuarios" });
      }
      const userId = parseInt(req.params.id);
      // 409, nao 400: o pedido esta bem formado: o que impede e o ESTADO. E a
      // exclusao e definitiva, entao as duas travas abaixo sao a unica coisa
      // entre um clique e um provedor sem ninguem que consiga administra-lo.
      if (userId === req.session.userId) {
        return res.status(409).json({ message: "Voce nao pode excluir a propria conta" });
      }
      const targetUser = await storage.getUser(userId);
      if (!targetUser || targetUser.providerId !== req.session.providerId) {
        return res.status(404).json({ message: "Usuario nao encontrado" });
      }
      if (targetUser.role === "admin") {
        const doProvedor = await storage.getUsersByProvider(req.session.providerId!);
        const admins = doProvedor.filter(u => u.role === "admin");
        if (admins.length <= 1) {
          return res.status(409).json({ message: "Este e o ultimo administrador do provedor. Promova outro antes de excluir." });
        }
      }
      try {
        await storage.deleteUser(userId);
      } catch (erro: any) {
        /**
         * 23503 = foreign_key_violation.
         *
         * `isp_consultations.user_id`, `spc_consultations.user_id`,
         * `bigdata_consultations.user_id` e `support_messages.sender_id` sao
         * NOT NULL e sem ON DELETE. Ou seja: o operador que ja rodou UMA
         * consulta — o uso normal da conta — nao pode ser apagado. Isso e
         * estado, nao falha do servidor, e virava 500 "Erro interno do
         * servidor": o admin clicava, via um erro sem causa e tentava de novo.
         */
        const codigo = erro?.code ?? erro?.cause?.code;
        if (codigo === "23503") {
          return res.status(409).json({
            message: "Este usuario ja tem historico no sistema (consultas ou mensagens de suporte) e por isso nao pode ser apagado — o historico e do provedor e nao pode ir junto.",
            code: "USUARIO_COM_HISTORICO",
          });
        }
        throw erro;
      }
      return res.json({ message: "Usuario removido com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/provider/settings", requireAuth, requireProvider, async (req, res) => {
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/profile", requireAuth, requireProvider, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const partners = await storage.getProviderPartners(req.session.providerId!);
      const documents = await storage.getProviderDocuments(req.session.providerId!);
      return res.json({ ...provider, partners, documents });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/integration", requireAuth, requireProvider, async (req, res) => {
    try {
      const token = await storage.getProviderWebhookToken(req.session.providerId!);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({ token, webhookUrl: `${baseUrl}/api/webhooks/erp-sync` });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/integration/regenerate-token", requireAuth, requireProvider, async (req, res) => {
    try {
      if (req.session.role !== "admin") return res.status(403).json({ message: "Apenas administradores" });
      const token = await storage.regenerateWebhookToken(req.session.providerId!);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({ token, webhookUrl: `${baseUrl}/api/webhooks/erp-sync` });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/provider/profile", requireAuth, requireProvider, async (req, res) => {
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/partners", requireAuth, requireProvider, async (req, res) => {
    try {
      const partners = await storage.getProviderPartners(req.session.providerId!);
      return res.json(partners);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/partners", requireAuth, requireProvider, async (req, res) => {
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/provider/partners/:id", requireAuth, requireProvider, async (req, res) => {
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/provider/partners/:id", requireAuth, requireProvider, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem remover socios" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteProviderPartner(id, req.session.providerId!);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/documents", requireAuth, requireProvider, async (req, res) => {
    try {
      const docs = await storage.getProviderDocuments(req.session.providerId!);
      const docsNoData = docs.map(({ fileData, ...rest }) => rest);
      return res.json(docsNoData);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/documents", requireAuth, requireProvider, async (req, res) => {
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
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/provider/documents/:id", requireAuth, requireProvider, async (req, res) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ message: "Apenas administradores podem remover documentos" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteProviderDocument(id, req.session.providerId!);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/documents/:id/download", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const doc = await storage.getProviderDocument(id);
      if (!doc || doc.providerId !== req.session.providerId!) {
        return res.status(404).json({ message: "Documento nao encontrado" });
      }
      const buffer = Buffer.from(doc.fileData.split(",")[1] || doc.fileData, "base64");
      res.setHeader("Content-Type", doc.documentMimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(doc.documentName)}"`);
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── Proactive Alert Settings ──────────────────────────────
  router.get("/api/providers/alert-settings", requireAuth, requireProvider, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      return res.json({
        proactiveAlertsEnabled: provider.proactiveAlertsEnabled ?? true,
        webhookUrl: provider.proactiveAlertWebhookUrl || "",
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.put("/api/providers/alert-settings", requireAuth, requireProvider, async (req, res) => {
    try {
      const { proactiveAlertsEnabled, webhookUrl } = req.body;
      await storage.updateProviderProfile(req.session.providerId!, {
        proactiveAlertsEnabled: proactiveAlertsEnabled === true,
        proactiveAlertWebhookUrl: webhookUrl || null,
      });
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/providers/alert-settings/test-webhook", requireAuth, requireProvider, async (req, res) => {
    try {
      const { webhookUrl } = req.body;
      if (!webhookUrl) return res.status(400).json({ message: "URL do webhook obrigatoria" });

      const testPayload = {
        event: "test",
        provider: "Teste",
        maskedCpf: "123.***.***.45",
        maskedCustomerName: "Joao S***",
        message: "Este e um teste de webhook do Consulta ISP",
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10_000),
      });

      return res.json({ success: response.ok, status: response.status });
    } catch (error: any) {
      logger.error({ err: error }, "Webhook test failed");
      return res.status(500).json({ message: "Falha ao testar webhook", error: error.message });
    }
  });

  // ── Proactive Alerts List ──────────────────────────────
  // O id cru do consulente nunca sai para o dono: ao lado do codigo pareado
  // ele desfazia a anonimizacao. Mesma mascara de GET /api/anti-fraud/alerts.
  router.get("/api/providers/proactive-alerts", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const alerts = await storage.getProactiveAlertsByProvider(providerId, limit);
      return res.json(alerts.map(pa => ({
        ...pa,
        consultingProviderId: pa.consultingProviderId === providerId ? pa.consultingProviderId : null,
        consultingProviderName: anonymizeProvider(providerId, pa.consultingProviderId),
      })));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/providers/proactive-alerts/:id/acknowledge", requireAuth, requireProvider, async (req, res) => {
    try {
      const alertId = parseInt(req.params.id);
      const updated = await storage.acknowledgeProactiveAlert(alertId, req.session.providerId!);
      if (!updated) return res.status(404).json({ message: "Alerta nao encontrado" });
      // So o que mudou: a linha inteira traz o id do consulente.
      return res.json({ id: updated.id, acknowledged: updated.acknowledged, acknowledgedAt: updated.acknowledgedAt });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
