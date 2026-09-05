/**
 * A tabela de arrasto do kanban de cobrança, fronteira a fronteira.
 *
 * O que está preso aqui é o que impede o gesto de virar um PATCH que o
 * servidor recusa com 409 depois de a coluna já ter mudado na tela — e o que
 * impede o operador de sumir com dívida (baixar/encerrar) por arrasto.
 */
import { describe, it, expect } from "vitest";
import { STATUS_DE_CASO } from "@shared/cobranca/estados";
import {
  avaliarMovimentoDeCaso, COLUNAS_DESFECHO, COLUNAS_RECOLHIDAS, COLUNAS_VIVAS, ORDEM_DO_QUADRO,
  MOTIVO_ACORDO_NASCE_DO_ACEITE, MOTIVO_CASO_FECHADO, MOTIVO_MESMA_COLUNA, MOTIVO_SO_ADMIN, tituloDoMovimento,
} from "./movimentos-cobranca";

const caso = (status: string) => ({ id: 1, status, valorAtual: 100 });
const operador = { podeAdministrar: false };
const admin = { podeAdministrar: true };

describe("o quadro cobre todo status da máquina de estados", () => {
  it("toda coluna é um status conhecido e todo status tem coluna", () => {
    expect([...ORDEM_DO_QUADRO].sort()).toEqual([...STATUS_DE_CASO].sort());
  });

  it("vivas → desfecho → recolhidas, nessa ordem", () => {
    expect(ORDEM_DO_QUADRO).toEqual([...COLUNAS_VIVAS, ...COLUNAS_DESFECHO, ...COLUNAS_RECOLHIDAS]);
    expect(COLUNAS_VIVAS[0]).toBe("aberto");
    expect(COLUNAS_DESFECHO).toEqual(["pago", "cancelamento"]);
  });
});

describe("avaliarMovimentoDeCaso", () => {
  it("mesma coluna não é movimento", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "aberto", operador)).toEqual({ tipo: "nenhum" });
  });

  it("aberto ⇄ em_contato é PATCH direto, para o operador", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "em_contato", operador)).toEqual({ tipo: "direto", status: "em_contato" });
    expect(avaliarMovimentoDeCaso(caso("em_contato"), "aberto", operador)).toEqual({ tipo: "direto", status: "aberto" });
  });

  it("negociando abre o diálogo — o status nasce da proposta, não do arrasto", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "negociando", operador)).toEqual({ tipo: "negociar" });
    expect(avaliarMovimentoDeCaso(caso("em_contato"), "negociando", operador)).toEqual({ tipo: "negociar" });
  });

  it("acordo ativo nunca é destino de arrasto: nasce do aceite", () => {
    const r = avaliarMovimentoDeCaso(caso("negociando"), "acordo_ativo", admin);
    expect(r).toEqual({ tipo: "recusado", motivo: MOTIVO_ACORDO_NASCE_DO_ACEITE });
  });

  it("cancelamento abre o diálogo de motivo, de qualquer status vivo", () => {
    for (const de of ["aberto", "em_contato", "negociando", "acordo_ativo", "negativado"]) {
      expect(avaliarMovimentoDeCaso(caso(de), "cancelamento", operador), de).toEqual({ tipo: "cancelar" });
    }
  });

  it("pago é do operador; baixado e encerrado só do admin", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "pago", operador)).toEqual({ tipo: "direto", status: "pago" });
    expect(avaliarMovimentoDeCaso(caso("aberto"), "baixado", operador)).toEqual({ tipo: "recusado", motivo: MOTIVO_SO_ADMIN });
    expect(avaliarMovimentoDeCaso(caso("aberto"), "encerrado", operador)).toEqual({ tipo: "recusado", motivo: MOTIVO_SO_ADMIN });
    expect(avaliarMovimentoDeCaso(caso("aberto"), "baixado", admin)).toEqual({ tipo: "direto", status: "baixado" });
  });

  it("caso fechado não volta ao quadro", () => {
    for (const de of ["pago", "baixado", "encerrado", "cancelamento"]) {
      expect(avaliarMovimentoDeCaso(caso(de), "aberto", admin), de).toEqual({ tipo: "recusado", motivo: MOTIVO_CASO_FECHADO });
    }
  });

  it("negativado não volta a aberto nem a em_contato — a máquina de estados manda", () => {
    expect(avaliarMovimentoDeCaso(caso("negativado"), "aberto", admin).tipo).toBe("recusado");
    expect(avaliarMovimentoDeCaso(caso("negativado"), "em_contato", admin).tipo).toBe("recusado");
    // ...mas negocia e paga.
    expect(avaliarMovimentoDeCaso(caso("negativado"), "negociando", operador)).toEqual({ tipo: "negociar" });
    expect(avaliarMovimentoDeCaso(caso("negativado"), "pago", operador)).toEqual({ tipo: "direto", status: "pago" });
  });

  it("a frase de recusa nunca é vazia", () => {
    const r = avaliarMovimentoDeCaso(caso("pago"), "aberto", admin);
    expect(r.tipo === "recusado" && r.motivo.length > 10).toBe(true);
    expect(MOTIVO_MESMA_COLUNA.length).toBeGreaterThan(5);
  });
});

describe("tituloDoMovimento", () => {
  it("tem frase para cada coluna de destino direto", () => {
    for (const s of ["em_contato", "aberto", "pago", "negativado", "baixado", "encerrado", "cancelamento"] as const) {
      expect(tituloDoMovimento(s)).not.toBe("Caso movido");
    }
  });
});
