/**
 * O corpo do PATCH de uma marca: a diferença entre o formulário e o que o
 * servidor tem.
 *
 * Vive fora do componente porque é aqui que estava o defeito, e defeito assim
 * merece teste. O formulário nasce da LISTA de marcas, que não carrega logo,
 * favicon, WhatsApp nem nome de exibição do e-mail — a listagem corta esses
 * campos para não trafegar três SVGs por linha. Enviando o formulário inteiro,
 * eles saíam vazios e o servidor os gravava como nulos: abrir a edição de uma
 * marca para corrigir um telefone APAGAVA o logo do revendedor, e ninguém via
 * até um cliente reclamar que a marca sumiu da tela de login.
 *
 * A regra é uma só: o que não mudou não é enviado, e o que o formulário nunca
 * carregou não muda.
 */

/** Campos de arquivo. Vazio neles significa "não mexi", nunca "apague". */
const ARQUIVOS = ["logoSvg", "logoPng", "faviconSvg"] as const;

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
