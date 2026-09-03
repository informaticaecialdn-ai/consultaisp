/**
 * Regras do kanban de recuperação — o que um arrasto entre colunas significa.
 *
 * Função pura, sem React e sem rede, para o teste dizer exatamente a tabela da
 * spec ("Movimentos permitidos"). A tela só traduz o resultado em PATCH,
 * diálogo ou toast; a decisão mora aqui e em nenhum outro lugar.
 *
 * O princípio por trás da tabela: a idade é FATO (dias desde a rescisão),
 * não etapa. Por isso nenhum arrasto muda a idade — o que muda é o desfecho
 * do caso (recuperado / baixado) ou a existência dele (abrir caso).
 */
import type { CardKanban, ColunaKanban } from "./tipos";

export const COLUNAS_IDADE: readonly ColunaKanban[] = ["ate30", "31a60", "61a90", "mais90"];
export const COLUNAS_ENCERRADAS: readonly ColunaKanban[] = ["recuperado", "baixado"];

export const ehColunaIdade = (coluna: ColunaKanban): boolean => COLUNAS_IDADE.includes(coluna);
export const ehColunaEncerrada = (coluna: ColunaKanban): boolean => COLUNAS_ENCERRADAS.includes(coluna);

export type Movimento =
  /** Soltou onde já estava: nada a fazer, sem aviso. */
  | { tipo: "nenhum" }
  /** Movimento proibido — o motivo vai para o toast. */
  | { tipo: "recusado"; motivo: string }
  /** idade → recuperado: `PATCH { status: "concluido" }`. */
  | { tipo: "concluir"; caseId: number }
  /** idade → baixado: `PATCH { status: "baixado_economico" }`, com confirmação. */
  | { tipo: "baixar"; caseId: number }
  /** sem_data → idade: abre o diálogo de abrir caso; a idade real vem do servidor. */
  | { tipo: "abrir_caso"; equipamentoId: number };

export const MOTIVO_IDADE_FIXA = "A idade vem da data de rescisão — não dá para mudá-la arrastando.";
export const MOTIVO_ENCERRADO = "Caso encerrado não volta para a fila de recuperação.";
export const MOTIVO_SEM_CASO = "Abra o caso primeiro: sem data de rescisão não há o que concluir nem baixar.";
export const MOTIVO_SEM_ID = "Este card não tem caso aberto para mover.";

type CardParaMovimento = Pick<CardKanban, "coluna" | "caseId"> & { equipamento: Pick<CardKanban["equipamento"], "id"> };

export function avaliarMovimento(card: CardParaMovimento, destino: ColunaKanban): Movimento {
  const origem = card.coluna;
  if (origem === destino) return { tipo: "nenhum" };

  // Encerrado é terminal: a regra já existe no servidor (409); aqui só se evita a viagem.
  if (ehColunaEncerrada(origem)) return { tipo: "recusado", motivo: MOTIVO_ENCERRADO };

  if (origem === "sem_data") {
    if (ehColunaIdade(destino)) return { tipo: "abrir_caso", equipamentoId: card.equipamento.id };
    return { tipo: "recusado", motivo: MOTIVO_SEM_CASO };
  }

  // Daqui em diante a origem é uma coluna de idade.
  if (ehColunaIdade(destino)) return { tipo: "recusado", motivo: MOTIVO_IDADE_FIXA };
  if (destino === "sem_data") return { tipo: "recusado", motivo: MOTIVO_IDADE_FIXA };
  if (card.caseId === null) return { tipo: "recusado", motivo: MOTIVO_SEM_ID };
  if (destino === "recuperado") return { tipo: "concluir", caseId: card.caseId };
  return { tipo: "baixar", caseId: card.caseId };
}

/** Faixa de cor do "dias retido" — os limites são os das colunas, inclusivos. */
export type FaixaIdade = "ok" | "gated" | "past" | "danger";

export function faixaDosDias(diasRetido: number): FaixaIdade {
  if (diasRetido <= 30) return "ok";
  if (diasRetido <= 60) return "gated";
  if (diasRetido <= 90) return "past";
  return "danger";
}

/** Prazo regulatório em palavras: "vence em 5 dias" / "vence hoje" / "vencido há 3 dias". */
export function textoPrazo(diasRestantes: number): string {
  if (diasRestantes > 1) return `vence em ${diasRestantes} dias`;
  if (diasRestantes === 1) return "vence amanhã";
  if (diasRestantes === 0) return "vence hoje";
  const atraso = -diasRestantes;
  return atraso === 1 ? "vencido há 1 dia" : `vencido há ${atraso} dias`;
}

/* ── Filtros ──────────────────────────────────────────────────────────── */

export interface FiltrosKanban {
  busca: string;
  /** "todas" ou uma prioridade. */
  prioridade: string;
  /** "todos", "sem" (sem responsável) ou o id do usuário como string. */
  responsavel: string;
  /** "todas" ou o nome da cidade. */
  cidade: string;
}

export const FILTROS_INICIAIS: FiltrosKanban = { busca: "", prioridade: "todas", responsavel: "todos", cidade: "todas" };

// Bloco Unicode "Combining Diacritical Marks" (U+0300–U+036F): depois do NFD, o
// acento vira um destes e some. Montado por code point porque o alvo do tsconfig
// não aceita a flag `u`, e o intervalo escrito com \u dentro de colchetes já
// virou caractere literal em edição automática uma vez — assim não tem como.
const MARCAS_DIACRITICAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

const normalizar = (valor: string | null | undefined) =>
  (valor ?? "").toLowerCase().normalize("NFD").replace(MARCAS_DIACRITICAS, "");

/** Busca por cliente, documento, série, MAC ou patrimônio; acento e caixa não importam. */
export function filtrarCards(cards: CardKanban[], filtros: FiltrosKanban): CardKanban[] {
  const termo = normalizar(filtros.busca.trim());
  const digitos = termo.replace(/\D/g, "");
  return cards.filter(card => {
    if (filtros.prioridade !== "todas" && card.caso?.prioridade !== filtros.prioridade) return false;
    if (filtros.responsavel === "sem") {
      if (card.caso?.responsavel) return false;
    } else if (filtros.responsavel !== "todos") {
      if (String(card.caso?.responsavel?.id ?? "") !== filtros.responsavel) return false;
    }
    if (filtros.cidade !== "todas" && normalizar(card.cliente.cidade) !== normalizar(filtros.cidade)) return false;
    if (!termo) return true;
    const textos = [
      card.cliente.nome, card.equipamento.serie, card.equipamento.mac, card.equipamento.patrimonio,
      card.equipamento.tipo, card.equipamento.marca, card.equipamento.modelo,
    ];
    if (textos.some(valor => normalizar(valor).includes(termo))) return true;
    // Documento: o operador digita com ou sem pontuação; compara-se só os dígitos.
    return digitos.length > 0 && card.cliente.documento.replace(/\D/g, "").includes(digitos);
  });
}

/** Cidades distintas dos cards, em ordem alfabética, para o filtro. */
export function cidadesDosCards(cards: CardKanban[]): string[] {
  const set = new Set<string>();
  for (const card of cards) if (card.cliente.cidade) set.add(card.cliente.cidade);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}
