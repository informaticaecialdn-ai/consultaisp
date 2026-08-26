/**
 * Veredito da consulta cadastral — regra escrita, nao modelo.
 *
 * Negar servico a alguem exige explicacao. A LGPD Art. 20 da ao titular o
 * direito de rever decisao automatizada, e o operador no balcao precisa
 * conseguir dizer POR QUE. Por isso todo veredito diferente de APROVAR carrega
 * `motivos` em portugues, e a regra mora aqui, num arquivo que se le em um
 * minuto — nao dentro de um score opaco.
 *
 * Hierarquia: RECUSAR vence ATENCAO, mas os motivos de ambos sao listados. O
 * operador ve o quadro inteiro, nao so a razao vencedora.
 */

export type Veredito = "APROVAR" | "ATENCAO" | "RECUSAR" | "NAO_ENCONTRADO";

export interface EnderecoCadastral {
  ratificado: boolean;
  ativo: boolean;
  ultimaPassagem?: string | null;
}

export interface DadosCadastrais {
  /** false quando a BigData nao achou o CPF (basic_data devolve -1200 nesse caso). */
  encontrado: boolean;
  taxIdStatus?: string;
  temObito?: boolean;
  nascimentoValidadoNaReceita?: boolean;
  homonimos?: number;
  enderecos?: EnderecoCadastral[];
  badAddressPassages?: number;
  /** Faixa da BigData, ex "3 A 5 SM". "SEM INFORMACAO" quando nao ha dado. */
  faixaRenda?: string;

  // ── Sinais de inadimplencia ────────────────────────────────────────────────
  /** Esta em cobranca neste momento. O sinal mais direto que existe. */
  emCobrancaAgora?: boolean;
  cobrancas365d?: number;
  /** Credores distintos que cobraram — dois credores pesa mais que duas cobrancas do mesmo. */
  credoresDistintos365d?: number;
  /** Processos em que a pessoa e RE. Como autor nao diz nada sobre pagar. */
  processosComoReu?: number;
  processos365d?: number;
  /** Execucao de titulo, execucao fiscal: alguem ja foi a juizo cobrar. */
  temExecucao?: boolean;
  /** Divida ativa da Uniao/FGTS (PGFN), em reais. */
  dividaAtiva?: number;
  /** Intensidade de busca por credito: A e altissima, H e nenhuma. */
  buscaCredito?: string;
  /** Trocas de nome no CPF ao longo da vida. */
  mudancasNome?: number;
  /** Vezes que o CPF foi consultado no mercado nos ultimos 30 dias. */
  consultas30d?: number;

  // ── Bureau de mercado (marketplace) ────────────────────────────────────────
  // Ficam undefined enquanto o provedor nao habilita os datasets no BDC Center.
  // undefined nunca gera motivo: ausencia de dado nao e sinal de risco.
  /** Indicio de negativacao no mercado, fora da rede de provedores. */
  negativadoNoMercado?: boolean;
  /** Score 0-999 de probabilidade de inadimplencia. Maior e melhor. */
  scoreMercado?: number;
  /** Soma devida no mercado, em reais. */
  dividaMercado?: number;
  /** Negativacoes ativas. Quitadas nao contam: sao historico, nao pendencia. */
  negativacoesAtivas?: number;
  /** Protestos em cartorio — mais grave que negativacao simples. */
  protestos?: number;
  /** Consultas de credito feitas por credores em 30 dias. */
  consultasCredito30d?: number;

  // ── Estabilidade de renda ──────────────────────────────────────────────────
  /** Trocas de vinculo de trabalho nos ultimos 5 anos. */
  trocasEmprego5Anos?: number;
  /** Media de anos entre trocas de vinculo. Abaixo de 1 e rotatividade alta. */
  mediaAnosPorVinculo?: number;
}

export interface OpcoesVeredito {
  /** Mensalidade do plano oferecido. Sem ela, renda nao e avaliada. */
  valorPlano?: number;
}

export interface ResultadoVeredito {
  veredito: Veredito;
  motivos: string[];
}

/** Salario minimo vigente. Atualizar aqui quando mudar. */
const SALARIO_MINIMO = 1518;

/**
 * Acima disso, o nome e comum a ponto de facilitar confusao de identidade na
 * instalacao. Numero escolhido por ordem de grandeza, nao por estudo — se a
 * operacao mostrar que gera ruido, sobe.
 */
const HOMONIMOS_DEMAIS = 100;

/**
 * Processos como reu acima disso vira alerta por volume, mesmo sem execucao.
 * Quem responde a muitos processos tem historico de conflito contratual.
 */
const PROCESSOS_DEMAIS = 5;

/**
 * Consultas no mercado em 30 dias acima disso indica alguem contratando em
 * varios lugares ao mesmo tempo — o padrao do migrador serial que o score ISP
 * ja persegue dentro da rede, aqui visto no mercado inteiro.
 */
const CONSULTAS_DEMAIS_30D = 10;

/** Status da Receita que impedem contratacao. Qualquer coisa fora de REGULAR. */
const STATUS_OK = "REGULAR";

/**
 * Score de mercado (0-999) abaixo disso vira alerta. 300 e o piso da faixa que
 * a propria BigData trata como risco alto, e espelha o corte de 301-500 que o
 * DESIGN_SYSTEM ja usa para pintar score baixo na tela.
 */
const SCORE_MERCADO_BAIXO = 300;

/**
 * Trocas de emprego em 5 anos acima disso indica renda instavel. Contrato de
 * internet dura 12 meses; quem trocou quatro vezes em cinco anos tem chance
 * real de estar sem renda em algum mes do contrato. Numero por ordem de
 * grandeza, nao por estudo — se gerar ruido na operacao, sobe.
 */
const TROCAS_EMPREGO_DEMAIS = 4;

/**
 * Consultas de credito por credores em 30 dias acima disso alerta. Corte mais
 * baixo que o de passagens na web (10) porque consulta de bureau e um sinal
 * mais forte: alguem esta avaliando conceder credito, nao apenas navegando.
 */
const CONSULTAS_CREDITO_DEMAIS_30D = 5;

/**
 * Piso em reais de uma faixa de renda da BigData.
 * Devolve o PISO, nao a media: comparar o piso com o valor do plano e a leitura
 * conservadora — se nem o piso cobre, ha risco real.
 */
export function rendaMinimaMensal(faixa?: string | null): number | null {
  if (!faixa) return null;
  const f = faixa.trim().toUpperCase();
  if (f === "SEM INFORMACAO") return null;

  const acima = f.match(/^ACIMA DE\s+([\d.,]+)\s*SM$/);
  if (acima) return parseFloat(acima[1].replace(",", ".")) * SALARIO_MINIMO;

  const ate = f.match(/^ATE\s+([\d.,]+)\s*SM$/);
  if (ate) return 0;

  const intervalo = f.match(/^([\d.,]+)\s*A\s*([\d.,]+)\s*SM$/);
  if (intervalo) return parseFloat(intervalo[1].replace(",", ".")) * SALARIO_MINIMO;

  return null;
}

/**
 * Traduz a faixa de salarios minimos para reais.
 * "ACIMA DE 20 SM" nao diz nada a quem esta no balcao decidindo se aprova um
 * plano de R$ 120 — precisa virar dinheiro.
 */
export function faixaRendaEmReais(faixa?: string | null): string | null {
  if (!faixa) return null;
  const f = faixa.trim().toUpperCase();
  if (f === "SEM INFORMACAO") return null;

  const brl = (v: number) =>
    `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

  const acima = f.match(/^ACIMA DE\s+([\d.,]+)\s*SM$/);
  if (acima) return `acima de ${brl(parseFloat(acima[1].replace(",", ".")) * SALARIO_MINIMO)}/mês`;

  const ate = f.match(/^ATE\s+([\d.,]+)\s*SM$/);
  if (ate) return `até ${brl(parseFloat(ate[1].replace(",", ".")) * SALARIO_MINIMO)}/mês`;

  const intervalo = f.match(/^([\d.,]+)\s*A\s*([\d.,]+)\s*SM$/);
  if (intervalo) {
    const de = parseFloat(intervalo[1].replace(",", ".")) * SALARIO_MINIMO;
    const ate2 = parseFloat(intervalo[2].replace(",", ".")) * SALARIO_MINIMO;
    return `${brl(de)} a ${brl(ate2)}/mês`;
  }
  return null;
}

export function decidirVeredito(
  d: DadosCadastrais,
  opcoes: OpcoesVeredito = {},
): ResultadoVeredito {
  if (!d.encontrado) {
    return {
      veredito: "NAO_ENCONTRADO",
      // Ausencia de informacao nao e recusa. Recusar por isso puniria quem
      // simplesmente nao tem rastro digital — que e comum na base de um ISP.
      motivos: ["CPF não encontrado na base da Receita Federal"],
    };
  }

  const motivos: string[] = [];
  let recusar = false;

  // ── Veto ──────────────────────────────────────────────────────────────────
  const status = d.taxIdStatus?.trim().toUpperCase();
  if (status && status !== STATUS_OK) {
    recusar = true;
    motivos.push(`CPF com situação "${d.taxIdStatus}" na Receita Federal`);
  }

  if (d.temObito) {
    recusar = true;
    motivos.push("Há indicação de óbito do titular");
  }

  // ── Alerta ────────────────────────────────────────────────────────────────
  const enderecos = d.enderecos ?? [];
  if (enderecos.length === 0) {
    motivos.push("Nenhum endereço encontrado para este CPF");
  } else if (!enderecos.some(e => e.ratificado)) {
    motivos.push("Nenhum endereço ratificado junto aos Correios");
  }

  if ((d.badAddressPassages ?? 0) > 0) {
    motivos.push(`${d.badAddressPassages} passagem(ns) de endereço suspeita(s)`);
  }

  if (d.nascimentoValidadoNaReceita === false) {
    motivos.push("Data de nascimento não confere com a Receita Federal");
  }

  if ((d.homonimos ?? 0) >= HOMONIMOS_DEMAIS) {
    motivos.push(`Nome com ${d.homonimos} homônimos — confira documento com foto`);
  }

  // Renda so entra se houver plano para comparar. Sem plano, alertar seria
  // inventar criterio; e faixa ausente nunca vira alerta.
  if (opcoes.valorPlano != null) {
    const piso = rendaMinimaMensal(d.faixaRenda);
    if (piso !== null && piso < opcoes.valorPlano) {
      motivos.push(
        `Renda estimada (${d.faixaRenda}) abaixo da mensalidade do plano`,
      );
    }
  }

  // ── Inadimplencia ─────────────────────────────────────────────────────────
  // Nenhum destes recusa sozinho: sao historico, nao impedimento. Cobranca
  // resolvida e processo perdido nao proibem alguem de contratar internet —
  // mas o provedor tem o direito de saber antes de instalar.
  if (d.emCobrancaAgora) {
    motivos.push("Em processo de cobrança neste momento");
  } else if ((d.cobrancas365d ?? 0) > 0) {
    const credores = d.credoresDistintos365d ?? 0;
    motivos.push(
      `${d.cobrancas365d} cobrança(s) nos últimos 12 meses` +
      (credores > 1 ? ` — ${credores} credores diferentes` : ""),
    );
  }

  if (d.temExecucao) {
    motivos.push("Execução judicial de dívida no histórico");
  } else if ((d.processosComoReu ?? 0) >= PROCESSOS_DEMAIS) {
    motivos.push(`${d.processosComoReu} processos como réu`);
  }

  if ((d.dividaAtiva ?? 0) > 0) {
    motivos.push(
      `Dívida ativa da União: R$ ${(d.dividaAtiva as number).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    );
  }

  // ── Bureau de mercado ─────────────────────────────────────────────────────
  // Negativacao vista fora da rede de provedores. Nao recusa sozinha, pelo
  // mesmo motivo das cobrancas: e historico, nao impedimento — e o titular tem
  // direito de contestar a anotacao. Mas e o sinal mais forte da lista.
  // Quando o detalhe existe, ele descreve melhor que o booleano: dizer
  // "2 negativações ativas, R$ 1.240,00" da ao operador o que negociar.
  if ((d.negativacoesAtivas ?? 0) > 0) {
    const valor = d.dividaMercado
      ? ` — R$ ${d.dividaMercado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
      : "";
    motivos.push(`${d.negativacoesAtivas} negativação(ões) ativa(s) no mercado${valor}`);
  } else if (d.negativadoNoMercado === true) {
    motivos.push("Indício de negativação em bureau de mercado");
  }

  // Protesto e cobranca levada a cartorio: um degrau acima da negativacao.
  if ((d.protestos ?? 0) > 0) {
    motivos.push(`${d.protestos} protesto(s) em cartório`);
  }

  if (d.scoreMercado != null && d.scoreMercado < SCORE_MERCADO_BAIXO) {
    motivos.push(`Score de crédito de mercado baixo (${d.scoreMercado} de 999)`);
  }

  // Consulta de bureau e mais forte que passagem na web: significa que outro
  // credor esta avaliando dar credito a esta pessoa AGORA. Muitas em 30 dias e
  // o padrao do migrador serial, visto fora da rede de provedores.
  if ((d.consultasCredito30d ?? 0) >= CONSULTAS_CREDITO_DEMAIS_30D) {
    motivos.push(`${d.consultasCredito30d} consultas de crédito por credores em 30 dias`);
  }

  // ── Estabilidade de renda ─────────────────────────────────────────────────
  // Estar empregado hoje nao diz nada sobre estar empregado no mes 8 do
  // contrato. Alerta de conferencia, nunca de recusa: trocar de emprego e
  // legitimo e recusar por isso puniria trabalhador de setor rotativo.
  if ((d.trocasEmprego5Anos ?? 0) > TROCAS_EMPREGO_DEMAIS) {
    motivos.push(`${d.trocasEmprego5Anos} trocas de emprego em 5 anos — renda instável`);
  } else if (d.mediaAnosPorVinculo != null && d.mediaAnosPorVinculo < 1 && (d.trocasEmprego5Anos ?? 0) > 0) {
    motivos.push("Vínculos de trabalho curtos — renda instável");
  }

  // A e H sao os extremos: A significa procurar credito o tempo todo, o que
  // costuma anteceder o aperto. So os dois primeiros niveis alertam.
  if (d.buscaCredito && ["A", "B"].includes(d.buscaCredito.trim().toUpperCase())) {
    motivos.push("Busca intensa por crédito no mercado");
  }

  if ((d.consultas30d ?? 0) >= CONSULTAS_DEMAIS_30D) {
    motivos.push(`CPF consultado ${d.consultas30d} vezes no mercado em 30 dias`);
  }

  // Trocar de nome e legitimo — casamento, adocao, retificacao. Vira alerta de
  // conferencia documental, nunca de recusa.
  if ((d.mudancasNome ?? 0) > 0) {
    motivos.push(`${d.mudancasNome} alteração(ões) de nome no CPF — confira o documento`);
  }

  if (recusar) return { veredito: "RECUSAR", motivos };
  if (motivos.length > 0) return { veredito: "ATENCAO", motivos };
  return { veredito: "APROVAR", motivos: [] };
}
