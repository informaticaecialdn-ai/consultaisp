import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  equipment,
  type Equipment, type InsertEquipment,
} from "@shared/schema";
import { decidirAcaoSync, type EquipamentoErp } from "../services/equipment-sync-rules";

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

  /**
   * Aplica o resultado do ERP sobre o equipamento de um cliente.
   * A decisao por aparelho vem de decidirAcaoSync (funcao pura, testada) —
   * aqui so executamos.
   */
  async syncEquipmentFromErp(
    providerId: number,
    customerId: number,
    detalhes: EquipamentoErp[],
  ): Promise<{ inseridos: number; devolvidos: number }> {
    if (detalhes.length === 0) return { inseridos: 0, devolvidos: 0 };

    const atuais = await db.select().from(equipment)
      .where(and(eq(equipment.providerId, providerId), eq(equipment.customerId, customerId)));

    const porSerie = new Map<string, typeof atuais[number]>();
    for (const a of atuais) {
      if (a.serialNumber) porSerie.set(a.serialNumber.trim().toLowerCase(), a);
    }

    let inseridos = 0;
    let devolvidos = 0;

    for (const d of detalhes) {
      const chave = d.serialNumber?.trim().toLowerCase() || "";
      const existente = chave ? porSerie.get(chave) : undefined;
      const acao = decidirAcaoSync(
        existente
          ? { id: existente.id, serialNumber: existente.serialNumber, status: existente.status }
          : undefined,
        d,
      );

      if (acao === "inserir") {
        await db.insert(equipment).values({
          providerId,
          customerId,
          type: d.type || "Equipamento",
          brand: d.brand || null,
          model: d.model || null,
          serialNumber: d.serialNumber,
          status: "installed",
          inRecoveryProcess: d.inRecoveryProcess,
          value: d.value || "290",
        });
        inseridos++;
      } else if (acao === "marcar-devolvido" && existente) {
        await db.update(equipment)
          .set({ status: "devolvido", inRecoveryProcess: false })
          .where(eq(equipment.id, existente.id));
        devolvidos++;
      }
    }

    return { inseridos, devolvidos };
  }

  /**
   * Contagem e valor de equipamento NAO devolvido, para N clientes numa query.
   * A consulta em rede usa isso; fazer N+1 aqui derrubaria o tempo de resposta.
   */
  async contarEquipamentoRetido(
    customerIds: number[],
  ): Promise<Map<number, { count: number; value: number }>> {
    const mapa = new Map<number, { count: number; value: number }>();
    if (customerIds.length === 0) return mapa;

    const linhas = await db.select({
      customerId: equipment.customerId,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${equipment.value}), 0)::float`,
    })
      .from(equipment)
      .where(and(
        inArray(equipment.customerId, customerIds),
        sql`lower(${equipment.status}) not in ('devolvido', 'returned', 'baixa', 'baixado')`,
      ))
      .groupBy(equipment.customerId);

    for (const l of linhas) {
      if (l.customerId != null) mapa.set(l.customerId, { count: l.count, value: l.total });
    }
    return mapa;
  }
}
