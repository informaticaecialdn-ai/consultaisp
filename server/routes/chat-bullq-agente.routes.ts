/**
 * As rotas que o AGENTE DE IA do Chat BullQ chama (skills HTTP) e o webhook
 * que o Chat BullQ manda de volta (automacao call_webhook).
 *
 * Nao ha sessao aqui: quem chama e uma maquina. As skills se identificam
 * pela chave do provedor (`x-chave-agente`, SHA-256 guardado); o webhook
 * pela assinatura HMAC-SHA256 do corpo com o segredo do provedor
 * (`X-Signature-256`), como o Asaas faz com o token. Nenhuma das duas
 * revela telefone em log.
 *
 * Status: as skills respondem 200 mesmo quando "nao encontrado" — no Chat
 * BullQ, >= 400 vira alerta para a organizacao inteira. 401 so para chave
 * ausente/invalida, que e mesmo um erro de configuracao.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { storage } from "../storage";
import { casoParaAgente, provedorDaChave, registrarPromessaDoAgente, registrarTransferenciaDoAgente } from "../services/chat/chat-agente.service";
import { receberRespostaDoCliente } from "../services/chat/chat-atendimento.service";
import { receberMensagemAutonoma } from "../services/chat/chat-autonomia.service";
import { autonomiaStorage } from "../storage/chat-autonomia.storage";
import { comTravaDoChat } from "../services/chat/chat-trava";

interface ReqDoAgente extends Request { agente?: { providerId: number; organizationId: string } }

async function exigirChaveDoAgente(req: ReqDoAgente, res: Response, next: NextFunction) {
  const chave = req.header("x-chave-agente");
  const quem = await provedorDaChave(chave);
  if (!quem) return res.status(401).json({ ok: false, message: "Chave do agente ausente ou invalida" });
  req.agente = quem;
  next();
}

const TelefoneSchema = z.string().trim().min(8).max(20);

const PromessaSchema = z.object({
  telefone: TelefoneSchema,
  dataPrometida: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD"),
  valor: z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d{1,2})?$/)]).optional().nullable(),
  observacao: z.string().trim().max(500).optional().nullable(),
  conversaId: z.string().trim().max(120).optional().nullable(),
});

const TransferenciaSchema = z.object({
  telefone: TelefoneSchema,
  motivo: z.string().trim().max(500).optional().nullable(),
  resumo: z.string().trim().max(1000).optional().nullable(),
  conversaId: z.string().trim().max(120).optional().nullable(),
});

const WebhookSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1).optional().nullable(),
  contactId: z.string().optional().nullable(),
  trigger: z.record(z.unknown()).optional().nullable(),
  sentAt: z.string().optional().nullable(),
});

/**
 * Quem vai responder a mensagem que o cliente acabou de mandar.
 *
 * `receberMensagemAutonoma` devolve `false` SO quando a autonomia esta
 * desligada — devolve `true` tambem em tres casos em que nao enfileira nada:
 * conversa sem vinculo, conversa em OPEN/PENDING/CLOSED e estado ja entregue
 * ao humano. Confiar nesse `true` fazia a mensagem do cliente SUMIR: numa
 * conversa CLOSED ninguem enfileirava, e o caminho humano — que reabre em
 * PENDING, grava o evento na linha do tempo e devolve o caso a fila — nao
 * rodava. O cliente respondia e ninguem atendia.
 *
 * Enquanto o contrato do servico for booleano, a decisao e lida AQUI, antes
 * de chamar: a fila autonoma recebe so o que ela vai mesmo responder, e todo
 * o resto vai para o atendimento humano. O lugar certo desta leitura e o
 * proprio `receberMensagemAutonoma`, devolvendo `{ assumida }`.
 *
 * Falha de leitura da autonomia nao decide nada sozinha: sem saber se o
 * assistente responde, a mensagem vai para o humano — a fila autonoma so
 * recebe o que foi lido, nunca o que foi suposto.
 */
async function quemRespondeAMensagem(providerId: number, conversationId: string): Promise<"autonomia" | "humano" | "ninguem"> {
  // Conversa que este modulo nao acompanha: nao ha caso, fila nem historico a
  // reabrir. O caminho humano recusaria com CASO_NAO_ENCONTRADO, e um >= 400
  // aqui viraria alerta para a organizacao inteira no Chat BullQ.
  const vinculo = await storage.getConversaDoChat(providerId, conversationId);
  if (!vinculo) return "ninguem";
  try {
    if (!(await autonomiaStorage.config(providerId)).ativa) return "humano";
    // Em atendimento humano, na fila dele, ou encerrada: a IA nao responde.
    if (["OPEN", "PENDING", "CLOSED"].includes(vinculo.status)) return "humano";
    if ((await autonomiaStorage.estado(providerId, conversationId)).humano) return "humano";
    return "autonomia";
  } catch (e) {
    logger.warn({ err: e, providerId }, "Webhook do chat: estado da autonomia nao lido; a mensagem segue para o atendimento humano");
    return "humano";
  }
}

export function registerChatBullqAgenteRoutes(): Router {
  const router = Router();

  router.get("/api/chat-bullq/agente/caso", exigirChaveDoAgente, async (req: ReqDoAgente, res) => {
    const telefone = typeof req.query.telefone === "string" ? req.query.telefone : "";
    try {
      res.json(await casoParaAgente(req.agente!.providerId, telefone));
    } catch (e) {
      logger.error({ err: e, providerId: req.agente?.providerId }, "Agente do chat: falha ao ler o caso");
      // 200 de proposito: o agente recebe uma instrucao, nao um alerta para a org inteira.
      res.json({ ok: false, encontrado: false, instrucao: "O sistema de cobranca nao respondeu agora. Nao cite valores; diga que vai verificar e transfira ao atendente." });
    }
  });

  router.post("/api/chat-bullq/agente/promessa", exigirChaveDoAgente, async (req: ReqDoAgente, res) => {
    const parsed = PromessaSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.json({ ok: false, encontrado: false, mensagem: `Dados invalidos: ${parsed.error.issues.map(i => i.message).join("; ")}` });
    const d = parsed.data;
    const valor = d.valor === undefined || d.valor === null ? null : typeof d.valor === "number" ? d.valor : Number(String(d.valor).replace(",", "."));
    try {
      const integracao = await storage.getIntegracaoDoChatPorOrganizacao(req.agente!.organizationId);
      if ((integracao?.agenteConfig as Record<string, unknown> | null)?.modoAtendimento === "primeira_resposta_humana") {
        return res.json({ ok: false, encontrado: false, mensagem: "Neste modo, o atendente confirma e registra a negociação. Transfira a conversa ao humano." });
      }
      res.json(await registrarPromessaDoAgente(req.agente!.providerId, { telefone: d.telefone, dataPrometida: d.dataPrometida, valor, observacao: d.observacao ?? null, conversaId: d.conversaId ?? null }));
    } catch (e) {
      logger.error({ err: e, providerId: req.agente?.providerId }, "Agente do chat: falha ao registrar promessa");
      res.json({ ok: false, encontrado: false, mensagem: "O sistema de cobranca nao gravou a promessa agora. Diga ao cliente que o atendente confirma." });
    }
  });

  router.post("/api/chat-bullq/agente/transferencia", exigirChaveDoAgente, async (req: ReqDoAgente, res) => {
    const parsed = TransferenciaSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.json({ ok: false, encontrado: false, mensagem: "Dados invalidos" });
    const d = parsed.data;
    try {
      res.json(await registrarTransferenciaDoAgente(req.agente!.providerId, { telefone: d.telefone, motivo: d.motivo ?? null, resumo: d.resumo ?? null, conversaId: d.conversaId ?? null }));
    } catch (e) {
      logger.error({ err: e, providerId: req.agente?.providerId }, "Agente do chat: falha ao registrar transferencia");
      res.json({ ok: false, encontrado: false, mensagem: "Nao foi possivel registrar no caso agora." });
    }
  });

  /**
   * O caminho de volta: o Chat BullQ avisa (automacao call_webhook) que a
   * conversa mudou de status (IA transferiu → PENDING) ou foi assumida.
   * Assinatura: X-Signature-256 = HMAC-SHA256(segredo do provedor, corpo cru).
   * O corpo cru vem do `express.json({ verify })` que guarda `rawBody`; sem
   * ele, a assinatura e conferida sobre o JSON re-serializado (mesmo texto
   * quando o remetente e o nosso fork, que serializa com JSON.stringify).
   */
  router.post("/api/webhooks/chat-bullq", async (req, res) => {
    const parsed = WebhookSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Corpo invalido" });
    const corpo = parsed.data;
    const assinatura = (req.header("x-signature-256") ?? "").trim().toLowerCase();
    // O provedor dono da organizacao — pelo id da org, nunca por algo que o corpo diga sobre o provedor.
    const intg = await storage.getIntegracaoDoChatPorOrganizacao(corpo.organizationId).catch(() => undefined);
    if (!intg?.webhookSecret) return res.status(404).json({ message: "Organizacao desconhecida" });
    // server/index.ts guarda o corpo cru em `req.rawBody` (Buffer) no express.json({ verify }).
    const cru = (req as Request & { rawBody?: unknown }).rawBody;
    const bruto: string = Buffer.isBuffer(cru) ? cru.toString("utf8") : typeof cru === "string" ? cru : JSON.stringify(req.body);
    const esperada = createHmac("sha256", intg.webhookSecret).update(bruto, "utf8").digest("hex");
    const a = Buffer.from(assinatura, "utf8");
    const b = Buffer.from(esperada, "utf8");
    if (!assinatura || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ message: "Assinatura invalida" });

    const trigger = (corpo.trigger ?? {}) as Record<string, unknown>;
    const toStatus = typeof trigger.toStatus === "string" ? trigger.toStatus : null;
    const assignedToId = typeof trigger.toAssigneeId === "string" ? trigger.toAssigneeId : typeof trigger.assignedToId === "string" ? trigger.assignedToId : null;
    if (!corpo.conversationId) return res.json({ ok: true, ignorado: "sem conversa" });

    try {
      if (trigger.isFromCustomer === true && typeof trigger.messageId === "string") {
        if (!trigger.messageId.trim() || trigger.messageId.length > 160) return res.status(400).json({ message: "Mensagem inválida" });
        const quem = await quemRespondeAMensagem(intg.providerId, corpo.conversationId);
        if (quem === "ninguem") {
          logger.warn({ providerId: intg.providerId, conversationId: corpo.conversationId }, "Webhook do chat: mensagem de cliente em conversa sem vinculo neste provedor");
          return res.json({ ok: true, ignorado: "conversa sem vinculo" });
        }
        // Se a autonomia foi desligada entre a leitura e a chamada, o `false`
        // devolve a mensagem ao caminho humano em vez de deixa-la sem ninguem.
        if (quem === "autonomia" && await receberMensagemAutonoma(intg.providerId, corpo.conversationId, trigger.messageId))
          return res.json({ ok: true });
        await receberRespostaDoCliente(intg.providerId, corpo.conversationId);
        return res.json({ ok: true });
      }
      if (toStatus === "OPEN" || toStatus === "CLOSED" || toStatus === "PENDING") {
        const bloqueado = await comTravaDoChat(`autonomia:${intg.providerId}:${corpo.conversationId}`, async () => {
          if (await storage.getConversaDoChat(intg.providerId, corpo.conversationId!))
            await autonomiaStorage.cancelar(intg.providerId, corpo.conversationId!, "Conversa transferida, assumida ou encerrada no chat");
          return true;
        });
        if (!bloqueado) return res.status(503).json({ message: "Rodada em andamento; repetir evento de status" });
      }
      // Todas as mensagens da ponte usam a conta técnica do owner no BullQ.
      // Atribuição a essa conta não prova que um operador assumiu o caso.
      const modo = (intg.agenteConfig as Record<string, unknown> | null)?.modoAtendimento;
      if (modo === "primeira_resposta_humana" && (assignedToId || toStatus === "OPEN" || toStatus === "BOT" || toStatus === "PENDING")) return res.json({ ok: true, ignorado: "atendimento sincronizado pelo Consulta ISP" });
      if (toStatus && !["BOT", "PENDING", "OPEN", "WAITING", "CLOSED"].includes(toStatus)) return res.status(400).json({ message: "Status inválido" });
      const vinculo = await storage.atualizarConversaDoChat(intg.providerId, corpo.conversationId, { status: toStatus ?? (assignedToId ? "OPEN" : undefined) });
      if (vinculo) {
        const texto = toStatus === "PENDING"
          ? "Chat: a IA transferiu a conversa ao atendente"
          : assignedToId
            ? "Chat: um atendente assumiu a conversa"
            : toStatus === "CLOSED"
              ? "Chat: conversa encerrada"
              : toStatus
                ? `Chat: conversa em ${toStatus.toLowerCase()}`
                : "Chat: conversa atualizada";
        await storage.registrarEventoDoChat(intg.providerId, vinculo, null, texto);
      }
      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e, providerId: intg.providerId }, "Webhook do chat: falha ao registrar");
      res.status(500).json({ message: "Erro ao registrar" });
    }
  });

  return router;
}
