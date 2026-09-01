/**
 * Rotas publicas do cadastro em etapas.
 *
 * Publicas por necessidade: quem se cadastra ainda nao tem sessao. E por isso
 * mesmo sao as rotas mais expostas do sistema — as unicas sem login que gastam
 * dinheiro por requisicao. As travas estao aqui e no servico; ver a economia
 * completa em server/services/cadastro-publico.service.ts.
 *
 * Os limites sao por IP e generosos para uma pessoa, apertados para um laco:
 * ninguem digita quinze CNPJs diferentes em uma hora para abrir UMA conta.
 */
import { Router } from "express";
import { z } from "zod";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import {
  buscarEmpresa, buscarBureauEmpresa, buscarResponsavel, buscaAutomaticaDisponivel,
} from "../services/cadastro-publico.service";

export function registerCadastroRoutes(): Router {
  const router = Router();

  /**
   * Limites por IP, proporcionais ao CUSTO de cada rota.
   *
   * A etapa 1 e so a Receita, que e gratuita — pode ser generosa. E precisa
   * ser: um escritorio de provedor sai por um IP so, e o limite anterior de 8
   * por hora chegou a barrar o proprio dono testando o formulario.
   *
   * O bureau e o CPF gastam de verdade (R$ 0,21 e R$ 1,09) e continuam curtos.
   */
  const limiteEmpresa = createRateLimiter({ windowMs: 3_600_000, maxRequests: 40 });
  const limiteBureau = createRateLimiter({ windowMs: 3_600_000, maxRequests: 12 });
  const limiteResponsavel = createRateLimiter({ windowMs: 3_600_000, maxRequests: 8 });

  /**
   * A tela pergunta isto antes de desenhar a etapa 2: com a busca desligada
   * (sem credencial da plataforma no ambiente), ela ja abre em modo manual em
   * vez de pedir o CPF, receber "desligado" e trocar o formulario na cara do
   * usuario.
   */
  router.get("/api/public/cadastro/recursos", async (_req, res) => {
    return res.json({ buscaAutomatica: await buscaAutomaticaDisponivel() });
  });

  router.get("/api/public/cadastro/empresa/:cnpj", limiteEmpresa, async (req, res) => {
    try {
      const r = await buscarEmpresa(String(req.params.cnpj ?? ""));
      // 409 para CNPJ ja cadastrado — a tela oferece login em vez de erro seco.
      if (!r.ok) return res.status(r.motivo === "ja-cadastrado" ? 409 : 404).json(r);
      return res.json(r);
    } catch (error: any) {
      return res.status(500).json({ ok: false, motivo: "indisponivel", mensagem: getSafeErrorMessage(error) });
    }
  });

  /**
   * O bloco de bureau da empresa. Rota separada de proposito: a consulta leva
   * 4 a 6 segundos e a tela nao pode esperar por ela para desenhar a etapa 1.
   * Chamada DEPOIS que o cartao da empresa ja apareceu.
   *
   * Exige o passe, que so e emitido para um CNPJ que passou pelos filtros
   * gratuitos — sem isso seria consulta de bureau empresarial de graca para
   * qualquer visitante.
   */
  router.get("/api/public/cadastro/empresa/:cnpj/bureau", limiteBureau, async (req, res) => {
    try {
      const r = await buscarBureauEmpresa(String(req.params.cnpj ?? ""), String(req.query.passe ?? ""));
      // Falha aqui nao e erro de tela: o bloco simplesmente nao aparece e o
      // cadastro segue. Por isso 200 com ok:false, e nao 4xx.
      return res.json(r);
    } catch {
      return res.json({ ok: false });
    }
  });

  const esquemaResponsavel = z.object({
    cpf: z.string().min(11).max(20),
    passe: z.string().min(10),
  });

  router.post("/api/public/cadastro/responsavel", limiteResponsavel, async (req, res) => {
    try {
      const parsed = esquemaResponsavel.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, motivo: "documento", mensagem: "Informe um CPF valido." });
      }
      const r = await buscarResponsavel(parsed.data.cpf, parsed.data.passe);
      if (!r.ok) {
        // "desligado" e "nao-encontrado" nao sao falha: a tela cai no modo
        // manual e o cadastro segue. Passe invalido volta 403 para a tela
        // mandar refazer a etapa 1.
        const status = r.motivo === "passe" ? 403 : 200;
        return res.status(status).json(r);
      }
      return res.json(r);
    } catch (error: any) {
      return res.status(500).json({ ok: false, motivo: "nao-encontrado", mensagem: getSafeErrorMessage(error) });
    }
  });

  return router;
}
