/**
 * O teste do formulário "Minha marca" do revendedor.
 *
 * O que ele pina é o defeito que a família desta tela já produziu uma vez
 * (`pages/admin/marca-form.test.ts`): editar um telefone apagava o logo, porque
 * o formulário era enviado inteiro e nasce sem os arquivos. Aqui a superfície é
 * maior — a rota do revendedor é um zod `.strict()` —, então além de "não
 * apague" há um "não mande o que a rota recusa".
 */
import { describe, it, expect } from "vitest";
import {
  FORMULARIO_VAZIO,
  camposDoDetalhe,
  corpoParcial,
  problemasDoFormulario,
  corValida,
  type MarcaDoRevendedor,
} from "./marca-form";

/** A marca como o `GET /api/revenda/marca` a devolve: sem SVG no corpo. */
const MARCA: MarcaDoRevendedor = {
  id: 7,
  slug: "crednet",
  nomeProduto: "CredNet",
  assinatura: "Crédito para provedores",
  corBrand: "#1F6F7A",
  corBrandDark: null,
  suporteEmail: "suporte@crednet.com.br",
  suporteWhatsapp: "5531999998888",
  site: null,
  emailNomeExibicao: "CredNet",
  emailRemetente: null,
  dominio: "app.crednet.com.br",
  dominioStatus: "ativo",
  dnsIp: "203.0.113.10",
  responsavelRazaoSocial: "CredNet Ltda",
  responsavelCnpj: "00.000.000/0001-00",
  temLogo: true,
  logoEhPng: false,
  temFavicon: true,
  previa: null,
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("camposDoDetalhe", () => {
  it("os campos de arquivo nascem vazios mesmo com logo e favicon gravados", () => {
    const campos = camposDoDetalhe(MARCA);
    expect(MARCA.temLogo && MARCA.temFavicon).toBe(true);
    expect(campos.logoSvg).toBe("");
    expect(campos.logoPng).toBe("");
    expect(campos.faviconSvg).toBe("");
  });

  it("nulo do banco vira string vazia, e a cor cai no padrão quando não há cor", () => {
    const campos = camposDoDetalhe({ ...MARCA, site: null, corBrand: "" });
    expect(campos.site).toBe("");
    expect(campos.corBrand).toBe(FORMULARIO_VAZIO.corBrand);
  });

  it("não inventa campo fora da lista que a rota aceita", () => {
    /* `.strict()` na rota transforma chave a mais em 400. A lista de chaves do
       formulário É o contrato com ela. */
    expect(Object.keys(camposDoDetalhe(MARCA)).sort()).toEqual(Object.keys(FORMULARIO_VAZIO).sort());
    for (const proibido of ["slug", "dominio", "emailRemetente", "responsavelRazaoSocial", "ativo"]) {
      expect(FORMULARIO_VAZIO, proibido).not.toHaveProperty(proibido);
    }
  });
});

describe("corpoParcial", () => {
  const ORIGINAL = camposDoDetalhe(MARCA);

  it("nada mudou, nada é enviado", () => {
    expect(corpoParcial({ ...ORIGINAL }, ORIGINAL)).toEqual({});
  });

  it("o defeito: mexer no WhatsApp não pode encostar em logo nem em favicon", () => {
    const corpo = corpoParcial({ ...ORIGINAL, suporteWhatsapp: "5531988887777" }, ORIGINAL);
    expect(corpo).toEqual({ suporteWhatsapp: "5531988887777" });
    for (const campo of ["logoSvg", "logoPng", "faviconSvg"]) {
      expect(corpo, campo).not.toHaveProperty(campo);
    }
  });

  it("campo de texto apagado vira null — limpar continua possível", () => {
    expect(corpoParcial({ ...ORIGINAL, suporteEmail: "" }, ORIGINAL)).toEqual({ suporteEmail: null });
  });

  it("logo novo em SVG apaga o PNG, e vice-versa", () => {
    expect(corpoParcial({ ...ORIGINAL, logoSvg: SVG }, ORIGINAL)).toEqual({ logoSvg: SVG, logoPng: null });
    expect(corpoParcial({ ...ORIGINAL, logoPng: PNG }, ORIGINAL)).toEqual({ logoPng: PNG, logoSvg: null });
  });

  it("favicon novo viaja sozinho", () => {
    expect(corpoParcial({ ...ORIGINAL, faviconSvg: SVG }, ORIGINAL)).toEqual({ faviconSvg: SVG });
  });
});

describe("problemasDoFormulario", () => {
  const OK = camposDoDetalhe(MARCA);

  it("o formulário recém-carregado do servidor não tem problema nenhum", () => {
    expect(problemasDoFormulario(OK)).toEqual({});
  });

  it("nome do produto vazio trava: a coluna é NOT NULL e é o nome na tela de login", () => {
    expect(problemasDoFormulario({ ...OK, nomeProduto: "   " })).toHaveProperty("nomeProduto");
  });

  it("cor fora do hexadecimal de 6 dígitos trava; a escura só se preenchida", () => {
    expect(problemasDoFormulario({ ...OK, corBrand: "#FFF" })).toHaveProperty("corBrand");
    expect(problemasDoFormulario({ ...OK, corBrandDark: "" })).not.toHaveProperty("corBrandDark");
    expect(problemasDoFormulario({ ...OK, corBrandDark: "roxo" })).toHaveProperty("corBrandDark");
  });

  it("site sem protocolo é recusado aqui porque o zod da rota o recusa lá", () => {
    expect(problemasDoFormulario({ ...OK, site: "crednet.com.br" })).toHaveProperty("site");
    expect(problemasDoFormulario({ ...OK, site: "https://crednet.com.br" })).not.toHaveProperty("site");
    expect(problemasDoFormulario({ ...OK, site: "" })).not.toHaveProperty("site");
  });

  it("e-mail de suporte sem cara de e-mail trava; vazio não", () => {
    expect(problemasDoFormulario({ ...OK, suporteEmail: "suporte@" })).toHaveProperty("suporteEmail");
    expect(problemasDoFormulario({ ...OK, suporteEmail: "" })).not.toHaveProperty("suporteEmail");
  });

  it("o limite de arquivo é medido na string, que é o que o servidor mede", () => {
    /* Um PNG de 400 KB em disco vira um data URI de ~533 KB e é recusado lá.
       Medir o arquivo diria "cabe" e o servidor diria "não cabe". */
    const png = `data:image/png;base64,${"A".repeat(512 * 1024)}`;
    expect(png.length).toBeGreaterThan(512 * 1024);
    expect(problemasDoFormulario({ ...OK, logoPng: png })).toHaveProperty("logoPng");
    expect(problemasDoFormulario({ ...OK, logoSvg: `<svg>${"x".repeat(256 * 1024)}</svg>` }))
      .toHaveProperty("logoSvg");
  });
});

describe("corValida", () => {
  it("aceita só #RRGGBB, como o servidor", () => {
    expect(corValida("#4A4670")).toBe(true);
    expect(corValida("#4a4670")).toBe(true);
    expect(corValida("#FFF")).toBe(false);
    expect(corValida("4A4670")).toBe(false);
    expect(corValida("")).toBe(false);
  });
});
