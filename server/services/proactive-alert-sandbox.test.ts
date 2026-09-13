/**
 * Quem é dono do CPF na base sincronizada, para o alerta de fuga (auditoria
 * de isolamento de 13/09/2026, L1).
 *
 * `notifyOwnerProviders` lê `customers` pelo CPF para achar o dono cujo ERP não
 * respondeu ao vivo. Na demonstração os CPFs da rede se repetem em todo
 * sandbox, e a leitura ao vivo de um visitante nunca pergunta ao sandbox de
 * outro: sem observador, o sandbox B entrava como dono "da base" e ganhava um
 * alerta de fuga — card, contador da sidebar e 360 — a cada consulta do
 * visitante A. O filtro mora no storage (`getCustomerByCpfCnpj`, só com
 * `emModoDemo()`); aqui se prende que o consulente chega até ele, nos dois
 * caminhos da Consulta ISP: com leitura ao vivo e sem ERP na rede.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  delete process.env.APP_URL;
  process.env.MAIN_DOMAIN = "consultaisp.com.br";
});

const storageMock = vi.hoisted(() => ({
  getCustomerByCpfCnpj: vi.fn(async (_c: string, _observador?: number): Promise<any[]> => []),
  getProvider: vi.fn(async (_id: number): Promise<any> => undefined),
  getMarca: vi.fn(async (_id: number): Promise<any> => undefined),
  getAntiFraudRules: vi.fn(async (_id: number): Promise<any[]> => []),
  getLastProactiveAlert: vi.fn(async (): Promise<any> => undefined),
  createAlert: vi.fn(async (_a: any) => undefined),
  createProactiveAlert: vi.fn(async (_a: any) => undefined),
  getUsersByProvider: vi.fn(async (_id: number): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("./email", () => ({ sendProactiveAlertEmail: vi.fn(async () => undefined) }));
vi.mock("./crm/zapi", () => ({ isZapiConfigured: vi.fn(() => false), sendText: vi.fn(async () => ({ success: true })) }));
vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { notifyOwnerProviders } from "./proactive-alert.service";

const CPF = "99950400007";
const VISITANTE_A = 501;

beforeEach(() => { vi.clearAllMocks(); });

describe("alerta de fuga — a base sincronizada é lida com o consulente como observador", () => {
  it("com leitura ao vivo: getCustomerByCpfCnpj recebe o provedor que consultou", async () => {
    await notifyOwnerProviders(CPF, [], VISITANTE_A, new Set([1, 2]), [VISITANTE_A]);

    expect(storageMock.getCustomerByCpfCnpj).toHaveBeenCalledWith(CPF, VISITANTE_A);
  });

  it("sem ERP na rede (o ramo que não lê ao vivo): o mesmo observador", async () => {
    await notifyOwnerProviders(CPF, [], VISITANTE_A, new Set(), [VISITANTE_A]);

    expect(storageMock.getCustomerByCpfCnpj).toHaveBeenCalledWith(CPF, VISITANTE_A);
  });
});
