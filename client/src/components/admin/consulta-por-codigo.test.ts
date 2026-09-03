import { describe, it, expect } from "vitest";
import {
  codigoParaUrl, desfechoDaFicha, linhasDaFicha, mensagemDoErro,
  ROTULO_DO_TIPO, type FichaDeConsulta,
} from "./consulta-por-codigo";

/**
 * O que a tela do suporte faz com o codigo antes e depois do servidor.
 *
 * O foco nao e formatacao bonita: e que a busca sobreviva ao codigo colado do
 * jeito que veio, que a mensagem do 404 chegue INTEIRA ate quem atende (ela e
 * a que ensina onde procurar), e que nenhuma linha da ficha invente um dado
 * que a consulta nunca teve.
 */

const FICHA_ISP: FichaDeConsulta = {
  consultaId: "CI-2609-K7F3M2",
  tipo: "isp",
  linhaId: 901,
  criadaEm: "2026-09-03T14:22:00.000Z",
  provedor: { id: 42, nome: "Provedor NsLink" },
  usuario: { id: 7, nome: "Ana Operadora" },
  documento: "123.***.***-**",
  custoCreditos: 1,
  custoOrigem: "gravado",
  desfecho: { score: 720, decisao: "Accept", veredito: null, tipoDeBusca: "cpf", datasets: null },
  protocoloDaOrigem: null,
};

const FICHA_CADASTRAL: FichaDeConsulta = {
  consultaId: "CI-2609-K7F3M2",
  tipo: "cadastral",
  linhaId: 310,
  criadaEm: "2026-09-03T14:40:00.000Z",
  provedor: { id: 42, nome: "Provedor NsLink" },
  usuario: { id: 7, nome: "Ana Operadora" },
  documento: "123.***.***-**",
  custoCreditos: 1,
  custoOrigem: "gravado",
  desfecho: { score: null, decisao: null, veredito: "ATENCAO", tipoDeBusca: null, datasets: ["basic_data", "phones"] },
  protocoloDaOrigem: { origem: "BigDataCorp", protocolo: "9f1c2b40-77aa-4c1e-b8f0-0d4a2e6d1111" },
};

const rotulos = (ficha: FichaDeConsulta) => linhasDaFicha(ficha).map(l => l.rotulo);
const valorDe = (ficha: FichaDeConsulta, rotulo: string) =>
  linhasDaFicha(ficha).find(l => l.rotulo === rotulo);

describe("codigoParaUrl", () => {
  it("aceita o codigo como ele e", () => {
    expect(codigoParaUrl("CI-2609-K7F3M2")).toBe("CI-2609-K7F3M2");
  });

  // Quem atende cola do WhatsApp e digita ouvindo por telefone.
  it("sobe a caixa e apara as pontas", () => {
    expect(codigoParaUrl("  ci-2609-k7f3m2  ")).toBe("CI-2609-K7F3M2");
  });

  it("tira espaco no meio e ponto — o servidor os aceitaria, mas nao precisam viajar", () => {
    expect(codigoParaUrl("CI 2609 K7F3M2")).toBe("CI2609K7F3M2");
    expect(codigoParaUrl("CI.2609.K7F3M2")).toBe("CI2609K7F3M2");
  });

  /**
   * A barra e o motivo desta funcao existir: colada num pedaco de caminho ela
   * faz o Express casar outra rota e responder um 404 mudo, em vez do 400 que
   * explica o formato.
   */
  it("nenhuma barra sobrevive de quem colou um link inteiro", () => {
    const saida = codigoParaUrl("https://app.exemplo/consultas/CI-2609-K7F3M2");
    // O resultado e lixo, e e o que se quer: lixo recebe o 400 que explica o
    // formato, enquanto uma barra receberia um 404 mudo do roteador.
    expect(saida).not.toBeNull();
    expect(saida).not.toContain("/");
    expect(saida).not.toContain(":");
  });

  it("caixa vazia nao vira busca", () => {
    expect(codigoParaUrl("")).toBeNull();
    expect(codigoParaUrl("   ")).toBeNull();
    expect(codigoParaUrl("!!!")).toBeNull();
  });

  /**
   * NAO corrige caractere parecido. O alfabeto do codigo nao tem `0` nem `O`,
   * entao trocar um pelo outro seria adivinhar — e adivinhar errado abre a
   * ficha de outra pessoa.
   */
  it("nao troca zero por O nem um por I", () => {
    expect(codigoParaUrl("CI-2609-K7F3MO")).toBe("CI-2609-K7F3MO");
    expect(codigoParaUrl("CI-2609-K7F3M0")).toBe("CI-2609-K7F3M0");
  });
});

describe("desfechoDaFicha", () => {
  it("traduz a decisao da ISP, que esta gravada em ingles", () => {
    expect(desfechoDaFicha(FICHA_ISP)).toEqual({ texto: "Aprovar", tom: "ok" });
    expect(desfechoDaFicha({ ...FICHA_ISP, desfecho: { ...FICHA_ISP.desfecho, decisao: "Reject" } }))
      .toEqual({ texto: "Rejeitar", tom: "recusa" });
    expect(desfechoDaFicha({ ...FICHA_ISP, desfecho: { ...FICHA_ISP.desfecho, decisao: "Review" } }))
      .toEqual({ texto: "Revisar", tom: "atencao" });
  });

  it("traduz o veredito da cadastral, gravado em caixa alta e sem acento", () => {
    expect(desfechoDaFicha(FICHA_CADASTRAL)).toEqual({ texto: "Atenção", tom: "atencao" });
    expect(desfechoDaFicha({ ...FICHA_CADASTRAL, desfecho: { ...FICHA_CADASTRAL.desfecho, veredito: "RECUSAR" } }))
      .toEqual({ texto: "Recusar", tom: "recusa" });
    expect(desfechoDaFicha({ ...FICHA_CADASTRAL, desfecho: { ...FICHA_CADASTRAL.desfecho, veredito: "NAO_ENCONTRADO" } }))
      .toEqual({ texto: "Não encontrado", tom: "neutro" });
  });

  /**
   * A SPC devolve score e deixa a decisao com o provedor. Dizer "Revisar" ali
   * seria inventar uma recomendacao que o bureau nunca deu.
   */
  it("SPC nao tem decisao, e a tela diz isso em vez de escolher uma", () => {
    const spc: FichaDeConsulta = {
      ...FICHA_ISP, tipo: "spc",
      desfecho: { score: 812, decisao: null, veredito: null, tipoDeBusca: null, datasets: null },
    };
    expect(desfechoDaFicha(spc)).toEqual({ texto: "Sem decisão registrada", tom: "neutro" });
  });

  it("valor desconhecido passa cru em vez de sumir", () => {
    const estranho = { ...FICHA_ISP, desfecho: { ...FICHA_ISP.desfecho, decisao: "Escalate" } };
    expect(desfechoDaFicha(estranho)).toEqual({ texto: "Escalate", tom: "atencao" });
  });
});

describe("linhasDaFicha", () => {
  it("a consulta ISP traz busca e score, e nao inventa veredito nem datasets", () => {
    expect(rotulos(FICHA_ISP)).toEqual([
      "tipo", "data", "provedor", "operador", "documento",
      "busca", "score", "custo", "linha no banco",
    ]);
    expect(valorDe(FICHA_ISP, "busca")!.valor).toBe("por CPF/CNPJ");
    expect(valorDe(FICHA_ISP, "score")!.valor).toBe("720");
  });

  it("a consulta cadastral traz datasets e o protocolo da origem", () => {
    expect(rotulos(FICHA_CADASTRAL)).toEqual([
      "tipo", "data", "provedor", "operador", "documento",
      "custo", "datasets", "protocolo BigDataCorp", "linha no banco",
    ]);
    expect(valorDe(FICHA_CADASTRAL, "protocolo BigDataCorp")!.valor)
      .toBe("9f1c2b40-77aa-4c1e-b8f0-0d4a2e6d1111");
  });

  // Score 0 e um score; some se a checagem for por valor "verdadeiro".
  it("score zero aparece", () => {
    const zerado = { ...FICHA_ISP, desfecho: { ...FICHA_ISP.desfecho, score: 0 } };
    expect(valorDe(zerado, "score")!.valor).toBe("0");
  });

  it("todo dado numerico vai em mono, que e o que alinha a coluna", () => {
    for (const rotulo of ["data", "documento", "score", "custo", "linha no banco"]) {
      expect(valorDe(FICHA_ISP, rotulo)!.mono, rotulo).toBe(true);
    }
  });

  it("o documento vem com a nota de mascarado — ninguem confunde com o CPF inteiro", () => {
    expect(valorDe(FICHA_ISP, "documento")).toMatchObject({
      valor: "123.***.***-**", nota: "mascarado",
    });
  });

  /**
   * Sem esta nota o suporte estorna pelo preco de hoje uma consulta antiga:
   * o SPC ja custou 4 creditos e passou a 3.
   */
  it("custo deduzido da tabela avisa que foi deduzido; custo gravado nao avisa nada", () => {
    expect(valorDe(FICHA_ISP, "custo")!.nota).toBeUndefined();
    const deTabela = { ...FICHA_ISP, custoOrigem: "tabela" as const, custoCreditos: 3 };
    expect(valorDe(deTabela, "custo")).toMatchObject({
      valor: "3 créditos", nota: "preço de tabela; não gravado na linha",
    });
  });

  it("um credito no singular", () => {
    expect(valorDe(FICHA_ISP, "custo")!.valor).toBe("1 crédito");
  });

  // Provedor apagado nao pode virar "null · #42" na tela de quem atende.
  it("provedor ou operador removido sai por extenso, nao como nulo", () => {
    const orfa = { ...FICHA_ISP, provedor: { id: 42, nome: null }, usuario: { id: 7, nome: null } };
    expect(valorDe(orfa, "provedor")!.valor).toBe("(provedor removido) · #42");
    expect(valorDe(orfa, "operador")!.valor).toBe("(usuário removido) · #7");
  });

  it("data ausente ou ilegivel nao quebra a ficha", () => {
    expect(valorDe({ ...FICHA_ISP, criadaEm: null }, "data")!.valor).toBe("—");
    expect(valorDe({ ...FICHA_ISP, criadaEm: "nao e data" }, "data")!.valor).toBe("—");
  });

  it("datasets vazio nao vira linha vazia", () => {
    const semDatasets = {
      ...FICHA_CADASTRAL,
      desfecho: { ...FICHA_CADASTRAL.desfecho, datasets: [] },
    };
    expect(rotulos(semDatasets)).not.toContain("datasets");
  });
});

describe("mensagemDoErro", () => {
  /**
   * A mensagem do 404 e o produto desta frente: ela ensina que o codigo pode
   * ser de uma consulta que falhou antes de gravar. Se chegasse embrulhada em
   * JSON, quem atende leria chaves em vez da explicacao.
   */
  it("desembrulha o corpo JSON que o queryClient empacota no texto do erro", () => {
    const erro = new Error('404: {"consultaId":"CI-2609-K7F3M2","message":"Nenhuma consulta gravada com este código."}');
    expect(mensagemDoErro(erro)).toBe("Nenhuma consulta gravada com este código.");
  });

  it("resposta que nao e JSON vira o proprio texto, sem o status na frente", () => {
    expect(mensagemDoErro(new Error("502: Bad Gateway"))).toBe("Bad Gateway");
  });

  it("erro sem mensagem ainda diz alguma coisa", () => {
    expect(mensagemDoErro(new Error(""))).toBe("Não foi possível buscar a consulta.");
    expect(mensagemDoErro(null)).toBe("Não foi possível buscar a consulta.");
  });
});

describe("ROTULO_DO_TIPO", () => {
  it("os tres tipos tem rotulo em portugues", () => {
    expect(ROTULO_DO_TIPO).toEqual({
      isp: "Consulta ISP",
      spc: "SPC Brasil",
      cadastral: "Consulta cadastral",
    });
  });
});
