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

    // Sai antes de tocar na rede. Sem isto, o conector era chamado so para
    // colecionar a recusa dele, e a passada de plotagem ficava com um erro de
    // leitura atribuido ao ERP do provedor. E no log que o suporte olha
    // primeiro: culpar o ERP por um conector que nem chegou a fazer requisicao
    // manda conferir credencial e liberacao de IP do provedor por uma pendencia
    // que e nossa. A mensagem abaixo diz de quem e.
    if (connector.naoImplementado) {
      logger.warn(
        { providerId, erp: intg.erpSource },
        `A integracao com o ${connector.label} ainda nao foi construida: o conector nao conversa `
        + `com a API desse ERP. Nada foi lido — nao ha falha no ERP do provedor.`,
      );
      continue;
    }

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
          .set({ latitude: String(coord.lat), longitude: String(coord.lng), geoPrecisao: "erp" })
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

    // Segunda pescaria, um a um, só em quem continuou sem ponto.
    atualizados += await puxarUmAUm(providerId, intg, connector);
  }

  return { comCoordenada, atualizados };
}

/**
 * Quantos clientes por provedor a busca um-a-um tenta numa passada.
 *
 * É uma requisição ao ERP por cliente. O teto existe para a passada terminar em
 * tempo previsível e para não martelar o ERP do provedor: o que sobrar entra na
 * próxima, e a lista só encolhe, porque quem for encontrado sai dela.
 */
const TETO_UM_A_UM = 300;

/**
 * A coordenada que a listagem em lote não trouxe, pedida cliente a cliente.
 *
 * O ERP guarda a mesma informação em dois lugares e nem sempre nos dois. Medido
 * no SGP da Amplinet em 04/09/2026: `/api/ura/clientes/` — a listagem que a
 * varredura acima usa — devolve latitude e longitude VAZIAS para boa parte da
 * base, enquanto a ficha do cliente traz `endereco_ll` preenchido. Entre os que
 * continuavam fora do mapa, 9 de 25 tinham a coordenada esperando ali.
 *
 * Vale a pena porque a alternativa é pior: dos 145 endereços pendentes daquele
 * provedor, só 21 existiam na base de endereços do IBGE — o resto é viela,
 * estrada e chácara que o censo não nomeia igual, e sobrava adivinhar pela rede.
 * A coordenada do ERP é o ponto da instalação.
 *
 * Só roda para conector que implementa `fetchCoordenadaPorCpf`; para os outros
 * o método não existe e a fase termina como antes.
 */
async function puxarUmAUm(
  providerId: number,
  intg: { erpSource: string; [k: string]: any },
  connector: { fetchCoordenadaPorCpf?: Function; label?: string },
): Promise<number> {
  if (!connector.fetchCoordenadaPorCpf) return 0;

  const pendentes = await db
    .select({ id: customers.id, cpfCnpj: customers.cpfCnpj, city: customers.city, state: customers.state })
    .from(customers)
    .where(and(eq(customers.providerId, providerId), SEM_COORDENADA))
    .limit(TETO_UM_A_UM);
  if (pendentes.length === 0) return 0;

  const config = buildConnectorConfig(intg as any);
  const limiter = getProviderLimiter(providerId, intg.erpSource);
  let gravados = 0, semCoordenadaNoErp = 0, recusadas = 0;

  for (const p of pendentes) {
    if (!p.cpfCnpj) continue;
    let achado: { latitude: string; longitude: string } | null = null;
    try {
      achado = await limiter(() => connector.fetchCoordenadaPorCpf!(config, p.cpfCnpj!));
    } catch {
      // Uma ficha que falha não derruba a passada nem as outras.
      continue;
    }
    if (!achado) { semCoordenadaNoErp++; continue; }

    // A MESMA régua da varredura em lote: coordenada que não combina com a
    // cidade declarada não entra. Vir da ficha em vez da listagem não a torna
    // mais confiável — o ERP erra coordenada dos dois lados.
    const coord = await coordenadaDoErpCoerente(achado.latitude, achado.longitude, p.city, p.state);
    if (!coord) { recusadas++; continue; }

    const r = await db.update(customers)
      .set({ latitude: String(coord.lat), longitude: String(coord.lng), geoPrecisao: "erp" })
      .where(and(eq(customers.id, p.id), SEM_COORDENADA))
      .returning({ id: customers.id });
    gravados += r.length;
  }

  if (gravados > 0 || recusadas > 0) {
    logger.info(
      { providerId, erp: intg.erpSource, tentados: pendentes.length, gravados, semCoordenadaNoErp, recusadas },
      "Coordenadas do ERP, ficha a ficha",
    );
  }
  return gravados;
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
