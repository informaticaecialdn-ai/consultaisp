/**
 * Para ONDE o alerta de fuga manda o dono.
 *
 * O botao "Ver o alerta" do e-mail e o "Detalhes:" do WhatsApp saiam de
 * `urlDaMarca`. Sem dominio proprio ativo — praticamente a base inteira hoje —
 * essa base e a RAIZ da plataforma: la o cookie de sessao (host-only, emitido
 * no subdominio do provedor) nao existe e o app serve a LANDING PAGE. O dono
 * clicava no aviso do proprio cliente e caia numa pagina de vendas.
 *
 * A regra agora e a mesma do e-mail de verificacao e do de reset: o endereco
 * vem do PROVEDOR dono do alerta (`urlDeEntrada`), nao da base da marca.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  delete process.env.APP_URL;
  process.env.MAIN_DOMAIN = "consultaisp.com.br";
});

const storageMock = vi.hoisted(() => ({
  getCustomerByCpfCnpj: vi.fn(async (_c: string): Promise<any[]> => []),
  getProvider: vi.fn(async (_id: number): Promise<any> => undefined),
  getMarca: vi.fn(async (_id: number): Promise<any> => undefined),
  getAntiFraudRules: vi.fn(async (_id: number): Promise<any[]> => []),
  getLastProactiveAlert: vi.fn(async (): Promise<any> => undefined),
  createAlert: vi.fn(async (_a: any) => undefined),
  createProactiveAlert: vi.fn(async (_a: any) => undefined),
  getUsersByProvider: vi.fn(async (_id: number): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const emailMock = vi.hoisted(() => ({ sendProactiveAlertEmail: vi.fn(async () => undefined) }));
vi.mock("./email", () => emailMock);

const zapiMock = vi.hoisted(() => ({
  isZapiConfigured: vi.fn(() => true),
  sendText: vi.fn(async (_to: string, _t: string) => ({ success: true })),
}));
vi.mock("./crm/zapi", () => zapiMock);

vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { notifyOwnerProviders } from "./proactive-alert.service";
import { esquecerMarcas } from "./marca.service";

const CONSULENTE = 9;
const DONO = 42;

/** O dono do cliente: sem marca white label, so com o subdominio da plataforma. */
const PROVEDOR_DONO = {
  id: DONO, name: "NsLink", subdomain: "nslink", marcaId: null,
  contactEmail: "financeiro@nslink.com.br", contactPhone: "5511999998888",
  proactiveAlertsEnabled: true, proactiveAlertWebhookUrl: null,
};

const CREDNET = {
  id: 7, slug: "crednet", ativo: true, nomeProduto: "CredNet", assinatura: null,
  dominio: "app.crednet.com.br", dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#1F6F7A", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: null,
  suporteEmail: null, suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null, createdAt: new Date(),
};

/** Cliente ativo e devendo: o portao da regra `ativo_inadimplente` abre. */
const CLIENTE_AO_VIVO = [{
  providerId: DONO, providerName: "NsLink", name: "Fulano de Tal",
  contractStatus: "active" as const, totalOverdueAmount: 561, maxDaysOverdue: 84,
}];

/** A url que o e-mail recebeu (7o argumento) e o texto que foi para o WhatsApp. */
function linksEnviados() {
  return {
    urlBaseDoEmail: emailMock.sendProactiveAlertEmail.mock.calls[0]?.[6] as string | undefined,
    textoDoZap: zapiMock.sendText.mock.calls[0]?.[1] as string | undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  esquecerMarcas();
  storageMock.getProvider.mockImplementation(async (id: number) =>
    id === DONO ? PROVEDOR_DONO : { id, name: "Outro Provedor" });
  storageMock.getMarca.mockResolvedValue(undefined);
});

describe("alerta de fuga: para onde o link leva", () => {
  it("provedor SEM marca vai para o proprio subdominio, nunca para a raiz", async () => {
    await notifyOwnerProviders("12345678901", CLIENTE_AO_VIVO, CONSULENTE);

    const { urlBaseDoEmail, textoDoZap } = linksEnviados();
    expect(urlBaseDoEmail).toBe("https://nslink.consultaisp.com.br");
    expect(textoDoZap).toContain("https://nslink.consultaisp.com.br/anti-fraude");
    // A raiz e a landing page: sem sessao, o dono cai numa pagina de vendas.
    expect(textoDoZap).not.toContain("https://consultaisp.com.br/anti-fraude");
  });

  it("provedor COM marca de dominio ativo vai para o dominio da marca", async () => {
    storageMock.getProvider.mockImplementation(async (id: number) =>
      id === DONO ? { ...PROVEDOR_DONO, marcaId: 7 } : { id, name: "Outro Provedor" });
    storageMock.getMarca.mockResolvedValue(CREDNET);

    await notifyOwnerProviders("12345678901", CLIENTE_AO_VIVO, CONSULENTE);

    const { urlBaseDoEmail, textoDoZap } = linksEnviados();
    expect(urlBaseDoEmail).toBe("https://app.crednet.com.br");
    expect(textoDoZap).toContain("https://app.crednet.com.br/anti-fraude");
  });

  it("dominio de marca ainda pendente nao vale: cai no subdominio do provedor", async () => {
    storageMock.getProvider.mockImplementation(async (id: number) =>
      id === DONO ? { ...PROVEDOR_DONO, marcaId: 7 } : { id, name: "Outro Provedor" });
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, dominioStatus: "pendente" });

    await notifyOwnerProviders("12345678901", CLIENTE_AO_VIVO, CONSULENTE);

    expect(linksEnviados().urlBaseDoEmail).toBe("https://nslink.consultaisp.com.br");
  });
});
