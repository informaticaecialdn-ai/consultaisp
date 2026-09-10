import { describe, expect, it } from "vitest";
import {
  VARIAVEIS_DO_MODELO_ZAPSIGN, VERSAO_DO_MODELO, baseCanonica, renderizarConfissao, serializarBase, textoDaConfissao,
  variaveisDoModeloZapSign, type EntradaDoModelo,
} from "./confissao-modelo";
import { AVISO_SANDBOX, AVISO_SEM_PARECER } from "./confissao";

const entrada = (): EntradaDoModelo => ({
  origem: "saldo_integral",
  ambiente: "producao",
  modeloRevisado: true,
  credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: "Rua A, 10, Centro, Lavras do Norte/MG, 39000-000", representante: null },
  devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: "Rua B, 20, Bairro, Lavras do Norte/MG", email: "maria@example.com", telefone: "31999990000" },
  cadastroErp: "4471",
  plano: "Fibra 300",
  inicioContrato: "2024-03-15",
  erpLidoEm: "2026-09-09T17:30:00.000Z",
  valorTotal: 719.86,
  valorOriginal: null,
  descontoPct: null,
  recebidoDoAcordo: null,
  parcelas: [{ n: 1, rotulo: "parcela", valor: 719.86, vencimento: "2026-10-10" }],
  meioDePagamento: "boleto ou PIX enviado pelo credor",
  encargos: { multaPct: 2, jurosMesPct: 1 },
  anexo: [
    { chave: "F-1", erpRef: "F-1", descricao: "Mensalidade 07/2026", vencimento: "2026-07-10", valor: 99.9, classe: "servico", diasAtraso: 61, multa: 2, juros: 2.03 },
    { chave: "F-2", erpRef: "F-2", descricao: "Multa rescisória", vencimento: "2026-08-10", valor: 615.93, classe: "multa", diasAtraso: 30, multa: 0, juros: 0 },
  ],
});

describe("modelo padrão v1.0", () => {
  it("a base canônica não carrega data/hora, normaliza documentos e ordena parcelas e anexo", () => {
    const b = baseCanonica({ ...entrada(), parcelas: [{ n: 2, rotulo: "parcela", valor: 10, vencimento: "2026-11-10" }, { n: 1, rotulo: "entrada", valor: 5.5, vencimento: "2026-10-10" }] });
    expect(b.versao).toBe(VERSAO_DO_MODELO);
    expect(b.parcelas.map(p => p.n)).toEqual([1, 2]);
    expect(b.devedor.documento).toBe("12345678901");
    expect(JSON.stringify(b)).not.toContain("geradoEm");
  });
  it("mesma base = mesma serialização, em qualquer ordem de chaves; hora diferente não entra", () => {
    const a = serializarBase(baseCanonica(entrada()));
    const invertida = Object.fromEntries(Object.entries(entrada()).reverse()) as EntradaDoModelo;
    expect(serializarBase(baseCanonica(invertida))).toBe(a);
    expect(serializarBase(baseCanonica({ ...entrada(), erpLidoEm: "2026-09-09T18:00:00.000Z" }))).not.toBe(a);
  });
  it("o render é determinístico dado geradoEm e hash", () => {
    const b = baseCanonica(entrada());
    const x = renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "abcdef0123456789");
    const y = renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "abcdef0123456789");
    expect(x).toEqual(y);
    const texto = textoDaConfissao(x);
    expect(texto).toContain("INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA");
    expect(texto).toContain("R$ 719,86 (setecentos e dezenove reais e oitenta e seis centavos)");
    expect(texto).toContain("cadastro nº 4471 no sistema de gestão do credor, plano Fibra 300, iniciada em 15/03/2024");
    expect(texto).toContain("art. 784, III e §4º");
    expect(texto).toContain("foro da comarca do domicílio do DEVEDOR");
    expect(texto).toContain("multa de 2% e juros de 1% ao mês");
    expect(texto).toContain("F-1");
    expect(texto).toContain("modelo padrão v1.0 · gerado em 09/09/2026 às 14:31 · hash abcdef01");
    expect(texto).toContain("não devolvido), lidas do sistema de gestão do credor em 09/09/2026 às 14:30.");
    expect(texto).not.toContain(AVISO_SEM_PARECER);
    expect(texto).not.toContain(AVISO_SANDBOX);
  });
  it("variável ausente sai da frase — nunca '—', 'null' nem '0'", () => {
    const b = baseCanonica({ ...entrada(), cadastroErp: null, plano: null, inicioContrato: null, erpLidoEm: null });
    const texto = textoDaConfissao(renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff"));
    expect(texto).toContain("mantida com o CREDOR, conforme as faturas relacionadas no Anexo I");
    expect(texto).not.toContain("cadastro nº");
    expect(texto).not.toContain("lidas do sistema de gestão");
    expect(texto).toContain("não devolvido).");
    expect(texto).not.toContain("—,");
    expect(texto).not.toMatch(/null|undefined|— —/);
  });
  it("acordo com desconto: cláusula condicional e saldo remanescente", () => {
    const b = baseCanonica({ ...entrada(), origem: "acordo", valorOriginal: 1000, descontoPct: 20, valorTotal: 600, recebidoDoAcordo: 200,
      parcelas: [{ n: 1, rotulo: "parcela", valor: 300, vencimento: "2026-10-10" }, { n: 2, rotulo: "parcela", valor: 300, vencimento: "2026-11-10" }] });
    const texto = textoDaConfissao(renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff"));
    expect(texto).toContain("reconhece e confessa dever ao CREDOR a quantia de R$ 1.000,00");
    expect(texto).toContain("desconto de R$ 200,00 (20%)");
    expect(texto).toContain("condicionado ao pagamento integral e pontual");
    expect(texto).toContain("restabelece o valor original, abatidos os pagamentos efetuados");
    expect(texto).toContain("saldo remanescente do acordo, já abatidos R$ 200,00 recebidos");
    expect(texto).toContain("em 2 parcelas");
  });
  it("devedor PJ sai representado; credor com representante quando o provedor assina", () => {
    const b = baseCanonica({ ...entrada(),
      devedor: { ...entrada().devedor, nome: "Padaria Pão Quente Ltda", documento: "11222333000181", pessoaJuridica: true, representante: { nome: "João Pão", cpf: "98765432100" } },
      credor: { ...entrada().credor, representante: { nome: "Ana Link", cpf: "11122233344" } } });
    const texto = textoDaConfissao(renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff"));
    expect(texto).toContain("Padaria Pão Quente Ltda, CNPJ 11.222.333/0001-81, representada por João Pão, CPF 987.654.321-00");
    expect(texto).toContain("representado por Ana Link, CPF 111.222.333-44");
  });
  it("avisos: modelo não revisado e sandbox vão ao rodapé; cláusulas 4, 5 e 6 em destaque", () => {
    const b = baseCanonica({ ...entrada(), modeloRevisado: false, ambiente: "sandbox" });
    const doc = renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff");
    expect(doc.avisos).toEqual([AVISO_SEM_PARECER, AVISO_SANDBOX]);
    const destaques = doc.blocos.filter(x => x.tipo === "paragrafo" && x.destaque).map(x => (x as { texto: string }).texto);
    expect(destaques).toHaveLength(3);
    expect(destaques[0]).toContain("CLÁUSULA 4ª");
    expect(destaques[1]).toContain("CLÁUSULA 5ª");
    expect(destaques[2]).toContain("CLÁUSULA 6ª");
  });
  it("as 20 variáveis do modelo do ZapSign, todas preenchidas (ausente = string vazia)", () => {
    const vars = variaveisDoModeloZapSign(baseCanonica(entrada()), "2026-09-09T17:31:00.000Z");
    expect(vars.map(v => v.de)).toEqual(VARIAVEIS_DO_MODELO_ZAPSIGN);
    expect(vars).toHaveLength(20);
    const mapa = Object.fromEntries(vars.map(v => [v.de, v.para]));
    expect(mapa["{{VALOR_TOTAL}}"]).toBe("R$ 719,86");
    expect(mapa["{{DEVEDOR_CPF_CNPJ}}"]).toBe("123.456.789-01");
    expect(mapa["{{PARCELAS}}"]).toContain("1 — parcela — R$ 719,86 — 10/10/2026");
    expect(mapa["{{DEVEDOR_REPRESENTANTE}}"]).toBe("");
  });
});
