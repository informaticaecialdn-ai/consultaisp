/**
 * A landing não tem login (dono, 11/09/2026).
 *
 * Cada provedor entra só pelo endereço dele (seuprovedor.consultaisp.com.br);
 * na raiz o servidor recusa o login de provedor. Um "Login" aqui mandava o
 * provedor para um "Email ou senha incorretos" sem ele ter errado nada.
 *
 * Teste de FONTE, como os vizinhos `.tsx`: o que ele prende é a volta do botão
 * numa atualização do desenho — o standalone do dono trazia "Login" no topo e
 * "Já tem conta? Fazer login" no bloco final.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "../../../..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

/** Só o código: o comentário que explica a regra cita o que saiu. */
const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const landing = semComentarios(ler("client/src/pages/public/landingpage.tsx"));
const css = ler("client/src/pages/public/landingpage.css");

describe("a landing só leva ao cadastro", () => {
  it("o único endereço de /login na página é o do cadastro", () => {
    const destinos = Array.from(landing.matchAll(/["'`](\/login[^"'`]*)["'`]/g)).map(m => m[1]);
    expect(destinos).toEqual(["/login?mode=register"]);
  });

  it("nenhum botão ou link de entrar no texto", () => {
    expect(landing).not.toMatch(/>\s*(Login|Entrar|Fazer login)\s*</);
    expect(landing).not.toContain("Já tem conta");
    expect(landing).not.toContain("nav-login");
  });

  it("o CSS do que saiu não ficou para trás", () => {
    expect(css).not.toMatch(/nav-login|final-cta-login/);
  });

  it("o cadastro continua no topo e no bloco final", () => {
    expect(landing).toMatch(/<div className="nav-right">\s*<a href=\{CADASTRO\}/);
    expect(landing).toMatch(/<div className="final-cta-buttons">\s*<a href=\{CADASTRO\}/);
  });
});
