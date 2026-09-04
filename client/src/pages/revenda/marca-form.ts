/**
 * A lógica do formulário "Minha marca" do revendedor: o que ele carrega, o que
 * ele recusa antes de enviar, e o que ele envia.
 *
 * Vive fora do componente porque a página é `.tsx` e este projeto não roda
 * componente em DOM (ver o `include` do vitest.config.ts): lógica dentro dela
 * não é coberta por ninguém. Aqui é onde moram as duas regras que, se
 * quebrarem, apagam dado gravado sem ninguém ver.
 *
 * ── POR QUE NÃO REUSO `pages/admin/marca-form.ts` ──────────────────────────
 *
 * Os dois formulários editam conjuntos DIFERENTES: o do superadmin edita slug,
 * domínio, e-mail remetente e responsável LGPD; a rota do revendedor
 * (`PATCH /api/revenda/marca`) é um zod `.strict()` que RECUSA exatamente esses
 * quatro. Compartilhar a lista de campos faria a próxima coluna acrescentada ao
 * formulário do superadmin entrar caladamente no corpo do PATCH do revendedor —
 * e `.strict()` transforma isso em 400 numa edição que não tem nada a ver.
 * A lista de campos é o contrato com a rota, e cada rota tem o seu.
 *
 * ── AS DUAS REGRAS QUE PROTEGEM DADO GRAVADO ───────────────────────────────
 *
 * 1. SÓ O QUE MUDOU VIAJA. O formulário nunca carrega logo nem favicon (são
 *    SVGs, ninguém os edita como texto, e o GET não os devolve). Enviando o
 *    formulário inteiro, eles sairiam vazios e o servidor os gravaria como
 *    nulos: abrir a tela para corrigir um telefone APAGARIA o logo. Não é
 *    hipótese — foi o defeito consertado em `pages/admin/marca-form.ts`, na
 *    mesma família de tela.
 * 2. VAZIO EM CAMPO DE ARQUIVO É "NÃO MEXI", NUNCA "APAGUE". Não existe botão
 *    de remover logo; um `null` que ninguém pediu é o defeito da regra 1
 *    voltando pela porta dos fundos.
 */

/** Campos de arquivo. Vazio neles significa "não mexi" — ver a regra 2 acima. */
const ARQUIVOS = ["logoSvg", "logoPng", "faviconSvg"] as const;

/**
 * O formulário em branco — e, na prática, a lista exata de campos que a tela do
 * revendedor edita. Mora ao lado do diff, porque campo que existe num lugar e
 * não no outro sai do PATCH sem ninguém perceber.
 *
 * O que NÃO está aqui está fora de propósito: `slug`, `dominio`, `ativo`,
 * `emailRemetente`, `responsavel*`, `comissao*` e `repasse_*` são somente
 * leitura ou invisíveis para o revendedor, e a rota recusa cada um deles.
 * `landing`, `landingAtiva`, `cadastroAberto` e `ogImagePng` existem no schema
 * mas são da fase 5 — entram aqui quando a tela de landing entrar.
 */
export const FORMULARIO_VAZIO: Record<string, string> = {
  nomeProduto: "",
  assinatura: "",
  corBrand: "#4A4670",
  corBrandDark: "",
  suporteEmail: "",
  suporteWhatsapp: "",
  site: "",
  emailNomeExibicao: "",
  logoSvg: "",
  logoPng: "",
  faviconSvg: "",
};

/** O que o `GET /api/revenda/marca` precisa devolver para preencher a tela. */
export type MarcaDoRevendedor = {
  id: number;
  /** Somente leitura: é ele que compõe endereços internos do sistema. */
  slug: string;
  nomeProduto: string;
  assinatura: string | null;
  corBrand: string;
  corBrandDark: string | null;
  suporteEmail: string | null;
  suporteWhatsapp: string | null;
  site: string | null;
  emailNomeExibicao: string | null;
  /**
   * Somente leitura. Nulo = os e-mails saem do domínio verificado da
   * plataforma com o nome de exibição da marca. É o que o destinatário vê no
   * cabeçalho, então a tela precisa dizer qual dos dois está valendo.
   */
  emailRemetente: string | null;
  /** Somente leitura: quem aponta o DNS é o revendedor, quem emite o certificado é a plataforma. */
  dominio: string | null;
  dominioStatus: string;
  /** IP do servidor para o registro A. Nulo quando a plataforma não o publica. */
  dnsIp: string | null;
  responsavelRazaoSocial: string | null;
  responsavelCnpj: string | null;
  /** Os arquivos não vêm no corpo — só o fato de existirem. Ver a regra 2. */
  temLogo: boolean;
  logoEhPng: boolean;
  temFavicon: boolean;
  /** Paleta derivada da cor GRAVADA, calculada no servidor. Nula se a cor for inválida. */
  previa: { claro: PaletaDaMarca; escuro: PaletaDaMarca } | null;
};

export type PaletaDaMarca = {
  brand: string;
  hover: string;
  soft: string;
  ink: string;
  textOnBrand: string;
  /** true quando a cor teve de ser escurecida/clareada para passar contraste. */
  ajustada: boolean;
};

/**
 * O detalhe do servidor virando formulário.
 *
 * Os campos de ARQUIVOS ficam em branco de propósito, mesmo numa marca que TEM
 * logo e favicon: branco ali é "não mexi", e é isso que os mantém fora do diff.
 */
export function camposDoDetalhe(marca: MarcaDoRevendedor): Record<string, string> {
  return {
    ...FORMULARIO_VAZIO,
    nomeProduto: marca.nomeProduto ?? "",
    assinatura: marca.assinatura ?? "",
    corBrand: marca.corBrand || FORMULARIO_VAZIO.corBrand,
    corBrandDark: marca.corBrandDark ?? "",
    suporteEmail: marca.suporteEmail ?? "",
    suporteWhatsapp: marca.suporteWhatsapp ?? "",
    site: marca.site ?? "",
    emailNomeExibicao: marca.emailNomeExibicao ?? "",
  };
}

/** A mesma regra do servidor (`corValida`, server/utils/marca-cores.ts). */
export function corValida(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex ?? "");
}

/**
 * Os limites são os do servidor, e são sobre o TAMANHO DA STRING — não sobre o
 * tamanho do arquivo em disco.
 *
 * Importa porque base64 infla o PNG em cerca de 4/3: um arquivo de 400 KB vira
 * um data URI de ~533 KB e é recusado. Medir `File.size` aqui diria "cabe" e o
 * servidor diria "não cabe", que é a pior das duas respostas — a que chega
 * depois de o operador esperar o upload.
 */
const LIMITE_SVG = 256 * 1024;
const LIMITE_PNG = 512 * 1024;

/**
 * O que impede o envio, por campo. Objeto vazio = pode salvar.
 *
 * Espelha o zod da rota (`esquemaMarca` em server/routes/marca.routes.ts) nos
 * campos que esta tela edita. Não substitui o servidor — duplica de propósito,
 * para o revendedor saber o que está errado sem gastar uma viagem e sem ver a
 * mensagem crua de um 400.
 */
export function problemasDoFormulario(form: Record<string, string>): Record<string, string> {
  const p: Record<string, string> = {};
  const texto = (campo: string) => (form[campo] ?? "").trim();

  /* `nomeProduto` é NOT NULL no banco e é o nome que aparece na tela de login
     do revendedor. Sem esta trava, apagar o campo mandaria `null` e derrubaria
     a gravação inteira com um 400 que não diz qual campo é. */
  if (!texto("nomeProduto")) p.nomeProduto = "Informe o nome do produto.";
  else if (texto("nomeProduto").length > 60) p.nomeProduto = "Máximo de 60 caracteres.";

  if (texto("assinatura").length > 120) p.assinatura = "Máximo de 120 caracteres.";
  if (texto("emailNomeExibicao").length > 60) p.emailNomeExibicao = "Máximo de 60 caracteres.";
  if (texto("suporteWhatsapp").length > 30) p.suporteWhatsapp = "Máximo de 30 caracteres.";

  if (!corValida(texto("corBrand"))) p.corBrand = "Use um hexadecimal de 6 dígitos, como #4A4670.";
  if (texto("corBrandDark") && !corValida(texto("corBrandDark"))) {
    p.corBrandDark = "Use um hexadecimal de 6 dígitos, como #A9A2D8.";
  }

  /* O servidor usa `z.string().email()`; aqui basta separar "tem cara de
     e-mail" de "não tem", porque quem decide continua sendo ele. */
  const email = texto("suporteEmail");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    p.suporteEmail = "Informe um e-mail válido.";
  }

  /* `site` é `z.string().url()` na rota: sem protocolo o zod recusa, e
     "crednet.com.br" é exatamente o que um humano digita. Dizer isso aqui evita
     um 400 por causa de oito caracteres. */
  const site = texto("site");
  if (site && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(site)) {
    p.site = "Comece com https:// — por exemplo, https://crednet.com.br";
  }

  if (form.logoSvg && form.logoSvg.length > LIMITE_SVG) p.logoSvg = "SVG acima de 256 KB.";
  if (form.faviconSvg && form.faviconSvg.length > LIMITE_SVG) p.faviconSvg = "SVG acima de 256 KB.";
  if (form.logoPng && form.logoPng.length > LIMITE_PNG) p.logoPng = "PNG acima de 512 KB.";

  return p;
}

/**
 * O corpo do PATCH: só o que mudou.
 *
 * Texto apagado vira `null` — "limpar o WhatsApp de suporte" é uma edição
 * legítima e o servidor aceita nulo em todos os campos opcionais desta tela.
 * Campo de arquivo é a exceção, e está na regra 2 do cabeçalho.
 */
export function corpoParcial(
  form: Record<string, string>,
  original: Record<string, string>,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};

  for (const [campo, valor] of Object.entries(form)) {
    if (valor === (original[campo] ?? "")) continue;
    corpo[campo] = valor === "" ? null : valor;
  }

  for (const campo of ARQUIVOS) {
    if (campo in corpo && !corpo[campo]) delete corpo[campo];
  }

  /* Trocar de formato de logo tem de apagar o outro: guardar SVG e PNG ao mesmo
     tempo deixa ambíguo qual é o logo, e o servidor prefere o SVG em silêncio —
     o revendedor mandaria um PNG novo e continuaria vendo o SVG antigo. */
  if (corpo.logoSvg) corpo.logoPng = null;
  if (corpo.logoPng) corpo.logoSvg = null;

  return corpo;
}
