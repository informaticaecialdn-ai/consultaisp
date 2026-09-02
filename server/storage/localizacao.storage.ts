import { eq } from "drizzle-orm";
import { db } from "../db";
import { customers, providers } from "@shared/schema";
import { resolverAreaAtendida, normalizarCidade, type OrigemArea } from "../services/area-atendida";
import { estadoDoPonto, type EstadoPonto } from "../services/estado-ponto";
import {
  separarCoordenadasSuspeitas, centroMediano, RAIO_MAX_KM, MIN_PONTOS_CIDADE,
} from "../services/coordenada-suspeita";
import { coordenadaValida } from "../services/coordenada";
import { criarAgrupadorDeBairro, criarCasadorDeBairro, normalizarLocalidade } from "../services/localidade";
import { carregarTerritorio, carregarCaixasMunicipio } from "../services/geo-bases.service";
import { geocodeAddress } from "../services/geocoding";

export interface LocalizacaoPonto {
  id: number;
  /**
   * Nome do cliente, para o popup do ponto. E a carteira PROPRIA do provedor,
   * a mesma que ele ve com nome em /inadimplentes — o mapa de cobranca sem
   * saber quem e o ponto nao serve para cobrar. Continua sem CPF: a tela nao
   * precisa dele.
   */
  nome: string;
  lat: number; lon: number;
  estado: EstadoPonto; emAberto: number; atraso: number;
  bairro: string | null; cidade: string;
}

export interface LocalizacaoBairro {
  bairro: string; cidade: string;
  clientes: number; inadimplentes: number; exComDivida: number;
  pctInadimplencia: number; dividaTotal: number;
  /** Clientes que ainda sao seus: ativos + suspensos. Numerador da penetracao. */
  atuais: number;
  /**
   * Territorio — vem das bases publicas (IBGE CNEFE, ANEEL BDGD). Enquanto elas
   * nao estiverem carregadas, os quatro sao null e a tela mostra "—" em vez de
   * um numero inventado. E a mesma doutrina da referencia: numero impossivel de
   * calcular e suprimido no servidor, nunca fabricado no cliente.
   */
  hps: number | null;
  ucsVivas: number | null;
  pctPenetracao: number | null;
  /** Inadimplencia media da regiao entre provedores. So sai com k-anonimato >= 3. */
  benchmarkPct: number | null;
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

export interface LocalizacaoSede {
  cidade: string;
  uf: string | null;
  lat: number | null;
  lon: number | null;
  /** A sede fica fora das cidades atendidas — comum, a matriz costuma ser numa capital regional. */
  foraDaArea: boolean;
}

/**
 * Cidade com menos clientes que isto nao entra no mapa da carteira.
 *
 * Nao e area de atuacao — e endereco avulso: cliente que mudou de cidade,
 * cobranca com endereco de escritorio, cadastro com a capital digitada por
 * engano. Plotar os 6 clientes espalhados por 37 cidades esticaria o mapa do
 * Parana a Brasilia e afundaria a praca real em zoom.
 */
export const MIN_CLIENTES_CIDADE = 20;

/** Uma cidade da carteira e a razao de ela estar ou nao no mapa. */
export interface LocalizacaoCidadeCatalogo {
  cidade: string;
  clientes: number;
  inadimplentes: number;
  noMapa: boolean;
  /** massa = passou o piso · poucos = abaixo dele · excluida = o provedor tirou. */
  motivo: 'massa' | 'poucos' | 'excluida';
}

export interface LocalizacaoResposta {
  origemArea: OrigemArea;
  /** Endereco cadastrado do provedor: ancora o mapa e marca o ponto de partida. */
  sede: LocalizacaoSede | null;
  semCoordenada: number;
  /**
   * Subconjunto de semCoordenada que a plotagem automatica consegue resolver —
   * tem cidade ou CEP no cadastro. O resto so o provedor corrige no ERP.
   * Sai da MESMA varredura que semCoordenada de proposito: contar isto noutra
   * query, com outro recorte territorial, punha dois numeros discordantes na
   * mesma tela.
   */
  plotaveis: number;
  /** Coordenada incoerente com a cidade declarada — fica fora do mapa. */
  coordenadaSuspeita: Array<{ id: number; cidade: string; lat: number; lon: number }>;
  cidades: LocalizacaoCidade[];
  /** Cidades na area declarada que ainda nao tem nenhum cliente. */
  cidadesSemCliente: string[];
  /**
   * Clientes da carteira que o recorte territorial DEIXOU DE FORA.
   *
   * Existe para a tela poder dizer o que nao esta mostrando. Sem isto o mapa
   * anunciava "1.272 de 1.272 pontos" com 1.667 clientes escondidos numa cidade
   * nao declarada, e o provedor lia aquilo como "nao tenho cliente la".
   */
  foraDoMapa: number;
  /** As cidades desses clientes, da maior para a menor. */
  cidadesForaDoMapa: Array<{ cidade: string; clientes: number; inadimplentes: number }>;
  /**
   * Toda cidade da carteira, com o porque de estar ou nao no mapa.
   *
   * E o que permite a tela oferecer a acao certa em cada linha: "remover" para
   * quem esta no mapa, "voltar ao mapa" para quem o provedor tirou, e nada para
   * quem tem cliente de menos — ali nao ha o que decidir.
   */
  catalogoCidades: LocalizacaoCidadeCatalogo[];
  pontos: LocalizacaoPonto[];
  bairros: LocalizacaoBairro[];
  /**
   * Legenda do mapa: SO quem tem fatura em aberto, que e o universo plotado.
   *
   * `em_dia` fica sempre em zero e nao aparece na tela. O mapa e de bureau —
   * mostra quem deve, nao a base saudavel do provedor.
   *
   * Conta inclusive quem esta sem coordenada: "quantos ex-clientes com divida
   * eu tenho" nao muda porque o cadastro de alguns esta incompleto.
   */
  porEstado: Record<EstadoPonto, number>;
  /** Quando a carteira foi lida do ERP pela ultima vez. A tela mostra numeros
   *  derivados desta data; sem dizer isso, o operador le como tempo real. */
  sincronizadoEm: string | null;
}

export class LocalizacaoStorage {
  /**
   * Endereco cadastrado do provedor, geocodificado. Vale a pena mesmo quando a
   * sede esta fora das cidades atendidas — e o ponto de referencia que o
   * operador conhece, e ancora a leitura do mapa.
   * geocodeAddress ja tem cache em memoria; falha de rede devolve null e a tela
   * segue sem a sede, nunca quebra por causa dela.
   */
  private async buscarSede(providerId: number, area: Awaited<ReturnType<typeof resolverAreaAtendida>>) {
    const [p] = await db.select().from(providers).where(eq(providers.id, providerId));
    if (!p?.addressCity) return null;

    const uf = p.addressState || null;
    const coords = await geocodeAddress(
      [p.addressStreet, p.addressNumber].filter(Boolean).join(", "),
      p.addressCity,
      uf || "",
      p.addressZip || undefined,
    ).catch(() => null);

    const naArea = (area.cidades ?? []).some(
      c => normalizarCidade(c) === normalizarCidade(p.addressCity),
    );

    return {
      cidade: p.addressCity,
      uf,
      lat: coords ? coords[0] : null,
      lon: coords ? coords[1] : null,
      foraDaArea: (area.cidades?.length ?? 0) > 0 && !naArea,
    };
  }

  /**
   * Preenche o território de cada bairro a partir das bases públicas.
   *
   * O bairro do ERP é texto livre e o do censo é oficial — o casamento vai por
   * cascata (exato → núcleo sem prefixo de loteamento → fuzzy), a mesma do
   * agrupamento do ranking.
   *
   * A regra que sustenta o bloco inteiro: **penetração acima de 100% não é
   * dado, é erro de casamento**, e é suprimida aqui, no servidor. Bairro do ERP
   * que casou com um recorte diferente do censo produziria "250% de penetração"
   * — o operador precisa ver "—", não um número que o faria desistir de vender
   * numa rua onde ele tem dois clientes. HPs e UCs continuam aparecendo: é o que
   * permite reconhecer o match divergente na tela.
   */
  private async aplicarTerritorio(bairros: LocalizacaoBairro[]): Promise<void> {
    if (bairros.length === 0) return;

    const cidades = Array.from(new Set(bairros.map(b => normalizarLocalidade(b.cidade)))).filter(Boolean);
    const territorio = await carregarTerritorio(cidades);
    if (territorio.size === 0) return;

    const casadores = new Map<string, { hps: ReturnType<typeof criarCasadorDeBairro>; ucs: ReturnType<typeof criarCasadorDeBairro> }>();

    for (const b of bairros) {
      const cidadeNorm = normalizarLocalidade(b.cidade);
      const t = territorio.get(cidadeNorm);
      if (!t) continue;

      let c = casadores.get(cidadeNorm);
      if (!c) {
        // Ordenado por tamanho: em empate no fuzzy, vence o bairro dominante.
        const ordenar = (m: Map<string, number>) =>
          Array.from(m.entries()).sort((x, y) => y[1] - x[1]).map(([k]) => k);
        c = { hps: criarCasadorDeBairro(ordenar(t.hps)), ucs: criarCasadorDeBairro(ordenar(t.ucs)) };
        casadores.set(cidadeNorm, c);
      }

      // As duas bases são casadas de forma independente: bater no CNEFE não
      // garante bater na ANEEL, e vice-versa.
      const mHps = c.hps(b.bairro);
      const mUcs = c.ucs(b.bairro);
      if (mHps) b.hps = t.hps.get(mHps.canonico) ?? null;
      if (mUcs) b.ucsVivas = t.ucs.get(mUcs.canonico) ?? null;

      // UC energizada é o denominador que importa; o censo entra como reserva.
      const denominador = b.ucsVivas ?? b.hps;
      if (denominador !== null && denominador > 0) {
        const bruta = (b.atuais / denominador) * 100;
        b.pctPenetracao = bruta <= 100 ? Math.round(bruta * 10) / 10 : null;
      }
    }
  }

  /**
   * Uma varredura da carteira produz os conjuntos que a tela precisa.
   * O recorte territorial vem da cascata — nunca mais de providers.addressState
   * sozinho, que nao filtrava nada quando a UF era nula.
   */
  async getLocalizacao(providerId: number): Promise<LocalizacaoResposta> {
    const area = await resolverAreaAtendida(providerId);
    const [prov] = await db.select().from(providers).where(eq(providers.id, providerId));
    const sede = await this.buscarSede(providerId, area);

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

    const dentroDaArea = (c: { city: string | null; state: string | null }) => {
      if (cidadesAlvo) return cidadesAlvo.has(normalizarCidade(c.city));
      if (ufAlvo) return (c.state || "").toUpperCase() === ufAlvo;
      return true;
    };

    /*
     * O MAPA DA CARTEIRA MOSTRA A CARTEIRA — nao a area declarada.
     *
     * Filtrava por `cidades_atendidas`, e isso escondia cliente do proprio
     * provedor. A NsLink tem 1.667 clientes em Ibipora e uma cidade declarada
     * (Londrina): o mapa mostrava 1.272 pontos e dizia "1.272 de 1.272",
     * afirmando completude com 60% da carteira fora. Avisar que estavam fora
     * nao resolve — eles precisam APARECER.
     *
     * A area declarada continua valendo onde faz sentido: no mapa da REDE
     * (/api/localizacao/rede), que mostra dado de OUTROS provedores e ai sim
     * precisa de recorte, e em `cidadesSemCliente`, que e cobertura declarada
     * sem venda.
     *
     * O corte aqui e por MASSA, nao por declaracao: cidade com menos de 20
     * clientes nao entra no mapa. Nao e area de atuacao — e endereco avulso,
     * cliente que mudou, cobranca com endereco de escritorio. Plotar os 6
     * clientes espalhados por 37 cidades esticaria o mapa do Parana a Brasilia
     * e afundaria a praca real em zoom.
     */
    const porCidadeBruta = new Map<string, { nome: string; clientes: number; inadimplentes: number }>();
    for (const c of todos) {
      const k = normalizarCidade(c.city);
      if (!k) continue;
      const e = porCidadeBruta.get(k) ?? { nome: (c.city || "").trim(), clientes: 0, inadimplentes: 0 };
      e.clientes++;
      if (c.paymentStatus === "overdue") e.inadimplentes++;
      porCidadeBruta.set(k, e);
    }

    /*
     * A ESCOLHA DO PROVEDOR VENCE O CORTE AUTOMATICO.
     *
     * O piso de massa acerta na maioria, mas erra num caso comum: o endereco de
     * cobranca numa capital junta dezenas de clientes, passa o piso e nao e
     * praca. Na NsLink e Curitiba — 43 clientes, zero inadimplentes.
     *
     * Regra so no servidor, nunca no cliente: cidade entra no mapa se tiver
     * massa E nao estiver na lista de excluidas.
     */
    const excluidas = new Set(
      (prov?.cidadesExcluidasDoMapa ?? []).map(normalizarCidade).filter(Boolean),
    );

    const cidadesDoMapa = new Set(
      Array.from(porCidadeBruta.entries())
        .filter(([k, v]) => v.clientes >= MIN_CLIENTES_CIDADE && !excluidas.has(k))
        .map(([k]) => k),
    );

    const noMapa = (c: { city: string | null }) => cidadesDoMapa.has(normalizarCidade(c.city));
    const naArea = todos.filter(noMapa);

    /*
     * O CATALOGO DE CIDADES — o que a tela precisa para deixar escolher.
     *
     * Sai da MESMA varredura, por classificacao: `motivo` diz POR QUE a cidade
     * esta ou nao no mapa, e e o que permite a tela oferecer a acao certa —
     * "remover" para quem esta, "voltar ao mapa" para quem o provedor tirou, e
     * nada para quem tem cliente de menos, porque nao ha o que decidir ali.
     */
    const catalogoCidades: LocalizacaoCidadeCatalogo[] = Array.from(porCidadeBruta.entries())
      .map(([k, v]) => ({
        cidade: v.nome || "Sem cidade",
        clientes: v.clientes,
        inadimplentes: v.inadimplentes,
        noMapa: cidadesDoMapa.has(k),
        motivo: excluidas.has(k)
          ? ("excluida" as const)
          : v.clientes < MIN_CLIENTES_CIDADE
            ? ("poucos" as const)
            : ("massa" as const),
      }))
      .sort((a, b) => b.clientes - a.clientes);

    const foraLista = todos.filter(c => !noMapa(c));
    const cidadesForaDoMapa = catalogoCidades
      .filter(c => !c.noMapa)
      .map(({ cidade, clientes, inadimplentes }) => ({ cidade, clientes, inadimplentes }));

    const pontos: LocalizacaoPonto[] = [];
    let semCoordenada = 0;
    let plotaveis = 0;
    let sincronizadoEm: Date | null = null;
    const porEstado: Record<EstadoPonto, number> = {
      em_dia: 0, em_cobranca: 0, suspenso: 0, ex_divida: 0,
    };
    const porCidade = new Map<string, LocalizacaoCidade>();
    const porBairro = new Map<string, LocalizacaoBairro>();
    // O bairro chega do ERP como texto livre. Sem agrupar as variacoes,
    // "Jd. Bandeirantes" e "JARDIM BANDEIRANTES" viram duas linhas do ranking,
    // cada uma com metade da carteira — e a metade menor sobe ao topo com uma
    // taxa de inadimplencia que nao descreve lugar nenhum. Um agrupador POR
    // CIDADE: bairros homonimos em cidades diferentes sao lugares diferentes.
    const agrupadores = new Map<string, ReturnType<typeof criarAgrupadorDeBairro>>();

    for (const c of naArea) {
      const cidade = canonizar(c.city);
      const ct = porCidade.get(cidade) || {
        cidade, clientes: 0, inadimplentes: 0, dividaTotal: 0, lat: null, lon: null,
      };
      ct.clientes++;

      const estado = estadoDoPonto(c);
      if (c.lastSyncAt && (!sincronizadoEm || c.lastSyncAt > sincronizadoEm)) {
        sincronizadoEm = c.lastSyncAt;
      }
      const emAberto = Number(c.totalOverdueAmount || 0) || 0;

      // A legenda descreve o MAPA, e o mapa so tem quem deve — ver o corte
      // adiante. Contar a carteira inteira aqui poria "Ativo em dia 980" numa
      // legenda de pontos onde nenhum adimplente aparece.
      //
      // Conta mesmo quem esta sem coordenada, de proposito: "quantos ex-clientes
      // com divida eu tenho" nao muda porque o cadastro de alguns esta
      // incompleto.
      if (emAberto > 0) porEstado[estado]++;

      let agrupador = agrupadores.get(cidade);
      if (!agrupador) { agrupador = criarAgrupadorDeBairro(); agrupadores.set(cidade, agrupador); }
      const grupo = agrupador.agrupar(c.neighborhood);
      const bairro = grupo?.rotulo || "Sem bairro";

      const chave = `${cidade.toUpperCase()}||${grupo?.chave ?? "SEM BAIRRO"}`;
      const b = porBairro.get(chave) || {
        bairro, cidade, clientes: 0, inadimplentes: 0, exComDivida: 0,
        pctInadimplencia: 0, dividaTotal: 0, atuais: 0,
        hps: null, ucsVivas: null, pctPenetracao: null, benchmarkPct: null,
      };
      b.clientes++;
      if (emAberto > 0) { b.inadimplentes++; b.dividaTotal += emAberto; }
      if (estado === 'ex_divida') b.exComDivida++;
      // "Atuais" e quem ainda e seu: ativo ou suspenso por atraso.
      //
      // A conta olha o STATUS, nao o estado do ponto. `ex_divida` so existe
      // quando ha cancelamento E divida > 0, entao `estado !== 'ex_divida'`
      // contava como atual todo ex-cliente que ja quitou — 1.380 dos 2.633
      // cancelados da NsLink em 28/08/2026. A penetracao por bairro saia inflada
      // justamente onde o provedor mais perdeu cliente.
      const situacao = (c.status || "").toLowerCase();
      if (situacao !== 'cancelled' && situacao !== 'inactive') b.atuais++;
      porBairro.set(chave, b);

      if (emAberto > 0) { ct.inadimplentes++; ct.dividaTotal += emAberto; }
      porCidade.set(cidade, ct);

      // Mesma regua da escrita (server/services/coordenada.ts). Antes a leitura
      // tinha a sua propria: coordenada fora do Brasil era barrada na gravacao
      // e aceita aqui, entao entrava no mapa por uma porta que a outra fechava.
      const valida = coordenadaValida(c.latitude, c.longitude);
      if (!valida) {
        semCoordenada++;
        // Mesmo criterio de TEM_ENDERECO no backfill: cidade ou CEP resolvem;
        // rua sozinha existe em mil cidades e nao geocodifica.
        if ((c.city || "").trim() || (c.cep || "").trim()) plotaveis++;
        continue;
      }

      /*
       * SO QUEM DEVE VAI AO MAPA — e isto e regra de bureau, nao de tela.
       *
       * O sistema e um bureau de credito: provedores compartilham dado de
       * inadimplencia entre si. Plotar cliente ATIVO EM DIA transformaria o
       * mapa noutra coisa — um retrato da base saudavel do provedor, que e o
       * ativo comercial dele e nao tem por que existir aqui. Dono de provedor
       * desconfia disso com razao, e a desconfianca derruba a adesao, que e o
       * que faz o bureau valer alguma coisa.
       *
       * O criterio e ter fatura em aberto, nao o rotulo de estado: entra quem
       * deve, seja ativo, suspenso ou ex-cliente. Suspenso sem divida fica de
       * fora junto com o adimplente.
       *
       * As ESTATISTICAS acima continuam varrendo a carteira inteira, e tem de
       * continuar: a taxa de inadimplencia do bairro precisa do denominador
       * completo. Contar so os plotados daria 100% em todo lugar.
       *
       * LGPD: sem nome e sem CPF — a tela nao precisa deles. O bairro sai
       * agrupado, o mesmo rotulo do ranking: clicar numa linha do ranking e ver
       * o mapa destacar outro conjunto seria mentir sobre o filtro.
       */
      if (emAberto <= 0) continue;

      pontos.push({
        id: c.id, nome: (c.name || "").trim() || "Sem nome",
        lat: valida.lat, lon: valida.lng, estado, emAberto,
        atraso: c.maxDaysOverdue || 0, bairro: grupo ? bairro : null, cidade,
      });
    }

    // Uma casa decimal, arredondada AQUI: o cliente so formata. Duas telas
    // arredondando o mesmo numero por conta propria acabam discordando.
    const bairros = Array.from(porBairro.values()).map(b => ({
      ...b,
      pctInadimplencia: b.clientes > 0 ? Math.round((b.inadimplentes / b.clientes) * 1000) / 10 : 0,
      dividaTotal: Math.round(b.dividaTotal * 100) / 100,
    }));

    await this.aplicarTerritorio(bairros);

    // Um ponto errado a centenas de km estica o enquadramento e a tela abre
    // numa regiao onde o provedor nao atende. Fora do mapa, mas contado — e
    // um defeito de cadastro que o provedor precisa ver para corrigir no ERP.
    // A caixa do municipio vem do CNEFE do IBGE e e a regua boa; o raio da
    // mediana fica de reserva para cidade sem base carregada. As chaves saem em
    // caixa alta porque e assim que o detector agrupa por cidade.
    const caixasPorNome = await carregarCaixasMunicipio(
      Array.from(new Set(pontos.map(p => normalizarLocalidade(p.cidade)))).filter(Boolean),
    );
    const caixas = new Map(
      Array.from(caixasPorNome.entries()).flatMap(([nome, cx]) => {
        // O detector chaveia pelo rotulo exibido em caixa alta ("IBIPORÃ"),
        // e a base normaliza sem acento ("IBIPORA"). Indexa pelos dois.
        const exibidos = pontos
          .map(p => (p.cidade || "").trim().toUpperCase())
          .filter(rotulo => normalizarLocalidade(rotulo) === nome);
        return Array.from(new Set([nome, ...exibidos])).map(k => [k, cx] as const);
      }),
    );

    const { coerentes, suspeitos } = separarCoordenadasSuspeitas(
      pontos, RAIO_MAX_KM, MIN_PONTOS_CIDADE, caixas,
    );

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
      sede,
      semCoordenada,
      plotaveis,
      coordenadaSuspeita: suspeitos.map(p => ({ id: p.id, cidade: p.cidade, lat: p.lat, lon: p.lon })),
      cidades: Array.from(porCidade.values()).sort((a, b) => b.clientes - a.clientes),
      cidadesSemCliente,
      foraDoMapa: foraLista.length,
      cidadesForaDoMapa,
      catalogoCidades,
      pontos: coerentes,
      // Ordem de chegada do ranking: pior taxa primeiro, e em empate a maior
      // divida. E a ordem que o "bairro campeao" assume ao desempatar.
      bairros: bairros.sort((a, b) =>
        b.pctInadimplencia - a.pctInadimplencia || b.dividaTotal - a.dividaTotal),
      porEstado,
      sincronizadoEm: sincronizadoEm ? (sincronizadoEm as Date).toISOString() : null,
    };
  }
}
