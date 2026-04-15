export interface ScoreUpdate {
  perfil: number;
  comportamento: number;
}

export interface ScoreResult {
  scorePerfil: number;
  scoreComportamento: number;
  scoreTotal: number;
  classificacao: string;
}

export function calculateScore(
  currentPerfil: number,
  currentComportamento: number,
  update: ScoreUpdate
): ScoreResult {
  const scorePerfil = Math.max(0, Math.min(50, currentPerfil + update.perfil));
  const scoreComportamento = Math.max(0, Math.min(50, currentComportamento + update.comportamento));
  const scoreTotal = scorePerfil + scoreComportamento;
  const classificacao =
    scoreTotal >= 81 ? "ultra_quente" :
    scoreTotal >= 61 ? "quente" :
    scoreTotal >= 31 ? "morno" : "frio";

  return { scorePerfil, scoreComportamento, scoreTotal, classificacao };
}

export function shouldHandoff(scoreTotal: number, agenteAtual: string): string | null {
  if (scoreTotal >= 81 && agenteAtual === "lucas") return "rafael";
  if (scoreTotal >= 61 && agenteAtual === "carlos") return "lucas";
  if (scoreTotal < 31 && agenteAtual === "carlos") return "sofia";
  if (scoreTotal < 31 && agenteAtual === "lucas") return "sofia";
  return null;
}

export function getEtapaForAgente(agente: string): string {
  const etapaMap: Record<string, string> = {
    sofia: "nurturing",
    carlos: "qualificacao",
    lucas: "negociacao",
    rafael: "fechamento",
  };
  return etapaMap[agente] || "novo";
}
