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
  it("esta no painel do provedor como aba `chat`, com a permissao do painel", () => {
    expect(painel).toContain('<TabsTrigger value="chat" className="gap-1.5" data-testid="tab-chat">');
    expect(painel).toContain("<AbaChat podeAdministrar={podeAdministrar} />");
    expect(painel).toContain('import { AbaChat } from "@/components/painel/AbaChat";');
  });
});
