/**
 * O motor de atendimento como PROCESSO. A guarda de demonstração só é
 * observável de fora: o `main()` roda no import, então o teste sobe o worker
 * de verdade (tsx) e lê o código de saída e o log.
 *
 * O banco aponta para uma porta fechada de propósito: quem passa pela guarda
 * cai no `tabelasExistem()` e sai com "não iniciou" — é assim que o teste
 * distingue "recusou pela demonstração" de "seguiu adiante".
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

const RAIZ = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/server\/$/, "");

function motor(args: string[], env: Record<string, string>) {
  return new Promise<{ codigo: number | null; saida: string }>((resolve) => {
    const processo = spawn(process.execPath, [`${RAIZ}node_modules/tsx/dist/cli.mjs`, `${RAIZ}server/chat-worker.ts`, ...args], {
      cwd: RAIZ,
      env: { ...process.env, NODE_ENV: "development", SESSION_SECRET: "segredo-local-de-teste-nao-usar-em-producao-000", DATABASE_URL: "postgresql://x:y@127.0.0.1:1/x", ...env },
    });
    let saida = "";
    processo.stdout.on("data", (d) => { saida += d; });
    processo.stderr.on("data", (d) => { saida += d; });
    processo.on("close", (codigo) => resolve({ codigo, saida }));
  });
}

describe("chat-worker — guarda de demonstração", () => {
  it("--enviar em DEMO_MODE recusa com log claro e sai 0; ensaio na demo e envio fora dela seguem até o banco", async () => {
    const [demoEnvio, demoEnsaio, producaoEnvio] = await Promise.all([
      motor(["--enviar"], { DEMO_MODE: "true" }),
      motor([], { DEMO_MODE: "true" }),
      motor(["--enviar"], { DEMO_MODE: "false" }),
    ]);
    expect(demoEnvio.saida).toContain("Demonstração não envia");
    expect(demoEnvio.saida).not.toContain("não iniciou");
    expect(demoEnvio.codigo).toBe(0);
    // Os dois passam pela guarda e morrem no banco fechado: prova de que seguiram.
    for (const r of [demoEnsaio, producaoEnvio]) {
      expect(r.saida).not.toContain("Demonstração não envia");
      expect(r.saida).toContain("não iniciou");
      expect(r.codigo).toBe(1);
    }
  }, 120_000);
});
