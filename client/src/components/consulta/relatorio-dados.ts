/**
 * As derivações do relatório de crédito — a conta, não a pintura.
 *
 * Tudo que vira número, frase ou linha de tabela mora aqui, e daqui saem TANTO
 * a tela (`ConsultaResultSummary.tsx`) quanto o papel (`PdfReportGenerator.ts`).
 *
 * Existe por um motivo concreto: até esta versão o PDF reimplementava por conta
 * própria o que a tela calculava, e o resultado foi um relatório impresso que
 * dizia outra coisa — sem a seção de equipamento, sem o raciocínio da decisão,
 * com a inadimplência de terceiros contada de outro jeito. Duas verdades para o
 * mesmo documento, e a que o provedor arquiva é a impressa.
 *
 * Nada aqui sabe de React, de cor ou de CSS. Só recebe `ConsultaResult` e
 * devolve dados prontos, com os textos literais que aparecem nos dois meios.
 */
import type { ConsultaResult, ProviderDetail } from "./types";

/* ── Tom semântico. Quem pinta decide o hex; aqui só o significado. ── */
export type Tom = "ok" | "gated" | "past" | "danger" | "info" | "neutral";

/* ── Formatadores ──────────────────────────────────────────────── */

export function brl(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export function brlCurto(v: number): string {
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

export function fmtCep(cep: string): string {
  const d = (cep || "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

/* ── Leitura dos dados ─────────────────────────────────────────── */

/**
 * "Inadimplente" não é só `daysOverdue > 0`: o parceiro chega mascarado, com
 * faixa de valor no lugar do número, e o status do ERP às vezes é a única
 * pista. Perder qualquer um dos três esconde ocorrência.
 */
export function isDelinquent(d: ProviderDetail): boolean {
  return d.daysOverdue > 0
    || (!d.isSameProvider && !!d.overdueAmountRange)
    || !!d.status?.toLowerCase().includes("inadimplente");
}

/**
 * Situação para o pill da tabela 03. O status do ERP é mais rico que um
 * binário ("Cancelado (débito)"), mas quando o parêntese só repete o atraso —
 * "Inadimplente (90+ dias)" ao lado da coluna Atraso "90+ dias" — ele vira
 * redundância. Cai o parêntese de dias; os demais ficam.
 */
export function situacaoCurta(status: string | undefined, fallback: string): string {
  if (!status) return fallback;
  return status.replace(/\s*\([^)]*dias?[^)]*\)\s*$/i, "").trim() || fallback;
}

/** As cinco faixas do score. A régua é a mesma da barra segmentada. */
export function faixaDoScore(score: number): { label: string; tom: Tom; indice: number } {
  if (score <= 300) return { label: "Crítico", tom: "danger", indice: 0 };
  if (score <= 500) return { label: "Risco alto", tom: "past", indice: 1 };
  if (score <= 700) return { label: "Risco médio", tom: "gated", indice: 2 };
  if (score <= 850) return { label: "Bom", tom: "info", indice: 3 };
  return { label: "Excelente", tom: "ok", indice: 4 };
}

/**
 * Débito estimado: o TOTAL em risco, não um recorte.
 *
 * O seu ERP dá valor exato; parceiros dão faixa (LGPD). Quando os dois existem,
 * os limites das faixas são somados ao valor próprio e o resultado continua
 * sendo faixa — descartar um dos lados subestimava o risco. Faixa que não
 * parseia derruba a soma para o comportamento conservador: mostra a faixa crua
 * em vez de inventar um número.
 */
export function debitoEstimado(proprios: ProviderDetail[], parceiros: ProviderDetail[]): {
  texto: string;
  temDebito: boolean;
} {
  const debitoProprio = proprios.reduce((s, d) => s + (d.overdueAmount ?? 0), 0);
  const faixas = parceiros.map(d => d.overdueAmountRange).filter(Boolean) as string[];

  const parseFaixa = (f: string): [number, number] | null => {
    const nums = f.match(/[\d.,]+/g)?.map(n => parseFloat(n.replace(/\./g, "").replace(",", ".")))
      .filter(n => Number.isFinite(n)) ?? [];
    if (nums.length === 2) return [nums[0], nums[1]];
    if (nums.length === 1) return [nums[0], nums[0]];
    return null;
  };

  const temDebito = faixas.length > 0 || debitoProprio > 0;
  const parsed = faixas.map(parseFaixa);

  if (faixas.length > 0 && parsed.every(Boolean)) {
    const min = (parsed as [number, number][]).reduce((s, [a]) => s + a, debitoProprio);
    const max = (parsed as [number, number][]).reduce((s, [, b]) => s + b, debitoProprio);
    return { texto: min === max ? brlCurto(min) : `${brlCurto(min)} – ${brlCurto(max)}`, temDebito };
  }
  if (faixas.length > 0) return { texto: faixas[0], temDebito };
  return { texto: debitoProprio > 0 ? brl(debitoProprio) : "—", temDebito };
}

/**
 * A frase que sustenta a decisão — escrita a partir dos sinais que pesaram,
 * nunca o eco de um alerta que já aparece na seção 07.
 */
export function decisionSubtitle(result: ConsultaResult, ativas: number, equipamentos: number): string {
  const partes: string[] = [];

  if (ativas > 0) {
    const comValor = result.providerDetails.find(d => isDelinquent(d) && (d.overdueAmountRange || d.overdueAmount != null));
    const valor = comValor?.isSameProvider && comValor.overdueAmount != null
      ? brl(comValor.overdueAmount)
      : comValor?.overdueAmountRange;
    partes.push(
      `${ativas} ocorrência${ativas > 1 ? "s" : ""} de inadimplência ativa na rede`
      + (valor ? `, com débito de ${valor}` : ""),
    );
  }
  if (equipamentos > 0) {
    // "devolvido" concorda também. A versão anterior escrevia "2 equipamentos
    // em comodato não devolvido" — o plural parava no meio da frase.
    const s = equipamentos > 1 ? "s" : "";
    partes.push(`${equipamentos} equipamento${s} em comodato não devolvido${s}`);
  }
  if (result.migratorAlert?.detected) {
    partes.push("padrão de migração entre provedores");
  }

  if (partes.length === 0) {
    return "Sem restrições na rede ISP colaborativa: nenhuma ocorrência de inadimplência, de equipamento ou de endereço registrada pelos provedores consultados.";
  }
  return partes.join(" · ") + ". A decisão considera o seu apetite de risco e as garantias que você pode exigir na ativação.";
}

/** Aprovar / Rejeitar / Analisar. "Review" e qualquer valor desconhecido caem em Analisar. */
export function decisaoDe(result: ConsultaResult): { curto: string; tom: Tom; titulo: string } {
  if (result.decisionReco === "Accept") return { curto: "Aprovar", tom: "ok", titulo: "Aprovar ativação." };
  if (result.decisionReco === "Reject") return { curto: "Rejeitar", tom: "danger", titulo: "Rejeitar ou exigir caução integral." };
  return { curto: "Analisar", tom: "gated", titulo: "Analisar manualmente antes de ativar." };
}

/* ── Linhas de tabela ──────────────────────────────────────────── */

export interface LinhaOcorrencia {
  cliente: string;
  sub?: string;
  fonte: string;
  situacao: string;
  situacaoTom: Tom;
  atraso: string;
  valor: string;
  valorNegativo: boolean;
  custo: string;
}

/** Linha das tabelas de 3 colunas (seções 04 e 05). */
export interface LinhaFonte {
  kicker: string;
  fonte: string;
  chip: string;
  chipTom: Tom;
  nome: string;
  linha: string;
}

/* ── O modelo inteiro do relatório ─────────────────────────────── */

export interface DadosRelatorio {
  score: number;
  faixa: ReturnType<typeof faixaDoScore>;
  proprios: ProviderDetail[];
  parceiros: ProviderDetail[];
  /** Ocorrências de inadimplência ativa, próprias + parceiras. */
  ativas: number;
  /** Soma dos equipamentos não devolvidos. */
  equipamentos: number;
  /** ERPs varridos — o DENOMINADOR. Inclui o seu, se você tiver integração. */
  provedoresConsultados: number;
  parceirosConsultados: number;
  /** ERPs que devolveram registro — o NUMERADOR. */
  provedoresComRegistro: number;
  decisao: ReturnType<typeof decisaoDe>;
  subtitulo: string;
  debito: ReturnType<typeof debitoEstimado>;
  ocorrencias: LinhaOcorrencia[];
  equipamentoLinhas: LinhaFonte[];
  enderecoLinhas: LinhaFonte[];
  /** Só os matches COM dívida — é o que a lista de endereço mostra. */
  enderecoComDivida: NonNullable<ConsultaResult["addressMatches"]>;
  cepUsado: string;
  rotuloLocal: string;
  cruzou: boolean;
  /** Consulta por CEP esconde as seções 03 e 04 — não há titular para descrever. */
  ehBuscaPorCep: boolean;
}

export function derivarRelatorio(result: ConsultaResult): DadosRelatorio {
  const score = Math.max(0, Math.min(1000, result.score));
  const proprios = result.providerDetails.filter(d => d.isSameProvider);
  const parceiros = result.providerDetails.filter(d => !d.isSameProvider);
  const ativas = result.providerDetails.filter(isDelinquent).length;
  const equipamentos = result.providerDetails.reduce(
    (s, d) => s + (d.hasUnreturnedEquipment ? d.unreturnedEquipmentCount : 0), 0,
  );

  // `erpSummary.total` conta todos os ERPs varridos na mesorregião, o seu
  // incluído SE você tiver um. É o denominador — e é o número que dá peso ao
  // "nada consta": 1 em 2 e 1 em 12 são leituras diferentes.
  const provedoresConsultados = result.erpSummary?.total ?? result.erpLatencies?.length ?? 0;
  const parceirosConsultados = Math.max(0, provedoresConsultados - (proprios.length > 0 ? 1 : 0));
  const provedoresComRegistro = result.providersFound || result.providerDetails.length;

  /**
   * Verde so para quem AINDA e cliente e esta em dia.
   *
   * O tom saia de `mau ? "past" : "ok"`, entao ex-cliente sem debito ganhava
   * o pill verde de bom pagador. Contrato encerrado nao e mau nem bom: e
   * neutro, e o leitor precisa ver a diferenca.
   */
  const tomDaSituacao = (d: any, mau: boolean): Tom =>
    mau ? "past" : d.contractStatus === "cancelled" ? "neutral" : "ok";

  const ocorrencias: LinhaOcorrencia[] = [];
  if (proprios.length > 0) {
    for (const d of proprios) {
      const mau = isDelinquent(d);
      ocorrencias.push({
        cliente: d.customerName || "— nada consta —",
        sub: d.hasUnreturnedEquipment
          ? `${d.unreturnedEquipmentCount} equipamento${d.unreturnedEquipmentCount > 1 ? "s" : ""} em comodato pendente`
          : undefined,
        fonte: `Seu ERP · ${d.providerName}`,
        situacao: situacaoCurta(d.status, mau ? "Inadimplente" : d.contractStatus === "cancelled" ? "Contrato encerrado" : "Em dia"),
        situacaoTom: tomDaSituacao(d, mau),
        atraso: d.daysOverdue > 0 ? `${d.daysOverdue} dias` : "—",
        valor: d.overdueAmount != null && d.overdueAmount > 0 ? brl(d.overdueAmount) : "—",
        valorNegativo: mau,
        custo: "grátis",
      });
    }
  } else {
    ocorrencias.push({
      cliente: "— nada consta —", fonte: "Seu ERP", situacao: "Sem registro",
      situacaoTom: "neutral", atraso: "—", valor: "—", valorNegativo: false, custo: "grátis",
    });
  }

  if (parceiros.length > 0) {
    for (const d of parceiros) {
      const mau = isDelinquent(d);
      const local = d.addressCity ? ` · ${d.addressCity}${d.addressState ? "/" + d.addressState : ""}` : "";
      ocorrencias.push({
        cliente: d.customerName || "Dados restritos",
        sub: d.hasUnreturnedEquipment
          ? `${d.unreturnedEquipmentCount >= 2 ? "2+" : d.unreturnedEquipmentCount} equipamento${d.unreturnedEquipmentCount > 1 ? "s" : ""} retido${d.unreturnedEquipmentCount > 1 ? "s" : ""}${d.equipmentSignalValidated ? " · ocorrência validada" : ""}`
          : undefined,
        fonte: `${d.providerName}${local}`,
        situacao: situacaoCurta(d.status, mau ? "Inadimplente" : d.contractStatus === "cancelled" ? "Contrato encerrado" : "Em dia"),
        situacaoTom: tomDaSituacao(d, mau),
        atraso: d.daysOverdueRange || (d.daysOverdue > 0 ? `${d.daysOverdue} dias` : "—"),
        valor: d.overdueAmountRange || "—",
        valorNegativo: mau,
        custo: "1 crédito",
      });
    }
  } else {
    ocorrencias.push({
      cliente: "— nada consta na rede —",
      fonte: `Rede ISP · ${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"}`,
      situacao: "Sem registro", situacaoTom: "neutral",
      atraso: "—", valor: "—", valorNegativo: false, custo: "grátis",
    });
  }

  const equipProprio = proprios.find(d => d.hasUnreturnedEquipment);
  const equipParceiro = parceiros.find(d => d.hasUnreturnedEquipment);
  const equipamentoLinhas: LinhaFonte[] = [
    equipProprio
      ? {
          kicker: "Seu provedor", fonte: `Seu ERP · ${equipProprio.providerName}`,
          chip: "Ocorrência ativa", chipTom: "danger",
          nome: `${equipProprio.unreturnedEquipmentCount} equipamento${equipProprio.unreturnedEquipmentCount > 1 ? "s" : ""} não devolvido${equipProprio.unreturnedEquipmentCount > 1 ? "s" : ""}`,
          linha: equipProprio.equipmentValueRange || equipProprio.equipmentPendingSummary || "Comodato pendente no seu ERP",
        }
      : {
          kicker: "Seu provedor", fonte: "Seu ERP",
          chip: "Sem ocorrência", chipTom: "ok",
          nome: "Nenhum equipamento retido",
          linha: "Sem registro de comodato pendente no seu ERP",
        },
    equipParceiro
      ? {
          kicker: "Provedor parceiro", fonte: `Rede ISP · ${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"}`,
          chip: equipParceiro.equipmentSignalValidated ? "Ocorrência validada" : "Sinal não validado",
          chipTom: equipParceiro.equipmentSignalValidated ? "gated" : "neutral",
          nome: `${equipParceiro.unreturnedEquipmentCount >= 2 ? "2+" : equipParceiro.unreturnedEquipmentCount} equipamento${equipParceiro.unreturnedEquipmentCount > 1 ? "s" : ""} retido${equipParceiro.unreturnedEquipmentCount > 1 ? "s" : ""}`,
          linha: [
            equipParceiro.equipmentSignalValidated ? "Ocorrência validada" : "Pendência operacional",
            equipParceiro.equipmentValueRange ? `${equipParceiro.equipmentValueRange} em risco` : null,
          ].filter(Boolean).join(" · "),
        }
      : {
          kicker: "Provedor parceiro", fonte: `Rede ISP · ${parceirosConsultados} parceiro${parceirosConsultados === 1 ? "" : "s"}`,
          chip: "Sem ocorrência", chipTom: "ok",
          nome: "Nenhum equipamento retido",
          linha: "Sem ocorrência validada no bureau",
        },
  ];

  const matchesProprios = result.addressMatches?.filter(m => m.isSameProvider) ?? [];
  const matchesParceiros = result.addressMatches?.filter(m => !m.isSameProvider) ?? [];
  const inadProprios = matchesProprios.filter(m => m.hasDebt).length;
  const inadParceiros = matchesParceiros.filter(m => m.hasDebt).length;
  const cepUsado = result.addressParts?.cep || proprios[0]?.cep || "";
  /* O rotulo mostra o que foi de fato cruzado. Antes ele era sempre
     `"CEP " + fmtCep(addressUsed)`, e como `addressUsed` costuma ser um
     endereco a tela escrevia "CEP Rua Amelia Wiesel Rose, 17 — ...". */
  const enderecoUsado = result.addressUsed || (cepUsado ? fmtCep(cepUsado) : "");
  const rotuloLocal = result.addressParts?.logradouro
    ? enderecoUsado
    : cepUsado ? `CEP ${fmtCep(cepUsado)}` : "";
  const cruzou = result.autoAddressCrossRef === true || !!result.addressSearch;

  const enderecoLinhas: LinhaFonte[] = [
    {
      kicker: "Seu provedor", fonte: `Seu ERP${rotuloLocal ? " · " + rotuloLocal : ""}`,
      chip: inadProprios > 0 ? `${inadProprios} inadimplente${inadProprios > 1 ? "s" : ""}` : "Nada consta",
      chipTom: inadProprios > 0 ? "danger" : "ok",
      nome: inadProprios > 0 ? `${inadProprios} inadimplente${inadProprios > 1 ? "s" : ""} no endereço` : "Nada consta",
      linha: inadProprios > 0
        ? "Possível fraude por troca de documento"
        : matchesProprios.length > 0
          ? `${matchesProprios.length} cadastro${matchesProprios.length > 1 ? "s" : ""} ativo${matchesProprios.length > 1 ? "s" : ""} na sua base · em dia`
          : "Nenhum outro cadastro seu neste endereço",
    },
    {
      kicker: "Provedor parceiro", fonte: `Rede ISP${rotuloLocal ? " · " + rotuloLocal : ""}`,
      chip: inadParceiros > 0 ? `${inadParceiros} inadimplente${inadParceiros > 1 ? "s" : ""}` : cruzou ? "Nada consta" : "Indisponível",
      chipTom: inadParceiros > 0 ? "danger" : cruzou ? "ok" : "neutral",
      nome: inadParceiros > 0
        ? `${inadParceiros} inadimplente${inadParceiros > 1 ? "s" : ""} no endereço`
        : cruzou ? "Nada consta" : "Cruzamento não realizado",
      linha: inadParceiros > 0
        ? "Possível fraude por troca de documento"
        : cruzou
          ? `${matchesParceiros.length} cadastro${matchesParceiros.length === 1 ? "" : "s"} em parceiros · nenhum inadimplente`
          : "Faltam CEP e número para cruzar o imóvel na rede",
    },
  ];

  return {
    score,
    faixa: faixaDoScore(score),
    proprios, parceiros, ativas, equipamentos,
    provedoresConsultados, parceirosConsultados, provedoresComRegistro,
    decisao: decisaoDe(result),
    subtitulo: decisionSubtitle(result, ativas, equipamentos),
    debito: debitoEstimado(proprios, parceiros),
    ocorrencias, equipamentoLinhas, enderecoLinhas,
    enderecoComDivida: (result.addressMatches ?? []).filter(m => m.hasDebt),
    cepUsado, rotuloLocal, cruzou,
    ehBuscaPorCep: result.searchType === "cep",
  };
}
