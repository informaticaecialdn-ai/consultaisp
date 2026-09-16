import { describe, expect, it } from "vitest";
import { geoPoint, distanceKm, orderByProximity, visitSchema, routeSchema, type FieldCase } from "./recovery-field";
const item = (id: number, lat: number, geoPrecision = "erp") => ({ id, point: { lat, lng: -51 }, geoPrecision }) as FieldCase;
describe("planejamento de recuperação", () => {
  it("não transforma coordenada ausente em zero nem aceita ponto fora do globo", () => {
    expect(geoPoint(null, null)).toBeNull(); expect(geoPoint("", "")).toBeNull(); expect(geoPoint("999", "-51")).toBeNull();
    expect(geoPoint("-23.3", "-51")).toEqual({ lat: -23.3, lng: -51 });
  });
  it("ordena por proximidade e exclui centroides ou origem desconhecida", () => {
    const route = orderByProximity({ lat: -23, lng: -51 }, [item(1, -24), item(2, -23.1), item(3, -23, "bairro"), item(4, -23, "")]);
    expect(route.stops.map(s => s.caseId)).toEqual([2, 1]); expect(route.excluded).toEqual([3, 4]); expect(route.distanceKm).toBeGreaterThan(100);
  });
  it("distância zero é válida para equipamentos na mesma residência", () => expect(distanceKm({ lat: -23, lng: -51 }, { lat: -23, lng: -51 })).toBe(0));
  it("não aceita caso duplicado nem origem fornecida como texto", () => {
    const stop = { caseId: 1, expectedUpdatedAt: new Date().toISOString() };
    expect(routeSchema.safeParse({ origin: { lat: -23, lng: -51 }, stops: [stop, stop] }).success).toBe(false);
  });
});
const visit = { requestId: "12345678-1234-4123-8123-123456789012", expectedUpdatedAt: "2026-09-13T12:00:00.000Z", occurredAt: "2026-09-13T12:00:00.000Z", result: "cliente_ausente", notes: "Visita realizada no endereço.", location: null, locationReason: "GPS indisponível no dispositivo", photos: [{ name: "visita.jpg", mime: "image/jpeg", base64: "/9j/AAAAAAAAAAAA" }], nextAction: "reagendar" };
describe("evidências de campo", () => {
  it("exige relato, evidência e motivo quando não há GPS", () => {
    expect(visitSchema.safeParse(visit).success).toBe(true);
    expect(visitSchema.safeParse({ ...visit, photos: [] }).success).toBe(false);
    expect(visitSchema.safeParse({ ...visit, locationReason: "" }).success).toBe(false);
    expect(visitSchema.safeParse({ ...visit, notes: "" }).success).toBe(false);
  });
  it("não aceita resultado sem retirada como triagem nem escreve tenant fornecido pelo cliente", () => {
    expect(visitSchema.safeParse({ ...visit, nextAction: "triagem" }).success).toBe(false);
    expect(visitSchema.safeParse({ ...visit, providerId: 9 }).success).toBe(false);
  });
});
