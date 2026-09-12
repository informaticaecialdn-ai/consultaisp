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
  /**
   * `iniciarLimpezaDaDemo()` tem TRY/CATCH PRÓPRIO, separado do que detecta
   * `emModoDemo()` — rodada de correção (revisão final de segurança, item
   * 6). Uma versão anterior juntava os dois: um throw ao iniciar a limpeza
   * caía no MESMO catch que loga "Deteccao de modo demo falhou", uma
   * mensagem que MENTE (a detecção funcionou; foi o scheduler que não subiu)
   * e, combinado com o teto de sandboxes vivos (item 3), deixava a
   * demonstração presa em 503 para sempre com um aviso apontando pra causa
   * errada.
   */
  it("iniciarLimpezaDaDemo roda dentro de if (emModoDemo()), num try/catch PROPRIO — nao solta, e nao se confunde com falha de deteccao", () => {
    expect(fonte).toContain(
      'if (emModoDemo()) {\n    try {\n      const { iniciarLimpezaDaDemo } = await import("./demo/limpeza.service");\n      iniciarLimpezaDaDemo();',
    );
    expect(fonte).toMatch(/} catch \(err\) \{\s*\n\s*logger\.error\(\s*\n\s*\{ err \},\s*\n\s*"\[Worker\] Limpeza de sandboxes da demo falhou ao iniciar/);
  });

  /**
   * A DETECÇÃO em si (o `import("./demo/modo-demo")`) está dentro de um
   * try/catch — revisão final de segurança antes da demonstração pública
   * (item 6). Sem ele, uma rejeição pularia — sem log, sem captura — todo o
   * resto desta IIFE: o laço da autonomia do chat, os handlers de
   * SIGTERM/SIGINT e a cadeia do mapa mais abaixo nunca seriam registrados.
   *
   * O try AGORA é ESTREITO — só a detecção, nunca o start da limpeza (ver o
   * teste acima): é essa a correção desta rodada.
   */
  it("a deteccao de emModoDemo() esta dentro de um try/catch ESTREITO — so a deteccao, nao o start da limpeza", () => {
    expect(fonte).toContain(
      'let emModoDemo: () => boolean = () => false;\n  try {\n    ({ emModoDemo } = await import("./demo/modo-demo"));\n  } catch (err) {',
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
