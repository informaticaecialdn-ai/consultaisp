import { describe, it, expect } from "vitest";
import {
  APARENCIA_POR_PROCEDENCIA,
  OPACIDADE_AFIRMA,
  OPACIDADE_APROXIMADA,
  aparenciaDoPonto,
  aproximacoesNaLegenda,
  type ProcedenciaPonto,
} from "./procedencia-ponto";

/**
 * O que estes testes protegem é a AFIRMAÇÃO do mapa, não o desenho.
 *
 * Um ponto sólido no mapa da carteira diz "a casa é aqui", e alguém sai para
 * cobrar nesse endereço. Um ponto tirado da instalação de outro cliente da
 * mesma rua está a algumas dezenas de metros da casa certa — perto o bastante
 * para valer a viagem, longe o bastante para ser o portão de um terceiro. As
 * duas maneiras de errar têm custo:
 *
 *   · AFIRMAR DEMAIS — desenhar aproximação como se fosse endereço exato. É a
 *     falha grave: o operador não tem como saber, e o produto tem uma regra
 *     dura de "nunca plotado no lugar errado".
 *   · CALAR — deixar o ponto de fora do mapa ou sem rótulo por não saber
 *     nomeá-lo. Devolve o cliente ao limbo que este trabalho todo existe para
 *     esvaziar.
 *
 * Por isso o caso mais importante aqui não é `vizinho` nem `bairro`: é a
 * procedência DESCONHECIDA. O servidor grava `geo_precisao` como texto livre e
 * é implantado antes do client; se o desconhecido caísse no ramo sólido, a tela
 * mentiria sozinha, em silêncio, no dia de um deploy.
 */

/* ==================================================================== */
/* aparenciaDoPonto                                                     */
/* ==================================================================== */

describe("aparenciaDoPonto", () => {
  it("coordenada do ERP e endereço exato afirmam a casa: sólidos e sem nota", () => {
    for (const p of ["erp", "endereco"]) {
      const a = aparenciaDoPonto(p);
      expect(a.aproximado).toBe(false);
      expect(a.opacidade).toBe(OPACIDADE_AFIRMA);
    }
  });

  /* DÍVIDA CONHECIDA, travada aqui para não mudar sem querer — e NÃO uma
     decisão de que rua vale como casa. `logradouro` é, pela definição do
     servidor, a mesma afirmação que o ponto da mesma rua (a rua bate, o número
     não), e num logradouro do censo a rua pode ter quilômetros sem guarda
     nenhuma; ainda assim ele sai sólido e sem nota, enquanto o ponto que passa
     por uma guarda sai translúcido. A hierarquia está invertida.

     Consertar é repintar a carteira histórica inteira: precisa da medição
     (quantos pontos da Amplinet estão em `logradouro` e `cep`) e do aval do
     dono. Enquanto isso, o teste registra o que É, não o que deve ser. */
  it("rua e CEP seguem sólidos — dívida herdada, não decisão", () => {
    expect(aparenciaDoPonto("logradouro").aproximado).toBe(false);
    expect(aparenciaDoPonto("cep").aproximado).toBe(false);
  });

  it("bairro não afirma a casa: translúcido e rotulado", () => {
    const a = aparenciaDoPonto("bairro");
    expect(a.aproximado).toBe(true);
    expect(a.opacidade).toBe(OPACIDADE_APROXIMADA);
    if (!a.aproximado) throw new Error("inalcançável");
    expect(a.aviso).toContain("aproximada");
  });

  it("ponto da mesma rua é aproximado, e o aviso diz que a rua está certa", () => {
    const a = aparenciaDoPonto("vizinho");
    expect(a.aproximado).toBe(true);
    expect(a.opacidade).toBe(OPACIDADE_APROXIMADA);
    if (!a.aproximado) throw new Error("inalcançável");
    expect(a.aviso).toContain("aproximada");
    expect(a.aviso).toContain("mesma rua");
    expect(a.legenda).toContain("mesma rua");
  });

  /* O CASO CARO. Uma procedência que o servidor grava e esta tela ainda não
     conhece — client implantado em separado — não pode virar afirmação. */
  it("procedência desconhecida NUNCA sai sólida", () => {
    for (const p of ["quadra", "vizinho_de_bairro", "VIZINHO", "cnefe_logradouro", "  "]) {
      const a = aparenciaDoPonto(p);
      expect(a.aproximado, `procedência "${p}" saiu sólida`).toBe(true);
      expect(a.opacidade).toBe(OPACIDADE_APROXIMADA);
    }
  });

  /* E o aviso do desconhecido não pode inventar uma origem que não sabemos:
     diz só o que é certo — que é aproximado. */
  it("o aviso do desconhecido não afirma de onde o ponto veio", () => {
    const a = aparenciaDoPonto("procedencia-que-ninguem-viu");
    if (!a.aproximado) throw new Error("inalcançável");
    expect(a.aviso).toBe("localização aproximada");
  });

  /* Ausência de procedência é cadastro anterior à coluna, quase sempre com
     coordenada do ERP. Tratá-la como aproximação repintaria uma carteira
     histórica inteira com base em nada. */
  it("sem procedência o ponto segue sólido — ausência não é informação", () => {
    expect(aparenciaDoPonto(null).aproximado).toBe(false);
    expect(aparenciaDoPonto(undefined).aproximado).toBe(false);
    expect(aparenciaDoPonto("").aproximado).toBe(false);
  });

  it("aproximado é mais translúcido que afirmado — o sinal do mapa é esse", () => {
    expect(OPACIDADE_APROXIMADA).toBeLessThan(OPACIDADE_AFIRMA);
  });
});

/* ==================================================================== */
/* O que a tela mostra                                                  */
/* ==================================================================== */

describe("texto que vai para a tela", () => {
  const visiveis = (): string[] => {
    const fora: string[] = [];
    for (const a of Object.values(APARENCIA_POR_PROCEDENCIA)) {
      if (a.aproximado) fora.push(a.aviso, a.legenda, a.explicacao);
    }
    const desconhecida = aparenciaDoPonto("origem-nova-do-servidor");
    if (desconhecida.aproximado) {
      fora.push(desconhecida.aviso, desconhecida.legenda, desconhecida.explicacao);
    }
    return fora;
  };

  /* Quem lê é um operador decidindo cobrança. O nome da coluna e o nome interno
     da fonte não significam nada para ele, e "vizinho" na tela ainda sugeriria
     que o mapa está apontando a casa do vizinho do cliente — que não é o que
     acontece: o ponto vem de outra instalação, que pode ser cinco casas adiante. */
  it("nada de jargão: nem o nome da coluna, nem o nome interno da fonte", () => {
    for (const t of visiveis()) {
      expect(t, t).not.toMatch(/geo[_ ]?precis/i);
      expect(t, t).not.toMatch(/vizinho/i);
      expect(t, t).not.toMatch(/logradouro|geocod|precis(ão|ao)\b/i);
    }
  });

  /* A tela não pode prometer uma precisão que o servidor não entrega. O trecho
     que sustenta o ponto da mesma rua vai a 300 m e a gravação soma ±110 m de
     ruído por LGPD — a ordem de grandeza é a centena de metros. A primeira
     redação dizia "a algumas dezenas de metros", que faria o operador esperar
     enxergar a casa do pino; numa área de chácara, 260 m é outra propriedade. */
  it("o texto da mesma rua não promete distância que o dado não garante", () => {
    const a = aparenciaDoPonto("vizinho");
    if (!a.aproximado) throw new Error("inalcançável");
    for (const t of [a.aviso, a.explicacao]) expect(t).not.toMatch(/dezenas de metros/i);
    expect(a.explicacao).toContain("centenas de metros");
    // E não afirma ser a instalação de alguém: é a mediana de várias, escolhida
    // no servidor justamente por não ser a casa de nenhum cliente.
    expect(a.aviso).not.toMatch(/de outra instala/i);
  });

  it("toda aproximação se declara aproximada no popup", () => {
    for (const a of Object.values(APARENCIA_POR_PROCEDENCIA)) {
      if (a.aproximado) expect(a.aviso).toContain("aproximada");
    }
  });

  /* A chave é de máquina (agrupamento e data-testid) e por isso pode ser o nome
     interno — mas tem de ser única, senão duas aproximações somam na mesma
     linha da legenda e o operador lê uma contagem que não corresponde a nada. */
  it("cada aproximação tem chave própria", () => {
    const chaves = Object.values(APARENCIA_POR_PROCEDENCIA)
      .filter(a => a.aproximado)
      .map(a => (a.aproximado ? a.chave : ""));
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  /* Se o tipo compartilhado ganhar uma procedência nova, o Record deixa de
     compilar. Este teste cobre o outro lado: ninguém pode deixar uma entrada
     meio preenchida. */
  it("toda procedência conhecida tem aparência declarada", () => {
    const esperadas: ProcedenciaPonto[] = ["erp", "endereco", "logradouro", "cep", "vizinho", "bairro"];
    for (const p of esperadas) {
      expect(APARENCIA_POR_PROCEDENCIA[p], p).toBeDefined();
      expect(typeof APARENCIA_POR_PROCEDENCIA[p].opacidade).toBe("number");
    }
  });
});

/* ==================================================================== */
/* aproximacoesNaLegenda                                                */
/* ==================================================================== */

describe("aproximacoesNaLegenda", () => {
  it("conta cada aproximação e ignora quem afirma a casa", () => {
    const linhas = aproximacoesNaLegenda([
      "erp", "erp", "endereco", null, "vizinho", "vizinho", "vizinho", "bairro",
    ]);
    expect(linhas.map(l => [l.chave, l.n])).toEqual([
      ["mesma-rua", 3],
      ["bairro", 1],
    ]);
  });

  /* Da pista mais estreita para a mais larga: a primeira linha é a que ainda
     dá para usar hoje. */
  it("ordena da aproximação mais útil para a mais larga, sem depender da entrada", () => {
    const linhas = aproximacoesNaLegenda(["bairro", "origem-nova", "vizinho"]);
    expect(linhas.map(l => l.chave)).toEqual(["mesma-rua", "bairro", "nao-identificada"]);
  });

  /* A legenda descreve o desenho: linha zerada seria a chave de uma cor que não
     está na tela. */
  it("não lista aproximação sem ponto no mapa", () => {
    expect(aproximacoesNaLegenda(["erp", "endereco", "cep"])).toEqual([]);
    expect(aproximacoesNaLegenda([])).toEqual([]);
  });

  it("procedências desconhecidas diferentes somam numa linha só", () => {
    const linhas = aproximacoesNaLegenda(["quadra", "outra-coisa", "mais-uma"]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].chave).toBe("nao-identificada");
    expect(linhas[0].n).toBe(3);
  });

  it("cada linha leva o rótulo e a explicação da própria procedência", () => {
    const [rua, bairro] = aproximacoesNaLegenda(["vizinho", "bairro"]);
    expect(rua.legenda).toBe("aproximados · mesma rua");
    expect(bairro.legenda).toBe("aproximados · bairro");
    expect(rua.explicacao).not.toBe(bairro.explicacao);
    expect(rua.explicacao.length).toBeGreaterThan(20);
  });

  /* A carteira medida em 04/09/2026 tem 868 clientes; a legenda é montada a
     cada render do mapa e não pode custar mais que uma passada. */
  it("uma passada só pela lista, mesmo com a carteira inteira", () => {
    const carteira = Array.from({ length: 900 }, (_, i) =>
      i % 3 === 0 ? "erp" : i % 3 === 1 ? "vizinho" : "bairro");
    const linhas = aproximacoesNaLegenda(carteira);
    expect(linhas.map(l => l.n)).toEqual([300, 300]);
  });
});
