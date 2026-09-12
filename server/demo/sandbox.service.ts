/**
 * O sandbox do visitante: um provedor de mentira criado NA HORA, com carteira
 * PRÓPRIA (1.500 clientes, faturas, equipamentos, um quadro de cobrança já
 * povoado), que nasce em segundos e morre sozinho 24h depois.
 *
 * É a porta de entrada da demonstração pública: `criarSandbox()` chama
 * `semearMundoBase()` primeiro (idempotente — garante que rede-1..5 existem
 * antes de qualquer visitante consultar a rede) e então gera uma carteira
 * exclusiva para ESTE visitante. A carteira é GERADA, nunca copiada de um
 * provedor molde: o sandbox não depende de nenhuma linha viva além do mundo
 * base.
 *
 * Escrita em massa, no molde de `mundo-base.ts`: `db.insert(...)` em blocos
 * de 500, nunca `storage.createCustomer` por linha — são ~5 mil linhas por
 * sandbox (clientes + faturas + equipamentos + casos de cobrança), e uma
 * chamada por registro transformaria a porta da demonstração em tela de
 * espera. Os DOIS ÚNICOS pontos que passam pela camada de storage são o
 * provedor e o usuário administrador — um INSERT simples cada, sem custo de
 * lote — via `storage.createProvider`/`storage.createUser`.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  providers,
  customers,
  invoices,
  equipment,
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  antiFraudAlerts,
  proactiveAlerts,
  ispConsultations,
  spcConsultations,
  users,
} from "@shared/schema";
import type { InsertCustomer, InsertInvoice, InsertEquipment, InsertCobrancaCaso } from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../password";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";
import { PROVEDORES_DA_DEMO, CPFS_COMPARTILHADOS, semearMundoBase } from "./mundo-base";
import { STATUS_DE_CASO, type StatusDeCaso } from "@shared/cobranca/estados";
import type { EtapaId } from "@shared/cobranca/regua";

/** O que uma transação de verdade e o `pg-proxy` de teste têm em comum. Ver o mesmo tipo em `mundo-base.ts`. */
type Executor = Pick<typeof db, "insert" | "select" | "delete">;

/** Toda identidade de sandbox é esta convenção — sem coluna nova, sem migração (ver CLAUDE.md/regras do plano). */
const PREFIXO_SANDBOX = "sandbox-";

/** 24 horas — um sandbox mais velho que isso é candidato a `apagarSandbox()` (Tarefa 7 faz a limpeza periódica). */
export const VIDA_DO_SANDBOX_MS = 24 * 60 * 60 * 1000;

/**
 * `providers` não tem uma coluna "saldo": tem `ispCredits` e `spcCredits`,
 * separadas (`shared/schema.ts:167-168`). Hoje só `isp_credits` é lido ou
 * debitado por qualquer caminho de consumo real (a consulta SPC também
 * desconta de `isp_credits` — ver `server/routes/consultas.routes.ts:1023`).
 * Mesmo assim, semeamos os DOIS campos: não custa nada e cobre qualquer
 * leitura direta de `spcCredits` que exista fora do caminho de consumo.
 */
export const SALDO_INICIAL = 500;

const TAMANHO_DO_BLOCO = 500;

// ── Alocação de índices de pessoa fictícia — disjunta do mundo base para SEMPRE ──
//
// O mundo base ocupa, no PIOR CASO, [0, 49_999] (faixa "única") e
// [500_000, 503_999] (faixa de aresta) — ver `mundo-base.ts:128-148`. O
// índice de exemplo do migrador-serial soma mais um ponto fixo, 504_000
// (`INDICE_MIGRADOR_DE_EXEMPLO`, exportado de `mundo-base.ts`).
//
// A conta que fecha é módulo um número FIXO de posições — nunca `providerId`
// cru (que é um SERIAL sem teto e eventualmente estouraria de volta para
// dentro das faixas acima).
const ZONA_SANDBOX_INICIO = 510_000; // logo depois de BASE_ARESTA + 4*PASSO_ARESTA (503_999)
const PASSO_POR_SANDBOX = 2_000; // > 1.350 índices exclusivos por sandbox, com folga
const SANDBOXES_EM_RODIZIO = 200; // 510_000 + 199*2_000 + 1_349 = 909_349, nunca chega em 999_998

/**
 * Até 200 sandboxes vivos ao mesmo tempo nunca colidem — cada `providerId`
 * cai num balde de 2.000 índices exclusivo dele enquanto vivo. Acima disso
 * (improvável: rate limit de 5/10min por IP na Tarefa 6, limpeza de hora em
 * hora na Tarefa 7), um balde é reciclado enquanto o dono anterior ainda
 * existe — a mesma folga que `PASSO_UNICO=10_000` já aceita no mundo base.
 */
function baseDeIndicesDoSandbox(providerId: number): number {
  return ZONA_SANDBOX_INICIO + (providerId % SANDBOXES_EM_RODIZIO) * PASSO_POR_SANDBOX;
}

// ── Volumes da carteira do sandbox (mesma forma do mundo base — Tarefa 3) ──
const CLIENTES_POR_SANDBOX = 1_500;
const INADIMPLENTES_POR_SANDBOX = 225; // 15%
const CANCELADOS_POR_SANDBOX = 150; // 10%
const CLIENTES_COMPARTILHADOS_POR_SANDBOX = 150; // reaproveitam CPF da rede, de propósito
const CLIENTES_EXCLUSIVOS_POR_SANDBOX = CLIENTES_POR_SANDBOX - CLIENTES_COMPARTILHADOS_POR_SANDBOX; // 1.350
const EM_DIA_TOTAL_POR_SANDBOX = CLIENTES_POR_SANDBOX - INADIMPLENTES_POR_SANDBOX - CANCELADOS_POR_SANDBOX; // 1.125

const EM_DIA_COM_EQUIPAMENTO_COMODATO = 90; // ativos, ONU normal, ainda em comodato
const CANCELADOS_COM_EQUIPAMENTO_RETIDO = 30; // ex-clientes, ONU NÃO devolvida — 120 = 8% do total

const IDADES_DE_VENCIMENTO_REPRESENTATIVAS = [10, 45, 120, 300, 20, 60, 90, 150, 250];
const VALORES_DE_PLANO = [79.9, 99.9, 119.9, 149.9, 199.9];
const TENURE_MESES_REPRESENTATIVOS = [2, 5, 9, 14, 20, 28, 36, 48, 60, 84];
const RECENCIA_CANCELAMENTO_DIAS = [30, 60, 90, 150, 210, 365];

const STATUS_DE_EQUIPAMENTO_RETIDO = ["retido", "retirada_pendente", "nao_localizado", "em_cobranca", "not_returned"] as const;
const STATUS_DE_EQUIPAMENTO_COMODATO = "em_comodato";
const MARCAS_DE_EQUIPAMENTO = ["Fiberhome", "Huawei", "ZTE", "Nokia", "TP-Link", "Intelbras"] as const;
const MODELO_POR_MARCA: Record<(typeof MARCAS_DE_EQUIPAMENTO)[number], string> = {
  Fiberhome: "AN5506-04-F",
  Huawei: "EG8145V5",
  ZTE: "F670L",
  Nokia: "G-140W-C",
  "TP-Link": "Archer VR2100",
  Intelbras: "ONU 121",
};
const VALOR_DO_EQUIPAMENTO = 290;

const MULTA_DE_SAIDA_PADRAO = 300;
const DIAS_PROPORCIONAL_DE_SAIDA = 15;

/** `data` menos `meses` meses — mesma ideia de `subtrairMeses` em `mundo-base.ts`. */
function subtrairMeses(data: Date, meses: number): Date {
  const d = new Date(data.getTime());
  d.setMonth(d.getMonth() - meses);
  return d;
}

/** `data` menos `dias` dias. */
function subtrairDias(data: Date, dias: number): Date {
  return new Date(data.getTime() - dias * 86_400_000);
}

/** `YYYY-MM-DD` local — `customers.contractStartDate` é DATE, o driver do Drizzle não converte. */
function paraDataSemHora(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatarReal(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/** Subdomínio aleatório do sandbox: `sandbox-` + 16 hex (8 bytes) — colisão é astronomicamente improvável. */
function subdominioDoSandbox(): string {
  return `${PREFIXO_SANDBOX}${crypto.randomBytes(8).toString("hex")}`;
}

/** Dígito verificador de CNPJ — mesmo algoritmo de `cnpjFicticio` em `mundo-base.ts` (não exportado de lá). */
function digitoVerificadorCnpj(digitos: number[], pesos: number[]): number {
  const soma = digitos.reduce((acc, d, idx) => acc + d * pesos[idx], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CNPJ do provedor do sandbox: `providers.cnpj` é `notNull().unique()`
 * (`shared/schema.ts:151`) e o brief não cobre este campo — 12 dígitos
 * aleatórios (nunca "40" + índice, a raiz que `mundo-base.ts` usa para os 5
 * provedores fixos) + 2 dígitos verificadores calculados pelo algoritmo
 * oficial, para nunca colidir com o mundo base e sempre passar por
 * `validarCNPJ` caso algum código um dia confira.
 */
function cnpjDoSandbox(): string {
  const base = Array.from({ length: 12 }, () => crypto.randomInt(0, 10));
  const d1 = digitoVerificadorCnpj(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificadorCnpj([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base.join("")}${d1}${d2}`;
}

/** MAC determinístico a partir do índice — mesma ideia de `macFicticio` em `mundo-base.ts`. */
function macFicticio(indice: number): string {
  const hex = Math.trunc(Math.abs(indice)).toString(16).padStart(8, "0").slice(-8);
  return `9C:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:FF`.toUpperCase();
}

type CategoriaSandbox = "inadimplente" | "cancelado" | "em_dia";

interface EntradaSandbox {
  /** Posição 0..1499 dentro do PRÓPRIO sandbox — nunca reconstruído, sempre lido do plano gerado. */
  cursor: number;
  categoria: CategoriaSandbox;
  /** Posição dentro da própria categoria (0-based) — cicla idade, valor e equipamento. */
  posicaoNaCategoria: number;
  /** Presente só nos 150 clientes que reaproveitam CPF da rede — sobrescreve `cpfFicticio(indice)`. */
  cpfOverride?: string;
}

/**
 * Monta os 1.500 clientes do sandbox: 1.350 usam `pessoaFicticia`/`cpfFicticio`
 * em índices exclusivos deste sandbox; os outros 150 reaproveitam
 * `CPFS_COMPARTILHADOS[0..149]` como CPF (nome/endereço/coordenada continuam
 * vindo do índice exclusivo normalmente — só `cpfCnpj` é sobrescrito). Estes
 * 150 nascem "em dia" NESTE sandbox de propósito: a história que a
 * demonstração conta é "limpo aqui, mas devendo na rede" — contrastar com um
 * cliente que já nasce inadimplente no próprio sandbox não ensinaria nada
 * sobre a rede.
 */
function planoDeIndicesDoSandbox(): EntradaSandbox[] {
  const entradas: EntradaSandbox[] = [];

  for (let k = 0; k < INADIMPLENTES_POR_SANDBOX; k++) {
    entradas.push({ cursor: k, categoria: "inadimplente", posicaoNaCategoria: k });
  }

  for (let k = 0; k < CANCELADOS_POR_SANDBOX; k++) {
    entradas.push({ cursor: INADIMPLENTES_POR_SANDBOX + k, categoria: "cancelado", posicaoNaCategoria: k });
  }

  // Os 150 compartilhados vêm PRIMEIRO dentro de "em dia" — mesma ordem que
  // `mundo-base.ts` usa para os CPFs de aresta, e é o que mantém o comodato
  // (abaixo) concentrado nos últimos 90, todos exclusivos.
  for (let k = 0; k < CLIENTES_COMPARTILHADOS_POR_SANDBOX; k++) {
    entradas.push({
      cursor: CLIENTES_EXCLUSIVOS_POR_SANDBOX + k, // 1.350..1.499
      categoria: "em_dia",
      posicaoNaCategoria: k,
      cpfOverride: CPFS_COMPARTILHADOS[k],
    });
  }

  const inicioEmDiaExclusivo = INADIMPLENTES_POR_SANDBOX + CANCELADOS_POR_SANDBOX; // 375
  const totalEmDiaExclusivo = CLIENTES_EXCLUSIVOS_POR_SANDBOX - inicioEmDiaExclusivo; // 975
  for (let k = 0; k < totalEmDiaExclusivo; k++) {
    entradas.push({
      cursor: inicioEmDiaExclusivo + k, // 375..1.349
      categoria: "em_dia",
      posicaoNaCategoria: CLIENTES_COMPARTILHADOS_POR_SANDBOX + k, // 150..1.124
    });
  }

  return entradas;
}

function indiceDaEntrada(providerId: number, entrada: EntradaSandbox): number {
  return baseDeIndicesDoSandbox(providerId) + entrada.cursor;
}

function idadeRepresentativa(posicao: number): number {
  return IDADES_DE_VENCIMENTO_REPRESENTATIVAS[posicao % IDADES_DE_VENCIMENTO_REPRESENTATIVAS.length];
}

function valorMensalidade(indice: number): number {
  return VALORES_DE_PLANO[Math.abs(indice) % VALORES_DE_PLANO.length];
}

function tenureMeses(indice: number): number {
  return TENURE_MESES_REPRESENTATIVOS[Math.abs(indice) % TENURE_MESES_REPRESENTATIVOS.length];
}

/** Quando este cliente saiu — só para "cancelado". Função pura: mesma entrada, mesma data sempre. */
function cortadoEmDaEntrada(entrada: EntradaSandbox, agora: Date): Date | null {
  if (entrada.categoria !== "cancelado") return null;
  return subtrairDias(agora, RECENCIA_CANCELAMENTO_DIAS[entrada.posicaoNaCategoria % RECENCIA_CANCELAMENTO_DIAS.length]);
}

interface DescritorDeEquipamento {
  status: string;
  value: number;
  /** true = não devolvido (conta no agregado do cliente); false = comodato normal (não conta). */
  retido: boolean;
}

/**
 * Cancelado: os primeiros `CANCELADOS_COM_EQUIPAMENTO_RETIDO` (por posição)
 * ficam com a ONU não devolvida. Em dia: os ÚLTIMOS `EM_DIA_COM_EQUIPAMENTO_COMODATO`
 * — nunca os primeiros, porque os primeiros de "em dia" são justamente os 150
 * compartilhados com a rede (ver `planoDeIndicesDoSandbox`), e o comodato
 * normal não precisa se concentrar ali.
 */
function equipamentoDaEntrada(entrada: EntradaSandbox): DescritorDeEquipamento | null {
  if (entrada.categoria === "cancelado" && entrada.posicaoNaCategoria < CANCELADOS_COM_EQUIPAMENTO_RETIDO) {
    const status = STATUS_DE_EQUIPAMENTO_RETIDO[entrada.posicaoNaCategoria % STATUS_DE_EQUIPAMENTO_RETIDO.length];
    return { status, value: VALOR_DO_EQUIPAMENTO, retido: true };
  }
  if (entrada.categoria === "em_dia" && entrada.posicaoNaCategoria >= EM_DIA_TOTAL_POR_SANDBOX - EM_DIA_COM_EQUIPAMENTO_COMODATO) {
    return { status: STATUS_DE_EQUIPAMENTO_COMODATO, value: VALOR_DO_EQUIPAMENTO, retido: false };
  }
  return null;
}

function linhaDoCliente(providerId: number, entrada: EntradaSandbox, agora: Date): InsertCustomer {
  const indice = indiceDaEntrada(providerId, entrada);
  const pessoa = pessoaFicticia(indice);
  const cpf = entrada.cpfOverride ?? cpfFicticio(indice);
  const equip = equipamentoDaEntrada(entrada);
  const cortadoEm = cortadoEmDaEntrada(entrada, agora);
  const contractStartDate = paraDataSemHora(subtrairMeses(cortadoEm ?? agora, tenureMeses(indice)));

  const base: InsertCustomer = {
    providerId,
    name: pessoa.nome,
    cpfCnpj: cpf,
    email: pessoa.email,
    phone: pessoa.telefone,
    address: pessoa.logradouro,
    addressNumber: pessoa.numero,
    neighborhood: pessoa.bairro,
    city: pessoa.cidade,
    state: pessoa.uf,
    cep: pessoa.cep,
    latitude: pessoa.latitude,
    longitude: pessoa.longitude,
    contractStartDate,
    equipmentCount: equip?.retido ? 1 : 0,
    equipmentEstimatedValue: equip?.retido ? equip.value.toFixed(2) : "0.00",
    ...(cortadoEm ? { cortadoEm } : {}),
  };

  if (entrada.categoria === "inadimplente") {
    return {
      ...base,
      status: "active",
      paymentStatus: "overdue",
      totalOverdueAmount: valorMensalidade(indice).toFixed(2),
      maxDaysOverdue: idadeRepresentativa(entrada.posicaoNaCategoria),
    };
  }
  if (entrada.categoria === "cancelado") {
    return { ...base, status: "cancelled", paymentStatus: "current", totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
  }
  return { ...base, status: "active", paymentStatus: "current", totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
}

function linhaDaFatura(providerId: number, customerId: number, entrada: EntradaSandbox, agora: Date): InsertInvoice {
  const indice = indiceDaEntrada(providerId, entrada);
  const idadeDias = idadeRepresentativa(entrada.posicaoNaCategoria);
  return {
    customerId,
    providerId,
    value: valorMensalidade(indice).toFixed(2),
    dueDate: subtrairDias(agora, idadeDias),
    status: "overdue",
  };
}

/**
 * A fatura de SAÍDA do ex-cliente — mesmo formato que `shared/cobranca/multa.ts`
 * (`parcelasDaDescricao`) lê, no molde de `mundo-base.ts`: sem ela a carteira
 * de ex-clientes do sandbox abriria vazia (Economia, multa, prejuízo).
 */
function linhaDaFaturaDeSaida(providerId: number, customerId: number, entrada: EntradaSandbox, cortadoEm: Date): InsertInvoice {
  const indice = indiceDaEntrada(providerId, entrada);
  const mensalidade = valorMensalidade(indice);
  const proporcional = Number((mensalidade * DIAS_PROPORCIONAL_DE_SAIDA / 30).toFixed(2));
  const valor = Number((MULTA_DE_SAIDA_PADRAO + VALOR_DO_EQUIPAMENTO + proporcional).toFixed(2));
  const descricao = `Proporcional ${DIAS_PROPORCIONAL_DE_SAIDA} dias + multa ${formatarReal(MULTA_DE_SAIDA_PADRAO)} + equipamento ${formatarReal(VALOR_DO_EQUIPAMENTO)}`;
  const paga = entrada.posicaoNaCategoria % 2 === 0;

  return {
    customerId,
    providerId,
    value: valor.toFixed(2),
    dueDate: cortadoEm,
    status: paga ? "paid" : "overdue",
    descricao,
    ...(paga ? { paidDate: cortadoEm, paidValue: valor.toFixed(2) } : {}),
  };
}

function linhaDoEquipamento(providerId: number, customerId: number, entrada: EntradaSandbox, descritor: DescritorDeEquipamento): InsertEquipment {
  const indice = indiceDaEntrada(providerId, entrada);
  const marca = MARCAS_DE_EQUIPAMENTO[entrada.posicaoNaCategoria % MARCAS_DE_EQUIPAMENTO.length];
  return {
    customerId,
    providerId,
    type: "ONU",
    brand: marca,
    model: MODELO_POR_MARCA[marca],
    serialNumber: `SB${String(indice).padStart(8, "0")}`,
    mac: macFicticio(indice),
    status: descritor.status,
    value: descritor.value.toFixed(2),
  };
}

async function inserirClientesEmBlocos(tx: Executor, linhas: InsertCustomer[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    const bloco = linhas.slice(i, i + TAMANHO_DO_BLOCO);
    const inseridos = await tx.insert(customers).values(bloco).returning({ id: customers.id });
    ids.push(...inseridos.map((r) => r.id));
  }
  return ids;
}

async function inserirFaturasEmBlocos(tx: Executor, linhas: InsertInvoice[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    await tx.insert(invoices).values(linhas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

async function inserirEquipamentosEmBlocos(tx: Executor, linhas: InsertEquipment[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    await tx.insert(equipment).values(linhas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

/**
 * Um caso em cada uma das 9 colunas do kanban (`ORDEM_DO_KANBAN`,
 * `server/routes/cobranca.routes.ts:1190-1192`, mesmo conjunto de
 * `STATUS_DE_CASO`). Sem isto, um visitante que cai no meio do dia vê o
 * quadro vazio — a régua diária que POPULARIA `cobranca_casos` só roda no
 * worker (boot + 05:00), que este processo HTTP nunca executa.
 *
 * Os 6 status não-terminais usam clientes que já nasceram inadimplentes
 * (`paymentStatus: "overdue"`); os 3 terminais que fecham o contrato
 * (`cancelamento`, `baixado`, `encerrado`) usam clientes que já nasceram
 * cancelados — nenhum dos 9 toca os clientes de exemplo ("limpo",
 * "devendo_na_rede"), que vivem fora da faixa exclusiva de cursores usada
 * aqui (0..4 e 225..227).
 */
function casosDoKanban(
  providerId: number,
  entradas: EntradaSandbox[],
  idsClientes: number[],
  indicePorCursor: Map<number, number>,
  agora: Date,
): InsertCobrancaCaso[] {
  const idDoCursor = (cursor: number): number => idsClientes[indicePorCursor.get(cursor)!];
  const entradaDoCursor = (cursor: number): EntradaSandbox => entradas[indicePorCursor.get(cursor)!];

  const NAO_TERMINAIS: Array<{ status: StatusDeCaso; cursor: number; etapa: EtapaId | null; prioridade: "critica" | "alta" | "normal" }> = [
    { status: "aberto", cursor: 0, etapa: "lembrete_atraso", prioridade: "normal" },
    { status: "em_contato", cursor: 1, etapa: "lembrete_atraso", prioridade: "normal" },
    { status: "negociando", cursor: 2, etapa: "negociacao_recuperacao", prioridade: "alta" },
    { status: "acordo_ativo", cursor: 3, etapa: "negociacao_recuperacao", prioridade: "alta" },
    { status: "negativado", cursor: 4, etapa: "pre_negativacao", prioridade: "critica" },
    { status: "pago", cursor: 5, etapa: null, prioridade: "normal" },
  ];
  const TERMINAIS_EX_CLIENTE: Array<{ status: StatusDeCaso; cursor: number }> = [
    { status: "cancelamento", cursor: INADIMPLENTES_POR_SANDBOX + 0 },
    { status: "baixado", cursor: INADIMPLENTES_POR_SANDBOX + 1 },
    { status: "encerrado", cursor: INADIMPLENTES_POR_SANDBOX + 2 },
  ];

  const casos: InsertCobrancaCaso[] = [];

  for (const item of NAO_TERMINAIS) {
    const entrada = entradaDoCursor(item.cursor);
    const indice = indiceDaEntrada(providerId, entrada);
    const valor = valorMensalidade(indice).toFixed(2);
    casos.push({
      providerId,
      customerId: idDoCursor(item.cursor),
      status: item.status,
      carteira: "ativo",
      etapaAtual: item.etapa,
      diasAtrasoAbertura: idadeRepresentativa(entrada.posicaoNaCategoria),
      valorAbertura: valor,
      valorAtual: valor,
      prioridade: item.prioridade,
      proximoContatoEm: item.status === "pago" ? null : new Date(agora.getTime() + 24 * 60 * 60 * 1000),
    });
  }

  for (const item of TERMINAIS_EX_CLIENTE) {
    casos.push({
      providerId,
      customerId: idDoCursor(item.cursor),
      status: item.status,
      carteira: "ex_cliente",
      etapaAtual: null,
      diasAtrasoAbertura: 0,
      valorAbertura: "0.00",
      valorAtual: "0.00",
      prioridade: "baixa",
      proximoContatoEm: null,
    });
  }

  // Defesa contra deriva silenciosa: se um dia `STATUS_DE_CASO` ganhar uma
  // décima coluna, este semeador tem de ser atualizado junto — falhar alto
  // aqui é melhor que o kanban nascer com uma coluna vazia sem ninguém notar.
  if (casos.length !== STATUS_DE_CASO.length) {
    throw new Error(`casosDoKanban: esperava ${STATUS_DE_CASO.length} casos (um por status), gerou ${casos.length}`);
  }

  return casos;
}

/**
 * Cria o sandbox do visitante: semeia o mundo base (idempotente), gera uma
 * carteira própria de 1.500 clientes e devolve as credenciais/identidade
 * para a rota (Tarefa 6) abrir a sessão.
 */
export async function criarSandbox(): Promise<{ providerId: number; userId: number; subdomain: string; expiraEm: Date }> {
  await semearMundoBase();

  const agora = new Date();
  const subdomain = subdominioDoSandbox();

  const provider = await storage.createProvider({
    name: "Provedor Demonstração",
    cnpj: cnpjDoSandbox(),
    subdomain,
    plan: "enterprise",
    status: "active",
    verificationStatus: "approved",
    ispCredits: SALDO_INICIAL,
    spcCredits: SALDO_INICIAL,
  });

  const senhaAleatoria = crypto.randomBytes(24).toString("hex");
  const user = await storage.createUser({
    email: `${subdomain}@demo.consultaisp.com.br`,
    password: await hashPassword(senhaAleatoria),
    name: "Administrador da Demonstração",
    role: "admin",
    providerId: provider.id,
    emailVerified: true,
  });

  const entradas = planoDeIndicesDoSandbox();
  const indicePorCursor = new Map(entradas.map((e, i) => [e.cursor, i]));

  await db.transaction(async (tx) => {
    const linhasClientes = entradas.map((e) => linhaDoCliente(provider.id, e, agora));
    const idsClientes = await inserirClientesEmBlocos(tx, linhasClientes);

    const linhasFaturas: InsertInvoice[] = [];
    const linhasEquipamentos: InsertEquipment[] = [];
    for (let k = 0; k < entradas.length; k++) {
      const entrada = entradas[k];
      const customerId = idsClientes[k];

      if (entrada.categoria === "inadimplente") {
        linhasFaturas.push(linhaDaFatura(provider.id, customerId, entrada, agora));
      } else if (entrada.categoria === "cancelado") {
        const cortadoEm = cortadoEmDaEntrada(entrada, agora)!;
        linhasFaturas.push(linhaDaFaturaDeSaida(provider.id, customerId, entrada, cortadoEm));
      }

      const equip = equipamentoDaEntrada(entrada);
      if (equip) linhasEquipamentos.push(linhaDoEquipamento(provider.id, customerId, entrada, equip));
    }

    await inserirFaturasEmBlocos(tx, linhasFaturas);
    await inserirEquipamentosEmBlocos(tx, linhasEquipamentos);

    const casos = casosDoKanban(provider.id, entradas, idsClientes, indicePorCursor, agora);
    await tx.insert(cobrancaCasos).values(casos);
  });

  return {
    providerId: provider.id,
    userId: user.id,
    subdomain,
    expiraEm: new Date(agora.getTime() + VIDA_DO_SANDBOX_MS),
  };
}

/**
 * Todos os `providers.id` cujo sandbox já passou de `VIDA_DO_SANDBOX_MS`.
 * Identidade por convenção (`subdomain` começando por `sandbox-`) — sem
 * migração, sem coluna nova. Um `SELECT *` seguido de filtro em JS: a
 * cardinalidade é baixa (~200 sandboxes no máximo, ver `SANDBOXES_EM_RODIZIO`),
 * então não vale a complexidade de um `LIKE` no SQL.
 */
export async function sandboxesExpirados(agora: Date = new Date()): Promise<number[]> {
  const todos = await db.select({ id: providers.id, subdomain: providers.subdomain, createdAt: providers.createdAt }).from(providers);
  const limite = agora.getTime() - VIDA_DO_SANDBOX_MS;

  return todos
    .filter((p) => (p.subdomain ?? "").startsWith(PREFIXO_SANDBOX))
    .filter((p) => {
      const criadoEm = p.createdAt ? new Date(p.createdAt).getTime() : 0;
      return criadoEm <= limite;
    })
    .map((p) => p.id);
}

/**
 * Apaga um sandbox e tudo que ele (ou o visitante, ao vivo) gravou.
 *
 * NÃO usa `storage.deleteProvider`: aquele caminho não conhece
 * `cobranca_casos` nem os alertas que uma consulta real do visitante pode
 * gerar (ver abaixo) — chamá-lo aqui quebraria com violação de FK no
 * primeiro sandbox que o visitante realmente usasse. Em vez disso, apaga
 * exatamente as tabelas que este módulo (ou o produto, através dele) pode
 * ter escrito, numa ordem segura para chave estrangeira, dentro de UMA
 * transação — ou apaga tudo, ou não apaga nada, nunca um sandbox pela
 * metade.
 *
 * Recusa apagar um provedor que não pareça um sandbox: `apagarSandbox` é
 * chamado pela limpeza automática (Tarefa 7) a partir de ids que ELA leu de
 * `sandboxesExpirados()`, mas um id errado em qualquer outro chamador futuro
 * não pode virar exclusão de um provedor de verdade.
 */
export async function apagarSandbox(providerId: number): Promise<void> {
  const [provider] = await db.select({ subdomain: providers.subdomain }).from(providers).where(eq(providers.id, providerId));
  if (!provider || !(provider.subdomain ?? "").startsWith(PREFIXO_SANDBOX)) {
    throw new Error(`apagarSandbox recusado: provider ${providerId} nao tem subdomain de sandbox`);
  }

  await db.transaction(async (tx) => {
    // Cobrança: o quadro que este arquivo semeia, mais o que o visitante cria
    // ao vivo clicando no kanban (evento, negociação, parcela) — nesta ordem
    // porque parcela referencia negociação, e as duas referenciam caso.
    await tx.delete(cobrancaParcelas).where(eq(cobrancaParcelas.providerId, providerId));
    await tx.delete(cobrancaNegociacoes).where(eq(cobrancaNegociacoes.providerId, providerId));
    await tx.delete(cobrancaEventos).where(eq(cobrancaEventos.providerId, providerId));
    await tx.delete(cobrancaCasos).where(eq(cobrancaCasos.providerId, providerId));

    // Uma consulta real ao CPF "devendo_na_rede" (Passo 3.4/`cpfsDeExemplo`)
    // é EXATAMENTE o tipo de cliente ativo+inadimplente que a regra
    // `ativo_inadimplente` (server/services/antifraude-rules.ts) usa para
    // avisar o dono na rede — gravando `anti_fraud_alerts`/`proactive_alerts`
    // com `consultingProviderId` = ESTE sandbox, nunca `providerId` (o
    // sandbox nunca tem `erp_integrations` própria, então nunca é alcançado
    // pela varredura da rede e nunca vira "dono" de um alerta).
    await tx.delete(antiFraudAlerts).where(eq(antiFraudAlerts.consultingProviderId, providerId));
    await tx.delete(proactiveAlerts).where(eq(proactiveAlerts.consultingProviderId, providerId));

    // Consultas de verdade que o visitante rodou.
    await tx.delete(ispConsultations).where(eq(ispConsultations.providerId, providerId));
    await tx.delete(spcConsultations).where(eq(spcConsultations.providerId, providerId));

    // A carteira própria do sandbox.
    await tx.delete(invoices).where(eq(invoices.providerId, providerId));
    await tx.delete(equipment).where(eq(equipment.providerId, providerId));
    await tx.delete(customers).where(eq(customers.providerId, providerId));

    await tx.delete(users).where(eq(users.providerId, providerId));
    await tx.delete(providers).where(eq(providers.id, providerId));
  });
}
