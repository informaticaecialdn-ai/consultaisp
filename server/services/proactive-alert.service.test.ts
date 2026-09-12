/**
 * Quem e avaliado para o alerta de fuga.
 *
 * O aviso nao pode depender de o ERP do dono estar de pe no segundo da
 * consulta: a base sincronizada entra como reserva para o provedor cujo ERP
 * nao respondeu. E `customers.status` so vira status de contrato nos valores
 * que o sync escreve — o default da coluna nao abre o portao.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./email", () => ({ sendProactiveAlertEmail: vi.fn() }));
vi.mock("./marca.service", () => ({ resolverMarcaPorProviderId: vi.fn(), urlDeEntrada: () => "" }));
vi.mock("./crm/zapi", () => ({ isZapiConfigured: () => false, sendText: vi.fn() }));

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { escolherDonos, statusDaBase, textoDoAlerta, enviarWebhookDoAlerta } from "./proactive-alert.service";

const CONSULENTE = 9;

describe("statusDaBase", () => {
  it("so reconhece o que o sync escreve", () => {
    expect(statusDaBase("active")).toBe("active");
    expect(statusDaBase("suspended")).toBe("suspended");
    expect(statusDaBase("cancelled")).toBe("cancelled");
    expect(statusDaBase("inactive")).toBe("cancelled");
  });
  it("qualquer outra coisa e desconhecido — nunca 'ativo' por padrao", () => {
    expect(statusDaBase("")).toBeUndefined();
    expect(statusDaBase(null)).toBeUndefined();
    expect(statusDaBase("pendente")).toBeUndefined();
  });
});

describe("escolherDonos", () => {
  const aoVivo = [
    { providerId: 1, providerName: "A", name: "Fulano", contractStatus: "active" as const, totalOverdueAmount: 300, maxDaysOverdue: 20 },
    { providerId: CONSULENTE, providerName: "Eu", name: "Fulano", contractStatus: "active" as const, totalOverdueAmount: 0, maxDaysOverdue: 0 },
  ];
  const daBase = [
    { id: 11, providerId: 1, name: "Fulano da base", status: "cancelled", totalOverdueAmount: "0", maxDaysOverdue: 0 },
    { id: 22, providerId: 2, name: "Fulano em B", status: "suspended", totalOverdueAmount: "450.50", maxDaysOverdue: 40 },
    { id: 33, providerId: 3, name: "Fulano em C", status: "active", totalOverdueAmount: "80", maxDaysOverdue: 3 },
    { id: 99, providerId: CONSULENTE, name: "Fulano", status: "active", totalOverdueAmount: "0", maxDaysOverdue: 0 },
  ];

  it("o consulente nunca e dono; o registro ao vivo vence a base e ganha o id do cadastro", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set([1, CONSULENTE]), daBase);
    const a = donos.find(d => d.providerId === 1)!;
    expect(a.origem).toBe("erp");
    expect(a.contractStatus).toBe("active");      // o ERP disse ativo; a base dizia cancelado
    expect(a.customerId).toBe(11);
    expect(donos.some(d => d.providerId === CONSULENTE)).toBe(false);
  });

  it("provedor cujo ERP nao respondeu entra pela base, com o status traduzido", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set([1, CONSULENTE]), daBase);
    const b = donos.find(d => d.providerId === 2)!;
    expect(b).toMatchObject({ origem: "base", customerId: 22, contractStatus: "suspended", totalOverdueAmount: 450.5, maxDaysOverdue: 40 });
  });

  it("provedor cujo ERP RESPONDEU e nao tem o cliente fica de fora — o ERP e mais fresco que a base", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set([1, 3, CONSULENTE]), daBase);
    expect(donos.some(d => d.providerId === 3)).toBe(false);
  });

  it("sem lista de quem respondeu, vale quem trouxe registro ao vivo", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set(aoVivo.map(c => c.providerId)), daBase);
    expect(donos.map(d => d.providerId).sort()).toEqual([1, 2, 3]);
  });
});
describe("textoDoAlerta", () => {
  const semDivida = { contractStatus: "active" as const, totalOverdueAmount: 0, maxDaysOverdue: 0 };

  it("diz o motivo principal com os numeros do momento", () => {
    expect(textoDoAlerta(["divida_ativa"], { contractStatus: "suspended", totalOverdueAmount: 561, maxDaysOverdue: 84 }, 1))
      .toBe("Seu cliente suspenso com R$ 561,00 vencidos há 84 dias foi consultado por outro provedor da rede");
    expect(textoDoAlerta(["consultas_repetidas", "cliente_ativo"], semDivida, 3))
      .toBe("Seu cliente ativo foi consultado por 3 provedores diferentes nos últimos 30 dias");
    expect(textoDoAlerta(["contrato_novo"], semDivida, 1, 13))
      .toBe("Seu cliente novo, com 13 dias de contrato, foi consultado por outro provedor da rede");
    expect(textoDoAlerta(["cliente_ativo"], semDivida, 1))
      .toBe("Seu cliente ativo foi consultado por outro provedor da rede");
  });
});


it("usa a data de contrato sincronizada quando o ERP não responde", () => {
  const [dono] = escolherDonos(9, [], new Set(), [{ id: 1, providerId: 2, name: "Teste", status: "active", contractStartDate: "2026-08-01", totalOverdueAmount: "100", maxDaysOverdue: 4 }]);
  expect(dono.contractStartDate).toBe("2026-08-01");
});

/**
 * `enviarWebhookDoAlerta` — revisão final de segurança antes da demonstração
 * pública (item 1): o DISPARO revalida o endereço, porque produção vem
 * gravando `proactiveAlertWebhookUrl` sem checagem nenhuma desde que a
 * funcionalidade existe — uma linha antiga com `http://` ou endereço interno
 * continua no banco até o provedor abrir a tela e salvar de novo, e é este
 * disparo, não a tela, quem chama `fetch()` sozinho a cada consulta que casar
 * a regra de fuga.
 */
describe("enviarWebhookDoAlerta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sem webhookUrl gravado, nao faz nada e devolve false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const enviou = await enviarWebhookDoAlerta({ id: 7, proactiveAlertWebhookUrl: null }, { evento: "x" });

    expect(enviou).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa endereco interno (o caso real: Evolution API na mesma VPS, 127.0.0.1:8080) — nao chama fetch, e loga ALTO com o providerId", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const enviou = await enviarWebhookDoAlerta({ id: 7, proactiveAlertWebhookUrl: "http://127.0.0.1:8080/x" }, { evento: "x" });

    expect(enviou).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 7 }),
      expect.stringMatching(/webhook recusado/i),
    );
  });

  /**
   * Item 6 da rodada seguinte: o log tem que dizer QUAL causa bateu (nao mais
   * uma frase que lista tres possibilidades pra toda recusa), mais o
   * HOSTNAME — e so o hostname, nunca o caminho (`/x?token=segredo`), que e
   * onde um webhook costuma guardar credencial.
   */
  it("o log carrega a causa maquina-legivel e SO o hostname — nunca a URL inteira nem o caminho", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // http:// (protocolo invalido) e o motivo de verdade aqui — o endereco
    // TAMBEM e interno, mas o protocolo e checado primeiro.
    await enviarWebhookDoAlerta({ id: 7, proactiveAlertWebhookUrl: "http://127.0.0.1:8080/caminho-secreto?token=abc123" }, {});

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 7, causa: "protocolo_invalido", host: "127.0.0.1" }),
      expect.any(String),
    );
    const [campos] = loggerMock.error.mock.calls[0];
    expect(JSON.stringify(campos)).not.toMatch(/caminho-secreto|token|abc123/);
  });

  it("recusa uma linha GRAVADA ANTES da validacao existir (endpoint de metadados de nuvem, https:// mas interno) — causa e host batem", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const enviou = await enviarWebhookDoAlerta({ id: 12, proactiveAlertWebhookUrl: "https://169.254.169.254/latest/meta-data/" }, {});

    expect(enviou).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 12, causa: "endereco_privado", host: "169.254.169.254" }),
      expect.any(String),
    );
  });

  it("endereco externo legitimo: chama fetch e devolve true quando a resposta e ok", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const enviou = await enviarWebhookDoAlerta({ id: 7, proactiveAlertWebhookUrl: "https://203.0.113.10/hook" }, { evento: "proactive_alert" });

    expect(enviou).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://203.0.113.10/hook", expect.objectContaining({ method: "POST" }));
  });

  it("resposta HTTP nao-ok devolve false — o canal 'hook' nao entra na lista de enviados", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const enviou = await enviarWebhookDoAlerta({ id: 7, proactiveAlertWebhookUrl: "https://203.0.113.10/hook" }, {});

    expect(enviou).toBe(false);
  });
});
