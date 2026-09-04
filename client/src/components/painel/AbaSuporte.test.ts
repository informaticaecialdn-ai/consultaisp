import { describe, it, expect } from "vitest";
import {
  desvioDoRelogio, faseDoAcesso, formatarRestante, jaEntrou, prazoPorExtenso,
  presenteAgora, restanteDaJanela, tempoDesde, type EstadoDoAcessoDeSuporte,
} from "./AbaSuporte";

/**
 * A aba que abre a porta do provedor para o suporte.
 *
 * O que estes testes protegem nao e o desenho: e a honestidade do que a tela
 * AFIRMA. Ela diz "acesso fechado", "acesso liberado", "suporte entrou" ou
 * "suporte conectado agora", e o provedor decide com base nisso se liga para nos
 * ou nao. Cada frase errada tem um custo proprio: dizer fechado com a porta
 * aberta esconde alguem de fora dentro da conta; dizer "conectado agora" duas
 * horas depois de a pessoa sair ensina o provedor a ignorar a faixa vermelha.
 *
 * O relogio esta em 2031 de proposito, longe do relogio do processo: nenhuma
 * destas funcoes pode depender de `Date.now()` por dentro.
 */
const AGORA = Date.parse("2031-05-04T14:00:00.000Z");
const emMinutos = (m: number) => new Date(AGORA + m * 60_000).toISOString();

const aberto: EstadoDoAcessoDeSuporte = {
  liberado: true,
  expiraEm: emMinutos(120),
  liberadoEm: emMinutos(0),
  conectado: false,
  usos: 0,
  duracaoPadraoMs: 2 * 3600_000,
};

describe("desvioDoRelogio", () => {
  it("mede o quanto o servidor esta a frente desta maquina", () => {
    expect(desvioDoRelogio(emMinutos(0), AGORA - 90_000)).toBe(90_000);
  });

  /* A rota ainda nao manda `agora`. Zero e a resposta certa nesse caso: a
     contagem cai no relogio local, que e a melhor aproximacao disponivel. */
  it("sem hora do servidor o desvio e zero", () => {
    expect(desvioDoRelogio(undefined, AGORA)).toBe(0);
    expect(desvioDoRelogio(null, AGORA)).toBe(0);
  });

  it("hora ilegivel nao vira NaN: um desvio NaN apagaria a contagem inteira", () => {
    expect(desvioDoRelogio("ontem de tarde", AGORA)).toBe(0);
  });
});

describe("restanteDaJanela", () => {
  it("conta o que falta ate o fim da janela", () => {
    expect(restanteDaJanela(emMinutos(120), AGORA)).toBe(120 * 60_000);
  });

  /* Sem o piso em zero a tela mostraria uma contagem NEGATIVA correndo para
     tras depois do vencimento — e `faseDoAcesso` continuaria lendo a janela
     como aberta, porque so o zero a fecha. */
  it("janela vencida nao devolve numero negativo", () => {
    expect(restanteDaJanela(emMinutos(-5), AGORA)).toBe(0);
  });

  it("sem prazo nao ha contagem", () => {
    expect(restanteDaJanela(undefined, AGORA)).toBe(0);
    expect(restanteDaJanela("qualquer coisa", AGORA)).toBe(0);
  });
});

describe("jaEntrou", () => {
  it("o campo do servidor manda", () => {
    expect(jaEntrou({ conectado: true })).toBe(true);
  });

  it("o carimbo de primeira entrada tambem basta", () => {
    expect(jaEntrou({ conectado: false, primeiroUsoEm: emMinutos(-40) })).toBe(true);
  });

  it("janela autorizada e nunca usada nao teve ninguem dentro", () => {
    expect(jaEntrou({ conectado: false })).toBe(false);
  });
});

describe("presenteAgora", () => {
  it("acao dentro da janela de presenca conta como estar na conta", () => {
    expect(presenteAgora({ ultimoUsoEm: emMinutos(-2) }, AGORA)).toBe(true);
  });

  /**
   * O caso que a separacao entre `jaEntrou` e `presenteAgora` existe para
   * cobrir. O `conectado` do servidor e grudento — uma vez verdadeiro, nunca
   * volta atras. Se a frase em vermelho saisse dele, a tela continuaria dizendo
   * "o suporte esta na sua conta agora" uma hora depois de a pessoa fechar a
   * aba, e da segunda vez o provedor deixa de acreditar no aviso.
   */
  it("uso antigo nao e presenca, mesmo com a janela aberta", () => {
    expect(presenteAgora({ ultimoUsoEm: emMinutos(-30) }, AGORA)).toBe(false);
  });

  it("sem carimbo de uso nao ha ninguem dentro", () => {
    expect(presenteAgora({ ultimoUsoEm: undefined }, AGORA)).toBe(false);
    expect(presenteAgora({ ultimoUsoEm: "sei la" }, AGORA)).toBe(false);
  });
});

describe("faseDoAcesso", () => {
  it("sem estado a tela nao inventa porta aberta", () => {
    expect(faseDoAcesso(undefined, 0)).toBe("fechado");
  });

  it("liberado e ainda vazio", () => {
    expect(faseDoAcesso(aberto, 60_000)).toBe("liberado");
  });

  it("liberado e ja usado", () => {
    expect(faseDoAcesso({ ...aberto, conectado: true }, 60_000)).toBe("conectado");
  });

  /**
   * O caso que mais importa. Entre um tique da contagem e a proxima resposta do
   * servidor a janela pode ter vencido: se a fase so olhasse `liberado`, a tela
   * ficaria escrevendo "suporte conectado" com 0:00:00 no relogio, e o provedor
   * apertaria "encerrar" numa porta que ja fechou sozinha.
   */
  it("prazo zerado fecha a leitura mesmo com o servidor ainda dizendo liberado", () => {
    expect(faseDoAcesso(aberto, 0)).toBe("fechado");
    expect(faseDoAcesso({ ...aberto, conectado: true }, 0)).toBe("fechado");
  });

  it("servidor dizendo fechado fecha, mesmo com prazo sobrando", () => {
    expect(faseDoAcesso({ ...aberto, liberado: false }, 60_000)).toBe("fechado");
  });
});

describe("formatarRestante", () => {
  it("h:mm:ss com largura fixa nos minutos e segundos", () => {
    expect(formatarRestante(2 * 3600_000)).toBe("2:00:00");
    expect(formatarRestante(3600_000 + 7 * 60_000 + 5_000)).toBe("1:07:05");
    expect(formatarRestante(243_000)).toBe("0:04:03");
  });

  it("zero e negativo mostram zero, nunca um menos na tela", () => {
    expect(formatarRestante(0)).toBe("0:00:00");
    expect(formatarRestante(-5_000)).toBe("0:00:00");
  });

  /* Arredondar para cima mostraria um segundo que a janela nao tem — e o ultimo
     segundo de uma janela de personificacao e onde a tela precisa ser
     conservadora, nao generosa. */
  it("trunca em vez de arredondar para cima", () => {
    expect(formatarRestante(1_999)).toBe("0:00:01");
  });
});

describe("prazoPorExtenso", () => {
  it("a duracao decidida com o dono", () => {
    expect(prazoPorExtenso(2 * 3600_000)).toBe("2 horas");
  });

  it("uma hora no singular", () => {
    expect(prazoPorExtenso(3600_000)).toBe("1 hora");
  });

  it("abaixo de uma hora fala em minutos", () => {
    expect(prazoPorExtenso(30 * 60_000)).toBe("30 minutos");
    expect(prazoPorExtenso(60_000)).toBe("1 minuto");
  });

  it("meia hora quebrada nao vira dizima na tela", () => {
    expect(prazoPorExtenso(90 * 60_000)).toBe("1,5 horas");
  });
});

describe("tempoDesde", () => {
  it("minutos e horas, sem prometer precisao de segundo", () => {
    expect(tempoDesde(emMinutos(-1), AGORA)).toBe("há 1 minuto");
    expect(tempoDesde(emMinutos(-12), AGORA)).toBe("há 12 minutos");
    expect(tempoDesde(emMinutos(-90), AGORA)).toBe("há 1 hora");
  });

  it("carimbo recem-gravado nao vira 'há 0 minutos'", () => {
    expect(tempoDesde(emMinutos(-0.2), AGORA)).toBe("agora há pouco");
  });

  /* Carimbo no futuro acontece com relogio local adiantado, enquanto a rota nao
     manda `agora`. "Há -3 minutos" na tela seria pior do que a imprecisao. */
  it("carimbo no futuro nao vira tempo negativo", () => {
    expect(tempoDesde(emMinutos(3), AGORA)).toBe("agora há pouco");
  });

  it("sem carimbo nao ha frase", () => {
    expect(tempoDesde(undefined, AGORA)).toBe("");
    expect(tempoDesde("nao é data", AGORA)).toBe("");
  });
});
