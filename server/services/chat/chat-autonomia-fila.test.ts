/**
 * A FILA da autonomia (D11 e achados e1, e4, e5, e14), separada da rodada: o
 * que se prova aqui é quem roda, quando e com qual trava — não o que a rodada
 * responde (isso está em chat-autonomia.service.test.ts).
 *
 * O gancho é `assumir`, a primeira operação de toda rodada de trabalho
 * pendente: segurá-lo mede o paralelismo; fazê-lo lançar simula a exceção que
 * escapa da rodada; devolver `false` encerra a rodada sem mais nada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cobranca/gestao-operacional.service", () => ({ comOrcamentoContato: vi.fn(), ErroGestao: class extends Error {} }));
const armazem = vi.hoisted(() => ({
  getConversaDoChat: vi.fn(async (): Promise<any> => ({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "BOT" })),
  getIntegracaoDoChat: vi.fn(async (): Promise<any> => ({ providerId: 42, organizationId: "org_42", agenteConfig: {} })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => null),
  atualizarCasoDeCobranca: vi.fn(async () => undefined),
  atualizarConversaDoChat: vi.fn(async () => undefined),
  registrarEventoDoChat: vi.fn(async () => undefined),
  getUser: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: armazem }));
vi.mock("../../storage/faturas.storage", () => ({ FaturasStorage: class {} }));
const fila = vi.hoisted(() => ({
  config: vi.fn(async (): Promise<any> => ({ ativa: true, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] })),
  estado: vi.fn(async (): Promise<any> => ({ turnos: 0, humano: false, proposta: null, motivo: null })),
  proximos: vi.fn(async (): Promise<any[]> => []),
  assumir: vi.fn(async (): Promise<boolean> => false),
  marcar: vi.fn(async () => undefined),
  cancelar: vi.fn(async () => undefined),
  devolverParaPendente: vi.fn(async () => true),
  tabelasExistem: vi.fn(async () => ({ ok: true, faltam: [] })),
  salvarConfig: vi.fn(async () => undefined),
  resumo: vi.fn(async () => ({ pendente: 0, processando: 0, enviando: 0, concluido: 0, humano: 0, cancelado: 0 })),
}));
vi.mock("../../storage/chat-autonomia.storage", () => ({ autonomiaStorage: fila }));
vi.mock("../../storage/chat-autonomia-seguranca.storage", () => ({ segurancaAutonomiaStorage: {} }));
const cliente = vi.hoisted(() => ({
  desligarIa: vi.fn(async (): Promise<any> => ({ ok: true, valor: undefined })),
  atribuir: vi.fn(async (): Promise<any> => ({ ok: true, valor: {} })),
}));
vi.mock("./chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("./chat-ponte.service")>("./chat-ponte.service");
  return { clienteDoChat: () => cliente, ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
/** Trava de verdade, com a semântica do `pg_try_advisory_lock`: quem chega com a chave presa recebe null na hora. */
const travas = vi.hoisted(() => ({ presas: new Set<string>(), eventos: [] as string[], recusar: new Set<string>() }));
vi.mock("./chat-trava", () => ({
  comTravaDoChat: async (chave: string, fn: () => Promise<unknown>) => {
    if (travas.recusar.has(chave) || travas.presas.has(chave)) { travas.eventos.push(`recusada ${chave}`); return null; }
    travas.presas.add(chave); travas.eventos.push(`entra ${chave}`);
    try { return await fn(); } finally { travas.presas.delete(chave); travas.eventos.push(`sai ${chave}`); }
  },
}));
vi.mock("./chat-agentes.service", async () => {
  const trava = await import("./chat-trava");
  const { ErroDaPonteDoChat } = await vi.importActual<typeof import("./chat-ponte.service")>("./chat-ponte.service");
  return {
    listarAgentesDoChat: vi.fn(async () => ({ agentes: [] })),
    modelosDosAgentesDoChat: vi.fn(async () => ({ configured: true, models: [] })),
    comTravaDaConfiguracaoDoChat: async (providerId: number, fn: () => Promise<unknown>) => {
      const r = await trava.comTravaDoChat(`config:${providerId}`, async () => ({ valor: await fn() }));
      if (!r) throw new ErroDaPonteDoChat("CONFLITO", "A configuração do chat está sendo atualizada. Tente novamente em instantes.");
      return (r as { valor: unknown }).valor;
    },
  };
});
vi.mock("./chat-contexto.service", () => ({}));
vi.mock("./chat-agente.service", () => ({}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../../logger", () => ({ logger: loggerMock }));

import { DURACAO_MAXIMA_DA_LEVA_MS, ESPERA_MAXIMA_NA_PARADA_MS, INTERVALO_ENTRE_VARREDURAS_MS, PARALELISMO_DA_AUTONOMIA, RODADAS_SIMULTANEAS_POR_PROVEDOR, configurarAutonomia, devolverSeParando, executarFilaAutonomia, iniciarAutonomia, lerConfiguracaoDaRodada, pararAutonomia } from "./chat-autonomia.service";

const trabalho = (id: number, conversa = `conv_${id}`, provedor = 42, extra: Record<string, unknown> = {}) =>
  ({ id, provider_id: provedor, conversation_id: conversa, message_id: `m${id}`, status: "pendente", ...extra });
const integracaoPadrao = async (): Promise<any> => ({ providerId: 42, organizationId: "org_42", agenteConfig: {} });
/** A chave D9 ligada nestes provedores (com ela o fork tem o vps/009 e aceita 3 planos por organização); nos outros, desligada. */
const ligarChave = (...provedores: number[]) => armazem.getIntegracaoDoChat.mockImplementation(async (providerId: number): Promise<any> =>
  ({ providerId, organizationId: `org_${providerId}`, agenteConfig: { funcionariaDigital: { ativa: provedores.includes(providerId) } } }));

/** Portões para segurar `assumir` e soltar quando o teste quiser. */
function portoes() {
  const abertos = new Map<number, () => void>();
  let emCurso = 0, maximo = 0;
  const entraram: number[] = [];
  const conversasAoMesmoTempo: string[][] = [];
  const emCursoPorConversa = new Set<string>();
  fila.assumir.mockImplementation(async (job: any) => {
    entraram.push(job.id);
    emCurso += 1; maximo = Math.max(maximo, emCurso);
    emCursoPorConversa.add(job.conversation_id); conversasAoMesmoTempo.push([...emCursoPorConversa]);
    await new Promise<void>(resolve => abertos.set(job.id, resolve));
    emCurso -= 1; emCursoPorConversa.delete(job.conversation_id);
    return false;
  });
  return {
    entraram, get maximo() { return maximo; }, conversasAoMesmoTempo,
    abrir: (id: number) => { abertos.get(id)?.(); abertos.delete(id); },
    abrirTodos: () => { for (const [id, r] of abertos) { r(); abertos.delete(id); } },
    esperando: () => [...abertos.keys()],
  };
}
/** Uma volta do laço de eventos — com relógio falso, avança zero e esvazia as promessas. */
const ciclo = () => (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : new Promise(r => setTimeout(r, 0)));
async function ate(condicao: () => boolean, voltas = 200) {
  for (let i = 0; i < voltas && !condicao(); i++) await ciclo();
  expect(condicao()).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  travas.presas.clear(); travas.eventos.length = 0; travas.recusar.clear();
  fila.assumir.mockImplementation(async () => false);
  fila.proximos.mockResolvedValue([]);
  // `clearAllMocks` não desfaz implementação: a chave de um teste não vaza para o próximo.
  armazem.getIntegracaoDoChat.mockImplementation(integracaoPadrao);
});
afterEach(() => { vi.useRealTimers(); });

describe("vazão: paralelismo, conversas distintas e rodízio", () => {
  it(`até ${PARALELISMO_DA_AUTONOMIA} rodadas ao mesmo tempo, nunca mais — e a leva inteira é atendida`, async () => {
    ligarChave(42);
    const p = portoes();
    fila.proximos.mockResolvedValue([1, 2, 3, 4, 5].map(id => trabalho(id)));
    const volta = executarFilaAutonomia();
    await ate(() => p.esperando().length === 3);
    await ciclo(); await ciclo();
    expect(p.entraram).toEqual([1, 2, 3]);
    p.abrir(2);
    await ate(() => p.entraram.length === 4);
    expect(p.entraram).toEqual([1, 2, 3, 4]);
    p.abrirTodos();
    await ate(() => p.entraram.length === 5);
    p.abrirTodos();
    await volta;
    expect(p.maximo).toBe(PARALELISMO_DA_AUTONOMIA);
    expect(p.entraram.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("duas mensagens da MESMA conversa nunca rodam juntas: a segunda espera a primeira, na mesma volta", async () => {
    ligarChave(42);
    const p = portoes();
    fila.proximos.mockResolvedValue([trabalho(1, "conv_a"), trabalho(2, "conv_a"), trabalho(3, "conv_b")]);
    const volta = executarFilaAutonomia();
    await ate(() => p.esperando().length === 2);
    await ciclo(); await ciclo();
    expect(p.entraram).toEqual([1, 3]);
    p.abrir(3);
    await ciclo(); await ciclo();
    expect(p.entraram).toEqual([1, 3]);
    p.abrir(1);
    await ate(() => p.entraram.length === 3);
    p.abrirTodos();
    await volta;
    expect(p.entraram).toEqual([1, 3, 2]);
    for (const juntas of p.conversasAoMesmoTempo) expect(new Set(juntas).size).toBe(juntas.length);
  });

  it("pega na ordem que o banco devolve (o rodízio entre provedores vem da varredura)", async () => {
    ligarChave(1, 2);
    const p = portoes();
    fila.proximos.mockResolvedValue([trabalho(10, "a1", 1), trabalho(20, "b1", 2), trabalho(11, "a2", 1), trabalho(21, "b2", 2)]);
    const volta = executarFilaAutonomia();
    await ate(() => p.esperando().length === 3);
    // Os três primeiros da varredura começam juntos (a ordem de chegada ao `assumir` depende das leituras); o quarto espera vaga.
    const primeiros = [...p.entraram].sort((a, b) => a - b);
    p.abrirTodos();
    expect(primeiros).toEqual([10, 11, 20]);
    await ate(() => p.entraram.length === 4);
    p.abrirTodos();
    await volta;
    expect(p.entraram.at(-1)).toBe(21);
  });

  it(`a leva para de pegar trabalho novo depois de ${DURACAO_MAXIMA_DA_LEVA_MS / 1000} s — com mensagens sem fim, quem a chama ainda recebe a vez`, async () => {
    let agora = Date.parse("2026-09-17T15:00:00Z");
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora);
    try {
      const p = portoes();
      let proximoId = 1;
      // Sempre um trabalho novo na varredura, como um provedor com fila que não acaba.
      fila.proximos.mockImplementation(async () => [trabalho(proximoId++)]);
      const volta = executarFilaAutonomia();
      await ate(() => p.esperando().length >= 1);
      agora += DURACAO_MAXIMA_DA_LEVA_MS;
      for (let i = 0; i < 20 && p.esperando().length; i++) { p.abrirTodos(); await ciclo(); }
      await volta;
      const pegos = p.entraram.length;
      expect(pegos).toBeLessThanOrEqual(PARALELISMO_DA_AUTONOMIA + 1);
    } finally {
      relogio.mockRestore();
    }
  });

  it("trabalho que chega DEPOIS de uma varredura vazia começa no intervalo, com a rodada lenta ainda presa (e4)", async () => {
    vi.useFakeTimers();
    const p = portoes();
    let chegou = false;
    // O cliente do provedor 43 responde depois que a leva já varreu e não achou nada além da rodada lenta do 42.
    fila.proximos.mockImplementation(async () => (chegou ? [trabalho(1), trabalho(2, "conv_2", 43)] : [trabalho(1)]));
    let terminou = false;
    const volta = executarFilaAutonomia().then(() => { terminou = true; });
    await ate(() => p.esperando().includes(1));
    await ciclo(); await ciclo();
    chegou = true;
    const varreduras = fila.proximos.mock.calls.length;
    // Quem está sem serviço não sai, e também não martela o banco: espera o intervalo.
    await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VARREDURAS_MS - 1);
    expect(fila.proximos.mock.calls.length).toBe(varreduras);
    expect(p.entraram).toEqual([1]);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await ate(() => p.entraram.includes(2));
    expect(p.esperando().sort()).toEqual([1, 2]);
    p.abrirTodos();
    await ate(() => terminou);
    await volta;
  });

  it("ninguém rodando e a varredura sem nada: a leva termina na hora, sem esperar o intervalo", async () => {
    vi.useFakeTimers();
    fila.proximos.mockResolvedValue([trabalho(1)]);
    let terminou = false;
    void executarFilaAutonomia().then(() => { terminou = true; });
    // Só voltas do laço de eventos, sem avançar o relógio.
    await ate(() => terminou);
    expect(fila.assumir).toHaveBeenCalledOnce();
  });

  it(`chave D9 desligada: ${RODADAS_SIMULTANEAS_POR_PROVEDOR.chaveDesligada} rodada por provedor (o fork sem o vps/009 recusa o segundo plano com 503), e provedores diferentes seguem juntos`, async () => {
    const p = portoes();
    fila.proximos.mockResolvedValue([trabalho(1, "a1", 42), trabalho(2, "a2", 42), trabalho(3, "b1", 43)]);
    const volta = executarFilaAutonomia();
    await ate(() => p.esperando().length === 2);
    // Mesmo com a chave já lida (desligada), a segunda do 42 não começa.
    for (let i = 0; i < 10; i++) await ciclo();
    expect(p.esperando().sort()).toEqual([1, 3]);
    p.abrir(1);
    await ate(() => p.entraram.includes(2));
    expect(p.esperando().sort()).toEqual([2, 3]);
    p.abrirTodos();
    await ate(() => p.entraram.length === 3 && p.esperando().length === 0);
    await volta;
    expect(armazem.getIntegracaoDoChat).toHaveBeenCalledWith(42);
  });

  it(`chave D9 ligada num provedor só: ele recebe até ${RODADAS_SIMULTANEAS_POR_PROVEDOR.chaveLigada} rodadas, o outro segue com uma`, async () => {
    ligarChave(42);
    const p = portoes();
    fila.proximos.mockResolvedValue([trabalho(1, "a1", 42), trabalho(2, "b1", 43), trabalho(3, "a2", 42), trabalho(4, "b2", 43)]);
    const volta = executarFilaAutonomia();
    await ate(() => p.esperando().length === 3);
    for (let i = 0; i < 10; i++) await ciclo();
    expect(p.esperando().sort()).toEqual([1, 2, 3]);
    p.abrir(1);
    // A vaga é do 42, mas o 43 (chave desligada) ainda tem a rodada 2 em curso: o 4 espera.
    for (let i = 0; i < 10; i++) await ciclo();
    expect(p.entraram).not.toContain(4);
    p.abrir(2);
    await ate(() => p.entraram.includes(4));
    p.abrirTodos();
    await ate(() => p.entraram.length === 4 && p.esperando().length === 0);
    await volta;
  });
});

describe("try/catch por trabalho (e1)", () => {
  it("exceção que escapa da rodada: o trabalho vai ao atendente, a conversa trava no humano e os OUTROS seguem", async () => {
    fila.proximos.mockResolvedValue([trabalho(1), trabalho(2), trabalho(3)]);
    fila.assumir.mockImplementation(async (job: any) => { if (job.id === 2) throw Object.assign(new Error("valor da coluna 12345678909"), { code: "57P01" }); return false; });
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(fila.assumir.mock.calls.map(c => (c[0] as any).id).sort()).toEqual([1, 2, 3]);
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_2", expect.stringContaining("sem reenvio automático"));
    expect(fila.marcar).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), "humano", expect.stringContaining("sem reenvio automático"));
    expect(fila.marcar).toHaveBeenCalledTimes(1);
    // O log leva só o código do erro — a mensagem de um erro do banco pode trazer dado do cliente.
    expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain("12345678909");
    expect(loggerMock.warn.mock.calls.some(c => (c[0] as any)?.causa === "57P01")).toBe(true);
  });

  it("a transferência que lança de dentro da rodada (trabalho interrompido, fork fora) não deixa o trabalho preso nem para a fila", async () => {
    cliente.desligarIa.mockResolvedValueOnce({ ok: false, erro: "fora do ar" });
    fila.proximos.mockResolvedValue([trabalho(1, "conv_1", 42, { status: "enviando" }), trabalho(2)]);
    await executarFilaAutonomia();
    // O trabalho interrompido nunca é reenviado nem assumido: vai ao atendente.
    expect(fila.marcar).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "humano", expect.any(String));
    expect(fila.assumir).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("com o banco fora até para desistir, nada lança: o trabalho fica onde estava e a próxima volta decide", async () => {
    fila.proximos.mockResolvedValue([trabalho(1), trabalho(2)]);
    fila.assumir.mockRejectedValue(new Error("banco fora"));
    fila.cancelar.mockRejectedValue(new Error("banco fora"));
    fila.marcar.mockRejectedValue(new Error("banco fora"));
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(fila.assumir).toHaveBeenCalledTimes(2);
  });

  it("varredura que falha: a volta lança para o laço registrar 'fila indisponível', como antes", async () => {
    fila.proximos.mockRejectedValue(new Error("banco fora"));
    await expect(executarFilaAutonomia()).rejects.toThrow("banco fora");
    expect(fila.assumir).not.toHaveBeenCalled();
  });
});

describe("travas: config só para ler (e5)", () => {
  it("a trava config: é solta ANTES da trava da conversa — nunca aninhada em volta da rodada", async () => {
    fila.proximos.mockResolvedValue([trabalho(1, "conv_1")]);
    await executarFilaAutonomia();
    expect(travas.eventos).toEqual(["entra config:42", "sai config:42", "entra autonomia:42:conv_1", "sai autonomia:42:conv_1"]);
  });

  it("salvar a configuração com uma rodada em andamento funciona (antes dava conflito)", async () => {
    const p = portoes();
    fila.proximos.mockResolvedValue([trabalho(1, "conv_1")]);
    const volta = executarFilaAutonomia();
    await ate(() => p.esperando().length === 1);
    expect(travas.presas.has("autonomia:42:conv_1")).toBe(true);
    await expect(configurarAutonomia(42, { ativa: false, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] })).resolves.toBeDefined();
    expect(fila.salvarConfig).toHaveBeenCalledOnce();
    p.abrirTodos();
    await volta;
  });

  it("configuração sendo salva na hora da leitura: o trabalho não é tocado e fica pendente para a próxima volta", async () => {
    travas.recusar.add("config:42");
    fila.proximos.mockResolvedValue([trabalho(1)]);
    await executarFilaAutonomia();
    expect(fila.assumir).not.toHaveBeenCalled();
    expect(fila.marcar).not.toHaveBeenCalled();
    expect(fila.config).not.toHaveBeenCalled();
  });

  it("conversa com a trava presa (atendente assumindo): o trabalho fica pendente, sem desistir", async () => {
    travas.recusar.add("autonomia:42:conv_1");
    fila.proximos.mockResolvedValue([trabalho(1, "conv_1")]);
    await executarFilaAutonomia();
    expect(fila.assumir).not.toHaveBeenCalled();
    expect(fila.marcar).not.toHaveBeenCalled();
    expect(fila.cancelar).not.toHaveBeenCalled();
  });

  it("trabalho adiado por trava ocupada volta na MESMA leva depois do intervalo — uma leva longa não o esquece", async () => {
    let agora = Date.parse("2026-09-17T15:00:00Z");
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora);
    try {
      const p = portoes();
      travas.recusar.add("autonomia:42:conv_1");
      fila.proximos.mockResolvedValue([trabalho(1, "conv_1"), trabalho(2, "conv_2")]);
      const volta = executarFilaAutonomia();
      await ate(() => p.esperando().includes(2) && travas.eventos.includes("recusada autonomia:42:conv_1"));
      await ciclo(); await ciclo();
      expect(p.entraram).toEqual([2]);
      travas.recusar.clear();
      agora += 3_000;
      p.abrir(2);
      await ate(() => p.entraram.includes(1));
      p.abrirTodos();
      await volta;
      expect(p.entraram).toEqual([2, 1]);
    } finally {
      relogio.mockRestore();
    }
  });

  it("a leitura da rodada traz a configuração e a chave D9 da integração do provedor — desligada por padrão", async () => {
    expect(await lerConfiguracaoDaRodada(42)).toMatchObject({ config: { ativa: true }, funcionariaDigital: { ativa: false } });
    armazem.getIntegracaoDoChat.mockResolvedValueOnce({ providerId: 42, organizationId: "org_42", agenteConfig: { funcionariaDigital: { ativa: true, atualizadaPorUserId: 7 } } });
    expect((await lerConfiguracaoDaRodada(42)).funcionariaDigital).toEqual({ ativa: true });
    armazem.getIntegracaoDoChat.mockResolvedValueOnce({ providerId: 99, organizationId: "org_99", agenteConfig: { funcionariaDigital: { ativa: true } } });
    expect((await lerConfiguracaoDaRodada(42)).funcionariaDigital).toEqual({ ativa: false });
    armazem.getIntegracaoDoChat.mockResolvedValueOnce(undefined);
    expect((await lerConfiguracaoDaRodada(42)).funcionariaDigital).toEqual({ ativa: false });
    armazem.getIntegracaoDoChat.mockResolvedValueOnce({ providerId: 42, organizationId: "org_42", agenteConfig: { funcionariaDigital: { ativa: "sim" } } });
    expect((await lerConfiguracaoDaRodada(42)).funcionariaDigital).toEqual({ ativa: false });
  });
});

describe("parada (e14)", () => {
  it("o sinal é conferido entre trabalhos: o que não começou fica intocado (pendente)", async () => {
    ligarChave(42);
    const p = portoes();
    let parar = false;
    fila.proximos.mockResolvedValue([1, 2, 3, 4, 5].map(id => trabalho(id)));
    const volta = executarFilaAutonomia({ deveParar: () => parar });
    await ate(() => p.esperando().length === 3);
    parar = true;
    p.abrirTodos();
    await volta;
    expect(p.entraram).toEqual([1, 2, 3]);
    expect(fila.marcar).not.toHaveBeenCalled();
  });

  it("devolverSeParando: com o sinal, a rodada que não enviou volta a pendente; sem ele, nada muda", async () => {
    const job = trabalho(1);
    expect(await devolverSeParando(job, { deveParar: () => false })).toBe(false);
    expect(fila.devolverParaPendente).not.toHaveBeenCalled();
    expect(await devolverSeParando(job, { deveParar: () => true })).toBe(true);
    expect(fila.devolverParaPendente).toHaveBeenCalledWith(job);
  });

  it("parada com trabalhador esperando: ninguém volta ao banco, e a leva termina quando a rodada em curso termina", async () => {
    vi.useFakeTimers();
    const p = portoes();
    let parar = false;
    fila.proximos.mockResolvedValue([trabalho(1)]);
    let terminou = false;
    void executarFilaAutonomia({ deveParar: () => parar }).then(() => { terminou = true; });
    await ate(() => p.esperando().includes(1));
    await ciclo(); await ciclo();
    const varreduras = fila.proximos.mock.calls.length;
    parar = true;
    await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VARREDURAS_MS * 3);
    expect(fila.proximos.mock.calls.length).toBe(varreduras);
    expect(terminou).toBe(false);
    p.abrirTodos();
    await ate(() => terminou);
    expect(p.entraram).toEqual([1]);
  });

  it("sem rodada em curso, a parada volta na hora", async () => {
    expect(await pararAutonomia()).toBe(true);
  });

  it(`pararAutonomia espera as rodadas no máximo ${ESPERA_MAXIMA_NA_PARADA_MS / 1000} s, não começa outra, e não trava uma chamada direta depois`, async () => {
    vi.useFakeTimers();
    ligarChave(42);
    const p = portoes();
    fila.proximos.mockResolvedValue([trabalho(1), trabalho(2)]);
    expect(await iniciarAutonomia()).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    await ate(() => p.esperando().length === 2);
    const parada = pararAutonomia();
    let resolvida: boolean | null = null;
    void parada.then(v => { resolvida = v; });
    await vi.advanceTimersByTimeAsync(ESPERA_MAXIMA_NA_PARADA_MS - 1);
    expect(resolvida).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await parada).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ emAndamento: 2, esperaMs: ESPERA_MAXIMA_NA_PARADA_MS }), expect.stringContaining("parada sem esperar"));
    // Nenhuma volta nova depois da parada, e as rodadas presas terminam sem pegar trabalho novo.
    fila.proximos.mockResolvedValue([trabalho(3)]);
    await vi.advanceTimersByTimeAsync(10_000);
    p.abrirTodos();
    await vi.advanceTimersByTimeAsync(10);
    expect(p.entraram).toEqual([1, 2]);
    vi.useRealTimers();
    // Parar o laço não é uma trava global: uma chamada direta (o processo do chat-worker) roda.
    const direta = portoes();
    fila.proximos.mockResolvedValue([trabalho(4)]);
    const volta = executarFilaAutonomia();
    await ate(() => direta.esperando().length === 1);
    direta.abrirTodos();
    await volta;
    expect(direta.entraram).toEqual([4]);
  });

});

describe("log", () => {
  it("cada trabalho registra desfecho, duração e idade na fila — só ids e tempos", async () => {
    fila.proximos.mockResolvedValue([trabalho(1, "conv_1", 42, { criado_em: new Date(Date.now() - 90_000) })]);
    await executarFilaAutonomia();
    const linha = loggerMock.info.mock.calls.find(c => c[1] === "Autonomia: trabalho da fila")?.[0] as any;
    expect(linha).toMatchObject({ providerId: 42, jobId: 1, desfecho: "rodada" });
    expect(linha.idadeMs).toBeGreaterThanOrEqual(90_000);
    expect(typeof linha.ms).toBe("number");
    expect(Object.keys(linha).sort()).toEqual(["desfecho", "idadeMs", "jobId", "ms", "providerId"]);
  });
});
