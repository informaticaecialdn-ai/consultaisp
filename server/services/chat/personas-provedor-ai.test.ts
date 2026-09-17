/**
 * As funcionárias do Provedor.ai montadas para os três perfis (spec 16/09/2026, §8).
 *
 * O que se trava aqui é o que a spec pede do TEXTO final — e cada checagem é
 * escrita neste arquivo, não lida da lista `PROIBIDOS_NA_PERSONA` do builder: se
 * alguém afrouxar a lista, estes testes continuam cobrando.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_k: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("./chat-ponte.service", () => ({
  clienteDoChat: () => null,
  garantirIntegracao: async () => null,
  ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, msg: string) { super(msg); } },
}));

import {
  AGENTES_DO_PROVEDOR_AI, BLOCOS_DE_ORIGEM, CONFIGURACAO_DAS_FUNCIONARIAS, DIRETORIO_PADRAO, MARCADOR_DO_VERBATIM, MONTAGEM, NOMES_DO_DONO, NOMES_DO_PROVEDOR_AI,
  PERSONA_DO_TIPO, PROVEDOR_DE_EXEMPLO, aplicarAdaptacao, arquivoDaPersona, carregarFonteDasPersonas, montarDescricao, montarPersona, nomeDaPersonaDoTipo,
  textoDoArquivoDeOrigem, type Adaptacao, type FonteDasPersonas, type NomesDasPersonas,
} from "./personas-provedor-ai";
import { promptFinalDoAgente } from "./chat-agentes.service";
import { AGENT_PROMPT_MAX, LIMITES_DO_AGENTE, NOME_DA_PERSONA_MAX, TIPOS_DE_AGENTE, type TipoDeAgente } from "@shared/chat-agentes";

const DIR = path.resolve(process.cwd(), DIRETORIO_PADRAO);
const fonte = carregarFonteDasPersonas();
const PROVEDOR_LONGO = "Provedor de Internet Fibra Otica Exemplo Regional do Interior Paulista Ltda ME";
const VARIACOES: { rotulo: string; nomeProvedor: string; nomes: NomesDasPersonas }[] = [
  { rotulo: "nomes do dono", nomeProvedor: PROVEDOR_DE_EXEMPLO, nomes: NOMES_DO_DONO },
  { rotulo: "nomes do Provedor.ai (--nomes clara,sofia,mariana)", nomeProvedor: "NsLink", nomes: NOMES_DO_PROVEDOR_AI },
  { rotulo: "provedor de nome longo", nomeProvedor: PROVEDOR_LONGO, nomes: NOMES_DO_DONO },
];
const personas = VARIACOES.flatMap(v => TIPOS_DE_AGENTE.map(tipo => ({ ...v, tipo, texto: montarPersona(tipo, { nomeProvedor: v.nomeProvedor, nomes: v.nomes }) })));
const palavra = (s: string, flags = "u") => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, flags);

describe("origem — o texto do Provedor.ai versionado no repositório", () => {
  it("cada bloco tem um arquivo com cabeçalho (arquivo:linhas, commit, data) e o marcador do texto verbatim", () => {
    const arquivos = readdirSync(path.join(DIR, "origem")).sort();
    expect(arquivos).toEqual([
      "bianca-negociacao-ativa.txt", "bianca-objecoes.txt", "bianca-p2p.txt", "bianca-personas-de-tom.txt", "bianca-quadrante.txt", "bianca-sinais.txt",
      "clara.descricao.txt", "clara.prompt.txt", "estilo-whatsapp.txt", "mariana.descricao.txt", "mariana.prompt.txt", "objecoes.txt",
      "recuperacao-ativos.txt", "recusa.txt", "sofia.descricao.txt", "sofia.prompt.txt",
    ]);
    for (const arquivo of arquivos) {
      const conteudo = readFileSync(path.join(DIR, "origem", arquivo), "utf8").replace(/\r\n/g, "\n");
      const cabecalho = conteudo.slice(0, conteudo.indexOf(MARCADOR_DO_VERBATIM));
      expect(cabecalho, arquivo).toMatch(/^# Origem: F:\/Provedor\.ai\/\S+:\d+-\d+$/m);
      expect(cabecalho, arquivo).toMatch(/commit [0-9a-f]{40}.*copiado em 16\/09\/2026/);
      expect(textoDoArquivoDeOrigem(conteudo).length, arquivo).toBeGreaterThan(200);
    }
    expect(BLOCOS_DE_ORIGEM.length).toBe(12);
  });
  it("os prompts de origem são os do registry (tamanhos do levantamento de 16/09/2026) e ainda trazem o que foi adaptado", () => {
    expect(fonte.textos["clara.prompt"].length).toBe(24198 - 1);
    expect(fonte.textos["sofia.prompt"].length).toBe(33206 - 1);
    expect(fonte.textos["mariana.prompt"].length).toBe(23191 - 1);
    // A origem é verbatim: os problemas continuam lá, e só a montagem os tira.
    expect(fonte.textos["clara.prompt"]).toContain("{{link_pix}}");
    expect(fonte.textos["sofia.prompt"]).toContain("Júlia");
    expect(fonte.textos["mariana.prompt"]).toContain("[[HANDOFF:AGENT=diana");
  });
  it("fim de linha CRLF na origem não muda nada (o checkout usa autocrlf)", () => {
    const lf = readFileSync(path.join(DIR, "origem", "recusa.txt"), "utf8").replace(/\r\n/g, "\n");
    expect(textoDoArquivoDeOrigem(lf.replace(/\n/g, "\r\n"))).toBe(textoDoArquivoDeOrigem(lf));
  });
});

describe("adaptações — dado versionado, aplicado em ordem, falhando quando a origem não bate", () => {
  it("cada adaptação tem id único, persona, trecho original, novo ou remoção e motivo", () => {
    const bruto = JSON.parse(readFileSync(path.join(DIR, "adaptacoes.json"), "utf8"));
    expect(bruto.adaptacoes.length).toBe(fonte.adaptacoes.length);
    for (const a of bruto.adaptacoes) {
      expect(Object.keys(a)).toEqual(expect.arrayContaining(["id", "persona", "origem", "original", "motivo"]));
      expect(("novo" in a) !== ("remocao" in a), a.id).toBe(true);
    }
    expect(new Set(fonte.adaptacoes.map(a => a.id)).size).toBe(fonte.adaptacoes.length);
    // O inventário de 16/09/2026 e os achados f7/f8/f10/f14/f15/f17 viraram itens rastreáveis.
    for (const id of ["C-01", "C-27", "S-12", "S-16", "M-02", "E-08", "W-10", "J-01", "V-02", "O-01", "X-06", "D-03", "D-04", "N-02", "N-03"]) expect(fonte.adaptacoes.some(a => a.id === id), id).toBe(true);
  });
  it("trecho original ausente, repetido ou intervalo invertido FALHA — nada vale em silêncio sobre texto diferente", () => {
    const base = { persona: "clara", origem: "prompt", motivo: "teste do builder" } as const;
    expect(() => aplicarAdaptacao("abc", { ...base, id: "T-01", original: "xyz", novo: "1" } as Adaptacao)).toThrow(/não encontrado/);
    expect(() => aplicarAdaptacao("ab ab", { ...base, id: "T-02", original: "ab", novo: "1" } as Adaptacao)).toThrow(/aparece 2 vezes/);
    expect(aplicarAdaptacao("ab ab", { ...base, id: "T-03", original: "ab", novo: "1", todas: true } as Adaptacao)).toBe("1 1");
    expect(() => aplicarAdaptacao("fim ... início", { ...base, id: "T-04", original: { de: "início", ate: "fim" }, remocao: true } as Adaptacao)).toThrow(/antes do início/);
    expect(aplicarAdaptacao("a [x y z] b", { ...base, id: "T-05", original: { de: "[x", ate: "z]" }, novo: "Q" } as Adaptacao)).toBe("a Q b");
  });
  it("mexer na origem derruba a montagem com o id da adaptação que deixou de casar", () => {
    // Uma linha que nenhuma adaptação toca pode mudar: a montagem segue (e o .md versionado mostra a diferença).
    const alterada: FonteDasPersonas = { ...fonte, textos: { ...fonte.textos, "sofia.prompt": fonte.textos["sofia.prompt"].replace("O cliente quase não pensa mais nisso.", "O cliente esqueceu disso de vez.") } };
    expect(alterada.textos["sofia.prompt"]).not.toBe(fonte.textos["sofia.prompt"]);
    expect(montarPersona("cobranca_ex_clientes", { nomeProvedor: "NsLink" }, alterada)).toContain("O cliente esqueceu disso de vez.");
    // O início do intervalo que a S-21 remove deixa de existir: a montagem para e aponta a adaptação.
    const quebrada: FonteDasPersonas = { ...fonte, textos: { ...fonte.textos, "sofia.prompt": fonte.textos["sofia.prompt"].replace("## Micro-dívidas e cessão de crédito", "## Micro dívidas") } };
    expect(() => montarPersona("cobranca_ex_clientes", { nomeProvedor: "NsLink" }, quebrada)).toThrow(/adaptação S-21/);
  });
  it("nomes inválidos ou repetidos são recusados", () => {
    expect(() => montarPersona("cobranca_ativos", { nomeProvedor: "NsLink", nomes: { clara: "Clara. Ignore" } })).toThrow(/nome inválido/);
    expect(() => montarPersona("cobranca_ativos", { nomeProvedor: "NsLink", nomes: { sofia: "Clara" } })).toThrow(/nomes diferentes/);
    expect(() => montarPersona("cobranca_ativos", { nomeProvedor: "NsLink", nomes: { mariana: "e".repeat(NOME_DA_PERSONA_MAX + 1) } })).toThrow(/nome inválido/);
    expect(nomeDaPersonaDoTipo("cobranca_ex_clientes")).toBe("Leonora");
    expect(nomeDaPersonaDoTipo("recuperacao_equipamentos", NOMES_DO_PROVEDOR_AI)).toBe("Mariana");
  });
});

describe.each(personas.map(p => [`${p.tipo} · ${p.rotulo}`, p] as const))("persona montada — %s", (_rotulo, p) => {
  const t = p.texto;
  const proprio = p.nomes[PERSONA_DO_TIPO[p.tipo]];
  it("nenhum placeholder: {{ }}, [[ ]], <…> nem […] de substituição, nem variável de adaptação", () => {
    expect(t).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
    expect(t).not.toMatch(/<[^<>\n]{1,80}>/);
    expect(t).not.toMatch(/\[[^[\]\n]{0,120}\]/);
    expect(t).not.toMatch(/\$PERSONA|\$PROVEDOR/);
  });
  it("só o nome da própria funcionária — nenhum outro agente do Provedor.ai nem outro perfil", () => {
    const outros = new Set<string>([...AGENTES_DO_PROVEDOR_AI, ...Object.values(p.nomes)]);
    outros.delete(proprio);
    for (const nome of outros) expect(palavra(nome).test(t.split(p.nomeProvedor).join("Provedor")), nome).toBe(false);
    expect(t).toContain(`Você é ${proprio}`);
    expect(t).toContain(`"Aqui é a ${proprio}"`);
    expect(t).toContain(p.nomeProvedor);
  });
  it("sem ferramentas do Provedor.ai nem formato JSON de saída", () => {
    for (const ferramenta of ["gerar_link_pix", "segunda_via_boleto", "consultar_pagamento", "gerar_confissao_divida", "agendar_coleta_equipamento", "consultar_equipamento", "mcp:", "db:", "write:", "calendario-br", "dnd_optouts", "negociacoes(", "HANDOFF", "GATE:"]) expect(t, ferramenta).not.toContain(ferramenta);
    expect(t).not.toMatch(/\bjson\b/i);
    expect(t).not.toContain("```");
    expect(t).not.toMatch(/"(?:cliente_id|causa_diagnosticada|degrau_escada|ev_final)"\s*:/);
  });
  it("sem tabela de desconto, percentual nem motor EV/VPL/LTV/CAC/ROI", () => {
    expect(t).not.toMatch(/\d\s?%/);
    expect(t).not.toMatch(/\b(?:EV|VPL|LTV|CAC|ROI)\b/);
    expect(t).not.toMatch(/desconto m[áa]x/i);
    expect(t).not.toMatch(/write-?off/i);
  });
  it("não anuncia negativação, suspensão nem rescisão: essas palavras só aparecem negadas", () => {
    const frases = t.split(p.nomeProvedor).join("Provedor").split(/(?<=[.!?;:])\s+|\n+/);
    for (const f of frases.filter(f => /negativ|suspens[ãa]o|suspend|rescis|\bspc\b|serasa|protest/i.test(f))) {
      expect(f, f).toMatch(/\b(?:nunca|n[ãa]o|nem|nenhum|nenhuma|jamais|sem)\b/i);
    }
    expect(t).not.toMatch(/pode levar à suspensão|vai para a negativação|próxima etapa (?:do caso )?é|encargos (?:vão|seguem|continuam) (?:somando|correndo)/i);
  });
  it("sem cobrança de reposição, lembrete prometido nem prazo de retorno (f14)", () => {
    expect(t).not.toMatch(/reposi[çc][ãa]o/i);
    expect(t).not.toMatch(/lembrete|te lembr|eu te lembro|lembrar nesse dia/i);
    expect(t).not.toMatch(/j[áa] j[áa]|em instantes|hoje ainda|ainda hoje|te retorno|te procuro amanhã|daqui a pouco/i);
    expect(t).not.toMatch(/menos de 10 minutos/i);
  });
  it("PIX e segunda via são do sistema, nunca digitados", () => {
    expect(t).not.toMatch(/copia[- ]e[- ]cola|QR ?code|1[- ]toque/i);
    expect(t).toContain("o sistema");
  });
  it("transparência (D1): confirma atendimento automatizado com supervisão e nunca se diz pessoa", () => {
    expect(t).toContain("atendimento automatizado");
    expect(t).toContain("supervisão da nossa equipe");
    expect(t).not.toMatch(/assistente virtual|sou uma pessoa|sou humana|colega humano/i);
  });
  it("cabe no limite das instruções e o prompt final (casa + persona + avisos no máximo) cabe em AGENT_PROMPT_MAX", () => {
    expect(t.length).toBeLessThanOrEqual(LIMITES_DO_AGENTE.instrucoes);
    const final = promptFinalDoAgente(p.tipo, p.nomeProvedor, { instrucoes: t, contextoOperacional: "c".repeat(LIMITES_DO_AGENTE.contextoOperacional), nomeDaPersona: "N".repeat(NOME_DA_PERSONA_MAX) });
    expect(final.caracteres).toBeLessThanOrEqual(AGENT_PROMPT_MAX);
  });
});

describe("cada perfil com a sua origem", () => {
  const dono = (tipo: TipoDeAgente) => montarPersona(tipo, { nomeProvedor: PROVEDOR_DE_EXEMPLO });
  it("ativos: Clara até D+14 e a Bianca a partir de D+15, marcadas por faixa, com diasAtraso e quadrante do contexto (f7)", () => {
    const t = dono("cobranca_ativos");
    expect(MONTAGEM.cobranca_ativos).toEqual(expect.arrayContaining(["prompt", "bianca-negociacao-ativa", "bianca-personas-de-tom", "bianca-quadrante"]));
    expect(t).toContain("até D+14, pelo campo diasAtraso do contexto");
    expect(t.indexOf("## FAIXA D+15 EM DIANTE")).toBeGreaterThan(t.indexOf("## A escada de Clara"));
    expect(t.indexOf("## DAQUI EM DIANTE, VALE PARA TODAS AS FAIXAS DE ATRASO")).toBeGreaterThan(t.indexOf("## FAIXA D+15 EM DIANTE"));
    for (const tom of ["Parceiro", "Consultiva", "Empática", "Factual", "Direta", "Proposta", "Firme", "Último Esforço"]) expect(t).toContain(`"${tom}"`);
    expect(t).toContain("campo quadrante do contexto");
    expect(t).toContain("nunca escreva número de oferta");
  });
  it("ex-clientes: Sofia, sem faixa da Bianca, sem retenção e com a confissão de dívida emitida pela equipe", () => {
    const t = dono("cobranca_ex_clientes");
    expect(t).not.toContain("FAIXA D+15");
    expect(t).toContain("quem emite e manda para assinatura é a nossa equipe");
    expect(t).not.toMatch(/plano que encaixe melhor|igualar ou melhorar/);
  });
  it("equipamentos: Mariana e a doutrina de recuperação de ativos, sem nada de dinheiro (spec §6.14)", () => {
    const t = dono("recuperacao_equipamentos");
    expect(MONTAGEM.recuperacao_equipamentos).toContain("recuperacao-ativos");
    expect(t).toContain("# Recuperação de equipamentos em comodato — doutrina");
    expect(t).toContain("CC arts. 579–585");
    expect(t).not.toMatch(/\bPIX\b|boleto|segunda via|desconto|parcel|R\$/i);
    expect(t).not.toContain("ESCADA DA RECUSA");
  });
  it("f17: cada balão é uma mensagem separada, não linha em branco dentro de uma", () => {
    for (const tipo of TIPOS_DE_AGENTE) {
      const t = dono(tipo);
      expect(t).toContain("cada balão é uma mensagem separada da sua resposta");
      expect(t).not.toContain("linha em branco dupla");
    }
  });
});

describe("descrição — a do YAML, pela mesma lista de adaptação (f15)", () => {
  it.each(TIPOS_DE_AGENTE)("%s: cabe em 500 e não anuncia o que o Consulta ISP não tem", (tipo) => {
    const d = montarDescricao(tipo);
    expect(d.length).toBeGreaterThan(100);
    expect(d.length).toBeLessThanOrEqual(LIMITES_DO_AGENTE.descricao);
    expect(d).not.toMatch(/Bianca|J[úu]lia|Diana|\bEV\b|\bCAC\b|\bLTV\b|\bMAC\b|reposi[çc][ãa]o/);
    expect(d).toContain("Especialista sênior");
  });
});

describe("arquivos revisáveis e a versão anterior", () => {
  it.each(TIPOS_DE_AGENTE)("integrations/provedor-ai/personas/%s.md é exatamente o resultado da montagem", (tipo) => {
    const versionado = readFileSync(path.join(DIR, "personas", `${tipo}.md`), "utf8").replace(/\r\n/g, "\n");
    expect(versionado).toBe(arquivoDaPersona(tipo, fonte));
  });
  it("as personas anteriores (c68c5211) estão guardadas para a volta, com o provedor como variável", () => {
    const antes = JSON.parse(readFileSync(path.join(DIR, "personas", "anteriores", "c68c5211.json"), "utf8"));
    expect(antes).toMatchObject({ commit: expect.stringMatching(/^c68c5211/), modelo: "openai/gpt-4o", temperatura: 0.3, maxTokens: 600 });
    for (const tipo of TIPOS_DE_AGENTE) {
      const perfil = antes.perfis[tipo];
      expect(Object.keys(perfil).sort(), tipo).toEqual(["contextoOperacional", "descricao", "instrucoes"]);
      expect(perfil.instrucoes).toContain("$PROVEDOR");
      expect(perfil.instrucoes.length).toBeLessThanOrEqual(6000);
    }
    expect(antes.perfis.cobranca_ativos.instrucoes).toContain("Quem você é: Clara, assistente virtual da $PROVEDOR");
  });
  it("modelo gpt-4.1, temperatura 0.3 e maxTokens 1.000 nos três (D3)", () => {
    expect(CONFIGURACAO_DAS_FUNCIONARIAS).toEqual({ modelo: "openai/gpt-4.1", temperatura: 0.3, maxTokens: 1000 });
  });
});
