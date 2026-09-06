import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * As rotas da ponte com o Chat BullQ: quem pode o que (operador manda caso,
 * so admin liga o canal), o que cada erro da ponte vira em HTTP, e que o
 * providerId e o userId da SESSAO — nunca do corpo — chegam ao servico.
 */

const servico = vi.hoisted(() => ({
  estadoDaIntegracao: vi.fn(async (): Promise<any> => ({ ligado: true, provisionado: false, organizationId: null, canal: null, status: null, ultimoErro: null, inboxUrl: "https://chat.consultaisp.com.br/inbox" })),
  configurarCanalWhatsapp: vi.fn(async (): Promise<any> => ({ canalOk: true, integracao: { status: "ativo", canalId: "ch_1", canalNome: "Principal", ultimoErro: null } })),
  enviarCasoParaCobranca: vi.fn(async (): Promise<any> => ({ conversationId: "conv_1", reaproveitada: false, messageId: "m1", inboxUrl: "https://chat.consultaisp.com.br/inbox" })),
  conversaDoCaso: vi.fn(async (): Promise<any> => null),
  enviarRecuperacaoParaChat: vi.fn(async (): Promise<any> => ({ conversationId: "conv_9", reaproveitada: false, messageId: "m9", inboxUrl: "https://chat.consultaisp.com.br/inbox" })),
  definirSenhaDoInbox: vi.fn(async (): Promise<any> => ({ ownerEmail: "dono@isp.com" })),
  garantirTransferenciaNaResposta: vi.fn(async () => undefined),
}));
vi.mock("../services/chat/chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("../services/chat/chat-ponte.service")>("../services/chat/chat-ponte.service");
  return { ...servico, ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
vi.hoisted(() => { process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real"; });
vi.mock("../db", () => ({ pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) }, db: {} }));
const inbox = vi.hoisted(() => ({ acaoNaConversa: vi.fn(async () => ({ statusConversa: "OPEN" })), detalheDoAtendimento: vi.fn(async () => ({ mensagens: [] })), midiaDoAtendimento: vi.fn() }));
const whatsapp = vi.hoisted(() => ({ consultarOuConectarWhatsapp: vi.fn(async () => ({ provider: "ZAPPFY", status: "connecting", qrCode: "data:image/png;base64,iVBORw0KGgo=" })) }));
vi.mock("../services/chat/chat-whatsapp.service", () => whatsapp);
const agentes = vi.hoisted(() => ({
  listarAgentesDoChat: vi.fn(async () => ({ agentes: [] })), configurarAgenteDoChat: vi.fn(async () => ({})),
  modelosDosAgentesDoChat: vi.fn(async () => ({ configured: true, models: [] })),
  provisionarAgenteDoChat: vi.fn(async () => ({ id: "ag1" })), prepararPrimeiroContatoDoAgente: vi.fn(async () => ({ texto: "Prévia" })),
  exigirAgentesProntos: vi.fn(async () => undefined),
  promptDoAgenteDoChat: vi.fn(async () => ({ tipo: "cobranca_ativos", nomeProvedor: "NsLink", prompt: "Você é o assistente virtual de NsLink.", contextoOperacional: "", caracteres: 38 })),
  comTravaDaConfiguracaoDoChat: async (_p: number, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../services/chat/chat-agentes.service", () => agentes);
const lista = vi.hoisted(() => ({ listarAtendimentosDoChat: vi.fn(async () => ({ itens: [], temMais: false })), getIntegracaoDoChat: vi.fn(), guardarAgenteDoChat: vi.fn() }));
vi.mock("../storage", () => ({ storage: lista }));
// O erro de dados e o limite da acao sao os REAIS: a rota mapeia o primeiro
// para 400 e valida o tamanho pelo segundo.
vi.mock("../services/chat/chat-atendimento.service", async () => {
  const real = await vi.importActual<typeof import("../services/chat/chat-atendimento.service")>("../services/chat/chat-atendimento.service");
  return { ...inbox, ErroDeDadosDoAtendimento: real.ErroDeDadosDoAtendimento, TAMANHO_MAXIMO_DA_ACAO: real.TAMANHO_MAXIMO_DA_ACAO };
});
const contexto = vi.hoisted(() => ({ contextoDoAtendimento: vi.fn(async () => ({})), segundaViaDoAtendimento: vi.fn(async () => ({ link: "https://erp.example/b/1" })) }));
vi.mock("../services/chat/chat-contexto.service", () => contexto);
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => (req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" })),
  requireProvider: (req: any, res: any, next: any) => (req.session?.providerId ? next() : res.status(403).json({ message: "Somente provedores" })),
}));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({ sendUsuarioAdicionadoEmail: vi.fn(async () => undefined) }));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null })),
  urlDeEntrada: vi.fn(() => "https://consultaisp.example"),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { registerChatBullqRoutes } from "./chat-bullq.routes";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";
import { ErroDeDadosDoAtendimento } from "../services/chat/chat-atendimento.service";

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
const ADMIN = { userId: 7, providerId: 42, role: "admin" };
const OPERADOR = { userId: 8, providerId: 42, role: "user" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerChatBullqRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); sessao = {}; });

const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

describe("acesso", () => {
  it("QR e status exigem administrador e usam somente o canal da sessão", async () => {
    expect((await json("GET", "/api/chat-bullq/integracao/canal/conexao")).status).toBe(401);
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/integracao/canal/conexao")).status).toBe(403);
    expect((await json("POST", "/api/chat-bullq/integracao/canal/conectar", {})).status).toBe(403);
    expect(whatsapp.consultarOuConectarWhatsapp).not.toHaveBeenCalled();
    sessao = ADMIN;
    const estado = await json("GET", "/api/chat-bullq/integracao/canal/conexao?providerId=999&canalId=outro");
    expect(estado.status).toBe(200);
    expect(estado.headers.get("cache-control")).toBe("no-store");
    expect(whatsapp.consultarOuConectarWhatsapp).toHaveBeenCalledWith(42, "consultar");
    expect((await json("POST", "/api/chat-bullq/integracao/canal/conectar", { channelId: "outro" })).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/integracao/canal/conectar", { phone: "5543999990000" })).status).toBe(200);
    expect(whatsapp.consultarOuConectarWhatsapp).toHaveBeenLastCalledWith(42, "conectar", "5543999990000");
  });
  it("valida campos por serviço e mantém token e segredo fora da resposta", async () => {
    sessao = ADMIN;
    const comum = { nome: "Principal", token: "token-sintetico" };
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { ...comum, provider: "UAZAPI" })).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { ...comum, provider: "UAZAPI", baseUrl: "https://minha.uazapi.com" })).status).toBe(200);
    expect(servico.configurarCanalWhatsapp).toHaveBeenLastCalledWith(42, { ...comum, provider: "UAZAPI", baseUrl: "https://minha.uazapi.com" });
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { ...comum, provider: "DATAFY", phoneNumberId: "123456789" })).status).toBe(400);
    const r = await json("POST", "/api/chat-bullq/integracao/canal", { ...comum, provider: "DATAFY", phoneNumberId: "123456789", webhookSecret: "whsec_segredo-sintetico" });
    expect(r.status).toBe(200);
    const body = await r.text(); expect(body).not.toContain(comum.token); expect(body).not.toContain("whsec_");
  });
  it("catálogo é consultável pelo operador; configurar/provisionar/testar exige admin e sessão", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/integracao/agentes")).status).toBe(200);
    expect(agentes.listarAgentesDoChat).toHaveBeenCalledWith(42);
    expect((await json("POST", "/api/chat-bullq/integracao/agentes/cobranca_ativos/testar", {})).status).toBe(403);
    expect((await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", {})).status).toBe(403);
    sessao = ADMIN;
    expect((await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", { modelo: "sakana/real", instrucoes: "Breve", habilitado: true })).status).toBe(200);
    expect(agentes.configurarAgenteDoChat).toHaveBeenCalledWith(42, "cobranca_ativos", { modelo: "sakana/real", instrucoes: "Breve", habilitado: true, descricao: "", contextoOperacional: "" });
    expect((await json("POST", "/api/chat-bullq/integracao/agentes/cobranca_ativos/provisionar", { providerId: 999 })).status).toBe(200);
    expect(agentes.provisionarAgenteDoChat).toHaveBeenCalledWith(42, "cobranca_ativos");
    expect((await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", { modelo: "x", providerId: 999 })).status).toBe(400);
  });
  it("perfil completo do agente: aceita os campos do AiAgent do fork e devolve o campo estourado no 400", async () => {
    sessao = ADMIN;
    const completo = { modelo: "openai/gpt-4o-mini", instrucoes: "Breve", habilitado: true, descricao: "Assistente", contextoOperacional: "Hoje sem visita", temperatura: 0.4, maxTokens: 800 };
    expect((await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", completo)).status).toBe(200);
    expect(agentes.configurarAgenteDoChat).toHaveBeenLastCalledWith(42, "cobranca_ativos", completo);
    const r = await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", { ...completo, contextoOperacional: "c".repeat(8001) });
    expect(r.status).toBe(400);
    expect((await r.json()).erros[0]).toMatch(/^contextoOperacional/);
    expect((await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", { ...completo, temperatura: 1.5 })).status).toBe(400);
    expect((await json("PUT", "/api/chat-bullq/integracao/agentes/cobranca_ativos", { ...completo, maxTokens: 2048 })).status).toBe(400);
  });
  it("prompt final: mesma leitura que a lista de agentes já dá ao operador, sempre do provedor da sessão; modelos seguem só admin", async () => {
    sessao = OPERADOR;
    // O prompt é a composição do que `GET .../agentes` já devolve (instruções, descrição, contexto) com texto do nosso próprio fonte:
    // exigir admin só aqui seria fachada. A fronteira real está na escrita — PUT, provisionar e testar continuam de admin.
    const operador = await json("GET", "/api/chat-bullq/integracao/agentes/cobranca_ativos/prompt?providerId=999");
    expect(operador.status).toBe(200);
    expect(agentes.promptDoAgenteDoChat).toHaveBeenCalledWith(42, "cobranca_ativos");
    expect((await json("GET", "/api/chat-bullq/integracao/agentes/modelos")).status).toBe(403);
    sessao = ADMIN;
    const r = await json("GET", "/api/chat-bullq/integracao/agentes/cobranca_ativos/prompt?providerId=999");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ prompt: "Você é o assistente virtual de NsLink.", caracteres: 38 });
    expect(agentes.promptDoAgenteDoChat).toHaveBeenLastCalledWith(42, "cobranca_ativos");
    expect((await json("GET", "/api/chat-bullq/integracao/agentes/papel_inexistente/prompt")).status).toBe(400);
    agentes.modelosDosAgentesDoChat.mockResolvedValueOnce({ configured: false, models: [{ id: "openai/gpt-4o-mini", origem: "openai_vps" }] } as never);
    const m = await json("GET", "/api/chat-bullq/integracao/agentes/modelos");
    expect(m.status).toBe(200);
    // `configured` viaja como o serviço respondeu, inclusive falso com modelos listados.
    expect(await m.json()).toMatchObject({ configured: false, models: [{ id: "openai/gpt-4o-mini", origem: "openai_vps" }] });
    expect(agentes.modelosDosAgentesDoChat).toHaveBeenCalledWith(42);
    agentes.promptDoAgenteDoChat.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", "Integração de outro provedor") as never);
    expect((await json("GET", "/api/chat-bullq/integracao/agentes/cobranca_ativos/prompt")).status).toBe(409);
  });
  it("ficha e segunda via usam provedor da sessão e validam a referência", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/atendimentos/c1/contexto?atualizar=true&providerId=999")).status).toBe(200);
    expect(contexto.contextoDoAtendimento).toHaveBeenCalledWith(42, "c1", true);
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/segunda-via", { ref: "" })).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/segunda-via", { ref: "f1", providerId: 999 })).status).toBe(200);
    expect(contexto.segundaViaDoAtendimento).toHaveBeenCalledWith(42, "c1", "f1");
  });
  it("apenas admin ativa automação; preserva configuração e usa provedor da sessão", async () => {
    sessao = OPERADOR;
    expect((await json("PUT", "/api/chat-bullq/automacao", { ligada: true })).status).toBe(403);
    expect(servico.garantirTransferenciaNaResposta).not.toHaveBeenCalled();
    sessao = ADMIN;
    lista.getIntegracaoDoChat.mockResolvedValue({ canalId: "ch1", status: "ativo", agenteConfig: { respostaHumanaAutomacaoId: "a1" } });
    expect((await json("PUT", "/api/chat-bullq/automacao", { ligada: true, limiteDiario: 101 })).status).toBe(400);
    expect((await json("PUT", "/api/chat-bullq/automacao", { ligada: true, limiteDiario: 5, providerId: 999 })).status).toBe(200);
    expect(servico.garantirTransferenciaNaResposta).toHaveBeenCalledExactlyOnceWith(42);
    expect(lista.guardarAgenteDoChat).toHaveBeenCalledWith(42, { agenteConfig: expect.objectContaining({ respostaHumanaAutomacaoId: "a1", primeiroContatoUserId: 7, primeiroContato: expect.objectContaining({ ligada: true, limiteDiario: 5 }) }) });
  });
  it("admin consegue desligar automação mesmo com canal em erro", async () => {
    sessao = ADMIN;
    lista.getIntegracaoDoChat.mockResolvedValue({ status: "erro", agenteConfig: {} });
    expect((await json("PUT", "/api/chat-bullq/automacao", { ligada: false })).status).toBe(200);
    expect(servico.garantirTransferenciaNaResposta).not.toHaveBeenCalled();
  });
  it("fila interna exige autenticação e separa carteira com provedor da sessão", async () => {
    expect((await json("GET", "/api/chat-bullq/atendimentos?origem=cobranca")).status).toBe(401);
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/atendimentos?origem=cobranca&carteira=ex_cliente&providerId=999")).status).toBe(200);
    expect(lista.listarAtendimentosDoChat).toHaveBeenCalledWith(42, { origem: "cobranca", carteira: "ex_cliente", pagina: 1 });
  });
  it("resposta interna usa operador e provedor da sessão; rejeita mensagem vazia", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "enviar", texto: " " })).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "enviar", texto: "Olá", providerId: 999, userId: 99 })).status).toBe(200);
    expect(inbox.acaoNaConversa).toHaveBeenCalledWith(42, "c1", 8, { acao: "enviar", texto: "Olá" });
  });
  it("o follow-up do diálogo chega ao serviço: ao responder e ao encerrar", async () => {
    sessao = OPERADOR;
    const quando = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const iso = quando.toISOString();
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "enviar", texto: "Segue o boleto", proximaAcao: "Confirmar o pagamento", proximoContatoEm: iso })).status).toBe(200);
    expect(inbox.acaoNaConversa).toHaveBeenLastCalledWith(42, "c1", 8, { acao: "enviar", texto: "Segue o boleto", proximaAcao: "Confirmar o pagamento", proximoContatoEm: quando });
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "encerrar", proximaAcao: "Cobrar a promessa", proximoContatoEm: iso })).status).toBe(200);
    expect(inbox.acaoNaConversa).toHaveBeenLastCalledWith(42, "c1", 8, { acao: "encerrar", proximaAcao: "Cobrar a promessa", proximoContatoEm: quando });
    // Sem follow-up o corpo continua valendo: quem recusa (caso vivo) é o serviço.
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "encerrar" })).status).toBe(200);
    expect(inbox.acaoNaConversa).toHaveBeenLastCalledWith(42, "c1", 8, { acao: "encerrar" });
    // Assumir não carrega follow-up: o que vier junto é descartado.
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "assumir", proximaAcao: "Ligar" })).status).toBe(200);
    expect(inbox.acaoNaConversa).toHaveBeenLastCalledWith(42, "c1", 8, { acao: "assumir" });
  });
  it("ação longa demais e data ilegível são recusadas no corpo, sem chegar ao serviço", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "encerrar", proximaAcao: "x".repeat(121), proximoContatoEm: new Date().toISOString() })).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "encerrar", proximaAcao: "Ligar", proximoContatoEm: "ontem" })).status).toBe(400);
    expect(inbox.acaoNaConversa).not.toHaveBeenCalled();
  });
  it("recusa de follow-up é 400 (dado inválido), não 409 (conflito de estado)", async () => {
    sessao = OPERADOR;
    inbox.acaoNaConversa.mockRejectedValueOnce(new ErroDeDadosDoAtendimento("Todo atendimento termina com a próxima ação") as never);
    const r = await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "encerrar" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ message: "Todo atendimento termina com a próxima ação", codigo: "DADOS_INVALIDOS" });
    // O conflito de estado continua 409.
    inbox.acaoNaConversa.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", "Assuma o atendimento antes de responder") as never);
    expect((await json("POST", "/api/chat-bullq/atendimentos/c1/acoes", { acao: "encerrar" })).status).toBe(409);
  });
  it("pagina inválida e origem desconhecida são rejeitadas", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/atendimentos?origem=outro")).status).toBe(400);
    expect((await json("GET", "/api/chat-bullq/atendimentos/c1?pagina=-1")).status).toBe(400);
  });
  it("401 sem sessao; 403 sem provedor", async () => {
    expect((await json("GET", "/api/chat-bullq/integracao")).status).toBe(401);
    sessao = { userId: 1, role: "superadmin" };
    expect((await json("GET", "/api/chat-bullq/integracao")).status).toBe(403);
  });
  it("operador ve a integracao e manda caso; so admin liga o canal", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/integracao")).status).toBe(200);
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", {})).status).toBe(200);
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { nome: "Principal", token: "tok_12345678" })).status).toBe(403);
    expect(servico.configurarCanalWhatsapp).not.toHaveBeenCalled();
    sessao = ADMIN;
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { nome: "Principal", token: "tok_12345678" })).status).toBe(200);
    expect(servico.configurarCanalWhatsapp).toHaveBeenCalledWith(42, { provider: "ZAPPFY", nome: "Principal", token: "tok_12345678" });
  });
});

describe("enviar para cobranca", () => {
  it("passa providerId e userId da sessao, o caso da rota e o texto/acao do corpo", async () => {
    sessao = OPERADOR;
    const res = await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", { texto: "Oi, tudo bem?", acaoDaEtapa: "Lembrar" });
    expect(res.status).toBe(200);
    expect(servico.enviarCasoParaCobranca).toHaveBeenCalledWith(42, 10, 8, "Oi, tudo bem?", "Lembrar");
    expect(await res.json()).toMatchObject({ conversationId: "conv_1" });
  });
  it("corpo vazio e aceito (mensagem modelo); caso invalido e 400; texto gigante e 400", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar")).status).toBe(200);
    expect(servico.enviarCasoParaCobranca).toHaveBeenLastCalledWith(42, 10, 8, null, null);
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/abc/enviar", {})).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", { texto: "x".repeat(2001) })).status).toBe(400);
  });
  it("os erros da ponte viram o status certo, com o codigo", async () => {
    sessao = OPERADOR;
    const casos: Array<[string, number]> = [["CASO_NAO_ENCONTRADO", 404], ["CHAT_DESLIGADO", 503], ["CHAT_FALHOU", 502], ["SEM_CANAL", 409], ["SEM_TELEFONE", 409]];
    for (const [codigo, status] of casos) {
      servico.enviarCasoParaCobranca.mockRejectedValueOnce(new ErroDaPonteDoChat(codigo as any, `erro ${codigo}`));
      const res = await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", {});
      expect(res.status, codigo).toBe(status);
      expect(await res.json()).toMatchObject({ codigo, message: `erro ${codigo}` });
    }
    servico.enviarCasoParaCobranca.mockRejectedValueOnce(new Error("explodiu"));
    const res = await json("POST", "/api/chat-bullq/cobranca/casos/10/enviar", {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("explodiu");
  });
});

describe("conversa do caso e recuperacao", () => {
  it("404 quando o caso nunca foi enviado; 200 com a conversa quando foi", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/chat-bullq/cobranca/casos/10/conversa")).status).toBe(404);
    servico.conversaDoCaso.mockResolvedValueOnce({ conversationId: "conv_1", status: "OPEN", mensagens: [], erro: null, inboxUrl: "x" });
    const res = await json("GET", "/api/chat-bullq/cobranca/casos/10/conversa");
    expect(res.status).toBe(200);
    expect(servico.conversaDoCaso).toHaveBeenCalledWith(42, 10);
  });
  it("recuperacao: mesmo contrato de envio", async () => {
    sessao = OPERADOR;
    const res = await json("POST", "/api/chat-bullq/recuperacao/77/enviar", { texto: "Combinar retirada" });
    expect(res.status).toBe(200);
    expect(servico.enviarRecuperacaoParaChat).toHaveBeenCalledWith(42, 77, 8, "Combinar retirada");
  });
});

describe("senha do inbox", () => {
  it("so admin; senha curta e 400; a senha vai ao servico com o provedor da sessao", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/chat-bullq/integracao/senha", { senha: "segredo123" })).status).toBe(403);
    sessao = ADMIN;
    expect((await json("POST", "/api/chat-bullq/integracao/senha", { senha: "curta" })).status).toBe(400);
    expect((await json("POST", "/api/chat-bullq/integracao/senha", { senha: "12345678901" })).status).toBe(400);
    const res = await json("POST", "/api/chat-bullq/integracao/senha", { senha: "segredo123456" });
    expect(res.status).toBe(200);
    expect(servico.definirSenhaDoInbox).toHaveBeenCalledWith(42, "segredo123456");
    expect(await res.json()).toEqual({ ownerEmail: "dono@isp.com" });
  });
});

describe("canal", () => {
  it("valida nome e token; teste do canal falhou vira 202 com o estado", async () => {
    sessao = ADMIN;
    expect((await json("POST", "/api/chat-bullq/integracao/canal", { nome: "P", token: "curto" })).status).toBe(400);
    servico.configurarCanalWhatsapp.mockResolvedValueOnce({ canalOk: false, integracao: { status: "erro", canalId: "ch_1", canalNome: "Principal", ultimoErro: "instancia desconectada" } });
    const res = await json("POST", "/api/chat-bullq/integracao/canal", { nome: "Principal", token: "tok_12345678" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ canalOk: false, integracao: { status: "erro", ultimoErro: "instancia desconectada" } });
  });
});
