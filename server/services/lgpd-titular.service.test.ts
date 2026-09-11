import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O pedido de EXCLUSÃO do titular (LGPD art. 18, VI) e a confissão de dívida
 * (spec §8): o que não é título — rascunho, cancelada, expirada, sandbox — perde
 * os dados pessoais NA HORA do pedido, não 90 dias depois pela retenção. Só a
 * confissão assinada em produção (título executivo) fica, com a base legal na
 * resposta. Antes o `processExclusao` só REPORTAVA as preservadas e não tocava
 * em nenhuma confissão: rascunho, cancelada e sandbox guardavam nome, CPF,
 * e-mail, telefone, Anexo I e os dois PDFs apesar do pedido.
 *
 * O banco das consultas ISP/SPC é o pg-proxy dos storages (o SQL do Drizzle
 * roda e volta vazio); as confissões passam pelo storage dublado.
 */
const banco = vi.hoisted(() => ({ consultas: [] as string[], db: null as any }));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }), pool: {} }));
const storageMock = vi.hoisted(() => ({
  confissoesDoTitular: vi.fn(async (): Promise<any[]> => []),
  anonimizarConfissao: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("./lgpd-email.service", () => ({ sendCompletionEmail: vi.fn(async () => undefined), sendSlaAlertEmail: vi.fn(async () => undefined) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { drizzle } from "drizzle-orm/pg-proxy";
import { processExclusao } from "./lgpd-titular.service";

beforeEach(() => {
  vi.clearAllMocks();
  banco.consultas.length = 0;
  banco.db = drizzle(async (sql) => { banco.consultas.push(sql); return { rows: [] }; });
});

describe("processExclusao — confissões de dívida", () => {
  it("anonimiza as confissões do CPF que não são título e devolve as contagens, com a base legal das preservadas", async () => {
    storageMock.confissoesDoTitular.mockResolvedValueOnce([
      { id: 10, providerId: 1, status: "assinada", valorTotal: 819.76, ambiente: "producao", assinadaEm: new Date("2026-09-12T10:00:00Z"), createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
      { id: 12, providerId: 1, status: "cancelada", valorTotal: 10, ambiente: "producao", assinadaEm: null, createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
      { id: 11, providerId: 1, status: "assinada", valorTotal: 10, ambiente: "sandbox", assinadaEm: new Date("2026-09-12T10:00:00Z"), createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
    ]);
    const r = await processExclusao("12345678901", "LGPD-202609-0001");
    // As consultas ISP e SPC continuam sendo anonimizadas como antes.
    expect(banco.consultas.filter(s => s.startsWith('update "isp_consultations"') || s.startsWith('update "spc_consultations"'))).toHaveLength(2);
    expect(storageMock.anonimizarConfissao.mock.calls).toEqual([[1, 12], [1, 11]]);
    expect(r).toMatchObject({
      action: "exclusao",
      confissoesAnonimizadas: 2,
      confissoesPreservadas: [expect.objectContaining({ id: 10, status: "assinada", ambiente: "producao" })],
      baseLegalDasConfissoes: expect.stringContaining("LGPD art. 16, I"),
      confissoesEmAndamento: [],
    });
  });
});
