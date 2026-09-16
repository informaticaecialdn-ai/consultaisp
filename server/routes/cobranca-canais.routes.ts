import { Router } from "express";
import { requireAuth, requireProvider } from "../auth";
import { podeAdministrarOProvedor } from "./provider.routes";
import { ConfiguracaoCanaisSchema } from "@shared/cobranca/canais-comunicacao";
import { ErroConfiguracaoCanais, obterConfiguracaoCanais, salvarConfiguracaoCanais } from "../services/cobranca/canais-comunicacao.service";

const router = Router();
router.use("/api/cobranca/canais", requireAuth, requireProvider);
router.get("/api/cobranca/canais", async (req, res) => {
  try { res.json(await obterConfiguracaoCanais(req.session.providerId as number)); }
  catch { res.status(503).json({ message: "Configuração dos canais indisponível." }); }
});
router.put("/api/cobranca/canais", async (req, res) => {
  if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: "Apenas administradores podem configurar os canais." });
  const parsed = ConfiguracaoCanaisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Confira os dados dos canais e o formato dos remetentes." });
  try { res.json(await salvarConfiguracaoCanais(req.session.providerId as number, parsed.data)); }
  catch (e) { res.status(e instanceof ErroConfiguracaoCanais ? 400 : 503).json({ message: e instanceof ErroConfiguracaoCanais ? e.message : "Não foi possível salvar os canais." }); }
});
export default router;
