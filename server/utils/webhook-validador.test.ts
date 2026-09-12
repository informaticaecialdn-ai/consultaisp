import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `validarWebhookExterno` — revisão final de segurança antes da demonstração
 * pública (itens 1 e 2), mais a rodada seguinte (itens 1 e 6 dela).
 *
 * `dns.lookup` fica mockado: um endereço IP literal (127.0.0.1,
 * 169.254.169.254) não precisa de rede — o Node devolve na hora, e o teste
 * prova isso separadamente, sem mock, mais abaixo. O mock existe para os
 * casos que depende de RESOLVER NOME — a prova central do item 2 (a "guarda
 * so de nome" que passa um host que resolve para loopback) e do item 1 da
 * rodada seguinte (o host que resolve para um IPv6 PÚBLICO, que a guarda
 * antiga também recusava, por engano).
 */
const dnsMock = vi.hoisted(() => ({
  lookup: vi.fn(),
}));
vi.mock("node:dns", () => ({ default: { lookup: dnsMock.lookup }, lookup: dnsMock.lookup }));

import { validarWebhookExterno, MOTIVO_WEBHOOK_INVALIDO, enderecoIpEhPrivado } from "./webhook-validador";

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
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "url_invalida" });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("recusa http:// — so https e aceito", async () => {
    const r = await validarWebhookExterno("http://webhook.example.com/x");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "protocolo_invalido" });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });
});

describe("validarWebhookExterno — endereco interno por FORMATO (sem precisar resolver)", () => {
  it("recusa 127.0.0.1 sem chamar dns.lookup — ja e endereco, nao precisa resolver", async () => {
    const r = await validarWebhookExterno("https://127.0.0.1:8080/x");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_privado" });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("recusa o endpoint de metadados de nuvem (169.254.169.254)", async () => {
    const r = await validarWebhookExterno("https://169.254.169.254/latest/meta-data/");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_privado" });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("recusa host sem ponto (nome interno da rede)", async () => {
    const r = await validarWebhookExterno("https://servidor-interno/x");
    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_privado" });
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

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_resolvido_privado" });
    expect(dnsMock.lookup).toHaveBeenCalledWith("127.0.0.1.nip.io", expect.objectContaining({ all: true }), expect.any(Function));
  });

  it("confere TODOS os enderecos devolvidos, nao so o primeiro", async () => {
    resolvePara({ address: "203.0.113.10", family: 4 }, { address: "10.0.0.5", family: 4 });

    const r = await validarWebhookExterno("https://multi-endereco.example.com/x");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_resolvido_privado" });
  });

  it("resolucao vazia (nenhum endereco) e recusada — sem prova de destino, sem 'ok'", async () => {
    resolvePara();

    const r = await validarWebhookExterno("https://sem-endereco.example.com/x");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "dns_vazio" });
  });

  it("falha ao resolver (ENOTFOUND) e recusada, nunca aceita por omissao", async () => {
    falhaResolver();

    const r = await validarWebhookExterno("https://nao-existe.example.com/x");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "dns_nao_resolve" });
  });
});

/**
 * DEFEITO CRÍTICO da rodada anterior (item 1): `enderecos.some(ehEnderecoPrivado)`
 * usava a função que julga HOSTNAME também para o ENDEREÇO já resolvido.
 * `ehEnderecoPrivado` marca qualquer string com ":" como "IPv6 literal,
 * suspeito" — o que é a leitura certa para um hostname, mas errada para um
 * endereço, porque TODO IPv6 tem ":". Medido contra DNS ao vivo antes da
 * correção: `example.com`, `webhook.site` e `n8n.io` (todos dual-stack)
 * devolviam `{ok:false}` — a VPS de produção é dual-stack, então o impacto
 * real era maior que em ambiente só-IPv4.
 */
describe("validarWebhookExterno — IPv6 nao pode ser recusado so por ser IPv6 (item 1)", () => {
  it("aceita um hostname que resolve para IPv6 unicast global (Cloudflare, endereco publico de verdade)", async () => {
    resolvePara({ address: "2606:4700:4700::1111", family: 6 });

    const r = await validarWebhookExterno("https://ipv6-publico.example.com/hook");

    expect(r).toEqual({ ok: true });
  });

  it("continua recusando quando o IPv6 resolvido É privado (link-local)", async () => {
    resolvePara({ address: "fe80::1", family: 6 });

    const r = await validarWebhookExterno("https://ipv6-privado.example.com/hook");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_resolvido_privado" });
  });

  it("recusa quando um host dual-stack tem QUALQUER endereco privado, mesmo com um IPv4 publico junto", async () => {
    resolvePara({ address: "2606:4700:4700::1111", family: 6 }, { address: "127.0.0.1", family: 4 });

    const r = await validarWebhookExterno("https://dual-stack-com-um-ruim.example.com/hook");

    expect(r).toEqual({ ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa: "endereco_resolvido_privado" });
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

/**
 * `enderecoIpEhPrivado` direto — a nova checagem por ENDEREÇO (item 1), não
 * por hostname. Cobre as faixas explicitamente pedidas na revisão mais os
 * dois buracos de IPv4 medidos como passando hoje (item 7): 198.18.0.1
 * (bancada de benchmark, RFC 2544) e 224.0.0.1 (multicast).
 */
describe("enderecoIpEhPrivado", () => {
  it("IPv4 — mantem as faixas antigas (10/8, 127/8, 0/8, 192.168/16, 172.16/12, 169.254/16, 100.64/10)", () => {
    expect(enderecoIpEhPrivado("10.1.2.3")).toBe(true);
    expect(enderecoIpEhPrivado("127.0.0.1")).toBe(true);
    expect(enderecoIpEhPrivado("0.0.0.0")).toBe(true);
    expect(enderecoIpEhPrivado("192.168.1.1")).toBe(true);
    expect(enderecoIpEhPrivado("172.16.0.1")).toBe(true);
    expect(enderecoIpEhPrivado("172.31.255.255")).toBe(true);
    expect(enderecoIpEhPrivado("172.32.0.1")).toBe(false); // fora do /12, tem que passar
    expect(enderecoIpEhPrivado("169.254.1.1")).toBe(true);
    expect(enderecoIpEhPrivado("100.64.0.1")).toBe(true);
    expect(enderecoIpEhPrivado("100.128.0.1")).toBe(false); // fora do /10 do CGNAT
  });

  it("IPv4 — os dois buracos medidos na revisao (item 7): benchmark RFC 2544 e multicast", () => {
    expect(enderecoIpEhPrivado("198.18.0.1")).toBe(true);
    expect(enderecoIpEhPrivado("198.19.255.255")).toBe(true);
    expect(enderecoIpEhPrivado("198.20.0.1")).toBe(false); // fora do /15
    expect(enderecoIpEhPrivado("224.0.0.1")).toBe(true);
    expect(enderecoIpEhPrivado("239.255.255.255")).toBe(true);
    expect(enderecoIpEhPrivado("240.0.0.1")).toBe(false); // fora do /4 multicast
  });

  it("IPv4 — endereco publico comum passa", () => {
    expect(enderecoIpEhPrivado("203.0.113.10")).toBe(false);
    expect(enderecoIpEhPrivado("8.8.8.8")).toBe(false);
  });

  it("IPv6 — loopback e indeterminado sao privados", () => {
    expect(enderecoIpEhPrivado("::1")).toBe(true);
    expect(enderecoIpEhPrivado("0:0:0:0:0:0:0:1")).toBe(true); // mesma coisa, forma expandida
    expect(enderecoIpEhPrivado("::")).toBe(true);
  });

  it("IPv6 — unique-local (fc00::/7) e link-local (fe80::/10) sao privados", () => {
    expect(enderecoIpEhPrivado("fc00::1")).toBe(true);
    expect(enderecoIpEhPrivado("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(enderecoIpEhPrivado("fe80::1")).toBe(true);
    expect(enderecoIpEhPrivado("fe80::a1b2:c3d4:e5f6:7890")).toBe(true);
    expect(enderecoIpEhPrivado("fe00::1")).toBe(false); // fora do /10 do link-local, tem que passar
  });

  it("IPv6 — prefixo NAT64 (64:ff9b::/96) e privado", () => {
    expect(enderecoIpEhPrivado("64:ff9b::c000:0201")).toBe(true); // embute 192.0.2.1
    expect(enderecoIpEhPrivado("64:ff9b::808:808")).toBe(true); // embute 8.8.8.8
  });

  it("IPv6 mapeado (::ffff:a.b.c.d) desembrulha e testa como IPv4", () => {
    expect(enderecoIpEhPrivado("::ffff:127.0.0.1")).toBe(true); // mapeia para loopback
    expect(enderecoIpEhPrivado("::ffff:192.168.1.1")).toBe(true); // mapeia para privado
    expect(enderecoIpEhPrivado("::ffff:8.8.8.8")).toBe(false); // mapeia para publico
  });

  it("IPv6 unicast global PASSA — o ponto central do defeito 1", () => {
    expect(enderecoIpEhPrivado("2606:4700:4700::1111")).toBe(false); // Cloudflare
    expect(enderecoIpEhPrivado("2001:4860:4860::8888")).toBe(false); // Google
    expect(enderecoIpEhPrivado("2606:4700::6810:84e5")).toBe(false); // forma comprimida real, medida ao vivo
  });

  it("forma invalida recusa — nunca aceita por omissao", () => {
    expect(enderecoIpEhPrivado("nao-e-um-endereco")).toBe(true);
    expect(enderecoIpEhPrivado("1.2.3")).toBe(true);
    expect(enderecoIpEhPrivado("1.2.3.4.5")).toBe(true);
    expect(enderecoIpEhPrivado("1.2.3.999")).toBe(true);
    expect(enderecoIpEhPrivado("gggg::1")).toBe(true);
    expect(enderecoIpEhPrivado("1::2::3")).toBe(true); // "::" duplicado nao e endereco valido
  });
});
