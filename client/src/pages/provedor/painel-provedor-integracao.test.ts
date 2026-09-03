import { describe, it, expect } from "vitest";
import { estadoDaIntegracao, desfechoDoLog } from "./painel-provedor";

/**
 * Os dois selos que o provedor le na aba Integracao.
 *
 * Sem os botoes de salvar, testar e sincronizar — que foram para o painel do
 * superadmin — este texto e o unico sinal que sobrou nesta tela. Quando ele
 * mente, o provedor abre chamado por um problema que nao existe ou deixa de
 * abrir por um que existe.
 */

const base = {
  erpSource: "ixc",
  isEnabled: true,
  configurado: true,
  status: "idle",
  lastSyncAt: "2026-09-01T03:00:00.000Z",
  lastSyncStatus: "success" as string | null,
  totalSynced: 1200,
  totalErrors: 0,
};

describe("estadoDaIntegracao", () => {
  it("integracao ligada e sincronizando le 'Integrada'", () => {
    expect(estadoDaIntegracao(base).texto).toBe("Integrada");
    expect(estadoDaIntegracao(base).tom).toBe("ok");
  });

  it("sem credencial completa le 'Aguardando configuracao', mesmo ligada", () => {
    const e = estadoDaIntegracao({ ...base, configurado: false });
    expect(e.texto).toBe("Aguardando configuracao");
    expect(e.tom).toBe("gated");
  });

  it("desligada sem marca de pausa le 'Desativada'", () => {
    const e = estadoDaIntegracao({ ...base, isEnabled: false });
    expect(e.texto).toBe("Desativada");
    expect(e.tom).toBe("neutro");
  });

  it("desligada com status 'pausado_por_falhas' le 'Pausada por falhas'", () => {
    const e = estadoDaIntegracao({ ...base, isEnabled: false, status: "pausado_por_falhas" });
    expect(e.texto).toBe("Pausada por falhas");
    expect(e.detalhe).toContain("pausada automaticamente");
  });

  /**
   * O defeito que motivou a reordenacao: `status` era lido antes de `isEnabled`.
   * Se a marca de pausa ficar presa por qualquer motivo — religamento que nao
   * limpou a coluna, migracao pela metade, escrita perdida — uma integracao
   * LIGADA e sincronizando aparecia como pausada.
   */
  it("integracao LIGADA nunca aparece como pausada, mesmo com o status preso", () => {
    const e = estadoDaIntegracao({ ...base, isEnabled: true, status: "pausado_por_falhas" });
    expect(e.texto).toBe("Integrada");
    expect(e.texto).not.toContain("Pausada");
  });

  it("ligada com status preso e ultima varredura em erro le a falha, nao a pausa", () => {
    const e = estadoDaIntegracao({ ...base, isEnabled: true, status: "pausado_por_falhas", lastSyncStatus: "error" });
    expect(e.texto).toBe("Falha na ultima sincronizacao");
    expect(e.tom).toBe("past");
  });
});

describe("desfechoDoLog", () => {
  it("traduz os tres desfechos de varredura", () => {
    expect(desfechoDoLog("success")).toEqual({ rotulo: "Sucesso", tom: "ok" });
    expect(desfechoDoLog("partial")).toEqual({ rotulo: "Parcial", tom: "gated" });
    expect(desfechoDoLog("error")).toEqual({ rotulo: "Erro", tom: "past" });
  });

  /**
   * 'reativado' e gravado pelo servidor quando o superadmin religa a
   * integracao. Sem estar mapeado, caia no ramo generico e virava "Parcial" —
   * um desfecho de varredura inventado para uma linha que nao e varredura.
   */
  it("religamento tem rotulo proprio e nao vira 'Parcial' nem 'Erro'", () => {
    const d = desfechoDoLog("reativado");
    expect(d.rotulo).toBe("Reativada");
    expect(d.tom).toBe("info");
  });

  it("status desconhecido nao ganha rotulo inventado", () => {
    expect(desfechoDoLog("algo_novo")).toEqual({ rotulo: "algo_novo", tom: "neutro" });
  });
});
