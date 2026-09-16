import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), snapshot: vi.fn(), integracoes: vi.fn(), segundaVia: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: mock.query } }));
vi.mock("../../storage", () => ({ storage: { getErpIntegrations: mock.integracoes } }));
vi.mock("./snapshot-ao-vivo.service", () => ({ snapshotAoVivoDoCliente: mock.snapshot }));
vi.mock("../../erp", () => ({ getConnector: () => ({ fetchSegundaVia: mock.segundaVia }), buildConnectorConfig: () => ({ apiUrl: "https://erp.example" }) }));
import { obterPagamentoFatura } from "./pagamento-fatura.service";
const snapshot = () => ({ ok: true, encontrado: true, leituraParcial: false, erpSource: "mk", cliente: { statusContrato: "active", dividaAtual: 0,
  faturas: [{ ref: "F10", vencimento: "2026-09-15", valor: 100, pagamento: { link: "https://erp.example/boleto/F10" } }] } });
beforeEach(() => {
  vi.clearAllMocks();
  mock.query.mockResolvedValue({ rows: [{ documento: "12345678901", referencia: "F10", fonte: "mk", vencimento: "2026-09-15", valor: 100 }] });
  mock.snapshot.mockResolvedValue(snapshot());
  mock.integracoes.mockResolvedValue([{ providerId: 6, erpSource: "mk", isEnabled: true }]);
  mock.segundaVia.mockResolvedValue({ link: "https://erp.example/pagamento/F10", valor: 100, vencimento: "2026-09-15" });
});
describe("link real para aviso de fatura", () => {
  it("confirma tenant e snapshot novo antes de devolver link existente", async () => {
    expect(await obterPagamentoFatura(6, 42, 10)).toEqual({ link: "https://erp.example/boleto/F10", valor: 100, vencimento: "2026-09-15" });
    expect(mock.query).toHaveBeenCalledWith(expect.stringContaining("f.provider_id=$1"), [6, 42, 10]);
    expect(mock.snapshot).toHaveBeenCalledWith(6, "12345678901", { forcar: true });
    expect(mock.segundaVia).not.toHaveBeenCalled();
  });
  it("fatura não encontrada no tenant não consulta ERP", async () => {
    mock.query.mockResolvedValue({ rows: [] });
    expect(await obterPagamentoFatura(99, 42, 10)).toBeNull();
    expect(mock.snapshot).not.toHaveBeenCalled();
  });
  it("recusa leitura parcial, fonte diferente e fatura liquidada ou alterada", async () => {
    for (const alteracao of [
      { ...snapshot(), leituraParcial: true }, { ...snapshot(), erpSource: "sgp" },
      { ...snapshot(), cliente: { ...snapshot().cliente, faturas: [] } },
      { ...snapshot(), cliente: { ...snapshot().cliente, faturas: [{ ref: "F10", valor: 101, vencimento: "2026-09-15" }] } },
    ]) { mock.snapshot.mockResolvedValueOnce(alteracao); expect(await obterPagamentoFatura(6, 42, 10)).toBeNull(); }
    expect(mock.segundaVia).not.toHaveBeenCalled();
  });
  it("busca segunda via somente no ERP correspondente quando falta link", async () => {
    const s = snapshot(); s.cliente.faturas[0].pagamento.link = "";
    mock.snapshot.mockResolvedValue(s);
    expect(await obterPagamentoFatura(6, 42, 10)).toMatchObject({ link: "https://erp.example/pagamento/F10" });
    expect(mock.segundaVia).toHaveBeenCalledWith(expect.objectContaining({ extra: { providerId: "6" } }), "12345678901", "F10");
  });
  it("rejeita HTTP e URLs contendo credenciais", async () => {
    for (const link of ["http://erp.example/boleto/F10", "https://user:secret@erp.example/boleto", "https://erp.example/boleto?api_key=secret"]) {
      const s = snapshot(); s.cliente.faturas[0].pagamento.link = link;
      mock.snapshot.mockResolvedValueOnce(s);
      mock.segundaVia.mockResolvedValueOnce({ link });
      expect(await obterPagamentoFatura(6, 42, 10)).toBeNull();
    }
  });
});
