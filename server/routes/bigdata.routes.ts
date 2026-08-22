import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { validarCPF } from "../utils/cpf-cnpj-validator";
import { consultarCpf, testarCredencial, invalidarToken, DATASETS } from "../services/bigdata.service";
import { decidirVeredito } from "../services/bigdata-veredito";

/**
 * Consulta Cadastral (BigDataCorp).
 *
 * Regra de cobranca: debita quando a BUSCA foi executada. Falha de rede,
 * credencial ruim ou CPF invalido nao cobram; CPF inexistente cobra, porque a
 * BigData executou e respondeu.
 */

const credencialSchema = z.object({
  login: z.string({ required_error: "Informe o usuário" }).min(1, "Informe o usuário"),
  password: z.string({ required_error: "Informe a senha" }).min(1, "Informe a senha"),
});

const consultaSchema = z.object({
  cpfCnpj: z.string({ required_error: "Informe o CPF" }).min(1, "Informe o CPF"),
  lgpdAccepted: z.boolean().optional(),
  valorPlano: z.number().positive().optional(),
});

export function registerBigdataRoutes(): Router {
  const router = Router();

  /** A senha volta mascarada. O valor real nunca sai do servidor. */
  router.get("/api/bigdata-integration", requireAuth, async (req, res) => {
    try {
      const i = await storage.getBigdataIntegration(req.session.providerId!);
      return res.json({
        configurado: !!(i?.login && i?.password),
        login: i?.login ?? null,
        senhaMascarada: i?.password ? "••••••••" : null,
        isEnabled: i?.isEnabled ?? false,
        lastCheckAt: i?.lastCheckAt ?? null,
        lastCheckStatus: i?.lastCheckStatus ?? null,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/bigdata-integration", requireAuth, async (req, res) => {
    try {
      const parsed = credencialSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

      const providerId = req.session.providerId!;
      // Credencial trocou: o token em cache virou lixo.
      invalidarToken(providerId);

      const teste = await testarCredencial(providerId, parsed.data);
      await storage.upsertBigdataIntegration(providerId, {
        ...parsed.data,
        isEnabled: teste.ok,
        lastCheckAt: new Date(),
        lastCheckStatus: teste.message,
      });
      return res.json({ ok: teste.ok, message: teste.message });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /** Valida a credencial guardada sem gastar consulta — so gera token. */
  router.post("/api/bigdata-integration/test", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const i = await storage.getBigdataIntegration(providerId);
      if (!i?.login || !i?.password) {
        return res.status(400).json({ ok: false, message: "Credencial não configurada" });
      }
      const teste = await testarCredencial(providerId, { login: i.login, password: i.password });
      await storage.upsertBigdataIntegration(providerId, {
        isEnabled: teste.ok, lastCheckAt: new Date(), lastCheckStatus: teste.message,
      });
      return res.json(teste);
    } catch (error: any) {
      return res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
    }
  });

  /** Mesmo formato do GET da consulta ISP, para a tela reusar o cabecalho. */
  router.get("/api/bigdata-consultations", requireAuth, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const brutas = await storage.getBigdataConsultations(providerId);
      // A origem do dado e informacao sensivel de negocio: nao sai do servidor.
      // datasets[] e o payload cru ficam gravados para auditoria, mas nunca vao
      // ao navegador — la eles apareceriam no devtools de qualquer operador.
      const consultations = brutas.map(c => ({
        id: c.id, cpfCnpj: c.cpfCnpj, veredito: c.veredito, createdAt: c.createdAt,
        consultasRealizadas: c.datasets?.length ?? 0,
      }));
      const provider = await storage.getProvider(providerId);

      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const em = (d: Date | null, desde: Date) => !!d && new Date(d) >= desde;

      return res.json({
        consultations,
        credits: provider?.bigdataCredits ?? 0,
        todayCount: consultations.filter(c => em(c.createdAt, hoje)).length,
        monthCount: consultations.filter(c => em(c.createdAt, inicioMes)).length,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/bigdata-consultations", requireAuth, async (req, res) => {
    const providerId = req.session.providerId!;
    let debitou = false;
    try {
      const parsed = consultaSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

      const cpf = parsed.data.cpfCnpj.replace(/\D/g, "");
      // Valida antes de chamar: CPF errado nao gasta credito nem consulta.
      if (!validarCPF(cpf)) {
        return res.status(400).json({ message: "CPF inválido: dígitos verificadores incorretos" });
      }

      const integ = await storage.getBigdataIntegration(providerId);
      if (!integ?.login || !integ?.password) {
        return res.status(400).json({
          message: "Consulta cadastral não configurada", naoConfigurado: true,
        });
      }

      debitou = await storage.debitarBigdataCredito(providerId);
      if (!debitou) {
        return res.status(402).json({ message: "Sem créditos de consulta cadastral" });
      }

      const r = await consultarCpf(providerId, { login: integ.login, password: integ.password }, cpf);
      const v = decidirVeredito(r.dados, { valorPlano: parsed.data.valorPlano });

      const salva = await storage.createBigdataConsultation({
        providerId, userId: req.session.userId!, cpfCnpj: cpf,
        result: {
          dados: r.dados,
          identidade: r.identidade,
          enderecos: r.enderecos,
          telefones: r.telefones,
          emails: r.emails,
          renda: r.renda,
          risco: r.risco,
          inadimplencia: r.inadimplencia,
          rastro: r.rastro,
          patrimonio: r.patrimonio,
          riscoArea: r.riscoArea,
          datasetsIndisponiveis: r.datasetsIndisponiveis,
          veredito: v.veredito,
          motivos: v.motivos,
          datasetsComFalha: r.datasetsComFalha,
          latenciaMs: r.latenciaMs,
          bruto: r.bruto,
          // Mesmo padrao LGPD da consulta ISP
          baseLegal: "Legítimo interesse (LGPD Art. 7, IX)",
          finalidadeConsulta: "Análise de risco de crédito para contratação de serviço",
          lgpdAccepted: parsed.data.lgpdAccepted === true,
        } as any,
        datasets: [...DATASETS],
        veredito: v.veredito,
      } as any);

      return res.json({
        id: salva.id,
        cpfCnpj: cpf,
        veredito: v.veredito,
        motivos: v.motivos,
        dados: r.dados,
        identidade: r.identidade,
        enderecos: r.enderecos,
        telefones: r.telefones,
        emails: r.emails,
        renda: r.renda,
        risco: r.risco,
        inadimplencia: r.inadimplencia,
        rastro: r.rastro,
        patrimonio: r.patrimonio,
        riscoArea: r.riscoArea,
        // Contagem, nao nome: "partner_quod_..." identificaria o fornecedor.
        consultasIndisponiveis: r.datasetsIndisponiveis.length,
        consultasComFalha: r.datasetsComFalha.length,
        latenciaMs: r.latenciaMs,
        createdAt: salva.createdAt,
      });
    } catch (error: any) {
      // Falha nossa ou do bureau nao cobra: a busca nao foi executada.
      if (debitou) await storage.estornarBigdataCredito(providerId).catch(() => {});
      const credencialRuim = error?.codigo === -111;
      return res.status(credencialRuim ? 400 : 503).json({
        message: credencialRuim
          ? "Credencial recusada. Verifique usuário e senha."
          : getSafeErrorMessage(error),
      });
    }
  });

  return router;
}
