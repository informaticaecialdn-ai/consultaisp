const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const EQUIPMENT_STATUSES = [
  "em_comodato",
  "retirada_pendente",
  "recuperado_triagem",
  "disponivel_reuso",
  "avariado",
  "nao_localizado",
  "furto_roubo_declarado",
  "baixado",
] as const;

export const RECOVERY_CASE_STATUSES = [
  "pre_recuperacao",
  "aguardando_agendamento",
  "agendado",
  "nova_tentativa",
  "devolucao_em_loja",
  "notificacao_formal",
  "contestado",
  "concluido",
  "baixado_economico",
  "prazo_expirado",
] as const;

export const RECOVERY_ATTEMPT_RESULTS = [
  "contato_confirmado",
  "sem_resposta",
  "numero_invalido",
  "reagendado",
  "ausente_horario_confirmado",
  "acesso_impedido",
  "endereco_incorreto",
  "recusa_expressa",
  "provedor_nao_compareceu",
] as const;

export type EquipmentStatus = typeof EQUIPMENT_STATUSES[number];
export type RecoveryCaseStatus = typeof RECOVERY_CASE_STATUSES[number];
export type RecoveryAttemptResult = typeof RECOVERY_ATTEMPT_RESULTS[number];

const STATUS_RECUPERADO = new Set([
  "recuperado_triagem", "disponivel_reuso", "avariado", "baixado",
  "devolvido", "returned", "recuperado", "baixa",
]);

const STATUS_PENDENTE = new Set([
  "retirada_pendente", "nao_localizado", "retido", "em_cobranca", "not_returned",
]);

const STATUS_CASO_FINAL = new Set<RecoveryCaseStatus>([
  "concluido", "baixado_economico", "prazo_expirado",
]);

export function equipamentoFoiRecuperado(status?: string | null): boolean {
  return !!status && STATUS_RECUPERADO.has(status.trim().toLowerCase());
}

export function equipamentoTemRetiradaPendente(status?: string | null): boolean {
  return !!status && STATUS_PENDENTE.has(status.trim().toLowerCase());
}

export function casoEstaEncerrado(status: string): boolean {
  return STATUS_CASO_FINAL.has(status as RecoveryCaseStatus);
}

export function calcularPrazoRetirada(dataRescisao: Date): Date {
  const prazo = new Date(dataRescisao);
  prazo.setDate(prazo.getDate() + 60);
  return prazo;
}

export function diasRestantes(prazo: Date, agora = new Date()): number {
  return Math.ceil((prazo.getTime() - agora.getTime()) / MS_PER_DAY);
}

export function faixaIdadeOcorrencia(dataRescisao: Date, agora = new Date()): string {
  const dias = Math.max(0, Math.floor((agora.getTime() - dataRescisao.getTime()) / MS_PER_DAY));
  if (dias <= 15) return "0-15 dias";
  if (dias <= 30) return "16-30 dias";
  if (dias <= 45) return "31-45 dias";
  return "46-60 dias";
}

export function faixaValorEquipamento(valor: number): string {
  if (valor <= 0) return "Valor não informado";
  if (valor <= 200) return "Até R$ 200";
  if (valor <= 500) return "R$ 200 - R$ 500";
  if (valor <= 1000) return "R$ 500 - R$ 1.000";
  return "Acima de R$ 1.000";
}

export function podeTransicionarCaso(de: string, para: RecoveryCaseStatus): boolean {
  if (de === para) return true;
  if (casoEstaEncerrado(de)) return false;
  return true;
}

export interface ValidacaoSinalBureau {
  deadlineAt: Date;
  proofReference?: string | null;
  customerNotifiedAt?: Date | null;
  disputedAt?: Date | null;
  attemptResults: Array<string | null>;
  now?: Date;
}

export function validarSinalBureau(input: ValidacaoSinalBureau): { ok: true } | { ok: false; message: string } {
  const now = input.now ?? new Date();
  if (input.deadlineAt.getTime() <= now.getTime()) {
    return { ok: false, message: "O prazo regulatório de 60 dias já expirou" };
  }
  if (!input.proofReference?.trim()) {
    return { ok: false, message: "Informe a referência do termo de comodato ou da OS de instalação" };
  }
  if (!input.customerNotifiedAt) {
    return { ok: false, message: "Registre a notificação prévia enviada ao titular" };
  }
  if (input.disputedAt) {
    return { ok: false, message: "O sinal permanece bloqueado enquanto houver contestação" };
  }

  const resultados = input.attemptResults.filter((item): item is string => !!item);
  const recusou = resultados.includes("recusa_expressa");
  const ausenciasConfirmadas = resultados.filter(item => item === "ausente_horario_confirmado").length;
  if (!recusou && ausenciasConfirmadas < 2) {
    return {
      ok: false,
      message: "Registre uma recusa expressa ou duas ausências em horários confirmados antes de publicar",
    };
  }
  return { ok: true };
}
