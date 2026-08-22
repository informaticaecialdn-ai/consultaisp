import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  equipment,
  type Equipment, type InsertEquipment,
} from "@shared/schema";

export class EquipmentStorage {
  async getEquipmentByProvider(providerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.providerId, providerId));
  }

  async getEquipmentByCustomer(customerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.customerId, customerId));
  }

  async createEquipment(eq_data: InsertEquipment): Promise<Equipment> {
    const [created] = await db.insert(equipment).values(eq_data).returning();
    return created;
  }

  /** providerId no WHERE e isolamento multi-tenant, nao conveniencia. */
  async getEquipmentById(id: number, providerId: number): Promise<Equipment | undefined> {
    const [found] = await db.select().from(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .limit(1);
    return found;
  }

  async updateEquipment(
    id: number,
    providerId: number,
    data: Partial<InsertEquipment>,
  ): Promise<Equipment | undefined> {
    const [updated] = await db.update(equipment)
      .set(data)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .returning();
    return updated;
  }

  async removeEquipment(id: number, providerId: number): Promise<boolean> {
    const removed = await db.delete(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .returning();
    return removed.length > 0;
  }
}
