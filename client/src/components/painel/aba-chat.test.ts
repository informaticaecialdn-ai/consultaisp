import { CATEGORIAS_PAINEL } from "@/components/painel/OrganizacaoPainel";
/**
 * A aba Chat do painel do provedor, travada pelo fonte: fala com as rotas da
 * ponte, o token e a senha nunca ficam no estado depois de enviados, so o
 * admin mexe, e a aba esta ligada no painel.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const aba = ler("./AbaChat.tsx");
const painel = ler("../../pages/provedor/painel-provedor.tsx");

describe("aba Chat", () => {
  it("le o estado e grava canal e senha pelas rotas da ponte", () => {
    expect(aba).toContain("`${API_CHAT_BULLQ}/integracao`");
    expect(aba).toContain("`${API_CHAT_BULLQ}/integracao/canal`");
    expect(aba).toContain("`${API_CHAT_BULLQ}/integracao/senha`");
  });
  it("token e senha sao campos password e sao limpos depois do envio", () => {
    expect(aba).toContain('type="password" autoComplete="off" value={canal.token}');
    expect(aba).toContain('setCanal(c => ({ ...c, token: "", webhookSecret: "" }))');
    expect(aba).toContain('setSenha({ senha: "", confirmacao: "" })');
    expect(aba).not.toMatch(/localStorage|console\.log/);
  });
  it("so dois servicos (dono, 16/09/2026): o WhatsApp da plataforma (Evolution), padrao, e a Datafy — Zappfy e Uazapi sairam", () => {
    expect(aba).toContain('<option value="EVOLUTION">');
    expect(aba).toContain('<option value="DATAFY">');
    expect(aba).not.toContain('value="ZAPPFY"');
    expect(aba).not.toContain('value="UAZAPI"');
    expect(aba).not.toMatch(/baseUrl|Uazapi|Zappfy/);
    expect(aba).toContain('provider: "EVOLUTION" as ProvedorOferecido');
  });
  it("WhatsApp da plataforma (Evolution): sem token nem segredo — o fork cria a instancia; a Datafy e a unica com credencial", () => {
    // O corpo enviado para a Evolution leva so o servico e o nome: nao ha token a digitar.
    expect(aba).toContain('{ provider: "EVOLUTION", nome: canal.nome.trim() }');
    // Os campos de token e segredo so existem para a Datafy, e o botao so exige credencial dela.
    expect(aba).toContain('{canal.provider === "DATAFY" && <Campo rotulo="token de acesso Datafy">');
    expect(aba).toContain('{canal.provider === "DATAFY" && <Campo rotulo="segredo de assinatura do webhook">');
    expect(aba).toContain('(canal.provider === "DATAFY" && (canal.token.trim().length < 8 ||');
    expect(aba).toContain("pareie o número pelo QR");
  });
  it("so o administrador liga o numero e define a senha", () => {
    expect((aba.match(/disabled=\{!podeAdministrar/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(aba).toContain("só o administrador liga o número");
  });
  it("diz quando o chat esta desligado na instalacao ou sem numero ativo, e leva ao inbox", () => {
    expect(aba).toContain("desligado nesta instalação");
    expect(aba).toContain("Sem número ativo, os botões de envio não aparecem nas telas.");
    expect(aba).toContain('data-testid="link-inbox-chat"');
  });
  it("aguardando o pareamento nao e erro: selo proprio em tom gated e o que falta fazer", () => {
    expect(aba).toContain('const aguardandoPareamento = integracao?.status === "aguardando_conexao"');
    expect(aba).toContain('aguardandoPareamento ? "aguardando pareamento"');
    expect(aba).toContain('data-testid="chat-aguardando-pareamento"');
    expect(aba).toContain("leia o QR com o WhatsApp do provedor");
    // O recado do pareamento nao pode sair como "ultimo erro" em vermelho: a
    // secao de erro so existe no outro ramo do mesmo ternario.
    const trecho = aba.slice(aba.indexOf("{aguardandoPareamento"), aba.indexOf('data-testid="chat-ultimo-erro"'));
    expect(trecho).toContain("text-[var(--gated)]");
    expect(trecho).toContain(": <>");
    expect(aba).not.toMatch(/\btext-white\b/);
    // Selo retangular e sem paleta crua do Tailwind (DESIGN_SYSTEM v5).
    expect(aba).not.toMatch(/rounded-full|\b(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/);
  });
  /**
   * A automacao de retorno e o que traz a resposta do cliente de volta. O fork
   * a pausa depois de 5 falhas do webhook e nunca religa (16/09/2026: ninguem
   * soube). A aba le o estado que a integracao traz, avisa em destaque e o
   * admin religa daqui.
   */
  it("automacao de retorno pausada ou ausente: aviso em destaque no tom de perigo, com o motivo, e o botao de religar so para o admin", () => {
    expect(aba).toContain('(retorno.estado === "pausada" || retorno.estado === "ausente")');
    expect(aba).toContain('data-testid="chat-retorno-pausado"');
    expect(aba).toContain("As respostas dos clientes não estão chegando ao Consulta ISP:");
    expect(aba).toContain("a automação de retorno do chat está pausada (${motivoDaPausa(retorno)})");
    expect(aba).toContain("falhas seguidas em ${quando}");
    expect(aba).toContain("a automação de retorno do chat não existe no Chat BullQ.");
    // O aviso usa os tokens de perigo da pele, como os avisos que ja existem na aba.
    const aviso = aba.slice(aba.indexOf('{integracao?.ligado && integracao.canal && (retorno.estado'), aba.indexOf('data-testid="chat-retorno-pausado"'));
    expect(aviso).toContain("var(--danger");
    expect(aviso).toContain('role="alert"');
    // So o admin religa: o botao fica atras de podeAdministrar; quem nao pode le o que fazer.
    expect(aba).toMatch(/\{podeAdministrar\s*\?\s*<button[^\n]*data-testid="chat-religar-retorno"/);
    expect(aba).toContain('"Religar retorno"');
    expect(aba).toContain("só o administrador religa");
    // Ausente, o gesto e CRIAR (a ponte devolve "recriada"): o botao diz o que faz.
    expect(aba).toContain('retorno.estado === "ausente" ? "Criar retorno" : "Religar retorno"');
    // Desligada a mao no inbox (enabled=false, 0 falhas, sem data) nao vira "0 falhas seguidas": zero falha nao e motivo.
    expect(aba).toMatch(/if \(r\.falhas\) return/);
    expect(aba).toContain('"desligada no chat"');
  });
  it("religar bate na rota nova, invalida a leitura da integracao (e com ela o retorno, pelo prefixo) e conta o resultado em toast", () => {
    expect(aba).toContain("`${API_CHAT_BULLQ}/integracao/retorno/religar`");
    const religar = aba.slice(aba.indexOf("const religarRetorno = useMutation"), aba.indexOf("const aguardandoPareamento"));
    expect(religar).toContain('apiRequest("POST", `${API_CHAT_BULLQ}/integracao/retorno/religar`)');
    expect(religar).toContain("queryClient.invalidateQueries({ queryKey: [CHAVE_INTEGRACAO] })");
    expect(religar).toContain('r.estado === "religada"');
    expect(religar).toContain('variant: "destructive"');
    expect(religar).toContain("mensagemDoErro(erro)");
  });
  it("o retorno tem leitura PROPRIA (GET /integracao/retorno, so com numero ligado): a integracao que kanban/360/esteira leem continua leve", () => {
    // A chave e [CHAVE_INTEGRACAO, "retorno"] — vira a URL /api/chat-bullq/integracao/retorno (queryClient junta com "/")
    // e continua casando com as invalidacoes por prefixo de ConexaoWhatsapp/AgentesDoChat/religar (["/api/chat-bullq/integracao"]).
    expect(aba).toContain('queryKey: [CHAVE_INTEGRACAO, "retorno"]');
    expect(aba).toMatch(/queryKey: \[CHAVE_INTEGRACAO, "retorno"\][^\n]*enabled: !!integracao\?\.canal/);
    expect(aba).not.toContain("conferirRetorno");
  });
  it("sem conseguir conferir (fork sem resposta): texto neutro, sem alarme; o estado vem do contrato compartilhado, tolerante ao que faltar", () => {
    expect(aba).toContain('retorno.estado === "desconhecido"');
    expect(aba).toContain("não foi possível conferir a automação de retorno agora");
    expect(aba).toContain("RetornoDoChatSchema.safeParse");
    expect(aba).toContain("RETORNO_DESCONHECIDO");
    // Sem numero ligado nao ha resposta a perder: nem o aviso nem o texto neutro aparecem.
    expect(aba).toContain('integracao?.ligado && integracao.canal && retorno.estado === "desconhecido"');
  });
  it("esta no painel do provedor como aba `chat`, com a permissao do painel", () => {
    expect(CATEGORIAS_PAINEL.flatMap(c=>c.itens).some(i=>i.id==="chat")).toBe(true);
    expect(painel).toContain("<AbaChat podeAdministrar={podeAdministrar} />");
    expect(painel).toContain('import { AbaChat } from "@/components/painel/AbaChat";');
  });
});
