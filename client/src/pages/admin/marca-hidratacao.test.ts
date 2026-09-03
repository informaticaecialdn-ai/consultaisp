/**
 * O segundo defeito da tela de marcas: editar apagava o que o operador digitou.
 *
 * O formulário abria com os campos da LISTA e um efeito o completava com o
 * detalhe que chegasse depois. A trava só impedia a SEGUNDA hidratação — a
 * primeira acontecia fosse qual fosse o estado do formulário e fazia
 * `setForm(f => ({ ...doServidor, ...arquivos }))`, descartando tudo que já
 * tinha sido escrito. Quem clicava em "Editar" e começava a digitar no mesmo
 * instante via o texto sumir sem aviso.
 *
 * A correção é não existir campo antes da resposta: enquanto a fase é
 * "aguardando" a tela mostra esqueleto. Sem campo não há digitação a perder.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { camposDoDetalhe, faseDoFormulario, FORMULARIO_VAZIO } from "./marca-form";

const DETALHE = {
  id: 7, slug: "crednet", nomeProduto: "CredNet", assinatura: "Crédito para provedores",
  dominio: "app.crednet.com.br", corBrand: "#1F6F7A", corBrandDark: null,
  suporteEmail: "suporte@crednet.com.br", suporteWhatsapp: "5531999998888", site: null,
  emailRemetente: null, emailNomeExibicao: "CredNet",
  responsavelRazaoSocial: "CredNet Ltda", responsavelCnpj: "00.000.000/0001-00",
  // O servidor tem os arquivos; o formulário não os carrega de propósito.
  logoSvg: "<svg />", logoPng: null, faviconSvg: "<svg />",
};

describe("faseDoFormulario", () => {
  it("digitou antes da resposta chegar: não há campo, então não há o que perder", () => {
    // Clicou em Editar; o detalhe está a caminho.
    expect(faseDoFormulario(7, undefined, null)).toEqual({ fase: "aguardando" });
    expect(faseDoFormulario(7, null, null)).toEqual({ fase: "aguardando" });

    // A resposta chega e é ela — inteira — que monta o formulário.
    const chegou = faseDoFormulario(7, DETALHE, null);
    expect(chegou.fase).toBe("carregar");

    // A partir daqui o que está na tela é do operador. A query do detalhe é
    // invalidada ao vincular um provedor: a resposta nova NÃO pode reescrever.
    expect(faseDoFormulario(7, DETALHE, 7)).toEqual({ fase: "pronto" });
  });

  it("marca nova não espera detalhe nenhum", () => {
    expect(faseDoFormulario("nova", undefined, null)).toEqual({ fase: "pronto" });
  });

  it("sem edição aberta, o formulário nem existe", () => {
    expect(faseDoFormulario(null, DETALHE, null)).toEqual({ fase: "fechado" });
  });

  it("resposta atrasada de OUTRA marca não carrega esta", () => {
    expect(faseDoFormulario(9, DETALHE, null)).toEqual({ fase: "aguardando" });
  });

  /**
   * Sem a fase de erro, um GET que falha deixava a tela em esqueleto para
   * sempre — e esqueleto diz "estou carregando", não "não deu".
   */
  it("detalhe que não chega vira erro, não esqueleto eterno", () => {
    expect(faseDoFormulario(7, undefined, null, true)).toEqual({ fase: "erro" });
  });

  it("erro depois de carregado não derruba quem já está editando", () => {
    expect(faseDoFormulario(7, DETALHE, 7, true)).toEqual({ fase: "pronto" });
  });
});

describe("camposDoDetalhe", () => {
  it("o formulário sai completo, com os campos que a lista não trazia", () => {
    const campos = camposDoDetalhe(DETALHE);
    expect(campos.suporteWhatsapp).toBe("5531999998888");
    expect(campos.emailNomeExibicao).toBe("CredNet");
    expect(campos.nomeProduto).toBe("CredNet");
  });

  it("nulo do servidor vira texto vazio, e cor ausente volta ao padrão", () => {
    const campos = camposDoDetalhe({ id: 7, corBrand: null });
    expect(campos.site).toBe("");
    expect(campos.corBrand).toBe(FORMULARIO_VAZIO.corBrand);
  });

  it("logo e favicon do servidor NÃO entram no formulário — vazio ali é 'não mexi'", () => {
    const campos = camposDoDetalhe(DETALHE);
    expect(campos.logoSvg).toBe("");
    expect(campos.faviconSvg).toBe("");
  });
});

/**
 * GUARDA: a tela não pode voltar a mesclar o detalhe por cima do formulário.
 * A mescla é o defeito; um refactor futuro que a traga de volta reintroduz o
 * apagamento silencioso sem quebrar nenhum outro teste (a página é .tsx e este
 * projeto não roda componente em DOM).
 */
describe("guarda de admin-marcas.tsx", () => {
  const fonte = readFileSync(join(__dirname, "admin-marcas.tsx"), "utf8");

  it("não existe setForm mesclando por cima do que está digitado", () => {
    expect(fonte).not.toMatch(/setForm\(\s*f\s*=>\s*\(\{\s*\.\.\.doServidor/);
  });

  it("o formulário passa pelo portão da fase antes de renderizar campo", () => {
    expect(fonte).toContain("faseDoFormulario");
    expect(fonte).toContain('fase.fase === "aguardando"');
  });
});
