import { describe, it, expect } from "vitest";
import { chaveDeEndereco, mesmoEndereco, agruparPorEndereco, hashEndereco } from "./endereco-chave";

const e = (o: Partial<Parameters<typeof chaveDeEndereco>[0]>) => ({
  address: "Rua Mato Grosso", addressNumber: "1435",
  neighborhood: "Centro", city: "Londrina", state: "PR", ...o,
});

describe("chaveDeEndereco", () => {
  it("normaliza abreviacao do tipo de logradouro", () => {
    const a = chaveDeEndereco(e({ address: "Av. Tiradentes" }))!;
    const b = chaveDeEndereco(e({ address: "AVENIDA TIRADENTES" }))!;
    const c = chaveDeEndereco(e({ address: "avenida tiradentes" }))!;
    expect(a.logradouro).toBe("AVENIDA TIRADENTES");
    expect(a.logradouro).toBe(b.logradouro);
    expect(b.logradouro).toBe(c.logradouro);
  });

  /** E como o MK devolve: numero e bairro grudados no logradouro. */
  it("separa o numero grudado no logradouro", () => {
    const k = chaveDeEndereco({
      address: "Rua Mato Grosso, 1435 - Centro, Londrina",
      city: "Londrina", state: "PR",
    })!;
    expect(k.numero).toBe(1435);
    expect(k.logradouro).toBe("RUA MATO GROSSO");
  });

  it("o campo proprio de numero manda sobre o que esta no texto", () => {
    const k = chaveDeEndereco({ address: "Rua Brasil, 100", addressNumber: "250", city: "Londrina" })!;
    expect(k.numero).toBe(250);
  });

  it("NAO exige CEP — era a trava que deixava 39% da NsLink de fora", () => {
    expect(chaveDeEndereco(e({ cep: null }))).not.toBeNull();
    expect(chaveDeEndereco(e({ cep: "00000" }))).not.toBeNull();
  });

  it("devolve null sem o minimo: logradouro, numero ou cidade", () => {
    expect(chaveDeEndereco(e({ address: "" }))).toBeNull();
    expect(chaveDeEndereco(e({ address: "Rua Sem Numero", addressNumber: "" }))).toBeNull();
    expect(chaveDeEndereco(e({ city: "" }))).toBeNull();
  });

  it("numero 0 conta como ausente — e o que se digita quando nao se sabe", () => {
    expect(chaveDeEndereco(e({ address: "Rua Brasil", addressNumber: "0" }))).toBeNull();
  });

  it("acento e pontuacao nao separam o mesmo endereco", () => {
    const a = chaveDeEndereco(e({ address: "Rua José Bonifácio", city: "São Paulo" }))!;
    const b = chaveDeEndereco(e({ address: "RUA JOSE BONIFACIO", city: "SAO PAULO" }))!;
    expect(mesmoEndereco(a, b)).toBe(true);
  });
});

describe("mesmoEndereco", () => {
  it("numero diferente e outro imovel", () => {
    expect(mesmoEndereco(chaveDeEndereco(e({}))!, chaveDeEndereco(e({ addressNumber: "1437" }))!)).toBe(false);
  });

  it("cidade diferente e outro imovel, mesmo com rua e numero iguais", () => {
    expect(mesmoEndereco(chaveDeEndereco(e({}))!, chaveDeEndereco(e({ city: "Maringa" }))!)).toBe(false);
  });

  it("bairro declarado e DIFERENTE separa — mesma rua e numero em bairros distintos", () => {
    const a = chaveDeEndereco(e({ address: "Rua das Flores", addressNumber: "100", neighborhood: "Centro" }))!;
    const b = chaveDeEndereco(e({ address: "Rua das Flores", addressNumber: "100", neighborhood: "Jardim Nova Esperanca" }))!;
    expect(mesmoEndereco(a, b)).toBe(false);
  });

  /**
   * A regra que mais importa: bairro AUSENTE nao separa. Separar produziria o
   * pior erro daqui — esconder uma pendencia que existe no endereco.
   */
  it("bairro ausente de um lado NAO separa", () => {
    const a = chaveDeEndereco(e({ neighborhood: "Centro" }))!;
    const b = chaveDeEndereco(e({ neighborhood: null }))!;
    expect(mesmoEndereco(a, b)).toBe(true);
    expect(mesmoEndereco(b, a)).toBe(true);
  });
});

describe("agruparPorEndereco", () => {
  const cli = (nome: string, o: any = {}) => ({ nome, ...e(o) });

  it("junta quem esta no mesmo imovel, escrito de jeitos diferentes", () => {
    const g = agruparPorEndereco(
      [cli("A"), cli("B", { address: "R. Mato Grosso" }), cli("C", { address: "RUA MATO GROSSO" })],
      x => x,
    );
    expect(g).toHaveLength(1);
    expect(g[0].itens).toHaveLength(3);
  });

  it("separa numeros diferentes da mesma rua", () => {
    const g = agruparPorEndereco([cli("A"), cli("B", { addressNumber: "1437" })], x => x);
    expect(g).toHaveLength(2);
  });

  it("quebra por bairro quando ha mais de um declarado na mesma rua e numero", () => {
    const g = agruparPorEndereco(
      [cli("A", { neighborhood: "Centro" }), cli("B", { neighborhood: "Vila Nova" })], x => x,
    );
    expect(g).toHaveLength(2);
  });

  it("quem nao declarou bairro fica no grupo majoritario, e nao isolado", () => {
    const g = agruparPorEndereco(
      [
        cli("A", { neighborhood: "Centro" }),
        cli("B", { neighborhood: "Centro" }),
        cli("C", { neighborhood: "Vila Nova" }),
        cli("D", { neighborhood: null }),
      ],
      x => x,
    );
    const centro = g.find(x => x.chave.bairro === "CENTRO")!;
    expect(centro.itens.map((i: any) => i.nome).sort()).toEqual(["A", "B", "D"]);
  });

  it("descarta quem nao tem endereco utilizavel, sem quebrar", () => {
    const g = agruparPorEndereco([cli("A"), cli("B", { address: "" }), cli("C", { city: "" })], x => x);
    expect(g).toHaveLength(1);
    expect(g[0].itens).toHaveLength(1);
  });
});

describe("hashEndereco", () => {
  it("mesmo endereco, mesmo hash; enderecos distintos, hashes distintos", () => {
    const a = chaveDeEndereco(e({ address: "Av. Tiradentes" }))!;
    const b = chaveDeEndereco(e({ address: "AVENIDA TIRADENTES" }))!;
    const c = chaveDeEndereco(e({ addressNumber: "999" }))!;
    expect(hashEndereco(a, "sal")).toBe(hashEndereco(b, "sal"));
    expect(hashEndereco(a, "sal")).not.toBe(hashEndereco(c, "sal"));
  });

  it("salt diferente muda o hash — nao da para cruzar entre bases", () => {
    const a = chaveDeEndereco(e({}))!;
    expect(hashEndereco(a, "sal1")).not.toBe(hashEndereco(a, "sal2"));
  });
});

describe("UF segue a regra do bairro", () => {
  const base = { address: "Rua Mato Grosso", addressNumber: "1435", neighborhood: "Centro", city: "Londrina" };

  it("UF ausente de um lado NAO separa", () => {
    const comUf = chaveDeEndereco({ ...base, state: "PR" })!;
    const semUf = chaveDeEndereco(base)!;
    expect(mesmoEndereco(comUf, semUf)).toBe(true);
    expect(mesmoEndereco(semUf, comUf)).toBe(true);
  });

  it("UF declarada e DIFERENTE separa", () => {
    const pr = chaveDeEndereco({ ...base, state: "PR" })!;
    const sp = chaveDeEndereco({ ...base, state: "SP" })!;
    expect(mesmoEndereco(pr, sp)).toBe(false);
  });

  it("o hash reflete a mesma regra: com e sem UF batem", () => {
    const comUf = chaveDeEndereco({ ...base, state: "PR" })!;
    const semUf = chaveDeEndereco(base)!;
    expect(hashEndereco(comUf, "sal")).toBe(hashEndereco(semUf, "sal"));
  });
});
