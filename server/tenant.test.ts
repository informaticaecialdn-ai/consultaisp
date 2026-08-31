import { describe, it, expect } from "vitest";
import { normalizarHost, extractSubdomainFromHost } from "./tenant";

describe("normalizarHost", () => {
  it("reduz as formas que chegam de verdade", () => {
    const casos: [string, string][] = [
      ["nslink.consultaisp.com.br", "nslink.consultaisp.com.br"],
      ["NSLink.ConsultaISP.com.BR", "nslink.consultaisp.com.br"],
      ["https://app.crednet.com.br/", "app.crednet.com.br"],
      ["http://app.crednet.com.br/painel?x=1", "app.crednet.com.br"],
      ["localhost:5000", "localhost"],
      ["consultaisp.com.br.", "consultaisp.com.br"],
      ["  consultaisp.com.br  ", "consultaisp.com.br"],
      ["", ""],
    ];
    for (const [entrada, esperado] of casos) {
      expect(normalizarHost(entrada), `entrada: ${JSON.stringify(entrada)}`).toBe(esperado);
    }
    expect(normalizarHost(null)).toBe("");
    expect(normalizarHost(undefined)).toBe("");
  });
});

describe("extractSubdomainFromHost", () => {
  it("so devolve rotulo de host DA PLATAFORMA", () => {
    expect(extractSubdomainFromHost("nslink.consultaisp.com.br")).toBe("nslink");
  });

  it("o dominio raiz nao e subdominio — era o bug que dizia 'consultaisp'", () => {
    expect(extractSubdomainFromHost("consultaisp.com.br")).toBeNull();
    expect(extractSubdomainFromHost("www.consultaisp.com.br")).toBeNull();
  });

  it("dominio de outra marca nao vira subdominio nosso", () => {
    expect(extractSubdomainFromHost("app.crednet.com.br")).toBeNull();
    expect(extractSubdomainFromHost("crednet.com")).toBeNull();
  });

  it("host que apenas TERMINA parecido nao passa", () => {
    // o classico: evil-consultaisp.com.br e naoconsultaisp.com.br
    expect(extractSubdomainFromHost("nslink.evil.com")).toBeNull();
    expect(extractSubdomainFromHost("nslink.evilconsultaisp.com.br")).toBeNull();
  });

  it("subdominio de dois niveis nao e tenant", () => {
    expect(extractSubdomainFromHost("a.b.consultaisp.com.br")).toBeNull();
  });
});
