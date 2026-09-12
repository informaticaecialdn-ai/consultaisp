import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * O Meta Pixel de `client/index.html` — revisão final de segurança antes da
 * demonstração pública (item 4).
 *
 * A demonstração serve o MESMO build da plataforma, e o snippet já era
 * guardado por hostname (`(^|\.)consultaisp\.com\.br$`) para não disparar em
 * localhost, preview ou host white label (aquela faixa inteira do HTML é
 * trocada em `server/marca-html.ts`). O problema é que esse mesmo regex
 * COBRE `demo.consultaisp.com.br` de propósito — é assim que ele também
 * cobre um revendedor sem marca própria — então, sem uma exclusão explícita
 * do host da demo, todo visitante anônimo do sandbox era reportado ao Meta
 * (URL, referrer, IP, cookie) sem consentimento, poluindo a conversão real
 * do dono com tráfego de demonstração.
 *
 * Este teste não importa nenhum módulo — `index.html` não é TypeScript. Ele
 * lê o ARQUIVO DE VERDADE, extrai o bloco de script que contém o Meta Pixel
 * (pela presença de "fbevents.js", não por número de linha, para não quebrar
 * com uma edição vizinha) e o executa numa sandbox `vm` com `window`/`document`
 * falsos — a mesma técnica de sempre para testar um snippet de browser fora
 * do browser. `sandbox.window = sandbox` reproduz a única coisa que faz o
 * snippet funcionar num browser de verdade: `window.fbq = ...` e a chamada
 * solta `fbq(...)` mais abaixo serem A MESMA coisa porque `window` É o
 * escopo global.
 */

const HTML_PATH = path.join(__dirname, "..", "index.html");

function extrairScriptDoPixel(): string {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const codigo = blocos.find(s => s.includes("fbevents.js"));
  if (!codigo) {
    throw new Error("Bloco do Meta Pixel nao encontrado em client/index.html — o snippet mudou de forma?");
  }
  return codigo;
}

/** Roda o snippet do pixel como um browser rodaria, para o `hostname` dado. */
function rodarPixelPara(hostname: string) {
  const codigo = extrairScriptDoPixel();
  let elementoCriado: { async?: boolean; src?: string } | null = null;
  const chamadasDeInsertBefore: unknown[][] = [];
  const scriptExistente = {
    parentNode: {
      insertBefore: (...args: unknown[]) => { chamadasDeInsertBefore.push(args); },
    },
  };

  const sandbox: any = {
    document: {
      createElement: () => { elementoCriado = {}; return elementoCriado; },
      getElementsByTagName: () => [scriptExistente],
    },
    location: { hostname },
  };
  // window === o proprio escopo global da sandbox — e o que faz `f.fbq = ...`
  // (dentro do snippet, `f` e o parametro `window`) e a chamada solta
  // `fbq(...)` mais abaixo serem a MESMA referencia, exatamente como no browser.
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);

  return {
    fbqFoiCriado: typeof sandbox.fbq === "function",
    elementoCriado: elementoCriado as { async?: boolean; src?: string } | null,
    inseriuScriptNoDom: chamadasDeInsertBefore.length > 0,
  };
}

describe("Meta Pixel em client/index.html — guarda de hostname", () => {
  it("NAO dispara para demo.consultaisp.com.br", () => {
    const r = rodarPixelPara("demo.consultaisp.com.br");

    expect(r.fbqFoiCriado).toBe(false);
    expect(r.elementoCriado).toBeNull();
    expect(r.inseriuScriptNoDom).toBe(false);
  });

  it("continua disparando no host da plataforma (consultaisp.com.br)", () => {
    const r = rodarPixelPara("consultaisp.com.br");

    expect(r.fbqFoiCriado).toBe(true);
    expect(r.elementoCriado).toMatchObject({ async: true, src: "https://connect.facebook.net/en_US/fbevents.js" });
    expect(r.inseriuScriptNoDom).toBe(true);
  });

  it("continua disparando num subdominio de tenant/revenda (ex.: nslink.consultaisp.com.br)", () => {
    const r = rodarPixelPara("nslink.consultaisp.com.br");

    expect(r.fbqFoiCriado).toBe(true);
  });

  it("continua sem disparar em localhost", () => {
    const r = rodarPixelPara("localhost");

    expect(r.fbqFoiCriado).toBe(false);
  });

  // O host da demo tem que ser comparado por SUFIXO DE RÓTULO (o mesmo
  // cuidado de `hostPermitido`, shared/chat-console.ts), nao por CONTER a
  // palavra "demo" solta — senão um subdominio de tenant como
  // "minhademo.consultaisp.com.br" também perderia o pixel por engano.
  it("um host que so CONTEM a palavra demo, mas nao e o host da demo, continua disparando", () => {
    const r = rodarPixelPara("minhademo.consultaisp.com.br");

    expect(r.fbqFoiCriado).toBe(true);
  });

  // Revisão final de segurança (item 6): a exclusão era por IGUALDADE exata
  // — só pegava "demo.consultaisp.com.br" literal, nunca um subdomínio dele.
  it("NAO dispara para um subdominio do host da demo (ex.: algo.demo.consultaisp.com.br)", () => {
    const r = rodarPixelPara("algo.demo.consultaisp.com.br");

    expect(r.fbqFoiCriado).toBe(false);
  });
});
