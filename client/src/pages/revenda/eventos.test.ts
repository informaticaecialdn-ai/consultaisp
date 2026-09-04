/**
 * A trilha da marca na tela.
 *
 * O que estes testes protegem é uma regra de auditoria, não de estilo: evento
 * que a tela não sabe nomear tem de APARECER mesmo assim. Uma trilha
 * append-only que esconde a linha desconhecida afirma, para quem lê, que
 * naquele intervalo ninguém mexeu em nada.
 */
import { describe, it, expect } from "vitest";
import {
  rotuloDaAcao,
  quemFez,
  complementoDoEvento,
  dataHoraDoEvento,
  type EventoNaTela,
} from "./eventos";

const EVENTO: EventoNaTela = {
  id: 1,
  acao: "editar_marca",
  atorRole: "revendedor",
  providerId: null,
  detalhe: {},
  createdAt: "2026-09-03T14:32:00.000Z",
};

describe("rotuloDaAcao", () => {
  it("traduz as ações do catálogo", () => {
    expect(rotuloDaAcao("suspender")).toBe("Provedor suspenso");
    expect(rotuloDaAcao("criar_usuario_revenda")).toBe("Pessoa adicionada à equipe");
  });

  it("ação sem rótulo aparece crua em vez de sumir", () => {
    /* O catálogo real vive no serviço do servidor. Uma ação nova entra lá antes
       de entrar aqui, e nesse intervalo a linha continua visível. */
    expect(rotuloDaAcao("acao_que_ainda_nao_existe")).toBe("acao_que_ainda_nao_existe");
  });
});

describe("quemFez", () => {
  it("separa o que a plataforma fez do que a equipe da marca fez", () => {
    expect(quemFez("superadmin")).toBe("plataforma");
    expect(quemFez("revendedor")).toBe("sua equipe");
  });

  it("usa o nome quando a rota o enriquece, sem perder o papel", () => {
    expect(quemFez("superadmin", "Ana")).toBe("Ana · plataforma");
  });
});

describe("complementoDoEvento", () => {
  it("sem nome de provedor e sem motivo, não inventa segunda linha", () => {
    expect(complementoDoEvento(EVENTO)).toBe("");
  });

  it("mostra o provedor e o motivo da suspensão, que é obrigatório na rota", () => {
    expect(
      complementoDoEvento({
        ...EVENTO,
        acao: "suspender",
        providerId: 4,
        provedorNome: "Fibra Norte",
        detalhe: { motivo: "inadimplência de 90 dias" },
      }),
    ).toBe("Fibra Norte — inadimplência de 90 dias");
  });

  it("ignora o resto do JSONB: o formato muda por ação e chave crua é ruído", () => {
    expect(
      complementoDoEvento({ ...EVENTO, detalhe: { antes: { corBrand: "#111111" }, motivo: 42 } }),
    ).toBe("");
  });

  it("aguenta detalhe nulo", () => {
    expect(complementoDoEvento({ ...EVENTO, detalhe: null })).toBe("");
  });
});

describe("dataHoraDoEvento", () => {
  it("data sem valor ou impossível de ler vira travessão, não 'Invalid Date'", () => {
    expect(dataHoraDoEvento(null)).toBe("—");
    expect(dataHoraDoEvento("")).toBe("—");
    expect(dataHoraDoEvento("nao e data")).toBe("—");
  });

  it("formata em pt-BR com hora e minuto", () => {
    /* O fuso do ambiente decide a hora exibida; o que se afirma aqui é a FORMA,
       que é o que a coluna mono precisa para alinhar. */
    expect(dataHoraDoEvento(EVENTO.createdAt)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });
});
