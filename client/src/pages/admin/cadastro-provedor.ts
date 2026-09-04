/**
 * A ficha cadastral do provedor vista pelo superadmin — a lógica, fora do `.tsx`.
 *
 * Existe por um motivo concreto: o vitest deste projeto só coleta `.test.ts` e
 * não há ambiente de DOM, então nada que more dentro do componente é coberto
 * por teste nenhum. Um formulário de 17 campos que grava CNPJ, subdomínio e
 * endereço de um tenant não pode ser a única coisa da tela sem prova.
 *
 * O que a ficha do superadmin editava até aqui: `name`, `subdomain`,
 * `contactEmail`, `contactPhone` e `website`. Faltavam CNPJ, nome fantasia,
 * tipo societário, data de abertura, segmento e os sete campos de endereço —
 * enquanto a gaveta da lista mandava "use o Painel completo", que não abre para
 * o superadmin. Este módulo é o miolo do caminho que passou a existir.
 *
 * O QUE FICA DE FORA, DE PROPÓSITO:
 * - `plan`, `ispCredits`, `spcCredits`: têm rota própria (`POST /:id/plan` e
 *   `POST /:id/credits`). O PATCH SUBSTITUI o saldo enquanto `/credits` SOMA —
 *   um campo de crédito num formulário apagaria saldo comprado. E `plan` é
 *   enum `free|pro`: reenviar o plano atual de um provedor legado (`basic`,
 *   `enterprise`) devolveria 400.
 * - `status` e `verificationStatus`: mudar o valor deles DISPARA E-MAIL ao
 *   provedor ("seu cadastro foi reprovado", "seu acesso foi suspenso"). Já têm
 *   botão próprio, com confirmação. Um seletor perdido entre dezessete campos
 *   transforma um clique errado num e-mail que não dá para voltar atrás.
 *
 * REGRA DE OURO DO PATCH: `adminUpdateProviderSchema` é `.strict()` e o handler
 * grava tudo ou nada. Uma única chave desconhecida, ou um `null` num campo que
 * o servidor declarou não-nulo, derruba o PATCH INTEIRO — as outras dezesseis
 * correções vão junto. Pior: erro de chave desconhecida cai em `formErrors`, e
 * não em `fieldErrors`, então a tela nem consegue apontar qual campo foi.
 * É por isso que `corpoDoPatch` só emite chaves do cadastro, e por isso que
 * `errosDoCadastro` espelha o servidor em vez de improvisar.
 *
 * SEGUNDA REGRA, IGUALMENTE DURA: o PATCH leva SÓ O QUE MUDOU. A ficha do
 * superadmin nasce de uma query com `staleTime` infinito — é um retrato do
 * cadastro no instante em que a tela abriu. Mandar as 17 colunas a cada
 * salvamento transforma esse retrato em ordem de gravação: o provedor corrige o
 * endereço no painel dele às 10h05, o superadmin (com a ficha aberta desde as
 * 10h00) arruma só o telefone e salva às 10h10 — e o endereço novo volta ao
 * valor antigo, sem que nenhum dos dois veja acontecer. Por isso `corpoDoPatch`
 * recebe o cadastro ORIGINAL e compara.
 */

import { z } from "zod";

/** Os campos de cadastro que a ficha do superadmin edita. Todos string no formulário. */
export interface CadastroProvedor {
  name: string;
  tradeName: string;
  cnpj: string;
  legalType: string;
  openingDate: string;
  businessSegment: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  subdomain: string;
  addressZip: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressNeighborhood: string;
  addressCity: string;
  addressState: string;
}

/**
 * As chaves do cadastro, numa lista só.
 *
 * Mora ao lado de `corpoDoPatch` porque é aqui que campo esquecido aparece:
 * um campo que existe no formulário e não no corpo sai do PATCH em silêncio, e
 * um que existe no corpo e não no schema do servidor derruba o PATCH inteiro.
 *
 * DEPENDÊNCIA DO SERVIDOR: `legalType`, `openingDate` e `businessSegment` estão
 * em `createProviderSchema` (o cadastro) mas NÃO em `adminUpdateProviderSchema`
 * (a edição). Enquanto os três não entrarem lá, o `.strict()` recusa o corpo
 * inteiro — não só eles.
 */
export const CAMPOS_DO_CADASTRO: readonly (keyof CadastroProvedor)[] = [
  "name", "tradeName", "cnpj", "legalType", "openingDate", "businessSegment",
  "contactEmail", "contactPhone", "website", "subdomain",
  "addressZip", "addressStreet", "addressNumber", "addressComplement",
  "addressNeighborhood", "addressCity", "addressState",
];

/** As mesmas sete opções do painel do provedor (`LEGAL_TYPES`). Duas listas divergem. */
export const TIPOS_SOCIETARIOS: readonly string[] = [
  "MEI", "ME", "EPP", "LTDA", "S/A", "EIRELI", "Outro",
];

/** Os mesmos cinco segmentos do painel do provedor (`SEGMENTS`). */
export const SEGMENTOS: readonly string[] = [
  "ISP / Provedor de Internet", "Telecom", "Data Center", "TV por Assinatura", "Outro",
];

/** Nulo, indefinido e número viram texto. O formulário só carrega string. */
function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

const CADASTRO_VAZIO: CadastroProvedor = {
  name: "", tradeName: "", cnpj: "", legalType: "", openingDate: "",
  businessSegment: "", contactEmail: "", contactPhone: "", website: "",
  subdomain: "", addressZip: "", addressStreet: "", addressNumber: "",
  addressComplement: "", addressNeighborhood: "", addressCity: "", addressState: "",
};

/**
 * Hidrata o formulário a partir da linha crua de `providers`.
 *
 * A fonte tem de ser o `provider` de `GET /api/admin/providers/:id/detail`, que
 * é a linha inteira. Hidratar de um resumo que não traga todos os campos e
 * depois enviar o corpo completo APAGARIA o que o resumo não trouxe — foi
 * exatamente o defeito que o formulário de marcas teve (editar o telefone
 * apagava o logo).
 *
 * CNPJ e CEP entram CRUS (só dígitos): o estado guarda o dado, a máscara é da
 * exibição. Guardar mascarado é o que faz o PATCH devolver 400 — `cnpj` é
 * `regex(/^\d{14}$/)` no servidor.
 */
export function cadastroDoProvedor(p: Record<string, any> | null | undefined): CadastroProvedor {
  if (!p) return { ...CADASTRO_VAZIO };
  return {
    name: texto(p.name),
    tradeName: texto(p.tradeName),
    cnpj: cnpjCru(texto(p.cnpj)),
    legalType: texto(p.legalType),
    openingDate: texto(p.openingDate),
    businessSegment: texto(p.businessSegment),
    contactEmail: texto(p.contactEmail),
    contactPhone: texto(p.contactPhone),
    website: texto(p.website),
    subdomain: texto(p.subdomain),
    addressZip: cepCru(texto(p.addressZip)),
    addressStreet: texto(p.addressStreet),
    addressNumber: texto(p.addressNumber),
    addressComplement: texto(p.addressComplement),
    addressNeighborhood: texto(p.addressNeighborhood),
    addressCity: texto(p.addressCity),
    addressState: texto(p.addressState),
  };
}

/** Só dígitos, no máximo 14. Para guardar no estado. */
export function cnpjCru(v: string): string {
  return texto(v).replace(/\D/g, "").slice(0, 14);
}

/**
 * 00.000.000/0000-00 — só para EXIBIR.
 *
 * Mascara em degraus porque o campo é digitado: um formatador que só saiba
 * mascarar os 14 dígitos completos devolve o número cru enquanto se digita, e
 * o cursor pula a cada tecla.
 */
export function cnpjMascarado(v: string): string {
  const d = cnpjCru(v);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Só dígitos, no máximo 8. */
export function cepCru(v: string): string {
  return texto(v).replace(/\D/g, "").slice(0, 8);
}

/** 00000-000 — só para exibir. */
export function cepMascarado(v: string): string {
  const d = cepCru(v);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * O subdomínio como ele será gravado: sem espaço em volta e em minúsculas.
 *
 * Minúscula não é preferência: o subdomínio é chave de resolução de host e é
 * comparado como texto (`getProviderBySubdomain`). "Acme" e "acme" gravados
 * como tenants diferentes é um bug de isolamento, não de estética.
 */
function subdominioNormalizado(v: string): string {
  return texto(v).trim().toLowerCase();
}

/**
 * O site como ele será gravado: exatamente o que foi digitado, sem os espaços.
 *
 * Esta função JÁ COMPLETOU o esquema (`www.x.com.br` virava `https://www.x.com.br`)
 * porque `website` era `z.string().url()` no PATCH do superadmin, e o painel do
 * PRÓPRIO provedor grava o campo sem validação nenhuma — a ficha do superadmin
 * levava 400 ao reenviar o valor que ela mesma tinha carregado. O servidor
 * deixou de exigir URL: hoje aceita texto livre e recusa só esquema que não seja
 * http/https.
 *
 * Some com a exigência, some o motivo de inventar o "https://" — e o que sobrava
 * era reescrita silenciosa do dado de outra pessoa. Um provedor que gravou
 * "Não temos site" no painel dele veria a ficha do superadmin gravar
 * "https://Não temos site" só porque alguém salvou o formulário; do lado do
 * superadmin isso é pior ainda, porque o provedor não vê a edição acontecer.
 *
 * O que resta é aparar o espaço, e é isso que faz desta função o ponto único
 * onde se decide "o valor que vai para a coluna" — usado pelos DOIS lados da
 * comparação de `corpoDoPatch`.
 */
export function siteNormalizado(v: string): string {
  return texto(v).trim();
}

/**
 * As opções de um `<select>` mais o valor que já está gravado, quando ele está
 * fora da lista.
 *
 * Não é preciosismo: `NewProviderWizard` grava `legalType` com a natureza
 * jurídica CRUA da Receita ("Sociedade Empresária Limitada") e
 * `businessSegment` com a atividade principal ("Serviços de comunicação
 * multimídia"). Nenhuma das duas está nas listas. Num `<select>` comum esse
 * valor não tem `<option>`, o campo volta sozinho para "Selecione..." sem erro
 * nenhum e o primeiro salvamento apaga o dado que a Receita tinha trazido.
 */
export function opcoesComValorAtual(lista: readonly string[], atual: string): string[] {
  const v = texto(atual).trim();
  if (!v || lista.includes(v)) return [...lista];
  return [v, ...lista];
}

/**
 * Cada campo do cadastro no valor EXATO que iria para a coluna.
 *
 * Vazio vira `null` — é assim que se APAGA um campo, e o schema aceita `null`
 * em tudo que a coluna permite nulo. As duas exceções são `name` e `cnpj`: as
 * colunas são `notNull` e o schema as declarou `.optional()` NÃO-nulas, então
 * `null` ali não limpa nada — devolve 400 e leva o PATCH inteiro. Vazios, os
 * dois viram `undefined`, que aqui significa "não é enviável" (o servidor trata
 * ausência como "não mexi"), e `errosDoCadastro` já barra o salvamento antes.
 *
 * Existe separado de `corpoDoPatch` porque a COMPARAÇÃO tem de acontecer sobre
 * estes valores, e nunca sobre o texto cru dos campos. Ver `corpoDoPatch`.
 */
function valoresGravaveis(
  c: CadastroProvedor,
): Record<string, string | null | undefined> {
  /** Aparar antes de decidir: um campo com só espaços é um campo vazio. */
  const nulo = (v: string) => {
    const t = texto(v).trim();
    return t === "" ? null : t;
  };

  return {
    name: texto(c.name).trim() || undefined,
    tradeName: nulo(c.tradeName),
    cnpj: cnpjCru(c.cnpj) || undefined,
    legalType: nulo(c.legalType),
    openingDate: nulo(c.openingDate),
    businessSegment: nulo(c.businessSegment),
    contactEmail: nulo(c.contactEmail),
    contactPhone: nulo(c.contactPhone),
    website: siteNormalizado(c.website) || null,
    // "" NÃO é NULL numa coluna UNIQUE: o primeiro provedor grava vazio e o
    // segundo estoura em 23505, que o handler traduz para "Erro interno do
    // servidor". Sem subdomínio o valor tem de ser nulo de verdade.
    subdomain: subdominioNormalizado(c.subdomain).replace(/\s+/g, "") || null,
    // CEP e CNPJ crus: `nfse-auto` e as buscas já tiram a máscara antes de usar,
    // e o dígito é o que se compara. Máscara é da tela.
    addressZip: cepCru(c.addressZip) || null,
    addressStreet: nulo(c.addressStreet),
    addressNumber: nulo(c.addressNumber),
    addressComplement: nulo(c.addressComplement),
    addressNeighborhood: nulo(c.addressNeighborhood),
    addressCity: nulo(c.addressCity),
    // UF em caixa alta: é código, e o resto do sistema compara com "MG", não
    // com "mg" (filtro regional, agregações por estado).
    addressState: (nulo(c.addressState) ?? "").toUpperCase() || null,
  };
}

/**
 * O corpo do PATCH: SÓ as chaves cujo valor mudou em relação ao original.
 * `original` é o cadastro como estava quando a edição começou.
 * Objeto vazio significa "nada mudou" — o chamador não deve enviar o PATCH.
 *
 * POR QUE NÃO MANDAR AS 17 SEMPRE. A ficha vem de uma query com `staleTime`
 * infinito: `original` é o retrato do cadastro no instante em que a tela abriu,
 * e ele envelhece enquanto o formulário fica aberto. Mandando tudo, esse retrato
 * vira ordem de gravação e o superadmin DESFAZ, sem ver, o que o provedor
 * acabou de gravar no painel dele — o provedor corrige o endereço às 10h05, o
 * superadmin (com a ficha aberta desde as 10h00) arruma só o telefone e salva
 * às 10h10, e o endereço novo some. Nenhum dos dois recebe aviso nenhum: o
 * PATCH responde 200, porque do ponto de vista do servidor foi uma gravação
 * legítima. Enviando só o que mudou, o telefone é a única coluna tocada.
 *
 * A COMPARAÇÃO É SOBRE O VALOR JÁ NORMALIZADO dos DOIS lados, nunca sobre o
 * texto cru. Se fosse crua, a normalização viraria reescrita silenciosa: o
 * provedor gravou "www.x.com.br" no painel dele, o superadmin não encosta no
 * campo, e mesmo assim o site sairia no corpo só porque a ficha o formata de
 * outro jeito. Vale igual para CEP com máscara, CNPJ com pontuação e UF em
 * minúsculas — em todos, o normalizado dos dois lados dá o mesmo resultado e a
 * chave não é emitida.
 *
 * Nada de `plan`, `ispCredits`, `spcCredits`, `status`, `verificationStatus` ou
 * `motivo`: os dois primeiros grupos têm rota própria e os dois seguintes
 * disparam e-mail ao provedor. Chave a mais aqui também é 400, porque o schema
 * é `.strict()`.
 */
export function corpoDoPatch(
  atual: CadastroProvedor,
  original: CadastroProvedor,
): Record<string, string | null> {
  const novo = valoresGravaveis(atual);
  const velho = valoresGravaveis(original);

  const corpo: Record<string, string | null> = {};
  for (const campo of CAMPOS_DO_CADASTRO) {
    const valor = novo[campo];
    // `name`/`cnpj` em branco: omitidos, nunca `null`. `errosDoCadastro` já
    // trava o salvamento, mas emitir `null` aqui derrubaria o PATCH inteiro.
    if (valor === undefined) continue;
    if (valor === velho[campo]) continue;
    corpo[campo] = valor;
  }
  return corpo;
}

/**
 * O tipo societário do `<select>` a partir da natureza jurídica da Receita.
 *
 * Cópia deliberada da regra que já vive em `pages/provedor/painel-provedor.tsx`
 * — mesma semântica e MESMA ORDEM de comparação. Importar de lá traria o
 * componente inteiro (React, TanStack Query, ~40 imports) para dentro de um
 * módulo puro e do teste dele.
 *
 * Casa por PALAVRA-CHAVE, não por string inteira, porque as três fontes
 * escrevem a mesma natureza de três jeitos ("Sociedade Empresária Limitada",
 * sem acento, e com o código do IBGE na frente, que o servidor já remove).
 *
 * A ORDEM É LOAD-BEARING: "microempresário individual" tem de ser testado antes
 * de "empresário individual", MEI antes de EIRELI e EIRELI antes de LTDA —
 * senão a palavra "limitada" captura as três.
 *
 * Devolve "" quando não reconhece, e não "Outro": chute errado no tipo
 * societário é pior que campo vazio, porque ele sai impresso em nota fiscal.
 */
export function tipoSocietario(natureza: string | null | undefined): string {
  const t = texto(natureza)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // tira acento
    .toLowerCase();
  if (!t) return "";
  if (t.includes("microempresario individual") || t.includes("mei")) return "MEI";
  if (t.includes("empresario individual")) return "MEI";
  if (t.includes("eireli") || t.includes("empresa individual de responsabilidade")) return "EIRELI";
  if (t.includes("sociedade anonima")) return "S/A";
  if (t.includes("limitada")) return "LTDA";
  return "";
}

/**
 * A resposta de `GET /api/admin/cnpj/:cnpj` virando ficha.
 *
 * A regra é a mesma do painel do provedor: o que a Receita traz SUBSTITUI, o
 * que ela não traz PRESERVA. O contrário deixaria de pé o defeito que motivou o
 * botão — a razão social gravada com o nome do sócio em vez do da empresa nunca
 * seria corrigida por ele.
 *
 * NÃO ENCOSTA em `subdomain` (é chave nossa, não cadastro da Receita) nem em
 * `website` (a Receita não devolve site). E NÃO ENCOSTA em `businessSegment`:
 * `atividadePrincipal` vem como descrição de CNAE ("Serviços de comunicação
 * multimídia"), que não é nenhuma das cinco opções de `SEGMENTOS` — escrevê-la
 * num `<select>` fechado é o mesmo defeito silencioso que `tipoSocietario`
 * existe para evitar.
 *
 * `contactEmail` e `contactPhone` seguem a MESMA regra que já vale para
 * `subdomain` e `website` — PRESERVAR-SE-PREENCHIDO: a Receita só entra quando o
 * campo está vazio. Estes dois não são "dado da Receita": lá eles são o contato
 * de quem ABRIU a empresa, quase sempre o escritório de contabilidade. Aqui eles
 * são o CANAL OPERACIONAL do provedor — por eles saem o aviso de sync pausado, o
 * e-mail de cadastro e o WhatsApp do anti-fraude. Substituídos pelos do contador,
 * o provedor simplesmente para de receber alerta, e ninguém descobre pela tela:
 * o envio "dá certo", só chega na caixa errada, e a falha só existe no log.
 */
export function aplicarEmpresaPublica(
  atual: CadastroProvedor,
  dados: Record<string, any>,
): CadastroProvedor {
  const d = dados ?? {};
  const societario = tipoSocietario(d.naturezaJuridica);
  /** Preenche a partir da fonte só quando a ficha não tem nada no campo. */
  const preservando = (jaNaFicha: string, daFonte: unknown) =>
    texto(jaNaFicha).trim() ? jaNaFicha : texto(daFonte);
  return {
    ...atual,
    name: texto(d.razaoSocial) || atual.name,
    tradeName: texto(d.nomeFantasia) || atual.tradeName,
    cnpj: cnpjCru(texto(d.cnpj)) || atual.cnpj,
    legalType: societario || atual.legalType,
    openingDate: texto(d.dataAbertura) || atual.openingDate,
    contactEmail: preservando(atual.contactEmail, d.email),
    contactPhone: preservando(atual.contactPhone, d.telefone),
    addressZip: cepCru(texto(d.cep)) || atual.addressZip,
    addressStreet: texto(d.logradouro) || atual.addressStreet,
    addressNumber: texto(d.numero) || atual.addressNumber,
    addressComplement: texto(d.complemento) || atual.addressComplement,
    addressNeighborhood: texto(d.bairro) || atual.addressNeighborhood,
    addressCity: texto(d.cidade) || atual.addressCity,
    addressState: texto(d.uf).trim().toUpperCase() || atual.addressState,
  };
}

/**
 * A resposta do ViaCEP virando endereço.
 *
 * Número e complemento ficam INTOCADOS: quem digitou o número não quer perdê-lo
 * ao corrigir o CEP, e o `complemento` do ViaCEP não é complemento de endereço
 * — é faixa ("de 1 a 999", "lado ímpar").
 *
 * Rua, bairro e cidade também PRESERVAM quando vêm vazios, e essa é a diferença
 * em relação ao painel do provedor, que grava `data.logradouro || ""`. Em CEP
 * único de município o ViaCEP devolve logradouro e bairro em branco: lá, digitar
 * o CEP da cidade APAGA a rua que o operador acabou de escrever.
 */
export function aplicarViaCep(
  atual: CadastroProvedor,
  dados: Record<string, any>,
): CadastroProvedor {
  const d = dados ?? {};
  // O ViaCEP sinaliza CEP inexistente com `erro` — `true` numa versão, "true"
  // na outra. Nos dois casos não há endereço nenhum na resposta, e sobrescrever
  // com vazio apagaria o que já estava na ficha.
  if (d.erro) return atual;
  return {
    ...atual,
    addressZip: cepCru(texto(d.cep)) || atual.addressZip,
    addressStreet: texto(d.logradouro) || atual.addressStreet,
    addressNeighborhood: texto(d.bairro) || atual.addressNeighborhood,
    addressCity: texto(d.localidade) || atual.addressCity,
    addressState: texto(d.uf).trim().toUpperCase() || atual.addressState,
  };
}

/**
 * Os limites de tamanho do servidor, campo a campo.
 *
 * Estourar um deles devolve "Dados inválidos" com o campo em `fieldErrors` —
 * mas só depois de ir e voltar. Espelhar aqui é o que faz o erro aparecer sob o
 * campo, antes do salvamento.
 */
const LIMITES: Partial<Record<keyof CadastroProvedor, { max: number; frase: string }>> = {
  name:                 { max: 200, frase: "A razão social" },
  tradeName:            { max: 200, frase: "O nome fantasia" },
  legalType:            { max: 50,  frase: "O tipo societário" },
  businessSegment:      { max: 100, frase: "O segmento" },
  contactEmail:         { max: 254, frase: "O e-mail" },
  contactPhone:         { max: 20,  frase: "O telefone" },
  // `z.string().max(500)` no servidor. Sem o limite aqui, um site colado com
  // parâmetros de campanha volta como "Dados inválidos" sem dizer qual campo.
  website:              { max: 500, frase: "O site" },
  subdomain:            { max: 50,  frase: "O subdomínio" },
  addressStreet:        { max: 200, frase: "A rua" },
  addressNumber:        { max: 20,  frase: "O número" },
  addressComplement:    { max: 100, frase: "O complemento" },
  addressNeighborhood:  { max: 100, frase: "O bairro" },
  addressCity:          { max: 100, frase: "A cidade" },
};

/** Data real, e não só data com cara de data: 2026-02-31 não existe. */
function dataIsoValida(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Site aceitável — a MESMA regra do servidor, letra por letra, e nada além dela.
 *
 * O `website` do servidor é texto livre (`z.string().max(500)`) com UMA recusa:
 * esquema que não seja http/https, para que um "javascript:..." nunca vire href.
 * Esta função é a cópia desse `refine`.
 *
 * Aqui havia `new URL()` mais host com ponto, o que era MAIS ESTRITO que o
 * servidor — e o excesso não protegia nada: trancava a ficha inteira. O painel
 * do próprio provedor grava `website` sem validação nenhuma, então a coluna já
 * guarda coisas como "Não temos site". Com a regra antiga, essa frase (escrita
 * pelo dono do provedor, na casa dele) deixava o botão Salvar desabilitado e
 * impedia o superadmin de corrigir o CNPJ — um campo que ninguém pediu para
 * mexer bloqueando os outros dezesseis.
 */
function siteValido(v: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(v) || /^https?:\/\//i.test(v);
}

/**
 * Formato de e-mail — o MESMO julgamento do servidor, não um parecido.
 *
 * O servidor é `z.string().email().max(254)`. A regra caseira que morava aqui
 * (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`) só exigia "um arroba e um ponto depois",
 * e era mais frouxa em casos que aparecem de verdade: "contato@empresa,com.br"
 * (vírgula no lugar do ponto, o erro de digitação mais comum em teclado
 * numérico), "contato@x..com.br", ".contato@x.com.br". Todos passavam na tela e
 * levavam 400 do outro lado, com um "Dados inválidos" que não diz qual dos
 * dezessete campos reprovou. Duas regras para o mesmo campo divergem sempre;
 * usar o zod, que já é dependência do client, deixa uma só.
 */
const ESQUEMA_DE_EMAIL = z.string().email().max(254);
function emailValido(v: string): boolean {
  return ESQUEMA_DE_EMAIL.safeParse(v).success;
}

/**
 * O que impede o salvamento. Chave = campo, valor = a frase em português.
 * Objeto vazio significa "pode salvar".
 *
 * O alvo é espelhar o servidor: mais frouxo aqui é botão que aparece e recusa
 * ao salvar, com um "Dados inválidos" que não diz qual dos dezessete campos foi;
 * mais estrito é ação que ninguém alcança. Onde este módulo é de fato mais
 * estrito, o motivo está escrito ao lado.
 *
 * CNPJ VAZIO É ERRO, e não "apaga o CNPJ". A coluna é `notNull` e o schema do
 * PATCH declarou o campo não-nulo: não existe forma de gravar um provedor sem
 * CNPJ. Um formulário que aceitasse o campo em branco estaria prometendo uma
 * gravação que o servidor recusa — e o CNPJ é a identidade do tenant, é o que a
 * consulta à Receita usa e o que sai na nota.
 */
export function errosDoCadastro(
  c: CadastroProvedor,
  original: CadastroProvedor,
): Partial<Record<keyof CadastroProvedor, string>> {
  const erros: Partial<Record<keyof CadastroProvedor, string>> = {};

  /**
   * SÓ SE JULGA O CAMPO QUE O OPERADOR MEXEU — a mesma simetria de
   * `corpoDoPatch`, e pelo mesmo motivo.
   *
   * O painel do PRÓPRIO provedor grava os 16 campos SEM validação nenhuma
   * (`PATCH /api/provider/profile` copia a lista de campos permitidos direto
   * para o banco, e as colunas são `text` sem limite). Então a coluna já guarda,
   * hoje, valores que este módulo recusa: "financeiro@x.com, suporte@x.com" no
   * e-mail de contato, "27/03/2015" na data de abertura, "Minas Gerais" na UF,
   * "acme_net" no subdomínio.
   *
   * Julgando o cadastro inteiro a cada render, um desses valores TRANCA a ficha:
   * o superadmin abre para corrigir o CEP, o botão Salvar recusa apontando um
   * campo que ele não tocou, e para gravar o CEP ele precisa antes reescrever
   * por cima o e-mail de contato REAL do provedor — que é o dado por onde saem
   * o aviso de cadastro, o de suspensão e o WhatsApp do anti-fraude. E o
   * provedor não vê essa edição acontecer.
   *
   * O servidor já se comporta assim por construção: o campo intocado nem chega
   * até ele, porque `corpoDoPatch` não o envia. Julgar aqui o que lá não é
   * julgado seria ser mais estrito que o servidor — ação que ninguém alcança.
   *
   * O que NÃO muda: assim que o operador encosta no campo, ele é julgado
   * normalmente. A porta é para o valor herdado, não para o valor novo.
   */
  const antes = valoresGravaveis(original);
  const agora = valoresGravaveis(c);
  const intocado = (campo: keyof CadastroProvedor) => agora[campo] === antes[campo];

  for (const campo of Object.keys(LIMITES) as (keyof CadastroProvedor)[]) {
    if (intocado(campo)) continue;
    const limite = LIMITES[campo]!;
    if (texto(c[campo]).trim().length > limite.max) {
      erros[campo] = `${limite.frase} deve ter no máximo ${limite.max} caracteres.`;
    }
  }

  if (!intocado("name") && !texto(c.name).trim()) {
    erros.name = "Informe a razão social do provedor.";
  }

  const cnpj = cnpjCru(c.cnpj);
  if (intocado("cnpj")) {
    // nao se julga o que nao foi mexido
  } else if (!cnpj) {
    erros.cnpj = "Informe o CNPJ do provedor: são 14 dígitos.";
  } else if (cnpj.length !== 14) {
    erros.cnpj = `CNPJ incompleto: são 14 dígitos, e há ${cnpj.length}.`;
  }

  const abertura = texto(c.openingDate).trim();
  if (!intocado("openingDate") && abertura && !dataIsoValida(abertura)) {
    erros.openingDate = "Data de abertura no formato AAAA-MM-DD (ex.: 2015-03-27).";
  }

  // O `!erros.X` guarda a frase mais específica: quem estourou 254 caracteres já
  // recebeu "o e-mail deve ter no máximo...", e trocá-la por "e-mail inválido"
  // esconderia a única informação útil — que o problema é o TAMANHO.
  const email = texto(c.contactEmail).trim();
  if (!intocado("contactEmail") && email && !erros.contactEmail && !emailValido(email)) {
    erros.contactEmail = "E-mail inválido. Use o formato nome@empresa.com.br.";
  }

  const site = siteNormalizado(c.website);
  if (!intocado("website") && site && !erros.website && !siteValido(site)) {
    erros.website = "O site só aceita http:// ou https://. Sem esquema também vale (www.exemplo.com.br).";
  }

  // O subdomínio é julgado já normalizado — é o valor que vai ser gravado.
  // O espaço no meio é recusado em vez de removido: apagar o espaço de
  // "Meu Provedor" grava "meuprovedor" como chave de host sem avisar ninguém.
  const sub = subdominioNormalizado(c.subdomain);
  if (!intocado("subdomain") && sub && !erros.subdomain) {
    if (!/^[a-z0-9-]+$/.test(sub)) {
      erros.subdomain = "Subdomínio: apenas letras minúsculas, números e hífens, sem espaço.";
    } else if (sub.length < 2) {
      // Mesmo mínimo do cadastro (`POST /api/admin/providers`). Aceitar aqui um
      // subdomínio que o cadastro recusa deixaria duas regras para a mesma coluna.
      erros.subdomain = "O subdomínio precisa de pelo menos 2 caracteres.";
    }
  }

  const cep = cepCru(c.addressZip);
  if (!intocado("addressZip") && texto(c.addressZip).trim() && cep.length !== 8) {
    erros.addressZip = "CEP incompleto: são 8 dígitos.";
  }

  const uf = texto(c.addressState).trim();
  if (!intocado("addressState") && uf && !/^[A-Za-z]{2}$/.test(uf)) {
    erros.addressState = "UF com 2 letras (ex.: MG).";
  }

  return erros;
}
