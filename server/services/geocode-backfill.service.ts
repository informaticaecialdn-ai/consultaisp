/**
 * Backfill de coordenadas — plota no mapa quem já está na base.
 *
 * O sync do ERP geocodifica os clientes que ELE traz. Quem entrou antes (base
 * restaurada de backup, importação CSV, sync antigo de quando a geocodificação
 * não existia) fica com lat/lng nulos para sempre — foi o que deixou a tela de
 * Localização com "0 plotados / 1220 sem coordenada" em produção, com o mapa
 * vazio ao lado de um ranking de bairros cheio.
 *
 * Este job varre os clientes sem coordenada que TÊM endereço, cidade ou CEP e
 * os geocodifica com as mesmas regras do sync: rua+cidade com jitter de ±100m,
 * fallback cidade com jitter de ±2km (LGPD — o ponto nunca é a casa exata).
 * Não depende de ERP nenhum: usa o que o cadastro já tem. Um sync futuro
 * sobrescreve com coordenada melhor se tiver.
 *
 * ── Três decisões que a primeira versão errou ──────────────────────────────
 *
 * 1. **Não existe marcador de "desisti".** A v1 gravava (0,0) no cliente que o
 *    geocoder não resolvia — mas (0,0) continuava casando com o filtro de
 *    pendentes, então a linha voltava na passada seguinte, e como cada página
 *    recomeçava do início da ordenação, um bloco de 500 irresolvíveis na
 *    frente da fila travava o job para sempre. Agora a paginação é por cursor
 *    (`id > último`), o que garante avanço mesmo quando NADA resolve, e o
 *    cliente não-resolvido simplesmente fica como está — a próxima volta tenta
 *    de novo, que é o comportamento certo quando a causa foi o geocoder.
 *
 * 2. **Geocoder fora do ar não é endereço inválido.** `indisponivel` (chave
 *    recusada, quota, timeout) aborta a passada; `nao_encontrado` só descarta
 *    aquele cliente. Tratar os dois igual queimava a base inteira em silêncio.
 *
 * 3. **O ritmo não é problema daqui.** Respeitar o limite do Nominatim virou
 *    responsabilidade do próprio módulo de geocodificação, que serializa as
 *    chamadas dele. Pausar aqui só acertava quando a suposição sobre qual
 *    provedor atenderia estivesse certa — e ela deixava de valer justamente
 *    quando o Google falhava e a chamada caía no Nominatim.
 */
import type { PoolClient } from "pg";
import { sql, and, or, isNull, eq, gt, asc } from "drizzle-orm";
import { db, pool } from "../db";
import { customers } from "@shared/schema";
import {
  geocodeAddressDetalhado, geocodeCepDetalhado,
  usandoNominatim,
} from "./geocoding";
import { puxarCoordenadasDoErp } from "./coords-erp.service";
import { abrirGeocodificadorLocal, type GeocodificadorLocal } from "./geocode-local.service";
import { chaveLogradouro } from "./logradouro";
import { logger } from "../logger";

const LOTE = 200;
/** Falhas de rede seguidas que caracterizam geocoder fora do ar. */
const LIMITE_FALHAS_DE_REDE = 8;
/** Teto de tempo por passada: o job é de fundo, não pode monopolizar o worker. */
const LIMITE_DA_PASSADA_MS = 25 * 60 * 1000;

export interface BackfillStatus {
  emAndamento: boolean;
  /** Clientes sem coordenada com algum dado de endereço, na última contagem. */
  total: number;
  processados: number;
  plotados: number;
  semDadosDeEndereco: number;
  /** Não resolvidos porque o geocoder não respondeu — voltam na próxima volta. */
  adiadosPorIndisponibilidade: number;
  geocoderIndisponivel: boolean;
  ultimoMotivo: string | null;
  cursor: number;
  iniciadoEm: string | null;
  terminadoEm: string | null;
}

const status: BackfillStatus = {
  emAndamento: false,
  total: 0,
  processados: 0,
  plotados: 0,
  semDadosDeEndereco: 0,
  adiadosPorIndisponibilidade: 0,
  geocoderIndisponivel: false,
  ultimoMotivo: null,
  cursor: 0,
  iniciadoEm: null,
  terminadoEm: null,
};

export function getBackfillStatus(): BackfillStatus {
  return { ...status };
}

/**
 * Sem coordenada utilizável: nula ou o par (0,0) que alguns imports gravam.
 * Exige os DOIS zeros — latitude 0 sozinha é legítima (o equador corta o Amapá).
 */
export const SEM_COORDENADA = or(
  isNull(customers.latitude),
  isNull(customers.longitude),
  and(eq(customers.latitude, "0"), eq(customers.longitude, "0")),
);

/**
 * O que basta para geocodificar: cidade, ou CEP (que os Correios convertem em
 * cidade). Rua sozinha não serve — "Rua das Flores, 100" existe em mil cidades
 * do Brasil, e aceitá-la só inflava a fila de pendentes com clientes que o
 * laço nunca conseguiria resolver.
 *
 * `isNotNull` também não bastava: base restaurada de backup guarda string
 * vazia, que passa em IS NOT NULL e não geocodifica nada.
 */
export const TEM_ENDERECO = or(
  sql`nullif(btrim(coalesce(${customers.city}, '')), '') is not null`,
  sql`nullif(btrim(coalesce(${customers.cep}, '')), '') is not null`,
);

async function buscarPendentes(cursor: number, limite: number, providerId: number | null) {
  return db
    .select({
      id: customers.id,
      address: customers.address,
      addressNumber: customers.addressNumber,
      city: customers.city,
      state: customers.state,
      cep: customers.cep,
    })
    .from(customers)
    .where(and(
      SEM_COORDENADA,
      TEM_ENDERECO,
      gt(customers.id, cursor),
      ...(providerId === null ? [] : [eq(customers.providerId, providerId)]),
    ))
    .orderBy(asc(customers.id))
    .limit(limite);
}

type Pendente = Awaited<ReturnType<typeof buscarPendentes>>[number];
type Desfecho = "plotado" | "sem-endereco" | "indisponivel";

const limpar = (v: string | null | undefined) => (v || "").trim();

/**
 * Clientes que precisam ser desempilhados de uma coordenada repetida.
 *
 * Coordenada idêntica em muitos clientes COM ENDEREÇOS DIFERENTES é, por
 * construção, um ponto de fallback: centroide de bairro ou centro de cidade
 * gravado quando o endereço não resolveu.
 *
 * A segunda metade da frase é o que separa defeito de dado correto, e custou
 * uma medição em produção para aparecer: 22 clientes no mesmo ponto eram um
 * prédio — todos na Avenida Américo Deolindo Garla, 224. Mesmo endereço, mesma
 * coordenada, e espalhá-los pelo bairro seria estragar o que estava certo.
 * Só é pilha quando o mesmo ponto reúne endereços que deveriam estar em
 * lugares diferentes.
 */
const MIN_PARA_DESEMPILHAR = 12;

/**
 * Decide se um ponto com muitos clientes é fallback ou dado correto.
 *
 * O SQL não serve para esta pergunta, e isso custou duas correções para
 * aparecer: comparando o texto cru, "Avenida Tiradentes", "Av. Tiradentes" e
 * "avenida Tiradentes" contam como três ruas, e uma avenida vira uma pilha
 * falsa. A régua tem que ser a MESMA que o geocodificador usa para decidir a
 * coordenada — se ele considera o mesmo logradouro, a coordenada repetida está
 * certa e não há o que desempilhar.
 *
 * Sobra suspeito o que é de fato suspeito: logradouros diferentes de verdade no
 * mesmo ponto, ou ninguém com logradouro nenhum.
 */
export function pilhaSuspeita(clientes: Array<{ address?: string | null }>): boolean {
  const ruas = new Set(
    clientes.map(c => chaveLogradouro(c.address)).filter(Boolean),
  );
  return ruas.size > 1 || ruas.size === 0;
}

async function buscarEmpilhados(providerId: number | null, limite: number) {
  const filtro = providerId === null ? "" : "AND provider_id = $2";
  const params: any[] = [MIN_PARA_DESEMPILHAR];
  if (providerId !== null) params.push(providerId);

  const { rows } = await pool.query<{ id: number; address: string | null; address_number: string | null; neighborhood: string | null; city: string | null; state: string | null; cep: string | null; grupo: string }>(
    `WITH pilhas AS (
       SELECT latitude, longitude, provider_id
         FROM customers
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND NOT (latitude = 0 AND longitude = 0)
          ${filtro}
        GROUP BY latitude, longitude, provider_id
       HAVING count(*) >= $1
     )
     SELECT c.id, c.address, c.address_number, c.neighborhood, c.city, c.state, c.cep,
            c.latitude::text || '|' || c.longitude::text || '|' || c.provider_id AS grupo
       FROM customers c
       JOIN pilhas p ON p.latitude = c.latitude AND p.longitude = c.longitude
                    AND p.provider_id = c.provider_id
      LIMIT ${limite}`,
    params,
  );

  const porGrupo = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = porGrupo.get(r.grupo);
    if (g) g.push(r); else porGrupo.set(r.grupo, [r]);
  }

  return Array.from(porGrupo.values())
    .filter(pilhaSuspeita)
    .flat()
    .map(r => ({
      id: r.id, address: r.address, addressNumber: r.address_number,
      neighborhood: r.neighborhood, city: r.city, state: r.state, cep: r.cep,
    }));
}

/** Resolve e grava a coordenada de um cliente. Não decide nada sobre a
 *  varredura — quem lê o desfecho é o laço. */
async function plotarCliente(
  c: Pendente,
  local: GeocodificadorLocal | null,
): Promise<{ desfecho: Desfecho; motivo?: string }> {
  const rua = [limpar(c.address), limpar(c.addressNumber)].filter(Boolean).join(", ");
  const cep = limpar(c.cep);
  let cidade = limpar(c.city);
  let uf = limpar(c.state);

  // 1. Base local do IBGE. Sem rede, sem quota, e com a coordenada da própria
  // casa quando o número bate. Só o que ela não resolver paga rede.
  //
  // Até o bairro. A precisão "cidade" — um endereço qualquer do município —
  // não é a localização de ninguém: era o que espalhava clientes de rua não
  // casada por toda a cidade, a quilômetros da casa. Quem cai nela segue para
  // a rede, que pode conhecer a rua que o censo não casou.
  if (local) {
    const acerto = local.resolver(c);
    if (acerto && acerto.precisao !== "cidade") {
      await db.update(customers)
        .set({ latitude: String(acerto.lat), longitude: String(acerto.lon) })
        .where(and(eq(customers.id, c.id), SEM_COORDENADA));
      return { desfecho: "plotado" };
    }
  }

  let coords: [number, number] | null = null;
  const jitter = 0.002;      // ±~100m — LGPD: o ponto nunca é a porta exata
  let indisponivel = false;
  let motivo: string | undefined;

  // Sem cidade no cadastro, o CEP resolve pelos Correios antes de qualquer
  // geocodificação. Era o furo que condenava o cliente que tinha CEP mas não
  // tinha cidade: nenhum dos dois ramos o aceitava.
  if (!cidade && cep) {
    const r = await geocodeCepDetalhado(cep);
    if (r.local) { cidade = r.local.city; uf = r.local.state; }
    else if (r.falha === "indisponivel") { indisponivel = true; motivo = `viacep — ${r.motivo}`; }
  }

  // Rua com número + cidade, e o CEP de logradouro de reserva. O geocoder só
  // é aceito com precisão de rua ou melhor (ver geocodeAddressDetalhado).
  //
  // NÃO há queda para o centro da cidade. Havia — com 2 km de ruído — e era o
  // ponto "muito fora do endereço": um centro de cidade vestido de cliente.
  // Quem não resolve fica sem coordenada, contado e visível na tela, em vez
  // de plotado no lugar errado.
  if ((rua || cep) && cidade) {
    const r = await geocodeAddressDetalhado(rua, cidade, uf, cep || undefined);
    if (r.coords) coords = r.coords;
    else if (r.falha === "indisponivel") { indisponivel = true; motivo = r.motivo; }
  }

  if (coords) {
    // `SEM_COORDENADA` no WHERE, e não só o id: entre a leitura do lote e este
    // UPDATE cabem os segundos que a geocodificação levou, e nesse intervalo um
    // sync pode ter gravado a coordenada EXATA que o ERP tem do cliente.
    // Escrever por cima dela um centro de cidade com jitter de ±2km seria
    // trocar a casa pelo município.
    // Se o UPDATE não pegou, é porque o cliente já ganhou coordenada melhor no
    // meio do caminho — o desfecho para ele continua sendo "plotado".
    await db.update(customers)
      .set({
        latitude: String(coords[0] + (Math.random() - 0.5) * jitter),
        longitude: String(coords[1] + (Math.random() - 0.5) * jitter),
      })
      .where(and(eq(customers.id, c.id), SEM_COORDENADA));
    return { desfecho: "plotado" };
  }
  // Geocoder fora do ar: o endereço não tem culpa, não grava nada e tenta
  // de novo depois. Respondeu e não conhece: nada a fazer até o provedor
  // corrigir o cadastro no ERP.
  return indisponivel
    ? { desfecho: "indisponivel", motivo }
    : { desfecho: "sem-endereco" };
}

/**
 * Trava entre processos. O worker roda o job sozinho a cada 6h e o admin pode
 * disparar pela tela — sem isto, os dois varrem a mesma base ao mesmo tempo e
 * pagam duas vezes a mesma chamada de geocodificação. A trava é do Postgres e
 * vive na conexão, então precisa de um cliente dedicado do pool.
 *
 * Falha aberta de propósito: se o banco não conceder a trava por algum motivo
 * inesperado, o job roda assim mesmo. Trabalho duplicado é desperdício; job
 * que nunca roda é o defeito que estamos consertando.
 */
const CHAVE_DA_TRAVA = 4820_1177;

async function tentarTravar(): Promise<{ liberar: () => Promise<void>; obtida: boolean }> {
  let conn: PoolClient | null = null;
  try {
    conn = await pool.connect();
    const r = await conn.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [CHAVE_DA_TRAVA]);
    if (!r.rows[0]?.ok) {
      conn.release();
      return { obtida: false, liberar: async () => {} };
    }
    const c = conn;
    return {
      obtida: true,
      liberar: async () => {
        try { await c.query("select pg_advisory_unlock($1)", [CHAVE_DA_TRAVA]); } catch {}
        c.release();
      },
    };
  } catch (err) {
    conn?.release();
    logger.warn({ err }, "Geocode backfill: trava indisponível — seguindo sem ela");
    return { obtida: true, liberar: async () => {} };
  }
}

/**
 * Há varredura rodando em QUALQUER processo?
 *
 * `status.emAndamento` só enxerga o próprio processo, e em produção a API e o
 * worker são dois — a tela perguntava para o processo errado. A trava do
 * Postgres é o único estado que os dois compartilham: se não dá para pegá-la,
 * alguém está varrendo. Pega-e-solta, para não segurar nada.
 */
export async function varreduraAtiva(): Promise<boolean> {
  if (status.emAndamento) return true;
  let conn: PoolClient | null = null;
  try {
    conn = await pool.connect();
    const r = await conn.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [CHAVE_DA_TRAVA]);
    if (r.rows[0]?.ok) {
      await conn.query("select pg_advisory_unlock($1)", [CHAVE_DA_TRAVA]);
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    conn?.release();
  }
}

export async function runGeocodeBackfill(providerIdPrioritario?: number): Promise<BackfillStatus> {
  if (status.emAndamento) return getBackfillStatus();
  // Marca antes de qualquer await: dois disparos quase simultâneos passariam
  // os dois pela guarda enquanto o primeiro espera a trava. É também o que a
  // tela consulta logo depois do POST para começar a acompanhar o progresso.
  status.emAndamento = true;

  const trava = await tentarTravar();
  if (!trava.obtida) {
    status.emAndamento = false;
    logger.info("Geocode backfill: outra instância já está rodando");
    return getBackfillStatus();
  }

  status.processados = 0;
  status.plotados = 0;
  status.semDadosDeEndereco = 0;
  status.adiadosPorIndisponibilidade = 0;
  status.geocoderIndisponivel = false;
  status.ultimoMotivo = null;
  status.iniciadoEm = new Date().toISOString();
  status.terminadoEm = null;

  const limiteDeTempo = Date.now() + LIMITE_DA_PASSADA_MS;
  let falhasSeguidasDeRede = 0;
  let parar: null | "tempo" | "geocoder" = null;

  try {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(SEM_COORDENADA, TEM_ENDERECO));
    status.total = n;

    // A fila vazia NÃO encerra a passada: desempilhar é trabalho independente
    // de plotar. Enquanto este `return` estava aqui em cima, produção ficou com
    // zero pendentes e cinco pilhas intactas — o job saía dizendo "nada a
    // plotar" e nunca chegava na fase que conserta a bola.
    logger.info({ total: n, viaNominatim: usandoNominatim(), cursor: status.cursor }, "Geocode backfill iniciado");

    // FASE A — o que o ERP já sabe. Uma varredura da carteira resolve a maioria
    // sem nenhuma chamada de geocodificação, e com coordenada melhor. Só o que
    // sobrar daqui paga rede na fase B. Sem fila, não há o que ela preencha.
    if (n > 0) {
      try {
        const doErp = await puxarCoordenadasDoErp(providerIdPrioritario);
        status.plotados += doErp.atualizados;
        if (doErp.atualizados > 0) {
          status.total = Math.max(0, status.total - doErp.atualizados);
        }
      } catch (err) {
        logger.warn({ err }, "Geocode backfill: fase de coordenadas do ERP falhou — segue para a geocodificação");
      }
    }

    const empilhados = await buscarEmpilhados(providerIdPrioritario ?? null, 20_000);
    if (n === 0 && empilhados.length === 0) {
      logger.info("Geocode backfill: nada a plotar nem a desempilhar");
      return finalizar();
    }

    // FASE B — a base de endereços do IBGE, se estiver carregada. Resolve na
    // memória do processo, então o que ela cobre nunca chega à rede. As cidades
    // carregadas são as de quem precisa de trabalho — pendentes e empilhados —,
    // e não a base inteira: cada município custa memória.
    let local: GeocodificadorLocal | null = null;
    try {
      const pendentes = await db
        .selectDistinct({ cidade: customers.city })
        .from(customers)
        .where(and(SEM_COORDENADA, TEM_ENDERECO));
      const cidades = Array.from(new Set([
        ...pendentes.map(c => c.cidade ?? ""),
        ...empilhados.map(c => c.city ?? ""),
      ].filter(Boolean)));
      local = await abrirGeocodificadorLocal(cidades.map(cidade => ({ cidade })));
    } catch (err) {
      logger.warn({ err }, "Geocode backfill: base local de endereços indisponível — seguindo pela rede");
    }

    // FASE C — desempilhar. Coordenada repetida em muitos clientes com ruas
    // diferentes é, por construção, um ponto de fallback que uma versão
    // anterior gravou: centro de cidade, centroide de CEP geral. Espalhar
    // sobre endereços reais da rua ou do bairro conserta a "bola".
    //
    // O que a base local não resolve até o bairro perde a coordenada — vira
    // pendente e vai para a fila da rede, que exige precisão de rua. Um ponto
    // que só a cidade explica é errado com certeza (a pilha prova isso), e
    // ficar com ele no mapa era a queixa: clientes a quilômetros da casa.
    if (empilhados.length > 0) {
      try {
        let desempilhados = 0;
        let devolvidosAFila = 0;
        for (const c of empilhados) {
          const acerto = local?.resolver(c);
          if (acerto && acerto.precisao !== "cidade") {
            await db.update(customers)
              .set({ latitude: String(acerto.lat), longitude: String(acerto.lon) })
              .where(eq(customers.id, c.id));
            desempilhados++;
          } else {
            await db.update(customers)
              .set({ latitude: null, longitude: null })
              .where(eq(customers.id, c.id));
            devolvidosAFila++;
          }
        }
        if (desempilhados > 0 || devolvidosAFila > 0) {
          logger.info(
            { desempilhados, devolvidosAFila, piso: MIN_PARA_DESEMPILHAR },
            "Geocode backfill: pilhas desfeitas — o resto volta para a fila de plotagem",
          );
          status.total += devolvidosAFila;
        }
      } catch (err) {
        logger.warn({ err }, "Geocode backfill: desempilhamento falhou — segue para a fila de pendentes");
      }
    }

    // Desempilhou e não há fila: a passada cumpriu o que tinha a cumprir.
    // (Quem foi devolvido à fila pela fase C entra em `status.total` e segue
    // para a rede abaixo.)
    if (status.total === 0) return finalizar();

    // Quem clicou "Plotar agora" quer ver a PRÓPRIA carteira no mapa. A
    // varredura é uma só para toda a base, então sem esta etapa o admin
    // esperaria a fila inteira enquanto o job geocodifica clientes de outro
    // provedor que por acaso têm id menor.
    const etapas: Array<number | null> = providerIdPrioritario ? [providerIdPrioritario, null] : [null];

    for (const etapa of etapas) {
      if (parar) break;

      // O cursor global sobrevive entre passadas (a anterior pode ter parado
      // no teto de tempo); a etapa prioritária é curta e sempre começa do zero.
      let cursor = etapa === null ? status.cursor : 0;
      const cursorInicial = cursor;
      let voltas = 0;

      for (;;) {
        const lote = await buscarPendentes(cursor, LOTE, etapa);

        if (lote.length === 0) {
          // Fim da fila. Se a etapa começou no meio da tabela, volta uma única
          // vez para varrer o trecho que ficou atrás. Quem começou em 0 já viu
          // tudo — dar a volta ali seria reprocessar o que acabou de falhar.
          if (cursorInicial === 0 || ++voltas > 1) break;
          cursor = 0;
          if (etapa === null) status.cursor = 0;
          continue;
        }
        // Na volta, para ao alcançar o ponto de partida: dali para frente já foi.
        if (voltas > 0 && lote[0].id >= cursorInicial) break;

        for (const c of lote) {
          if (Date.now() > limiteDeTempo) { parar = "tempo"; break; }

          cursor = c.id;
          if (etapa === null) status.cursor = cursor;
          status.processados++;

          const r = await plotarCliente(c, local);
          if (r.desfecho === "plotado") {
            status.plotados++;
            falhasSeguidasDeRede = 0;
            status.geocoderIndisponivel = false;
          } else if (r.desfecho === "indisponivel") {
            status.adiadosPorIndisponibilidade++;
            status.ultimoMotivo = r.motivo ?? "geocoder não respondeu";
            if (++falhasSeguidasDeRede >= LIMITE_FALHAS_DE_REDE) { parar = "geocoder"; break; }
          } else {
            status.semDadosDeEndereco++;
            falhasSeguidasDeRede = 0;
          }
        }
        if (parar) break;
      }
    }

    if (parar === "tempo") {
      logger.info(
        { processados: status.processados, plotados: status.plotados, cursor: status.cursor },
        "Geocode backfill: teto de tempo da passada — continua na próxima",
      );
      return finalizar();
    }
    if (parar === "geocoder") {
      status.geocoderIndisponivel = true;
      logger.error(
        { motivo: status.ultimoMotivo, processados: status.processados, plotados: status.plotados },
        "Geocode backfill abortado: geocoder fora do ar",
      );
      return finalizar();
    }

    logger.info(
      {
        plotados: status.plotados,
        semEndereco: status.semDadosDeEndereco,
        adiados: status.adiadosPorIndisponibilidade,
        processados: status.processados,
        total: status.total,
      },
      "Geocode backfill concluído",
    );
    status.cursor = 0;  // próxima passada varre do começo
    return finalizar();
  } catch (err) {
    logger.error({ err }, "Geocode backfill falhou");
    return finalizar();
  } finally {
    await trava.liberar();
  }
}

function finalizar(): BackfillStatus {
  status.emAndamento = false;
  status.terminadoEm = new Date().toISOString();
  return getBackfillStatus();
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Uma passada 30s após o boot (não atrasa a subida do servidor) e depois a
 * cada 6h para pegar clientes novos de importação CSV. É idempotente e barata
 * quando não há pendência: a contagem inicial devolve 0 e o job encerra.
 */
export function startGeocodeBackfill(): void {
  if (timer) return;
  setTimeout(() => { runGeocodeBackfill().catch(() => {}); }, 30_000);
  timer = setInterval(() => { runGeocodeBackfill().catch(() => {}); }, 6 * 60 * 60 * 1000);
  timer.unref?.();
}
