import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * `ecosystem.config.cjs` (PRODUÇÃO) — revisão final de segurança antes da
 * demonstração pública (item 4).
 *
 * Mesmo defeito que `ecosystem.demo.config.cjs` tinha antes de ser corrigido
 * (`script/ecosystem-demo-config.test.ts`): `dotenv.config()` sem `path`
 * resolvia ".env" contra o CWD de quem chama `pm2 start` — não contra este
 * arquivo. Rodando de qualquer outro diretório (ou herdando o cwd que o
 * DAEMON do pm2 guarda desde o primeiro `pm2 start` na máquina), `.parsed`
 * vinha vazio e o antigo `|| {}` fazia este par herdar o env que o daemon já
 * tinha carregado em memória. Ali o risco era a demo herdar produção; aqui é
 * o INVERSO e mais grave: se o daemon um dia carregar o env da demonstração
 * antes deste par subir, PRODUÇÃO boota em `DEMO_MODE=true` — cadastro
 * fechado, bureaus simulados, faixa de "dados fictícios" para provedores
 * pagantes, tudo em silêncio.
 *
 * Agora o path é ANCORADO em `__dirname` (funciona não importa de onde o
 * comando é chamado) e a ausência do arquivo é ERRO FATAL, não um `{}`
 * silencioso.
 *
 * O teste roda o arquivo de verdade num processo Node LIMPO via
 * `execFileSync` — não um `import`/`require` direto deste `.test.ts`, que é
 * ESM (o projeto inteiro é `"type": "module"`) e não teria `require` global
 * disponível do jeito que o pm2 (CommonJS puro) invoca este `.cjs`. É a
 * mesma situação real: "pm2 start" rodando de um diretório qualquer.
 */

const RAIZ_DO_REPO = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(RAIZ_DO_REPO, "ecosystem.config.cjs");
const ENV_PATH = path.join(RAIZ_DO_REPO, ".env");

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

describe("ecosystem.config.cjs — .env ancorado no arquivo, nao no cwd de quem chama", () => {
  afterEach(() => {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
  });

  it("sem .env no repo, o processo lanca em vez de subir com env vazio (pressuposto: .env e gitignored e nao existe neste checkout)", () => {
    expect(fs.existsSync(ENV_PATH)).toBe(false);

    const r = requerDeOutroDiretorio(os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/nao encontrei/);
    expect(r.saida).toMatch(/\.env\b/);
  });

  it("com .env presente na RAIZ DO REPO, encontra o arquivo mesmo chamado de outro diretorio", () => {
    fs.writeFileSync(ENV_PATH, "MARCADOR_DE_TESTE=valor-unico-do-teste\n");

    // Chamado do tmpdir do sistema — nunca da raiz do repo — e prova que o
    // path nao depende de onde o comando roda.
    const r = requerDeOutroDiretorio(os.tmpdir());

    expect(r.codigo).toBe(0);
    // O dotenv imprime uma dica ("[dotenv@x] injecting env...") no stdout
    // ANTES do nosso console.log — a ultima linha nao vazia e a nossa.
    const linhas = r.saida.trim().split("\n");
    const envsDosDoisProcessos = JSON.parse(linhas[linhas.length - 1]);
    expect(envsDosDoisProcessos).toHaveLength(2); // consulta-isp + consulta-isp-worker
    for (const env of envsDosDoisProcessos) {
      expect(env.MARCADOR_DE_TESTE).toBe("valor-unico-do-teste");
    }
  });

  /**
   * A prova de que este arquivo (produção) e o da demo NÃO se confundem:
   * cada um lê o PRÓPRIO .env, mesmo os dois presentes ao mesmo tempo na
   * raiz do repo — que é exatamente a situação real na VPS, que hospeda os
   * dois pares no mesmo checkout.
   */
  it("com .env E .env.demo presentes, este arquivo le SO o .env — nunca o da demo", () => {
    const ENV_DEMO_PATH = path.join(RAIZ_DO_REPO, ".env.demo");
    fs.writeFileSync(ENV_PATH, "MARCADOR_DE_TESTE=producao\n");
    fs.writeFileSync(ENV_DEMO_PATH, "MARCADOR_DE_TESTE=demo\n");
    try {
      const r = requerDeOutroDiretorio(os.tmpdir());

      expect(r.codigo).toBe(0);
      const linhas = r.saida.trim().split("\n");
      const envsDosDoisProcessos = JSON.parse(linhas[linhas.length - 1]);
      for (const env of envsDosDoisProcessos) {
        expect(env.MARCADOR_DE_TESTE).toBe("producao");
      }
    } finally {
      if (fs.existsSync(ENV_DEMO_PATH)) fs.unlinkSync(ENV_DEMO_PATH);
    }
  });
});
