/**
 * O histórico de consultas e os alertas extras do sandbox (`semeadura-consultas.ts`).
 *
 * A auditoria de telas da demo (13/09/2026) abriu o painel com "Consultas hoje
 * 0 · no mês 0", os Históricos da Consulta ISP, do SPC e da cadastral vazios, e
 * o Anti-Fraude com três alertas iguais e as abas Resolvidos/Descartados
 * vazias. O módulo é PURO: recebe a carteira que a semeadura já montou e
 * devolve linhas — por isso o teste roda sem banco, sobre uma carteira de
 * fixture no formato de `linhaDoCliente` (sandbox.service.ts).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { avaliarRiscoDeFuga, motivosGravados, severidadeDoAlerta } from "@shared/antifraude-avaliacao";
import { montarRegras } from "@shared/antifraude-regras";
import { decidirVeredito } from "../services/bigdata-veredito";
import { FORMATO_DO_IDENTIFICADOR } from "../services/identificador-consulta";
import { _resetPartnerKeysForTests } from "../utils/provider-anonymizer";
import { pessoaFicticia } from "./pessoas-ficticias";
import {
  REGRAS_DA_DEMO,
  alertasExtrasDoSandbox,
  consultasDoSandbox,
  regrasAntiFraudeDaDemo,
  type ClienteDaConsulta,
  type ClienteDaRede,
  type ConsultaDaRede,
} from "./semeadura-consultas";

const DIA = 86_400_000;
const HORA = 3_600_000;
const AGORA = new Date("2026-09-13T15:00:00.000Z");
const PROVIDER_ID = 777;
const ADMIN_ID = 9001;
const PROVEDORES_DA_REDE = [
  { id: 101, nome: "Rede Norte Conecta" },
  { id: 102, nome: "Ibiporã Telecom" },
  { id: 103, nome: "Cambé NetSul" },
  { id: 104, nome: "Apucarana Wireless" },
  { id: 105, nome: "Paraná Norte Internet" },
];

const IDADES = [10, 45, 120, 300, 20, 60, 90, 150, 250];
const PLANOS = [79.9, 99.9, 119.9, 149.9, 199.9];
const TENURES = [2, 5, 9, 14, 20, 28, 36, 48, 60, 84];

function dataSemHora(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mesesAtras(meses: number): string {
  const d = new Date(AGORA);
  d.setMonth(d.getMonth() - meses);
  return dataSemHora(d);
}

/** A carteira no formato de `linhaDoCliente`: inadimplentes, cancelados e em dia, nesta ordem. */
function carteira(): { clientes: ClienteDaConsulta[]; equipamentos: { customerId: number; status: string; value: string }[] } {
  const clientes: ClienteDaConsulta[] = [];
  const equipamentos: { customerId: number; status: string; value: string }[] = [];
  const pessoa = (k: number) => {
    const p = pessoaFicticia(864_000 + k);
    return {
      name: p.nome, cpfCnpj: p.cpf, address: p.logradouro, addressNumber: p.numero, neighborhood: p.bairro,
      city: p.cidade, state: p.uf, cep: p.cep, latitude: p.latitude, longitude: p.longitude,
    };
  };
  for (let k = 0; k < 45; k++) {
    const id = 1000 + clientes.length;
    clientes.push({
      id, ...pessoa(clientes.length), status: "active",
      totalOverdueAmount: PLANOS[k % 5].toFixed(2), maxDaysOverdue: IDADES[k % 9], overdueInvoicesCount: 1,
      contractStartDate: mesesAtras(TENURES[k % 10]), equipmentCount: 0, mensalidade: PLANOS[k % 5],
    });
    if (k % 4 === 1) equipamentos.push({ customerId: id, status: "em_comodato", value: "290.00" });
  }
  for (let k = 0; k < 20; k++) {
    const id = 1000 + clientes.length;
    const deve = k % 2 === 1;
    clientes.push({
      id, ...pessoa(clientes.length), status: "cancelled",
      totalOverdueAmount: deve ? "619.95" : "0.00", maxDaysOverdue: deve ? [30, 60, 90, 150, 210, 365][k % 6] : 0,
      overdueInvoicesCount: deve ? 1 : 0, contractStartDate: mesesAtras(TENURES[k % 10] + 6),
      equipmentCount: k < 6 ? 1 : 0, mensalidade: PLANOS[k % 5],
    });
    if (k < 6) equipamentos.push({ customerId: id, status: "retido", value: "290.00" });
  }
  for (let k = 0; k < 60; k++) {
    const id = 1000 + clientes.length;
    clientes.push({
      id, ...pessoa(clientes.length), status: "active",
      totalOverdueAmount: "0.00", maxDaysOverdue: 0, overdueInvoicesCount: 0,
      contractStartDate: mesesAtras(TENURES[k % 10]), equipmentCount: 0, mensalidade: PLANOS[k % 5],
      // Quem pagou nos últimos 30 dias: a fatura venceu há 20 dias e foi quitada há 3.
      ...(k === 5 ? { faturasVencidas: [{ valor: PLANOS[k % 5], vencimento: new Date(AGORA.getTime() - 20 * DIA), quitadaEm: new Date(AGORA.getTime() - 3 * DIA) }] } : {}),
    });
    if (k >= 50) equipamentos.push({ customerId: id, status: "em_comodato", value: "290.00" });
  }
  return { clientes, equipamentos };
}

const { clientes: CLIENTES, equipamentos: EQUIPAMENTOS } = carteira();
const EM_DIA = CLIENTES.filter(c => c.status === "active" && Number(c.maxDaysOverdue) === 0);
const PAGOU_DEPOIS = EM_DIA[5];
/** Dois CPFs da carteira que também existem na rede: um devendo lá, outro ex-cliente de lá sem dívida. */
const REDE: ClienteDaRede[] = [
  { providerId: 101, name: EM_DIA[0].name, cpfCnpj: EM_DIA[0].cpfCnpj, status: "active", totalOverdueAmount: "129.90", maxDaysOverdue: 45, overdueInvoicesCount: 1, contractStartDate: mesesAtras(14), city: "Londrina", state: "PR" },
  { providerId: 102, name: EM_DIA[1].name, cpfCnpj: EM_DIA[1].cpfCnpj, status: "cancelled", totalOverdueAmount: "0.00", maxDaysOverdue: 0, overdueInvoicesCount: 0, contractStartDate: mesesAtras(30), city: "Ibiporã", state: "PR" },
];
/**
 * As consultas da rede no molde de `consultasDoMundoBase` (mundo-base.ts): de
 * 1 a 3 por CPF ativo, de provedores diferentes, espalhadas nos 89 dias antes
 * de hoje. Quem pagou depois do aviso ganha a sua entre o vencimento e o
 * pagamento.
 */
const CONSULTAS_DA_REDE: ConsultaDaRede[] = [
  ...CLIENTES.filter(c => c.status === "active").flatMap((c, k) => Array.from({ length: 1 + ((k * 7) % 3) }, (_, t) => ({
    providerId: PROVEDORES_DA_REDE[(k + t) % PROVEDORES_DA_REDE.length].id,
    cpfCnpj: c.cpfCnpj,
    createdAt: new Date(AGORA.getTime() - (1 + ((k * 37 + t * 29) % 89)) * DIA - ((k * 5 + t * 7) % 11) * HORA),
  }))),
  { providerId: PROVEDORES_DA_REDE[2].id, cpfCnpj: PAGOU_DEPOIS.cpfCnpj, createdAt: new Date(AGORA.getTime() - 10 * DIA) },
];

const consultas = () => consultasDoSandbox({
  providerId: PROVIDER_ID, nomeDoProvedor: "Provedor Demonstração", adminId: ADMIN_ID,
  clientes: CLIENTES, rede: REDE, agora: AGORA,
});
const alertas = (consultasDaRede: readonly ConsultaDaRede[] = CONSULTAS_DA_REDE) => alertasExtrasDoSandbox({
  providerId: PROVIDER_ID, clientes: CLIENTES, equipamentos: EQUIPAMENTOS,
  provedoresDaRede: PROVEDORES_DA_REDE, consultasDaRede, agora: AGORA,
});

const inicioDoMes = new Date(AGORA.getFullYear(), AGORA.getMonth(), 1);
const inicioDoDia = (() => { const d = new Date(AGORA); d.setHours(0, 0, 0, 0); return d; })();
const cpfsDaCarteira = new Set(CLIENTES.map(c => c.cpfCnpj));

beforeAll(() => {
  // O código de parceiro do relatório é o mesmo HMAC da consulta ao vivo.
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "segredo-de-teste-da-semeadura-de-consultas-000";
  _resetPartnerKeysForTests();
});

describe("consultasDoSandbox — Consulta ISP", () => {
  it("é determinística: a mesma carteira no mesmo instante dá as mesmas linhas", () => {
    expect(consultas()).toEqual(consultas());
  });

  it("~10 consultas do PRÓPRIO sandbox, pelo administrador, sobre CPFs da carteira", () => {
    const { isp } = consultas();
    expect(isp.length).toBeGreaterThanOrEqual(9);
    expect(isp.length).toBeLessThanOrEqual(12);
    for (const c of isp) {
      expect(c.providerId).toBe(PROVIDER_ID);
      expect(c.userId).toBe(ADMIN_ID);
      expect(cpfsDaCarteira.has(c.cpfCnpj)).toBe(true);
      expect(c.searchType).toBe("cpf");
    }
  });

  it("as três pílulas do parecer aparecem, e a coluna bate com o resultado gravado", () => {
    const { isp } = consultas();
    expect(new Set(isp.map(c => c.decisionReco))).toEqual(new Set(["Accept", "Review", "Reject"]));
    for (const c of isp) {
      const r = c.result as Record<string, any>;
      expect(c.decisionReco).toBe(r.decisionReco);
      expect(c.score).toBe(r.score);
      expect(c.approved).toBe((c.score ?? 0) >= 500);
      const esperado = r.sugestaoIA === "APROVAR" ? "Accept" : r.sugestaoIA === "REJEITAR" ? "Reject" : "Review";
      expect(c.decisionReco).toBe(esperado);
    }
  });

  it("custa 1 crédito só quando a rede tem registro do CPF; o resto é grátis", () => {
    const { isp } = consultas();
    const naRede = new Set(REDE.map(r => r.cpfCnpj));
    expect(new Set(isp.map(c => c.cost))).toEqual(new Set([0, 1]));
    for (const c of isp) {
      expect(c.cost).toBe(naRede.has(c.cpfCnpj) ? 1 : 0);
      expect((c.result as any).creditsCost).toBe(c.cost);
    }
  });

  it("sem a rede, nenhuma consulta custa crédito — o módulo não inventa ocorrência de parceiro", () => {
    const { isp } = consultasDoSandbox({
      providerId: PROVIDER_ID, nomeDoProvedor: "Provedor Demonstração", adminId: ADMIN_ID, clientes: CLIENTES, agora: AGORA,
    });
    expect(isp.every(c => c.cost === 0)).toBe(true);
    expect(isp.every(c => (c.result as any).providerDetails.every((d: any) => d.isSameProvider))).toBe(true);
  });

  it("nenhuma no futuro, parte hoje, e o resto dentro do mês", () => {
    const { isp } = consultas();
    expect(isp.every(c => c.createdAt!.getTime() <= AGORA.getTime())).toBe(true);
    expect(isp.filter(c => c.createdAt! >= inicioDoDia).length).toBeGreaterThanOrEqual(2);
    // No máximo UMA fica antes do dia 1: a primeira do CPF repetido, que é de
    // antes da dívida (ver o teste abaixo).
    expect(isp.filter(c => c.createdAt! < inicioDoMes).length).toBeLessThanOrEqual(1);
  });

  it("consulta de dia anterior, nas três telas, cai no horário de balcão — nunca 23h59", () => {
    const { isp, spc, cadastral } = consultas();
    const doMesAntesDeHoje = [...isp, ...spc, ...cadastral].filter(c => c.createdAt! >= inicioDoMes && c.createdAt! < inicioDoDia);
    expect(doMesAntesDeHoje.length).toBeGreaterThan(0);
    for (const c of doMesAntesDeHoje) {
      expect(c.createdAt!.getHours(), c.createdAt!.toString()).toBeGreaterThanOrEqual(9);
      expect(c.createdAt!.getHours(), c.createdAt!.toString()).toBeLessThanOrEqual(17);
    }
  });

  it("no dia 1, logo depois da meia-noite, tudo do mês ainda é de hoje e nada passa do relógio", () => {
    const cedo = new Date(2026, 8, 1, 0, 20);
    const { isp, spc, cadastral } = consultasDoSandbox({
      providerId: PROVIDER_ID, nomeDoProvedor: "Provedor Demonstração", adminId: ADMIN_ID, clientes: CLIENTES, rede: REDE, agora: cedo,
    });
    const todas = [...isp, ...spc, ...cadastral];
    expect(todas.every(c => c.createdAt!.getTime() <= cedo.getTime())).toBe(true);
    expect(todas.filter(c => c.createdAt! < new Date(2026, 8, 1)).length).toBeLessThanOrEqual(1);
  });

  it("um CPF consultado duas vezes, com scores diferentes — a linha do tempo tem delta", () => {
    const { isp } = consultas();
    const porCpf = new Map<string, typeof isp>();
    for (const c of isp) porCpf.set(c.cpfCnpj, [...(porCpf.get(c.cpfCnpj) ?? []), c]);
    const repetidos = Array.from(porCpf.values()).filter(l => l.length === 2);
    expect(repetidos).toHaveLength(1);
    const [antes, depois] = repetidos[0].sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
    expect(antes.score).not.toBe(depois.score);
    expect(antes.score!).toBeGreaterThan(depois.score!);
  });

  it("a consulta semeada conta os provedores da rede que consultaram o CPF nos 30 dias antes dela — a conta da consulta ao vivo", () => {
    // Revisão da fase B (13/09/2026): semeada sem "consultas repetidas", e a
    // mesma consulta refeita ao vivo com "3+ consultas de ISPs diferentes".
    const cpf = EM_DIA[0].cpfCnpj;
    const alerta = "3+ consultas de ISPs diferentes nos ultimos 30 dias";
    const semRede = consultas().isp.filter(c => c.cpfCnpj === cpf);
    expect(semRede.length).toBeGreaterThan(0);
    for (const c of semRede) expect((c.result as any).alerts).not.toContain(alerta);

    const tresProvedores: ConsultaDaRede[] = [103, 104, 105].map((providerId, i) => ({ providerId, cpfCnpj: cpf, createdAt: new Date(inicioDoMes.getTime() - (5 + i) * DIA) }));
    const comRede = consultasDoSandbox({
      providerId: PROVIDER_ID, nomeDoProvedor: "Provedor Demonstração", adminId: ADMIN_ID, clientes: CLIENTES, rede: REDE, consultasDaRede: tresProvedores, agora: AGORA,
    }).isp.filter(c => c.cpfCnpj === cpf);
    expect(comRede.length).toBe(semRede.length);
    for (const c of comRede) expect((c.result as any).alerts).toContain(alerta);

    // Consulta da rede DEPOIS da semeada não pesa nela: a conta é a do instante da consulta.
    const depois = tresProvedores.map(c => ({ ...c, createdAt: new Date(AGORA.getTime() + DIA) }));
    const comAsDeDepois = consultasDoSandbox({
      providerId: PROVIDER_ID, nomeDoProvedor: "Provedor Demonstração", adminId: ADMIN_ID, clientes: CLIENTES, rede: REDE, consultasDaRede: depois, agora: AGORA,
    }).isp.filter(c => c.cpfCnpj === cpf);
    expect(comAsDeDepois).toEqual(semRede);
  });

  it("o result reabre no formato que a tela lê em 'Ver resultado'", () => {
    const { isp } = consultas();
    for (const c of isp) {
      const r = c.result as Record<string, any>;
      expect(r).toMatchObject({ cpfCnpj: c.cpfCnpj, searchType: "cpf", notFound: false, isOwnCustomer: true, simulado: true, lgpdAccepted: true });
      for (const campo of ["riskTier", "riskLabel", "recommendation", "faixa", "nivelRisco", "sugestaoIA"]) expect(typeof r[campo], campo).toBe("string");
      expect(Array.isArray(r.providerDetails) && r.providerDetails.length > 0).toBe(true);
      expect(Array.isArray(r.alerts)).toBe(true);
      expect(Array.isArray(r.recommendedActions)).toBe(true);
      expect(r.composicaoScore.base).toBe(700);
      expect(r.providersFound).toBe(new Set(r.providerDetails.map((d: any) => d.providerName)).size);
      expect(r.addressParts.cidade).toBeTruthy();
    }
  });

  it("detalhe de parceiro sai mascarado como na consulta ao vivo: sem dias e valor exatos, com código de parceiro", () => {
    const { isp } = consultas();
    const deParceiro = isp.flatMap(c => (c.result as any).providerDetails).filter((d: any) => !d.isSameProvider);
    expect(deParceiro.length).toBeGreaterThan(0);
    for (const d of deParceiro) {
      expect(d.daysOverdue).toBeUndefined();
      expect(d.overdueAmount).toBeUndefined();
      expect(d.cep).toBeUndefined();
      expect(d.providerName).toMatch(/^Provedor Parceiro ISP-/);
      expect(d.customerName).toMatch(/\*\*\*$/);
    }
  });
});

describe("consultasDoSandbox — SPC e cadastral", () => {
  it("4 consultas SPC pelo simulado: duas limpas e duas com restrição, a 3 créditos, com o instante da própria consulta", () => {
    const { spc } = consultas();
    expect(spc).toHaveLength(4);
    expect(spc.filter(c => (c.result as any).restricao).length).toBe(2);
    for (const c of spc) {
      const r = c.result as Record<string, any>;
      expect(c.providerId).toBe(PROVIDER_ID);
      expect(c.userId).toBe(ADMIN_ID);
      expect(cpfsDaCarteira.has(c.cpfCnpj)).toBe(true);
      expect(r.simulado).toBe(true);
      expect(r.creditosCobrados).toBe(3);
      expect(r.consultadoEm).toBe(c.createdAt!.toISOString());
      expect(c.score).toBe(r.score);
      expect(c.createdAt! >= inicioDoMes && c.createdAt! <= AGORA).toBe(true);
    }
    expect(spc.some(c => c.createdAt! >= inicioDoDia)).toBe(true);
  });

  it("3 consultas cadastrais pelo simulado, com veredito da regra real e contagem de datasets", () => {
    const { cadastral } = consultas();
    expect(cadastral).toHaveLength(3);
    expect(new Set(cadastral.map(c => c.veredito)).size).toBeGreaterThanOrEqual(2);
    for (const c of cadastral) {
      const r = c.result as Record<string, any>;
      expect(c.providerId).toBe(PROVIDER_ID);
      expect(c.userId).toBe(ADMIN_ID);
      expect(c.veredito).toBe(r.veredito);
      expect(c.veredito).toBe(decidirVeredito(r.dados).veredito);
      expect(c.datasets!.length).toBeGreaterThan(0);
      expect(r).toMatchObject({ simulado: true, nivel: "padrao", creditosCobrados: 1, lgpdAccepted: true });
      expect(c.createdAt! >= inicioDoMes && c.createdAt! <= AGORA).toBe(true);
    }
  });

  it("todo código de consulta tem o formato do produto e é único — também entre dois sandboxes", () => {
    const deste = consultas();
    const outro = consultasDoSandbox({ providerId: PROVIDER_ID + 1, nomeDoProvedor: "Outro", adminId: 1, clientes: CLIENTES, rede: REDE, agora: AGORA });
    const codigos = [deste, outro].flatMap(t => [...t.isp, ...t.spc, ...t.cadastral].map(c => c.consultaId));
    for (const codigo of codigos) expect(codigo).toMatch(FORMATO_DO_IDENTIFICADOR);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});

describe("alertasExtrasDoSandbox", () => {
  it("é determinística", () => {
    expect(alertas()).toEqual(alertas());
  });

  it("~16 alertas do PRÓPRIO sandbox, consultados por provedores da rede, um por cliente da carteira", () => {
    const lista = alertas();
    const ids = new Set(CLIENTES.map(c => c.id));
    const daRede = new Set(PROVEDORES_DA_REDE.map(p => p.id));
    expect(lista.length).toBeGreaterThanOrEqual(12);
    expect(lista.length).toBeLessThanOrEqual(16);
    for (const a of lista) {
      expect(a.providerId).toBe(PROVIDER_ID);
      expect(daRede.has(a.consultingProviderId!)).toBe(true);
      expect(PROVEDORES_DA_REDE.find(p => p.id === a.consultingProviderId)!.nome).toBe(a.consultingProviderName);
      expect(ids.has(a.customerId!)).toBe(true);
      expect(a.type).toBe("defaulter_consulted");
    }
    expect(new Set(lista.map(a => a.customerId)).size).toBe(lista.length);
  });

  it("todo alerta nasce de uma consulta de verdade: o consulente consultou o CPF um minuto antes, e recentConsultations é a contagem daquele instante", () => {
    // Revisão da fase B (13/09/2026): alertas sobre CPF que só o sandbox tem,
    // "consultado por 3 provedores", com o 360 contando zero consultas de outros.
    for (const a of alertas()) {
      const doCpf = CONSULTAS_DA_REDE.filter(c => c.cpfCnpj === a.customerCpfCnpj);
      const origem = doCpf.find(c => c.providerId === a.consultingProviderId && c.createdAt.getTime() < a.createdAt!.getTime() && a.createdAt!.getTime() - c.createdAt.getTime() <= 60_000);
      expect(origem, `${a.message} (${a.customerCpfCnpj})`).toBeDefined();
      const naJanela = doCpf.filter(c => c.createdAt.getTime() <= origem!.createdAt.getTime() && origem!.createdAt.getTime() - c.createdAt.getTime() <= 30 * DIA);
      expect(a.recentConsultations, a.message!).toBe(new Set(naJanela.map(c => c.providerId)).size);
    }
  });

  it("CPF que nenhum provedor da rede consultou nunca vira 'consultado por outro provedor'", () => {
    expect(alertas([])).toEqual([]);
    const soDosEmDia = new Set(EM_DIA.map(c => c.cpfCnpj));
    const lista = alertas(CONSULTAS_DA_REDE.filter(c => soDosEmDia.has(c.cpfCnpj)));
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every(a => soDosEmDia.has(a.customerCpfCnpj!))).toBe(true);
  });

  it("nenhum aviso traz dívida mais velha que o contrato naquele dia", () => {
    // Revisão da fase B: "contrato novo, 57 dias" no mesmo card de "vencidos há 145 dias".
    for (const a of alertas()) {
      const diasDeContrato = Number(a.riskFactors!.find(f => f.startsWith("dias_contrato:"))!.split(":")[1]);
      expect(a.daysOverdue!, a.message!).toBeLessThanOrEqual(diasDeContrato);
    }
  });

  it("os motivos novos aparecem — dívida, consultas repetidas e contrato novo", () => {
    const motivos = new Set(alertas().flatMap(a => motivosGravados(a.riskFactors)));
    for (const m of ["divida_ativa", "consultas_repetidas", "contrato_novo"]) expect(motivos.has(m as any), m).toBe(true);
  });

  it("cada alerta passa pela regra real na hora em que nasceu, e a severidade é a de severidadeDoAlerta", () => {
    for (const a of alertas()) {
      const cliente = CLIENTES.find(c => c.id === a.customerId)!;
      const motivos = motivosGravados(a.riskFactors);
      const foto = { totalOverdueAmount: parseFloat(a.overdueAmount!), maxDaysOverdue: a.daysOverdue! };
      const avaliacao = avaliarRiscoDeFuga(
        { contractStatus: "active", contractStartDate: cliente.contractStartDate ?? undefined, ...foto },
        { consultanteEhDono: false, regras: REGRAS_DA_DEMO, consultasDeOutros: a.recentConsultations!, agora: a.createdAt! },
      );
      expect(avaliacao.alerta, a.message).toBe(true);
      expect(avaliacao.motivos).toEqual(motivos);
      expect(a.severity).toBe(severidadeDoAlerta(motivos, foto));
    }
  });

  it("riskFactors no formato de notifyOwnerProviders", () => {
    for (const a of alertas()) {
      const rf = a.riskFactors!;
      expect(rf[0]).toBe("consulta_outro_provedor");
      expect(rf).toContain("combinacao:qualquer");
      expect(["base_sincronizada", "erp_ao_vivo"]).toContain(rf[rf.length - 1]);
    }
  });

  it("tem resolvidos e descartados, com data no passado; os abertos nascem sem resolver", () => {
    const lista = alertas();
    const resolvidos = lista.filter(a => a.status === "resolved");
    const descartados = lista.filter(a => a.status === "dismissed");
    expect(resolvidos.length).toBeGreaterThanOrEqual(1);
    expect(descartados.length).toBeGreaterThanOrEqual(1);
    for (const a of [...resolvidos, ...descartados]) {
      expect(a.resolved).toBe(true);
      expect(a.createdAt!.getTime()).toBeLessThan(AGORA.getTime() - 86_400_000);
    }
    for (const a of lista.filter(x => x.status === "new")) expect(a.resolved).toBe(false);
    expect(lista.every(a => a.createdAt!.getTime() <= AGORA.getTime())).toBe(true);
  });

  it("um alerta traz a ONU em comodato com valor, e um cliente pagou depois do aviso — a foto diverge de hoje", () => {
    const lista = alertas();
    expect(lista.some(a => (a.equipmentNotReturned ?? 0) > 0 && parseFloat(a.equipmentValue ?? "0") > 0)).toBe(true);
    const pagouDepois = lista.filter(a => {
      const c = CLIENTES.find(x => x.id === a.customerId)!;
      return parseFloat(a.overdueAmount!) > 0 && Number(c.totalOverdueAmount) === 0;
    });
    expect(pagouDepois.length).toBeGreaterThanOrEqual(1);
  });

  it("as regras da demo gravadas reabrem iguais, com contrato novo e consultas repetidas ligados", () => {
    const linhas = regrasAntiFraudeDaDemo(PROVIDER_ID);
    expect(linhas.every(l => l.providerId === PROVIDER_ID)).toBe(true);
    expect(montarRegras(linhas.map(l => ({ tipo: l.tipo, ativo: l.ativo ?? true, parametros: l.parametros })))).toEqual(REGRAS_DA_DEMO);
    expect(REGRAS_DA_DEMO.contrato_novo.ativo && REGRAS_DA_DEMO.consultas_repetidas.ativo && REGRAS_DA_DEMO.ativo_inadimplente.ativo).toBe(true);
  });
});

describe("semeadura-consultas é pura", () => {
  it("não importa banco, storage nem o serviço de alerta (que grava em provedor base)", () => {
    const fonte = readFileSync(join(__dirname, "semeadura-consultas.ts"), "utf8");
    const imports = fonte.split("\n").filter(l => /^\s*import\b/.test(l)).join("\n");
    expect(imports).not.toMatch(/storage|["']\.\.\/db["']|proactive-alert|drizzle-orm/);
  });
});
