/**
 * A limpeza de sandboxes da demo (Tarefa 7, `server/demo/limpeza.service.ts`)
 * só pode rodar na instância de demonstração. `server/worker.ts` decide isso
 * na CHAMADA — `if (emModoDemo())` em volta de `iniciarLimpezaDaDemo()` no
 * boot e de `pararLimpezaDaDemo()` no shutdown — e não dentro do serviço,
 * para que o timer só exista onde pode agir.
 *
 * Este teste trava a amarração pelo FONTE, no molde de
 * `worker-autonomia-boot.test.ts`: o IIFE de `worker.ts` valida env, abre
 * pool de conexão e liga schedulers reais no import — inviável (e
 * desnecessário) subir o processo inteiro só para provar duas linhas de
 * `if`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

describe("o worker so liga (e so desliga) a limpeza da demo em modo demonstracao", () => {
  it("iniciarLimpezaDaDemo roda dentro de if (emModoDemo()), nao solta", () => {
    expect(fonte).toContain(
      'if (emModoDemo()) {\n      const { iniciarLimpezaDaDemo } = await import("./demo/limpeza.service");\n      iniciarLimpezaDaDemo();',
    );
  });

  /**
   * A DETECÇÃO em si (o `import("./demo/modo-demo")`) está dentro de um
   * try/catch — revisão final de segurança antes da demonstração pública
   * (item 6). Sem ele, uma rejeição pularia — sem log, sem captura — todo o
   * resto desta IIFE: o laço da autonomia do chat, os handlers de
   * SIGTERM/SIGINT e a cadeia do mapa mais abaixo nunca seriam registrados.
   */
  it("a deteccao de emModoDemo() esta dentro de um try/catch, nao solta", () => {
    expect(fonte).toContain(
      'let emModoDemo: () => boolean = () => false;\n  try {\n    ({ emModoDemo } = await import("./demo/modo-demo"));',
    );
    expect(fonte).toMatch(/} catch \(err\) \{\s*\n\s*logger\.warn\(\{ err \}, "\[Worker\] Deteccao de modo demo falhou/);
  });

  it("pararLimpezaDaDemo e chamada (e esperada) no shutdown, dentro do mesmo guard", () => {
    expect(fonte).toContain(
      'if (emModoDemo()) {\n      const { pararLimpezaDaDemo } = await import("./demo/limpeza.service");\n      await pararLimpezaDaDemo();',
    );
  });

  it("so existe UMA chamada a iniciarLimpezaDaDemo em todo o arquivo — nenhuma fora do guard", () => {
    expect(fonte.match(/iniciarLimpezaDaDemo\(\)/g)).toHaveLength(1);
  });

  it("so existe UMA chamada a pararLimpezaDaDemo em todo o arquivo — nenhuma fora do guard", () => {
    expect(fonte.match(/pararLimpezaDaDemo\(\)/g)).toHaveLength(1);
  });
});
