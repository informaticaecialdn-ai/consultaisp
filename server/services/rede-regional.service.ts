/**
 * Mapa da rede — ex-clientes com dívida de TODOS os provedores, por cidade.
 *
 * É a pergunta que só o bureau responde: onde, na cidade, ficam os endereços
 * que já deram calote em alguém. Um provedor sozinho vê a própria carteira; a
 * rede vê a cidade. Um ponto aqui é um lugar onde alguém instalou, não recebeu
 * e cancelou — informação que muda a decisão de vender naquela rua.
 *
 * ── O que NÃO sai daqui ──────────────────────────────────────────────────
 * Sem nome, sem documento, sem valor exato, sem provedor. Nem o id do cliente:
 * o identificador devolvido é derivado e serve só para o React ter uma chave
 * estável de lista.
 *
 * ── E por que a coordenada é embaralhada ─────────────────────────────────
 * Coordenada exata É endereço. Plotar a casa de um ex-cliente de outro provedor
 * permitiria ir até lá e ver quem mora — e o contrato deste produto (CLAUDE.md)
 * diz que entre provedores o endereço vai SEM NÚMERO. O deslocamento de até
 * ~150m tira o número e mantém a quadra, que é a leitura que interessa.
 *
 * O deslocamento é DETERMINÍSTICO, derivado do id: aleatório a cada requisição
 * pareceria mais seguro e seria menos, porque recarregar a página muitas vezes
 * e tirar a média das posições devolveria o ponto verdadeiro.
 *
 * Além disso, ponto isolado é ponto identificável mesmo embaralhado — numa
 * chácara, 150m ainda é a mesma propriedade. Por isso a célula precisa de pelo
 * menos MIN_POR_CELULA ocorrências para aparecer.
 */
import { and, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { coordenadaValida } from "./coordenada";
import { normalizarCidade } from "./area-atendida";

/** Raio máximo do deslocamento, em graus (~150m na latitude do Brasil). */
export const FUZZ_GRAUS = 0.00135;
/** Lado da célula de k-anonimato, em graus (~440m). A janela contada é 3×3
 *  células, ou seja ~1,3km de lado. */
const CELULA_GRAUS = 0.004;
/** Ocorrências mínimas na célula para ela aparecer. */
export const MIN_POR_CELULA = 3;

export interface PontoRedeRegional {
  /** Chave de lista. Não é o id do cliente e não serve para achar ninguém. */
  ref: string;
  lat: number;
  lon: number;
  cidade: string;
  /** Faixa de dívida, nunca o valor exato — valor exato reidentifica. */
  faixa: "ate300" | "de300a1000" | "acima1000";
  /** Faixa de atraso, pelo mesmo motivo. */
  atraso: "ate6m" | "de6ma1a" | "acima1a";
}

/** Embaralhamento estável: mesma entrada, mesmo deslocamento, sempre. */
export function deslocarPonto(id: number, lat: number, lon: number): { lat: number; lon: number } {
  // Hash barato e determinístico do id em dois ângulos independentes.
  // Cada passo termina em `>>> 0`: sem isso o XOR devolve inteiro COM SINAL, e
  // metade dos ids saía com hash negativo — raiz de negativo é NaN, e o ponto
  // desaparecia do mapa sem erro nenhum.
  const h = (n: number, sal: number) => {
    let x = (n * 2654435761 + sal * 40503) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = (x * 1274126177) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x / 4294967296;
  };
  const angulo = h(id, 1) * Math.PI * 2;
  // Raiz do raio: sem ela o sorteio concentra os pontos no centro do círculo.
  const raio = Math.sqrt(h(id, 2)) * FUZZ_GRAUS;
  return {
    lat: lat + Math.sin(angulo) * raio,
    // A longitude encolhe com o cosseno da latitude; sem isso o borrão fica
    // oval e mais estreito do que os 150m prometidos.
    lon: lon + (Math.cos(angulo) * raio) / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
  };
}

const faixaDivida = (v: number): PontoRedeRegional["faixa"] =>
  v > 1000 ? "acima1000" : v > 300 ? "de300a1000" : "ate300";

const faixaAtraso = (d: number): PontoRedeRegional["atraso"] =>
  d > 365 ? "acima1a" : d > 180 ? "de6ma1a" : "ate6m";

/**
 * Ex-clientes com dívida de todos os provedores nas cidades pedidas.
 *
 * "Ex-cliente" é contrato encerrado — cancelado ou inativo. Cliente que ainda
 * é de alguém não entra: ele está sendo cobrado por quem o atende, e expor a
 * casa dele para a concorrência não é informação de risco, é lista de alvos.
 */
export interface ResultadoRede {
  pontos: PontoRedeRegional[];
  /**
   * Ocorrências que existem mas não foram desenhadas por estarem isoladas
   * demais. Sai como número justamente para o mapa vazio não virar mistério:
   * "não há nada" e "há, mas não dá para mostrar sem apontar uma casa" são
   * coisas diferentes, e o operador precisa saber qual das duas está vendo.
   */
  ocultas: number;
}

export async function pontosDaRede(cidades: string[]): Promise<ResultadoRede> {
  if (cidades.length === 0) return { pontos: [], ocultas: 0 };

  const linhas = await db
    .select({
      id: customers.id,
      latitude: customers.latitude,
      longitude: customers.longitude,
      city: customers.city,
      totalOverdueAmount: customers.totalOverdueAmount,
      maxDaysOverdue: customers.maxDaysOverdue,
    })
    .from(customers)
    .where(and(
      inArray(customers.status, ["cancelled", "inactive"]),
      gt(customers.totalOverdueAmount, "0"),
      isNotNull(customers.latitude),
      isNotNull(customers.longitude),
    ));

  // O recorte de cidade fica em JS: a lista da área vem como "Londrina - PR" e
  // o cadastro guarda "Londrina", então a comparação precisa da mesma
  // canonização que o resto da tela usa — e é ela que define o que é a mesma
  // cidade em todo o produto.
  const alvo = new Set(cidades.map(normalizarCidade));

  // Primeira passada: valida e filtra por cidade. A posição VERDADEIRA é
  // guardada junto, porque é sobre ela que a vizinhança é contada — a pergunta
  // de privacidade é "há gente perto deste lugar de verdade?", não "há gente
  // perto de onde eu resolvi desenhar".
  const brutos = linhas.flatMap(l => {
    if (!alvo.has(normalizarCidade(l.city))) return [];
    const coord = coordenadaValida(l.latitude, l.longitude);
    if (!coord) return [];
    const d = deslocarPonto(l.id, coord.lat, coord.lng);
    return [{
      id: l.id,
      lat: d.lat,
      lon: d.lon,
      latReal: coord.lat,
      lonReal: coord.lng,
      cidade: (l.city || "").trim(),
      divida: Number(l.totalOverdueAmount || 0) || 0,
      atraso: l.maxDaysOverdue || 0,
    }];
  });

  // Segunda passada: k-anonimato pela vizinhança. Ponto sozinho no meio do nada
  // continua sendo um endereço, por mais que a coordenada tenha sido mexida.
  //
  // A contagem soma a célula e as OITO vizinhas. Com célula pura, quatro casas
  // na mesma quadra caíam em duas células por estarem na linha divisória, e
  // nenhuma das duas chegava ao mínimo — um aglomerado real desaparecia por
  // acidente de grade. A janela de 3×3 tira a borda da conta.
  const porCelula = new Map<string, number>();
  const chave = (i: number, j: number) => `${i}:${j}`;
  const indice = (lat: number, lon: number): [number, number] =>
    [Math.floor(lat / CELULA_GRAUS), Math.floor(lon / CELULA_GRAUS)];

  for (const b of brutos) {
    const [i, j] = indice(b.latReal, b.lonReal);
    porCelula.set(chave(i, j), (porCelula.get(chave(i, j)) ?? 0) + 1);
  }

  const vizinhanca = (lat: number, lon: number) => {
    const [i, j] = indice(lat, lon);
    let n = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) n += porCelula.get(chave(i + di, j + dj)) ?? 0;
    }
    return n;
  };

  const visiveis = brutos.filter(b => vizinhanca(b.latReal, b.lonReal) >= MIN_POR_CELULA);

  return {
    ocultas: brutos.length - visiveis.length,
    pontos: visiveis.map(b => ({
      // Referência opaca: o id real não sai daqui.
      ref: `r${(b.id * 2654435761) % 100000000}`,
      lat: b.lat,
      lon: b.lon,
      cidade: b.cidade,
      faixa: faixaDivida(b.divida),
      atraso: faixaAtraso(b.atraso),
    })),
  };
}
