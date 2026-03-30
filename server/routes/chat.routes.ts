import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../auth";
import { storage } from "../storage";

export function registerChatRoutes(): Router {
  const router = Router();

  // ---- SUPPORT CHAT (Admin side) ----

  router.get("/api/admin/chat/threads", requireSuperAdmin, async (_req, res) => {
    try {
      const threads = await storage.getAllSupportThreads();
      return res.json(threads);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/chat/threads/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const messages = await storage.getSupportMessages(threadId);
      await storage.markMessagesRead(threadId, false);
      return res.json(messages);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/admin/chat/threads/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const threadId = parseInt(req.params.id);
      const { status } = req.body;
      await storage.updateThreadStatus(threadId, status);
      return res.json({ message: "Status atualizado" });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- SUPPORT CHAT (Provider side) ----

  router.get("/api/chat/thread", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getOrCreateSupportThread(req.session.providerId!);
      const messages = await storage.getSupportMessages(thread.id);
      await storage.markMessagesRead(thread.id, true);
      return res.json({ thread, messages });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/chat/thread/messages", requireAuth, async (req, res) => {
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/chat/unread", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadCountForProvider(req.session.providerId!);
      return res.json({ count });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- VISITOR CHAT (Public) ----

  router.post("/api/public/visitor-chat/start", async (req, res) => {
    try {
      const { name, email, phone } = req.body;
      if (!name || !email) return res.status(400).json({ message: "Nome e email sao obrigatorios" });
      const chat = await storage.createVisitorChat(name, email, phone || null);
      return res.status(201).json({ token: chat.token, chatId: chat.id });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/public/visitor-chat/messages", async (req, res) => {
    try {
      const token = req.headers["x-visitor-token"] as string;
      if (!token) return res.status(401).json({ message: "Token necessario" });
      const chat = await storage.getVisitorChatByToken(token);
      if (!chat) return res.status(404).json({ message: "Chat nao encontrado" });
      if (chat.status === "closed") return res.status(400).json({ message: "Chat encerrado" });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Mensagem vazia" });
      const msg = await storage.createVisitorChatMessage(chat.id, content.trim(), false, chat.visitorName);
      return res.status(201).json(msg);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- VISITOR CHAT (Admin) ----

  router.get("/api/admin/visitor-chats", requireSuperAdmin, async (_req, res) => {
    try {
      const chats = await storage.getAllVisitorChats();
      return res.json(chats);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.get("/api/admin/visitor-chats/:id/messages", requireSuperAdmin, async (req, res) => {
    try {
      const chatId = parseInt(req.params.id);
      await storage.markVisitorMessagesRead(chatId, false);
      const messages = await storage.getVisitorChatMessages(chatId);
      return res.json(messages);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.patch("/api/admin/visitor-chats/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const { status } = req.body;
      await storage.updateVisitorChatStatus(chatId, status);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
