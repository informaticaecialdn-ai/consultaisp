/**
 * A tabela que decide o que um ARRASTO no kanban de cobrança significa.
 *
 * O quadro é o fluxo do operador (decisão do dono, 05/09/2026): A contatar →
 * Em contato → Negociando → Acordo ativo → Pago | Cancelamento, com os
 * encerrados recolhidos. Arrastar um card é uma INTENÇÃO; o que ela vira —
 * um PATCH direto, um diálogo antes do PATCH, ou uma recusa — é decidido aqui,
 * em código puro e testado, ANTES de qualquer requisição. O molde é
 * `components/recuperacao/movimentos.ts`: o kanban de equipamentos já provou
 * que a tabela fora do componente é o que impede o gesto de virar um PATCH
 * que o servidor recusa com 409 depois de a coluna já ter mudado na tela.
 *
 * Duas colunas NÃO recebem card por arrasto direto, e é de propósito:
 * - `negociando` nasce de uma negociação PROPOSTA — arrastar abre o diálogo,
 *   e é o POST da negociação que muda o status (o servidor não aceita esse
 *   status pelo PATCH do caso: "nasce da negociação");
 * - `acordo_ativo` nasce do ACEITE de uma proposta — não existe "arrastar para
 *   acordo ativo"; quem aceita é o botão da negociação, no 360.
 *
 * `cancelamento` pede motivo (o servidor exige) e, além de fechar o caso,
 * sugere abrir a recuperação do equipamento — é a ponte com o módulo de
 * equipamentos (fase 3). `baixado` e `encerrado` são só do admin (decisão do
 * revisor: operador não some com dívida); `pago` o operador pode.
 */
import { casoFechado, transicaoDeCaso, type StatusDeCaso } from "@shared/cobranca/estados";
import { proximoContato } from "./formatacao";
import type { TomDeSelo } from "./ui";

export const COLUNAS_VIVAS: readonly StatusDeCaso[] = ["aberto", "em_contato", "negociando", "acordo_ativo"];
export const COLUNAS_DESFECHO: readonly StatusDeCaso[] = ["pago", "cancelamento"];
export const COLUNAS_RECOLHIDAS: readonly StatusDeCaso[] = ["negativado", "baixado", "encerrado"];
/** A ordem visual do quadro. */
export const ORDEM_DO_QUADRO: readonly StatusDeCaso[] = [...COLUNAS_VIVAS, ...COLUNAS_DESFECHO, ...COLUNAS_RECOLHIDAS];

export const SO_ADMIN: ReadonlySet<StatusDeCaso> = new Set(["baixado", "encerrado"]);

export const MOTIVO_MESMA_COLUNA = "O caso já está nesta coluna.";
export const MOTIVO_ACORDO_NASCE_DO_ACEITE =
  "Acordo ativo nasce do aceite de uma negociação — abra a negociação no Cliente 360 e marque o aceite.";
export const MOTIVO_SO_ADMIN = "Baixar ou encerrar dívida é decisão do administrador do provedor.";
export const MOTIVO_CASO_FECHADO = "Caso fechado não volta para o quadro: abra um novo pela carteira.";

export interface CasoParaMover {
  id: number;
  status: string;
  valorAtual: number;
}

export type MovimentoDeCaso =
  | { tipo: "nenhum" }
  | { tipo: "recusado"; motivo: string }
  /** PATCH /casos/:id { status } direto, com otimismo na tela. */
  | { tipo: "direto"; status: StatusDeCaso }
  /** Abre o diálogo de negociação; o status muda quando a proposta é gravada. */
  | { tipo: "negociar" }
  /** Abre o diálogo de cancelamento (motivo obrigatório); o PATCH vai de lá. */
  | { tipo: "cancelar" };

export function avaliarMovimentoDeCaso(
  caso: CasoParaMover,
  destino: StatusDeCaso,
  contexto: { podeAdministrar: boolean },
): MovimentoDeCaso {
  if (caso.status === destino) return { tipo: "nenhum" };
  if (casoFechado(caso.status)) return { tipo: "recusado", motivo: MOTIVO_CASO_FECHADO };
  if (destino === "acordo_ativo") return { tipo: "recusado", motivo: MOTIVO_ACORDO_NASCE_DO_ACEITE };
  if (SO_ADMIN.has(destino) && !contexto.podeAdministrar) return { tipo: "recusado", motivo: MOTIVO_SO_ADMIN };

  // A máquina de estados compartilhada é a última palavra: o que ela recusa
  // aqui, o servidor recusaria com 409 — só que com a coluna já pintada.
  const transicao = transicaoDeCaso(caso.status as StatusDeCaso, destino);
  if (!transicao.ok) return { tipo: "recusado", motivo: transicao.motivo };

  if (destino === "negociando") return { tipo: "negociar" };
  if (destino === "cancelamento") return { tipo: "cancelar" };
  return { tipo: "direto", status: destino };
}

/** Frase curta do toast quando o movimento direto dá certo. */
export function tituloDoMovimento(destino: StatusDeCaso): string {
  switch (destino) {
    case "em_contato": return "Caso marcado como em contato";
    case "aberto": return "Caso de volta à fila";
    case "pago": return "Caso encerrado como pago";
    case "negativado": return "Caso marcado como negativado";
    case "baixado": return "Dívida baixada";
    case "encerrado": return "Caso encerrado";
    case "cancelamento": return "Contrato em cancelamento";
    default: return "Caso movido";
  }
}

/* ── Cores do funil (pedido do dono, 05/09/2026: "cores por tipo de etapa do funil") ── */

/** O tom de cada coluna do fluxo: a contatar e neutro, em contato informa, negociando pede atencao, acordo e pago sao bons, negativado e perigo, cancelamento e passado. */
export const TOM_DA_COLUNA: Record<string, TomDeSelo> = {
  aberto: "neutro",
  em_contato: "info",
  negociando: "gated",
  acordo_ativo: "ok",
  pago: "ok",
  negativado: "danger",
  cancelamento: "past",
  baixado: "neutro",
  encerrado: "neutro",
};

export function tomDaColunaDoKanban(status: string): TomDeSelo {
  return TOM_DA_COLUNA[status] ?? "neutro";
}

/** A cor de cada tom, para a borda da coluna e a contagem — os mesmos tokens dos selos. */
export const COR_DO_TOM: Record<TomDeSelo, string> = {
  ok: "var(--ok)",
  gated: "var(--gated)",
  past: "var(--past)",
  danger: "var(--danger)",
  info: "var(--info)",
  marca: "var(--brand)",
  neutro: "var(--text-faint)",
};

/**
 * O tom da ETAPA da regua no selo do card: lembretes informam (azul), aviso de
 * suspensao e negociacao pedem atencao (ambar), pre-negativacao e perigo
 * (vermelho), divida antiga e fim de linha sao passado (vinho). O funil de
 * cores acompanha o atraso: quanto mais a direita, mais quente.
 */
export const TOM_DA_ETAPA: Record<string, TomDeSelo> = {
  lembrete_pre_vencimento: "info",
  lembrete_atraso: "info",
  aviso_suspensao: "gated",
  negociacao_recuperacao: "gated",
  pre_negativacao: "danger",
  divida_antiga: "past",
  fim_de_linha: "past",
};

export function tomDaEtapaDaRegua(etapaId: string | null | undefined): TomDeSelo {
  return (etapaId && TOM_DA_ETAPA[etapaId]) || "marca";
}

/* ── A coluna como POSTO DE TRABALHO (pedido do dono, 06/09/2026) ────────── */

/**
 * "O kanban precisa ser uma esteira de resolução da cobrança". Numa esteira,
 * cada posto diz O QUE SE FAZ ali para a peça sair — senão a coluna é só uma
 * gaveta com um rótulo. O VERBO é isso: a ação que tira o caso desta coluna.
 *
 * As colunas de desfecho (pago, cancelamento, negativado, baixado, encerrado)
 * não têm verbo de propósito: o caso já saiu da esteira, não há trabalho a
 * fazer ali. `null` é ausência de verbo, e a tela não escreve nada.
 */
export const VERBO_DA_COLUNA: Record<StatusDeCaso, string | null> = {
  aberto: "registrar contato",
  em_contato: "propor acordo",
  negociando: "registrar o aceite",
  acordo_ativo: "conferir a parcela",
  pago: null,
  negativado: null,
  cancelamento: null,
  baixado: null,
  encerrado: null,
};

export function verboDaColuna(status: string): string | null {
  return VERBO_DA_COLUNA[status as StatusDeCaso] ?? null;
}

/**
 * O botão de acordo que o card oferece, pelo verbo da coluna: em contato se
 * PROPÕE, negociando se REGISTRA o aceite. Nas outras colunas não há botão de
 * acordo — em "aberto" o trabalho é o contato, e no desfecho não há trabalho.
 */
export const ROTULO_DO_BOTAO_DE_ACORDO: Record<string, string> = {
  em_contato: "Propor acordo",
  negociando: "Registrar aceite",
};

/**
 * PARA ONDE o botao de acordo leva — e por que os dois destinos existem.
 *
 * "Propor acordo" abre o dialogo, que CRIA a negociacao. Em "negociando" isso
 * daria 409 sempre: o caso so esta nessa coluna porque ja tem negociacao viva
 * (foi ela que o moveu), e o storage recusa a segunda com NEGOCIACAO_VIVA
 * ("cancele-a antes de propor outra"). O aceite mora na ficha do cliente.
 * Achado da revisao de 06/09/2026: o botao principal da coluna levava toda a
 * populacao dela a um erro garantido.
 */
export type DestinoDoBotaoDeAcordo = "dialogo" | "ficha";

export function destinoDoBotaoDeAcordo(status: string): DestinoDoBotaoDeAcordo {
  return status === "negociando" ? "ficha" : "dialogo";
}

export function rotuloDoBotaoDeAcordo(status: string): string | null {
  return ROTULO_DO_BOTAO_DE_ACORDO[status] ?? null;
}

/**
 * Qual botão é o PRINCIPAL do card. Só "negociando" troca: ali o trabalho é
 * fechar o acordo, e oferecer "Contato" em destaque manda o operador repetir
 * o que ele já fez. Nas demais colunas o principal continua o contato — o
 * botão de acordo, quando existe, entra como secundário.
 */
export type AcaoPrincipalDoCard = "contato" | "acordo";

export function acaoPrincipalDoCard(status: string): AcaoPrincipalDoCard {
  return status === "negociando" ? "acordo" : "contato";
}
/* O destino do botao principal de "negociando" e a ficha — ver destinoDoBotaoDeAcordo. */

/**
 * O que TRAVA a coluna. Numa esteira o que importa não é quantos passaram, e
 * sim quantos estão empacados — e por quê:
 * - `contatoVencido`: passou da data marcada e ninguém falou com o cliente;
 * - `semProximaAcao`: caso vivo sem data de próximo contato — está parado, e
 *   parado vira dívida perdida (regra do dono, 05/09/2026). É o mesmo corte
 *   do KPI `semProximaAcao` da rota e do card em vermelho;
 * - `semDono`: na fila geral, ninguém puxou o caso.
 *
 * As três contas são sobre os casos QUE A COLUNA RECEBEU. Quando a coluna vem
 * truncada (`porColuna` da rota), isso é a página e não a coluna inteira — a
 * tela é obrigada a dizer isso, e diz.
 */
export interface CasoNaColuna {
  responsavelUserId: number | null;
  proximoContatoEm: string | null;
}

export interface GargalosDaColuna {
  contatoVencido: number;
  semProximaAcao: number;
  semDono: number;
  /** Quantos casos entraram nesta conta — a base do "de N". */
  base: number;
}

export function contarGargalosDaColuna(casos: readonly CasoNaColuna[], hoje: Date): GargalosDaColuna {
  let contatoVencido = 0;
  let semProximaAcao = 0;
  let semDono = 0;
  for (const caso of casos) {
    const urgencia = proximoContato(caso.proximoContatoEm, hoje).urgencia;
    if (urgencia === "vencido") contatoVencido += 1;
    if (urgencia === "sem_data") semProximaAcao += 1;
    if (caso.responsavelUserId === null) semDono += 1;
  }
  return { contatoVencido, semProximaAcao, semDono, base: casos.length };
}

/**
 * O TEMPO NA COLUNA esquenta com a espera. Os cortes são ESCOLHA NOSSA
 * (06/09/2026), não medição: não existe base histórica de tempo por coluna
 * — a coluna `status_desde` nasce agora. Vêm da régua, que é o único ritmo
 * escrito do produto: ela cobra a cada poucos dias, então dois dias parados
 * ainda é trabalho em curso, três a seis já é atraso do operador, e uma
 * semana no mesmo posto é o gargalo que o dono quer enxergar. Quando houver
 * histórico, refaça sobre ele — e troque este comentário.
 */
export const CORTES_DO_TEMPO_NA_COLUNA = { atencao: 3, perigo: 7 } as const;

export function tomDoTempoNaColuna(dias: number | null | undefined): TomDeSelo {
  if (dias === null || dias === undefined) return "neutro";
  if (dias >= CORTES_DO_TEMPO_NA_COLUNA.perigo) return "danger";
  if (dias >= CORTES_DO_TEMPO_NA_COLUNA.atencao) return "gated";
  return "neutro";
}
