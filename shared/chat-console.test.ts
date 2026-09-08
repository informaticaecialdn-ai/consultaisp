import { describe, expect, it } from "vitest";
import {
  AgenteDoConsoleSchema, ehEnderecoPrivado, hostPermitido, ParametrosDaSkillSchema,
  SkillDoConsoleSchema, ToolDoConsoleSchema,
} from "./chat-console";

const LIBERADOS = ["consultaisp.com.br"];

describe("host da conexão", () => {
  it("aceita o host liberado e os subdomínios dele", () => {
    expect(hostPermitido("https://consultaisp.com.br/api", LIBERADOS).ok).toBe(true);
    expect(hostPermitido("https://api.consultaisp.com.br/v1", LIBERADOS).ok).toBe(true);
  });

  it("um host que só TERMINA parecido não passa — o sufixo tem que ser um rótulo inteiro", () => {
    // `maliciosoconsultaisp.com.br` termina com o texto do host liberado, mas
    // não é subdomínio dele. Comparar por `endsWith` cru deixaria passar.
    expect(hostPermitido("https://maliciosoconsultaisp.com.br/x", LIBERADOS).ok).toBe(false);
  });

  it("recusa http, credencial na URL e endereço não liberado", () => {
    expect(hostPermitido("http://consultaisp.com.br/x", LIBERADOS)).toMatchObject({ ok: false });
    expect(hostPermitido("https://a:b@consultaisp.com.br/x", LIBERADOS)).toMatchObject({ ok: false });
    expect(hostPermitido("https://outro.example/x", LIBERADOS)).toMatchObject({ ok: false });
  });

  it("sem nenhum host liberado, a mensagem manda falar com o suporte", () => {
    const r = hostPermitido("https://qualquer.com.br/x", []);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.motivo).toMatch(/suporte/);
  });

  it("endereço interno é sempre privado, mesmo que alguém o libere", () => {
    for (const host of ["localhost", "10.0.0.5", "192.168.1.1", "172.16.0.9", "127.0.0.1", "169.254.1.1", "servidor", "api.internal"]) {
      expect(ehEnderecoPrivado(host)).toBe(true);
    }
    expect(ehEnderecoPrivado("consultaisp.com.br")).toBe(false);
    expect(hostPermitido("https://10.0.0.5/x", ["10.0.0.5"]).ok).toBe(false);
  });
});

describe("schema do agente", () => {
  const base = {
    nome: "Cobrança", modelo: "openai/gpt-4o-mini",
    instrucoes: "Você atende clientes inadimplentes com cordialidade.",
  };

  it("aceita o mínimo e devolve WORKER por padrão", () => {
    const r = AgenteDoConsoleSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tipo).toBe("WORKER");
  });

  it("recusa modelo que a VPS não roda", () => {
    expect(AgenteDoConsoleSchema.safeParse({ ...base, modelo: "anthropic/claude" }).success).toBe(false);
    expect(AgenteDoConsoleSchema.safeParse({ ...base, modelo: "gpt-4o" }).success).toBe(true);
  });

  it("recusa instrução curta demais — o fork exige 10 caracteres e devolveria 400", () => {
    expect(AgenteDoConsoleSchema.safeParse({ ...base, instrucoes: "oi" }).success).toBe(false);
  });

  it("recusa campo desconhecido em vez de mandá-lo adiante", () => {
    expect(AgenteDoConsoleSchema.safeParse({ ...base, organizationId: "org-outra" }).success).toBe(false);
  });
});

describe("schema da skill", () => {
  const base = {
    nome: "consultarSaldo", descricao: "Consulta o saldo em aberto do cliente.",
    toolId: "tool-1", parametros: '{"type":"object"}', metodo: "POST", caminho: "/saldo",
  };

  it("transforma o texto dos parâmetros em objeto — o fork exige objeto", () => {
    const r = SkillDoConsoleSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.parametros).toEqual({ type: "object" });
  });

  it("JSON inválido e JSON que não é objeto viram erro de campo, não 400 do fork", () => {
    expect(ParametrosDaSkillSchema.safeParse("{nao json").success).toBe(false);
    expect(ParametrosDaSkillSchema.safeParse("[1,2]").success).toBe(false);
    expect(ParametrosDaSkillSchema.safeParse("").success).toBe(true);
  });

  it("o nome vira nome de função para o modelo: nada de espaço nem hífen", () => {
    for (const nome of ["consultar saldo", "consultar-saldo", "1consultar", ""]) {
      expect(SkillDoConsoleSchema.safeParse({ ...base, nome }).success).toBe(false);
    }
  });

  it("skill sem conexão é recusada com frase, não com campo vazio", () => {
    const r = SkillDoConsoleSchema.safeParse({ ...base, toolId: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => /conexão/.test(i.message))).toBe(true);
  });
});

describe("schema da conexão", () => {
  it("não existe conexão SQL: o campo `source` nem entra no contrato", () => {
    const r = ToolDoConsoleSchema.safeParse({
      nome: "Banco", descricao: "Query direta", baseUrl: "https://x.com.br",
      source: "CUSTOM_SQL", sqlConnectionRef: "postgres://…",
    });
    // `.strict()` recusa: a query livre contra o nosso Postgres ignoraria
    // provider_id e derrubaria o isolamento multi-tenant por configuração de tela.
    expect(r.success).toBe(false);
  });

  it("headers são opcionais — não mandá-los é 'mantenha os que estão gravados'", () => {
    const r = ToolDoConsoleSchema.safeParse({ nome: "API", descricao: "Conexão", baseUrl: "https://x.com.br" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.headers).toBeUndefined();
  });
});
