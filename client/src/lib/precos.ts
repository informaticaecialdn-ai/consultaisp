import { formatarReais } from "@shared/planos";

/**
 * A FORMA DA TABELA DE PRECO NO CLIENT, E AS DERIVACOES QUE AS TELAS FAZEM.
 *
 * Modulo puro de proposito: as telas erravam justamente na borda — tabela que
 * ainda nao chegou, ou que nunca vai chegar porque a query falhou. `usePrecos`
 * roda com `retry` curto e `refetchOnWindowFocus: false`, entao um unico 500 no
 * mount deixa `precos` `undefined` ate o proximo recarregamento da pagina.
 *
 * Cada telinha resolvia isso com `?? 0`, e `?? 0` em preco nao e "ainda nao
 * sei": e "de graca". Foi assim que o formulario de fatura passou a gravar
 * R$ 0,00 para provedor pagante e o pedido manual passou a criar um pedido
 * "Personalizado" de 100 creditos sem ninguem pedir.
 *
 * A regra deste arquivo: ausencia de preco devolve `null`, nunca zero. Quem
 * chama e obrigado a decidir o que fazer com o `null` — desabilitar o botao,
 * manter o campo intocado, mostrar o erro.
 */

export interface PacoteDeCredito {
  id: string;
  nome: string;
  creditos: number;
  precoCentavos: number;
  precoReais: number;
  precoLabel: string;
  precoUnitarioCentavos: number;
  precoUnitarioLabel: string;
  popular: boolean;
}

export interface PrecoDePlano {
  chave: string;
  rotulo: string;
  precoCentavos: number;
  precoReais: number;
  precoLabel: string;
  creditosInclusos: { isp: number; spc: number };
  naVitrine: boolean;
  /**
   * O plano gera fatura mensal? Se nao gera, `creditosInclusos` NAO e uma
   * promessa recorrente — e so o texto que uma fatura escreveria se existisse.
   * Ver o comentario de PLAN_CREDITS em shared/planos.ts.
   */
  recorrente: boolean;
}

export interface TabelaDePrecos {
  origem: "plataforma" | "marca";
  marcaId: number | null;
  pacotes: PacoteDeCredito[];
  planos: PrecoDePlano[];
  custoEmCreditos: Record<string, number>;
}

/**
 * "R$ 99" quando o valor e redondo, "R$ 99,90" quando nao e.
 *
 * So para vitrine. Em fatura e extrato o centavo aparece sempre — usar
 * `precoLabel`.
 */
export function precoCurto(preco: { precoCentavos: number; precoLabel: string }): string {
  if (preco.precoCentavos % 100 !== 0) return preco.precoLabel;
  return `R$ ${(preco.precoCentavos / 100).toLocaleString("pt-BR")}`;
}

/** Acha um plano pela chave (`free`, `pro`…) sem espalhar `.find` por cinco telas. */
export function planoPorChave(
  tabela: TabelaDePrecos | undefined,
  chave: string | null | undefined,
): PrecoDePlano | undefined {
  if (!tabela || !chave) return undefined;
  return tabela.planos.find((p) => p.chave === chave);
}

export interface CamposDaFatura {
  planAtTime: string;
  amount: string;
  ispCreditsIncluded: string;
  spcCreditsIncluded: string;
}

/**
 * O que o formulario de fatura passa a valer quando o plano cobrado muda.
 *
 * `null` quando nao ha resposta para dar — tabela ausente, ou plano que nao
 * existe nela. Antes isto devolvia `amount: "0"` nos dois casos, e o
 * superadmin emitia uma fatura de R$ 0,00 para um provedor pagante sem que
 * nada na tela avisasse.
 */
export function camposDaFatura(
  tabela: TabelaDePrecos | undefined,
  chave: string | null | undefined,
): CamposDaFatura | null {
  const plano = planoPorChave(tabela, chave);
  if (!plano) return null;
  return {
    planAtTime: plano.chave,
    amount: plano.precoReais.toString(),
    ispCreditsIncluded: plano.creditosInclusos.isp.toString(),
    spcCreditsIncluded: plano.creditosInclusos.spc.toString(),
  };
}

/**
 * O pedido manual de credito pode ser enviado?
 *
 * O `packageId` do formulario e derivado da tabela: sem tabela ele fica vazio,
 * e vazio e falsy no servidor, que entao cai no ramo "Personalizado" e grava o
 * pedido com os defaults do formulario — 100 creditos por R$ 100,00 que
 * ninguem escolheu. O botao so pode existir com um pacote resolvido de fato.
 */
export function pedidoDeCreditoPronto(args: {
  providerId: string;
  packageId: string;
  pacoteEscolhido: PacoteDeCredito | undefined;
}): boolean {
  if (!args.providerId) return false;
  if (!args.packageId) return false;
  if (args.packageId === "custom") return true;
  return Boolean(args.pacoteEscolhido);
}

/**
 * O preco de UM credito, quando ele e o mesmo em todos os pacotes.
 *
 * `null` quando a tabela nao chegou ou quando os pacotes divergem entre si —
 * nesse caso nao existe "o preco do credito" para anunciar, e a tela tem que
 * calar em vez de escolher um dos numeros. O cabecalho de /creditos afirmava
 * "Um credito custa R$ 1,00" em texto cravado, logo acima de cards que ja
 * vinham do servidor: bastava a tabela mudar para a mesma tela dizer dois
 * precos diferentes.
 */
export function precoDoCreditoUnico(tabela: TabelaDePrecos | undefined): string | null {
  const pacotes = tabela?.pacotes ?? [];
  if (pacotes.length === 0) return null;
  const unitario = pacotes[0].precoUnitarioCentavos;
  if (!Number.isFinite(unitario) || unitario <= 0) return null;
  if (pacotes.some((p) => p.precoUnitarioCentavos !== unitario)) return null;
  return formatarReais(unitario);
}

/** A frase de abertura de /creditos, com o preco so quando ele e conhecido. */
export function fraseDoCredito(tabela: TabelaDePrecos | undefined): string {
  const preco = precoDoCreditoUnico(tabela);
  const abertura = preco
    ? `Um crédito custa ${preco} e vale para qualquer consulta do sistema.`
    : "Um crédito vale para qualquer consulta do sistema.";
  return `${abertura} O que muda é quantos créditos cada uma consome.`;
}

/**
 * A linha de creditos no card de plano.
 *
 * `creditosInclusos` so vira promessa mensal para plano que gera fatura. No
 * `free` nada no sistema soma credito todo mes — os 50 vem uma vez, do default
 * da coluna no cadastro — e `generate-monthly` pula quem tem preco zero. O card
 * anunciava "50 creditos inclusos por mes" para uma recorrencia que nunca
 * acontece.
 */
export function linhaDeCreditosDoPlano(plano: PrecoDePlano): string {
  if (plano.recorrente && plano.creditosInclusos.isp > 0) {
    return `${plano.creditosInclusos.isp} creditos inclusos por mes`;
  }
  return "Consultas na rede pagas por credito";
}
