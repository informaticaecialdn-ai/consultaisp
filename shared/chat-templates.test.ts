import { describe, expect, it } from "vitest";
import { analisarTemplateDeAbertura, montarTemplateDeAbertura } from "./chat-templates";
import type { TemplateDatafy, TemplateDeAbertura } from "./chat-whatsapp";

const template = (text = "Olá, {{1}}! Aqui é {{2}}.", status = "APPROVED"): TemplateDatafy => ({ name: "abertura", language: "pt_BR", status, components: [{ type: "BODY", text }] });
const config: TemplateDeAbertura = { nome: "abertura", idioma: "pt_BR", variaveis: ["nomeCliente", "nomeProvedor"] };
describe("template aprovado para abertura", () => {
  it("monta somente parâmetros das variáveis permitidas e limpa quebras de linha", () => {
    expect(montarTemplateDeAbertura(template(), config, { nomeCliente: "Maria\r\nSilva", nomeProvedor: "ISP\tSul" })).toEqual({ name: "abertura", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Maria Silva" }, { type: "text", text: "ISP Sul" }] }] });
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
