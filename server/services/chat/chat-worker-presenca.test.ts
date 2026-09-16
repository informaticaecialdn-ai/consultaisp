import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn(), poolQuery: vi.fn(), warn: vi.fn(), options: [] as unknown[] }));
vi.mock("pg", () => ({ Client: class {
  constructor(options: unknown) { fake.options.push(options); }
  connect = fake.connect; query = fake.query; end = fake.end; on = fake.on;
} }));
vi.mock("../../db", () => ({ pool: { query: fake.poolQuery } }));
vi.mock("../../logger", () => ({ logger: { warn: fake.warn } }));
import { conectarPresencaDoChat, estadoDoProcessoChat, iniciarPresencaDoChat } from "./chat-worker-presenca";
beforeEach(() => { vi.resetAllMocks(); fake.options.length = 0; fake.connect.mockResolvedValue(undefined); fake.end.mockResolvedValue(undefined); fake.query.mockResolvedValue({ rows: [] }); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
describe("presença do processo", () => {
  it("pulsa a cada 15 segundos e encerra a conexão e o timer", async () => {
    const presenca = await iniciarPresencaDoChat("ensaio");
    expect(fake.options[0]).toMatchObject({ application_name: "consultaisp-chat:ensaio" });
    expect(fake.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.query).toHaveBeenCalledTimes(3);
    await presenca.encerrar();
    expect(fake.end).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.query).toHaveBeenCalledTimes(3);
  });
  it("falha de pulso é observada e a próxima rodada reconecta", async () => {
    const presenca = await iniciarPresencaDoChat("envio");
    fake.query.mockRejectedValueOnce(new Error("socket perdido"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.warn).toHaveBeenCalledTimes(1);
    expect(fake.end).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.connect).toHaveBeenCalledTimes(2);
    await presenca.encerrar();
  });
  it("não sobrepõe pulsos e aguarda pulso pendente ao encerrar", async () => {
    const presenca = await iniciarPresencaDoChat("envio");
    let concluir!: () => void;
    fake.query.mockImplementationOnce(() => new Promise<void>(resolve => { concluir = resolve; }));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fake.query).toHaveBeenCalledTimes(2);
    const encerrando = presenca.encerrar();
    expect(fake.end).not.toHaveBeenCalled();
    concluir();
    await encerrando;
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("conexão que falha no início libera o recurso", async () => {
    fake.connect.mockRejectedValueOnce(new Error("banco fora"));
    await expect(conectarPresencaDoChat("ensaio")).rejects.toThrow("banco fora");
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("declara ausente quando não há processo recente e mantém modo retornado", async () => {
    fake.poolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await estadoDoProcessoChat()).toEqual({ online: false, modo: null, verificadoEm: null });
    const data = new Date("2026-09-14T14:00:00Z");
    fake.poolQuery.mockResolvedValueOnce({ rows: [{ application_name: "consultaisp-chat:envio", state_change: data }] });
    expect(await estadoDoProcessoChat()).toEqual({ online: true, modo: "envio", verificadoEm: data.toISOString() });
  });
});
