import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: PATCH /api/provider/profile — a regua do cadastro que o PROVEDOR edita.
 *
 * Ate 05/09/2026 esta rota copiava dezesseis campos do corpo direto para o
 * `db.update().set()`. E dela que saiu, medido em producao, o cadastro do
 * provedor 4: `opening_date` com "17/05/2017" numa coluna que o resto do
 * sistema le como ISO, `legal_type` com "206-2 - Sociedade Empresaria Limitada"
 * num campo de sete opcoes, UF por extenso num campo de dois caracteres,
 * e-mail de contato com dois enderecos separados por virgula e CNPJ mascarado
 * numa coluna UNIQUE comparada por igualdade exata de string.
 *
 * O que se prova aqui, e que decide o desenho inteiro: **a regua julga so o que
 * MUDOU**. A tela reenvia os dezesseis campos a cada Salvar, com o conteudo que
 * ela mesma leu do banco; uma validacao que julgasse o cadastro inteiro
 * trancaria justamente o provedor 4 fora do proprio cadastro — ele nao
 * conseguiria corrigir o telefone sem antes arrumar dois campos que nao sabe
 * que estao errados. Por isso quase todo teste daqui manda a FICHA INTEIRA, como
 * a tela manda, e nao so o campo em questao.
 *
 * `requireProvider` e `exigirAdminDoProvedor` entram como os REAIS: quem pode
 * mexer no cadastro da empresa e parte do que a rota promete.
 */
const storageMock = vi.hoisted(() => ({
  // O requireProvider REAL le o status do provedor; o handler le a linha
  // anterior para saber o que mudou. Os dois passam por aqui.
  getProvider: vi.fn(async (): Promise<any> => null),
  updateProviderProfile: vi.fn(async (_id: number, dados: any): Promise<any> => ({ id: _id, ...dados })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/**
 * Importar `../auth` cobra dois pedagios, e nenhum tem a ver com o que se testa:
 * ele exige SESSION_SECRET no topo e monta a sessao sobre o pool do Postgres.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real";
});
vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) },
  db: {},
}));
vi.mock("../auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../auth")>();
  return {
    ...real,
    // O requireAuth real depende de prova de host e de sessao completa, que
    // este arquivo nao esta testando.
    requireAuth: (req: any, res: any, next: any) => {
      if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
      next();
    },
  };
});

vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({ sendUsuarioAdicionadoEmail: vi.fn(async () => undefined) }));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null })),
  urlDeEntrada: vi.fn(() => "https://consultaisp.example"),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { esquecerStatusDeProvedor } from "../auth";
import { registerProviderRoutes } from "./provider.routes";

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
  app.use(registerProviderRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

/**
 * A linha do provedor 4, com TODAS as doencas que esta rota gravou: CNPJ
 * mascarado, data em formato brasileiro, natureza juridica com o codigo do
 * IBGE, UF por extenso, e-mail com dois enderecos e CEP mascarado.
 *
 * Ela e o fixture padrao de proposito: se a regua trancasse alguem, seria ele.
 */
const PROVEDOR_LEGADO = {
  id: 4,
  status: "active",
  name: "Amplinet Telecom Ltda",
  tradeName: "Amplinet",
  cnpj: "23.864.873/0001-48",
  legalType: "206-2 - Sociedade Empresaria Limitada",
  openingDate: "17/05/2017",
  businessSegment: "ISP / Provedor de Internet",
  contactEmail: "financeiro@amplinet.com.br, suporte@amplinet.com.br",
  contactPhone: "3799990000",
  website: "www.amplinet.com.br",
  addressZip: "35500-000",
  addressStreet: "Rua das Palmeiras",
  addressNumber: "120",
  addressComplement: null,
  addressNeighborhood: "Centro",
  addressCity: "Divinopolis",
  addressState: "Minas Gerais",
};

/** Uma linha limpa, para o que nao tem a ver com cadastro legado. */
const PROVEDOR_EM_ORDEM = {
  id: 4,
  status: "active",
  name: "NsLink Telecom Ltda",
  tradeName: "NsLink",
  cnpj: "12345678000199",
  legalType: "LTDA",
  openingDate: "2014-03-21",
  businessSegment: "ISP / Provedor de Internet",
  contactEmail: "contato@nslink.com.br",
  contactPhone: "37999990000",
  website: "https://nslink.com.br",
  addressZip: "35500000",
  addressStreet: "Rua das Palmeiras",
  addressNumber: "120",
  addressComplement: "Sala 3",
  addressNeighborhood: "Centro",
  addressCity: "Divinopolis",
  addressState: "MG",
};

const CAMPOS_DA_TELA = [
  "name", "tradeName", "cnpj", "legalType", "openingDate", "businessSegment",
  "contactEmail", "contactPhone", "website",
  "addressZip", "addressStreet", "addressNumber", "addressComplement",
  "addressNeighborhood", "addressCity", "addressState",
] as const;

/**
 * O corpo EXATO que a tela monta: `provider.campo || ""` para os dezesseis, com
 * o que o provedor digitou por cima (`getEmpresa()` em painel-provedor.tsx).
 *
 * Testar com este corpo, e nao com o campo isolado, e o que faz estes testes
 * valerem: e assim que a rota e chamada de verdade.
 */
const fichaDaTela = (provedor: Record<string, any>, editado: Record<string, any> = {}) => {
  const corpo: Record<string, any> = {};
  for (const campo of CAMPOS_DA_TELA) corpo[campo] = provedor[campo] || "";
  return { ...corpo, ...editado };
};

const salvar = (corpo: Record<string, any>) =>
  fetch(`${base}/api/provider/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

/** O objeto que chegaria ao banco — o unico lugar onde se ve o que seria gravado. */
const gravado = () => storageMock.updateProviderProfile.mock.calls[0][1] as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` limpa as chamadas, nao a implementacao: sem estas linhas um
  // `mockResolvedValue` de um teste vazaria para os seguintes.
  storageMock.getProvider.mockResolvedValue(PROVEDOR_LEGADO);
  storageMock.updateProviderProfile.mockImplementation(async (id: number, dados: any) => ({ id, ...dados }));
  // O status do provedor e cacheado por 30s dentro do requireProvider real.
  esquecerStatusDeProvedor(4);
  sessao = { userId: 1, providerId: 4, role: "admin" };
});

/**
 * O defeito de hoje, preso: cadastro legado nao pode trancar quem o tem.
 */
describe("PATCH /api/provider/profile — o cadastro legado nao tranca a rota", () => {
  it("corrige o telefone de um cadastro com data, natureza e UF legadas", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { contactPhone: "37988887777" }));

    expect(res.status).toBe(200);
    // So o telefone: os outros quinze chegaram iguais ao gravado e nao sao
    // alteracao nenhuma — nem para julgar, nem para gravar.
    expect(gravado()).toEqual({ contactPhone: "37988887777" });
  });

  it("a data legada so e julgada quando o provedor a troca", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { openingDate: "18/05/2017" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.openingDate?.[0]).toMatch(/AAAA-MM-DD/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("corrigir a data legada para ISO grava so ela", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { openingDate: "2017-05-17" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ openingDate: "2017-05-17" });
  });

  it("data que casa com o formato mas nao existe no calendario e recusada", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { openingDate: "2017-02-31" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.openingDate?.[0]).toMatch(/não existe no calendário/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("a natureza juridica com codigo do IBGE passa como eco, e nao volta a entrar", async () => {
    const eco = await salvar(fichaDaTela(PROVEDOR_LEGADO));
    expect(eco.status).toBe(200);

    const troca = await salvar(fichaDaTela(PROVEDOR_LEGADO, { legalType: "213-5 - Empresario Individual" }));
    const corpo = await troca.json();

    expect(troca.status).toBe(400);
    expect(corpo.errors.legalType?.[0]).toMatch(/LTDA/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("trocar a natureza juridica por uma das sete opcoes grava", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { legalType: "LTDA" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ legalType: "LTDA" });
  });

  it("a UF por extenso gravada nao reprova o Salvar", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressNumber: "121" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressNumber: "121" });
  });

  it("trocar a UF por outro nome por extenso e recusado, dizendo o que vale", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressState: "Sao Paulo" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.addressState?.[0]).toMatch(/sigla de dois caracteres/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("o e-mail de contato com dois enderecos nao tranca a correcao do endereco", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: "Formiga" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressCity: "Formiga" });
  });

  it("uma recusa segura o formulario inteiro: nada de gravacao parcial", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, {
      addressCity: "Formiga",
      addressState: "Sao Paulo",
    }));

    expect(res.status).toBe(400);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("espaco em volta do valor gravado nao conta como alteracao", async () => {
    storageMock.getProvider.mockResolvedValue({ ...PROVEDOR_LEGADO, addressCity: "  Divinopolis  " });

    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: "Divinopolis" }));

    expect(res.status).toBe(200);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});

/**
 * DECISAO (a), nos dois sentidos: o CNPJ sai do que o provedor altera, mas o
 * eco do que ja esta gravado tem de passar — senao a tela, que reenvia o campo
 * `readOnly` a cada Salvar, trancaria o cadastro inteiro.
 */
describe("PATCH /api/provider/profile — o CNPJ", () => {
  it("o eco do CNPJ mascarado passa, e o campo nao chega ao banco", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { contactPhone: "37988887777" }));

    expect(res.status).toBe(200);
    expect(gravado()).not.toHaveProperty("cnpj");
  });

  it("o mesmo documento sem mascara tambem e eco, e nao vira gravacao", async () => {
    // "23864873000148" e "23.864.873/0001-48" sao a mesma inscricao: a
    // comparacao e por digitos, senao a linha mascarada de producao viraria
    // 403 para quem so quer salvar o telefone.
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, {
      cnpj: "23864873000148",
      contactPhone: "37988887777",
    }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactPhone: "37988887777" });
  });

  it("outro CNPJ e recusado com 403 e manda falar com o suporte", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { cnpj: "12345678000199" }));
    const corpo = await res.json();

    // 403 e nao 400: o valor pode ser um CNPJ perfeito; o que falta e permissao
    // para mexer NESTE campo.
    expect(res.status).toBe(403);
    expect(corpo.message).toMatch(/suporte/i);
    expect(corpo.errors.cnpj?.[0]).toMatch(/suporte/i);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("apagar o CNPJ tambem e recusado", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { cnpj: "" }));

    expect(res.status).toBe(403);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("o CNPJ trocado barra o Salvar inteiro, mesmo com o resto valido", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, {
      cnpj: "12345678000199",
      addressCity: "Formiga",
    }));

    expect(res.status).toBe(403);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("a tentativa fica no log, com o documento truncado", async () => {
    await salvar(fichaDaTela(PROVEDOR_LEGADO, { cnpj: "12345678000199" }));

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 4, cnpj: "1234***" }),
      expect.stringContaining("CNPJ"),
    );
  });

  it("provedor sem CNPJ nenhum: o campo vazio da tela e eco, e nao 403", async () => {
    storageMock.getProvider.mockResolvedValue({ ...PROVEDOR_LEGADO, cnpj: null });

    const res = await salvar(fichaDaTela({ ...PROVEDOR_LEGADO, cnpj: null }, { contactPhone: "37988887777" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactPhone: "37988887777" });
  });
});

describe('PATCH /api/provider/profile — "" vira null', () => {
  it('apagar o complemento grava null, e nao ""', async () => {
    storageMock.getProvider.mockResolvedValue(PROVEDOR_EM_ORDEM);

    const res = await salvar(fichaDaTela(PROVEDOR_EM_ORDEM, { addressComplement: "" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressComplement: null });
  });

  it('"" onde a coluna ja e null nao e alteracao', async () => {
    // A tela manda `provider.addressComplement || ""` — um provedor sem
    // complemento manda "" toda vez. Sem esta equivalencia, todo Salvar
    // regravaria a coluna com uma forma diferente do vazio.
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO));

    expect(res.status).toBe(200);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("so espaco tambem vira null, e o texto util e aparado", async () => {
    storageMock.getProvider.mockResolvedValue(PROVEDOR_EM_ORDEM);

    const res = await salvar(fichaDaTela(PROVEDOR_EM_ORDEM, {
      addressComplement: "   ",
      addressCity: "  Formiga  ",
    }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressComplement: null, addressCity: "Formiga" });
  });

  it("apagar a razao social e recusado: ela e o nome do tenant", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { name: "" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.name?.[0]).toMatch(/razão social/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});

/**
 * O que a regua canoniza, canoniza so no valor que o provedor esta digitando
 * agora. Consertar de passagem o valor antigo seria reescrever em silencio o
 * dado de outra pessoa.
 */
describe("PATCH /api/provider/profile — forma canonica do que foi digitado", () => {
  it("CEP digitado com mascara vira 8 digitos", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressZip: "35.501-000" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressZip: "35501000" });
  });

  it("CEP incompleto e recusado", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressZip: "35500" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.addressZip?.[0]).toMatch(/8 dígitos/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("o CEP mascarado que ja esta gravado nao e reescrito por um Salvar", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressNumber: "121" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressNumber: "121" });
  });

  it("UF em minuscula vira sigla maiuscula", async () => {
    storageMock.getProvider.mockResolvedValue(PROVEDOR_EM_ORDEM);

    const res = await salvar(fichaDaTela(PROVEDOR_EM_ORDEM, { addressState: "sp" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ addressState: "SP" });
  });

  it("UF que so muda de caixa nao vira gravacao", async () => {
    storageMock.getProvider.mockResolvedValue(PROVEDOR_EM_ORDEM);

    const res = await salvar(fichaDaTela(PROVEDOR_EM_ORDEM, { addressState: "mg" }));

    expect(res.status).toBe(200);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/provider/profile — e-mail de contato e site", () => {
  it("e-mail novo invalido e recusado, em portugues e nomeando o campo", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { contactEmail: "financeiro@amplinet.com.br; suporte@amplinet.com.br" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.contactEmail?.[0]).toMatch(/e-mail de contato/i);
    // O painel imprime so `message` no toast: a frase precisa estar la tambem.
    expect(corpo.message).toMatch(/e-mail de contato/i);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("e-mail novo e valido e gravado", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { contactEmail: "financeiro@amplinet.com.br" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactEmail: "financeiro@amplinet.com.br" });
  });

  it("apagar o e-mail de contato continua valendo", async () => {
    // Sem contato, `destinatariosDoProvedor` cai nos administradores — o
    // resgate funcionando, e nao um cadastro pela metade.
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { contactEmail: "" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ contactEmail: null });
  });

  it("o site sem esquema, como o provedor digitou, e aceito e nao e reescrito", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { website: "www.amplinet.net.br" }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ website: "www.amplinet.net.br" });
  });

  it("site com esquema que nao e http/https e recusado", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { website: "javascript:alert(1)" }));

    expect(res.status).toBe(400);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  /**
   * O regex de esquema incluia o ponto na classe do nome (`[a-z0-9+.-]*`),
   * entao ele lia "meuisp.net.br" como esquema e, como o valor nao comeca com
   * http://, RECUSAVA um endereco com porta. E o formulario e tudo-ou-nada: o
   * provedor perdia o Salvar dos outros quinze campos junto.
   */
  it("site com porta e aceito, e o resto do formulario e salvo junto", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, {
      website: "meuisp.net.br:8080",
      contactPhone: "37988887777",
    }));

    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ website: "meuisp.net.br:8080", contactPhone: "37988887777" });
  });

  it("limite estourado diz o campo, o limite e em portugues", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { tradeName: "N".repeat(201) }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.tradeName?.[0]).toBe("O nome fantasia deve ter no máximo 200 caracteres.");
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/provider/profile — o que nao chega ao banco", () => {
  it("chave que nao e coluna e recusada, em vez de descartada em silencio", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { ispCredits: 5000 }));

    expect(res.status).toBe(400);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  /**
   * A recusa do `.strict()` e um `unrecognized_keys`, que nao pertence a campo
   * nenhum: o zod a poe em `formErrors`, e a resposta so mandava `fieldErrors`.
   * Medido: este mesmo PATCH respondia {"message":"Dados invalidos","errors":{}}
   * — 400 sem uma palavra sobre o que estava errado, num painel que imprime so
   * `message` num toast.
   */
  it("a chave recusada e NOMEADA na resposta, em portugues", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { ispCredits: 5000 }));
    const corpo = await res.json();

    expect(corpo.message).toContain("ispCredits");
    expect(corpo.message).not.toMatch(/Unrecognized key/);
    expect(corpo.formErrors).toEqual([expect.stringContaining("ispCredits")]);
  });

  it("mais de uma chave desconhecida: todas sao nomeadas", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { ispCredits: 5000, plan: "enterprise" }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.message).toContain("ispCredits");
    expect(corpo.message).toContain("plan");
  });

  // Sem chave estranha, `formErrors` fica vazio e o campo continua sendo
  // apontado por `errors` — a novidade nao pode roubar o lugar do erro de campo.
  it("erro de campo continua indo em errors, com formErrors vazio", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: { nome: "Formiga" } }));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.errors.addressCity?.length).toBeGreaterThan(0);
    expect(corpo.formErrors).toEqual([]);
  });

  it("valor que nao e texto e recusado", async () => {
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: { nome: "Formiga" } }));

    expect(res.status).toBe(400);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("corpo vazio nao chega ao storage", async () => {
    // `db.update().set({})` nao e no-op: o Drizzle recusa o SET vazio, o erro
    // cai no catch generico e a tela diz "Erro interno do servidor".
    const res = await salvar({});
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.message).toMatch(/Nenhum campo/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("Salvar sem editar nada devolve 200 e nao escreve", async () => {
    // A tela reenvia os dezesseis campos; nada mudou. 400 aqui pintaria de
    // vermelho um clique que nao tem nada de errado.
    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO));
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.cnpj).toBe(PROVEDOR_LEGADO.cnpj);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("provedor que sumiu do banco da 404 antes de gravar", async () => {
    storageMock.getProvider.mockResolvedValue(undefined);
    // Provedor ausente nao e suspensao para o requireProvider (de proposito:
    // esconder a causa real por tras de "acesso suspenso" seria pior), entao
    // quem recusa e o handler — e sem a linha anterior nao ha o que comparar.
    esquecerStatusDeProvedor(4);

    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: "Formiga" }));

    expect(res.status).toBe(404);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});

/**
 * DECISAO (b): a rota continua exigindo admin do provedor depois da regua.
 */
describe("PATCH /api/provider/profile — quem pode alterar", () => {
  it("operador comum nao altera o cadastro da empresa", async () => {
    sessao = { userId: 1, providerId: 4, role: "user" };

    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: "Formiga" }));
    const corpo = await res.json();

    expect(res.status).toBe(403);
    expect(corpo.message).toMatch(/administradores/);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("sessao sem provedor nao passa do requireProvider", async () => {
    sessao = { userId: 1, providerId: 0, role: "admin" };

    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: "Formiga" }));

    expect(res.status).toBe(403);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("sem sessao nenhuma, 401", async () => {
    sessao = {};

    const res = await salvar(fichaDaTela(PROVEDOR_LEGADO, { addressCity: "Formiga" }));

    expect(res.status).toBe(401);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});
