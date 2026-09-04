/**
 * Canoniza a cidade dos clientes JÁ gravados.
 *
 *   npx tsx script/canonizar-cidades.ts 6              # mede o provedor 6
 *   npx tsx script/canonizar-cidades.ts 6 --aplicar    # grava
 *   npx tsx script/canonizar-cidades.ts --todos        # mede a base inteira
 *   npx tsx script/canonizar-cidades.ts --todos --aplicar
 *
 * POR QUE UMA CORREÇÃO ÚNICA. `upsertFromErp` passou a gravar o nome oficial do
 * município, mas isso só vale para quem passar por ele DEPOIS: a linha antiga
 * só é reescrita quando o ERP devolver aquele cliente de novo, e quem o ERP não
 * lista mais nunca mais passa por lá. Sem este script, a carteira já gravada
 * continuaria fora do mapa — "EMBUGUAÇU" não casa com a base de Embu-Guaçu — e
 * a barra de filtros da Localização continuaria com sete chips para a mesma
 * cidade. Foi o que o dono viu na Amplinet em 04/09/2026.
 *
 * A regra é a MESMA do upsert, importada, e não uma cópia: script e produto não
 * podem discordar sobre o que é a mesma cidade. Sem `--aplicar`, só mede.
 *
 * O que ele NÃO faz: adivinhar. "EMBU GAUCU" e "PARQUE JANDAIA" (bairro no
 * campo de cidade) saem na terceira lista, para o provedor corrigir no ERP —
 * plantar o cliente na cidade errada é pior do que deixá-lo fora do mapa.
 */
import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { customers } from "@shared/schema";
import {
  canonizarCidadeDoCadastro, type CidadeDoCadastro, type MotivoSemCanonizacao,
} from "../server/services/cidade-canonica.service";
/**
 * A MESMA régua de "sem coordenada" da fila de plotagem. O número que este
 * script promete destravar tem de ser o mesmo que a tela conta como pendente;
 * redigitar a condição aqui faria as duas divergirem sem ninguém notar.
 */
import { SEM_COORDENADA } from "../server/services/geocode-backfill.service";

const n = (v: number) => v.toLocaleString("pt-BR");

const EXPLICACAO: Record<MotivoSemCanonizacao, string> = {
  sem_cidade: "campo de cidade vazio",
  sem_uf: "sem UF no cadastro — sem ela não dá para saber qual município é",
  uf_em_conflito: "o estado do cadastro e a sigla escrita no nome discordam — obedecer a uma delas mudaria o cliente de estado",
  uf_nao_bate: "a cidade existe, mas não no estado informado — o campo a corrigir é o ESTADO",
  nao_encontrada: "erro de digitação ou bairro no campo de cidade",
};

/**
 * A explicação de uma linha, com o município candidato quando há um.
 *
 * `uf_nao_bate` é o caso dos quatro cadastros "ITAPECERICA DA SERRA" com RN, SE
 * e SC numa carteira toda de SP. Sem este motivo eles caíam em `nao_encontrada`
 * e o relatório mandava o provedor corrigir o NOME da cidade — que está escrito
 * perfeitamente. O campo errado é o outro.
 */
function explicar(r: CidadeDoCadastro): string {
  const base = EXPLICACAO[r.motivo ?? "nao_encontrada"];
  return r.candidato ? `${base} (parece ser ${r.candidato.nome}/${r.candidato.uf})` : base;
}

interface Grupo {
  cidade: string;
  uf: string | null;
  clientes: number;
  semCoordenada: number;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const todos = args.includes("--todos");
  const providerId = Number(args.find(a => /^\d+$/.test(a)) ?? 0);
  if (!todos && !providerId) {
    console.error("uso: npx tsx script/canonizar-cidades.ts <providerId> [--aplicar]  |  --todos [--aplicar]");
    process.exit(1);
  }
  // `--todos` é exigido para alcançar a base inteira: reescrever a cidade de
  // todos os provedores não pode ser o que acontece por esquecer um argumento.
  const alvo = todos ? null : providerId;

  const linhas: Grupo[] = await db
    .select({
      cidade: customers.city,
      uf: customers.state,
      clientes: sql<number>`count(*)::int`,
      semCoordenada: sql<number>`count(*) filter (where ${SEM_COORDENADA})::int`,
    })
    .from(customers)
    .where(and(
      sql`nullif(btrim(coalesce(${customers.city}, '')), '') is not null`,
      ...(alvo === null ? [] : [eq(customers.providerId, alvo)]),
    ))
    .groupBy(customers.city, customers.state) as Grupo[];

  const jaCanonicas: Grupo[] = [];
  const aMudar: Array<Grupo & { paraCidade: string; paraUf: string }> = [];
  const semMunicipio: Array<Grupo & { motivo: MotivoSemCanonizacao; explicacao: string }> = [];

  for (const g of linhas) {
    const r = canonizarCidadeDoCadastro(g.cidade, g.uf);
    if (!r.municipio) {
      semMunicipio.push({ ...g, motivo: r.motivo ?? "nao_encontrada", explicacao: explicar(r) });
    } else if (g.cidade === r.city && g.uf === r.state) {
      jaCanonicas.push(g);
    } else {
      aMudar.push({ ...g, paraCidade: r.city!, paraUf: r.state! });
    }
  }

  const soma = (gs: Grupo[], campo: "clientes" | "semCoordenada") =>
    gs.reduce((s, g) => s + g[campo], 0);
  const maiores = <T extends Grupo>(gs: T[]) => [...gs].sort((a, b) => b.clientes - a.clientes);

  const escopo = alvo === null ? "toda a base" : `provedor ${alvo}`;
  console.log(`\nCanonização da cidade — ${escopo}`);
  console.log(`Grafias de cidade no cadastro: ${n(linhas.length)}  ·  clientes: ${n(soma(linhas, "clientes"))}`);
  console.log(`  já no nome oficial: ${n(jaCanonicas.length)} grafias · ${n(soma(jaCanonicas, "clientes"))} clientes`);
  console.log(`  a canonizar:        ${n(aMudar.length)} grafias · ${n(soma(aMudar, "clientes"))} clientes · ${n(soma(aMudar, "semCoordenada"))} deles sem coordenada`);
  console.log(`  sem município:      ${n(semMunicipio.length)} grafias · ${n(soma(semMunicipio, "clientes"))} clientes`);

  if (aMudar.length) {
    console.log(`\nA CANONIZAR:`);
    for (const g of maiores(aMudar)) {
      const de = `"${g.cidade}"/${g.uf ?? "—"}`;
      console.log(`  ${de} → "${g.paraCidade}"/${g.paraUf} — ${n(g.clientes)} cliente(s), ${n(g.semCoordenada)} sem coordenada`);
    }
  }

  if (semMunicipio.length) {
    console.log(`\nNÃO CASAM COM MUNICÍPIO NENHUM — o cadastro do ERP precisa ser corrigido:`);
    for (const g of maiores(semMunicipio)) {
      console.log(`  "${g.cidade}"/${g.uf ?? "—"} — ${n(g.clientes)} cliente(s) · ${g.explicacao}`);
    }
    /*
     * DUAS RÉGUAS, e o operador precisa saber disso ANTES de abrir um chamado.
     *
     * A tela de cobertura (`cobertura-geo.service`) resolve cada grafia pela UF
     * DOMINANTE da carteira: as 211 linhas de "ITAPECERICA DA SERRA" — 207 em
     * SP e 4 em RN/SE/SC — viram um município só, e ela conta os clientes das
     * quatro como destraváveis pela base. Aqui a régua é a UF DA LINHA, e as
     * quatro aparecem acima como cadastro a corrigir.
     *
     * As duas estão certas para o que decidem. A tela decide QUAL BASE BAIXAR, e
     * ali a maioria é evidência legítima — errar custa um download. O
     * canonizador decide O QUE GRAVAR NA LINHA do cliente, e ali a maioria não é
     * evidência nenhuma: mudaria o estado de um cliente por causa do que os
     * outros 207 dizem, sem caminho de volta.
     */
    if (semMunicipio.some(g => g.motivo === "uf_nao_bate")) {
      console.log(
        `\n  (As linhas "uf_nao_bate" podem aparecer como cobertas na tela de Localização:` +
        `\n   lá a UF sai da MAIORIA dos cadastros daquela grafia, o que basta para escolher` +
        `\n   qual base baixar. Para reescrever a linha do cliente isso não basta — ver o` +
        `\n   comentário no fim desta seção do script.)`,
      );
    }
  }

  if (!aplicar) {
    console.log(aMudar.length ? "\nSó medição. Para gravar: --aplicar" : "\nNada a canonizar.");
    await pool.end();
    return;
  }
  if (aMudar.length === 0) {
    console.log("\nNada a canonizar.");
    await pool.end();
    return;
  }

  console.log("");
  let clientes = 0;
  // Uma grafia por vez, e cada UPDATE é fechado pela grafia EXATA que estava
  // gravada — inclusive `state IS NULL`, que `= NULL` nunca alcançaria. Assim
  // uma grafia que falhe não leva as outras junto, e a passada seguinte pode
  // ser repetida sem efeito: o que já está canônico não entra mais na lista.
  for (const g of aMudar) {
    const linhasMudadas = await db.update(customers)
      .set({ city: g.paraCidade, state: g.paraUf })
      .where(and(
        eq(customers.city, g.cidade),
        g.uf === null ? isNull(customers.state) : eq(customers.state, g.uf),
        ...(alvo === null ? [] : [eq(customers.providerId, alvo)]),
      ))
      .returning({ id: customers.id });
    clientes += linhasMudadas.length;
    console.log(`  "${g.cidade}"/${g.uf ?? "—"} → "${g.paraCidade}"/${g.paraUf}: ${n(linhasMudadas.length)} cliente(s)`);
  }

  console.log(`\n${n(clientes)} cliente(s) canonizados em ${n(aMudar.length)} grafia(s).`);
  console.log("A plotagem alcança as cidades novas na próxima passada, ou já — pelo botão \"Plotar agora\".");
  await pool.end();
}

// `e.message` sozinho não basta: um banco fora do ar chega como AggregateError
// de mensagem vazia, e a saída seria um "erro:" sem nada depois.
main().catch(e => { console.error("erro:", e?.message || e); process.exit(1); });
