/**
 * Mapa da rede — ex-clientes com dívida de TODOS os provedores, POR BAIRRO.
 *
 * É a pergunta que só o bureau responde: em que bairros da cidade já houve
 * calote, contando a experiência de todo mundo e não só a sua. Um provedor
 * sozinho vê a própria carteira; a rede vê a cidade.
 *
 * ── Por que bairro, e não ponto ──────────────────────────────────────────
 * A primeira versão devolvia um ponto por ex-cliente, com a coordenada
 * deslocada para tirar o número da casa. Funcionava, mas defendia um dado que
 * não precisava existir: o operador não decide nada com a casa específica de um
 * ex-cliente de outro provedor — ele decide com "neste bairro a rede já tomou
 * doze calotes". Agregando na origem, nenhuma posição individual sai do
 * servidor, e não há o que mascarar.
 *
 * O que sai é o centroide do bairro, calculado sobre no mínimo MIN_POR_BAIRRO
 * ocorrências. Centroide de três ou mais casas não é a casa de ninguém.
 *
 * Continua sem nome, sem documento, sem valor por cliente e sem dizer de qual
 * provedor veio cada ocorrência — só quantos provedores contribuíram, que é o
 * que diz se aquilo é a experiência da rede ou de um só.
 */
import { and, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { coordenadaValida } from "./coordenada";
import { normalizarCidade } from "./area-atendida";
import { criarAgrupadorDeBairro } from "./localidade";

/** Ocorrências mínimas para um bairro aparecer. */
export const MIN_POR_BAIRRO = 3;

export interface BairroRede {
  bairro: string;
  cidade: string;
  /** Ex-clientes com dívida no bairro, somando todos os provedores. */
  ocorrencias: number;
  dividaTotal: number;
  /** Quantos provedores contribuíram. Diz se é experiência da rede ou de um só. */
  provedores: number;
  /** Centroide das ocorrências; null quando nenhuma tem coordenada. */
  lat: number | null;
  lon: number | null;
}

export interface ResultadoRede {
  bairros: BairroRede[];
  /**
   * Ocorrências que existem mas ficaram fora por estarem em bairros com menos
   * de MIN_POR_BAIRRO casos. Mapa vazio sem explicação faz o operador achar que
   * quebrou; "não há nada" e "há, mas é pouco para agregar" são coisas
   * diferentes.
   */
  ocultas: number;
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Ex-clientes com dívida de todos os provedores, agregados por bairro.
 *
 * "Ex-cliente" é contrato encerrado — cancelado ou inativo. Cliente que ainda é
 * de alguém não entra: ele está sendo cobrado por quem o atende, e apontar onde
 * ele mora para a concorrência não é informação de risco, é lista de alvos.
 */
export async function bairrosDaRede(cidades: string[]): Promise<ResultadoRede> {
  if (cidades.length === 0) return { bairros: [], ocultas: 0 };

  const linhas = await db
    .select({
      providerId: customers.providerId,
      latitude: customers.latitude,
      longitude: customers.longitude,
      city: customers.city,
      neighborhood: customers.neighborhood,
      totalOverdueAmount: customers.totalOverdueAmount,
    })
    .from(customers)
    .where(and(
      inArray(customers.status, ["cancelled", "inactive"]),
      gt(customers.totalOverdueAmount, "0"),
      isNotNull(customers.neighborhood),
    ));

  // O recorte vem da área atendida como "Londrina - PR" e o cadastro guarda
  // "Londrina": a comparação usa a mesma canonização do resto do produto.
  const alvo = new Set(cidades.map(normalizarCidade));

  interface Acc {
    bairro: string; cidade: string; ocorrencias: number; divida: number;
    provedores: Set<number>; lats: number[]; lons: number[];
  }
  const porBairro = new Map<string, Acc>();
  // Um agrupador por cidade: bairros homônimos em cidades diferentes são
  // lugares diferentes.
  const agrupadores = new Map<string, ReturnType<typeof criarAgrupadorDeBairro>>();

  for (const l of linhas) {
    const cidadeNorm = normalizarCidade(l.city);
    if (!alvo.has(cidadeNorm)) continue;

    let ag = agrupadores.get(cidadeNorm);
    if (!ag) { ag = criarAgrupadorDeBairro(); agrupadores.set(cidadeNorm, ag); }
    const grupo = ag.agrupar(l.neighborhood);
    if (!grupo) continue;

    const chave = `${cidadeNorm}||${grupo.chave}`;
    let a = porBairro.get(chave);
    if (!a) {
      a = {
        bairro: grupo.rotulo, cidade: (l.city || "").trim(),
        ocorrencias: 0, divida: 0, provedores: new Set(), lats: [], lons: [],
      };
      porBairro.set(chave, a);
    }
    a.ocorrencias++;
    a.divida += Number(l.totalOverdueAmount || 0) || 0;
    if (l.providerId != null) a.provedores.add(l.providerId);

    const coord = coordenadaValida(l.latitude, l.longitude);
    if (coord) { a.lats.push(coord.lat); a.lons.push(coord.lng); }
  }

  const todos = Array.from(porBairro.values());
  const visiveis = todos.filter(a => a.ocorrencias >= MIN_POR_BAIRRO);

  return {
    ocultas: todos.filter(a => a.ocorrencias < MIN_POR_BAIRRO)
      .reduce((s, a) => s + a.ocorrencias, 0),
    bairros: visiveis
      .map(a => ({
        bairro: a.bairro,
        cidade: a.cidade,
        ocorrencias: a.ocorrencias,
        dividaTotal: Math.round(a.divida * 100) / 100,
        provedores: a.provedores.size,
        // Mediana e não média: uma coordenada errada a centenas de km puxaria
        // a média para fora da cidade e levaria o bairro inteiro junto.
        lat: a.lats.length ? mediana(a.lats) : null,
        lon: a.lons.length ? mediana(a.lons) : null,
      }))
      .sort((x, y) => y.ocorrencias - x.ocorrencias || y.dividaTotal - x.dividaTotal),
  };
}
