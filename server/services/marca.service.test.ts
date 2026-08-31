/**
 * A regra de pertencimento host<->tenant e a peca de seguranca do white label.
 *
 * Antes, a unica prova era "o primeiro rotulo do host bate com o subdominio do
 * provedor", e ela era fail-OPEN: quando nao dava para extrair rotulo nenhum, a
 * checagem inteira era pulada e qualquer usuario de qualquer provedor entrava.
 * Dominio proprio produz exatamente esse caso o tempo todo, entao a tentacao
 * era afrouxar a regra — e afrouxar aqui e cross-tenant.
 *
 * O teste que da nome ao arquivo e "provedor da marca A no dominio da marca B".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getMarcaPorSubdominio = vi.fn();
const getMarcaPorDominio = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getMarcaPorSubdominio: (s: string) => getMarcaPorSubdominio(s),
    getMarcaPorDominio: (h: string) => getMarcaPorDominio(h),
  },
}));

import { hostPertenceAoProvider, resolverMarcaPorHost, esquecerMarcas } from "./marca.service";

/** Uma marca como o banco devolve, com o minimo que o resolvedor le. */
const marca = (id: number, nome: string, dominio: string | null) => ({
  id, ativo: true, nomeProduto: nome, assinatura: null,
  dominio, dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#1F6F7A", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: null,
  suporteEmail: null, suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null,
  slug: nome.toLowerCase(), createdAt: new Date(),
});

const CREDNET = marca(7, "CredNet", "app.crednet.com.br");
const RIVAL = marca(9, "Rival", "portal.rival.com.br");

const ambienteOriginal = process.env.NODE_ENV;

beforeEach(() => {
  esquecerMarcas();
  getMarcaPorSubdominio.mockReset();
  getMarcaPorDominio.mockReset();
  getMarcaPorSubdominio.mockResolvedValue(undefined);
  getMarcaPorDominio.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.NODE_ENV = ambienteOriginal;
  esquecerMarcas();
});

/** Liga o mundo: quem responde por cada dominio e por cada subdominio. */
function mundo(porDominio: Record<string, any>, porSubdominio: Record<string, any> = {}) {
  getMarcaPorDominio.mockImplementation(async (h: string) => porDominio[h]);
  getMarcaPorSubdominio.mockImplementation(async (s: string) => porSubdominio[s]);
}

describe("provedor que so tem subdominio", () => {
  const nslink = { subdomain: "nslink", marcaId: null };

  it("entra pelo proprio subdominio", async () => {
    expect(await hostPertenceAoProvider("nslink.consultaisp.com.br", nslink)).toBe(true);
  });

  it("NAO entra pelo subdominio de outro provedor", async () => {
    expect(await hostPertenceAoProvider("outro.consultaisp.com.br", nslink)).toBe(false);
  });

  it("NAO entra pelo dominio raiz da plataforma", async () => {
    // Preserva o comportamento de hoje: provedor loga no endereco dele.
    expect(await hostPertenceAoProvider("consultaisp.com.br", nslink)).toBe(false);
    expect(await hostPertenceAoProvider("www.consultaisp.com.br", nslink)).toBe(false);
  });

  it("NAO entra pelo dominio de uma marca", async () => {
    mundo({ "app.crednet.com.br": CREDNET });
    expect(await hostPertenceAoProvider("app.crednet.com.br", nslink)).toBe(false);
  });

  it("host que so TERMINA parecido nao serve de prova", async () => {
    expect(await hostPertenceAoProvider("nslink.evilconsultaisp.com.br", nslink)).toBe(false);
    expect(await hostPertenceAoProvider("nslink.evil.com", nslink)).toBe(false);
  });
});

describe("provedor vinculado a uma marca", () => {
  const daCredNet = { subdomain: "cliente1", marcaId: 7 };

  it("entra pelo dominio da marca dele", async () => {
    mundo({ "app.crednet.com.br": CREDNET });
    expect(await hostPertenceAoProvider("app.crednet.com.br", daCredNet)).toBe(true);
  });

  it("NAO entra pelo dominio de OUTRA marca", async () => {
    // O caso que da nome ao arquivo: revendedores concorrentes na mesma base.
    mundo({ "app.crednet.com.br": CREDNET, "portal.rival.com.br": RIVAL });
    expect(await hostPertenceAoProvider("portal.rival.com.br", daCredNet)).toBe(false);
  });

  it("continua entrando pelo subdominio da plataforma", async () => {
    // Ter marca nao tira o subdominio: os dois enderecos valem.
    expect(await hostPertenceAoProvider("cliente1.consultaisp.com.br", daCredNet)).toBe(true);
  });

  it("marca desativada deixa de ser prova", async () => {
    mundo({ "app.crednet.com.br": { ...CREDNET, ativo: false } });
    expect(await hostPertenceAoProvider("app.crednet.com.br", daCredNet)).toBe(false);
  });
});

describe("falha FECHADA", () => {
  it("provedor sem subdominio e sem marca nao entra em lugar nenhum", async () => {
    const orfao = { subdomain: null, marcaId: null };
    mundo({ "app.crednet.com.br": CREDNET });
    for (const h of ["consultaisp.com.br", "x.consultaisp.com.br", "app.crednet.com.br", "qualquer.com"]) {
      expect(await hostPertenceAoProvider(h, orfao), `host ${h}`).toBe(false);
    }
  });

  it("host desconhecido recusa em vez de dispensar a checagem", async () => {
    expect(await hostPertenceAoProvider("dominio-solto.com", { subdomain: "nslink", marcaId: null })).toBe(false);
  });

  it("host vazio recusa", async () => {
    expect(await hostPertenceAoProvider("", { subdomain: "nslink", marcaId: null })).toBe(false);
    expect(await hostPertenceAoProvider(undefined, { subdomain: "nslink", marcaId: null })).toBe(false);
  });
});

describe("excecao de desenvolvimento", () => {
  it("localhost passa fora de producao — senao ninguem loga na maquina local", async () => {
    process.env.NODE_ENV = "development";
    expect(await hostPertenceAoProvider("localhost", { subdomain: "nslink", marcaId: null })).toBe(true);
    expect(await hostPertenceAoProvider("localhost:5000", { subdomain: null, marcaId: null })).toBe(true);
  });

  it("em PRODUCAO localhost nao passa", async () => {
    process.env.NODE_ENV = "production";
    expect(await hostPertenceAoProvider("localhost", { subdomain: "nslink", marcaId: null })).toBe(false);
    expect(await hostPertenceAoProvider("127.0.0.1", { subdomain: "nslink", marcaId: null })).toBe(false);
  });
});

describe("resolucao de marca pelo host", () => {
  it("dominio raiz e www sao a plataforma, e a tela e a landing", async () => {
    for (const h of ["consultaisp.com.br", "www.consultaisp.com.br"]) {
      const m = await resolverMarcaPorHost(h);
      expect(m.origem, `host ${h}`).toBe("plataforma");
      expect(m.contexto).toBe("plataforma");
      expect(m.marcaId).toBeNull();
    }
  });

  it("dominio proprio traz a marca do revendedor e contexto de tenant", async () => {
    mundo({ "app.crednet.com.br": CREDNET });
    const m = await resolverMarcaPorHost("app.crednet.com.br");
    expect(m.origem).toBe("dominio-proprio");
    expect(m.contexto).toBe("tenant");
    expect(m.nomeProduto).toBe("CredNet");
    expect(m.cores).not.toBeNull();
  });

  it("subdominio de provedor SEM marca e tenant com a cara da plataforma", async () => {
    // Importa para o App.tsx: sem o contexto, o cliente cairia na landing.
    const m = await resolverMarcaPorHost("nslink.consultaisp.com.br");
    expect(m.contexto).toBe("tenant");
    expect(m.nomeProduto).toBe("Consulta ISP");
    expect(m.cores).toBeNull();
  });

  it("host desconhecido cai na plataforma em vez de estourar", async () => {
    const m = await resolverMarcaPorHost("dominio-que-alguem-apontou.com");
    expect(m.origem).toBe("plataforma");
  });

  it("normaliza antes de comparar — maiuscula e porta nao trocam a marca", async () => {
    mundo({ "app.crednet.com.br": CREDNET });
    for (const h of ["APP.CredNet.com.BR", "app.crednet.com.br:443", "app.crednet.com.br."]) {
      expect((await resolverMarcaPorHost(h)).marcaId, `host ${h}`).toBe(7);
    }
  });

  it("banco fora do ar nao derruba a pagina — cai na plataforma", async () => {
    getMarcaPorDominio.mockRejectedValue(new Error("conexao recusada"));
    const m = await resolverMarcaPorHost("app.crednet.com.br");
    expect(m.origem).toBe("plataforma");
  });

  it("o cache nao mistura hosts", async () => {
    mundo({ "app.crednet.com.br": CREDNET, "portal.rival.com.br": RIVAL });
    expect((await resolverMarcaPorHost("app.crednet.com.br")).marcaId).toBe(7);
    expect((await resolverMarcaPorHost("portal.rival.com.br")).marcaId).toBe(9);
    expect((await resolverMarcaPorHost("app.crednet.com.br")).marcaId).toBe(7);
  });
});

/**
 * O cache e chaveado pelo HOST, que o cliente controla. Um Map de modulo sem
 * teto e memoria que cresce enquanto alguem inventar hosts — o pm2 reinicia a
 * API ao bater max_memory_restart. Achado numa revisao adversarial.
 */
describe("cache nao pode crescer sem limite", () => {
  it("host que nao e hostname valido nem consulta o banco", async () => {
    mundo({ "app.crednet.com.br": CREDNET });
    for (const lixo of ["a".repeat(300), "com espaco", "tem_underscore", "-comeca-com-hifen", "x".repeat(64) + ".com"]) {
      const m = await resolverMarcaPorHost(lixo);
      expect(m.origem, `host ${lixo.slice(0, 20)}`).toBe("plataforma");
    }
    expect(getMarcaPorDominio).not.toHaveBeenCalled();
  });

  it("mantem a marca certa mesmo depois de muitos hosts desconhecidos", async () => {
    mundo({ "app.crednet.com.br": CREDNET });
    expect((await resolverMarcaPorHost("app.crednet.com.br")).marcaId).toBe(7);

    // Enche o cache muito alem do teto; o descarte FIFO pode expulsar a CredNet,
    // mas ela tem de voltar correta na proxima consulta.
    for (let i = 0; i < 700; i++) await resolverMarcaPorHost(`h${i}.desconhecido.com`);

    expect((await resolverMarcaPorHost("app.crednet.com.br")).marcaId).toBe(7);
    expect((await resolverMarcaPorHost("h1.desconhecido.com")).origem).toBe("plataforma");
  });
});
