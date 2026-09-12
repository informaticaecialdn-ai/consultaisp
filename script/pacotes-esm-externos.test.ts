import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { PACOTES_EMBUTIDOS } from "./pacotes-embutidos";

/**
 * A classe de defeito que NEM O BUILD NEM A SUÍTE PEGAM.
 *
 * O bundle do servidor é CJS (`script/build.ts`), e tudo que não está em
 * `PACOTES_EMBUTIDOS` sai como `external` — um `require()` de verdade, em
 * tempo de execução. Quando o pacote externo é ESM puro e o nosso código o
 * importa com `import X from "pacote"`, o esbuild emite:
 *
 *     var mod = __toESM(require("pacote"), 1);
 *     ... (0, mod.default)(1)
 *
 * e o `__toESM` com `isNodeMode = 1` grava em `.default` o resultado CRU do
 * `require`. Em Node ≥ 20.19 (que ganhou `require(esm)`) esse resultado é o
 * *namespace* do módulo — um OBJETO, não a função exportada por default. A
 * chamada morre com `TypeError: ... is not a function`, no CARREGAMENTO do
 * módulo, antes da primeira requisição.
 *
 * Por que nada mais pega isso:
 * - `npm run build` fecha sem um aviso: para o esbuild, `external` é uma
 *   instrução, não uma suspeita.
 * - `npx tsc --noEmit` fecha: nos TIPOS o default existe mesmo.
 * - `npx vitest run` fecha: o vitest roda o fonte em ESM, onde o import
 *   default é o de verdade. O bundle CJS nunca é exercitado.
 *
 * Só executar o bundle revela — e foi assim que apareceu, em 12/09/2026, com
 * o pm2 da demonstração em ciclo de reinício: `p-limit` (ESM puro, v7) tinha
 * entrado com import default em `server/routes/demo.routes.ts`.
 *
 * IMPORT NOMEADO NÃO TEM O PROBLEMA, e o teste não o acusa: o `__copyProps`
 * do mesmo helper copia as chaves do namespace, então `mod.createServer` é a
 * função certa. É por isso que `vite` — ESM puro e externo de propósito, por
 * ser devDependency pesada — convive bem: `server/vite.ts` só usa nomes.
 */

const RAIZ = path.resolve(__dirname, "..");

/** Os diretórios que ENTRAM no bundle do servidor. */
const FONTES_DO_BUNDLE = ["server", "shared"];

function arquivosDeFonte(dir: string, saida: string[] = []): string[] {
  const absoluto = path.join(RAIZ, dir);
  if (!existsSync(absoluto)) return saida;
  for (const entrada of readdirSync(absoluto, { withFileTypes: true })) {
    const relativo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "node_modules") arquivosDeFonte(relativo, saida);
      continue;
    }
    // Teste não é empacotado — o que ele importa não chega ao bundle.
    if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      saida.push(relativo);
    }
  }
  return saida;
}

/** "p-limit" de "p-limit", "@scope/x" de "@scope/x/sub". Devolve null para caminho relativo e alias. */
function nomeDoPacote(especificador: string): string | null {
  if (especificador.startsWith(".") || especificador.startsWith("@/")) return null;
  if (especificador.startsWith("@shared/") || especificador.startsWith("@assets/")) return null;
  if (especificador.startsWith("node:")) return null;
  const partes = especificador.split("/");
  return especificador.startsWith("@") ? partes.slice(0, 2).join("/") : partes[0];
}

/**
 * Acha os pacotes importados com DEFAULT (`import X from`, `import X, {a} from`).
 * Import só-nomeado, namespace e de efeito colateral ficam de fora de propósito.
 */
function importesDefault(fonte: string): string[] {
  const semComentario = fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const achados: string[] = [];
  // A cláusula não pode conter ";" — é isso que impede o casamento de atravessar
  // duas declarações, e ainda assim aceita lista nomeada em várias linhas.
  for (const m of semComentario.matchAll(/\bimport\s([^;]*?)\sfrom\s*["']([^"']+)["']/g)) {
    let clausula = m[1].trim();
    if (clausula.startsWith("type ")) continue; // `import type` some no JS emitido
    if (!clausula || clausula.startsWith("{") || clausula.startsWith("*")) continue;
    achados.push(m[2]);
  }
  return achados;
}

/** Um pacote é ESM puro quando declara `type: module` e não oferece nenhuma porta CJS. */
function ehEsmPuro(pacote: string): boolean {
  const manifesto = path.join(RAIZ, "node_modules", pacote, "package.json");
  if (!existsSync(manifesto)) return false;
  const json = JSON.parse(readFileSync(manifesto, "utf-8"));
  if (json.type !== "module") return false;
  if (!json.exports) return !json.main; // sem `exports`, `main` é a porta CJS
  let temPortaCjs = false;
  const varrer = (valor: unknown): void => {
    if (!valor || typeof valor === "string") return;
    if (Array.isArray(valor)) return valor.forEach(varrer);
    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      if (chave === "require") temPortaCjs = true;
      varrer(filho);
    }
  };
  varrer(json.exports);
  return !temPortaCjs;
}

function dependenciasDeclaradas(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf-8"));
  return [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
}

describe("pacotes externos ao bundle CJS do servidor", () => {
  it("nenhum pacote ESM puro é importado com default fora do bundle", () => {
    // Exatamente a conta de `script/build.ts`.
    const externos = new Set(
      dependenciasDeclaradas().filter((dep) => !PACOTES_EMBUTIDOS.includes(dep)),
    );

    const ofensores: string[] = [];
    for (const dir of FONTES_DO_BUNDLE) {
      for (const arquivo of arquivosDeFonte(dir)) {
        const fonte = readFileSync(path.join(RAIZ, arquivo), "utf-8");
        for (const especificador of importesDefault(fonte)) {
          const pacote = nomeDoPacote(especificador);
          if (!pacote || !externos.has(pacote)) continue;
          if (!ehEsmPuro(pacote)) continue;
          ofensores.push(`${arquivo} importa "${pacote}" com default`);
        }
      }
    }

    expect(
      ofensores,
      `Pacote ESM puro importado com default e deixado FORA do bundle:\n` +
        `${ofensores.map((o) => `  - ${o}`).join("\n")}\n\n` +
        `O bundle CJS sobe e morre no carregamento com "is not a function".\n` +
        `Conserto: acrescente o pacote a PACOTES_EMBUTIDOS em script/pacotes-embutidos.ts\n` +
        `(ou troque por import nomeado, que o interop do esbuild resolve certo).`,
    ).toEqual([]);
  });

  it("todo nome de PACOTES_EMBUTIDOS existe no package.json", () => {
    // Um nome com erro de digitação não dá erro em lugar nenhum: ele
    // simplesmente não casa com dependência alguma, o pacote de verdade
    // continua externo, e a proteção acima vira decoração.
    const declaradas = new Set(dependenciasDeclaradas());
    const fantasmas = PACOTES_EMBUTIDOS.filter((nome) => !declaradas.has(nome));
    expect(fantasmas, `Nomes em PACOTES_EMBUTIDOS que não são dependência declarada`).toEqual([]);
  });
});
