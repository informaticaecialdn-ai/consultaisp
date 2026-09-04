import { describe, it, expect } from "vitest";
import {
  planoDeCobertura,
  rotuloDasGrafias,
  subDoKpiSemCoordenada,
  SUB_SEM_COORDENADA_PADRAO,
  SUB_SEM_COORDENADA_COM_DIAGNOSTICO,
  ROTA_COBERTURA,
  type Cobertura,
  type CidadeDeCobertura,
  type GrafiaDeCobertura,
} from "./CoberturaEnderecos";

/**
 * O que estes testes protegem é a FRASE, não o desenho.
 *
 * A tela de Localização já falhou uma vez exatamente aqui, e o custo foi medido:
 * em 04/09/2026 ela dizia "184 clientes esperam plotagem · carteira sem
 * geocodificação — fora do mapa", com um botão "Plotar agora" ao lado. Tudo
 * verdadeiro. O dono leu e concluiu que o produto não plota, quando a causa era
 * a base de endereços da região dele nunca ter sido carregada no servidor — algo
 * que só aparecia num script rodado à mão por quem tinha acesso à máquina.
 *
 * Então há duas maneiras de errar, e as duas são caras:
 *   · CALAR — não desenhar o bloco quando há causa. É a falha original, e é a
 *     pior: o provedor culpa o produto por um problema que ele resolveria com
 *     um clique ou com uma correção no ERP.
 *   · FALAR À TOA — desenhar um cartão quando não há nada a fazer. A tela é
 *     densa por decisão de produto (seção 4 do DESIGN_SYSTEM); um cartão que
 *     não muda nada empurra o mapa para baixo e treina o olho a ignorar avisos.
 *
 * Nada aqui monta React: o plano é uma função pura, e é assim que estas duas
 * frases podem ser provadas.
 */

const cidade = (
  nome: string,
  uf: string,
  ibge: string,
  clientes: number,
  semCoordenada: number,
  grafias: string[] = [nome.toUpperCase()],
): CidadeDeCobertura => ({
  municipio: { nome, uf, ibge },
  clientes,
  semCoordenada,
  grafias,
  chaves: grafias.map(g => g.toLowerCase()),
});

const grafia = (
  chave: string,
  grafias: string[],
  clientes: number,
  semCoordenada: number,
  motivo: GrafiaDeCobertura["motivo"] = "nao_encontrada",
): GrafiaDeCobertura => ({ chave, grafias, clientes, semCoordenada, motivo });

/** O caso medido na Amplinet, reduzido ao que a tela consome. */
const AMPLINET: Cobertura = {
  semBase: [
    cidade("Embu-Guaçu", "SP", "3515186", 96, 62, ["EMBU-GUAÇU", "EMBU GUACU"]),
    cidade("Itapecerica da Serra", "SP", "3523107", 30, 18),
  ],
  semMunicipio: [
    grafia("embu gaucu", ["EMBU GAUCU"], 9, 9),
    grafia("sao pauylo", ["SÃO PAUYLO"], 6, 6),
    grafia("parque jandaia", ["PARQUE JANDAIA"], 4, 4),
    grafia("itapecerica", ["ITAPECERICA"], 3, 3, "sem_uf"),
  ],
};

const ADMIN = { podeCarregar: true, carregando: false };
const OPERADOR = { podeCarregar: false, carregando: false };

describe("planoDeCobertura — quando a tela fica calada", () => {
  it("sem resposta do servidor não afirma nada", () => {
    expect(planoDeCobertura(undefined, ADMIN)).toBeNull();
    expect(planoDeCobertura(null, ADMIN)).toBeNull();
  });

  it("carteira inteira coberta e plotada não desenha bloco nenhum", () => {
    expect(planoDeCobertura({ semBase: [], semMunicipio: [] }, ADMIN)).toBeNull();
  });

  /* A regra que decide se o bloco existe é "segura alguém fora do mapa", e não
     "falta base". Cidade sem base cujos clientes já estão todos plotados não
     responde à pergunta desta tela. */
  it("cidade sem base que não segura ninguém não vira bloco", () => {
    const plano = planoDeCobertura(
      { semBase: [cidade("Curitiba", "PR", "4106902", 40, 0)], semMunicipio: [] },
      ADMIN,
    );
    expect(plano).toBeNull();
  });

  it("grafia errada cujos clientes já estão no mapa não vira bloco", () => {
    const plano = planoDeCobertura(
      { semBase: [], semMunicipio: [grafia("parque jandaia", ["PARQUE JANDAIA"], 4, 0)] },
      ADMIN,
    );
    expect(plano).toBeNull();
  });

  /* Uma linha sem nome de município é defeito do servidor. Melhor não desenhar
     do que desenhar "undefined · " na frente do provedor. */
  it("cidade sem nome de município é descartada em vez de virar linha vazia", () => {
    const quebrada = { ...cidade("", "", "0000000", 5, 5) };
    expect(planoDeCobertura({ semBase: [quebrada], semMunicipio: [] }, ADMIN)).toBeNull();
  });
});

describe("planoDeCobertura — o caso medido na Amplinet", () => {
  const plano = planoDeCobertura(AMPLINET, ADMIN)!;

  it("desenha os dois blocos", () => {
    expect(plano.semBase).not.toBeNull();
    expect(plano.semMunicipio).not.toBeNull();
  });

  it("o número do bloco da base é quem está FORA do mapa, não a carteira", () => {
    // 62 + 18 = 80 sem coordenada, de 126 clientes. Anunciar 126 diria ao
    // provedor que 126 sumiram do mapa, e a maioria deles está lá.
    expect(plano.semBase!.retidos).toBe(80);
    expect(plano.semBase!.titulo).toBe("80 clientes esperam a base de endereços de 2 cidades suas");
  });

  it("cidade que segura mais gente vem primeiro", () => {
    expect(plano.semBase!.cidades.map(c => c.rotulo)).toEqual([
      "Embu-Guaçu · SP",
      "Itapecerica da Serra · SP",
    ]);
    expect(plano.semBase!.cidades[0]).toMatchObject({ retidos: 62, clientes: 96 });
  });

  it("a explicação diz que a culpa não é do cadastro do provedor", () => {
    // A frase existe para desfazer exatamente a leitura que o dono fez.
    expect(plano.semBase!.explicacao).toContain("não o endereço que eles têm no seu cadastro");
    expect(plano.semBase!.explicacao).toContain("IBGE");
  });

  it("o bloco das grafias soma só quem está fora do mapa e ordena por peso", () => {
    expect(plano.semMunicipio!.retidos).toBe(22);
    expect(plano.semMunicipio!.itens.map(i => i.rotulo)).toEqual([
      "EMBU GAUCU", "SÃO PAUYLO", "PARQUE JANDAIA", "ITAPECERICA",
    ]);
  });

  it("diz que o conserto é no ERP, e não promete mapa cheio depois dele", () => {
    expect(plano.semMunicipio!.explicacao).toContain("O ajuste é no seu ERP");
    expect(plano.semMunicipio!.explicacao).toContain("entram na fila do mapa");
  });

  it("os dois blocos somados explicam 102 dos 184", () => {
    expect(plano.explicados).toBe(102);
  });
});

describe("planoDeCobertura — os dois motivos são correções diferentes", () => {
  it("sem_uf não acusa erro: falta um campo", () => {
    const plano = planoDeCobertura(
      { semMunicipio: [grafia("itapecerica", ["ITAPECERICA"], 3, 3, "sem_uf")] },
      ADMIN,
    )!;
    const item = plano.semMunicipio!.itens[0];
    expect(item.selo).toBe("sem estado");
    expect(item.tom).toBe("neutro");
    expect(plano.semMunicipio!.comoCorrigir).toHaveLength(1);
    expect(plano.semMunicipio!.comoCorrigir[0]).toContain("mais de um estado");
  });

  it("nao_encontrada aponta digitação ou bairro no campo da cidade", () => {
    const plano = planoDeCobertura(
      { semMunicipio: [grafia("embu gaucu", ["EMBU GAUCU"], 9, 9)] },
      ADMIN,
    )!;
    expect(plano.semMunicipio!.itens[0].selo).toBe("não confere");
    expect(plano.semMunicipio!.itens[0].tom).toBe("gated");
    expect(plano.semMunicipio!.comoCorrigir[0]).toContain("bairro");
  });

  /* Explicar um selo que não está na lista é ruído; explicar só um dos dois
     quando ambos aparecem deixa metade da lista sem instrução. */
  it("só explica os motivos presentes, na ordem em que o olho os encontra", () => {
    const soUm = planoDeCobertura({ semMunicipio: [grafia("x", ["X"], 2, 2)] }, ADMIN)!;
    expect(soUm.semMunicipio!.comoCorrigir).toHaveLength(1);

    const ambos = planoDeCobertura(AMPLINET, ADMIN)!;
    expect(ambos.semMunicipio!.comoCorrigir).toHaveLength(2);
    expect(ambos.semMunicipio!.comoCorrigir[0]).toContain("não confere");
    expect(ambos.semMunicipio!.comoCorrigir[1]).toContain("sem estado");
  });
});

describe("planoDeCobertura — o que sobra não some", () => {
  /* A falha original foi uma verdade invisível. Trocá-la por outra, menor,
     repetiria o erro em escala menor: o que não entra na lista vira contagem. */
  it("cidade sem base que não segura ninguém vira uma linha de contagem", () => {
    const plano = planoDeCobertura(
      {
        semBase: [
          cidade("Embu-Guaçu", "SP", "3515186", 96, 62),
          cidade("Curitiba", "PR", "4106902", 40, 0),
          cidade("Londrina", "PR", "4113700", 12, 0),
        ],
      },
      ADMIN,
    )!;
    expect(plano.semBase!.cidades).toHaveLength(1);
    expect(plano.semBase!.outras).toBe(
      "Outras 2 cidades suas também não têm base carregada, mas nenhum cliente delas está fora do mapa.",
    );
  });

  it("uma só fala no singular", () => {
    const plano = planoDeCobertura(
      {
        semBase: [
          cidade("Embu-Guaçu", "SP", "3515186", 96, 62),
          cidade("Curitiba", "PR", "4106902", 40, 0),
        ],
      },
      ADMIN,
    )!;
    expect(plano.semBase!.outras).toContain("Outra cidade sua também não tem base");
  });

  it("nada sobrando não inventa linha", () => {
    const plano = planoDeCobertura(
      { semBase: [cidade("Embu-Guaçu", "SP", "3515186", 96, 62)] },
      ADMIN,
    )!;
    expect(plano.semBase!.outras).toBeNull();
  });

  it("grafia que não segura ninguém também vira contagem", () => {
    const plano = planoDeCobertura(
      {
        semMunicipio: [
          grafia("embu gaucu", ["EMBU GAUCU"], 9, 9),
          grafia("parque jandaia", ["PARQUE JANDAIA"], 4, 0),
        ],
      },
      ADMIN,
    )!;
    expect(plano.semMunicipio!.itens).toHaveLength(1);
    expect(plano.semMunicipio!.outras).toContain("Outra grafia também não confere");
  });
});

describe("planoDeCobertura — uma cidade só fala pelo nome dela", () => {
  const plano = planoDeCobertura(
    { semBase: [cidade("Embu-Guaçu", "SP", "3515186", 96, 62)] },
    ADMIN,
  )!;

  it("nomeia a cidade no título e na explicação", () => {
    expect(plano.semBase!.titulo).toBe("62 clientes esperam a base de endereços de Embu-Guaçu");
    expect(plano.semBase!.explicacao).toContain("O de Embu-Guaçu ainda não foi carregado");
  });

  it("o botão fala no singular", () => {
    expect(plano.semBase!.acao).toEqual({ estado: "carregar", rotulo: "Carregar a base" });
  });

  it("um cliente só não vira “1 clientes”", () => {
    const um = planoDeCobertura(
      { semBase: [cidade("Embu-Guaçu", "SP", "3515186", 96, 1)] },
      ADMIN,
    )!;
    expect(um.semBase!.titulo).toBe("1 cliente espera a base de endereços de Embu-Guaçu");

    const umaGrafia = planoDeCobertura({ semMunicipio: [grafia("x", ["X"], 1, 1)] }, ADMIN)!;
    expect(umaGrafia.semMunicipio!.titulo).toBe("1 cliente tem no cadastro uma cidade que não confere");
  });
});

describe("planoDeCobertura — a ação e quem pode disparar", () => {
  it("enquanto a carga roda o botão diz que está rodando e sai de serviço", () => {
    const plano = planoDeCobertura(AMPLINET, { podeCarregar: true, carregando: true })!;
    expect(plano.semBase!.acao.estado).toBe("rodando");
    // Sem esta frase o operador clica de novo: a carga leva minutos e a tela
    // ficaria idêntica antes e depois do clique.
    expect(plano.semBase!.acao).toMatchObject({ rotulo: "Carregando…" });
    expect(plano.semBase!.acao).toHaveProperty("aviso");
  });

  it("operador vê o diagnóstico inteiro, mas sem botão", () => {
    const plano = planoDeCobertura(AMPLINET, OPERADOR)!;
    expect(plano.semBase!.cidades).toHaveLength(2);
    expect(plano.semBase!.acao.estado).toBe("sem_permissao");
    expect(plano.semMunicipio!.itens).toHaveLength(4);
  });

  /* A rota encadeia a plotagem logo após uma carga que trouxe base nova
     (localizacao.routes.ts), então o rodapé antigo — "entram na PRÓXIMA
     varredura, ou use Plotar agora" — passou a mentir por excesso de cautela, e
     ainda mandava o operador a um botão que ele não enxerga. Uma frase só, igual
     para os dois, e ela continua sem prometer mapa cheio no instante do clique:
     os pontos aparecem à medida que cada endereço resolve. */
  it("o rodapé promete o encadeamento que existe, e nada além dele", () => {
    const doAdmin = planoDeCobertura(AMPLINET, ADMIN)!.semBase!.rodape;
    expect(doAdmin).toContain("começa em seguida");
    expect(doAdmin).toContain("conforme forem resolvidos");
    // Nada de "clique naquele outro botão" para quem não tem botão nenhum.
    expect(doAdmin).not.toContain("Plotar agora");
    expect(planoDeCobertura(AMPLINET, OPERADOR)!.semBase!.rodape).toBe(doAdmin);
  });

  /* A trava do servidor é global — o FTP do IBGE e as tabelas de endereço são um
     recurso só. Enquanto a carga de OUTRA carteira roda, o botão não funciona;
     mas prometer progresso a quem não tem carga nenhuma seria falso, e a passada
     do worker roda em todo boot e a cada 24h. */
  it("servidor ocupado por outra carteira: botão fora de serviço, sem promessa", () => {
    const plano = planoDeCobertura(AMPLINET, { podeCarregar: true, carregando: false, ocupado: true })!;
    expect(plano.semBase!.acao.estado).toBe("ocupado");
    expect(plano.semBase!.acao).toHaveProperty("aviso");
    const aviso = (plano.semBase!.acao as { aviso: string }).aviso;
    expect(aviso).toContain("outra base");
    // A frase da carga própria promete que "a carga continua no servidor" — a
    // deste caso não pode prometer nada disso.
    expect(aviso).not.toContain("Pode sair desta tela");
  });

  it("a carga própria vence o servidor ocupado: quem carrega é este provedor", () => {
    const plano = planoDeCobertura(AMPLINET, { podeCarregar: true, carregando: true, ocupado: true })!;
    expect(plano.semBase!.acao.estado).toBe("rodando");
  });

  it("sem permissão, nem “ocupado” aparece — não há botão a explicar", () => {
    const plano = planoDeCobertura(AMPLINET, { podeCarregar: false, carregando: false, ocupado: true })!;
    expect(plano.semBase!.acao.estado).toBe("sem_permissao");
  });
});

describe("o contrato com o servidor", () => {
  /* O primeiro defeito desta tela foi de endereço: o POST ia para
     "/api/localizacao/cobertura" e a rota estava em ".../carregar". Não dava
     404 — o catch-all da SPA responde a qualquer método com 200 e o index.html,
     o `throwIfResNotOk` deixava passar e o `.json()` estourava num toast
     vermelho de erro de parser. `server/routes/localizacao.routes.test.ts`
     importa esta mesma constante para registrar o servidor, então um renomeio de
     um lado só quebra um teste em vez de quebrar o botão. */
  it("a leitura e a ação usam o mesmo caminho, como em /api/localizacao/plotagem", () => {
    expect(ROTA_COBERTURA).toBe("/api/localizacao/cobertura");
  });
});

describe("rotuloDasGrafias", () => {
  it("mostra todas as grafias da mesma chave — é por elas que se procura no ERP", () => {
    expect(rotuloDasGrafias(["EMBU-GUAÇU", "EMBU GUACU"])).toBe("EMBU-GUAÇU · EMBU GUACU");
  });

  it("da quarta em diante vira contagem: a linha tem de caber", () => {
    expect(rotuloDasGrafias(["A", "B", "C", "D", "E"])).toBe("A · B · C +2");
  });

  it("ignora vazio e espaço", () => {
    expect(rotuloDasGrafias(["  ", "EMBU GAUCU", ""])).toBe("EMBU GAUCU");
    expect(rotuloDasGrafias([])).toBe("");
  });
});

describe("subDoKpiSemCoordenada", () => {
  it("sem diagnóstico, o KPI mantém a frase antiga", () => {
    expect(subDoKpiSemCoordenada(undefined, true)).toBe(SUB_SEM_COORDENADA_PADRAO);
    expect(subDoKpiSemCoordenada({ semBase: [], semMunicipio: [] }, true))
      .toBe(SUB_SEM_COORDENADA_PADRAO);
  });

  /* O KPI não pode apontar para baixo quando não há bloco: é a mesma decisão,
     e por isso passa pela mesma função. */
  it("com diagnóstico, manda o olho para o bloco", () => {
    expect(subDoKpiSemCoordenada(AMPLINET, true)).toBe(SUB_SEM_COORDENADA_COM_DIAGNOSTICO);
    expect(subDoKpiSemCoordenada(AMPLINET, false)).toBe(SUB_SEM_COORDENADA_COM_DIAGNOSTICO);
  });
});
