import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  bigdataIntegrations, bigdataConsultations, providers,
  type BigdataIntegration, type BigdataConsultation, type InsertBigdataConsultation,
} from "@shared/schema";
import { encryptField, decryptField } from "../utils/crypto";

/** Campos cifrados em repouso, mesmo padrao de erp.storage.ts. */
const SENSIVEIS = ["login", "password"] as const;

function cifrar<T extends Record<string, any>>(data: T): T {
  const out: any = { ...data };
  for (const f of SENSIVEIS) if (out[f]) out[f] = encryptField(out[f]);
  return out;
}

function decifrar(row: BigdataIntegration): BigdataIntegration {
  const out: any = { ...row };
  for (const f of SENSIVEIS) if (out[f]) out[f] = decryptField(out[f]);
  return out;
}

export class BigdataStorage {
  /**
   * Credencial em claro — uso interno do servico apenas.
   * A rota NUNCA devolve isso ao navegador: a senha nao sai do servidor.
   */
  async getIntegration(providerId: number): Promise<BigdataIntegration | undefined> {
    const [row] = await db.select().from(bigdataIntegrations)
      .where(eq(bigdataIntegrations.providerId, providerId)).limit(1);
    return row ? decifrar(row) : undefined;
  }

  async upsertIntegration(
    providerId: number,
    data: Partial<Pick<BigdataIntegration, "login" | "password" | "isEnabled" | "lastCheckAt" | "lastCheckStatus">>,
  ): Promise<BigdataIntegration> {
    const existente = await db.select().from(bigdataIntegrations)
      .where(eq(bigdataIntegrations.providerId, providerId)).limit(1);

    const valores = cifrar(data);

    if (existente.length > 0) {
      const [upd] = await db.update(bigdataIntegrations)
        .set(valores)
        .where(eq(bigdataIntegrations.providerId, providerId))
        .returning();
      return decifrar(upd);
    }
    const [novo] = await db.insert(bigdataIntegrations)
      .values({ providerId, ...valores } as any)
      .returning();
    return decifrar(novo);
  }

  async createConsultation(data: InsertBigdataConsultation): Promise<BigdataConsultation> {
    const [c] = await db.insert(bigdataConsultations).values(data).returning();
    return c;
  }

  async getConsultations(providerId: number, limite = 50): Promise<BigdataConsultation[]> {
    return db.select().from(bigdataConsultations)
      .where(eq(bigdataConsultations.providerId, providerId))
      .orderBy(desc(bigdataConsultations.createdAt))
      .limit(limite);
  }

  /**
   * Debito atomico: o WHERE exige saldo suficiente, entao duas consultas
   * simultaneas nao conseguem gastar o mesmo credito. Ler-depois-gravar
   * deixaria essa brecha aberta.
   *
   * `quantidade` vem do nivel escolhido — a Premium custa 17 creditos, e o
   * WHERE precisa exigir os 17, nao apenas saldo > 0. Sem isso um provedor com
   * 3 creditos rodaria uma Premium e ficaria com saldo negativo.
   */
  async debitarCredito(providerId: number, quantidade = 1): Promise<boolean> {
    const n = Math.max(1, Math.trunc(quantidade));
    const linhas = await db.update(providers)
      .set({ bigdataCredits: sql`${providers.bigdataCredits} - ${n}` })
      .where(and(eq(providers.id, providerId), sql`${providers.bigdataCredits} >= ${n}`))
      .returning({ id: providers.id });
    return linhas.length > 0;
  }

  /** Devolve os creditos quando a consulta falha por culpa nossa ou do bureau. */
  async estornarCredito(providerId: number, quantidade = 1): Promise<void> {
    const n = Math.max(1, Math.trunc(quantidade));
    await db.update(providers)
      .set({ bigdataCredits: sql`${providers.bigdataCredits} + ${n}` })
      .where(eq(providers.id, providerId));
  }
}
