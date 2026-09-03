/**
 * A TABELA DE PRECO PODE NAO CHEGAR — E ESSE E O CASO QUE QUEBRAVA.
 *
 * `usePrecos` nao refaz a leitura ao voltar o foco da janela, entao um 500 no
 * mount deixa `precos` `undefined` ate a pagina recarregar. As telas tratavam
 * esse `undefined` com `?? 0`, e `?? 0` em preco significa "de graca": o
 * formulario de fatura gravava R$ 0,00 para provedor pagante e o pedido manual
 * de credito criava um "Personalizado" de 100 creditos que ninguem escolheu.
 *
 * Cada funcao aqui devolve `null`/`false` na ausencia de preco, para que a tela
 * seja obrigada a decidir — nunca um zero que passa por numero valido.
 */
import { describe, it, expect } from "vitest";
import {
  camposDaFatura,
  fraseDoCredito,
  linhaDeCreditosDoPlano,
  pedidoDeCreditoPronto,
  planoPorChave,
  precoCurto,
  precoDoCreditoUnico,
  type PacoteDeCredito,
  type PrecoDePlano,
  type TabelaDePrecos,
} from "./precos";

function pacote(over: Partial<PacoteDeCredito> = {}): PacoteDeCredito {
  return {
    id: "credits-100",
    nome: "100 créditos",
    creditos: 100,
    precoCentavos: 10000,
    precoReais: 100,
    precoLabel: "R$ 100,00",
    precoUnitarioCentavos: 100,
    precoUnitarioLabel: "R$ 1,00/crédito",
    popular: true,
    ...over,
  };
}

function plano(over: Partial<PrecoDePlano> = {}): PrecoDePlano {
  return {
    chave: "pro",
    rotulo: "Profissional",
    precoCentavos: 9900,
    precoReais: 99,
    precoLabel: "R$ 99,00",
    creditosInclusos: { isp: 0, spc: 0 },
    naVitrine: true,
    recorrente: true,
    ...over,
  };
}

function tabela(over: Partial<TabelaDePrecos> = {}): TabelaDePrecos {
  return {
    origem: "plataforma",
    marcaId: null,
    pacotes: [pacote()],
    planos: [plano()],
    custoEmCreditos: { isp: 1, cadastral: 1, spc: 3 },
    ...over,
  };
}

describe("camposDaFatura", () => {
  it("devolve null sem tabela — nao ha valor para preencher", () => {
    expect(camposDaFatura(undefined, "pro")).toBeNull();
  });

  it("devolve null para plano que nao existe na tabela", () => {
    expect(camposDaFatura(tabela(), "plano-que-nao-existe")).toBeNull();
  });

  it("devolve null sem chave de plano", () => {
    expect(camposDaFatura(tabela(), "")).toBeNull();
    expect(camposDaFatura(tabela(), null)).toBeNull();
  });

  /**
   * O defeito em uma linha: com a tabela ausente o formulario recebia
   * `amount: "0"` e o superadmin emitia fatura de R$ 0,00 sem nenhum aviso.
   * Ausencia tem que ser distinguivel de gratuidade.
   */
  it("nunca devolve zero por ausencia — plano free de fato custa zero", () => {
    const semTabela = camposDaFatura(undefined, "free");
    expect(semTabela).toBeNull();

    const comTabela = camposDaFatura(
      tabela({ planos: [plano({ chave: "free", precoCentavos: 0, precoReais: 0, recorrente: false })] }),
      "free",
    );
    expect(comTabela).toEqual({
      planAtTime: "free",
      amount: "0",
      ispCreditsIncluded: "0",
      spcCreditsIncluded: "0",
    });
  });

  it("preenche valor e creditos do plano encontrado", () => {
    const campos = camposDaFatura(
      tabela({ planos: [plano({ chave: "basic", precoReais: 149, creditosInclusos: { isp: 200, spc: 50 } })] }),
      "basic",
    );
    expect(campos).toEqual({
      planAtTime: "basic",
      amount: "149",
      ispCreditsIncluded: "200",
      spcCreditsIncluded: "50",
    });
  });
});

describe("pedidoDeCreditoPronto", () => {
  const pkg = pacote();

  it("recusa sem provedor", () => {
    expect(pedidoDeCreditoPronto({ providerId: "", packageId: "credits-100", pacoteEscolhido: pkg })).toBe(false);
  });

  /**
   * O caso que gravava em silencio: sem tabela o `packageId` derivado fica
   * vazio, o servidor le vazio como falsy e cai no ramo "Personalizado",
   * gravando os defaults do formulario — 100 creditos, R$ 100,00.
   */
  it("recusa com pacote vazio, que o servidor leria como Personalizado", () => {
    expect(pedidoDeCreditoPronto({ providerId: "7", packageId: "", pacoteEscolhido: undefined })).toBe(false);
  });

  it("recusa pacote que nao existe na tabela recebida", () => {
    expect(pedidoDeCreditoPronto({ providerId: "7", packageId: "credits-999", pacoteEscolhido: undefined })).toBe(false);
  });

  it("aceita Personalizado, que e escolha explicita do superadmin", () => {
    expect(pedidoDeCreditoPronto({ providerId: "7", packageId: "custom", pacoteEscolhido: undefined })).toBe(true);
  });

  it("aceita pacote resolvido", () => {
    expect(pedidoDeCreditoPronto({ providerId: "7", packageId: "credits-100", pacoteEscolhido: pkg })).toBe(true);
  });
});

describe("precoDoCreditoUnico / fraseDoCredito", () => {
  it("devolve null sem tabela", () => {
    expect(precoDoCreditoUnico(undefined)).toBeNull();
    expect(precoDoCreditoUnico(tabela({ pacotes: [] }))).toBeNull();
  });

  it("devolve o preco unitario quando todos os pacotes concordam", () => {
    expect(
      precoDoCreditoUnico(
        tabela({
          pacotes: [
            pacote({ id: "credits-50", precoUnitarioCentavos: 100 }),
            pacote({ id: "credits-500", precoUnitarioCentavos: 100 }),
          ],
        }),
      ),
    ).toBe("R$ 1,00");
  });

  /** A tela nao pode eleger um dos precos como "o" preco do credito. */
  it("cala quando os pacotes divergem entre si", () => {
    expect(
      precoDoCreditoUnico(
        tabela({
          pacotes: [
            pacote({ id: "credits-50", precoUnitarioCentavos: 120 }),
            pacote({ id: "credits-500", precoUnitarioCentavos: 100 }),
          ],
        }),
      ),
    ).toBeNull();
  });

  /**
   * O cabecalho de /creditos afirmava "Um credito custa R$ 1,00" em texto
   * cravado logo acima de cards ja vindos do servidor: bastava a tabela mudar
   * para a mesma tela dizer dois precos.
   */
  it("a frase acompanha a tabela em vez de cravar R$ 1,00", () => {
    const cara = fraseDoCredito(
      tabela({ pacotes: [pacote({ precoUnitarioCentavos: 250, precoUnitarioLabel: "R$ 2,50/crédito" })] }),
    );
    expect(cara).toContain("R$ 2,50");
    expect(cara).not.toContain("R$ 1,00");
  });

  it("omite o valor quando ele nao e conhecido, sem inventar", () => {
    const frase = fraseDoCredito(undefined);
    expect(frase).not.toMatch(/R\$/);
    expect(frase).toContain("qualquer consulta do sistema");
  });
});

describe("linhaDeCreditosDoPlano", () => {
  /**
   * `free` nao gera fatura (generate-monthly pula preco zero) e nada no
   * sistema soma credito todo mes. O card prometia "50 creditos inclusos por
   * mes" para uma recorrencia inexistente.
   */
  it("nao promete recorrencia em plano que nao gera fatura", () => {
    const linha = linhaDeCreditosDoPlano(
      plano({ chave: "free", precoCentavos: 0, precoReais: 0, recorrente: false, creditosInclusos: { isp: 50, spc: 0 } }),
    );
    expect(linha).not.toContain("por mes");
    expect(linha).not.toContain("50");
  });

  it("anuncia os creditos mensais de plano que gera fatura", () => {
    const linha = linhaDeCreditosDoPlano(
      plano({ chave: "basic", recorrente: true, creditosInclusos: { isp: 200, spc: 50 } }),
    );
    expect(linha).toBe("200 creditos inclusos por mes");
  });

  it("plano pago sem creditos inclusos fala do credito avulso", () => {
    const linha = linhaDeCreditosDoPlano(plano({ chave: "pro", recorrente: true, creditosInclusos: { isp: 0, spc: 0 } }));
    expect(linha).toBe("Consultas na rede pagas por credito");
  });
});

describe("precoCurto e planoPorChave", () => {
  it("corta o centavo redondo e mantem o quebrado", () => {
    expect(precoCurto({ precoCentavos: 9900, precoLabel: "R$ 99,00" })).toBe("R$ 99");
    expect(precoCurto({ precoCentavos: 14990, precoLabel: "R$ 149,90" })).toBe("R$ 149,90");
  });

  it("nao acha plano sem tabela nem sem chave", () => {
    expect(planoPorChave(undefined, "pro")).toBeUndefined();
    expect(planoPorChave(tabela(), undefined)).toBeUndefined();
    expect(planoPorChave(tabela(), "pro")?.rotulo).toBe("Profissional");
  });
});
