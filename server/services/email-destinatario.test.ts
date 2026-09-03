/**
 * Para quem, com que marca e por qual endereco — as tres respostas que ja foram
 * dadas erradas.
 *
 * Cada teste aqui existe por um incidente concreto:
 *
 *  · A NsLink esta cadastrada SEM e-mail de contato, e o alerta anti-fraude era
 *    descartado com um aviso no log. Ninguem ficava sabendo. Por isso a queda
 *    para os administradores.
 *  · Um e-mail assinado "Consulta ISP" para quem comprou da "CredNet" entrega o
 *    revendedor. Por isso a marca sai do PROVEDOR, nunca do host da requisicao.
 *  · O botao do e-mail levava para a raiz da plataforma, onde o login e
 *    recusado por desenho. Por isso `urlDeEntrada`.
 *  · E, acima de tudo: aprovar um cadastro, liberar credito e suspender um
 *    provedor sao atos que JA TERMINARAM quando o e-mail sai. Resend fora do ar
 *    nao pode desfazer nenhum deles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUsersByProvider = vi.fn();
const getMarca = vi.fn();
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));

/** Ligado por um teste so: e a unica forma de fazer o contexto falhar inteiro. */
const controle = vi.hoisted(() => ({ urlDeEntradaLanca: false }));

vi.mock("../storage", () => ({
  storage: {
    getUsersByProvider: (id: number) => getUsersByProvider(id),
    getMarca: (id: number) => getMarca(id),
  },
}));

vi.mock("../logger", () => ({ logger: log }));

vi.mock("./marca.service", async (original) => {
  const real = await original<typeof import("./marca.service")>();
  return {
    ...real,
    urlDeEntrada: (p: any, m: any) => {
      if (controle.urlDeEntradaLanca) throw new Error("marca corrompida");
      return real.urlDeEntrada(p, m);
    },
  };
});

import { avisarProvedor, contextoDeEmail, destinatariosDoProvedor } from "./email-destinatario";
import { esquecerMarcas, MARCA_PLATAFORMA } from "./marca.service";

const NSLINK = { id: 3, name: "NsLink Provedor", contactEmail: null, marcaId: null, subdomain: "nslink" };

const usuario = (email: string, role: string) => ({ id: 1, email, role, providerId: 3 });

const marcaCredNet = {
  id: 7, ativo: true, nomeProduto: "CredNet Bureau", assinatura: null,
  dominio: "app.crednet.com.br", dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#1F6F7A", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: null,
  suporteEmail: "suporte@crednet.com.br", suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null,
  slug: "crednet", createdAt: new Date(),
};

beforeEach(() => {
  esquecerMarcas();
  controle.urlDeEntradaLanca = false;
  getUsersByProvider.mockReset();
  getMarca.mockReset();
  log.warn.mockReset();
  log.error.mockReset();
  getUsersByProvider.mockResolvedValue([]);
  getMarca.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Para quem
// ─────────────────────────────────────────────────────────────────────────────

describe("destinatariosDoProvedor", () => {
  it("o contato do provedor tem prioridade, e nem chega a olhar os usuarios", async () => {
    const para = await destinatariosDoProvedor({ ...NSLINK, contactEmail: "financeiro@nslink.com.br" });
    expect(para).toEqual(["financeiro@nslink.com.br"]);
    expect(getUsersByProvider).not.toHaveBeenCalled();
  });

  it("contato so com espaco em branco conta como ausente", async () => {
    getUsersByProvider.mockResolvedValue([usuario("admin@nslink.com.br", "admin")]);
    const para = await destinatariosDoProvedor({ ...NSLINK, contactEmail: "   " });
    expect(para).toEqual(["admin@nslink.com.br"]);
  });

  it("sem contato, caem os ADMINISTRADORES — e so eles", async () => {
    getUsersByProvider.mockResolvedValue([
      usuario("admin@nslink.com.br", "admin"),
      usuario("operador@nslink.com.br", "user"),
      usuario("outro.admin@nslink.com.br", "admin"),
    ]);
    const para = await destinatariosDoProvedor(NSLINK);
    expect(para).toEqual(["admin@nslink.com.br", "outro.admin@nslink.com.br"]);
    expect(getUsersByProvider).toHaveBeenCalledWith(3);
  });

  it("o mesmo endereco em maiuscula e minuscula e um destinatario so", async () => {
    getUsersByProvider.mockResolvedValue([
      usuario("Admin@NsLink.com.br", "admin"),
      usuario(" admin@nslink.com.br ", "admin"),
    ]);
    expect(await destinatariosDoProvedor(NSLINK)).toEqual(["admin@nslink.com.br"]);
  });

  it("sem contato e sem administrador, nao inventa endereco", async () => {
    getUsersByProvider.mockResolvedValue([usuario("operador@nslink.com.br", "user")]);
    expect(await destinatariosDoProvedor(NSLINK)).toEqual([]);
  });

  it("banco fora do ar ao listar administradores: lista vazia e aviso, nunca excecao", async () => {
    getUsersByProvider.mockRejectedValue(new Error("connection terminated"));
    expect(await destinatariosDoProvedor(NSLINK)).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Com que marca e por qual endereco
// ─────────────────────────────────────────────────────────────────────────────

describe("contextoDeEmail", () => {
  it("provedor sem marca: marca da plataforma e o subdominio dele como endereco", async () => {
    const ctx = await contextoDeEmail({ ...NSLINK, contactEmail: "a@b.com" });
    expect(ctx.marca).toBe(MARCA_PLATAFORMA);
    expect(ctx.urlBase).toBe("https://nslink.consultaisp.com.br");
    expect(ctx.nome).toBe("NsLink Provedor");
  });

  it("provedor de revendedor: a marca DELE e o dominio dele", async () => {
    getMarca.mockResolvedValue(marcaCredNet);
    const ctx = await contextoDeEmail({ ...NSLINK, contactEmail: "a@b.com", marcaId: 7 });
    expect(ctx.marca.nomeProduto).toBe("CredNet Bureau");
    expect(ctx.marca.suporteEmail).toBe("suporte@crednet.com.br");
    expect(ctx.urlBase).toBe("https://app.crednet.com.br");
  });

  it("marca com dominio ainda pendente de HTTPS: o endereco volta a ser o subdominio", async () => {
    // Sem certificado o dominio proprio nao serve o app; mandar o provedor
    // para la e mandar para um endereco que nao responde.
    getMarca.mockResolvedValue({ ...marcaCredNet, dominioStatus: "pendente" });
    const ctx = await contextoDeEmail({ ...NSLINK, contactEmail: "a@b.com", marcaId: 7 });
    expect(ctx.marca.nomeProduto).toBe("CredNet Bureau");
    expect(ctx.urlBase).toBe("https://nslink.consultaisp.com.br");
  });

  it("marca desligada volta para a plataforma, inclusive fora de requisicao", async () => {
    getMarca.mockResolvedValue({ ...marcaCredNet, ativo: false });
    const ctx = await contextoDeEmail({ ...NSLINK, contactEmail: "a@b.com", marcaId: 7 });
    expect(ctx.marca).toBe(MARCA_PLATAFORMA);
  });

  it("banco fora do ar ao resolver a marca nao derruba o contexto", async () => {
    getMarca.mockRejectedValue(new Error("timeout"));
    const ctx = await contextoDeEmail({ ...NSLINK, contactEmail: "a@b.com", marcaId: 7 });
    expect(ctx.marca).toBe(MARCA_PLATAFORMA);
    expect(ctx.para).toEqual(["a@b.com"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// avisarProvedor — a regra que protege a operacao
// ─────────────────────────────────────────────────────────────────────────────

describe("avisarProvedor", () => {
  it("manda uma vez para cada destinatario, com o contexto resolvido", async () => {
    getUsersByProvider.mockResolvedValue([
      usuario("admin@nslink.com.br", "admin"),
      usuario("socio@nslink.com.br", "admin"),
    ]);
    const enviar = vi.fn(async () => undefined);

    await avisarProvedor(NSLINK, enviar, "cadastro-aprovado");

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls.map(c => c[0])).toEqual(["admin@nslink.com.br", "socio@nslink.com.br"]);
    const ctx = enviar.mock.calls[0][1];
    expect(ctx.marca).toBe(MARCA_PLATAFORMA);
    expect(ctx.urlBase).toBe("https://nslink.consultaisp.com.br");
    expect(ctx.nome).toBe("NsLink Provedor");
  });

  it("sem ninguem a quem avisar, nao envia e registra o motivo", async () => {
    const enviar = vi.fn(async () => undefined);
    await avisarProvedor(NSLINK, enviar, "creditos-liberados");
    expect(enviar).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatchObject({ providerId: 3, rotulo: "creditos-liberados" });
  });

  it("falha de envio a um destinatario nao impede os outros", async () => {
    getUsersByProvider.mockResolvedValue([
      usuario("quebrado@nslink.com.br", "admin"),
      usuario("ok@nslink.com.br", "admin"),
    ]);
    const recebidos: string[] = [];
    const enviar = vi.fn(async (para: string) => {
      if (para.startsWith("quebrado")) throw new Error("recipient rejected");
      recebidos.push(para);
    });

    await avisarProvedor(NSLINK, enviar, "fatura-gerada");

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(recebidos).toEqual(["ok@nslink.com.br"]);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("Resend inteiro fora do ar: nenhuma excecao sobe — o ato ja terminou", async () => {
    getUsersByProvider.mockResolvedValue([usuario("admin@nslink.com.br", "admin")]);
    const enviar = vi.fn(async () => { throw new Error("Falha ao enviar email: service unavailable"); });

    await expect(avisarProvedor(NSLINK, enviar, "acesso-suspenso")).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("falha ao MONTAR o contexto tambem e engolida, e nada e enviado", async () => {
    controle.urlDeEntradaLanca = true;
    const enviar = vi.fn(async () => undefined);

    await expect(
      avisarProvedor({ ...NSLINK, contactEmail: "a@b.com" }, enviar, "plano-alterado"),
    ).resolves.toBeUndefined();

    expect(enviar).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toMatchObject({ rotulo: "plano-alterado" });
  });

  it("o rotulo entra no log para dizer QUAL aviso se perdeu", async () => {
    await avisarProvedor(NSLINK, vi.fn(async () => undefined), "usuario-adicionado");
    expect(log.warn.mock.calls[0][0].rotulo).toBe("usuario-adicionado");
  });
});
