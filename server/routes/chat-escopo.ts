import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { logger } from "../logger";
import { carteiraDoStatusErp } from "../storage/cobranca.storage";

/** Valida o escopo antes de ler dados ou executar qualquer ação. */
export async function exigirEscopoDoChat(req: Request, res: Response, next: NextFunction) {
  const escopo = z.object({ origem: z.enum(["cobranca", "equipamentos"]).optional(), carteira: z.enum(["ativo", "ex_cliente"]).optional() }).safeParse(req.query);
  if (!escopo.success) return res.status(400).json({ message: "Escopo de atendimento inválido" });
  const { origem, carteira } = escopo.data;
  if (!origem && !carteira) return next();
  try {
    const providerId = req.session.providerId as number;
    const conversaId = req.params.conversaId ?? req.params.conversationId;
    const vinculo = conversaId ? await storage.getConversaDoChat(providerId, String(conversaId)) : null;
    const casoId = vinculo?.casoId ?? (!conversaId ? Number(req.params.id) || null : null);
    const caso = casoId ? await storage.obterCasoDeCobranca(providerId, casoId) : null;
    const cliente = carteira && vinculo && !caso ? await storage.clienteDoAtendimento(providerId, vinculo.customerId) : null;
    const carteiraAtual = caso?.carteira ?? (cliente ? carteiraDoStatusErp(cliente.statusContrato) : null);
    if ((conversaId && (!vinculo || (origem === "cobranca" && !vinculo.casoId && vinculo.origem !== "cobranca") || (origem === "equipamentos" && !vinculo.recuperacaoId))) || (carteira && carteiraAtual !== carteira)) {
      return res.status(404).json({ message: "Atendimento não encontrado nesta carteira", codigo: "ESCOPO_DIVERGENTE" });
    }
    next();
  } catch (e) {
    logger.error({ err: e }, "Falha ao validar escopo do chat");
    res.status(500).json({ message: "Não foi possível validar a carteira do atendimento" });
  }
}

