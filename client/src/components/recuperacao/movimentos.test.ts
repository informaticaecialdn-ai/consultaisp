import { describe, expect, it } from "vitest";
import {
  avaliarMovimento,
  cidadesDosCards,
  faixaDosDias,
  filtrarCards,
  FILTROS_INICIAIS,
  MOTIVO_ENCERRADO,
  MOTIVO_IDADE_FIXA,
  MOTIVO_SEM_CASO,
  textoPrazo,
} from "./movimentos";
import type { CardKanban, CasoKanban, ColunaKanban } from "./tipos";

const CASO_BASE: CasoKanban = {
  status: "aguardando_agendamento", prioridade: "normal", rescisaoEm: "2026-08-01", prazoAt: "2026-09-30",
  diasRetido: 32, diasRestantes: 28, agendadoEm: null, metodo: null, responsavel: null,
  notificadoEm: null, bureauStatus: "inativo", contestadoEm: null, encerradoEm: null, notas: null,
  tentativas: { total: 0, ultima: null },
};

function card(coluna: ColunaKanban, extra: Partial<CardKanban> = {}): CardKanban {
  const temCaso = coluna !== "sem_data";
  return {
    chave: temCaso ? "caso:7" : "equip:3",
    coluna,
    caseId: temCaso ? 7 : null,
    equipamento: { id: 3, tipo: "ONU", marca: "Intelbras", modelo: "110", serie: "SN1", mac: "AA:BB", patrimonio: "P-1", valor: 290, status: "retirada_pendente" },
    cliente: { id: 9, nome: "Maria da Silva", documento: "123.456.789-01", telefone: null, whatsapp: null, endereco: null, bairro: "Centro", cidade: "Uberlândia", uf: "MG", situacao: "cancelled", dividaEmAberto: 0, diasEmAtraso: 0 },
    caso: temCaso ? { ...CASO_BASE } : null,
    ...extra,
  };
}

describe("avaliarMovimento — tabela da spec", () => {
  it("soltar na própria coluna não faz nada", () => {
    expect(avaliarMovimento(card("31a60"), "31a60")).toEqual({ tipo: "nenhum" });
  });

  it("idade → recuperado conclui o caso", () => {
    for (const origem of ["ate30", "31a60", "61a90", "mais90"] as const) {
      expect(avaliarMovimento(card(origem), "recuperado")).toEqual({ tipo: "concluir", caseId: 7 });
    }
  });

  it("idade → baixado pede baixa (com confirmação na tela)", () => {
    expect(avaliarMovimento(card("mais90"), "baixado")).toEqual({ tipo: "baixar", caseId: 7 });
  });

  it("sem_data → qualquer idade abre o diálogo de caso com o equipamento", () => {
    for (const destino of ["ate30", "31a60", "61a90", "mais90"] as const) {
      expect(avaliarMovimento(card("sem_data"), destino)).toEqual({ tipo: "abrir_caso", equipamentoId: 3 });
    }
  });

  it("sem_data → encerradas é recusado: sem caso não há o que concluir", () => {
    expect(avaliarMovimento(card("sem_data"), "recuperado")).toEqual({ tipo: "recusado", motivo: MOTIVO_SEM_CASO });
    expect(avaliarMovimento(card("sem_data"), "baixado")).toEqual({ tipo: "recusado", motivo: MOTIVO_SEM_CASO });
  });

  it("idade → idade é recusado: a idade vem da rescisão", () => {
    expect(avaliarMovimento(card("ate30"), "61a90")).toEqual({ tipo: "recusado", motivo: MOTIVO_IDADE_FIXA });
    expect(avaliarMovimento(card("mais90"), "ate30")).toEqual({ tipo: "recusado", motivo: MOTIVO_IDADE_FIXA });
  });

  it("idade → sem_data é recusado: caso aberto tem rescisão", () => {
    expect(avaliarMovimento(card("31a60"), "sem_data")).toEqual({ tipo: "recusado", motivo: MOTIVO_IDADE_FIXA });
  });

  it("encerrado → qualquer coluna é recusado, inclusive entre encerradas", () => {
    for (const origem of ["recuperado", "baixado"] as const) {
      for (const destino of ["sem_data", "ate30", "mais90", "recuperado", "baixado"] as const) {
        if (origem === destino) continue;
        expect(avaliarMovimento(card(origem), destino)).toEqual({ tipo: "recusado", motivo: MOTIVO_ENCERRADO });
      }
    }
  });

  it("card de idade sem caseId não é movido para encerrado", () => {
    expect(avaliarMovimento(card("ate30", { caseId: null }), "recuperado").tipo).toBe("recusado");
  });
});

describe("faixaDosDias — limites inclusivos iguais aos das colunas", () => {
  it.each([
    [0, "ok"], [30, "ok"], [31, "gated"], [60, "gated"], [61, "past"], [90, "past"], [91, "danger"], [400, "danger"],
  ] as const)("%i dias → %s", (dias, faixa) => {
    expect(faixaDosDias(dias)).toBe(faixa);
  });
});

describe("textoPrazo", () => {
  it.each([
    [10, "vence em 10 dias"], [1, "vence amanhã"], [0, "vence hoje"], [-1, "vencido há 1 dia"], [-15, "vencido há 15 dias"],
  ] as const)("%i → %s", (dias, texto) => {
    expect(textoPrazo(dias)).toBe(texto);
  });
});

describe("filtrarCards", () => {
  const base = card("31a60");
  const cards: CardKanban[] = [
    card("ate30", { chave: "caso:1", caseId: 1 }),
    card("31a60", {
      chave: "caso:2",
      caseId: 2,
      cliente: { ...base.cliente, nome: "José Pereira", documento: "987.654.321-00", cidade: "Araguari" },
      caso: { ...CASO_BASE, prioridade: "critica", responsavel: { id: 5, nome: "Ana" } },
    }),
    card("sem_data"),
  ];

  it("sem filtro devolve tudo", () => {
    expect(filtrarCards(cards, FILTROS_INICIAIS)).toHaveLength(3);
  });

  it("busca ignora acento e caixa no nome", () => {
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, busca: "jose" }).map(c => c.chave)).toEqual(["caso:2"]);
  });

  it("busca por documento aceita só dígitos", () => {
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, busca: "98765" }).map(c => c.chave)).toEqual(["caso:2"]);
  });

  it("busca por série/patrimônio encontra", () => {
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, busca: "p-1" })).toHaveLength(3);
  });

  it("prioridade exclui cards sem caso", () => {
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, prioridade: "critica" }).map(c => c.chave)).toEqual(["caso:2"]);
  });

  it("responsável por id e 'sem'", () => {
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, responsavel: "5" }).map(c => c.chave)).toEqual(["caso:2"]);
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, responsavel: "sem" }).map(c => c.chave)).toEqual(["caso:1", "equip:3"]);
  });

  it("cidade", () => {
    expect(filtrarCards(cards, { ...FILTROS_INICIAIS, cidade: "Araguari" }).map(c => c.chave)).toEqual(["caso:2"]);
  });

  it("cidadesDosCards lista distintas em ordem", () => {
    expect(cidadesDosCards(cards)).toEqual(["Araguari", "Uberlândia"]);
  });
});
