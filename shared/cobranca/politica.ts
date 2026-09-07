/**
 * A POLÍTICA DE COBRANÇA DO PROVEDOR — uma linha por provedor em
 * `cobranca_politica`, e as regras de negociação que ela impõe.
 *
 * Porte do `CollectionPolicySchema` e das validações de `routes/negociacao.ts`
 * do Provedor.ai, reduzidos ao que a fase 1 usa: régua, negociação, encargos,
 * janela de contato e a pausa. Zonas de agente, propensão e Asaas ficaram lá.
 *
 * Os TETOS LEGAIS são clamp, não recusa: o admin que digita multa de 10% vê o
 * valor voltar a 2% com o aviso do porquê. Recusar o formulário inteiro por um
 * campo faria o provedor abandonar a tela; ajustar em silêncio esconderia a
 * lei. `validarPolitica` devolve os dois: a política ajustada e os ajustes.
 *
 * Percentuais são PONTOS PERCENTUAIS em toda a política: 2 = 2%, 20 = 20%.
 * O Provedor.ai mistura fração (0.2) e ponto (2); aqui é um jeito só.
 *
 * Módulo puro: sem banco, sem React, sem I/O.
 */
import { z } from "zod";
import { ETAPAS_PADRAO, EtapasConfigSchema, type Etapa, resolverEtapas } from "./regua";
import { ACORDO_PADRAO, AcordoSchema, clampAcordo, type Acordo } from "./acordo";
import type { TipoDeNegociacao } from "./estados";

/* ── Tetos legais ─────────────────────────────────────────────────────── */

export const TETOS_LEGAIS = {
  /** CDC art. 52 §1º: multa de mora de no máximo 2%. */
  multaPct: 2,
  /** CC art. 406 c/c Decreto 22.626: juros de mora de até 1% ao mês. */
  jurosMesPct: 1,
  /** Teto operacional do Provedor.ai (HARD_LIMITS.NEGOTIATION_CEIL). */
  maxParcelas: 48,
  /** CDC art. 42 / Lei 14.181: dias úteis 8h–20h, sábado até 14h, nunca domingo ou feriado. */
  janelaContato: { horaInicio: 8, horaFim: 20, sabadoHoraFim: 14 },
} as const;

/* ── Schema ───────────────────────────────────────────────────────────── */

export const NegociacaoConfigSchema = z.object({
  maxParcelas: z.number().int().min(1).max(240),
  /** % do valor negociado que precisa entrar à vista. */
  entradaMinimaPct: z.number().min(0).max(100),
  /** % máximo de desconto sobre o valor original da dívida. */
  descontoMaxPct: z.number().min(0).max(100),
  /** Abaixo disto não se parcela: cobra-se à vista. */
  saldoMinimoParcelar: z.number().min(0),
});
export type NegociacaoConfig = z.infer<typeof NegociacaoConfigSchema>;

export const EncargosSchema = z.object({
  multaPct: z.number().min(0).max(100),
  jurosMesPct: z.number().min(0).max(100),
});
export type Encargos = z.infer<typeof EncargosSchema>;

const hora = z.number().int().min(0).max(23);

export const JanelaContatoSchema = z.object({
  horaInicio: hora,
  horaFim: hora,
  sabado: z.boolean(),
  sabadoHoraFim: hora,
  domingo: z.boolean(),
  feriado: z.boolean(),
});
export type JanelaContato = z.infer<typeof JanelaContatoSchema>;

/* ── Economia do cliente (R24) ────────────────────────────────────────── */

/**
 * Os custos POR PROVEDOR que alimentam a "Economia do cliente" da ficha 360
 * (decisão do dono, 05/09/2026): o que o Provedor.ai lê de `computeEconomiaLedger`.
 * Dinheiro em reais por cliente; OPEX por mês; imposto em pontos percentuais.
 *
 * `confirmado` é o que separa dado de chute: enquanto o admin não passar pela
 * tela "Confirmar custos", a Economia sai com o selo "≈ parâmetros padrão" —
 * exatamente como o Provedor.ai faz. Um número zerado não é um custo zero, é
 * um custo que ninguém informou.
 */
export const LIMITES_DA_ECONOMIA = {
  impostoReceitaPct: { min: 0, max: 100 },
  /** Um mês a dez anos: fora disso é dedo no lugar errado, não decisão. */
  cicloMeses: { min: 1, max: 120 },
} as const;

const custo = z.number().finite().min(0);

export const EconomiaSchema = z.object({
  /** Custo de aquisição do cliente (comercial + instalação comercial). */
  cac: custo,
  /** Instalação: cabo, mão de obra, drop. */
  capexInstalacao: custo,
  /** O que o equipamento em comodato ainda vale ao voltar. */
  equipamentoResidual: custo,
  opexLink: custo,
  opexRedePop: custo,
  opexSuporte: custo,
  opexManutencaoNoc: custo,
  /** Sobre a receita, em pontos percentuais. Clamp em 0..100, não recusa. */
  impostoReceitaPct: z.number().finite(),
  /** Ciclo de vida esperado, em meses. Clamp em 1..120. */
  cicloMeses: z.number().int(),
  confirmado: z.boolean(),
  /**
   * Mensalidade por NOME de plano, como o ERP o escreve ("Fibra 300"). É o
   * ARPU da Economia do cliente: o Provedor.ai o lê de `clientes.valor_mensal`,
   * que o sync daqui não traz. Plano sem preço cadastrado = Economia PENDENTE,
   * nunca um chute. Nome casado sem caixa, acento nem espaço duplo.
   */
  precoPorPlano: z.record(z.string().trim().min(1).max(120), z.number().finite().min(0)).default({}),
});
export type Economia = z.infer<typeof EconomiaSchema>;

/**
 * O provedor chegou a informar os custos dele?
 *
 * `POLITICA_PADRAO.economia` nasce com TUDO zerado, e zero não é um custo
 * plausível — é o campo em branco. A diferença importa porque as fórmulas
 * aceitam zero de bom grado e produzem um resultado bonito e falso: com OPEX
 * zero a margem de contribuição é 100% do ARPU, com investimento zero o
 * payback é 0 mês, e o 360 anunciaria que todo assinante se paga no dia da
 * instalação. Preferimos "—" com o motivo.
 *
 * `equipamentoResidual` e `cicloMeses` ficam FORA da conta de propósito:
 * residual zero é uma resposta legítima (equipamento que não volta valendo
 * nada) e o ciclo já nasce com 36 meses, que é um padrão declarado e não um
 * campo em branco.
 */
export function custosInformados(e: Economia | null | undefined): boolean {
  if (!e) return false;
  return e.cac > 0 || e.capexInstalacao > 0 || e.opexLink > 0 || e.opexRedePop > 0
    || e.opexSuporte > 0 || e.opexManutencaoNoc > 0 || e.impostoReceitaPct > 0;
}

export const POLITICA_PADRAO = {
  /** Vazio = catálogo padrão inteiro (`ETAPAS_PADRAO`); aqui vão só as mudanças do provedor. */
  etapas: [] as z.infer<typeof EtapasConfigSchema>,
  // Os mesmos padrões do Provedor.ai (buildDefaultPolicy), em pontos percentuais.
  negociacao: { maxParcelas: 6, entradaMinimaPct: 20, descontoMaxPct: 20, saldoMinimoParcelar: 150 },
  encargos: { multaPct: TETOS_LEGAIS.multaPct, jurosMesPct: TETOS_LEGAIS.jurosMesPct },
  janelaContato: {
    horaInicio: TETOS_LEGAIS.janelaContato.horaInicio,
    horaFim: TETOS_LEGAIS.janelaContato.horaFim,
    sabado: true,
    sabadoHoraFim: TETOS_LEGAIS.janelaContato.sabadoHoraFim,
    domingo: false,
    feriado: false,
  },
  // Custos zerados e não confirmados: a Economia mostra "≈ parâmetros padrão"
  // até o admin confirmar. 36 meses é o ciclo padrão do Provedor.ai.
  economia: {
    cac: 0,
    capexInstalacao: 0,
    equipamentoResidual: 0,
    opexLink: 0,
    opexRedePop: 0,
    opexSuporte: 0,
    opexManutencaoNoc: 0,
    impostoReceitaPct: 0,
    cicloMeses: 36,
    confirmado: false,
    precoPorPlano: {},
  } satisfies Economia,
  // A política de ACORDO nasce com a origem da cobrança NÃO DEFINIDA (decisão
  // do dono, 06/09/2026): sem ela nenhuma oferta com desconto é gerada.
  acordo: ACORDO_PADRAO satisfies Acordo,
  pausada: false,
  pausadaMotivo: null as string | null,
};

export const PoliticaSchema = z.object({
  etapas: EtapasConfigSchema.default([]),
  negociacao: NegociacaoConfigSchema.default(POLITICA_PADRAO.negociacao),
  encargos: EncargosSchema.default(POLITICA_PADRAO.encargos),
  janelaContato: JanelaContatoSchema.default(POLITICA_PADRAO.janelaContato),
  economia: EconomiaSchema.default(POLITICA_PADRAO.economia),
  acordo: AcordoSchema.default(() => structuredClone(ACORDO_PADRAO)),
  pausada: z.boolean().default(false),
  pausadaMotivo: z.string().trim().max(300).nullable().default(null),
});
export type Politica = z.infer<typeof PoliticaSchema>;
export type PoliticaEntrada = z.input<typeof PoliticaSchema>;

/* ── Clamp e validação ────────────────────────────────────────────────── */

export interface PoliticaAjustada {
  politica: Politica;
  /** Frases para o admin: o que foi puxado ao teto e por quê. Vazio = nada mexido. */
  ajustes: string[];
}

export function clampPolitica(politica: Politica): PoliticaAjustada {
  const ajustes: string[] = [];
  const p: Politica = structuredClone(politica);

  if (p.encargos.multaPct > TETOS_LEGAIS.multaPct) {
    ajustes.push(`Multa de ${pct(p.encargos.multaPct)} reduzida a ${pct(TETOS_LEGAIS.multaPct)}: teto do CDC art. 52 §1º.`);
    p.encargos.multaPct = TETOS_LEGAIS.multaPct;
  }
  if (p.encargos.jurosMesPct > TETOS_LEGAIS.jurosMesPct) {
    ajustes.push(`Juros de ${pct(p.encargos.jurosMesPct)} ao mês reduzidos a ${pct(TETOS_LEGAIS.jurosMesPct)}: teto do CC art. 406.`);
    p.encargos.jurosMesPct = TETOS_LEGAIS.jurosMesPct;
  }
  if (p.negociacao.maxParcelas > TETOS_LEGAIS.maxParcelas) {
    ajustes.push(`Máximo de parcelas reduzido de ${p.negociacao.maxParcelas} a ${TETOS_LEGAIS.maxParcelas}.`);
    p.negociacao.maxParcelas = TETOS_LEGAIS.maxParcelas;
  }

  const legal = TETOS_LEGAIS.janelaContato;
  if (p.janelaContato.horaInicio < legal.horaInicio) {
    ajustes.push(`Contato a partir das ${p.janelaContato.horaInicio}h adiado para ${legal.horaInicio}h: CDC art. 42.`);
    p.janelaContato.horaInicio = legal.horaInicio;
  }
  if (p.janelaContato.horaFim > legal.horaFim) {
    ajustes.push(`Contato até ${p.janelaContato.horaFim}h encerrado às ${legal.horaFim}h: CDC art. 42.`);
    p.janelaContato.horaFim = legal.horaFim;
  }
  if (p.janelaContato.sabado && p.janelaContato.sabadoHoraFim > legal.sabadoHoraFim) {
    ajustes.push(`Sábado até ${p.janelaContato.sabadoHoraFim}h encerrado às ${legal.sabadoHoraFim}h: CDC art. 42.`);
    p.janelaContato.sabadoHoraFim = legal.sabadoHoraFim;
  }
  if (p.janelaContato.domingo) {
    ajustes.push("Contato no domingo desligado: proibido pelo CDC art. 42.");
    p.janelaContato.domingo = false;
  }
  if (p.janelaContato.feriado) {
    ajustes.push("Contato em feriado desligado: proibido pelo CDC art. 42.");
    p.janelaContato.feriado = false;
  }

  // Economia: limites operacionais, não legais — mas o mesmo tratamento:
  // ajusta e avisa, em vez de devolver o formulário inteiro.
  const eco = LIMITES_DA_ECONOMIA;
  if (p.economia.impostoReceitaPct < eco.impostoReceitaPct.min) {
    ajustes.push(`Imposto sobre receita de ${pct(p.economia.impostoReceitaPct)} ajustado a ${pct(eco.impostoReceitaPct.min)}: não pode ser negativo.`);
    p.economia.impostoReceitaPct = eco.impostoReceitaPct.min;
  }
  if (p.economia.impostoReceitaPct > eco.impostoReceitaPct.max) {
    ajustes.push(`Imposto sobre receita de ${pct(p.economia.impostoReceitaPct)} reduzido a ${pct(eco.impostoReceitaPct.max)}: não há imposto acima da receita.`);
    p.economia.impostoReceitaPct = eco.impostoReceitaPct.max;
  }
  if (p.economia.cicloMeses < eco.cicloMeses.min) {
    ajustes.push(`Ciclo de ${p.economia.cicloMeses} meses ajustado a ${eco.cicloMeses.min}: é o mínimo.`);
    p.economia.cicloMeses = eco.cicloMeses.min;
  }
  if (p.economia.cicloMeses > eco.cicloMeses.max) {
    ajustes.push(`Ciclo de ${p.economia.cicloMeses} meses reduzido a ${eco.cicloMeses.max} (dez anos).`);
    p.economia.cicloMeses = eco.cicloMeses.max;
  }
  // A política de acordo vive DENTRO do envelope geral, e o envelope já foi
  // puxado aos tetos legais acima — por isso o clamp do acordo vem por último:
  // uma faixa de 12x contra um `maxParcelas` que acabou de cair a 6 tem de
  // cair a 6 também, e não ao número que o admin digitou.
  const acordo = clampAcordo(p.acordo, p.negociacao);
  p.acordo = acordo.acordo;
  ajustes.push(...acordo.ajustes);

  // A régua tem o próprio piso (Anatel) e é ajustada em resolverEtapas, que
  // toda leitura chama. Aqui só se garante que o JSON gravado é o que passou.
  return { politica: p, ajustes };
}

export type ResultadoDaPolitica = ({ ok: true } & PoliticaAjustada) | { ok: false; erros: string[] };

/** O que a rota chama no PUT: JSON cru entra, política válida e ajustada sai — ou a lista de erros em português. */
export function validarPolitica(entrada: unknown): ResultadoDaPolitica {
  const parsed = PoliticaSchema.safeParse(entrada, { errorMap: mensagensEmPortugues });
  if (!parsed.success) {
    return { ok: false, erros: parsed.error.issues.map(i => `${i.path.join(".") || "política"}: ${i.message}`) };
  }
  return { ok: true, ...clampPolitica(parsed.data) };
}

/** As etapas completas que valem para o provedor, já com os pisos aplicados. */
export function etapasDaPolitica(politica: Pick<Politica, "etapas"> | null | undefined): Etapa[] {
  return politica ? resolverEtapas(politica) : [...ETAPAS_PADRAO];
}

const mensagensEmPortugues: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "obrigatório" : `esperava ${issue.expected}, veio ${issue.received}` };
    case z.ZodIssueCode.too_small:
      return { message: issue.type === "string" ? "não pode ficar vazio" : `mínimo ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      return { message: `máximo ${issue.maximum}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `valor inválido; aceitos: ${issue.options.join(", ")}` };
    default:
      return { message: ctx.defaultError };
  }
};

/* ── Negociação ───────────────────────────────────────────────────────── */

export interface PedidoDeNegociacao {
  tipo: TipoDeNegociacao;
  /** A dívida no momento (valor_atual do caso). Sem ele não há como medir desconto. */
  valorOriginal: number;
  /** O total que o cliente vai pagar, entrada inclusa. */
  valorNegociado: number;
  /** Só parcelamento. Não é parcela: é paga na aceitação. */
  entrada?: number;
  /** Só parcelamento. */
  parcelas?: number;
}

export interface ContextoDaNegociacao {
  /**
   * Mensalidade do cliente, quando o provedor a tem. Com ela a política
   * distingue "uma fatura atrasada" de "dívida acumulada" e só parcela a
   * segunda. Sem ela (fase 1: `customers` não guarda o plano) o gate é
   * pulado — o saldo mínimo é a única trava. Bloquear todo parcelamento por
   * falta de um dado seria o oposto do que o dono pediu.
   */
  valorMensalidade?: number | null;
  /** Lei 14.181: o vulnerável sempre tem acesso ao plano de pagamento. */
  vulneravel?: boolean;
}

export type ResultadoDaNegociacao = { ok: true } | { ok: false; violacoes: string[] };

export const STATUS_DE_PARCELAMENTO = ["ativo", "inadimplente_recente", "acumulado_multi_mes"] as const;
export type StatusDeParcelamento = (typeof STATUS_DE_PARCELAMENTO)[number];

/**
 * Razão dívida/mensalidade → perfil de parcelamento (ADR 0020 do Provedor.ai).
 * Menos de meia mensalidade é "ativo" (resíduo); de meia a duas é atraso
 * recente; duas ou mais é acumulado. Mensalidade zero cai em recente — sem
 * dado, o caminho conservador.
 */
export function derivarStatusParcelamento(dividaTotal: number, valorMensal: number): StatusDeParcelamento {
  if (dividaTotal <= 0) return "ativo";
  if (valorMensal <= 0) return "inadimplente_recente";
  const meses = dividaTotal / valorMensal;
  if (meses >= 2) return "acumulado_multi_mes";
  if (meses >= 0.5) return "inadimplente_recente";
  return "ativo";
}

/**
 * Quem pode parcelar por perfil — o padrão conservador do Provedor.ai
 * (decisão do dono, 24/06): uma ou duas faturas é à vista; a partir de duas
 * mensalidades acumuladas pode parcelar. Não é configurável na fase 1: o
 * JSONB `negociacao` autorizado não tem esse campo.
 */
export const PARCELAMENTO_POR_STATUS: Record<StatusDeParcelamento, boolean> = {
  ativo: false,
  inadimplente_recente: false,
  acumulado_multi_mes: true,
};

export function validarNegociacao(
  politica: Pick<Politica, "negociacao">,
  pedido: PedidoDeNegociacao,
  contexto: ContextoDaNegociacao = {},
): ResultadoDaNegociacao {
  const regras = politica.negociacao;
  const violacoes: string[] = [];

  if (!(pedido.valorOriginal > 0)) violacoes.push("Não há dívida a negociar: o valor original precisa ser maior que zero.");
  if (!(pedido.valorNegociado > 0)) violacoes.push("O valor negociado precisa ser maior que zero.");
  if (violacoes.length > 0) return { ok: false, violacoes };

  const descontoPct = ((pedido.valorOriginal - pedido.valorNegociado) / pedido.valorOriginal) * 100;
  if (descontoPct > regras.descontoMaxPct + 1e-9) {
    violacoes.push(`Desconto de ${pct(descontoPct)} excede o teto de ${pct(regras.descontoMaxPct)} da política.`);
  }

  if (pedido.tipo !== "parcelamento") {
    if (pedido.parcelas !== undefined && pedido.parcelas > 1) {
      violacoes.push("Quitação é à vista: para dividir o valor, use parcelamento.");
    }
    return violacoes.length > 0 ? { ok: false, violacoes } : { ok: true };
  }

  const parcelas = pedido.parcelas;
  if (parcelas === undefined || !Number.isInteger(parcelas) || parcelas < 1) {
    violacoes.push("Informe o número de parcelas (no mínimo 1).");
  } else if (parcelas > regras.maxParcelas) {
    violacoes.push(`Máximo de ${regras.maxParcelas} parcelas pela política; pedido: ${parcelas}.`);
  }

  const entrada = pedido.entrada ?? 0;
  if (entrada < 0) violacoes.push("A entrada não pode ser negativa.");
  if (entrada > pedido.valorNegociado) violacoes.push("A entrada não pode ser maior que o valor negociado.");

  // O vulnerável sempre tem acesso ao plano de pagamento (Lei 14.181): as
  // travas de entrada, saldo mínimo e perfil não valem para ele. O teto de
  // parcelas continua — é o limite do que o provedor consegue administrar.
  if (!contexto.vulneravel) {
    const entradaMinima = arredondar((pedido.valorNegociado * regras.entradaMinimaPct) / 100);
    if (entrada + 0.005 < entradaMinima) {
      violacoes.push(
        `Entrada mínima de ${brl(entradaMinima)} (${pct(regras.entradaMinimaPct)} do negociado); informada: ${brl(entrada)}.`,
      );
    }
    const saldo = arredondar(pedido.valorNegociado - entrada);
    if (saldo < regras.saldoMinimoParcelar) {
      violacoes.push(`Saldo de ${brl(saldo)} abaixo do mínimo de ${brl(regras.saldoMinimoParcelar)} para parcelar: cobrar à vista.`);
    }
    const mensalidade = contexto.valorMensalidade;
    if (typeof mensalidade === "number" && mensalidade > 0) {
      const status = derivarStatusParcelamento(pedido.valorOriginal, mensalidade);
      if (!PARCELAMENTO_POR_STATUS[status]) {
        violacoes.push(
          "Dívida de menos de duas mensalidades: a política pede pagamento à vista (parcelamento a partir de duas mensalidades acumuladas).",
        );
      }
    }
  }

  return violacoes.length > 0 ? { ok: false, violacoes } : { ok: true };
}

/* ── Parcelas ─────────────────────────────────────────────────────────── */

export interface ParcelaGerada {
  numero: number;
  valor: number;
  /** "AAAA-MM-DD", para a coluna DATE. */
  vencimento: string;
}

/**
 * Divide o saldo (valor negociado menos a entrada) em `parcelas` iguais, com
 * a conta feita em CENTAVOS para o total fechar exato: a última parcela
 * absorve a sobra. R$ 100,00 em 3 é 33,33 + 33,33 + 33,34, nunca 99,99.
 * Vencimentos mensais no mesmo dia; quando o mês não tem o dia (31 → fev),
 * cai no último dia do mês.
 */
export function gerarParcelas(
  valorNegociado: number,
  parcelas: number,
  entrada: number,
  primeiroVencimento: string,
): ParcelaGerada[] {
  if (!Number.isInteger(parcelas) || parcelas < 1) throw new RangeError("Parcelas precisa ser um inteiro a partir de 1.");
  const saldoCentavos = Math.round((valorNegociado - entrada) * 100);
  if (saldoCentavos < 0) throw new RangeError("A entrada não pode ser maior que o valor negociado.");
  const base = Math.floor(saldoCentavos / parcelas);
  const ultima = saldoCentavos - base * (parcelas - 1);
  const [ano, mes, dia] = lerIso(primeiroVencimento);

  return Array.from({ length: parcelas }, (_, i) => ({
    numero: i + 1,
    valor: (i === parcelas - 1 ? ultima : base) / 100,
    vencimento: somarMeses(ano, mes, dia, i),
  }));
}

/* ── Encargos ─────────────────────────────────────────────────────────── */

export interface ValorAtualizado {
  principal: number;
  multa: number;
  juros: number;
  total: number;
}

/** Multa uma vez, juros pro rata die (mês de 30 dias). Sem atraso, nada é somado. */
export function valorAtualizado(principal: number, diasAtraso: number, encargos: Encargos): ValorAtualizado {
  if (diasAtraso <= 0 || principal <= 0) return { principal, multa: 0, juros: 0, total: principal };
  const multa = arredondar((principal * encargos.multaPct) / 100);
  const juros = arredondar(((principal * encargos.jurosMesPct) / 100) * (diasAtraso / 30));
  return { principal, multa, juros, total: arredondar(principal + multa + juros) };
}

/* ── Utilidades ───────────────────────────────────────────────────────── */

export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** "R$ 1.234,56" — formatação própria para o teste não depender do ICU nem do espaço fino do Intl. */
export function brl(valor: number): string {
  const negativo = valor < 0;
  const [inteiro, decimais] = Math.abs(valor).toFixed(2).split(".");
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${comPontos},${decimais}`;
}

/** "20%" ou "12,5%": sem casas quando é inteiro. */
export function pct(valor: number): string {
  const v = Math.round(valor * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}%`;
}

function lerIso(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Data inválida: "${iso}" (esperado AAAA-MM-DD).`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function somarMeses(ano: number, mes: number, dia: number, meses: number): string {
  const totalMeses = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  // Dia 0 do mês seguinte, em UTC, é o último dia deste — sem passar pelo fuso.
  const ultimoDia = new Date(Date.UTC(novoAno, novoMes, 0)).getUTCDate();
  const novoDia = Math.min(dia, ultimoDia);
  return `${novoAno}-${String(novoMes).padStart(2, "0")}-${String(novoDia).padStart(2, "0")}`;
}
