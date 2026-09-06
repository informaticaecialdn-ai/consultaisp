import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ getConversaDoChat: vi.fn(), clienteDoAtendimento: vi.fn(), contextoFinanceiroDoChat: vi.fn(), getErpIntegrations: vi.fn() }));
const erp = vi.hoisted(() => ({ snapshot: vi.fn(), segundaVia: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../cobranca/snapshot-ao-vivo.service", () => ({ snapshotAoVivoDoCliente: erp.snapshot }));
vi.mock("../../erp", () => ({ getConnector: () => ({ fetchSegundaVia: erp.segundaVia }), buildConnectorConfig: () => ({ apiUrl: "https://erp.example", apiToken: "segredo-interno" }) }));
vi.mock("./chat-ponte.service", () => ({ ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, m: string) { super(m); } } }));
import { contextoDoAtendimento, segundaViaDoAtendimento } from "./chat-contexto.service";
const cliente = { id: 42, nome: "Maria", documento: "12345678909", telefone: "0000000000", endereco: "Rua Exemplo", numero: "100", statusContrato: "active", credito: 600, risco: "low", divida: "200", diasAtraso: 20 };
beforeEach(() => {
  vi.resetAllMocks();
  fake.getConversaDoChat.mockResolvedValue({ customerId: 42 });
  fake.clienteDoAtendimento.mockResolvedValue(cliente);
  fake.contextoFinanceiroDoChat.mockResolvedValue({ faturas: [], temMaisFaturas: false, pagamentos: { pagas: 4, comData: 2, pontuais: 1 }, contrato: null, ordens: [] });
  fake.getErpIntegrations.mockResolvedValue([{ providerId: 6, erpSource: "sgp", isEnabled: true }]);
  erp.snapshot.mockResolvedValue({ ok: true, erpSource: "sgp", lidoEm: "2026-09-06T12:00:00Z", cliente: { plano: "Fibra 500", dividaAtual: 100, diasAtraso: 10, faturas: [{ ref: "123", valor: 100, vencimento: "2026-09-01" }] } });
  erp.segundaVia.mockResolvedValue({ link: "https://erp.example/b/123", pix: null, linhaDigitavel: null, valor: 102, vencimento: "2026-09-10" });
});
describe("ficha financeira dentro do chat", () => {
  it("usa cadastro da conversa e apenas pagamentos confirmados com data na taxa", async () => {
    const r = await contextoDoAtendimento(6, "c1");
    expect(fake.clienteDoAtendimento).toHaveBeenCalledWith(6, 42);
    expect(r.cliente).toMatchObject({ nome: "Maria", plano: "Fibra 500", mensalidade: null, divida: 100 });
    expect(r.pagamentos).toEqual({ pagas: 4, comData: 2, pontualidade: 50 });
  });

  it("sem leitura do ERP e sem valor na base, dívida e atraso saem nulos — zero seria dizer que não deve nada", async () => {
    fake.clienteDoAtendimento.mockResolvedValue({ ...cliente, divida: null, diasAtraso: null });
    erp.snapshot.mockResolvedValue({ ok: false, erpSource: "sgp", lidoEm: "2026-09-06T12:00:00Z", cliente: null });
    const r = await contextoDoAtendimento(6, "c1");
    expect(r.cliente.divida).toBeNull();
    expect(r.cliente.diasAtraso).toBeNull();
    expect(r.erp.status).toBe("indisponivel");
  });

  it("o par (100, 'low') é o default da coluna, não um score: sai nulo, e o risco junto", async () => {
    fake.clienteDoAtendimento.mockResolvedValue({ ...cliente, credito: 100, risco: "low" });
    expect((await contextoDoAtendimento(6, "c1")).cliente).toMatchObject({ ispScore: null, risco: null });
  });

  it("score gravado de verdade continua saindo, com a faixa que veio junto", async () => {
    fake.clienteDoAtendimento.mockResolvedValue({ ...cliente, credito: 780, risco: "low" });
    expect((await contextoDoAtendimento(6, "c1")).cliente).toMatchObject({ ispScore: 780, risco: "low" });
  });

  it("faturas saem da mais antiga para a mais nova; sem vencimento legível vão ao fim e são contadas", async () => {
    erp.snapshot.mockResolvedValue({
      ok: true, erpSource: "sgp", lidoEm: "2026-09-06T12:00:00Z",
      cliente: { dividaAtual: 300, diasAtraso: 40, faturas: [
        { ref: "b", valor: 100, vencimento: "2026-08-10" },
        { ref: "sem", valor: 100, vencimento: "" },
        { ref: "a", valor: 100, vencimento: "2026-07-05" },
      ] },
    });
    const r = await contextoDoAtendimento(6, "c1");
    expect(r.faturas.map(f => f.ref)).toEqual(["a", "b", "sem"]);
    expect(r.faturasSemData).toBe(1);
  });
  it("leitura parcial não apaga dívida nem confirma ausência de faturas", async () => {
    erp.snapshot.mockResolvedValue({ ok: true, leituraParcial: true, erpSource: "sgp", cliente: { dividaAtual: 0, diasAtraso: 0, faturas: [] } });
    const r = await contextoDoAtendimento(6, "c1");
    expect(r.cliente.divida).toBe(200); expect(r.erp.status).toBe("parcial");
    expect(r.erp.financeiroAoVivo).toBe(false);
    expect(r.erp.valoresDe).toBe("base_sincronizada");
  });

  it("leitura ao vivo completa: o valor é do ERP de agora, e a ficha diz isso", async () => {
    const r = await contextoDoAtendimento(6, "c1");
    expect(r.cliente.divida).toBe(100);
    expect(r.erp).toMatchObject({ status: "disponivel", financeiroAoVivo: true, valoresDe: "ao_vivo", lidoEm: "2026-09-06T12:00:00Z", mensagem: null });
  });

  it("cliente PAGOU TUDO: o ERP responde sem fatura nenhuma, o valor cai para a varredura e a ficha marca que NÃO é leitura ao vivo", async () => {
    // O MK devolve `faturasAbertas: undefined` quando não há pendência; sem esta
    // marca, `status: "disponivel"` faria o saldo de três dias atrás passar por atual.
    fake.clienteDoAtendimento.mockResolvedValue({ ...cliente, sincronizadoEm: new Date("2026-09-03T06:00:00Z") });
    erp.snapshot.mockResolvedValue({ ok: true, erpSource: "mk", lidoEm: "2026-09-06T12:00:00Z", cliente: { dividaAtual: 0, diasAtraso: 0, faturas: undefined } });
    const r = await contextoDoAtendimento(6, "c1");
    expect(r.erp.status).toBe("disponivel");
    expect(r.erp.financeiroAoVivo).toBe(false);
    expect(r.erp.valoresDe).toBe("base_sincronizada");
    // A data do VALOR é a da varredura, não a da consulta ao ERP.
    expect(r.erp.lidoEm).toBe("2026-09-03T06:00:00.000Z");
    expect(r.erp.atualizadoEm).toBe("2026-09-06T12:00:00Z");
    expect(r.erp.mensagem).toContain("base sincronizada");
    expect(r.erp.mensagem).toContain("03/09/2026");
    expect(r.cliente.divida).toBe(200);
  });

  it("sem varredura registrada, o texto não inventa data — só diz a origem", async () => {
    erp.snapshot.mockResolvedValue({ ok: false, erpSource: "sgp", lidoEm: "2026-09-06T12:00:00Z", cliente: null });
    const r = await contextoDoAtendimento(6, "c1");
    expect(r.erp.mensagem).toBe("ERP indisponível. Exibindo o último cadastro sincronizado.");
    expect(r.erp).toMatchObject({ financeiroAoVivo: false, valoresDe: "base_sincronizada", lidoEm: null });
  });
  it("rejeita conversa de outro provedor antes de consultar o ERP", async () => {
    fake.getConversaDoChat.mockResolvedValue(undefined);
    await expect(segundaViaDoAtendimento(7, "c1", "123")).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
    expect(erp.snapshot).not.toHaveBeenCalled();
  });
  it("não consulta boleto por referência de outro cliente ou de fatura já paga", async () => {
    await expect(segundaViaDoAtendimento(6, "c1", "999")).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
    expect(erp.segundaVia).not.toHaveBeenCalled();
  });
  it("confere fatura novamente e conserva valor e vencimento da segunda via", async () => {
    const r = await segundaViaDoAtendimento(6, "c1", "123");
    expect(erp.snapshot).toHaveBeenCalledWith(6, "12345678909", { forcar: true });
    expect(r).toMatchObject({ valor: 102, vencimento: "2026-09-10", link: "https://erp.example/b/123" });
  });
});
