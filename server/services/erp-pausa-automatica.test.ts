/**
 * O corte automatico, sob contrato.
 *
 * Cada teste aqui existe por um risco concreto:
 *
 *  · Pausar cedo demais transforma um blip de rede em chamado de suporte. Duas
 *    falhas nao pausam; tres pausam.
 *  · Pausar de novo o que ja esta parado manda um e-mail por varredura, para
 *    sempre. O provedor aprende a ignorar o aviso — e ai ele nao serve para
 *    nada.
 *  · O Resend fora do ar nao pode desfazer um corte que ja aconteceu. Pausar e
 *    ato terminado quando o aviso sai.
 *  · E o aviso so serve se disser QUAL ERP e QUANTAS falhas: sem isso o
 *    provedor nao sabe o que ir conferir.
 *  · E, do lado oposto: pausar a integracao porque o SUPORTE clicou tres vezes
 *    em "Sincronizar Agora" enquanto depurava manda o provedor abrir chamado
 *    com quem estava com a mao no problema. O corte e para a varredura que
 *    ninguem esta olhando.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pausarPorFalhas = vi.fn(async (_p: number, _s: string) => {});
const getProvider = vi.fn(async (_id: number) => NSLINK as any);
const getUsersByProvider = vi.fn(async (_id: number) => [] as any[]);
const registrarResultadoSync = vi.fn(async (_p: number, _s: string, _d: any) => {});
const contarFalhasConsecutivas = vi.fn(async (_p: number, _s: string) => 3);
const getErpIntegracoesResumo = vi.fn(async (_p: number) => [
  { erpSource: "ixc", isEnabled: true, status: "idle" } as any,
]);

/**
 * O conector que a varredura vai usar. `null` = o registry de verdade, que e
 * quem sabe que "ixc" se chama "IXC Soft" — o teste do rotulo depende disso.
 */
const conector = vi.hoisted(() => ({ atual: null as any }));

/** O envio de verdade e trocado aqui: e o unico ponto observavel do aviso. */
const enviarPausado = vi.hoisted(() => vi.fn(async (..._a: any[]) => {}));

const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock("../storage", () => ({
  storage: {
    pausarPorFalhas: (p: number, s: string) => pausarPorFalhas(p, s),
    getProvider: (id: number) => getProvider(id),
    getUsersByProvider: (id: number) => getUsersByProvider(id),
    registrarResultadoSync: (p: number, s: string, d: any) => registrarResultadoSync(p, s, d),
    contarFalhasConsecutivas: (p: number, s: string) => contarFalhasConsecutivas(p, s),
    getErpIntegracoesResumo: (p: number) => getErpIntegracoesResumo(p),
  },
}));

vi.mock("../logger", () => ({ logger: log }));

/**
 * A trava da varredura e um advisory lock no Postgres; aqui ela sempre concede.
 * Sem isto o sync tentaria uma conexao real e esperaria o timeout do pool.
 */
vi.mock("../db", () => ({
  pool: {
    connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }),
  },
  db: {},
}));

/**
 * So o `getConnector` e desviavel — e so quando `conector.atual` estiver posto.
 * O resto do registry continua o de verdade porque o aviso de pausa traduz
 * "ixc" para "IXC Soft" por ele.
 */
vi.mock("../erp", async (original) => {
  const real = await original<typeof import("../erp")>();
  return { ...real, getConnector: (s: string) => conector.atual ?? real.getConnector(s) };
});

/**
 * So `sendErpPausadoEmail` e falso. O `montarErpPausado` continua o de verdade
 * porque e ele que o ultimo teste inspeciona — um HTML imitado envelheceria
 * sozinho e provaria nada.
 */
vi.mock("./email", async (original) => {
  const real = await original<typeof import("./email")>();
  return { ...real, sendErpPausadoEmail: (...a: any[]) => enviarPausado(...a) };
});

import { avaliarPausaAutomatica, devePausar, FALHAS_PARA_PAUSAR } from "./erp-pausa-automatica";
import { syncProviderToDb } from "./erp-sync.service";
import { montarErpPausado } from "./email";
import { MARCA_PLATAFORMA } from "./marca.service";

const NSLINK = {
  id: 3, name: "NsLink Provedor", contactEmail: "financeiro@nslink.com.br",
  marcaId: null, subdomain: "nslink",
};

const base = {
  providerId: 3, erpSource: "ixc", providerName: "NsLink Provedor",
  ultimoErro: "403 — IP do servidor nao liberado no painel do IXC",
};

beforeEach(() => {
  vi.clearAllMocks();
  getProvider.mockResolvedValue(NSLINK as any);
  getUsersByProvider.mockResolvedValue([]);
  enviarPausado.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. O limiar
// ─────────────────────────────────────────────────────────────────────────────

describe("devePausar — a decisao, sem banco e sem e-mail", () => {
  it("o limiar da casa e tres", () => {
    expect(FALHAS_PARA_PAUSAR).toBe(3);
  });

  it("ruido de rede nao pausa: 0, 1 e 2 falhas seguem", () => {
    expect(devePausar(0, false)).toBe(false);
    expect(devePausar(1, false)).toBe(false);
    expect(devePausar(2, false)).toBe(false);
  });

  it("tres seguidas ja e padrao, e pausa — e o que passa dai tambem", () => {
    expect(devePausar(3, false)).toBe(true);
    expect(devePausar(30, false)).toBe(true);
  });

  it("o que ja esta parado nunca pausa de novo, por mais falhas que tenha", () => {
    expect(devePausar(3, true)).toBe(false);
    expect(devePausar(90, true)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. O efeito
// ─────────────────────────────────────────────────────────────────────────────

describe("avaliarPausaAutomatica", () => {
  it("duas falhas nao pausam nem avisam", async () => {
    const r = await avaliarPausaAutomatica({ ...base, falhasSeguidas: 2, jaPausado: false });
    expect(r).toEqual({ pausou: false });
    expect(pausarPorFalhas).not.toHaveBeenCalled();
    expect(enviarPausado).not.toHaveBeenCalled();
  });

  it("tres falhas pausam a integracao certa e avisam o provedor", async () => {
    const r = await avaliarPausaAutomatica({ ...base, falhasSeguidas: 3, jaPausado: false });
    expect(r).toEqual({ pausou: true });
    expect(pausarPorFalhas).toHaveBeenCalledTimes(1);
    // O par provedor+ERP e o que isola o tenant: pausar o ERP errado de outro
    // provedor seria pior que nao pausar nenhum.
    expect(pausarPorFalhas).toHaveBeenCalledWith(3, "ixc");
    expect(enviarPausado).toHaveBeenCalledTimes(1);
    expect(enviarPausado.mock.calls[0][0]).toBe("financeiro@nslink.com.br");
  });

  it("ja pausado: nao repausa e NAO manda o e-mail de novo", async () => {
    const r = await avaliarPausaAutomatica({ ...base, falhasSeguidas: 12, jaPausado: true });
    expect(r).toEqual({ pausou: false });
    expect(pausarPorFalhas).not.toHaveBeenCalled();
    expect(enviarPausado).not.toHaveBeenCalled();
  });

  it("o e-mail que nao chega nao desfaz o corte — devolve pausou, sem lancar", async () => {
    enviarPausado.mockRejectedValue(new Error("Resend nao respondeu em 10000ms"));
    const r = await avaliarPausaAutomatica({ ...base, falhasSeguidas: 3, jaPausado: false });
    expect(r).toEqual({ pausou: true });
    expect(pausarPorFalhas).toHaveBeenCalledWith(3, "ixc");
  });

  it("provedor sumido do cadastro tambem nao desfaz o corte", async () => {
    getProvider.mockResolvedValue(undefined as any);
    const r = await avaliarPausaAutomatica({ ...base, falhasSeguidas: 4, jaPausado: false });
    expect(r).toEqual({ pausou: true });
    expect(enviarPausado).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it("banco fora do ar na leitura do cadastro nao propaga para o sync", async () => {
    getProvider.mockRejectedValue(new Error("connection terminated"));
    await expect(
      avaliarPausaAutomatica({ ...base, falhasSeguidas: 3, jaPausado: false }),
    ).resolves.toEqual({ pausou: true });
    expect(log.error).toHaveBeenCalled();
  });

  it("o ERP vira rotulo humano no aviso: 'ixc' chega como 'IXC Soft'", async () => {
    await avaliarPausaAutomatica({ ...base, falhasSeguidas: 3, jaPausado: false });
    const dados = enviarPausado.mock.calls[0][2];
    expect(dados.erp).toContain("IXC");
    expect(dados.erp).not.toBe("ixc");
    expect(dados.falhasSeguidas).toBe(3);
    expect(dados.ultimoErro).toBe(base.ultimoErro);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. O que o provedor le
// ─────────────────────────────────────────────────────────────────────────────

describe("o aviso diz o que o provedor precisa para agir", () => {
  const m = montarErpPausado("Emerson Queiroz", {
    erp: "IXC Soft", falhasSeguidas: 3,
    ultimoErro: "403 — IP do servidor nao liberado",
  }, MARCA_PLATAFORMA, "https://nslink.consultaisp.com.br");

  it("o nome do ERP e o numero de falhas estao no corpo", () => {
    expect(m.html).toContain("IXC Soft");
    expect(m.html).toContain("3 vezes seguidas");
  });

  it("o ultimo erro vai junto: sem ele o provedor nao sabe o que conferir", () => {
    expect(m.html).toContain("403 — IP do servidor nao liberado");
  });

  it("diz que PAUSOU, e nao que 'houve um problema'", () => {
    expect(m.assunto).toMatch(/pausada/i);
    expect(m.html).toMatch(/pausada/i);
  });

  it("aponta o suporte para religar — o provedor nao tem mais botao nenhum", () => {
    expect(m.html).toMatch(/suporte/i);
    expect(m.html).toMatch(/religar/i);
  });

  it("uma falha unica sai no singular, para o dia em que o limiar mudar", () => {
    const um = montarErpPausado("Emerson", { erp: "MK Solutions", falhasSeguidas: 1 }, MARCA_PLATAFORMA);
    expect(um.html).toContain("falhou 1 vez.");
    expect(um.html).not.toContain("1 vezes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Quem clica em "Sincronizar Agora" nao pausa nada
//
// A contagem de falhas consecutivas nao distingue a origem da varredura, e ela
// nao pode: quem a faz parar e a linha "reativado", gravada como manual quando
// o superadmin religa. Entao o filtro fica no CHAMADOR — a avaliacao da pausa
// so roda para `syncType: "auto"`.
// ─────────────────────────────────────────────────────────────────────────────

const INTEGRACAO = { apiUrl: "https://ixc.nslink.com.br", apiToken: "token" };

/** Um ERP fora do ar: nenhuma fonte responde, e o sync registra "error". */
const foraDoAr = {
  name: "ixc",
  fetchDelinquents: async () => ({
    ok: false, customers: [],
    message: "403 — IP do servidor nao liberado no painel do IXC",
  }),
};

describe("o corte automatico so vale para a varredura agendada", () => {
  beforeEach(() => {
    conector.atual = foraDoAr;
    contarFalhasConsecutivas.mockResolvedValue(3);
    getErpIntegracoesResumo.mockResolvedValue([
      { erpSource: "ixc", isEnabled: true, status: "idle" } as any,
    ]);
  });

  afterEach(() => {
    conector.atual = null;
  });

  it("tres cliques em Sincronizar Agora num ERP fora do ar nao pausam nem avisam", async () => {
    for (let i = 0; i < 3; i++) {
      await syncProviderToDb(3, "NsLink Provedor", "ixc", INTEGRACAO, "manual");
    }
    expect(pausarPorFalhas).not.toHaveBeenCalled();
    expect(enviarPausado).not.toHaveBeenCalled();
    // Nem a contagem chega a ser feita: a decisao morre antes da consulta.
    expect(contarFalhasConsecutivas).not.toHaveBeenCalled();
  });

  it("a MESMA falha, na varredura das 03:00, pausa e avisa o provedor", async () => {
    await syncProviderToDb(3, "NsLink Provedor", "ixc", INTEGRACAO, "auto");
    expect(contarFalhasConsecutivas).toHaveBeenCalledWith(3, "ixc");
    expect(pausarPorFalhas).toHaveBeenCalledWith(3, "ixc");
    expect(enviarPausado).toHaveBeenCalledTimes(1);
  });

  it("a falha manual continua no historico — e ela que a proxima automatica conta", async () => {
    await syncProviderToDb(3, "NsLink Provedor", "ixc", INTEGRACAO, "manual");
    expect(registrarResultadoSync).toHaveBeenCalledTimes(1);
    const [providerId, erpSource, dados] = registrarResultadoSync.mock.calls[0] as any[];
    expect(providerId).toBe(3);
    expect(erpSource).toBe("ixc");
    expect(dados.status).toBe("error");
    expect(dados.syncType).toBe("manual");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Conector que nunca foi implementado nao pune o provedor
//
// Quatro conectores estao no registry so para figurar no catalogo: todo metodo
// deles devolve recusa, entao TODA varredura falha por construcao. Sem guarda,
// tres madrugadas bastam para o provedor receber um e-mail dizendo que a
// integracao dele foi pausada por falhas — de um ERP onde nao ha nada errado.
// Ele abre chamado, e o suporte vai conferir a credencial dele por um problema
// que e nosso.
// ─────────────────────────────────────────────────────────────────────────────

/** Um dos quatro stubs, no formato que o registry expoe. */
const semImplementacao = {
  name: "topsapp",
  label: "TopSApp",
  naoImplementado: true,
  fetchDelinquents: async () => ({
    ok: false, customers: [],
    message: "Conector TopSApp ainda nao implementado — fetchDelinquents indisponivel",
  }),
  fetchCustomers: async () => ({
    ok: false, customers: [],
    message: "Conector TopSApp ainda nao implementado — fetchCustomers indisponivel",
  }),
};

describe("conector sem implementacao nao dispara o corte automatico", () => {
  beforeEach(() => {
    contarFalhasConsecutivas.mockResolvedValue(3);
    getErpIntegracoesResumo.mockResolvedValue([
      { erpSource: "ixc", isEnabled: true, status: "idle" } as any,
      { erpSource: "topsapp", isEnabled: true, status: "idle" } as any,
    ]);
  });

  afterEach(() => {
    conector.atual = null;
  });

  it("tres varreduras das 03:00 num stub nao pausam nem avisam o provedor", async () => {
    conector.atual = semImplementacao;
    for (let i = 0; i < 3; i++) {
      await syncProviderToDb(3, "NsLink Provedor", "topsapp", INTEGRACAO, "auto");
    }
    expect(pausarPorFalhas).not.toHaveBeenCalled();
    expect(enviarPausado).not.toHaveBeenCalled();
    // A decisao morre antes da consulta: nem contar as falhas faz sentido aqui.
    expect(contarFalhasConsecutivas).not.toHaveBeenCalled();
  });

  it("a falha do stub continua no historico, e diz de quem e a pendencia", async () => {
    conector.atual = semImplementacao;
    await syncProviderToDb(3, "NsLink Provedor", "topsapp", INTEGRACAO, "auto");
    expect(registrarResultadoSync).toHaveBeenCalledTimes(1);
    const [providerId, erpSource, dados] = registrarResultadoSync.mock.calls[0] as any[];
    expect(providerId).toBe(3);
    expect(erpSource).toBe("topsapp");
    expect(dados.status).toBe("error");
    // Quem le o historico precisa saber que a pendencia e nossa, e sem o rotulo
    // humano do ERP a linha nao diz de qual integracao se trata.
    expect(dados.mensagem).toContain("TopSApp");
    expect(dados.mensagem).toMatch(/nao ha falha no ERP do provedor/i);
  });

  it("o conector implementado continua sendo cortado na terceira falha seguida", async () => {
    conector.atual = foraDoAr;
    contarFalhasConsecutivas
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    for (let i = 0; i < 3; i++) {
      await syncProviderToDb(3, "NsLink Provedor", "ixc", INTEGRACAO, "auto");
    }
    expect(pausarPorFalhas).toHaveBeenCalledTimes(1);
    expect(pausarPorFalhas).toHaveBeenCalledWith(3, "ixc");
    expect(enviarPausado).toHaveBeenCalledTimes(1);
  });
});
