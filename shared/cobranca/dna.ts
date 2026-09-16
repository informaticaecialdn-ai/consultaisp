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
 * O histórico usa somente faturas explicitamente pagas COM data de pagamento.
 * Sem essa evidência, `historicoInsuficiente` permanece true e a classificação
 * usa apenas o atraso atual. Desaparecer dos pendentes do ERP nunca mede
 * pontualidade: baixa sem recibo continua desconhecida.
 *
 * Módulo puro: sem banco, sem React, sem I/O. Servidor e cliente importam daqui.
 */
import type { Carteira } from "./estados";

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
  "ex_esclarecedor",
  "ex_respeitoso",
  "ex_acolhedor",
  "ex_orientador",
  "ex_firme_gentil",
  "ex_cuidado",
  "ex_objetivo",
  "ex_assertivo",
  "ex_conciliador",
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
   * true quando não há pagamentos com data confirmada. A ausência não vira
   * taxa observada zero; só desabilita o critério histórico da classificação.
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

/** Mesmos eixos históricos, com voz própria para a recuperação de contrato encerrado. */
export const ABORDAGEM_EX_CLIENTE_POR_QUADRANTE: Record<Quadrante, Abordagem> = {
  A1: "ex_esclarecedor", A2: "ex_respeitoso", A3: "ex_acolhedor",
  B1: "ex_orientador", B2: "ex_firme_gentil", B3: "ex_cuidado",
  C1: "ex_objetivo", C2: "ex_assertivo", C3: "ex_conciliador",
};

export function abordagemDoQuadrante(quadrante: Quadrante, carteira: Carteira = "ativo"): Abordagem {
  return (carteira === "ex_cliente" ? ABORDAGEM_EX_CLIENTE_POR_QUADRANTE : ABORDAGEM_POR_QUADRANTE)[quadrante];
}

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
 * Ex-cliente: meses e pagamentos precisam pertencer à relação encerrada.
 * O chamador recorta os pagamentos confirmados até o encerramento. A idade
 * atual da dívida orienta a régua, nunca reescreve esse histórico de relação.
 * Sem histórico suficiente, não há quadrante a inferir do saldo em aberto.
 */
export function classificarDnaDaCarteira(entrada: EntradaDna, carteira: Carteira): Dna | null {
  if (carteira === "ativo") return classificarDna(entrada);
  const { faturasPagas, faturasPagasComAtraso, mesesComoCliente } = entrada;
  if (
    entrada.historicoInsuficiente || !Number.isFinite(mesesComoCliente) || mesesComoCliente < 0 ||
    faturasPagas === undefined || !Number.isInteger(faturasPagas) || faturasPagas <= 0 ||
    faturasPagasComAtraso === undefined || !Number.isInteger(faturasPagasComAtraso) ||
    faturasPagasComAtraso < 0 || faturasPagasComAtraso > faturasPagas
  ) return null;
  const dna = classificarDna({ ...entrada, diasAtrasoMax: 0, faturasAbertas: 0 });
  return { ...dna, abordagem: abordagemDoQuadrante(dna.quadrante, carteira) };
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

/** Ex-cliente não acumula tempo de casa depois que o contrato terminou. */
export function mesesDaRelacao(
  inicio: Date | string | null | undefined,
  hoje: Date,
  carteira: Carteira,
  encerramento?: Date | string | null,
): number | null {
  if (carteira === "ativo") return mesesDeContrato(inicio, hoje);
  const inicioPartes = lerData(inicio);
  const fimPartes = lerData(encerramento);
  if (!inicioPartes || !fimPartes || Number.isNaN(hoje.getTime())) return null;
  const inicioData = new Date(inicioPartes[0], inicioPartes[1] - 1, inicioPartes[2]);
  const fimData = new Date(fimPartes[0], fimPartes[1] - 1, fimPartes[2]);
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (inicioData > fimData || fimData > hojeSemHora) return null;
  return mesesDeContrato(inicio, fimData);
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
  const conferida = new Date(partes[0], partes[1] - 1, partes[2]);
  if (conferida.getFullYear() !== partes[0] || conferida.getMonth() + 1 !== partes[1] || conferida.getDate() !== partes[2]) return null;
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
    "Relação recente. Apresente-se e use linguagem simples e acolhedora, sem presumir familiaridade com o atendimento. Comunique apenas a ação indicada pela régua.",
  parceiro:
    "Cliente com relação estabelecida. Fale de igual para igual, com respeito e clareza, sem confundir o histórico de pagamento com a situação da fatura atual.",
  acolhedor:
    "Relação longa. Reconheça o tempo de casa e use uma linguagem próxima e acolhedora. Escute a pessoa sem presumir a causa da pendência nem atribuir má-fé.",
  orientador:
    "Relação recente com oscilação de pagamento. Explique com calma, em frases simples, e confira se a pessoa entendeu. Mantenha o conteúdo definido pela régua, sem pressão.",
  firme_gentil:
    "Relação estabelecida com histórico misto. Seja claro sobre os fatos confirmados e empático com a pessoa. Use linguagem firme e gentil, sem julgamento.",
  cuidado:
    "Relação longa com oscilação de pagamento. Use um tom cuidadoso e dê espaço à pessoa para explicar a situação, sem pressionar nem presumir dificuldade financeira.",
  firme_objetivo:
    "Relação recente com atraso relevante. Use frases diretas e objetivas, mantenha os fatos verificáveis e evite julgamentos sobre a pessoa. As condições vêm da política.",
  recuperacao:
    "Relação estabelecida com atraso relevante. Use linguagem profissional e assertiva, sem constrangimento ou urgência artificial. A régua define a ação e o próximo contato.",
  negociar_reter:
    "Relação longa com atraso relevante. Use um tom conciliador que reconheça o vínculo, sem prometer benefícios ou condições. A política e a régua definem a negociação.",
  ex_esclarecedor:
    "Relação encerrada de curta duração e histórico pontual. Use um tom esclarecedor, apresente os fatos com simplicidade e escute dúvidas sem presumir a causa da pendência.",
  ex_respeitoso:
    "Relação encerrada de duração intermediária e histórico pontual. Use um tom respeitoso e direto, reconhecendo o histórico sem tratar a dívida atual como quitada.",
  ex_acolhedor:
    "Relação encerrada de longa duração e histórico pontual. Reconheça a relação anterior com discrição e acolhimento. Evite familiaridade excessiva ou julgamentos.",
  ex_orientador:
    "Relação encerrada de curta duração e histórico oscilante. Use explicações simples e pacientes, confirme a compreensão e mantenha o foco nos fatos da pendência.",
  ex_firme_gentil:
    "Relação encerrada de duração intermediária e histórico oscilante. Seja firme e gentil, diferencie fatos de suposições e dê espaço para esclarecer divergências.",
  ex_cuidado:
    "Relação encerrada de longa duração e histórico oscilante. Use um tom cuidadoso e escute a pessoa, sem pressão e sem inferir sua situação financeira atual.",
  ex_objetivo:
    "Relação encerrada de curta duração e atrasos recorrentes no histórico. Use frases objetivas e neutras, evitando rótulos pessoais, acusações ou urgência artificial.",
  ex_assertivo:
    "Relação encerrada de duração intermediária e atrasos recorrentes no histórico. Use linguagem profissional e assertiva, sem constrangimento, sempre apoiada em fatos confirmados.",
  ex_conciliador:
    "Relação encerrada de longa duração e atrasos recorrentes no histórico. Reconheça o vínculo anterior com um tom conciliador, sem prometer condições ou pressionar por decisão.",
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
  ex_esclarecedor: "Esclarecedor",
  ex_respeitoso: "Respeitoso",
  ex_acolhedor: "Acolhedor · relação anterior",
  ex_orientador: "Orientador · pendência",
  ex_firme_gentil: "Firme e gentil",
  ex_cuidado: "Cuidado · relação anterior",
  ex_objetivo: "Objetivo",
  ex_assertivo: "Assertivo",
  ex_conciliador: "Conciliador",
};

/** A frase que o funcionário pode usar para abrir a conversa — copy do DNA 3×3 do Provedor.ai. */
export const FRASE_EXEMPLO_POR_QUADRANTE: Record<Quadrante, string> = {
  A1: "Olá, sou do atendimento do provedor. Vou explicar o motivo deste contato e esclarecer suas dúvidas.",
  A2: "Olá, vamos conversar sobre a situação da sua fatura? Estou à disposição para esclarecer.",
  A3: "Agradecemos seu tempo conosco. Vamos conversar sobre a sua fatura e ouvir suas dúvidas.",
  B1: "Olá, vou explicar a situação da fatura com calma. Pode me dizer se ficar alguma dúvida.",
  B2: "Vamos conferir a situação da sua fatura. Quero ouvir suas dúvidas antes de seguirmos.",
  B3: "Olá, quero ouvir você e entender suas dúvidas sobre a fatura. Podemos conversar com calma.",
  C1: "Olá, o contato é sobre a sua fatura. Vou apresentar os dados confirmados de forma objetiva.",
  C2: "Vamos conferir os dados da sua pendência. Estou à disposição para esclarecer divergências.",
  C3: "Reconhecemos seu tempo conosco. Vamos conversar sobre a pendência e ouvir o que você tem a dizer.",
};

export const FRASE_EXEMPLO_EX_CLIENTE_POR_QUADRANTE: Record<Quadrante, string> = {
  A1: "Olá, o contato é sobre uma pendência do contrato encerrado. Vou explicar os dados e ouvir suas dúvidas.",
  A2: "Olá, podemos conversar sobre a pendência do contrato encerrado? Estou à disposição para esclarecer os dados.",
  A3: "Agradecemos a relação que tivemos. O contato é sobre uma pendência do contrato encerrado; vamos conferir juntos.",
  B1: "Vou explicar com calma os dados da pendência do contrato encerrado. Pode me dizer se houver alguma dúvida.",
  B2: "O contato é sobre a pendência do contrato encerrado. Vamos conferir os dados e esclarecer eventuais divergências.",
  B3: "Podemos conversar com calma sobre a pendência do contrato encerrado. Quero ouvir suas dúvidas.",
  C1: "O contato é sobre a pendência do contrato encerrado. Vou apresentar os dados confirmados de forma objetiva.",
  C2: "Vamos conferir os dados da pendência do contrato encerrado. Estou à disposição para esclarecer o que for necessário.",
  C3: "Reconhecemos a relação que tivemos. Vamos conversar sobre a pendência do contrato encerrado e ouvir suas dúvidas.",
};

export const ROTULO_RELACAO_ENCERRADA: Record<Fidelidade, string> = { novo: "Curta", medio: "Intermediária", fiel: "Longa" };
export const ROTULO_HISTORICO_ENCERRADO: Record<Confiabilidade, string> = {
  em_dia: "Pontual no histórico", oscila: "Oscilante no histórico", cronico: "Atrasos recorrentes",
};

/** Uma fonte para grade, 360 e agentes; rótulos e exemplos seguem a carteira. */
export function apresentacaoDoDna(quadrante: Quadrante, carteira: Carteira = "ativo") {
  const eixos = eixosDoQuadrante(quadrante);
  const abordagem = abordagemDoQuadrante(quadrante, carteira);
  const exCliente = carteira === "ex_cliente";
  return {
    ...eixos, abordagem, rotulo: ROTULO_TOM[abordagem], diretiva: DIRETIVA_POR_TOM[abordagem],
    frase: (exCliente ? FRASE_EXEMPLO_EX_CLIENTE_POR_QUADRANTE : FRASE_EXEMPLO_POR_QUADRANTE)[quadrante],
    rotuloFidelidade: (exCliente ? ROTULO_RELACAO_ENCERRADA : ROTULO_FIDELIDADE)[eixos.fidelidade],
    rotuloConfiabilidade: (exCliente ? ROTULO_HISTORICO_ENCERRADO : ROTULO_CONFIABILIDADE)[eixos.confiabilidade],
  };
}

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
