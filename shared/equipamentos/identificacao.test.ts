import { describe, expect, it } from "vitest";
import { cruzarIdentificadores, normalizarMac, autenticacoesDoSgp, conexoesDoMk, serialDeOnuMk } from "./identificacao";

describe("identificação de equipamento por evidência", () => {
  it("normaliza grafias do mesmo MAC, rejeita lixo e endereço vazio", () => {
    expect(normalizarMac("aa:bb:cc:dd:ee:01")).toBe("AABBCCDDEE01");
    expect(normalizarMac("aabb.ccdd.ee01")).toBe("AABBCCDDEE01");
    expect(normalizarMac("zz:aa:bb:cc:dd:ee:01")).toBeNull();
    expect(normalizarMac("00:00:00:00:00:00")).toBeNull();
  });
  it("MAC único encontra candidato, não confirma posse ou retirada", () => {
    expect(cruzarIdentificadores({ mac: "aa:bb:cc:dd:ee:01" }, [{ id: 1, mac: "AABBCCDDEE01" }])).toMatchObject({ status: "coincidencia", ids: [1], por: "mac" });
  });
  it("MAC duplicado nunca escolhe arbitrariamente um aparelho", () => {
    expect(cruzarIdentificadores({ mac: "aabbccddee01" }, [{ id: 1, mac: "aabbccddee01" }, { id: 2, mac: "aabbccddee01" }]).status).toBe("ambiguo");
  });
  it("serial e MAC apontando para aparelhos diferentes é conflito", () => {
    expect(cruzarIdentificadores({ serial: "ZTE001", mac: "aabbccddee01" }, [{ id: 1, serial: "ZTE001" }, { id: 2, mac: "aabbccddee01" }]).status).toBe("conflito");
  });
  it("não inventa equipamento quando o ERP apagou o MAC", () => {
    expect(cruzarIdentificadores({}, [{ id: 1, mac: "aabbccddee01" }]).status).toBe("sem_identificador");
  });
  it("extrai autenticação sem trazer senha e preserva múltiplos contratos", () => {
    const a = autenticacoesDoSgp([{ contrato: 1, servicos: [{ login: "cliente.pppoe", senha: "segredo", mac: "aa:bb:cc:dd:ee:01", ip: "10.0.0.2" }] }, { contrato: 2, servicos: [{ login: "segundo" }] }]);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ login: "cliente.pppoe", mac: "AABBCCDDEE01", contrato: "1" });
    expect(JSON.stringify(a)).not.toContain("segredo");
    expect(a[1].mac).toBeNull();
  });
});

/**
 * As respostas abaixo copiam, campo por campo, o que o MK da NsLink devolveu em
 * `WSMKConexoesPorCliente` na sonda de 06/09/2026 (script/probe-mk-conexoes.ts).
 * MAC e login estao mascarados; a FORMA e a real.
 */
const FTTH = {
  bloqueada: "Não",
  cadastro: "2025-12-27",
  cep: "86200000",
  codconexao: 2721,
  contrato: null,
  endereco: "Rua Exemplo, 100 - Centro",
  esta_reduzida: "Não",
  latitude: "",
  longitude: "",
  mac_address: "64:db:f7:ed:1d:24",
  motivo_bloqueio: null,
  tecnologia: "Ftth",
  username: "ALCLFC65623D-000",
};
const WIRELESS = {
  bloqueada: "Sim",
  cadastro: "2024-07-22",
  codconexao: 1819,
  contrato: 1958,
  esta_reduzida: "Não",
  mac_address: "AA:BB:CC:DD:EE:01",
  motivo_bloqueio: "Falta de pagamento",
  tecnologia: "Wireless",
  username: "assinante@provedor.com",
};

describe("conexões do MK — a identificação da instalação", () => {
  it("lê login, MAC e contrato da resposta real, e não inventa IP nem sessão", () => {
    const r = conexoesDoMk({ CodigoPessoa: 194, Nome: "Fulano", status: "OK", Conexoes: [FTTH, WIRELESS] });
    expect(r?.autenticacoes).toEqual([
      { login: "ALCLFC65623D-000", mac: "64DBF7ED1D24", ip: null, contrato: null, serial: "ALCLFC65623D", online: null, bloqueada: false, fonte: "mk" },
      { login: "assinante@provedor.com", mac: "AABBCCDDEE01", ip: null, contrato: "1958", serial: null, online: null, bloqueada: true, fonte: "mk" },
    ]);
    // O endereço postal da conexão nunca pode ser lido como IP.
    expect(JSON.stringify(r)).not.toContain("Rua Exemplo");
  });

  it("bloqueio não é sessão: cortado continua com online desconhecido", () => {
    const r = conexoesDoMk({ Conexoes: [WIRELESS] });
    expect(r?.bloqueada).toBe(true);
    expect(r?.autenticacoes[0].online).toBeNull();
  });

  it("uma conexão bloqueada entre várias já corta o cliente", () => {
    expect(conexoesDoMk({ Conexoes: [FTTH, WIRELESS] })?.bloqueada).toBe(true);
    expect(conexoesDoMk({ Conexoes: [FTTH] })?.bloqueada).toBe(false);
  });

  it("aceita nomes alternativos de outra release sem exigir os da NsLink", () => {
    const r = conexoesDoMk([{ login: "outro.login", mac: "aabb.ccdd.ee02", ip: "100.64.0.9", codcontrato: 7, bloqueado: true, online: "Sim", numero_serie: "ztez1234" }]);
    expect(r?.autenticacoes[0]).toEqual({ login: "outro.login", mac: "AABBCCDDEE02", ip: "100.64.0.9", contrato: "7", serial: "ZTEZ1234", online: true, bloqueada: true, fonte: "mk" });
  });

  it("erro com HTTP 200 não é 'nenhuma conexão' — é leitura sem resposta", () => {
    expect(conexoesDoMk({ status: "ERRO", mensagem: "token inválido" })).toBeNull();
    expect(conexoesDoMk({ CODIGO_ERRO: 12, Conexoes: [] })).toBeNull();
    expect(conexoesDoMk({ Nome: "Fulano" })).toBeNull();
    expect(conexoesDoMk(null)).toBeNull();
  });

  it("cliente sem conexão responde lista vazia e bloqueio desconhecido, não 'liberado'", () => {
    expect(conexoesDoMk({ CodigoPessoa: 57, Conexoes: [], status: "OK" })).toEqual({ autenticacoes: [], bloqueada: null });
  });

  it("MAC malformado vira ausência, e a conexão só some se não sobrar identificador", () => {
    const comLogin = conexoesDoMk({ Conexoes: [{ username: "so.login", mac_address: "00:00:00:00:00:00" }] });
    expect(comLogin?.autenticacoes).toEqual([
      { login: "so.login", mac: null, ip: null, contrato: null, serial: null, online: null, bloqueada: null, fonte: "mk" },
    ]);
    expect(conexoesDoMk({ Conexoes: [{ codconexao: 9, mac_address: "zz:zz", bloqueada: "Sim" }] }))
      .toEqual({ autenticacoes: [], bloqueada: true });
  });

  it("serial da ONU sai do login só quando é fibra e tem a forma de serial", () => {
    expect(serialDeOnuMk("ALCLFC65623D-000", "Ftth")).toBe("ALCLFC65623D");
    expect(serialDeOnuMk("ALCLFCD7276D", "Ftth")).toBe("ALCLFCD7276D");
    expect(serialDeOnuMk("ALCLFC65623D", "Wireless")).toBeNull();
    expect(serialDeOnuMk("fulano@provedor.com", "Ftth")).toBeNull();
    expect(serialDeOnuMk("cesar.filho2", "Ftth")).toBeNull();
  });
});
