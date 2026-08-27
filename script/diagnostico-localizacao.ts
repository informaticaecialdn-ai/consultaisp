/**
 * Diagnóstico da Localização — roda no servidor e diz o que está errado.
 *
 *   npx tsx script/diagnostico-localizacao.ts
 *
 * Não altera nada. Existe porque "não plotou" tem meia dúzia de causas
 * diferentes — base pública ausente, geocoder de rede bloqueado, endereço que
 * não casa, coordenada empilhada — e olhar a tela não distingue uma da outra.
 * Cada bloco abaixo termina num veredito, não num despejo de números.
 */
import "dotenv/config";
import { pool } from "../server/db";
import { abrirGeocodificadorLocal } from "../server/services/geocode-local.service";
import { chaveLogradouro } from "../server/services/logradouro";

const OK = "  [ok] ";
const AVISO = "  [!]  ";
const ERRO = "  [X]  ";
const n = (v: any) => Number(v ?? 0).toLocaleString("pt-BR");

function titulo(s: string) {
  console.log(`\n${s}\n${"─".repeat(s.length)}`);
}

async function bases() {
  titulo("1. Bases públicas");
  try {
    const { rows } = await pool.query(
      `SELECT cidade_norm, uf, municipio_ibge, fonte, count(*)::int bairros, sum(hps)::int total
         FROM geo_hps_bairro GROUP BY 1,2,3,4 ORDER BY 1,4`);
    if (rows.length === 0) {
      console.log(ERRO + "Nenhuma base carregada — o funil do Raio-X fica em '—' e o geocodificador local não funciona.");
      console.log("       Rode: npx tsx script/ingest-geo.ts cnefe <Cidade>");
      return [];
    }
    for (const r of rows) {
      console.log(`${OK}${r.cidade_norm}/${r.uf} · ${r.fonte === "CNEFE2022" ? "IBGE" : "ANEEL"} · ${n(r.total)} em ${r.bairros} bairros`);
    }
    const { rows: end } = await pool.query(
      `SELECT municipio_ibge, count(*)::int total FROM geo_endereco GROUP BY 1`);
    if (end.length === 0) {
      console.log(ERRO + "Tabela de ENDEREÇOS vazia — o geocodificador local não resolve nada.");
      console.log("       Recarregue o CNEFE: é ele que popula geo_endereco.");
    } else {
      for (const e of end) console.log(`${OK}${e.municipio_ibge}: ${n(e.total)} endereços com coordenada`);
    }
    return rows;
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.log(ERRO + "Tabelas de geo não existem. Rode a carga do CNEFE — a DDL nasce com ela.");
      return [];
    }
    throw err;
  }
}

async function coordenadas() {
  titulo("2. Coordenadas da carteira");
  const { rows: [c] } = await pool.query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL
                             OR (latitude = 0 AND longitude = 0))::int sem,
            count(*) FILTER (WHERE nullif(btrim(coalesce(city,'')),'') IS NULL
                             AND nullif(btrim(coalesce(cep,'')),'') IS NULL)::int sem_endereco
       FROM customers`);
  console.log(`  carteira: ${n(c.total)} clientes · ${n(c.sem)} sem coordenada`);
  if (c.sem === 0) console.log(OK + "Todo mundo plotado.");
  else if (c.sem === c.sem_endereco) console.log(AVISO + `Os ${n(c.sem)} sem coordenada também não têm cidade nem CEP — só o ERP resolve.`);
  else console.log(ERRO + `${n(c.sem - c.sem_endereco)} clientes TÊM endereço e mesmo assim não foram plotados.`);

  // Pilha suspeita é decidida com a MESMA régua do geocodificador: o SQL
  // compararia texto cru e faria "Av. Tiradentes" e "Avenida Tiradentes"
  // parecerem duas ruas, transformando uma avenida em defeito.
  const { rows: agrupados } = await pool.query<{ grupo: string; address: string | null; n: number }>(
    `SELECT c.latitude::text || '|' || c.longitude::text || '|' || c.provider_id AS grupo,
            c.address, count(*)::int n
       FROM customers c
       JOIN (SELECT latitude, longitude, provider_id
               FROM customers
              WHERE latitude IS NOT NULL AND NOT (latitude = 0 AND longitude = 0)
              GROUP BY 1,2,3 HAVING count(*) >= 12) p
         ON p.latitude = c.latitude AND p.longitude = c.longitude AND p.provider_id = c.provider_id
      GROUP BY 1,2`);

  const porGrupo = new Map<string, { ruas: Set<string>; total: number }>();
  for (const r of agrupados) {
    const g = porGrupo.get(r.grupo) ?? { ruas: new Set<string>(), total: 0 };
    const rua = chaveLogradouro(r.address);
    if (rua) g.ruas.add(rua);
    g.total += r.n;
    porGrupo.set(r.grupo, g);
  }
  const suspeitas = Array.from(porGrupo.values())
    .filter(g => g.ruas.size > 1 || g.ruas.size === 0)
    .sort((a, b) => b.total - a.total);
  const legitimos = porGrupo.size - suspeitas.length;

  if (suspeitas.length === 0) {
    console.log(OK + "Nenhuma pilha de coordenada repetida.");
  } else {
    const soma = suspeitas.slice(0, 5).reduce((s, g) => s + g.total, 0);
    console.log(ERRO + `${suspeitas.length} pilha(s) com logradouros DIFERENTES no mesmo ponto — a maior com ${n(suspeitas[0].total)} clientes (${n(soma)} nas 5 maiores).`);
    console.log("       É a 'bola' no mapa. O botão Plotar agora desempilha.");
  }
  if (legitimos > 0) {
    console.log(OK + `${n(legitimos)} ponto(s) com 12+ clientes no MESMO logradouro — prédio ou mesma rua, não defeito.`);
  }
  return c;
}

async function geocodificadorLocal() {
  titulo("3. Geocodificador local (IBGE)");
  const { rows: cidades } = await pool.query(
    `SELECT DISTINCT city FROM customers
      WHERE nullif(btrim(coalesce(city,'')),'') IS NOT NULL`);
  const geo = await abrirGeocodificadorLocal(cidades.map(c => ({ cidade: c.city })));
  if (!geo) {
    console.log(ERRO + "Não abriu — nenhuma cidade da carteira tem base do IBGE carregada.");
    console.log("       Cidades da carteira: " + cidades.map(c => c.city).join(", "));
    return;
  }
  console.log(`${OK}Aberto para ${geo.municipios} município(s).`);

  const { rows: pendentes } = await pool.query(
    `SELECT id, address, address_number AS "addressNumber", neighborhood, city
       FROM customers
      WHERE (latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0))
        AND (nullif(btrim(coalesce(city,'')),'') IS NOT NULL
             OR nullif(btrim(coalesce(cep,'')),'') IS NOT NULL)`);
  if (pendentes.length === 0) {
    console.log(OK + "Nenhum cliente pendente para testar.");
    return;
  }

  const contagem: Record<string, number> = { endereco: 0, logradouro: 0, bairro: 0, cidade: 0, nada: 0 };
  const semCobertura = new Map<string, number>();
  for (const p of pendentes) {
    const a = geo.resolver(p);
    if (a) contagem[a.precisao]++;
    else {
      contagem.nada++;
      const c = (p.city || "(sem cidade)").trim();
      semCobertura.set(c, (semCobertura.get(c) ?? 0) + 1);
    }
  }
  const resolve = pendentes.length - contagem.nada;
  console.log(`  ${n(pendentes.length)} pendentes · a base local resolve ${n(resolve)} (${((resolve / pendentes.length) * 100).toFixed(1)}%)`);
  console.log(`    endereço exato ${n(contagem.endereco)} · rua ${n(contagem.logradouro)} · bairro ${n(contagem.bairro)} · cidade ${n(contagem.cidade)}`);
  if (contagem.nada > 0) {
    console.log(AVISO + `${n(contagem.nada)} sem cobertura local, por cidade:`);
    for (const [c, q] of Array.from(semCobertura.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`         ${c}: ${n(q)}  →  npx tsx script/ingest-geo.ts cnefe "${c}"`);
    }
  } else {
    console.log(OK + "A base local cobre TODOS os pendentes — o botão Plotar agora zera a fila sem tocar na rede.");
  }
}

async function rede() {
  titulo("4. Geocoder de rede (só o resíduo depende dele)");
  const chave = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
  console.log(`  GOOGLE_MAPS_API_KEY: ${chave.length > 10 ? `presente (${chave.length} chars)` : "ausente"}`);
  if (chave.length > 10) {
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=Londrina,PR,Brasil&components=country:BR&key=${chave}`,
        { signal: AbortSignal.timeout(15000) });
      const j: any = await r.json();
      if (j.status === "OK") console.log(OK + "Google responde.");
      else console.log(ERRO + `Google recusou: ${j.status}${j.error_message ? ` — ${j.error_message}` : ""}`);
    } catch (e: any) {
      console.log(ERRO + `Google inacessível: ${e?.name || e?.message}`);
    }
  }
  try {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/search?q=Londrina%2C+PR%2C+Brasil&format=json&limit=1&countrycodes=br",
      { headers: { "User-Agent": "ConsultaISP/1.0 heatmap@consultaisp.com.br" }, signal: AbortSignal.timeout(15000) });
    if (r.ok && ((await r.json()) as any[]).length > 0) console.log(OK + "Nominatim responde.");
    else console.log(AVISO + `Nominatim respondeu HTTP ${r.status} sem resultado.`);
  } catch (e: any) {
    console.log(AVISO + `Nominatim inacessível: ${e?.name || e?.message} — sem problema se a base local cobrir tudo.`);
  }
}

async function main() {
  console.log("DIAGNÓSTICO DA LOCALIZAÇÃO — somente leitura");
  await bases();
  await coordenadas();
  await geocodificadorLocal();
  await rede();
  console.log("\nFim. Cole esta saída inteira.\n");
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
