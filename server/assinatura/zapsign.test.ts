import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTS_DO_ZAPSIGN, clienteZapSign } from "./zapsign";
import { ErroDeConfissao } from "./erro";

type Chamada = { url: string; init: RequestInit };
function fetchFalso(respostas: Array<{ status: number; corpo?: unknown; headers?: Record<string, string> }>) {
  const chamadas: Chamada[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas.shift() ?? { status: 200, corpo: {} };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  });
  return { chamadas, fetchImpl: fetchImpl as unknown as typeof fetch };
}
const corpoDe = (c: Chamada) => JSON.parse(String(c.init.body));

describe("conector do ZapSign", () => {
  it("fala com o host do ambiente pedido e manda o Bearer", async () => {
    const { chamadas, fetchImpl } = fetchFalso([{ status: 200, corpo: { count: 0, results: [] } }]);
    await clienteZapSign({ apiToken: "tok-1", ambiente: "sandbox", fetchImpl }).testarToken();
    expect(chamadas[0].url).toBe(`${HOSTS_DO_ZAPSIGN.sandbox}/docs/?page=1`);
    expect((chamadas[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    const prod = fetchFalso([{ status: 200, corpo: [] }]);
    await clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl: prod.fetchImpl }).testarToken();
    expect(prod.chamadas[0].url.startsWith("https://api.zapsign.com.br/api/v1/")).toBe(true);
  });
  it("cria documento por PDF com os campos da spec e devolve token e signatários (campos extras descartados)", async () => {
    const { chamadas, fetchImpl } = fetchFalso([{ status: 200, corpo: {
      token: "doc-1", status: "pending", sandbox: true,
      signers: [{ token: "s-1", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-1", auth_mode: "assinaturaTela-tokenWhatsapp", liveness_photo_url: "x", geo_latitude: 1, ip: "1.1.1.1" }],
    } }]);
    const doc = await clienteZapSign({ apiToken: "t", ambiente: "sandbox", fetchImpl }).criarDocumentoPorPdf({
      name: "Confissão de dívida — Maria — NsLink", base64_pdf: "JVBERi0=", lang: "pt-br", external_id: "confissao:7", folder_path: "consulta-isp/1",
      date_limit_to_sign: "2026-09-24", reminder_every_n_days: 3, allow_refuse_signature: true, signature_order_active: false,
      signers: [{ name: "Maria", email: "m@x.com", phone_country: "55", phone_number: "31999990000", auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true, validate_cpf: true, send_automatic_email: false, send_automatic_whatsapp: false, lock_name: true }],
    });
    expect(chamadas[0].url).toBe(`${HOSTS_DO_ZAPSIGN.sandbox}/docs/`);
    expect(chamadas[0].init.method).toBe("POST");
    expect(corpoDe(chamadas[0])).toMatchObject({ base64_pdf: "JVBERi0=", date_limit_to_sign: "2026-09-24", reminder_every_n_days: 3, allow_refuse_signature: true });
    expect(doc.token).toBe("doc-1");
    expect(doc.signers[0]).toEqual({ token: "s-1", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-1", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: null });
    expect(JSON.stringify(doc)).not.toContain("liveness");
  });
  it("cria por modelo e adiciona/atualiza signatário nos caminhos certos", async () => {
    const { chamadas, fetchImpl } = fetchFalso([
      { status: 200, corpo: { token: "doc-2", status: "pending", signers: [{ token: "s-2", status: "new" }] } },
      { status: 200, corpo: { token: "s-3", status: "new", sign_url: "u" } },
      { status: 200, corpo: { token: "s-2", status: "new" } },
    ]);
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    await c.criarDocumentoPorModelo({ template_id: "tpl-1", signer_name: "Maria", signer_email: "m@x.com", signer_phone_country: "55", signer_phone_number: "31999990000", data: [{ de: "{{VALOR_TOTAL}}", para: "R$ 1,00" }], external_id: "confissao:8", folder_path: "consulta-isp/1", date_limit_to_sign: "2026-09-24", reminder_every_n_days: 3, allow_refuse_signature: true, lang: "pt-br", send_automatic_email: true, send_automatic_whatsapp: false });
    await c.adicionarSignatario("doc-2", { name: "Ana", email: "a@x.com", auth_mode: "assinaturaTela-tokenEmail", order_group: 1 });
    await c.atualizarSignatario("s-2", { auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true, validate_cpf: true });
    expect(chamadas.map(x => x.url)).toEqual([
      `${HOSTS_DO_ZAPSIGN.producao}/models/create-doc/`,
      `${HOSTS_DO_ZAPSIGN.producao}/docs/doc-2/add-signer/`,
      `${HOSTS_DO_ZAPSIGN.producao}/signers/s-2/`,
    ]);
    expect(corpoDe(chamadas[0]).data).toEqual([{ de: "{{VALOR_TOTAL}}", para: "R$ 1,00" }]);
  });
  it("detalha, exclui, registra o webhook DO DOCUMENTO com o cabeçalho na criação, exclui webhook e reenvia em massa", async () => {
    const { chamadas, fetchImpl } = fetchFalso([
      { status: 200, corpo: { token: "doc-1", status: "signed", signed_at: "2026-09-10T12:00:00Z", signed_file: "https://s3/x.pdf", original_file: "https://s3/o.pdf", deleted: false, sandbox: false, signers: [{ token: "s-1", status: "signed", signed_at: "2026-09-10T12:00:00Z", auth_mode: "assinaturaTela-tokenWhatsapp", answers: [] }] } },
      { status: 200, corpo: {} },
      { status: 200, corpo: { id: 4242 } },
      { status: 200, corpo: {} },
      { status: 200, corpo: { success: true, total_signers: 1, sent_count: 1, failed_count: 0, failed_signers: [] } },
    ]);
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    const d = await c.detalharDocumento("doc-1");
    expect(d).toMatchObject({ status: "signed", deleted: false, sandbox: false, signed_file: "https://s3/x.pdf" });
    expect(JSON.stringify(d)).not.toContain("answers");
    await c.excluirDocumento("doc-1");
    const w = await c.registrarWebhookDoDocumento({ url: "https://consultaisp.com.br/api/webhooks/zapsign/1", docToken: "doc-1", cabecalho: { nome: "X-Consulta-ISP-Assinatura", valor: "segredo" } });
    expect(w).toEqual({ id: "4242" });
    await c.excluirWebhook("4242");
    const r = await c.reenviarNotificacoes("doc-1");
    expect(r).toEqual({ enviados: 1, falhas: 0 });
    expect(chamadas.map(x => `${x.init.method} ${x.url}`)).toEqual([
      `GET ${HOSTS_DO_ZAPSIGN.producao}/docs/doc-1/`,
      `DELETE ${HOSTS_DO_ZAPSIGN.producao}/docs/doc-1/`,
      `POST ${HOSTS_DO_ZAPSIGN.producao}/user/company/webhook/`,
      `DELETE ${HOSTS_DO_ZAPSIGN.producao}/user/company/webhook/delete/`,
      `POST ${HOSTS_DO_ZAPSIGN.producao}/docs/doc-1/resend-notifications-bulk/`,
    ]);
    expect(corpoDe(chamadas[2])).toEqual({ url: "https://consultaisp.com.br/api/webhooks/zapsign/1", type: "", doc_token: "doc-1", headers: [{ name: "X-Consulta-ISP-Assinatura", value: "segredo" }] });
    expect(corpoDe(chamadas[3])).toEqual({ id: "4242" });
    expect(chamadas[4].init.body).toBeUndefined();
  });
  it("não registra webhook sem o valor do cabeçalho: sem ele, todo retorno bateria no 401", async () => {
    const { chamadas, fetchImpl } = fetchFalso([]);
    const erro = await clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl }).registrarWebhookDoDocumento({ url: "https://consultaisp.com.br/api/webhooks/zapsign/1", docToken: "doc-1", cabecalho: { nome: "X-Consulta-ISP-Assinatura", valor: "" } }).catch(e => e);
    expect(erro).toBeInstanceOf(ErroDeConfissao);
    expect(erro.codigo).toBe("NAO_CONFIGURADA");
    expect(chamadas).toHaveLength(0);
  });
  it.each([
    [401, "ZAPSIGN_CREDENCIAL", 422], [403, "ZAPSIGN_CREDENCIAL", 422], [402, "ZAPSIGN_CREDITOS", 422],
    [429, "ZAPSIGN_LIMITE", 429], [400, "ZAPSIGN_RECUSOU", 422], [404, "NAO_ENCONTRADA", 404], [500, "ZAPSIGN_INDISPONIVEL", 502], [503, "ZAPSIGN_INDISPONIVEL", 502],
  ])("HTTP %s vira %s (%s) sem vazar o corpo", async (status, codigo, http) => {
    const { fetchImpl } = fetchFalso([{ status, corpo: { detail: "token secreto abc123 no corpo" }, headers: status === 429 ? { "retry-after": "90" } : {} }]);
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    const erro = await c.detalharDocumento("doc-1").catch(e => e);
    expect(erro).toBeInstanceOf(ErroDeConfissao);
    expect(erro.codigo).toBe(codigo);
    expect(erro.http).toBe(http);
    expect(erro.message).not.toContain("abc123");
    if (status === 429) expect(erro.detalhes).toEqual({ aguardarSegundos: 90 });
  });
  it("rede fora ou timeout = indisponível", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const erro = await clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl }).testarToken().catch(e => e);
    expect(erro.codigo).toBe("ZAPSIGN_INDISPONIVEL");
  });
  it("baixa o arquivo assinado até o limite e recusa acima dele", async () => {
    const grande = new Uint8Array(11);
    const fetchImpl = (async () => new Response(grande, { status: 200 })) as unknown as typeof fetch;
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    expect((await c.baixarArquivo("https://s3/x.pdf", 11)).length).toBe(11);
    const erro = await c.baixarArquivo("https://s3/x.pdf", 10).catch(e => e);
    expect(erro.codigo).toBe("ARQUIVO_GRANDE");
  });
});

/**
 * O download do PDF assinado roda no WORKER, dentro da reconciliação: sem
 * prazo, um link S3 parado prende a passada pelos ~300 s do undici, e a trava
 * `emAndamento` derruba cada tique de 10 min enquanto isso. O prazo (60 s — PDF
 * é maior que JSON) cobre cabeçalho E corpo, e nenhum dos dois depende de o
 * `fetch` honrar o sinal: aqui o dublê ignora o abort de propósito.
 */
describe("prazo do download do arquivo assinado", () => {
  afterEach(() => { vi.useRealTimers(); });
  const acompanhar = (p: Promise<unknown>) => {
    const estado: { valor: unknown } = { valor: "pendente" };
    p.then(() => { estado.valor = "resolveu"; }, e => { estado.valor = e; });
    return estado;
  };

  it("fetch que nunca responde rejeita com indisponibilidade depois de 60 s, e não antes", async () => {
    vi.useFakeTimers();
    let sinal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => { sinal = init?.signal ?? undefined; return new Promise<Response>(() => {}); }) as unknown as typeof fetch;
    const estado = acompanhar(clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl }).baixarArquivo("https://s3/x.pdf", 1024));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(estado.valor).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    expect(estado.valor).toBeInstanceOf(ErroDeConfissao);
    expect(estado.valor).toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL", http: 502 });
    expect(sinal?.aborted, "a requisição é cancelada, não só abandonada").toBe(true);
  });

  it("corpo que trava depois do cabeçalho também rejeita no prazo", async () => {
    vi.useFakeTimers();
    const corpoParado = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46])); } });
    const fetchImpl = (async () => new Response(corpoParado, { status: 200 })) as unknown as typeof fetch;
    const estado = acompanhar(clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl }).baixarArquivo("https://s3/x.pdf", 1024));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(estado.valor).toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL", http: 502 });
  });

  it("download que termina a tempo não deixa o prazo armado", async () => {
    vi.useFakeTimers();
    const fetchImpl = (async () => new Response(new Uint8Array(4), { status: 200 })) as unknown as typeof fetch;
    expect((await clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl }).baixarArquivo("https://s3/x.pdf", 1024)).length).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });
});
