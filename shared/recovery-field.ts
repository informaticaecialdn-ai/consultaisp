import { z } from "zod";

export const pointSchema = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict();
export type FieldPoint = z.infer<typeof pointSchema>;
export const visitResults = {
  recolhido: "Equipamento recolhido",
  cliente_ausente: "Cliente não encontrado",
  endereco_incorreto: "Endereço incorreto",
  acesso_impedido: "Acesso impedido",
  reagendamento: "Cliente pediu reagendamento",
  recusa: "Cliente recusou a devolução",
} as const;
export const photoSchema = z.object({
  name: z.string().trim().min(1).max(100),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(12).max(700_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export const visitSchema = z.object({
  requestId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
  result: z.enum(["recolhido", "cliente_ausente", "endereco_incorreto", "acesso_impedido", "reagendamento", "recusa"]),
  notes: z.string().trim().min(12, "Descreva a visita com pelo menos 12 caracteres").max(2000),
  location: pointSchema.extend({ accuracy: z.number().finite().min(0).max(100_000) }).nullable(),
  locationReason: z.string().trim().max(300).optional(),
  photos: z.array(photoSchema).min(1, "Anexe ao menos uma foto da visita").max(3),
  collectedIdentifier: z.string().trim().max(120).optional(),
  nextAction: z.enum(["reagendar", "corrigir_endereco", "supervisor", "triagem"]),
}).strict().superRefine((v, ctx) => {
  if (!v.location && (v.locationReason?.length ?? 0) < 10) ctx.addIssue({ code: "custom", path: ["locationReason"], message: "Explique por que a localização não está disponível" });
  if (v.result === "recolhido" && v.nextAction !== "triagem") ctx.addIssue({ code: "custom", path: ["nextAction"], message: "Equipamento recolhido deve seguir para triagem" });
  if (v.result !== "recolhido" && v.nextAction === "triagem") ctx.addIssue({ code: "custom", path: ["nextAction"], message: "Selecione a próxima ação da visita sem recolhimento" });
});
export type FieldVisit = z.infer<typeof visitSchema>;
export const routeSchema = z.object({
  origin: pointSchema,
  stops: z.array(z.object({ caseId: z.number().int().positive(), expectedUpdatedAt: z.string().datetime() }).strict()).min(1).max(30),
}).strict().refine(v => new Set(v.stops.map(s => s.caseId)).size === v.stops.length, "Não repita um caso na rota");
export const dispatchSchema = z.object({
  origin: pointSchema,
  stops: z.array(z.object({ caseId: z.number().int().positive(), expectedUpdatedAt: z.string().datetime() }).strict()).min(1).max(30),
  assignedToUserId: z.number().int().positive(),
  scheduledAt: z.string().datetime(),
}).strict().refine(v => new Set(v.stops.map(s => s.caseId)).size === v.stops.length, "Não repita um caso na rota");

export interface FieldCase {
  id: number; customerId: number; equipmentId: number; status: string; priority: string;
  customerName: string; phone: string | null; address: string | null; city: string | null; neighborhood: string | null;
  equipmentType: string; serial: string | null; mac: string | null; assetTag: string | null; value: string | null;
  point: FieldPoint | null; geoPrecision: string | null;
  assignedToUserId: number | null; assignedName: string | null;
  scheduledAt: string | null; updatedAt: string; deadlineAt: string; closedAt: string | null;
  route: { id: string; order: number } | null;
}
export interface FieldEvent {
  id: number; caseId: number; result: keyof typeof visitResults; notes: string | null; occurredAt: string;
  technician: string | null; nextAction: string; location: (FieldPoint & { accuracy: number }) | null;
  locationReason?: string; photos: { name: string; url: string }[];
}
export function geoPoint(lat: unknown, lng: unknown): FieldPoint | null {
  if (lat === null || lat === "" || lng === null || lng === "") return null;
  const parsed = pointSchema.safeParse({ lat: Number(lat), lng: Number(lng) });
  return parsed.success && !(parsed.data.lat === 0 && parsed.data.lng === 0) ? parsed.data : null;
}
export function distanceKm(a: FieldPoint, b: FieldPoint): number {
  const rad = (v: number) => v * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
/** Proximidade em linha reta: não estima trânsito, duração ou melhor percurso viário. */
export function orderByProximity(origin: FieldPoint, cases: FieldCase[]) {
  const excluded = cases.filter(c => !c.point || !["erp", "endereco"].includes(c.geoPrecision ?? ""));
  const pending = cases.filter(c => !excluded.includes(c));
  const stops: { caseId: number; order: number; distanceKm: number }[] = [];
  let current = origin;
  while (pending.length) {
    pending.sort((a, b) => distanceKm(current, a.point!) - distanceKm(current, b.point!) || a.id - b.id);
    const next = pending.shift()!;
    stops.push({ caseId: next.id, order: stops.length + 1, distanceKm: distanceKm(current, next.point!) });
    current = next.point!;
  }
  return { stops, excluded: excluded.map(c => c.id), distanceKm: stops.reduce((sum, s) => sum + s.distanceKm, 0) };
}
