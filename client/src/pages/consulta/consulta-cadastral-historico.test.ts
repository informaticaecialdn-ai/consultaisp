/**
 * Coluna "Datasets" do Histórico da Consulta Cadastral.
 *
 * A rota `GET /api/bigdata-consultations` (server/routes/bigdata.routes.ts) NÃO
 * manda `datasets[]` ao navegador — a origem do dado é informação sensível de
 * negócio e fica só no servidor. O que ela publica é a contagem pronta, em
 * `consultasRealizadas`. A tela lia `c.datasets?.length`, campo que nunca chega:
 * a coluna mostrava 0 em toda linha, para todo provedor.
 *
 * A página é um componente grande sem ambiente de DOM neste projeto (ver o
 * `include` do vitest.config.ts); como em `admin-erp-pausa.test.ts`, o que se
 * trava é o texto da fonte, amarrado ao nome que a rota realmente publica.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const semComentario = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\s*\}/g, "");

const tela = readFileSync(join(__dirname, "consulta-cadastral.tsx"), "utf8");
const historico = semComentario(
  tela.slice(tela.indexOf('activeTab === "historico"'), tela.indexOf('activeTab === "info"')),
);

const rota = readFileSync(
  join(__dirname, "..", "..", "..", "..", "server", "routes", "bigdata.routes.ts"),
  "utf8",
);
const mapaDaRota = semComentario(
  rota.slice(rota.indexOf("const consultations = brutas.map"), rota.indexOf("const provider = await")),
);

describe("histórico da consulta cadastral — coluna Datasets", () => {
  it("a rota publica a contagem em consultasRealizadas, e não o datasets[] cru", () => {
    expect(mapaDaRota).toContain("consultasRealizadas:");
    // `datasets` só aparece do lado direito (c.datasets?.length), nunca como chave.
    expect(mapaDaRota).not.toMatch(/[{,\s]datasets\s*:/);
  });

  it("a coluna lê o campo que a rota manda — senão fica 0 em toda linha", () => {
    expect(historico.length).toBeGreaterThan(0);
    expect(historico).toContain("c.consultasRealizadas");
    expect(historico).not.toContain("c.datasets");
  });
});
