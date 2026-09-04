import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, readdir, copyFile, stat, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

/**
 * Onde ficam os assets dos builds ANTERIORES.
 *
 * Fora de `dist/`, de proposito: a primeira coisa que o build faz e apagar
 * `dist` inteiro, e um esconderijo la dentro morreria junto.
 */
const PASTA_DE_GRACA = "dist-assets-anteriores";
const ASSETS = path.join("dist", "public", "assets");

/** Por quantos dias um chunk de build antigo continua sendo servido. */
export const DIAS_DE_GRACA = 14;

/**
 * Guarda os assets do build que esta saindo, para devolve-los ao novo.
 *
 * O PORQUE, medido em producao em 04/09/2026: cada tela e um chunk separado
 * (`React.lazy`, em client/src/App.tsx) e o nome do arquivo carrega o hash do
 * conteudo. Ate aqui o build gravava os hashes novos e APAGAVA os antigos —
 * entao todo deploy quebrava as abas que ja estavam abertas: o proximo clique
 * em qualquer menu pedia um `.js` que nao existia mais, dava 404, o import
 * dinamico rejeitava, e o ErrorBoundary trocava o app inteiro pelo cartao
 * "Algo deu errado". O dono relatou como "isso esta acontecendo em cada menu
 * que clica" — e era literal: todo menu e um chunk.
 *
 * O log do nginx daquele dia tem a assinatura: `anti-fraude-BtSNX9uk.js`,
 * `dashboard-CWn2P--S.js` e mais uma duzia, todos 404, no minuto do relato.
 *
 * Guardar os antigos por `DIAS_DE_GRACA` faz o deploy deixar de ser um evento
 * que derruba quem esta usando. A rede de seguranca da outra ponta esta em
 * `client/src/lib/pagina-do-deploy.ts`: se um chunk sumir mesmo assim, a tela
 * se recarrega sozinha uma vez em vez de mostrar o cartao de erro.
 *
 * Um chunk entra na pasta de graca UMA vez e nunca e sobrescrito — entao a data
 * dele e a de quando foi visto pela primeira vez, que e o relogio certo para a
 * poda. Sobrescrever a cada build renovaria a validade e a poda nunca chegaria.
 */
async function guardarAssetsDoBuildAnterior(): Promise<number> {
  if (!existsSync(ASSETS)) return 0;
  await mkdir(PASTA_DE_GRACA, { recursive: true });
  let guardados = 0;
  for (const nome of await readdir(ASSETS)) {
    const destino = path.join(PASTA_DE_GRACA, nome);
    if (existsSync(destino)) continue;
    await copyFile(path.join(ASSETS, nome), destino);
    guardados++;
  }
  return guardados;
}

/** Devolve ao build novo os assets antigos que ele nao regerou. */
async function restaurarAssetsAntigos(): Promise<number> {
  if (!existsSync(PASTA_DE_GRACA)) return 0;
  await mkdir(ASSETS, { recursive: true });
  let devolvidos = 0;
  for (const nome of await readdir(PASTA_DE_GRACA)) {
    const destino = path.join(ASSETS, nome);
    if (existsSync(destino)) continue;
    await copyFile(path.join(PASTA_DE_GRACA, nome), destino);
    devolvidos++;
  }
  return devolvidos;
}

/** Poda o que passou da janela — sem isso a pasta cresce para sempre. */
async function podarAssetsVencidos(agora: number): Promise<number> {
  if (!existsSync(PASTA_DE_GRACA)) return 0;
  const limite = agora - DIAS_DE_GRACA * 24 * 60 * 60 * 1000;
  let podados = 0;
  for (const nome of await readdir(PASTA_DE_GRACA)) {
    const arquivo = path.join(PASTA_DE_GRACA, nome);
    if ((await stat(arquivo)).mtimeMs >= limite) continue;
    await unlink(arquivo);
    podados++;
  }
  return podados;
}

async function buildAll() {
  const guardados = await guardarAssetsDoBuildAnterior();
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  const devolvidos = await restaurarAssetsAntigos();
  const podados = await podarAssetsVencidos(Date.now());
  console.log(
    `assets de builds anteriores: ${guardados} guardados, ${devolvidos} devolvidos, ${podados} podados`,
  );

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("building worker...");
  await esbuild({
    entryPoints: ["server/worker.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/worker.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
