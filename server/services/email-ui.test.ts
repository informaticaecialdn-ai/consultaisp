/**
 * A APARENCIA do e-mail, sob teste.
 *
 * Este e o unico modulo do produto cujo defeito e IRREVERSIVEL: nao ha CSS
 * externo para corrigir, nao ha recarregar, e o que saiu errado ficou errado na
 * caixa de entrada de quem recebeu. Por isso o que se testa aqui nao e "o HTML
 * parece bonito" — e as tres coisas que quebram de verdade:
 *
 *  1. ESCAPE. `esc` e a unica barreira entre o nome que um provedor digitou no
 *     cadastro e o HTML que sai. Todo bloco que recebe dado de fora tem de
 *     passar por ela.
 *  2. O ENVELOPE. DOCTYPE, preheader e a marca certa no lugar certo.
 *  3. A COR DA MARCA. Um revendedor que abre o e-mail e ve o roxo da
 *     plataforma descobre de quem comprou de fato.
 */
import { describe, it, expect } from "vitest";
import {
  acento, alerta, blocoDeDados, botao, brl, divisor, envelope, esc, kicker,
  linkDeReserva, linkSecundario, paragrafo, passos, saudacao, titulo,
} from "./email-ui";
import { MARCA_PLATAFORMA, type MarcaResolvida } from "./marca.service";

/** O payload que se usa aqui do inicio ao fim. Se ele sair cru, o teste falhou. */
const HOSTIL = `<img src=x onerror=alert(1)>`;

/** Um revendedor de verdade: nome proprio, cor propria, dominio proprio. */
const CREDNET: MarcaResolvida = {
  ...MARCA_PLATAFORMA,
  origem: "dominio-proprio",
  contexto: "tenant",
  marcaId: 7,
  dominio: "app.crednet.com.br",
  dominioAtivo: true,
  nomeProduto: "CredNet Bureau",
  assinatura: "Crédito para provedores",
  suporteEmail: "suporte@crednet.com.br",
  cores: {
    claro: { brand: "#1F6F7A", hover: "#186068", soft: "#E4F1F3", ink: "#155760", textOnBrand: "#FFFFFF", ajustada: false },
    escuro: { brand: "#7FC6CF", hover: "#8FD2DA", soft: "#123338", ink: "#A6DCE2", textOnBrand: "#131219", ajustada: false },
  },
};

describe("esc", () => {
  it("escapa os cinco caracteres que quebram HTML e atributo", () => {
    expect(esc(`&`)).toBe("&amp;");
    expect(esc(`<`)).toBe("&lt;");
    expect(esc(`>`)).toBe("&gt;");
    expect(esc(`"`)).toBe("&quot;");
    expect(esc(`'`)).toBe("&#39;");
  });

  it("escapa o & primeiro, senao a propria entidade seria escapada de novo", () => {
    // Se a ordem fosse outra, `<` viraria `&amp;lt;` e o leitor veria "&lt;".
    expect(esc("<")).toBe("&lt;");
    expect(esc("&lt;")).toBe("&amp;lt;");
  });

  it("neutraliza uma tag inteira", () => {
    expect(esc(HOSTIL)).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(esc(HOSTIL)).not.toContain("<img");
  });

  it("neutraliza a fuga de atributo — aspas fechadas no meio de um style/href", () => {
    const fuga = `" onerror="alert(1)`;
    expect(esc(fuga)).toBe("&quot; onerror=&quot;alert(1)");
    expect(esc(fuga)).not.toContain(`"`);
  });

  it("nulo e indefinido viram string vazia, nunca 'null' nem 'undefined'", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("brl", () => {
  it("sempre dois decimais, para a coluna nao dancar", () => {
    expect(brl(99)).toBe("R$ 99,00");
    expect(brl(1234.5)).toBe("R$ 1.234,50");
    expect(brl(526.07)).toBe("R$ 526,07");
  });

  it("zero e ausencia de valor viram R$ 0,00, nao 'R$ NaN'", () => {
    expect(brl(0)).toBe("R$ 0,00");
    expect(brl(undefined as unknown as number)).toBe("R$ 0,00");
    expect(brl(NaN)).toBe("R$ 0,00");
  });
});

describe("blocos que recebem dado de fora", () => {
  it("kicker escapa o texto", () => {
    expect(kicker(HOSTIL)).not.toContain("<img");
    expect(kicker(HOSTIL)).toContain("&lt;img");
  });

  it("saudacao escapa o nome", () => {
    expect(saudacao(HOSTIL)).not.toContain("<img");
    expect(saudacao("Emerson Queiroz")).toContain("Emerson Queiroz");
  });

  it("blocoDeDados escapa o ROTULO; o valor e contrato de quem chama", () => {
    const html = blocoDeDados([{ rotulo: HOSTIL, valor: "x" }]);
    expect(html).not.toContain("<img");
    // O valor sai cru de proposito: e por onde entra o link de pagamento e o
    // <a> do endereco de acesso. Quem chama escapa — e `email.test.ts` prova
    // que todas as 14 mensagens de fato escapam.
    expect(blocoDeDados([{ rotulo: "x", valor: `<a href="#">ok</a>` }])).toContain(`<a href="#">ok</a>`);
  });

  it("botao, linkSecundario e linkDeReserva escapam o href", () => {
    const veneno = `https://x.com/" onclick="alert(1)`;
    for (const html of [
      botao(veneno, "Ir", MARCA_PLATAFORMA),
      linkSecundario(veneno, "Ir", MARCA_PLATAFORMA),
      linkDeReserva(veneno, MARCA_PLATAFORMA),
    ]) {
      expect(html).not.toContain(`onclick="alert(1)"`);
      expect(html).toContain("&quot; onclick=&quot;alert(1)");
    }
  });

  it("os blocos sem dado de fora saem estaveis", () => {
    expect(divisor()).toContain("border-top");
    expect(paragrafo("texto")).toContain("texto");
    expect(alerta("cuidado", "perigo")).toContain("cuidado");
    expect(passos(["um", "dois"], MARCA_PLATAFORMA)).toContain("dois");
  });
});

describe("acento", () => {
  it("sem cores, a berinjela da plataforma", () => {
    expect(acento(MARCA_PLATAFORMA)).toEqual({
      brand: "#4A4670", hover: "#3C3860", sobre: "#FFFFFF", suave: "#EDECF3",
    });
  });

  it("com cores, a cor do revendedor", () => {
    expect(acento(CREDNET).brand).toBe("#1F6F7A");
    expect(acento(CREDNET).suave).toBe("#E4F1F3");
  });
});

describe("envelope", () => {
  const html = envelope("<p>corpo</p>", "a previa da caixa de entrada", MARCA_PLATAFORMA);

  it("e um documento completo — sem DOCTYPE o Outlook renderiza em modo quirks", () => {
    expect(html.startsWith("<!DOCTYPE")).toBe(true);
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("charset=UTF-8");
  });

  it("leva o preheader escondido, antes de qualquer texto visivel", () => {
    expect(html).toContain("a previa da caixa de entrada");
    // Tem de vir antes do corpo: e o que a caixa de entrada le para a previa.
    expect(html.indexOf("a previa da caixa de entrada")).toBeLessThan(html.indexOf("<p>corpo</p>"));
  });

  it("preheader ausente nao vira 'undefined' na previa", () => {
    const semPreheader = envelope("<p>x</p>", undefined, MARCA_PLATAFORMA);
    expect(semPreheader).not.toContain("undefined");
  });

  it("sem logo, o quadrado com a inicial do produto — imagem bloqueada nao pode apagar a marca", () => {
    expect(html).toContain(">C<");
    expect(html).not.toContain("<img");
  });

  it("com logo, a imagem sai sob o dominio da marca", () => {
    const comLogo = envelope("x", "y", { ...CREDNET, logoUrl: "/api/marca/7/logo" });
    expect(comLogo).toContain(`src="https://app.crednet.com.br/api/marca/7/logo"`);
    expect(comLogo).toContain(`alt="CredNet Bureau"`);
  });

  it("nome de produto hostil nao vira marcacao — nem no titulo, nem no alt, nem na inicial", () => {
    const sujo = envelope("x", "y", { ...CREDNET, nomeProduto: `<script>alert(1)</script>`, logoUrl: "/l.png" });
    expect(sujo).not.toContain("<script>");
    expect(sujo).toContain("&lt;script&gt;");
  });

  it("assinatura hostil tambem sai escapada", () => {
    expect(envelope("x", "y", { ...CREDNET, assinatura: HOSTIL })).not.toContain("<img");
  });

  it("preheader hostil sai escapado", () => {
    expect(envelope("x", HOSTIL, MARCA_PLATAFORMA)).not.toContain("<img");
  });
});

describe("envelope, marca de revendedor", () => {
  const html = envelope("<p>corpo</p>", "previa", CREDNET);

  it("mostra o nome do revendedor, e nao o da plataforma", () => {
    expect(html).toContain("CredNet Bureau");
    expect(html).not.toContain("Consulta ISP");
  });

  it("o filete e o botao usam a cor do revendedor", () => {
    expect(html).toContain("#1F6F7A");
    expect(html).not.toContain("#4A4670");
  });

  it("o rodape leva o e-mail de suporte do revendedor e o dominio dele", () => {
    expect(html).toContain("suporte@crednet.com.br");
    expect(html).toContain("app.crednet.com.br");
  });

  it("sem e-mail de suporte, o rodape simplesmente nao mostra a linha", () => {
    const semSuporte = envelope("x", "y", { ...CREDNET, suporteEmail: null });
    expect(semSuporte).not.toContain("Suporte:");
    expect(semSuporte).not.toContain("mailto:");
  });

  it("e-mail de suporte hostil nao escapa do atributo mailto", () => {
    const sujo = envelope("x", "y", { ...CREDNET, suporteEmail: `a@b.com" onclick="alert(1)` });
    expect(sujo).not.toContain(`onclick="alert(1)"`);
  });
});
