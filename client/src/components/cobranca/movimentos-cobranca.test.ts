/**
 * A tabela de arrasto do kanban de cobrança, fronteira a fronteira.
 *
 * O que está preso aqui é o que impede o gesto de virar um PATCH que o
 * servidor recusa com 409 depois de a coluna já ter mudado na tela — e o que
 * impede o operador de sumir com dívida (baixar/encerrar) por arrasto.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { STATUS_DE_CASO } from "@shared/cobranca/estados";
import {
  acaoPrincipalDoCard, avaliarMovimentoDeCaso, COLUNAS_DESFECHO, COLUNAS_RECOLHIDAS, COLUNAS_VIVAS, contarGargalosDaColuna,
  CORTES_DO_TEMPO_NA_COLUNA, ORDEM_DO_QUADRO, rotuloDoBotaoDeAcordo, tomDoTempoNaColuna, VERBO_DA_COLUNA, verboDaColuna,
  MOTIVO_ACORDO_NASCE_DO_ACEITE, MOTIVO_CASO_FECHADO, MOTIVO_MESMA_COLUNA, MOTIVO_SO_ADMIN, tituloDoMovimento, COR_DO_TOM, tomDaColunaDoKanban, tomDaEtapaDaRegua , destinoDoBotaoDeAcordo} from "./movimentos-cobranca";

const caso = (status: string) => ({ id: 1, status, valorAtual: 100 });
const operador = { podeAdministrar: false };
const admin = { podeAdministrar: true };

describe("o quadro cobre todo status da máquina de estados", () => {
  it("toda coluna é um status conhecido e todo status tem coluna", () => {
    expect([...ORDEM_DO_QUADRO].sort()).toEqual([...STATUS_DE_CASO].sort());
  });

  it("vivas → desfecho → recolhidas, nessa ordem", () => {
    expect(ORDEM_DO_QUADRO).toEqual([...COLUNAS_VIVAS, ...COLUNAS_DESFECHO, ...COLUNAS_RECOLHIDAS]);
    expect(COLUNAS_VIVAS[0]).toBe("aberto");
    expect(COLUNAS_DESFECHO).toEqual(["pago", "cancelamento"]);
  });
});

describe("avaliarMovimentoDeCaso", () => {
  it("mesma coluna não é movimento", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "aberto", operador)).toEqual({ tipo: "nenhum" });
  });

  it("aberto ⇄ em_contato é PATCH direto, para o operador", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "em_contato", operador)).toEqual({ tipo: "direto", status: "em_contato" });
    expect(avaliarMovimentoDeCaso(caso("em_contato"), "aberto", operador)).toEqual({ tipo: "direto", status: "aberto" });
  });

  it("negociando abre o diálogo — o status nasce da proposta, não do arrasto", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "negociando", operador)).toEqual({ tipo: "negociar" });
    expect(avaliarMovimentoDeCaso(caso("em_contato"), "negociando", operador)).toEqual({ tipo: "negociar" });
  });

  it("acordo ativo nunca é destino de arrasto: nasce do aceite", () => {
    const r = avaliarMovimentoDeCaso(caso("negociando"), "acordo_ativo", admin);
    expect(r).toEqual({ tipo: "recusado", motivo: MOTIVO_ACORDO_NASCE_DO_ACEITE });
  });

  it("cancelamento abre o diálogo de motivo, de qualquer status vivo", () => {
    for (const de of ["aberto", "em_contato", "negociando", "acordo_ativo", "negativado"]) {
      expect(avaliarMovimentoDeCaso(caso(de), "cancelamento", operador), de).toEqual({ tipo: "cancelar" });
    }
  });

  it("pago é do operador; baixado e encerrado só do admin", () => {
    expect(avaliarMovimentoDeCaso(caso("aberto"), "pago", operador)).toEqual({ tipo: "direto", status: "pago" });
    expect(avaliarMovimentoDeCaso(caso("aberto"), "baixado", operador)).toEqual({ tipo: "recusado", motivo: MOTIVO_SO_ADMIN });
    expect(avaliarMovimentoDeCaso(caso("aberto"), "encerrado", operador)).toEqual({ tipo: "recusado", motivo: MOTIVO_SO_ADMIN });
    expect(avaliarMovimentoDeCaso(caso("aberto"), "baixado", admin)).toEqual({ tipo: "direto", status: "baixado" });
  });

  it("caso fechado não volta ao quadro", () => {
    for (const de of ["pago", "baixado", "encerrado", "cancelamento"]) {
      expect(avaliarMovimentoDeCaso(caso(de), "aberto", admin), de).toEqual({ tipo: "recusado", motivo: MOTIVO_CASO_FECHADO });
    }
  });

  it("negativado não volta a aberto nem a em_contato — a máquina de estados manda", () => {
    expect(avaliarMovimentoDeCaso(caso("negativado"), "aberto", admin).tipo).toBe("recusado");
    expect(avaliarMovimentoDeCaso(caso("negativado"), "em_contato", admin).tipo).toBe("recusado");
    // ...mas negocia e paga.
    expect(avaliarMovimentoDeCaso(caso("negativado"), "negociando", operador)).toEqual({ tipo: "negociar" });
    expect(avaliarMovimentoDeCaso(caso("negativado"), "pago", operador)).toEqual({ tipo: "direto", status: "pago" });
  });

  it("a frase de recusa nunca é vazia", () => {
    const r = avaliarMovimentoDeCaso(caso("pago"), "aberto", admin);
    expect(r.tipo === "recusado" && r.motivo.length > 10).toBe(true);
    expect(MOTIVO_MESMA_COLUNA.length).toBeGreaterThan(5);
  });
});

describe("tituloDoMovimento", () => {
  it("tem frase para cada coluna de destino direto", () => {
    for (const s of ["em_contato", "aberto", "pago", "negativado", "baixado", "encerrado", "cancelamento"] as const) {
      expect(tituloDoMovimento(s)).not.toBe("Caso movido");
    }
  });
});

describe("cores do funil", () => {
  it("cada coluna do fluxo tem um tom; desconhecida e neutra", () => {
    expect(tomDaColunaDoKanban("aberto")).toBe("neutro");
    expect(tomDaColunaDoKanban("em_contato")).toBe("info");
    expect(tomDaColunaDoKanban("negociando")).toBe("gated");
    expect(tomDaColunaDoKanban("acordo_ativo")).toBe("ok");
    expect(tomDaColunaDoKanban("pago")).toBe("ok");
    expect(tomDaColunaDoKanban("negativado")).toBe("danger");
    expect(tomDaColunaDoKanban("cancelamento")).toBe("past");
    expect(tomDaColunaDoKanban("qualquer")).toBe("neutro");
  });
  it("a etapa da regua esquenta com o atraso: lembrete azul, aviso e negociacao ambar, pre-negativacao vermelho, divida antiga e fim de linha vinho", () => {
    expect(tomDaEtapaDaRegua("lembrete_atraso")).toBe("info");
    expect(tomDaEtapaDaRegua("aviso_suspensao")).toBe("gated");
    expect(tomDaEtapaDaRegua("negociacao_recuperacao")).toBe("gated");
    expect(tomDaEtapaDaRegua("pre_negativacao")).toBe("danger");
    expect(tomDaEtapaDaRegua("divida_antiga")).toBe("past");
    expect(tomDaEtapaDaRegua("fim_de_linha")).toBe("past");
    expect(tomDaEtapaDaRegua(null)).toBe("marca");
  });
  it("todo tom tem uma cor de token, nunca hex nem paleta do Tailwind", () => {
    for (const cor of Object.values(COR_DO_TOM)) expect(cor).toMatch(/^var\(--[a-z-]+\)$/);
  });
});

/**
 * A coluna como POSTO DE TRABALHO (pedido do dono, 06/09/2026: "o kanban
 * precisa ser uma esteira de resolução da cobrança"): o verbo que tira o caso
 * dali, o que trava a coluna e o tempo que esquenta.
 */
describe("o verbo da coluna", () => {
  it("cada coluna viva diz o que se faz ali para o caso sair", () => {
    expect(verboDaColuna("aberto")).toBe("registrar contato");
    expect(verboDaColuna("em_contato")).toBe("propor acordo");
    expect(verboDaColuna("negociando")).toBe("registrar o aceite");
    expect(verboDaColuna("acordo_ativo")).toBe("conferir a parcela");
  });

  it("coluna de desfecho não tem verbo: o caso já saiu da esteira", () => {
    for (const s of [...COLUNAS_DESFECHO, ...COLUNAS_RECOLHIDAS]) expect(verboDaColuna(s), s).toBeNull();
    expect(verboDaColuna("inventada")).toBeNull();
  });

  it("toda coluna viva tem verbo — nenhuma gaveta sem trabalho declarado", () => {
    for (const s of COLUNAS_VIVAS) expect(VERBO_DA_COLUNA[s], s).toBeTruthy();
  });
});

describe("o botão de acordo do card", () => {
  it("em contato PROPÕE; negociando REGISTRA o aceite; nas outras não há botão", () => {
    expect(rotuloDoBotaoDeAcordo("em_contato")).toBe("Propor acordo");
    expect(rotuloDoBotaoDeAcordo("negociando")).toBe("Registrar aceite");
    // E o aceite mora na FICHA: o dialogo so cria negociacao, e o caso em
    // "negociando" ja tem uma viva — o botao daria 409 sempre.
    expect(destinoDoBotaoDeAcordo("negociando")).toBe("ficha");
    expect(destinoDoBotaoDeAcordo("em_contato")).toBe("dialogo");
    for (const s of ["aberto", "acordo_ativo", "pago", "cancelamento", "negativado"]) {
      expect(rotuloDoBotaoDeAcordo(s), s).toBeNull();
    }
  });

  it("só 'negociando' troca o botão principal — nas demais o principal continua o contato", () => {
    expect(acaoPrincipalDoCard("negociando")).toBe("acordo");
    for (const s of ["aberto", "em_contato", "acordo_ativo", "pago"]) {
      expect(acaoPrincipalDoCard(s), s).toBe("contato");
    }
  });
});

describe("o que trava a coluna", () => {
  const hoje = new Date(2026, 8, 6, 10, 0);
  const emDias = (dias: number) => new Date(2026, 8, 6 + dias, 9, 0).toISOString();

  it("conta contato vencido, sem próxima ação e sem dono sobre os casos que a coluna recebeu", () => {
    const g = contarGargalosDaColuna([
      { responsavelUserId: 7, proximoContatoEm: emDias(-2) },   // vencido, com dono
      { responsavelUserId: null, proximoContatoEm: null },      // parado e sem dono
      { responsavelUserId: 7, proximoContatoEm: emDias(0) },    // hoje: não trava
      { responsavelUserId: 7, proximoContatoEm: emDias(3) },    // agendado: não trava
    ], hoje);
    expect(g).toEqual({ contatoVencido: 1, semProximaAcao: 1, semDono: 1, base: 4 });
  });

  it("vencido e sem data são cortes disjuntos: quem tem data não entra em 'sem próxima ação'", () => {
    const g = contarGargalosDaColuna([{ responsavelUserId: 1, proximoContatoEm: emDias(-9) }], hoje);
    expect(g.contatoVencido).toBe(1);
    expect(g.semProximaAcao).toBe(0);
  });

  it("coluna vazia não trava nada, e a base é zero — a tela decide não mostrar", () => {
    expect(contarGargalosDaColuna([], hoje)).toEqual({ contatoVencido: 0, semProximaAcao: 0, semDono: 0, base: 0 });
  });
});

describe("o tempo na coluna esquenta", () => {
  it("os cortes são os declarados, e o limite pertence à faixa mais quente", () => {
    expect(tomDoTempoNaColuna(0)).toBe("neutro");
    expect(tomDoTempoNaColuna(CORTES_DO_TEMPO_NA_COLUNA.atencao - 1)).toBe("neutro");
    expect(tomDoTempoNaColuna(CORTES_DO_TEMPO_NA_COLUNA.atencao)).toBe("gated");
    expect(tomDoTempoNaColuna(CORTES_DO_TEMPO_NA_COLUNA.perigo - 1)).toBe("gated");
    expect(tomDoTempoNaColuna(CORTES_DO_TEMPO_NA_COLUNA.perigo)).toBe("danger");
    expect(tomDoTempoNaColuna(90)).toBe("danger");
  });

  it("sem medição não há tom: ausência não pinta de verde nem de vermelho", () => {
    expect(tomDoTempoNaColuna(null)).toBe("neutro");
    expect(tomDoTempoNaColuna(undefined)).toBe("neutro");
  });

  it("os cortes são crescentes e o comentário do fonte diz que são escolha nossa", () => {
    expect(CORTES_DO_TEMPO_NA_COLUNA.atencao).toBeLessThan(CORTES_DO_TEMPO_NA_COLUNA.perigo);
    const fonte = readFileSync(new URL("./movimentos-cobranca.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/ESCOLHA NOSSA[\s\S]{0,200}não medição/);
  });
});
