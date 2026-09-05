/**
 * VOCABULÁRIO E MÁQUINAS DE ESTADO DA COBRANÇA.
 *
 * Um caso é a vida do cliente dentro da cobrança; uma negociação é um acordo
 * dentro do caso. Os dois têm status, e o que é permitido mudar de um para o
 * outro mora AQUI, e em nenhum outro lugar — a rota devolve 409 com o motivo
 * que sai daqui, e a tela desabilita o botão pelo mesmo motivo. Molde: o
 * kanban de recuperação (`client/src/components/recuperacao/movimentos.ts`).
 *
 * As listas de tipo, canal, resultado e prioridade também vivem aqui porque
 * três lugares (rota, drawer e linha do tempo) mostram a mesma palavra para a
 * mesma chave. Dois dicionários divergindo é o operador lendo "Encerrado" num
 * card e "Fechado" no outro.
 *
 * Módulo puro: sem banco, sem React, sem I/O.
 */

/* ── Carteiras ────────────────────────────────────────────────────────── */

/** Fixada na abertura do caso: o cliente que cancelou depois continua na régua em que entrou. */
export const CARTEIRAS = ["ativo", "ex_cliente"] as const;
export type Carteira = (typeof CARTEIRAS)[number];

export const ROTULO_CARTEIRA: Record<Carteira, string> = {
  ativo: "Clientes",
  ex_cliente: "Ex-clientes",
};

/* ── Caso ─────────────────────────────────────────────────────────────── */

/**
 * Na ordem do kanban do operador (decisão do dono, 05/09/2026): A contatar
 * (aberto) → Em contato → Negociando → Acordo ativo → Pago | Cancelamento,
 * com os demais fechados recolhidos em "Encerrados".
 *
 * `em_contato`: o operador já falou com o cliente e aguarda — a coluna que
 * separa "ninguém ligou ainda" de "estamos conversando". Não tem evento
 * próprio: o contato registrado é o que conta a história.
 *
 * `cancelamento`: terminal. O contrato entrou em cancelamento — pelo ERP ou
 * pela mão do operador — e o motivo é obrigatório, porque é o que o
 * funcionário lê antes de ir buscar o equipamento (o CRM de recuperação é a
 * sugestão que acompanha o movimento).
 */
export const STATUS_DE_CASO = [
  "aberto",
  "em_contato",
  "negociando",
  "acordo_ativo",
  "pago",
  "baixado",
  "negativado",
  "encerrado",
  "cancelamento",
] as const;
export type StatusDeCaso = (typeof STATUS_DE_CASO)[number];

/**
 * Fechados: saem da fila e liberam o índice único parcial de "um caso aberto
 * por cliente". `negativado` NÃO é fechado — a dívida continua existindo e o
 * funcionário continua trabalhando o caso até pagar, baixar ou encerrar.
 * `cancelamento` é: contrato cancelado é outro caso, o da recuperação.
 */
export const STATUS_FECHADOS_DE_CASO = ["pago", "baixado", "encerrado", "cancelamento"] as const;
export type StatusFechadoDeCaso = (typeof STATUS_FECHADOS_DE_CASO)[number];

export const STATUS_ABERTOS_DE_CASO = ["aberto", "em_contato", "negociando", "acordo_ativo", "negativado"] as const;

export function casoFechado(status: string): status is StatusFechadoDeCaso {
  return (STATUS_FECHADOS_DE_CASO as readonly string[]).includes(status);
}

export const ROTULO_STATUS_DE_CASO: Record<StatusDeCaso, string> = {
  aberto: "Aberto",
  em_contato: "Em contato",
  negociando: "Negociando",
  acordo_ativo: "Acordo ativo",
  pago: "Pago",
  baixado: "Baixado",
  negativado: "Negativado",
  encerrado: "Encerrado",
  cancelamento: "Cancelamento",
};

/** Todo status vivo pode ir a qualquer desfecho — cancelamento incluso: o contrato acabou, seja em que coluna o caso estiver. */
const DESFECHOS = ["pago", "baixado", "encerrado", "cancelamento"] as const;

export const TRANSICOES_DE_CASO: Record<StatusDeCaso, readonly StatusDeCaso[]> = {
  aberto: ["em_contato", "negociando", "acordo_ativo", "negativado", ...DESFECHOS],
  // Conversa que esfriou volta à fila; que avançou vira proposta ou acordo.
  em_contato: ["aberto", "negociando", "acordo_ativo", "negativado", ...DESFECHOS],
  // Proposta recusada ou cancelada devolve o caso à fila ou à conversa.
  negociando: ["aberto", "em_contato", "acordo_ativo", "negativado", ...DESFECHOS],
  // Acordo quebrado volta à fila, à conversa ou a uma nova negociação; cumprido vira pago.
  acordo_ativo: ["aberto", "em_contato", "negociando", "negativado", ...DESFECHOS],
  // A negativação continua até o desfecho: não há "voltar para a fila".
  negativado: ["negociando", "acordo_ativo", ...DESFECHOS],
  pago: [],
  baixado: [],
  encerrado: [],
  cancelamento: [],
};

export type ResultadoDaTransicao = { ok: true } | { ok: false; motivo: string };

export const MOTIVO_CASO_FECHADO = "Caso fechado é definitivo: para voltar a cobrar, abra um caso novo.";
export const MOTIVO_NEGATIVADO_NAO_VOLTA =
  "Cliente negativado não volta à fila: a negativação continua até pagar, baixar ou encerrar.";

export function transicaoDeCaso(de: StatusDeCaso, para: StatusDeCaso): ResultadoDaTransicao {
  if (de === para) return { ok: false, motivo: `O caso já está em "${ROTULO_STATUS_DE_CASO[de]}".` };
  if (casoFechado(de)) return { ok: false, motivo: MOTIVO_CASO_FECHADO };
  if (de === "negativado" && (para === "aberto" || para === "em_contato")) {
    return { ok: false, motivo: MOTIVO_NEGATIVADO_NAO_VOLTA };
  }
  if (!TRANSICOES_DE_CASO[de].includes(para)) {
    return {
      ok: false,
      motivo: `De "${ROTULO_STATUS_DE_CASO[de]}" não se vai para "${ROTULO_STATUS_DE_CASO[para]}".`,
    };
  }
  return { ok: true };
}

/**
 * Para onde o caso volta quando a negociação se desfaz (cancelada ou
 * quebrada). A regra geral é "de volta à fila" (`aberto`). A exceção é o
 * negativado: a proposta não desfez a negativação, e mandar o caso para a
 * fila apagaria um fato que continua valendo no bureau — foi o achado da
 * revisão: a cascata devolvia todo caso a `aberto`, e o negativado perdia um
 * status que a máquina de estados proíbe recuperar por qualquer outro caminho.
 *
 * `statusAnterior` é o status que o caso tinha ANTES de entrar na negociação.
 * Quem o descobre é o storage, pela linha do tempo; aqui só se decide.
 */
export function statusAposNegociacaoDesfeita(statusAnterior: StatusDeCaso | null | undefined): "aberto" | "negativado" {
  return statusAnterior === "negativado" ? "negativado" : "aberto";
}

/* ── Negociação ───────────────────────────────────────────────────────── */

export const TIPOS_DE_NEGOCIACAO = ["parcelamento", "quitacao_desconto", "baixa_negociada"] as const;
export type TipoDeNegociacao = (typeof TIPOS_DE_NEGOCIACAO)[number];

export const ROTULO_TIPO_DE_NEGOCIACAO: Record<TipoDeNegociacao, string> = {
  parcelamento: "Parcelamento",
  quitacao_desconto: "Quitação com desconto",
  baixa_negociada: "Baixa negociada",
};

export const STATUS_DE_NEGOCIACAO = ["proposta", "aceita", "ativa", "cumprida", "quebrada", "cancelada"] as const;
export type StatusDeNegociacao = (typeof STATUS_DE_NEGOCIACAO)[number];

export const STATUS_FINAIS_DE_NEGOCIACAO = ["cumprida", "quebrada", "cancelada"] as const;

/** Só uma destas por caso de cada vez: propor outra exige desfazer a que existe. */
export const STATUS_VIVOS_DE_NEGOCIACAO = ["proposta", "aceita", "ativa"] as const;

export function negociacaoEncerrada(status: string): boolean {
  return (STATUS_FINAIS_DE_NEGOCIACAO as readonly string[]).includes(status);
}

export const ROTULO_STATUS_DE_NEGOCIACAO: Record<StatusDeNegociacao, string> = {
  proposta: "Proposta",
  aceita: "Aceita",
  ativa: "Ativa",
  cumprida: "Cumprida",
  quebrada: "Quebrada",
  cancelada: "Cancelada",
};

export const TRANSICOES_DE_NEGOCIACAO: Record<StatusDeNegociacao, readonly StatusDeNegociacao[]> = {
  proposta: ["aceita", "cancelada"],
  // Aceita mas a entrada nunca veio: quebrada. Cancelada só antes de começar a pagar.
  aceita: ["ativa", "quebrada", "cancelada"],
  // Renegociar cancela a ativa e abre outra: por isso "cancelada" continua possível.
  ativa: ["cumprida", "quebrada", "cancelada"],
  cumprida: [],
  quebrada: [],
  cancelada: [],
};

export const MOTIVO_NEGOCIACAO_ENCERRADA =
  "Negociação encerrada não muda mais: quebrada ou cancelada, faça uma nova proposta.";

export function transicaoDeNegociacao(de: StatusDeNegociacao, para: StatusDeNegociacao): ResultadoDaTransicao {
  if (de === para) return { ok: false, motivo: `A negociação já está em "${ROTULO_STATUS_DE_NEGOCIACAO[de]}".` };
  if (negociacaoEncerrada(de)) return { ok: false, motivo: MOTIVO_NEGOCIACAO_ENCERRADA };
  if (!TRANSICOES_DE_NEGOCIACAO[de].includes(para)) {
    return {
      ok: false,
      motivo: `De "${ROTULO_STATUS_DE_NEGOCIACAO[de]}" não se vai para "${ROTULO_STATUS_DE_NEGOCIACAO[para]}".`,
    };
  }
  return { ok: true };
}

/* ── Parcela ──────────────────────────────────────────────────────────── */

export const STATUS_DE_PARCELA = ["pendente", "paga", "atrasada", "cancelada"] as const;
export type StatusDeParcela = (typeof STATUS_DE_PARCELA)[number];

export const ROTULO_STATUS_DE_PARCELA: Record<StatusDeParcela, string> = {
  pendente: "Pendente",
  paga: "Paga",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
};

/* ── Linha do tempo ───────────────────────────────────────────────────── */

export const TIPOS_DE_EVENTO = [
  "contato",
  "promessa",
  "negociacao_proposta",
  "acordo_aceito",
  "acordo_quebrado",
  "parcela_paga",
  "etapa_mudou",
  "responsavel_mudou",
  "nota",
  "suspensao",
  "negativacao",
  "encerramento",
  "cancelamento",
] as const;
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

export const ROTULO_TIPO_DE_EVENTO: Record<TipoDeEvento, string> = {
  contato: "Contato",
  promessa: "Promessa de pagamento",
  negociacao_proposta: "Proposta de negociação",
  acordo_aceito: "Acordo aceito",
  acordo_quebrado: "Acordo quebrado",
  parcela_paga: "Parcela paga",
  etapa_mudou: "Mudança de etapa",
  responsavel_mudou: "Mudança de responsável",
  nota: "Anotação",
  suspensao: "Suspensão",
  negativacao: "Negativação",
  encerramento: "Encerramento",
  cancelamento: "Cancelamento do contrato",
};

/** "sistema" é o que a régua e o sync escrevem; os outros quatro são o funcionário. */
export const CANAIS_DE_CONTATO = ["telefone", "whatsapp", "email", "presencial", "sistema"] as const;
export type CanalDeContato = (typeof CANAIS_DE_CONTATO)[number];

export const CANAIS_HUMANOS = ["telefone", "whatsapp", "email", "presencial"] as const;
export type CanalHumano = (typeof CANAIS_HUMANOS)[number];

export const ROTULO_CANAL: Record<CanalDeContato, string> = {
  telefone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  presencial: "Presencial",
  sistema: "Sistema",
};

export const RESULTADOS_DE_CONTATO = [
  "falou",
  "nao_atendeu",
  "caixa_postal",
  "promessa_pagamento",
  "recusou",
  "numero_errado",
] as const;
export type ResultadoDeContato = (typeof RESULTADOS_DE_CONTATO)[number];

export const ROTULO_RESULTADO: Record<ResultadoDeContato, string> = {
  falou: "Falou com o cliente",
  nao_atendeu: "Não atendeu",
  caixa_postal: "Caixa postal",
  promessa_pagamento: "Prometeu pagar",
  recusou: "Recusou",
  numero_errado: "Número errado",
};

/* ── Prioridade ───────────────────────────────────────────────────────── */

export const PRIORIDADES = ["critica", "alta", "normal", "baixa"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  critica: "Crítica",
  alta: "Alta",
  normal: "Normal",
  baixa: "Baixa",
};

/* ── O evento que uma mudança de status implica ───────────────────────── */

/**
 * Toda mudança de status do caso deixa rastro na linha do tempo. Qual tipo
 * de evento ela implica é decidido aqui para a rota não inventar um a cada
 * chamada. `null` quando a mudança não tem evento próprio (por exemplo,
 * negociando → aberto: o contato com "recusou" já contou a história).
 */
export function eventoDaTransicaoDeCaso(de: StatusDeCaso, para: StatusDeCaso): TipoDeEvento | null {
  // Cancelamento tem evento próprio, separado do encerramento: é ele que
  // carrega o motivo e a sugestão de abrir a recuperação do equipamento.
  if (para === "cancelamento") return "cancelamento";
  // Acordo quebrado vem antes de "nova proposta": é o fato que importa na
  // linha do tempo; a proposta nova ganha o próprio evento quando for criada.
  if (de === "acordo_ativo" && (para === "aberto" || para === "em_contato" || para === "negociando")) return "acordo_quebrado";
  if (para === "negociando") return "negociacao_proposta";
  if (para === "acordo_ativo") return "acordo_aceito";
  if (para === "negativado") return "negativacao";
  if (casoFechado(para)) return "encerramento";
  // aberto ↔ em_contato: o contato registrado já contou a história.
  return null;
}
