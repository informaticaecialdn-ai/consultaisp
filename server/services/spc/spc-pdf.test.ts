/**
 * O PDF da consulta SPC é o mesmo relatório que a tela mostra, montado a
 * partir da LINHA gravada (o provedor pagou por ela) — nunca de uma consulta
 * nova ao SPC. Aqui se prova a montagem do documento, que é pura; o PDF em si
 * é o gerador genérico de `server/assinatura/pdf.ts`, testado lá.
 */
import { describe, expect, it } from "vitest";
import type { SpcConsultation } from "@shared/schema";
import { documentoDaConsultaSpc, nomeDoArquivoDoPdfSpc, MARCA_DAGUA_SIMULADO } from "./spc-pdf";

function consulta(extra: Partial<Omit<SpcConsultation, "result">> & { result?: Record<string, unknown> } = {}): SpcConsultation {
  const { result: resultExtra, ...linha } = extra;
  return {
    id: 91, providerId: 42, userId: 7, cpfCnpj: "00752477714", score: 832, consultaId: "CI-2609-K7F3M2",
    createdAt: new Date("2026-09-16T14:05:00.000Z"),
    result: {
      cpfCnpj: "00752477714", protocolo: "SPC-2026-000123", consultadoEm: "2026-09-16T14:04:58.000Z", restricao: true,
      cadastralData: {
        nome: "Maria da Silva", cpfCnpj: "00752477714", dataNascimento: "1988-03-12", nomeMae: "Ana da Silva",
        situacaoRf: "REGULAR", obitoRegistrado: false, tipo: "PF", cidade: "Londrina", uf: "PR",
      },
      score: 832, scoreFonte: "spc-score-12-meses", scoreDetalhe: { indiceRisco: "B" },
      riskLevel: "low", riskLabel: "Risco baixo", recommendation: "Aprovar com cautela",
      status: "restricted",
      restrictions: [{
        type: "spc", description: "Registro SPC", severity: "high", creditor: "Loja Exemplo", value: "350.90",
        date: "2026-05-10", origin: "SPC", contrato: "C-77", vencimento: "2026-04-10",
        detalhes: [{ rotulo: "Cidade", valor: "Londrina" }, { rotulo: "Contrato", valor: "C-77" }],
      }],
      totalRestrictions: 350.9,
      resumo: {},
      pendenciasFinanceiras: [{ origem: "Banco X", titulo: "Empréstimo", data: "2026-02-01", valor: 1200, avalista: false }],
      previousConsultations: {
        total: 2, last90Days: 2, diasConsiderados: 90, bySegment: {},
        lista: [{ associado: "Provedor Y", cidade: "Cambé", uf: "PR", data: "2026-08-01" }],
      },
      alerts: [{ type: "documento", message: "Verificar documento", severity: "medium" }],
      rendaPresumida: 3500, limiteCreditoSugerido: 900, basesInoperantes: ["Cheque lojista"],
      rawXml: "<xml>SEGREDO-DO-XML</xml>",
      creditosCobrados: 3,
      ...resultExtra,
    },
    ...linha,
  } as SpcConsultation;
}

const GERADO_EM = new Date("2026-09-16T15:00:00.000Z");
const montar = (c: SpcConsultation = consulta()) => documentoDaConsultaSpc({ consulta: c, provedor: { name: "NsLink Provedor" }, geradoEm: GERADO_EM });
const textoDe = (doc: ReturnType<typeof montar>) => JSON.stringify(doc.blocos);

describe("documentoDaConsultaSpc", () => {
  it("leva tudo o que a tela mostra: identificação, cadastro, análise, restrições com detalhes, pendências, quem consultou, alertas e bases inoperantes", () => {
    const doc = montar();
    const t = textoDe(doc);
    expect(doc.titulo).toContain("SPC");
    for (const esperado of [
      "CI-2609-K7F3M2", "SPC-2026-000123", "NsLink Provedor",
      "Maria da Silva", "007.524.777-14", "12/03/1988", "Ana da Silva", "REGULAR", "Londrina",
      "832", "Risco baixo", "Aprovar com cautela", "3.500,00", "900,00",
      "Loja Exemplo", "350,90", "10/05/2026", "C-77", "Cidade: Londrina",
      "Banco X", "1.200,00", "Provedor Y", "Cambé", "01/08/2026",
      "Verificar documento", "Cheque lojista",
    ]) {
      expect(t, esperado).toContain(esperado);
    }
  });

  it("o XML cru e o que a tela não mostra nunca entram", () => {
    const t = textoDe(montar());
    expect(t).not.toContain("SEGREDO-DO-XML");
    expect(t).not.toContain("rawXml");
  });

  it("sem restrições diz que nenhuma foi retornada; sem score diz que o produto não devolve", () => {
    const t = textoDe(montar(consulta({
      score: null,
      result: { status: "clean", restrictions: [], totalRestrictions: 0, score: null, scoreDetalhe: undefined, pendenciasFinanceiras: [], alerts: [], basesInoperantes: [], previousConsultations: { total: 0, last90Days: 0, diasConsiderados: 90, bySegment: {}, lista: [] } },
    })));
    expect(t).toContain("Nenhuma restrição");
    expect(t.toLowerCase()).toContain("não devolve score");
    expect(t).not.toContain("Loja Exemplo");
    expect(t).not.toContain("null");
  });

  it("na demonstração o título e o rodapé avisam que é simulado; fora dela nada disso aparece", () => {
    const simulado = montar(consulta({ result: { simulado: true } }));
    expect(simulado.titulo).toContain("SIMULADO");
    expect(simulado.blocos.some(b => b.tipo === "rodape" && /fict[ií]cios/i.test(b.texto))).toBe(true);
    const real = montar();
    expect(real.titulo).not.toContain("SIMULADO");
    expect(textoDe(real)).not.toMatch(/fict[ií]cios/i);
    expect(MARCA_DAGUA_SIMULADO).toContain("SIMULADO");
  });

  it("consulta gravada antes do código: nada de código inventado, e o arquivo leva o id", () => {
    const antiga = consulta({ consultaId: null });
    expect(textoDe(montar(antiga))).not.toContain("CI-");
    expect(nomeDoArquivoDoPdfSpc(antiga)).toBe("consulta-spc-91.pdf");
  });

  it("o nome do arquivo usa o código da consulta, nunca o documento — arquivo circula", () => {
    expect(nomeDoArquivoDoPdfSpc(consulta())).toBe("consulta-spc-CI-2609-K7F3M2.pdf");
    expect(nomeDoArquivoDoPdfSpc(consulta())).not.toContain("00752477714");
  });

  it("a hora de geração e a do provedor consulente ficam no documento", () => {
    const t = textoDe(montar());
    expect(t).toContain("16/09/2026");
    expect(t).toContain("NsLink Provedor");
  });
});
