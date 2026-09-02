/**
 * Carga das bases geográficas públicas.
 *
 *   npx tsx script/ingest-geo.ts cnefe Londrina            # baixa do IBGE
 *   npx tsx script/ingest-geo.ts cnefe "Bom Jesus - PR"    # UF desempata homonimas
 *   npx tsx script/ingest-geo.ts cnefe 4113700             # ou o codigo IBGE
 *   npx tsx script/ingest-geo.ts cnefe ./4113700_LONDRINA.csv  # arquivo ja baixado
 *   npx tsx script/ingest-geo.ts aneel .data/aneel/ucbt_por_bairro.csv \
 *       --esperado 4113700=224729,4109807=20910
 *   npx tsx script/ingest-geo.ts status
 *
 * A ordem entre CNEFE e ANEEL não importa: a ANEEL só traz o código IBGE, e o
 * nome da cidade sai do CNEFE quando já está carregado ou, sem ele, da lista
 * oficial de municípios (shared/data/cidades-brasil.json) — as duas produzem a
 * mesma chave. A penetração, porém, precisa das duas bases.
 *
 * `--esperado` é o total de UCs vivas por município conferido no recon do
 * BDGD (Copel 2024: Londrina 224.729, Ibiporã 20.910). A soma do CSV é
 * conferida ANTES de gravar; qualquer município que divergir aborta a carga
 * inteira, porque CSV truncado ou agregado com filtro errado tem o mesmo
 * formato do certo e só a soma denuncia.
 *
 * As tabelas nascem na primeira carga (DDL idempotente em
 * server/services/geo-bases.service.ts). Rodar de novo o mesmo arquivo
 * substitui o que estava lá; não soma em cima.
 *
 * De onde vêm os arquivos:
 *   CNEFE 2022 — https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/
 *                (um .zip por UF; dentro, um CSV por município)
 *   ANEEL BDGD — https://dadosabertos.aneel.gov.br/ (BDGD, camada UCBT, filtrar
 *                classe residencial e situação ativa, agregar por bairro)
 */
import "dotenv/config";
import { pool } from "../server/db";
import { carregarCnefe, carregarCnefeDoConteudo, carregarAneel, garantirTabelasGeo, FONTE_CNEFE, FONTE_ANEEL } from "../server/services/geo-bases.service";
import type { TotaisEsperadosAneel } from "../server/services/geo-bases.service";
import { baixarCnefe } from "../server/services/cnefe-download.service";

/**
 * `--esperado 4113700=224729,4109807=20910` → Map(código IBGE → total).
 * Formato rígido de propósito: um dígito trocado no código faria a validação
 * conferir um município que não está no CSV e abortar por um motivo errado.
 */
function parseEsperado(spec: string): TotaisEsperadosAneel {
  const mapa: TotaisEsperadosAneel = new Map();
  for (const par of spec.split(",").map(p => p.trim()).filter(Boolean)) {
    const m = /^(\d{7})=(\d+)$/.exec(par);
    if (!m) throw new Error(`--esperado inválido em "${par}": use <código IBGE de 7 dígitos>=<total>, separados por vírgula`);
    mapa.set(m[1], parseInt(m[2], 10));
  }
  if (mapa.size === 0) throw new Error("--esperado sem nenhum município");
  return mapa;
}

/** Únicas opções que existem. Qualquer outra é erro, não silêncio. */
const OPCOES_CONHECIDAS = new Set(["esperado"]);

/**
 * Separa as opções `--x valor` / `--x=valor` dos argumentos posicionais.
 *
 * Flag desconhecida (um `--experado`) e flag sem valor derrubam o script: se
 * passassem, a conferência de totais viraria opcional por acidente de digitação
 * — e ninguém descobriria até a penetração aparecer errada na tela.
 */
function parseArgs(argv: string[]): { posicionais: string[]; opcoes: Map<string, string> } {
  const posicionais: string[] = [];
  const opcoes = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const igual = a.indexOf("=");
      const nome = igual > 0 ? a.slice(2, igual) : a.slice(2);
      if (!OPCOES_CONHECIDAS.has(nome)) throw new Error(`argumento desconhecido: ${a}`);
      const valor = igual > 0 ? a.slice(igual + 1) : argv[++i];
      if (valor === undefined || valor === "" || valor.startsWith("--")) {
        throw new Error(`--${nome} sem valor`);
      }
      opcoes.set(nome, valor);
    } else {
      posicionais.push(a);
    }
  }
  return { posicionais, opcoes };
}

async function status() {
  await garantirTabelasGeo();
  const { rows } = await pool.query(
    `SELECT cidade_norm, uf, municipio_ibge, fonte,
            count(*)::int AS bairros, sum(hps)::int AS total,
            max(atualizado_em) AS quando
       FROM geo_hps_bairro
      GROUP BY 1,2,3,4
      ORDER BY cidade_norm, fonte`,
  );
  if (rows.length === 0) {
    console.log("Nenhuma base carregada. A tela mostra “sem bases públicas”, que é a verdade.");
    return;
  }
  console.table(rows.map(r => ({
    cidade: r.cidade_norm,
    uf: r.uf,
    ibge: r.municipio_ibge,
    fonte: r.fonte === FONTE_CNEFE ? "IBGE CNEFE 2022" : r.fonte === FONTE_ANEEL ? "ANEEL BDGD" : r.fonte,
    bairros: r.bairros,
    total: Number(r.total).toLocaleString("pt-BR"),
    carregado: r.quando ? new Date(r.quando).toLocaleString("pt-BR") : "",
  })));
}

async function main() {
  const { posicionais, opcoes } = parseArgs(process.argv.slice(2));
  const [comando, caminho] = posicionais;

  if (!comando || comando === "status") {
    await status();
  } else if (comando === "cnefe") {
    if (!caminho) throw new Error("Informe a cidade (ou o caminho de um CSV já baixado)");

    // Caminho de arquivo ou nome de cidade — o segundo é o caso normal, e evita
    // o operador ter de achar e mover um arquivo de 47MB.
    const pareceArquivo = /[\\/]/.test(caminho) || /\.csv$/i.test(caminho);
    let r;
    if (pareceArquivo) {
      r = await carregarCnefe(caminho);
    } else {
      const { municipio, csv } = await baixarCnefe(caminho);
      r = await carregarCnefeDoConteudo(csv, municipio.nome);
    }

    console.log(`IBGE CNEFE · ${r.cidade}/${r.uf} (${r.municipio}): ${r.total.toLocaleString("pt-BR")} domicílios em ${r.bairros} bairros` +
      (r.enderecos ? ` · ${r.enderecos.toLocaleString("pt-BR")} endereços com coordenada` : ""));
  } else if (comando === "aneel") {
    // ANEEL BDGD — `mun;bairro;uc_re_ativas`, um arquivo pode cobrir vários
    // municípios. A soma por município é conferida antes de gravar e a carga
    // inteira aborta se qualquer uma divergir. `--esperado` é obrigatório: a
    // conferência é a única coisa que separa o CSV certo do truncado, então
    // não pode ser opt-in.
    if (!caminho) throw new Error("Informe o caminho do CSV da ANEEL");
    const esperadoSpec = opcoes.get("esperado");
    if (!esperadoSpec) {
      throw new Error("Informe --esperado <ibge>=<total>,... com os totais do recon do BDGD (ex.: --esperado 4113700=224729,4109807=20910) — sem eles um CSV truncado entraria sem reclamar");
    }
    const esperado = parseEsperado(esperadoSpec);
    const rs = await carregarAneel(caminho, esperado);
    if (rs.length === 0) {
      console.log("Nenhum município aproveitado — nenhum código IBGE do CSV existe na lista de municípios.");
    }
    for (const r of rs) {
      console.log(`ANEEL BDGD · ${r.cidade}/${r.uf} (${r.municipio}): ${r.total.toLocaleString("pt-BR")} UCs vivas em ${r.bairros} bairros`);
    }
  } else {
    console.log("Comandos: cnefe <arquivo> · aneel <arquivo> --esperado <ibge>=<total>,... · status");
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
