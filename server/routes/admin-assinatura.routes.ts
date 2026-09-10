/**
 * A conta ZapSign de cada provedor — configurada SÓ pelo superadmin, no molde
 * da configuração de ERP (admin.routes.ts). Router próprio pelo tamanho do
 * arquivo do ERP; os limites são os mesmos de lá (60/min salvar, 20/min testar).
 *
 * Diferente do ERP, o GET NUNCA devolve a credencial decifrada: só se a
 * credencial existe, se abre neste servidor e os 4 últimos caracteres.
 */
import { Router } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import { clienteZapSign } from "../assinatura/zapsign";
import { ErroDeConfissao } from "../assinatura/erro";
import { AMBIENTES_DE_ASSINATURA, AUTH_MODES_DO_CLIENTE, AUTH_MODE_PADRAO, PRAZO_PADRAO_DE_ASSINATURA_DIAS } from "@shared/cobranca/confissao";

export const ConfiguracaoZapSignSchema = z.object({
  apiToken: z.string().max(500).nullable().optional(),
  ambiente: z.enum(AMBIENTES_DE_ASSINATURA).optional(),
  templateId: z.string().trim().max(120).nullable().optional(),
  signatarioNome: z.string().trim().max(160).nullable().optional(),
  signatarioCpf: z.string().trim().max(20).nullable().optional(),
  signatarioEmail: z.string().trim().email().max(160).nullable().optional(),
  signatarioTelefone: z.string().trim().max(30).nullable().optional(),
  provedorAssina: z.boolean().optional(),
  authModeCliente: z.enum(AUTH_MODES_DO_CLIENTE).optional(),
  exigirSelfie: z.boolean().optional(),
  prazoAssinaturaDias: z.number().int().min(1).max(90).optional(),
  enviarArquivoAssinadoWhatsapp: z.boolean().optional(),
}).strict().superRefine((d, ctx) => {
  if (d.provedorAssina && !(d.signatarioNome && d.signatarioEmail)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["signatarioEmail"], message: "Quando o provedor assina, informe nome e e-mail do representante" });
  }
});

const NAO_CONFIGURADA = {
  configurada: false, apiTokenGravado: false, apiTokenIlegivel: false, apiTokenFinal: null, ambiente: "sandbox", templateId: null,
  signatarioNome: null, signatarioCpf: null, signatarioEmail: null, signatarioTelefone: null, provedorAssina: false,
  authModeCliente: AUTH_MODE_PADRAO, exigirSelfie: false, prazoAssinaturaDias: PRAZO_PADRAO_DE_ASSINATURA_DIAS, enviarArquivoAssinadoWhatsapp: false,
  modeloRevisadoEm: null, isEnabled: false, ativadaEm: null, updatedAt: null,
};

export function registerAdminAssinaturaRoutes(): Router {
  const router = Router();
  const limiteConfig = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const limiteAtivar = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

  async function provedorDaRota(idCru: string): Promise<number | null> {
    const id = Number.parseInt(idCru, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    return (await storage.getProvider(id)) ? id : null;
  }

  router.get("/api/admin/providers/:id/assinatura/zapsign", requireSuperAdmin, async (req, res) => {
    try {
      const id = await provedorDaRota(String(req.params.id));
      if (!id) return res.status(404).json({ message: "Provedor nao encontrado" });
      res.json((await storage.getIntegracaoParaAdmin(id)) ?? NAO_CONFIGURADA);
    } catch (e) {
      res.status(500).json({ message: getSafeErrorMessage(e) });
    }
  });

  router.put("/api/admin/providers/:id/assinatura/zapsign", requireSuperAdmin, limiteConfig, async (req, res) => {
    try {
      const id = await provedorDaRota(String(req.params.id));
      if (!id) return res.status(404).json({ message: "Provedor nao encontrado" });
      const parsed = ConfiguracaoZapSignSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      const atual = await storage.getIntegracaoParaAdmin(id);
      const tokenNovo = typeof parsed.data.apiToken === "string" && parsed.data.apiToken.trim().length > 0;
      if (atual?.apiTokenIlegivel && !tokenNovo) {
        return res.status(400).json({ message: "O token gravado não abre neste servidor — redigite o token do ZapSign para salvar" });
      }
      await storage.salvarIntegracaoDeAssinatura(id, parsed.data);
      res.json((await storage.getIntegracaoParaAdmin(id)) ?? NAO_CONFIGURADA);
    } catch (e) {
      res.status(500).json({ message: getSafeErrorMessage(e) });
    }
  });

  router.post("/api/admin/providers/:id/assinatura/zapsign/ativar", requireSuperAdmin, limiteAtivar, async (req, res) => {
    try {
      const id = await provedorDaRota(String(req.params.id));
      if (!id) return res.status(404).json({ message: "Provedor nao encontrado" });
      const credencial = await storage.getIntegracaoComCredencial(id);
      if (!credencial) return res.status(400).json({ message: "Salve o token do ZapSign antes de ativar" });
      try {
        await clienteZapSign({ apiToken: credencial.apiToken, ambiente: credencial.ambiente as "sandbox" | "producao" }).testarToken();
      } catch (e) {
        if (e instanceof ErroDeConfissao) return res.status(422).json({ message: e.message, code: e.codigo });
        throw e;
      }
      await storage.ativarIntegracaoDeAssinatura(id);
      res.json((await storage.getIntegracaoParaAdmin(id)) ?? NAO_CONFIGURADA);
    } catch (e) {
      if (e instanceof ErroDeConfissao) return res.status(e.http).json({ message: e.message, code: e.codigo });
      res.status(500).json({ message: getSafeErrorMessage(e) });
    }
  });

  return router;
}
