import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldVisit } from "@shared/recovery-field";
const state = vi.hoisted(() => {
  const reads: unknown[][] = [];
  const write = vi.fn();
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => reads.shift() ?? [], limit: async () => reads.shift() ?? [] }) }) }),
    insert: () => ({ values: (value: unknown) => { write(value); return { returning: async () => [{ id: 91 }] }; } }),
    update: () => ({ set: (value: unknown) => ({ where: async () => { write(value); return []; } }) }),
  };
  return { reads, write, tx };
});
vi.mock("../db", () => ({ db: { transaction: async (run: (tx: typeof state.tx) => Promise<unknown>) => run(state.tx) } }));
import { RecoveryFieldService } from "./recovery-field.service";
const service = new RecoveryFieldService();
const actor = { providerId: 4, userId: 8, manager: false };
const when = new Date(Date.now() - 60_000).toISOString();
const current = { id: 7, providerId: 4, equipmentId: 12, customerId: 19, assignedToUserId: 8, status: "agendado", updatedAt: new Date(when), terminationDate: new Date(Date.now() - 86400000), deadlineAt: new Date(Date.now() + 86400000), closedAt: null };
const visit: FieldVisit = { requestId: "12345678-1234-4123-8123-123456789012", expectedUpdatedAt: when, occurredAt: when, result: "cliente_ausente", notes: "Não houve atendimento na residência.", location: null, locationReason: "GPS indisponível", photos: [{ name: "visita.jpg", mime: "image/jpeg", base64: Buffer.from([255,216,255,224,0,0,0,0]).toString("base64") }], nextAction: "reagendar" };
beforeEach(() => { state.reads.length = 0; state.write.mockClear(); });
describe("gravação de visita", () => {
  it("nega atividade atribuída a outro técnico antes de qualquer gravação", async () => {
    state.reads.push([{ ...current, assignedToUserId: 99 }]);
    await expect(service.visit(actor, 7, visit)).rejects.toThrow("Caso não encontrado"); expect(state.write).not.toHaveBeenCalled();
  });
  it("nega caso alterado após a agenda ser carregada", async () => {
    state.reads.push([{ ...current, updatedAt: new Date() }], []);
    await expect(service.visit(actor, 7, visit)).rejects.toThrow("O caso mudou"); expect(state.write).not.toHaveBeenCalled();
  });
  it("nega aparelho incompatível antes de concluir", async () => {
    state.reads.push([current], [], [{ customerId: 19, serialNumber: "ABC123" }]);
    await expect(service.visit(actor, 7, { ...visit, result: "recolhido", nextAction: "triagem", collectedIdentifier: "XYZ999" })).rejects.toThrow("Confirme a série"); expect(state.write).not.toHaveBeenCalled();
  });
  it("reenviar o mesmo pedido após fechamento devolve o evento e não duplica a visita", async () => {
    state.reads.push([{ ...current, status: "concluido", closedAt: new Date() }], [{ id: 91, metadata: { version: 1, kind: "field_visit", requestId: visit.requestId, payloadHash: createHash("sha256").update(JSON.stringify(visit)).digest("hex"), visit } }]);
    expect(await service.visit(actor, 7, visit)).toMatchObject({ eventId: 91, replayed: true }); expect(state.write).not.toHaveBeenCalled();
  });
  it("não reaproveita chave com evidências diferentes", async () => {
    state.reads.push([current], [{ id: 91, metadata: { version: 1, kind: "field_visit", requestId: visit.requestId, payloadHash: "outro-conteudo", visit } }]);
    await expect(service.visit(actor, 7, visit)).rejects.toThrow("outro conteúdo"); expect(state.write).not.toHaveBeenCalled();
  });
  it("visita frustrada gera nova tentativa e preserva evidência privada", async () => {
    state.reads.push([current], [], [{ customerId: 19, id: 12, serialNumber: "ABC123" }]);
    expect(await service.visit(actor, 7, visit)).toMatchObject({ eventId: 91, replayed: false });
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ type: "visita_campo", providerId: 4, userId: 8, toStatus: "nova_tentativa", metadata: expect.objectContaining({ kind: "field_visit" }) }));
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ status: "nova_tentativa", scheduledAt: null }));
    expect(state.write).not.toHaveBeenCalledWith(expect.objectContaining({ bureauStatus: "ativo_validado" }));
  });
  it("recolhimento com MAC conferido encerra o caso e encaminha o aparelho para triagem", async () => {
    state.reads.push([current], [], [{ customerId: 19, id: 12, mac: "AA:BB:CC:DD:EE:FF" }]);
    await service.visit(actor, 7, { ...visit, result: "recolhido", nextAction: "triagem", collectedIdentifier: "aa-bb-cc-dd-ee-ff" });
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ type: "visita_campo", result: "recolhido", toStatus: "concluido" }));
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ status: "concluido", closedAt: expect.any(Date), bureauStatus: "resolvido" }));
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ status: "recuperado_triagem", inRecoveryProcess: false }));
  });
  it.each(["contestado", "concluido", "prazo_expirado"])("recusa nova visita em caso %s", async status => {
    state.reads.push([{ ...current, status }], []);
    await expect(service.visit(actor, 7, visit)).rejects.toThrow("Solicite revisão");
    expect(state.write).not.toHaveBeenCalled();
  });
});
