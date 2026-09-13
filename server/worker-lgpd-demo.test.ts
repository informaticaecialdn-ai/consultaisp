/**
 * O processador de pedidos de titular (LGPD) não roda na demonstração
 * (auditoria de isolamento de 13/09/2026, L3). Ele anonimiza, PELO CPF, as
 * consultas de todos os provedores, e na demonstração os CPFs da rede se
 * repetem em todo sandbox e no mundo base: o pedido de um visitante apagaria o
 * histórico de todos os outros. A rota pública já recusa o pedido na
 * demonstração; esta guarda cobre o que já estivesse gravado no banco.
 *
 * Mesmo molde de `worker-chat-demo.test.ts`: o IIFE de `worker.ts` valida env,
 * abre pool e liga schedulers reais no import, então a amarração é travada
 * pelo FONTE. `emModoDemo?.() !== true` liga (produção, ou detecção falhando),
 * `true` não liga.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Normaliza CRLF: numa copia de trabalho no Windows (core.autocrlf) o fonte
// chega com \r\n, e as amarras abaixo sao escritas com \n.
const fonte = readFileSync(new URL("./worker.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("o worker nao liga o processador de pedidos de titular em modo demonstracao", () => {
  it("a deteccao de emModoDemo acontece ANTES do start do processador", () => {
    const deteccao = fonte.indexOf('({ emModoDemo } = await import("./demo/modo-demo"));');
    expect(deteccao).toBeGreaterThan(-1);
    expect(deteccao).toBeLessThan(fonte.indexOf("startTitularProcessor();"));
  });

  it("startTitularProcessor so roda fora da demonstracao, e e a unica chamada do arquivo", () => {
    expect(fonte).toContain(
      "if (emModoDemo?.() !== true) {\n    try {\n      const { startTitularProcessor } = await import(\"./services/lgpd-titular.service\");\n      startTitularProcessor();",
    );
    expect(fonte).toContain("logger.info(\"[Worker] Pedidos de titular (LGPD): processador desligado na demonstração\");");
    expect(fonte.match(/startTitularProcessor\(\);/g)).toHaveLength(1);
  });

  it("a retencao por idade continua ligando sempre — ela nao depende do que um visitante pede", () => {
    expect(fonte).toContain("startRetentionScheduler();");
  });
});
