import { describe, expect, it } from "vitest";
import { validateVisitPhotos, storedVisitSchema } from "./recovery-field.service";
describe("armazenamento das evidências", () => {
  it("rejeita arquivo HTML disfarçado de JPEG", () => expect(() => validateVisitPhotos([{ name: "foto.jpg", mime: "image/jpeg", base64: Buffer.from("<script>alert(1)</script>").toString("base64") }])).toThrow("Foto inválida"));
  it("rejeita imagem que ultrapassa o limite por arquivo", () => { const bytes = Buffer.alloc(512_001); bytes.set([255,216,255]); expect(() => validateVisitPhotos([{ name: "foto.jpg", mime: "image/jpeg", base64: bytes.toString("base64") }])).toThrow(); });
  it("rejeita MIME divergente da assinatura", () => expect(() => validateVisitPhotos([{ name: "foto.png", mime: "image/png", base64: Buffer.from([255,216,255,224,0,0,0,0]).toString("base64") }])).toThrow());
  it("lê histórico sem bytes da imagem", () => expect(storedVisitSchema.safeParse({ version: 1, kind: "field_visit", requestId: "id", payloadHash: "hash", visit: { nextAction: "reagendar", location: null, photos: [{ name: "foto", mime: "image/jpeg" }] } }).success).toBe(true));
});
