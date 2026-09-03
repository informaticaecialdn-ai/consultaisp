/**
 * Contrato do kanban de recuperação — espelho de `GET /api/equipment/recovery-board`
 * (spec docs/superpowers/specs/2026-09-02-recuperacao-kanban.md).
 *
 * O frontend programa contra este contrato, não contra o código do servidor:
 * as duas frentes foram feitas em paralelo, e o que as amarra é a spec.
 * Rótulos de status, prioridade, canal e resultado moram aqui porque três
 * componentes (card, drawer, diálogos) mostram a mesma palavra para a mesma
 * chave — dois dicionários divergindo é o operador lendo "Concluído" num
 * lugar e "Encerrado" no outro.
 */

export type ColunaKanban = "sem_data" | "ate30" | "31a60" | "61a90" | "mais90" | "recuperado" | "baixado";

export interface EquipamentoKanban {
  id: number;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  mac: string | null;
  patrimonio: string | null;
  /** Em reais. */
  valor: number | null;
  status: string;
}

export interface ClienteKanban {
  id: number;
  nome: string;
  /** Já formatado (000.000.000-00). */
  documento: string;
  telefone: string | null;
  /** Só dígitos, com 55 na frente — pronto para `https://wa.me/`. */
  whatsapp: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  situacao: string;
  dividaEmAberto: number;
  diasEmAtraso: number;
}

export interface UltimaTentativa {
  canal: string | null;
  resultado: string | null;
  em: string;
}

export interface CasoKanban {
  status: string;
  prioridade: string;
  rescisaoEm: string;
  prazoAt: string;
  /** hoje − rescisão, em dias civis. */
  diasRetido: number;
  /** prazo − hoje; negativo = vencido. */
  diasRestantes: number;
  agendadoEm: string | null;
  metodo: string | null;
  responsavel: { id: number; nome: string } | null;
  notificadoEm: string | null;
  bureauStatus: string;
  contestadoEm: string | null;
  encerradoEm: string | null;
  notas: string | null;
  tentativas: { total: number; ultima: UltimaTentativa | null };
}

export interface CardKanban {
  /** "caso:123" ou "equip:45" — id estável para o dnd-kit e para o React. */
  chave: string;
  coluna: ColunaKanban;
  /** null só em `sem_data`. */
  caseId: number | null;
  equipamento: EquipamentoKanban;
  cliente: ClienteKanban;
  caso: CasoKanban | null;
}

export interface ColunaResumo {
  chave: ColunaKanban;
  rotulo: string;
  cards: number;
  valor: number;
}

export interface Responsavel {
  id: number;
  nome: string;
}

export interface BoardKanban {
  geradoEm: string;
  colunas: ColunaResumo[];
  cards: CardKanban[];
  kpis: {
    retidos: number;
    valorEmRisco: number;
    prazoCritico: number;
    recuperados30d: number;
    valorRecuperado30d: number;
  };
  responsaveis: Responsavel[];
}

/** Evento da linha do tempo — `GET /api/equipment/recovery-cases/:id/events`. */
export interface EventoCaso {
  id: number;
  type: string;
  channel: string | null;
  result: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  notes: string | null;
  occurredAt: string;
}

/* ── Vocabulário ─────────────────────────────────────────────────────── */

export const ORDEM_COLUNAS: readonly ColunaKanban[] = [
  "sem_data", "ate30", "31a60", "61a90", "mais90", "recuperado", "baixado",
];

export const ROTULO_COLUNA: Record<ColunaKanban, string> = {
  sem_data: "Sem data de rescisão",
  ate30: "Até 30 dias",
  "31a60": "31 a 60 dias",
  "61a90": "61 a 90 dias",
  mais90: "Mais de 90 dias",
  recuperado: "Recuperados",
  baixado: "Baixados",
};

/** Etapas em que o caso ainda está aberto — o select de etapa só oferece estas. */
export const ETAPAS_ABERTAS = [
  "pre_recuperacao",
  "aguardando_agendamento",
  "agendado",
  "nova_tentativa",
  "devolucao_em_loja",
  "notificacao_formal",
  "contestado",
] as const;

export const ROTULO_ETAPA: Record<string, string> = {
  pre_recuperacao: "Pré-recuperação",
  aguardando_agendamento: "Aguardando agendamento",
  agendado: "Agendado",
  nova_tentativa: "Nova tentativa",
  devolucao_em_loja: "Devolução em loja",
  notificacao_formal: "Notificação formal",
  contestado: "Contestado",
  concluido: "Concluído",
  baixado_economico: "Baixado economicamente",
  prazo_expirado: "Prazo expirado",
};

export const PRIORIDADES = ["critica", "alta", "normal", "baixa"] as const;
export type Prioridade = typeof PRIORIDADES[number];

export const ROTULO_PRIORIDADE: Record<string, string> = {
  critica: "Crítica",
  alta: "Alta",
  normal: "Normal",
  baixa: "Baixa",
};

export const CANAIS = ["whatsapp", "telefone", "email", "visita", "loja", "logistica_reversa"] as const;
export type Canal = typeof CANAIS[number];

export const ROTULO_CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  email: "E-mail",
  visita: "Visita técnica",
  loja: "Loja",
  logistica_reversa: "Logística reversa",
};

export const RESULTADOS_TENTATIVA = [
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
export type ResultadoTentativa = typeof RESULTADOS_TENTATIVA[number];

export const ROTULO_RESULTADO: Record<string, string> = {
  contato_confirmado: "Contato confirmado",
  sem_resposta: "Sem resposta",
  numero_invalido: "Número inválido",
  reagendado: "Reagendado",
  ausente_horario_confirmado: "Ausente no horário confirmado",
  acesso_impedido: "Acesso impedido",
  endereco_incorreto: "Endereço incorreto",
  recusa_expressa: "Recusa expressa",
  provedor_nao_compareceu: "Provedor não compareceu",
};

export const METODOS_COLETA = ["retirada", "entrega_loja", "logistica_reversa"] as const;
export type MetodoColeta = typeof METODOS_COLETA[number];

export const ROTULO_METODO: Record<string, string> = {
  retirada: "Retirada gratuita",
  entrega_loja: "Entrega em loja",
  logistica_reversa: "Logística reversa",
};

export const ROTULO_STATUS_EQUIPAMENTO: Record<string, string> = {
  em_comodato: "Em comodato",
  retirada_pendente: "Retirada pendente",
  recuperado_triagem: "Recuperado / triagem",
  disponivel_reuso: "Disponível para reuso",
  avariado: "Avariado",
  nao_localizado: "Não localizado",
  furto_roubo_declarado: "Furto/roubo declarado",
  baixado: "Baixado",
  installed: "Em comodato",
  retido: "Retirada pendente",
  em_cobranca: "Retirada pendente",
  not_returned: "Retirada pendente",
  devolvido: "Recuperado",
  returned: "Recuperado",
};

/** Chaves de invalidação: tudo que muda quando um caso muda. */
export const QUERIES_AFETADAS = [
  "/api/equipment/recovery-board",
  "/api/equipment/recovery-cases",
  "/api/equipment",
  "/api/dashboard/stats",
] as const;

export const QUERY_BOARD = "/api/equipment/recovery-board";
