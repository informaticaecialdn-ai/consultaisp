/**
 * O card de cobrança conta a história do caso (pedido do dono, 05/09/2026):
 * quem, quanto e desde quando, o acordo e as parcelas, o que fazer agora e
 * com quem falar. As funções puras rodam de verdade; o JSX é travado pelo
 * fonte.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  diasNoStatusDoCaso, MOTIVO_SEM_TEMPO_NA_COLUNA, resumoDoAcordo, textoDoTempoNaColuna,
  TOM_DA_FAIXA_DO_DIA, vencimentoMaisAntigo,
} from "./CardCaso";
import { proximoContato } from "./formatacao";

const fonte = readFileSync(new URL("./CardCaso.tsx", import.meta.url), "utf8");
const semNbsp = (s: string) => s.replace(/ /g, " ");

describe("vencimentoMaisAntigo", () => {
  it("é hoje menos os dias de atraso; sem atraso não há vencimento", () => {
    const hoje = new Date(2026, 8, 5);
    expect(vencimentoMaisAntigo(46, hoje)?.toISOString().slice(0, 10)).toBe("2026-07-21");
    expect(vencimentoMaisAntigo(0, hoje)).toBeNull();
  });
});

describe("resumoDoAcordo", () => {
  it("parcelamento: parcelas × valor, entrada, pagas/total e a próxima (com aviso de atraso)", () => {
    expect(semNbsp(resumoDoAcordo({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 50, parcelas: 3, valorParcela: 100, parcelasPagas: 1, proximaParcela: { numero: 2, vencimento: "2026-09-10", valor: 100, atrasada: false }, aceitaEm: null })))
      .toBe("3x de R$ 100,00 · entrada R$ 50,00 · 1/3 pagas · próxima 10/09/2026");
    expect(semNbsp(resumoDoAcordo({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 0, parcelas: 3, valorParcela: 100, parcelasPagas: 2, proximaParcela: { numero: 3, vencimento: "2026-08-10", valor: 100, atrasada: true }, aceitaEm: null })))
      .toBe("3x de R$ 100,00 · 2/3 pagas · próxima 10/08/2026 (atrasada)");
  });
  it("à vista: o valor negociado", () => {
    expect(semNbsp(resumoDoAcordo({ id: 2, tipo: "a_vista", status: "proposta", valorNegociado: 250, entrada: 0, parcelas: 1, valorParcela: null, parcelasPagas: 0, proximaParcela: null, aceitaEm: null }))).toBe("à vista R$ 250,00");
  });
});

/**
 * A faixa do dia é a ordem em que a coluna vem do servidor (vencido, hoje,
 * sem data, agendado). O card diz a que faixa pertence — sem isso o operador
 * não sabe por que aquele card está na frente.
 */
describe("faixa do dia no card", () => {
  const hoje = new Date(2026, 8, 6, 10, 0);
  const emDias = (dias: number) => new Date(2026, 8, 6 + dias, 9, 0).toISOString();

  it("cada faixa tem o texto e o tom que o operador lê de longe", () => {
    const faixa = (iso: string | null) => proximoContato(iso, hoje);
    expect(faixa(emDias(-3))).toMatchObject({ urgencia: "vencido", texto: "vencido há 3 dias" });
    expect(faixa(emDias(0))).toMatchObject({ urgencia: "hoje", texto: "hoje" });
    expect(faixa(emDias(2))).toMatchObject({ urgencia: "futuro", texto: "em 2 dias" });
    expect(faixa(null)).toMatchObject({ urgencia: "sem_data", texto: "sem data" });

    // vencido e SEM DATA são os dois vermelhos: caso parado vira dívida perdida
    expect(TOM_DA_FAIXA_DO_DIA.vencido).toBe("danger");
    expect(TOM_DA_FAIXA_DO_DIA.sem_data).toBe("danger");
    expect(TOM_DA_FAIXA_DO_DIA.hoje).toBe("gated");
    expect(TOM_DA_FAIXA_DO_DIA.futuro).toBe("neutro");
  });

  it("o selo aparece no alto do card e some no caso fechado", () => {
    expect(fonte).toContain("card-faixa-do-dia-${item.id}");
    expect(fonte).toContain("{!fechado && (");
    expect(fonte).toContain("TOM_DA_FAIXA_DO_DIA[contato.urgencia]");
  });
});

describe("o card, pelo fonte", () => {
  it("QUEM: nome inteiro (duas linhas, sem cortar), cidade e bairro, documento, situação do contrato", () => {
    expect(fonte).toContain("[-webkit-line-clamp:2]");
    expect(fonte).toContain("card-nome-${item.id}");
    expect(fonte).toContain("[cliente.bairro, cliente.cidade].filter(Boolean)");
    expect(fonte).toContain("situacaoDoErp(cliente.statusErp)");
  });
  it("QUANTO E DESDE QUANDO: a dívida em destaque, faturas vencidas, a mais antiga, o valor na abertura", () => {
    expect(fonte).toContain("card-divida-${item.id}");
    expect(fonte).toContain("fatura${faturas === 1 ? \"\" : \"s\"} vencida");
    expect(fonte).toContain("a mais antiga venceu ${dataBr(maisAntiga.toISOString())}");
    expect(fonte).toContain("na abertura do caso: {brl(item.valorAbertura)}");
  });
  it("O ACORDO: tipo, status e o andamento das parcelas quando há negociação viva", () => {
    expect(fonte).toContain("card-acordo-${item.id}");
    expect(fonte).toContain("resumoDoAcordo(acordo)");
  });
  it("O QUE FAZER AGORA: a etapa da régua com a AÇÃO escrita, o canal sugerido e o tom do DNA", () => {
    expect(fonte).toContain("card-etapa-${item.id}");
    expect(fonte).toContain("card-acao-${item.id}");
    expect(fonte).toContain("{etapa.acao}");
    expect(fonte).toContain("<SeloTom tom={tom} />");
    // canal sugerido: sai da etapa da régua e só existe com etapa — canal não se inventa
    expect(fonte).toContain("card-canal-${item.id}");
    expect(fonte).toContain("ROTULO_CANAL[etapa.canalSugerido]");
    expect(fonte).toMatch(/\{etapa && \(\s*<p className="mt-0\.5 pl-4/);
  });
  it("FOLLOW-UP: as quatro coisas claras (próxima ação, dono, quando, status) e o caso PARADO em vermelho", () => {
    expect(fonte).toContain("card-followup-${item.id}");
    expect(fonte).toContain("card-proxima-acao-${item.id}");
    expect(fonte).toContain("sem próxima ação — defina no próximo contato");
    expect(fonte).toContain("item.proximoContatoEm === null && !fechado");
    expect(fonte).toContain("ROTULO_STATUS_DE_CASO[item.status as StatusDeCaso]");
    // a régua só SUGERE (≈); a próxima ação escrita pelo operador vence
    expect(fonte).toContain("item.proximaAcao ? (");
    expect(fonte).toContain("≈ ${etapa.acao}");
  });
  it("COM QUEM: responsável, próximo e último contato, telefone com WhatsApp, chat", () => {
    expect(fonte).toContain("próximo contato ${contato.texto}");
    expect(fonte).toContain("último {dataBr(item.ultimoContatoEm)}");
    expect(fonte).toContain("nenhum contato ainda");
    expect(fonte).toContain("<LinkWhatsapp");
    expect(fonte).toContain("card-chat-${item.id}");
  });
  it("as ações e os testids que o quadro e a fila esperam continuam", () => {
    for (const id of ["card-caso-", "card-contato-", "card-pegar-", "card-enviar-chat-", "card-360-"]) expect(fonte).toContain(`${id}\${item.id}`);
    expect(fonte).toContain("item.responsavelUserId === null && acoes.onPegar !== undefined");
    expect(fonte).toContain("acoes.onEnviarParaChat && !item.chat");
  });
});

/**
 * ESTEIRA (pedido do dono, 06/09/2026): o card diz há quantos dias o caso está
 * parado NAQUELE posto, e o botão principal ganha o verbo da coluna quando
 * insistir no contato mandaria o operador repetir o que ele já fez.
 */
describe("tempo na coluna", () => {
  const hoje = new Date(2026, 8, 6, 15, 0);

  it("prefere o número que a rota contou", () => {
    expect(diasNoStatusDoCaso({ diasNoStatus: 4, statusDesde: "2026-01-01T00:00:00Z" }, hoje)).toBe(4);
    expect(diasNoStatusDoCaso({ diasNoStatus: 0 }, hoje)).toBe(0);
  });

  it("sem o número, deriva de statusDesde por dia civil", () => {
    expect(diasNoStatusDoCaso({ statusDesde: new Date(2026, 8, 3, 23, 0).toISOString() }, hoje)).toBe(3);
    expect(diasNoStatusDoCaso({ statusDesde: new Date(2026, 8, 6, 1, 0).toISOString() }, hoje)).toBe(0);
  });

  it("sem os dois é null — a tela mostra '—' com o motivo, e nunca zero", () => {
    expect(diasNoStatusDoCaso({}, hoje)).toBeNull();
    expect(diasNoStatusDoCaso({ diasNoStatus: null, statusDesde: null }, hoje)).toBeNull();
    expect(diasNoStatusDoCaso({ statusDesde: "não é data" }, hoje)).toBeNull();
    expect(textoDoTempoNaColuna(null)).toBe("—");
    expect(MOTIVO_SEM_TEMPO_NA_COLUNA).toMatch(/ainda não informa/);
    // updatedAt não vale como substituto, e o motivo diz por quê
    expect(MOTIVO_SEM_TEMPO_NA_COLUNA).toMatch(/updatedAt/);
  });

  it("data no futuro (relógio adiantado) vira 0, nunca negativo", () => {
    expect(diasNoStatusDoCaso({ statusDesde: new Date(2026, 8, 9).toISOString() }, hoje)).toBe(0);
    expect(diasNoStatusDoCaso({ diasNoStatus: -3 }, hoje)).toBe(0);
  });

  it("zero é 'chegou hoje' — outra coisa que ausência", () => {
    expect(textoDoTempoNaColuna(0)).toBe("chegou hoje");
    expect(textoDoTempoNaColuna(1)).toBe("há 1 dia aqui");
    expect(textoDoTempoNaColuna(12)).toBe("há 12 dias aqui");
  });

  it("o selo está no card, em mono tabular, e some no caso fechado", () => {
    expect(fonte).toContain("card-tempo-na-coluna-${item.id}");
    expect(fonte).toContain("tomDoTempoNaColuna(diasAqui)");
    expect(fonte).toContain("textoDoTempoNaColuna(diasAqui)");
    expect(fonte).toContain("MOTIVO_SEM_TEMPO_NA_COLUNA");
    // o selo vive dentro do mesmo `{!fechado && (` da faixa do dia
    expect(fonte).toMatch(/\{!fechado && \([\s\S]{0,900}card-tempo-na-coluna/);
  });
});

describe("o verbo da coluna no botão do card", () => {
  it("negociando: o principal é registrar o acordo, e o contato continua ali como secundário", () => {
    expect(fonte).toContain("acaoPrincipalDoCard(item.status) === \"acordo\"");
    expect(fonte).toContain("card-acordo-botao-${item.id}");
    expect(fonte).toContain("acordoEhPrincipal ? BOTAO_SECUNDARIO : BOTAO_MARCA");
    // o botão de contato nunca sai do card
    expect(fonte).toContain("card-contato-${item.id}");
  });

  it("sem `onNegociar` o card não oferece acordo nenhum — nada promete o que a tela não abre", () => {
    expect(fonte).toContain("acoes.onNegociar !== undefined");
    expect(fonte).toContain("rotuloDoAcordo !== null");
    expect(fonte).toContain("!overlay && !fechado");
  });

  it("o title do botão diz o verbo que tira o caso da coluna", () => {
    expect(fonte).toContain("O que tira o caso desta coluna: ${verboDaColuna(item.status)}");
  });
});
