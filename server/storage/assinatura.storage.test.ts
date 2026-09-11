import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `AssinaturaStorage`: toda consulta leva o provider_id; o token entra
 * cifrado e nunca sai pela leitura do admin; o PDF só sai por `obterPdf`;
 * as transições são atômicas (`WHERE status = de`) e a máquina de estados
 * recusa antes de ir ao banco. Mesmo banco de mentira (pg-proxy) dos outros
 * storages: o SQL que o Drizzle gera é o que se confere.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[]; method: string }[],
  responder: null as null | ((sql: string, params: unknown[]) => unknown[][]),
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }), pool: {} }));
vi.hoisted(() => { process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real"; });

import { drizzle } from "drizzle-orm/pg-proxy";
import { decryptField } from "../utils/crypto";
import { AssinaturaStorage } from "./assinatura.storage";

const PROVEDOR = 6;
let storage: AssinaturaStorage;
beforeEach(() => {
  banco.consultas.length = 0;
  banco.responder = null;
  banco.db = drizzle(async (sqlTexto, params, method) => {
    banco.consultas.push({ sql: sqlTexto, params, method });
    return { rows: banco.responder ? banco.responder(sqlTexto, params) : [] };
  });
  storage = new AssinaturaStorage();
});

function conferirTenant(c: { sql: string; params: unknown[] }) {
  const oc = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
  expect(oc.length, c.sql).toBeGreaterThan(0);
  for (const o of oc) expect(c.params[Number(o[1]) - 1]).toBe(PROVEDOR);
}

/** A linha de `assinatura_integracoes` na ordem do select explícito de `colunasDaIntegracao`. */
function linhaDaIntegracao(sobrescrever: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    id: 1, providerId: PROVEDOR, apiToken: null, ambiente: "sandbox", templateId: null, signatarioNome: null, signatarioCpf: null,
    signatarioEmail: null, signatarioTelefone: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false,
    prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null, webhookSecret: "s3gr3d0", isEnabled: false, ativadaEm: null, updatedAt: null,
    ...sobrescrever,
  };
  return Object.values(base);
}

describe("integração de assinatura", () => {
  it("salvar cifra o token, gera o segredo do webhook e zera is_enabled; o token puro nunca vai ao banco", async () => {
    banco.responder = () => [];
    await storage.salvarIntegracaoDeAssinatura(PROVEDOR, { apiToken: "tok-puro-123", ambiente: "producao", authModeCliente: "assinaturaTela-tokenEmail" });
    const insert = banco.consultas.find(c => c.sql.startsWith('insert into "assinatura_integracoes"'))!;
    expect(insert).toBeDefined();
    expect(insert.params).toContain(PROVEDOR);
    expect(insert.params).not.toContain("tok-puro-123");
    const cifrado = insert.params.find(p => typeof p === "string" && p.startsWith("enc:")) as string;
    expect(decryptField(cifrado)).toBe("tok-puro-123");
    const segredo = insert.params.find(p => typeof p === "string" && /^[A-Za-z0-9_-]{40,}$/.test(p));
    expect(segredo, "webhook_secret base64url de 32 bytes").toBeDefined();
    expect(insert.params).toContain(false); // is_enabled
  });
  it("salvar sem token não mexe no token; trocar só o modelo não regenera o segredo; trocar o ambiente regenera", async () => {
    banco.responder = texto => texto.startsWith("select") ? [linhaDaIntegracao({ apiToken: "enc:x.y.z", ambiente: "sandbox", isEnabled: true })] : [];
    await storage.salvarIntegracaoDeAssinatura(PROVEDOR, { apiToken: "", templateId: "tpl-9" });
    const update = banco.consultas.find(c => c.sql.startsWith('update "assinatura_integracoes"'))!;
    expect(update.sql).not.toContain('"api_token"');
    expect(update.sql).not.toContain('"webhook_secret"');
    expect(update.sql).not.toContain('"is_enabled"');
    expect(update.params).toContain("tpl-9");
    conferirTenant(update);
    banco.consultas.length = 0;
    await storage.salvarIntegracaoDeAssinatura(PROVEDOR, { ambiente: "producao" });
    const update2 = banco.consultas.find(c => c.sql.startsWith('update "assinatura_integracoes"'))!;
    expect(update2.sql).toContain('"webhook_secret"');
    expect(update2.sql).toContain('"is_enabled"');
    expect(update2.params).toContain(false);
  });
  it("a leitura do admin não traz token nem segredo, só o final do token; ilegível quando não decifra", async () => {
    banco.responder = () => [linhaDaIntegracao({ apiToken: "enc:lixo", isEnabled: true })];
    const r = await storage.getIntegracaoParaAdmin(PROVEDOR);
    expect(r).toBeDefined();
    expect(Object.keys(r!)).not.toContain("apiToken");
    expect(Object.keys(r!)).not.toContain("webhookSecret");
    expect(r).toMatchObject({ configurada: true, apiTokenGravado: true, apiTokenIlegivel: true, apiTokenFinal: null });
    conferirTenant(banco.consultas[0]);
    const { encryptField } = await import("../utils/crypto");
    banco.responder = () => [linhaDaIntegracao({ apiToken: encryptField("abcdef1234") })];
    expect(await storage.getIntegracaoParaAdmin(PROVEDOR)).toMatchObject({ apiTokenIlegivel: false, apiTokenFinal: "1234" });
  });
  it("a credencial decifrada só sai por getIntegracaoComCredencial; ilegível lança CREDENCIAL_ILEGIVEL", async () => {
    const { encryptField } = await import("../utils/crypto");
    banco.responder = () => [linhaDaIntegracao({ apiToken: encryptField("tok-1"), isEnabled: true })];
    expect((await storage.getIntegracaoComCredencial(PROVEDOR))?.apiToken).toBe("tok-1");
    banco.responder = () => [linhaDaIntegracao({ apiToken: "enc:lixo" })];
    await expect(storage.getIntegracaoComCredencial(PROVEDOR)).rejects.toMatchObject({ codigo: "CREDENCIAL_ILEGIVEL" });
    banco.responder = () => [linhaDaIntegracao({ apiToken: null })];
    expect(await storage.getIntegracaoComCredencial(PROVEDOR)).toBeUndefined();
  });
});

/**
 * Um Postgres de mentira para as leituras do selo: responde às colunas que o
 * SELECT pede, filtra pelos clientes e status que o WHERE pede e respeita o
 * ORDER BY por `assinada_em` e o LIMIT — como o banco faria. Assim o teste vale
 * para a leitura de antes e a de agora, e o que ele prende é o RESULTADO.
 */
function bancoDoSelo(linhas: Array<Record<string, unknown>>) {
  return (sqlTexto: string, params: unknown[]): unknown[][] => {
    const valor = (n: string) => params[Number(n) - 1];
    const dosParametros = (trecho: RegExpMatchArray | null) => new Set(trecho ? [...trecho[1].matchAll(/\$(\d+)/g)].map(m => valor(m[1])) : []);
    const colunas = [...sqlTexto.slice("select ".length, sqlTexto.indexOf(" from ")).matchAll(/"(\w+)"/g)].map(m => m[1]);
    const clientes = dosParametros(sqlTexto.match(/"customer_id" (?:= |in \()([^)]*?)(?:\)| and| order| limit|$)/));
    const status = dosParametros(sqlTexto.match(/"status" (?:= |in \()([^)]*?)(?:\)| and| order| limit|$)/));
    let resultado = linhas.filter(l => clientes.has(l.customer_id) && status.has(l.status));
    const ordem = sqlTexto.match(/"assinada_em" (asc|desc)/);
    if (ordem) resultado = [...resultado].sort((a, b) => String(a.assinada_em).localeCompare(String(b.assinada_em)) * (ordem[1] === "asc" ? 1 : -1));
    const limite = sqlTexto.match(/limit \$(\d+)/);
    if (limite) resultado = resultado.slice(0, Number(valor(limite[1])));
    return resultado.map(l => colunas.map(c => l[c] ?? null));
  };
}

describe("o selo do cliente: só produção tem efeito jurídico", () => {
  const linhas = [
    { id: 70, customer_id: 42, status: "assinada", ambiente: "producao", assinada_em: "2026-08-01 12:00:00", valor_total: "819.76" },
    { id: 90, customer_id: 42, status: "assinada", ambiente: "sandbox", assinada_em: "2026-09-12 15:00:00", valor_total: "10.00" },
    { id: 71, customer_id: 43, status: "quitada", ambiente: "producao", assinada_em: "2026-08-02 12:00:00", valor_total: "500.00" },
    { id: 60, customer_id: 43, status: "assinada", ambiente: "sandbox", assinada_em: "2026-07-20 12:00:00", valor_total: "10.00" },
    { id: 95, customer_id: 44, status: "assinada", ambiente: "sandbox", assinada_em: "2026-09-10 12:00:00", valor_total: "10.00" },
  ];
  it("título de produção de 01/08 vence o teste de sandbox de 12/09; quitado + teste antigo não acende nada; só teste acende o TESTE", async () => {
    banco.responder = bancoDoSelo(linhas);
    expect(await storage.confissaoAssinadaVivaDoCliente(PROVEDOR, 42)).toMatchObject({ id: 70, ambiente: "producao", valorTotal: 819.76 });
    expect(await storage.confissaoAssinadaVivaDoCliente(PROVEDOR, 43)).toBeUndefined();
    expect(await storage.confissaoAssinadaVivaDoCliente(PROVEDOR, 44)).toMatchObject({ id: 95, ambiente: "sandbox" });
    for (const c of banco.consultas) conferirTenant(c);
  });
  it("a leitura da lista e do quadro escolhe igual à do 360, cliente a cliente", async () => {
    banco.responder = bancoDoSelo(linhas);
    const mapa = await storage.confissoesAssinadasVivasPorCliente(PROVEDOR, [42, 43, 44]);
    expect([...mapa.entries()].map(([cliente, selo]) => [cliente, selo.id, selo.ambiente]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([[42, 70, "producao"], [44, 95, "sandbox"]]);
    conferirTenant(banco.consultas[0]);
  });
});

describe("confissões", () => {
  const nova = {
    customerId: 42, casoId: 9, negociacaoId: null, origem: "saldo_integral" as const, ambiente: "producao" as const,
    valorTotal: 719.86, valorOriginal: null, descontoPct: null, parcelas: [{ n: 1, rotulo: "parcela" as const, valor: 719.86, vencimento: "2026-10-10" }],
    erpSource: "mk", erpLidoEm: new Date("2026-09-09T17:30:00Z"), erpFaturas: [], modelo: "padrao" as const, modeloVersao: "1.0", modeloRevisado: false,
    baseCanonica: { versao: "1.0" }, textoHash: "abc", geradoEm: new Date("2026-09-09T17:31:00Z"),
    clienteNome: "Maria", clienteCpfCnpj: "12345678901", clienteEmail: "m@x.com", clienteTelefone: "31999990000", clienteEmailErp: "m@x.com", clienteTelefoneErp: "31999990000",
    contatoAlteradoPorUserId: null, representanteNome: null, representanteCpf: null, dataLimiteAssinatura: "2026-09-24", criadaPorUserId: 7, aprovadaPorUserId: 7, chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-000000000001",
  };
  it("criar grava com o tenant e converte os decimais; a constraint de confissão viva vira CONFISSAO_VIVA", async () => {
    banco.responder = () => [[77]];
    const c = await storage.criarConfissao(PROVEDOR, nova);
    expect(c.id).toBe(77);
    const insert = banco.consultas[0];
    expect(insert.sql.startsWith('insert into "cobranca_confissoes"')).toBe(true);
    expect(insert.params).toContain(PROVEDOR);
    expect(insert.params).toContain("719.86");
    banco.db.insert = () => { throw Object.assign(new Error("duplicate key"), { code: "23505", constraint: "cobranca_confissoes_viva_uq" }); };
    await expect(storage.criarConfissao(PROVEDOR, nova)).rejects.toMatchObject({ codigo: "CONFISSAO_VIVA" });
  });
  it("toda leitura leva o provider_id", async () => {
    banco.responder = () => [];
    await storage.obterConfissao(PROVEDOR, 77);
    await storage.obterConfissaoPorToken(PROVEDOR, "doc-1");
    await storage.obterConfissaoPorChave(PROVEDOR, "5f0c9d1e-2b1a-4c3d-9e8f-000000000001");
    await storage.confissaoVivaDoCliente(PROVEDOR, 42);
    await storage.confissaoAssinadaVivaDoCliente(PROVEDOR, 42);
    await storage.confissaoEnviadaDaNegociacao(PROVEDOR, 3);
    await storage.listarConfissoesDoCliente(PROVEDOR, 42);
    await storage.confissoesAssinadasVivasPorCliente(PROVEDOR, [42, 43]);
    expect(banco.consultas).toHaveLength(8);
    for (const c of banco.consultas) {
      conferirTenant(c);
      expect(c.sql, "os PDFs nunca vêm junto").not.toContain('"cobranca_confissoes_pdf"');
    }
    banco.consultas.length = 0;
    expect((await storage.confissoesAssinadasVivasPorCliente(PROVEDOR, [])).size).toBe(0);
    expect(banco.consultas).toHaveLength(0);
  });
  it("a transição é atômica: WHERE status = de; transição proibida não vai ao banco", async () => {
    banco.responder = () => [[77]];
    const r = await storage.transicionarConfissao(PROVEDOR, 77, "enviada", "assinada", { assinadaEm: new Date("2026-09-10T12:00:00Z") });
    expect(r?.id).toBe(77);
    const update = banco.consultas[0];
    expect(update.sql.startsWith('update "cobranca_confissoes"')).toBe(true);
    expect(update.sql).toMatch(/"status" = \$\d+/);
    expect(update.params).toEqual(expect.arrayContaining([PROVEDOR, 77, "enviada", "assinada"]));
    expect(update.sql).toContain("returning");
    banco.consultas.length = 0;
    banco.responder = () => [];
    expect(await storage.transicionarConfissao(PROVEDOR, 77, "enviada", "assinada")).toBeUndefined();
    banco.consultas.length = 0;
    await expect(storage.transicionarConfissao(PROVEDOR, 77, "assinada", "cancelada")).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(banco.consultas).toHaveLength(0);
  });
  it("o PDF só sai por obterPdf; guardar calcula o sha256 e faz upsert por (confissao_id, tipo)", async () => {
    banco.responder = texto => texto.startsWith("select") ? [[77]] : [];
    const bytes = Buffer.from("%PDF-1.4 teste");
    const r = await storage.guardarPdf(PROVEDOR, 77, "original", bytes);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.tamanhoBytes).toBe(bytes.length);
    const insert = banco.consultas.find(c => c.sql.startsWith('insert into "cobranca_confissoes_pdf"'))!;
    expect(insert.sql).toContain("on conflict");
    expect(insert.params).toContain(bytes.toString("base64"));
    expect(banco.consultas.some(c => c.sql.startsWith('update "cobranca_confissoes"') && c.sql.includes('"pdf_original_sha256"'))).toBe(true);
    banco.consultas.length = 0;
    banco.responder = () => [[bytes.toString("base64"), r.sha256, bytes.length]];
    const pdf = await storage.obterPdf(PROVEDOR, 77, "original", { registrarDownload: true });
    expect(pdf?.bytes.equals(bytes)).toBe(true);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas.some(c => c.sql.startsWith('update "cobranca_confissoes_pdf"') && c.sql.includes('"baixado_em"'))).toBe(true);
  });
  it("guardarPdf recusa confissão de outro provedor sem inserir nada", async () => {
    banco.responder = () => [];
    await expect(storage.guardarPdf(PROVEDOR, 77, "original", Buffer.from("%PDF-1.4"))).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA", http: 404 });
    expect(banco.consultas.some(c => c.sql.startsWith("insert"))).toBe(false);
    conferirTenant(banco.consultas[0]);
  });
  it("substituir só alcança assinadas do MESMO ambiente: um teste de sandbox assinado nunca rebaixa o título de produção", async () => {
    banco.responder = () => [];
    await storage.marcarSubstituidas(PROVEDOR, 42, 78, "sandbox");
    const update = banco.consultas[0];
    expect(update.sql.startsWith('update "cobranca_confissoes"')).toBe(true);
    expect(update.sql).toMatch(/"ambiente" = \$\d+/);
    expect(update.params).toEqual(expect.arrayContaining(["substituida", PROVEDOR, 42, "assinada", 78, "sandbox"]));
    conferirTenant(update);
  });
  it("a quitação gira: ordena pelo carimbo da última verificação (nulos primeiro) e pelo id, no limite pedido; carimbar não mexe em updated_at", async () => {
    banco.responder = () => [];
    await storage.confissoesAssinadasParaQuitacao(2);
    const selecao = banco.consultas[0];
    expect(selecao.sql).toMatch(/"status" = \$\d+/);
    expect(selecao.sql).toMatch(/order by "cobranca_confissoes"\."quitacao_verificada_em" asc nulls first, "cobranca_confissoes"\."id" asc limit \$\d+$/);
    expect(selecao.params).toEqual(["assinada", 2]);
    banco.consultas.length = 0;
    const quando = new Date("2026-09-12T12:00:00Z");
    await storage.marcarQuitacaoVerificada(PROVEDOR, 77, quando);
    const carimbo = banco.consultas[0];
    expect(carimbo.sql).toMatch(/^update "cobranca_confissoes" set "quitacao_verificada_em" = \$1 where/);
    // updated_at é "última alteração" para a tela, e a retenção de 90 dias (sandbox) conta a partir dele.
    expect(carimbo.sql).not.toContain('"updated_at"');
    expect(carimbo.params).toContain(77);
    conferirTenant(carimbo);
  });
  it("worker e LGPD: reconciliar por prazo, expirar pela data limite, retenção só do que não é título, anonimizar apaga PDFs", async () => {
    banco.responder = () => [];
    await storage.confissoesParaReconciliar(new Date("2026-09-10T12:00:00Z"), 60 * 60 * 1000);
    expect(banco.consultas[0].sql).toContain('"status" = $');
    expect(banco.consultas[0].sql).toMatch(/"reconciliar_em" <= \$\d+/);
    expect(banco.consultas[0].sql).toMatch(/"enviada_em" <= \$\d+/);
    banco.consultas.length = 0;
    await storage.confissoesParaExpirar("2026-09-25");
    expect(banco.consultas[0].sql).toMatch(/"data_limite_assinatura" < \$\d+/);
    banco.consultas.length = 0;
    await storage.confissoesParaRetencao(new Date("2026-06-11T00:00:00Z"));
    expect(banco.consultas[0].sql).toContain("'sandbox'");
    expect(banco.consultas[0].sql).toContain('"cliente_cpf_cnpj" is not null');
    banco.consultas.length = 0;
    await storage.anonimizarConfissao(PROVEDOR, 77);
    expect(banco.consultas.some(c => c.sql.startsWith('delete from "cobranca_confissoes_pdf"'))).toBe(true);
    const update = banco.consultas.find(c => c.sql.startsWith('update "cobranca_confissoes"'))!;
    for (const col of ['"cliente_nome"', '"cliente_cpf_cnpj"', '"cliente_email"', '"cliente_telefone"', '"parcelas"', '"erp_faturas"', '"zapsign_signers"', '"base_canonica"']) expect(update.sql).toContain(col);
    expect(update.sql).not.toContain('"texto_hash"');
    expect(update.sql).not.toContain('"status"');
    for (const c of banco.consultas) conferirTenant(c);
  });
});
