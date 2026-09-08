/**
 * A TRAVA: não existe entrada manual de dado de cliente.
 *
 * Decisão do dono, 08/09/2026: "tirar qq possibilidade de importação na mão...
 * os dados têm que vir dos ERPs".
 *
 * A razão não é arrumação de menu. Cliente, fatura e contrato que este sistema
 * guarda alimentam o SCORE DA REDE — o número que OUTRO provedor consulta antes
 * de instalar. Uma linha digitada ou colada de planilha entra nesse cálculo sem
 * que ninguém consiga conferir de onde veio, e a decisão de crédito de um
 * terceiro passa a depender dela. Por isso o corte é de caminho, não de tela: um
 * botão escondido continua sendo `curl`.
 *
 * O que foi removido (não escondido) em 08/09/2026:
 * - `server/routes/import.routes.ts` — os três `POST /api/import/*`
 * - `server/storage/import.storage.ts` — `bulkImportCustomers/Invoices/Equipment`
 * - `POST /api/customers` — rota de escrita SEM tela, SEM validação (`{...req.body}`)
 *   e SEM checagem de papel: qualquer operador `user` fabricava cliente por curl
 * - a página `/importacao` com as três abas de CSV
 * - o diálogo "Importar planilha" de `/equipamentos` e o `?importar=1`
 * - o atalho do Dashboard e as duas promessas de CSV na landing
 *
 * Este teste lê o FONTE, e não a lista de rotas em execução, porque o que se
 * quer impedir é o código voltar — inclusive num arquivo novo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function arquivosDe(pasta: string, ext: string[], achados: string[] = []): string[] {
  const alvo = join(RAIZ, pasta);
  if (!existsSync(alvo)) return achados;
  for (const nome of readdirSync(alvo)) {
    if (nome === "node_modules" || nome === "dist" || nome.startsWith(".")) continue;
    const caminho = join(alvo, nome);
    if (statSync(caminho).isDirectory()) arquivosDe(join(pasta, nome), ext, achados);
    else if (ext.some(e => nome.endsWith(e)) && !nome.includes(".test.")) achados.push(caminho);
  }
  return achados;
}

const FONTES_SERVIDOR = arquivosDe("server", [".ts"]);
const FONTES_CLIENT = arquivosDe("client/src", [".ts", ".tsx"]);
const ler = (caminho: string) => readFileSync(caminho, "utf8");
const relativo = (caminho: string) => caminho.slice(RAIZ.length).replace(/\\/g, "/");

describe("os arquivos da importação não voltam", () => {
  it("import.routes.ts e import.storage.ts não existem", () => {
    expect(existsSync(join(RAIZ, "server/routes/import.routes.ts"))).toBe(false);
    expect(existsSync(join(RAIZ, "server/storage/import.storage.ts"))).toBe(false);
    expect(existsSync(join(RAIZ, "client/src/pages/operacional/importacao.tsx"))).toBe(false);
  });

  it("nenhum arquivo do servidor declara rota /api/import/*", () => {
    for (const arquivo of FONTES_SERVIDOR) {
      expect(ler(arquivo), `${relativo(arquivo)} declara /api/import`).not.toMatch(/["'`]\/api\/import\//);
    }
  });

  it("nenhum arquivo do servidor tem bulkImport de cliente, fatura ou equipamento", () => {
    for (const arquivo of FONTES_SERVIDOR) {
      expect(ler(arquivo), `${relativo(arquivo)} tem bulkImport`).not.toMatch(/bulkImport(Customers|Invoices|Equipment)/);
    }
  });

  it("não existe POST /api/customers — cliente entra pelo sync do ERP e mais nada", () => {
    for (const arquivo of FONTES_SERVIDOR) {
      const fonte = ler(arquivo);
      expect(fonte, `${relativo(arquivo)} declara POST /api/customers`)
        .not.toMatch(/router\.(post|put)\(\s*["'`]\/api\/customers["'`]/);
    }
  });
});

describe("o client não oferece nem consegue importar", () => {
  it("nenhuma tela chama /api/import", () => {
    for (const arquivo of FONTES_CLIENT) {
      expect(ler(arquivo), `${relativo(arquivo)} chama /api/import`).not.toMatch(/\/api\/import/);
    }
  });

  it("nenhuma tela lê planilha: sem papaparse e sem input de arquivo CSV", () => {
    for (const arquivo of FONTES_CLIENT) {
      const fonte = ler(arquivo);
      expect(fonte, `${relativo(arquivo)} importa papaparse`).not.toMatch(/from ["']papaparse["']/);
      expect(fonte, `${relativo(arquivo)} aceita arquivo .csv`).not.toMatch(/accept=["'][^"']*\.csv/);
    }
  });

  it("a landing não vende importação por CSV", () => {
    const landing = ler(join(RAIZ, "client/src/pages/public/landingpage.tsx"));
    expect(landing).not.toMatch(/CSV/i);
    expect(landing).not.toMatch(/planilha/i);
  });

  it("o endereço antigo continua de pé, explicando — favorito não cai em página vazia", () => {
    const app = ler(join(RAIZ, "client/src/App.tsx"));
    expect(app).toContain('<Route path="/importacao" component={ImportacaoEncerradaPage} />');
    expect(app).toContain('<Route path="/importacao-equipamentos"><Redirect to="/importacao" replace /></Route>');
    // A guarda roda ANTES do desvio: os dois enderecos continuam na lista.
    const lista = app.slice(app.indexOf("PROVIDER_ONLY_PATHS = ["), app.indexOf("PROVIDER_ONLY_PATHS = [") + 1400);
    expect(lista).toContain('"/importacao"');
    expect(lista).toContain('"/importacao-equipamentos"');

    const tela = ler(join(RAIZ, "client/src/pages/operacional/importacao-encerrada.tsx"));
    expect(tela).toMatch(/encerrada/i);
    expect(tela).toContain("/painel-provedor?tab=integracao");
  });
});

describe("o caminho que ficou", () => {
  it("cliente e fatura entram pelo sync do ERP, que segue de pé", () => {
    const sync = ler(join(RAIZ, "server/services/erp-sync.service.ts"));
    expect(sync).toMatch(/upsertFromErp/);
    expect(sync).toMatch(/upsertFaturasDoErp/);
  });
});
