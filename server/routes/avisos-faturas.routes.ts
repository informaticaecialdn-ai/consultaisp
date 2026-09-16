import { Router } from "express";
import { z } from "zod";
import { AvisosFaturasSchema } from "@shared/cobranca/preventivo";
import { lerAutomacaoChat, janelaDoChat } from "@shared/cobranca/automacao-chat";
import { requireAuth, requireProvider } from "../auth";
import { podeAdministrarOProvedor } from "./provider.routes";
import { CobrancaPreventivoStorage, diaDoPreAviso } from "../storage/cobranca-preventivo.storage";
import { storage } from "../storage";
import { logger } from "../logger";

const SimulacaoSchema = z.object({
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => {
    const date = new Date(`${d}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === d;
  }).optional(),
  config: AvisosFaturasSchema.optional(),
});

export function registerAvisosFaturasRoutes(): Router {
  const router = Router();
  const fila = new CobrancaPreventivoStorage();
  const configAtual = async (providerId: number) => {
    const configurada = await fila.obterConfigAvisos(providerId);
    if (configurada) return configurada;
    const integracao = await storage.getIntegracaoDoChat(providerId);
    const legado = lerAutomacaoChat((integracao?.agenteConfig as Record<string, unknown> | null)?.primeiroContato);
    return AvisosFaturasSchema.parse({ ligada: legado.ligada && legado.preventivo, limiteDiario: legado.limiteDiario });
  };
  router.get("/api/cobranca/avisos-faturas/config", requireAuth, requireProvider, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await configAtual(req.session.providerId!)); }
    catch { logger.error({ providerId: req.session.providerId }, "Falha ao ler avisos de faturas"); res.status(500).json({ message: "Não foi possível carregar os avisos" }); }
  });
  router.put("/api/cobranca/avisos-faturas/config", requireAuth, requireProvider, async (req, res) => {
    if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: "Somente administradores configuram avisos" });
    const parsed = AvisosFaturasSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Informe de 1 a 10 dias únicos entre 0 e 30, canal e limite diário entre 1 e 10.000" });
    try { res.json(await fila.salvarConfigAvisos(req.session.providerId!, parsed.data)); }
    catch { logger.error({ providerId: req.session.providerId }, "Falha ao salvar avisos de faturas"); res.status(500).json({ message: "Não foi possível salvar os avisos" }); }
  });
  router.post("/api/cobranca/avisos-faturas/simular", requireAuth, requireProvider, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = SimulacaoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Informe uma data e configuração válidas" });
    try {
      const providerId = req.session.providerId!;
      const config = parsed.data.config ?? await configAtual(providerId);
      const dia = parsed.data.dia ?? diaDoPreAviso(new Date());
      const resultado = await fila.simularAvisos(providerId, dia, config);
      const politica = await storage.getPoliticaDeCobranca(providerId);
      const janela = janelaDoChat(new Date(`${dia}T12:00:00-03:00`), politica?.janelaContato);
      res.json({ ...resultado, calendarioPermitido: janela.permitida });
    } catch { logger.error({ providerId: req.session.providerId }, "Falha ao simular avisos de faturas"); res.status(500).json({ message: "Não foi possível simular os avisos" }); }
  });
  return router;
}
