/**
 * REGRA DO ANTI-FRAUDE — detector de FUGA.
 *
 * O conceito, nas palavras do dono (02/09/2026): o anti-fraude avisa o
 * provedor quando um cliente DELE, com CONTRATO ATIVO, e consultado por um
 * provedor parceiro. E o momento em que ele ainda pode agir — cobrar,
 * renegociar, recolher o equipamento, reter — antes que o cliente instale no
 * concorrente.
 *
 * QUAL cliente ativo merece aviso e escolha do provedor, em
 * shared/antifraude-regras.ts (padrao: so quem esta devendo). Esta funcao e o
 * portao comum a todas as regras mais a avaliacao de cada uma:
 *   1. quem consultou NAO e o dono do cliente;
 *   2. o cliente e comprovadamente ATIVO (ou suspenso por atraso — cortado,
 *      mas ainda cliente) na base do dono. Cancelado sai, e status
 *      desconhecido tambem: nao saber se e cliente nao e o mesmo que saber
 *      que e, e um alerta que o provedor nao consegue verificar e ruido;
 *   3. pelo menos uma regra ligada bate.
 *
 * O que SAIU em 02/09/2026, e por que:
 *   - o teto de 90 dias de atraso. Existia para compensar status
 *     desatualizado. Desde que o sync le o contrato de verdade (V2 do MK,
 *     tabela de contratos do IXC, conexao bloqueada = suspenso), o status e
 *     confiavel: se o ERP diz ativo com 200 dias, ha um servico ligado;
 *   - o piso de 15 dias de atraso. O alerta so existe quando OUTRO provedor
 *     consultou o CPF, o que ja e raro e significativo; esperar 15 dias para
 *     avisar e avisar depois que o cliente assinou no concorrente;
 *   - o sinal de migrador serial (ex-cliente devendo, consultado de novo).
 *     Nao e anti-fraude: e bureau, e vai no resultado da consulta.
 */
import { REGRAS_PADRAO, type RegrasAntiFraude } from "@shared/antifraude-regras";

/** Um por regra. A ordem aqui e a de prioridade do rotulo e da severidade. */
export const MOTIVOS_DE_FUGA = ["divida_ativa", "consultas_repetidas", "contrato_novo", "cliente_ativo"] as const;
export type MotivoFuga = (typeof MOTIVOS_DE_FUGA)[number];

/** Por que um candidato NAO virou alerta. Vai para o log — e explica a lista vazia. */
export type MotivoDescarte =
  | "consulta_do_proprio_dono"
  | "contrato_cancelado"
  | "status_desconhecido"
  | "nenhuma_regra";

export interface ClienteParaAvaliar {
  /** Status do contrato no ERP (ou na base sincronizada) do DONO. undefined = ninguem informou. */
  contractStatus?: "active" | "cancelled" | "suspended";
  /** Inicio do contrato. Aceita ISO (YYYY-MM-DD) e BR (DD/MM/AAAA). */
  contractStartDate?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
}

export interface AvaliacaoFuga {
  alerta: boolean;
  motivos: MotivoFuga[];
  descartadoPor?: MotivoDescarte;
  diasDeContrato?: number;
}

export interface OpcoesDeAvaliacao {
  consultanteEhDono: boolean;
  agora?: Date;
  /** As regras do DONO. Sem elas vale o padrao (so inadimplente). */
  regras?: RegrasAntiFraude;
  /** Quantos provedores DIFERENTES do dono consultaram este CPF em 30 dias, incluindo o de agora. */
  consultasDeOutros?: number;
}

/** Os padroes, exportados por nome — a regua do mapa e do relatorio. */
export const DIVIDA_MINIMA = REGRAS_PADRAO.ativo_inadimplente.valorMinimo;
export const DIAS_MINIMOS_ATRASO = REGRAS_PADRAO.ativo_inadimplente.diasMinimo;

/** Aceita "2026-08-27", "27/08/2026" e "27/08/2026 14:30". */
export function parseDataContrato(valor?: string): Date | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (!texto) return null;

  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const [dia, mes, ano] = [Number(br[1]), Number(br[2]), Number(br[3])];
    const d = new Date(ano, mes - 1, dia);
    // O construtor do Date faz rollover em silêncio: 31/31/2026 vira jul/2028.
    // Só aceita se os componentes voltarem iguais aos que entraram.
    const valido = d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
    return valido ? d : null;
  }

  const iso = new Date(texto);
  if (isNaN(iso.getTime())) return null;
  // "0000-00-00" e afins viram datas absurdas em alguns ERPs
  if (iso.getFullYear() < 1990) return null;
  return iso;
}

export function diasDesde(data: Date, agora = new Date()): number {
  return Math.floor((agora.getTime() - data.getTime()) / 86_400_000);
}

/**
 * O coracao da regra. Recebe o cliente como o DONO o descreve, e as regras do
 * dono, e diz se a consulta de um terceiro merece aviso — e por quais motivos.
 */
export function avaliarRiscoDeFuga(cliente: ClienteParaAvaliar, opcoes: OpcoesDeAvaliacao): AvaliacaoFuga {
  if (opcoes.consultanteEhDono) {
    return { alerta: false, motivos: [], descartadoPor: "consulta_do_proprio_dono" };
  }

  /* "Somente clientes ativos." Cancelado sai — e desconhecido tambem.
     Ausencia de prova de que o cliente e ativo nao e prova de que e: tratar
     undefined como "provavelmente ativo" era o que deixava ex-cliente passar. */
  if (cliente.contractStatus !== "active" && cliente.contractStatus !== "suspended") {
    return {
      alerta: false,
      motivos: [],
      descartadoPor: cliente.contractStatus === "cancelled" ? "contrato_cancelado" : "status_desconhecido",
    };
  }

  const regras = opcoes.regras ?? REGRAS_PADRAO;
  const inicio = parseDataContrato(cliente.contractStartDate);
  const diasDeContrato = inicio ? diasDesde(inicio, opcoes.agora) : undefined;
  const motivos: MotivoFuga[] = [];

  const inadimplente = regras.ativo_inadimplente;
  if (
    inadimplente.ativo &&
    cliente.totalOverdueAmount >= inadimplente.valorMinimo &&
    cliente.maxDaysOverdue >= inadimplente.diasMinimo
  ) {
    motivos.push("divida_ativa");
  }

  const repetidas = regras.consultas_repetidas;
  if (repetidas.ativo && (opcoes.consultasDeOutros ?? 0) >= repetidas.provedoresMinimos) {
    motivos.push("consultas_repetidas");
  }

  // Sem data de contrato nao ha como dizer que e novo — a regra nao dispara,
  // em vez de presumir. A base sincronizada nao guarda essa data.
  const novo = regras.contrato_novo;
  if (novo.ativo && diasDeContrato !== undefined && diasDeContrato <= novo.diasMaximo) {
    motivos.push("contrato_novo");
  }

  if (regras.ativo_qualquer.ativo) {
    motivos.push("cliente_ativo");
  }

  if (motivos.length === 0) {
    return { alerta: false, motivos: [], descartadoPor: "nenhuma_regra", diasDeContrato };
  }
  return { alerta: true, motivos, diasDeContrato };
}

/** O que foi gravado em `riskFactors` que e motivo de fuga — na ordem de prioridade. */
export function motivosGravados(riskFactors: unknown): MotivoFuga[] {
  if (!Array.isArray(riskFactors)) return [];
  return MOTIVOS_DE_FUGA.filter(m => riskFactors.includes(m));
}

/** O motivo que manda: o primeiro na ordem de prioridade. */
export function motivoPrincipal(motivos: MotivoFuga[]): MotivoFuga | undefined {
  return MOTIVOS_DE_FUGA.find(m => motivos.includes(m));
}

const ROTULOS: Record<MotivoFuga, string> = {
  divida_ativa: "Fuga · cliente ativo com dívida",
  consultas_repetidas: "Cliente ativo consultado por vários provedores",
  contrato_novo: "Cliente novo consultado por outro provedor",
  cliente_ativo: "Cliente ativo consultado por outro provedor",
};

/** Rotulo do alerta na tela, pelo motivo principal. */
export function rotuloDoAlerta(motivos: MotivoFuga[]): string {
  return ROTULOS[motivoPrincipal(motivos) ?? "divida_ativa"];
}

/**
 * Severidade pelo tamanho do prejuizo em curso. O provedor ve dezenas de
 * alertas; o que separa o urgente e quanto ja esta em jogo. Sem divida, o
 * que pesa e a insistencia (varios provedores) — o resto e aviso de retencao.
 */
export function severidadeDoAlerta(
  motivos: MotivoFuga[],
  cliente: Pick<ClienteParaAvaliar, "totalOverdueAmount" | "maxDaysOverdue">,
): "medium" | "high" | "critical" {
  if (motivos.includes("divida_ativa")) {
    if (cliente.totalOverdueAmount >= 500 || cliente.maxDaysOverdue >= 60) return "critical";
    if (cliente.totalOverdueAmount >= 200 || cliente.maxDaysOverdue >= 30) return "high";
    return "medium";
  }
  if (motivos.includes("consultas_repetidas")) return "high";
  return "medium";
}
