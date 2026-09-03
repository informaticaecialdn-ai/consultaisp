import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { validarCPF, validarCNPJ } from "../utils/cpf-cnpj-validator";
import {
  consultarCpf, testarCredencial, invalidarToken, DATASETS,
  NIVEIS, NIVEL_PADRAO, extrasDoNivel,
} from "../services/bigdata.service";
import { decidirVeredito } from "../services/bigdata-veredito";
import { consultarCnpj, decidirVereditoEmpresa } from "../services/bigdata-empresa";
import { gerarIdentificadorDeConsulta, protocoloDaOrigem } from "../services/identificador-consulta";
import { logger } from "../logger";

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

  /**
   * Endereco de INSTALACAO. A barra de busca ja coletava estes campos e o
   * schema os descartava em silencio — zod remove chave nao declarada, entao o
   * painel "Verificar tambem por endereco de instalacao" existia e nao fazia
   * nada nesta rota.
   *
   * Sao o que liga o cruzamento de domicilio: parente morando no imovel onde o
   * servico vai ser instalado. Opcionais de proposito — sem eles a consulta
   * roda igual, so nao cruza.
   */
  addressStreet: z.string().max(200).optional(),
  addressNumber: z.string().max(20).optional(),
  addressComplement: z.string().max(60).optional(),
  addressNeighborhood: z.string().max(120).optional(),
  addressCity: z.string().max(120).optional(),
  addressState: z.string().max(40).optional(),
  addressZip: z.string().max(12).optional(),
});

export function registerBigdataRoutes(): Router {
  const router = Router();

  /** A senha volta mascarada. O valor real nunca sai do servidor. */
  router.get("/api/bigdata-integration", requireAuth, requireProvider, async (req, res) => {
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

  router.patch("/api/bigdata-integration", requireAuth, requireProvider, async (req, res) => {
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
  router.post("/api/bigdata-integration/test", requireAuth, requireProvider, async (req, res) => {
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
  router.get("/api/bigdata-consultations", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const brutas = await storage.getBigdataConsultations(providerId);
      // A origem do dado e informacao sensivel de negocio: nao sai do servidor.
      // datasets[] e o payload cru ficam gravados para auditoria, mas nunca vao
      // ao navegador — la eles apareceriam no devtools de qualquer operador.
      const consultations = brutas.map(c => ({
        id: c.id, cpfCnpj: c.cpfCnpj, veredito: c.veredito, createdAt: c.createdAt,
        // Nulo nas consultas anteriores a esta versao: elas nasceram sem codigo
        // e a tela mostra o traco, em vez de inventar um que o log nao tem.
        consultaId: c.consultaId ?? null,
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
        credits: provider?.ispCredits ?? 0,
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

  router.post("/api/bigdata-consultations", requireAuth, requireProvider, async (req, res) => {
    const providerId = req.session.providerId!;
    let debitou = false;
    // Fora do try porque o catch precisa estornar a MESMA quantidade debitada.
    // Uma Premium que falha tem de devolver 17 creditos, nao 1.
    let custoCreditos = NIVEIS[NIVEL_PADRAO].creditos;

    /**
     * O identificador nasce AQUI, na primeira linha do handler.
     *
     * Antes do parse, antes do debito, antes de falar com a BigDataCorp — e
     * proposital. Se ele nascesse junto do insert, os caminhos que MAIS
     * precisam dele ficariam sem: saldo insuficiente, credencial recusada,
     * bureau fora do ar. E justamente ai que o provedor liga para o suporte,
     * e ate esta versao nao havia o que procurar — esta rota nao tinha uma
     * unica linha de log.
     *
     * Um por REQUISICAO, nao por linha gravada: os dois ramos abaixo (CNPJ e
     * CPF) usam o mesmo codigo, porque foram a mesma consulta.
     */
    const consultaId = gerarIdentificadorDeConsulta();
    const t0 = Date.now();
    // Declarado fora do try porque o catch tambem escreve log: sem isso a linha
    // de falha sairia sem saber qual documento estava sendo consultado.
    let contexto: Record<string, unknown> = { consultaId, providerId };

    try {
      const parsed = consultaSchema.safeParse(req.body);
      if (!parsed.success) {
        // Documento nao chegou a ser lido: o log NAO pode citar req.body.
        logger.warn({ consultaId, providerId, motivo: "corpo-invalido" },
          "[Cadastral] consulta recusada antes de qualquer cobranca");
        return res.status(400).json({ consultaId, message: parsed.error.issues[0].message });
      }

      const doc = parsed.data.cpfCnpj.replace(/\D/g, "");
      const ehCnpj = doc.length === 14;
      // Quatro digitos e o suficiente para o suporte casar a linha com a
      // consulta que o provedor esta descrevendo, e nao remonta o documento.
      // Mesmo mascaramento das outras rotas.
      contexto = { consultaId, providerId, doc: doc.slice(0, 4) + "***", tipo: ehCnpj ? "cnpj" : "cpf" };

      logger.info(contexto, "[Cadastral] consulta iniciada");

      // Valida antes de chamar: documento errado nao gasta credito nem consulta.
      // A mensagem tem de descrever o documento QUE FOI DIGITADO — antes daqui
      // um CNPJ recebia "CPF invalido: digitos verificadores incorretos", que
      // manda o operador conferir a coisa errada.
      if (ehCnpj) {
        if (!validarCNPJ(doc)) {
          logger.warn({ ...contexto, motivo: "documento-invalido" }, "[Cadastral] consulta recusada sem cobranca");
          return res.status(400).json({ consultaId, message: "CNPJ inválido: dígitos verificadores incorretos" });
        }
      } else if (!validarCPF(doc)) {
        logger.warn({ ...contexto, motivo: "documento-invalido" }, "[Cadastral] consulta recusada sem cobranca");
        return res.status(400).json({ consultaId, message: "CPF inválido: dígitos verificadores incorretos" });
      }

      const integ = await storage.getBigdataIntegration(providerId);
      if (!integ?.login || !integ?.password) {
        logger.warn({ ...contexto, motivo: "sem-credencial" }, "[Cadastral] consulta recusada sem cobranca");
        return res.status(400).json({
          consultaId,
          message: "Consulta cadastral não configurada", naoConfigurado: true,
        });
      }

      // ── CNPJ: endpoint proprio, veredito proprio ────────────────────────────
      //
      // Nao e o mesmo caminho com outro documento: /pessoas recusa CNPJ com
      // -114 em todos os datasets. Empresa vai para /empresas, tem os blocos
      // dela (situacao na Receita, idade, CNAE, quadro societario) e NAO tem os
      // de pessoa (renda familiar, beneficio, domicilio). Custa 1 credito
      // igual, embora saia mais barato para nos — a diferenca vira margem.
      if (ehCnpj) {
        custoCreditos = NIVEIS[NIVEL_PADRAO].creditos;
        debitou = await storage.debitarBigdataCredito(providerId, custoCreditos);
        if (!debitou) {
          const provider = await storage.getProvider(providerId);
          logger.warn({ ...contexto, motivo: "saldo-insuficiente", creditosNecessarios: custoCreditos },
            "[Cadastral] consulta recusada sem cobranca");
          return res.status(402).json({
            consultaId,
            message: `Saldo insuficiente: a consulta custa ${custoCreditos} crédito(s) `
              + `e você tem ${provider?.ispCredits ?? 0}`,
            creditosNecessarios: custoCreditos,
            creditosDisponiveis: provider?.ispCredits ?? 0,
          });
        }

        const e = await consultarCnpj(
          providerId, { login: integ.login, password: integ.password }, doc,
        );
        const ve = decidirVereditoEmpresa(e);

        // O protocolo que a PROPRIA BigDataCorp emitiu (um UUID no envelope).
        // Quando o dado vem errado quem resolve e ela, e e este numero que ela
        // pede. Estava gravado em `bruto` desde sempre, e ninguem lia.
        const protocoloEmpresa = protocoloDaOrigem("cadastral", { bruto: e.bruto });

        const salvaEmpresa = await storage.createBigdataConsultation({
          providerId, userId: req.session.userId!, cpfCnpj: doc,
          consultaId,
          result: {
            tipoDocumento: "cnpj",
            empresa: e.empresa,
            enderecos: e.enderecos,
            telefones: e.telefones,
            emails: e.emails,
            inadimplencia: e.inadimplencia,
            processos: e.processos,
            datasetsIndisponiveis: e.datasetsIndisponiveis,
            veredito: ve.veredito,
            motivos: ve.motivos,
            datasetsComFalha: e.datasetsComFalha,
            latenciaMs: e.latenciaMs,
            bruto: e.bruto,
            nivel: NIVEL_PADRAO,
            nivelPedido: NIVEL_PADRAO,
            creditosCobrados: custoCreditos,
            bureauIndisponivel: false,
            baseLegal: "Legítimo interesse (LGPD Art. 7, IX)",
            finalidadeConsulta: "Análise de risco de crédito para contratação de serviço",
            lgpdAccepted: parsed.data.lgpdAccepted === true,
          } as any,
          datasets: [...e.datasetsChamados],
          veredito: ve.veredito,
        } as any);

        logger.info({
          ...contexto, linhaId: salvaEmpresa.id, veredito: ve.veredito,
          encontrado: e.encontrado, creditosCobrados: custoCreditos,
          protocoloOrigem: protocoloEmpresa?.protocolo ?? null,
          ms: Date.now() - t0,
        }, "[Cadastral] consulta concluída");

        return res.json({
          id: salvaEmpresa.id,
          consultaId,
          protocoloDaOrigem: protocoloEmpresa,
          cpfCnpj: doc,
          tipoDocumento: "cnpj",
          veredito: ve.veredito,
          motivos: ve.motivos,
          empresa: e.empresa,
          enderecos: e.enderecos,
          telefones: e.telefones,
          emails: e.emails,
          inadimplencia: e.inadimplencia,
          processos: e.processos,
          consultasIndisponiveis: e.datasetsIndisponiveis.length,
          consultasComFalha: e.datasetsComFalha.length,
          latenciaMs: e.latenciaMs,
          nivel: NIVEL_PADRAO,
          nivelPedido: NIVEL_PADRAO,
          creditosCobrados: custoCreditos,
          bureauIndisponivel: false,
          createdAt: salvaEmpresa.createdAt,
        });
      }

      const cpf = doc;
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
      // Em 02/09/2026 o dono fechou um nivel so, a 1 credito ("quando tiver
      // volume aumentamos"): a Completa saiu de NIVEIS. O `nivel` continua no
      // schema para nao quebrar chamador antigo; o que vale e este.
      const nivel = NIVEL_PADRAO;
      custoCreditos = NIVEIS[nivel].creditos;

      debitou = await storage.debitarBigdataCredito(providerId, custoCreditos);
      if (!debitou) {
        const provider = await storage.getProvider(providerId);
        logger.warn({ ...contexto, motivo: "saldo-insuficiente", creditosNecessarios: custoCreditos },
          "[Cadastral] consulta recusada sem cobranca");
        return res.status(402).json({
          consultaId,
          message: `Saldo insuficiente: a consulta ${NIVEIS[nivel].rotulo} custa `
            + `${custoCreditos} crédito(s) e você tem ${provider?.ispCredits ?? 0}`,
          creditosNecessarios: custoCreditos,
          creditosDisponiveis: provider?.ispCredits ?? 0,
        });
      }

      // Endereco de instalacao so vale como cruzamento se tiver o minimo para
      // afirmar que dois cadastros sao o mesmo imovel: rua, numero e cidade.
      // Incompleto vira null — melhor nao cruzar do que cruzar por aproximacao
      // e apontar um parente que mora noutro lugar.
      const p = parsed.data;
      const enderecoInstalacao = (p.addressStreet && p.addressNumber && p.addressCity)
        ? {
            address: p.addressStreet, addressNumber: p.addressNumber,
            neighborhood: p.addressNeighborhood, city: p.addressCity,
            state: p.addressState, cep: p.addressZip,
          }
        : null;

      const r = await consultarCpf(
        providerId, { login: integ.login, password: integ.password }, cpf, nivel,
        enderecoInstalacao,
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
          // Movimento de credito que o provedor ve no extrato e nao consegue
          // explicar sozinho: cobrado 4, devolvido 3. Com o codigo na linha, o
          // suporte liga o estorno a consulta que o causou.
          await storage.estornarBigdataCredito(providerId, estorno).catch(() => {});
          logger.info({ ...contexto, estornado: estorno, motivo: "bureau-indisponivel" },
            "[Cadastral] estorno parcial de créditos");
        }
        custoCreditos = NIVEIS[NIVEL_PADRAO].creditos;
        nivelCobrado = NIVEL_PADRAO;
      }

      const protocolo = protocoloDaOrigem("cadastral", { bruto: r.bruto });

      const salva = await storage.createBigdataConsultation({
        providerId, userId: req.session.userId!, cpfCnpj: cpf,
        consultaId,
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
          ocupacao: r.ocupacao,
          perfil: r.perfil,
          mercado: r.mercado,
          capacidade: r.capacidade,

          domicilio: r.domicilio,
          cruzamentoDomicilio: r.cruzamentoDomicilio,

          riscoFamiliar: r.riscoFamiliar,


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

      logger.info({
        ...contexto, linhaId: salva.id, veredito: v.veredito,
        encontrado: r.dados.encontrado, creditosCobrados: custoCreditos, bureauIndisponivel,
        protocoloOrigem: protocolo?.protocolo ?? null,
        ms: Date.now() - t0,
      }, "[Cadastral] consulta concluída");

      return res.json({
        id: salva.id,
        consultaId,
        protocoloDaOrigem: protocolo,
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
        ocupacao: r.ocupacao,
        perfil: r.perfil,
        mercado: r.mercado,
        capacidade: r.capacidade,

        domicilio: r.domicilio,
        cruzamentoDomicilio: r.cruzamentoDomicilio,

        riscoFamiliar: r.riscoFamiliar,


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
      /**
       * O buraco que este bloco fechou.
       *
       * O credito e debitado ANTES do insert, entao existe um intervalo real em
       * que o provedor pagou e nenhuma linha foi gravada: bureau fora do ar,
       * timeout, credencial recusada no meio. Ate esta versao esse evento nao
       * deixava rastro NENHUM — nem a falha, nem o estorno que a compensa. O
       * provedor via o saldo oscilar e o suporte nao tinha o que procurar.
       */
      if (debitou) {
        await storage.estornarBigdataCredito(providerId, custoCreditos).catch(() => {});
        logger.info({ ...contexto, estornado: custoCreditos, motivo: "falha-na-consulta" },
          "[Cadastral] estorno integral de créditos");
      }
      const credencialRuim = error?.codigo === -111;
      logger.error({
        ...contexto, codigo: error?.codigo ?? null,
        motivo: credencialRuim ? "credencial-recusada" : "falha-do-bureau",
        // `err` e o campo que o pino serializa como erro; a mensagem crua pode
        // conter o corpo da resposta do bureau, entao nao vai por outro caminho.
        err: error, debitou, ms: Date.now() - t0,
      }, "[Cadastral] consulta falhou — nenhuma linha gravada");

      return res.status(credencialRuim ? 400 : 503).json({
        // O codigo vai TAMBEM no erro, e e aqui que ele mais importa: e o unico
        // caminho em que nao existe linha no banco para o suporte consultar.
        consultaId,
        message: credencialRuim
          ? "Credencial recusada. Verifique usuário e senha."
          : getSafeErrorMessage(error),
      });
    }
  });

  return router;
}
