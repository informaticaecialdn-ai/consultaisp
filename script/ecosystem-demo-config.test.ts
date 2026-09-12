import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * `ecosystem.demo.config.cjs` — revisão final de segurança antes da
 * demonstração pública (item 6), e a correção do PRÓPRIO teste na rodada
 * seguinte (defeito crítico 2, o mesmo que atingia `ecosystem-config.test.ts`).
 *
 * Antes, `dotenv.config({ path: ".env.demo" })` resolvia contra o CWD de quem
 * chama `pm2 start` — não contra este arquivo. Iniciado de qualquer outro
 * diretório, `.parsed` vinha vazio e o `|| {}` fazia o par da demo herdar o
 * env que o DAEMON do pm2 já carregava, que nesta máquina foi o de produção
 * (o par de produção sobe primeiro, no mesmo daemon). Agora o path é ANCORADO
 * em `__dirname` (funciona não importa de onde o comando é chamado) e a
 * ausência do arquivo é ERRO FATAL, não um `{}` silencioso.
 *
 * DEFEITO CRÍTICO 2 (achado numa revisão adversarial desta MESMA suíte, o
 * gêmeo do que atingia `ecosystem-config.test.ts`): a primeira versão deste
 * arquivo escrevia e apagava `.env.demo` NA RAIZ DO REPO de verdade —
 * `afterEach` chamava `fs.unlinkSync(ENV_DEMO_PATH)`. Rodar `npm test`
 * (`vitest run`) uma vez dentro do checkout de produção da VPS apagaria o
 * `.env.demo` real dela.
 *
 * A correção: este arquivo NUNCA toca a raiz do repo. Cada teste copia
 * `ecosystem.demo.config.cjs` (só LIDO daqui) para um diretório novo em
 * `os.tmpdir()` e escreve o `.env.demo` de teste AO LADO da cópia — é
 * exatamente o `__dirname` ancorado no PRÓPRIO arquivo que estamos testando,
 * então a prova continua sendo sobre a propriedade real, só que nunca mais
 * encosta no `.env`/`.env.demo` do checkout.
 *
 * `require("dotenv")` de dentro da cópia em `os.tmpdir()` não acharia o
 * módulo sozinho — por isso o processo filho ganha `NODE_PATH` apontando
 * para o `node_modules` real deste checkout.
 *
 * O teste roda o arquivo de verdade num processo Node LIMPO via
 * `execFileSync` — não um `import`/`require` direto deste `.test.ts`, que é
 * ESM (o projeto inteiro é `"type": "module"`) e não teria `require` global
 * disponível do jeito que o pm2 (CommonJS puro) invoca este `.cjs`. É a
 * mesma situação real: "pm2 start" rodando de um diretório qualquer.
 */

const RAIZ_DO_REPO = path.resolve(__dirname, "..");
const CONFIG_DE_VERDADE = path.join(RAIZ_DO_REPO, "ecosystem.demo.config.cjs");
const NODE_MODULES_DO_REPO = path.join(RAIZ_DO_REPO, "node_modules");

/** Copia `ecosystem.demo.config.cjs` para uma pasta nova em `os.tmpdir()` — nunca escreve na raiz do repo. */
function prepararCopiaEmTemp(): { pastaTemp: string; configCopiado: string } {
  const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), "consulta-isp-ecosystem-demo-"));
  const configCopiado = path.join(pastaTemp, "ecosystem.demo.config.cjs");
  fs.copyFileSync(CONFIG_DE_VERDADE, configCopiado);
  return { pastaTemp, configCopiado };
}

function requerDeOutroDiretorio(configPath: string, cwdAlternativo: string): { codigo: number; saida: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["-e", `const c = require(${JSON.stringify(configPath)}); console.log(JSON.stringify(c.apps.map((a) => a.env)));`],
      {
        cwd: cwdAlternativo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // Sem isto, `require("dotenv")` dentro da copia (em os.tmpdir()) nao
        // acharia o modulo — a resolucao do Node sobe a arvore de diretorios
        // a partir do ARQUIVO que faz o require, e um diretorio temporario
        // nao tem `node_modules` nenhum acima dele.
        env: { ...process.env, NODE_PATH: NODE_MODULES_DO_REPO },
      },
    );
    return { codigo: 0, saida: stdout };
  } catch (err: any) {
    return { codigo: typeof err.status === "number" ? err.status : 1, saida: String(err.stderr ?? err.message ?? "") };
  }
}

describe("ecosystem.demo.config.cjs — .env.demo ancorado no arquivo, nao no cwd de quem chama", () => {
  let pastasParaLimpar: string[] = [];

  afterEach(() => {
    // Limpa as COPIAS em os.tmpdir() que este teste criou — nunca a raiz do
    // repo, que este arquivo (defeito 2) nao toca mais.
    for (const pasta of pastasParaLimpar) {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
    pastasParaLimpar = [];
  });

  it("sem .env.demo ao lado do arquivo, o processo lanca em vez de subir com env vazio", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    expect(fs.existsSync(path.join(pastaTemp, ".env.demo"))).toBe(false);

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/nao encontrei/);
    expect(r.saida).toMatch(/\.env\.demo/);
  });

  it("com .env.demo presente AO LADO DA CÓPIA, encontra o arquivo mesmo chamado de outro diretorio", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env.demo"), "MARCADOR_DE_TESTE=valor-unico-do-teste\nDATABASE_URL=postgresql://demo\n");

    // Chamado do tmpdir do sistema — nunca da pasta da copia — e prova que o
    // path nao depende de onde o comando roda.
    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

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

  /**
   * Item 4 da rodada seguinte (o mesmo defeito do par de produção): um
   * `.env.demo` de ZERO BYTES não produz erro nenhum do dotenv — `.parsed`
   * vem `{}`, vazio mas "bem-sucedido". DATABASE_URL é a primeira variável
   * OBRIGATÓRIA de `.env.demo.example`; sem ela o arquivo está vazio ou
   * corrompido, e subir mesmo assim é o mesmo silêncio perigoso.
   */
  it("\".env.demo\" vazio (0 bytes) e ERRO FATAL, nao um ambiente vazio silencioso", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env.demo"), "");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/DATABASE_URL/);
  });

  it("\".env.demo\" com conteudo mas SEM DATABASE_URL tambem e ERRO FATAL", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env.demo"), "DEMO_MODE=true\n");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/DATABASE_URL/);
  });
});
