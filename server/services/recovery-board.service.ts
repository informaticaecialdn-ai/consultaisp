/**
 * Montagem do kanban de recuperação de equipamentos (spec 2026-09-02).
 *
 * Função pura: recebe o que o storage leu e a hora de referência, devolve o
 * BoardKanban do contrato. Nada de banco, nada de sessão — é o que permite
 * testar limite de faixa, ordenação e KPI sem subir nada.
 *
 * A idade de um card é FATO, não etapa: vem de `terminationDate` do caso
 * aberto. Equipamento retido sem caso não tem rescisão, então cai em
 * `sem_data`; nunca inventamos idade a partir de `createdAt`.
 */
import { casoEstaEncerrado } from "./equipment-recovery-rules";

export type ColunaKanban = "sem_data" | "ate30" | "31a60" | "61a90" | "mais90" | "recuperado" | "baixado";

export interface CardKanban {
  chave: string;
  coluna: ColunaKanban;
  caseId: number | null;
  equipamento: {
    id: number; tipo: string; marca: string | null; modelo: string | null;
    serie: string | null; mac: string | null; patrimonio: string | null;
    valor: number | null;
    status: string;
  };
  cliente: {
    id: number; nome: string; documento: string;
    telefone: string | null; whatsapp: string | null;
    endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null;
    situacao: string;
    dividaEmAberto: number;
    diasEmAtraso: number;
  };
  caso: null | {
    status: string; prioridade: string;
    rescisaoEm: string;
    prazoAt: string;
    diasRetido: number;
    diasRestantes: number;
    agendadoEm: string | null; metodo: string | null;
    responsavel: { id: number; nome: string } | null;
    notificadoEm: string | null; bureauStatus: string; contestadoEm: string | null;
    encerradoEm: string | null; notas: string | null;
    tentativas: { total: number; ultima: { canal: string | null; resultado: string | null; em: string } | null };
  };
}

export interface BoardKanban {
  geradoEm: string;
  colunas: Array<{ chave: ColunaKanban; rotulo: string; cards: number; valor: number }>;
  cards: CardKanban[];
  kpis: {
    retidos: number;
    valorEmRisco: number;
    prazoCritico: number;
    recuperados30d: number;
    valorRecuperado30d: number;
  };
  responsaveis: Array<{ id: number; nome: string }>;
}

/** Cliente como o storage devolve (só o que o card usa). */
export interface EntradaClienteBoard {
  id: number;
  nome: string;
  cpfCnpj: string;
  telefone: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  situacao: string;
  dividaEmAberto: string | number | null;
  diasEmAtraso: number | null;
}

/** Equipamento como o storage devolve (decimal chega como string). */
export interface EntradaEquipamentoBoard {
  id: number;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  mac: string | null;
  patrimonio: string | null;
  valor: string | number | null;
  status: string;
}

/** Caso de recuperação com equipamento, cliente e responsável já juntados. */
export interface EntradaCasoBoard {
  id: number;
  status: string;
  prioridade: string;
  rescisaoEm: Date;
  prazoAt: Date;
  agendadoEm: Date | null;
  metodo: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  notificadoEm: Date | null;
  bureauStatus: string;
  contestadoEm: Date | null;
  encerradoEm: Date | null;
  notas: string | null;
  equipamento: EntradaEquipamentoBoard;
  cliente: EntradaClienteBoard;
}

/** Equipamento retido sem caso aberto — vira card de `sem_data`. */
export interface EntradaEquipamentoSemCasoBoard {
  equipamento: EntradaEquipamentoBoard;
  cliente: EntradaClienteBoard;
}

/** Agregado de tentativas por caso: total e a última, calculados no SQL. */
export interface EntradaTentativaBoard {
  caseId: number;
  total: number;
  canal: string | null;
  resultado: string | null;
  em: Date;
}

export interface EntradaUsuarioBoard {
  id: number;
  nome: string;
}

export interface EntradasBoard {
  casos: EntradaCasoBoard[];
  equipamentosSemCaso: EntradaEquipamentoSemCasoBoard[];
  tentativas: EntradaTentativaBoard[];
  usuarios: EntradaUsuarioBoard[];
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Janela em que caso encerrado ainda aparece na coluna de encerrados. */
const JANELA_ENCERRADOS_DIAS = 90;
/** Janela do KPI "recuperados 30 d". */
const JANELA_RECUPERADOS_DIAS = 30;
/** Caso aberto com este saldo de prazo (ou menos) conta como prazo crítico. */
const PRAZO_CRITICO_DIAS = 10;

export const ROTULOS_COLUNAS: Record<ColunaKanban, string> = {
  sem_data: "Sem data de rescisão",
  ate30: "Até 30 dias",
  "31a60": "31 a 60 dias",
  "61a90": "61 a 90 dias",
  mais90: "Mais de 90 dias",
  recuperado: "Recuperados",
  baixado: "Baixados",
};

export const ORDEM_COLUNAS: ColunaKanban[] = [
  "sem_data", "ate30", "31a60", "61a90", "mais90", "recuperado", "baixado",
];

const PESO_PRIORIDADE: Record<string, number> = { critica: 0, alta: 1, normal: 2, baixa: 3 };

/**
 * Dia civil em UTC (meia-noite), sem fuso. O operador conta "dias corridos"
 * no calendário; usar horas cruas faria um caso mudar de coluna à tarde e
 * o fuso do servidor decidir a faixa. Truncar em UTC dos dois lados dá a
 * mesma resposta em qualquer máquina.
 */
function diaCivilUtc(data: Date): number {
  return Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
}

/** Dias civis inteiros de `de` até `ate` (negativo se `ate` for antes). */
export function diasCivisEntre(de: Date, ate: Date): number {
  return Math.round((diaCivilUtc(ate) - diaCivilUtc(de)) / MS_POR_DIA);
}

/** Faixa de idade pelos dias retidos. Limites 30/60/90 inclusivos, como a spec. */
export function colunaPorIdade(diasRetido: number): Extract<ColunaKanban, "ate30" | "31a60" | "61a90" | "mais90"> {
  if (diasRetido <= 30) return "ate30";
  if (diasRetido <= 60) return "31a60";
  if (diasRetido <= 90) return "61a90";
  return "mais90";
}

/**
 * CPF 000.000.000-00, CNPJ 00.000.000/0000-00. Qualquer outro tamanho volta
 * como está: o card é do próprio provedor, não há o que esconder, e um
 * documento estranho é mais útil visível do que quebrado numa máscara errada.
 */
export function formatarDocumento(cpfCnpj: string): string {
  const digitos = cpfCnpj.replace(/\D/g, "");
  if (digitos.length === 11) {
    return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  }
  if (digitos.length === 14) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
  }
  return cpfCnpj;
}

/**
 * Número para `https://wa.me/<n>`: só dígitos, com o 55 na frente.
 *
 * A decisão pelo tamanho, e não por "começa com 55", é proposital: um fixo
 * do DDD 55 (Santa Maria/RS) tem 10 dígitos e começa com 55 — prefixar pelo
 * prefixo o deixaria sem país. Com 10 ou 11 dígitos é DDD + número, sempre
 * recebe 55; com 12 ou 13 já veio com país e só passa se for o 55. Fora
 * disso não dá para montar um link confiável, então null.
 */
export function formatarWhatsapp(telefone: string | null | undefined): string | null {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, "").replace(/^0+/, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

function numeroOuZero(valor: string | number | null | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function valorEquipamento(valor: string | number | null | undefined): number | null {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function montarEquipamento(e: EntradaEquipamentoBoard): CardKanban["equipamento"] {
  return {
    id: e.id,
    tipo: e.tipo,
    marca: e.marca,
    modelo: e.modelo,
    serie: e.serie,
    mac: e.mac,
    patrimonio: e.patrimonio,
    valor: valorEquipamento(e.valor),
    status: e.status,
  };
}

function montarCliente(c: EntradaClienteBoard): CardKanban["cliente"] {
  const endereco = c.endereco
    ? (c.numero ? `${c.endereco}, ${c.numero}` : c.endereco)
    : null;
  return {
    id: c.id,
    nome: c.nome,
    documento: formatarDocumento(c.cpfCnpj),
    telefone: c.telefone,
    whatsapp: formatarWhatsapp(c.telefone),
    endereco,
    bairro: c.bairro,
    cidade: c.cidade,
    uf: c.uf,
    situacao: c.situacao,
    dividaEmAberto: numeroOuZero(c.dividaEmAberto),
    diasEmAtraso: c.diasEmAtraso ?? 0,
  };
}

function iso(data: Date | null | undefined): string | null {
  return data ? data.toISOString() : null;
}

/** Coluna de um caso encerrado; null quando saiu da janela de 90 dias. */
function colunaEncerrado(caso: EntradaCasoBoard, agora: Date): ColunaKanban | null {
  // Caso fechado sem `closedAt` é dado inconsistente (o storage sempre grava
  // os dois juntos). Sem data não dá para saber se está na janela — fica fora.
  if (!caso.encerradoEm) return null;
  const idade = diasCivisEntre(caso.encerradoEm, agora);
  if (idade < 0 || idade > JANELA_ENCERRADOS_DIAS) return null;
  return caso.status === "concluido" ? "recuperado" : "baixado";
}

function montarCardDeCaso(
  caso: EntradaCasoBoard,
  coluna: ColunaKanban,
  agora: Date,
  tentativa: EntradaTentativaBoard | undefined,
): CardKanban {
  // Rescisão no futuro não passa pela rota de criação; se aparecer, o card
  // vale como "hoje" em vez de dias negativos que não significam nada.
  const diasRetido = Math.max(0, diasCivisEntre(caso.rescisaoEm, agora));
  return {
    chave: `caso:${caso.id}`,
    coluna,
    caseId: caso.id,
    equipamento: montarEquipamento(caso.equipamento),
    cliente: montarCliente(caso.cliente),
    caso: {
      status: caso.status,
      prioridade: caso.prioridade,
      rescisaoEm: caso.rescisaoEm.toISOString(),
      prazoAt: caso.prazoAt.toISOString(),
      diasRetido,
      diasRestantes: diasCivisEntre(agora, caso.prazoAt),
      agendadoEm: iso(caso.agendadoEm),
      metodo: caso.metodo,
      responsavel: caso.responsavelId != null
        ? { id: caso.responsavelId, nome: caso.responsavelNome ?? "" }
        : null,
      notificadoEm: iso(caso.notificadoEm),
      bureauStatus: caso.bureauStatus,
      contestadoEm: iso(caso.contestadoEm),
      encerradoEm: iso(caso.encerradoEm),
      notas: caso.notas,
      tentativas: {
        total: tentativa?.total ?? 0,
        ultima: tentativa
          ? { canal: tentativa.canal, resultado: tentativa.resultado, em: tentativa.em.toISOString() }
          : null,
      },
    },
  };
}

function montarCardSemData(entrada: EntradaEquipamentoSemCasoBoard): CardKanban {
  return {
    chave: `equip:${entrada.equipamento.id}`,
    coluna: "sem_data",
    caseId: null,
    equipamento: montarEquipamento(entrada.equipamento),
    cliente: montarCliente(entrada.cliente),
    caso: null,
  };
}

/**
 * Ordem dentro da coluna de idade: prioridade, depois menos dias restantes
 * (o que vence primeiro sobe), depois maior valor. Desempate por id para a
 * ordem ser estável entre duas cargas.
 */
function compararAbertos(a: CardKanban, b: CardKanban): number {
  const pa = PESO_PRIORIDADE[a.caso!.prioridade] ?? 99;
  const pb = PESO_PRIORIDADE[b.caso!.prioridade] ?? 99;
  if (pa !== pb) return pa - pb;
  if (a.caso!.diasRestantes !== b.caso!.diasRestantes) return a.caso!.diasRestantes - b.caso!.diasRestantes;
  const va = a.equipamento.valor ?? -1;
  const vb = b.equipamento.valor ?? -1;
  if (va !== vb) return vb - va;
  return a.caseId! - b.caseId!;
}

/** Sem data não tem prioridade nem prazo: maior valor primeiro, depois id. */
function compararSemData(a: CardKanban, b: CardKanban): number {
  const va = a.equipamento.valor ?? -1;
  const vb = b.equipamento.valor ?? -1;
  if (va !== vb) return vb - va;
  return a.equipamento.id - b.equipamento.id;
}

/** Encerrados: o mais recente primeiro. */
function compararEncerrados(a: CardKanban, b: CardKanban): number {
  const ea = a.caso!.encerradoEm ?? "";
  const eb = b.caso!.encerradoEm ?? "";
  if (ea !== eb) return ea < eb ? 1 : -1;
  return b.caseId! - a.caseId!;
}

function comparador(coluna: ColunaKanban): (a: CardKanban, b: CardKanban) => number {
  if (coluna === "sem_data") return compararSemData;
  if (coluna === "recuperado" || coluna === "baixado") return compararEncerrados;
  return compararAbertos;
}

export function montarBoard(entradas: EntradasBoard, agora: Date = new Date()): BoardKanban {
  const tentativasPorCaso = new Map<number, EntradaTentativaBoard>();
  for (const t of entradas.tentativas) tentativasPorCaso.set(t.caseId, t);

  const porColuna = new Map<ColunaKanban, CardKanban[]>();
  for (const chave of ORDEM_COLUNAS) porColuna.set(chave, []);

  for (const caso of entradas.casos) {
    let coluna: ColunaKanban | null;
    if (casoEstaEncerrado(caso.status)) {
      coluna = colunaEncerrado(caso, agora);
      if (!coluna) continue;
    } else {
      coluna = colunaPorIdade(Math.max(0, diasCivisEntre(caso.rescisaoEm, agora)));
    }
    porColuna.get(coluna)!.push(montarCardDeCaso(caso, coluna, agora, tentativasPorCaso.get(caso.id)));
  }

  for (const entrada of entradas.equipamentosSemCaso) {
    porColuna.get("sem_data")!.push(montarCardSemData(entrada));
  }

  const cards: CardKanban[] = [];
  const colunas: BoardKanban["colunas"] = [];
  for (const chave of ORDEM_COLUNAS) {
    const lista = porColuna.get(chave)!.sort(comparador(chave));
    cards.push(...lista);
    colunas.push({
      chave,
      rotulo: ROTULOS_COLUNAS[chave],
      cards: lista.length,
      valor: lista.reduce((soma, c) => soma + (c.equipamento.valor ?? 0), 0),
    });
  }

  const retidos = cards.filter(c => c.coluna !== "recuperado" && c.coluna !== "baixado");
  const recuperados30d = cards.filter(c =>
    c.coluna === "recuperado"
    && c.caso?.encerradoEm != null
    && diasCivisEntre(new Date(c.caso.encerradoEm), agora) <= JANELA_RECUPERADOS_DIAS,
  );

  return {
    geradoEm: agora.toISOString(),
    colunas,
    cards,
    kpis: {
      retidos: retidos.length,
      valorEmRisco: retidos.reduce((soma, c) => soma + (c.equipamento.valor ?? 0), 0),
      prazoCritico: retidos.filter(c => c.caso != null && c.caso.diasRestantes <= PRAZO_CRITICO_DIAS).length,
      recuperados30d: recuperados30d.length,
      valorRecuperado30d: recuperados30d.reduce((soma, c) => soma + (c.equipamento.valor ?? 0), 0),
    },
    responsaveis: entradas.usuarios
      .map(u => ({ id: u.id, nome: u.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  };
}
