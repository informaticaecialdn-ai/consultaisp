import { describe, it, expect } from "vitest";
import {
  camposDoConector,
  valorDoCampo,
  corpoDoFormulario,
  type CampoErp,
  type ConectorMeta,
} from "./FormularioErp";

/**
 * O que este teste protege: o caminho do dado entre a tela e a coluna.
 *
 * Nao e formatacao. E que TODO campo que o conector declara sobreviva ao
 * Salvar e volte igual na releitura. A contra-senha do MK e o nome do app do
 * SGP ja foram descartados em silencio em producao — o campo aparecia, o
 * operador digitava, e a requisicao saia sem ele. Cada assercao abaixo existe
 * para que essa perda nao possa voltar sem quebrar o teste.
 */

/* Copias fieis do configFields de cada conector (server/erp/connectors/*.ts).
   Se um conector mudar a lista, a divergencia aparece aqui como falha e nao
   como campo perdido em producao. */
const IXC: ConectorMeta = {
  name: "ixc",
  label: "IXC Soft",
  configFields: [
    { key: "apiUser", label: "ID do Usuario (numerico)", type: "text", required: true },
    { key: "apiToken", label: "Token do Usuario", type: "password", required: true },
  ],
};

const MK: ConectorMeta = {
  name: "mk",
  label: "MK Solutions",
  configFields: [
    { key: "apiToken", label: "Token do Usuario MK", type: "password", required: true },
    { key: "mkContraSenha", label: "Contra-Senha Webservice", type: "password", required: true },
  ],
};

const VOALLE: ConectorMeta = {
  name: "voalle",
  label: "Voalle",
  configFields: [
    { key: "apiUser", label: "Usuario de Integracao", type: "text", required: true },
    { key: "apiToken", label: "Senha", type: "password", required: true },
    { key: "extra.voalleClientId", label: "Client ID (opcional)", type: "text", required: false },
  ],
};

const SGP: ConectorMeta = {
  name: "sgp",
  label: "SGP",
  configFields: [
    { key: "apiUrl", label: "URL do Servidor SGP", type: "url", required: true },
    { key: "apiToken", label: "Token SGP", type: "password", required: true },
    { key: "extra.sgpApp", label: "Nome do App", type: "text", required: true },
  ],
};

const HUBSOFT: ConectorMeta = {
  name: "hubsoft",
  label: "Hubsoft",
  configFields: [
    { key: "apiUrl", label: "URL da API", type: "url", required: true },
    { key: "apiUser", label: "Username", type: "text", required: true },
    { key: "apiToken", label: "Password", type: "password", required: true },
    { key: "extra.clientId", label: "Client ID", type: "text", required: true },
    { key: "extra.clientSecret", label: "Client Secret", type: "password", required: true },
  ],
};

const RBX: ConectorMeta = {
  name: "rbx",
  label: "RBX ISP",
  configFields: [
    { key: "apiUrl", label: "URL da API", type: "url", required: true },
    { key: "apiToken", label: "Chave de Integracao", type: "password", required: true },
  ],
};

const TODOS: ConectorMeta[] = [IXC, MK, VOALLE, SGP, HUBSOFT, RBX];

/** Preenche cada campo com um valor distinto e reconhecivel. */
function preencher(campos: CampoErp[]): Record<string, string> {
  const valores: Record<string, string> = {};
  campos.forEach((c, i) => { valores[c.key] = `valor-${c.key}-${i}`; });
  return valores;
}

describe("camposDoConector", () => {
  it("acrescenta apiUrl no topo para IXC, MK e Voalle, que nao o declaram", () => {
    for (const conector of [IXC, MK, VOALLE]) {
      const campos = camposDoConector(conector);
      expect(campos[0].key, conector.name).toBe("apiUrl");
      expect(campos[0].required, conector.name).toBe(true);
      // Nenhum campo declarado pode ter sumido no caminho.
      expect(campos.slice(1)).toEqual(conector.configFields);
    }
  });

  it("nao duplica apiUrl para quem ja declara o campo", () => {
    for (const conector of [SGP, HUBSOFT, RBX]) {
      const campos = camposDoConector(conector);
      const quantos = campos.filter(c => c.key === "apiUrl").length;
      expect(quantos, conector.name).toBe(1);
      expect(campos, conector.name).toEqual(conector.configFields);
    }
  });

  it("todo conector termina com apiUrl e apiToken, que test e sync exigem", () => {
    for (const conector of TODOS) {
      const chaves = camposDoConector(conector).map(c => c.key);
      expect(chaves, conector.name).toContain("apiUrl");
      expect(chaves, conector.name).toContain("apiToken");
    }
  });
});

describe("corpoDoFormulario", () => {
  it("MK: a contra-senha vai no topo do corpo, nao em extraConfig nem em apiUser", () => {
    const campos = camposDoConector(MK);
    const corpo = corpoDoFormulario(campos, {
      apiUrl: "https://mk.provedor.com.br",
      apiToken: "tok-mk",
      mkContraSenha: "contra-123",
    });
    expect(corpo.mkContraSenha).toBe("contra-123");
    expect(corpo.apiUser).toBeUndefined();
    expect(corpo.extraConfig).toBeUndefined();
    expect(corpo.apiUrl).toBe("https://mk.provedor.com.br");
    expect(corpo.apiToken).toBe("tok-mk");
  });

  it("SGP: o nome do app vai em extraConfig.sgpApp", () => {
    const campos = camposDoConector(SGP);
    const corpo = corpoDoFormulario(campos, {
      apiUrl: "https://provedor.sgp.net.br",
      apiToken: "tok-sgp",
      "extra.sgpApp": "consultaisp",
    });
    expect(corpo.extraConfig).toEqual({ sgpApp: "consultaisp" });
    // O prefixo "extra." nunca pode vazar como coluna de topo.
    expect(corpo["extra.sgpApp"]).toBeUndefined();
    expect(corpo.sgpApp).toBeUndefined();
  });

  it("Hubsoft: clientId e clientSecret sao colunas de topo, nao extraConfig", () => {
    const campos = camposDoConector(HUBSOFT);
    const corpo = corpoDoFormulario(campos, {
      apiUrl: "https://provedor.hubsoft.com.br/api",
      apiUser: "integracao",
      apiToken: "senha-oauth",
      "extra.clientId": "cid-9",
      "extra.clientSecret": "csecret-9",
    });
    expect(corpo.clientId).toBe("cid-9");
    expect(corpo.clientSecret).toBe("csecret-9");
    expect(corpo.extraConfig).toBeUndefined();
  });

  it("Voalle: o client id opcional cai em extraConfig.voalleClientId", () => {
    const campos = camposDoConector(VOALLE);
    const corpo = corpoDoFormulario(campos, {
      apiUrl: "https://voalle.provedor.com.br",
      apiUser: "usuario-integracao",
      apiToken: "senha",
      "extra.voalleClientId": "tger",
    });
    expect(corpo.extraConfig).toEqual({ voalleClientId: "tger" });
  });

  it("campo nao preenchido vira string vazia, nunca undefined", () => {
    const corpo = corpoDoFormulario(camposDoConector(IXC), {});
    expect(corpo).toEqual({ apiUrl: "", apiUser: "", apiToken: "" });
  });

  it("chave desconhecida do conector nao entra no corpo", () => {
    const corpo = corpoDoFormulario(
      [{ key: "campoInventado", label: "x", type: "text", required: false }],
      { campoInventado: "valor" },
    );
    expect(corpo).toEqual({});
  });
});

describe("valorDoCampo", () => {
  it("le de volta cada destino do corpo, incluindo o fallback de extraConfig", () => {
    const registro = {
      apiUrl: "https://erp.provedor.com.br",
      apiToken: "tok",
      apiUser: "user",
      mkContraSenha: "contra",
      clientId: "cid",
      clientSecret: "csecret",
      extraConfig: { sgpApp: "consultaisp", voalleClientId: "tger" },
    };
    expect(valorDoCampo("apiUrl", registro)).toBe("https://erp.provedor.com.br");
    expect(valorDoCampo("apiToken", registro)).toBe("tok");
    expect(valorDoCampo("apiUser", registro)).toBe("user");
    expect(valorDoCampo("mkContraSenha", registro)).toBe("contra");
    expect(valorDoCampo("extra.clientId", registro)).toBe("cid");
    expect(valorDoCampo("extra.clientSecret", registro)).toBe("csecret");
    expect(valorDoCampo("extra.sgpApp", registro)).toBe("consultaisp");
    expect(valorDoCampo("extra.voalleClientId", registro)).toBe("tger");
  });

  it("registro ausente ou campo vazio devolve string vazia — nunca undefined no input", () => {
    expect(valorDoCampo("apiUrl", undefined)).toBe("");
    expect(valorDoCampo("extra.sgpApp", undefined)).toBe("");
    expect(valorDoCampo("extra.sgpApp", { extraConfig: null })).toBe("");
    expect(valorDoCampo("campoInventado", { campoInventado: "x" })).toBe("");
  });
});

describe("ida e volta", () => {
  it("o que o Salvar manda, a releitura devolve igual — em todo conector real", () => {
    for (const conector of TODOS) {
      const campos = camposDoConector(conector);
      const digitado = preencher(campos);
      const corpo = corpoDoFormulario(campos, digitado);
      const relido: Record<string, string> = {};
      campos.forEach(c => { relido[c.key] = valorDoCampo(c.key, corpo); });
      expect(relido, conector.name).toEqual(digitado);
    }
  });
});
