import { describe, it, expect, beforeEach } from "vitest";
import {
  generatePartnerCode, anonymizeProvider, getProviderDisplayName,
  normalizePartnerCode, resolvePartnerCode, _resetPartnerKeysForTests,
  PARTNER_CODE_REGEX, PARTNER_DISPLAY_REGEX, ROTULO_SEM_ID,
} from "./provider-anonymizer";

/**
 * O codigo de parceiro e um pseudonimo PAREADO por observador, chaveado pelo
 * ambiente, sem nada do nome. Cada bloco e uma propriedade que o esquema
 * anterior (sha256 de salt fixo + id, com a inicial do nome no fim) nao tinha.
 */

const SEGREDO = "p".repeat(64);
const SESSAO = "s".repeat(64);

function ambiente(env: { PARTNER_CODE_SECRET?: string; SESSION_SECRET?: string; PARTNER_CODE_SECRET_PREVIOUS?: string }) {
  for (const k of ["PARTNER_CODE_SECRET", "SESSION_SECRET", "PARTNER_CODE_SECRET_PREVIOUS"] as const) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  _resetPartnerKeysForTests();
}

beforeEach(() => ambiente({ PARTNER_CODE_SECRET: SEGREDO, SESSION_SECRET: SESSAO }));

describe("formato", () => {
  it("ISP-XXX-XXX em Crockford Base32, sem I, L, O, U e sem #", () => {
    for (let id = 1; id <= 50; id++) {
      const c = generatePartnerCode(1, id);
      expect(c).toMatch(PARTNER_CODE_REGEX);
      // Os simbolos, sem o prefixo "ISP-" (que tem um I de proposito).
      expect(c.slice(4)).not.toMatch(/[ILOU#]/);
    }
  });

  it("o texto de exibicao mantem o prefixo que o client concatena", () => {
    expect(anonymizeProvider(1, 42)).toMatch(PARTNER_DISPLAY_REGEX);
  });
});

describe("pareado por observador", () => {
  it("o mesmo observador ve sempre o mesmo codigo para o mesmo parceiro", () => {
    expect(generatePartnerCode(1, 42)).toBe(generatePartnerCode(1, 42));
  });

  it("observadores diferentes veem codigos diferentes para o mesmo parceiro — nao existe 'o codigo de Z'", () => {
    expect(generatePartnerCode(1, 42)).not.toBe(generatePartnerCode(2, 42));
  });

  it("e assimetrico: o que A ve para B nao e o que B ve para A", () => {
    expect(generatePartnerCode(1, 2)).not.toBe(generatePartnerCode(2, 1));
  });

  it("parceiros diferentes, codigos diferentes", () => {
    expect(generatePartnerCode(1, 42)).not.toBe(generatePartnerCode(1, 43));
  });

  it("sem colisao entre 5.000 parceiros de um mesmo observador", () => {
    const vistos = new Set<string>();
    for (let id = 1; id <= 5000; id++) vistos.add(generatePartnerCode(7, id));
    expect(vistos.size).toBe(5000);
  });
});

describe("nada do nome entra", () => {
  it("o nome do parceiro nao muda o codigo nem aparece nele", () => {
    const a = getProviderDisplayName("NG Telecom", 1, 42);
    const b = getProviderDisplayName("Vertical Fibra", 1, 42);
    expect(a).toBe(b);
    expect(a).toMatch(PARTNER_DISPLAY_REGEX);
    expect(a).not.toContain("NG");
    expect(a).not.toContain("Telecom");
    expect(a).not.toContain("Vertical");
  });

  it("o proprio provedor ve o nome real; sem nome, um rotulo neutro", () => {
    expect(getProviderDisplayName("NG Telecom", 42, 42)).toBe("NG Telecom");
    expect(getProviderDisplayName("", 42, 42)).toBe("Seu provedor");
  });

  it("sem id do parceiro nao ha codigo — nem fallback por nome", () => {
    expect(anonymizeProvider(1, null)).toBe(ROTULO_SEM_ID);
    expect(anonymizeProvider(1, undefined)).toBe(ROTULO_SEM_ID);
    expect(getProviderDisplayName("NG Telecom", 1, null)).toBe(ROTULO_SEM_ID);
    expect(anonymizeProvider(1, null)).not.toContain("ISP-");
  });

  it("sem observador valido cai no rotulo fixo — nunca um espaco global pela porta dos fundos", () => {
    expect(anonymizeProvider(0, 42)).toBe(ROTULO_SEM_ID);
    expect(anonymizeProvider(undefined as unknown as number, 42)).toBe(ROTULO_SEM_ID);
    expect(anonymizeProvider(-1, 42)).toBe(ROTULO_SEM_ID);
  });
});

describe("chave do ambiente", () => {
  it("segredo diferente, codigo diferente", () => {
    const antes = generatePartnerCode(1, 42);
    ambiente({ PARTNER_CODE_SECRET: "q".repeat(64), SESSION_SECRET: SESSAO });
    expect(generatePartnerCode(1, 42)).not.toBe(antes);
  });

  it("sem PARTNER_CODE_SECRET deriva do SESSION_SECRET; sem os dois, lanca", () => {
    ambiente({ SESSION_SECRET: SESSAO });
    expect(generatePartnerCode(1, 42)).toMatch(PARTNER_CODE_REGEX);
    ambiente({});
    expect(() => generatePartnerCode(1, 42)).toThrow(/PARTNER_CODE_SECRET/);
  });

  it("PARTNER_CODE_SECRET curto lanca em vez de truncar em silencio", () => {
    ambiente({ PARTNER_CODE_SECRET: "curto", SESSION_SECRET: SESSAO });
    expect(() => generatePartnerCode(1, 42)).toThrow(/32/);
  });

  it("o fallback e a mesma derivacao: PARTNER_CODE_SECRET e SESSION_SECRET com o mesmo valor dao o mesmo codigo", () => {
    ambiente({ PARTNER_CODE_SECRET: SEGREDO, SESSION_SECRET: SEGREDO });
    const dedicada = generatePartnerCode(1, 42);
    ambiente({ SESSION_SECRET: SEGREDO });
    // Mesmo ikm, mesmo HKDF, mesmo info. E o que permite ao resolvedor cobrir
    // o periodo em que so havia SESSION_SECRET sem configuracao extra.
    expect(generatePartnerCode(1, 42)).toBe(dedicada);
  });

  it("a chave dos codigos nao coincide com a chave AES dos tokens de ERP derivada do mesmo SESSION_SECRET", async () => {
    // Separacao de dominio: HKDF com info proprio aqui, PBKDF2 com salt proprio
    // em crypto.ts. Se um dia as duas derivacoes coincidirem, quem tem uma
    // tem a outra.
    ambiente({ SESSION_SECRET: SEGREDO });
    const { hkdfSync, pbkdf2Sync } = await import("crypto");
    const daqui = Buffer.from(hkdfSync("sha256", SEGREDO, "consulta-isp-partner-code", "consulta-isp/partner-code/v1", 32));
    const doErp = pbkdf2Sync(SEGREDO, "consulta-isp-erp-token-v1", 100_000, 32, "sha256");
    expect(daqui.equals(doErp)).toBe(false);
  });
});

describe("normalizacao do que o suporte ouve", () => {
  it("aceita minusculas, espacos, sem hifen e com #", () => {
    expect(normalizePartnerCode("isp rep cev")).toBe("ISP-REP-CEV");
    expect(normalizePartnerCode("ISP-#REP-CEV")).toBe("ISP-REP-CEV");
    expect(normalizePartnerCode("repcev")).toBe("ISP-REP-CEV");
  });

  it("corrige o que o ouvido troca: O -> 0, I e L -> 1", () => {
    expect(normalizePartnerCode("ISP-REI-CEO")).toBe("ISP-RE1-CE0");
    expect(normalizePartnerCode("ISP-LEP-CEV")).toBe("ISP-1EP-CEV");
  });

  it("codigo do esquema antigo e lixo nao normalizam", () => {
    expect(normalizePartnerCode("ISP-#HPZFV")).toBeNull();
    expect(normalizePartnerCode("")).toBeNull();
    expect(normalizePartnerCode("ISP-REP-CEVX")).toBeNull();
    expect(normalizePartnerCode("ISP-REU-CEV")).toBeNull();
  });
});

describe("resolucao pelo controlador", () => {
  it("resolve o codigo para o parceiro certo, so entre os candidatos e so para aquele observador", () => {
    const codigo = generatePartnerCode(1, 42);
    expect(resolvePartnerCode(1, codigo, [40, 41, 42, 43])).toEqual({ subjectProviderId: 42, keyVersion: "current" });
    expect(resolvePartnerCode(1, codigo, [40, 41, 43])).toBeNull();
    expect(resolvePartnerCode(2, codigo, [40, 41, 42, 43])).toBeNull();
  });

  it("aceita a forma como o suporte digitou", () => {
    const codigo = generatePartnerCode(1, 42);
    const ditado = codigo.toLowerCase().replace(/-/g, " ");
    expect(resolvePartnerCode(1, ditado, [42])?.subjectProviderId).toBe(42);
  });

  it("codigo gerado com a chave anterior resolve por PARTNER_CODE_SECRET_PREVIOUS", () => {
    const antiga = "a".repeat(64);
    ambiente({ PARTNER_CODE_SECRET: antiga, SESSION_SECRET: SESSAO });
    const codigo = generatePartnerCode(1, 42);
    ambiente({ PARTNER_CODE_SECRET: "b".repeat(64), PARTNER_CODE_SECRET_PREVIOUS: antiga, SESSION_SECRET: SESSAO });
    expect(generatePartnerCode(1, 42)).not.toBe(codigo);
    expect(resolvePartnerCode(1, codigo, [42])).toEqual({ subjectProviderId: 42, keyVersion: "previous-0" });
  });

  it("codigo gerado no periodo do fallback (so SESSION_SECRET) resolve depois que o segredo dedicado entra", () => {
    ambiente({ SESSION_SECRET: SESSAO });
    const codigo = generatePartnerCode(1, 42);
    ambiente({ PARTNER_CODE_SECRET: SEGREDO, SESSION_SECRET: SESSAO });
    expect(resolvePartnerCode(1, codigo, [42])).toEqual({ subjectProviderId: 42, keyVersion: "session-fallback" });
  });

  it("codigo do esquema antigo nao resolve", () => {
    expect(resolvePartnerCode(1, "ISP-#HPZFV", [1, 2, 3])).toBeNull();
  });
});
