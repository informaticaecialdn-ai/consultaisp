import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A régua diária sob contrato — abertura, revisão, acordo, prescrição,
 * cancelamento pelo ERP, política pausada e a idempotência.
 *
 * O banco é um armazém em memória que imita o que o storage de verdade
 * promete (e que `cobranca.storage.test.ts` prova do lado de lá): um caso vivo
 * por cliente, a cascata da negociação quebrada, o `etapa_mudou` gravado pelo
 * `atualizar`, o `encerramento` gravado pelo `fechar` e pelo `cancelar`, e o
 * DNA arbitrado pelo funcionário que o motor não sobrescreve. Sem esse
 * comportamento o teste de idempotência não provaria nada — ele existe para
 * mostrar que rodar duas vezes no mesmo dia NÃO escreve de novo, e isso só se
 * mede com um armazém que lembra o que já foi escrito.
 */

vi.mock("../../db", () => ({ pool: {}, db: {} }));

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }));
vi.mock("../../logger", () => ({ logger: log }));

const fake = vi.hoisted(() => {
  type Cliente = {
    id: number; providerId: number; nome: string; statusErp: string;
    divida: number; dias: number; faturas: number; contrato: string | null;
  };
  type Caso = {
    id: number; providerId: number; customerId: number; status: string; carteira: string; abertoEm: Date;
    etapaAtual: string | null; diasAtrasoAbertura: number; valorAbertura: number; valorAtual: number;
    responsavelUserId: number | null; prioridade: string; proximoContatoEm: Date | null; ultimoContatoEm: Date | null;
    quadranteDna: string | null; tom: string | null; encerradoEm: Date | null; motivoEncerramento: string | null;
  };
  type Evento = {
    id: number; providerId: number; casoId: number; customerId: number; userId: number | null; tipo: string;
    canal: string | null; notas: string | null; metadata: Record<string, unknown> | null; ocorridoEm: Date;
  };
  type Parcela = { id: number; negociacaoId: number; numero: number; valor: string; vencimento: string; status: string };
  type Negociacao = { id: number; providerId: number; casoId: number; customerId: number; status: string; parcelamento: Parcela[] };

  const estado = {
    provedores: [] as Array<{ id: number; status: string }>,
    politicas: new Map<number, any>(),
    clientes: [] as Cliente[],
    casos: [] as Caso[],
    eventos: [] as Evento[],
    negociacoes: [] as Negociacao[],
    proximoId: 1,
  };
  /** STATUS_FECHADOS_DE_CASO de shared/cobranca/estados.ts — `cancelamento` é terminal. */
  const FECHADOS = ["pago", "baixado", "encerrado", "cancelamento"];
  const NEGOCIACAO_VIVA = ["proposta", "aceita", "ativa"];
  const vivo = (c: Caso) => !FECHADOS.includes(c.status);
  const id = () => estado.proximoId++;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const evento = (e: Omit<Evento, "id">) => { estado.eventos.push({ id: id(), ...e }); };

  const linha = (caso: Caso) => {
    const c = estado.clientes.find(x => x.id === caso.customerId && x.providerId === caso.providerId)!;
    return {
      ...caso,
      responsavelNome: null,
      cliente: {
        id: c.id, nome: c.nome, cpfCnpj: "000", telefone: null, email: null, cidade: null, bairro: null,
        statusErp: c.statusErp, dividaAtual: c.divida, diasAtraso: c.dias, faturasAbertas: c.faturas,
        plano: null, contractStartDate: c.contrato,
      },
    };
  };

  const storage = {
    getAllProviders: vi.fn(async () => estado.provedores),
    getPoliticaDeCobranca: vi.fn(async (pid: number) => estado.politicas.get(pid)),

    clientesParaAbrirCaso: vi.fn(async (pid: number, minimo: number, _limite?: number) => {
      const agora = Date.now();
      return estado.clientes
        .filter(c => c.providerId === pid && c.divida > minimo && c.dias >= 1)
        .filter(c => !estado.casos.some(k => k.providerId === pid && k.customerId === c.id && vivo(k)))
        .filter(c => !estado.casos.some(k => k.providerId === pid && k.customerId === c.id && ["baixado", "encerrado"].includes(k.status)))
        .filter(c => !estado.casos.some(k => k.providerId === pid && k.customerId === c.id && k.status === "pago"
          && k.encerradoEm && agora - k.encerradoEm.getTime() < 7 * 86_400_000))
        .sort((a, b) => b.divida - a.divida)
        .map(c => ({
          customerId: c.id, nome: c.nome, cpfCnpj: "000", statusErp: c.statusErp,
          carteira: ["active", "suspended"].includes(c.statusErp) ? "ativo" : "ex_cliente",
          dividaAtual: c.divida, diasAtraso: c.dias, faturasAbertas: c.faturas, contractStartDate: c.contrato,
        }));
    }),

    abrirCasoDeCobranca: vi.fn(async (pid: number, d: any) => {
      if (!estado.clientes.some(c => c.id === d.customerId && c.providerId === pid)) {
        throw new Error(`Cliente ${d.customerId} nao pertence ao provedor ${pid}`);
      }
      const existente = estado.casos.find(k => k.providerId === pid && k.customerId === d.customerId && vivo(k));
      if (existente) throw new Error(`Cliente ${d.customerId} ja tem caso de cobranca aberto (#${existente.id})`);
      const caso: Caso = {
        id: id(), providerId: pid, customerId: d.customerId, status: "aberto", carteira: d.carteira, abertoEm: new Date(),
        etapaAtual: d.etapaAtual ?? null, diasAtrasoAbertura: d.diasAtrasoAbertura, valorAbertura: d.valorAbertura,
        valorAtual: d.valorAbertura, responsavelUserId: d.responsavelUserId ?? null, prioridade: d.prioridade ?? "normal",
        proximoContatoEm: d.proximoContatoEm ?? null, ultimoContatoEm: null, quadranteDna: d.quadranteDna ?? null,
        tom: d.tom ?? null, encerradoEm: null, motivoEncerramento: null,
      };
      estado.casos.push(caso);
      return caso;
    }),

    registrarEventoDeCobranca: vi.fn(async (pid: number, e: any) => {
      const caso = estado.casos.find(k => k.id === e.casoId && k.providerId === pid);
      if (!caso) throw new Error(`Caso ${e.casoId} nao pertence ao provedor ${pid}`);
      const gravado = {
        id: id(), providerId: pid, casoId: caso.id, customerId: caso.customerId, userId: e.userId ?? null,
        tipo: e.tipo, canal: e.canal ?? null, notas: e.notas ?? null, metadata: e.metadata ?? null,
        ocorridoEm: e.ocorridoEm ?? new Date(),
      };
      estado.eventos.push(gravado);
      return gravado;
    }),

    listarCasosDeCobranca: vi.fn(async (pid: number, _f: any, pag: { pagina: number; porPagina: number }) => {
      const vivos = estado.casos.filter(k => k.providerId === pid && vivo(k))
        .sort((a, b) => b.valorAtual - a.valorAtual || a.id - b.id);
      const inicio = (pag.pagina - 1) * pag.porPagina;
      return { linhas: vivos.slice(inicio, inicio + pag.porPagina).map(linha), total: vivos.length };
    }),

    atualizarCasoDeCobranca: vi.fn(async (pid: number, casoId: number, patch: any, userId: number | null = null) => {
      const caso = estado.casos.find(k => k.id === casoId && k.providerId === pid);
      if (!caso) return undefined;
      const etapaAntes = caso.etapaAtual;
      if (patch.status !== undefined) caso.status = patch.status;
      if (patch.etapaAtual !== undefined) caso.etapaAtual = patch.etapaAtual;
      if (patch.valorAtual !== undefined) caso.valorAtual = patch.valorAtual;
      if (patch.prioridade !== undefined) caso.prioridade = patch.prioridade;
      if (patch.proximoContatoEm !== undefined) caso.proximoContatoEm = patch.proximoContatoEm;
      if (patch.quadranteDna !== undefined) caso.quadranteDna = patch.quadranteDna;
      if (patch.tom !== undefined) caso.tom = patch.tom;
      if (patch.etapaAtual !== undefined && patch.etapaAtual !== etapaAntes) {
        evento({ providerId: pid, casoId, customerId: caso.customerId, userId, tipo: "etapa_mudou", canal: "sistema",
          notas: null, metadata: { de: etapaAntes, para: patch.etapaAtual }, ocorridoEm: new Date() });
      }
      return caso;
    }),

    /**
     * Contrato do storage: grava quadrante e tom; `arbitrado: true` ("fidelidade
     * assumida sem a data") deixa uma nota de aviso no caso. Caso fechado não muda.
     */
    atualizarDnaDoCaso: vi.fn(async (
      pid: number, casoId: number,
      dna: { quadranteDna: string | null; tom: string | null; arbitrado: boolean },
      userId: number | null = null,
    ) => {
      const caso = estado.casos.find(k => k.id === casoId && k.providerId === pid);
      if (!caso) return undefined;
      if (FECHADOS.includes(caso.status)) return caso;
      caso.quadranteDna = dna.quadranteDna;
      caso.tom = dna.tom;
      if (dna.arbitrado) {
        evento({ providerId: pid, casoId, customerId: caso.customerId, userId, tipo: "nota", canal: "sistema",
          notas: `Quadrante ${dna.quadranteDna ?? "—"} arbitrado`, metadata: { motivo: "dna_arbitrado" }, ocorridoEm: new Date() });
      }
      return caso;
    }),

    fecharCasoDeCobranca: vi.fn(async (pid: number, casoId: number, status: string, motivo: string | null, userId: number | null = null) => {
      const caso = estado.casos.find(k => k.id === casoId && k.providerId === pid);
      if (!caso) return undefined;
      if (FECHADOS.includes(caso.status)) return caso;
      const de = caso.status;
      caso.status = status;
      caso.encerradoEm = new Date();
      caso.motivoEncerramento = motivo;
      evento({ providerId: pid, casoId, customerId: caso.customerId, userId, tipo: "encerramento",
        canal: userId === null ? "sistema" : null, notas: motivo, metadata: { status, de }, ocorridoEm: new Date() });
      return caso;
    }),

    /**
     * Contrato do storage: terminal `cancelamento`, motivo obrigatório, o evento
     * `cancelamento` leva o motivo e `sugerirRecuperacao: true`, e a negociação
     * viva é desfeita junto (parcelas pendentes e atrasadas viram canceladas).
     */
    cancelarCaso: vi.fn(async (pid: number, casoId: number, motivo: string, userId: number | null = null) => {
      const texto = motivo.trim();
      if (!texto) throw new Error("Cancelamento exige o motivo");
      const caso = estado.casos.find(k => k.id === casoId && k.providerId === pid);
      if (!caso) return undefined;
      if (FECHADOS.includes(caso.status)) return caso;
      const de = caso.status;
      caso.status = "cancelamento";
      caso.encerradoEm = new Date();
      caso.motivoEncerramento = texto;
      evento({ providerId: pid, casoId, customerId: caso.customerId, userId, tipo: "cancelamento",
        canal: userId === null ? "sistema" : null, notas: texto,
        metadata: { status: "cancelamento", de, motivo: texto, sugerirRecuperacao: true }, ocorridoEm: new Date() });
      for (const n of estado.negociacoes.filter(n => n.providerId === pid && n.casoId === casoId && NEGOCIACAO_VIVA.includes(n.status))) {
        n.status = "cancelada";
        for (const p of n.parcelamento) if (p.status === "pendente" || p.status === "atrasada") p.status = "cancelada";
      }
      return caso;
    }),

    listarEventosDoCaso: vi.fn(async (pid: number, casoId: number) =>
      estado.eventos.filter(e => e.providerId === pid && e.casoId === casoId)),

    marcarParcelasAtrasadas: vi.fn(async (pid: number, hoje: Date) => {
      const corte = iso(hoje);
      const tocadas = new Set<number>();
      let marcadas = 0;
      for (const n of estado.negociacoes.filter(n => n.providerId === pid)) {
        for (const p of n.parcelamento) {
          if (p.status === "pendente" && p.vencimento < corte) { p.status = "atrasada"; marcadas++; tocadas.add(n.id); }
        }
      }
      return { marcadas, negociacoes: [...tocadas] };
    }),

    listarNegociacoesDoCaso: vi.fn(async (pid: number, casoId: number) =>
      estado.negociacoes.filter(n => n.providerId === pid && n.casoId === casoId)),

    atualizarStatusDaNegociacao: vi.fn(async (pid: number, negId: number, status: string, userId: number | null = null) => {
      const n = estado.negociacoes.find(x => x.id === negId && x.providerId === pid);
      if (!n) return undefined;
      n.status = status;
      if (status === "quebrada" || status === "cancelada") {
        for (const p of n.parcelamento) if (p.status === "pendente" || p.status === "atrasada") p.status = "cancelada";
        const caso = estado.casos.find(k => k.id === n.casoId && k.providerId === pid);
        if (caso && vivo(caso)) caso.status = "aberto";
      }
      evento({ providerId: pid, casoId: n.casoId, customerId: n.customerId, userId,
        tipo: status === "quebrada" ? "acordo_quebrado" : "nota", canal: null, notas: null,
        metadata: { negociacaoId: negId, status }, ocorridoEm: new Date() });
      return n;
    }),
  };

  function reset() {
    estado.provedores = [{ id: 1, status: "active" }];
    estado.politicas = new Map();
    estado.clientes = [];
    estado.casos = [];
    estado.eventos = [];
    estado.negociacoes = [];
    estado.proximoId = 1;
  }

  function cliente(dados: Partial<Cliente> & { id: number }): Cliente {
    const c: Cliente = {
      providerId: 1, nome: `Cliente ${dados.id}`, statusErp: "active", divida: 100, dias: 10, faturas: 1,
      contrato: "2024-03-01", ...dados,
    };
    estado.clientes.push(c);
    return c;
  }

  function caso(dados: Partial<Caso> & { customerId: number }): Caso {
    const k: Caso = {
      id: id(), providerId: 1, status: "aberto", carteira: "ativo", abertoEm: new Date(2026, 8, 1),
      etapaAtual: "lembrete_atraso", diasAtrasoAbertura: 5, valorAbertura: 100, valorAtual: 100,
      responsavelUserId: null, prioridade: "normal", proximoContatoEm: null, ultimoContatoEm: null,
      quadranteDna: "A2", tom: "parceiro", encerradoEm: null, motivoEncerramento: null, ...dados,
    };
    estado.casos.push(k);
    return k;
  }

  function negociacao(dados: { casoId: number; status?: string; parcelas: Array<{ vencimento: string; status?: string }> }): Negociacao {
    const k = estado.casos.find(x => x.id === dados.casoId)!;
    const n: Negociacao = {
      id: id(), providerId: k.providerId, casoId: k.id, customerId: k.customerId, status: dados.status ?? "ativa",
      parcelamento: [],
    };
    n.parcelamento = dados.parcelas.map((p, i) => ({
      id: id(), negociacaoId: n.id, numero: i + 1, valor: "50.00", vencimento: p.vencimento, status: p.status ?? "pendente",
    }));
    estado.negociacoes.push(n);
    return n;
  }

  return { estado, storage, reset, cliente, caso, negociacao };
});

vi.mock("../../storage", () => ({ storage: fake.storage }));

import {
  ATRASO_DA_PASSADA_DE_BOOT_MS, DIVIDA_MINIMA_PARA_CASO, HORA_DA_PASSADA, LIMITE_DE_CANDIDATOS_POR_PASSADA,
  MOTIVO_CANCELADO_NO_ERP, MOTIVO_DIVIDA_ZERADA, MOTIVO_PRESCRITA,
  TOLERANCIA_QUEBRA_DE_ACORDO_DIAS, _reiniciarReguaParaTestes, dnaDoCaso, iniciarAgendaDaRegua, prioridadeSugerida,
  reguaEmAndamento, rodarReguaDiaria, rodarReguaDoProvedor,
} from "./regua-diaria.service";
import { DIAS_PRESCRICAO } from "@shared/cobranca/regua";
import { TOM_VULNERAVEL } from "@shared/cobranca/dna";
import { STATUS_FECHADOS_DE_CASO } from "@shared/cobranca/estados";

const { estado, storage, cliente, caso, negociacao } = fake;

/** Sábado, 5 de setembro de 2026, 05:00 — a hora da passada. */
const hoje = new Date(2026, 8, 5, 5, 0, 0);
const amanha = new Date(2026, 8, 6, 5, 0, 0);
const eventosDo = (casoId: number) => estado.eventos.filter(e => e.casoId === casoId);
const casoDe = (customerId: number) => estado.casos.find(k => k.customerId === customerId);

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  _reiniciarReguaParaTestes();
});

afterEach(() => {
  _reiniciarReguaParaTestes();
  vi.useRealTimers();
});

describe("1 · abertura de caso", () => {
  it("abre o caso do ativo em atraso com etapa, DNA, prioridade, próximo contato hoje e o evento de abertura", async () => {
    // Contrato de março/2024: 30 meses → fidelidade média. 10 dias, 1 fatura → em dia. A2 → parceiro.
    cliente({ id: 10, statusErp: "active", divida: 120, dias: 10, faturas: 1, contrato: "2024-03-01" });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.abertos).toBe(1);
    const k = casoDe(10)!;
    expect(k).toMatchObject({
      status: "aberto", carteira: "ativo", etapaAtual: "lembrete_atraso",
      diasAtrasoAbertura: 10, valorAbertura: 120, valorAtual: 120,
      quadranteDna: "A2", tom: "parceiro", prioridade: "normal", responsavelUserId: null,
    });
    expect(k.proximoContatoEm).toEqual(hoje);

    const [abertura] = eventosDo(k.id);
    expect(abertura).toMatchObject({ tipo: "etapa_mudou", canal: "sistema", userId: null });
    expect(abertura.metadata).toEqual({
      abertura: true, de: null, para: "lembrete_atraso", motivoSemEtapa: null, carteira: "ativo",
      diasAtraso: 10, valor: 120, quadrante: "A2", tom: "parceiro",
    });
  });

  it("ex-cliente vai do lembrete direto à negociação: não há serviço a suspender", async () => {
    cliente({ id: 11, statusErp: "cancelled", divida: 400, dias: 20 });

    await rodarReguaDoProvedor(1, hoje);

    expect(casoDe(11)).toMatchObject({ carteira: "ex_cliente", etapaAtual: "negociacao_recuperacao" });
  });

  it("suspenso por atraso ainda é cliente: carteira 'ativo'", async () => {
    cliente({ id: 12, statusErp: "suspended", divida: 300, dias: 40 });

    await rodarReguaDoProvedor(1, hoje);

    expect(casoDe(12)).toMatchObject({ carteira: "ativo", etapaAtual: "negociacao_recuperacao" });
  });

  it("sem data de contrato não há DNA: quadrante e tom nascem nulos, e o evento de abertura diz o mesmo", async () => {
    // Antes o job arbitrava "médio" — e mandava o funcionário ligar com o tom de
    // cliente regular para alguém que podia ter dez anos ou dez dias de casa.
    // A regra de dna.ts é uma só: sem data, sem DNA. Etapa e prioridade seguem.
    cliente({ id: 13, divida: 500, dias: 100, faturas: 2, contrato: null });

    await rodarReguaDoProvedor(1, hoje);

    const k = casoDe(13)!;
    expect(k).toMatchObject({ quadranteDna: null, tom: null, status: "aberto" });
    expect(k.etapaAtual).not.toBeNull();
    expect(eventosDo(k.id)[0].metadata).toMatchObject({ abertura: true, quadrante: null, tom: null });
    expect(eventosDo(k.id)[0].metadata).not.toHaveProperty("fidelidadePorFaltaDeData");
  });

  it("dívida prescrita NUNCA vira caso — CC art. 206 §5º", async () => {
    cliente({ id: 14, statusErp: "cancelled", divida: 2000, dias: DIAS_PRESCRICAO + 30 });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(casoDe(14)).toBeUndefined();
    expect(r.naoAbertosPrescritos).toBe(1);
    expect(r.abertos).toBe(0);
  });

  it("o piso de abertura é o resíduo de R$ 20, não o saldo mínimo de parcelamento da política", async () => {
    // R$ 89,90 com dez dias de atraso é a fatura que o lembrete existe para
    // resolver; com o saldoMinimoParcelar (150) como piso ela nunca entraria.
    estado.politicas.set(1, { pausada: false, etapas: [], negociacao: { saldoMinimoParcelar: 150 } });
    cliente({ id: 15, divida: 89.9, dias: 10 });
    cliente({ id: 16, divida: 15, dias: 10 });

    await rodarReguaDoProvedor(1, hoje);

    expect(storage.clientesParaAbrirCaso).toHaveBeenCalledWith(1, DIVIDA_MINIMA_PARA_CASO, LIMITE_DE_CANDIDATOS_POR_PASSADA);
    expect(DIVIDA_MINIMA_PARA_CASO).toBe(20);
    expect(casoDe(15)).toBeDefined();
    expect(casoDe(16)).toBeUndefined();
  });

  it("a corrida com outro processo conta como 'já aberto', não como erro", async () => {
    cliente({ id: 17 });
    storage.abrirCasoDeCobranca.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.jaAbertos).toBe(1);
    expect(r.erros).toBe(0);
    expect(r.abertos).toBe(0);
  });

  it("a régua do provedor vale na abertura: etapa desligada é absorvida pela seguinte", async () => {
    estado.politicas.set(1, { pausada: false, etapas: [{ id: "aviso_suspensao", ativa: false }] });
    cliente({ id: 18, statusErp: "active", divida: 200, dias: 20 });

    await rodarReguaDoProvedor(1, hoje);

    expect(casoDe(18)!.etapaAtual).toBe("negociacao_recuperacao");
  });

  it("a primeira passada de produção cabe numa só: o teto de candidatos cobre os ~7.200 casos medidos", () => {
    expect(LIMITE_DE_CANDIDATOS_POR_PASSADA).toBeGreaterThanOrEqual(559 + 6637);
  });
});

describe("2 · revisão dos casos abertos", () => {
  it("recalcula a etapa pelo atraso de hoje, espelha o valor e deixa o rastro de → para", async () => {
    cliente({ id: 20, statusErp: "active", divida: 180, dias: 20 });
    const k = caso({ customerId: 20, etapaAtual: "lembrete_atraso", valorAtual: 100 });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.etapasMudadas).toBe(1);
    expect(r.valoresEspelhados).toBe(1);
    expect(k).toMatchObject({ etapaAtual: "aviso_suspensao", valorAtual: 180, status: "aberto" });
    const mudou = eventosDo(k.id).find(e => e.tipo === "etapa_mudou")!;
    expect(mudou.userId).toBeNull();
    expect(mudou.metadata).toEqual({ de: "lembrete_atraso", para: "aviso_suspensao" });
  });

  it("dívida zerada no sync encerra como pago, pelo sistema, com o motivo", async () => {
    cliente({ id: 21, divida: 0, dias: 0 });
    const k = caso({ customerId: 21 });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.pagos).toBe(1);
    expect(k).toMatchObject({ status: "pago", motivoEncerramento: MOTIVO_DIVIDA_ZERADA });
    expect(k.encerradoEm).not.toBeNull();
    const fim = eventosDo(k.id).find(e => e.tipo === "encerramento")!;
    expect(fim).toMatchObject({ userId: null, canal: "sistema" });
  });

  it("o acordo manda no caso: dívida zerada no ERP não encerra um acordo ativo", async () => {
    // Quem renegocia no ERP vê as faturas velhas canceladas e a dívida cair a
    // zero antes da primeira parcela vencer; encerrar como pago aí seria mentira.
    cliente({ id: 22, divida: 0, dias: 0 });
    const k = caso({ customerId: 22, status: "acordo_ativo" });
    negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-10-05" }] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(k.status).toBe("acordo_ativo");
    expect(r.pagos).toBe(0);
    expect(storage.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("`em_contato` segue a régua como aberto: a etapa anda, o valor espelha, a dívida zerada encerra — e o status fica", async () => {
    // O funcionário já falou e aguarda; o relógio da régua não para por isso.
    cliente({ id: 43, statusErp: "active", divida: 180, dias: 20 });
    const conversando = caso({ customerId: 43, status: "em_contato", etapaAtual: "lembrete_atraso", valorAtual: 100 });
    cliente({ id: 44, divida: 0, dias: 0 });
    const pagou = caso({ customerId: 44, status: "em_contato" });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(conversando).toMatchObject({ status: "em_contato", etapaAtual: "aviso_suspensao", valorAtual: 180 });
    expect(pagou).toMatchObject({ status: "pago", motivoEncerramento: MOTIVO_DIVIDA_ZERADA });
    expect(r).toMatchObject({ etapasMudadas: 1, valoresEspelhados: 1, pagos: 1 });
  });

  it("`negociando` com proposta na mesa é blindado como o acordo: nem etapa, nem pago, nem prescrição, nem cancelamento", async () => {
    // O funcionário está no meio da conversa, e o ERP pode já ter cancelado
    // as faturas velhas em cima da proposta. Até a proposta virar acordo ou
    // ser cancelada pelo storage (que devolve o caso a `aberto`), o job não
    // encosta — era o buraco do achado A1: pagar parcela de proposta deixava
    // o caso em `negociando` e fora da blindagem.
    cliente({ id: 45, statusErp: "active", divida: 180, dias: 20 });
    const envelheceu = caso({ customerId: 45, status: "negociando", etapaAtual: "lembrete_atraso", valorAtual: 100 });
    cliente({ id: 46, divida: 0, dias: 0 });
    const zerou = caso({ customerId: 46, status: "negociando" });
    cliente({ id: 47, statusErp: "cancelled", divida: 800, dias: DIAS_PRESCRICAO + 10 });
    const prescreveu = caso({ customerId: 47, status: "negociando", carteira: "ex_cliente" });
    cliente({ id: 48, statusErp: "cancelled", divida: 100, dias: 10 });
    const cancelou = caso({ customerId: 48, status: "negociando", carteira: "ativo" });
    for (const k of [envelheceu, zerou, prescreveu, cancelou]) {
      negociacao({ casoId: k.id, status: "proposta", parcelas: [{ vencimento: "2026-10-05" }] });
    }

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(envelheceu).toMatchObject({ status: "negociando", etapaAtual: "lembrete_atraso", valorAtual: 100 });
    expect(zerou.status).toBe("negociando");
    expect(prescreveu.status).toBe("negociando");
    expect(cancelou.status).toBe("negociando");
    expect(r).toMatchObject({ etapasMudadas: 0, valoresEspelhados: 0, pagos: 0, prescritosEncerrados: 0, cancelados: 0, dnaAtualizados: 0 });
    expect(storage.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(storage.atualizarDnaDoCaso).not.toHaveBeenCalled();
    expect(storage.fecharCasoDeCobranca).not.toHaveBeenCalled();
    expect(storage.cancelarCaso).not.toHaveBeenCalled();
  });

  it("negociação `ativa` presa num caso `negociando` (deriva do A1) ainda quebra pela parcela, e o caso volta à régua", async () => {
    cliente({ id: 49, statusErp: "active", divida: 300, dias: 40 });
    const k = caso({ customerId: 49, status: "negociando", etapaAtual: null });
    // Venceu em 28/08 — oito dias antes de hoje.
    const n = negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-08-28" }] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(n.status).toBe("quebrada");
    expect(r.acordosQuebrados).toBe(1);
    expect(k).toMatchObject({ status: "aberto", etapaAtual: "negociacao_recuperacao", valorAtual: 300 });
  });

  it("contrato cancelado no ERP com o caso vivo: `cancelamento` pelo storage, que já carrega a sugestão de recuperação — uma vez só", async () => {
    cliente({ id: 23, statusErp: "cancelled", divida: 100, dias: 10 });
    const k = caso({ customerId: 23, carteira: "ativo" });

    const primeira = await rodarReguaDoProvedor(1, hoje);

    expect(primeira.cancelados).toBe(1);
    expect(storage.cancelarCaso).toHaveBeenCalledWith(1, k.id, MOTIVO_CANCELADO_NO_ERP, null);
    expect(MOTIVO_CANCELADO_NO_ERP).toBe("contrato cancelado no ERP");
    expect(k).toMatchObject({ status: "cancelamento", carteira: "ativo", motivoEncerramento: MOTIVO_CANCELADO_NO_ERP });
    expect(k.encerradoEm).not.toBeNull();
    // Cancelado ANTES de mover etapa: não se anda a régua de um caso que acabou.
    expect(storage.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(storage.atualizarDnaDoCaso).not.toHaveBeenCalled();
    // O evento é do storage (motivo + sugerirRecuperacao); o job não escreve
    // nota por cima — a antiga ("o caso segue na carteira") morreu com o caso.
    const fim = eventosDo(k.id).find(e => e.tipo === "cancelamento")!;
    expect(fim).toMatchObject({ userId: null, canal: "sistema", notas: MOTIVO_CANCELADO_NO_ERP });
    expect(fim.metadata).toMatchObject({ de: "aberto", sugerirRecuperacao: true });
    expect(eventosDo(k.id).filter(e => e.tipo === "nota")).toHaveLength(0);
    expect(storage.registrarEventoDeCobranca).not.toHaveBeenCalled();

    // Cancelado hoje não reabre hoje: o cliente virou ex-cliente com dívida e
    // o mock o devolveria como candidato na mesma passada — dois cards da
    // mesma pessoa abertos no mesmo minuto. Se e quando a dívida volta como
    // caso de ex-cliente é decisão de `clientesParaAbrirCaso`, do storage.
    expect(primeira.abertos).toBe(0);
    expect(estado.casos.filter(c => c.customerId === 23)).toHaveLength(1);

    // Terminal: o caso sumiu da lista de vivos e nada se repete.
    const segunda = await rodarReguaDoProvedor(1, hoje);
    expect(segunda.cancelados).toBe(0);
    expect(storage.cancelarCaso).toHaveBeenCalledTimes(1);
    expect(eventosDo(k.id).filter(e => e.tipo === "cancelamento")).toHaveLength(1);
  });

  it("cancelamento só para quem abriu como ativo: o ex-cliente já nasceu cancelado, e quem pagou e cancelou pagou", async () => {
    cliente({ id: 28, statusErp: "cancelled", divida: 100, dias: 20 });
    const exCliente = caso({ customerId: 28, carteira: "ex_cliente", etapaAtual: "negociacao_recuperacao" });
    cliente({ id: 27, statusErp: "cancelled", divida: 0, dias: 0 });
    const pagouESaiu = caso({ customerId: 27, carteira: "ativo" });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(exCliente.status).toBe("aberto");
    expect(pagouESaiu).toMatchObject({ status: "pago", motivoEncerramento: MOTIVO_DIVIDA_ZERADA });
    expect(r).toMatchObject({ cancelados: 0, pagos: 1 });
    expect(storage.cancelarCaso).not.toHaveBeenCalled();
  });

  it("o tom de vulnerável posto pelo funcionário não é sobrescrito; o quadrante ainda acompanha", async () => {
    cliente({ id: 25, divida: 100, dias: 100, faturas: 3, contrato: "2024-03-01" });
    const k = caso({ customerId: 25, etapaAtual: "pre_negativacao", quadranteDna: "A2", tom: TOM_VULNERAVEL });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(storage.atualizarDnaDoCaso).toHaveBeenCalledWith(1, k.id, { quadranteDna: "C2", tom: TOM_VULNERAVEL, arbitrado: false }, null);
    expect(k.tom).toBe(TOM_VULNERAVEL);
    expect(k.quadranteDna).toBe("C2");
    expect(r.dnaAtualizados).toBe(1);
  });

  it("sem data de contrato o quadrante calculado é nulo, e nulo é o que se grava — uma vez, nunca como 'arbitrado'", async () => {
    // O caso abriu quando o ERP ainda dava a data (ou pela arbitragem antiga
    // de "médio"); hoje o ERP não dá. "Sem DNA" é dado: a grade o conta. E o
    // job nunca manda `arbitrado: true` — a nota de "fidelidade assumida" que
    // o storage escreveria não tem quando nascer.
    cliente({ id: 29, divida: 100, dias: 10, contrato: null });
    const k = caso({ customerId: 29, quadranteDna: "A2", tom: "parceiro" });

    const primeira = await rodarReguaDoProvedor(1, hoje);
    const segunda = await rodarReguaDoProvedor(1, hoje);

    expect(storage.atualizarDnaDoCaso).toHaveBeenCalledTimes(1);
    expect(storage.atualizarDnaDoCaso).toHaveBeenCalledWith(1, k.id, { quadranteDna: null, tom: null, arbitrado: false }, null);
    expect(k).toMatchObject({ quadranteDna: null, tom: null });
    expect(primeira.dnaAtualizados).toBe(1);
    expect(segunda.dnaAtualizados).toBe(0);
    expect(estado.eventos.filter(e => e.tipo === "nota")).toHaveLength(0);
  });

  it("todo DNA que o job grava sai com arbitrado:false — em qualquer quadrante", async () => {
    cliente({ id: 26, divida: 100, dias: 100, faturas: 3, contrato: "2024-03-01" });
    caso({ customerId: 26, etapaAtual: "pre_negativacao", quadranteDna: "A3", tom: "acolhedor" });
    cliente({ id: 27, divida: 100, dias: 10, contrato: null });
    caso({ customerId: 27 });

    await rodarReguaDoProvedor(1, hoje);

    expect(storage.atualizarDnaDoCaso).toHaveBeenCalledTimes(2);
    expect(storage.atualizarDnaDoCaso.mock.calls.every(([, , dna]) => dna.arbitrado === false)).toBe(true);
  });

  it("caso sem mudança nenhuma não é tocado", async () => {
    cliente({ id: 30, statusErp: "active", divida: 100, dias: 10, faturas: 1, contrato: "2024-03-01" });
    caso({ customerId: 30, etapaAtual: "lembrete_atraso", valorAtual: 100, quadranteDna: "A2", tom: "parceiro" });

    await rodarReguaDoProvedor(1, hoje);

    expect(storage.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(storage.atualizarDnaDoCaso).not.toHaveBeenCalled();
    expect(storage.fecharCasoDeCobranca).not.toHaveBeenCalled();
    expect(storage.cancelarCaso).not.toHaveBeenCalled();
    expect(estado.eventos).toHaveLength(0);
  });
});

describe("3 · parcelas e acordos", () => {
  it("parcela vencida vira atrasada; atrasada há mais de 5 dias quebra o acordo e o caso volta à régua na mesma passada", async () => {
    cliente({ id: 30, statusErp: "active", divida: 300, dias: 40 });
    const k = caso({ customerId: 30, status: "acordo_ativo", etapaAtual: null });
    // Venceu em 28/08 — oito dias antes de hoje.
    const n = negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-08-28" }, { vencimento: "2026-09-28" }] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(storage.marcarParcelasAtrasadas).toHaveBeenCalledWith(1, hoje);
    expect(r.parcelasAtrasadas).toBe(1);
    expect(r.acordosQuebrados).toBe(1);
    expect(n.status).toBe("quebrada");
    expect(n.parcelamento.map(p => p.status)).toEqual(["cancelada", "cancelada"]);
    expect(eventosDo(k.id).some(e => e.tipo === "acordo_quebrado")).toBe(true);
    // E o caso não fica um dia sem etapa: voltou a aberto e já foi revisado.
    expect(k).toMatchObject({ status: "aberto", etapaAtual: "negociacao_recuperacao", valorAtual: 300 });
  });

  it("parcela atrasada há 3 dias ainda não quebra o acordo", async () => {
    expect(TOLERANCIA_QUEBRA_DE_ACORDO_DIAS).toBe(5);
    cliente({ id: 31, divida: 300, dias: 40 });
    const k = caso({ customerId: 31, status: "acordo_ativo" });
    const n = negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-09-02" }] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(n.parcelamento[0].status).toBe("atrasada");
    expect(n.status).toBe("ativa");
    expect(k.status).toBe("acordo_ativo");
    expect(r.acordosQuebrados).toBe(0);
  });

  it("exatamente 5 dias é tolerado; o sexto quebra", async () => {
    cliente({ id: 32, divida: 300, dias: 40 });
    const k = caso({ customerId: 32, status: "acordo_ativo" });
    const n = negociacao({ casoId: k.id, status: "aceita", parcelas: [{ vencimento: "2026-08-31", status: "atrasada" }] });

    await rodarReguaDoProvedor(1, hoje);
    expect(n.status).toBe("aceita");

    await rodarReguaDoProvedor(1, amanha);
    expect(n.status).toBe("quebrada");
    expect(k.status).toBe("aberto");
  });

  it("negociação já encerrada (cancelada, cumprida) não é reexaminada", async () => {
    cliente({ id: 33, divida: 300, dias: 40 });
    const k = caso({ customerId: 33, status: "acordo_ativo" });
    negociacao({ casoId: k.id, status: "cancelada", parcelas: [{ vencimento: "2026-08-01", status: "atrasada" }] });
    negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-10-01" }] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.acordosQuebrados).toBe(0);
    expect(storage.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
  });

  it("acordo ativo de quem cancelou o contrato no ERP não é cancelado pelo job: o acordo é o compromisso real", async () => {
    // Cancelar aqui cancelaria as parcelas de um plano que o devedor está
    // pagando. Se o funcionário quiser, cancela pelo kanban.
    cliente({ id: 34, statusErp: "cancelled", divida: 300, dias: 40 });
    const k = caso({ customerId: 34, status: "acordo_ativo", carteira: "ativo" });
    const n = negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-10-01" }] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(k.status).toBe("acordo_ativo");
    expect(n.status).toBe("ativa");
    expect(r.cancelados).toBe(0);
    expect(storage.cancelarCaso).not.toHaveBeenCalled();
  });
});

describe("4 · prescrição", () => {
  it("caso aberto cuja dívida prescreveu é encerrado com motivo 'prescrita'", async () => {
    cliente({ id: 40, statusErp: "cancelled", divida: 800, dias: DIAS_PRESCRICAO });
    const k = caso({ customerId: 40, carteira: "ex_cliente", etapaAtual: "fim_de_linha" });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.prescritosEncerrados).toBe(1);
    expect(k).toMatchObject({ status: "encerrado", motivoEncerramento: MOTIVO_PRESCRITA });
    expect(eventosDo(k.id).find(e => e.tipo === "encerramento")).toMatchObject({ userId: null, notas: MOTIVO_PRESCRITA });
  });

  it("encerrado por prescrição não volta como candidato no dia seguinte", async () => {
    cliente({ id: 41, statusErp: "cancelled", divida: 800, dias: DIAS_PRESCRICAO + 1 });
    caso({ customerId: 41, carteira: "ex_cliente" });

    await rodarReguaDoProvedor(1, hoje);
    const r = await rodarReguaDoProvedor(1, amanha);

    expect(r.abertos).toBe(0);
    expect(estado.casos.filter(c => c.customerId === 41)).toHaveLength(1);
  });

  it("acordo ativo não prescreve pelo relógio da dívida: reconhecer a dívida interrompe a prescrição", async () => {
    cliente({ id: 42, statusErp: "cancelled", divida: 800, dias: DIAS_PRESCRICAO + 10 });
    const k = caso({ customerId: 42, carteira: "ex_cliente", status: "acordo_ativo" });
    negociacao({ casoId: k.id, status: "ativa", parcelas: [{ vencimento: "2026-10-01" }] });

    await rodarReguaDoProvedor(1, hoje);

    expect(k.status).toBe("acordo_ativo");
    expect(storage.fecharCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("prescrição vence o cancelamento: quem cancelou o contrato com dívida de cinco anos sai por prescrita", async () => {
    cliente({ id: 43, statusErp: "cancelled", divida: 800, dias: DIAS_PRESCRICAO + 1 });
    const k = caso({ customerId: 43, carteira: "ativo" });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(k).toMatchObject({ status: "encerrado", motivoEncerramento: MOTIVO_PRESCRITA });
    expect(r).toMatchObject({ prescritosEncerrados: 1, cancelados: 0 });
  });
});

describe("5 · política pausada", () => {
  it("não abre, não move, não marca parcela, não cancela — só registra que pulou, com o motivo", async () => {
    estado.politicas.set(1, { pausada: true, pausadaMotivo: "  auditoria interna  ", etapas: [] });
    cliente({ id: 50, divida: 500, dias: 40 });
    const k = caso({ customerId: 50, etapaAtual: "lembrete_atraso", valorAtual: 10 });
    negociacao({ casoId: k.id, parcelas: [{ vencimento: "2026-08-01" }] });
    cliente({ id: 51, statusErp: "cancelled", divida: 100, dias: 10 });
    const cancelou = caso({ customerId: 51, carteira: "ativo" });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r).toMatchObject({ pulado: true, motivo: "auditoria interna", abertos: 0, etapasMudadas: 0, cancelados: 0 });
    expect(storage.clientesParaAbrirCaso).not.toHaveBeenCalled();
    expect(storage.listarCasosDeCobranca).not.toHaveBeenCalled();
    expect(storage.marcarParcelasAtrasadas).not.toHaveBeenCalled();
    expect(storage.cancelarCaso).not.toHaveBeenCalled();
    expect(k).toMatchObject({ etapaAtual: "lembrete_atraso", valorAtual: 10 });
    expect(cancelou.status).toBe("aberto");
    expect(estado.negociacoes[0].parcelamento[0].status).toBe("pendente");
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ providerId: 1 }), expect.stringContaining("pausado"));
  });

  it("pausada sem motivo ganha um motivo legível", async () => {
    estado.politicas.set(1, { pausada: true, pausadaMotivo: null, etapas: [] });

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.motivo).toBe("política pausada");
  });
});

describe("idempotência", () => {
  it("rodar duas vezes no mesmo dia não escreve nada na segunda", async () => {
    // Um de cada: candidato, caso que muda de etapa, caso pago, prescrito,
    // DNA que virou nulo, acordo quebrado. O cancelamento pelo ERP tem o
    // próprio teste de repetição: é terminal, e o que a dívida vira depois é
    // do storage.
    cliente({ id: 60, divida: 120, dias: 10 });
    cliente({ id: 61, statusErp: "active", divida: 180, dias: 20 });
    caso({ customerId: 61, etapaAtual: "lembrete_atraso", valorAtual: 100 });
    cliente({ id: 62, divida: 0, dias: 0 });
    caso({ customerId: 62 });
    cliente({ id: 63, statusErp: "cancelled", divida: 800, dias: DIAS_PRESCRICAO + 5 });
    caso({ customerId: 63, carteira: "ex_cliente" });
    cliente({ id: 64, divida: 100, dias: 10, contrato: null });
    caso({ customerId: 64, quadranteDna: "A2", tom: "parceiro" });
    cliente({ id: 65, divida: 300, dias: 40 });
    const k65 = caso({ customerId: 65, status: "acordo_ativo", etapaAtual: null });
    negociacao({ casoId: k65.id, parcelas: [{ vencimento: "2026-08-20" }] });

    const primeira = await rodarReguaDoProvedor(1, hoje);
    const casosDepois = estado.casos.length;
    const eventosDepois = estado.eventos.length;
    const foto = JSON.stringify(estado.casos) + JSON.stringify(estado.negociacoes);

    const segunda = await rodarReguaDoProvedor(1, hoje);

    expect(primeira).toMatchObject({
      abertos: 1, etapasMudadas: 2, valoresEspelhados: 2, dnaAtualizados: 2, pagos: 1, prescritosEncerrados: 1,
      cancelados: 0, parcelasAtrasadas: 1, acordosQuebrados: 1, erros: 0,
    });
    expect(segunda).toMatchObject({
      abertos: 0, jaAbertos: 0, etapasMudadas: 0, valoresEspelhados: 0, dnaAtualizados: 0, pagos: 0,
      prescritosEncerrados: 0, cancelados: 0, parcelasAtrasadas: 0, acordosQuebrados: 0, erros: 0,
    });
    expect(estado.casos).toHaveLength(casosDepois);
    expect(estado.eventos).toHaveLength(eventosDepois);
    expect(JSON.stringify(estado.casos) + JSON.stringify(estado.negociacoes)).toBe(foto);
  });

  it("um caso pago hoje não é reaberto amanhã pelo ERP ainda mostrando a dívida", async () => {
    cliente({ id: 66, divida: 0, dias: 0 });
    caso({ customerId: 66 });
    await rodarReguaDoProvedor(1, hoje);
    // O sync da noite ainda não trouxe a baixa: `customers` volta a mostrar dívida.
    estado.clientes.find(c => c.id === 66)!.divida = 150;
    estado.clientes.find(c => c.id === 66)!.dias = 12;

    const r = await rodarReguaDoProvedor(1, amanha);

    expect(r.abertos).toBe(0);
  });

  it("toda saída do job é terminal no vocabulário compartilhado: o caso fechado nunca volta à lista de vivos", () => {
    // Se `cancelamento` saísse desta lista, o job cancelaria o mesmo caso todo dia.
    expect(STATUS_FECHADOS_DE_CASO).toEqual(expect.arrayContaining(["pago", "encerrado", "cancelamento"]));
  });
});

describe("a passada inteira", () => {
  it("um provedor que falha não derruba os outros, e a passada nunca lança", async () => {
    estado.provedores = [{ id: 1, status: "active" }, { id: 2, status: "active" }];
    cliente({ id: 70, providerId: 2, divida: 100, dias: 10 });
    storage.getPoliticaDeCobranca.mockImplementationOnce(async () => { throw new Error("banco fora do ar"); });

    const r = await rodarReguaDiaria(hoje);

    expect(r).not.toBeNull();
    expect(r!.provedores).toHaveLength(2);
    expect(r!.provedores[0]).toMatchObject({ providerId: 1, pulado: true, motivo: "falhou", erros: 1 });
    expect(r!.provedores[1]).toMatchObject({ providerId: 2, abertos: 1 });
    expect(r!.totais).toMatchObject({ provedores: 2, pulados: 1, abertos: 1, cancelados: 0, dnaAtualizados: 0, erros: 1 });
    expect(casoDe(70)).toBeDefined();
  });

  it("provedor cancelado fica de fora; suspenso entra", async () => {
    estado.provedores = [{ id: 1, status: "cancelled" }, { id: 2, status: "suspended" }];

    const r = await rodarReguaDiaria(hoje);

    expect(r!.provedores.map(p => p.providerId)).toEqual([2]);
    expect(storage.getPoliticaDeCobranca).not.toHaveBeenCalledWith(1);
  });

  it("um caso que explode é contado em erros e o laço segue", async () => {
    cliente({ id: 71, statusErp: "active", divida: 180, dias: 20 });
    caso({ customerId: 71, etapaAtual: "lembrete_atraso" });
    cliente({ id: 72, statusErp: "active", divida: 180, dias: 20 });
    caso({ customerId: 72, etapaAtual: "lembrete_atraso" });
    storage.atualizarCasoDeCobranca.mockRejectedValueOnce(new Error("deadlock"));

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.erros).toBe(1);
    expect(r.etapasMudadas).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ providerId: 1 }), expect.stringContaining("revisado"));
  });

  it("o cancelamento que falha no storage conta como erro, não cancela pela metade, e os outros seguem", async () => {
    cliente({ id: 73, statusErp: "cancelled", divida: 100, dias: 10 });
    const k73 = caso({ customerId: 73, carteira: "ativo" });
    cliente({ id: 74, statusErp: "cancelled", divida: 100, dias: 10 });
    const k74 = caso({ customerId: 74, carteira: "ativo" });
    storage.cancelarCaso.mockRejectedValueOnce(new Error("deadlock"));

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r).toMatchObject({ erros: 1, cancelados: 1 });
    expect([k73.status, k74.status].sort()).toEqual(["aberto", "cancelamento"]);
    expect(estado.eventos.filter(e => e.tipo === "cancelamento")).toHaveLength(1);
    // O que falhou não foi contado como cancelado nem tirado da abertura de hoje:
    // o caso dele continua vivo, então também não reabre — um card só.
    expect(estado.casos.filter(c => [73, 74].includes(c.customerId))).toHaveLength(2);
  });

  it("o log resume cada provedor com abertos, movidos, fechados e cancelados — o que se lê na primeira passada", async () => {
    cliente({ id: 80, divida: 100, dias: 10 });
    cliente({ id: 81, statusErp: "active", divida: 180, dias: 20 });
    caso({ customerId: 81, etapaAtual: "lembrete_atraso", valorAtual: 100 });
    cliente({ id: 82, divida: 0, dias: 0 });
    caso({ customerId: 82 });
    cliente({ id: 83, statusErp: "cancelled", divida: 100, dias: 10 });
    caso({ customerId: 83, carteira: "ativo" });

    await rodarReguaDoProvedor(1, hoje);

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 1, abertos: 1, movidos: 1, fechados: 1, cancelados: 1, erros: 0 }),
      expect.stringContaining("provedor concluído"),
    );
  });

  it("a segunda chamada sai na hora enquanto a primeira roda", async () => {
    let abrir!: () => void;
    storage.getAllProviders.mockImplementationOnce(async () => {
      await new Promise<void>(r => { abrir = r; });
      return estado.provedores;
    });

    const primeira = rodarReguaDiaria(hoje);
    const segunda = await rodarReguaDiaria(hoje);

    expect(segunda).toBeNull();
    expect(reguaEmAndamento()).toBe(true);
    abrir();
    await primeira;
    expect(reguaEmAndamento()).toBe(false);
  });

  it("lê os casos em páginas de 200 antes de escrever", async () => {
    for (let i = 0; i < 250; i++) {
      cliente({ id: 1000 + i, divida: 0, dias: 0 });
      caso({ customerId: 1000 + i });
    }

    const r = await rodarReguaDoProvedor(1, hoje);

    expect(r.pagos).toBe(250);
    expect(storage.listarCasosDeCobranca).toHaveBeenCalledTimes(2);
    expect(estado.casos.every(k => k.status === "pago")).toBe(true);
  });
});

describe("prioridadeSugerida", () => {
  it("a etapa dá a base, o valor sobe ou desce um nível", () => {
    expect(prioridadeSugerida(120, "lembrete_atraso")).toBe("normal");
    expect(prioridadeSugerida(80, "lembrete_atraso")).toBe("baixa");
    expect(prioridadeSugerida(1500, "lembrete_atraso")).toBe("alta");
    expect(prioridadeSugerida(200, "aviso_suspensao")).toBe("alta");
    expect(prioridadeSugerida(1200, "aviso_suspensao")).toBe("critica");
    expect(prioridadeSugerida(1200, "negociacao_recuperacao")).toBe("critica");
    expect(prioridadeSugerida(5000, "fim_de_linha")).toBe("normal");
    expect(prioridadeSugerida(50, "divida_antiga")).toBe("baixa");
    expect(prioridadeSugerida(300, null)).toBe("normal");
  });
});

describe("dnaDoCaso", () => {
  it("fase 1: a confiabilidade sai só do atraso e das faturas abertas; sem data não há DNA", () => {
    expect(dnaDoCaso({ contractStartDate: "2026-06-01", diasAtraso: 5, faturasAbertas: 1 }, hoje))
      .toEqual({ quadranteDna: "A1", tom: "boas_vindas", arbitrado: false });
    expect(dnaDoCaso({ contractStartDate: "2020-01-01", diasAtraso: 45, faturasAbertas: 2 }, hoje))
      .toEqual({ quadranteDna: "B3", tom: "cuidado", arbitrado: false });
    expect(dnaDoCaso({ contractStartDate: "2020-01-01", diasAtraso: 45, faturasAbertas: 3 }, hoje))
      .toEqual({ quadranteDna: "C3", tom: "negociar_reter", arbitrado: false });
    expect(dnaDoCaso({ contractStartDate: null, diasAtraso: 5, faturasAbertas: 1 }, hoje))
      .toEqual({ quadranteDna: null, tom: null, arbitrado: false });
    // Data ilegível é o mesmo que data nenhuma: não se chuta.
    expect(dnaDoCaso({ contractStartDate: "hoje", diasAtraso: 5, faturasAbertas: 1 }, hoje))
      .toEqual({ quadranteDna: null, tom: null, arbitrado: false });
  });
});

describe("a agenda", () => {
  it("roda uma passada de boot depois do atraso e a diária às 05:00; ligar duas vezes não vira dois relógios", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 6, 0, 0));
    expect(HORA_DA_PASSADA).toBe(5);

    iniciarAgendaDaRegua();
    iniciarAgendaDaRegua();
    expect(storage.getAllProviders).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ATRASO_DA_PASSADA_DE_BOOT_MS);
    expect(storage.getAllProviders).toHaveBeenCalledTimes(1);

    // Até 04:59 de amanhã, nada; às 05:00, a segunda passada.
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000 - ATRASO_DA_PASSADA_DE_BOOT_MS - 60_000);
    expect(storage.getAllProviders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storage.getAllProviders).toHaveBeenCalledTimes(2);

    // E se rearma sozinha para o dia seguinte.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(storage.getAllProviders).toHaveBeenCalledTimes(3);
  });

  it("se o worker sobe às 04:59, a de boot e a das 05:00 não se atropelam", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 4, 59, 50));
    let abrir!: () => void;
    storage.getAllProviders.mockImplementationOnce(async () => {
      await new Promise<void>(r => { abrir = r; });
      return estado.provedores;
    });

    iniciarAgendaDaRegua();
    await vi.advanceTimersByTimeAsync(ATRASO_DA_PASSADA_DE_BOOT_MS + 1000);

    // A das 05:00 disparou enquanto a de boot esperava o banco: saiu na hora.
    expect(storage.getAllProviders).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("já em andamento"));
    abrir();
    await vi.advanceTimersByTimeAsync(0);
    expect(reguaEmAndamento()).toBe(false);
  });
});
