/**
 * "Salvar PDF" da Consulta SPC: o relatório vira arquivo pela rota
 * `GET /api/spc-consultations/:id/pdf`, montado da linha gravada.
 *
 * A página é um componente grande sem ambiente de DOM neste projeto (ver o
 * `include` do vitest.config.ts); como em `consulta-cadastral-historico.test.ts`,
 * o que se trava é o texto da fonte: o link existe no resultado e em cada
 * linha do histórico, é um `<a href>` (o navegador baixa com o cookie da
 * sessão, sem fetch), e o id vem de onde a rota o manda.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const semComentario = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\s*\}/g, "");

const fonte = semComentario(readFileSync(join(__dirname, "consulta-spc.tsx"), "utf8"));
const entre = (de: string, ate: string) => {
  const i = fonte.indexOf(de);
  const j = fonte.indexOf(ate, i);
  expect(i, de).toBeGreaterThan(-1);
  expect(j, ate).toBeGreaterThan(i);
  return fonte.slice(i, j);
};
const sucesso = entre("onSuccess: (data) => {", "onError:");
const doHistorico = entre("const abrirDoHistorico = (c: any) => {", "const handleSearch");
const resultado = entre('data-testid="spc-result"', '<TabsContent value="historico">');
const historico = entre('<TabsContent value="historico">', '<TabsContent value="info">');

describe("Consulta SPC — salvar em PDF", () => {
  it("a consulta nova guarda o id que a rota devolve; o histórico usa o id da linha", () => {
    expect(sucesso).toContain("setConsultaGravadaId(");
    expect(sucesso).toContain("data.id");
    expect(doHistorico).toContain("setConsultaGravadaId(");
    expect(doHistorico).toContain("c.id");
  });

  it("o resultado tem o link do PDF: <a href> para a rota, só com linha gravada, sem fetch", () => {
    expect(resultado).toContain("href={`/api/spc-consultations/${consultaGravadaId}/pdf`}");
    expect(resultado).toContain('data-testid="link-spc-pdf"');
    expect(resultado).toContain("consultaGravadaId != null &&");
    expect(resultado).not.toContain("fetch(");
  });

  it("cada linha do histórico tem o link, e o clique nele não abre a linha", () => {
    expect(historico).toContain("href={`/api/spc-consultations/${c.id}/pdf`}");
    expect(historico).toContain("e.stopPropagation()");
  });

  it("limpar e erro zeram o id: sem consulta na tela, sem link", () => {
    expect((fonte.match(/setConsultaGravadaId\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
