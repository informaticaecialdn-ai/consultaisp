/**
 * A cadeia do mapa (`iniciarCadeiaDoMapa`, `server/worker.ts`) baixa e carrega
 * censo real do IBGE, cidade a cidade, para cobrir a carteira de clientes sem
 * base de geocodificação. Achado na revisão de correção da Tarefa 11
 * (12/09/2026): a chamada era incondicional, então a instância de
 * demonstração baixava CNEFE de Londrina, Ibiporã, Cambé e Apucarana no
 * primeiro boot — sem necessidade nenhuma, já que os clientes fictícios
 * nascem com coordenada direto da semeadura
 * (`server/demo/pessoas-ficticias.ts`), e numa VPS que também roda produção.
 *
 * Mesmo molde de `worker-limpeza-demo.test.ts`: o IIFE de `worker.ts` valida
 * env, abre pool de conexão e liga schedulers reais no import — inviável (e
 * desnecessário) subir o processo inteiro só para provar duas linhas de `if`.
 * Trava-se pelo FONTE.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

describe("o worker so liga a cadeia do mapa fora do modo demonstracao", () => {
  it("iniciarCadeiaDoMapa roda dentro de if (!emModoDemo()), nao solta", () => {
    expect(fonte).toContain(
      'if (!emModoDemo()) {\n    iniciarCadeiaDoMapa().catch(err =>\n      logger.warn({ err }, "[Worker] Cadeia do mapa falhou ao iniciar"));\n  }',
    );
  });

  it("so existe UMA chamada a iniciarCadeiaDoMapa em todo o arquivo — nenhuma fora do guard", () => {
    // `iniciarCadeiaDoMapa()` sozinho tambem bate na PROPRIA declaracao
    // (`async function iniciarCadeiaDoMapa(): Promise<void>`, que nao tem
    // argumento) — o padrao com `.catch(` colado identifica so a CHAMADA.
    expect(fonte.match(/iniciarCadeiaDoMapa\(\)\.catch\(/g)).toHaveLength(1);
  });
});
