/**
 * A corrida de boot entre a API (que aplica as migrações) e o worker.
 *
 * Medida no deploy de 06/09/2026: `pm2 start` sobe os dois juntos, a API
 * aplicou a 0028 às 14:57:25 e o worker conferiu as tabelas às 14:57:24 — um
 * segundo antes. As tabelas passaram a existir e a fila da autonomia ficou
 * desligada até alguém reiniciar o worker à mão. O conserto é tentar de novo
 * algumas vezes; este teste trava isso no fonte, que é o que a suíte alcança
 * sem subir o processo.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

describe("o worker liga a fila da autonomia mesmo perdendo a corrida do boot", () => {
  it("tenta mais de uma vez, com espera entre as tentativas", () => {
    expect(fonte).toContain("TENTATIVAS_DA_AUTONOMIA");
    expect(fonte).toContain("ESPERA_ENTRE_TENTATIVAS_MS");
    const tentativas = fonte.match(/const TENTATIVAS_DA_AUTONOMIA = (\d+)/);
    const espera = fonte.match(/const ESPERA_ENTRE_TENTATIVAS_MS = ([\d_]+)/);
    expect(tentativas).not.toBeNull();
    expect(Number(tentativas![1])).toBeGreaterThan(1);
    expect(Number(espera![1].replace(/_/g, ""))).toBeGreaterThanOrEqual(10_000);
  });

  it("desiste depois do teto, e o aviso diz o que fazer", () => {
    expect(fonte).toContain("tentativaDaAutonomia >= TENTATIVAS_DA_AUTONOMIA");
    expect(fonte).toContain("Reinicie o worker depois de aplicar a migração.");
  });

  it("a tentativa pendente não segura o processo nem sobrevive ao desligamento", () => {
    expect(fonte).toContain("timerDaAutonomia.unref()");
    expect(fonte).toContain("if (timerDaAutonomia) { clearTimeout(timerDaAutonomia); timerDaAutonomia = null; }");
  });

  it("o sucesso é registrado uma vez, com o número da tentativa", () => {
    expect(fonte).toContain('"[Worker] Autonomia do chat: fila ligada"');
    expect(fonte).toContain("{ tentativa: tentativaDaAutonomia }");
  });
});
