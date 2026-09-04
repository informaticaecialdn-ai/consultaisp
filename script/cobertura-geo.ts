/**
 * A base de enderecos do IBGE para TODA cidade que o provedor atende.
 *
 *   npx tsx script/cobertura-geo.ts 6            # mede: o que falta
 *   npx tsx script/cobertura-geo.ts 6 --carregar # baixa e carrega o que falta
 *   npx tsx script/cobertura-geo.ts --todos --carregar
 *
 * POR QUE ISTO EXISTE. Ate 04/09/2026 a cobertura era escolhida a mao, cidade
 * por cidade, por quem tinha acesso ao servidor. O resultado apareceu na
 * Amplinet: a base carregada cobria 9 municipios, TODOS do Parana — a regiao do
 * outro provedor —, e 202 clientes ficavam fora do mapa com a tela dizendo
 * "carteira sem geocodificacao", que o dono leu como "o sistema nao plota".
 *
 * A cidade de atendimento nao e uma escolha: ela esta escrita na carteira. Este
 * script pergunta ao banco quais sao, e nao a quem estiver rodando.
 *
 * O NOME DA CIDADE E LIVRE no cadastro do ERP. "EMBU-GUACU", "EMBU GUACU" e
 * "EMBUGUACU" sao a mesma cidade e viram uma linha so aqui, pela mesma
 * `normalizarCidade` que o geocodificador usa. O que nao casa com nenhum
 * municipio do IBGE e listado a parte: e erro de digitacao no ERP, e nenhuma
 * normalizacao conserta ("EMBU GAUCU", "SAO PAUYLO").
 */
import "dotenv/config";
import { preferirIPv4NaSaida } from "../server/rede-saida";
preferirIPv4NaSaida();

import { pool } from "../server/db";
import { normalizarCidade } from "../server/services/area-atendida";
import { baixarCnefe } from "../server/services/cnefe-download.service";
import { carregarCnefeDoConteudo, FONTE_CNEFE } from "../server/services/geo-bases.service";
import citiesData from "../shared/data/cidades-brasil.json";

interface Municipio { nome: string; uf: string; ibge: string }

/**
 * Limpa o que o cadastro do ERP acrescenta ao nome da cidade.
 *
 * Casos reais medidos na carteira da Amplinet em 04/09/2026:
 *   "EMBU-GUACU,"              virgula no fim
 *   "ITAPECERICA DA SERRA SP"  UF grudada, sem separador
 *   "STRING:SAO PAULO"         prefixo de alguma integracao mal feita
 */
function limparNomeDeCidade(bruto: string): string {
  return bruto
    .replace(/^\s*[A-Za-z_]+\s*:\s*/, "")            // "STRING:" e parentes
    .replace(/[,.;/\\]+\s*$/, "")                    // pontuacao no fim
    .replace(/\s+[-–]?\s*[A-Za-z]{2}\s*$/, "")       // " SP", " - SP"
    .trim();
}

/**
 * Cidade da carteira → municipio do IBGE.
 *
 * TRES tentativas, cada uma exigindo resultado UNICO **e** UF batendo. A UF nao
 * e opcional: "ITAPECERICA" e nome unico no pais (Minas Gerais), e sem conferir
 * a UF o resolvedor casou dois clientes de Itapecerica DA SERRA/SP com a cidade
 * mineira — a base foi carregada e teria plotado os dois a 500 km. Foi medido em
 * 04/09/2026 e desfeito na mesma hora.
 *
 * A UF vem da MAIORIA dos clientes daquela grafia, e nao de uma linha: na mesma
 * carteira, "ITAPECERICA DA SERRA" aparece com SP em 207 cadastros e com RN, SE
 * e SC em quatro. Uma linha ruim nao pode decidir por 207.
 */
function resolver(cidadeNorm: string, uf: string | null): Municipio | null {
  const lista = citiesData as Municipio[];
  if (!cidadeNorm || cidadeNorm.length < 3) return null;   // "SP" nao e cidade

  const unico = (achados: Municipio[]): Municipio | null => {
    const naUf = uf ? achados.filter(c => c.uf === uf) : achados;
    return naUf.length === 1 ? naUf[0] : null;
  };

  // 1) Nome igual, ja normalizado (hifen e acento fora).
  const exato = unico(lista.filter(c => normalizarCidade(c.nome) === cidadeNorm));
  if (exato) return exato;

  // 2) Sem espaco nenhum: "EMBUGUACU" e "Embu-Guacu" sao a mesma cidade
  //    digitada sem a barra de espaco. 23 cadastros da Amplinet estavam assim.
  const semEspaco = cidadeNorm.replace(/ /g, "");
  const colado = unico(lista.filter(c => normalizarCidade(c.nome).replace(/ /g, "") === semEspaco));
  if (colado) return colado;

  // 3) Prefixo unico DENTRO DA UF: "ITAPECERICA" com UF SP so pode ser
  //    Itapecerica da Serra. Sem a UF esta regra seria perigosa — e por isso ela
  //    nao roda sem UF.
  if (uf) {
    const prefixo = unico(lista.filter(c => normalizarCidade(c.nome).startsWith(`${cidadeNorm} `)));
    if (prefixo) return prefixo;
  }

  // Erro de digitacao ("EMBU GAUCU", "SAO PAUYLO") e bairro no campo de cidade
  // ("PARQUE JANDAIA") param aqui, de proposito: adivinhar cidade por semelhanca
  // e como se planta um ponto no lugar errado sem ninguem desconfiar.
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const carregar = args.includes("--carregar");
  const todos = args.includes("--todos");
  const providerId = Number(args.find(a => /^\d+$/.test(a)) ?? 0);
  if (!todos && !providerId) {
    console.error("uso: npx tsx script/cobertura-geo.ts <providerId> [--carregar]  |  --todos [--carregar]");
    process.exit(1);
  }

  const { rows } = await pool.query(
    `select coalesce(city,'') as cidade, coalesce(state,'') as uf,
            count(*)::int as clientes,
            count(*) filter (where latitude is null)::int as sem_coord
       from customers
      where ${todos ? "true" : "provider_id = $1"}
        and coalesce(city,'') <> ''
      group by 1,2`,
    todos ? [] : [providerId],
  );

  // As grafias colapsam pela mesma regra do geocodificador, depois de limpo o
  // que o ERP acrescenta ao nome.
  const porCidade = new Map<string, {
    clientes: number; semCoord: number; grafias: Set<string>; ufs: Map<string, number>;
  }>();
  for (const l of rows) {
    const chave = normalizarCidade(limparNomeDeCidade(l.cidade));
    if (!chave) continue;
    const at = porCidade.get(chave) ?? { clientes: 0, semCoord: 0, grafias: new Set<string>(), ufs: new Map<string, number>() };
    at.clientes += l.clientes;
    at.semCoord += l.sem_coord;
    at.grafias.add(l.cidade);
    if (l.uf) at.ufs.set(l.uf, (at.ufs.get(l.uf) ?? 0) + l.clientes);
    porCidade.set(chave, at);
  }

  /** A UF da MAIORIA dos cadastros. Uma linha ruim nao decide por 207. */
  const ufDominante = (ufs: Map<string, number>): string | null => {
    let melhor: string | null = null, max = 0;
    for (const [uf, n] of ufs) if (n > max) { max = n; melhor = uf; }
    return melhor;
  };

  const { rows: carregadas } = await pool.query(
    `select distinct municipio_ibge from geo_hps_bairro where fonte = $1`, [FONTE_CNEFE]);
  const jaTem = new Set(carregadas.map((l: any) => l.municipio_ibge));

  const faltando: Array<{ chave: string; m: Municipio; clientes: number; semCoord: number }> = [];
  const semMunicipio: Array<{ chave: string; clientes: number; grafias: string[] }> = [];

  for (const [chave, d] of [...porCidade.entries()].sort((a, b) => b[1].semCoord - a[1].semCoord)) {
    const m = resolver(chave, ufDominante(d.ufs));
    if (!m) { semMunicipio.push({ chave, clientes: d.clientes, grafias: [...d.grafias] }); continue; }
    if (jaTem.has(m.ibge)) continue;
    faltando.push({ chave, m, clientes: d.clientes, semCoord: d.semCoord });
  }

  console.log(`\nCidades na carteira: ${porCidade.size}  ·  ja com base: ${porCidade.size - faltando.length - semMunicipio.length}`);

  if (faltando.length === 0) console.log("\nNenhuma cidade sem base. Nada a carregar.");
  else {
    console.log(`\nSEM BASE DE ENDERECOS (${faltando.length}):`);
    for (const f of faltando) {
      console.log(`  ${f.m.nome}/${f.m.uf} (${f.m.ibge}) — ${f.clientes} clientes, ${f.semCoord} sem coordenada`);
    }
  }

  if (semMunicipio.length) {
    console.log(`\nNAO CASAM COM MUNICIPIO NENHUM (${semMunicipio.length}) — erro de digitacao no ERP:`);
    for (const s of semMunicipio) {
      console.log(`  ${s.grafias.join(" / ")} — ${s.clientes} cliente(s)`);
    }
    console.log("  Nenhuma normalizacao conserta isso: o provedor precisa corrigir no ERP.");
  }

  if (!carregar || faltando.length === 0) {
    if (faltando.length) console.log("\nSo medicao. Para baixar e carregar: --carregar");
    await pool.end();
    return;
  }

  console.log("");
  for (const f of faltando) {
    const rotulo = `${f.m.nome}/${f.m.uf}`;
    try {
      // Uma por vez, de proposito: sao dezenas de MB cada e o FTP do IBGE nao
      // agradece paralelismo.
      const { municipio, csv } = await baixarCnefe(f.m.ibge);
      const r = await carregarCnefeDoConteudo(csv, municipio.nome);
      console.log(`  [ok]    ${rotulo}: ${r.total.toLocaleString("pt-BR")} domicilios · ${(r.enderecos ?? 0).toLocaleString("pt-BR")} enderecos com coordenada`);
    } catch (e: any) {
      // Uma cidade que falha nao pode levar as outras junto: o motivo mais comum
      // e o FTP do IBGE recusando, e a proxima passada resolve.
      console.log(`  [falha] ${rotulo}: ${e.message}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error("erro:", e.message); process.exit(1); });
