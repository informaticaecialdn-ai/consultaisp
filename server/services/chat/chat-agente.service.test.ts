import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A porta do agente sob contrato: a chave identifica o provedor (hash, tempo
 * constante); o caso sai pelo telefone com os numeros REAIS e a instrucao
 * montada da regua, do DNA e da politica — ou "nao encontrado" honesto; a
 * promessa vira evento no caso vivo e move o proximo contato; a
 * transferencia vira nota. Telefone nunca vai ao log.
 */

vi.mock("../../db", () => ({ pool: {}, db: {} }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }));
vi.mock("../../logger", () => ({ logger: log }));

const fake = vi.hoisted(() => ({
  integracao: undefined as any,
  cliente: undefined as any,
  casoVivo: undefined as any,
  detalhe: undefined as any,
  eventos: [] as any[],
  gravados: [] as any[],
  patches: [] as any[],
}));
vi.mock("../../storage", () => ({
  storage: {
    getIntegracaoDoChatPorChave: vi.fn(async () => fake.integracao),
    getCustomerByPhoneDigits: vi.fn(async () => fake.cliente),
    casoAbertoDoCliente: vi.fn(async () => fake.casoVivo),
    obterCasoDeCobranca: vi.fn(async () => fake.detalhe),
    listarEventosDoCaso: vi.fn(async () => fake.eventos),
    registrarEventoDeCobranca: vi.fn(async (_p: number, ev: any) => { fake.gravados.push(ev); return { id: 900 + fake.gravados.length, ...ev }; }),
    atualizarCasoDeCobranca: vi.fn(async (_p: number, id: number, patch: any) => { fake.patches.push({ id, patch }); return { id }; }),
  },
}));
// As regras da cobranca vem da rota (exportadas de la); aqui sao substitutas com o mesmo contrato.
vi.mock("../../routes/cobranca.routes", () => ({
  carregarPolitica: vi.fn(async () => ({
    politica: { negociacao: { maxParcelas: 6, entradaMinimaPct: 20, descontoMaxPct: 15, saldoMinimoParcelar: 150 }, encargos: { multaPct: 2, jurosMesPct: 1 } },
    etapas: [],
    configurada: true,
    updatedAt: null,
  })),
  classificarCliente: vi.fn(() => ({ mesesComoCliente: 30, dna: { quadrante: "B3" }, tom: "cuidado" })),
  reguaParaHoje: vi.fn(() => ({ etapa: { id: "negociacao_recuperacao", rotulo: "Negociação", diaMin: 30, diaMax: 59, acao: "Oferecer parcelamento com cordialidade.", canalSugerido: "whatsapp" }, motivo: null, motivoRotulo: null })),
  carteiraValida: vi.fn((v: string) => v),
}));
vi.mock("../../storage/cobranca.storage", () => ({ carteiraDoStatusErp: vi.fn(() => "ativo") }));

import { casoParaAgente, gerarChaveDoAgente, hashDaChave, provedorDaChave, registrarPromessaDoAgente, registrarTransferenciaDoAgente } from "./chat-agente.service";

const CLIENTE = { id: 42, name: "Maria da Silva", phone: "(43) 99999-0000", city: "Londrina", status: "active", totalOverdueAmount: "189.90", maxDaysOverdue: 47, overdueInvoicesCount: 2, contractStartDate: "2024-01-10" };
const DETALHE = { id: 10, status: "em_contato", carteira: "ativo", valorAtual: 189.9, responsavelNome: "Ana", cliente: { id: 42 } };

beforeEach(() => {
  fake.integracao = undefined;
  fake.cliente = CLIENTE;
  fake.casoVivo = { id: 10 };
  fake.detalhe = DETALHE;
  fake.eventos = [];
  fake.gravados.length = 0;
  fake.patches.length = 0;
  vi.clearAllMocks();
});

describe("a chave do agente", () => {
  it("gera com prefixo e entropia; o hash e sha256 estavel", () => {
    const a = gerarChaveDoAgente();
    const b = gerarChaveDoAgente();
    expect(a).toMatch(/^isp_ag_[A-Za-z0-9_-]{30,}$/);
    expect(a).not.toBe(b);
    expect(hashDaChave(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDaChave(a)).toBe(hashDaChave(a));
  });
  it("identifica o provedor pelo hash; chave errada, curta ou ausente = null", async () => {
    const chave = gerarChaveDoAgente();
    fake.integracao = { providerId: 6, organizationId: "org_1", chaveAgenteHash: hashDaChave(chave) };
    expect(await provedorDaChave(chave)).toEqual({ providerId: 6, organizationId: "org_1" });
    expect(await provedorDaChave(undefined)).toBeNull();
    expect(await provedorDaChave("curta")).toBeNull();
    fake.integracao = undefined;
    expect(await provedorDaChave(chave)).toBeNull();
  });
});

describe("casoParaAgente", () => {
  it("telefone invalido ou cliente desconhecido: encontrado=false com a instrucao de nao cobrar", async () => {
    expect((await casoParaAgente(6, "123")).encontrado).toBe(false);
    fake.cliente = undefined;
    const r = await casoParaAgente(6, "43999990000");
    expect(r.encontrado).toBe(false);
    expect(r.instrucao).toMatch(/Nao cobre nada/);
  });
  it("cliente com caso vivo: numeros reais, etapa, tom, politica e a instrucao com teto de desconto e parcelas", async () => {
    const r = await casoParaAgente(6, "43999990000");
    expect(r.encontrado).toBe(true);
    expect(r.cliente).toMatchObject({ primeiroNome: "Maria", cidade: "Londrina", situacaoContrato: "ativo", clienteHaMeses: 30 });
    expect(r.caso).toMatchObject({ id: 10, status: "em_contato", valorEmAberto: 189.9, diasAtraso: 47, faturasVencidas: 2, prescrita: false, responsavel: "Ana" });
    expect(r.caso!.etapa).toMatchObject({ rotulo: "Negociação", acao: "Oferecer parcelamento com cordialidade.", canalSugerido: "WhatsApp" });
    expect(r.tom).toMatchObject({ quadrante: "B3", tom: "cuidado" });
    expect(r.tom!.diretiva).toBeTruthy();
    expect(r.politica).toEqual({ descontoMaxPct: 15, maxParcelas: 6, entradaMinimaPct: 20, saldoMinimoParcelar: 150, multaPct: 2, jurosMesPct: 1 });
    expect(r.instrucao).toContain("189,90");
    expect(r.instrucao).toContain("47 dias");
    expect(r.instrucao).toContain("Oferecer parcelamento");
    expect(r.instrucao).toContain("15%");
    expect(r.instrucao).toContain("6x");
    expect(r.instrucao).toContain("entrada minima de 20%");
    expect(r.promessaAberta).toBeNull();
  });
  it("sem divida: instrucao de nao cobrar; prescrita: instrucao de transferir", async () => {
    fake.cliente = { ...CLIENTE, totalOverdueAmount: "0", maxDaysOverdue: 0, overdueInvoicesCount: 0 };
    fake.casoVivo = undefined; fake.detalhe = undefined;
    expect((await casoParaAgente(6, "43999990000")).instrucao).toMatch(/NAO tem divida vencida/);
    fake.cliente = { ...CLIENTE, maxDaysOverdue: 5 * 365 + 10 };
    expect((await casoParaAgente(6, "43999990000")).instrucao).toMatch(/PRESCRITA/);
  });
  it("promessa aberta (data futura) vai na resposta e na instrucao; promessa vencida nao", async () => {
    const futuro = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    fake.eventos = [
      { tipo: "promessa", ocorridoEm: new Date(Date.now() - 86_400_000), metadata: { dataPrometida: "2020-01-01", valor: 50 } },
      { tipo: "promessa", ocorridoEm: new Date(), metadata: { dataPrometida: futuro, valor: 100 } },
    ];
    const r = await casoParaAgente(6, "43999990000");
    expect(r.promessaAberta).toMatchObject({ data: futuro, valor: 100 });
    expect(r.instrucao).toContain("Ja existe promessa");
    fake.eventos = [{ tipo: "promessa", ocorridoEm: new Date(), metadata: { dataPrometida: "2020-01-01", valor: 50 } }];
    expect((await casoParaAgente(6, "43999990000")).promessaAberta).toBeNull();
  });
  it("o telefone nao vai ao log", async () => {
    await casoParaAgente(6, "43999990000");
    expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])).not.toContain("99999");
  });
});

describe("registrarPromessaDoAgente", () => {
  const base = { telefone: "43999990000", dataPrometida: "2026-09-20", valor: 149.9, observacao: "vai pagar dia 20", conversaId: "conv_1" };
  it("sem cliente ou sem caso vivo: ok=false com o motivo, nada gravado", async () => {
    fake.cliente = undefined;
    expect(await registrarPromessaDoAgente(6, base)).toMatchObject({ ok: false, encontrado: false });
    fake.cliente = CLIENTE; fake.casoVivo = undefined;
    expect((await registrarPromessaDoAgente(6, base)).ok).toBe(false);
    expect(fake.gravados).toEqual([]);
  });
  it("data invalida e recusada", async () => {
    expect((await registrarPromessaDoAgente(6, { ...base, dataPrometida: "20/09/2026" })).ok).toBe(false);
    expect((await registrarPromessaDoAgente(6, { ...base, dataPrometida: "2026-13-45" })).ok).toBe(false);
  });
  it("grava o evento `promessa` no caso, com metadata, e move o proximo contato para a data", async () => {
    const r = await registrarPromessaDoAgente(6, base);
    expect(r.ok).toBe(true);
    expect(fake.gravados[0]).toMatchObject({ casoId: 10, userId: null, tipo: "promessa", canal: "whatsapp", resultado: "promessa_pagamento" });
    expect(fake.gravados[0].metadata).toMatchObject({ origem: "agente_chat", dataPrometida: "2026-09-20", valor: 149.9, conversaId: "conv_1" });
    expect(fake.gravados[0].notas).toContain("2026-09-20");
    expect(fake.patches[0].id).toBe(10);
    expect(fake.patches[0].patch.proximoContatoEm.toISOString().slice(0, 10)).toBe("2026-09-20");
  });
  it("valor ausente ou invalido vira null, sem quebrar", async () => {
    await registrarPromessaDoAgente(6, { ...base, valor: null });
    expect(fake.gravados[0].metadata.valor).toBeNull();
  });
});

describe("registrarTransferenciaDoAgente", () => {
  it("vira nota no caso com o motivo e o resumo; sem caso, resposta honesta", async () => {
    const r = await registrarTransferenciaDoAgente(6, { telefone: "43999990000", motivo: "cliente contestou a divida", resumo: "diz que pagou dia 3", conversaId: "conv_1" });
    expect(r.ok).toBe(true);
    expect(fake.gravados[0]).toMatchObject({ casoId: 10, tipo: "nota", canal: "whatsapp" });
    expect(fake.gravados[0].notas).toContain("contestou a divida");
    expect(fake.gravados[0].metadata).toMatchObject({ origem: "agente_chat", transferencia: true });
    fake.casoVivo = undefined;
    expect((await registrarTransferenciaDoAgente(6, { telefone: "43999990000", motivo: null, resumo: null, conversaId: null })).ok).toBe(false);
  });
});
