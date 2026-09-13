import { describe, expect, it } from "vitest";
import { classificarConfiabilidade } from "@shared/cobranca/dna";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import {
  faturasHistoricasDoSandbox,
  MESES_DE_HISTORICO,
  MESES_DE_HISTORICO_REDUZIDO,
  RECUPERACOES_POR_CARTEIRA,
  TETO_DE_FATURAS_HISTORICAS,
  type ClienteDoHistorico,
  type ContatoDoHistorico,
} from "./semeadura-faturas";

/**
 * O histórico de faturas do sandbox é um módulo PURO: nenhum banco, nenhum
 * mock. A carteira de entrada imita a FORMA da de `sandbox.service.ts`
 * (225 inadimplentes, 150 cancelados, 1.125 em dia; os mesmos ciclos de
 * plano, tempo de casa, idade da dívida e recência do corte) — não importa de
 * lá porque aquele arquivo carrega o banco. A prova com a carteira de verdade
 * é da fiação, no banco local.
 */

const DIA = 86_400_000;
const HORA = 3_600_000;
const PROVEDOR = 777;
const ADMIN = 4242;

const VALORES_DE_PLANO = [79.9, 99.9, 119.9, 149.9, 199.9];
const TENURE_MESES = [2, 5, 9, 14, 20, 28, 36, 48, 60, 84];
const IDADES_DA_DIVIDA = [10, 45, 120, 300, 20, 60, 90, 150, 250];
const RECENCIA_DO_CORTE = [30, 60, 90, 150, 210, 365];

function menosMeses(d: Date, meses: number): Date {
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() - meses);
  return x;
}

function dataSemHora(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Meia-noite UTC do dia LOCAL de `d` — o `corte` de `resumoDoMes`. */
function diaLocal(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

const isoDoDia = (d: Date) => d.toISOString().slice(0, 10);

interface Carteira {
  clientes: ClienteDoHistorico[];
  inadimplentes: ClienteDoHistorico[];
  cancelados: ClienteDoHistorico[];
  emDia: ClienteDoHistorico[];
  tenurePorCliente: Map<number, number>;
}

function carteiraNoMoldeDoSandbox(agora: Date, totalEmDia = 1_125): Carteira {
  let proximoId = 10_000;
  const tenurePorCliente = new Map<number, number>();
  const inadimplentes: ClienteDoHistorico[] = [];
  const cancelados: ClienteDoHistorico[] = [];
  const emDia: ClienteDoHistorico[] = [];

  for (let k = 0; k < 225; k++) {
    const customerId = proximoId++;
    const mensalidade = VALORES_DE_PLANO[k % 5];
    const idade = IDADES_DA_DIVIDA[k % 9];
    const tenure = TENURE_MESES[k % 10];
    tenurePorCliente.set(customerId, tenure);
    inadimplentes.push({
      customerId,
      categoria: "inadimplente",
      mensalidade,
      contractStartDate: dataSemHora(menosMeses(agora, tenure)),
      cortadoEm: null,
      maxDaysOverdue: idade,
      overdueInvoicesCount: 1,
      faturaEmAberto: { erpRef: `demo-fatura-${customerId}`, valor: mensalidade, vencimento: new Date(agora.getTime() - idade * DIA) },
    });
  }

  for (let k = 0; k < 150; k++) {
    const customerId = proximoId++;
    const mensalidade = VALORES_DE_PLANO[(225 + k) % 5];
    const recencia = RECENCIA_DO_CORTE[k % 6];
    const cortadoEm = new Date(agora.getTime() - recencia * DIA);
    const tenure = TENURE_MESES[(225 + k) % 10];
    tenurePorCliente.set(customerId, tenure);
    const pagouASaida = k % 2 === 0;
    const valorDaSaida = Number((300 + 290 + (mensalidade * 15) / 30).toFixed(2));
    cancelados.push({
      customerId,
      categoria: "cancelado",
      mensalidade,
      contractStartDate: dataSemHora(menosMeses(cortadoEm, tenure)),
      cortadoEm,
      maxDaysOverdue: pagouASaida ? 0 : recencia,
      overdueInvoicesCount: pagouASaida ? 0 : 1,
      faturaEmAberto: pagouASaida ? null : { erpRef: `demo-saida-${customerId}`, valor: valorDaSaida, vencimento: cortadoEm },
    });
  }

  for (let k = 0; k < totalEmDia; k++) {
    const customerId = proximoId++;
    const tenure = TENURE_MESES[(375 + k) % 10];
    tenurePorCliente.set(customerId, tenure);
    emDia.push({
      customerId,
      categoria: "em_dia",
      mensalidade: VALORES_DE_PLANO[(375 + k) % 5],
      contractStartDate: dataSemHora(menosMeses(agora, tenure)),
      cortadoEm: null,
      maxDaysOverdue: 0,
      overdueInvoicesCount: 0,
      faturaEmAberto: null,
    });
  }

  return { clientes: [...inadimplentes, ...cancelados, ...emDia], inadimplentes, cancelados, emDia, tenurePorCliente };
}

/**
 * Os contatos no molde das conversas semeadas (OPEN 72 h, PENDING 48 h,
 * WAITING 120 h, CLOSED 240 h, BOT 10 h) + os que NÃO podem virar
 * recuperação: contato velho demais, robô de horas atrás, ex-cliente sem
 * dívida e cliente em dia.
 */
function contatosNoMoldeDasConversas(agora: Date, c: Carteira): ContatoDoHistorico[] {
  const ha = (horas: number) => new Date(agora.getTime() - horas * HORA);
  return [
    { customerId: c.inadimplentes[5].customerId, contatoEm: ha(35 * 24) }, // fora dos 30 dias
    { customerId: c.inadimplentes[9].customerId, contatoEm: ha(10) }, // robô de 10 h: baixa um dia depois estaria no futuro
    { customerId: c.inadimplentes[1].customerId, contatoEm: ha(72) },
    { customerId: c.cancelados[0].customerId, contatoEm: ha(72) }, // pagou a saída: não deve nada
    { customerId: c.inadimplentes[2].customerId, contatoEm: ha(48 + 0.2) },
    { customerId: c.cancelados[9].customerId, contatoEm: ha(10) },
    { customerId: c.emDia[0].customerId, contatoEm: ha(72) }, // em dia: nada a recuperar
    { customerId: c.cancelados[15].customerId, contatoEm: ha(48 + 0.3) },
    { customerId: c.inadimplentes[3].customerId, contatoEm: ha(240) },
    { customerId: c.inadimplentes[1].customerId, contatoEm: ha(50) }, // segundo contato do mesmo cliente: não duplica
    { customerId: c.cancelados[17].customerId, contatoEm: ha(72) },
    { customerId: c.inadimplentes[4].customerId, contatoEm: ha(120) }, // quarto ativo elegível: passa do teto
    { customerId: c.cancelados[23].customerId, contatoEm: ha(120) },
    { customerId: c.cancelados[25].customerId, contatoEm: ha(240) }, // quarto ex-cliente elegível
  ];
}

function gerar(agora: Date, totalEmDia?: number) {
  const carteira = carteiraNoMoldeDoSandbox(agora, totalEmDia);
  const contatos = contatosNoMoldeDasConversas(agora, carteira);
  const resultado = faturasHistoricasDoSandbox({ providerId: PROVEDOR, adminId: ADMIN, clientes: carteira.clientes, contatos, agora });
  return { carteira, contatos, resultado };
}

const pagas = (linhas: ReturnType<typeof gerar>["resultado"]["faturas"]) =>
  linhas.filter((f) => f.status === "paid" && f.paidDate);

const atrasadas = (linhas: ReturnType<typeof gerar>["resultado"]["faturas"]) =>
  pagas(linhas).filter((f) => isoDoDia(f.paidDate!) > isoDoDia(f.dueDate));

function porCliente<T extends { customerId: number }>(linhas: T[]): Map<number, T[]> {
  const mapa = new Map<number, T[]>();
  for (const l of linhas) mapa.set(l.customerId, [...(mapa.get(l.customerId) ?? []), l]);
  return mapa;
}

const AGORA = new Date(2026, 8, 13, 10, 0, 0); // 13/09/2026 10:00 local

/** Início, meio e fim de mês, e a virada de ano — as regras de calendário não podem depender do dia do visitante. */
const AGORAS = [
  new Date(2026, 8, 1, 0, 30, 0),
  AGORA,
  new Date(2026, 8, 30, 23, 30, 0),
  new Date(2026, 11, 31, 23, 0, 0),
  new Date(2027, 0, 2, 8, 0, 0),
];

describe("faturasHistoricasDoSandbox — forma das linhas", () => {
  it("é determinística: a mesma entrada devolve exatamente as mesmas linhas", () => {
    expect(gerar(AGORA).resultado).toEqual(gerar(AGORA).resultado);
  });

  it("toda linha é do provedor do sandbox, vem da fonte demo, com erpRef único e fora do espaço das faturas já semeadas", () => {
    const { carteira, resultado } = gerar(AGORA);
    expect(resultado.faturas.length).toBeGreaterThan(0);
    expect(resultado.faturas.every((f) => f.providerId === PROVEDOR && f.erpSource === FONTE_ERP_DEMO)).toBe(true);
    const refs = resultado.faturas.map((f) => f.erpRef);
    expect(refs.every((r) => typeof r === "string" && r.startsWith("demo-mens-"))).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
    const refsDasDividas = new Set(carteira.clientes.flatMap((c) => (c.faturaEmAberto ? [c.faturaEmAberto.erpRef] : [])));
    expect(refs.some((r) => refsDasDividas.has(r!))).toBe(false);
  });

  it("toda mensalidade tem a descrição que a leitura de mensalidade reconhece e o valor do plano do cliente", () => {
    const { carteira, resultado } = gerar(AGORA);
    const mensalidade = new Map(carteira.clientes.map((c) => [c.customerId, c.mensalidade.toFixed(2)]));
    for (const f of resultado.faturas) {
      expect(f.descricao).toMatch(/^Mensalidade \d{2}\/\d{4}$/);
      expect(f.value).toBe(mensalidade.get(f.customerId));
      if (f.status === "paid") expect(f.paidValue).toBe(f.value);
    }
  });

  it("volume dentro do teto declarado, com 6 meses de histórico nos em dia", () => {
    const { resultado } = gerar(AGORA);
    expect(resultado.mesesDeHistoricoEmDia).toBe(MESES_DE_HISTORICO);
    expect(resultado.faturas.length).toBeLessThanOrEqual(TETO_DE_FATURAS_HISTORICAS);
  });

  it("se a carteira passar do teto, os em dia caem para 3 meses de histórico", () => {
    const { resultado, carteira } = gerar(AGORA, 1_800);
    expect(resultado.mesesDeHistoricoEmDia).toBe(MESES_DE_HISTORICO_REDUZIDO);
    expect(resultado.faturas.length).toBeLessThanOrEqual(TETO_DE_FATURAS_HISTORICAS);
    const doMaisAntigo = porCliente(resultado.faturas).get(carteira.emDia.find((c) => carteira.tenurePorCliente.get(c.customerId)! >= 9)!.customerId)!;
    expect(doMaisAntigo).toHaveLength(MESES_DE_HISTORICO_REDUZIDO + 1);
  });

  it("a fiacao pode pedir menos meses nos em dia (orcamento do criarSandbox): so os em dia encolhem", () => {
    const carteira = carteiraNoMoldeDoSandbox(AGORA);
    const contatos = contatosNoMoldeDasConversas(AGORA, carteira);
    const completo = faturasHistoricasDoSandbox({ providerId: PROVEDOR, adminId: ADMIN, clientes: carteira.clientes, contatos, agora: AGORA });
    const reduzido = faturasHistoricasDoSandbox({ providerId: PROVEDOR, adminId: ADMIN, clientes: carteira.clientes, contatos, agora: AGORA, mesesDeHistoricoEmDia: MESES_DE_HISTORICO_REDUZIDO });
    expect(reduzido.mesesDeHistoricoEmDia).toBe(MESES_DE_HISTORICO_REDUZIDO);
    expect(reduzido.faturas.length).toBeLessThan(completo.faturas.length);

    const emDia = new Set(carteira.emDia.map((c) => c.customerId));
    const doMaisAntigo = porCliente(reduzido.faturas).get(carteira.emDia.find((c) => carteira.tenurePorCliente.get(c.customerId)! >= 9)!.customerId)!;
    expect(doMaisAntigo).toHaveLength(MESES_DE_HISTORICO_REDUZIDO + 1);
    // Inadimplentes e cancelados guardam o histórico inteiro, e as recuperações não mudam.
    const foraDosEmDia = (linhas: typeof completo.faturas) => linhas.filter((f) => !emDia.has(f.customerId)).map((f) => f.erpRef);
    expect(foraDosEmDia(reduzido.faturas)).toEqual(foraDosEmDia(completo.faturas));
    expect(reduzido.recuperacoes).toEqual(completo.recuperacoes);
    expect(reduzido.quitacoes).toEqual(completo.quitacoes);
  });
});

describe.each(AGORAS)("faturasHistoricasDoSandbox — calendário com agora = %s", (agora) => {
  const { carteira, resultado } = gerar(agora);
  const hoje = diaLocal(agora);

  it("nenhuma paga tem pagamento depois de agora — nem no próprio dia de hoje, que ainda não fechou", () => {
    for (const f of pagas(resultado.faturas)) {
      expect(f.paidDate!.getTime()).toBeLessThanOrEqual(agora.getTime());
      expect(f.paidDate!.getTime()).toBeLessThan(hoje);
    }
  });

  it("a única linha nova aberta e vencida é a mensalidade do mês do inadimplente, DECLARADA para a fiação somar na dívida; nenhuma vence durante as 24 h de vida do sandbox", () => {
    const declaradas = new Set(resultado.dividasDoMes.map((d) => d.erpRef));
    for (const f of resultado.faturas.filter((x) => x.status !== "paid")) {
      if (f.status === "overdue") {
        expect(declaradas.has(f.erpRef!), f.erpRef!).toBe(true);
        expect(f.dueDate.getTime()).toBeLessThan(hoje);
        continue;
      }
      expect(f.status).toBe("aberta");
      expect(f.dueDate.getTime()).toBeGreaterThanOrEqual(hoje + 2 * DIA);
    }
    expect(resultado.dividasDoMes).toHaveLength(resultado.faturas.filter((x) => x.status === "overdue").length);
    const inadimplentes = new Set(carteira.inadimplentes.map((c) => c.customerId));
    const recuperados = new Set(resultado.recuperacoes.map((r) => r.customerId));
    for (const d of resultado.dividasDoMes) {
      expect(inadimplentes.has(d.customerId)).toBe(true);
      expect(recuperados.has(d.customerId), "quem pagou nos últimos 30 dias não fica devendo o mês").toBe(false);
      const f = resultado.faturas.find((x) => x.erpRef === d.erpRef)!;
      expect(d).toEqual({ customerId: f.customerId, erpRef: f.erpRef, valor: Number(f.value), vencimento: f.dueDate });
    }
  });

  it("todo ativo — em dia ou inadimplente — tem fatura vencendo no mês corrente, e a maioria das dos em dia já está paga", () => {
    // Revisão da fase B (13/09/2026): a carteira do mês abria 200 ativos "sem
    // fatura" — os inadimplentes cuja dívida é de um mês anterior.
    const mesCorrente = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
    const mesDe = (d: Date) => isoDoDia(d).slice(0, 7);
    const doMes = resultado.faturas.filter((f) => mesDe(f.dueDate) === mesCorrente);
    const clientesDoMes = new Set(doMes.map((f) => f.customerId));
    for (const c of carteira.emDia) expect(clientesDoMes.has(c.customerId)).toBe(true);
    const doMesDosEmDia = doMes.filter((f) => carteira.emDia.some((c) => c.customerId === f.customerId));
    expect(doMesDosEmDia).toHaveLength(carteira.emDia.length);
    expect(doMesDosEmDia.filter((f) => f.status === "paid").length).toBeGreaterThan(doMesDosEmDia.length / 2);
    for (const c of carteira.inadimplentes) {
      // A dívida já é do mês: ela é a fatura do mês, e não nasce outra.
      const dividaNoMes = mesDe(c.faturaEmAberto!.vencimento) === mesCorrente;
      expect(doMes.filter((f) => f.customerId === c.customerId), `cliente ${c.customerId}`).toHaveLength(dividaNoMes ? 0 : 1);
    }
  });

  it("nenhuma fatura vence antes do início do contrato", () => {
    const inicio = new Map(carteira.clientes.map((c) => [c.customerId, c.contractStartDate]));
    for (const f of resultado.faturas) expect(isoDoDia(f.dueDate) >= inicio.get(f.customerId)!).toBe(true);
  });
});

describe("faturasHistoricasDoSandbox — por categoria", () => {
  const { carteira, resultado } = gerar(AGORA);
  const linhas = porCliente(resultado.faturas);

  it("em dia: histórico de pagamento calculável (≥ 6 pagas com data) para quem tem tempo de casa, e ao menos uma para todos", () => {
    for (const c of carteira.emDia) {
      const doCliente = pagas(linhas.get(c.customerId) ?? []);
      expect(doCliente.length).toBeGreaterThanOrEqual(1);
      if (carteira.tenurePorCliente.get(c.customerId)! >= 7) expect(doCliente.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("o mês corrente dos em dia tem uma parte a vencer (13/09: dias 15, 20 e 25 ainda não venceram)", () => {
    const aVencer = resultado.faturas.filter((f) => f.status === "aberta");
    expect(aVencer.length).toBeGreaterThan(0);
    expect(aVencer.length).toBeLessThan(carteira.emDia.length / 2);
  });

  it("inadimplentes: pagas ANTES da fatura em aberto e, no mês corrente, só a mensalidade do mês — a vencer ou vencida e declarada", () => {
    const mesCorrente = isoDoDia(new Date(diaLocal(AGORA))).slice(0, 7);
    const declaradas = new Set(resultado.dividasDoMes.map((d) => d.erpRef));
    for (const c of carteira.inadimplentes) {
      for (const f of linhas.get(c.customerId) ?? []) {
        if (isoDoDia(f.dueDate).slice(0, 7) === mesCorrente) {
          expect(f.dueDate.getTime()).toBeGreaterThan(c.faturaEmAberto!.vencimento.getTime());
          if (f.status === "paid") expect(f.paidDate!.getTime()).toBeLessThanOrEqual(f.dueDate.getTime());
          else expect(f.status === "aberta" || declaradas.has(f.erpRef!), f.erpRef!).toBe(true);
          continue;
        }
        expect(f.status).toBe("paid");
        expect(f.dueDate.getTime()).toBeLessThan(c.faturaEmAberto!.vencimento.getTime());
        expect(f.paidDate!.getTime()).toBeLessThan(c.faturaEmAberto!.vencimento.getTime());
      }
    }
    expect(carteira.inadimplentes.some((c) => (linhas.get(c.customerId)?.length ?? 0) >= 6)).toBe(true);
    // 13/09: a dívida de 250 dias venceu num dia 6 — a mensalidade de 06/09 também já venceu.
    expect(resultado.dividasDoMes.length).toBeGreaterThan(0);
  });

  it("cancelados: só pagas, todas antes do corte — o prejuízo do ex-cliente passa a ter receita observada", () => {
    for (const c of carteira.cancelados) {
      for (const f of linhas.get(c.customerId) ?? []) {
        expect(f.status).toBe("paid");
        expect(f.dueDate.getTime()).toBeLessThan(c.cortadoEm!.getTime());
        expect(f.paidDate!.getTime()).toBeLessThan(c.cortadoEm!.getTime());
      }
    }
    expect(carteira.cancelados.filter((c) => (linhas.get(c.customerId)?.length ?? 0) > 0).length).toBeGreaterThan(100);
  });

  it("a pontualidade vem do perfil do DNA: com o histórico a confiabilidade que a régua calcula é a MESMA de sem histórico", () => {
    for (const c of carteira.clientes) {
      const doCliente = linhas.get(c.customerId) ?? [];
      const n = pagas(doCliente).length;
      const semHistorico = classificarConfiabilidade({ mesesComoCliente: 0, diasAtrasoMax: c.maxDaysOverdue, faturasAbertas: c.overdueInvoicesCount, historicoInsuficiente: true });
      const comHistorico = classificarConfiabilidade({
        mesesComoCliente: 0, diasAtrasoMax: c.maxDaysOverdue, faturasAbertas: c.overdueInvoicesCount,
        historicoInsuficiente: n === 0, faturasPagas: n, faturasPagasComAtraso: atrasadas(doCliente).length,
      });
      expect(comHistorico, `cliente ${c.customerId}`).toBe(semHistorico);
    }
  });

  it("em dia nunca paga com atraso; oscila e crônico têm parte paga com atraso", () => {
    const perfil = (c: ClienteDoHistorico) => classificarConfiabilidade({ mesesComoCliente: 0, diasAtrasoMax: c.maxDaysOverdue, faturasAbertas: c.overdueInvoicesCount, historicoInsuficiente: true });
    for (const c of carteira.clientes) {
      const doCliente = linhas.get(c.customerId) ?? [];
      const n = pagas(doCliente).length;
      const comAtraso = atrasadas(doCliente).length;
      if (perfil(c) === "em_dia") expect(comAtraso).toBe(0);
      if (perfil(c) === "oscila" && n >= 3) expect(comAtraso).toBeGreaterThanOrEqual(1);
      if (perfil(c) === "cronico" && n >= 1) expect(comAtraso / n).toBeGreaterThan(0.4);
    }
  });
});

describe("faturasHistoricasDoSandbox — recuperação dos últimos 30 dias", () => {
  const { carteira, contatos, resultado } = gerar(AGORA);
  const cliente = new Map(carteira.clientes.map((c) => [c.customerId, c]));

  it("escolhe, na ORDEM dos contatos, até 3 clientes que devem por carteira — pula contato velho, robô de horas atrás, quem não deve e o repetido", () => {
    const ids = (carteira_: "ativo" | "ex_cliente") => resultado.recuperacoes.filter((r) => r.carteira === carteira_).map((r) => r.customerId);
    expect(RECUPERACOES_POR_CARTEIRA).toBe(3);
    expect(ids("ativo")).toEqual([carteira.inadimplentes[1], carteira.inadimplentes[2], carteira.inadimplentes[3]].map((c) => c.customerId));
    expect(ids("ex_cliente")).toEqual([carteira.cancelados[15], carteira.cancelados[17], carteira.cancelados[23]].map((c) => c.customerId));
  });

  it("cada recuperação fecha a fatura em aberto do cliente, pelo valor dela, entre o contato e 7 dias depois, dentro dos 30 dias e antes de agora", () => {
    for (const r of resultado.recuperacoes) {
      const c = cliente.get(r.customerId)!;
      const contato = contatos.find((x) => x.customerId === r.customerId)!;
      expect(r.erpRef).toBe(c.faturaEmAberto!.erpRef);
      expect(r.valor).toBe(c.faturaEmAberto!.valor);
      expect(r.contatoEm).toEqual(contato.contatoEm);
      expect(r.recuperadoEm.getTime()).toBeGreaterThan(contato.contatoEm.getTime());
      expect(r.recuperadoEm.getTime()).toBeLessThanOrEqual(contato.contatoEm.getTime() + 7 * DIA);
      expect(r.recuperadoEm.getTime()).toBeGreaterThanOrEqual(AGORA.getTime() - 30 * DIA);
      expect(r.recuperadoEm.getTime()).toBeLessThan(AGORA.getTime());
      expect(r.recuperadoEm.getTime()).toBeGreaterThan(c.faturaEmAberto!.vencimento.getTime());
    }
  });

  it("cada carteira acende os DOIS indicadores: baixa no ERP (esteira) e quitação conferida (KPI da carteira)", () => {
    for (const carteira_ of ["ativo", "ex_cliente"] as const) {
      const mecanismos = resultado.recuperacoes.filter((r) => r.carteira === carteira_).map((r) => r.mecanismo);
      expect(mecanismos).toEqual(["baixada_no_erp", "quitacao", "baixada_no_erp"]);
    }
  });

  it("baixa: a fatura vira baixada_no_erp com baixadaEm = recuperadoEm, como a varredura completa grava", () => {
    for (const r of resultado.recuperacoes.filter((x) => x.mecanismo === "baixada_no_erp")) {
      expect(r.alteracaoDaFatura).toEqual({ status: "baixada_no_erp", baixadaEm: r.recuperadoEm });
    }
  });

  it("quitação: o recibo que registrarQuitacaoConfirmada grava (valor integral, data não futura) e a fatura paga naquele dia", () => {
    const quitadas = resultado.recuperacoes.filter((x) => x.mecanismo === "quitacao");
    expect(resultado.quitacoes).toHaveLength(quitadas.length);
    for (const r of quitadas) {
      const q = resultado.quitacoes.find((x) => x.erpRef === r.erpRef)!;
      expect(q).toMatchObject({
        providerId: PROVEDOR,
        customerId: r.customerId,
        origem: "comprovante_conferido",
        userId: ADMIN,
        valorPago: r.valor.toFixed(2),
      });
      expect(q.referencia.length).toBeGreaterThanOrEqual(3);
      expect(q.pagoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(q.pagoEm <= dataSemHora(AGORA)).toBe(true);
      expect(q.pagoEm >= dataSemHora(r.contatoEm)).toBe(true);
      expect(q.confirmadoEm).toEqual(r.recuperadoEm);
      const [a, m, d] = q.pagoEm.split("-").map(Number);
      expect(r.alteracaoDaFatura).toEqual({ status: "paid", paidDate: new Date(Date.UTC(a, m - 1, d)) });
      expect((r.alteracaoDaFatura.paidDate as Date).getTime()).toBeLessThanOrEqual(AGORA.getTime());
    }
    expect(new Set(resultado.quitacoes.map((q) => q.referencia)).size).toBe(resultado.quitacoes.length);
  });

  it("quem pagou nos últimos 30 dias não fica com a mensalidade do mês vencida em aberto: ela está paga ou a vencer", () => {
    // Em 20/09 a dívida de 45 dias venceu num dia 6: a mensalidade de 06/09 do ativo que pagou já venceu — e ele a pagou.
    const agora = new Date(2026, 8, 20, 10, 0, 0);
    const carteira20 = carteiraNoMoldeDoSandbox(agora);
    const r = faturasHistoricasDoSandbox({ providerId: PROVEDOR, adminId: ADMIN, clientes: carteira20.clientes, contatos: contatosNoMoldeDasConversas(agora, carteira20), agora });
    expect(r.recuperacoes.length).toBeGreaterThan(0);
    const mesCorrente = isoDoDia(new Date(diaLocal(agora))).slice(0, 7);
    for (const rec of r.recuperacoes.filter((x) => x.carteira === "ativo")) {
      const doMes = r.faturas.filter((f) => f.customerId === rec.customerId && isoDoDia(f.dueDate).slice(0, 7) === mesCorrente);
      expect(doMes.every((f) => f.status === "paid" || f.status === "aberta"), `cliente ${rec.customerId}`).toBe(true);
    }
    expect(r.dividasDoMes.some((d) => r.recuperacoes.some((x) => x.customerId === d.customerId))).toBe(false);
  });

  it("sem contato elegível não há recuperação nem quitação — e só a mensalidade do mês de quem pagaria muda", () => {
    const vazio = faturasHistoricasDoSandbox({ providerId: PROVEDOR, adminId: ADMIN, clientes: carteira.clientes, contatos: [], agora: AGORA });
    expect(vazio.recuperacoes).toEqual([]);
    expect(vazio.quitacoes).toEqual([]);
    const recuperados = new Set(resultado.recuperacoes.map((r) => r.customerId));
    const semOsRecuperados = (l: typeof resultado.faturas) => l.filter((f) => !recuperados.has(f.customerId));
    expect(semOsRecuperados(vazio.faturas)).toEqual(semOsRecuperados(resultado.faturas));
  });
});
