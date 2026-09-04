/**
 * Carga das bases geográficas públicas — IBGE CNEFE 2022 e ANEEL BDGD.
 *
 * É o que transforma o funil do Raio-X de quatro travessões em números: sem
 * denominador não existe penetração, e penetração inventada é pior que
 * penetração ausente, porque o provedor decide investimento comercial em cima
 * dela.
 *
 * ── CNEFE 2022 (IBGE) ────────────────────────────────────────────────────
 * Censo de endereços. Uma linha por endereço do município, com o bairro em
 * DSC_LOCALIDADE e a espécie em COD_ESPECIE. Só 1 (domicílio particular) e 2
 * (domicílio coletivo) contam como HP — comércio e equipamento público não são
 * casa de ninguém e não compram internet residencial.
 * Arquivo por município, nomeado {codigoIbge}_{NOME}.csv, separado por ';',
 * codificação latin1.
 *
 * ── ANEEL BDGD ───────────────────────────────────────────────────────────
 * Unidades consumidoras residenciais com energia ATIVA, agregadas por bairro.
 * É o melhor denominador que existe: domicílio sem luz não é mercado.
 * CSV com cabeçalho `mun;bairro;uc_re_ativas`.
 *
 * A DDL vive aqui, idempotente, em vez de depender de `drizzle-kit push` —
 * push pergunta "criar ou renomear?" para cada tabela nova e trava um deploy
 * não-interativo. A tabela também está declarada em shared/schema.ts, que é
 * quem dá tipo às consultas.
 */
import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { pool } from "../db";
import { normalizarLocalidade } from "./localidade";
import { chaveLogradouro, numeroDoEndereco } from "./logradouro";
import { garantirTabelaEnderecos } from "./geocode-local.service";
import { logger } from "../logger";
import citiesData from "../../shared/data/cidades-brasil.json";

export const FONTE_CNEFE = "CNEFE2022";
export const FONTE_ANEEL = "ANEEL_BDGD_2024";

export interface ResultadoCarga {
  fonte: string;
  municipio: string;
  cidade: string;
  uf: string;
  bairros: number;
  total: number;
  /** Endereços com coordenada extraídos do mesmo arquivo (só no CNEFE). */
  enderecos?: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS geo_hps_bairro (
  id            serial PRIMARY KEY,
  municipio_ibge text NOT NULL,
  cidade_norm    text NOT NULL,
  uf             text NOT NULL,
  bairro_norm    text NOT NULL,
  fonte          text NOT NULL,
  hps            integer NOT NULL,
  atualizado_em  timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS geo_hps_bairro_chave
  ON geo_hps_bairro (municipio_ibge, fonte, bairro_norm);
CREATE INDEX IF NOT EXISTS geo_hps_bairro_cidade
  ON geo_hps_bairro (cidade_norm, uf);
`;

export async function garantirTabelasGeo(): Promise<void> {
  await pool.query(DDL);
}

/** UF por código IBGE — os dois primeiros dígitos do código do município. */
const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/** Grava o agregado de uma fonte substituindo o que houver — recarregar o
 *  mesmo arquivo não duplica nem soma em cima. */
async function gravar(
  municipioIbge: string, cidadeNorm: string, uf: string, fonte: string,
  porBairro: Map<string, number>,
): Promise<ResultadoCarga> {
  await garantirTabelasGeo();
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query(
      "DELETE FROM geo_hps_bairro WHERE municipio_ibge = $1 AND fonte = $2",
      [municipioIbge, fonte],
    );
    let total = 0;
    for (const [bairro, n] of Array.from(porBairro.entries())) {
      if (!bairro || n <= 0) continue;
      total += n;
      await conn.query(
        `INSERT INTO geo_hps_bairro (municipio_ibge, cidade_norm, uf, bairro_norm, fonte, hps)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [municipioIbge, cidadeNorm, uf, bairro, fonte, n],
      );
    }
    await conn.query("COMMIT");
    return { fonte, municipio: municipioIbge, cidade: cidadeNorm, uf, bairros: porBairro.size, total };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Domicílios por bairro a partir do conteúdo do CSV do CNEFE. Puro. */
/**
 * As linhas de um CSV que NAO cabe numa string.
 *
 * O CNEFE de Sao Paulo capital passa de 512 MB, e `Buffer.toString()` estoura
 * ali: "Cannot create a string longer than 0x1fffffe8 characters" — o limite de
 * string do V8. Foi o que impediu de carregar a capital em 04/09/2026, quando
 * a Amplinet precisou dela (parte da zona sul, na divisa de Embu-Guacu).
 *
 * Decodifica em fatias de 8 MB e emite linha a linha. O resto do arquivo nunca
 * vira string, entao o tamanho deixa de importar — o que importa e o pico de
 * memoria de quem CONSOME, e por isso os dois consumidores viraram geradores.
 *
 * latin1 e decodificado por byte, sem estado entre fatias: cortar o buffer em
 * qualquer posicao e seguro, ao contrario de UTF-8, onde a fatia poderia partir
 * um caractere ao meio. O CNEFE e latin1 — ver o comentario de `baixarCnefe`.
 */
export function* linhasDoBuffer(buf: Buffer): Generator<string> {
  const FATIA = 8 * 1024 * 1024;
  let resto = "";
  for (let i = 0; i < buf.length; i += FATIA) {
    const pedaco = resto + buf.toString("latin1", i, Math.min(i + FATIA, buf.length));
    const partes = pedaco.split(/\r?\n/);
    // A ultima parte pode ser meia linha: so sai quando a proxima fatia chegar.
    resto = partes.pop() ?? "";
    for (const l of partes) yield l;
  }
  if (resto) yield resto;
}

/** Aceita o CSV inteiro (arquivo pequeno, teste) ou as linhas de um buffer. */
type FonteCsv = string | Iterable<string>;

function* comoLinhas(fonte: FonteCsv): Generator<string> {
  if (typeof fonte === "string") {
    for (const l of fonte.split(/\r?\n/)) yield l;
    return;
  }
  yield* fonte;
}

export function agregarCnefe(fonte: FonteCsv): { municipioIbge: string; porBairro: Map<string, number> } {
  const linhas = comoLinhas(fonte);
  const primeira = linhas.next();
  if (primeira.done) throw new Error("CSV vazio");

  const cab = primeira.value.split(";").map(c => c.trim().toUpperCase());
  const iMunicipio = cab.indexOf("COD_MUNICIPIO");
  const iLocalidade = cab.indexOf("DSC_LOCALIDADE");
  const iEspecie = cab.indexOf("COD_ESPECIE");
  if (iMunicipio < 0 || iLocalidade < 0 || iEspecie < 0) {
    throw new Error("Cabeçalho do CNEFE sem COD_MUNICIPIO, DSC_LOCALIDADE ou COD_ESPECIE");
  }

  const porBairro = new Map<string, number>();
  let municipioIbge = "";
  for (const l of linhas) {
    if (!l) continue;
    const f = l.split(";");
    // Só domicílio: HP é casa, não loja nem escola.
    const especie = (f[iEspecie] || "").trim();
    if (especie !== "1" && especie !== "2") continue;
    if (!municipioIbge) municipioIbge = (f[iMunicipio] || "").trim();
    const bairro = normalizarLocalidade(f[iLocalidade]);
    if (!bairro) continue;
    porBairro.set(bairro, (porBairro.get(bairro) ?? 0) + 1);
  }

  if (!municipioIbge) throw new Error("Nenhum domicílio encontrado no arquivo");
  return { municipioIbge, porBairro };
}

/** Cabeçalho exato que o agregado do BDGD tem de trazer. */
export const CABECALHO_ANEEL = "mun;bairro;uc_re_ativas";

/** UCs vivas por município e bairro a partir do CSV da ANEEL. Puro. */
export function agregarAneel(conteudo: string): Map<string, Map<string, number>> {
  const linhas = conteudo.split(/\r?\n/);
  if (linhas.length < 2) throw new Error("CSV vazio");

  // O cabeçalho é comparado inteiro, não por prefixo: o nome `uc_re_ativas` é
  // a única marca de que o agregado filtrou classe residencial + situação
  // ativa. Um export com `uc_total` (todas as classes, inativas inclusive) tem
  // o mesmo formato e entraria como denominador inflado sem ninguém notar.
  const cab = linhas[0].replace(/^\uFEFF/, "").trim().toLowerCase();
  if (cab !== CABECALHO_ANEEL) {
    throw new Error(`Cabeçalho da ANEEL "${linhas[0].trim()}" fora do esperado — precisa ser exatamente "${CABECALHO_ANEEL}" (mun, bairro, uc_re_ativas)`);
  }
  const iMun = 0, iBairro = 1, iUc = 2;

  const porMunicipio = new Map<string, Map<string, number>>();
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const f = l.split(";");
    const mun = (f[iMun] || "").trim();
    const bairro = normalizarLocalidade(f[iBairro]);
    const uc = parseInt((f[iUc] || "").trim(), 10);
    // Código IBGE tem 7 dígitos; qualquer outra coisa é linha quebrada, e uma
    // contagem negativa é sinal de agregação errada — nenhuma das duas pode
    // entrar num denominador.
    if (!/^\d{7}$/.test(mun) || !bairro || !Number.isFinite(uc) || uc < 0) continue;
    let m = porMunicipio.get(mun);
    if (!m) { m = new Map(); porMunicipio.set(mun, m); }
    // Duas linhas do mesmo bairro somam: a base vem por transformador, e o
    // mesmo bairro pode aparecer em mais de um.
    m.set(bairro, (m.get(bairro) ?? 0) + uc);
  }
  return porMunicipio;
}

/** Código IBGE → total de UCs vivas conferido no recon do BDGD. */
export type TotaisEsperadosAneel = Map<string, number>;

/**
 * Confere a soma de UCs de cada município contra o recon ANTES de gravar.
 * Puro; lança com todas as divergências de uma vez.
 *
 * Um CSV truncado ou agregado com o filtro errado tem o mesmo formato do
 * certo e passa pelo parser sem reclamar. A soma é a única coisa que separa os
 * dois, e carga errada em denominador vira penetração errada na tela do
 * provedor. Município esperado que não aparece no CSV soma zero e diverge do
 * mesmo jeito — arquivo do município errado não é "nada a fazer".
 */
export function validarTotaisAneel(
  porMunicipio: Map<string, Map<string, number>>,
  esperado: TotaisEsperadosAneel,
): void {
  const divergencias: string[] = [];
  for (const [mun, total] of Array.from(esperado.entries())) {
    const m = porMunicipio.get(mun);
    const soma = m ? Array.from(m.values()).reduce((s, n) => s + n, 0) : 0;
    if (soma !== total) divergencias.push(`${mun}: ${soma} UCs no CSV, esperado ${total}`);
  }
  if (divergencias.length > 0) {
    throw new Error(
      `Totais da ANEEL divergem do recon — carga abortada, nada gravado (CSV errado ou truncado?): ${divergencias.join("; ")}`,
    );
  }
}

export interface EnderecoCnefe {
  logradouroNorm: string;
  numero: number | null;
  cep: string | null;
  bairroNorm: string | null;
  lat: number;
  lon: number;
}

/**
 * Endereços com coordenada, a partir do conteúdo do CSV. Puro.
 *
 * Deduplicado por (logradouro, número): um prédio de cem apartamentos tem cem
 * linhas no censo e uma única porta na rua. Sem isso, Londrina sozinha traria
 * centenas de milhares de linhas redundantes para responder a mesma pergunta.
 */
/**
 * Os enderecos, um a um, sem montar a lista inteira.
 *
 * Gerador e nao array porque Sao Paulo capital tem alguns milhoes de linhas:
 * o array e o `Set` de deduplicacao juntos passariam de um giga de heap, e a
 * gravacao ja e em lotes de mil — nunca houve razao para segurar tudo.
 * `extrairEnderecosCnefe` continua existindo, devolvendo array, porque e o
 * que os testes exercitam e o que um municipio pequeno pede.
 */
export function* enderecosCnefe(fonte: FonteCsv): Generator<EnderecoCnefe> {
  const linhas = comoLinhas(fonte);
  const primeira = linhas.next();
  if (primeira.done) throw new Error("CSV vazio");

  const cab = primeira.value.split(";").map(c => c.trim().toUpperCase());
  const idx = (nome: string) => cab.indexOf(nome);
  const iTipo = idx("NOM_TIPO_SEGLOGR");
  const iTitulo = idx("NOM_TITULO_SEGLOGR");
  const iNome = idx("NOM_SEGLOGR");
  const iNumero = idx("NUM_ENDERECO");
  const iCep = idx("CEP");
  const iLocalidade = idx("DSC_LOCALIDADE");
  const iLat = idx("LATITUDE");
  const iLon = idx("LONGITUDE");
  if (iNome < 0 || iLat < 0 || iLon < 0) {
    throw new Error("Cabeçalho do CNEFE sem NOM_SEGLOGR, LATITUDE ou LONGITUDE");
  }

  const vistos = new Set<string>();

  for (const l of linhas) {
    if (!l) continue;
    const f = l.split(";");

    const lat = parseFloat((f[iLat] || "").trim());
    const lon = parseFloat((f[iLon] || "").trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;

    // O logradouro do censo vem em três campos: tipo, título e nome. Juntos
    // formam a mesma string que a normalização do ERP produz.
    const partes = [
      iTipo >= 0 ? f[iTipo] : "",
      iTitulo >= 0 ? f[iTitulo] : "",
      f[iNome],
    ].map(p => (p || "").trim()).filter(Boolean);
    const logradouroNorm = chaveLogradouro(partes.join(" "));
    if (!logradouroNorm) continue;

    const numero = iNumero >= 0 ? numeroDoEndereco(f[iNumero]) : null;
    const chave = `${logradouroNorm}|${numero ?? ""}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const cepBruto = iCep >= 0 ? (f[iCep] || "").replace(/\D/g, "") : "";
    yield {
      logradouroNorm,
      numero,
      cep: cepBruto.length === 8 ? cepBruto : null,
      bairroNorm: iLocalidade >= 0 ? normalizarLocalidade(f[iLocalidade]) || null : null,
      lat,
      lon,
    };
  }
}

/** A lista inteira. So para municipio pequeno e para teste — ver `enderecosCnefe`. */
export function extrairEnderecosCnefe(fonte: FonteCsv): EnderecoCnefe[] {
  return [...enderecosCnefe(fonte)];
}

/**
 * Carrega um CSV do CNEFE. O município e o nome saem do próprio arquivo — o
 * código está em toda linha, e o nome no nome do arquivo.
 */
export async function carregarCnefe(caminho: string): Promise<ResultadoCarga> {
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);

  // latin1: o CNEFE não é UTF-8, e lido como UTF-8 "IBIPORÃ" vira caractere
  // inválido e o bairro deixa de casar com o do ERP.
  // "4113700_LONDRINA.csv" → LONDRINA
  const nomeArquivo = basename(caminho).replace(/\.csv$/i, "");
  const cidade = normalizarLocalidade(nomeArquivo.replace(/^\d+[_-]?/, "").replace(/_/g, " "));
  if (!cidade) throw new Error(`Não deu para extrair a cidade do nome do arquivo: ${nomeArquivo}`);
  return carregarCnefeDoConteudo(readFileSync(caminho), cidade);
}

/**
 * Carrega o CNEFE a partir do conteúdo já em memória — é por aqui que entra o
 * arquivo baixado do IBGE, sem passar pelo disco.
 */
export async function carregarCnefeDoConteudo(
  conteudo: string | Buffer,
  nomeCidade: string,
): Promise<ResultadoCarga> {
  /**
   * Buffer entra sem virar string; string continua aceita para arquivo pequeno
   * e para teste. O CNEFE de Sao Paulo capital passa do limite de string do V8
   * (512 MB) — ver `linhasDoBuffer`.
   *
   * O arquivo e percorrido DUAS vezes, uma por agregacao. O comentario anterior
   * dizia que isso seria desperdicio, e era: ali "ler duas vezes" significava
   * ler do disco ou da rede de novo. Aqui os bytes ja estao na memoria e o
   * custo e so redecodificar — barato ao lado de segurar milhoes de enderecos
   * em heap para fazer as duas contas de uma vez.
   */
  const linhas = () => (typeof conteudo === "string" ? conteudo : linhasDoBuffer(conteudo));

  const { municipioIbge, porBairro } = agregarCnefe(linhas());
  const cidadeNorm = normalizarLocalidade(nomeCidade);
  const uf = UF_POR_CODIGO[municipioIbge.slice(0, 2)] ?? "";
  if (!cidadeNorm) throw new Error("Nome de cidade vazio");

  const r = await gravar(municipioIbge, cidadeNorm, uf, FONTE_CNEFE, porBairro);

  // O mesmo arquivo alimenta o geocodificador local.
  const enderecos = await gravarEnderecos(municipioIbge, enderecosCnefe(linhas()));
  logger.info({ ...r, enderecos }, "CNEFE carregado");
  return { ...r, enderecos };
}

/**
 * Substitui os endereços do município — recarregar não duplica.
 *
 * Consome um ITERAVEL e nunca guarda a lista: Sao Paulo capital tem alguns
 * milhoes de enderecos, e o array inteiro em heap era metade do motivo de a
 * capital nao carregar (a outra metade era o limite de string, em
 * `linhasDoBuffer`). Devolve quantos gravou, que e o numero que o log e a tela
 * mostram.
 */
async function gravarEnderecos(
  municipioIbge: string,
  enderecos: Iterable<EnderecoCnefe>,
): Promise<number> {
  await garantirTabelaEnderecos();
  const conn = await pool.connect();
  // Em lotes: um INSERT por endereço seriam centenas de milhares de idas ao
  // banco, e um INSERT único estouraria o limite de parâmetros do protocolo.
  const LOTE = 1000;
  let gravados = 0;

  const descarregar = async (fatia: EnderecoCnefe[]) => {
    if (fatia.length === 0) return;
    const valores: any[] = [];
    const marcadores = fatia.map((e, k) => {
      const b = k * 7;
      valores.push(municipioIbge, e.logradouroNorm, e.numero, e.cep, e.bairroNorm, String(e.lat), String(e.lon));
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    await conn.query(
      `INSERT INTO geo_endereco
         (municipio_ibge, logradouro_norm, numero, cep, bairro_norm, latitude, longitude)
       VALUES ${marcadores.join(",")}`,
      valores,
    );
    gravados += fatia.length;
  };

  try {
    await conn.query("BEGIN");
    await conn.query("DELETE FROM geo_endereco WHERE municipio_ibge = $1", [municipioIbge]);

    let fatia: EnderecoCnefe[] = [];
    for (const e of enderecos) {
      fatia.push(e);
      if (fatia.length >= LOTE) { await descarregar(fatia); fatia = []; }
    }
    await descarregar(fatia);

    await conn.query("COMMIT");
    return gravados;
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Nome normalizado e UF de um município pelo código IBGE, da lista oficial em
 * shared/data/cidades-brasil.json. Índice montado uma vez: são 5.570 linhas e
 * a carga pergunta por município, não por linha.
 */
let municipioPorIbge: Map<string, { cidadeNorm: string; uf: string }> | null = null;
function municipioDaListaIbge(codigo: string): { cidadeNorm: string; uf: string } | null {
  if (!municipioPorIbge) {
    municipioPorIbge = new Map();
    for (const c of citiesData as Array<{ nome: string; uf: string; ibge: string }>) {
      const cidadeNorm = normalizarLocalidade(c.nome);
      if (c.ibge && cidadeNorm) municipioPorIbge.set(c.ibge, { cidadeNorm, uf: c.uf });
    }
  }
  return municipioPorIbge.get(codigo) ?? null;
}

/**
 * Carrega o agregado da ANEEL de um arquivo. Um arquivo pode cobrir vários
 * municípios, então a carga é feita por município encontrado.
 */
export async function carregarAneel(
  caminho: string,
  esperado?: TotaisEsperadosAneel,
): Promise<ResultadoCarga[]> {
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
  return carregarAneelDoConteudo(readFileSync(caminho, "latin1"), esperado);
}

/**
 * Carrega a ANEEL a partir do conteúdo já em memória.
 *
 * Os totais esperados são conferidos antes de qualquer escrita: se um município
 * divergir, nenhum entra — carga parcial com um município certo e outro errado
 * é pior de diagnosticar do que carga nenhuma.
 *
 * O CSV não traz o nome da cidade, só o código IBGE. O nome sai do CNEFE já
 * carregado quando há, porque é a grafia que o resto do sistema usa como
 * chave; sem CNEFE, sai da lista oficial de municípios, que produz a mesma
 * chave normalizada. Só fica de fora o código que não existe em lugar nenhum,
 * porque aí é o CSV que está errado.
 */
export async function carregarAneelDoConteudo(
  conteudo: string,
  esperado?: TotaisEsperadosAneel,
): Promise<ResultadoCarga[]> {
  const porMunicipio = agregarAneel(conteudo);
  if (esperado && esperado.size > 0) {
    validarTotaisAneel(porMunicipio, esperado);
    for (const [mun, total] of Array.from(esperado.entries())) {
      logger.info({ municipio: mun, total, bairros: porMunicipio.get(mun)?.size ?? 0 }, "ANEEL: total confere com o recon");
    }
  }

  await garantirTabelasGeo();
  const resultados: ResultadoCarga[] = [];
  for (const [mun, porBairroBruto] of Array.from(porMunicipio.entries())) {
    // Bairro com zero UC é dado real, mas `gravar` não o escreve — e o número
    // devolvido (CLI, log "ANEEL carregada") tem de ser o que está na tabela,
    // não o que o CSV listou.
    const porBairro = new Map(Array.from(porBairroBruto.entries()).filter(([, n]) => n > 0));

    // Filtrado pela fonte: sem isso a linha devolvida podia ser a da própria
    // ANEEL de uma carga anterior (o DELETE só acontece dentro de `gravar`) e a
    // "prioridade do CNEFE" prometida acima não existia de fato. Se a grafia
    // das duas divergisse, `carregarTerritorio` chaveia por cidade_norm e
    // separava HPs e UCs do mesmo município em entradas diferentes.
    const { rows } = await pool.query<{ cidade_norm: string; uf: string }>(
      "SELECT cidade_norm, uf FROM geo_hps_bairro WHERE municipio_ibge = $1 AND fonte = $2 LIMIT 1",
      [mun, FONTE_CNEFE],
    );
    let cidadeNorm: string;
    let uf: string;
    if (rows.length > 0) {
      cidadeNorm = rows[0].cidade_norm;
      uf = rows[0].uf;
    } else {
      const m = municipioDaListaIbge(mun);
      if (!m) {
        logger.warn({ municipio: mun }, "ANEEL: código IBGE não existe na lista de municípios — ignorado");
        continue;
      }
      cidadeNorm = m.cidadeNorm;
      uf = m.uf || UF_POR_CODIGO[mun.slice(0, 2)] || "";
      logger.info({ municipio: mun, cidade: cidadeNorm }, "ANEEL: sem CNEFE, nome resolvido pela lista de municípios");
    }
    const r = await gravar(mun, cidadeNorm, uf, FONTE_ANEEL, porBairro);
    logger.info(r, "ANEEL carregada");
    resultados.push(r);
  }
  return resultados;
}

/* ── Leitura ────────────────────────────────────────────────────────────── */

export interface TerritorioDoMunicipio {
  /** bairroNorm → HPs do CNEFE */
  hps: Map<string, number>;
  /** bairroNorm → UCs vivas da ANEEL */
  ucs: Map<string, number>;
}

/**
 * Território das cidades pedidas, indexado por cidade normalizada.
 * Uma consulta só: a tela pede o território de todas as cidades da carteira de
 * uma vez, e uma ida ao banco por cidade seria N idas por render.
 */
export async function carregarTerritorio(
  cidadesNorm: string[],
): Promise<Map<string, TerritorioDoMunicipio>> {
  const mapa = new Map<string, TerritorioDoMunicipio>();
  if (cidadesNorm.length === 0) return mapa;

  let rows: Array<{ cidade_norm: string; bairro_norm: string; fonte: string; hps: number }>;
  try {
    ({ rows } = await pool.query(
      `SELECT cidade_norm, bairro_norm, fonte, hps
         FROM geo_hps_bairro
        WHERE cidade_norm = ANY($1::text[])`,
      [cidadesNorm],
    ));
  } catch (err: any) {
    // Tabela ainda não existe (nenhuma base carregada): o território fica vazio
    // e a tela mostra "sem bases públicas", que é a verdade.
    if (err?.code === "42P01") return mapa;
    throw err;
  }

  for (const r of rows) {
    let t = mapa.get(r.cidade_norm);
    if (!t) { t = { hps: new Map(), ucs: new Map() }; mapa.set(r.cidade_norm, t); }
    const destino = r.fonte === FONTE_ANEEL ? t.ucs : t.hps;
    destino.set(r.bairro_norm, Number(r.hps));
  }
  return mapa;
}

/**
 * Contorno real de cada municipio, a partir dos enderecos do CNEFE.
 *
 * POR QUE ISTO EXISTE. A deteccao de coordenada errada usava raio de 50 km em
 * volta da mediana da cidade. E uma regua grosseira: no norte do Parana as
 * cidades ficam a 30-45 km umas das outras, entao um cliente de Ibipora
 * geocodificado em Primeiro de Maio — 47 km — passava como coerente e o mapa o
 * plotava fora do municipio dele. Medido na carteira da NsLink em 28/08/2026:
 * quatro pontos assim, invisiveis para o raio e obvios para o olho.
 *
 * A caixa e conservadora de proposito. E o retangulo que envolve o municipio,
 * entao um ponto DENTRO dela pode ainda estar fora da divisa (canto do
 * retangulo) — isso passa, e tudo bem. Mas um ponto FORA da caixa esta
 * certamente fora do municipio. So acusa o que e certo.
 *
 * Cidade sem CNEFE carregado nao entra no mapa de retorno, e o chamador cai no
 * raio da mediana. Melhor a regua grosseira que regua nenhuma.
 */
export interface CaixaMunicipio {
  latMin: number; latMax: number; lonMin: number; lonMax: number;
}

/** Margem em graus (~1,1 km) para lacuna de cobertura na borda do CNEFE. */
export const MARGEM_CAIXA_GRAUS = 0.01;

export async function carregarCaixasMunicipio(
  cidadesNorm: string[],
): Promise<Map<string, CaixaMunicipio>> {
  const mapa = new Map<string, CaixaMunicipio>();
  if (cidadesNorm.length === 0) return mapa;

  // Nome normalizado -> codigo IBGE. `geo_endereco` e chaveado por IBGE; o
  // resto do sistema fala por nome.
  const porIbge = new Map<string, string>();
  const alvo = new Set(cidadesNorm);
  for (const c of citiesData as Array<{ nome: string; ibge: string }>) {
    const norm = normalizarLocalidade(c.nome);
    if (alvo.has(norm)) porIbge.set(c.ibge, norm);
  }
  if (porIbge.size === 0) return mapa;

  let rows: Array<{ municipio_ibge: string; la0: string; la1: string; lo0: string; lo1: string }>;
  try {
    ({ rows } = await pool.query(
      `SELECT municipio_ibge,
              MIN(latitude)  AS la0, MAX(latitude)  AS la1,
              MIN(longitude) AS lo0, MAX(longitude) AS lo1
         FROM geo_endereco
        WHERE municipio_ibge = ANY($1::text[])
        GROUP BY municipio_ibge`,
      [Array.from(porIbge.keys())],
    ));
  } catch (err: any) {
    // Base ainda nao carregada: sem caixa, o chamador usa o raio.
    if (err?.code === "42P01") return mapa;
    throw err;
  }

  for (const r of rows) {
    const nome = porIbge.get(r.municipio_ibge);
    if (!nome) continue;
    mapa.set(nome, {
      latMin: Number(r.la0) - MARGEM_CAIXA_GRAUS,
      latMax: Number(r.la1) + MARGEM_CAIXA_GRAUS,
      lonMin: Number(r.lo0) - MARGEM_CAIXA_GRAUS,
      lonMax: Number(r.lo1) + MARGEM_CAIXA_GRAUS,
    });
  }
  return mapa;
}

/**
 * Centro de cada bairro segundo o censo de endereços (CNEFE): a mediana da
 * latitude e da longitude de todos os endereços do bairro.
 *
 * É a âncora do mapa da rede (rede-regional.service.ts). Antes a bolha do
 * bairro ficava na mediana das coordenadas dos ex-clientes, e em Londrina os
 * 206 bairros caíram no mesmo quarteirão — as coordenadas vinham do sync
 * antigo, que caía no centro da cidade com ruído. O censo não tem esse
 * problema: é público, cobre o município inteiro e não é a casa de ninguém.
 *
 * Chave do mapa: cidade na régua de `normalizarLocalidade` ("LONDRINA"), que
 * é como `geo_hps_bairro.cidade_norm` liga o nome da cidade ao código IBGE.
 * Cache em memória por 6h: o censo não muda entre duas requisições.
 */
export interface CentroideBairro {
  /** Bairro na régua do CNEFE: "UNIAO DA VITORIA". */
  bairroNorm: string;
  lat: number;
  lon: number;
  /** Quantos endereços do censo sustentam o centro. */
  enderecos: number;
}
export type CentroidesPorCidade = Map<string, CentroideBairro[]>;

const CENTROIDES_TTL_MS = 6 * 60 * 60 * 1000;
const centroidesCache = new Map<string, { em: number; lista: CentroideBairro[] }>();

/** Só para os testes: esvazia o cache. */
export function _limparCacheDeCentroidesParaTestes(): void {
  centroidesCache.clear();
}

export async function carregarCentroidesDeBairro(cidadesNorm: string[]): Promise<CentroidesPorCidade> {
  const mapa: CentroidesPorCidade = new Map();
  const agora = Date.now();
  const faltam: string[] = [];
  for (const c of Array.from(new Set(cidadesNorm.filter(Boolean)))) {
    const hit = centroidesCache.get(c);
    if (hit && agora - hit.em < CENTROIDES_TTL_MS) mapa.set(c, hit.lista);
    else faltam.push(c);
  }
  if (faltam.length === 0) return mapa;

  let rows: Array<{ cidade_norm: string; bairro_norm: string; n: string; lat: string; lon: string }>;
  try {
    ({ rows } = await pool.query(
      `WITH municipios AS (
         SELECT DISTINCT cidade_norm, municipio_ibge
           FROM geo_hps_bairro
          WHERE cidade_norm = ANY($1::text[])
       )
       SELECT m.cidade_norm, e.bairro_norm, count(*) AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY e.latitude::float)  AS lat,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY e.longitude::float) AS lon
         FROM municipios m
         JOIN geo_endereco e ON e.municipio_ibge = m.municipio_ibge
        WHERE e.bairro_norm IS NOT NULL AND e.bairro_norm <> ''
        GROUP BY m.cidade_norm, e.bairro_norm`,
      [faltam],
    ));
  } catch (err: any) {
    // Bases públicas ainda não carregadas: o mapa da rede cai na carteira, e a
    // tela diz de onde veio a âncora.
    if (err?.code === "42P01") return mapa;
    throw err;
  }

  const porCidade = new Map<string, CentroideBairro[]>();
  for (const r of rows) {
    const lat = Number(r.lat), lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let lista = porCidade.get(r.cidade_norm);
    if (!lista) { lista = []; porCidade.set(r.cidade_norm, lista); }
    lista.push({ bairroNorm: r.bairro_norm, lat, lon, enderecos: Number(r.n) });
  }
  for (const c of faltam) {
    const lista = porCidade.get(c) ?? [];
    centroidesCache.set(c, { em: agora, lista });
    mapa.set(c, lista);
  }
  return mapa;
}
