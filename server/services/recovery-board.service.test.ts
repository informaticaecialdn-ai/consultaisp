import { describe, expect, it } from "vitest";
import {
  colunaPorIdade,
  diasCivisEntre,
  formatarDocumento,
  formatarWhatsapp,
  montarBoard,
  ORDEM_COLUNAS,
  type EntradaCasoBoard,
  type EntradaClienteBoard,
  type EntradaEquipamentoBoard,
  type EntradasBoard,
} from "./recovery-board.service";

// Hora de referência fixa: meio da tarde em UTC, para pegar quem usar hora
// crua em vez de dia civil.
const AGORA = new Date("2026-09-02T15:30:00Z");

function diasAtras(dias: number, hora = "03:00:00"): Date {
  const d = new Date(`2026-09-02T${hora}Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

function cliente(overrides: Partial<EntradaClienteBoard> = {}): EntradaClienteBoard {
  return {
    id: 10,
    nome: "Maria da Silva",
    cpfCnpj: "12345678901",
    telefone: "(35) 99876-5432",
    endereco: "Rua das Flores",
    numero: "120",
    bairro: "Centro",
    cidade: "Pouso Alegre",
    uf: "MG",
    situacao: "active",
    dividaEmAberto: "189.90",
    diasEmAtraso: 42,
    ...overrides,
  };
}

function equipamento(overrides: Partial<EntradaEquipamentoBoard> = {}): EntradaEquipamentoBoard {
  return {
    id: 1,
    tipo: "ONU",
    marca: "Huawei",
    modelo: "HG8245",
    serie: "HWTC1234",
    mac: "AA:BB:CC:DD:EE:FF",
    patrimonio: "PAT-001",
    valor: "290.00",
    status: "retirada_pendente",
    ...overrides,
  };
}

let proximoId = 100;
function caso(overrides: Partial<EntradaCasoBoard> = {}): EntradaCasoBoard {
  const id = overrides.id ?? proximoId++;
  const rescisaoEm = overrides.rescisaoEm ?? diasAtras(5);
  const prazoAt = overrides.prazoAt ?? new Date(rescisaoEm.getTime() + 60 * 24 * 60 * 60 * 1000);
  return {
    id,
    status: "pre_recuperacao",
    prioridade: "normal",
    rescisaoEm,
    prazoAt,
    agendadoEm: null,
    metodo: null,
    responsavelId: null,
    responsavelNome: null,
    notificadoEm: null,
    bureauStatus: "candidato",
    contestadoEm: null,
    encerradoEm: null,
    notas: null,
    equipamento: equipamento({ id }),
    cliente: cliente(),
    ...overrides,
  };
}

function entradas(parcial: Partial<EntradasBoard> = {}): EntradasBoard {
  return { casos: [], equipamentosSemCaso: [], tentativas: [], usuarios: [], ...parcial };
}

function cardDe(board: ReturnType<typeof montarBoard>, chave: string) {
  const card = board.cards.find(c => c.chave === chave);
  if (!card) throw new Error(`card ${chave} não está no board`);
  return card;
}

describe("dias civis sem fuso", () => {
  it("conta o calendário, não as horas: 23h59 de ontem para 00h01 de hoje é 1 dia", () => {
    expect(diasCivisEntre(new Date("2026-09-01T23:59:00Z"), new Date("2026-09-02T00:01:00Z"))).toBe(1);
  });

  it("mesmo dia civil é zero, mesmo com 20 horas de diferença", () => {
    expect(diasCivisEntre(new Date("2026-09-02T01:00:00Z"), new Date("2026-09-02T21:00:00Z"))).toBe(0);
  });

  it("é negativo quando o destino vem antes", () => {
    expect(diasCivisEntre(new Date("2026-09-05T00:00:00Z"), new Date("2026-09-02T00:00:00Z"))).toBe(-3);
  });
});

describe("faixas de idade (30/60/90 inclusivos)", () => {
  it.each([
    [0, "ate30"], [30, "ate30"],
    [31, "31a60"], [60, "31a60"],
    [61, "61a90"], [90, "61a90"],
    [91, "mais90"], [400, "mais90"],
  ] as const)("%i dias → %s", (dias, coluna) => {
    expect(colunaPorIdade(dias)).toBe(coluna);
  });

  it("classifica pelo dia civil: rescisão há 30 dias às 3h ainda é 'até 30' às 15h30", () => {
    const board = montarBoard(entradas({ casos: [caso({ id: 1, rescisaoEm: diasAtras(30, "03:00:00") })] }), AGORA);
    expect(cardDe(board, "caso:1").coluna).toBe("ate30");
    expect(cardDe(board, "caso:1").caso?.diasRetido).toBe(30);
  });

  it("rescisão há 31 dias, mesmo às 23h59, já é '31 a 60'", () => {
    const board = montarBoard(entradas({ casos: [caso({ id: 1, rescisaoEm: diasAtras(31, "23:59:00") })] }), AGORA);
    expect(cardDe(board, "caso:1").coluna).toBe("31a60");
  });

  it("contestado continua na idade (é caso aberto)", () => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1, status: "contestado", rescisaoEm: diasAtras(70), contestadoEm: diasAtras(2) })],
    }), AGORA);
    const card = cardDe(board, "caso:1");
    expect(card.coluna).toBe("61a90");
    expect(card.caso?.contestadoEm).not.toBeNull();
  });

  it("rescisão no futuro vale como hoje, nunca dias negativos", () => {
    const board = montarBoard(entradas({ casos: [caso({ id: 1, rescisaoEm: diasAtras(-3) })] }), AGORA);
    expect(cardDe(board, "caso:1").caso?.diasRetido).toBe(0);
    expect(cardDe(board, "caso:1").coluna).toBe("ate30");
  });
});

describe("coluna sem data", () => {
  it("equipamento retido sem caso vira card equip:<id> sem caso e sem idade", () => {
    const board = montarBoard(entradas({
      equipamentosSemCaso: [{ equipamento: equipamento({ id: 7 }), cliente: cliente() }],
    }), AGORA);
    const card = cardDe(board, "equip:7");
    expect(card.coluna).toBe("sem_data");
    expect(card.caseId).toBeNull();
    expect(card.caso).toBeNull();
  });

  it("ordena sem data por maior valor", () => {
    const board = montarBoard(entradas({
      equipamentosSemCaso: [
        { equipamento: equipamento({ id: 1, valor: "100" }), cliente: cliente() },
        { equipamento: equipamento({ id: 2, valor: null }), cliente: cliente() },
        { equipamento: equipamento({ id: 3, valor: "900" }), cliente: cliente() },
      ],
    }), AGORA);
    expect(board.cards.map(c => c.chave)).toEqual(["equip:3", "equip:1", "equip:2"]);
  });
});

describe("encerrados só nos últimos 90 dias", () => {
  it("concluído há 90 dias entra em recuperado; há 91 fica fora", () => {
    const board = montarBoard(entradas({
      casos: [
        caso({ id: 1, status: "concluido", rescisaoEm: diasAtras(120), encerradoEm: diasAtras(90) }),
        caso({ id: 2, status: "concluido", rescisaoEm: diasAtras(120), encerradoEm: diasAtras(91) }),
      ],
    }), AGORA);
    expect(cardDe(board, "caso:1").coluna).toBe("recuperado");
    expect(board.cards.find(c => c.chave === "caso:2")).toBeUndefined();
  });

  it.each(["baixado_economico", "prazo_expirado"])("%s recente vai para baixado", status => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1, status, rescisaoEm: diasAtras(100), encerradoEm: diasAtras(10) })],
    }), AGORA);
    expect(cardDe(board, "caso:1").coluna).toBe("baixado");
  });

  it("encerrado sem closedAt é inconsistente e fica fora", () => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1, status: "concluido", encerradoEm: null })],
    }), AGORA);
    expect(board.cards).toHaveLength(0);
  });

  it("encerrados: o mais recente primeiro", () => {
    const board = montarBoard(entradas({
      casos: [
        caso({ id: 1, status: "concluido", rescisaoEm: diasAtras(50), encerradoEm: diasAtras(20) }),
        caso({ id: 2, status: "concluido", rescisaoEm: diasAtras(50), encerradoEm: diasAtras(2) }),
      ],
    }), AGORA);
    expect(board.cards.map(c => c.chave)).toEqual(["caso:2", "caso:1"]);
  });
});

describe("ordenação dentro da coluna de idade", () => {
  it("prioridade, depois menos dias restantes, depois maior valor", () => {
    const rescisao = diasAtras(10);
    const board = montarBoard(entradas({
      casos: [
        caso({ id: 1, prioridade: "normal", rescisaoEm: rescisao, equipamento: equipamento({ id: 1, valor: "100" }) }),
        caso({ id: 2, prioridade: "critica", rescisaoEm: rescisao, equipamento: equipamento({ id: 2, valor: "50" }) }),
        caso({ id: 3, prioridade: "normal", rescisaoEm: rescisao, equipamento: equipamento({ id: 3, valor: "900" }) }),
        // mesma prioridade "normal", mas prazo mais curto: sobe acima dos outros normais
        caso({ id: 4, prioridade: "normal", rescisaoEm: rescisao, prazoAt: diasAtras(-3), equipamento: equipamento({ id: 4, valor: "10" }) }),
        caso({ id: 5, prioridade: "baixa", rescisaoEm: rescisao, equipamento: equipamento({ id: 5, valor: "9999" }) }),
        caso({ id: 6, prioridade: "alta", rescisaoEm: rescisao, equipamento: equipamento({ id: 6, valor: "1" }) }),
      ],
    }), AGORA);
    expect(board.cards.map(c => c.chave)).toEqual([
      "caso:2", "caso:6", "caso:4", "caso:3", "caso:1", "caso:5",
    ]);
  });
});

describe("colunas e KPIs", () => {
  const monta = () => montarBoard(entradas({
    casos: [
      caso({ id: 1, rescisaoEm: diasAtras(5), equipamento: equipamento({ id: 1, valor: "300" }) }),
      caso({ id: 2, rescisaoEm: diasAtras(55), equipamento: equipamento({ id: 2, valor: "200" }) }), // 5 dias restantes → crítico
      caso({ id: 3, rescisaoEm: diasAtras(95), equipamento: equipamento({ id: 3, valor: "100" }) }), // vencido → crítico
      caso({ id: 4, status: "concluido", rescisaoEm: diasAtras(40), encerradoEm: diasAtras(10), equipamento: equipamento({ id: 4, valor: "150" }) }),
      caso({ id: 5, status: "concluido", rescisaoEm: diasAtras(80), encerradoEm: diasAtras(45), equipamento: equipamento({ id: 5, valor: "999" }) }),
      caso({ id: 6, status: "baixado_economico", rescisaoEm: diasAtras(80), encerradoEm: diasAtras(3), equipamento: equipamento({ id: 6, valor: "50" }) }),
    ],
    equipamentosSemCaso: [
      { equipamento: equipamento({ id: 7, valor: "80" }), cliente: cliente() },
      { equipamento: equipamento({ id: 8, valor: null }), cliente: cliente() },
    ],
  }), AGORA);

  it("sempre devolve as sete colunas na ordem da spec, mesmo vazias", () => {
    const board = montarBoard(entradas(), AGORA);
    expect(board.colunas.map(c => c.chave)).toEqual(ORDEM_COLUNAS);
    expect(board.colunas.every(c => c.cards === 0 && c.valor === 0)).toBe(true);
    expect(board.kpis).toEqual({ retidos: 0, valorEmRisco: 0, prazoCritico: 0, recuperados30d: 0, valorRecuperado30d: 0 });
  });

  it("conta e soma valor por coluna", () => {
    const board = monta();
    const porChave = Object.fromEntries(board.colunas.map(c => [c.chave, c]));
    expect(porChave.sem_data).toMatchObject({ cards: 2, valor: 80 });
    expect(porChave.ate30).toMatchObject({ cards: 1, valor: 300 });
    expect(porChave["31a60"]).toMatchObject({ cards: 1, valor: 200 });
    expect(porChave["61a90"]).toMatchObject({ cards: 0, valor: 0 });
    expect(porChave.mais90).toMatchObject({ cards: 1, valor: 100 });
    expect(porChave.recuperado).toMatchObject({ cards: 2, valor: 1149 });
    expect(porChave.baixado).toMatchObject({ cards: 1, valor: 50 });
  });

  it("KPIs: retidos = sem data + idades; críticos = prazo <= 10 dias; recuperados só 30 dias", () => {
    const board = monta();
    expect(board.kpis.retidos).toBe(5);
    expect(board.kpis.valorEmRisco).toBe(680);
    expect(board.kpis.prazoCritico).toBe(2);
    expect(board.kpis.recuperados30d).toBe(1);
    expect(board.kpis.valorRecuperado30d).toBe(150);
  });

  it("geradoEm é a hora de referência", () => {
    expect(monta().geradoEm).toBe(AGORA.toISOString());
  });

  it("prazo: diasRestantes negativo quando vencido, diasRetido = hoje - rescisão", () => {
    const card = cardDe(monta(), "caso:3");
    expect(card.caso?.diasRetido).toBe(95);
    expect(card.caso?.diasRestantes).toBe(-35);
  });
});

describe("tentativas e responsável", () => {
  it("anexa total e última tentativa do agregado; sem registro fica zero/null", () => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1 }), caso({ id: 2 })],
      tentativas: [{ caseId: 1, total: 3, canal: "whatsapp", resultado: "sem_resposta", em: diasAtras(1) }],
    }), AGORA);
    expect(cardDe(board, "caso:1").caso?.tentativas).toEqual({
      total: 3,
      ultima: { canal: "whatsapp", resultado: "sem_resposta", em: diasAtras(1).toISOString() },
    });
    expect(cardDe(board, "caso:2").caso?.tentativas).toEqual({ total: 0, ultima: null });
  });

  it("responsável sai como {id, nome}; sem responsável é null", () => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1, responsavelId: 4, responsavelNome: "João" }), caso({ id: 2 })],
    }), AGORA);
    expect(cardDe(board, "caso:1").caso?.responsavel).toEqual({ id: 4, nome: "João" });
    expect(cardDe(board, "caso:2").caso?.responsavel).toBeNull();
  });

  it("responsaveis lista os usuários do provedor em ordem alfabética", () => {
    const board = montarBoard(entradas({
      usuarios: [{ id: 2, nome: "Zé" }, { id: 1, nome: "Ana" }],
    }), AGORA);
    expect(board.responsaveis).toEqual([{ id: 1, nome: "Ana" }, { id: 2, nome: "Zé" }]);
  });
});

describe("cliente e equipamento no card", () => {
  it("formata documento, whatsapp, endereço e converte decimais em número", () => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1 })],
    }), AGORA);
    const card = cardDe(board, "caso:1");
    expect(card.cliente).toEqual({
      id: 10,
      nome: "Maria da Silva",
      documento: "123.456.789-01",
      telefone: "(35) 99876-5432",
      whatsapp: "5535998765432",
      endereco: "Rua das Flores, 120",
      bairro: "Centro",
      cidade: "Pouso Alegre",
      uf: "MG",
      situacao: "active",
      dividaEmAberto: 189.9,
      diasEmAtraso: 42,
    });
    expect(card.equipamento.valor).toBe(290);
  });

  it("valor nulo continua nulo (nunca inventamos R$); dívida nula vira zero", () => {
    const board = montarBoard(entradas({
      casos: [caso({ id: 1, equipamento: equipamento({ id: 1, valor: null }), cliente: cliente({ dividaEmAberto: null, diasEmAtraso: null }) })],
    }), AGORA);
    const card = cardDe(board, "caso:1");
    expect(card.equipamento.valor).toBeNull();
    expect(card.cliente.dividaEmAberto).toBe(0);
    expect(card.cliente.diasEmAtraso).toBe(0);
  });
});

describe("formatarDocumento", () => {
  it("CPF e CNPJ com máscara; outro tamanho volta como veio", () => {
    expect(formatarDocumento("12345678901")).toBe("123.456.789-01");
    expect(formatarDocumento("123.456.789-01")).toBe("123.456.789-01");
    expect(formatarDocumento("12345678000199")).toBe("12.345.678/0001-99");
    expect(formatarDocumento("1234")).toBe("1234");
  });
});

describe("formatarWhatsapp", () => {
  it.each([
    ["(35) 99876-5432", "5535998765432"],
    ["35 3421-1234", "553534211234"],
    ["+55 (35) 99876-5432", "5535998765432"],
    ["5535998765432", "5535998765432"],
    ["035998765432", "5535998765432"],
  ])("%s → %s", (entrada, esperado) => {
    expect(formatarWhatsapp(entrada)).toBe(esperado);
  });

  it("fixo do DDD 55 recebe o país mesmo começando com 55", () => {
    expect(formatarWhatsapp("(55) 3222-1234")).toBe("555532221234");
  });

  it("sem número, curto demais ou de outro país → null", () => {
    expect(formatarWhatsapp(null)).toBeNull();
    expect(formatarWhatsapp("")).toBeNull();
    expect(formatarWhatsapp("9876-5432")).toBeNull();
    expect(formatarWhatsapp("+44 20 7946 0958 123")).toBeNull();
  });
});
