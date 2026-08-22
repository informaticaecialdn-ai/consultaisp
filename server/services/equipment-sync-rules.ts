/**
 * Decide o que o sync de ERP faz com cada equipamento.
 *
 * Regra do produto: MANUAL VENCE. O equipamento digitado a mao existe
 * justamente porque o ERP nao o tinha; sobrescrever destruiria dado real.
 *
 * EXCECAO (unica escrita do sync sobre linha existente): quando o ERP confirma
 * DEVOLUCAO, atualizamos. Sem isso um aparelho ja devolvido seguiria marcado
 * como retido e penalizaria o score de quem devolveu — num bureau isso e
 * acusacao errada. A excecao so corrige para menos, nunca para mais.
 *
 * Para remover a excecao, apague o ramo `marcar-devolvido` abaixo.
 */

export type AcaoSync = 'inserir' | 'marcar-devolvido' | 'ignorar';

export interface EquipamentoExistente {
  id: number;
  serialNumber: string | null;
  status: string;
}

export interface EquipamentoErp {
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  value: string;
  inRecoveryProcess: boolean;
  status?: string;
}

/** Vocabularios de devolucao que os ERPs usam; nenhum deles padroniza isso. */
const STATUS_DEVOLVIDO = ['devolvido', 'returned', 'baixa', 'baixado'];

export function ehDevolvido(status?: string | null): boolean {
  if (!status) return false;
  return STATUS_DEVOLVIDO.includes(status.trim().toLowerCase());
}

export function decidirAcaoSync(
  existente: EquipamentoExistente | undefined,
  entrando: EquipamentoErp,
): AcaoSync {
  // Sem serie nao ha como casar com seguranca: nao inserimos duplicata a cada sync.
  if (!entrando.serialNumber?.trim()) return 'ignorar';

  if (!existente) return 'inserir';

  if (ehDevolvido(entrando.status) && !ehDevolvido(existente.status)) {
    return 'marcar-devolvido';
  }

  return 'ignorar';
}
