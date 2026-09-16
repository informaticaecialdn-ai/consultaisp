import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, equipment, equipmentRecoveryCases as cases, equipmentRecoveryEvents as events, users } from "@shared/schema";
import { geoPoint, orderByProximity, type FieldCase, type FieldVisit, dispatchSchema, routeSchema } from "@shared/recovery-field";
import { z } from "zod";
import { casoEstaEncerrado } from "./equipment-recovery-rules";

export class FieldError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface FieldActor { providerId: number; userId: number; manager: boolean }
const normalize = (text: string) => text.replace(/[^a-z0-9]/gi, "").toUpperCase();

export function validateVisitPhotos(photos: FieldVisit["photos"]) {
  for (const photo of photos) {
    const bytes = Buffer.from(photo.base64, "base64");
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (bytes.length > 512_000 || !({ "image/jpeg": jpeg, "image/png": png, "image/webp": webp }[photo.mime])) {
      throw new FieldError(400, "Foto inválida. Use JPEG, PNG ou WebP de até 500 KB.");
    }
  }
}
export const storedVisitSchema = z.object({ version: z.literal(1), kind: z.literal("field_visit"), requestId: z.string(), payloadHash: z.string(), visit: z.object({
  nextAction: z.string(), location: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number() }).nullable(), locationReason: z.string().optional(),
  photos: z.array(z.object({ name: z.string(), mime: z.string(), base64: z.string().default("") })),
}) });

export class RecoveryFieldService {
  async list(actor: FieldActor) {
    const rows = await db.select({
      id: cases.id, customerId: cases.customerId, equipmentId: cases.equipmentId, status: cases.status, priority: cases.priority,
      customerName: customers.name, phone: customers.phone, street: customers.address, number: customers.addressNumber, city: customers.city, neighborhood: customers.neighborhood,
      equipmentType: equipment.type, serial: equipment.serialNumber, mac: equipment.mac, assetTag: equipment.assetTag, value: equipment.value,
      lat: customers.latitude, lng: customers.longitude, geoPrecision: customers.geoPrecisao,
      assignedToUserId: cases.assignedToUserId, assignedName: users.name,
      scheduledAt: cases.scheduledAt, updatedAt: cases.updatedAt, deadlineAt: cases.deadlineAt, closedAt: cases.closedAt,
    }).from(cases)
      .innerJoin(customers, and(eq(customers.id, cases.customerId), eq(customers.providerId, actor.providerId)))
      .innerJoin(equipment, and(eq(equipment.id, cases.equipmentId), eq(equipment.providerId, actor.providerId)))
      .leftJoin(users, and(eq(users.id, cases.assignedToUserId), eq(users.providerId, actor.providerId)))
      .where(and(eq(cases.providerId, actor.providerId), actor.manager ? undefined : eq(cases.assignedToUserId, actor.userId)))
      .orderBy(desc(cases.updatedAt)).limit(2000);
    const ids = rows.map(r => r.id);
    const routeEvents = ids.length ? await db.select({ caseId: events.caseId, metadata: events.metadata }).from(events)
      .where(and(eq(events.providerId, actor.providerId), inArray(events.caseId, ids), eq(events.type, "rota_planejada"))).orderBy(desc(events.id)) : [];
    const routes = new Map<number, FieldCase["route"]>();
    for (const event of routeEvents) {
      const data = z.object({ routeId: z.string(), order: z.number() }).safeParse(event.metadata);
      if (!routes.has(event.caseId) && data.success) routes.set(event.caseId, { id: data.data.routeId, order: data.data.order });
    }
    return rows.map(({ lat, lng, street, number, ...r }): FieldCase => ({ ...r,
      address: [street, number].filter(Boolean).join(", ") || null, point: geoPoint(lat, lng),
      scheduledAt: r.scheduledAt?.toISOString() ?? null, updatedAt: (r.updatedAt ?? new Date(0)).toISOString(),
      deadlineAt: r.deadlineAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null,
      route: routes.get(r.id) ?? null,
    }));
  }

  async preview(actor: FieldActor, input: z.infer<typeof routeSchema>) {
    const list = await this.list(actor);
    const selected = input.stops.map(stop => {
      const item = list.find(c => c.id === stop.caseId);
      if (!item) throw new FieldError(404, "Um dos casos não pertence à sua fila");
      if (item.closedAt || casoEstaEncerrado(item.status) || item.status === "contestado" || new Date(item.deadlineAt) <= new Date()) throw new FieldError(409, "Retire casos encerrados, contestados ou com prazo vencido da seleção");
      if (item.updatedAt !== stop.expectedUpdatedAt) throw new FieldError(409, "A fila mudou. Atualize antes de planejar");
      return item;
    });
    return orderByProximity(input.origin, selected);
  }

  async dispatch(actor: FieldActor, input: z.infer<typeof dispatchSchema>) {
    const plan = await this.preview(actor, { origin: input.origin, stops: input.stops });
    if (plan.excluded.length) throw new FieldError(409, "Há endereços sem coordenada precisa. Retire-os da rota e revise o cadastro");
    const when = new Date(input.scheduledAt);
    if (when <= new Date()) throw new FieldError(400, "Selecione um horário futuro para a saída");
    const routeId = randomUUID();
    await db.transaction(async tx => {
      const [technician] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.assignedToUserId), eq(users.providerId, actor.providerId), inArray(users.role, ["user", "admin"]))).limit(1);
      if (!technician) throw new FieldError(400, "Responsável não pertence à equipe do provedor");
      const locked = await tx.select().from(cases).where(and(eq(cases.providerId, actor.providerId), inArray(cases.id, input.stops.map(s => s.caseId)))).orderBy(cases.id).for("update");
      if (locked.length !== input.stops.length) throw new FieldError(404, "Caso não encontrado");
      for (const c of locked) {
        if (c.closedAt || casoEstaEncerrado(c.status) || c.status === "contestado" || c.deadlineAt <= when || c.updatedAt?.toISOString() !== input.stops.find(s => s.caseId === c.id)?.expectedUpdatedAt) throw new FieldError(409, "Caso alterado ou fora do prazo. Atualize a fila e planeje novamente");
      }
      for (const stop of plan.stops) {
        const current = locked.find(c => c.id === stop.caseId)!;
        await tx.update(cases).set({ assignedToUserId: technician.id, scheduledAt: when, collectionMethod: "retirada", status: "agendado", updatedAt: new Date() }).where(and(eq(cases.id, current.id), eq(cases.providerId, actor.providerId)));
        await tx.insert(events).values({ providerId: actor.providerId, caseId: current.id, userId: actor.userId, type: "rota_planejada", fromStatus: current.status, toStatus: "agendado", notes: `Parada ${stop.order} · saída ${when.toISOString()}`, metadata: { version: 1, routeId, order: stop.order, assignedToUserId: technician.id, origin: input.origin, distanceKm: stop.distanceKm } });
      }
    });
    return { routeId, ...plan };
  }

  async visit(actor: FieldActor, caseId: number, input: FieldVisit) {
    validateVisitPhotos(input.photos);
    const occurred = new Date(input.occurredAt);
    if (occurred.getTime() > Date.now() + 60_000) throw new FieldError(400, "A visita não pode estar no futuro");
    const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return db.transaction(async tx => {
      const [current] = await tx.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.providerId, actor.providerId))).for("update");
      if (!current || (!actor.manager && current.assignedToUserId !== actor.userId)) throw new FieldError(404, "Caso não encontrado na sua fila");
      const [previous] = await tx.select({ id: events.id, metadata: events.metadata }).from(events).where(and(eq(events.providerId, actor.providerId), eq(events.caseId, caseId), eq(events.type, "visita_campo"), sql`${events.metadata}->>'requestId' = ${input.requestId}`)).limit(1);
      if (previous) {
        const saved = storedVisitSchema.parse(previous.metadata);
        if (saved.payloadHash !== payloadHash) throw new FieldError(409, "Este identificador já foi usado com outro conteúdo");
        return { eventId: previous.id, customerId: current.customerId, replayed: true };
      }
      if (current.closedAt || casoEstaEncerrado(current.status) || current.status === "contestado" || current.deadlineAt <= new Date()) throw new FieldError(409, "Caso encerrado, contestado ou fora do prazo. Solicite revisão ao gestor");
      if (current.updatedAt?.toISOString() !== input.expectedUpdatedAt) throw new FieldError(409, "O caso mudou. Atualize a fila antes de registrar a visita");
      if (occurred < current.terminationDate) throw new FieldError(400, "A visita não pode ser anterior à rescisão");
      const [asset] = await tx.select().from(equipment).where(and(eq(equipment.id, current.equipmentId), eq(equipment.providerId, actor.providerId))).for("update");
      if (!asset || asset.customerId !== current.customerId) throw new FieldError(409, "Vínculo do equipamento alterado. Solicite revisão");
      if (input.result === "recolhido") {
        const identifiers = [asset.serialNumber, asset.mac, asset.assetTag].filter((v): v is string => !!v?.trim()).map(normalize);
        if (!identifiers.length || !identifiers.includes(normalize(input.collectedIdentifier ?? ""))) throw new FieldError(400, "Confirme a série, MAC ou patrimônio do aparelho recolhido. Se o cadastro não tiver identificador, peça ao gestor para atualizá-lo");
      }
      const next = input.result === "recolhido" ? "concluido" : "nova_tentativa";
      const [created] = await tx.insert(events).values({
        providerId: actor.providerId, caseId, userId: actor.userId, type: "visita_campo", channel: "visita", result: input.result,
        notes: input.notes, fromStatus: current.status, toStatus: next, occurredAt: occurred,
        metadata: { version: 1, kind: "field_visit", requestId: input.requestId, payloadHash, visit: input },
      }).returning({ id: events.id });
      await tx.update(cases).set({ status: next, scheduledAt: null, updatedAt: new Date(),
        ...(next === "concluido" ? { closedAt: new Date(), bureauStatus: "resolvido" } : {}),
      }).where(and(eq(cases.id, caseId), eq(cases.providerId, actor.providerId)));
      if (next === "concluido") await tx.update(equipment).set({ status: "recuperado_triagem", inRecoveryProcess: false, updatedAt: new Date() }).where(and(eq(equipment.id, asset.id), eq(equipment.providerId, actor.providerId)));
      return { eventId: created.id, customerId: current.customerId, replayed: false };
    });
  }

  async evidence(actor: FieldActor, caseId: number, eventId?: number) {
    const [owned] = await db.select({ id: cases.id }).from(cases).where(and(eq(cases.id, caseId), eq(cases.providerId, actor.providerId), actor.manager ? undefined : eq(cases.assignedToUserId, actor.userId))).limit(1);
    if (!owned) throw new FieldError(404, "Caso não encontrado na sua fila");
    // Listas recebem só metadados. Os bytes são lidos apenas pelo endpoint privado de uma foto.
    const metadata = eventId ? events.metadata : sql`jsonb_set(${events.metadata}, '{visit,photos}', coalesce((select jsonb_agg(p - 'base64') from jsonb_array_elements(${events.metadata}->'visit'->'photos') p), '[]'::jsonb))`;
    return db.select({ id: events.id, caseId: events.caseId, result: events.result, notes: events.notes, occurredAt: events.occurredAt, metadata, technician: users.name }).from(events)
      .leftJoin(users, and(eq(users.id, events.userId), eq(users.providerId, actor.providerId)))
      .where(and(eq(events.providerId, actor.providerId), eq(events.caseId, caseId), eq(events.type, "visita_campo"), eventId ? eq(events.id, eventId) : undefined)).orderBy(desc(events.id)).limit(100);
  }
}
export const recoveryFieldService = new RecoveryFieldService();
