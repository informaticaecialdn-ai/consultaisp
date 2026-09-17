import { beforeEach, describe, expect, it, vi } from "vitest";
import { POLITICA_PADRAO } from "@shared/cobranca/politica";
import type { OfertasAutonomia } from "@shared/chat-autonomia-seguranca";
const fake = vi.hoisted(() => ({ getPoliticaDeCobranca: vi.fn(), getUser: vi.fn(), criarNegociacao: vi.fn(), atualizarCasoDeCobranca: vi.fn(), ofertas: vi.fn(), autorizacao: vi.fn(), ler: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../storage/chat-autonomia-seguranca.storage", () => ({ segurancaAutonomiaStorage: fake }));
import { processarNegociacaoAutonoma, type ResultadoNegociacao } from "./chat-autonomia-negociacao.service";
let politica = structuredClone(POLITICA_PADRAO);
const agora = new Date("2026-09-08T15:00:00Z");
// identidade confirmada meia hora antes, ainda no episódio: o aceite de acordo exige no máximo 2 h (D10)
const identidadeDe = (confirmadaHaMs: number, customerId = 7) => ({ providerId: 42, conversationId: "c1", customerId, telefone: "5543999990000", cadastroHash: "h", tentativas: 0,
  desafiadaEm: new Date(agora.getTime() - confirmadaHaMs).toISOString(), ultimaMensagemId: "m0", confirmadaEm: new Date(agora.getTime() - confirmadaHaMs).toISOString(),
  validaAte: new Date(agora.getTime() + 60 * 60_000).toISOString() });
const base = { providerId: 42, conversationId: "c1", casoId: 10, customerId: 7, carteira: "ex_cliente" as const, saldo: 400, diasAtraso: 200, mensalidade: 100, vulneravel: false, permitir: true, permitirSegundaVia: true, agora };
beforeEach(() => {
  vi.resetAllMocks(); politica = structuredClone(POLITICA_PADRAO); politica.acordo.ex_cliente.origemDaCobranca = "manual";
  fake.getPoliticaDeCobranca.mockImplementation(async () => politica);
  fake.autorizacao.mockResolvedValue(8); fake.getUser.mockResolvedValue({ id: 8, providerId: 42, role: "admin" });
  fake.criarNegociacao.mockResolvedValue({ id: 99 });
  fake.ler.mockResolvedValue({ identidade: identidadeDe(30 * 60_000), ofertas: null });
});
async function rodada(texto: string, messageId: string, ofertas: OfertasAutonomia | null = null, extra: Record<string, unknown> = {}) { return processarNegociacaoAutonoma({ ...base, texto, messageId, ofertas, ...extra }); }
const salvas = () => fake.ofertas.mock.calls.at(-1)?.[2] as OfertasAutonomia;
const textos = (r: ResultadoNegociacao) => (r && r.acao === "responder" ? ("baloes" in r ? r.baloes.join("\n") : "linhas" in r ? r.linhas : "") : "");
describe("acordo autônomo: oferta, seleção, consentimento e gravação", () => {
  it("só persiste após seleção e sim em outra mensagem; usa parcelas calculadas e aprovação explícita", async () => {
    const opcoes = await rodada("tem desconto?", "m1");
    expect(opcoes).toMatchObject({ acao: "responder", etapa: "ofertas" });
    let ofertas = salvas(); expect(fake.criarNegociacao).not.toHaveBeenCalled();
    const selecao = await rodada("opção 2 para 09/09", "m2", ofertas);
    expect(selecao).toMatchObject({ acao: "responder", etapa: "aceite" });
    expect(textos(selecao)).toMatch(/Posso registrar o acordo\?/);
    ofertas = salvas(); expect(fake.criarNegociacao).not.toHaveBeenCalled();
    const aceite = await rodada("sim", "m3", ofertas);
    expect(aceite).toMatchObject({ acao: "responder", etapa: "acordo_registrado", precisaEmissao: true, gravado: { tipo: "acordo", data: "2026-09-09", valorCentavos: 6400 } });
    expect(fake.criarNegociacao).toHaveBeenCalledWith(42, expect.objectContaining({ casoId: 10, tipo: "parcelamento", valorOriginal: 400, valorNegociado: 320, entrada: 64, aceita: true, criadoPorUserId: 8, aprovacao: expect.objectContaining({ exigeAprovacao: false }) }), expect.arrayContaining([expect.objectContaining({ numero: 1, valor: 42.66, vencimento: "2026-09-09" })]));
  });
  it("as linhas e a pergunta do aceite são do servidor, na voz da funcionária: dd/mm, R$ com espaço comum, sem ERP nem data ISO", async () => {
    const opcoes = await rodada("tem desconto?", "m1");
    const linhas = textos(opcoes);
    expect(linhas).toMatch(/^Opção 1: R\$ \d/m);
    expect(linhas).toMatch(/Opção 2: entrada de R\$ 64,00 \+ 6 parcelas de R\$ 42,66 \(a última de R\$ 42,70\), total de R\$ 320,00/);
    expect(linhas).toMatch(/até \d{2}\/\d{2}/);
    expect(linhas).not.toMatch(/\d{4}-\d{2}-\d{2}|ERP|\u00a0/);
    const aceite = textos(await rodada("opção 2 para 09/09", "m2", salvas()));
    expect(aceite).toContain("pro dia 09/09");
    expect(aceite).not.toMatch(/\d{4}-\d{2}-\d{2}|ERP|\u00a0|#/);
  });
  it("aceite com identidade de mais de 2 h pede os dígitos de novo SEM perder a opção; de outro cliente ou sem identidade não grava (D10)", async () => {
    await rodada("tem desconto?", "m1");
    await rodada("opção 2 para 09/09", "m2", salvas());
    const selecionada = salvas();
    fake.ofertas.mockClear();
    fake.ler.mockResolvedValueOnce({ identidade: identidadeDe(3 * 60 * 60_000), ofertas: null });
    expect(await rodada("sim", "m3", selecionada)).toEqual({ acao: "pedir_identidade", motivo: "Aceite de acordo exige identidade confirmada nas últimas 2 horas" });
    // nada apaga a opção escolhida: o "sim" depois dos dígitos ainda a encontra
    expect(fake.ofertas).not.toHaveBeenCalled();
    for (const identidade of [identidadeDe(30 * 60_000, 8), null]) {
      fake.ler.mockResolvedValueOnce({ identidade, ofertas: null });
      expect(await rodada("sim", "m3", selecionada)).toMatchObject({ acao: "humano" });
    }
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
    expect((await rodada("sim", "m3", selecionada))?.acao).toBe("responder");
    expect(fake.criarNegociacao).toHaveBeenCalledTimes(1);
  });
  it("na volta do novo desafio (só os dígitos), a pergunta do aceite é repetida em vez de ir à equipe", async () => {
    await rodada("tem desconto?", "m1");
    await rodada("opção 2 para 09/09", "m2", salvas());
    const selecionada = salvas();
    expect(await rodada("8909", "m4", selecionada, { identidadeRecemConfirmada: true })).toMatchObject({ acao: "responder", etapa: "aceite" });
    expect(await rodada("8909", "m4", selecionada)).toMatchObject({ acao: "humano" });
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
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
  it("sem origem definida mantém pagamento integral pela segunda via, sem criar acordo", async () => {
    politica.acordo.ex_cliente.origemDaCobranca = "nao_definida";
    const r = await rodada("tem desconto?", "m1");
    expect(r).toMatchObject({ acao: "responder", etapa: "somente_integral" });
    expect(textos(r)).toMatch(/valor total, de R\$ 400,00, pela segunda via/);
    expect(textos(r)).not.toMatch(/ERP/);
    expect(fake.ofertas).not.toHaveBeenCalled();
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
  });
  it("sem origem definida e segunda via desautorizada transfere sem oferecer a função", async () => {
    politica.acordo.ex_cliente.origemDaCobranca = "nao_definida";
    expect(await processarNegociacaoAutonoma({ ...base, permitirSegundaVia: false, texto: "tem desconto?", messageId: "m1", ofertas: null })).toMatchObject({ acao: "humano" });
    expect(fake.ofertas).not.toHaveBeenCalled();
    expect(fake.criarNegociacao).not.toHaveBeenCalled();
  });
});
