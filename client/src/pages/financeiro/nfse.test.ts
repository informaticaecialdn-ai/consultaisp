/**
 * O selo do ambiente da tela de NFS-e. Na demonstração o servidor responde
 * `environment: "demonstracao"` (nfse.routes.ts) e a nota é simulada; antes, a
 * tela só conhecia "producao" e mostrava HOMOLOGACAO para todo o resto — a
 * nota de mentira parecia homologação real da Focus. Fora da demonstração os
 * dois rótulos de sempre continuam iguais.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sessao = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({ provider: { id: 42, name: "Provedor" }, demoMode: sessao.demoMode }),
}));

import NfsePage, { municipioDaNfse, prestadorDaNfse, seloDoAmbienteNfse } from "./nfse";

describe("seloDoAmbienteNfse", () => {
  it("demonstracao: rotulo proprio e aviso de nota simulada", () => {
    expect(seloDoAmbienteNfse("demonstracao")).toEqual({ rotulo: "DEMONSTRACAO", simulado: true });
  });

  it("fora da demonstracao nada muda: producao e homologacao, sem aviso", () => {
    expect(seloDoAmbienteNfse("producao")).toEqual({ rotulo: "PRODUCAO", simulado: false });
    expect(seloDoAmbienteNfse("homologacao")).toEqual({ rotulo: "HOMOLOGACAO", simulado: false });
    expect(seloDoAmbienteNfse(undefined)).toEqual({ rotulo: "HOMOLOGACAO", simulado: false });
  });
});

/** O que o servidor responde hoje fora da demonstração (nfse.routes.ts). */
const CONFIG_DE_PRODUCAO = {
  configured: false, environment: "homologacao", cnpjPrestador: "64199963000149", inscricaoMunicipal: "",
  codigoMunicipio: "3550308", aliquotaIss: 2.9, codigoServico: "01.07",
  descricaoPadrao: "Licenciamento de uso de software SaaS - Consulta ISP - Analise de credito para provedores de internet",
};

const CONFIG_DA_DEMONSTRACAO = {
  configured: true, environment: "demonstracao", cnpjPrestador: "12345678000190",
  razaoSocialPrestador: "PROVEDOR DEMONSTRACAO LTDA", inscricaoMunicipal: "",
  codigoMunicipio: "4113700", municipio: "Londrina", uf: "PR", aliquotaIss: 2, codigoServico: "01.03",
  descricaoPadrao: "Serviço de valor adicionado — provimento de acesso à internet",
};

const NOTAS = [
  { ref: "demo-42-1757170800000", status: "processing", tomadorNome: "Condomínio Residencial Exemplo", valor: 890, emitidaEm: "2026-09-06T15:00:00.000Z", mensagem: "Em processamento" },
  { ref: "demo-42-1756566000000", status: "authorized", numero: "000000", tomadorNome: "Mercado Fictício Ltda", valor: 349.9, emitidaEm: "2026-08-30T15:00:00.000Z" },
];

function renderizar(demoMode: boolean, respostas: Record<string, unknown>) {
  sessao.demoMode = demoMode;
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  for (const [chave, dado] of Object.entries(respostas)) queryClient.setQueryData([chave], dado);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(NfsePage)));
  queryClient.clear();
  return html;
}

describe("município e prestador lidos da config", () => {
  it("config sem município (a de hoje fora da demo): São Paulo, como o texto fixo de antes", () => {
    expect(municipioDaNfse(CONFIG_DE_PRODUCAO)).toEqual({ nome: "Sao Paulo", uf: "SP" });
    expect(municipioDaNfse(undefined)).toEqual({ nome: "Sao Paulo", uf: "SP" });
    expect(prestadorDaNfse(CONFIG_DE_PRODUCAO)).toBeNull();
  });

  it("config da demonstração: Londrina/PR e o prestador do próprio sandbox", () => {
    expect(municipioDaNfse(CONFIG_DA_DEMONSTRACAO)).toEqual({ nome: "Londrina", uf: "PR" });
    expect(prestadorDaNfse(CONFIG_DA_DEMONSTRACAO)).toBe("PROVEDOR DEMONSTRACAO LTDA · CNPJ 12.345.678/0001-90");
  });
});

describe("tela de NFS-e (SSR)", () => {
  it("demonstração: cabeçalho de Londrina, prestador do sandbox e o histórico de notas com 'Verificar'", () => {
    const html = renderizar(true, { "/api/nfse/config": CONFIG_DA_DEMONSTRACAO, "/api/nfse": NOTAS });
    expect(html).toContain("Prefeitura de Londrina");
    expect(html).toContain("Londrina - PR");
    expect(html).not.toContain("Sao Paulo");
    expect(html).toContain("12.345.678/0001-90");
    expect(html).toContain("Condomínio Residencial Exemplo");
    expect(html).toContain("Mercado Fictício Ltda");
    expect(html).toContain("Verificar");
    expect(html).toContain("2 nota(s)");
  });

  it("fora da demonstração: o cabeçalho de sempre e nenhum histórico, mesmo com algo no cache", () => {
    const html = renderizar(false, { "/api/nfse/config": CONFIG_DE_PRODUCAO, "/api/nfse": NOTAS });
    expect(html).toContain("Emissao de NFS-e via Focus NFe — Prefeitura de Sao Paulo");
    expect(html).toContain("Municipio: <strong>Sao Paulo - SP</strong>");
    expect(html).not.toContain("Notas Emitidas");
    expect(html).not.toContain("Condomínio Residencial Exemplo");
    expect(html).not.toContain("CNPJ 64.199.963/0001-49");
  });
});
