import { describe, expect, it } from "vitest";
import { baseCanonica, renderizarConfissao, type EntradaDoModelo } from "@shared/cobranca/confissao-modelo";
import { CORPO_PT, gerarPdfDaConfissao } from "./pdf";

const entrada: EntradaDoModelo = {
  origem: "saldo_integral", ambiente: "sandbox", modeloRevisado: false,
  credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: "Rua A, 10, Centro, Lavras/MG", representante: null },
  devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: "Rua B, 20", email: "maria@example.com", telefone: "31999990000" },
  cadastroErp: "4471", plano: "Fibra 300", inicioContrato: "2024-03-15", erpLidoEm: "2026-09-09T17:30:00.000Z",
  valorTotal: 719.86, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null,
  parcelas: [{ n: 1, rotulo: "parcela", valor: 719.86, vencimento: "2026-10-10" }],
  meioDePagamento: "boleto ou PIX enviado pelo credor", encargos: { multaPct: 2, jurosMesPct: 1 },
  anexo: Array.from({ length: 40 }, (_, i) => ({ chave: `F-${i + 1}`, erpRef: `F-${i + 1}`, descricao: `Mensalidade ${i + 1}`, vencimento: "2026-07-10", valor: 99.9, classe: "servico" as const, diasAtraso: 61, multa: 2, juros: 2.03 })),
};

/** O conteúdo sem compressão: os textos saem como <hex> WinAnsi em operadores TJ. O trailer traz /ID [<…> <…>] derivado da data de criação — não é texto, fica de fora. */
function textoDoPdf(pdf: Buffer): string {
  const conteudo = pdf.toString("latin1");
  const corpo = conteudo.slice(0, conteudo.lastIndexOf("trailer"));
  return Array.from(corpo.matchAll(/<([0-9a-fA-F]+)>/g)).map(m => Buffer.from(m[1], "hex").toString("latin1")).join("");
}

describe("PDF da confissão", () => {
  it("é um PDF válido, pequeno, com corpo 12 pt, destaque em negrito e o texto presente", async () => {
    const doc = renderizarConfissao(baseCanonica(entrada), "2026-09-09T17:31:00.000Z", "abcdef0123456789");
    const pdf = await gerarPdfDaConfissao(doc);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeLessThan(1024 * 1024);
    const bruto = pdf.toString("latin1");
    expect(bruto).toMatch(new RegExp(`/F\\d+ ${CORPO_PT} Tf`));
    expect(bruto).toContain("/BaseFont /Helvetica-Bold");
    expect(bruto).toContain("/Type /Page\n"); // ao menos uma página; o anexo de 40 linhas força mais de uma
    expect((bruto.match(/\/Type \/Page\n/g) ?? []).length).toBeGreaterThan(1);
    // Cada linha do PDF é um <hex> próprio: tirando os espaços, uma quebra de
    // linha no meio da frase deixa de importar.
    const texto = textoDoPdf(pdf).replace(/\s+/g, "");
    expect(texto).toContain("confessadeveraoCREDOR");
    expect(texto).toContain("F-40");
    expect(texto).toContain("SEMPARECERJUR");
    expect(texto).toContain("AMBIENTEDETESTES");
  });
  it("dois PDFs do mesmo documento têm o mesmo texto (o binário difere só por data de criação)", async () => {
    const doc = renderizarConfissao(baseCanonica(entrada), "2026-09-09T17:31:00.000Z", "ff");
    const [a, b] = await Promise.all([gerarPdfDaConfissao(doc), gerarPdfDaConfissao(doc)]);
    expect(textoDoPdf(a)).toBe(textoDoPdf(b));
  });
});
