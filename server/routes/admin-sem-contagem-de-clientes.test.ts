import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";

/**
 * Decisao do dono (17/09/2026): "remover de dentro do sistema do painel
 * administrativo, qualquer dados de totalizacao de clientes dos provedores".
 *
 * A trava e de CAMINHO, nao de tela: o painel do superadmin nao pode devolver a
 * contagem de clientes de um provedor nem a soma da plataforma, e a rota do
 * detalhe nem pode LER a carteira — ela carregava as linhas inteiras (nome,
 * documento, telefone, endereco, divida) so para imprimir `.length`.
 *
 * Por isso este arquivo prova as tres coisas que um corte de JSX nao provaria:
 * o payload sem o campo, o storage sem a leitura, e o fonte do client sem o
 * cartao — se alguem reintroduzir o numero, aqui falha.
 */
const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (): Promise<any> => null),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  getCustomersByProvider: vi.fn(async (): Promise<any[]> => []),
  getEquipmentByProvider: vi.fn(async (): Promise<any[]> => []),
  getIspConsultationsByProvider: vi.fn(async (): Promise<any[]> => []),
  getSpcConsultationsByProvider: vi.fn(async (): Promise<any[]> => []),
  getAllProviderInvoices: vi.fn(async (): Promise<any[]> => []),
  getPlanChanges: vi.fn(async (): Promise<any[]> => []),
  getSystemStats: vi.fn(async (): Promise<any> => ({
    providers: 7, users: 10, ispConsultations: 138, spcConsultations: 43,
    totalIspCredits: 1250.5, totalSpcCredits: 90, activeProviders: 6,
  })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
  esquecerStatusDeProvedor: vi.fn(),
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({}));
vi.mock("../services/marca.service", () => ({
  esquecerMarcas: vi.fn(),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null })),
  urlDeEntrada: vi.fn(() => "https://consultaisp.com.br"),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/lgpd-email.service", () => ({ sendCompletionEmail: vi.fn(async () => undefined) }));

import { registerAdminRoutes } from "./admin.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerAdminRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getProvider.mockResolvedValue({ id: 42, name: "Provedor NsLink", subdomain: "nslink", plan: "free", status: "active" });
  storageMock.getUsersByProvider.mockResolvedValue([]);
  storageMock.getCustomersByProvider.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
  storageMock.getEquipmentByProvider.mockResolvedValue([{ id: 1 }]);
  storageMock.getIspConsultationsByProvider.mockResolvedValue([]);
  storageMock.getSpcConsultationsByProvider.mockResolvedValue([]);
  storageMock.getAllProviderInvoices.mockResolvedValue([]);
  storageMock.getPlanChanges.mockResolvedValue([]);
  sessao = { userId: 1, role: "superadmin" };
});

describe("painel administrativo nao totaliza clientes de provedor", () => {
  it("GET /api/admin/providers/:id/detail nao devolve a contagem de clientes", async () => {
    const res = await fetch(`${base}/api/admin/providers/42/detail`);
    expect(res.status).toBe(200);
    const corpo = await res.json();

    expect(corpo.stats).toBeDefined();
    expect(corpo.stats).not.toHaveProperty("customers");
    expect(JSON.stringify(corpo)).not.toContain("\"customers\"");
    // Uso da plataforma continua inteiro: o corte e so a carteira do provedor.
    expect(corpo.stats).toHaveProperty("ispConsultations");
    expect(corpo.stats).toHaveProperty("spcConsultations");
  });

  it("a rota do detalhe nem LE a carteira do provedor", async () => {
    const res = await fetch(`${base}/api/admin/providers/42/detail`);
    expect(res.status).toBe(200);
    // Sem esta asserção sobraria a variante "sumiu da tela, continua saindo do banco":
    // a leitura trazia nome, documento, telefone, endereco e divida de cada titular.
    expect(storageMock.getCustomersByProvider).not.toHaveBeenCalled();
  });

  it("GET /api/admin/stats nao devolve a soma de clientes da plataforma", async () => {
    const res = await fetch(`${base}/api/admin/stats`);
    expect(res.status).toBe(200);
    const corpo = await res.json();

    expect(corpo).not.toHaveProperty("customers");
    expect(corpo.providers).toBe(7);
    expect(corpo.ispConsultations).toBe(138);
  });
});

describe("o fonte do painel nao mostra contagem de clientes", () => {
  const raiz = join(import.meta.dirname, "..", "..");
  const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

  it("o storage do painel nao conta a tabela de clientes", () => {
    const fonte = ler("server/storage/admin.storage.ts");
    expect(fonte).not.toMatch(/from\(\s*customers\s*\)/);
    expect(fonte).not.toMatch(/customers\s*:/);
  });

  it("a rota do painel nao pede a carteira do provedor", () => {
    const fonte = ler("server/routes/admin.routes.ts");
    // A CHAMADA, nao a palavra: o comentario que explica o corte cita o metodo
    // pelo nome de proposito, para quem ler a rota saber por que ele nao esta la.
    expect(fonte).not.toMatch(/storage\s*\.\s*getCustomersByProvider\s*\(/);
  });

  it("as telas do painel administrativo nao tem cartao de clientes", () => {
    for (const arquivo of [
      "client/src/components/admin/tabs/VisaoGeralTab.tsx",
      "client/src/pages/admin/admin-provedor.tsx",
    ]) {
      const fonte = ler(arquivo);
      expect(fonte, arquivo).not.toMatch(/stats\??\.customers/);
      expect(fonte, arquivo).not.toMatch(/"(stat-)?card-clientes"/);
    }
  });
});
