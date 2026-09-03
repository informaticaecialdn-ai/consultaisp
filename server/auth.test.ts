import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be hoisted so SESSION_SECRET is set before auth.ts module evaluates
vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

// Mock dependencies that auth.ts imports at top level
vi.mock("express-session", () => {
  const sessionFn = () => (_req: any, _res: any, next: any) => next();
  return { default: sessionFn };
});

vi.mock("connect-pg-simple", () => {
  return { default: () => class MockPgStore {} };
});

vi.mock("./db", () => ({
  pool: {},
}));

import { requireAuth, requireAdmin, requireProvider, requireSuperAdmin } from "./auth.js";

type SessionData = {
  userId?: number;
  providerId?: number;
  role?: string;
  subdomain?: string;
  hostLogin?: string;
};

const mockReq = (session: Partial<SessionData> = {}, hostname = "nslink.consultaisp.com.br") =>
  ({ session, hostname } as any);

const mockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("requireAuth", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 401 when no session userId", () => {
    const req = mockReq({});
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Autenticacao necessaria" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when a provider session matches the host it was born on", () => {
    const req = mockReq({
      userId: 1,
      providerId: 7,
      role: "admin",
      hostLogin: "nslink.consultaisp.com.br",
    });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // O buraco fail-OPEN: a prova de host so rodava quando havia providerId.
  it("recusa com 401 generico quem nao e superadmin e nao tem provedor", () => {
    const req = mockReq({ userId: 1, role: "user" });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Autenticacao necessaria" });
    expect(next).not.toHaveBeenCalled();
  });

  it("recusa providerId 0, que e o valor gravado no login para quem nao tem provedor", () => {
    const req = mockReq({ userId: 1, providerId: 0, role: "user", hostLogin: "nslink.consultaisp.com.br" });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("recusa sessao sem provedor mesmo sem papel declarado", () => {
    const req = mockReq({ userId: 1 });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("superadmin continua entrando por qualquer host, sem provedor", () => {
    const req = mockReq({ userId: 1, role: "superadmin" }, "consultaisp.com.br");
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 quando a sessao de um host e reapresentada em outro", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", hostLogin: "nslink.consultaisp.com.br" },
      "outra.consultaisp.com.br",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Sessao invalida para este endereco" });
    expect(next).not.toHaveBeenCalled();
  });

  // Sessao aberta antes do deploy do hostLogin: janela de compatibilidade de
  // 48h que segue valendo pela regra antiga, agora so para quem TEM provedor.
  it("sessao legada sem hostLogin ainda e barrada quando o subdominio diverge", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", subdomain: "nslink" },
      "outra.consultaisp.com.br",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("sessao legada sem hostLogin passa quando o subdominio confere", () => {
    const req = mockReq(
      { userId: 1, providerId: 7, role: "admin", subdomain: "nslink" },
      "nslink.consultaisp.com.br",
    );
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireProvider", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("passa com provedor de verdade", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "user" });
    const res = mockRes();

    requireProvider(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 com providerId 0 — o valor que gravaria provider_id 0 na tabela", () => {
    const req = mockReq({ userId: 1, providerId: 0, role: "user" });
    const res = mockRes();

    requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Somente provedores" });
    expect(next).not.toHaveBeenCalled();
  });

  it("403 sem providerId nenhum", () => {
    const req = mockReq({ userId: 1, role: "user" });
    const res = mockRes();

    requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 sem sessao", () => {
    const req = mockReq({});
    const res = mockRes();

    requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 para superadmin: rota de provedor nao e endereco dele", () => {
    const req = mockReq({ userId: 1, role: "superadmin" });
    const res = mockRes();

    requireProvider(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 403 when role is 'user'", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "user" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'admin'", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "admin" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'superadmin'", () => {
    const req = mockReq({ userId: 1, role: "superadmin" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403 para admin sem provedor: escreveria com providerId 0", () => {
    const req = mockReq({ userId: 1, providerId: 0, role: "admin" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireSuperAdmin", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 403 when role is 'admin'", () => {
    const req = mockReq({ userId: 1, providerId: 7, role: "admin" });
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'superadmin'", () => {
    const req = mockReq({ userId: 1, role: "superadmin" });
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when no session at all", () => {
    const req = mockReq({});
    const res = mockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
