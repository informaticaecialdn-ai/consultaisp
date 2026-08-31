/**
 * `cleanCpfCnpj` — o campo do documento tem que conter um documento.
 *
 * A função só tirava os não-dígitos e devolvia qualquer coisa. No IXC o
 * encadeamento é `row.cpf_cnpj || row.cnpj_cpf || row.documento`, e em
 * `fn_areceber` o campo `documento` é o número do BOLETO — então fatura sem CPF
 * virava um "cliente" identificado pelo número do título. Medido na base em
 * 29/08/2026: 8.693 linhas de `customers` com 4 a 9 dígitos ali, todas do IXC,
 * todas marcadas inadimplentes, 8.692 sem nome.
 *
 * Num bureau isso é grave duas vezes: são devedores fantasma que ninguém
 * consegue identificar, e eles poluem o cruzamento por endereço — três faturas
 * de R$ 122,68 do mesmo imóvel apareciam como três inadimplentes distintos, e o
 * endereço saía como "possível fraude por troca de documento".
 */
import { describe, it, expect } from "vitest";
import { cleanCpfCnpj } from "./normalize";

describe("cleanCpfCnpj", () => {
  it("mantem CPF e CNPJ, com ou sem pontuacao", () => {
    expect(cleanCpfCnpj("041.179.829-40")).toBe("04117982940");
    expect(cleanCpfCnpj("04117982940")).toBe("04117982940");
    expect(cleanCpfCnpj("22.735.562/0001-16")).toBe("22735562000116");
  });

  it("numero de boleto NAO vira documento", () => {
    // Os tres valores reais que estavam na base, do mesmo imovel.
    for (const titulo of ["11497310", "11497290", "11497260"]) {
      expect(cleanCpfCnpj(titulo)).toBe("");
    }
    // E as demais faixas encontradas: 4 a 9 digitos.
    expect(cleanCpfCnpj("1234")).toBe("");
    expect(cleanCpfCnpj("123456")).toBe("");
    expect(cleanCpfCnpj("1234567")).toBe("");
  });

  it("recompoe o zero a esquerda que o ERP comeu", () => {
    // ERP que guarda o documento como NUMERO perde o zero inicial. Ate dois
    // zeros e o caso normal, e sem isso um CPF legitimo seria descartado.
    expect(cleanCpfCnpj("4117982940")).toBe("04117982940");   // 10 -> 11
    expect(cleanCpfCnpj("876791917")).toBe("00876791917");     // 9  -> 11
    // 13 -> 14 exigiria um CNPJ que so fecha com o zero na frente; o caso
    // real de producao e o CPF acima.
  });

  it("vazio e lixo devolvem vazio", () => {
    expect(cleanCpfCnpj("")).toBe("");
    expect(cleanCpfCnpj("sem documento")).toBe("");
    expect(cleanCpfCnpj("---")).toBe("");
  });

  it("nao inventa documento a partir de numero grande demais", () => {
    expect(cleanCpfCnpj("123456789012345")).toBe("");
  });
});

/**
 * `aggregateByCustomer` — fatura sem documento não vira cliente.
 *
 * O agrupamento é por documento. Sem a guarda, TODAS as faturas sem CPF caem na
 * mesma chave vazia e viram UM cliente sem identidade somando a dívida de todas
 * elas. Depois que `cleanCpfCnpj` passou a devolver vazio para número de boleto,
 * isso deixaria de ser raro: seriam 8.693 faturas do IXC colapsando num único
 * registro de R$ 3,5 milhões.
 */
describe("aggregateByCustomer", () => {
  const fat = (doc: string, valor: number) => ({
    cpfCnpj: doc, name: doc ? "Fulano" : "", amount: valor, daysOverdue: 30,
    erpSource: "ixc",
  });

  it("descarta fatura sem documento em vez de agrupar todas numa so", async () => {
    const { aggregateByCustomer } = await import("./normalize");
    const r = aggregateByCustomer([
      fat("", 100), fat("", 200), fat("", 300),
      fat("04117982940", 50),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].cpfCnpj).toBe("04117982940");
    expect(r[0].totalOverdueAmount).toBe(50);
  });

  it("continua somando as faturas de um mesmo documento", async () => {
    const { aggregateByCustomer } = await import("./normalize");
    const r = aggregateByCustomer([fat("04117982940", 50), fat("04117982940", 70)]);
    expect(r).toHaveLength(1);
    expect(r[0].totalOverdueAmount).toBe(120);
    expect(r[0].overdueInvoicesCount).toBe(2);
  });
});
