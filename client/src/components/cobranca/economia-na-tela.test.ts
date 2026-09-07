/**
 * A Economia do cliente NA TELA: o que aparece, o que fica "—", e por quê.
 *
 * O dono abriu o 360 em 06/09/2026, viu doze campos com "—" e um selo
 * "PENDENTE · R24", e disse: "clientes 360 falta dados… falta a configuração
 * para os dados aparecerem". Ele estava certo no sintoma e a tela era culpada
 * de duas coisas ao mesmo tempo:
 *
 *   1. o MOTIVO do pendente existia só no atributo `title` do selo. Tooltip não
 *      sobrevive a um print, a um celular nem a um leitor de tela — então a
 *      tela dizia "falta alguma coisa" sem dizer qual;
 *   2. o botão ao lado dizia sempre "Confirmar custos", inclusive quando o que
 *      faltava era outra coisa e inclusive quando os custos já estavam
 *      confirmados. Botão que promete o passo errado gasta quem clica.
 *
 * E há uma terceira regra, que é de honestidade e não de usabilidade: com
 * todos os custos zerados as fórmulas produzem um resultado bonito e falso —
 * margem de contribuição igual a 100% da mensalidade e payback de zero mês.
 * A tela não pode exibir isso, e a Política não pode deixar CONFIRMAR isso.
 *
 * Teste sobre o texto da fonte: o vitest deste projeto não monta React (ver o
 * `include` do vitest.config.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { custosInformados, POLITICA_PADRAO } from "@shared/cobranca";
import { algumCustoPreenchido } from "./politica-form";
import { lerCoberturaDaMensalidade } from "./tipos";
import { rotuloDaMensalidade } from "../../pages/cobranca/cliente360";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ficha360 = ler("../../pages/cobranca/cliente360.tsx");
// A politica virou aba do Painel do Provedor em 06/09/2026.
const politica = ler("../painel/AbaCobranca.tsx");

describe("o motivo do PENDENTE vai para a tela, não para o tooltip", () => {
  it("o selo continua, e ao lado dele o motivo em texto", () => {
    const p = ficha360.slice(ficha360.indexOf("function Pendente("), ficha360.indexOf("export const ORIGEM_DO_VALOR"));
    expect(p).toContain('data-testid="motivo-pendente"');
    expect(p).toContain("{motivo}");
    // O title continua, para o texto completo: um não substitui o outro.
    expect(p).toContain("titulo={motivo");
  });
});

describe("a mensalidade aparece antes dos custos", () => {
  it("o MRR do card sai de valorMensal, e não do ledger — ele não depende de custo nenhum", () => {
    expect(ficha360).toContain('k === "MRR" && valorMensal !== null ? money(valorMensal) : DASH');
    expect(ficha360).toContain("valorMensal={ficha?.valorMensal ?? null}");
  });

  it("o ARPU do bloco R24 também, e o rótulo diz de ONDE o número veio", () => {
    expect(ficha360).toContain("v: e ? money(e.arpu) : valorMensal !== null ? money(valorMensal) : DASH");
    expect(ficha360).toContain("s: rotuloDaMensalidade(origem, evidencia)");
    expect(ficha360).toContain("origem={ficha?.origemDoValorMensal ?? null}");
  });

  it("as duas origens são nomeadas: cadastro do admin e leitura das faturas", () => {
    expect(ficha360).toMatch(/plano_cadastrado:\s*\{/);
    expect(ficha360).toMatch(/faturas_do_erp:\s*\{/);
    expect(ficha360).toMatch(/lida das faturas/);
  });
});

describe("o botão do cabeçalho diz o que falta de verdade", () => {
  it("faltando custo, ele chama de custo; faltando preço, chama de preço", () => {
    const acao = ficha360.slice(ficha360.indexOf("export function acaoDoPendente"));
    expect(acao).toContain("Informar os custos");
    expect(acao).toContain("Cadastrar preço do plano");
  });

  it("quando o que falta é do ERP, não há botão — a Política não resolve isso", () => {
    expect(ficha360).toContain("if (pendente) return { rotulo: \"\", leva: false };");
    expect(ficha360).toContain("{acao.leva && <Link");
  });
});

describe("a Política não deixa confirmar o que ninguém preencheu", () => {
  it("o botão trava com tudo zerado, e o title diz por quê", () => {
    expect(politica).toContain("disabled={travado || !custoPreenchido}");
    expect(politica).toContain("MOTIVO_SEM_CUSTO");
    expect(politica).toMatch(/margem sairia como 100% da mensalidade/);
  });

  it("a tela avisa que é ISTO que falta para a Economia aparecer no 360", () => {
    expect(politica).toContain('data-testid="aviso-sem-custo"');
    expect(politica).toMatch(/É isto que falta para a Economia aparecer no 360/);
  });

  it("e mostra a cobertura: quantos clientes já têm de onde tirar a mensalidade", () => {
    expect(politica).toContain('data-testid="cobertura-mensalidade"');
    expect(politica).toContain("cobertura.comMensalidade");
    expect(politica).toContain("cobertura.ativos");
  });

  it("o texto do cartão não promete mais que o ARPU vem do cadastro de planos", () => {
    // Ele dizia "O ARPU (mensalidade) vem do contrato de cada cliente, não daqui",
    // e o cadastro de planos dizia que sem ele a Economia fica PENDENTE. As duas
    // frases ficaram falsas quando a mensalidade passou a sair das faturas.
    expect(politica).not.toMatch(/a Economia do cliente fica PENDENTE no 360 até haver a mensalidade do plano/);
    expect(politica).toMatch(/lê das faturas que a varredura trouxe do ERP/);
  });
});

describe("custo zerado não é custo — nas duas pontas, com a mesma regra", () => {
  it("no servidor: a política padrão, toda zerada, não conta como informada", () => {
    expect(custosInformados(POLITICA_PADRAO.economia)).toBe(false);
    expect(custosInformados(null)).toBe(false);
  });

  it("um custo qualquer já basta — o provedor não precisa preencher os nove", () => {
    for (const campo of ["cac", "capexInstalacao", "opexLink", "opexRedePop", "opexSuporte", "opexManutencaoNoc", "impostoReceitaPct"] as const) {
      expect(custosInformados({ ...POLITICA_PADRAO.economia, [campo]: 5 }), campo).toBe(true);
    }
  });

  it("residual e ciclo NÃO contam: residual zero é resposta legítima e o ciclo já nasce com 36 meses", () => {
    expect(custosInformados({ ...POLITICA_PADRAO.economia, equipamentoResidual: 80 })).toBe(false);
    expect(custosInformados({ ...POLITICA_PADRAO.economia, cicloMeses: 48 })).toBe(false);
  });

  it("no formulário: a mesma regra, lendo o TEXTO que o admin acabou de digitar", () => {
    const vazio = { cac: "", capexInstalacao: "", equipamentoResidual: "", opexLink: "", opexRedePop: "", opexSuporte: "", opexManutencaoNoc: "", impostoReceitaPct: "", cicloMeses: "36", confirmado: false, planos: [] };
    expect(algumCustoPreenchido(vazio as never)).toBe(false);
    expect(algumCustoPreenchido({ ...vazio, cac: "0" } as never)).toBe(false);
    // Vírgula é como se digita em português.
    expect(algumCustoPreenchido({ ...vazio, opexLink: "12,50" } as never)).toBe(true);
    expect(algumCustoPreenchido({ ...vazio, equipamentoResidual: "80" } as never)).toBe(false);
  });
});

describe("a cobertura chega à tela sem inventar zero", () => {
  it("lê os números que a rota manda", () => {
    expect(lerCoberturaDaMensalidade({ cobertura: { ativos: 100, comMensalidade: 93, comDataDeContrato: 90 } }))
      .toEqual({ ativos: 100, comMensalidade: 93, comDataDeContrato: 90 });
  });

  it("rota que não contou vira null, e a tela some com a linha — zero diria 'nenhum cliente tem'", () => {
    expect(lerCoberturaDaMensalidade({ cobertura: null })).toBeNull();
    expect(lerCoberturaDaMensalidade({})).toBeNull();
    expect(lerCoberturaDaMensalidade(undefined)).toBeNull();
    expect(lerCoberturaDaMensalidade({ cobertura: { ativos: "muitos" } })).toBeNull();
  });
});

describe("o rótulo do ARPU carrega a força da evidência", () => {
  /*
   * Medido em produção (06/09/2026), entre clientes de contrato vivo com data
   * de contrato e ao menos uma fatura do ERP: no IXC 91,1% têm duas ou mais
   * faturas com o MESMO valor, e só 6,9% têm uma fatura. No MK é o oposto:
   * 93,2% têm UMA fatura só, e apenas 5,1% chegam a duas concordantes.
   *
   * Isso decidiu o desenho. Exigir duas faturas concordantes para aceitar a
   * mensalidade deixaria a carteira MK inteira PENDENTE — e a amostra mostra
   * que a fatura única do MK costuma SER a mensalidade (R$ 99,90 · 79,90 ·
   * 109,90 · 89,90 em quatro de cinco). Então o número sai, e o rótulo diz de
   * quantas faturas ele veio: quem lê "lida de 1 fatura só" ao lado de
   * R$ 636,40 numa base de R$ 100 sabe o que está olhando.
   */
  const rotulo = (o: Parameters<typeof rotuloDaMensalidade>[0], e: Parameters<typeof rotuloDaMensalidade>[1]) => rotuloDaMensalidade(o, e);

  it("preço cadastrado se anuncia como cadastro, não como leitura", () => {
    expect(rotulo("plano_cadastrado", null)).toMatch(/cadastrado/);
  });

  it("evidência forte diz quantas faturas concordam", () => {
    expect(rotulo("faturas_do_erp", { valor: 129.9, concordam: 3, faturas: 4 })).toBe("mesmo valor em 3 de 4 faturas");
  });

  it("uma fatura só é dito com todas as letras — é o caso do MK", () => {
    expect(rotulo("faturas_do_erp", { valor: 636.4, concordam: 1, faturas: 1 })).toBe("lida de 1 fatura só");
  });

  it("várias faturas sem nenhuma repetição também é evidência fraca, e aparece", () => {
    expect(rotulo("faturas_do_erp", { valor: 200, concordam: 1, faturas: 3 })).toMatch(/valores diferentes/);
  });

  it("sem mensalidade nenhuma, o rótulo não promete leitura", () => {
    expect(rotulo(null, null)).toBe("mensalidade do plano");
  });
});
