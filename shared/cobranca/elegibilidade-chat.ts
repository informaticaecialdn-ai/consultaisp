import { orientarContato } from "./contato";
import type { Etapa } from "./regua";

export interface CandidatoAoContato {
  id: number;
  carteira: string | null;
  carteiraDoCaso?: string;
  diasAtraso: number | null;
  tom?: string | null;
  quadrante?: string | null;
  telefoneValido?: boolean;
  proximoContatoEm?: Date | string | null;
}

/** Mesma decisão para a fila e sua prévia. Não autoriza transporte nem revela dados. */
export function avaliarCandidatoAoContato(c: CandidatoAoContato, carteiras: readonly string[], etapas: readonly Etapa[], agora: Date) {
  const orientacao = orientarContato({ ...c, carteira: c.carteira ?? "desconhecida", diasAtraso: c.diasAtraso ?? 0, etapas });
  let motivo: string | null = null;
  if (!c.carteira) motivo = "Situação do contrato não reconhecida no ERP";
  else if (c.carteiraDoCaso && c.carteiraDoCaso !== c.carteira) motivo = "Caso precisa ser atualizado para a carteira atual do ERP";
  else if (!carteiras.includes(c.carteira)) motivo = "Carteira desativada na automação";
  else if (c.telefoneValido === false) motivo = "Telefone ausente ou inválido";
  else if (c.proximoContatoEm && (!Number.isFinite(new Date(c.proximoContatoEm).getTime()) || new Date(c.proximoContatoEm) > agora)) motivo = "Aguardando a data do próximo contato";
  else if (!orientacao.automatizavel) motivo = orientacao.agente === "Acolhimento humano" ? "Atendimento humano por vulnerabilidade" : "Etapa reservada à revisão humana ou fora da régua";
  return { elegivel: motivo === null, motivo, orientacao };
}
