import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * `ecosystem.demo.config.cjs` — revisão final de segurança antes da
 * demonstração pública (item 6).
 *
 * Antes, `dotenv.config({ path: ".env.demo" })` resolvia contra o CWD de quem
 * chama `pm2 start` — não contra este arquivo. Iniciado de qualquer outro
 * diretório, `.parsed` vinha vazio e o `|| {}` fazia o par da demo herdar o
 * env que o DAEMON do pm2 já carregava, que nesta máquina foi o de produção
 * (o par de produção sobe primeiro, no mesmo daemon). Agora o path é ANCORADO
 * em `__dirname` (funciona não importa de onde o comando é chamado) e a
 * ausência do arquivo é ERRO FATAL, não um `{}` silencioso.
 *
 * O teste roda o arquivo de verdade num processo Node LIMPO via
 * `execFileSync` — não um `import`/`require` direto deste `.test.ts`, que é
 * ESM (o projeto inteiro é `"type": "module"`) e não teria `require` global
 * disponível do jeito que o pm2 (CommonJS puro) invoca este `.cjs`. É a
 * mesma situação real: "pm2 start" rodando de um diretório qualquer.
 */

const RAIZ_DO_REPO = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(RAIZ_DO_REPO, "ecosystem.demo.config.cjs");
const ENV_DEMO_PATH = path.join(RAIZ_DO_REPO, ".env.demo");

function requerDeOutroDiretorio(cwdAlternativo: string): { codigo: number; saida: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["-e", `const c = require(${JSON.stringify(CONFIG_PATH)}); console.log(JSON.stringify(c.apps.map((a) => a.env)));`],
      { cwd: cwdAlternativo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { codigo: 0, saida: stdout };
  } catch (err: any) {
    return { codigo: typeof err.status === "number" ? err.status : 1, saida: String(err.stderr ?? err.message ?? "") };
  }
}

describe("ecosystem.demo.config.cjs — .env.demo ancorado no arquivo, nao no cwd de quem chama", () => {
  afterEach(() => {
    if (fs.existsSync(ENV_DEMO_PATH)) fs.unlinkSync(ENV_DEMO_PATH);
  });

  it("sem .env.demo no repo, o processo lanca em vez de subir com env vazio (pressuposto: .env.demo e gitignored e nao existe neste checkout)", () => {
    expect(fs.existsSync(ENV_DEMO_PATH)).toBe(false);

    const r = requerDeOutroDiretorio(os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/nao encontrei/);
    expect(r.saida).toMatch(/\.env\.demo/);
  });

  it("com .env.demo presente na RAIZ DO REPO, encontra o arquivo mesmo chamado de outro diretorio", () => {
    fs.writeFileSync(ENV_DEMO_PATH, "MARCADOR_DE_TESTE=valor-unico-do-teste\n");

    // Chamado do tmpdir do sistema — nunca da raiz do repo — e prova que o
    // path nao depende de onde o comando roda.
    const r = requerDeOutroDiretorio(os.tmpdir());

    expect(r.codigo).toBe(0);
    // O dotenv imprime uma dica ("[dotenv@x] injecting env...") no stdout
    // ANTES do nosso console.log — a ultima linha nao vazia e a nossa.
    const linhas = r.saida.trim().split("\n");
    const envsDosDoisProcessos = JSON.parse(linhas[linhas.length - 1]);
    expect(envsDosDoisProcessos).toHaveLength(2); // consulta-isp-demo + consulta-isp-demo-worker
    for (const env of envsDosDoisProcessos) {
      expect(env.MARCADOR_DE_TESTE).toBe("valor-unico-do-teste");
    }
  });
});
