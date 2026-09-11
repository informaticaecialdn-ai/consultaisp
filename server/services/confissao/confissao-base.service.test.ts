import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A base é a parte que decide o que se confessa. O que se prova: acordo usa só
 * as parcelas em aberto e guarda o recebido; saldo integral exige leitura ao
 * vivo, bate Σ faturas com a dívida do ERP, separa multa/equipamento em linhas
 * desmarcáveis e soma encargos só no serviço; os bloqueios da spec §8; o hash
 * muda quando a base muda e não muda com o relógio.
 */
const storageMock = vi.hoisted(() => ({
  obterCliente: vi.fn(async (): Promise<any> => cliente()),
  getCustomersByProvider: vi.fn(async (): Promise<any[]> => [cliente()]),
  getProvider: vi.fn(async (): Promise<any> => ({ id: 1, name: "NsLink Telecom Ltda", tradeName: "NsLink", cnpj: "12345678000199", addressStreet: "Rua A", addressNumber: "10", addressNeighborhood: "Centro", addressCity: "Lavras do Norte", addressState: "MG", addressZip: "39000000" })),
  casoAbertoDoCliente: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto", customerId: 42 })),
  listarNegociacoesDoCaso: vi.fn(async (): Promise<any[]> => []),
  getPoliticaDeCobranca: vi.fn(async (): Promise<any> => undefined),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => integracao()),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const snapshotMock = vi.hoisted(() => ({ snapshotAoVivoDoCliente: vi.fn(async (): Promise<any> => snapshot()) }));
vi.mock("../cobranca/snapshot-ao-vivo.service", () => snapshotMock);
vi.mock("../chat/chat-ponte.service", () => ({ estadoDaIntegracao: vi.fn(async () => ({ ligado: true, canal: { id: "c1" } })) }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { estadoDaAssinatura, hashDaBase, montarBase } from "./confissao-base.service";

const HOJE = new Date(2026, 8, 10, 10, 0); // 10/09/2026
function cliente(extra: Record<string, unknown> = {}) {
  return { id: 42, providerId: 1, name: "Maria da Silva", cpfCnpj: "12345678901", email: "maria@example.com", phone: "31999990000", address: "Rua B", addressNumber: "20", neighborhood: "Bairro", city: "Lavras do Norte", state: "MG", cep: "39000000", status: "suspended", erpCustomerId: "4471", contractPlan: "Fibra 300", contractStartDate: "2024-03-15", totalOverdueAmount: "819.76", ...extra };
}
function integracao(extra: Record<string, unknown> = {}) {
  return { apiToken: "tok", ambiente: "producao", templateId: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null, isEnabled: true, webhookSecret: "s", ...extra };
}
function snapshot(extra: Record<string, unknown> = {}) {
  return { ok: true, erpSource: "mk", encontrado: false === extra.encontrado ? false : true, leituraParcial: false, lidoEm: "2026-09-10T13:00:00.000Z", cliente: {
    nome: "Maria da Silva", plano: "Fibra 300", statusContrato: "suspended", dividaAtual: 819.76, diasAtraso: 62, faturasAbertas: 2, email: "maria@example.com", telefone: "31999990000", contractStartDate: "2024-03-15",
    faturas: [
      { ref: "F-1", vencimento: "2026-07-10", valor: 99.9, descricao: "Mensalidade 07/2026" },
      { ref: "F-2", vencimento: "2026-08-10", valor: 719.86, descricao: "Multa rescisória R$ 619,96 + mensalidade 99,90" },
      { ref: "F-3", vencimento: "2026-10-10", valor: 99.9, descricao: "Mensalidade 10/2026" },
    ],
  }, ...extra };
}

beforeEach(() => { vi.clearAllMocks(); storageMock.obterCliente.mockResolvedValue(cliente()); storageMock.getIntegracaoComCredencial.mockResolvedValue(integracao()); snapshotMock.snapshotAoVivoDoCliente.mockResolvedValue(snapshot()); });

describe("saldo integral", () => {
  it("lê o ERP ao vivo (forçado), só faturas vencidas, divide multa com valor em linha própria e soma encargos só no serviço", async () => {
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(snapshotMock.snapshotAoVivoDoCliente).toHaveBeenCalledWith(1, "12345678901", { forcar: true });
    expect(b.dto.origem).toBe("saldo_integral");
    expect(b.dto.anexo.map(a => a.chave)).toEqual(["F-1", "F-2", "F-2#multa"]);
    const servico = b.dto.anexo.find(a => a.chave === "F-2")!;
    const multa = b.dto.anexo.find(a => a.chave === "F-2#multa")!;
    expect(servico).toMatchObject({ classe: "servico", valor: 99.9, diasAtraso: 31 });
    expect(multa).toMatchObject({ classe: "multa", valor: 619.96, multa: 0, juros: 0 });
    expect(b.dto.faturasDeSaida).toEqual(["F-2#multa"]);
    expect(b.dto.anexo.find(a => a.chave === "F-1")).toMatchObject({ multa: 2, juros: 2.06 }); // 99,90 × 2% e 99,90 × 1% × 62/30
    expect(b.dto.valorTotal).toBeCloseTo(99.9 + 2 + 2.06 + 99.9 + 2 + 1.03 + 619.96, 2);
    expect(b.dto.parcelas).toHaveLength(1);
    expect(b.dto.vencimento).toEqual({ minimo: "2026-09-26", maximo: "2026-12-09", escolhido: null });
    expect(b.dto.bloqueios).toEqual([]);
    expect(b.dto.baseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.dto.previa).toMatchObject({ modelo: "padrao" });
  });
  it("desmarcar a multa recalcula o total; o vencimento escolhido entra na parcela e muda o hash", async () => {
    const a = await montarBase(1, 42, { hoje: HOJE });
    const b = await montarBase(1, 42, { hoje: HOJE, faturasExcluidas: ["F-2#multa"], vencimento: "2026-10-15" });
    expect(b.dto.valorTotal).toBeCloseTo(a.dto.valorTotal - 619.96, 2);
    expect(b.dto.parcelas[0].vencimento).toBe("2026-10-15");
    expect(b.dto.baseHash).not.toBe(a.dto.baseHash);
    const c = await montarBase(1, 42, { hoje: HOJE, faturasExcluidas: ["F-2#multa"], vencimento: "2026-10-15" });
    expect(c.dto.baseHash).toBe(b.dto.baseHash);
  });
  it("vencimento fora da janela é bloqueio; sem ERP ao vivo não se emite; leitura parcial também não", async () => {
    expect((await montarBase(1, 42, { hoje: HOJE, vencimento: "2026-09-20" })).dto.bloqueios).toContainEqual(expect.stringContaining("entre 26/09/2026 e 09/12/2026"));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce({ ok: false, erpSource: "mk", encontrado: false, cliente: null, erro: "timeout", lidoEm: "x" });
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem leitura ao vivo não se emite título"));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ leituraParcial: true }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem leitura ao vivo"));
  });
  it("Σ faturas ≠ dívida do ERP bloqueia e mostra os dois números; sem fatura vencida, nada a formalizar", async () => {
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 900 } }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.bloqueios).toContainEqual(expect.stringMatching(/R\$ 819,76.*R\$ 900,00/));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 0, faturas: [{ ref: "F-3", vencimento: "2026-10-10", valor: 99.9 }] } }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("nada a formalizar"));
  });
  it("fatura indeterminada acende o aviso; prescrita bloqueia", async () => {
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 300, faturas: [{ ref: "F-9", vencimento: "2026-06-10", valor: 300, descricao: "Mensalidade e multa" }] } }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.faturasIndeterminadas).toBe(1);
    expect(b.dto.avisos).toContainEqual(expect.stringContaining("mistura mensalidade e multa sem valores"));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 99.9, diasAtraso: 1900, faturas: [{ ref: "F-0", vencimento: "2021-06-10", valor: 99.9, descricao: "Mensalidade" }] } }));
    const p = await montarBase(1, 42, { hoje: HOJE });
    expect(p.dto.prescrita).toBe(true);
    expect(p.dto.bloqueios).toContainEqual(expect.stringContaining("CC art. 191"));
  });
  it("uma nova leitura ao vivo com outra hora não muda o hash da mesma dívida", async () => {
    const a = await montarBase(1, 42, { hoje: HOJE });
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ lidoEm: "2026-09-10T13:00:05.000Z" }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.erpLidoEm).not.toBe(a.dto.erpLidoEm);
    expect(b.dto.baseHash).toBe(a.dto.baseHash);
  });
});

describe("acordo", () => {
  const negociacao = () => ({ id: 3, status: "aceita", valorOriginal: "1000.00", valorNegociado: "800.00", descontoPct: "20.00", entrada: "200.00", parcelas: 2, parcelamento: [
    { id: 30, numero: 0, valor: "200.00", vencimento: "2026-09-01", status: "paga", valorPago: "200.00" },
    { id: 31, numero: 1, valor: "300.00", vencimento: "2026-10-01", status: "pendente", valorPago: null },
    { id: 32, numero: 2, valor: "300.00", vencimento: "2026-11-01", status: "atrasada", valorPago: null },
  ] });
  it("espelha só as parcelas em aberto, guarda o recebido e o desconto, e reconfere o saldo ao vivo", async () => {
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([negociacao()]);
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.origem).toBe("acordo");
    expect(b.dto.negociacaoId).toBe(3);
    expect(b.dto.parcelas).toEqual([{ n: 1, rotulo: "parcela", valor: 300, vencimento: "2026-10-01" }, { n: 2, rotulo: "parcela", valor: 300, vencimento: "2026-11-01" }]);
    expect(b.dto).toMatchObject({ valorTotal: 600, valorOriginal: 1000, descontoPct: 20, recebidoDoAcordo: 200 });
    expect(b.dto.anexo.length).toBeGreaterThan(0); // as faturas de origem, informativas
    expect(b.dto.anexo.every(l => l.multa === 0 && l.juros === 0)).toBe(true);
    expect(b.dto.bloqueios).toEqual([]);
  });
  it("entrada não recebida entra como 'entrada'; saldo do ERP menor que o do acordo bloqueia", async () => {
    const n = negociacao();
    n.parcelamento[0].status = "pendente";
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([n]);
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 500 } }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.parcelas[0]).toEqual({ n: 0, rotulo: "entrada", valor: 200, vencimento: "2026-09-01" });
    expect(b.dto.valorTotal).toBe(800);
    expect(b.dto.bloqueios).toContainEqual(expect.stringMatching(/saldo no ERP \(R\$ 500,00\) é menor que o do acordo \(R\$ 800,00\)/));
  });
});

describe("bloqueios de cadastro e configuração", () => {
  it("sem integração ativa, sem caso, sem documento, sem contato, PJ sem representante", async () => {
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(undefined);
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("assinatura eletrônica não configurada"));
    storageMock.casoAbertoDoCliente.mockResolvedValueOnce(undefined);
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("abra o caso antes"));
    storageMock.obterCliente.mockResolvedValueOnce(cliente({ cpfCnpj: "" }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem CPF/CNPJ"));
    storageMock.obterCliente.mockResolvedValueOnce(cliente({ email: null, phone: null }));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, email: null, telefone: null } }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem e-mail e sem telefone"));
    storageMock.obterCliente.mockResolvedValueOnce(cliente({ cpfCnpj: "11222333000181", name: "Padaria Ltda" }));
    const pj = await montarBase(1, 42, { hoje: HOJE });
    expect(pj.dto.cliente.pessoaJuridica).toBe(true);
    expect(pj.dto.bloqueios).toContainEqual(expect.stringContaining("representante legal"));
    storageMock.obterCliente.mockResolvedValueOnce(cliente({ cpfCnpj: "11222333000181", name: "Padaria Ltda" }));
    expect((await montarBase(1, 42, { hoje: HOJE, representante: { nome: "João", cpf: "98765432100" } })).dto.bloqueios).toEqual([]);
  });
  it("provedor assina exige representante (nome e e-mail) cadastrado", async () => {
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(integracao({ provedorAssina: true }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("representante (nome e e-mail)"));
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(integracao({ provedorAssina: true, signatarioNome: "Ana Link", signatarioEmail: "ana@nslink.com" }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).not.toContainEqual(expect.stringContaining("representante (nome e e-mail)"));
  });
  it("e-mail digitado inválido é bloqueio (não 400); nome de representante com menos de 3 letras conta como não informado", async () => {
    const b = await montarBase(1, 42, { hoje: HOJE, email: "maria@" });
    expect(b.dto.bloqueios).toContainEqual("e-mail do cliente inválido");
    expect((await montarBase(1, 42, { hoje: HOJE, email: " maria@example.com " })).dto.bloqueios).not.toContainEqual("e-mail do cliente inválido");
    storageMock.obterCliente.mockResolvedValueOnce(cliente({ cpfCnpj: "11222333000181", name: "Padaria Ltda" }));
    expect((await montarBase(1, 42, { hoje: HOJE, representante: { nome: "Jo", cpf: "98765432100" } })).dto.bloqueios).toContainEqual(expect.stringContaining("representante legal"));
  });
  it("lê UM cliente pelo id, escopado ao provedor — não a carteira inteira", async () => {
    await montarBase(1, 42, { hoje: HOJE });
    expect(storageMock.obterCliente).toHaveBeenCalledWith(1, 42);
    expect(storageMock.getCustomersByProvider).not.toHaveBeenCalled();
  });
  it("contato informado pelo operador substitui o do cadastro e marca alteração", async () => {
    const b = await montarBase(1, 42, { hoje: HOJE, email: "outro@example.com" });
    expect(b.dto.cliente.email).toBe("outro@example.com");
    expect(b.contatoAlterado).toBe(true);
    expect(b.dto.avisos).toContainEqual(expect.stringContaining("validação do CPF"));
    expect((await montarBase(1, 42, { hoje: HOJE })).contatoAlterado).toBe(false);
  });
  it("credencial ilegível vira bloqueio, não 500; a política do provedor define os encargos", async () => {
    const { ErroDeConfissao } = await import("../../assinatura/erro");
    storageMock.getIntegracaoComCredencial.mockRejectedValueOnce(new ErroDeConfissao("CREDENCIAL_ILEGIVEL", "não abre", 409));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("não abre"));
    // A linha gravada tem as MESMAS colunas da política inteira (validarPolitica recusa política pela metade).
    const { POLITICA_PADRAO } = await import("@shared/cobranca");
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({ ...structuredClone(POLITICA_PADRAO), encargos: { multaPct: 1, jurosMesPct: 0.5 }, updatedAt: null });
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.encargos).toMatchObject({ multaPct: 1, jurosMesPct: 0.5 });
  });
  it("o custo usa o telefone que vai ao ZapSign — o do ERP quando o cadastro não tem", async () => {
    storageMock.obterCliente.mockResolvedValueOnce(cliente({ phone: null }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.cliente.telefone).toBe("31999990000");
    expect(b.dto.custo.reais).toBe(0.5);
  });
  it("o hash é do JSON canônico e não leva a hora da leitura", () => {
    const base: any = { versao: "1.0", origem: "saldo_integral", parcelas: [], erpLidoEm: "2026-09-10T13:00:00.000Z" };
    expect(hashDaBase(base)).toBe(hashDaBase({ ...base, erpLidoEm: "2026-09-10T13:00:01.400Z" }));
    expect(hashDaBase(base)).not.toBe(hashDaBase({ ...base, origem: "acordo" }));
  });
});

describe("estado da assinatura", () => {
  it("resume configuração, ambiente, modelo, custo e chat", async () => {
    const e = await estadoDaAssinatura(1);
    expect(e).toMatchObject({ configurada: true, ativa: true, ambiente: "producao", modelo: "padrao", modeloRevisado: false, provedorAssina: false, authMode: "assinaturaTela-tokenWhatsapp", prazoAssinaturaDias: 15, chatDisponivel: true, motivo: null });
    expect(e.custo?.creditos).toBe(5);
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(undefined);
    expect(await estadoDaAssinatura(1)).toMatchObject({ configurada: false, ativa: false, motivo: expect.stringContaining("superadmin") });
  });
});
