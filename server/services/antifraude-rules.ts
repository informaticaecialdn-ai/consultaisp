/**
 * REGRA DO ANTI-FRAUDE — detector de FUGA, não listador de inadimplentes.
 *
 * O alerta existe para avisar o provedor que um cliente que ele AINDA TEM está
 * procurando outro provedor. É o momento em que ele ainda pode agir: cobrar,
 * renegociar, recolher o equipamento. Um ex-cliente de sete anos atrás não tem
 * nada disso — não há fuga, já foi.
 *
 * Dispara quando TODAS forem verdadeiras:
 *   1. quem consultou NÃO é o dono do cliente;
 *   2. o cliente é comprovadamente ATIVO (ou suspenso por atraso) na base do
 *      dono — cancelado sai, e status desconhecido também;
 *   3. o atraso está dentro da janela de fuga (até 90 dias);
 *   4. E pelo menos uma:
 *      (a) tem dívida ativa material, ou
 *      (b) o contrato tem menos de 90 dias.
 *
 * O caso (b) existe porque o cliente novo que já sai procurando outro provedor
 * costuma ser instalação recém-feita: o provedor pagou instalação e equipamento
 * e ainda não recuperou nada.
 */

export type MotivoFuga = "divida_ativa" | "contrato_recente";

/** Por que um candidato NÃO virou alerta. Vai para o log — e explica a lista vazia. */
export type MotivoDescarte =
  | "consulta_do_proprio_dono"
  | "contrato_cancelado"
  | "status_desconhecido"
  | "sem_divida_nem_contrato_novo"
  | "atraso_incompativel_com_cliente_ativo";

export interface ClienteParaAvaliar {
  /** Status do contrato no ERP do DONO. undefined = o conector não informou. */
  contractStatus?: "active" | "cancelled" | "suspended";
  /** Início do contrato. Aceita ISO (YYYY-MM-DD) e BR (DD/MM/AAAA). */
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

/** Abaixo disso a dívida não move ninguém para outro provedor — é resíduo de fatura. */
export const DIVIDA_MINIMA = 50;
/** Menos que isso é atraso de boleto, não inadimplência. */
export const DIAS_MINIMOS_ATRASO = 15;
/** Instalação recém-paga que ainda não se pagou. */
export const DIAS_CONTRATO_NOVO = 90;
/**
 * Teto de atraso — e vale MESMO quando o ERP jura que o contrato está ativo.
 *
 * Provedor corta quem não paga: aviso por volta de 15 dias, bloqueio em 30-45,
 * cancelamento em 60-90. Alguém "ativo" com 200 dias de atraso não está
 * conectado — a base é que não foi atualizada. Passado esse ponto o caso é de
 * recuperação de equipamento e bureau, não de prevenção de fuga: não há mais
 * serviço a perder, então não há o que impedir.
 *
 * A janela de fuga é curta de propósito. É ela que separa "meu cliente está
 * saindo, posso agir" de "meu ex-cliente me deve".
 */
export const DIAS_ATRASO_TETO = 90;

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
 * O coração da regra. Recebe o cliente como o ERP do DONO o descreve e diz se
 * a consulta de um terceiro configura risco de fuga.
 */
export function avaliarRiscoDeFuga(
  cliente: ClienteParaAvaliar,
  opcoes: { consultanteEhDono: boolean; agora?: Date },
): AvaliacaoFuga {
  if (opcoes.consultanteEhDono) {
    return { alerta: false, motivos: [], descartadoPor: "consulta_do_proprio_dono" };
  }

  /* "Somente clientes ativos." Cancelado sai — e desconhecido também.
     Ausência de prova de que o cliente é ativo não é prova de que é: sem o
     sinal do contrato não dá para afirmar que há uma fuga acontecendo, e um
     alerta que o provedor não consegue verificar é ruído. Tratar undefined
     como "provavelmente ativo" era o que deixava ex-cliente passar. */
  if (cliente.contractStatus !== "active" && cliente.contractStatus !== "suspended") {
    return {
      alerta: false,
      motivos: [],
      descartadoPor: cliente.contractStatus === "cancelled" ? "contrato_cancelado" : "status_desconhecido",
    };
  }

  const inicio = parseDataContrato(cliente.contractStartDate);
  const diasDeContrato = inicio ? diasDesde(inicio, opcoes.agora) : undefined;

  // Suspenso por falta de pagamento DENTRO da janela continua sendo cliente —
  // e é justamente o perfil que migra. Fora da janela, não.
  if (cliente.maxDaysOverdue > DIAS_ATRASO_TETO) {
    return {
      alerta: false,
      motivos: [],
      descartadoPor: "atraso_incompativel_com_cliente_ativo",
      diasDeContrato,
    };
  }

  const motivos: MotivoFuga[] = [];

  const temDividaAtiva =
    cliente.totalOverdueAmount >= DIVIDA_MINIMA &&
    cliente.maxDaysOverdue >= DIAS_MINIMOS_ATRASO;
  if (temDividaAtiva) motivos.push("divida_ativa");

  if (diasDeContrato !== undefined && diasDeContrato >= 0 && diasDeContrato < DIAS_CONTRATO_NOVO) {
    motivos.push("contrato_recente");
  }

  if (motivos.length === 0) {
    return {
      alerta: false,
      motivos: [],
      descartadoPor: "sem_divida_nem_contrato_novo",
      diasDeContrato,
    };
  }

  return { alerta: true, motivos, diasDeContrato };
}

/** Rótulo do alerta na tela. Deriva do motivo, não do número de dias de atraso. */
export function rotuloDoAlerta(motivos: MotivoFuga[]): string {
  const divida = motivos.includes("divida_ativa");
  const novo = motivos.includes("contrato_recente");
  if (divida && novo) return "Fuga · dívida em contrato novo";
  if (novo) return "Fuga · contrato recente";
  return "Fuga · dívida ativa";
}

export function severidadeDoAlerta(
  motivos: MotivoFuga[],
  cliente: ClienteParaAvaliar,
): "medium" | "high" | "critical" {
  // Contrato novo E já devendo é o pior caso: o provedor pagou instalação e
  // equipamento e não recebeu uma mensalidade sequer.
  if (motivos.includes("divida_ativa") && motivos.includes("contrato_recente")) return "critical";
  if (cliente.totalOverdueAmount >= 500 || cliente.maxDaysOverdue >= 60) return "high";
  return "medium";
}
