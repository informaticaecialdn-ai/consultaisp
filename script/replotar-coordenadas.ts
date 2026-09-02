/**
 * Replotar as coordenadas de um provedor — desfaz o que o sync antigo gravou.
 *
 *   npx tsx script/replotar-coordenadas.ts <providerId>            # só mede
 *   npx tsx script/replotar-coordenadas.ts <providerId> --apagar   # apaga os errados e replota
 *   npx tsx script/replotar-coordenadas.ts <providerId> --apagar-tudo
 *
 * Até 02/09/2026 o sync geocodificava o inadimplente pelo CEP antes da rua,
 * sem o número, aceitando a precisão que viesse, com queda para o centro da
 * cidade — e regravava isso a cada passada por cima do ponto exato que a
 * plotagem do IBGE tinha resolvido. O código parou de fazer isso; este script
 * conserta o que ficou gravado.
 *
 * `--apagar` é cirúrgico: só perde a coordenada quem o IBGE conhece pela casa
 * ou pela rua e está a mais de 500 m dela, mais quem divide o mesmo ponto com
 * clientes de ruas diferentes (a "pilha"). `--apagar-tudo` zera o provedor
 * inteiro — para quem tem coordenada no ERP (MK) é seguro, porque a fase A da
 * plotagem a traz de volta na hora; para quem não tem, o mapa fica vazio até
 * a plotagem terminar.
 *
 * Nos dois casos a plotagem roda em seguida para o provedor, com as regras
 * novas: ERP → base do IBGE → rede com precisão de rua. Nada de cidade.
 */
import "dotenv/config";
import { pool } from "../server/db";
import { abrirGeocodificadorLocal } from "../server/services/geocode-local.service";
import { runGeocodeBackfill } from "../server/services/geocode-backfill.service";
import { chaveLogradouro } from "../server/services/logradouro";
import { distanciaKm } from "../server/services/coordenada-suspeita";

const LONGE_M = 500;
const PILHA = 12;

async function main() {
  const providerId = Number(process.argv[2]);
  const apagar = process.argv.includes("--apagar");
  const apagarTudo = process.argv.includes("--apagar-tudo");
  if (!Number.isInteger(providerId) || providerId <= 0) {
    console.error("uso: npx tsx script/replotar-coordenadas.ts <providerId> [--apagar | --apagar-tudo]");
    process.exit(1);
  }

  const { rows } = await pool.query<{
    id: number; address: string | null; address_number: string | null; neighborhood: string | null;
    city: string | null; lat: string; lon: string; geo_precisao: string | null;
  }>(
    `SELECT id, address, address_number, neighborhood, city, latitude::text lat, longitude::text lon, geo_precisao
       FROM customers
      WHERE provider_id = $1
        AND latitude IS NOT NULL AND longitude IS NOT NULL AND NOT (latitude = 0 AND longitude = 0)`,
    [providerId],
  );
  console.log(`provedor ${providerId}: ${rows.length} clientes com coordenada`);
  const porProcedencia = new Map<string, number>();
  for (const r of rows) porProcedencia.set(r.geo_precisao ?? "(sem procedência)", (porProcedencia.get(r.geo_precisao ?? "(sem procedência)") ?? 0) + 1);
  console.log("  por procedência: " + Array.from(porProcedencia.entries()).map(([k, v]) => `${k} ${v}`).join(" · "));

  // 1. Longe do endereço que o IBGE conhece. A coordenada do ERP fica de fora
  // do apagamento: o sync a regrava a cada passada, e apagar seria em vão —
  // ela é contada à parte, para o dono saber que o ERP contradiz o censo.
  const geo = await abrirGeocodificadorLocal(
    Array.from(new Set(rows.map(r => r.city || "").filter(Boolean))).map(cidade => ({ cidade })),
  );
  const longe = new Set<number>();
  let comparaveis = 0;
  let erpContradiz = 0;
  if (geo) {
    for (const r of rows) {
      const a = geo.resolver({ id: r.id, address: r.address, addressNumber: r.address_number, neighborhood: r.neighborhood, city: r.city });
      if (!a || (a.precisao !== "endereco" && a.precisao !== "logradouro")) continue;
      comparaveis++;
      if (distanciaKm(Number(r.lat), Number(r.lon), a.lat, a.lon) * 1000 > LONGE_M) {
        if (r.geo_precisao === "erp") erpContradiz++;
        else longe.add(r.id);
      }
    }
    console.log(`  comparáveis com o IBGE: ${comparaveis} · a mais de ${LONGE_M} m do endereço: ${longe.size} (+ ${erpContradiz} do ERP, que não se apaga)`);
  } else {
    console.log("  sem base do IBGE para as cidades deste provedor — a medição por endereço não é possível");
  }

  // 2. Pilhas: o mesmo ponto para ruas diferentes.
  const porPonto = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.lat}|${r.lon}`;
    const g = porPonto.get(k); if (g) g.push(r); else porPonto.set(k, [r]);
  }
  const empilhados = new Set<number>();
  for (const grupo of porPonto.values()) {
    if (grupo.length < PILHA) continue;
    const ruas = new Set(grupo.map(r => chaveLogradouro(r.address)).filter(Boolean));
    if (ruas.size > 1 || ruas.size === 0) for (const r of grupo) empilhados.add(r.id);
  }
  console.log(`  em pilhas de ${PILHA}+ clientes com ruas diferentes: ${empilhados.size}`);

  const alvo = apagarTudo
    ? rows.map(r => r.id)
    : Array.from(new Set([...Array.from(longe), ...Array.from(empilhados)]));
  console.log(`  ${apagarTudo ? "TODOS" : "candidatos a replotar"}: ${alvo.length}`);

  if (!apagar && !apagarTudo) {
    console.log("\nSó medição. Para apagar e replotar: --apagar (cirúrgico) ou --apagar-tudo.");
    await pool.end();
    return;
  }
  if (alvo.length === 0) {
    console.log("Nada a apagar.");
    await pool.end();
    return;
  }

  const r = await pool.query(
    `UPDATE customers SET latitude = NULL, longitude = NULL
      WHERE provider_id = $1 AND id = ANY($2::int[])`,
    [providerId, alvo],
  );
  console.log(`apagadas ${r.rowCount} coordenadas — replotando...`);

  const status = await runGeocodeBackfill(providerId);
  console.log(`plotagem: ${status.plotados} plotados · ${status.semDadosDeEndereco} sem endereço localizável · ${status.adiadosPorIndisponibilidade} adiados (geocoder)`);
  if (status.geocoderIndisponivel) console.log(`geocoder indisponível: ${status.ultimoMotivo}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
