/**
 * Índice de logradouros da própria carteira — o vizinho de rua já plotado.
 *
 * ── O PROBLEMA, medido na Amplinet (provedor 6) em 04/09/2026 ──────────────
 * De 868 clientes, 86 continuavam fora do mapa depois de tudo: base de
 * endereços do IBGE da região carregada (2,2 milhões de pontos), grafias de
 * cidade canonizadas, e a coordenada de instalação pescada do `endereco_ll` do
 * SGP. Dos 86 que sobraram:
 *
 *     a rua existe na cidade declarada          1
 *     a rua existe só noutro município          4
 *     a rua NÃO EXISTE no censo do IBGE        72   (84%)
 *     cidade do cadastro desconhecida           9
 *
 * e o geocodificador de rede resolveu 1 de 40 numa amostra — 3%. São vielas,
 * estradas e chácaras de área peri-urbana: o censo não as nomeia e o
 * OpenStreetMap não as conhece. Nenhuma base pública vai resolver isso.
 *
 * ── A FONTE QUE SOBRA É A PRÓPRIA CARTEIRA ────────────────────────────────
 * O mesmo provedor tem 467 clientes plotados com `geo_precisao = "erp"` — a
 * coordenada que o técnico gravou ao instalar. Isso é um índice de logradouros
 * que o provedor construiu sem saber: se a RUA JOSÉ SECHI já tem cinco
 * instalações georreferenciadas, o sexto cliente da mesma rua não precisa de
 * base pública nenhuma.
 *
 * Dos 86 fora do mapa, 25 estão numa rua que JÁ TEM cliente plotado, e em 23
 * dessas 25 os pontos vêm SÓ do ERP.
 *
 * ── O QUE ESTE MÓDULO NÃO FAZ ─────────────────────────────────────────────
 * Não estima. A guarda (abaixo, em `avaliarVizinho`) é o coração disto: numa
 * rua de 136 m — a mediana medida — o ponto do vizinho é praticamente a casa;
 * numa estrada de 3.766 m — o máximo medido — não é a casa de ninguém, e a
 * regra RECUSA em vez de aproximar. É a mesma doutrina que tirou a queda para
 * o centro da cidade do backfill: quem não resolve fica sem coordenada,
 * contado e visível na tela, nunca plotado no lugar errado.
 *
 * ── ISOLAMENTO ────────────────────────────────────────────────────────────
 * O índice de uma carteira só enxerga pontos daquele provedor, e o filtro vive
 * no SQL (`filtroDaCarteira`). Índice montado com ponto de outro tenant seria
 * vazar a geolocalização de cliente alheio — por isso `montarIndice` ainda
 * lança se uma linha estranha chegar: a falha do filtro tem que ser barulhenta,
 * não silenciosa.
 */
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { coordenadaValida } from "./coordenada";
import { distanciaKm, mediana } from "./coordenada-suspeita";
import { normalizarCidade } from "./area-atendida";
import { chaveLogradouro, normalizarTexto, numeroDoEndereco } from "./logradouro";
import { logger } from "../logger";
import type { GeoPrecisao } from "@shared/geo-precisao";

/**
 * Procedência do ponto que este módulo devolve.
 *
 * NÃO é `erp` — a coordenada não é da instalação DESTE cliente, é a do trecho
 * de rua onde ficam as dos outros. NÃO é `logradouro` — não veio de
 * geocodificação, veio da carteira. Chamar de uma das duas apagaria a diferença
 * justamente no campo que o mapa lê para decidir se o marcador é sólido ou
 * translúcido.
 */
export const PRECISAO_VIZINHO = "vizinho" satisfies GeoPrecisao;

/**
 * QUAIS PONTOS ENTRAM NO ÍNDICE — e por que só a coordenada do ERP.
 *
 * `erp` é a coordenada da instalação, gravada crua (ver `coords-erp.service`:
 * nenhum ruído é somado a ela). É a melhor que existe e a única que mede a rua
 * de verdade.
 *
 * `endereco` e `logradouro` ficam DE FORA, e o motivo não é purismo — é que
 * eles quebrariam a régua. Todo ponto geocodificado pela rede é gravado com
 * jitter de ±0,001° por eixo (`geocode-backfill.service`, LGPD: "o ponto nunca
 * é a porta exata"). Dois clientes no MESMO endereço podem então aparecer a até
 * ~300 m um do outro só por causa do ruído — exatamente o teto desta guarda. O
 * índice passaria a medir o nosso próprio ruído em vez do comprimento da rua,
 * rejeitando rua curta boa e aceitando rua longa ruim, nas duas direções.
 *
 * `vizinho` pela mesma razão, e com um agravante: seria aproximação servindo de
 * base para aproximação, que é a pilha que o backfill já teve de desmontar.
 *
 * E o ganho seria quase nada: das 25 ruas com vizinho plotado na Amplinet, 23
 * têm pontos SÓ do ERP. As outras duas não valem corromper a única régua que
 * este módulo tem. Some-se que 84% das ruas em questão não existem no censo e
 * a rede resolveu 3% da amostra: não há ponto geocodificado nessas ruas para
 * aproveitar.
 *
 * A lista é constante de propósito. Se um dia o jitter sair do caminho de
 * escrita, reabrir esta decisão é trocar uma palavra aqui e remedir.
 */
export const PROCEDENCIAS_DO_INDICE = ["erp"] as const;

/**
 * Teto do trecho que sustenta o ponto, em metros.
 *
 * MEDIDO na Amplinet: mediana das ruas 136 m, máximo 3.766 m; com 300 m, 15 dos
 * 25 candidatos passam. O número não é redondo por acaso — ele fica entre dois
 * pisos:
 *
 *   · Não pode ser MENOR que ~200 m. Quem grava soma ±0,001° de jitter (~±110 m)
 *     por LGPD. Uma guarda mais apertada que o ruído que nós mesmos somamos
 *     estaria medindo o ruído, não a rua.
 *   · Não pode ser MUITO MAIOR. Com 300 m de trecho, o ponto devolvido fica a
 *     no máximo ~150 m do cliente; somado o jitter, o pior caso é ~260 m —
 *     ainda a quadra certa da rua certa. A 600 m o pior caso passa de 400 m, e
 *     numa estrada de chácara 400 m é outra propriedade.
 *
 * Contra os dados: a rua mediana (136 m) passa com folga de 2,2×, e a estrada
 * de 3.766 m é recusada por um fator de 12. Não é decisão em fio de navalha em
 * nenhuma das pontas.
 */
export const TETO_DISPERSAO_M = 300;

/**
 * Teto do trecho quando NÃO há prova de que o cliente está dentro dele —
 * metade do outro.
 *
 * A porta do cerco (abaixo) sabe onde o cliente está: entre dois pontos
 * conhecidos. A porta da amostra não sabe; ela aposta que a presença do
 * provedor naquela rua é um trecho curto. Aposta não pode gastar o mesmo
 * orçamento que prova, então o trecho aceito cai pela metade e o pior caso
 * volta a ser o mesmo ~260 m (150 do trecho + 110 do jitter) — só que agora
 * medido a partir do trecho inteiro, e não do cerco.
 */
export const TETO_SEM_CERCO_M = 150;

/**
 * Lugares distintos exigidos quando não há cerco por número.
 *
 * QUATRO, e não dois, e isto foi o defeito que a conferência apontou: dois
 * pontos colados numa estrada de 4 km dão dispersão de metros, a guarda aprova,
 * e QUALQUER cliente daquela rua — inclusive o que mora quilômetros adiante —
 * recebe a mediana dos dois. A guarda de dois pontos media a AMOSTRA, não a
 * rua, e a cascata chama esta fonte justamente onde as ruas são longas: vielas,
 * estradas e chácaras que o censo não nomeia.
 *
 * Quatro instalações independentes da mesma carteira dentro de 150 m ainda não
 * são prova de que a rua é curta — são evidência de que a presença do provedor
 * ali é um trecho curto. É por isso que esta porta só abre com o teto pela
 * metade, e por isso a tela chama o ponto de aproximado sem prometer distância.
 *
 * "Lugares", e não pontos: dois clientes gravados na coordenada IDÊNTICA são um
 * lugar só. Sem isso, a coordenada-padrão que alguns ERPs escrevem em todo mundo
 * (ver `coordenada.ts`) faria uma rua de 5 km medir zero de dispersão e passar
 * — o mesmo raciocínio que este módulo já recusava para o ponto único.
 */
export const MIN_LUGARES_SEM_CERCO = 4;

/**
 * Casas decimais que definem "o mesmo lugar": 5 ≈ 1,1 m.
 *
 * Serve para dois julgamentos: contar lugares distintos e reconhecer a
 * coordenada repetida que denuncia ponto de fallback do ERP.
 */
const CASAS_DO_LUGAR = 5;

/** Um cliente já plotado servindo de referência. Sem nome, sem documento. */
export interface PontoConhecido {
  id: number;
  lat: number;
  lon: number;
  /** Número da casa, quando o cadastro tem. É o que sustenta o cerco. */
  numero: number | null;
}

export interface IndiceDaCarteira {
  /** De quem é este índice. Nenhum ponto aqui é de outro provedor. */
  providerId: number;
  /** `chaveDaRua()` → pontos conhecidos daquela rua. */
  ruas: Map<string, PontoConhecido[]>;
  /** Total de pontos indexados — para o log de quem chama. */
  pontos: number;
}

/** Qual porta sustentou o ponto — prova de posição ou evidência de trecho. */
export type PortaDoVizinho = "cerco" | "amostra";

export interface AcertoVizinho {
  lat: number;
  lon: number;
  precisao: typeof PRECISAO_VIZINHO;
  /** Quantos pontos sustentaram o ponto devolvido. */
  vizinhos: number;
  /** Extensão do trecho que sustentou o ponto, em metros. */
  dispersaoM: number;
  porta: PortaDoVizinho;
}

/**
 * Por que um cliente não foi resolvido. Existe para ser CONTADO: o custo de
 * cobertura de cada regra desta guarda tem de ser medível numa passada, e não
 * discutido no escuro.
 */
export type MotivoRecusa =
  /** Sem cidade, sem UF ou sem logradouro: não há chave. */
  | "sem-chave"
  /** A carteira não tem nenhum ponto naquela rua. */
  | "rua-desconhecida"
  /** O número do cliente cai FORA do intervalo conhecido da rua. */
  | "fora-do-cerco"
  /** O cerco existe, mas o trecho entre os cercadores passa do teto. */
  | "cerco-largo"
  /** Os dois cercadores estão na mesma coordenada com números diferentes. */
  | "coordenada-repetida"
  /** Sem número utilizável, e a amostra da rua não basta para arriscar. */
  | "amostra-fraca";

export interface ResultadoVizinho {
  acerto: AcertoVizinho | null;
  motivo: MotivoRecusa | null;
}

/** O que a leitura do banco devolve, e o que `montarIndice` consome. */
export interface LinhaPlotada {
  id: number;
  providerId: number;
  address: string | null;
  addressNumber?: string | null;
  city: string | null;
  state?: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
}

/** O cliente sendo resolvido — só o que decide a rua. Sem nome, sem documento. */
export interface ClienteParaResolver {
  id: number;
  address?: string | null;
  addressNumber?: string | null;
  city?: string | null;
  state?: string | null;
}

/** UF em duas letras maiúsculas, ou "" quando o cadastro não tem. */
function normalizarUf(uf: string | null | undefined): string {
  const u = (uf || "").normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
  return u.length === 2 ? u : "";
}

/**
 * Marco de posição AO LONGO da via — o número que não é número de casa.
 *
 * O DEFEITO QUE ISTO CONSERTA: separar o endereço pelo último número trata o
 * quilômetro como número de casa, então "ESTRADA DO PINHAL KM 5" e "ESTRADA DO
 * PINHAL KM 22" produziam a MESMA chave. Era inofensivo enquanto a chave só era
 * comparada contra o CNEFE, que grava "ESTRADA DO PINHAL" sem o KM e não
 * casava. Esta cascata compara cadastro contra cadastro, onde os dois lados
 * carregam o "KM" e casam entre si — e a guarda de dispersão não salva, porque
 * ela mede os pontos CONHECIDOS: duas instalações no KM 5 dão dispersão de
 * metros, a guarda aprova, e o cliente do KM 22 vai para 17 km de casa. É a
 * forma de endereço exata da população que esta fonte existe para atender.
 *
 * Duas famílias de marco:
 *   · quilometragem — "KM 5", "km. 22"
 *   · código de rodovia — "PR 445", "BR-376", "SP 250". Aqui o número é o NOME
 *     da via: sem isto, "RODOVIA PR 445" e "RODOVIA PR 376" viravam a mesma
 *     chave "RODOVIA PR".
 *
 * O código só é reconhecido quando o endereço fala de rodovia/estrada ou quando
 * ele abre o endereço. "RUA SÃO PAULO, 250" não pode virar "RUA SAO PAULO 250":
 * ali o 250 é a casa, e separar por número esfacelaria a rua em 200 chaves.
 */
const UF_DE_RODOVIA =
  "BR|AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";
const RE_QUILOMETRO = /\bKM\s*0*(\d{1,4})\b/;
const RE_VIA_LONGA = /\b(RODOVIA|ROD|ESTRADA|ESTR|EST)\b/;
const RE_CODIGO_DE_RODOVIA = new RegExp(`(^|\\s)(${UF_DE_RODOVIA})\\s*0*(\\d{2,4})(?=\\s|$)`);

function separarMarcoDaVia(normalizado: string): { base: string; marco: string; codigo: string } {
  const retirar = (texto: string, inicio: number, tamanho: number) =>
    `${texto.slice(0, inicio)} ${texto.slice(inicio + tamanho)}`.replace(/\s+/g, " ").trim();

  let base = normalizado;
  let codigo = "";
  const marcos: string[] = [];

  const km = base.match(RE_QUILOMETRO);
  if (km && km.index !== undefined) {
    marcos.push(`KM ${Number(km[1])}`);
    base = retirar(base, km.index, km[0].length);
  }

  const cod = base.match(RE_CODIGO_DE_RODOVIA);
  if (cod && cod.index !== undefined && (RE_VIA_LONGA.test(normalizado) || cod.index === 0)) {
    // O separador que a regex consumiu à esquerda não faz parte do marco.
    const inicio = cod.index + cod[1].length;
    codigo = `${cod[2]} ${Number(cod[3])}`;
    marcos.unshift(codigo);
    base = retirar(base, inicio, cod[0].length - cod[1].length);
  }

  return { base, marco: marcos.join(" "), codigo };
}

/**
 * Tipos de logradouro que sozinhos não são nome de rua nenhum.
 *
 * Existem para decidir uma coisa só: em "RUA 7", o 7 é o NOME da rua, não o
 * número da casa — porque o que sobraria seria "RUA", que não identifica nada.
 * Já em "RUA BRASIL 7" sobra "RUA BRASIL", que identifica.
 */
const SO_TIPO = new Set([
  "RUA", "AVENIDA", "TRAVESSA", "ALAMEDA", "PRACA", "RODOVIA", "ESTRADA",
  "LARGO", "JARDIM", "VILA", "VIELA", "BECO", "LADEIRA", "SERVIDAO",
]);

/**
 * Separa o nome da via do número da casa.
 *
 * POR QUE NÃO USA `separarLogradouroENumero`. A regex de lá aceita um rabo
 * depois do número (`", 250 - apto 2"`), e é isso que a faz partir no número
 * ERRADO quando o nome da rua termina em número: "TRAVESSA 2, 30" vira
 * ("TRAVESSA", 2), e então todas as ruas numeradas da cidade — RUA 7, RUA 12,
 * TRAVESSA 2 — colapsam na MESMA chave "RUA"/"TRAVESSA", com o número da rua
 * fazendo as vezes de número de casa. Numa cascata que compara cadastro contra
 * cadastro isso é grave duas vezes: junta ruas diferentes e ainda alimenta o
 * cerco com números que não são de casa. Rua numerada é a forma mais comum de
 * endereço em periferia e loteamento rural, que é a população que esta fonte
 * atende.
 *
 * Aqui a régua é outra, e explícita:
 *   · havendo vírgula seguida de número, o nome é tudo antes dela — a última
 *     vírgula que abre número, para que o complemento ("- apto 2") não confunda;
 *   · sem vírgula, o número é o ÚLTIMO token, e só quando o que sobra não é um
 *     tipo de logradouro solto.
 *
 * `separarLogradouroENumero` continua valendo onde ela é usada: o casamento com
 * o CNEFE compara contra a grafia do censo, que é outra comparação.
 */
function separarNomeENumero(bruto: string): { nome: string; numero: number | null } {
  const t = bruto.trim();
  const comVirgula = t.match(/^(.*),\s*(\d{1,6})(?!\d)/);
  if (comVirgula) return { nome: comVirgula[1], numero: numeroDoEndereco(comVirgula[2]) };

  const noFim = t.match(/^(.*?)\s+(\d{1,6})\s*$/);
  if (noFim && !SO_TIPO.has(chaveLogradouro(noFim[1]))) {
    return { nome: noFim[1], numero: numeroDoEndereco(noFim[2]) };
  }
  return { nome: t, numero: null };
}

/**
 * Logradouro (com o marco de via, quando há) e número da casa.
 *
 * Uma porta só, usada pelos dois lados da comparação: o ponto que entra no
 * índice e o cliente que procura vizinho. Se as duas pontas não passassem pela
 * mesma função, uma normalização divergente casaria ruas diferentes — que é o
 * único jeito de este módulo plotar alguém no lugar errado sem que nenhuma
 * guarda perceba.
 */
export function partesDaRua(
  endereco: string | null | undefined,
  numeroSeparado?: string | null,
): { logradouro: string; numero: number | null } {
  const { base, marco, codigo } = separarMarcoDaVia(normalizarTexto(endereco));
  const fonte = marco ? base : (endereco ?? "");
  const { nome, numero: doTexto } = separarNomeENumero(fonte);
  // O campo próprio manda: quando os dois existem e divergem, o número digitado
  // num campo de número é o mais confiável.
  const numero = numeroDoEndereco(numeroSeparado) ?? doTexto;
  const logradouro = chaveLogradouro(nome);
  if (logradouro) return { logradouro: marco ? `${logradouro} ${marco}` : logradouro, numero };
  // Sobrou só o marco. "BR 376 KM 12" identifica uma via e um trecho dela, e
  // vale como chave. "KM 12" sozinho não identifica nada — sem saber de que
  // estrada é aquele quilômetro, casar dois cadastros assim juntaria clientes
  // de rodovias diferentes no mesmo ponto.
  return { logradouro: codigo ? marco : "", numero };
}

/**
 * Chave do índice: UF + cidade + logradouro, nas mesmas réguas que o resto do
 * sistema usa (`normalizarCidade`, `chaveLogradouro`).
 *
 * A cidade entra na chave e não é decoração: "RUA SÃO PAULO" existe em toda
 * parte, e casar por nome de rua sozinho jogaria um cliente de uma cidade em
 * cima da rua homônima de outra.
 *
 * A UF entra pelo mesmo motivo, um nível acima, e o furo era real:
 * `normalizarCidade` REMOVE o sufixo " - UF" de propósito, então "Bom Jesus -
 * PR" e "Bom Jesus - SC" viravam a mesma chave. O Brasil tem centenas de
 * municípios homônimos em estados diferentes, e um provedor com carteira nos
 * dois lados de uma divisa tem os dois na mesma base.
 *
 * UF vazia NÃO casa com UF preenchida: ausência de informação não é prova de
 * que é o mesmo estado. Custa alguns casamentos num cadastro que preencha o
 * campo pela metade; o que ela compra é nunca plotar um cliente a centenas de
 * quilômetros por causa de um município homônimo.
 *
 * Sem cidade OU sem logradouro não há chave — devolve "" e quem chama desiste.
 */
export function chaveDaRua(
  cidade: string | null | undefined,
  uf: string | null | undefined,
  endereco: string | null | undefined,
  numero?: string | null,
): string {
  const c = normalizarCidade(cidade);
  const { logradouro } = partesDaRua(endereco, numero);
  if (!c || !logradouro) return "";
  return `${normalizarUf(uf)}|${c}|${logradouro}`;
}

/**
 * O filtro da carteira, no SQL.
 *
 * Exportado para ser lido num teste: um índice montado com ponto de outro
 * tenant é vazamento de geolocalização entre provedores, e a prova de que o
 * recorte está no banco — e não numa passagem em memória que alguém pode
 * remover sem perceber — precisa ser verificável.
 */
export function filtroDaCarteira(providerId: number): SQL {
  return and(
    eq(customers.providerId, providerId),
    inArray(customers.geoPrecisao, [...PROCEDENCIAS_DO_INDICE]),
    isNotNull(customers.latitude),
    isNotNull(customers.longitude),
    // String vazia passa em IS NOT NULL e não é endereço nenhum — base
    // restaurada de backup guarda assim.
    sql`nullif(btrim(coalesce(${customers.address}, '')), '') is not null`,
    sql`nullif(btrim(coalesce(${customers.city}, '')), '') is not null`,
  ) as SQL;
}

/**
 * Monta o índice a partir das linhas lidas. Pura, para ser testável sem banco.
 *
 * A checagem de `providerId` linha a linha NÃO substitui o filtro do SQL — ela
 * existe para que, se o filtro algum dia deixar de valer, a falha apareça como
 * exceção em vez de virar um índice contaminado que ninguém percebe. Vazamento
 * entre tenants não pode degradar em silêncio.
 */
export function montarIndice(providerId: number, linhas: LinhaPlotada[]): IndiceDaCarteira {
  const ruas = new Map<string, PontoConhecido[]>();
  let pontos = 0;

  for (const l of linhas) {
    if (l.providerId !== providerId) {
      throw new Error(
        `Índice de logradouros do provedor ${providerId} recebeu linha do provedor ${l.providerId}: `
        + `o filtro por provider_id não valeu. Nenhum ponto de outra carteira pode entrar aqui.`,
      );
    }

    const coord = coordenadaValida(l.latitude, l.longitude);
    if (!coord) continue;

    const chave = chaveDaRua(l.city, l.state, l.address, l.addressNumber);
    if (!chave) continue;

    const { numero } = partesDaRua(l.address, l.addressNumber);
    const ponto: PontoConhecido = { id: l.id, lat: coord.lat, lon: coord.lng, numero };
    const lista = ruas.get(chave);
    if (lista) lista.push(ponto);
    else ruas.set(chave, [ponto]);
    pontos++;
  }

  return { providerId, ruas, pontos };
}

/**
 * Leitura do banco + montagem. Uma consulta só: a carteira inteira é resolvida
 * numa passada, e ir ao banco por cliente seriam centenas de idas.
 */
export async function abrirIndiceDaCarteira(providerId: number): Promise<IndiceDaCarteira> {
  const linhas = await db
    .select({
      id: customers.id,
      providerId: customers.providerId,
      address: customers.address,
      addressNumber: customers.addressNumber,
      city: customers.city,
      // A UF faz parte da chave: sem ela, "Bom Jesus - PR" e "Bom Jesus - SC"
      // seriam a mesma rua.
      state: customers.state,
      latitude: customers.latitude,
      longitude: customers.longitude,
    })
    .from(customers)
    .where(filtroDaCarteira(providerId));

  const indice = montarIndice(providerId, linhas);
  // LGPD: só contagens. Nome e documento nunca vão para log.
  logger.info(
    { providerId, ruas: indice.ruas.size, pontos: indice.pontos },
    "Índice de logradouros da carteira montado",
  );
  return indice;
}

/**
 * Maior distância entre dois pontos, em metros — a extensão do trecho.
 *
 * Sai no primeiro par acima do teto: o resultado exato não interessa quando já
 * se sabe que o trecho é longo demais, e isso limita o custo justamente no caso
 * em que a rua tem muitos pontos espalhados.
 */
export function dispersaoMaximaM(pontos: PontoConhecido[], tetoM = Infinity): number {
  let maior = 0;
  for (let i = 0; i < pontos.length; i++) {
    for (let j = i + 1; j < pontos.length; j++) {
      const d = distanciaKm(pontos[i].lat, pontos[i].lon, pontos[j].lat, pontos[j].lon) * 1000;
      if (d > maior) maior = d;
      if (maior > tetoM) return maior;
    }
  }
  return maior;
}

const chaveDoLugar = (p: PontoConhecido) =>
  `${p.lat.toFixed(CASAS_DO_LUGAR)}|${p.lon.toFixed(CASAS_DO_LUGAR)}`;

const mesmoLugar = (a: PontoConhecido, b: PontoConhecido) => chaveDoLugar(a) === chaveDoLugar(b);

/** Um ponto por coordenada: clientes empilhados na mesma coordenada são um lugar. */
function lugaresDistintos(pontos: PontoConhecido[]): PontoConhecido[] {
  const vistos = new Set<string>();
  const saida: PontoConhecido[] = [];
  for (const p of pontos) {
    const k = chaveDoLugar(p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push(p);
  }
  return saida;
}

const acerto = (
  pontos: PontoConhecido[], dispersaoM: number, porta: PortaDoVizinho,
): ResultadoVizinho => ({
  acerto: {
    // Mediana de latitude e de longitude, independentemente — o mesmo centro
    // robusto que o resto do produto usa.
    //
    // Por que não o vizinho mais próximo, sorteado ou escolhido de forma estável
    // como faz `geocode-local.service`: lá a lista são centenas de endereços do
    // CENSO, que não são a casa de ninguém, e espalhar evitava trezentos pontos
    // empilhados num pixel. Aqui a lista são as instalações de CLIENTES REAIS.
    // Devolver um deles é apontar o cliente B para o telhado do cliente A.
    lat: mediana(pontos.map(p => p.lat)),
    lon: mediana(pontos.map(p => p.lon)),
    precisao: PRECISAO_VIZINHO,
    vizinhos: pontos.length,
    dispersaoM,
    porta,
  },
  motivo: null,
});

const recusa = (motivo: MotivoRecusa): ResultadoVizinho => ({ acerto: null, motivo });

/**
 * O ponto do cliente a partir dos vizinhos da mesma rua, com o motivo quando
 * não dá.
 *
 * ── DUAS PORTAS, E POR QUE A PRIMEIRA EXISTE ──────────────────────────────
 * A versão anterior tinha uma guarda só: dois pontos conhecidos e dispersão
 * até 300 m. A conferência mostrou que ela media a AMOSTRA e não a rua — dois
 * vizinhos colados numa estrada longa dão dispersão de metros, a guarda aprova,
 * e qualquer cliente daquela chave de rua recebe a mediana dos dois, inclusive
 * quem mora quilômetros adiante. A guarda nunca era consultada sobre ESTE
 * cliente, porque nada no módulo dizia onde ele está na rua. E o agravante é
 * estrutural: a cascata só chega aqui quando o censo NÃO conhece a rua, ou
 * seja, exatamente nas estradas e vielas peri-urbanas, que são as mais longas
 * da carteira.
 *
 *   PORTA 1 — CERCO POR NÚMERO. Existe conhecido com número ≤ e conhecido com
 *   número ≥ o do cliente. A numeração brasileira não é linear — e por isso
 *   NADA é interpolado aqui, nem "o 150 fica a 40% entre o 100 e o 220" —, mas
 *   ela é MONÓTONA ao longo da via: o 150 está entre o 100 e o 220, de um lado
 *   ou do outro da rua. Isso é prova de contenção, não estimativa. O ponto
 *   devolvido é a mediana dos dois cercadores e o trecho medido é o cerco, não
 *   a rua inteira — o que também admite o cliente que mora no trecho conhecido
 *   de uma estrada longa, que a regra antiga recusava junto com o resto.
 *
 *   Quando o cliente tem número e a rua tem DOIS números conhecidos que não o
 *   cercam, a resposta é NÃO: o número disponível contradiz a contenção, e
 *   ignorá-lo para cair na porta 2 seria escolher a evidência mais fraca de
 *   propósito. É o caso do cliente 4500 numa rua cujos conhecidos são 100 e 200.
 *
 *   PORTA 2 — AMOSTRA. Sem número de um dos lados não há como provar posição;
 *   só se aceita quando a rua tem 4 lugares distintos dentro de 150 m, metade
 *   do teto do cerco. Não é prova, é evidência de que a presença do provedor
 *   naquela rua é um trecho curto, e por isso paga o dobro em rigor.
 *
 * ── O PRÓPRIO CLIENTE NÃO É VIZINHO DE SI ─────────────────────────────────
 * Cliente sem coordenada não está no índice, então o descarte por id parece
 * dispensável — só que a fase de desempilhamento do backfill re-resolve
 * clientes que JÁ TÊM coordenada. Ali, sem este descarte, o cliente casaria
 * consigo mesmo, o trecho daria zero e a pilha continuaria de pé.
 */
export function avaliarVizinho(
  cliente: ClienteParaResolver,
  indice: IndiceDaCarteira,
): ResultadoVizinho {
  const chave = chaveDaRua(cliente.city, cliente.state, cliente.address, cliente.addressNumber);
  if (!chave) return recusa("sem-chave");

  const conhecidos = (indice.ruas.get(chave) ?? []).filter(p => p.id !== cliente.id);
  if (conhecidos.length === 0) return recusa("rua-desconhecida");

  const { numero } = partesDaRua(cliente.address, cliente.addressNumber);
  const comNumero = conhecidos.filter(p => p.numero !== null);

  if (numero !== null && comNumero.length > 0) {
    // Mesmo número na mesma rua é o mesmo endereço — o prédio da Avenida
    // Américo Deolindo Garla, 224, que já pôs 22 clientes na mesma coordenada
    // legitimamente. Aqui um ponto basta: não é amostra de rua, é o endereço.
    const iguais = comNumero.filter(p => p.numero === numero);
    if (iguais.length > 0) {
      const trecho = dispersaoMaximaM(iguais, TETO_DISPERSAO_M);
      // Mesmo número em pontos distantes é cadastro divergente, não endereço.
      return trecho > TETO_DISPERSAO_M ? recusa("cerco-largo") : acerto(iguais, trecho, "cerco");
    }

    const antes = comNumero.filter(p => p.numero! < numero)
      .reduce<PontoConhecido | null>((m, p) => (m === null || p.numero! > m.numero! ? p : m), null);
    const depois = comNumero.filter(p => p.numero! > numero)
      .reduce<PontoConhecido | null>((m, p) => (m === null || p.numero! < m.numero! ? p : m), null);

    if (antes && depois) {
      // Coordenada idêntica em endereços de números diferentes não é a posição
      // de nenhum dos dois: é a coordenada-padrão que alguns ERPs escrevem em
      // todo mundo (a matriz, o centro da cidade). `coordenadaDoErpCoerente` só
      // recusa além de 35 km do centro do município, então uma dessas dentro da
      // própria cidade entra no índice como `erp` e passaria por cerco de
      // trecho zero.
      if (mesmoLugar(antes, depois)) return recusa("coordenada-repetida");
      const trecho = dispersaoMaximaM([antes, depois]);
      if (trecho > TETO_DISPERSAO_M) return recusa("cerco-largo");
      return acerto([antes, depois], trecho, "cerco");
    }

    // Um único número conhecido não é intervalo e não contradiz nada — a rua
    // ainda pode ser julgada pela amostra. Dois ou mais formam intervalo, e o
    // cliente que cai fora dele está declaradamente noutro trecho.
    if (new Set(comNumero.map(p => p.numero)).size >= 2) return recusa("fora-do-cerco");
  }

  const lugares = lugaresDistintos(conhecidos);
  if (lugares.length < MIN_LUGARES_SEM_CERCO) return recusa("amostra-fraca");

  const trecho = dispersaoMaximaM(lugares, TETO_SEM_CERCO_M);
  if (trecho > TETO_SEM_CERCO_M) return recusa("amostra-fraca");
  return acerto(lugares, trecho, "amostra");
}

/** `avaliarVizinho` para quem só quer o ponto. O motivo é para quem conta. */
export function resolverPorVizinho(
  cliente: ClienteParaResolver,
  indice: IndiceDaCarteira,
): AcertoVizinho | null {
  return avaliarVizinho(cliente, indice).acerto;
}
