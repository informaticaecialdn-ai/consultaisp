/**
 * GUARDA: o client nao pode ter tabela de preco.
 *
 * A divergencia que este teste impede ja aconteceu quatro vezes ao mesmo
 * tempo: `painel-provedor.tsx` anunciava planos de R$ 199/399/799 que a fatura
 * nunca cobrou, `admin-financeiro.tsx` e `FinanceiroTab.tsx` ofereciam
 * "Pro — R$ 399" e preenchiam outro valor, `invoice-view.tsx` guardava a
 * propria copia dos creditos por plano, e `admin-creditos.tsx` mandava comprar
 * pacotes com id que o servidor ja nao reconhecia.
 *
 * Com o white label deixa de ser desatualizacao e vira erro: o preco depende
 * da MARCA que o provedor veste, e uma constante compilada no bundle nao tem
 * como saber disso. O client pede a `GET /api/credits/packages` ou a
 * `GET /api/public/precos`.
 *
 * `CUSTO_EM_CREDITOS` fica de fora da lista de proposito: e quantos creditos
 * a consulta consome, e isso nao varia por marca — a marca revende o credito
 * mais caro, nao muda o consumo.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const RAIZ_CLIENT = join(__dirname, "..", "client", "src");

const PROIBIDOS = ["CREDIT_PACKAGES", "PLAN_PRICES", "PLAN_CREDITS"];

function arquivosDoClient(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDoClient(caminho));
    } else if (/\.(ts|tsx)$/.test(entrada)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/** `import { A, B } from "@shared/x"` e `await import("@shared/x")`. */
const IMPORT_DE_SHARED = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@shared\/[^"']+["']/g;
const DESTRUCT_DINAMICO = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']@shared\/[^"']+["']\s*\)/g;

/** `const PLAN_PRICES = ...` — a copia local, que e como tudo comecou. */
const DECLARACAO_LOCAL = new RegExp(
  `(?:const|let|var)\\s+(${PROIBIDOS.join("|")})\\b`,
  "g",
);

const arquivos = arquivosDoClient(RAIZ_CLIENT);

describe("tabela de preco fora do client", () => {
  it("encontra os arquivos do client — um scanner vazio passaria calado", () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it("nenhum arquivo de client/src importa a tabela de preco de @shared/*", () => {
    const infratores: string[] = [];
    for (const caminho of arquivos) {
      const fonte = readFileSync(caminho, "utf8");
      for (const padrao of [IMPORT_DE_SHARED, DESTRUCT_DINAMICO]) {
        padrao.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = padrao.exec(fonte)) !== null) {
          const nomes = m[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
          for (const proibido of PROIBIDOS) {
            if (nomes.includes(proibido)) {
              infratores.push(`${caminho.replace(RAIZ_CLIENT, "client/src")} importa ${proibido}`);
            }
          }
        }
      }
    }
    expect(infratores).toEqual([]);
  });

  it("nenhum arquivo de client/src declara a propria tabela de preco", () => {
    const infratores: string[] = [];
    for (const caminho of arquivos) {
      const fonte = readFileSync(caminho, "utf8");
      DECLARACAO_LOCAL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DECLARACAO_LOCAL.exec(fonte)) !== null) {
        infratores.push(`${caminho.replace(RAIZ_CLIENT, "client/src")} declara ${m[1]}`);
      }
    }
    expect(infratores).toEqual([]);
  });
});
