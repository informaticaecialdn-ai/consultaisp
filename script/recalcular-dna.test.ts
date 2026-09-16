import { describe, expect, it, vi } from "vitest";
import { lerArgumentos, recalcularDna, type DependenciasDoRecalculo, type CasoParaRecalculo } from "./recalcular-dna";

const hoje = new Date(2026, 8, 13);
const caso = (dados: Partial<CasoParaRecalculo> = {}): CasoParaRecalculo => ({
  id: 1, quadranteDna: "C3", tom: "negociar_reter",
  cliente: { id: 42, statusErp: "cancelled", contractStartDate: "2020-01-01", diasAtraso: 1500, faturasAbertas: 4 },
  ...dados,
});
function dependencias(casos: CasoParaRecalculo[]) {
  const atualizar = vi.fn(async (_providerId: number, id: number, dna: { quadranteDna: string | null; tom: string | null; arbitrado: boolean }) => {
    Object.assign(casos.find(c => c.id === id)!, dna);
  });
  const deps: DependenciasDoRecalculo = {
    comTrava: async (_chave, executar) => executar(),
    historicos: async () => new Map(),
    listar: async (_providerId, pagina) => ({ linhas: pagina === 1 ? casos : [], total: casos.length }),
    atualizar,
  };
  return { deps, atualizar };
}

describe("recalcular DNA isoladamente", () => {
  it("exige provedor explícito e só aplica com a opção exata", () => {
    expect(lerArgumentos(["--provider", "1"])).toEqual({ providerId: 1, aplicar: false });
    expect(lerArgumentos(["--provider", "1", "--aplicar"])).toEqual({ providerId: 1, aplicar: true });
    for (const args of [[], ["--provider", "0"], ["--provider", "1.5"], ["--provider", "1", "--apply"], ["--provider", "1", "--provider", "2"]]) {
      expect(() => lerArgumentos(args)).toThrow();
    }
  });
  it("prévia calcula mudanças, preserva vulnerável e não grava", async () => {
    const { deps, atualizar } = dependencias([caso(), caso({ id: 2, tom: "humanizado_vulneravel" })]);
    const resumo = await recalcularDna({ providerId: 1, aplicar: false }, deps, hoje);
    expect(resumo).toMatchObject({ examinados: 2, alteracoes: 2, aplicados: 0, vulneraveisPreservados: 1, exClientesSemDna: 2 });
    expect(atualizar).not.toHaveBeenCalled();
  });
  it("aplicação altera só DNA e repetir é idempotente", async () => {
    const lista = [caso(), caso({ id: 2, tom: "humanizado_vulneravel" })];
    const { deps, atualizar } = dependencias(lista);
    expect(await recalcularDna({ providerId: 1, aplicar: true }, deps, hoje)).toMatchObject({ alteracoes: 2, aplicados: 2 });
    expect(atualizar).toHaveBeenCalledWith(1, 2, { quadranteDna: null, tom: "humanizado_vulneravel", arbitrado: false });
    expect(await recalcularDna({ providerId: 1, aplicar: true }, deps, hoje)).toMatchObject({ alteracoes: 0, aplicados: 0 });
    expect(atualizar).toHaveBeenCalledTimes(2);
  });
  it("sem a trava do provedor não lê nem altera casos", async () => {
    const { deps, atualizar } = dependencias([caso()]);
    deps.comTrava = async () => null;
    const listar = vi.spyOn(deps, "listar");
    await expect(recalcularDna({ providerId: 6, aplicar: true }, deps, hoje)).rejects.toThrow(/em andamento/);
    expect(listar).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
  });
  it("recorta a consulta pelo provedor e usa encerramento confirmado", async () => {
    const { deps, atualizar } = dependencias([caso()]);
    deps.historicos = vi.fn(async () => new Map([[42, { historicoInsuficiente: false, faturasPagas: 5, faturasPagasComAtraso: 0, recebido: 500, taxaAtraso: 0, fonte: "pagamentos_com_data" as const, ultimaConfirmacaoEm: new Date("2020-06-01"), encerramentoConfirmadoEm: "2020-07-01" }]]));
    await recalcularDna({ providerId: 6, aplicar: true }, deps, hoje);
    expect(deps.historicos).toHaveBeenCalledWith(6, hoje);
    expect(atualizar).toHaveBeenCalledWith(6, 1, { quadranteDna: "A1", tom: "ex_esclarecedor", arbitrado: false });
  });
});
