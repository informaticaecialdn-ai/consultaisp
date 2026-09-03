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

const arquivos = arquivosDoClient(RAIZ_CLIENT).filter(c => !/\.test\.tsx?$/.test(c));

/**
 * Comentario nao e tela. Esta guarda varre PROSA, e o comentario que explica o
 * defeito ("anunciava R$ 1,00 cravado") nao pode ser lido como o defeito.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * "Um credito custa R$ 1,00", "R$ 1,00/credito", "R$ 1,00 por credito".
 *
 * O identificador saiu do client, mas o preco por credito continuava escrito
 * em texto no cabecalho de /creditos, logo acima de cards que ja vinham do
 * servidor. Bastava a tabela mudar — ou a marca revender o credito a R$ 2,50
 * na fase 3 — para a mesma tela mostrar dois precos diferentes. A guarda de
 * identificadores nao pega isso: prosa nao importa nada.
 */
const PRECO_POR_CREDITO_EM_PROSA = [
  /cr[ée]dito\s+custa\s+R\$/i,
  /R\$\s?[\d.,]+\s*\/\s*cr[ée]dito/i,
  /R\$\s?[\d.,]+\s+por\s+cr[ée]dito/i,
];

/* ------------------------------------------------------------------------- *
 * A GUARDA PELA FORMA, NAO PELO NOME.
 *
 * As tres travas acima procuram identificador (`PLAN_PRICES`, `PLAN_CREDITS`,
 * `CREDIT_PACKAGES`) e frase de preco por credito. Todas passaram verdes
 * enquanto `/admin/provedor/:id` mantinha um `PLAN_CONFIG` proprio com
 * `basic 199` e `pro 399 / 500 ISP / 150 SPC` — nome nenhum da lista, e a tela
 * anunciava "Mensalidade R$ 399,00" para um plano de R$ 99 e abria o modal de
 * fatura com esse valor. `POST /api/admin/invoices` grava o `amount` do corpo
 * sem conferir contra o plano, entao nascia fatura de R$ 399 onde o
 * `generate-monthly` cobra R$ 99.
 *
 * Batizar a constante de outro jeito nao pode continuar sendo a saida. O que
 * reprova daqui em diante e a FORMA: chave de plano apontando para preco ou
 * credito.
 * ------------------------------------------------------------------------- */

const CHAVES_DE_PLANO = "free|basic|pro|enterprise";

/**
 * `pro: { ... }` com ate um nivel de aninhamento no corpo — o suficiente para
 * alcancar `pro: { creditosInclusos: { isp: 0 } }` sem precisar de um parser.
 */
const BLOCO_DE_PLANO = new RegExp(
  `\\b(${CHAVES_DE_PLANO})\\s*:\\s*(\\{(?:[^{}]|\\{[^{}]*\\})*\\})`,
  "g",
);

/**
 * O campo que transforma o bloco em tabela de preco.
 *
 * A negativa de `number`/`string`/`boolean` deixa TIPO passar: uma interface
 * com `isp: number` descreve a forma que vem do servidor, nao crava valor. Ela
 * come o espaco DENTRO do lookahead de proposito — com `\s*` do lado de fora o
 * motor volta atras, casa zero espaco e a negativa passa a olhar para " number".
 */
const CAMPO_DE_PRECO = /\b(price|preco\w*|isp|spc|credit\w*|credito\w*)\s*:(?!\s*(?:number|string|boolean)\b)/i;

/** `{ free: 0, pro: 99 }` — a mesma tabela sem o objeto intermediario. */
const PLANO_PARA_NUMERO = new RegExp(`\\b(${CHAVES_DE_PLANO})\\s*:\\s*-?\\d`, "g");

/**
 * As tabelas de preco/credito por plano que este fonte declara.
 *
 * Funcao pura para poder ser provada nos dois sentidos: que reprova o
 * `PLAN_CONFIG` que existia em `admin-provedor.tsx`, e que NAO reprova o mapa
 * de rotulo e cor que ficou no lugar dele.
 */
export function tabelasDePrecoDePlano(fonte: string): string[] {
  const limpo = semComentarios(fonte);
  const achados: string[] = [];

  BLOCO_DE_PLANO.lastIndex = 0;
  let bloco: RegExpExecArray | null;
  while ((bloco = BLOCO_DE_PLANO.exec(limpo)) !== null) {
    const campo = bloco[2].match(CAMPO_DE_PRECO);
    if (campo) achados.push(`${bloco[1]}: { … ${campo[0].trim()} … }`);
  }

  PLANO_PARA_NUMERO.lastIndex = 0;
  const chavesComNumero = new Set<string>();
  let direto: RegExpExecArray | null;
  while ((direto = PLANO_PARA_NUMERO.exec(limpo)) !== null) chavesComNumero.add(direto[1]);
  // Uma chave sozinha pode ser coincidencia; duas ja sao uma tabela por plano.
  if (chavesComNumero.size >= 2) {
    achados.push(`${[...chavesComNumero].join(", ")} apontando direto para numero`);
  }

  return achados;
}

const COMO_CORRIGIR =
  "Preco e credito de plano vem do servidor: use usePrecos() (ou usePrecosPublicos() " +
  "sem sessao) de @/hooks/use-precos e leia precos.planos / planoPorChave / " +
  "camposDaFatura. Sem tabela o campo fica intocado e o botao desabilitado — " +
  "nunca R$ 0,00 nem numero cravado. Rotulo e cor do plano podem ficar no client; " +
  "preco e credito nao, porque dependem da marca que o provedor veste.";

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

  it("nenhuma tela afirma em texto quanto custa um credito", () => {
    const infratores: string[] = [];
    for (const caminho of arquivos) {
      const fonte = semComentarios(readFileSync(caminho, "utf8"));
      for (const padrao of PRECO_POR_CREDITO_EM_PROSA) {
        const achado = fonte.match(padrao);
        if (achado) {
          infratores.push(`${caminho.replace(RAIZ_CLIENT, "client/src")}: "${achado[0]}"`);
        }
      }
    }
    expect(infratores).toEqual([]);
  });

  it("nenhum arquivo de client/src mapeia chave de plano para preco ou credito", () => {
    const infratores: string[] = [];
    for (const caminho of arquivos) {
      for (const achado of tabelasDePrecoDePlano(readFileSync(caminho, "utf8"))) {
        infratores.push(`${caminho.replace(RAIZ_CLIENT, "client/src")}: ${achado}`);
      }
    }
    if (infratores.length > 0) {
      throw new Error(`Tabela de preco por plano em client/src:\n  ${infratores.join("\n  ")}\n\n${COMO_CORRIGIR}`);
    }
    expect(infratores).toEqual([]);
  });

  /**
   * A guarda anterior tambem "passava": o defeito de `admin-provedor.tsx` nao
   * cabia em nenhuma das travas por nome. Sem esta prova, uma rede furada
   * continuaria verde e ninguem saberia.
   */
  it("a guarda pela forma reprova o PLAN_CONFIG que existia em admin-provedor.tsx", () => {
    const comoEra = `
const PLAN_CONFIG: Record<string, { label: string; color: string; isp: number; spc: number; price: number }> = {
  free:       { label: "Gratuito",   color: "bg-[var(--color-tag-bg)] text-gray-700",   isp: 50,   spc: 0,   price: 0 },
  basic:      { label: "Basico",     color: "bg-[var(--color-brand-bg)] text-[var(--color-brand)]",   isp: 200,  spc: 50,  price: 199 },
  pro:        { label: "Pro",        color: "bg-indigo-100 text-indigo-700", isp: 500, spc: 150, price: 399 },
  enterprise: { label: "Enterprise", color: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]", isp: 1500, spc: 500, price: 799 },
};`;
    expect(tabelasDePrecoDePlano(comoEra)).toHaveLength(4);
  });

  it("a guarda pela forma reprova a tabela sem objeto intermediario", () => {
    expect(tabelasDePrecoDePlano(`const mensalidade = { free: 0, pro: 99, enterprise: 799 };`)).toEqual([
      "free, pro, enterprise apontando direto para numero",
    ]);
  });

  it("rotulo, cor e tipo nao caem na rede — a guarda so pega preco e credito", () => {
    const rotuloECor = `
const PLANO_VISUAL: Record<string, { rotulo: string; cor: string }> = {
  free:       { rotulo: "Gratuito",     cor: "bg-[var(--color-tag-bg)] text-[var(--text-2)]" },
  pro:        { rotulo: "Profissional", cor: "bg-[var(--brand-soft)] text-[var(--brand-ink)]" },
};`;
    expect(tabelasDePrecoDePlano(rotuloECor)).toEqual([]);

    const tipo = `interface Tabela { pro: { isp: number; spc: number } }`;
    expect(tabelasDePrecoDePlano(tipo)).toEqual([]);

    // Comentario nao e tela: a explicacao do defeito nao pode ser lida como o defeito.
    const comentario = `/* pro: { isp: 500, spc: 150, price: 399 } era a tabela morta */`;
    expect(tabelasDePrecoDePlano(comentario)).toEqual([]);
  });

  /**
   * A tela que emite fatura e a que mais custa caro errar: `POST
   * /api/admin/invoices` grava o `amount` do corpo sem conferir contra o plano.
   * Se ela nao le a tabela do servidor, o valor so pode ter vindo de dentro do
   * bundle — foi assim que `/admin/provedor/:id` faturou R$ 399 num plano de
   * R$ 99.
   */
  it("toda tela que emite fatura le a tabela do servidor", () => {
    const semTabela: string[] = [];
    let emissoras = 0;
    for (const caminho of arquivos) {
      const fonte = readFileSync(caminho, "utf8");
      if (!/apiRequest\(\s*["']POST["']\s*,\s*["']\/api\/admin\/invoices["']/.test(fonte)) continue;
      emissoras++;
      if (!/from\s+["']@\/hooks\/use-precos["']/.test(fonte)) {
        semTabela.push(caminho.replace(RAIZ_CLIENT, "client/src"));
      }
    }
    expect(emissoras).toBeGreaterThanOrEqual(3);
    expect(semTabela, COMO_CORRIGIR).toEqual([]);
  });
});
