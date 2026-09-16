import { describe, expect, it } from "vitest";
import { lerKanban } from "../../components/cobranca/tipos";
import { queryDoKanban } from "./kanban";

describe("Gestão de cobranças: totais e atenção", () => {
  it("preserva valor agregado da coluna paginada sem somar os cards", () => {
    const quadro = lerKanban({ colunas: [{ status: "aberto", total: 300, valorTotal: "12500.50", truncado: true, casos: [] }] });
    expect(quadro.colunas[0].valorTotal).toBe(12500.5);
  });
  it("mantém valor desconhecido quando servidor antigo não envia a soma", () => {
    expect(lerKanban({ colunas: [{ status: "aberto", total: 300, truncado: true }] }).colunas[0].valorTotal).toBeNull();
  });
  it("envia filtro de atenção ao servidor", () => {
    expect(queryDoKanban({ escopo: "todos", etapa: "", carteira: "ativo", busca: "", atencao: "sem_responsavel" })).toBe("?carteira=ativo&atencao=sem_responsavel");
  });
});
