/**
 * Cobertura da base de endereços — o que falta para a carteira caber no mapa.
 *
 * POR QUE ISTO EXISTE. Medido na Amplinet (provedor 6) em 04/09/2026: a tela de
 * Localização dizia "184 clientes esperam plotagem · carteira sem
 * geocodificação", e o dono leu isso como "o sistema não plota". Não era. A base
 * de endereços do IBGE carregada no servidor cobria 9 municípios, TODOS do
 * Paraná — a região de OUTRO provedor. A região da Amplinet nunca tinha sido
 * carregada, e nada na tela dizia isso: a cobertura da base era invisível para
 * o operador e para o provedor.
 *
 * A cidade de atendimento não é uma escolha de quem opera o servidor: ela está
 * escrita na carteira. Este serviço pergunta ao banco quais são, resolve cada
 * uma contra a lista oficial de municípios e diz três coisas — o que já tem
 * base, o que falta baixar, e quais grafias do cadastro não são cidade nenhuma.
 * A terceira lista é relatório de qualidade do cadastro, e é o provedor quem
 * conserta: nenhuma normalização transforma "EMBU GAUCU" em município.
 *
 * `carregarBasesFaltantes` é o outro lado: baixa do IBGE e carrega o que falta,
 * uma cidade por vez. Isto aqui é o serviço; quem o agenda e quem o mostra na
 * tela são outras frentes.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { customers, providers } from "@shared/schema";
import { normalizarCidade } from "./area-atendida";
import { cidadesNoMapa } from "./cidades-do-mapa";
import {
  limparNomeDeCidade, resolverMunicipioDaCidade, ufDominante, ufNoNomeDaCidade,
  type Municipio,
} from "./municipio.service";
import { baixarCnefe } from "./cnefe-download.service";
import { carregarCnefeDoConteudo, FONTE_CNEFE } from "./geo-bases.service";
/**
 * A MESMA régua de "sem coordenada" que a fila de plotagem usa — inclusive o
 * par (0,0) que alguns imports gravam. Duplicar a condição aqui faria o número
 * desta tela divergir do número de pendentes do plotador, e o provedor veria
 * duas contagens diferentes do mesmo problema.
 */
import { SEM_COORDENADA } from "./geocode-backfill.service";
import { logger } from "../logger";

/* ── Medição ─────────────────────────────────────────────────────────────── */

export interface CidadeDaCarteira {
  municipio: Municipio;
  clientes: number;
  /** Quantos desses ainda não têm coordenada — é o que a base destravaria. */
  semCoordenada: number;
  /** As grafias cruas do ERP que caíram nesta cidade. */
  grafias: string[];
  /**
   * As chaves normalizadas que caíram neste município — é por elas que o
   * geocodificador liga `customers.city` à base. Normalmente uma; "EMBUGUACU"
   * e "EMBU GUACU" são duas chaves diferentes e o mesmo município.
   */
  chaves: string[];
}

/** Por que uma grafia não virou município. As duas pedem correção no ERP. */
export type MotivoSemMunicipio =
  /** O cadastro não diz a UF, e sem UF "ITAPECERICA" pode ser SP ou MG. */
  | "sem_uf"
  /** Erro de digitação ou bairro no campo de cidade. */
  | "nao_encontrada";

export interface GrafiaSemMunicipio {
  chave: string;
  grafias: string[];
  clientes: number;
  semCoordenada: number;
  motivo: MotivoSemMunicipio;
}

export interface CoberturaDaCarteira {
  /** null quando a medição é da base inteira (superadmin). */
  providerId: number | null;
  /**
   * Municípios resolvidos + grafias que não viraram município. É o número de
   * linhas das três listas somadas, não o número de grafias do cadastro.
   */
  cidades: number;
  clientes: number;
  semCoordenada: number;
  comBase: CidadeDaCarteira[];
  semBase: CidadeDaCarteira[];
  semMunicipio: GrafiaSemMunicipio[];
}

interface Grupo {
  clientes: number;
  semCoordenada: number;
  grafias: Set<string>;
  /** UF do cadastro → quantos clientes. A dominante é quem decide. */
  ufs: Map<string, number>;
}

/** Uma linha do agrupamento da carteira: uma grafia de cidade + uma UF. */
export interface LinhaDaCarteira {
  /** Ausente quando quem chama não separa por tenant — só nos testes da classificação. */
  providerId?: number | null;
  cidade: string | null;
  uf: string | null;
  clientes: number;
  semCoordenada: number;
}

/**
 * Municípios que já têm o censo de endereços carregado.
 *
 * A CONDIÇÃO É TER ENDEREÇO EM `geo_endereco`, e não linha em `geo_hps_bairro`.
 * A carga do CNEFE grava nas duas tabelas em TRANSAÇÕES SEPARADAS
 * (`carregarCnefeDoConteudo`): primeiro os bairros, depois os milhões de
 * endereços. Um restart do worker entre os dois commits — e o deploy manual do
 * pm2 é exatamente um `delete/start` — deixava a cidade marcada como coberta e
 * VAZIA para sempre: saía de `semBase`, o botão da tela não a oferecia mais, a
 * passada de 24h a ignorava, e nenhum cliente dela plotava. A falha invisível
 * que esta rotina existe para acabar, reencenada.
 *
 * `geo_endereco` é a tabela que o geocodificador local realmente consome
 * (`geocode-local.service`), então perguntar a ela é perguntar a quem responde.
 * O `exists` corre por município — são dezenas — contra o índice
 * `geo_endereco_rua`, em vez de um `distinct` sobre a tabela inteira.
 */
async function municipiosComBase(): Promise<Set<string>> {
  try {
    const { rows } = await pool.query<{ ibge: string }>(
      `SELECT DISTINCT h.municipio_ibge AS ibge
         FROM geo_hps_bairro h
        WHERE h.fonte = $1
          AND EXISTS (SELECT 1 FROM geo_endereco e WHERE e.municipio_ibge = h.municipio_ibge)`,
      [FONTE_CNEFE],
    );
    return new Set(rows.map(l => l.ibge));
  } catch (err: any) {
    // Nenhuma base carregada ainda: as tabelas nascem com a primeira carga. Sem
    // base é o estado inicial legítimo, não um defeito.
    if (err?.code === "42P01") return new Set();
    throw err;
  }
}

/**
 * As cidades que cada provedor tirou do mapa, pelo nome como ele as gravou.
 *
 * Uma consulta só; a lista de exclusões é um array de texto na linha do
 * provedor. Com a carteira inteira (o worker), lê a de todos que têm cliente.
 */
async function exclusoesPorProvedor(ids: number[]): Promise<Map<number, string[]>> {
  const unicos = [...new Set(ids.filter(id => Number.isFinite(id)))];
  if (unicos.length === 0) return new Map();
  const linhas = await db
    .select({ id: providers.id, excluidas: providers.cidadesExcluidasDoMapa })
    .from(providers)
    .where(inArray(providers.id, unicos));
  return new Map(linhas.map(l => [l.id, l.excluidas ?? []]));
}

/**
 * Fica só o que o mapa da carteira de fato mostra.
 *
 * POR QUE FILTRAR. Estas linhas viram duas coisas: o número que a tela anuncia
 * ("N clientes esperam a base de endereços de X") e a FILA de download do FTP
 * do IBGE. Sem o recorte, as duas erram na mesma direção — a tela promete que
 * carregar a base põe no mapa gente que o mapa não mostra de qualquer jeito, e
 * a fila põe no topo a capital que o provedor excluiu à mão, que é justamente o
 * CNEFE mais pesado do país. A régua é a de `cidades-do-mapa.ts`, a mesma que o
 * KPI "Sem coordenada" logo acima usa, para os dois números da mesma página
 * descreverem o mesmo universo.
 *
 * Por provedor, e não pela soma: o piso de massa e a lista de exclusões são de
 * cada carteira. Na passada da base inteira isso significa que a capital
 * excluída por um provedor ainda entra se for praça de verdade de outro.
 */
export function somenteCidadesDoMapa(
  linhas: LinhaDaCarteira[],
  excluidasPorProvedor: ReadonlyMap<number, readonly string[]> = new Map(),
): LinhaDaCarteira[] {
  const contagens = new Map<number, Map<string, number>>();
  for (const l of linhas) {
    const chave = normalizarCidade(l.cidade);
    if (!chave) continue;
    const p = l.providerId ?? 0;
    const doProvedor = contagens.get(p) ?? new Map<string, number>();
    doProvedor.set(chave, (doProvedor.get(chave) ?? 0) + (Number(l.clientes) || 0));
    contagens.set(p, doProvedor);
  }

  const doMapa = new Map<number, Set<string>>();
  for (const [p, contagem] of contagens) {
    doMapa.set(p, cidadesNoMapa(contagem, excluidasPorProvedor.get(p) ?? []));
  }

  return linhas.filter(l => doMapa.get(l.providerId ?? 0)?.has(normalizarCidade(l.cidade)));
}

/**
 * A classificação em si, isolada do banco para ser testável — é o mesmo padrão
 * de `escolherArea` em area-atendida.ts. Recebe a carteira já agrupada e o
 * conjunto de municípios que têm base, e devolve as três listas.
 */
export function classificarCobertura(
  linhas: LinhaDaCarteira[],
  municipiosComBase: ReadonlySet<string>,
  providerId: number | null = null,
): CoberturaDaCarteira {
  // As grafias colapsam pela MESMA regra do geocodificador, depois de limpo o
  // que o ERP acrescenta ao nome: "EMBU-GUAÇU", "EMBU GUACU" e "EMBUGUAÇU" são
  // uma cidade só, e uma base só a resolve.
  const porCidade = new Map<string, Grupo>();
  for (const l of linhas) {
    const bruta = (l.cidade || "").trim();
    const chave = normalizarCidade(limparNomeDeCidade(bruta));
    if (!chave) continue;
    const grupo = porCidade.get(chave) ?? {
      clientes: 0, semCoordenada: 0, grafias: new Set<string>(), ufs: new Map<string, number>(),
    };
    grupo.clientes += Number(l.clientes) || 0;
    grupo.semCoordenada += Number(l.semCoordenada) || 0;
    grupo.grafias.add(bruta);
    const uf = (l.uf || "").trim();
    if (uf) grupo.ufs.set(uf, (grupo.ufs.get(uf) ?? 0) + (Number(l.clientes) || 0));
    porCidade.set(chave, grupo);
  }

  /**
   * Fundido por município, e não pela chave normalizada.
   *
   * "EMBUGUACU" e "EMBU GUACU" são duas chaves — só a segunda regra do
   * resolvedor as junta —, e sem esta fusão Embu-Guaçu apareceria duas vezes na
   * lista do que falta e seria baixada duas vezes do IBGE. O município é a
   * identidade; a chave é só como o cadastro chegou até ele.
   */
  const porMunicipio = new Map<string, CidadeDaCarteira>();
  const semMunicipio: GrafiaSemMunicipio[] = [];
  let clientes = 0;
  let semCoordenada = 0;

  for (const [chave, grupo] of porCidade) {
    clientes += grupo.clientes;
    semCoordenada += grupo.semCoordenada;
    const grafias = [...grupo.grafias];

    // A UF sai da MAIORIA dos cadastros; se o campo de estado estiver vazio,
    // ainda vale a sigla que alguém escreveu junto do nome da cidade.
    const uf = ufDominante(grupo.ufs) ?? grafias.map(ufNoNomeDaCidade).find(Boolean) ?? null;
    /*
     * RÉGUA FROUXA AQUI, de propósito — inclusive a expansão por prefixo.
     *
     * Esta resolução decide QUAL BASE DO IBGE BAIXAR, e nada mais: errar custa
     * um download, e a plotagem continua chaveada pelo texto do próprio cliente.
     * A régua ESTRITA é a de `cidade-canonica.service`, que decide o que gravar
     * em `customers.city` — lá um casamento por semelhança reescreveria o
     * cadastro do provedor sem caminho de volta. Ver "DUAS RÉGUAS" em
     * `municipio.service`.
     *
     * Pelo mesmo motivo a UF vem da maioria: 207 cadastros em SP contra quatro
     * em RN/SE/SC são evidência boa o bastante para escolher um download, e não
     * são evidência nenhuma para mudar uma linha de estado. É por isso que uma
     * grafia pode aparecer coberta nesta tela e como "corrija no ERP" no
     * relatório do `script/canonizar-cidades.ts`.
     */
    const municipio = resolverMunicipioDaCidade(chave, uf);

    if (!municipio) {
      semMunicipio.push({
        chave, grafias, clientes: grupo.clientes, semCoordenada: grupo.semCoordenada,
        motivo: uf ? "nao_encontrada" : "sem_uf",
      });
      continue;
    }

    const cidade = porMunicipio.get(municipio.ibge);
    if (cidade) {
      cidade.clientes += grupo.clientes;
      cidade.semCoordenada += grupo.semCoordenada;
      cidade.grafias.push(...grafias);
      cidade.chaves.push(chave);
    } else {
      porMunicipio.set(municipio.ibge, {
        municipio, clientes: grupo.clientes, semCoordenada: grupo.semCoordenada,
        grafias, chaves: [chave],
      });
    }
  }

  const comBase: CidadeDaCarteira[] = [];
  const semBase: CidadeDaCarteira[] = [];
  for (const cidade of porMunicipio.values()) {
    (municipiosComBase.has(cidade.municipio.ibge) ? comBase : semBase).push(cidade);
  }

  // Quem tem mais gente fora do mapa vem primeiro: é a ordem em que a carga
  // devolve cliente plotado por megabyte baixado.
  const maisUrgente = (a: CidadeDaCarteira, b: CidadeDaCarteira) =>
    b.semCoordenada - a.semCoordenada || b.clientes - a.clientes;
  comBase.sort(maisUrgente);
  semBase.sort(maisUrgente);
  semMunicipio.sort((a, b) => b.clientes - a.clientes);

  return {
    providerId,
    cidades: porMunicipio.size + semMunicipio.length,
    clientes,
    semCoordenada,
    comBase,
    semBase,
    semMunicipio,
  };
}

/**
 * A carteira agrupada por cidade, com as grafias já colapsadas.
 *
 * `providerId` ausente ou null mede a base inteira — é a visão do superadmin.
 * Com providerId, a query filtra pelo tenant, como toda query do sistema.
 *
 * Só as cidades que o mapa da carteira de fato mostra entram na conta — ver
 * `somenteCidadesDoMapa`. Sem isso este número e o do KPI "Sem coordenada" da
 * mesma tela discordariam, e a fila de download começaria pela capital que o
 * provedor excluiu do mapa à mão.
 */
export async function coberturaDaCarteira(
  providerId?: number | null,
): Promise<CoberturaDaCarteira> {
  const doProvedor = typeof providerId === "number" ? providerId : null;

  const linhas = await db
    .select({
      providerId: customers.providerId,
      cidade: customers.city,
      uf: customers.state,
      clientes: sql<number>`count(*)::int`,
      semCoordenada: sql<number>`count(*) filter (where ${SEM_COORDENADA})::int`,
    })
    .from(customers)
    .where(and(
      sql`nullif(btrim(coalesce(${customers.city}, '')), '') is not null`,
      ...(doProvedor === null ? [] : [eq(customers.providerId, doProvedor)]),
    ))
    // Por provedor também: o piso de massa e as cidades excluídas do mapa são
    // de cada carteira, e a passada do worker mede várias de uma vez.
    .groupBy(customers.providerId, customers.city, customers.state);

  const noMapa = somenteCidadesDoMapa(
    linhas,
    await exclusoesPorProvedor(linhas.map(l => l.providerId)),
  );

  return classificarCobertura(noMapa, await municipiosComBase(), doProvedor);
}

/* ── Carga ───────────────────────────────────────────────────────────────── */

export interface CargaDeBase {
  municipio: Municipio;
  ok: boolean;
  /** Domicílios do CNEFE gravados (só quando deu certo). */
  domicilios?: number;
  /** Endereços com coordenada — é o que o geocodificador local consome. */
  enderecos?: number;
  erro?: string;
}

export interface OpcoesDeCarga {
  /** Teto de cidades por passada. Sem teto, carrega todas as que faltam. */
  limite?: number;
  /** Avisos de progresso — a linha de comando imprime, um job loga. */
  aoIniciar?: (municipio: Municipio, indice: number, total: number) => void;
  aoTerminar?: (carga: CargaDeBase) => void;
}

export interface ResultadoDaCarga {
  providerId: number | null;
  /** Quantas cidades da carteira estavam sem base quando a passada começou. */
  faltavam: number;
  tentadas: number;
  carregadas: CargaDeBase[];
  falhas: CargaDeBase[];
}

/**
 * Baixa do IBGE e carrega a base de cada cidade da carteira que ainda não tem.
 *
 * UMA POR VEZ, de propósito: são dezenas de MB por município e o FTP do IBGE
 * não agradece paralelismo. E com try/catch por cidade, também de propósito:
 * uma que falhe — o FTP recusando, o zip sem CSV — não pode levar as outras
 * junto, e a passada seguinte tenta de novo só o que faltou.
 */
export async function carregarBasesFaltantes(
  providerId?: number | null,
  opcoes: OpcoesDeCarga = {},
): Promise<ResultadoDaCarga> {
  const cobertura = await coberturaDaCarteira(providerId);
  const alvo = typeof opcoes.limite === "number" && opcoes.limite >= 0
    ? cobertura.semBase.slice(0, opcoes.limite)
    : cobertura.semBase;

  const carregadas: CargaDeBase[] = [];
  const falhas: CargaDeBase[] = [];

  for (const [i, cidade] of alvo.entries()) {
    const { municipio } = cidade;
    opcoes.aoIniciar?.(municipio, i + 1, alvo.length);
    let carga: CargaDeBase;
    try {
      const { municipio: baixado, csv } = await baixarCnefe(municipio.ibge);
      const r = await carregarCnefeDoConteudo(csv, baixado.nome);
      carga = { municipio, ok: true, domicilios: r.total, enderecos: r.enderecos ?? 0 };
      carregadas.push(carga);
      logger.info(
        { municipio: municipio.nome, uf: municipio.uf, ibge: municipio.ibge,
          domicilios: r.total, enderecos: r.enderecos ?? 0, providerId: cobertura.providerId },
        "Cobertura geo: base do IBGE carregada",
      );
    } catch (err: any) {
      carga = { municipio, ok: false, erro: err?.message || String(err) };
      falhas.push(carga);
      logger.warn(
        { err, municipio: municipio.nome, uf: municipio.uf, ibge: municipio.ibge },
        "Cobertura geo: falha ao carregar a base — as outras cidades seguem",
      );
    }
    opcoes.aoTerminar?.(carga);
  }

  return {
    providerId: cobertura.providerId,
    faltavam: cobertura.semBase.length,
    tentadas: alvo.length,
    carregadas,
    falhas,
  };
}
