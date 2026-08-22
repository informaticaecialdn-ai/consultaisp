import { eq } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { resolverAreaAtendida, type OrigemArea } from "../services/area-atendida";
import { estadoDoPonto, type EstadoPonto } from "../services/estado-ponto";

export interface LocalizacaoPonto {
  id: number; lat: number; lon: number;
  estado: EstadoPonto; emAberto: number; atraso: number;
  bairro: string | null; cidade: string;
}

export interface LocalizacaoBairro {
  bairro: string; cidade: string;
  clientes: number; inadimplentes: number; exComDivida: number;
  pctInadimplencia: number; dividaTotal: number;
}

export interface LocalizacaoResposta {
  origemArea: OrigemArea;
  semCoordenada: number;
  cidades: Array<{ cidade: string; clientes: number }>;
  pontos: LocalizacaoPonto[];
  bairros: LocalizacaoBairro[];
}

export class LocalizacaoStorage {
  /**
   * Uma varredura da carteira produz os quatro conjuntos que a tela precisa.
   * O recorte territorial vem da cascata — nunca mais de providers.addressState
   * sozinho, que nao filtrava nada quando a UF era nula.
   */
  async getLocalizacao(providerId: number): Promise<LocalizacaoResposta> {
    const area = await resolverAreaAtendida(providerId);

    const todos = await db.select().from(customers)
      .where(eq(customers.providerId, providerId));

    const cidadesAlvo = area.cidades
      ? new Set(area.cidades.map(c => c.trim().toLowerCase()))
      : null;
    const ufAlvo = area.uf ? area.uf.toUpperCase() : null;

    const naArea = todos.filter(c => {
      if (cidadesAlvo) return cidadesAlvo.has((c.city || "").trim().toLowerCase());
      if (ufAlvo) return (c.state || "").toUpperCase() === ufAlvo;
      return true;
    });

    const pontos: LocalizacaoPonto[] = [];
    let semCoordenada = 0;
    const porCidade = new Map<string, number>();
    const porBairro = new Map<string, LocalizacaoBairro>();

    for (const c of naArea) {
      const cidade = (c.city || "").trim() || "Sem cidade";
      porCidade.set(cidade, (porCidade.get(cidade) || 0) + 1);

      const estado = estadoDoPonto(c);
      const emAberto = Number(c.totalOverdueAmount || 0) || 0;
      const bairro = (c.neighborhood || "").trim() || "Sem bairro";

      const chave = `${cidade.toUpperCase()}||${bairro.toUpperCase()}`;
      const b = porBairro.get(chave) || {
        bairro, cidade, clientes: 0, inadimplentes: 0, exComDivida: 0,
        pctInadimplencia: 0, dividaTotal: 0,
      };
      b.clientes++;
      if (emAberto > 0) { b.inadimplentes++; b.dividaTotal += emAberto; }
      if (estado === 'ex_divida') b.exComDivida++;
      porBairro.set(chave, b);

      const lat = c.latitude ? parseFloat(c.latitude) : NaN;
      const lon = c.longitude ? parseFloat(c.longitude) : NaN;
      if (Number.isNaN(lat) || Number.isNaN(lon)) { semCoordenada++; continue; }

      // LGPD: sem nome e sem CPF — a tela nao precisa deles.
      pontos.push({
        id: c.id, lat, lon, estado, emAberto,
        atraso: c.maxDaysOverdue || 0, bairro: c.neighborhood, cidade,
      });
    }

    const bairros = Array.from(porBairro.values()).map(b => ({
      ...b,
      pctInadimplencia: b.clientes > 0 ? (b.inadimplentes / b.clientes) * 100 : 0,
    }));

    return {
      origemArea: area.origem,
      semCoordenada,
      cidades: Array.from(porCidade.entries())
        .map(([cidade, clientes]) => ({ cidade, clientes }))
        .sort((a, b) => b.clientes - a.clientes),
      pontos,
      bairros,
    };
  }
}
