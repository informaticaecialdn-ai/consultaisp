import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O ciclo da confissão com os serviços REAIS — emissão, retorno e
 * reconciliação — sobre uma tabela em memória. Só o conector do ZapSign, o
 * `montarBase`, a trava e o gerador de PDF são dublados.
 *
 * Existe porque os testes unitários de cada serviço dublam os vizinhos, e há
 * defeitos que só aparecem na costura: um serviço grava um campo que o outro lê
 * como marca (o aviso ao provedor que o `aplicarRetorno` apagava), ou um estado
 * que só um terceiro serviço consegue desfazer (a vaga de "uma confissão viva
 * por cliente" presa por um 404 do ZapSign). A tabela em memória imita o que o
 * banco garante: transição atômica `WHERE status = de` e o índice parcial
 * `cobranca_confissoes_viva_uq` (uma rascunho/enviada por cliente).
 */
const fake = vi.hoisted(() => ({ storage: {} as Record<string, (...args: any[]) => any> }));
vi.mock("../../storage", () => ({ storage: new Proxy({}, { get: (_alvo, chave) => fake.storage[chave as string] }) }));
const zap = vi.hoisted(() => ({
  detalharDocumento: vi.fn(),
  excluirDocumento: vi.fn(),
  excluirWebhook: vi.fn(),
  baixarArquivo: vi.fn(),
  reenviarNotificacoes: vi.fn(),
  criarDocumentoPorPdf: vi.fn(),
  criarDocumentoPorModelo: vi.fn(),
  adicionarSignatario: vi.fn(),
  atualizarSignatario: vi.fn(),
  registrarWebhookDoDocumento: vi.fn(),
}));
vi.mock("../../assinatura/zapsign", () => ({ clienteZapSign: () => zap }));
vi.mock("../../assinatura/pdf", () => ({ LIMITE_DO_PDF_BYTES: 8 * 1024 * 1024, gerarPdfDaConfissao: async () => Buffer.from("%PDF-1.4 x") }));
const baseMock = vi.hoisted(() => ({ montarBase: vi.fn() }));
vi.mock("./confissao-base.service", () => baseMock);
vi.mock("../chat/chat-trava", () => ({ comTravaDoChat: async (_chave: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ErroDeConfissao } from "../../assinatura/erro";
import { emitirConfissao } from "./confissao-emissao.service";
import { cancelarConfissao } from "./confissao-retorno.service";
import { _reiniciarReconciliacaoParaTestes, rodarReconciliacao } from "./confissao-reconciliacao.service";

const PROVEDOR = 1;
const CLIENTE = 42;
const AGORA = new Date("2026-09-12T12:00:00Z");

let confissoes: Map<number, any>;
let eventos: any[];
let followUps: Array<{ casoId: number; patch: any }>;
let integracao: Record<string, unknown>;
let statusDoCaso: string;

const viva = (status: string) => status === "rascunho" || status === "enviada";
const copia = <T>(l: T): T => (l === undefined ? l : structuredClone(l));

function tabelaEmMemoria() {
  let proximoId = 100;
  const linha = (p: number, id: number) => { const l = confissoes.get(id); return l && l.providerId === p ? l : undefined; };
  return {
    obterConfissao: async (p: number, id: number) => copia(linha(p, id)),
    obterConfissaoPorChave: async (p: number, chave: string) => copia([...confissoes.values()].find(l => l.providerId === p && l.chaveIdempotencia === chave)),
    confissaoVivaDoCliente: async (p: number, customerId: number) => copia([...confissoes.values()].filter(l => l.providerId === p && l.customerId === customerId && viva(l.status)).sort((a, b) => b.id - a.id)[0]),
    criarConfissao: async (p: number, d: any) => {
      // O índice parcial do banco: uma confissão viva por cliente.
      if ([...confissoes.values()].some(l => l.providerId === p && l.customerId === d.customerId && viva(l.status))) {
        throw new ErroDeConfissao("CONFISSAO_VIVA", "Este cliente já tem uma confissão em andamento — cancele-a antes de emitir outra", 409);
      }
      const nova = { ...structuredClone(d), id: proximoId++, providerId: p, status: "rascunho", zapsignSigners: [], erroUltimo: null, reconciliarEm: null, enviadaEm: null, updatedAt: AGORA };
      confissoes.set(nova.id, nova);
      return copia(nova);
    },
    guardarPdf: async () => ({ sha256: "s", tamanhoBytes: 10 }),
    atualizarConfissao: async (p: number, id: number, patch: any) => { const l = linha(p, id); if (!l) return undefined; Object.assign(l, structuredClone(patch)); return copia(l); },
    transicionarConfissao: async (p: number, id: number, de: string, para: string, patch: any = {}) => {
      const l = linha(p, id);
      if (!l || l.status !== de) return undefined;
      Object.assign(l, structuredClone(patch), { status: para });
      return copia(l);
    },
    marcarSubstituidas: async () => 0,
    confissoesParaReconciliar: async (agora: Date, enviadasHaMaisDeMs: number | null) => [...confissoes.values()]
      .filter(l => l.status === "enviada" && ((l.reconciliarEm && l.reconciliarEm <= agora) || (enviadasHaMaisDeMs !== null && l.enviadaEm && l.enviadaEm <= new Date(agora.getTime() - enviadasHaMaisDeMs))))
      .map(copia),
    confissoesParaExpirar: async (hoje: string) => [...confissoes.values()].filter(l => l.status === "enviada" && l.dataLimiteAssinatura < hoje).map(copia),
    confissoesAssinadasParaQuitacao: async () => [],
    marcarQuitacaoVerificada: async () => undefined,
    getIntegracaoComCredencial: async () => ({ ...integracao }),
    obterCasoDeCobranca: async (_p: number, id: number) => ({ id, status: statusDoCaso }),
    registrarEventoDeCobranca: async (_p: number, e: any) => { eventos.push(e); return { id: eventos.length }; },
    atualizarCasoDeCobranca: async (_p: number, casoId: number, patch: any) => { followUps.push({ casoId, patch }); return { id: casoId }; },
  };
}

function enviada(extra: Record<string, any> = {}) {
  return {
    id: 77, providerId: PROVEDOR, customerId: CLIENTE, casoId: 9, negociacaoId: null, status: "enviada", origem: "saldo_integral", ambiente: "producao", valorTotal: "819.76",
    zapsignDocToken: "doc-da-conta-antiga", webhookZapsignId: "w-1", zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "u", status: "new", signedAt: null, authMode: "x" }],
    dataLimiteAssinatura: "2026-09-25", enviadaEm: new Date(AGORA.getTime() - 2 * 60 * 60_000), reconciliarEm: null, erroUltimo: null,
    recusaInformadaEm: null, expiracaoInformadaEm: null, chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-00000000000a", ...extra,
  };
}

function base() {
  const canonica = { versao: "1.0", origem: "saldo_integral", ambiente: "producao", modeloRevisado: false,
    credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: null, representante: null },
    devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: null, email: "maria@example.com", telefone: "31999990000" },
    cadastroErp: "4471", plano: null, inicioContrato: null, erpLidoEm: "2026-09-12T11:59:00.000Z", valorTotal: 819.76, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null,
    parcelas: [{ n: 1, rotulo: "parcela", valor: 819.76, vencimento: "2026-10-10" }], meioDePagamento: "boleto ou PIX enviado pelo credor", encargos: { multaPct: 2, jurosMesPct: 1 }, anexo: [] };
  return {
    dto: { origem: "saldo_integral", casoId: 9, negociacaoId: null, cliente: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, email: "maria@example.com", telefone: "31999990000", endereco: null },
      valorTotal: 819.76, valorOriginal: null, descontoPct: null, parcelas: canonica.parcelas, anexo: [], erpSource: "mk", erpLidoEm: "2026-09-12T11:59:00.000Z",
      bloqueios: [], ambiente: "producao", modeloRevisado: false },
    entrada: canonica, canonica, hash: "h1",
    cliente: { id: CLIENTE, name: "Maria da Silva", cpfCnpj: "12345678901" },
    provedor: { id: PROVEDOR, name: "NsLink Telecom Ltda", tradeName: "NsLink" },
    caso: { id: 9, status: "aberto" },
    integracao: { apiToken: "tok", ambiente: "producao", templateId: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, webhookSecret: "segredo-do-webhook", signatarioNome: null, signatarioEmail: null, signatarioCpf: null },
    contatoAlterado: false, contatoDoErp: { email: "maria@example.com", telefone: "31999990000" },
  };
}
const corpoDaEmissao = () => ({ origem: "saldo_integral" as const, vencimento: "2026-10-10", faturasExcluidas: [], clienteEmail: null, clienteTelefone: null, representante: null, baseHash: "h1", chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-00000000000b" });
const erro404 = () => new ErroDeConfissao("NAO_ENCONTRADA", "O documento não existe no ZapSign", 404);

beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarReconciliacaoParaTestes();
  confissoes = new Map();
  eventos = [];
  followUps = [];
  integracao = { apiToken: "tok", ambiente: "producao", provedorAssina: false, isEnabled: true };
  statusDoCaso = "aberto";
  fake.storage = tabelaEmMemoria();
  baseMock.montarBase.mockResolvedValue(base());
  zap.criarDocumentoPorPdf.mockResolvedValue({ token: "doc-novo", status: "pending", sandbox: false, signers: [{ token: "s-9", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-9", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: "cliente" }] });
  zap.registrarWebhookDoDocumento.mockResolvedValue({ id: "w-2" });
  zap.excluirDocumento.mockResolvedValue(undefined);
  zap.excluirWebhook.mockResolvedValue(undefined);
});

describe("404 do ZapSign (token trocado para outra conta, ou documento expurgado)", () => {
  it("o admin cancela: a confissão vai para cancelada localmente, o erro explica, o evento é gravado — e a vaga do cliente fica livre para uma nova", async () => {
    confissoes.set(77, enviada());
    zap.detalharDocumento.mockRejectedValue(erro404());
    zap.excluirDocumento.mockRejectedValue(erro404());

    const cancelada = await cancelarConfissao(PROVEDOR, 77, 7);
    expect(cancelada.status).toBe("cancelada");
    expect(cancelada.erroUltimo).toBe("documento não encontrado no ZapSign — token trocado ou documento excluído; cancelada sem consulta ao ZapSign");
    expect(cancelada.encerradaEm).toBeInstanceOf(Date);
    // O DELETE foi tentado e o 404 dele, tolerado: o documento já não existe.
    expect(zap.excluirDocumento).toHaveBeenCalledWith("doc-da-conta-antiga");
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ casoId: 9, userId: 7, tipo: "confissao", metadata: { confissaoId: 77, status: "cancelada" } });

    const nova = await emitirConfissao(PROVEDOR, CLIENTE, 7, corpoDaEmissao());
    expect(nova.status).toBe("enviada");
    expect(nova.id).not.toBe(77);
    expect([...confissoes.values()].filter(l => l.customerId === CLIENTE && viva(l.status)).map(l => l.id)).toEqual([nova.id]);
  });

  it("GET em 404 mas DELETE falhando por outro motivo: nada muda localmente — o estado do documento é incerto", async () => {
    confissoes.set(77, enviada());
    zap.detalharDocumento.mockRejectedValue(erro404());
    zap.excluirDocumento.mockRejectedValue(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "O ZapSign não respondeu (HTTP 503)", 502));
    await expect(cancelarConfissao(PROVEDOR, 77, 7)).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    expect(confissoes.get(77).status).toBe("enviada");
    expect(eventos).toHaveLength(0);
  });

  it("a reconciliação automática nunca conclui nada de um 404: nem reconsultando nem expirando, a linha continua enviada", async () => {
    // Passou da data limite E está há mais de 1 h enviada: as duas varreduras a pegam.
    confissoes.set(77, enviada({ dataLimiteAssinatura: "2026-09-01" }));
    zap.detalharDocumento.mockRejectedValue(erro404());
    const resumo = await rodarReconciliacao(AGORA);
    expect(resumo).toMatchObject({ reconsultadas: 1, expiradas: 0 });
    expect(resumo.falhas).toBeGreaterThanOrEqual(2);
    expect(confissoes.get(77).status).toBe("enviada");
    expect(zap.excluirDocumento).not.toHaveBeenCalled();
    expect(eventos).toHaveLength(0);
  });
});

/**
 * "Falta a assinatura do provedor": o cliente assinou, o representante do
 * provedor não. O aviso sai UMA vez — e a prova tem de passar pelo
 * `aplicarRetorno` real, porque é ele que regrava a linha a cada reconsulta
 * (o ramo pendente zera `erro_ultimo`). Enquanto a marca morava em
 * `erro_ultimo`, ela era apagada antes de ser lida: evento novo e follow-up
 * jogando o caso para "hoje" a cada passada completa, ~60 vezes numa janela de
 * 15 dias. O teste antigo dublava o `aplicarRetorno` e injetava a marca na
 * segunda leitura — afirmava o que a integração não entregava.
 */
describe("aviso 'falta a assinatura do provedor'", () => {
  const signers = (cliente: string) => [
    { papel: "cliente", token: "s-cli", signUrl: "u1", status: cliente, signedAt: cliente === "signed" ? "2026-09-12T10:00:00Z" : null, authMode: "x" },
    { papel: "provedor", token: "s-prov", signUrl: "u2", status: "new", signedAt: null, authMode: "assinaturaTela-tokenEmail" },
  ];
  // O ZapSign: documento ainda pendente (falta o provedor), com o cliente já assinado.
  const detalhePendente = () => ({ token: "doc-da-conta-antiga", status: "pending", signed_at: null, signed_file: null, original_file: "o", deleted: false, sandbox: false,
    signers: [
      { token: "s-cli", status: "signed", sign_url: "u1", signed_at: "2026-09-12T10:00:00Z", auth_mode: "x", external_id: "cliente" },
      { token: "s-prov", status: "new", sign_url: "u2", signed_at: null, auth_mode: "assinaturaTela-tokenEmail", external_id: "provedor" },
    ] });
  const passadaCompletaSeguinte = new Date(AGORA.getTime() + 6 * 60 * 60_000 + 1);

  beforeEach(() => {
    integracao = { ...integracao, provedorAssina: true, signatarioNome: "Ana Link", signatarioEmail: "ana@nslink.com" };
    zap.detalharDocumento.mockResolvedValue(detalhePendente());
  });

  it("duas passadas completas seguidas, cliente assinado e provedor pendente: UM evento e UMA atualização do caso", async () => {
    // O webhook da assinatura do cliente se perdeu: é a reconsulta da passada que descobre.
    confissoes.set(77, enviada({ zapsignSigners: signers("link-opened") }));
    const primeira = await rodarReconciliacao(AGORA);
    const segunda = await rodarReconciliacao(passadaCompletaSeguinte);
    expect(zap.detalharDocumento, "as duas passadas reconsultaram de verdade").toHaveBeenCalledTimes(2);
    expect([primeira.avisosDeProvedor, segunda.avisosDeProvedor]).toEqual([1, 0]);
    const avisos = eventos.filter(e => e.metadata?.status === "aguardando_provedor");
    expect(avisos).toHaveLength(1);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ casoId: 9, patch: { proximaAcao: expect.stringContaining("falta a assinatura do provedor") } });
    const linha = confissoes.get(77);
    expect(linha.avisoProvedorEm).toEqual(AGORA);
    // O canal de erro da tela fica limpo: a marca não mora mais nele.
    expect(linha.erroUltimo).toBeNull();
    expect(linha.status).toBe("enviada");
  });

  it("caso fechado: sem evento não há aviso — nem follow-up, nem carimbo", async () => {
    statusDoCaso = "pago";
    confissoes.set(77, enviada({ zapsignSigners: signers("signed") }));
    await rodarReconciliacao(AGORA);
    await rodarReconciliacao(passadaCompletaSeguinte);
    expect(eventos).toHaveLength(0);
    expect(followUps).toHaveLength(0);
    expect(confissoes.get(77).avisoProvedorEm ?? null).toBeNull();
  });

  it("o provedor que não assina não é avisado", async () => {
    integracao = { ...integracao, provedorAssina: false };
    confissoes.set(77, enviada({ zapsignSigners: signers("signed") }));
    const r = await rodarReconciliacao(AGORA);
    expect(r.avisosDeProvedor).toBe(0);
    expect(eventos).toHaveLength(0);
  });
});
