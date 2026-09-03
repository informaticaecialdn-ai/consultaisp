import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  type User, type InsertUser,
} from "@shared/schema";

export class UsersStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return undefined;
    const allUsers = await db.select().from(users);
    return allUsers.find(u => u.phone && u.phone.replace(/\D/g, "") === digits);
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.verificationToken, token));
    return user;
  }

  async setEmailVerified(userId: number): Promise<void> {
    await db.update(users)
      .set({ emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null })
      .where(eq(users.id, userId));
  }

  async setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await db.update(users)
      .set({ verificationToken: token, verificationTokenExpiresAt: expiresAt })
      .where(eq(users.id, userId));
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getUsersByProvider(providerId: number): Promise<User[]> {
    return db.select().from(users).where(eq(users.providerId, providerId));
  }

  /**
   * Apaga o usuario E as sessoes abertas dele, na mesma transacao.
   *
   * A tela promete que "o acesso e perdido na hora" e isso era falso:
   * `requireAuth` so olha `req.session`, e a linha da sessao vive na tabela do
   * connect-pg-simple, que ninguem tocava. O excluido continuava navegando e
   * consultando ate o cookie vencer — 48h depois.
   *
   * SQL cru aqui e deliberado e e a excecao a regra do projeto: a tabela
   * `session` e criada e mantida pelo connect-pg-simple (ver server/auth.ts),
   * nao esta em shared/schema.ts e por isso nao existe tabela Drizzle para
   * consultar. O id vai como parametro, nunca interpolado.
   *
   * Nao trata a violacao de chave estrangeira: quem chama e que sabe o que
   * responder — ver DELETE /api/provider/users/:id.
   */
  async deleteUser(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, id));
      // `->>` devolve texto e funciona tanto em `json` quanto em `jsonb`, que e
      // o que muda entre bancos criados por versoes diferentes do store.
      await tx.execute(sql`DELETE FROM "session" WHERE sess ->> 'userId' = ${String(id)}`);
    });
  }

  async updateUserEmail(id: number, email: string): Promise<void> {
    await db.update(users).set({ email }).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }
}
