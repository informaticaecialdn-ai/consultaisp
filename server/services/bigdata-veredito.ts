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

/** Status da Receita que impedem contratacao. Qualquer coisa fora de REGULAR. */
const STATUS_OK = "REGULAR";

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

  if (recusar) return { veredito: "RECUSAR", motivos };
  if (motivos.length > 0) return { veredito: "ATENCAO", motivos };
  return { veredito: "APROVAR", motivos: [] };
}
