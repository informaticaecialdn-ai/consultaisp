/**
 * A base de endereços do IBGE para TODA cidade que o provedor atende.
 *
 *   npx tsx script/cobertura-geo.ts 6            # mede: o que falta
 *   npx tsx script/cobertura-geo.ts 6 --carregar # baixa e carrega o que falta
 *   npx tsx script/cobertura-geo.ts --todos --carregar
 *
 * CASCA FINA. Toda a lógica — resolver a cidade do cadastro contra a lista
 * oficial de municípios, medir a cobertura, baixar e carregar — vive em
 * `server/services/municipio.service.ts` e
 * `server/services/cobertura-geo.service.ts`, porque isto não pode continuar
 * sendo um script que alguém com acesso ao servidor roda a mão: é rotina do
 * produto, e o que ela descobre tem de chegar à tela. Aqui ficou só a leitura
 * dos argumentos e a impressão — a linha de comando continua útil para
 * diagnosticar, sem que a regra exista em dois lugares.
 */
import "dotenv/config";
import { preferirIPv4NaSaida } from "../server/rede-saida";
preferirIPv4NaSaida();

import { pool } from "../server/db";
import {
  coberturaDaCarteira, carregarBasesFaltantes,
} from "../server/services/cobertura-geo.service";

const n = (v: number) => v.toLocaleString("pt-BR");

async function main() {
  const args = process.argv.slice(2);
  const carregar = args.includes("--carregar");
  const todos = args.includes("--todos");
  const providerId = Number(args.find(a => /^\d+$/.test(a)) ?? 0);
  if (!todos && !providerId) {
    console.error("uso: npx tsx script/cobertura-geo.ts <providerId> [--carregar]  |  --todos [--carregar]");
    process.exit(1);
  }
  const alvo = todos ? null : providerId;

  const c = await coberturaDaCarteira(alvo);
  console.log(`\nCidades na carteira: ${n(c.cidades)}  ·  já com base: ${n(c.comBase.length)}`);
  console.log(`Clientes: ${n(c.clientes)}  ·  sem coordenada: ${n(c.semCoordenada)}`);

  if (c.semBase.length === 0) console.log("\nNenhuma cidade sem base. Nada a carregar.");
  else {
    console.log(`\nSEM BASE DE ENDEREÇOS (${c.semBase.length}):`);
    for (const f of c.semBase) {
      console.log(`  ${f.municipio.nome}/${f.municipio.uf} (${f.municipio.ibge}) — ${n(f.clientes)} clientes, ${n(f.semCoordenada)} sem coordenada`);
    }
  }

  if (c.semMunicipio.length) {
    console.log(`\nNÃO CASAM COM MUNICÍPIO NENHUM (${c.semMunicipio.length}) — o cadastro do ERP precisa ser corrigido:`);
    for (const s of c.semMunicipio) {
      const motivo = s.motivo === "sem_uf"
        ? "sem UF no cadastro — sem ela não dá para saber qual município é"
        : "erro de digitação ou bairro no campo de cidade";
      console.log(`  ${s.grafias.join(" / ")} — ${n(s.clientes)} cliente(s) · ${motivo}`);
    }
  }

  if (!carregar || c.semBase.length === 0) {
    if (c.semBase.length) console.log("\nSó medição. Para baixar e carregar: --carregar");
    await pool.end();
    return;
  }

  console.log("");
  const r = await carregarBasesFaltantes(alvo, {
    aoIniciar: (m, i, total) => console.log(`  [${i}/${total}] baixando ${m.nome}/${m.uf}...`),
    aoTerminar: (carga) => {
      const rotulo = `${carga.municipio.nome}/${carga.municipio.uf}`;
      if (carga.ok) console.log(`  [ok]    ${rotulo}: ${n(carga.domicilios ?? 0)} domicílios · ${n(carga.enderecos ?? 0)} endereços com coordenada`);
      else console.log(`  [falha] ${rotulo}: ${carga.erro}`);
    },
  });
  console.log(`\nCarregadas ${n(r.carregadas.length)} de ${n(r.tentadas)}${r.falhas.length ? ` · ${n(r.falhas.length)} falharam (a próxima passada tenta de novo)` : ""}.`);

  await pool.end();
}

// `e.message` sozinho não bastava: um banco fora do ar chega como AggregateError
// de mensagem vazia, e a saída era um "erro:" sem nada depois.
main().catch(e => { console.error("erro:", e?.message || e); process.exit(1); });
