import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { validarCPF } from "../utils/cpf-cnpj-validator";
import {
  consultarCpf, testarCredencial, invalidarToken, DATASETS,
  NIVEIS, NIVEL_PADRAO, extrasDoNivel,
} from "../services/bigdata.service";
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
  // O nivel vem do cliente, mas o custo NUNCA: quantos creditos cada um consome
  // e lido de NIVEIS no servidor. Aceitar preco do cliente deixaria qualquer um
  // rodar uma Premium por 1 credito.
  nivel: z.enum(["padrao", "completa"]).optional(),
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
        // Consultas antigas nao tem nivel gravado; sao todas do combo padrao.
        nivel: (c.result as any)?.nivel ?? NIVEL_PADRAO,
        creditosCobrados: (c.result as any)?.creditosCobrados ?? 1,
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
        // Catalogo dos niveis para a tela montar o seletor. `custoBrl` fica no
        // servidor: e o que a BigData cobra de nos, nao do provedor.
        niveis: (Object.keys(NIVEIS) as Array<keyof typeof NIVEIS>).map(k => ({
          id: k,
          rotulo: NIVEIS[k].rotulo,
          descricao: NIVEIS[k].descricao,
          creditos: NIVEIS[k].creditos,
        })),
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/bigdata-consultations", requireAuth, async (req, res) => {
    const providerId = req.session.providerId!;
    let debitou = false;
    // Fora do try porque o catch precisa estornar a MESMA quantidade debitada.
    // Uma Premium que falha tem de devolver 17 creditos, nao 1.
    let custoCreditos = NIVEIS[NIVEL_PADRAO].creditos;
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

      // A Completa esta DESLIGADA — o nivel pedido e ignorado.
      //
      // Medido contra a API da BigDataCorp em 27/08/2026: os quatro datasets que
      // ela promete (quod_credit_risk_details, quantum_custom_score,
      // telesign_phone_id, rede_vistorias_address) respondem -109 DATASET NOT
      // AVAILABLE — nao estao habilitados no BDC Center desta conta. O estorno
      // logo abaixo devolvia a diferenca, entao ninguem foi cobrado a mais; mas
      // o provedor escolhia um nivel que nao existia e esperava um dado que
      // nunca vinha. Melhor nao oferecer do que oferecer vazio.
      //
      // O `nivel` continua no schema para nao quebrar chamador antigo, e NIVEIS
      // segue com a Completa definida: habilitados os datasets no BDC Center,
      // basta remover esta linha e voltar o seletor na tela.
      const nivel = NIVEL_PADRAO;
      custoCreditos = NIVEIS[nivel].creditos;

      debitou = await storage.debitarBigdataCredito(providerId, custoCreditos);
      if (!debitou) {
        const provider = await storage.getProvider(providerId);
        return res.status(402).json({
          message: `Saldo insuficiente: a consulta ${NIVEIS[nivel].rotulo} custa `
            + `${custoCreditos} crédito(s) e você tem ${provider?.bigdataCredits ?? 0}`,
          creditosNecessarios: custoCreditos,
          creditosDisponiveis: provider?.bigdataCredits ?? 0,
        });
      }

      const r = await consultarCpf(
        providerId, { login: integ.login, password: integ.password }, cpf, nivel,
      );
      const v = decidirVeredito(r.dados, { valorPlano: parsed.data.valorPlano });

      // Cobrar 4 creditos e entregar so o combo padrao e o que o provedor viu
      // como "nao veio nada". Se NENHUM bureau do nivel respondeu — nao
      // habilitado (-109) OU fora do ar (falha) — estorna a diferenca e
      // registra a consulta pelo que ela de fato foi: uma Padrao.
      const extras = extrasDoNivel(nivel);
      const bloqueados = extras.filter(d =>
        r.datasetsIndisponiveis.includes(d) || r.datasetsComFalha.includes(d));
      const bureauIndisponivel = extras.length > 0 && bloqueados.length === extras.length;

      let nivelCobrado = nivel;
      if (bureauIndisponivel) {
        const estorno = custoCreditos - NIVEIS[NIVEL_PADRAO].creditos;
        if (estorno > 0) {
          await storage.estornarBigdataCredito(providerId, estorno).catch(() => {});
        }
        custoCreditos = NIVEIS[NIVEL_PADRAO].creditos;
        nivelCobrado = NIVEL_PADRAO;
      }

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
        processos: r.processos,
          rastro: r.rastro,
          patrimonio: r.patrimonio,
          ocupacao: r.ocupacao,
          perfil: r.perfil,
          mercado: r.mercado,
          riscoArea: r.riscoArea,
        validacaoTelefone: r.validacaoTelefone,
        imovel: r.imovel,
          datasetsIndisponiveis: r.datasetsIndisponiveis,
          veredito: v.veredito,
          motivos: v.motivos,
          datasetsComFalha: r.datasetsComFalha,
          latenciaMs: r.latenciaMs,
          bruto: r.bruto,
          // Nivel e custo ficam gravados: sem isso nao da para auditar depois
          // por que uma consulta gastou 4 creditos e outra gastou 1.
          nivel: nivelCobrado,
          nivelPedido: nivel,
          creditosCobrados: custoCreditos,
          bureauIndisponivel,
          // Mesmo padrao LGPD da consulta ISP
          baseLegal: "Legítimo interesse (LGPD Art. 7, IX)",
          finalidadeConsulta: "Análise de risco de crédito para contratação de serviço",
          lgpdAccepted: parsed.data.lgpdAccepted === true,
        } as any,
        datasets: [...r.datasetsChamados],
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
        processos: r.processos,
        rastro: r.rastro,
        patrimonio: r.patrimonio,
        ocupacao: r.ocupacao,
        perfil: r.perfil,
        mercado: r.mercado,
        riscoArea: r.riscoArea,
        validacaoTelefone: r.validacaoTelefone,
        imovel: r.imovel,
        // Contagem, nao nome: "partner_quod_..." identificaria o fornecedor.
        consultasIndisponiveis: r.datasetsIndisponiveis.length,
        consultasComFalha: r.datasetsComFalha.length,
        latenciaMs: r.latenciaMs,
        nivel: nivelCobrado,
        nivelPedido: nivel,
        creditosCobrados: custoCreditos,
        // A tela precisa explicar por que o bloco de mercado nao apareceu — sem
        // isso o operador conclui que o CPF esta limpo, e nao que ninguem olhou.
        bureauIndisponivel,
        createdAt: salva.createdAt,
      });
    } catch (error: any) {
      // Falha nossa ou do bureau nao cobra: a busca nao foi executada.
      if (debitou) await storage.estornarBigdataCredito(providerId, custoCreditos).catch(() => {});
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
