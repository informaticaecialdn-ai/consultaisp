/**
 * A lógica do formulário de marcas: o que ele mostra, quando ele nasce e o que
 * ele envia.
 *
 * Vive fora do componente porque é aqui que estavam os dois defeitos, e defeito
 * assim merece teste — a página é `.tsx` e este projeto não roda componente em
 * DOM, então lógica dentro dela não é coberta por ninguém.
 *
 * 1. O formulário nascia da LISTA de marcas, que não carrega logo, favicon,
 *    WhatsApp nem nome de exibição do e-mail. Enviando o formulário inteiro,
 *    eles saíam vazios e o servidor os gravava como nulos: abrir a edição de uma
 *    marca para corrigir um telefone APAGAVA o logo do revendedor, e ninguém via
 *    até um cliente reclamar que a marca sumiu da tela de login. A regra do
 *    PATCH é uma só: o que não mudou não é enviado, e o que o formulário nunca
 *    carregou não muda.
 * 2. E a hidratação com o detalhe reescrevia o que já tinha sido digitado —
 *    ver `faseDoFormulario`.
 */

/** Campos de arquivo. Vazio neles significa "não mexi", nunca "apague". */
const ARQUIVOS = ["logoSvg", "logoPng", "faviconSvg"] as const;

/**
 * O formulário em branco — e, na prática, a lista de campos que a tela edita.
 * Mora aqui, ao lado do diff, porque campo que existe num lugar e não no outro
 * sai do PATCH sem ninguém perceber.
 */
export const FORMULARIO_VAZIO: Record<string, string> = {
  slug: "", nomeProduto: "", assinatura: "", dominio: "", corBrand: "#4A4670",
  corBrandDark: "", suporteEmail: "", suporteWhatsapp: "", site: "",
  emailRemetente: "", emailNomeExibicao: "",
  responsavelRazaoSocial: "", responsavelCnpj: "",
  logoSvg: "", logoPng: "", faviconSvg: "",
};

/**
 * O detalhe do servidor virando formulário.
 *
 * Os campos de ARQUIVOS ficam em branco de propósito, mesmo quando o servidor
 * tem logo e favicon: branco ali é "não mexi", e é o que os mantém fora do
 * diff — ver `corpoParcial`.
 */
export function camposDoDetalhe(detalhe: Record<string, any>): Record<string, string> {
  return {
    ...FORMULARIO_VAZIO,
    slug: detalhe.slug ?? "",
    nomeProduto: detalhe.nomeProduto ?? "",
    assinatura: detalhe.assinatura ?? "",
    dominio: detalhe.dominio ?? "",
    corBrand: detalhe.corBrand || FORMULARIO_VAZIO.corBrand,
    corBrandDark: detalhe.corBrandDark ?? "",
    suporteEmail: detalhe.suporteEmail ?? "",
    suporteWhatsapp: detalhe.suporteWhatsapp ?? "",
    site: detalhe.site ?? "",
    emailRemetente: detalhe.emailRemetente ?? "",
    emailNomeExibicao: detalhe.emailNomeExibicao ?? "",
    responsavelRazaoSocial: detalhe.responsavelRazaoSocial ?? "",
    responsavelCnpj: detalhe.responsavelCnpj ?? "",
  };
}

export type FaseDoFormulario =
  | { fase: "fechado" }
  | { fase: "aguardando" }
  | { fase: "erro" }
  | { fase: "carregar"; campos: Record<string, string> }
  | { fase: "pronto" };

/**
 * Em que pé está o formulário de edição — e é aqui que mora a correção do
 * segundo defeito desta tela.
 *
 * Antes, o formulário abria com os campos da LISTA e um efeito o completava
 * quando o detalhe chegasse. A trava só impedia a SEGUNDA hidratação: a
 * primeira acontecia fosse qual fosse o estado do formulário e reescrevia tudo
 * com o que veio do servidor. Quem clicava em "Editar" e começava a escrever no
 * mesmo instante via o texto sumir sem aviso.
 *
 * A saída escolhida é NÃO EXISTIR campo antes da resposta: enquanto a fase é
 * "aguardando", a tela mostra esqueleto, e não há digitação a perder. A
 * alternativa — marcar o formulário como sujo e mesclar só o que a lista não
 * trazia — deixaria de pé exatamente o caso em que o operador digita no
 * WhatsApp de suporte ou no nome de exibição do e-mail, que são justamente os
 * campos que só o detalhe traz.
 *
 * "pronto" vem ANTES de olhar o detalhe: a query do detalhe é invalidada ao
 * vincular um provedor, e a resposta nova não pode reescrever o formulário.
 */
export function faseDoFormulario(
  editando: number | "nova" | null,
  detalhe: Record<string, any> | null | undefined,
  jaCarregada: number | null,
  falhou = false,
): FaseDoFormulario {
  if (editando === null) return { fase: "fechado" };
  if (editando === "nova") return { fase: "pronto" };
  if (jaCarregada === editando) return { fase: "pronto" };
  // Sem esta fase, GET do detalhe que falha deixa a tela em esqueleto para
  // sempre, sem uma palavra: o operador acha que ainda está carregando.
  if (falhou) return { fase: "erro" };
  // Resposta atrasada da marca anterior não vale para esta.
  if (!detalhe || detalhe.id !== editando) return { fase: "aguardando" };
  return { fase: "carregar", campos: camposDoDetalhe(detalhe) };
}

export function corpoParcial(
  form: Record<string, string>,
  original: Record<string, string>,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};

  for (const [campo, valor] of Object.entries(form)) {
    if (valor === (original[campo] ?? "")) continue;
    // Texto apagado no formulário é intenção de limpar; o servidor aceita null.
    corpo[campo] = valor === "" ? null : valor;
  }

  // Campo de arquivo só viaja quando carrega conteúdo NOVO. Vazio ali é sempre
  // "não mexi" — não existe botão de remover logo, e um null que ninguém pediu
  // é exatamente o defeito que este módulo conserta.
  for (const campo of ARQUIVOS) {
    if (campo in corpo && !corpo[campo]) delete corpo[campo];
  }

  // Trocar de formato de logo tem de apagar o outro: guardar SVG e PNG ao mesmo
  // tempo deixa ambíguo qual é o logo, e o servidor prefere o SVG em silêncio.
  if (corpo.logoSvg) corpo.logoPng = null;
  if (corpo.logoPng) corpo.logoSvg = null;

  return corpo;
}
