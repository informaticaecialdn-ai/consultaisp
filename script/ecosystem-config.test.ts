import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * `ecosystem.config.cjs` (PRODUÇÃO) — revisão final de segurança antes da
 * demonstração pública (item 4), e a correção do PRÓPRIO teste na rodada
 * seguinte (defeito crítico 2).
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
 * DEFEITO CRÍTICO 2 (achado numa revisão adversarial desta MESMA suíte): a
 * primeira versão deste arquivo escrevia e apagava `.env` NA RAIZ DO REPO —
 * `afterEach` chamava `fs.unlinkSync(ENV_PATH)` contra o `.env` de VERDADE.
 * `npm test` é `vitest run`; rodar a suíte UMA VEZ dentro de
 * `/var/www/consulta-isp` (conferindo um build, caçando um bug) apagava o
 * `.env` de PRODUÇÃO — e como o `ecosystem.config.cjs` da mesma correção
 * passou a lançar sem `.env`, produção nem reiniciava depois. As duas
 * metades se somavam exatamente no desastre que a correção existia para
 * evitar.
 *
 * A correção: este arquivo NUNCA toca a raiz do repo. Cada teste copia
 * `ecosystem.config.cjs` (o arquivo de verdade, só LIDO daqui) para um
 * diretório novo em `os.tmpdir()` e escreve o `.env` de teste AO LADO da
 * cópia — é exatamente o `__dirname` ancorado no PRÓPRIO arquivo que estamos
 * testando, então a prova continua sendo sobre a propriedade real (o path
 * não depende de onde `pm2 start` é chamado), só que nunca mais encosta no
 * `.env`/`.env.demo` do checkout.
 *
 * `require("dotenv")` de dentro da cópia em `os.tmpdir()` não acharia o
 * módulo sozinho (a resolução do Node sobe a árvore de diretórios a partir
 * do ARQUIVO, não do repo) — por isso o processo filho ganha `NODE_PATH`
 * apontando para o `node_modules` real deste checkout.
 *
 * O teste roda o arquivo de verdade num processo Node LIMPO via
 * `execFileSync` — não um `import`/`require` direto deste `.test.ts`, que é
 * ESM (o projeto inteiro é `"type": "module"`) e não teria `require` global
 * disponível do jeito que o pm2 (CommonJS puro) invoca este `.cjs`. É a
 * mesma situação real: "pm2 start" rodando de um diretório qualquer.
 */

const RAIZ_DO_REPO = path.resolve(__dirname, "..");
const CONFIG_DE_VERDADE = path.join(RAIZ_DO_REPO, "ecosystem.config.cjs");
const NODE_MODULES_DO_REPO = path.join(RAIZ_DO_REPO, "node_modules");

/** Copia `ecosystem.config.cjs` para uma pasta nova em `os.tmpdir()` — nunca escreve na raiz do repo. */
function prepararCopiaEmTemp(): { pastaTemp: string; configCopiado: string } {
  const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), "consulta-isp-ecosystem-"));
  const configCopiado = path.join(pastaTemp, "ecosystem.config.cjs");
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

describe("ecosystem.config.cjs — .env ancorado no arquivo, nao no cwd de quem chama", () => {
  let pastasParaLimpar: string[] = [];

  afterEach(() => {
    // Limpa as COPIAS em os.tmpdir() que este teste criou — nunca a raiz do
    // repo, que este arquivo (defeito 2) nao toca mais.
    for (const pasta of pastasParaLimpar) {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
    pastasParaLimpar = [];
  });

  it("sem .env ao lado do arquivo, o processo lanca em vez de subir com env vazio", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    expect(fs.existsSync(path.join(pastaTemp, ".env"))).toBe(false);

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/nao encontrei/);
    expect(r.saida).toMatch(/\.env\b/);
  });

  it("com .env presente AO LADO DA CÓPIA, encontra o arquivo mesmo chamado de outro diretorio", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env"), "MARCADOR_DE_TESTE=valor-unico-do-teste\nDATABASE_URL=postgresql://prod\n");

    // Chamado do tmpdir do sistema — nunca da pasta da copia — e prova que o
    // path nao depende de onde o comando roda.
    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

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
   * cada um lê o PRÓPRIO .env, mesmo os dois presentes ao mesmo tempo lado a
   * lado — que é exatamente a situação real na VPS, que hospeda os dois
   * pares no mesmo checkout.
   */
  it("com .env E .env.demo lado a lado, este arquivo le SO o .env — nunca o da demo", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env"), "MARCADOR_DE_TESTE=producao\nDATABASE_URL=postgresql://prod\n");
    fs.writeFileSync(path.join(pastaTemp, ".env.demo"), "MARCADOR_DE_TESTE=demo\nDATABASE_URL=postgresql://demo\n");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).toBe(0);
    const linhas = r.saida.trim().split("\n");
    const envsDosDoisProcessos = JSON.parse(linhas[linhas.length - 1]);
    for (const env of envsDosDoisProcessos) {
      expect(env.MARCADOR_DE_TESTE).toBe("producao");
    }
  });

  /**
   * Item 3 da rodada seguinte: `.env.example` não lista `DEMO_MODE`, então um
   * `.env` de produção típico também não a declara — e para toda chave que
   * `app.env` não define, o pm2 cai para o ambiente do DAEMON. Sem o default
   * explícito, um `DEMO_MODE=true` que o daemon já tivesse em memória (por
   * exemplo, alguém testando a demo no mesmo shell antes de subir produção)
   * seria herdado em silêncio.
   */
  it("DEMO_MODE nao declarado no .env vira a string \"false\" no ambiente do processo — nunca herda o daemon", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env"), "DATABASE_URL=postgresql://prod\n");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).toBe(0);
    const linhas = r.saida.trim().split("\n");
    const envsDosDoisProcessos = JSON.parse(linhas[linhas.length - 1]);
    for (const env of envsDosDoisProcessos) {
      expect(env.DEMO_MODE).toBe("false");
    }
  });

  it("DEMO_MODE presente no .env sobrescreve o default \"false\" (nunca deveria estar assim em producao, mas quem manda e o arquivo)", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env"), "DATABASE_URL=postgresql://prod\nDEMO_MODE=true\n");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).toBe(0);
    const linhas = r.saida.trim().split("\n");
    const envsDosDoisProcessos = JSON.parse(linhas[linhas.length - 1]);
    for (const env of envsDosDoisProcessos) {
      expect(env.DEMO_MODE).toBe("true");
    }
  });

  /**
   * Item 4 da rodada seguinte: um `.env` de ZERO BYTES (cópia que parou pela
   * metade, um `>` no lugar de um `>>`) não produz erro nenhum do dotenv —
   * `.parsed` vem `{}`, vazio mas "bem-sucedido". Sem esta checagem o
   * processo subiria em silêncio sem NENHUMA variável real.
   */
  it("\".env\" vazio (0 bytes) e ERRO FATAL, nao um ambiente vazio silencioso", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env"), "");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/DATABASE_URL/);
  });

  it("\".env\" com conteudo mas SEM DATABASE_URL tambem e ERRO FATAL", () => {
    const { pastaTemp, configCopiado } = prepararCopiaEmTemp();
    pastasParaLimpar.push(pastaTemp);
    fs.writeFileSync(path.join(pastaTemp, ".env"), "SESSION_SECRET=qualquercoisa\n");

    const r = requerDeOutroDiretorio(configCopiado, os.tmpdir());

    expect(r.codigo).not.toBe(0);
    expect(r.saida).toMatch(/DATABASE_URL/);
  });
});
