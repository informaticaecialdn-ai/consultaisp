import { Router } from "express";
import { requireAuth } from "../auth";
import { streamConsultationAnalysis, streamAntiFraudAnalysis } from "../services/ai-analysis";

export function registerAiRoutes(): Router {
  const router = Router();

  router.post("/api/ai/analyze-consultation", requireAuth, async (req, res) => {
    try {
      const { result } = req.body;
      if (!result) return res.status(400).json({ message: "Dados de consulta ausentes" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      await streamConsultationAnalysis(result, (text: string) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("AI consultation analysis error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message || "Erro na analise" })}\n\n`);
      res.end();
    }
  });

  router.post("/api/ai/analyze-antifraud", requireAuth, async (req, res) => {
    try {
      const { alerts, customers } = req.body;
      if (!alerts || !customers) return res.status(400).json({ message: "Dados ausentes" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      await streamAntiFraudAnalysis(alerts, customers, (text: string) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("AI antifraud analysis error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message || "Erro na analise" })}\n\n`);
      res.end();
    }
  });

  return router;
}
