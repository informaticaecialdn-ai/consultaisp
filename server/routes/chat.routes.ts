import { Router } from "express";
import { requireAuth, requireProvider, requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";

export function registerChatRoutes(): Router {
  const router = Router();

  // ---- SUPPORT CHAT (Admin side) ----

  router.get("/api/admin/chat/threads", requireSuperAdmin, async (_req, res) => {
    try {
      const threads = await storage.getAllSupportThreads();
      return res.json(threads);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/chat/threads/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const messages = await storage.getSupportMessages(threadId);
      await storage.markMessagesRead(threadId, false);
      return res.json(messages);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/chat/threads/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem nao pode ser vazia" });
      const me = await storage.getUser(req.session.userId!);
      const msg = await storage.createSupportMessage({
        threadId, senderId: req.session.userId!, senderName: me?.name || "Admin",
        content: content.trim(), isFromAdmin: true, isRead: false,
      });
      return res.json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/chat/threads/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { status } = req.body;
      await storage.updateThreadStatus(threadId, status);
      return res.json({ message: "Status atualizado" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ---- SUPPORT CHAT (Provider side) ----

  router.get("/api/chat/thread", requireAuth, requireProvider, async (req, res) => {
    try {
      const thread = await storage.getOrCreateSupportThread(req.session.providerId!);
      const messages = await storage.getSupportMessages(thread.id);
      await storage.markMessagesRead(thread.id, true);
      return res.json({ thread, messages });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/chat/thread/messages", requireAuth, requireProvider, async (req, res) => {
    try {
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem nao pode ser vazia" });
      const me = await storage.getUser(req.session.userId!);
      const thread = await storage.getOrCreateSupportThread(req.session.providerId!);
      const msg = await storage.createSupportMessage({
        threadId: thread.id, senderId: req.session.userId!, senderName: me?.name || "Usuario",
        content: content.trim(), isFromAdmin: false, isRead: false,
      });
      return res.json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/chat/unread", requireAuth, requireProvider, async (req, res) => {
    try {
      const count = await storage.getUnreadCountForProvider(req.session.providerId!);
      return res.json({ count });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ---- VISITOR CHAT (Public) ----

  /**
   * Sem sessão, sem `provider_id` na linha (`visitorChatMessages` não tem essa
   * coluna) e sem varredura de limpeza que alcance esta tabela — revisão final
   * de segurança antes da demonstração pública (item 5). Sem limite, qualquer
   * IP grava mensagens sem parar; o corpo já tem teto de 10 MB no parser
   * global (`server/index.ts`), mas isso ainda é generoso demais por MENSAGEM
   * — daí o teto de tamanho logo abaixo, além do limite de taxa.
   *
   * O MESMO limitador guarda `/start` (logo abaixo): `/start` não grava
   * mensagem nenhuma, mas cada token que ele emite dá direito a 20 mensagens
   * POR MINUTO — cada uma com resposta automática via IA (OpenAI). Sem
   * limite ali, um IP mintava tokens sem parar e cada um abria sua própria
   * cota de 20 mensagens/min de custo de IA; é por isso que as duas rotas
   * dividem o MESMO balde (a mesma instância), não um balde equivalente cada
   * uma — o custo de IA por origem é um teto só, não a soma de dois.
   */
  const limiteMensagemVisitante = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });
  const TAMANHO_MAXIMO_MENSAGEM_VISITANTE = 4_000;
  /**
   * Tetos de tamanho para `/start` (item 7 menor da rodada seguinte): `name`,
   * `email` e `phone` nao tinham NENHUM teto — string arbitraria ate o limite
   * global de 10 MB do parser JSON, gravada numa tabela (`visitor_chats`) sem
   * coluna varchar nem varredura de limpeza que a alcance. O que falta aqui e
   * TAMANHO, nao formato — a validacao de e-mail continua tao simples quanto
   * era (`!email`, presenca), no mesmo espirito do teto de `/messages` acima.
   */
  const TAMANHO_MAXIMO_NOME_VISITANTE = 200;
  const TAMANHO_MAXIMO_EMAIL_VISITANTE = 254; // limite pratico de um endereco de e-mail inteiro (RFC 5321 §4.5.3.1.3)
  const TAMANHO_MAXIMO_TELEFONE_VISITANTE = 40;

  router.post("/api/public/visitor-chat/start", limiteMensagemVisitante, async (req, res) => {
    try {
      const { name, email, phone } = req.body;
      // Revisao de seguranca 4 (item 4 do pedido): so `phone` checava `typeof`
      // antes desta linha. `{"name": 12345}` passa por `!name` (numero e
      // truthy), e `(12345).length` e `undefined` — `undefined > 200` e
      // `false`, entao o teto de tamanho abaixo nunca disparava e o numero
      // cru chegava em `storage.createVisitorChat`. Mesma guarda nos tres
      // campos agora: sem ser string, recusa aqui, antes de qualquer `.length`.
      if (typeof name !== "string" || typeof email !== "string" || !name || !email) {
        return res.status(400).json({ message: "Nome e email sao obrigatorios" });
      }
      if (name.length > TAMANHO_MAXIMO_NOME_VISITANTE) {
        return res.status(400).json({ message: `Nome muito longo (maximo ${TAMANHO_MAXIMO_NOME_VISITANTE} caracteres)` });
      }
      if (email.length > TAMANHO_MAXIMO_EMAIL_VISITANTE) {
        return res.status(400).json({ message: `Email muito longo (maximo ${TAMANHO_MAXIMO_EMAIL_VISITANTE} caracteres)` });
      }
      if (typeof phone === "string" && phone.length > TAMANHO_MAXIMO_TELEFONE_VISITANTE) {
        return res.status(400).json({ message: `Telefone muito longo (maximo ${TAMANHO_MAXIMO_TELEFONE_VISITANTE} caracteres)` });
      }
      const chat = await storage.createVisitorChat(name, email, phone || null);
      return res.status(201).json({ token: chat.token, chatId: chat.id });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/public/visitor-chat/messages", async (req, res) => {
    try {
      const token = req.headers["x-visitor-token"] as string;
      if (!token) return res.status(401).json({ message: "Token necessario" });
      const chat = await storage.getVisitorChatByToken(token);
      if (!chat) return res.status(404).json({ message: "Chat nao encontrado" });
      await storage.markVisitorMessagesRead(chat.id, true);
      const messages = await storage.getVisitorChatMessages(chat.id);
      return res.json({ chat, messages });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/public/visitor-chat/messages", limiteMensagemVisitante, async (req, res) => {
    try {
      const token = req.headers["x-visitor-token"] as string;
      if (!token) return res.status(401).json({ message: "Token necessario" });
      const chat = await storage.getVisitorChatByToken(token);
      if (!chat) return res.status(404).json({ message: "Chat nao encontrado" });
      if (chat.status === "closed") return res.status(400).json({ message: "Chat encerrado" });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem vazia" });
      if (content.length > TAMANHO_MAXIMO_MENSAGEM_VISITANTE) {
        return res.status(400).json({ message: `Mensagem muito longa (maximo ${TAMANHO_MAXIMO_MENSAGEM_VISITANTE} caracteres)` });
      }

      // Salvar mensagem do visitante
      const msg = await storage.createVisitorChatMessage(chat.id, content.trim(), false, chat.visitorName);

      // Gerar resposta automatica via IA (fire-and-forget pra nao bloquear o response)
      (async () => {
        try {
          const { generateChatResponse } = await import("../services/chat-agent");
          // Buscar historico do chat pra contexto
          const allMessages = await storage.getVisitorChatMessages(chat.id);
          const history = allMessages.map((m: any) => ({
            role: (m.isFromAdmin ? "assistant" : "user") as "user" | "assistant",
            content: m.content,
          }));
          const aiResponse = await generateChatResponse(content.trim(), history.slice(0, -1));
          // Salvar resposta da IA como mensagem do admin
          await storage.createVisitorChatMessage(chat.id, aiResponse, true, "Consulta ISP");
        } catch (err: any) {
          console.warn(`[ChatAgent] Erro ao gerar resposta: ${err.message}`);
        }
      })();

      return res.status(201).json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/public/visitor-chat/unread", async (req, res) => {
    try {
      const token = req.headers["x-visitor-token"] as string;
      if (!token) return res.json({ count: 0 });
      const chat = await storage.getVisitorChatByToken(token);
      if (!chat) return res.json({ count: 0 });
      const cnt = await storage.getVisitorUnreadCount(chat.id);
      return res.json({ count: cnt });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ---- VISITOR CHAT (Admin) ----

  router.get("/api/admin/visitor-chats", requireSuperAdmin, async (_req, res) => {
    try {
      const chats = await storage.getAllVisitorChats();
      return res.json(chats);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/visitor-chats/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const chatId = parseInt(req.params.id);
      await storage.markVisitorMessagesRead(chatId, false);
      const messages = await storage.getVisitorChatMessages(chatId);
      return res.json(messages);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/visitor-chats/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem vazia" });
      const user = req.user as any;
      const msg = await storage.createVisitorChatMessage(chatId, content.trim(), true, user.name || "Atendente");
      return res.status(201).json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/visitor-chats/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const { status } = req.body;
      await storage.updateVisitorChatStatus(chatId, status);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
