/**
 * O Painel do Provedor na demonstração pública.
 *
 * O sandbox tem subdomínio (`sandbox-<hex>`), mas nenhum DNS aponta para ele:
 * o link do cabeçalho e o "Abrir" da aba do subdomínio levavam o visitante a
 * um endereço que não existe, e o card de DNS dava instrução de
 * infraestrutura para quem só está conhecendo o produto. E o CEP da ficha
 * perguntava ao viacep.com.br pelo navegador — tráfego para fora da demo.
 *
 * Fora da demonstração nada muda (os dois lados abaixo). O sinal é o mesmo par
 * da FaixaDemonstracao: `demoMode` do servidor E o prefixo do subdomínio.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

const sessao = vi.hoisted(() => ({ demoMode: false, subdomain: "provedor" }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({
    user: { id: 1, name: "Operador", role: "admin" },
    provider: { id: 1, name: "Provedor", plan: "enterprise", subdomain: sessao.subdomain },
    personificando: false,
    demoMode: sessao.demoMode,
    marca: null,
    logout: vi.fn(),
    recarregar: vi.fn(),
  }),
}));

import PainelProvedorPage, { cepParaViaCep } from "./painel-provedor";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderizar(aba: string, demoMode: boolean, subdomain: string) {
  sessao.demoMode = demoMode;
  sessao.subdomain = subdomain;
  vi.stubGlobal("window", { location: { search: aba ? `?tab=${aba}` : "" } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient },
      createElement(Router, { ssrPath: "/painel-provedor" }, createElement(PainelProvedorPage))),
  );
  queryClient.clear();
  return html;
}

const LINK_PARA_SUBDOMINIO = /href="https:\/\/[^"]*consultaisp\.com\.br/;
const SANDBOX = "sandbox-0123456789abcdef";

describe("subdomínio do sandbox no Painel do Provedor", () => {
  it("demonstração: cabeçalho sem link nem botão de copiar para o subdomínio do sandbox", () => {
    const html = renderizar("", true, SANDBOX);
    expect(html).not.toMatch(LINK_PARA_SUBDOMINIO);
    expect(html).not.toContain('data-testid="button-copy-subdomain"');
  });

  it("demonstração: aba do subdomínio sem 'Abrir', sem copiar e sem o card de DNS, com o porquê", () => {
    const html = renderizar("subdominio", true, SANDBOX);
    expect(html).not.toMatch(LINK_PARA_SUBDOMINIO);
    expect(html).not.toContain('data-testid="link-open-subdomain"');
    expect(html).not.toContain('data-testid="button-copy-subdomain"');
    expect(html).not.toContain("DNS e Configuracao de Producao");
    expect(html).toContain('data-testid="aviso-subdominio-demonstracao"');
  });

  it("fora da demonstração: cabeçalho e aba continuam com link, copiar e card de DNS", () => {
    const cabecalho = renderizar("", false, "provedor");
    expect(cabecalho).toContain('href="https://provedor.consultaisp.com.br"');
    expect(cabecalho).toContain('data-testid="button-copy-subdomain"');

    const aba = renderizar("subdominio", false, "provedor");
    expect(aba).toContain('data-testid="link-open-subdomain"');
    expect(aba).toContain("DNS e Configuracao de Producao");
    expect(aba).not.toContain('data-testid="aviso-subdominio-demonstracao"');
  });

  it("só o prefixo não basta: sem demoMode do servidor, um subdomínio 'sandbox-' mantém tudo", () => {
    const aba = renderizar("subdominio", false, SANDBOX);
    expect(aba).toContain('data-testid="link-open-subdomain"');
    expect(aba).toContain("DNS e Configuracao de Producao");
  });
});

describe("CEP da ficha da empresa", () => {
  it("demonstração: nunca pergunta ao ViaCEP", () => {
    expect(cepParaViaCep(true, "86010-000")).toBeNull();
    expect(cepParaViaCep(true, "86010000")).toBeNull();
  });

  it("fora da demonstração: 8 dígitos seguem para a busca, como antes; incompleto não", () => {
    expect(cepParaViaCep(false, "86010-000")).toBe("86010000");
    expect(cepParaViaCep(undefined, "86010000")).toBe("86010000");
    expect(cepParaViaCep(false, "8601")).toBeNull();
  });

  it("trava de fonte: o fetch do ViaCEP só acontece depois da decisão de cepParaViaCep", () => {
    const fonte = readFileSync(join(__dirname, "painel-provedor.tsx"), "utf8");
    const inicio = fonte.indexOf("const handleCepLookup");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = fonte.slice(inicio, fonte.indexOf("};", inicio));
    const decisao = corpo.indexOf("cepParaViaCep(demoMode");
    expect(decisao).toBeGreaterThan(-1);
    expect(corpo.indexOf("https://viacep.com.br/")).toBeGreaterThan(decisao);
    // Uma única URL do ViaCEP no arquivo inteiro: nenhuma busca por fora desta.
    expect(fonte.match(/https:\/\/viacep\.com\.br\//g)).toHaveLength(1);
  });
});
