/**
 * Primeiros contatos e autonomia do chat não rodam na demonstração (leva de
 * 12/09/2026, Frente A). O chat simulado deixa a integração do sandbox
 * "pronta", e sem a guarda um visitante que liga o envio automático em
 * `PUT /api/chat-bullq/automacao` põe os dois laços para agir no sandbox.
 *
 * Mesmo molde de `worker-limpeza-demo.test.ts` e
 * `worker-cadeia-mapa-demo.test.ts`: o IIFE de `worker.ts` valida env, abre
 * pool e liga schedulers reais no import, então a amarração é travada pelo
 * FONTE. Os dois lados ficam no mesmo `if`: `emModoDemo?.() !== true` liga
 * (produção, ou detecção falhando), `true` não liga.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Normaliza CRLF: numa copia de trabalho no Windows (core.autocrlf) o fonte
// chega com \r\n, e as amarras abaixo sao escritas com \n.
const fonte = readFileSync(new URL("./worker.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("o worker nao liga primeiros contatos nem autonomia do chat em modo demonstracao", () => {
  it("a deteccao de emModoDemo acontece ANTES dos dois starts — antes ela vinha depois dos primeiros contatos", () => {
    const deteccao = fonte.indexOf('({ emModoDemo } = await import("./demo/modo-demo"));');
    expect(deteccao).toBeGreaterThan(-1);
    expect(deteccao).toBeLessThan(fonte.indexOf("iniciarPrimeirosContatos();"));
    expect(deteccao).toBeLessThan(fonte.indexOf("await tentarLigarAutonomia();"));
  });

  it("iniciarPrimeirosContatos so roda fora da demonstracao, e e a unica chamada do arquivo", () => {
    expect(fonte).toContain(
      "if (emModoDemo?.() !== true) {\n    iniciarPrimeirosContatos();\n  } else {\n    logger.info(\"[Worker] Primeiros contatos do chat: desligados na demonstração\");\n  }",
    );
    expect(fonte.match(/iniciarPrimeirosContatos\(\);/g)).toHaveLength(1);
  });

  it("a primeira tentativa de ligar a autonomia so roda fora da demonstracao — as seguintes nascem dela", () => {
    expect(fonte).toContain(
      "if (emModoDemo?.() !== true) {\n    await tentarLigarAutonomia();\n  } else {\n    logger.info(\"[Worker] Autonomia do chat: desligada na demonstração\");\n  }",
    );
    expect(fonte.match(/await tentarLigarAutonomia\(\)/g)).toHaveLength(1);
  });

  it("o shutdown continua parando os dois laços sempre — parar o que nunca ligou e inofensivo", () => {
    expect(fonte).toContain("await pararPrimeirosContatos();");
    expect(fonte).toContain("await pararAutonomia();");
  });
});
