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

import { requireAuth, requireAdmin, requireSuperAdmin } from "./auth.js";

type SessionData = { userId?: number; providerId?: number; role?: string };

const mockReq = (session: Partial<SessionData> = {}) => ({ session } as any);

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

  it("calls next() when session has userId", () => {
    const req = mockReq({ userId: 1 });
    const res = mockRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 403 when role is 'user'", () => {
    const req = mockReq({ userId: 1, role: "user" });
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when role is 'admin'", () => {
    const req = mockReq({ userId: 1, role: "admin" });
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
});

describe("requireSuperAdmin", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 403 when role is 'admin'", () => {
    const req = mockReq({ userId: 1, role: "admin" });
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
