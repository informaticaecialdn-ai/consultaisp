import { beforeEach, describe, expect, it, vi } from "vitest";
import { POLITICA_PADRAO } from "@shared/cobranca/politica";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
const fake = vi.hoisted(() => ({ getPoliticaDeCobranca: vi.fn(), getUser: vi.fn(), criarNegociacao: vi.fn(), atualizarCasoDeCobranca: vi.fn(), ofertas: vi.fn(), autorizacao: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../storage/chat-autonomia-seguranca.storage", () => ({ segurancaAutonomiaStorage: fake }));
import { processarNegociacaoAutonoma } from "./chat-autonomia-negociacao.service";
let politica = structuredClone(POLITICA_PADRAO);
const agora = new Date("2026-09-08T15:00:00Z");
const base = { providerId: 42, conversationId: "c1", casoId: 10, customerId: 7, carteira: "ex_cliente" as const, saldo: 400, diasAtraso: 200, mensalidade: 100, vulneravel: false, permitir: true, agora };
beforeEach(() => {
  vi.resetAllMocks(); politica = structuredClone(POLITICA_PADRAO); politica.acordo.ex_cliente.origemDaCobranca = "manual";
  fake.getPoliticaDeCobranca.mockImplementation(async () => politica);
  fake.autorizacao.mockResolvedValue(8); fake.getUser.mockResolvedValue({ id: 8, providerId: 42, role: "admin" });
  fake.criarNegociacao.mockResolvedValue({ id: 99 });
});
async function rodada(texto: string, messageId: string, ofertas: OfertasAutonomia | null = null) { return processarNegociacaoAutonoma({ ...base, texto, messageId, ofertas }); }
const salvas = () => fake.ofertas.mock.calls.at(-1)?.[2] as OfertasAutonomia;
describe("acordo autônomo: oferta, seleção, consentimento e gravação", () => {
  it("só persiste após seleção e sim em outra mensagem; usa parcelas calculadas e aprovação explícita", async () => {
    expect((await rodada("tem desconto?", "m1"))?.acao).toBe("responder");
    let ofertas = salvas(); expect(fake.criarNegociacao).not.toHaveBeenCalled();
    const selecao = await rodada("opção 2 para 09/09", "m2", ofertas);
    expect(selecao).toMatchObject({ acao: "responder", resposta: expect.stringContaining("Confirma") });
    ofertas = salvas(); expect(fake.criarNegociacao).not.toHaveBeenCalled();
    const aceite = await rodada("sim", "m3", ofertas);
    expect(aceite).toMatchObject({ acao: "responder", precisaEmissao: true, resposta: expect.stringContaining("registrado") });
    expect(fake.criarNegociacao).toHaveBeenCalledWith(42, expect.objectContaining({ casoId: 10, tipo: "parcelamento", valorOriginal: 400, valorNegociado: 320, entrada: 64, aceita: true, criadoPorUserId: 8, aprovacao: expect.objectContaining({ exigeAprovacao: false }) }), expect.arrayContaining([expect.objectContaining({ numero: 1, valor: 42.66, vencimento: "2026-09-09" })]));
  });
  it("mudança de política ou perda da autorização impede criação", async () => {
    await rodada("tem desconto?", "m1");
    await rodada("opção 1 para 09/09", "m2", salvas());
    const oferta = salvas(); politica.negociacao.descontoMaxPct = 10;
    expect((await rodada("sim", "m3", oferta))?.acao).toBe("humano");
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
    fake.getUser.mockResolvedValueOnce({ id: 8, providerId: 99, role: "admin" });
    expect((await rodada("tem desconto?", "m4"))?.acao).toBe("humano");
  });
  it("contraproposta acima da faixa não persiste nem concede desconto", async () => {
    expect((await rodada("quero desconto de 90%", "m1"))?.acao).toBe("humano");
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
  });
  it("sem origem definida mantém pagamento integral pela segunda via ERP, sem criar acordo", async () => {
    politica.acordo.ex_cliente.origemDaCobranca = "nao_definida";
    const r = await rodada("tem desconto?", "m1");
    expect(r).toMatchObject({ acao: "responder", resposta: expect.stringContaining("segunda via do ERP") });
    expect(fake.ofertas).not.toHaveBeenCalled();
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
  });
});
