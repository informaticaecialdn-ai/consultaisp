/**
 * Os pacotes que o esbuild EMBUTE no bundle do servidor. Todo o resto vira
 * `external` — fica no `node_modules` e é carregado por `require()` em tempo
 * de execução (ver `script/build.ts`).
 *
 * Mora num arquivo próprio, e não dentro do `build.ts`, por um motivo
 * mecânico: `build.ts` chama `buildAll()` no topo do módulo, então qualquer
 * `import` dele dispara um build inteiro. O teste que confere esta lista
 * (`script/pacotes-esm-externos.test.ts`) precisa lê-la sem construir nada.
 *
 * Duas razões colocam um pacote aqui:
 *
 * 1. **Velocidade de boot** (a razão original): menos `openat(2)`, arranque
 *    mais rápido.
 * 2. **Pacote ESM puro importado com `import X from`** — e essa é obrigatória,
 *    não uma otimização. O bundle é CJS, então o esbuild traduz o import para
 *    `__toESM(require("pacote"), 1)`. Com `isNodeMode = 1` esse helper grava
 *    em `.default` o resultado CRU do `require`. Para um pacote ESM puro em
 *    Node ≥ 20.19 (que tem `require(esm)`), esse resultado é o *namespace* do
 *    módulo — um objeto. Aí `(0, mod.default)(...)` chama um objeto, e o
 *    processo morre no CARREGAMENTO, antes da primeira requisição.
 *
 *    Import NOMEADO (`import { x } from`) não sofre disso: o `__copyProps` do
 *    mesmo helper copia as chaves do namespace, e `mod.x` é a função certa. É
 *    por isso que `vite` (ESM puro, externo) convive bem aqui — `server/vite.ts`
 *    só usa nomes.
 *
 * Custou uma demonstração fora do ar em 12/09/2026: `p-limit` entrou com
 * `import pLimit from "p-limit"` em `server/routes/demo.routes.ts`, o
 * `npm run build` fechou sem reclamar, os 6.321 testes passaram (o vitest roda
 * em ESM, onde o import é o de verdade), e o defeito só apareceu quando o pm2
 * tentou subir o bundle: `TypeError: (0 , Are.default) is not a function`.
 */
/**
 * Saíram daqui em 12/09/2026, junto com o conserto do `p-limit`, onze nomes
 * que não eram dependência declarada havia tempos — sobra de um `package.json`
 * antigo: `@google/generative-ai`, `axios`, `cors`, `express-rate-limit`,
 * `jsonwebtoken`, `multer`, `nanoid`, `nodemailer`, `stripe`, `uuid`, `xlsx`.
 *
 * A remoção é PROVADAMENTE inerte: o `build.ts` usa esta lista só para filtrar
 * (`allDeps.filter(dep => !allowlist.includes(dep))`), então nome que não casa
 * com dependência alguma nunca mudou o resultado — o conjunto `external` sai
 * idêntico com e sem eles. Foram removidos porque uma lista com entrada morta
 * esconde erro de digitação: `"p-limt"` também não casaria com nada, e o
 * pacote continuaria fora do bundle sem ninguém perceber. O segundo teste de
 * `pacotes-esm-externos.test.ts` é o que mantém isso honesto.
 */
export const PACOTES_EMBUTIDOS = [
  "connect-pg-simple",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "openai",
  // ESM puro + import default em server/routes/demo.routes.ts — obrigatório,
  // não otimização. Ver o bloco de comentário no topo deste arquivo.
  "p-limit",
  "passport",
  "passport-local",
  "pg",
  "ws",
  "zod",
  "zod-validation-error",
];
