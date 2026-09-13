/**
 * O formulário "Credencial da consulta cadastral", na demonstração e fora dela.
 *
 * Na demonstração o servidor diz `configurado: true` (a cadastral responde
 * simulada, sem credencial) e recusa com 403 qualquer PATCH de credencial —
 * a BigDataCorp nunca é chamada por um visitante. Mas o botão "Credencial"
 * abria o formulário de sempre: o visitante digitava, salvava e recebia um
 * toast "Erro". Lá o formulário vira somente leitura, com o aviso do porquê.
 *
 * `Configuracao` lê `demoMode` de `useAuth`; o hook vira estado controlado e o
 * componente é renderizado de verdade (SSR) nos dois lados.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import { Configuracao } from "./consulta-cadastral";

const INTEGRACAO = { configurado: true, login: null, senhaMascarada: null, isEnabled: false, lastCheckStatus: null };

const renderizar = () =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(Configuracao, { integracao: INTEGRACAO })),
  );

/** A tag de abertura do elemento com este data-testid. */
const tag = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("Credencial da consulta cadastral", () => {
  beforeEach(() => {
    auth.demoMode = false;
  });

  it("fora da demonstração: formulário editável com o botão de salvar, sem aviso", () => {
    const html = renderizar();
    expect(tag(html, "botao-salvar-credencial")).not.toBe("");
    expect(tag(html, "campo-login")).not.toMatch(/\sdisabled=""/);
    expect(tag(html, "campo-senha")).not.toMatch(/\sdisabled=""/);
    expect(html).not.toContain('data-testid="aviso-credencial-demo"');
  });

  it("na demonstração: campos somente leitura, sem botão de salvar, com o aviso", () => {
    auth.demoMode = true;
    const html = renderizar();
    expect(tag(html, "botao-salvar-credencial")).toBe("");
    expect(tag(html, "campo-login")).toMatch(/\sdisabled=""/);
    expect(tag(html, "campo-senha")).toMatch(/\sdisabled=""/);
    expect(tag(html, "aviso-credencial-demo")).not.toBe("");
    expect(html).toContain("Credencial da demonstração");
  });
});
