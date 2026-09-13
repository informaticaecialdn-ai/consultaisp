import { afterEach, describe, expect, it, vi } from "vitest";
import { avaliarPedidoDeAcordo } from "@shared/cobranca/acordo";
import { feriadosDoChat, janelaDoChat } from "@shared/cobranca/automacao-chat";
import { etapasDaPolitica, PoliticaSchema, validarNegociacao } from "@shared/cobranca/politica";
import { etapaParaAtraso } from "@shared/cobranca/regua";
import type { Carteira, StatusDeCaso } from "@shared/cobranca/estados";
import { dataLocal } from "../services/chat/chat-autonomia-politica";
import {
  DIAS_UTEIS_ENTRE_PRE_AVISO_E_NEGATIVACAO,
  eventosDaNegociacao,
  primeiraNegativacaoPermitida,
  trilhaDosCasos,
  type CasoDaTrilha,
  type EntradaDaTrilha,
} from "./semeadura-negociacoes";

const DIA_MS = 86_400_000;
const PROVEDOR = 19;
const ADMIN = 7;

/** A política que o sandbox grava: tudo no padrão, com a origem da cobrança `manual` nas duas carteiras. */
const politica = PoliticaSchema.parse({
  acordo: { ativo: { origemDaCobranca: "manual" }, ex_cliente: { origemDaCobranca: "manual" } },
});
const etapas = etapasDaPolitica(politica);

/**
 * Três relógios: quinta ao meio-dia, sábado à noite e domingo (São Paulo).
 * A trilha não pode depender do dia em que o visitante chega.
 */
const AGORAS = [
  new Date("2026-09-10T15:00:00Z"),
  new Date("2026-09-13T02:30:00Z"),
  new Date("2026-09-13T15:00:00Z"),
];

interface Molde {
  id: number;
  status: StatusDeCaso;
  carteira: Carteira;
  dias: number;
  valor: number;
  abertoHaDias: number;
  statusHaDias: number;
  propostaHaDias?: number;
}

function casoDe(agora: Date, m: Molde): CasoDaTrilha {
  const atras = (dias: number) => new Date(agora.getTime() - dias * DIA_MS);
  return {
    id: m.id,
    customerId: 1000 + m.id,
    status: m.status,
    carteira: m.carteira,
    // A mesma conta do semeador: a etapa de HOJE pela régua real.
    etapaAtual: etapaParaAtraso(m.dias, m.carteira, etapas).etapa?.id ?? null,
    quadranteDna: "B2",
    tom: "firme_gentil",
    abertoEm: atras(m.abertoHaDias),
    statusDesde: atras(m.statusHaDias),
    propostaEm: m.propostaHaDias === undefined ? null : atras(m.propostaHaDias),
    valorAtual: m.valor,
    diasAtraso: m.dias,
  };
}

/** Uma carteira no formato do sandbox: um de cada status vivo nas duas carteiras, mais um fechado. */
const MOLDES: Molde[] = [
  { id: 1, status: "aberto", carteira: "ativo", dias: 20, valor: 99.9, abertoHaDias: 0, statusHaDias: 0 },
  { id: 2, status: "em_contato", carteira: "ativo", dias: 45, valor: 119.9, abertoHaDias: 3, statusHaDias: 2 },
  { id: 3, status: "negociando", carteira: "ativo", dias: 45, valor: 99.9, abertoHaDias: 4, statusHaDias: 1 },
  { id: 4, status: "acordo_ativo", carteira: "ativo", dias: 20, valor: 149.9, abertoHaDias: 6, statusHaDias: 2, propostaHaDias: 3 },
  { id: 5, status: "negociando", carteira: "ex_cliente", dias: 150, valor: 1089.9, abertoHaDias: 5, statusHaDias: 2 },
  { id: 6, status: "acordo_ativo", carteira: "ex_cliente", dias: 210, valor: 1289.9, abertoHaDias: 2, statusHaDias: 1 },
  { id: 7, status: "negativado", carteira: "ativo", dias: 300, valor: 79.9, abertoHaDias: 250, statusHaDias: 30 },
  { id: 8, status: "negativado", carteira: "ex_cliente", dias: 365, valor: 1189.9, abertoHaDias: 300, statusHaDias: 60 },
  { id: 9, status: "pago", carteira: "ativo", dias: 20, valor: 79.9, abertoHaDias: 10, statusHaDias: 1 },
];

function entradaDe(agora: Date, moldes: Molde[] = MOLDES): EntradaDaTrilha {
  return { providerId: PROVEDOR, adminId: ADMIN, politica, casos: moldes.map((m) => casoDe(agora, m)), agora };
}

const atrasoEm = (c: CasoDaTrilha, t: Date, agora: Date) => c.diasAtraso - Math.floor((agora.getTime() - t.getTime()) / DIA_MS);

function diasUteisEntre(de: string, ate: string): number {
  let n = 0;
  let d = de;
  while (d < ate) {
    const proximo = new Date(`${d}T12:00:00Z`);
    proximo.setUTCDate(proximo.getUTCDate() + 1);
    d = proximo.toISOString().slice(0, 10);
    const semana = proximo.getUTCDay();
    if (semana >= 1 && semana <= 5 && !feriadosDoChat(Number(d.slice(0, 4))).includes(d)) n++;
  }
  return n;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("trilhaDosCasos — negociações", () => {
  it("todo 'negociando' tem exatamente uma proposta, todo 'acordo_ativo' um acordo aceito ou ativo, e mais nenhum caso tem negociação", () => {
    for (const agora of AGORAS) {
      const entrada = entradaDe(agora);
      const { negociacoes } = trilhaDosCasos(entrada);
      for (const caso of entrada.casos) {
        const doCaso = negociacoes.filter((n) => n.casoId === caso.id);
        const rotulo = `caso ${caso.id} (${caso.status}) em ${agora.toISOString()}`;
        if (caso.status === "negociando") {
          expect(doCaso.map((n) => n.linha.status), rotulo).toEqual(["proposta"]);
        } else if (caso.status === "acordo_ativo") {
          expect(doCaso, rotulo).toHaveLength(1);
          expect(["aceita", "ativa"], rotulo).toContain(doCaso[0].linha.status);
        } else {
          expect(doCaso, rotulo).toHaveLength(0);
        }
        for (const n of doCaso) {
          expect(n.linha.providerId, rotulo).toBe(PROVEDOR);
          expect(n.linha.customerId, rotulo).toBe(caso.customerId);
          expect(n.linha.criadoPorUserId, rotulo).toBe(ADMIN);
          for (const p of n.parcelas) expect(p.providerId, rotulo).toBe(PROVEDOR);
        }
      }
    }
  });

  it("toda negociação passa em validarNegociacao e cai DENTRO da faixa da carteira (sem exceção a aprovar), medida no dia da proposta", () => {
    for (const agora of AGORAS) {
      const entrada = entradaDe(agora);
      for (const n of trilhaDosCasos(entrada).negociacoes) {
        const caso = entrada.casos.find((c) => c.id === n.casoId)!;
        const rotulo = `caso ${caso.id} (${caso.status})`;
        const l = n.linha;
        const pedido = {
          tipo: l.tipo as "parcelamento" | "quitacao_desconto",
          valorOriginal: Number(l.valorOriginal),
          valorNegociado: Number(l.valorNegociado),
          entrada: Number(l.entrada),
          parcelas: l.parcelas as number,
        };
        // A dívida negociada é a do caso (a rota recusa com SALDO_ALTERADO se não for).
        expect(pedido.valorOriginal, rotulo).toBeCloseTo(caso.valorAtual, 2);
        // O mesmo contexto da rota POST /negociacoes: sem mensalidade, vulnerável da fase 1 = false.
        expect(validarNegociacao(politica, pedido, { vulneravel: false }), rotulo).toEqual({ ok: true });
        const diasNaProposta = atrasoEm(caso, l.createdAt as Date, agora);
        expect(avaliarPedidoDeAcordo({ ...pedido, carteira: caso.carteira, diasAtraso: diasNaProposta }, politica).decisao, rotulo).toBe("dentro");
        // Entrada e parcelas representam exatamente o total (o storage recusa com VALOR_INVALIDO).
        const soma = n.parcelas.reduce((t, p) => t + Number(p.valor), 0);
        expect(Math.abs(soma - pedido.valorNegociado), rotulo).toBeLessThan(0.005);
        expect(n.parcelas.filter((p) => p.numero !== 0), rotulo).toHaveLength(pedido.parcelas);
        expect(n.parcelas.some((p) => p.numero === 0), rotulo).toBe(pedido.entrada > 0);
      }
    }
  });

  it("o acordo parcelado de ex-cliente aparece com entrada paga e parcelas futuras — a demonstração mostra os dois formatos", () => {
    const { negociacoes } = trilhaDosCasos(entradaDe(AGORAS[0]));
    const parcelados = negociacoes.filter((n) => n.linha.tipo === "parcelamento");
    const avista = negociacoes.filter((n) => n.linha.tipo === "quitacao_desconto");
    expect(parcelados.length).toBeGreaterThan(0);
    expect(avista.length).toBeGreaterThan(0);
    const ativa = negociacoes.find((n) => n.casoId === 6)!;
    expect(ativa.linha.status).toBe("ativa");
    const entradaPaga = ativa.parcelas.find((p) => p.numero === 0)!;
    expect(entradaPaga.status).toBe("paga");
    expect(Number(entradaPaga.valorPago)).toBeCloseTo(Number(ativa.linha.entrada), 2);
  });

  it("toda parcela a receber vence DEPOIS de hoje (a régua quebraria o acordo) e nunca antes do dia da proposta; paga só em acordo ativo, no aceite", () => {
    for (const agora of AGORAS) {
      const hoje = dataLocal(agora);
      for (const n of trilhaDosCasos(entradaDe(agora)).negociacoes) {
        const rotulo = `negociacao do caso ${n.casoId}`;
        const diaDaProposta = dataLocal(n.linha.createdAt as Date);
        expect(n.linha.primeiroVencimento! >= diaDaProposta, rotulo).toBe(true);
        for (const p of n.parcelas) {
          if (p.status === "pendente") {
            expect(p.vencimento > hoje, `${rotulo}: parcela ${p.numero} vence ${p.vencimento}, hoje ${hoje}`).toBe(true);
          } else {
            expect(p.status, rotulo).toBe("paga");
            expect(n.linha.status, rotulo).toBe("ativa");
            expect((p.pagoEm as Date).getTime(), rotulo).toBe((n.linha.aceitaEm as Date).getTime());
            expect((p.pagoEm as Date).getTime(), rotulo).toBeLessThanOrEqual(agora.getTime());
          }
        }
        if (n.linha.status === "proposta") expect(n.linha.aceitaEm ?? null, rotulo).toBeNull();
      }
    }
  });
});

describe("trilhaDosCasos — linha do tempo", () => {
  it("não duplica o que a transição de status já grava: só etapa_mudou e o contato do pré-aviso", () => {
    for (const agora of AGORAS) {
      const { eventos } = trilhaDosCasos(entradaDe(agora));
      expect(new Set(eventos.map((e) => e.tipo))).toEqual(new Set(["etapa_mudou", "contato"]));
    }
  });

  it("eventos de cada caso em ordem, entre a abertura e agora; caso fechado não ganha trilha", () => {
    for (const agora of AGORAS) {
      const entrada = entradaDe(agora);
      const { eventos } = trilhaDosCasos(entrada);
      expect(eventos.some((e) => e.casoId === 9)).toBe(false);
      for (const caso of entrada.casos.filter((c) => c.status !== "pago")) {
        const doCaso = eventos.filter((e) => e.casoId === caso.id);
        expect(doCaso.length, `caso ${caso.id}`).toBeGreaterThan(0);
        let anterior = 0;
        for (const e of doCaso) {
          const t = (e.ocorridoEm as Date).getTime();
          expect(t, `caso ${caso.id} ${e.tipo}`).toBeGreaterThanOrEqual(caso.abertoEm.getTime());
          expect(t, `caso ${caso.id} ${e.tipo}`).toBeLessThanOrEqual(agora.getTime());
          expect(t, `caso ${caso.id} fora de ordem`).toBeGreaterThanOrEqual(anterior);
          expect(e.providerId).toBe(PROVEDOR);
          expect(e.customerId).toBe(caso.customerId);
          anterior = t;
        }
      }
    }
  });

  it("etapa_mudou no formato da régua: abertura com de nulo, degraus encadeados pelas faixas e o último na etapa atual", () => {
    for (const agora of AGORAS) {
      const entrada = entradaDe(agora);
      const { eventos } = trilhaDosCasos(entrada);
      for (const caso of entrada.casos.filter((c) => c.status !== "pago")) {
        const rotulo = `caso ${caso.id}`;
        const degraus = eventos.filter((e) => e.casoId === caso.id && e.tipo === "etapa_mudou");
        const [abertura, ...resto] = degraus;
        const diasNaAbertura = atrasoEm(caso, caso.abertoEm, agora);
        const decisao = etapaParaAtraso(diasNaAbertura, caso.carteira, etapas);
        expect(abertura.ocorridoEm, rotulo).toEqual(caso.abertoEm);
        expect(abertura.userId, rotulo).toBeNull();
        expect(abertura.canal, rotulo).toBe("sistema");
        expect(abertura.metadata, rotulo).toEqual({
          abertura: true, de: null, para: decisao.etapa?.id ?? null, motivoSemEtapa: decisao.motivo,
          carteira: caso.carteira, diasAtraso: diasNaAbertura, valor: caso.valorAtual, quadrante: caso.quadranteDna, tom: caso.tom,
        });
        let atual = decisao.etapa?.id ?? null;
        for (const d of resto) {
          const m = d.metadata as { de: string | null; para: string | null };
          expect(Object.keys(m).sort(), rotulo).toEqual(["de", "para"]);
          expect(m.de, rotulo).toBe(atual);
          expect(m.para, rotulo).not.toBe(atual);
          expect(m.para, rotulo).toBe(etapaParaAtraso(atrasoEm(caso, d.ocorridoEm as Date, agora), caso.carteira, etapas).etapa?.id ?? null);
          expect(d.userId, rotulo).toBeNull();
          expect(d.canal, rotulo).toBe("sistema");
          atual = m.para;
        }
        expect(atual, rotulo).toBe(caso.etapaAtual);
      }
    }
  });

  it("todo negativado tem o pré-aviso formal da etapa de pré-negativação, na janela de contato, a 10 dias úteis ou mais da negativação", () => {
    expect(DIAS_UTEIS_ENTRE_PRE_AVISO_E_NEGATIVACAO).toBe(10);
    for (const agora of AGORAS) {
      const entrada = entradaDe(agora);
      const { eventos } = trilhaDosCasos(entrada);
      for (const caso of entrada.casos) {
        const contatos = eventos.filter((e) => e.casoId === caso.id && e.tipo === "contato");
        const rotulo = `caso ${caso.id} (${caso.status})`;
        if (caso.status !== "negativado") {
          expect(contatos, rotulo).toHaveLength(0);
          continue;
        }
        expect(contatos, rotulo).toHaveLength(1);
        const [aviso] = contatos;
        const em = aviso.ocorridoEm as Date;
        // O formato do POST /casos/:id/eventos: contato declarado pelo funcionário, canal da etapa, sem resultado nem metadata.
        expect(aviso.canal, rotulo).toBe("email");
        expect(aviso.userId, rotulo).toBe(ADMIN);
        expect(aviso.resultado ?? null, rotulo).toBeNull();
        expect(aviso.metadata ?? null, rotulo).toBeNull();
        expect(aviso.notas, rotulo).toMatch(/pré-aviso/i);
        // CDC art. 42: contato só dentro da janela da política.
        expect(janelaDoChat(em, politica.janelaContato).permitida, `${rotulo}: pré-aviso fora da janela em ${em.toISOString()}`).toBe(true);
        // Enviado quando o caso já estava na pré-negativação (D+90), nunca antes.
        expect(atrasoEm(caso, em, agora), rotulo).toBeGreaterThanOrEqual(90);
        const etapaNoAviso = eventos.filter((e) => e.casoId === caso.id && e.tipo === "etapa_mudou" && (e.ocorridoEm as Date).getTime() <= em.getTime()).at(-1);
        expect((etapaNoAviso!.metadata as { para: string }).para, rotulo).toBe("pre_negativacao");
        // Súmula 359 do STJ / CDC art. 43 §2: a negativação só depois do prazo.
        expect(em.getTime(), rotulo).toBeLessThan(caso.statusDesde.getTime());
        expect(diasUteisEntre(dataLocal(em), dataLocal(caso.statusDesde)), rotulo).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("primeiraNegativacaoPermitida é o começo do 10º dia útil depois do pré-aviso, e o semeador pode confiar nela", () => {
    for (const agora of AGORAS) {
      const entrada = entradaDe(agora);
      const { eventos } = trilhaDosCasos(entrada);
      for (const caso of entrada.casos.filter((c) => c.status === "negativado")) {
        const aviso = eventos.find((e) => e.casoId === caso.id && e.tipo === "contato")!;
        const permitida = primeiraNegativacaoPermitida(caso, politica, agora);
        const dia = dataLocal(permitida);
        expect(permitida.toISOString(), `caso ${caso.id}`).toBe(new Date(`${dia}T00:00:00-03:00`).toISOString());
        expect(diasUteisEntre(dataLocal(aviso.ocorridoEm as Date), dia), `caso ${caso.id}`).toBe(10);
        // Um dia antes já não é permitido: é o PRIMEIRO.
        const vespera = new Date(permitida.getTime() - DIA_MS);
        expect(diasUteisEntre(dataLocal(aviso.ocorridoEm as Date), dataLocal(vespera)), `caso ${caso.id}`).toBeLessThan(10);
      }
    }
  });
});

describe("trilhaDosCasos — falha alto quando o plano contradiz o produto", () => {
  const agora = AGORAS[0];

  it("negativado aberto e negativado no mesmo dia (sem os 10 dias úteis do pré-aviso) é recusado com o motivo legal", () => {
    // O desenho de hoje do sandbox: abre um dia antes da conversa e negativa 12 h depois.
    const entrada = entradaDe(agora, [{ id: 7, status: "negativado", carteira: "ativo", dias: 300, valor: 79.9, abertoHaDias: 1, statusHaDias: 0.5 }]);
    expect(() => trilhaDosCasos(entrada)).toThrow(/Sumula 359/);
  });

  it("negativado antes de a dívida chegar à pré-negativação é recusado", () => {
    const entrada = entradaDe(agora, [{ id: 7, status: "negativado", carteira: "ativo", dias: 60, valor: 79.9, abertoHaDias: 40, statusHaDias: 5 }]);
    expect(() => trilhaDosCasos(entrada)).toThrow(/pre-negativacao/);
  });

  it("acordo proposto há tanto tempo que a parcela já teria vencido é recusado", () => {
    const entrada = entradaDe(agora, [{ id: 4, status: "acordo_ativo", carteira: "ativo", dias: 60, valor: 149.9, abertoHaDias: 25, statusHaDias: 20, propostaHaDias: 22 }]);
    expect(() => trilhaDosCasos(entrada)).toThrow(/vence/);
  });

  it("dívida prescrita (CC art. 206 §5º I) não vira caso vivo, proposta nem negativação — a régua a encerraria", () => {
    for (const molde of [
      { id: 7, status: "negativado" as const, carteira: "ex_cliente" as const, dias: 1900, valor: 1189.9, abertoHaDias: 1800, statusHaDias: 60 },
      { id: 5, status: "negociando" as const, carteira: "ex_cliente" as const, dias: 1830, valor: 1089.9, abertoHaDias: 5, statusHaDias: 2 },
    ]) {
      expect(() => trilhaDosCasos(entradaDe(agora, [molde])), molde.status).toThrow(/prescrita/);
    }
  });

  it("caso cuja etapa gravada não é a da régua é recusado", () => {
    const entrada = entradaDe(agora, [MOLDES[1]]);
    entrada.casos[0].etapaAtual = "divida_antiga";
    expect(() => trilhaDosCasos(entrada)).toThrow(/etapa/);
  });
});

describe("eventosDaNegociacao — o que só existe depois do insert", () => {
  const agora = AGORAS[0];
  const { negociacoes } = trilhaDosCasos(entradaDe(agora));
  const idsDe = (i: number) => ({ negociacaoId: 500 + i, parcelaIds: negociacoes[i].parcelas.map((_, k) => 900 + i * 10 + k) });

  it("proposta: a metadata do negociacao_proposta é a do storage, sem exigir aprovação — o aceite de qualquer operador passa no portão", () => {
    const i = negociacoes.findIndex((n) => n.casoId === 5);
    const n = negociacoes[i];
    const r = eventosDaNegociacao(n, idsDe(i));
    expect(r.metadataDoAceite).toBeNull();
    expect(r.eventos).toEqual([]);
    expect(r.metadataDaProposta).toEqual({
      negociacaoId: 500 + i, tipo: "parcelamento", valorNegociado: Number(n.linha.valorNegociado), parcelas: n.linha.parcelas,
      versaoAprovacao: 1, exigeAprovacao: false, motivos: [], faixa: expect.objectContaining({ acimaDeDias: 90, ateDias: 180 }), carteira: "ex_cliente",
      entrada: { numero: 0, valor: Number(n.linha.entrada), vencimento: n.linha.primeiroVencimento, origem: "acordo", recebimentoConfirmado: false },
    });
  });

  it("acordo em dois passos: proposta com o registro, aceite com a conferência do PATCH; acordo à vista sem entrada fica 'aceita'", () => {
    const i = negociacoes.findIndex((n) => n.casoId === 4);
    const n = negociacoes[i];
    expect(n.linha.tipo).toBe("quitacao_desconto");
    expect(n.linha.status).toBe("aceita");
    const r = eventosDaNegociacao(n, idsDe(i));
    expect(r.metadataDaProposta).toMatchObject({ negociacaoId: 500 + i, versaoAprovacao: 1, exigeAprovacao: false, entrada: null, carteira: "ativo" });
    expect(r.metadataDoAceite).toEqual({ negociacaoId: 500 + i, status: "aceita", aprovacaoConferida: true, aprovadoPorUserId: ADMIN });
    expect(r.eventos).toEqual([]);
  });

  it("acordo aceito na criação: sem proposta, o registro vai no acordo_aceito; a entrada paga deixa parcela_paga no formato de marcarParcelaPaga", () => {
    const i = negociacoes.findIndex((n) => n.casoId === 6);
    const n = negociacoes[i];
    const ids = idsDe(i);
    const r = eventosDaNegociacao(n, ids);
    expect(r.metadataDaProposta).toBeNull();
    expect(r.metadataDoAceite).toMatchObject({ negociacaoId: 500 + i, versaoAprovacao: 1, exigeAprovacao: false, carteira: "ex_cliente" });
    const k = n.parcelas.findIndex((p) => p.numero === 0);
    expect(r.eventos).toEqual([{
      providerId: PROVEDOR, casoId: 6, customerId: 1006, userId: ADMIN, tipo: "parcela_paga",
      metadata: { negociacaoId: 500 + i, parcelaId: ids.parcelaIds[k], numero: 0, valorPago: Number(n.linha.entrada), acumulado: Number(n.linha.entrada), parcial: false, origem: "confirmacao_operador", recebimentoConfirmado: true },
      ocorridoEm: n.linha.aceitaEm,
    }]);
  });

  it("ids de parcela em quantidade diferente das parcelas é deriva da fiação e falha alto", () => {
    const i = negociacoes.findIndex((n) => n.casoId === 6);
    expect(() => eventosDaNegociacao(negociacoes[i], { negociacaoId: 1, parcelaIds: [] })).toThrow(/parcela/);
  });
});

describe("trilhaDosCasos — puro", () => {
  it("determinístico e sem relógio: o mesmo `agora` dá a mesma trilha em qualquer hora do sistema", () => {
    const agora = AGORAS[1];
    const primeira = trilhaDosCasos(entradaDe(agora));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-02-03T04:05:06Z"));
    const segunda = trilhaDosCasos(entradaDe(agora));
    expect(segunda).toEqual(primeira);
  });
});
