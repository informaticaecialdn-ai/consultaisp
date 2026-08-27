/**
 * Backfill de coordenadas — plota no mapa quem já está na base.
 *
 * O sync do ERP geocodifica os clientes que ELE traz. Quem entrou antes (base
 * restaurada de backup, importação CSV, sync antigo de quando a geocodificação
 * não existia) fica com lat/lng nulos para sempre — foi o que deixou a tela de
 * Localização com "0 plotados / 1220 sem coordenada" em produção, com o mapa
 * vazio ao lado de um ranking de bairros cheio.
 *
 * Este job varre os clientes sem coordenada que TÊM endereço ou cidade e os
 * geocodifica com as mesmas regras do sync: rua+cidade com jitter de ±100m,
 * fallback cidade com jitter de ±2km (LGPD — o ponto nunca é a casa exata).
 * Não depende de ERP nenhum: usa o que o cadastro já tem. Um sync futuro
 * sobrescreve com coordenada melhor se tiver.
 */
import { sql, and, or, isNull, isNotNull, eq } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { geocodeAddress, geocodeCity } from "./geocoding";
import { logger } from "../logger";

const USA_GOOGLE = (process.env.GOOGLE_MAPS_API_KEY || "").length > 10;
/**
 * Pausa entre clientes. O cache por rua única do geocoding absorve a maioria
 * das chamadas; esta pausa protege o Nominatim (limite público de 1 req/s)
 * nas que restam. Com a chave do Google o limite é folgado.
 */
const PAUSA_MS = USA_GOOGLE ? 60 : 1200;
const LOTE = 500;

export interface BackfillStatus {
  emAndamento: boolean;
  total: number;
  processados: number;
  plotados: number;
  semDadosDeEndereco: number;
  iniciadoEm: string | null;
  terminadoEm: string | null;
}

const status: BackfillStatus = {
  emAndamento: false,
  total: 0,
  processados: 0,
  plotados: 0,
  semDadosDeEndereco: 0,
  iniciadoEm: null,
  terminadoEm: null,
};

export function getBackfillStatus(): BackfillStatus {
  return { ...status };
}

/** Sem coordenada utilizável: nula, vazia ou o "0" que alguns imports gravam. */
const SEM_COORDENADA = or(
  isNull(customers.latitude),
  isNull(customers.longitude),
  eq(customers.latitude, "0"),
  sql`trim(coalesce(${customers.latitude}::text, '')) = ''`,
);

async function buscarPendentes(limite: number) {
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
      // Sem nenhum sinal de endereço não há o que geocodificar.
      or(isNotNull(customers.city), isNotNull(customers.cep), isNotNull(customers.address)),
    ))
    .orderBy(customers.providerId, customers.id)
    .limit(limite);
}

const pausa = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runGeocodeBackfill(): Promise<BackfillStatus> {
  if (status.emAndamento) return getBackfillStatus();

  status.emAndamento = true;
  status.processados = 0;
  status.plotados = 0;
  status.semDadosDeEndereco = 0;
  status.iniciadoEm = new Date().toISOString();
  status.terminadoEm = null;

  try {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(
        SEM_COORDENADA,
        or(isNotNull(customers.city), isNotNull(customers.cep), isNotNull(customers.address)),
      ));
    status.total = n;

    if (n === 0) {
      logger.info("Geocode backfill: nada a plotar");
      return finalizar();
    }

    logger.info({ total: n, viaGoogle: USA_GOOGLE }, "Geocode backfill iniciado");

    // Lotes com re-consulta: cada cliente resolvido sai do WHERE, então a
    // próxima página começa sempre do início do que restou.
    for (;;) {
      const lote = await buscarPendentes(LOTE);
      if (lote.length === 0) break;

      let resolveuAlgumNoLote = false;

      for (const c of lote) {
        status.processados++;

        let lat: string | undefined;
        let lng: string | undefined;

        const cidade = (c.city || "").trim();
        const uf = (c.state || "").trim();
        const rua = [c.address, c.addressNumber].filter(Boolean).join(", ").trim();

        if (rua && cidade) {
          const coords = await geocodeAddress(rua, cidade, uf, c.cep || undefined).catch(() => null);
          if (coords) {
            lat = String(coords[0] + (Math.random() - 0.5) * 0.002);
            lng = String(coords[1] + (Math.random() - 0.5) * 0.002);
          }
        }
        if (!lat && cidade) {
          const coords = await geocodeCity(cidade, uf).catch(() => null);
          if (coords) {
            lat = String(coords[0] + (Math.random() - 0.5) * 0.02);
            lng = String(coords[1] + (Math.random() - 0.5) * 0.02);
          }
        }

        if (lat && lng) {
          await db.update(customers)
            .set({ latitude: lat, longitude: lng })
            .where(eq(customers.id, c.id));
          status.plotados++;
          resolveuAlgumNoLote = true;
        } else {
          // Endereço que nem o geocoder resolve: marca com coordenada "0" para
          // não voltar a pagar a consulta de rede a cada passada do job.
          await db.update(customers)
            .set({ latitude: "0", longitude: "0" })
            .where(eq(customers.id, c.id));
          status.semDadosDeEndereco++;
        }

        await pausa(PAUSA_MS);
      }

      // Circuit breaker: rede fora ou geocoder bloqueando — parar e tentar na
      // próxima passada do agendador em vez de martelar o serviço.
      if (!resolveuAlgumNoLote) {
        logger.warn("Geocode backfill: lote inteiro sem resposta do geocoder — pausando até a próxima passada");
        break;
      }
    }

    logger.info(
      { plotados: status.plotados, semEndereco: status.semDadosDeEndereco, total: status.total },
      "Geocode backfill concluído",
    );
    return finalizar();
  } catch (err) {
    logger.error({ err }, "Geocode backfill falhou");
    return finalizar();
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
