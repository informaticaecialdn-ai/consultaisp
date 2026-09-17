/**
 * O contrato da autonomia com o fork e a chave D9 da funcionária digital.
 *
 * - A configuração é LIDA com tolerância a chave desconhecida (achado e9): um
 *   JSON gravado por uma versão mais nova não desliga a autonomia numa volta de
 *   deploy. Valor inválido continua caindo no padrão desligado.
 * - A chave D9 mora fora desse objeto e nasce desligada; só `ativa === true` liga.
 * - O plano aceita `mensagens` de 1 a 3 balões de até 600 caracteres — os
 *   mesmos limites do verificador, conferidos aqui para não se afastarem.
 */
import { describe, expect, it } from "vitest";
import { ConfigAutonomiaSchema, FuncionariaDigitalSchema, LIMITES_DO_PLANO_ESCRITO, PlanoRespostaSchema, lerConfigAutonomia, lerFuncionariaDigital } from "./chat-autonomia";
import { LIMITES_DAS_MENSAGENS } from "./chat-funcionaria-digital";

describe("configuração da autonomia, lida com tolerância", () => {
  it("chave desconhecida gravada por outra versão não derruba a autonomia: ativa continua true e a chave some", () => {
    const lida = lerConfigAutonomia({ ativa: true, maxTurnos: 8, tipos: ["cobranca_ativos"], redacaoPelaFuncionaria: true, chaveDoFuturo: { x: 1 } });
    expect(lida).toMatchObject({ ativa: true, maxTurnos: 8, tipos: ["cobranca_ativos"] });
    expect(lida).not.toHaveProperty("redacaoPelaFuncionaria");
    expect(lida).not.toHaveProperty("chaveDoFuturo");
    // E o que sai da leitura passa na gravação estrita da rota.
    expect(ConfigAutonomiaSchema.safeParse(lida).success).toBe(true);
  });
  it("valor inválido continua caindo no padrão desligado; a gravação segue estrita", () => {
    expect(lerConfigAutonomia({ ativa: true, maxTurnos: 99 })).toMatchObject({ ativa: false, maxTurnos: 12 });
    expect(lerConfigAutonomia({ ativa: "sim" }).ativa).toBe(false);
    expect(lerConfigAutonomia(null).ativa).toBe(false);
    expect(ConfigAutonomiaSchema.safeParse({ ativa: true, chaveNova: 1 }).success).toBe(false);
  });
});

describe("D9 — a chave da funcionária digital", () => {
  it("nasce desligada: sem integração, sem chave ou com agenteConfig vazio", () => {
    for (const agenteConfig of [undefined, null, {}, { agentes: {} }, [], "ativa"]) expect(lerFuncionariaDigital(agenteConfig)).toEqual({ ativa: false });
  });
  it("leitura tolerante: só ativa === true liga, e os campos de auditoria ao lado são ignorados", () => {
    expect(lerFuncionariaDigital({ funcionariaDigital: { ativa: true, atualizadaEm: "2026-09-17T03:00:00Z", atualizadaPorUserId: 7 } })).toEqual({ ativa: true });
    for (const chave of [{ ativa: "true" }, { ativa: 1 }, { ativa: false }, { ligada: true }, true, "ativa", null, [{ ativa: true }]]) {
      expect(lerFuncionariaDigital({ funcionariaDigital: chave }), JSON.stringify(chave)).toEqual({ ativa: false });
    }
  });
  it("a chave não mora na configuração da autonomia: gravá-la lá seria recusado pelo schema estrito", () => {
    expect(ConfigAutonomiaSchema.safeParse({ ativa: true, funcionariaDigital: { ativa: true } }).success).toBe(false);
  });
  it("a escrita aceita só { ativa: boolean }", () => {
    expect(FuncionariaDigitalSchema.safeParse({ ativa: true }).success).toBe(true);
    for (const corpo of [{}, { ativa: "sim" }, { ativa: true, providerId: 9 }, null]) expect(FuncionariaDigitalSchema.safeParse(corpo).success).toBe(false);
  });
});

describe("o plano com balões (vps/009)", () => {
  it("mensagens é opcional: o plano do 008 continua valendo", () => {
    expect(PlanoRespostaSchema.parse({ acao: "responder", resposta: "acolher" })).toEqual({ acao: "responder", resposta: "acolher" });
  });
  it("aceita de 1 a 3 balões de 1 a 600 caracteres, em qualquer ação", () => {
    expect(PlanoRespostaSchema.parse({ acao: "responder", mensagens: ["Oi, Maria!"] }).mensagens).toEqual(["Oi, Maria!"]);
    expect(PlanoRespostaSchema.parse({ acao: "promessa", data: "2026-09-20", valor: 150, mensagens: ["a", "b", "x".repeat(600)] }).mensagens).toHaveLength(3);
    expect(PlanoRespostaSchema.parse({ acao: "transferir", mensagens: ["Vou pedir pra alguém da equipe continuar com você por aqui, tá?"] }).acao).toBe("transferir");
    for (const mensagens of [[], ["a", "b", "c", "d"], [""], ["x".repeat(601)], "Oi", [1]]) {
      expect(PlanoRespostaSchema.safeParse({ acao: "responder", mensagens }).success, JSON.stringify(mensagens)).toBe(false);
    }
  });
  it("os limites do contrato são os do verificador", () => {
    expect(LIMITES_DO_PLANO_ESCRITO.baloes).toBe(LIMITES_DAS_MENSAGENS.baloes);
    expect(LIMITES_DO_PLANO_ESCRITO.caracteresPorBalao).toBe(LIMITES_DAS_MENSAGENS.caracteresPorBalao);
  });
});
