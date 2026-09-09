import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { FaturasStorage } from "../storage/faturas.storage";
import { podeAdministrarOProvedor } from "./provider.routes";
import { logger } from "../logger";

const faturas = new FaturasStorage();
const Id = z.coerce.number().int().positive().safe();
const Confirmacao = z.object({
  referencia: z.string().trim().min(3).max(200),
  pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => {
    const data = new Date(`${d}T00:00:00Z`);
    return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === d;
  }),
  valorPago: z.number().finite().positive().max(9999999999.99).refine(v => Math.abs(Math.round(v * 100) - v * 100) < 0.0001),
}).strict();

const CONFLITOS = new Set([
  "Recebimento não pode ter data futura",
  "Fatura não encontrada neste cliente e provedor",
  "A quitação exige o valor integral; registre pagamentos parciais no acordo",
  "Esta fatura já tem outra confirmação de recebimento",
  "Esta fatura já está paga; confira o registro existente",
  "Operador não pertence ao provedor",
  "Cliente com acordo: confirme o recebimento pelas parcelas ou concilie a origem para evitar duplicidade",
  "Cliente tem recebimento em acordo; concilie a origem antes de confirmar a mesma dívida novamente",
  "Esta fatura não permite confirmação de recebimento",
  "Esta referência de recebimento já foi usada",
]);

/** A origem e o provedor vêm do servidor. O comprovante foi conferido pelo administrador. */
export function registerCobrancaRecebimentosRoutes(): Router {
  const router = Router();
  router.get("/api/cobranca/clientes/:id/pagamentos", requireAuth, requireProvider, async (req, res) => {
    const escopo = z.enum(["ativo", "ex_cliente"]).optional().safeParse(req.query.carteira);
    if (!escopo.success) return res.status(400).json({ message: "Carteira inválida" });
    const id = Id.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Cliente inválido" });
    const providerId = req.session.providerId!;
    try {
      if (!await faturas.clienteExiste(providerId, id.data, escopo.data)) return res.status(404).json({ message: "Cliente não encontrado" });
      const [titulos, historico, quitacoes] = await Promise.all([
        faturas.faturasDoCliente(providerId, id.data),
        faturas.historicoDePagamentosDoCliente(providerId, id.data),
        faturas.listarQuitacoesDoCliente(providerId, id.data),
      ]);
      return res.json({ faturas: titulos, historico, quitacoes });
    } catch {
      logger.error({ providerId, customerId: id.data }, "Falha ao consultar recebimentos da cobrança");
      return res.status(500).json({ message: "Não foi possível consultar os recebimentos" });
    }
  });

  router.post("/api/cobranca/faturas/:id/confirmar-quitacao", requireAuth, requireProvider, async (req, res) => {
    const escopo = z.enum(["ativo", "ex_cliente"]).optional().safeParse(req.query.carteira);
    if (!escopo.success) return res.status(400).json({ message: "Carteira inválida" });
    if (!podeAdministrarOProvedor(req.session)) return res.status(403).json({ message: "Somente o administrador pode confirmar um recebimento" });
    const id = Id.safeParse(req.params.id);
    const corpo = Confirmacao.safeParse(req.body);
    if (!id.success || !corpo.success) return res.status(400).json({ message: "Informe fatura, valor, data válida e referência do comprovante" });
    const providerId = req.session.providerId!;
    try {
      const customerId = await faturas.clienteDaFatura(providerId, id.data);
      if (customerId === null) return res.status(404).json({ message: "Fatura não encontrada" });
      if (escopo.data && !await faturas.clienteExiste(providerId, customerId, escopo.data)) return res.status(404).json({ message: "Fatura não encontrada" });
      const resultado = await faturas.registrarQuitacaoConfirmada(providerId, customerId, {
        ...corpo.data, faturaId: id.data, origem: "comprovante_conferido", userId: req.session.userId!,
      }, req.session.role === "superadmin" && req.session.suporte?.providerId === providerId ? { suporteProviderId: providerId } : undefined);
      return res.json(resultado);
    } catch (erro) {
      if (erro instanceof Error && erro.message === "A confirmação exige administrador atual do provedor ou suporte autorizado") return res.status(403).json({ message: erro.message });
      if (erro instanceof Error && CONFLITOS.has(erro.message)) return res.status(409).json({ message: erro.message });
      logger.error({ providerId, faturaId: id.data }, "Falha ao confirmar recebimento da cobrança");
      return res.status(500).json({ message: "Não foi possível confirmar o recebimento. Confira a fatura antes de tentar novamente." });
    }
  });
  return router;
}
