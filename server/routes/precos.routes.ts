import { Router } from "express";
import { requireAuth } from "../auth";
import { getSafeErrorMessage } from "../utils/safe-error";
import { precosDaMarca } from "../services/precos.service";
import { resolverMarcaPorHost } from "../services/marca.service";

export function registerPrecosRoutes(): Router {
  const router = Router();

  /**
   * A tabela de preco de quem esta logado.
   *
   * `requireAuth` e nao `requireSuperAdmin`: o superadmin tambem consome esta
   * rota (fatura manual em /admin/financeiro, pedido manual em /admin/creditos),
   * e ele nao tem providerId.
   *
   * A marca sai da SESSAO, gravada no login. Nao aceitamos marcaId por query:
   * seria o provedor escolhendo por qual tabela quer ser cobrado.
   */
  router.get("/api/credits/packages", requireAuth, async (req, res) => {
    try {
      const tabela = await precosDaMarca(req.session.marcaId ?? null);
      return res.json(tabela);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * A mesma tabela para quem ainda nao tem sessao: landing e cadastro.
   *
   * A marca vem do HOST, pelo mesmo resolvedor da pele — no dominio proprio do
   * revendedor a vitrine tem que anunciar o preco DELE. Host desconhecido
   * resolve para a plataforma.
   */
  router.get("/api/public/precos", async (req, res) => {
    try {
      const marca = await resolverMarcaPorHost(req.hostname);
      const tabela = await precosDaMarca(marca.marcaId);
      return res.json(tabela);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
