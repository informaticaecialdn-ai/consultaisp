import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `validarWebhookExterno` — revisão final de segurança antes da demonstração
 * pública (itens 1 e 2).
 *
 * `dns.lookup` fica mockado: um endereço IP literal (127.0.0.1,
 * 169.254.169.254) não precisa de rede — o Node devolve na hora, e o teste
 * prova isso separadamente, sem mock, mais abaixo. O mock existe para os
 * casos que depende de RESOLVER NOME — a prova central do item 2 (a "guarda
 * so de nome" que passa um host que resolve para loopback).
 */
const dnsMock = vi.hoisted(() => ({
  lookup: vi.fn(),
}));
vi.mock("node:dns", () => ({ default: { lookup: dnsMock.lookup }, lookup: dnsMock.lookup }));

import { validarWebhookExterno, MOTIVO_WEBHOOK_INVALIDO } from "./webhook-validador";

/** Simula a assinatura callback de `dns.lookup(host, opts, cb)` com uma lista de endereços. */
function resolvePara(...enderecos: Array<{ address: string; family: 4 | 6 }>) {
  dnsMock.lookup.mockImplementation((_host: string, _opts: unknown, cb: (err: Error | null, e: typeof enderecos) => void) => {
    cb(null, enderecos);
  });
}

function falhaResolver(mensagem = "getaddrinfo ENOTFOUND") {
  dnsMock.lookup.mockImplementation((_host: string, _opts: unknown, cb: (err: Error | null, e: unknown) => void) => {
    cb(new Error(mensagem), []);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Padrao: qualquer host "resolve" para um IP publico de documentacao
  // (RFC 5737) — os testes que precisam de outro comportamento sobrescrevem.
  resolvePara({ address: "203.0.113.10", family: 4 });
});

describe("validarWebhookExterno — forma da URL", () => {
  it("recusa string que nao e URL", async () => {
    const r = await validarWebhookExterno("nao-e-url");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("recusa http:// — so https e aceito", async () => {
    const r = await validarWebhookExterno("http://webhook.example.com/x");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });
});

describe("validarWebhookExterno — endereco interno por FORMATO (sem precisar resolver)", () => {
  it("recusa 127.0.0.1 sem chamar dns.lookup — ja e endereco, nao precisa resolver", async () => {
    const r = await validarWebhookExterno("https://127.0.0.1:8080/x");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("recusa o endpoint de metadados de nuvem (169.254.169.254)", async () => {
    const r = await validarWebhookExterno("https://169.254.169.254/latest/meta-data/");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("recusa host sem ponto (nome interno da rede)", async () => {
    const r = await validarWebhookExterno("https://servidor-interno/x");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });
});

describe("validarWebhookExterno — a guarda so de nome nao bastava (item 2)", () => {
  it("recusa um hostname PUBLICO que RESOLVE para loopback (127.0.0.1.nip.io e o exemplo real do achado)", async () => {
    // `ehEnderecoPrivado("qualquer-nome.nip.io")` sozinha devolveria false —
    // a string nao e IP nem cai em nenhum padrao de nome interno. So a
    // resolucao de DNS revela que o destino de verdade e loopback.
    resolvePara({ address: "127.0.0.1", family: 4 });

    const r = await validarWebhookExterno("https://127.0.0.1.nip.io:5432/");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
    expect(dnsMock.lookup).toHaveBeenCalledWith("127.0.0.1.nip.io", expect.objectContaining({ all: true }), expect.any(Function));
  });

  it("confere TODOS os enderecos devolvidos, nao so o primeiro", async () => {
    resolvePara({ address: "203.0.113.10", family: 4 }, { address: "10.0.0.5", family: 4 });

    const r = await validarWebhookExterno("https://multi-endereco.example.com/x");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
  });

  it("resolucao vazia (nenhum endereco) e recusada — sem prova de destino, sem 'ok'", async () => {
    resolvePara();

    const r = await validarWebhookExterno("https://sem-endereco.example.com/x");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
  });

  it("falha ao resolver (ENOTFOUND) e recusada, nunca aceita por omissao", async () => {
    falhaResolver();

    const r = await validarWebhookExterno("https://nao-existe.example.com/x");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO });
  });
});

describe("validarWebhookExterno — caminho feliz", () => {
  it("aceita https:// com host publico que resolve para IP publico", async () => {
    resolvePara({ address: "203.0.113.10", family: 4 });

    const r = await validarWebhookExterno("https://webhook.example.com/abc123");

    expect(r).toEqual({ ok: true });
  });

  it("aceita direto um IP literal publico — dns.lookup e chamado, mas o proprio Node devolve o endereco na hora, sem rede", async () => {
    resolvePara({ address: "203.0.113.10", family: 4 });

    const r = await validarWebhookExterno("https://203.0.113.10/x");

    expect(r).toEqual({ ok: true });
  });
});
