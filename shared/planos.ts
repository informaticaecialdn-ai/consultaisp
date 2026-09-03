/**
 * TABELA DE PRECO DA PLATAFORMA — FONTE UNICA.
 *
 * Estas constantes viviam em `shared/schema.ts`, misturadas com as tabelas do
 * Drizzle, e o client as importava direto. O resultado media-se em tela: preco
 * de plano hardcoded em `painel-provedor.tsx`, creditos de plano copiados em
 * `invoice-view.tsx`, `admin-financeiro.tsx` e `FinanceiroTab.tsx`, e pacote de
 * credito com id que o servidor nao conhecia mais em `admin-creditos.tsx` — a
 * compra respondia "Pacote invalido" porque a copia do client tinha envelhecido.
 *
 * `shared/schema.ts` re-exporta tudo o que esta aqui, entao quem ja importava de
 * la continua funcionando. Codigo novo importa daqui.
 *
 * REGRA DE QUEM LE O QUE:
 * - O que pode variar por MARCA (preco de pacote e de plano) o client NUNCA
 *   importa: pede a `GET /api/credits/packages` ou `GET /api/public/precos`,
 *   que resolvem a marca no servidor. Ha um teste-guarda que falha se um
 *   arquivo de `client/src` voltar a importar essas tabelas de `@shared/*`.
 * - O que NAO varia por marca (`CUSTO_EM_CREDITOS` — quantos creditos a
 *   consulta consome) segue como constante compartilhada, importavel pelo
 *   client. A marca revende o credito mais caro; ela nao muda quantos creditos
 *   uma consulta gasta.
 */

/**
 * CREDITO UNICO, VALIDO PARA TODA CONSULTA DO SISTEMA.
 *
 * Antes existiam tres bolsos separados — isp_credits, spc_credits e
 * bigdata_credits — cada um com o proprio pacote e a propria tabela de preco.
 * Na pratica isso produzia o defeito que o provedor via na tela: saldo de 187
 * creditos e a Consulta Cadastral respondendo "saldo insuficiente, voce tem 0",
 * porque ela debitava de um bolso que ninguem nunca comprou.
 *
 * Agora ha um saldo so. O que varia e QUANTOS creditos cada consulta consome,
 * nao de onde ela tira. O saldo vive em `providers.isp_credits`, que virou o
 * campo universal — as outras duas colunas foram zeradas e somadas nela pela
 * migration 0008; ficam no schema porque `credit_orders` e `provider_invoices`
 * as referenciam em registros historicos.
 */
export const CREDIT_PACKAGES = [
  { id: "credits-50",  name: "50 créditos",  credits: 50,  price: 5000,  priceLabel: "R$ 50,00",  perUnit: "R$ 1,00/crédito" },
  { id: "credits-100", name: "100 créditos", credits: 100, price: 10000, priceLabel: "R$ 100,00", perUnit: "R$ 1,00/crédito", popular: true },
  { id: "credits-250", name: "250 créditos", credits: 250, price: 25000, priceLabel: "R$ 250,00", perUnit: "R$ 1,00/crédito" },
  { id: "credits-500", name: "500 créditos", credits: 500, price: 50000, priceLabel: "R$ 500,00", perUnit: "R$ 1,00/crédito" },
];

/**
 * Quanto cada consulta consome do saldo. Credito vale R$ 1,00, entao o numero
 * aqui e o preco em reais.
 *
 * SEM DESCONTO POR VOLUME, de proposito: o pacote maior nao barateia a consulta,
 * so evita recarga. Preco de consulta que muda conforme o tamanho da compra e
 * dificil de explicar no suporte e impossivel de conferir numa fatura.
 *
 * - `isp` (R$ 1,00): consulta a rede colaborativa. Custo nosso e proximo de
 *   zero — e banco proprio, sem bureau externo.
 * - `cadastral` (R$ 1,00): BigDataCorp. Custa R$ 0,72 de 14 datasets (preco
 *   DA CONTA, medido em POST /precos em 02/09/2026). Margem de R$ 0,28, 28%,
 *   apertada de proposito — decisao do dono em 02/09/2026: "um nivel so,
 *   cobrando 1 credito; quando tiver volume aumentamos". Ao mexer no combo em
 *   server/services/bigdata.service.ts, refaca essa conta: cada dataset e
 *   cobrado a parte, e PRECO_DA_CONTA la e a fonte.
 * - `spc` (R$ 3,00): SPC Brasil. Continua o mais caro dos tres porque o bureau
 *   cobra mais e a consulta e negativacao formal. Baixado de 4 para 3 por
 *   decisao do dono em 31/08/2026.
 *
 * ESTE E O UNICO LUGAR ONDE ESSES NUMEROS EXISTEM. Nao repita nenhum deles em
 * texto de tela: a landing anunciava "4 creditos" em quatro arquivos diferentes,
 * e cada mudanca de preco exigia lembrar dos quatro. Importe a constante.
 */
export const CUSTO_EM_CREDITOS = {
  isp: 1,
  cadastral: 1,
  spc: 3,
} as const;

export type TipoConsultaCobravel = keyof typeof CUSTO_EM_CREDITOS;

/**
 * O que a fatura mensal cobra (server/routes/financeiro.routes.ts) e o que a
 * landing exibe. Sao a MESMA fonte de proposito: preco de vitrine que diverge
 * do preco cobrado e a forma mais rapida de perder um cliente.
 *
 * SAO DOIS, e sao os da landing. Decisao do dono em 03/09/2026: o catalogo
 * inteiro do sistema passa a ser Gratuito e Profissional.
 *
 * `basic` e `enterprise` foram removidos daqui. Estavam documentados como
 * "legado, fora da vitrine", mas continuavam aparecendo em todo seletor do
 * admin, no formulario de fatura e no cadastro de provedor — na pratica ainda
 * eram vendaveis. A migracao 0014 moveu para `pro` os dois provedores que
 * estavam em `enterprise` (nao havia ninguem em `basic`, e nenhuma fatura
 * tinha sido emitida ate ali).
 *
 * Quem le dado ANTIGO (plan_changes, plan_at_time de fatura) usa
 * `ROTULO_DO_PLANO` em precos.service.ts, que ainda sabe nomear os dois — o
 * historico registra o que existia na epoca, nao o catalogo de hoje.
 */
export const PLAN_PRICES: Record<string, number> = {
  free: 0,
  pro: 99,
};

/**
 * Creditos inclusos no plano, por mes.
 *
 * O `free` sao os creditos de boas-vindas, concedidos uma vez no cadastro
 * (o default da coluna `providers.isp_credits` faz isso).
 *
 * O `pro` sao 30 por mes, e sao CONCEDIDOS DE VERDADE quando a fatura do mes e
 * paga — ver `creditarPlanoDaFatura`. Decisao do dono em 03/09/2026, junto com
 * a reducao para dois planos. A conta que sustenta o numero: o credito e
 * vendido avulso a R$ 1,00 e custa ate R$ 0,72 na origem, entao 30 creditos
 * consomem no maximo R$ 21,60 de um plano de R$ 99. Cem creditos, por
 * exemplo, entregariam R$ 100 de consulta num plano de R$ 99 e o avulso
 * deixaria de fazer sentido.
 *
 * Ate esta versao NADA era creditado automaticamente: o numero aqui era so o
 * que a fatura ESCREVIA, e quem somava ao saldo era o superadmin, na mao.
 */
export const PLAN_CREDITS: Record<string, { isp: number; spc: number }> = {
  free: { isp: 50, spc: 0 },
  pro: { isp: 30, spc: 0 },
};

/**
 * Teto do preco que uma marca revendedora pode cobrar por credito: R$ 5,00.
 *
 * O piso nao mora aqui porque nao e um numero fixo — e a propria tabela da
 * plataforma (`CREDIT_PACKAGES`), ou seja, a marca so pode SUBIR o preco. O
 * motivo e aritmetico: a plataforma fica com preco x (1 - comissao); a R$ 0,80
 * com 20% de comissao sobram R$ 0,64 para uma consulta cadastral que custa
 * R$ 0,72 na BigDataCorp — prejuizo por venda.
 *
 * Decisao do dono em 02/09/2026.
 */
export const TETO_CREDITO_CENTAVOS = 500;

export type ValidacaoDePreco =
  | { ok: true }
  | { ok: false; motivo: string };

/**
 * O preco por credito que a marca quer cobrar e aceitavel?
 *
 * REJEITA, NUNCA CORRIGE. Clampar em silencio faria o revendedor digitar
 * R$ 0,50, ver a tela salvar sem erro e descobrir depois — na fatura do cliente
 * dele — que o sistema gravou outro numero. Erro de preco tem que voltar como
 * erro.
 *
 * Ambos os valores sao o preco de UM credito, em centavos.
 */
export function validarPrecoDaMarca(
  precoCentavos: number,
  precoPlataformaCentavos: number,
): ValidacaoDePreco {
  if (!Number.isInteger(precoCentavos)) {
    return { ok: false, motivo: "O preço deve ser um valor inteiro em centavos." };
  }
  if (precoCentavos <= 0) {
    return { ok: false, motivo: "O preço deve ser maior que zero." };
  }
  if (!Number.isInteger(precoPlataformaCentavos) || precoPlataformaCentavos <= 0) {
    // Piso invalido nao vira "sem piso": sem piso confiavel nao ha o que validar.
    return { ok: false, motivo: "Preço da plataforma indisponível para comparação." };
  }
  if (precoCentavos < precoPlataformaCentavos) {
    return {
      ok: false,
      motivo: `O preço não pode ficar abaixo de ${formatarReais(precoPlataformaCentavos)} por crédito, que é a tabela da plataforma.`,
    };
  }
  if (precoCentavos > TETO_CREDITO_CENTAVOS) {
    return {
      ok: false,
      motivo: `O preço não pode passar de ${formatarReais(TETO_CREDITO_CENTAVOS)} por crédito.`,
    };
  }
  return { ok: true };
}

/** "R$ 1.234,56" a partir de centavos. Espaco comum, nao o do Intl. */
export function formatarReais(centavos: number): string {
  const negativo = centavos < 0;
  const [inteiro, decimal] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${comMilhar},${decimal}`;
}
