import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db";
import {
  providers, supportThreads, supportMessages,
  visitorChats, visitorChatMessages,
  type SupportThread, type InsertSupportMessage, type SupportMessage,
  type VisitorChat, type VisitorChatMessage,
} from "@shared/schema";

export class ChatStorage {
  async getOrCreateSupportThread(providerId: number): Promise<SupportThread> {
    const [existing] = await db.select().from(supportThreads).where(eq(supportThreads.providerId, providerId));
    if (existing) return existing;
    const [created] = await db.insert(supportThreads).values({ providerId, subject: "Suporte Geral", status: "open" }).returning();
    return created;
  }

  async getAllSupportThreads(): Promise<(SupportThread & { providerName: string; unreadCount: number; lastMessage: string | null; lastMessageFrom: string | null })[]> {
    const threads = await db.select().from(supportThreads).orderBy(desc(supportThreads.lastMessageAt));
    const result = await Promise.all(threads.map(async (thread) => {
      const [provider] = await db.select({ name: providers.name }).from(providers).where(eq(providers.id, thread.providerId));
      const [{ count: unread }] = await db.select({ count: count() }).from(supportMessages)
        .where(and(eq(supportMessages.threadId, thread.id), eq(supportMessages.isFromAdmin, false), eq(supportMessages.isRead, false)));
      const [lastMsg] = await db.select({ content: supportMessages.content, isFromAdmin: supportMessages.isFromAdmin })
        .from(supportMessages).where(eq(supportMessages.threadId, thread.id))
        .orderBy(desc(supportMessages.createdAt)).limit(1);
      return {
        ...thread,
        providerName: provider?.name || "Desconhecido",
        unreadCount: Number(unread),
        lastMessage: lastMsg?.content || null,
        lastMessageFrom: lastMsg ? (lastMsg.isFromAdmin ? "admin" : "provider") : null,
      };
    }));
    return result;
  }

  async getSupportMessages(threadId: number): Promise<SupportMessage[]> {
    return db.select().from(supportMessages).where(eq(supportMessages.threadId, threadId)).orderBy(supportMessages.createdAt);
  }

  async createSupportMessage(msg: InsertSupportMessage): Promise<SupportMessage> {
    const [created] = await db.insert(supportMessages).values(msg).returning();
    await db.update(supportThreads).set({ lastMessageAt: new Date() }).where(eq(supportThreads.id, msg.threadId));
    return created;
  }

  async markMessagesRead(threadId: number, isFromAdmin: boolean): Promise<void> {
    await db.update(supportMessages)
      .set({ isRead: true })
      .where(and(eq(supportMessages.threadId, threadId), eq(supportMessages.isFromAdmin, isFromAdmin)));
  }

  async updateThreadStatus(threadId: number, status: string): Promise<void> {
    await db.update(supportThreads).set({ status }).where(eq(supportThreads.id, threadId));
  }

  async getUnreadCountForProvider(providerId: number): Promise<number> {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.providerId, providerId));
    if (!thread) return 0;
    const [{ count: unread }] = await db.select({ count: count() }).from(supportMessages)
      .where(and(eq(supportMessages.threadId, thread.id), eq(supportMessages.isFromAdmin, true), eq(supportMessages.isRead, false)));
    return Number(unread);
  }

  async createVisitorChat(name: string, email: string, phone: string | null): Promise<VisitorChat> {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const [chat] = await db.insert(visitorChats).values({ visitorName: name, visitorEmail: email, visitorPhone: phone, token }).returning();
    return chat;
  }

  async getVisitorChatByToken(token: string): Promise<VisitorChat | undefined> {
    const [chat] = await db.select().from(visitorChats).where(eq(visitorChats.token, token));
    return chat;
  }

  async getVisitorChatMessages(chatId: number): Promise<VisitorChatMessage[]> {
    return db.select().from(visitorChatMessages).where(eq(visitorChatMessages.chatId, chatId)).orderBy(visitorChatMessages.createdAt);
  }

  async createVisitorChatMessage(chatId: number, content: string, isFromAdmin: boolean, senderName: string): Promise<VisitorChatMessage> {
    const [msg] = await db.insert(visitorChatMessages).values({ chatId, content, isFromAdmin, senderName }).returning();
    await db.update(visitorChats).set({ lastMessageAt: new Date() }).where(eq(visitorChats.id, chatId));
    return msg;
  }

  async getAllVisitorChats(): Promise<(VisitorChat & { unreadCount: number; lastMessage: string | null })[]> {
    const chats = await db.select().from(visitorChats).orderBy(desc(visitorChats.lastMessageAt));
    return Promise.all(chats.map(async (chat) => {
      const [{ count: unread }] = await db.select({ count: count() }).from(visitorChatMessages)
        .where(and(eq(visitorChatMessages.chatId, chat.id), eq(visitorChatMessages.isFromAdmin, false), eq(visitorChatMessages.isRead, false)));
      const [lastMsg] = await db.select({ content: visitorChatMessages.content }).from(visitorChatMessages)
        .where(eq(visitorChatMessages.chatId, chat.id)).orderBy(desc(visitorChatMessages.createdAt)).limit(1);
      return { ...chat, unreadCount: Number(unread), lastMessage: lastMsg?.content || null };
    }));
  }

  async markVisitorMessagesRead(chatId: number, isFromAdmin: boolean): Promise<void> {
    await db.update(visitorChatMessages).set({ isRead: true })
      .where(and(eq(visitorChatMessages.chatId, chatId), eq(visitorChatMessages.isFromAdmin, isFromAdmin)));
  }

  async updateVisitorChatStatus(chatId: number, status: string): Promise<void> {
    await db.update(visitorChats).set({ status }).where(eq(visitorChats.id, chatId));
  }

  async getVisitorUnreadCount(chatId: number): Promise<number> {
    const [{ count: unread }] = await db.select({ count: count() }).from(visitorChatMessages)
      .where(and(eq(visitorChatMessages.chatId, chatId), eq(visitorChatMessages.isFromAdmin, true), eq(visitorChatMessages.isRead, false)));
    return Number(unread);
  }
}
