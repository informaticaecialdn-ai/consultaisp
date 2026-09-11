import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Emitir é a única escrita que fala com o ZapSign para CRIAR. O que se prova:
 * a chave de idempotência devolve a mesma confissão sem chamar o ZapSign; a
 * trava ocupada é 409; hash divergente é "A dívida mudou"; bloqueio da base é
 * 422; sandbox exige confirmoTeste; o caminho feliz grava rascunho + PDF,
 * cria o documento com os campos da spec, registra o webhook DO documento com
 * o cabeçalho secreto, passa a `enviada` e grava evento + follow-up; contato
 * alterado liga validate_cpf; falha depois de criar o documento apaga o órfão
 * no ZapSign, encerra o rascunho como `cancelada` com o motivo em `erro_ultimo`
 * e libera a chave de idempotência — nada é dito como enviado.
 */
const storageMock = vi.hoisted(() => ({
  obterConfissaoPorChave: vi.fn(async (): Promise<any> => undefined),
  confissaoVivaDoCliente: vi.fn(async (): Promise<any> => undefined),
  criarConfissao: vi.fn(async (_p: number, d: any): Promise<any> => ({ id: 77, providerId: 1, status: "rascunho", ...d })),
  guardarPdf: vi.fn(async (): Promise<any> => ({ sha256: "abc", tamanhoBytes: 10 })),
  transicionarConfissao: vi.fn(async (_p: number, id: number, _de: string, para: string, patch: any): Promise<any> => ({ id, status: para, casoId: 9, customerId: 42, valorTotal: "819.76", ambiente: "producao", ...patch })),
  atualizarConfissao: vi.fn(async (): Promise<any> => ({ id: 77 })),
  registrarEventoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 500 })),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9 })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto" })),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const baseMock = vi.hoisted(() => ({ montarBase: vi.fn(async (): Promise<any> => base()) }));
vi.mock("./confissao-base.service", () => baseMock);
const travaMock = vi.hoisted(() => ({ comTravaDoChat: vi.fn(async (_chave: string, fn: () => Promise<unknown>) => fn()) }));
vi.mock("../chat/chat-trava", () => travaMock);
const zapsign = vi.hoisted(() => ({
  criarDocumentoPorPdf: vi.fn(async (): Promise<any> => ({ token: "doc-1", status: "pending", sandbox: false, signers: [{ token: "s-1", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-1", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: "cliente" }] })),
  criarDocumentoPorModelo: vi.fn(async (): Promise<any> => ({ token: "doc-2", status: "pending", sandbox: false, signers: [{ token: "s-9", status: "new", sign_url: "u", signed_at: null, auth_mode: null, external_id: null }] })),
  adicionarSignatario: vi.fn(async (): Promise<any> => ({ token: "s-2", status: "new", sign_url: "u2", signed_at: null, auth_mode: "assinaturaTela-tokenEmail", external_id: "provedor" })),
  atualizarSignatario: vi.fn(async (): Promise<any> => ({ token: "s-9", status: "new", sign_url: "u", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: null })),
  registrarWebhookDoDocumento: vi.fn(async (): Promise<any> => ({ id: "w-1" })),
  excluirDocumento: vi.fn(async (): Promise<void> => undefined),
  excluirWebhook: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("../../assinatura/zapsign", () => ({ clienteZapSign: () => zapsign }));
vi.mock("../../assinatura/pdf", () => ({ gerarPdfDaConfissao: vi.fn(async () => Buffer.from("%PDF-1.4 x")) }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../logger", () => ({ logger: loggerMock }));

import { CABECALHO_DO_WEBHOOK, emitirConfissao, urlDoWebhookDeAssinatura } from "./confissao-emissao.service";
import { ErroDeConfissao } from "../../assinatura/erro";

function base(extra: Record<string, any> = {}) {
  const canonica = { versao: "1.0", origem: "saldo_integral", ambiente: "producao", modeloRevisado: false,
    credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: null, representante: null },
    devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: null, email: "maria@example.com", telefone: "31999990000" },
    cadastroErp: "4471", plano: null, inicioContrato: null, erpLidoEm: "2026-09-10T13:00:00.000Z", valorTotal: 819.76, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null,
    parcelas: [{ n: 1, rotulo: "parcela", valor: 819.76, vencimento: "2026-10-10" }], meioDePagamento: "boleto ou PIX enviado pelo credor", encargos: { multaPct: 2, jurosMesPct: 1 }, anexo: [] };
  return {
    dto: { origem: "saldo_integral", casoId: 9, negociacaoId: null, cliente: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, email: "maria@example.com", telefone: "31999990000", endereco: null },
      valorTotal: 819.76, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null, encargos: { multa: 4, juros: 3.09, multaPct: 2, jurosMesPct: 1 }, parcelas: canonica.parcelas, anexo: [], faturasIndeterminadas: 0, faturasDeSaida: [],
      erpSource: "mk", erpLidoEm: "2026-09-10T13:00:00.000Z", dividaAtualDoErp: 819.76, vencimento: { minimo: "2026-09-26", maximo: "2026-12-09", escolhido: "2026-10-10" }, bloqueios: [], avisos: [], prescrita: false, baseHash: "h1", previa: null,
      custo: { creditos: 5, reais: 0.5, texto: "" }, ambiente: "producao", modeloRevisado: false },
    entrada: canonica, canonica, hash: "h1",
    cliente: { id: 42, name: "Maria da Silva", cpfCnpj: "12345678901", email: "maria@example.com", phone: "31999990000", erpCustomerId: "4471", contractPlan: null, contractStartDate: null },
    provedor: { id: 1, name: "NsLink Telecom Ltda", tradeName: "NsLink", cnpj: "12345678000199" },
    caso: { id: 9, status: "aberto" }, negociacao: null,
    integracao: { apiToken: "tok", ambiente: "producao", templateId: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null, isEnabled: true, webhookSecret: "segredo-do-webhook", signatarioNome: null, signatarioEmail: null, signatarioCpf: null, signatarioTelefone: null },
    encargos: { multaPct: 2, jurosMesPct: 1 }, contatoAlterado: false, contatoDoErp: { email: "maria@example.com", telefone: "31999990000" }, snapshot: null,
    ...extra,
  };
}
const corpo = () => ({ origem: "saldo_integral" as const, vencimento: "2026-10-10", faturasExcluidas: [], clienteEmail: null, clienteTelefone: null, representante: null, baseHash: "h1", chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-000000000001", confirmoTeste: false, confirmoPrescricao: false });

beforeEach(() => { vi.clearAllMocks(); baseMock.montarBase.mockResolvedValue(base()); });

describe("emitir a confissão", () => {
  it("a mesma chave de idempotência devolve a confissão já criada sem falar com o ZapSign", async () => {
    storageMock.obterConfissaoPorChave.mockResolvedValueOnce({ id: 70, status: "enviada" });
    const r = await emitirConfissao(1, 42, 7, corpo());
    expect(r.id).toBe(70);
    expect(zapsign.criarDocumentoPorPdf).not.toHaveBeenCalled();
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
  });
  it("a mesma chave com um rascunho que nunca foi enviado encerra o rascunho, libera a chave e emite de novo", async () => {
    storageMock.obterConfissaoPorChave.mockResolvedValue({ id: 70, status: "rascunho", customerId: 42, zapsignDocToken: null, erroUltimo: "O ZapSign não respondeu (HTTP 503)" });
    const r = await emitirConfissao(1, 42, 7, corpo());
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 70, "rascunho", "cancelada", expect.objectContaining({ chaveIdempotencia: null, erroUltimo: expect.stringContaining("503") }));
    expect(storageMock.criarConfissao).toHaveBeenCalled();
    expect(zapsign.criarDocumentoPorPdf).toHaveBeenCalled();
    expect(r.status).toBe("enviada");
    storageMock.obterConfissaoPorChave.mockResolvedValue(undefined);
  });
  it("um rascunho pela chave NÃO é encerrado fora da trava: trava ocupada devolve EM_ANDAMENTO sem tocar na linha", async () => {
    storageMock.obterConfissaoPorChave.mockResolvedValueOnce({ id: 70, status: "rascunho", customerId: 42, zapsignDocToken: null, erroUltimo: null });
    travaMock.comTravaDoChat.mockResolvedValueOnce(null);
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "EM_ANDAMENTO" });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
  it("chave de outro cliente dentro da trava é recusada", async () => {
    storageMock.obterConfissaoPorChave.mockResolvedValue({ id: 70, status: "rascunho", customerId: 99, zapsignDocToken: null });
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BASE_MUDOU" });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
    storageMock.obterConfissaoPorChave.mockResolvedValue(undefined);
  });
  it("trava ocupada é EM_ANDAMENTO; a chave da trava é por provedor e cliente", async () => {
    travaMock.comTravaDoChat.mockResolvedValueOnce(null);
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "EM_ANDAMENTO", http: 409 });
    expect(travaMock.comTravaDoChat.mock.calls[0][0]).toBe("confissao:1:42");
  });
  it("hash divergente, bloqueio, origem trocada e sandbox sem confirmação recusam antes de gravar", async () => {
    await expect(emitirConfissao(1, 42, 7, { ...corpo(), baseHash: "outro" })).rejects.toMatchObject({ codigo: "BASE_MUDOU" });
    baseMock.montarBase.mockResolvedValueOnce(base({ dto: { ...base().dto, bloqueios: ["abra o caso antes"] } }));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BLOQUEADA", http: 422, detalhes: { bloqueios: ["abra o caso antes"] } });
    await expect(emitirConfissao(1, 42, 7, { ...corpo(), origem: "acordo" })).rejects.toMatchObject({ codigo: "BASE_MUDOU" });
    const sandbox = base({ dto: { ...base().dto, ambiente: "sandbox" }, integracao: { ...base().integracao, ambiente: "sandbox" } });
    baseMock.montarBase.mockResolvedValueOnce(sandbox);
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BLOQUEADA" });
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
    expect(baseMock.montarBase).toHaveBeenCalledWith(1, 42, expect.objectContaining({ vencimento: "2026-10-10", faturasExcluidas: [] }));
  });
  it("caminho feliz: rascunho + PDF, documento com os campos da spec, webhook do documento com o cabeçalho, enviada, evento e follow-up", async () => {
    const r = await emitirConfissao(1, 42, 7, corpo());
    expect(storageMock.criarConfissao).toHaveBeenCalledWith(1, expect.objectContaining({ customerId: 42, casoId: 9, origem: "saldo_integral", ambiente: "producao", valorTotal: 819.76, modelo: "padrao", modeloVersao: "1.0", textoHash: "h1", clienteCpfCnpj: "12345678901", chaveIdempotencia: corpo().chaveIdempotencia, criadaPorUserId: 7, aprovadaPorUserId: 7, contatoAlteradoPorUserId: null }));
    expect(storageMock.guardarPdf).toHaveBeenCalledWith(1, 77, "original", expect.any(Buffer));
    const doc = zapsign.criarDocumentoPorPdf.mock.calls[0][0];
    expect(doc).toMatchObject({ name: "Confissão de dívida — Maria da Silva — NsLink", external_id: "confissao:77", folder_path: "consulta-isp/1", lang: "pt-br", reminder_every_n_days: 3, allow_refuse_signature: true, signature_order_active: false, brand_name: "NsLink" });
    expect(doc.date_limit_to_sign).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.base64_pdf).toBe(Buffer.from("%PDF-1.4 x").toString("base64"));
    expect(doc.signers).toHaveLength(1);
    expect(doc.signers[0]).toMatchObject({ name: "Maria da Silva", email: "maria@example.com", phone_country: "55", phone_number: "31999990000", auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true, validate_cpf: false, require_selfie_photo: false, send_automatic_email: true, send_automatic_whatsapp: true, lock_name: true, external_id: "cliente" });
    expect(zapsign.registrarWebhookDoDocumento).toHaveBeenCalledWith({ url: urlDoWebhookDeAssinatura(1), docToken: "doc-1", cabecalho: { nome: CABECALHO_DO_WEBHOOK, valor: "segredo-do-webhook" } });
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "rascunho", "enviada", expect.objectContaining({ zapsignDocToken: "doc-1", webhookZapsignId: "w-1", zapsignSandbox: false, erroUltimo: null, zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "https://app.zapsign.com.br/verificar/s-1", status: "new", signedAt: null, authMode: "assinaturaTela-tokenWhatsapp" }] }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ casoId: 9, userId: 7, tipo: "confissao", canal: "sistema", metadata: expect.objectContaining({ confissaoId: 77, status: "enviada", valor: 819.76, ambiente: "producao", contatoAlterado: false }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("aguardar assinatura"), proximoContatoEm: expect.any(Date) }), 7);
    expect(r.status).toBe("enviada");
  });
  it("contato alterado: validate_cpf ligado, metadata.contatoAlterado, quem alterou gravado; sandbox não envia nada automático", async () => {
    baseMock.montarBase.mockResolvedValueOnce(base({ contatoAlterado: true, dto: { ...base().dto, cliente: { ...base().dto.cliente, email: "outro@example.com" } }, canonica: { ...base().canonica, devedor: { ...base().canonica.devedor, email: "outro@example.com" } } }));
    await emitirConfissao(1, 42, 7, { ...corpo(), clienteEmail: "outro@example.com" });
    expect(zapsign.criarDocumentoPorPdf.mock.calls[0][0].signers[0]).toMatchObject({ email: "outro@example.com", validate_cpf: true });
    expect(storageMock.criarConfissao).toHaveBeenCalledWith(1, expect.objectContaining({ contatoAlteradoPorUserId: 7, clienteEmail: "outro@example.com", clienteEmailErp: "maria@example.com" }));
    expect(storageMock.registrarEventoDeCobranca.mock.calls[0][1].metadata.contatoAlterado).toBe(true);
    vi.clearAllMocks();
    const sandbox = base({ dto: { ...base().dto, ambiente: "sandbox" }, integracao: { ...base().integracao, ambiente: "sandbox" }, canonica: { ...base().canonica, ambiente: "sandbox" } });
    baseMock.montarBase.mockResolvedValueOnce(sandbox);
    await emitirConfissao(1, 42, 7, { ...corpo(), confirmoTeste: true });
    expect(zapsign.criarDocumentoPorPdf.mock.calls[0][0].signers[0]).toMatchObject({ send_automatic_email: false, send_automatic_whatsapp: false });
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalled(); // o follow-up "aguardar assinatura" existe também no teste; o que não existe em sandbox é o "título assinado"
  });
  it("provedor assina: dois signatários, provedor primeiro, ordem ativa; modelo do ZapSign: create-doc + atualizar signatário", async () => {
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, provedorAssina: true, signatarioNome: "Ana Link", signatarioEmail: "ana@nslink.com", signatarioCpf: "11122233344" } }));
    await emitirConfissao(1, 42, 7, corpo());
    const doc = zapsign.criarDocumentoPorPdf.mock.calls[0][0];
    expect(doc.signature_order_active).toBe(true);
    expect(doc.signers.map((s: any) => [s.external_id, s.order_group, s.auth_mode])).toEqual([["provedor", 1, "assinaturaTela-tokenEmail"], ["cliente", 2, "assinaturaTela-tokenWhatsapp"]]);
    vi.clearAllMocks();
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, templateId: "tpl-1" } }));
    await emitirConfissao(1, 42, 7, corpo());
    expect(zapsign.criarDocumentoPorPdf).not.toHaveBeenCalled();
    expect(zapsign.criarDocumentoPorModelo.mock.calls[0][0]).toMatchObject({ template_id: "tpl-1", signer_name: "Maria da Silva", external_id: "confissao:77" });
    expect(zapsign.criarDocumentoPorModelo.mock.calls[0][0].data.find((v: any) => v.de === "{{VALOR_TOTAL}}").para).toBe("R$ 819,76");
    expect(zapsign.atualizarSignatario).toHaveBeenCalledWith("s-9", expect.objectContaining({ auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true }));
    expect(storageMock.criarConfissao).toHaveBeenCalledWith(1, expect.objectContaining({ modelo: "zapsign", modeloVersao: "tpl-1" }));
  });
  it.each([null, ""])("segredo do webhook %j: recusa antes de criar o rascunho e o documento — um webhook sem cabeçalho nunca autenticaria o retorno", async (segredo) => {
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, webhookSecret: segredo } }));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "NAO_CONFIGURADA" });
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
    expect(zapsign.criarDocumentoPorPdf).not.toHaveBeenCalled();
    expect(zapsign.registrarWebhookDoDocumento).not.toHaveBeenCalled();
  });
  it("provedor assina sem representante completo (nome, CPF e e-mail) recusa antes de gravar", async () => {
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, provedorAssina: true, signatarioNome: null, signatarioEmail: null } }));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BLOQUEADA" });
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, provedorAssina: true, signatarioNome: "Ana Link", signatarioEmail: "ana@nslink.com", signatarioCpf: null } }));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BLOQUEADA", message: expect.stringContaining("nome, CPF e e-mail") });
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
  });
  it("falha ao registrar o webhook apaga o documento órfão, encerra o rascunho e libera a chave", async () => {
    zapsign.registrarWebhookDoDocumento.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "O ZapSign não respondeu (HTTP 503)", 502));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    expect(zapsign.excluirDocumento).toHaveBeenCalledWith("doc-1");
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "rascunho", "cancelada", expect.objectContaining({ erroUltimo: expect.stringContaining("HTTP 503"), chaveIdempotencia: null }));
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalledWith(1, 77, "rascunho", "enviada", expect.anything());
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it.each([
    ["o evento no caso", () => storageMock.registrarEventoDeCobranca.mockRejectedValueOnce(new Error("conexão com o banco caiu"))],
    ["o follow-up do caso", () => storageMock.atualizarCasoDeCobranca.mockRejectedValueOnce(new Error("conexão com o banco caiu"))],
  ])("%s falhando DEPOIS de `enviada` não apaga o documento já enviado: a emissão aconteceu e responde sucesso, com warn no log", async (_efeito, falhar) => {
    falhar();
    const r = await emitirConfissao(1, 42, 7, corpo());
    expect(r.status).toBe("enviada");
    expect(zapsign.excluirDocumento).not.toHaveBeenCalled();
    expect(zapsign.excluirWebhook).not.toHaveBeenCalled();
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalledWith(1, 77, "rascunho", "cancelada", expect.anything());
    const aviso = loggerMock.warn.mock.calls.find(c => c[0]?.confissaoId === 77);
    expect(aviso, "warn com a confissão").toBeDefined();
    expect(aviso![0]).toMatchObject({ providerId: 1, confissaoId: 77, casoId: 9 });
    // Sem dado pessoal no log: nem nome nem documento do devedor.
    expect(JSON.stringify(aviso)).not.toMatch(/Maria|12345678901/);
  });
  it("confissão viva existente recusa antes de gravar", async () => {
    storageMock.confissaoVivaDoCliente.mockResolvedValueOnce({ id: 60, status: "enviada" });
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "CONFISSAO_VIVA", detalhes: { confissaoId: 60 } });
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
    storageMock.confissaoVivaDoCliente.mockResolvedValueOnce({ id: 61, status: "rascunho", zapsignDocToken: null, erroUltimo: null });
    await emitirConfissao(1, 42, 7, corpo());
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 61, "rascunho", "cancelada", expect.objectContaining({ chaveIdempotencia: null, erroUltimo: "emissão interrompida antes do envio" }));
    expect(storageMock.criarConfissao).toHaveBeenCalled();
  });
});
