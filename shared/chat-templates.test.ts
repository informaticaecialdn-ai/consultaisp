import { describe, expect, it } from "vitest";
import { analisarTemplateDeAbertura, montarTemplateDeAbertura, textoDeAberturaControlada, textoNeutroAntesDaIdentificacao } from "./chat-templates";
import type { TemplateDatafy, TemplateDeAbertura } from "./chat-whatsapp";

const template = (text = "Olá, {{1}}! Aqui é {{2}}.", status = "APPROVED"): TemplateDatafy => ({ name: "abertura", language: "pt_BR", status, components: [{ type: "BODY", text }] });
const config: TemplateDeAbertura = { nome: "abertura", idioma: "pt_BR", variaveis: ["nomeCliente", "nomeProvedor"] };
describe("template aprovado para abertura", () => {
  it.each(["Sua dívida é R$ 200,00", "Sua fatura venceu", "Contrato suspenso", "Envie seu CPF", "Acesse https://isp.invalid/pagar", "Valor de duzentos reais", "请支付账单"])("recusa conteúdo antes da identidade: %s", text => {
    expect(analisarTemplateDeAbertura(template(text)).compativel).toBe(false);
  });
  it.each(["HEADER", "FOOTER"])("confere conteúdo estático de %s", type => {
    const t = template(); t.components.push({ type, format: "TEXT", text: "Saldo pendente R$ 200" });
    expect(analisarTemplateDeAbertura(t).compativel).toBe(false);
  });
  it("bloqueia links estáticos e conteúdo financeiro de botões", () => {
    for (const button of [{ type: "URL", text: "Continuar", url: "https://isp.invalid" }, { type: "QUICK_REPLY", text: "Pagar dívida" }]) {
      const t = template(); t.components.push({ type: "BUTTONS", buttons: [button] });
      expect(analisarTemplateDeAbertura(t).compativel).toBe(false);
    }
  });
  it("gera apenas primeiro nome e provedor; parâmetros não carregam documento ou instrução", () => {
    expect(textoDeAberturaControlada({ nomeCliente: "Maria Silva CPF 12345678901", nomeProvedor: "ISP Sul" }))
      .toBe("Olá, sou o assistente virtual de ISP Sul. Posso falar com Maria?");
    expect(textoNeutroAntesDaIdentificacao("Maria deve 200 reais", { nomeCliente: "Maria", nomeProvedor: "ISP" })).toBe(false);
    expect(textoDeAberturaControlada({ nomeCliente: "https://segredo.invalid", nomeProvedor: "Saldo R$ 200" })).not.toMatch(/200|https|Saldo/);
  });
  it("monta somente parâmetros das variáveis permitidas e limpa quebras de linha", () => {
    expect(montarTemplateDeAbertura(template(), config, { nomeCliente: "Maria\r\nSilva", nomeProvedor: "ISP\tSul" })).toEqual({ name: "abertura", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "ISP Sul" }] }] });
  });
  it("aceita corpo estático, parâmetros repetidos e botões estáticos", () => {
    expect(montarTemplateDeAbertura(template("Olá!"), { ...config, variaveis: [] }, { nomeCliente: "", nomeProvedor: "" })).toEqual({ name: "abertura", language: { code: "pt_BR" } });
    expect(analisarTemplateDeAbertura(template("{{1}} fala com {{2}}, {{1}}?")).variaveis).toBe(2);
    const t = template(); t.components.push({ type: "HEADER", format: "TEXT", text: "Atendimento" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Continuar" }] });
    expect(analisarTemplateDeAbertura(t).compativel).toBe(true);
  });
  it.each(["{{nome}}", "{{0}}", "{{01}}", "{{2}}", "{{1}} {{3}}", "{{1}", "{1}}", "{{1}} {{", "{{ 1 }}", "{{{1}}}"])("recusa variável inválida: %s", texto => {
    expect(analisarTemplateDeAbertura(template(texto)).compativel).toBe(false);
  });
  it.each(["PENDING", "REJECTED", "PAUSED", "DISABLED"])("recusa template %s", status => {
    expect(() => montarTemplateDeAbertura(template(undefined, status), config, { nomeCliente: "Maria", nomeProvedor: "ISP" })).toThrow(/aprovado/);
  });
  it("recusa mídia, botões dinâmicos e nome/idioma/contagem diferentes", () => {
    const media = template(); media.components.unshift({ type: "HEADER", format: "IMAGE" });
    expect(analisarTemplateDeAbertura(media).compativel).toBe(false);
    const dinamico = template(); dinamico.components.push({ type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://isp.invalid/{{1}}" }] });
    expect(analisarTemplateDeAbertura(dinamico).compativel).toBe(false);
    for (const c of [{ ...config, nome: "outro" }, { ...config, idioma: "en_US" }, { ...config, variaveis: [] }]) expect(() => montarTemplateDeAbertura(template(), c, { nomeCliente: "Maria", nomeProvedor: "ISP" })).toThrow();
  });
  it("recusa variável fora do contrato e contexto vazio com mensagem controlada", () => {
    expect(() => montarTemplateDeAbertura(template("Olá {{1}}"), { ...config, variaveis: ["token" as never] }, { nomeCliente: "Maria", nomeProvedor: "ISP" })).toThrow(/variáveis/i);
    expect(() => montarTemplateDeAbertura(template(), config, { nomeCliente: "  ", nomeProvedor: "ISP" })).toThrow(/nome/);
  });
});
