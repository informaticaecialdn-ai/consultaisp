import { describe, expect, it, vi } from "vitest";

/**
 * O índice de logradouros da carteira, e a guarda que o torna aceitável.
 *
 * Os números que aparecem aqui foram MEDIDOS na Amplinet (provedor 6) em
 * 04/09/2026 e são o que justifica cada decisão: 86 clientes fora do mapa, 25
 * deles numa rua que já tem vizinho plotado, dispersão mediana das ruas 136 m,
 * máxima 3.766 m. A rua de 136 m e a estrada de 3.766 m são os dois casos que
 * este arquivo existe para separar — um é praticamente a casa, o outro não é a
 * casa de ninguém.
 *
 * ── O QUE MUDOU DEPOIS DA CONFERÊNCIA ─────────────────────────────────────
 * A primeira versão tinha uma guarda só: dois pontos conhecidos e dispersão até
 * 300 m. Ela media a AMOSTRA, não a rua — dois vizinhos colados numa estrada de
 * 4 km dão dispersão de metros, a guarda aprova, e o cliente que mora
 * quilômetros adiante recebe a mediana dos dois. Nada no módulo dizia onde ESSE
 * cliente está na rua, então a guarda nunca era consultada sobre ele.
 *
 * Agora há duas portas, e os testes abaixo cobrem as duas:
 *   · CERCO POR NÚMERO — prova de que o cliente está entre dois conhecidos.
 *   · AMOSTRA — sem número, quatro lugares distintos dentro de 150 m.
 */

const consultas = vi.hoisted(() => ({ where: [] as unknown[], linhas: [] as any[] }));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          consultas.where.push(cond);
          return Promise.resolve(consultas.linhas);
        },
      }),
    }),
  },
  pool: {},
}));

import { PgDialect } from "drizzle-orm/pg-core";
import {
  abrirIndiceDaCarteira, avaliarVizinho, chaveDaRua, dispersaoMaximaM, filtroDaCarteira,
  montarIndice, partesDaRua, resolverPorVizinho,
  MIN_LUGARES_SEM_CERCO, PROCEDENCIAS_DO_INDICE, PRECISAO_VIZINHO,
  TETO_DISPERSAO_M, TETO_SEM_CERCO_M,
  type LinhaPlotada,
} from "./vizinho-de-rua.service";

/** Embu-Guaçu/SP — a região onde os 86 clientes sem ponto foram medidos. */
const BASE: [number, number] = [-23.8300, -46.8110];
const M_POR_GRAU_LAT = 111_320;

/** Um ponto a `metros` ao norte da base. */
const aoNorte = (metros: number): [number, number] => [BASE[0] + metros / M_POR_GRAU_LAT, BASE[1]];

let proximoId = 1;
const linha = (
  cidade: string, endereco: string, ponto: [number, number],
  extra: Partial<LinhaPlotada> = {},
): LinhaPlotada => ({
  id: proximoId++,
  providerId: 6,
  address: endereco,
  city: cidade,
  state: "SP",
  latitude: String(ponto[0]),
  longitude: String(ponto[1]),
  ...extra,
});

const indiceCom = (...linhas: LinhaPlotada[]) => montarIndice(6, linhas);

/** Um cliente da carteira procurando vizinho. Sem nome, sem documento. */
const cliente = (over: Record<string, any> = {}) => ({
  id: 10_001, city: "Embu-Guaçu", state: "SP", address: "RUA JOSE SECHI", ...over,
});

describe("chaveDaRua", () => {
  it("colapsa as grafias que o ERP grava para a mesma rua", () => {
    const canonica = chaveDaRua("Embu-Guaçu", "SP", "RUA JOSE SECHI");
    expect(chaveDaRua("EMBU GUACU", "sp", "R. José Sechi")).toBe(canonica);
    expect(chaveDaRua("embu  guacu", "SP", "Rua Jose Sechi, 240")).toBe(canonica);
    expect(canonica).toBe("SP|embu guacu|RUA JOSE SECHI");
  });

  it("sem cidade ou sem logradouro não há chave", () => {
    expect(chaveDaRua("", "SP", "RUA JOSE SECHI")).toBe("");
    expect(chaveDaRua("Embu-Guaçu", "SP", "")).toBe("");
    expect(chaveDaRua(null, null, null)).toBe("");
  });

  /* O Brasil tem centenas de municípios homônimos em estados diferentes, e
     `normalizarCidade` REMOVE o sufixo " - UF" de propósito antes de comparar.
     Sem a UF na chave, um provedor com carteira nos dois lados de uma divisa
     plotaria o cliente de uma "RUA CENTRAL" sobre a homônima do outro estado. */
  it("município homônimo em estados diferentes não é a mesma rua", () => {
    expect(chaveDaRua("Bom Jesus - PR", "PR", "RUA CENTRAL"))
      .not.toBe(chaveDaRua("Bom Jesus - SC", "SC", "RUA CENTRAL"));
  });

  /* Ausência de UF não é prova de que é o mesmo estado. Custa casamentos num
     cadastro preenchido pela metade; evita plotar a centenas de quilômetros. */
  it("UF vazia não casa com UF preenchida", () => {
    expect(chaveDaRua("Bom Jesus", "", "RUA CENTRAL"))
      .not.toBe(chaveDaRua("Bom Jesus", "PR", "RUA CENTRAL"));
  });
});

describe("marco de via — o número que não é número de casa", () => {
  /* O DEFEITO: `separarLogradouroENumero` arranca o último número como se fosse
     a casa, então os dois quilômetros da mesma estrada viravam a MESMA chave. A
     guarda de dispersão não salva, porque ela mede os pontos CONHECIDOS: duas
     instalações no KM 5 dão dispersão de metros e o cliente do KM 22 vai para
     17 km de casa. É a forma de endereço exata da população que esta fonte
     existe para atender — estradas e chácaras peri-urbanas. */
  it("KM 5 e KM 22 da mesma estrada são ruas diferentes", () => {
    const km5 = chaveDaRua("Embu-Guaçu", "SP", "ESTRADA DO PINHAL KM 5");
    const km22 = chaveDaRua("Embu-Guaçu", "SP", "ESTRADA DO PINHAL KM 22");
    expect(km5).not.toBe(km22);
    expect(km5).toContain("ESTRADA DO PINHAL KM 5");
  });

  it("a mesma quilometragem escrita de outro jeito continua sendo a mesma", () => {
    expect(chaveDaRua("Embu-Guaçu", "SP", "Estrada do Pinhal, km. 05"))
      .toBe(chaveDaRua("Embu-Guaçu", "SP", "ESTRADA DO PINHAL KM 5"));
  });

  /* Aqui o número é o NOME da via. Sem isto, "RODOVIA PR 445" e "RODOVIA PR
     376" viravam a mesma chave "RODOVIA PR". */
  it("código de rodovia fica na chave: PR 445 não é PR 376", () => {
    expect(chaveDaRua("Ibaiti", "PR", "RODOVIA PR 445"))
      .not.toBe(chaveDaRua("Ibaiti", "PR", "RODOVIA PR 376"));
    expect(chaveDaRua("Ibaiti", "PR", "RODOVIA PR 445 KM 7"))
      .not.toBe(chaveDaRua("Ibaiti", "PR", "RODOVIA PR 445 KM 20"));
  });

  /* E o contrário, que é o que impede o conserto de virar outro defeito: numa
     rua comum o último número É a casa, e separar por ele esfacelaria a rua em
     duzentas chaves — ninguém acharia vizinho nenhum. */
  it("numa rua comum o número final continua sendo a casa", () => {
    expect(chaveDaRua("Embu-Guaçu", "SP", "RUA SAO PAULO, 250"))
      .toBe(chaveDaRua("Embu-Guaçu", "SP", "RUA SAO PAULO, 1180"));
    expect(chaveDaRua("Embu-Guaçu", "SP", "ESTRADA DA BARRA, 1200"))
      .toBe(chaveDaRua("Embu-Guaçu", "SP", "ESTRADA DA BARRA, 1300"));
  });

  it("o quilômetro não é lido como número da casa", () => {
    expect(partesDaRua("ESTRADA DO PINHAL KM 22").numero).toBeNull();
    expect(partesDaRua("ESTRADA DO PINHAL KM 22", "1200").numero).toBe(1200);
  });

  /* "KM 12" sem via não identifica nada: casar dois cadastros assim juntaria
     clientes de rodovias diferentes no mesmo ponto. Com o código da rodovia,
     identifica — e vale como chave. */
  it("quilômetro sem via não vira rua; com código de rodovia, vira", () => {
    expect(chaveDaRua("Ibaiti", "PR", "KM 12")).toBe("");
    expect(chaveDaRua("Ibaiti", "PR", "BR 153 KM 12")).toContain("BR 153 KM 12");
  });
});

describe("rua numerada — o outro número que não é da casa", () => {
  /* O MESMO defeito do KM, na forma urbana mais comum do país: "RUA 7, 250" era
     partido no 7, o que colapsava TODAS as ruas numeradas da cidade na chave
     "RUA" e ainda punha o número da RUA no lugar do número da casa — que é o
     que o cerco lê. Duas instalações na Rua 7 acabariam cercando um cliente da
     Rua 12. Rua numerada é a regra em periferia e loteamento rural, que é a
     população que esta fonte atende. */
  it("RUA 7 e RUA 12 são ruas diferentes, e o número da casa é o outro", () => {
    expect(chaveDaRua("Ibaiti", "PR", "RUA 7, 250")).not.toBe(chaveDaRua("Ibaiti", "PR", "RUA 12, 380"));
    expect(partesDaRua("RUA 7, 250")).toEqual({ logradouro: "RUA 7", numero: 250 });
    expect(partesDaRua("TRAVESSA 2, 30")).toEqual({ logradouro: "TRAVESSA 2", numero: 30 });
  });

  it("rua numerada sem número de casa não inventa número", () => {
    expect(partesDaRua("Rua 7")).toEqual({ logradouro: "RUA 7", numero: null });
    expect(partesDaRua("Rua 7", "250")).toEqual({ logradouro: "RUA 7", numero: 250 });
  });

  /* E o complemento não vira número: era o motivo de a régua antiga aceitar um
     rabo depois do número, e é o caso que a nova precisa continuar acertando. */
  it("complemento depois do número não confunde", () => {
    expect(partesDaRua("Rua Brasil, 1234 - apto 2")).toEqual({ logradouro: "RUA BRASIL", numero: 1234 });
  });

  it("nome de rua com número no meio continua inteiro", () => {
    expect(partesDaRua("Rua 15 de Novembro, 100"))
      .toEqual({ logradouro: "RUA 15 DE NOVEMBRO", numero: 100 });
  });

  /* A prova de que isto importa para a guarda, e não só para a chave: sem o
     conserto, os dois pontos da Rua 7 (nos números 7 e 12, lidos como casas)
     cercariam o cliente da Rua 12 e o plotariam na rua errada. */
  it("cliente da RUA 12 não é cercado por instalações da RUA 7", () => {
    const indice = indiceCom(
      linha("Ibaiti", "RUA 7, 100", aoNorte(0), { state: "PR" }),
      linha("Ibaiti", "RUA 7, 400", aoNorte(80), { state: "PR" }),
    );
    const naRua12 = cliente({ city: "Ibaiti", state: "PR", address: "RUA 12, 250" });
    expect(avaliarVizinho(naRua12, indice).motivo).toBe("rua-desconhecida");
    // E o da própria Rua 7, esse sim, é cercado.
    expect(avaliarVizinho(cliente({ city: "Ibaiti", state: "PR", address: "RUA 7, 250" }), indice).acerto)
      .not.toBeNull();
  });
});

describe("porta 1 — cerco por número", () => {
  /** Rua com dois conhecidos, nos números e nas distâncias dadas. */
  const ruaCom = (aM: number, aNum: string, bM: number, bNum: string) => indiceCom(
    linha("Embu-Guaçu", `RUA JOSE SECHI, ${aNum}`, aoNorte(aM)),
    linha("Embu-Guaçu", `RUA JOSE SECHI, ${bNum}`, aoNorte(bM)),
  );

  it("rua curta com o cliente cercado resolve, e o ponto fica entre os cercadores", () => {
    // 136 m é a dispersão MEDIANA das ruas medidas: o caso típico.
    const r = avaliarVizinho(cliente({ address: "R. José Sechi, 250" }), ruaCom(0, "100", 136, "400"));

    expect(r.motivo).toBeNull();
    expect(r.acerto).not.toBeNull();
    expect(r.acerto!.precisao).toBe(PRECISAO_VIZINHO);
    expect(r.acerto!.porta).toBe("cerco");
    expect(r.acerto!.vizinhos).toBe(2);
    expect(r.acerto!.dispersaoM).toBeGreaterThan(130);
    expect(r.acerto!.dispersaoM).toBeLessThan(142);
    expect(r.acerto!.lat).toBeGreaterThan(aoNorte(0)[0]);
    expect(r.acerto!.lat).toBeLessThan(aoNorte(136)[0]);
  });

  it("estrada de 3.766 m NÃO resolve — não é a casa de ninguém", () => {
    // O máximo medido na carteira. É o caso que a guarda existe para recusar.
    const r = avaliarVizinho(cliente({ address: "ESTRADA DA BARRA, 250" }), indiceCom(
      linha("Embu-Guaçu", "ESTRADA DA BARRA, 100", aoNorte(0)),
      linha("Embu-Guaçu", "ESTRADA DA BARRA, 400", aoNorte(3766)),
    ));
    expect(r.acerto).toBeNull();
    expect(r.motivo).toBe("cerco-largo");
  });

  it("o teto separa o cerco de 290 m do de 340 m", () => {
    expect(TETO_DISPERSAO_M).toBe(300);
    expect(avaliarVizinho(cliente({ address: "R. José Sechi, 250" }), ruaCom(0, "100", 290, "400")).acerto).not.toBeNull();
    expect(avaliarVizinho(cliente({ address: "R. José Sechi, 250" }), ruaCom(0, "100", 340, "400")).acerto).toBeNull();
  });

  /* O CASO QUE A CONFERÊNCIA APONTOU. Dois vizinhos a 78 m numa estrada longa:
     a dispersão passa com folga de 4×, mas o cliente do 4500 não está entre
     eles — e nada no cadastro diz que ele está perto. A regra antiga plotava;
     esta recusa. */
  it("cliente fora do intervalo conhecido é recusado, por mais colados que estejam os vizinhos", () => {
    const r = avaliarVizinho(cliente({ address: "ESTRADA DA BOA VISTA", addressNumber: "4500" }), indiceCom(
      linha("Embu-Guaçu", "ESTRADA DA BOA VISTA, 100", aoNorte(0)),
      linha("Embu-Guaçu", "ESTRADA DA BOA VISTA, 200", aoNorte(78)),
    ));
    expect(r.acerto).toBeNull();
    expect(r.motivo).toBe("fora-do-cerco");
  });

  /* E o ganho do mesmo raciocínio, na direção oposta: numa estrada de 3,7 km a
     regra antiga recusava TODO MUNDO, inclusive quem mora no trecho denso. O
     cerco mede o trecho do cliente, não a rua inteira. */
  it("num trecho conhecido de estrada longa, o cliente cercado resolve", () => {
    const r = avaliarVizinho(cliente({ address: "ESTRADA DA BARRA, 150" }), indiceCom(
      linha("Embu-Guaçu", "ESTRADA DA BARRA, 100", aoNorte(0)),
      linha("Embu-Guaçu", "ESTRADA DA BARRA, 200", aoNorte(120)),
      linha("Embu-Guaçu", "ESTRADA DA BARRA, 5000", aoNorte(3766)),
    ));
    expect(r.acerto?.porta).toBe("cerco");
    expect(r.acerto!.dispersaoM).toBeLessThan(130);
  });

  /* Mesmo número na mesma rua é o mesmo endereço — o prédio da Avenida Américo
     Deolindo Garla, 224, que já pôs 22 clientes na mesma coordenada
     legitimamente. Ali um ponto basta: não é amostra de rua, é o endereço. */
  it("mesmo número na mesma rua é o mesmo endereço, e um ponto basta", () => {
    const r = avaliarVizinho(cliente({ address: "AVENIDA AMERICO DEOLINDO GARLA", addressNumber: "224" }), indiceCom(
      linha("Embu-Guaçu", "AVENIDA AMERICO DEOLINDO GARLA, 224", aoNorte(0)),
    ));
    expect(r.acerto?.porta).toBe("cerco");
    expect(r.acerto!.vizinhos).toBe(1);
  });

  /* Coordenada idêntica em números diferentes não é a posição de nenhum dos
     dois: é a coordenada-padrão que alguns ERPs escrevem em todo mundo. Ela
     entra no índice como `erp` (a coerência só recusa além de 35 km do centro
     do município) e daria um cerco de trecho zero em rua de qualquer tamanho. */
  it("dois cercadores na mesma coordenada com números diferentes são recusados", () => {
    const r = avaliarVizinho(cliente({ address: "ESTRADA DA SERRA, 250" }), indiceCom(
      linha("Embu-Guaçu", "ESTRADA DA SERRA, 100", aoNorte(0)),
      linha("Embu-Guaçu", "ESTRADA DA SERRA, 400", aoNorte(0)),
    ));
    expect(r.acerto).toBeNull();
    expect(r.motivo).toBe("coordenada-repetida");
  });
});

describe("porta 2 — amostra, quando não há número para cercar", () => {
  const semNumero = (n: number, espalhamentoM: number) => indiceCom(
    ...Array.from({ length: n }, (_, i) =>
      linha("Embu-Guaçu", "VIELA DO CORREGO", aoNorte((espalhamentoM * i) / Math.max(1, n - 1)))),
  );

  it("quatro lugares dentro de 150 m resolvem; três não", () => {
    expect(MIN_LUGARES_SEM_CERCO).toBe(4);
    expect(TETO_SEM_CERCO_M).toBe(150);
    const r = avaliarVizinho(cliente({ address: "Viela do Córrego" }), semNumero(4, 120));
    expect(r.acerto?.porta).toBe("amostra");
    expect(r.acerto!.vizinhos).toBe(4);
    expect(avaliarVizinho(cliente({ address: "Viela do Córrego" }), semNumero(3, 120)).motivo).toBe("amostra-fraca");
  });

  /* Sem prova de contenção, a aposta paga o dobro em rigor: o teto é metade do
     que o cerco pode gastar. */
  it("quatro lugares espalhados por 200 m não bastam sem cerco", () => {
    expect(avaliarVizinho(cliente({ address: "Viela do Córrego" }), semNumero(4, 200)).motivo)
      .toBe("amostra-fraca");
  });

  /* O mesmo raciocínio que o módulo já aplicava ao ponto único: dispersão zero
     não é medida de rua curta, é ausência de medida. Quatro clientes na
     coordenada-padrão do ERP são UM lugar. */
  it("quatro clientes na mesma coordenada são um lugar só, não uma amostra", () => {
    const r = avaliarVizinho(cliente({ address: "Estrada da Serra" }), indiceCom(
      ...Array.from({ length: 4 }, () => linha("Embu-Guaçu", "ESTRADA DA SERRA", aoNorte(0))),
    ));
    expect(r.acerto).toBeNull();
    expect(r.motivo).toBe("amostra-fraca");
  });

  /* Um único número conhecido não forma intervalo e não contradiz nada — a rua
     ainda pode ser julgada pela amostra. Dois já formam, e aí o número manda. */
  it("um número conhecido só não fecha a porta da amostra", () => {
    const indice = indiceCom(
      linha("Embu-Guaçu", "VIELA DO CORREGO, 100", aoNorte(0)),
      linha("Embu-Guaçu", "VIELA DO CORREGO", aoNorte(40)),
      linha("Embu-Guaçu", "VIELA DO CORREGO", aoNorte(80)),
      linha("Embu-Guaçu", "VIELA DO CORREGO", aoNorte(120)),
    );
    expect(avaliarVizinho(cliente({ address: "VIELA DO CORREGO", addressNumber: "9000" }), indice).acerto?.porta)
      .toBe("amostra");
  });
});

describe("recusas que não dependem de guarda nenhuma", () => {
  const rua = () => indiceCom(
    linha("Embu-Guaçu", "RUA JOSE SECHI, 100", aoNorte(0)),
    linha("Embu-Guaçu", "RUA JOSE SECHI, 400", aoNorte(60)),
  );

  it("mesma rua em cidade diferente não casa — 'RUA SAO PAULO' existe em toda parte", () => {
    const indice = indiceCom(
      linha("Itapecerica da Serra", "RUA SAO PAULO, 100", aoNorte(0)),
      linha("Itapecerica da Serra", "RUA SAO PAULO, 400", aoNorte(80)),
    );
    expect(avaliarVizinho(cliente({ city: "Embu-Guaçu", address: "Rua São Paulo, 250" }), indice).motivo)
      .toBe("rua-desconhecida");
    expect(resolverPorVizinho(cliente({ city: "Itapecerica da Serra", address: "Rua São Paulo, 250" }), indice))
      .not.toBeNull();
  });

  it("cliente sem endereço ou sem cidade não resolve", () => {
    for (const c of [
      cliente({ address: null }), cliente({ address: "   " }),
      cliente({ city: null }), { id: 999 },
    ]) {
      expect(avaliarVizinho(c, rua()).motivo).toBe("sem-chave");
    }
  });

  it("rua desconhecida da carteira não resolve", () => {
    expect(avaliarVizinho(cliente({ address: "VIELA SEM NOME" }), rua()).motivo).toBe("rua-desconhecida");
  });

  it("o cliente não serve de vizinho de si mesmo", () => {
    // A fase de desempilhamento do backfill re-resolve quem JÁ tem coordenada;
    // sem o descarte por id o cliente casaria consigo e a pilha continuaria de pé.
    const eu = linha("Embu-Guaçu", "RUA JOSE SECHI, 250", aoNorte(0));
    const indice = indiceCom(eu);
    expect(avaliarVizinho({ ...cliente({ address: "RUA JOSE SECHI, 250" }), id: eu.id }, indice).motivo)
      .toBe("rua-desconhecida");
  });
});

/* ==================================================================== */
/* A carteira medida                                                    */
/* ==================================================================== */

describe("as 25 ruas candidatas da Amplinet", () => {
  /**
   * A distribuição medida em 04/09/2026, RECONSTRUÍDA a partir dos três números
   * publicados — não são as 25 dispersões reais, que não estão neste
   * repositório. O que a lista honra, e é o que o teste usa:
   *
   *     25 candidatos · mediana 136 m · máximo 3.766 m · 15 com até 300 m
   *
   * Qualquer outra lista que respeitasse os três números daria o mesmo
   * resultado, porque a guarda só compara cada dispersão com o teto.
   */
  const LETRA = "ABCDEFGHIJKLMNOPQRSTUVWXY";

  const DISPERSOES_M = [
    18, 27, 41, 55, 62, 78, 90, 104, 112, 121, 128, 133, 136,   // 13 até a mediana
    187, 264,                                                    // ainda sob o teto
    342, 410, 505, 680, 820, 1100, 1450, 2100, 2900, 3766,       // acima dele
  ];

  it("a lista é a medição: 25 candidatos, mediana 136 m, máximo 3.766 m", () => {
    expect(DISPERSOES_M).toHaveLength(25);
    expect([...DISPERSOES_M].sort((a, b) => a - b)[12]).toBe(136);
    expect(Math.max(...DISPERSOES_M)).toBe(3766);
  });

  /**
   * O NÚMERO DO ENUNCIADO. Cada rua tem dois conhecidos (nos números 100 e 400)
   * e o cliente no 250 — cercado, portanto, e julgado só pela geometria. Com o
   * teto de 300 m, exatamente 15 dos 25 entram no mapa.
   *
   * É o mesmo 15 da regra anterior, e de propósito: a guarda geométrica não
   * ficou mais apertada. O que mudou é que ela agora mede o trecho que CERCA o
   * cliente, e por isso precisa da prova de cerco — o teste seguinte mostra o
   * preço disso.
   */
  it("15 dos 25 resolvem quando o cliente está cercado", () => {
    const resolvidos = DISPERSOES_M.filter((d, i) => resolverPorVizinho(
      cliente({ address: `RUA MEDIDA ${LETRA[i]}, 250` }),
      indiceCom(
        linha("Embu-Guaçu", `RUA MEDIDA ${LETRA[i]}, 100`, aoNorte(0)),
        linha("Embu-Guaçu", `RUA MEDIDA ${LETRA[i]}, 400`, aoNorte(d)),
      ),
    ) !== null);

    expect(resolvidos).toHaveLength(15);
    expect(Math.max(...resolvidos)).toBe(264);
    expect(DISPERSOES_M.filter(d => d <= TETO_DISPERSAO_M)).toHaveLength(15);
  });

  /**
   * O PREÇO DA GUARDA, medido no mesmo conjunto: sem cerco — cliente sem número
   * no cadastro, ou número fora do intervalo conhecido —, nenhuma das 25 ruas
   * resolve com dois pontos, porque duas instalações não são amostra de rua.
   *
   * Quantos dos 25 clientes reais têm número cercado não dá para saber sem o
   * banco. Por isso o backfill passou a contar `recusasDoVizinho` por motivo:
   * uma passada em produção mede exatamente esta diferença.
   */
  it("sem cerco, os mesmos 25 não resolvem com dois pontos", () => {
    const comDoisPontos = (numeroDoCliente: string | undefined) =>
      DISPERSOES_M.filter((d, i) => resolverPorVizinho(
        cliente({ address: `RUA MEDIDA ${LETRA[i]}`, addressNumber: numeroDoCliente }),
        indiceCom(
          linha("Embu-Guaçu", `RUA MEDIDA ${LETRA[i]}, 100`, aoNorte(0)),
          linha("Embu-Guaçu", `RUA MEDIDA ${LETRA[i]}, 400`, aoNorte(d)),
        ),
      ) !== null);

    expect(comDoisPontos(undefined)).toHaveLength(0);   // cliente sem número
    expect(comDoisPontos("9000")).toHaveLength(0);      // número fora do intervalo
  });
});

describe("montarIndice", () => {
  it("descarta coordenada inválida: (0,0) e texto não são endereço", () => {
    const idx = montarIndice(6, [
      linha("Embu-Guaçu", "RUA JOSE SECHI", [0, 0]),
      { ...linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(0)), latitude: "sem", longitude: "coordenada" },
      linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(50)),
      linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(90)),
    ]);
    expect(idx.pontos).toBe(2);
    expect(idx.ruas.get("SP|embu guacu|RUA JOSE SECHI")).toHaveLength(2);
  });

  it("guarda o número da casa, que é o que sustenta o cerco", () => {
    const idx = montarIndice(6, [
      linha("Embu-Guaçu", "RUA JOSE SECHI, 240", aoNorte(0)),
      linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(50), { addressNumber: "380" }),
      linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(90)),
    ]);
    expect(idx.ruas.get("SP|embu guacu|RUA JOSE SECHI")!.map(p => p.numero)).toEqual([240, 380, null]);
  });

  it("linha de outro provedor não entra no índice — ela derruba a montagem", () => {
    // Vazamento de geolocalização entre tenants não pode degradar em silêncio:
    // se o filtro do SQL deixar de valer, isto precisa aparecer como exceção.
    expect(() => montarIndice(6, [
      linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(0)),
      linha("Embu-Guaçu", "RUA JOSE SECHI", aoNorte(50), { providerId: 7 }),
    ])).toThrow(/provedor 7/);
  });
});

describe("filtro da carteira", () => {
  const render = (providerId: number) => new PgDialect().sqlToQuery(filtroDaCarteira(providerId));

  it("o recorte por provedor está no SQL, não em memória", () => {
    const q = render(6);
    expect(q.sql).toContain("provider_id");
    expect(q.params).toContain(6);
  });

  it("só a coordenada do ERP alimenta o índice", () => {
    // `endereco` e `logradouro` carregam o jitter de ±110 m que a gravação soma
    // por LGPD: dois clientes no mesmo endereço podem medir ~300 m de distância
    // só por causa do ruído, e a guarda passaria a medir o nosso ruído em vez
    // do comprimento da rua. `bairro`, `cidade` e o próprio `vizinho` seriam
    // aproximação servindo de base para aproximação.
    const q = render(6);
    expect(PROCEDENCIAS_DO_INDICE).toEqual(["erp"]);
    expect(q.sql).toContain("geo_precisao");
    expect(q.params).toContain("erp");
    for (const proibida of ["endereco", "logradouro", "bairro", "cidade", "vizinho"]) {
      expect(q.params).not.toContain(proibida);
    }
  });
});

describe("abrirIndiceDaCarteira", () => {
  it("lê a carteira numa consulta só, com o filtro do provedor", async () => {
    consultas.where.length = 0;
    consultas.linhas = [
      linha("Embu-Guaçu", "RUA JOSE SECHI, 100", aoNorte(0)),
      linha("Embu-Guaçu", "RUA JOSE SECHI, 400", aoNorte(120)),
      linha("Embu-Guaçu", "ESTRADA DA BARRA", aoNorte(500)),
    ];

    const idx = await abrirIndiceDaCarteira(6);

    expect(consultas.where).toHaveLength(1);
    expect(new PgDialect().sqlToQuery(consultas.where[0] as any).params).toContain(6);
    expect(idx.providerId).toBe(6);
    expect(idx.pontos).toBe(3);
    expect(idx.ruas.size).toBe(2);
    expect(resolverPorVizinho(cliente({ city: "EMBU GUACU", address: "R. José Sechi, 250" }), idx)).not.toBeNull();
  });
});

describe("dispersaoMaximaM", () => {
  const p = (m: number) => ({ id: m, lat: aoNorte(m)[0], lon: aoNorte(m)[1], numero: null });

  it("é o par mais distante, não a soma nem a média", () => {
    expect(dispersaoMaximaM([p(0), p(40), p(260)])).toBeGreaterThan(255);
    expect(dispersaoMaximaM([p(0), p(40), p(260)])).toBeLessThan(265);
  });

  it("sai assim que passa do teto — rua longa não custa n² completo", () => {
    const pontos = Array.from({ length: 50 }, (_, i) => p(i * 100));
    expect(dispersaoMaximaM(pontos, TETO_DISPERSAO_M)).toBeGreaterThan(TETO_DISPERSAO_M);
  });

  it("lista de um ponto tem dispersão zero — e é por isso que ela não basta", () => {
    expect(dispersaoMaximaM([p(0)])).toBe(0);
  });
});
