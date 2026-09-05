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
