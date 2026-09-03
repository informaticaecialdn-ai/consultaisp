import { describe, it, expect } from "vitest";
import { estadoDaIntegracao, integracaoNoAr, integracaoVisivelAoProvedor } from "./painel-provedor";

/**
 * Quais linhas de integracao aparecem para o PROVEDOR.
 *
 * A tabela guarda uma linha por ERP que o suporte ja tocou, e nesta aba o
 * provedor nao configura nada — ele so le. A regra que decide o que ele ve
 * (`configurado && (isEnabled || status === "pausado_por_falhas")`) nao tinha
 * teste nenhum: uma refatoracao futura podia troca-la por um `isEnabled` cru,
 * calar o aviso de pausa e a suite continuaria verde.
 */

const base = {
  erpSource: "ixc",
  isEnabled: true,
  configurado: true,
  status: "idle",
  lastSyncAt: "2026-09-01T03:00:00.000Z",
  lastSyncStatus: "success" as string | null,
  totalSynced: 1200,
  totalErrors: 0,
};

describe("integracaoVisivelAoProvedor", () => {
  it("linha sem credencial fica de fora, mesmo ligada", () => {
    expect(integracaoVisivelAoProvedor({ ...base, configurado: false })).toBe(false);
  });

  it("configurada e ligada entra", () => {
    expect(integracaoVisivelAoProvedor(base)).toBe(true);
  });

  it("configurada e desligada de proposito pelo suporte fica de fora", () => {
    expect(integracaoVisivelAoProvedor({ ...base, isEnabled: false })).toBe(false);
  });

  /**
   * O caso que mais importa. A pausa e gravada como isEnabled=false +
   * status 'pausado_por_falhas', e e o unico aviso que o provedor recebe de
   * que a sincronizacao dele parou. Se a regra virar so `isEnabled`, o aviso
   * some junto — esconde-se justamente aquilo sobre o que ele tem de agir.
   */
  it("desligada por FALHAS entra: e o unico aviso de que a sincronizacao parou", () => {
    expect(integracaoVisivelAoProvedor({ ...base, isEnabled: false, status: "pausado_por_falhas" })).toBe(true);
  });

  it("sem credencial e pausada por falhas fica de fora: nao ha o que consertar", () => {
    expect(
      integracaoVisivelAoProvedor({ ...base, configurado: false, isEnabled: false, status: "pausado_por_falhas" }),
    ).toBe(false);
  });

  /**
   * `status` e texto livre vindo do servidor. Nenhum valor novo pode ganhar o
   * poder de mostrar uma integracao desligada — so a pausa por falhas o tem.
   */
  it("status desconhecido nao torna visivel uma integracao desligada", () => {
    expect(integracaoVisivelAoProvedor({ ...base, isEnabled: false, status: "algo_novo" })).toBe(false);
    expect(integracaoVisivelAoProvedor({ ...base, isEnabled: false, status: "" })).toBe(false);
  });

  it("status desconhecido tambem nao esconde uma integracao ligada", () => {
    expect(integracaoVisivelAoProvedor({ ...base, status: "algo_novo" })).toBe(true);
  });

  /**
   * A decisao sobre o ERP cujo conector ainda esta em construcao: a linha FICA.
   * Escondida, a conta que so tem essa linha cai no estado vazio, e aquele texto
   * manda falar com o suporte para cadastrar a integracao — o chamado que se
   * quer evitar, sobre um ERP que o suporte ja cadastrou. Visivel, ela se
   * explica sozinha (ver o estado "Em desenvolvimento" abaixo).
   */
  it("linha de conector em construcao continua visivel: sumir com ela gera o chamado que se quer evitar", () => {
    expect(integracaoVisivelAoProvedor({ ...base, erpSource: "topsapp" })).toBe(true);
  });
});

/**
 * O estado do ERP cujo conector ainda nao conversa com a API dele.
 *
 * Sem esta leitura a linha nascia "Integrada" em verde e, depois da primeira
 * varredura automatica, congelava em "Falha na ultima sincronizacao" — porque o
 * corte automatico por falhas foi suprimido de proposito para esses conectores.
 * A tela culpava o sistema do provedor por um atraso nosso, e ele abria chamado.
 */
describe("estadoDaIntegracao — conector ainda em construcao", () => {
  it("le 'Em desenvolvimento' em vez de 'Integrada'", () => {
    const e = estadoDaIntegracao(base, true);
    expect(e.texto).toBe("Em desenvolvimento");
    expect(e.texto).not.toBe("Integrada");
    expect(e.tom).toBe("neutro");
  });

  /** O texto tem um trabalho so: tirar a culpa do provedor e dispensa-lo de agir. */
  it("o detalhe diz que a falha nao e do ERP dele e que nao ha nada a fazer", () => {
    const detalhe = estadoDaIntegracao(base, true).detalhe ?? "";
    expect(detalhe).toContain("Nao ha falha no seu sistema");
    expect(detalhe).toContain("nao ha nada a ajustar do seu lado");
    /* Nem jargao nosso nem identificador de banco: o provedor le "Fly Speed",
       nunca "flyspeed", e nunca "stub". */
    expect(detalhe).not.toMatch(/stub|conector|endpoint|api/i);
  });

  /**
   * A precedencia e o ponto da correcao. Depois da primeira varredura a linha
   * chega aqui com lastSyncStatus 'error' e ficaria assim para sempre; e uma
   * linha antiga pode chegar pausada. Nos dois casos o motivo verdadeiro e o
   * mesmo, e e o unico que o provedor precisa ler.
   */
  it("vence a falha na ultima sincronizacao", () => {
    const e = estadoDaIntegracao({ ...base, lastSyncStatus: "error" }, true);
    expect(e.texto).toBe("Em desenvolvimento");
  });

  it("vence a pausa por falhas e a desativacao", () => {
    expect(estadoDaIntegracao({ ...base, isEnabled: false, status: "pausado_por_falhas" }, true).texto).toBe("Em desenvolvimento");
    expect(estadoDaIntegracao({ ...base, isEnabled: false }, true).texto).toBe("Em desenvolvimento");
  });

  it("vence ate a falta de credencial: a credencial nao e o que impede", () => {
    expect(estadoDaIntegracao({ ...base, configurado: false }, true).texto).toBe("Em desenvolvimento");
  });

  /**
   * O parametro e opcional para nao quebrar quem ja chamava a funcao com um
   * argumento so. Omitido, a leitura tem de ser identica a de antes.
   */
  it("omitido, nada muda: conector implementado continua lendo 'Integrada'", () => {
    expect(estadoDaIntegracao(base).texto).toBe("Integrada");
    expect(estadoDaIntegracao(base, false).texto).toBe("Integrada");
    expect(estadoDaIntegracao({ ...base, lastSyncStatus: "error" }).texto).toBe("Falha na ultima sincronizacao");
  });
});

/**
 * O cartao "integracoes ativas" imprime este numero em 21px. Contar a linha em
 * construcao poria "1" logo acima da propria linha que se declara em
 * desenvolvimento — a contradicao que faz o operador desconfiar da tela inteira.
 */
describe("integracaoNoAr", () => {
  it("ligada com conector pronto conta", () => {
    expect(integracaoNoAr(base)).toBe(true);
    expect(integracaoNoAr(base, false)).toBe(true);
  });

  it("ligada com conector em construcao NAO conta: a coluna diz ligada, nada sincroniza", () => {
    expect(integracaoNoAr(base, true)).toBe(false);
  });

  it("desligada nunca conta", () => {
    expect(integracaoNoAr({ ...base, isEnabled: false })).toBe(false);
    expect(integracaoNoAr({ ...base, isEnabled: false, status: "pausado_por_falhas" })).toBe(false);
  });
});
