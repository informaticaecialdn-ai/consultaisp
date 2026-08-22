import citiesData from "../../shared/data/cidades-brasil.json";
import { storage } from "../storage";

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
    .replace(/\s*-\s*[A-Za-z]{2}\s*$/, "")        // sufixo " - PR"
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // acentos
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

export async function resolverAreaAtendida(providerId: number): Promise<AreaAtendida> {
  const p = await storage.getProvider(providerId);
  return escolherArea(p?.cidadesAtendidas, p?.mesorregioes, p?.addressState);
}
