/**
 * As rotas cujo corpo de resposta NAO pode virar linha de log.
 *
 * A consulta cadastral estava de fora, e ela devolve o maior dossie do sistema:
 * nome, nascimento, nome da mae, enderecos, telefones e o array `emails`, com
 * endereco de e-mail em texto puro. O corpo inteiro ia para o arquivo de log a
 * cada consulta — e o log de producao e replicado a cada rotacao.
 *
 * `sanitizeForLog` nao servia de rede: ele censura por NOME DE CHAVE, no
 * singular. O primeiro teste abaixo demonstra o furo em vez de descreve-lo.
 *
 * A lista mora em `server/index.ts`, que sobe o servidor ao ser importado —
 * por isso este teste le o fonte em vez de importar o modulo. E o mesmo motivo
 * que fez `sanitizeForLog` mudar de arquivo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sanitizeForLog } from "./utils/sanitize-log";

const fonteDoIndex = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8",
);

/**
 * O conteudo do array `SENSITIVE_ROUTES`, como o arquivo o declara.
 *
 * Os comentarios saem ANTES da varredura por aspas. Sem isso, uma rota citada
 * dentro de um comentario do bloco entrava na lista como se estivesse
 * declarada — e o teste passaria a afirmar protecao que nao existe. Foi o que
 * aconteceu quando o bloco ganhou um JSDoc explicando por que a consulta
 * cadastral entrou.
 */
function rotasSensiveis(): string[] {
  const bloco = fonteDoIndex.match(/const SENSITIVE_ROUTES = \[([\s\S]*?)\];/);
  if (!bloco) throw new Error("SENSITIVE_ROUTES nao encontrado em server/index.ts");
  const semComentario = bloco[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return Array.from(semComentario.matchAll(/"([^"]+)"/g)).map(m => m[1]);
}

describe("SENSITIVE_ROUTES", () => {
  it("sanitizeForLog NAO cobre o que a consulta cadastral devolve", () => {
    // Este e o furo que obrigou a rota a entrar na lista: a censura procura
    // "email", e a BigDataCorp devolve "emails".
    const corpo = sanitizeForLog({
      emails: ["fulano@exemplo.com"],
      enderecos: [{ logradouro: "Rua das Flores", numero: "100", cidade: "Porto Alegre" }],
      telefones: [{ ddd: "51", numero: "999998888" }],
      identidade: { nome: "FULANO DE TAL" },
    });
    // Passam limpos: a lista tem "email", "address" e "telefone" no singular,
    // e o que a BigDataCorp devolve e no plural, com os campos dentro.
    expect(corpo.emails[0]).toBe("fulano@exemplo.com");
    expect(corpo.enderecos[0].logradouro).toBe("Rua das Flores");
    expect(corpo.enderecos[0].numero).toBe("100");
    expect(corpo.telefones[0].numero).toBe("999998888");
    // "nome" esta na lista e e censurado — a censura por chave pega UM campo
    // e deixa o resto do dossie passar. E por isso que a rota inteira precisa
    // ficar de fora do log, e nao mais um nome de chave na lista.
    expect(corpo.identidade.nome).toBe("[REDACTED]");
  });

  it("a consulta cadastral esta na lista, junto das outras consultas", () => {
    const rotas = rotasSensiveis();
    expect(rotas).toContain("/api/bigdata-consultations");
    // As que ja estavam: perder uma delas e o mesmo tipo de vazamento.
    expect(rotas).toContain("/api/isp-consultations");
    expect(rotas).toContain("/api/spc-consultations");
    expect(rotas).toContain("/api/public/titular-request");
  });

  it("o corpo so e suprimido por prefixo — a rota precisa casar do inicio", () => {
    // Espelha o `path.startsWith(r)` do middleware: e assim que o GET do
    // historico e o POST da consulta ficam cobertos pela mesma entrada.
    const rotas = rotasSensiveis();
    const coberta = (p: string) => rotas.some(r => p.startsWith(r));
    expect(coberta("/api/bigdata-consultations")).toBe(true);
    expect(coberta("/api/bigdata-integration")).toBe(false);
  });
});
