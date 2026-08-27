/**
 * Carga das bases geográficas públicas.
 *
 *   npx tsx script/ingest-geo.ts cnefe Londrina            # baixa do IBGE
 *   npx tsx script/ingest-geo.ts cnefe "Bom Jesus - PR"    # UF desempata homonimas
 *   npx tsx script/ingest-geo.ts cnefe 4113700             # ou o codigo IBGE
 *   npx tsx script/ingest-geo.ts cnefe ./4113700_LONDRINA.csv  # arquivo ja baixado
 *   npx tsx script/ingest-geo.ts aneel .data/aneel/ucbt_por_bairro.csv
 *   npx tsx script/ingest-geo.ts status
 *
 * A ordem importa: o CNEFE primeiro, porque é dele que sai o nome da cidade —
 * o CSV da ANEEL só traz o código IBGE do município.
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
import { baixarCnefe } from "../server/services/cnefe-download.service";

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
  const [comando, caminho] = process.argv.slice(2);

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
    if (!caminho) throw new Error("Informe o caminho do CSV da ANEEL");
    const rs = await carregarAneel(caminho);
    if (rs.length === 0) {
      console.log("Nenhum município aproveitado — carregue o CNEFE do município antes.");
    }
    for (const r of rs) {
      console.log(`ANEEL BDGD · ${r.cidade}/${r.uf} (${r.municipio}): ${r.total.toLocaleString("pt-BR")} UCs vivas em ${r.bairros} bairros`);
    }
  } else {
    console.log("Comandos: cnefe <arquivo> · aneel <arquivo> · status");
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
