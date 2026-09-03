/**
 * O teste que reproduz o defeito: editar o telefone apagava o logo.
 *
 * O formulário de marcas era enviado inteiro, e ele nasce da LISTA — que não
 * carrega logo, favicon, WhatsApp nem nome de exibição do e-mail. Os campos
 * ausentes iam como nulo e o servidor os gravava assim. A marca do revendedor
 * sumia da tela de login dele por causa de uma edição de contato.
 */
import { describe, it, expect } from "vitest";
import { corpoParcial } from "./marca-form";

/** O formulário como ele abre numa marca existente: sem os arquivos. */
const ORIGINAL = {
  slug: "crednet", nomeProduto: "CredNet", assinatura: "",
  dominio: "app.crednet.com.br", corBrand: "#1F6F7A", corBrandDark: "",
  suporteEmail: "suporte@crednet.com.br", suporteWhatsapp: "5531999998888",
  site: "", emailRemetente: "", emailNomeExibicao: "CredNet",
  responsavelRazaoSocial: "CredNet Ltda", responsavelCnpj: "00.000.000/0001-00",
  logoSvg: "", logoPng: "", faviconSvg: "",
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("corpoParcial", () => {
  it("nada mudou, nada é enviado", () => {
    expect(corpoParcial({ ...ORIGINAL }, ORIGINAL)).toEqual({});
  });

  it("o defeito: mexer no telefone não pode encostar em logo, favicon ou e-mail", () => {
    const corpo = corpoParcial({ ...ORIGINAL, suporteWhatsapp: "5531988887777" }, ORIGINAL);
    expect(corpo).toEqual({ suporteWhatsapp: "5531988887777" });
    for (const campo of ["logoSvg", "logoPng", "faviconSvg", "emailNomeExibicao"]) {
      expect(corpo, campo).not.toHaveProperty(campo);
    }
  });

  it("campo de texto apagado vira null — limpar continua possível", () => {
    const corpo = corpoParcial({ ...ORIGINAL, suporteEmail: "" }, ORIGINAL);
    expect(corpo).toEqual({ suporteEmail: null });
  });

  it("arquivo novo viaja; o outro formato de logo é apagado junto", () => {
    expect(corpoParcial({ ...ORIGINAL, logoSvg: SVG }, ORIGINAL))
      .toEqual({ logoSvg: SVG, logoPng: null });
    expect(corpoParcial({ ...ORIGINAL, logoPng: PNG }, ORIGINAL))
      .toEqual({ logoPng: PNG, logoSvg: null });
  });

  it("favicon novo não mexe no logo", () => {
    expect(corpoParcial({ ...ORIGINAL, faviconSvg: SVG }, ORIGINAL)).toEqual({ faviconSvg: SVG });
  });

  it("campo de arquivo vazio NUNCA vira null, mesmo com o servidor tendo conteúdo", () => {
    // Se um dia alguém preencher `original` com o SVG do servidor, o campo vazio
    // do formulário não pode ser lido como "apague".
    const comArquivoNoServidor = { ...ORIGINAL, logoSvg: SVG, faviconSvg: SVG };
    const corpo = corpoParcial({ ...ORIGINAL, nomeProduto: "CredNet Pro" }, comArquivoNoServidor);
    expect(corpo).toEqual({ nomeProduto: "CredNet Pro" });
  });

  it("várias mudanças de uma vez saem juntas, e só elas", () => {
    const corpo = corpoParcial(
      { ...ORIGINAL, nomeProduto: "CredNet Pro", corBrand: "#4A4670", site: "https://crednet.com.br" },
      ORIGINAL,
    );
    expect(corpo).toEqual({
      nomeProduto: "CredNet Pro", corBrand: "#4A4670", site: "https://crednet.com.br",
    });
  });

  it("campo que o original nem conhece conta como mudança quando tem valor", () => {
    // Formulário mais novo que o snapshot: o campo novo precisa ser gravável.
    const corpo = corpoParcial({ ...ORIGINAL, emailNomeExibicao: "CredNet" }, { ...ORIGINAL, emailNomeExibicao: "" });
    expect(corpo).toEqual({ emailNomeExibicao: "CredNet" });
  });
});
