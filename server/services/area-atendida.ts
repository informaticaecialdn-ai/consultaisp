import citiesData from "../../shared/data/cidades-brasil.json";

/**
 * Recorte territorial do provedor.
 *
 * O sistema e regional: o dado tem aderencia regional. Antes disto as queries
 * de territorio filtravam por providers.addressState — e a NsLink tem UF NULA,
 * entao a condicao `providerState ? filtrar : nao filtrar` caia no ramo que nao
 * filtra. Ela via tudo, apesar de ter 46 cidades atendidas configuradas.
 *
 * `cidades: null` significa "sem filtro por cidade". `origem` alimenta o aviso
 * na tela, para o provedor entender o recorte que esta vendo.
 */

export type OrigemArea = 'cidades' | 'meso' | 'uf' | 'nenhuma';

export interface AreaAtendida {
  cidades: string[] | null;
  uf?: string | null;
  origem: OrigemArea;
}

/**
 * Normaliza nome de cidade para comparacao.
 *
 * Os tres lados guardam formatos diferentes:
 *   providers.cidadesAtendidas → "Abatiá - PR"  (com sufixo de UF)
 *   customers.city            → "Sao Paulo"     (sem sufixo, sem acento)
 *   cidades-brasil.json       → "Abadia de Goiás" (com acento, sem sufixo)
 *
 * Sem normalizar, o filtro regional nunca casa — e o dado de demonstracao
 * mascara isso, porque os clientes semeados nem ficam na regiao atendida.
 */
export function normalizarCidade(nome: string | null | undefined): string {
  return (nome || "")
    .replace(/\s*-\s*[A-Za-z]{2}\s*$/, "")        // sufixo " - PR" — ANTES de mexer no hifen
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // acentos
    /**
     * Hifen e espaco repetido viram UM espaco.
     *
     * "Embu-Guacu" e "Embu Guacu" sao a mesma cidade escrita de dois jeitos, e
     * cada base escolhe um: o CNEFE do IBGE grava EMBU GUACU, o cadastro do ERP
     * do provedor grava EMBU-GUAÇU, e o operador digita EMBU  GUAÇU. Sem esta
     * linha as tres sao chaves diferentes e nenhuma acha a outra.
     *
     * Medido na Amplinet em 04/09/2026: dos 179 clientes fora do mapa, 80
     * estavam bloqueados SO por isto — a base de enderecos da cidade estava
     * carregada, com 20.651 pontos, e o casador nao chegava nela por causa de
     * um traco. A tela dizia "carteira sem geocodificacao", que o provedor leu
     * como "o sistema nao plota".
     *
     * A ordem importa: o sufixo de UF e removido ANTES, senao " - PR" viraria
     * " pr" e a regex do sufixo nao casaria mais.
     */
    .replace(/[-_\s]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Cidades de uma lista de mesorregioes, a partir de cidades-brasil.json. */
export function cidadesDasMesorregioes(mesos: string[]): string[] {
  if (!mesos.length) return [];
  const alvo = new Set(mesos.map(m => m.trim().toLowerCase()));
  return (citiesData as Array<{ nome: string; mesorregiao: string }>)
    .filter(c => alvo.has((c.mesorregiao || "").trim().toLowerCase()))
    .map(c => c.nome);
}

/** A cascata, isolada do banco para ser testavel. */
export function escolherArea(
  cidadesAtendidas: string[] | null | undefined,
  mesorregioes: string[] | null | undefined,
  uf: string | null | undefined,
  resolverMeso: (m: string[]) => string[] = cidadesDasMesorregioes,
): AreaAtendida {
  const cidades = (cidadesAtendidas || []).filter(Boolean);
  if (cidades.length > 0) return { cidades, origem: 'cidades' };

  const mesos = (mesorregioes || []).filter(Boolean);
  if (mesos.length > 0) {
    const daMeso = resolverMeso(mesos);
    if (daMeso.length > 0) return { cidades: daMeso, origem: 'meso' };
  }

  if (uf) return { cidades: null, uf, origem: 'uf' };

  return { cidades: null, uf: null, origem: 'nenhuma' };
}

/**
 * O BARRIL DO STORAGE ENTRA AQUI DENTRO, e nao no topo do arquivo.
 *
 * `normalizarCidade` acima e uma funcao pura que meio repositorio usa —
 * inclusive `municipio.service`, que por sua vez alimenta a canonizacao da
 * cidade dentro de `customers.storage`. Com `import { storage } from "../storage"`
 * no topo, esse caminho fechava o ciclo
 * `customers.storage → cidade-canonica → municipio → area-atendida → storage/index`,
 * e quem importasse `customers.storage` DIRETO (um teste, um script) fazia o
 * barril avaliar `new DatabaseStorage()` com a classe ainda em TDZ. O erro que
 * aparecia — "Cannot access 'CustomersStorage' before initialization" — nao
 * menciona ciclo nenhum, e custa uma tarde para achar.
 *
 * `resolverAreaAtendida` ja e assincrona e o import de modulo e cacheado pelo
 * Node, entao o custo desta linha e uma microtarefa por chamada. O ganho e o
 * arquivo voltar a ser folha: quem so quer normalizar um nome de cidade nao
 * arrasta a camada de dados junto.
 */
export async function resolverAreaAtendida(providerId: number): Promise<AreaAtendida> {
  const { storage } = await import("../storage");
  const p = await storage.getProvider(providerId);
  return escolherArea(p?.cidadesAtendidas, p?.mesorregioes, p?.addressState);
}
