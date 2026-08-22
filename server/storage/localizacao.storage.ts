import { eq } from "drizzle-orm";
import { db } from "../db";
import { customers } from "@shared/schema";
import { resolverAreaAtendida, normalizarCidade, type OrigemArea } from "../services/area-atendida";
import { estadoDoPonto, type EstadoPonto } from "../services/estado-ponto";
import { separarCoordenadasSuspeitas, centroMediano } from "../services/coordenada-suspeita";

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

export interface LocalizacaoCidade {
  cidade: string;
  clientes: number;
  inadimplentes: number;
  dividaTotal: number;
  /** Centro mediano dos clientes da cidade; null quando nenhum tem coordenada. */
  lat: number | null;
  lon: number | null;
}

export interface LocalizacaoResposta {
  origemArea: OrigemArea;
  semCoordenada: number;
  /** Coordenada incoerente com a cidade declarada — fica fora do mapa. */
  coordenadaSuspeita: Array<{ id: number; cidade: string; lat: number; lon: number }>;
  cidades: LocalizacaoCidade[];
  /** Cidades na area declarada que ainda nao tem nenhum cliente. */
  cidadesSemCliente: string[];
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
      ? new Set(area.cidades.map(normalizarCidade))
      : null;
    const ufAlvo = area.uf ? area.uf.toUpperCase() : null;

    // A mesma cidade chega escrita de varios jeitos: "Cornélio Procópio",
    // "Cornelio Procopio", "Cornélio Procópio - PR". Sem canonizar, a mesma
    // cidade vira dois chips, duas linhas de ranking, e a deteccao de
    // coordenada suspeita perde massa por dividir o grupo. O rotulo oficial
    // vem da area declarada; se a cidade nao estiver la, vale o que o ERP mandou.
    const rotuloOficial = new Map<string, string>();
    for (const nome of area.cidades ?? []) {
      rotuloOficial.set(normalizarCidade(nome), nome.replace(/\s*-\s*[A-Za-z]{2}\s*$/, "").trim());
    }
    const canonizar = (bruto: string | null) => {
      const limpo = (bruto || "").trim();
      if (!limpo) return "Sem cidade";
      return rotuloOficial.get(normalizarCidade(limpo)) ?? limpo;
    };

    const naArea = todos.filter(c => {
      if (cidadesAlvo) return cidadesAlvo.has(normalizarCidade(c.city));
      if (ufAlvo) return (c.state || "").toUpperCase() === ufAlvo;
      return true;
    });

    const pontos: LocalizacaoPonto[] = [];
    let semCoordenada = 0;
    const porCidade = new Map<string, LocalizacaoCidade>();
    const porBairro = new Map<string, LocalizacaoBairro>();

    for (const c of naArea) {
      const cidade = canonizar(c.city);
      const ct = porCidade.get(cidade) || {
        cidade, clientes: 0, inadimplentes: 0, dividaTotal: 0, lat: null, lon: null,
      };
      ct.clientes++;

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

      if (emAberto > 0) { ct.inadimplentes++; ct.dividaTotal += emAberto; }
      porCidade.set(cidade, ct);

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

    // Um ponto errado a centenas de km estica o enquadramento e a tela abre
    // numa regiao onde o provedor nao atende. Fora do mapa, mas contado — e
    // um defeito de cadastro que o provedor precisa ver para corrigir no ERP.
    const { coerentes, suspeitos } = separarCoordenadasSuspeitas(pontos);

    // Centro de cada cidade pela mediana dos proprios clientes — so os
    // coerentes, para o marcador da visao por cidade nao ser puxado pelo mesmo
    // ponto errado que ja foi excluido do mapa.
    const pontosPorCidade = new Map<string, LocalizacaoPonto[]>();
    for (const p of coerentes) {
      const lista = pontosPorCidade.get(p.cidade);
      if (lista) lista.push(p); else pontosPorCidade.set(p.cidade, [p]);
    }
    for (const [cidade, lista] of Array.from(pontosPorCidade.entries())) {
      const ct = porCidade.get(cidade);
      if (!ct) continue;
      const centro = centroMediano(lista.map(p => ({ lat: p.lat, lon: p.lon, cidade })));
      ct.lat = centro.lat;
      ct.lon = centro.lon;
    }

    // Cidade declarada sem nenhum cliente e cobertura sem carteira — o provedor
    // atende ali e nao vendeu. Sem coordenada propria, nao vai ao mapa; vai como
    // contagem, que e o que torna a informacao acionavel.
    const comCliente = new Set(Array.from(porCidade.keys()).map(normalizarCidade));
    const cidadesSemCliente = (area.cidades ?? [])
      .map(n => n.replace(/\s*-\s*[A-Za-z]{2}\s*$/, "").trim())
      .filter(n => !comCliente.has(normalizarCidade(n)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    return {
      origemArea: area.origem,
      semCoordenada,
      coordenadaSuspeita: suspeitos.map(p => ({ id: p.id, cidade: p.cidade, lat: p.lat, lon: p.lon })),
      cidades: Array.from(porCidade.values()).sort((a, b) => b.clientes - a.clientes),
      cidadesSemCliente,
      pontos: coerentes,
      bairros,
    };
  }
}
