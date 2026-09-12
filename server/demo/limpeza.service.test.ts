import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const fake = vi.hoisted(() => ({ expirados: vi.fn(), apagar: vi.fn() }));
vi.mock("./sandbox.service", () => ({
  sandboxesExpirados: fake.expirados,
  apagarSandbox: fake.apagar,
}));
import { limparSandboxesExpirados } from "./limpeza.service";

describe("limpeza da demo", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.DEMO_MODE = "true"; fake.apagar.mockResolvedValue(undefined); });
  afterEach(() => { delete process.env.DEMO_MODE; });

  it("apaga cada sandbox expirado", async () => {
    fake.expirados.mockResolvedValue([11, 12]);
    await expect(limparSandboxesExpirados()).resolves.toEqual({ apagados: 2 });
    expect(fake.apagar).toHaveBeenCalledWith(11);
    expect(fake.apagar).toHaveBeenCalledWith(12);
  });

  it("fora do modo demo nao apaga nada — producao nunca perde provedor", async () => {
    delete process.env.DEMO_MODE;
    await expect(limparSandboxesExpirados()).resolves.toEqual({ apagados: 0 });
    expect(fake.expirados).not.toHaveBeenCalled();
  });

  it("um sandbox que falha nao impede os outros", async () => {
    fake.expirados.mockResolvedValue([11, 12]);
    fake.apagar.mockRejectedValueOnce(new Error("fk"));
    await expect(limparSandboxesExpirados()).resolves.toEqual({ apagados: 1 });
    expect(fake.apagar).toHaveBeenCalledTimes(2);
  });
});
