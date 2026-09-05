/**
 * DNA 3×3 DA COBRANÇA — decide COMO falar com o cliente. Nunca QUANDO.
 *
 * Porte de `packages/scoring/src/dna/classify.ts` do Provedor.ai (mesmo dono),
 * com uma diferença de leitor: lá a diretiva entrava no prompt de um agente de
 * IA; aqui quem lê é o FUNCIONÁRIO do provedor antes de ligar. O texto é
 * instrução para uma pessoa, não para um modelo.
 *
 * Fidelidade (tempo de casa) × confiabilidade (histórico de pagamento) → um de
 * nove quadrantes, e cada quadrante tem uma abordagem. O quando (a etapa da
 * régua) mora em `regua.ts`; os dois se cruzam só na tela e no caso.
 *
 * LIMITAÇÃO DA FASE 1, medida em produção (05/09/2026): o sync do ERP grava
 * agregados em `customers` — não há fatura paga nem fatura paga com atraso.
 * A taxa de atraso histórica, que no Provedor.ai separa "oscila" de "em dia",
 * NÃO existe aqui: `historicoInsuficiente` é sempre true, e a confiabilidade
 * sai só do atraso atual e das faturas em aberto. Isso é o que o original faz
 * quando o ERP só expõe faturas abertas — a regra já previa esse caso.
 *
 * Módulo puro: sem banco, sem React, sem I/O. Servidor e cliente importam daqui.
 */

export const FIDELIDADES = ["novo", "medio", "fiel"] as const;
export type Fidelidade = (typeof FIDELIDADES)[number];

export const CONFIABILIDADES = ["em_dia", "oscila", "cronico"] as const;
export type Confiabilidade = (typeof CONFIABILIDADES)[number];

/** Linha = confiabilidade (A em dia · B oscila · C crônico); coluna = fidelidade (1 novo · 2 médio · 3 fiel). */
export const QUADRANTES = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"] as const;
export type Quadrante = (typeof QUADRANTES)[number];

export const ABORDAGENS = [
  "boas_vindas",
  "parceiro",
  "acolhedor",
  "orientador",
  "firme_gentil",
  "cuidado",
  "firme_objetivo",
  "recuperacao",
  "negociar_reter",
] as const;
export type Abordagem = (typeof ABORDAGENS)[number];

/** O tom do vulnerável (Lei 14.181) não é um quadrante: sobrepõe qualquer um. */
export const TOM_VULNERAVEL = "humanizado_vulneravel" as const;
export type Tom = Abordagem | typeof TOM_VULNERAVEL;
export const TONS = [...ABORDAGENS, TOM_VULNERAVEL] as const;

/* ── Limiares — os mesmos do Provedor.ai, nomeados para virarem config por provedor um dia ── */

/** Até 11 meses é novo; 12 a 36 é médio; acima de 36 é fiel. */
export const FIDELIDADE_NOVO_MAX_MESES = 11;
export const FIDELIDADE_MEDIO_MAX_MESES = 36;

/** Crônico: 3 ou mais faturas em aberto, OU atraso acima de 90 dias, OU (com histórico) taxa de atraso acima de 40%. */
export const CRONICO_FATURAS_ABERTAS_MIN = 3;
export const CRONICO_DIAS_ATRASO_ACIMA_DE = 90;
export const CRONICO_TAXA_ATRASO_ACIMA_DE = 0.4;

/** Em dia: atraso de até 30 dias E (sem histórico OU taxa de atraso de até 10%). */
export const EM_DIA_DIAS_ATRASO_MAX = 30;
export const EM_DIA_TAXA_ATRASO_MAX = 0.1;

export interface EntradaDna {
  /** Meses completos de contrato. Sem a data do contrato NÃO há DNA — ver `mesesDeContrato`. */
  mesesComoCliente: number;
  /** `customers.max_days_overdue`. */
  diasAtrasoMax: number;
  /** `customers.overdue_invoices_count`. */
  faturasAbertas: number;
  /**
   * Fase 1: SEMPRE true. O sync não traz fatura paga, então a taxa de atraso
   * histórica não pode ser calculada e é tratada como zero — exatamente como o
   * original faz para ERP que só expõe faturas abertas. Na fase 2, quem tiver
   * `faturasPagas > 0` passa false e preenche os dois campos abaixo.
   */
  historicoInsuficiente: boolean;
  faturasPagas?: number;
  faturasPagasComAtraso?: number;
}

export interface Dna {
  fidelidade: Fidelidade;
  confiabilidade: Confiabilidade;
  quadrante: Quadrante;
  abordagem: Abordagem;
  /** Ecoa a entrada: a tela avisa que a confiabilidade veio só do atraso atual. */
  historicoInsuficiente: boolean;
}

export function classificarFidelidade(mesesComoCliente: number): Fidelidade {
  if (mesesComoCliente <= FIDELIDADE_NOVO_MAX_MESES) return "novo";
  if (mesesComoCliente <= FIDELIDADE_MEDIO_MAX_MESES) return "medio";
  return "fiel";
}

export function classificarConfiabilidade(entrada: EntradaDna): Confiabilidade {
  // Sem histórico a taxa é zero: não se pune quem ainda não teve chance de pagar
  // com atraso, e não se absolve cegamente — o atraso atual ainda decide.
  const insuficiente = entrada.historicoInsuficiente || !entrada.faturasPagas;
  const taxa = insuficiente
    ? 0
    : (entrada.faturasPagasComAtraso ?? 0) / Math.max(entrada.faturasPagas ?? 0, 1);

  // Crônico pela dívida ATUAL basta, mesmo sem histórico: muitas abertas ou
  // atraso extremo já dizem tudo.
  if (
    entrada.faturasAbertas >= CRONICO_FATURAS_ABERTAS_MIN ||
    entrada.diasAtrasoMax > CRONICO_DIAS_ATRASO_ACIMA_DE ||
    (!insuficiente && taxa > CRONICO_TAXA_ATRASO_ACIMA_DE)
  ) {
    return "cronico";
  }
  if (entrada.diasAtrasoMax <= EM_DIA_DIAS_ATRASO_MAX && (insuficiente || taxa <= EM_DIA_TAXA_ATRASO_MAX)) {
    return "em_dia";
  }
  return "oscila";
}

const QUADRANTE_POR_EIXOS: Record<Confiabilidade, Record<Fidelidade, Quadrante>> = {
  em_dia: { novo: "A1", medio: "A2", fiel: "A3" },
  oscila: { novo: "B1", medio: "B2", fiel: "B3" },
  cronico: { novo: "C1", medio: "C2", fiel: "C3" },
};

export function quadranteDe(fidelidade: Fidelidade, confiabilidade: Confiabilidade): Quadrante {
  return QUADRANTE_POR_EIXOS[confiabilidade][fidelidade];
}

/** O inverso de `quadranteDe`: a tela do 3×3 lê a linha e a coluna do código. */
export function eixosDoQuadrante(quadrante: Quadrante): { fidelidade: Fidelidade; confiabilidade: Confiabilidade } {
  const confiabilidade: Confiabilidade = quadrante[0] === "A" ? "em_dia" : quadrante[0] === "B" ? "oscila" : "cronico";
  const fidelidade: Fidelidade = quadrante[1] === "1" ? "novo" : quadrante[1] === "2" ? "medio" : "fiel";
  return { fidelidade, confiabilidade };
}

export const ABORDAGEM_POR_QUADRANTE: Record<Quadrante, Abordagem> = {
  A1: "boas_vindas",
  A2: "parceiro",
  A3: "acolhedor",
  B1: "orientador",
  B2: "firme_gentil",
  B3: "cuidado",
  C1: "firme_objetivo",
  C2: "recuperacao",
  C3: "negociar_reter",
};

export function classificarDna(entrada: EntradaDna): Dna {
  const fidelidade = classificarFidelidade(entrada.mesesComoCliente);
  const confiabilidade = classificarConfiabilidade(entrada);
  const quadrante = quadranteDe(fidelidade, confiabilidade);
  return {
    fidelidade,
    confiabilidade,
    quadrante,
    abordagem: ABORDAGEM_POR_QUADRANTE[quadrante],
    historicoInsuficiente: entrada.historicoInsuficiente || !entrada.faturasPagas,
  };
}

/**
 * Meses COMPLETOS entre o início do contrato e hoje. `null` quando não há data:
 * o chamador guarda `quadrante_dna` nulo e a tela mostra "—". Chutar "novo"
 * para quem não tem data mandaria o funcionário ligar com o tom errado para um
 * cliente de dez anos — e a regra da casa é só dado real.
 *
 * Aceita "AAAA-MM-DD" (como o Drizzle devolve uma coluna DATE) ou Date. A
 * string é lida sem passar por `new Date()`, que a trataria como UTC e faria
 * o dia 1 virar dia 30 do mês anterior em qualquer fuso brasileiro.
 */
export function mesesDeContrato(inicio: Date | string | null | undefined, hoje: Date): number | null {
  const partes = lerData(inicio);
  if (!partes) return null;
  const [ano, mes, dia] = partes;
  let meses = (hoje.getFullYear() - ano) * 12 + (hoje.getMonth() + 1 - mes);
  if (hoje.getDate() < dia) meses -= 1;
  return meses < 0 ? 0 : meses;
}

function lerData(valor: Date | string | null | undefined): [number, number, number] | null {
  if (!valor) return null;
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : [valor.getFullYear(), valor.getMonth() + 1, valor.getDate()];
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return null;
  const partes: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (partes[1] < 1 || partes[1] > 12 || partes[2] < 1 || partes[2] > 31) return null;
  return partes;
}

/**
 * Vulnerável (Lei 14.181) SEMPRE sobrepõe o quadrante: não há tom firme para
 * quem a lei manda proteger. Sem DNA (sem data de contrato) e sem
 * vulnerabilidade não há tom a sugerir — `null`, e o funcionário decide.
 */
export function tomEfetivo(dna: Pick<Dna, "abordagem"> | null, vulneravel: boolean): Tom | null {
  if (vulneravel) return TOM_VULNERAVEL;
  return dna?.abordagem ?? null;
}

/* ── Textos — escritos para o funcionário que vai ligar, não para um prompt ── */

export const DIRETIVA_POR_ABORDAGEM: Record<Abordagem, string> = {
  boas_vindas:
    "Cliente novo e em dia. Apresente-se, agradeça a escolha e explique como funciona o pagamento e o suporte. Não é cobrança: é orientação.",
  parceiro:
    "Cliente regular e pontual. Fale de igual para igual, com respeito. Ofereça a conveniência (PIX, segunda via) antes de qualquer cobrança.",
  acolhedor:
    "Cliente fiel e confiável. Agradeça o tempo de casa e trate como parceiro de longa data. Se houver pendência, presuma esquecimento, nunca má-fé.",
  orientador:
    "Cliente novo que já oscilou. Explique com calma o que acontece se o atraso continuar (encargos, suspensão) sem pressionar, e mostre o caminho mais fácil para pagar.",
  firme_gentil:
    "Cliente regular com histórico misto. Seja firme sobre o que está em aberto e empático com a pessoa: mostre o impacto e ofereça uma saída concreta.",
  cuidado:
    "Bom cliente num momento ruim. Pergunte o que aconteceu antes de cobrar; ofereça ajuda (prazo, parcela) e não pressione. Manter este cliente vale mais que a fatura.",
  firme_objetivo:
    "Cliente novo e crônico. Direto e objetivo: valor, prazo e meio de pagamento. Prefira à vista; se parcelar, poucas parcelas e entrada.",
  recuperacao:
    "Histórico problemático recorrente. Profissional e assertivo: apresente as opções e busque a decisão na mesma conversa. Sem acordo, avance de etapa sem demora.",
  negociar_reter:
    "Cliente fiel em risco de sair. Negocie primeiro: desconto ou parcelamento antes de falar em suspensão ou negativação. O objetivo é manter o cliente.",
};

export const DIRETIVA_VULNERAVEL =
  "Cliente vulnerável (Lei 14.181). Tom de cuidado, sem pressão e sem ameaça de suspensão ou negativação. Ofereça o plano mais protetivo que a política permitir e respeite o mínimo existencial.";

export const DIRETIVA_POR_TOM: Record<Tom, string> = {
  ...DIRETIVA_POR_ABORDAGEM,
  [TOM_VULNERAVEL]: DIRETIVA_VULNERAVEL,
};

export const ROTULO_FIDELIDADE: Record<Fidelidade, string> = { novo: "Novo", medio: "Médio", fiel: "Fiel" };
export const ROTULO_CONFIABILIDADE: Record<Confiabilidade, string> = {
  em_dia: "Em dia",
  oscila: "Oscila",
  cronico: "Crônico",
};

export const ROTULO_TOM: Record<Tom, string> = {
  boas_vindas: "Boas-vindas",
  parceiro: "Parceiro",
  acolhedor: "Acolhedor",
  orientador: "Orientador",
  firme_gentil: "Firme-gentil",
  cuidado: "Cuidado · sem pressão",
  firme_objetivo: "Firme e objetivo",
  recuperacao: "Recuperação",
  negociar_reter: "Negociar + reter",
  humanizado_vulneravel: "Humanizado · vulnerável",
};

/** A frase que o funcionário pode usar para abrir a conversa — copy do DNA 3×3 do Provedor.ai. */
export const FRASE_EXEMPLO_POR_QUADRANTE: Record<Quadrante, string> = {
  A1: "Que bom ter você com a gente! Sua fatura vence em 3 dias — qualquer coisa, é só chamar.",
  A2: "Oi! Passando só pra lembrar do vencimento — e obrigado por estar sempre em dia.",
  A3: "Você é cliente de longa data e sempre em dia — qualquer ajuste no plano, fala comigo.",
  B1: "Vi que a fatura ficou em aberto — quer que eu te mande o PIX pra resolver rapidinho?",
  B2: "Sua fatura está em aberto. Posso gerar um PIX agora ou a 2ª via — o que prefere?",
  B3: "Vi que sua fatura ficou em aberto — posso ajudar a resolver do jeito mais fácil pra você?",
  C1: "Sua fatura está vencida. Consigo condição à vista hoje — quer que eu envie?",
  C2: "Precisamos resolver sua pendência. Tenho opções — vamos escolher uma juntos hoje?",
  C3: "Você é cliente de longa data. Quero manter você conosco — vamos achar um acordo que caiba?",
};

export const FRASE_EXEMPLO_VULNERAVEL =
  "Sei que o momento está difícil. Vamos ver juntos um jeito que caiba no seu orçamento, sem pressa.";

/** As três linhas da grade, na ordem da tela: em dia em cima, crônico embaixo; colunas novo → fiel. */
export const GRADE_DNA: readonly { confiabilidade: Confiabilidade; quadrantes: readonly Quadrante[] }[] = [
  { confiabilidade: "em_dia", quadrantes: ["A1", "A2", "A3"] },
  { confiabilidade: "oscila", quadrantes: ["B1", "B2", "B3"] },
  { confiabilidade: "cronico", quadrantes: ["C1", "C2", "C3"] },
];

/** Família semântica do DESIGN_SYSTEM para pintar o quadrante: A → ok, B → gated, C → past. */
export type FamiliaDoQuadrante = "ok" | "gated" | "past";

export function familiaDoQuadrante(quadrante: Quadrante): FamiliaDoQuadrante {
  if (quadrante[0] === "A") return "ok";
  if (quadrante[0] === "B") return "gated";
  return "past";
}
