/**
 * Coordenadas em massa, direto do ERP.
 *
 * A plotagem por geocodificação de endereço é cara: uma chamada de rede por
 * cliente, serializada a 1 req/s pelo limite do Nominatim. Mil clientes viram
 * vinte minutos — quando dá certo.
 *
 * Só que o ERP quase sempre já sabe onde o cliente mora: o MK guarda a
 * latitude e a longitude da instalação no próprio cadastro, o ponto que o
 * técnico registrou quando montou o serviço. Uma varredura da carteira traz
 * tudo de uma vez, sem geocodificar nada, e a coordenada é melhor do que
 * qualquer aproximação de rua.
 *
 * Por isso esta fase roda ANTES do backfill de geocodificação: ela resolve a
 * maioria de graça, e a rede sobra para o resíduo que o ERP não coordenou.
 *
 * Escreve apenas em quem está sem coordenada. Cliente já plotado não é tocado
 * — inclusive porque a coordenada dele pode ter vindo justamente daqui.
 */
import { sql, and, eq, or, isNull } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { storage } from "../storage";
import { getConnector, buildConnectorConfig, getProviderLimiter } from "../erp";
import { coordenadaValida, coerenteComCidade } from "./coordenada";
import { geocodeCityDetalhado } from "./geocoding";
import { logger } from "../logger";

/**
 * A coordenada do ERP, SE ela combina com a cidade declarada do cliente.
 *
 * O ERP erra coordenada com frequencia: a matriz gravada como padrao, o ponto
 * de outro cliente copiado, lat/lon de uma cidade homonima. Uma coordenada a
 * 200 km da cidade do cadastro nao e a casa de ninguem, e gravada como
 * "coordenada do ERP" ela vencia qualquer outra fonte para sempre.
 *
 * A referencia e o centro da cidade pelo geocoder, cacheado — mil clientes da
 * mesma cidade custam uma chamada. Sem cidade legivel (vazia, ou o codigo IBGE
 * cru que o IXC manda) ou sem centro conhecido, a coordenada passa: sem regua
 * nao se acusa, e a tela ainda tem a caixa do municipio para o que sobrar.
 */
export async function coordenadaDoErpCoerente(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const c = coordenadaValida(lat, lng);
  if (!c) return null;
  const cidade = (city || "").trim();
  if (!cidade || /^\d+$/.test(cidade)) return c;
  const centro = await geocodeCityDetalhado(cidade, (state || "").trim());
  if (!centro.coords) return c;
  return coerenteComCidade(c.lat, c.lng, { lat: centro.coords[0], lng: centro.coords[1] }) ? c : null;
}

export interface ResultadoCoordsErp {
  /** Provedores varridos. */
  provedores: number;
  /** Clientes que o ERP devolveu com coordenada utilizável. */
  comCoordenada: number;
  /** Clientes que ganharam coordenada nova no banco. */
  atualizados: number;
}

const SEM_COORDENADA = or(
  isNull(customers.latitude),
  isNull(customers.longitude),
  and(eq(customers.latitude, "0"), eq(customers.longitude, "0")),
);

/**
 * Puxa as coordenadas do ERP de um provedor e grava em quem está sem ponto.
 * Devolve quantos foram resolvidos. Nunca lança: um ERP fora do ar não pode
 * derrubar a passada de plotagem.
 */
async function puxarDoProvedor(providerId: number): Promise<{ comCoordenada: number; atualizados: number }> {
  let comCoordenada = 0;
  let atualizados = 0;

  const integracoes = (await storage.getErpIntegrations(providerId))
    .filter(i => i.isEnabled && i.apiUrl && i.apiToken);

  for (const intg of integracoes) {
    const connector = getConnector(intg.erpSource);
    if (!connector || typeof connector.fetchCustomers !== "function") continue;

    try {
      const limiter = getProviderLimiter(providerId, intg.erpSource);
      const r = await limiter(() => connector.fetchCustomers!(buildConnectorConfig(intg)));
      if (!r.ok || r.customers.length === 0) continue;

      let recusadas = 0;
      for (const c of r.customers) {
        if (!c.cpfCnpj) continue;
        const coord = await coordenadaDoErpCoerente(c.latitude, c.longitude, c.city, c.state);
        if (!coord) {
          if (coordenadaValida(c.latitude, c.longitude)) recusadas++;
          continue;
        }
        comCoordenada++;

        // Chave é (provedor, documento): cpf_cnpj não é único entre provedores.
        // O SEM_COORDENADA no WHERE mantém a operação idempotente e impede
        // sobrescrever quem já está plotado.
        const gravados = await db.update(customers)
          .set({ latitude: String(coord.lat), longitude: String(coord.lng) })
          .where(and(
            eq(customers.providerId, providerId),
            sql`regexp_replace(coalesce(${customers.cpfCnpj}, ''), '[^0-9]', '', 'g') = ${c.cpfCnpj.replace(/\D/g, "")}`,
            SEM_COORDENADA,
          ))
          .returning({ id: customers.id });
        atualizados += gravados.length;
      }
      if (recusadas > 0) {
        logger.warn({ providerId, erp: intg.erpSource, recusadas }, "Coordenadas do ERP fora da cidade declarada — nao gravadas");
      }
    } catch (err) {
      // LGPD: só contagem e origem no log, nunca nome ou documento.
      logger.warn({ err, providerId, erp: intg.erpSource }, "Coordenadas do ERP: varredura falhou");
    }
  }

  return { comCoordenada, atualizados };
}

/**
 * Fase de coordenadas do ERP.
 *
 * Sem `providerIdPrioritario`, varre todos os provedores com integração ativa —
 * é o que a passada automática do worker faz. Com ele, atende só aquele
 * provedor: é o admin que clicou "Plotar agora" e quer ver a própria carteira.
 */
export async function puxarCoordenadasDoErp(providerId?: number): Promise<ResultadoCoordsErp> {
  const resultado: ResultadoCoordsErp = { provedores: 0, comCoordenada: 0, atualizados: 0 };

  let ids: number[];
  if (providerId) {
    ids = [providerId];
  } else {
    const linhas = await db
      .selectDistinct({ providerId: customers.providerId })
      .from(customers)
      .where(SEM_COORDENADA);
    ids = linhas.map(l => l.providerId).filter((n): n is number => n != null);
  }

  for (const id of ids) {
    const r = await puxarDoProvedor(id);
    resultado.provedores++;
    resultado.comCoordenada += r.comCoordenada;
    resultado.atualizados += r.atualizados;
  }

  if (resultado.atualizados > 0 || resultado.comCoordenada > 0) {
    logger.info(resultado, "Coordenadas do ERP aplicadas");
  }
  return resultado;
}
