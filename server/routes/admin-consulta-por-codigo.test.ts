import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: GET /api/admin/consultas/:consultaId — a unica porta por onde o
 * suporte acha uma consulta a partir do codigo que o provedor ditou.
 *
 * Tres coisas se provam aqui, e so tres:
 * 1. o codigo colado torto (minusculo, sem traco, com espaco) acha a MESMA
 *    consulta — quem cola no chamado cola do jeito que veio;
 * 2. a resposta NAO carrega o documento em texto puro nem o corpo do
 *    relatorio, mesmo com um superadmin do outro lado;
 * 3. cada ramo de saida (400, 404, 200, 500) deixa uma linha de log com o
 *    codigo, que e a razao de o identificador existir.
 *
 * `identificador-consulta` e `lgpd-masking` entram COMO OS REAIS de proposito:
 * mockar o normalizador provaria que a rota chamou uma funcao, nao que
 * "ci2609k7f3m2" vira `CI-2609-K7F3M2`; e mockar o mascarador transformaria a
 * prova de LGPD em prova de que um espiao foi chamado.
 */
const storageMock = vi.hoisted(() => ({
  buscarConsultasPorCodigo: vi.fn(async (): Promise<any[]> => []),
  // O modulo de rotas so precisa destes ao montar; ficam mudos.
  getUser: vi.fn(async (): Promise<any> => null),
  getProvider: vi.fn(async (): Promise<any> => null),
  getAllProviders: vi.fn(async (): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
  esquecerStatusDeProvedor: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));
vi.mock("../logger", () => ({ logger: loggerMock }));

vi.mock("../db", () => ({ db: {} }));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({
  sendVerificationEmail: vi.fn(), sendCadastroAprovadoEmail: vi.fn(),
  sendCadastroReprovadoEmail: vi.fn(), sendAcessoSuspensoEmail: vi.fn(),
  sendAcessoReativadoEmail: vi.fn(), sendPlanoAlteradoEmail: vi.fn(),
  sendUsuarioAdicionadoEmail: vi.fn(),
}));
vi.mock("../services/marca.service", () => ({
  esquecerMarcas: vi.fn(),
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: 7, nomeProduto: "CredNet" })),
  urlDeEntrada: vi.fn(() => "https://crednet.example"),
  MARCA_PLATAFORMA: { marcaId: 7, nomeProduto: "CredNet" },
}));
vi.mock("../services/lgpd-email.service", () => ({ sendCompletionEmail: vi.fn() }));

import { registerAdminRoutes } from "./admin.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerAdminRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.buscarConsultasPorCodigo.mockResolvedValue([]);
  sessao = { userId: 1, role: "superadmin" };
});

const CODIGO = "CI-2609-K7F3M2";

/** O documento inteiro de um titular real: nunca pode reaparecer na resposta. */
const DOCUMENTO = "12345678909";

/**
 * O relatorio como ele fica gravado: nome, endereco, telefone, e-mail, renda.
 * E exatamente o que NAO pode sair por um codigo que circula em ticket.
 */
const RELATORIO_COM_PII = {
  dados: { nome: "Joao da Silva Pereira", nomeMae: "Maria Aparecida Pereira", dataNascimento: "1984-03-11" },
  enderecos: [{ logradouro: "Rua das Acacias", numero: "417", cidade: "Uberaba", cep: "38010120" }],
  telefones: [{ numero: "34999887766" }],
  emails: [{ email: "joao.pereira@exemplo.com.br" }],
  renda: { estimada: 4200 },
  bruto: { QueryId: "9f1c2b40-77aa-4c1e-b8f0-0d4a2e6d1111" },
  creditosCobrados: 1,
};

const linhaIsp = (extra: Record<string, any> = {}) => ({
  tipo: "isp" as const,
  id: 901,
  consultaId: CODIGO,
  cpfCnpj: DOCUMENTO,
  criadaEm: new Date("2026-09-03T14:22:00.000Z"),
  providerId: 42,
  providerName: "Provedor NsLink",
  userId: 7,
  userName: "Ana Operadora",
  cost: 1,
  searchType: "cpf",
  score: 720,
  decisionReco: "Accept",
  veredito: null,
  datasets: null,
  result: { providerDetails: [{ nome: "Joao da Silva Pereira", cep: "38010120" }] },
  ...extra,
});

const linhaSpc = (extra: Record<string, any> = {}) => ({
  tipo: "spc" as const,
  id: 55,
  consultaId: CODIGO,
  cpfCnpj: DOCUMENTO,
  criadaEm: new Date("2026-09-03T14:30:00.000Z"),
  providerId: 42,
  providerName: "Provedor NsLink",
  userId: 7,
  userName: "Ana Operadora",
  cost: null,
  searchType: null,
  score: 812,
  decisionReco: null,
  veredito: null,
  datasets: null,
  result: { protocolo: "SPC-2026-0009123", creditosCobrados: 3, restrictions: [{ credor: "Loja X" }] },
  ...extra,
});

const linhaCadastral = (extra: Record<string, any> = {}) => ({
  tipo: "cadastral" as const,
  id: 310,
  consultaId: CODIGO,
  cpfCnpj: DOCUMENTO,
  criadaEm: new Date("2026-09-03T14:40:00.000Z"),
  providerId: 42,
  providerName: "Provedor NsLink",
  userId: 7,
  userName: "Ana Operadora",
  cost: null,
  searchType: null,
  score: null,
  decisionReco: null,
  veredito: "ATENCAO",
  datasets: ["basic_data", "phones", "addresses"],
  result: RELATORIO_COM_PII,
  ...extra,
});

const buscar = (codigo: string) =>
  fetch(`${base}/api/admin/consultas/${encodeURIComponent(codigo)}`);

describe("GET /api/admin/consultas/:consultaId — o codigo acha a consulta", () => {
  it("acha a consulta ISP e devolve o desfecho dela", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaIsp()]);

    const res = await buscar(CODIGO);
    const ficha = await res.json();

    expect(res.status).toBe(200);
    expect(storageMock.buscarConsultasPorCodigo).toHaveBeenCalledWith(CODIGO);
    expect(ficha.tipo).toBe("isp");
    expect(ficha.consultaId).toBe(CODIGO);
    expect(ficha.linhaId).toBe(901);
    expect(ficha.provedor).toEqual({ id: 42, nome: "Provedor NsLink" });
    expect(ficha.usuario).toEqual({ id: 7, nome: "Ana Operadora" });
    expect(ficha.desfecho.score).toBe(720);
    expect(ficha.desfecho.decisao).toBe("Accept");
    expect(ficha.desfecho.tipoDeBusca).toBe("cpf");
    // A ISP nasce aqui dentro; nao ha bureau a quem escalar.
    expect(ficha.protocoloDaOrigem).toBeNull();
    expect(ficha.custoCreditos).toBe(1);
    expect(ficha.custoOrigem).toBe("gravado");
  });

  it("acha a consulta SPC e leva o protocolo do bureau, que e a quem se escala", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaSpc()]);

    const ficha = await (await buscar(CODIGO)).json();

    expect(ficha.tipo).toBe("spc");
    expect(ficha.desfecho.score).toBe(812);
    expect(ficha.protocoloDaOrigem).toEqual({ origem: "SPC Brasil", protocolo: "SPC-2026-0009123" });
    expect(ficha.custoCreditos).toBe(3);
    expect(ficha.custoOrigem).toBe("gravado");
  });

  it("acha a consulta cadastral e leva o QueryId da BigDataCorp", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaCadastral()]);

    const ficha = await (await buscar(CODIGO)).json();

    expect(ficha.tipo).toBe("cadastral");
    expect(ficha.desfecho.veredito).toBe("ATENCAO");
    expect(ficha.desfecho.datasets).toEqual(["basic_data", "phones", "addresses"]);
    expect(ficha.protocoloDaOrigem).toEqual({
      origem: "BigDataCorp",
      protocolo: "9f1c2b40-77aa-4c1e-b8f0-0d4a2e6d1111",
    });
  });

  /**
   * Linha anterior a este trabalho nao tem custo gravado em lugar nenhum. Ela
   * ganha o preco de tabela, e a ficha DIZ que ganhou: o SPC ja custou 4
   * creditos, e devolver "3" como se fosse gravado induziria estorno errado.
   */
  it("sem custo gravado, cai na tabela de precos e admite que caiu", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([
      linhaSpc({ result: { protocolo: "SPC-2026-0009123" } }),
    ]);

    const ficha = await (await buscar(CODIGO)).json();

    expect(ficha.custoCreditos).toBe(3);
    expect(ficha.custoOrigem).toBe("tabela");
  });
});

describe("o codigo colado torto", () => {
  // Quem atende cola do WhatsApp, do e-mail ou digita ouvindo por telefone.
  const tortos = [
    ["minusculo", "ci-2609-k7f3m2"],
    ["sem traco", "CI2609K7F3M2"],
    ["sem traco e minusculo", "ci2609k7f3m2"],
    ["com espaco no lugar do traco", "CI 2609 K7F3M2"],
    ["com espaco sobrando nas pontas", "  CI-2609-K7F3M2  "],
  ] as const;

  for (const [comoVeio, texto] of tortos) {
    it(`${comoVeio} acha a mesma consulta`, async () => {
      storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaIsp()]);

      const res = await buscar(texto);
      const ficha = await res.json();

      expect(res.status).toBe(200);
      // O banco e procurado pelo codigo canonico, nao pelo que foi digitado.
      expect(storageMock.buscarConsultasPorCodigo).toHaveBeenCalledWith(CODIGO);
      expect(ficha.linhaId).toBe(901);
    });
  }
});

describe("o que a rota recusa", () => {
  it("codigo fora do formato: 400 sem encostar no banco", async () => {
    const res = await buscar("nao-e-codigo");

    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("CI-AAMM-XXXXXX");
    expect(storageMock.buscarConsultasPorCodigo).not.toHaveBeenCalled();
  });

  /**
   * `0`, `1`, `I`, `O` e `U` estao fora do alfabeto. Trocar por parecido seria
   * adivinhar; o certo e dizer que o codigo esta errado.
   */
  it("codigo com caractere que o alfabeto nao tem: 400", async () => {
    const res = await buscar("CI-2609-K7F3MO");

    expect(res.status).toBe(400);
    expect(storageMock.buscarConsultasPorCodigo).not.toHaveBeenCalled();
  });

  it("codigo valido que nao existe: 404 ensinando onde procurar", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([]);

    const res = await buscar(CODIGO);
    const corpo = await res.json();

    expect(res.status).toBe(404);
    expect(corpo.consultaId).toBe(CODIGO);
    // A parte que ensina: pode ter falhado antes de gravar, e ai so ha o log.
    expect(corpo.message).toContain("falhou antes de gravar");
    expect(corpo.message).toContain("consultaId");
  });

  // Sem esta trava, um admin de provedor le a consulta de um concorrente.
  it("admin de provedor nao passa: 403, e o banco nem e consultado", async () => {
    sessao = { userId: 9, providerId: 42, role: "admin" };

    const res = await buscar(CODIGO);

    expect(res.status).toBe(403);
    expect(storageMock.buscarConsultasPorCodigo).not.toHaveBeenCalled();
  });

  it("usuario comum nao passa: 403", async () => {
    sessao = { userId: 9, providerId: 42, role: "user" };

    expect((await buscar(CODIGO)).status).toBe(403);
  });

  it("erro inesperado vira 500 que ainda carrega o codigo", async () => {
    storageMock.buscarConsultasPorCodigo.mockRejectedValue(new Error("banco fora do ar"));

    const res = await buscar(CODIGO);

    expect(res.status).toBe(500);
    expect((await res.json()).consultaId).toBe(CODIGO);
  });
});

describe("LGPD — o codigo nao e chave de leitura do relatorio", () => {
  it("a consulta cadastral sai sem uma linha do relatorio", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaCadastral()]);

    const res = await buscar(CODIGO);
    const texto = await res.text();
    const ficha = JSON.parse(texto);

    // Nem o campo, nem o conteudo dele por outro caminho.
    expect(ficha).not.toHaveProperty("result");
    for (const vazado of [
      "Joao da Silva Pereira", "Maria Aparecida Pereira", "1984-03-11",
      "Rua das Acacias", "38010120", "34999887766", "joao.pereira@exemplo.com.br",
    ]) {
      expect(texto, vazado).not.toContain(vazado);
    }
  });

  it("a consulta ISP sai sem o historico da rede", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaIsp()]);

    const texto = await (await buscar(CODIGO)).text();

    expect(texto).not.toContain("providerDetails");
    expect(texto).not.toContain("Joao da Silva Pereira");
  });

  it("a consulta SPC sai sem as restricoes", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaSpc()]);

    const texto = await (await buscar(CODIGO)).text();

    expect(texto).not.toContain("restrictions");
    expect(texto).not.toContain("Loja X");
  });

  it("o documento sai mascarado, nunca inteiro", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaIsp()]);

    const res = await buscar(CODIGO);
    const texto = await res.text();
    const ficha = JSON.parse(texto);

    expect(ficha.documento).toBe("123.***.***-**");
    expect(texto).not.toContain(DOCUMENTO);
  });

  it("CNPJ tambem sai mascarado", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([
      linhaIsp({ cpfCnpj: "12345678000199" }),
    ]);

    const ficha = await (await buscar(CODIGO)).json();

    expect(ficha.documento).toBe("12.***.***/0001-**");
  });
});

describe("o log de cada ramo de saida", () => {
  const linhasDeLog = (espiao: { mock: { calls: any[][] } }) =>
    espiao.mock.calls.map(c => ({ contexto: c[0], mensagem: c[1] }));

  it("achou: log com o codigo, o tipo, a linha e de quem era a consulta", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaIsp()]);

    await buscar(CODIGO);

    const linha = linhasDeLog(loggerMock.info).find(l => l.mensagem === "consulta localizada pelo codigo");
    expect(linha).toBeDefined();
    expect(linha!.contexto).toMatchObject({
      consultaId: CODIGO, tipo: "isp", linhaId: 901, providerId: 42, superadminUserId: 1,
    });
  });

  it("nao achou: log com o codigo — e o unico rastro que sobra do chamado", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([]);

    await buscar(CODIGO);

    const linha = linhasDeLog(loggerMock.info).find(l => l.mensagem === "busca de consulta sem resultado");
    expect(linha).toBeDefined();
    expect(linha!.contexto).toMatchObject({ consultaId: CODIGO });
  });

  /**
   * O engano mais provavel de quem atende e colar na caixa o CPF que o
   * provedor acabou de ditar. Se o texto digitado fosse para o log, a busca
   * que existe para tirar CPF do log seria a porta que o poe la.
   */
  it("codigo invalido: o texto digitado NAO vai para o log", async () => {
    await buscar("12345678909");

    const linha = linhasDeLog(loggerMock.warn).find(l => l.mensagem?.includes("fora do formato"));
    expect(linha).toBeDefined();
    expect(JSON.stringify(linha!.contexto)).not.toContain("12345678909");
    expect(linha!.contexto).toMatchObject({ tamanhoDigitado: 11 });
  });

  it("erro inesperado: log de erro com o codigo", async () => {
    storageMock.buscarConsultasPorCodigo.mockRejectedValue(new Error("banco fora do ar"));

    await buscar(CODIGO);

    const linha = linhasDeLog(loggerMock.error).find(l => l.mensagem?.includes("erro ao buscar consulta"));
    expect(linha!.contexto).toMatchObject({ consultaId: CODIGO });
  });

  /**
   * O indice unico e por tabela: duas tabelas com o mesmo codigo e defeito, e
   * defeito silencioso e o pior tipo. A ficha sai mesmo assim — quem atende
   * tem um chamado aberto na mao.
   */
  it("codigo repetido em duas tabelas: erro no log e a primeira na resposta", async () => {
    storageMock.buscarConsultasPorCodigo.mockResolvedValue([linhaIsp(), linhaSpc()]);

    const res = await buscar(CODIGO);
    const ficha = await res.json();

    expect(res.status).toBe(200);
    expect(ficha.tipo).toBe("isp");
    const linha = linhasDeLog(loggerMock.error).find(l => l.mensagem?.includes("repetido em mais de uma tabela"));
    expect(linha).toBeDefined();
    expect(linha!.contexto).toMatchObject({ consultaId: CODIGO, tipos: ["isp", "spc"], linhas: [901, 55] });
  });
});
