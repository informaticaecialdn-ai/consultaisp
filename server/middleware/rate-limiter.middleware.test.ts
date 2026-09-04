import { describe, it, expect, vi, beforeEach } from "vitest";
import { chaveDoLimite, createRateLimiter } from "./rate-limiter.middleware";

const req = (session: Record<string, unknown> | undefined, ip = "10.0.0.1") =>
  ({ session, ip } as any);

const res = () => {
  const r: any = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  r.setHeader = vi.fn();
  return r;
};

describe("chaveDoLimite", () => {
  it("usa o provedor quando ha provedor", () => {
    expect(chaveDoLimite(req({ userId: 9, providerId: 4 }))).toBe("p:4");
  });

  // O defeito: a chave era `providerId || ip`. Sem provedor, todo mundo caia
  // no mesmo balde e um usuario gastava a cota dos outros.
  it("cai no usuario quando nao ha provedor, e nao num balde comum", () => {
    expect(chaveDoLimite(req({ userId: 9 }))).toBe("u:9");
    expect(chaveDoLimite(req({ userId: 10 }))).toBe("u:10");
  });

  it("providerId 0 nao vale como provedor", () => {
    expect(chaveDoLimite(req({ userId: 9, providerId: 0 }))).toBe("u:9");
  });

  it("sem sessao vale o IP — login e cadastro passam por aqui", () => {
    expect(chaveDoLimite(req(undefined, "203.0.113.7"))).toBe("ip:203.0.113.7");
    expect(chaveDoLimite(req({}, "203.0.113.7"))).toBe("ip:203.0.113.7");
  });

  // Ids de tabelas diferentes: sem prefixo, o provedor 5 e o usuario 5
  // dividiriam o mesmo balde.
  it("provedor e usuario de mesmo numero nao colidem", () => {
    expect(chaveDoLimite(req({ userId: 5, providerId: 5 }))).not.toBe(chaveDoLimite(req({ userId: 5 })));
  });
});

describe("createRateLimiter", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("dois usuarios sem provedor nao dividem a cota", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter(req({ userId: 1 }), res(), next);
    limiter(req({ userId: 2 }), res(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("o mesmo usuario sem provedor estoura a propria cota", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const bloqueada = res();

    limiter(req({ userId: 1 }), res(), next);
    limiter(req({ userId: 1 }), bloqueada, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(bloqueada.status).toHaveBeenCalledWith(429);
    expect(bloqueada.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("usuarios do MESMO provedor continuam dividindo a cota do provedor", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const bloqueada = res();

    limiter(req({ userId: 1, providerId: 4 }), res(), next);
    limiter(req({ userId: 2, providerId: 4 }), bloqueada, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(bloqueada.status).toHaveBeenCalledWith(429);
  });

  it("provedores diferentes nao se atrapalham", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter(req({ userId: 1, providerId: 4 }), res(), next);
    limiter(req({ userId: 2, providerId: 5 }), res(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  /**
   * O caso que a fase 1 do white label torna cotidiano: a sessao do revendedor
   * nasce com `providerId` 0 de propósito — o tenant dele e `marcaId`. Sem o
   * ramo `u:`, revendedores de MARCAS DIFERENTES dividiriam um unico balde
   * chamado "sem provedor", e um deles esgotaria a cota de todos.
   */
  it("revendedores de marcas diferentes nao dividem balde", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    const sessaoDeRevenda = (userId: number, marcaId: number) =>
      req({ userId, providerId: 0, role: "revendedor", marcaId });

    expect(chaveDoLimite(sessaoDeRevenda(3, 7))).toBe("u:3");
    limiter(sessaoDeRevenda(3, 7), res(), next);
    limiter(sessaoDeRevenda(4, 9), res(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("a cota do revendedor e por pessoa, nao por marca", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    // Dois usuarios da MESMA marca: uma equipe de revenda grande nao pode se
    // estrangular sozinha, entao cada um tem o proprio balde.
    limiter(req({ userId: 3, providerId: 0, role: "revendedor", marcaId: 7 }), res(), next);
    limiter(req({ userId: 4, providerId: 0, role: "revendedor", marcaId: 7 }), res(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });
});
