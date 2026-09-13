/**
 * O mundo base da demonstração pública: cinco provedores fictícios, cada um
 * com a carteira de um provedor real (medida pelo dono, 11/09/2026 — ver
 * `.superpowers/sdd/2026-09-11-demo-sandbox/task-3-brief.md`), e a sobreposição
 * de CPFs entre vizinhos que é o que faz a consulta na rede mostrar algo: sem
 * ela, toda consulta de demonstração voltaria "nada consta".
 *
 * Consome `pessoaFicticia`/`cpfFicticio` (Tarefa 2, `./pessoas-ficticias.ts`).
 * Grava direto por `db.insert(...)`, em blocos de 500 — 7.500 clientes mais
 * faturas e equipamentos são dezenas de milhares de linhas, e uma chamada de
 * storage por linha (`storage.createCustomer` etc.) seria uma dezena de
 * milhares de idas ao banco. Isso vale também para `providers` e
 * `erp_integrations` (só 5 linhas cada, onde o custo não importaria) — por
 * uniformidade: UM caminho de escrita só neste arquivo, sem a camada de
 * storage (que criptografa segredo de ERP de verdade, LGPD/e-mail, etc. —
 * nada disso existe para o conector "demo", que não tem credencial real).
 *
 * TUDO dentro de UMA transação (rodada de correção, 11/09/2026): sem ela, uma
 * queda no meio dos cinco provedores deixava um mundo pela metade, e o guard
 * de idempotência (que só olha "rede-1" existe?") não tinha como perceber —
 * rede-1 pronta e rede-3 pela metade nunca se autocorrige. Com a transação, o
 * pior caso é "nada foi gravado", que o guard já sabe tratar.
 *
 * O COMPLEMENTO (13/09/2026, `complementarMundoBase`): o guard de idempotência
 * faz a semeadura nunca mais rodar num banco que já tem "rede-1" — então
 * corrigir a semeadura sozinha não chega ao banco da demonstração publicada.
 * O complemento reconhece pelo conteúdo um mundo no formato antigo e o
 * reescreve para o formato atual, e acrescenta as consultas cruzadas da rede,
 * que a semeadura nunca gravou.
 */
import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { providers, customers, invoices, equipment, erpIntegrations, users, ispConsultations } from "@shared/schema";
import type { InsertCustomer, InsertInvoice, InsertEquipment, InsertErpIntegration } from "@shared/schema";
import { CUSTO_EM_CREDITOS } from "@shared/planos";
import type { GeoPrecisao } from "@shared/geo-precisao";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";
import { encryptField } from "../utils/crypto";
import { hashPassword } from "../password";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";

/** O que uma transação de verdade e o `pg-proxy` de teste têm em comum: `insert`/`select`/`update`/`execute`. */
type Executor = Pick<typeof db, "insert" | "select" | "update" | "execute">;

export interface ProvedorDaDemo {
  nome: string;
  subdomain: string;
  cidade: string;
}

/**
 * Nesta ordem: `PROVEDORES_DA_DEMO[0].subdomain` PRECISA ser "rede-1" — é o
 * que o guard de idempotência verifica, e o que os testes usam como âncora.
 * Ligados em LINHA (rede-1 — rede-2 — rede-3 — rede-4 — rede-5), não em anel:
 * as pontas (rede-1, rede-5) têm UM vizinho; o meio tem DOIS. É a mesma forma
 * que faz a consulta cruzada contar uma história — vizinho perto repete
 * cliente, provedor distante não.
 */
export const PROVEDORES_DA_DEMO: ProvedorDaDemo[] = [
  { nome: "Rede Norte Conecta", subdomain: "rede-1", cidade: "Londrina" },
  { nome: "Ibiporã Telecom", subdomain: "rede-2", cidade: "Ibiporã" },
  { nome: "Cambé NetSul", subdomain: "rede-3", cidade: "Cambé" },
  { nome: "Apucarana Wireless", subdomain: "rede-4", cidade: "Apucarana" },
  { nome: "Paraná Norte Internet", subdomain: "rede-5", cidade: "Londrina" },
];

// ── Volumes (medida do dono, forma de um provedor real — 11/09/2026) ───────
const CLIENTES_POR_PROVEDOR = 1500;
const INADIMPLENTES_POR_PROVEDOR = 225; // 15%
const CANCELADOS_POR_PROVEDOR = 150; // 10%

/**
 * 9% com equipamento (135), mas NÃO tudo retido: rodada de correção
 * (11/09/2026) — o comodato normal (`em_comodato`, o default do schema) é o
 * caso do dia a dia, num cliente ATIVO; só o ex-cliente carrega os estados
 * "não devolvido" que alimentam a recuperação. Antes, os 120 eram todos
 * cancelados com estado retido, e um visitante navegando os 1.350 ativos de
 * qualquer provedor via ZERO equipamento — o módulo de comodato parecia
 * morto para quem olha a carteira viva.
 *
 * O inadimplente ativo também tem a ONU instalada (13/09/2026): até ali só o
 * cliente em dia tinha comodato, e a consulta de quem deve na rede nunca
 * mostrava aparelho algum — o contrário do caso mais comum de um provedor,
 * que é justamente cobrar quem está com o equipamento em casa.
 */
const EM_DIA_COM_EQUIPAMENTO_COMODATO = 90; // ativos em dia, ONU normal, ainda em comodato
const INADIMPLENTES_COM_EQUIPAMENTO_COMODATO = 15; // ativos devendo, ONU instalada (não é retirada)
const CANCELADOS_COM_EQUIPAMENTO_RETIDO = 30; // ex-clientes, ONU NÃO devolvida

const COMPARTILHADOS_POR_ARESTA = 150; // 10% de um portfólio, por vizinhança

/**
 * Dos CPFs compartilhados com um vizinho, quantos TAMBÉM entram como
 * inadimplentes (em vez de "em dia") — é o que dá à consulta cruzada algo
 * para mostrar: o cliente que o vizinho já tem como devedor. O resto do
 * compartilhamento fica em dia, para não inflar as contagens exatas de
 * inadimplente/cancelado que o teste verifica.
 */
const COMPARTILHADOS_INADIMPLENTES_POR_ARESTA = 40;

/** Total de "em dia" por provedor é sempre este número — não depende de quantos vêm de aresta compartilhada. */
const EM_DIA_TOTAL_POR_PROVEDOR = CLIENTES_POR_PROVEDOR - INADIMPLENTES_POR_PROVEDOR - CANCELADOS_POR_PROVEDOR; // 1125

const TAMANHO_DO_BLOCO = 500;

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

/** Idades de vencimento representativas — as quatro que a régua de cobrança usa (10/45/120/300) primeiro, depois uma variedade realista. */
const IDADES_DE_VENCIMENTO_REPRESENTATIVAS = [10, 45, 120, 300, 5, 20, 35, 60, 75, 90, 150, 200, 250, 15, 25];

/** Mensalidades por faixa de plano — cíclico pelo índice da pessoa, só para variedade. */
const VALORES_DE_PLANO = [79.9, 99.9, 119.9, 149.9, 199.9];
/**
 * Nome do plano, no MESMO índice de `VALORES_DE_PLANO` — para o nome bater
 * com a mensalidade em vez de sortear os dois de forma independente. Sem
 * `customers.contractPlan` o relatório de consulta e o Cliente 360 mostram o
 * plano em branco (rodada de correção, 11/09/2026) — é o campo que o ERP
 * escreve de verdade (`contract_plan`, migração 0036) e a demonstração nunca
 * preencheu.
 */
const NOMES_DE_PLANO = ["Fibra 200 Mega", "Fibra 300 Mega", "Fibra 500 Mega", "Fibra 600 Mega", "Fibra 800 Mega"];

/**
 * Tempo de casa, em meses — cobre as três faixas do DNA de cobrança (novo até
 * 11, médio até 36, fiel acima; ver CLAUDE.md). Sem `contractStartDate` o
 * quadrante DNA fica em branco para sempre na demo, e a Economia do cliente
 * (`shared/cobranca/economia.ts`, `mesesEntre`) não tem de onde contar
 * "meses vivo" — as duas dependem desta coluna, não só o Kanban.
 */
const TENURE_MESES_REPRESENTATIVOS = [2, 5, 9, 14, 20, 28, 36, 48, 60, 84, 120];
/** Há quantos meses um ex-cliente saiu — cíclico, para variar a "safra" de cancelamento. */
const RECENCIA_CANCELAMENTO_MESES = [1, 2, 3, 5, 8, 12, 18, 24];

/**
 * Estados "retido" com o vocabulário que o módulo de recuperação escreve hoje
 * (`server/services/equipment-recovery-rules.ts`). Até 13/09/2026 a lista
 * também tinha `retido`, `em_cobranca` e `not_returned`: continuam aceitos
 * como pendência por quem lê (`STATUS_EQUIPAMENTO_PENDENTE`), mas nenhum
 * caminho do produto grava mais nenhum deles, e a demonstração não deve ser o
 * único lugar onde aparecem.
 */
const STATUS_DE_EQUIPAMENTO_RETIDO = ["retirada_pendente", "nao_localizado"] as const;
/** O default do schema (`equipment.status`) — comodato normal, cliente ainda tem o aparelho. */
const STATUS_DE_EQUIPAMENTO_COMODATO = "em_comodato";
const MARCAS_DE_EQUIPAMENTO = ["Fiberhome", "Huawei", "ZTE", "Nokia", "TP-Link", "Intelbras"] as const;
const MODELOS_POR_MARCA: Record<(typeof MARCAS_DE_EQUIPAMENTO)[number], string[]> = {
  Fiberhome: ["AN5506-04-F", "HG6145F3"],
  Huawei: ["EG8145V5", "HG8245Q2"],
  ZTE: ["F670L", "F609"],
  Nokia: ["G-140W-C", "G-240W-A"],
  "TP-Link": ["Archer VR2100", "XC220-G3v"],
  Intelbras: ["ONU 121", "ONU 132"],
};
/** Valor padrão do ONU — o mesmo default histórico citado em `shared/schema.ts` (customers.equipmentEstimatedValue). */
const VALOR_DO_EQUIPAMENTO = 290;

/** Multa de saída e equipamento cobrados na fatura de rescisão — o formato que `shared/cobranca/multa.ts` lê. */
const MULTA_DE_SAIDA_PADRAO = 300;
const DIAS_PROPORCIONAL_DE_SAIDA = 15;

/**
 * A coordenada da pessoa fictícia é a que o "ERP" da demonstração informa — é
 * a procedência `erp` de `shared/geo-precisao.ts`. Sem ela (`geo_precisao`
 * nulo) o mapa da Rede não usa a coordenada nem como ponto nem como âncora da
 * bolha (`PRECISAO_CONFIAVEL`, `server/services/rede-regional.service.ts`), e
 * no banco local de 12/09/2026 o painel dizia "43 casos em 12 bairros" com o
 * mapa vazio.
 */
const GEO_PRECISAO_DA_DEMO: GeoPrecisao = "erp";

/**
 * O motivo do corte no texto cru de um ERP, na redação que
 * `normalizarMotivoCorte` (`shared/motivo-corte.ts`) reconhece — a família é a
 * primeira palavra, o resto é o detalhe que cada provedor escreve. Quem saiu
 * devendo foi cortado por dinheiro; quem pagou a fatura de saída pediu para
 * sair. Sem o motivo, o histórico do Cliente 360 mostra só "cancelado no ERP"
 * e o score não distingue calote de mudança de endereço.
 */
const MOTIVOS_DE_CORTE_FINANCEIRO = ["Financeiro", "Financeiro - inadimplência"];
const MOTIVOS_DE_CORTE_ADMINISTRATIVO = [
  "Administrativo - mudança de endereço",
  "Administrativo - pedido do titular",
  "Administrativo - portabilidade",
];

// ── Índices de pessoa fictícia: faixas disjuntas de propósito ──────────────
// Únicos: BASE_UNICO + provedor*PASSO_UNICO + cursor (0..9999 de folga por
// provedor — o maior uso real é 1350). Arestas (compartilhamento): bem acima,
// BASE_ARESTA + aresta*PASSO_ARESTA (0..149 por aresta) — nunca colide com a
// faixa única de nenhum provedor.
const BASE_UNICO = 0;
const PASSO_UNICO = 10_000;
const BASE_ARESTA = 500_000;
const PASSO_ARESTA = 1_000;

/**
 * O índice do par migrador-serial de EXEMPLO da demonstração (Tarefa 5,
 * `.superpowers/sdd/2026-09-11-demo-sandbox/task-5-brief.md`, Passo 3.7).
 * Fixo, reservado, fora de toda faixa já usada pelo mundo base: logo depois
 * do fim da faixa de aresta (`BASE_ARESTA + 4*PASSO_ARESTA` = 503_999) e bem
 * antes do início da zona reservada aos sandboxes (510_000, ver
 * `server/demo/sandbox.service.ts`). Exportado porque o teste do sandbox
 * precisa do MESMO valor para computar o CPF de exemplo — duas constantes
 * divergentes aqui seriam o tipo de coisa que só um teste pega.
 */
export const INDICE_MIGRADOR_DE_EXEMPLO = 504_000;
const CPF_DO_MIGRADOR_DE_EXEMPLO = cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO);

/** Há quantos dias o contrato ANTIGO do migrador foi cortado — a fatura de saída vence nesse dia e fica acima dos 90 dias de atraso. */
const DIAS_DESDE_O_CORTE_DO_MIGRADOR = 120;
/**
 * Há quantos dias o contrato NOVO do migrador começou. O chip promete "no
 * máximo 60 dias"; o relógio do mundo só desloca as datas depois de 7 dias sem
 * atualizar (`LIMIAR_DE_ATUALIZACAO_DO_MUNDO_DIAS`), então 45 + 6 fica sempre
 * dentro da promessa.
 */
const DIAS_DO_CONTRATO_NOVO_DO_MIGRADOR = 45;

function indicesDaAresta(aresta: number): number[] {
  const base = BASE_ARESTA + aresta * PASSO_ARESTA;
  return Array.from({ length: COMPARTILHADOS_POR_ARESTA }, (_, k) => base + k);
}

/** As arestas (0..3) que tocam este provedor — linha, não anel: ponta tem uma, meio tem duas. */
function arestasDoProvedor(indiceProvedor: number): number[] {
  const arestas: number[] = [];
  if (indiceProvedor - 1 >= 0) arestas.push(indiceProvedor - 1);
  if (indiceProvedor <= PROVEDORES_DA_DEMO.length - 2) arestas.push(indiceProvedor);
  return arestas;
}

/**
 * Os índices de pessoa fictícia por trás de cada `CPFS_COMPARTILHADOS[k]`, na
 * MESMA ordem (mesmo `k`, mesma pessoa) — as 4 arestas da linha, achatadas
 * (4 × 150 = 600).
 *
 * Exportado (rodada de correção, 12/09/2026) porque um CPF compartilhado não é
 * só um documento repetido: é a MESMA PESSOA em dois provedores, e quem
 * reaproveita `CPFS_COMPARTILHADOS[k]` como documento de um cliente precisa
 * também da IDENTIDADE que aquele documento implica — `pessoaFicticia(este
 * índice)`, nunca `pessoaFicticia` de outro índice qualquer. Ver o bug que
 * isto corrige em `server/demo/sandbox.service.ts` (`linhaDoCliente`).
 */
export const INDICES_COMPARTILHADOS: number[] = Array.from(
  { length: PROVEDORES_DA_DEMO.length - 1 },
  (_, aresta) => indicesDaAresta(aresta),
).flat();

/** Os CPFs que se repetem entre vizinhos — mesma ordem/índice de `INDICES_COMPARTILHADOS`. */
export const CPFS_COMPARTILHADOS: string[] = INDICES_COMPARTILHADOS.map(cpfFicticio);

type Categoria = "inadimplente" | "cancelado" | "em_dia";

interface EntradaDoPlano {
  personaIndex: number;
  categoria: Categoria;
  /** Posição dentro da própria categoria (0-based) — usada para ciclar idade, valor e equipamento. */
  posicaoNaCategoria: number;
}

/**
 * Monta os 1.500 clientes de um provedor: quem é inadimplente, quem é
 * cancelado e quem está em dia — e, dentro disso, QUAIS índices vêm de uma
 * aresta compartilhada com um vizinho em vez da faixa exclusiva do provedor.
 */
function planoDeIndices(indiceProvedor: number): EntradaDoPlano[] {
  const arestas = arestasDoProvedor(indiceProvedor);
  const compartilhados = arestas.flatMap(indicesDaAresta);
  const compartilhadosInadimplentes = compartilhados.slice(0, COMPARTILHADOS_INADIMPLENTES_POR_ARESTA * arestas.length);
  const compartilhadosEmDia = compartilhados.slice(COMPARTILHADOS_INADIMPLENTES_POR_ARESTA * arestas.length);

  const entradas: EntradaDoPlano[] = [];
  let cursorUnico = 0;
  const proximoIndiceUnico = () => BASE_UNICO + indiceProvedor * PASSO_UNICO + cursorUnico++;

  let posInadimplente = 0;
  for (const personaIndex of compartilhadosInadimplentes) {
    entradas.push({ personaIndex, categoria: "inadimplente", posicaoNaCategoria: posInadimplente++ });
  }
  while (posInadimplente < INADIMPLENTES_POR_PROVEDOR) {
    entradas.push({ personaIndex: proximoIndiceUnico(), categoria: "inadimplente", posicaoNaCategoria: posInadimplente++ });
  }

  for (let k = 0; k < CANCELADOS_POR_PROVEDOR; k++) {
    entradas.push({ personaIndex: proximoIndiceUnico(), categoria: "cancelado", posicaoNaCategoria: k });
  }

  let posEmDia = 0;
  for (const personaIndex of compartilhadosEmDia) {
    entradas.push({ personaIndex, categoria: "em_dia", posicaoNaCategoria: posEmDia++ });
  }
  while (entradas.length < CLIENTES_POR_PROVEDOR) {
    entradas.push({ personaIndex: proximoIndiceUnico(), categoria: "em_dia", posicaoNaCategoria: posEmDia++ });
  }

  return entradas;
}

function idadeRepresentativa(posicao: number): number {
  return IDADES_DE_VENCIMENTO_REPRESENTATIVAS[posicao % IDADES_DE_VENCIMENTO_REPRESENTATIVAS.length];
}

function valorMensalidade(personaIndex: number): number {
  return VALORES_DE_PLANO[Math.abs(personaIndex) % VALORES_DE_PLANO.length];
}

/** Mesmo índice de `valorMensalidade` — o nome do plano sempre bate com a mensalidade. */
function planoDoContrato(personaIndex: number): string {
  return NOMES_DE_PLANO[Math.abs(personaIndex) % NOMES_DE_PLANO.length];
}

function tenureMeses(personaIndex: number): number {
  return TENURE_MESES_REPRESENTATIVOS[Math.abs(personaIndex) % TENURE_MESES_REPRESENTATIVOS.length];
}

function recenciaCancelamentoMeses(posicaoNaCategoria: number): number {
  return RECENCIA_CANCELAMENTO_MESES[posicaoNaCategoria % RECENCIA_CANCELAMENTO_MESES.length];
}

/** `data` menos `meses` meses — aritmética de calendário local (a mesma ideia de `dataSemHora` em customers.storage.ts). */
function subtrairMeses(data: Date, meses: number): Date {
  const d = new Date(data.getTime());
  d.setMonth(d.getMonth() - meses);
  return d;
}

/** `data` menos `dias` dias — para o par migrador-serial, que precisa de precisão de dia, não de mês. */
function subtrairDias(data: Date, dias: number): Date {
  return new Date(data.getTime() - dias * DIA_MS);
}

/** Dias INTEIROS entre duas datas — `hoje` é sempre depois da âncora, aqui. Aceita `Date` ou o texto ISO que o banco de mentira devolve (ver mundo-base.test.ts). */
function diasEntre(hoje: Date, ancora: Date | string): number {
  return Math.floor((hoje.getTime() - new Date(ancora).getTime()) / DIA_MS);
}

/** `YYYY-MM-DD` local — `customers.contractStartDate` é DATE, e o driver do Drizzle não converte: lê e grava texto cru. */
function paraDataSemHora(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Quando este cliente saiu — só para "cancelado"; `null` para quem ainda é cliente. Função pura: mesma entrada, mesma data, sempre — usada tanto na linha do cliente quanto na fatura de saída, sem precisar passar o valor adiante. */
function cortadoEmDaEntrada(entrada: EntradaDoPlano, agora: Date): Date | null {
  if (entrada.categoria !== "cancelado") return null;
  return subtrairMeses(agora, recenciaCancelamentoMeses(entrada.posicaoNaCategoria));
}

/**
 * A fatura de saída deste ex-cliente foi paga? Alterna por posição: paga
 * alimenta a Economia REALIZADA, aberta alimenta a ESTIMADA — ver
 * `linhaDaFaturaDeSaida`. É também o que separa quem saiu devendo (a dívida é
 * a própria fatura de saída) de quem pediu para sair e acertou a conta.
 */
function saidaPaga(entrada: EntradaDoPlano): boolean {
  return entrada.posicaoNaCategoria % 2 === 0;
}

/** Multa + equipamento + proporcional: o valor da fatura de saída, o mesmo que `linhaDaFaturaDeSaida` grava. */
function valorDaFaturaDeSaida(personaIndex: number): number {
  const proporcional = Number((valorMensalidade(personaIndex) * DIAS_PROPORCIONAL_DE_SAIDA / 30).toFixed(2));
  return Number((MULTA_DE_SAIDA_PADRAO + VALOR_DO_EQUIPAMENTO + proporcional).toFixed(2));
}

/**
 * A dívida do ex-cliente que saiu devendo: exatamente a fatura de saída
 * vencida, contada desde o corte (é quando ela vence). `null` para quem pagou.
 *
 * Até 13/09/2026 todo cancelado da rede nascia com dívida zero, mesmo com
 * metade das faturas de saída em aberto: a coluna agregada e a fatura
 * contavam histórias opostas, e tudo que lê a coluna — o benchmark de
 * ex-clientes, o mapa da Rede — via uma rede sem nenhum ex-cliente devedor
 * (medido no banco local em 12/09/2026: 150 cancelados por provedor, zero com
 * `total_overdue_amount > 0`, e a tela comparava 39-62% do visitante contra 0%).
 */
function dividaDeSaida(personaIndex: number, cortadoEm: Date, agora: Date): { valor: number; dias: number } {
  return { valor: valorDaFaturaDeSaida(personaIndex), dias: diasEntre(agora, cortadoEm) };
}

/**
 * A faixa de risco com o vocabulário e a regra do produto — a mesma
 * expressão que o sync grava em `customers.risk_tier` e que
 * `server/demo/sandbox.service.ts` (`faixaDeRiscoDoAtraso`) repete e trava por
 * teste contra o texto de customers.storage.ts. Sem ela a rede ficava toda no
 * default do schema, 'low', inclusive quem devia havia 300 dias.
 */
function faixaDeRiscoDoAtraso(maxDaysOverdue: number): string {
  return maxDaysOverdue > 180 ? "critical" : maxDaysOverdue > 90 ? "high" : maxDaysOverdue > 60 ? "medium" : "low";
}

/**
 * Score coerente com a história de cada conta — as mesmas faixas de
 * `scoreDaEntrada` em `server/demo/sandbox.service.ts`. O default da coluna
 * (100) é o que `ispScoreReal` (cobranca.routes.ts) trata como "nunca
 * calculado": a rede inteira estava nele.
 */
function scoreEmDia(personaIndex: number): number {
  return 650 + (Math.abs(personaIndex) % 251);
}

function scoreDeInadimplente(diasDeAtraso: number): number {
  return Math.round(600 - Math.min(diasDeAtraso, 300) * (350 / 300));
}

/** Ex-cliente: quem pagou a saída fica mais alto, quem saiu devendo mais baixo — pior quanto mais antigo o corte. */
function scoreDeExCliente(pagou: boolean, cortadoEm: Date, agora: Date): number {
  const fracaoDoAno = Math.min((agora.getTime() - cortadoEm.getTime()) / DIA_MS, 365) / 365;
  return pagou ? Math.round(550 - fracaoDoAno * 100) : Math.round(400 - fracaoDoAno * 150);
}

function motivoCorteDaEntrada(entrada: EntradaDoPlano): string {
  const motivos = saidaPaga(entrada) ? MOTIVOS_DE_CORTE_ADMINISTRATIVO : MOTIVOS_DE_CORTE_FINANCEIRO;
  return motivos[entrada.posicaoNaCategoria % motivos.length];
}

interface DescritorDeEquipamento {
  status: string;
  value: number;
  /** true = não devolvido (conta no agregado do cliente); false = comodato normal (não conta). */
  retido: boolean;
}

/**
 * Qual equipamento (se algum) esta entrada leva — e o único lugar que decide
 * isso, usado tanto para a linha de `equipment` quanto para o agregado em
 * `customers`. Cancelado: os primeiros `CANCELADOS_COM_EQUIPAMENTO_RETIDO`
 * (por posição, não por índice de pessoa) ficam com a ONU não devolvida.
 * Ativo (em dia ou devendo): os ÚLTIMOS de cada categoria — nunca os
 * primeiros, porque os primeiros são justamente a fatia compartilhada com o
 * vizinho (ver `planoDeIndices`), e o comodato normal não precisa se
 * concentrar ali.
 */
function equipamentoDaEntrada(entrada: EntradaDoPlano): DescritorDeEquipamento | null {
  if (entrada.categoria === "cancelado" && entrada.posicaoNaCategoria < CANCELADOS_COM_EQUIPAMENTO_RETIDO) {
    const status = STATUS_DE_EQUIPAMENTO_RETIDO[entrada.posicaoNaCategoria % STATUS_DE_EQUIPAMENTO_RETIDO.length];
    return { status, value: VALOR_DO_EQUIPAMENTO, retido: true };
  }
  if (entrada.categoria === "inadimplente" && entrada.posicaoNaCategoria >= INADIMPLENTES_POR_PROVEDOR - INADIMPLENTES_COM_EQUIPAMENTO_COMODATO) {
    return { status: STATUS_DE_EQUIPAMENTO_COMODATO, value: VALOR_DO_EQUIPAMENTO, retido: false };
  }
  if (entrada.categoria === "em_dia" && entrada.posicaoNaCategoria >= EM_DIA_TOTAL_POR_PROVEDOR - EM_DIA_COM_EQUIPAMENTO_COMODATO) {
    return { status: STATUS_DE_EQUIPAMENTO_COMODATO, value: VALOR_DO_EQUIPAMENTO, retido: false };
  }
  return null;
}

function linhaDoCliente(providerId: number, entrada: EntradaDoPlano, agora: Date): InsertCustomer {
  const pessoa = pessoaFicticia(entrada.personaIndex);
  const equip = equipamentoDaEntrada(entrada);
  const cortadoEm = cortadoEmDaEntrada(entrada, agora);
  // O tempo de casa conta a partir do CORTE para quem já saiu, e de hoje para
  // quem ainda é cliente — nunca de "hoje" para um ex-cliente (infla a tenure).
  const contractStartDate = paraDataSemHora(subtrairMeses(cortadoEm ?? agora, tenureMeses(entrada.personaIndex)));

  const base: InsertCustomer = {
    providerId,
    name: pessoa.nome,
    cpfCnpj: pessoa.cpf,
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
    geoPrecisao: GEO_PRECISAO_DA_DEMO,
    contractStartDate,
    contractPlan: planoDoContrato(entrada.personaIndex),
    // Default de schema e "manual" (shared/schema.ts:357) — o mesmo "veio do
    // ERP ou foi digitado" que `invoices.erpSource` marca. Sem isto
    // `novaDividaAposSaldoZerado` (server/storage/cobranca.storage.ts:1676) e
    // o card de qualidade do Cliente 360 tratam a demonstracao inteira como
    // dado nao verificavel.
    erpSource: FONTE_ERP_DEMO,
    // `recalculateCustomerEquipmentAggregate` (server/storage/equipment.storage.ts)
    // só CONTA equipamento em estado retido — comodato normal fica em 0/"0",
    // e é o valor CERTO (o card de perda do anti-fraude lê estas duas
    // colunas, não "tem equipamento? sim/não"). Escrito sempre, explícito —
    // as duas têm default de SCHEMA (0/"0"), então omitir funcionaria contra
    // um Postgres de verdade, mas é o único par, entre tudo que este arquivo
    // grava, com default não-nulo: melhor não depender disso.
    equipmentCount: equip?.retido ? 1 : 0,
    equipmentEstimatedValue: equip?.retido ? equip.value.toFixed(2) : "0.00",
    ...(cortadoEm ? { cortadoEm } : {}),
  };

  if (entrada.categoria === "inadimplente") {
    const maxDaysOverdue = idadeRepresentativa(entrada.posicaoNaCategoria);
    return {
      ...base,
      status: "active",
      paymentStatus: "overdue",
      totalOverdueAmount: valorMensalidade(entrada.personaIndex).toFixed(2),
      maxDaysOverdue,
      overdueInvoicesCount: 1,
      ispScore: scoreDeInadimplente(maxDaysOverdue),
      riskTier: faixaDeRiscoDoAtraso(maxDaysOverdue),
    };
  }
  if (entrada.categoria === "cancelado") {
    // `paymentStatus` segue a regra do sync (customers.storage.ts): `overdue`
    // se há valor em aberto, sem olhar o status do contrato — a mesma que
    // `sandbox.service.ts` aplica ao ex-cliente do visitante. A carteira de
    // ativos não infla: cobrança, régua e kanban separam as carteiras pelo
    // status do contrato, nunca por `payment_status`.
    const pagou = saidaPaga(entrada);
    const divida = pagou ? null : dividaDeSaida(entrada.personaIndex, cortadoEm!, agora);
    const maxDaysOverdue = divida?.dias ?? 0;
    return {
      ...base,
      status: "cancelled",
      paymentStatus: divida ? "overdue" : "current",
      totalOverdueAmount: divida ? divida.valor.toFixed(2) : "0.00",
      maxDaysOverdue,
      overdueInvoicesCount: divida ? 1 : 0,
      ispScore: scoreDeExCliente(pagou, cortadoEm!, agora),
      riskTier: faixaDeRiscoDoAtraso(maxDaysOverdue),
      motivoCorte: motivoCorteDaEntrada(entrada),
    };
  }
  return {
    ...base,
    status: "active",
    paymentStatus: "current",
    totalOverdueAmount: "0.00",
    maxDaysOverdue: 0,
    overdueInvoicesCount: 0,
    ispScore: scoreEmDia(entrada.personaIndex),
    riskTier: faixaDeRiscoDoAtraso(0),
  };
}

function linhaDaFatura(providerId: number, customerId: number, entrada: EntradaDoPlano, agora: Date): InsertInvoice {
  const idadeDias = idadeRepresentativa(entrada.posicaoNaCategoria);
  const vencimento = new Date(agora.getTime() - idadeDias * DIA_MS);
  return {
    customerId,
    providerId,
    value: valorMensalidade(entrada.personaIndex).toFixed(2),
    dueDate: vencimento,
    status: "overdue",
    // `erp_source` nulo = digitada a mao (shared/schema.ts:444) — sem isto
    // `baseDeFaturas` fica 0 e `/api/cobranca/carteira/mes` responde
    // `live:false` para a demonstracao inteira. `erpRef` unico por
    // (provider, fonte) — ver o uniqueIndex em `invoices` — e o `customerId`
    // ja e globalmente unico, entao basta prefixar.
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-fatura-${customerId}`,
  };
}

function formatarReal(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/**
 * A fatura de SAÍDA do ex-cliente — sem ela a carteira de ex-clientes inteira
 * (Economia, multa, prejuízo, "carteira em dois espaços") abre vazia na demo.
 *
 * Descrição no formato que `shared/cobranca/multa.ts` (`parcelasDaDescricao`)
 * lê: "Proporcional N dias + multa X,XX + equipamento Y,YY" — os três valores
 * batem exatamente com `value` (multa + equipamento + proporcional), então o
 * parser nunca precisa clampar nada. Paga alimenta `erpConfirmaPagamentos`
 * (server/storage/faturas.storage.ts) e a Economia REALIZADA; aberta alimenta
 * `cobrancasDeSaida` (ela só lê `STATUS_FATURA_ABERTA = ["aberta","pending","overdue"]`
 * — "overdue" está nessa lista, confirmado em faturas.storage.ts:63) e a
 * Economia ESTIMADA. Sem as duas, só um dos dois caminhos teria o que mostrar.
 */
function linhaDaFaturaDeSaida(providerId: number, customerId: number, personaIndex: number, paga: boolean, cortadoEm: Date): InsertInvoice {
  const valor = valorDaFaturaDeSaida(personaIndex);
  const descricao = `Proporcional ${DIAS_PROPORCIONAL_DE_SAIDA} dias + multa ${formatarReal(MULTA_DE_SAIDA_PADRAO)} + equipamento ${formatarReal(VALOR_DO_EQUIPAMENTO)}`;

  return {
    customerId,
    providerId,
    value: valor.toFixed(2),
    dueDate: cortadoEm,
    status: paga ? "paid" : "overdue",
    descricao,
    // Mesma razao da fatura normal: sem `erpSource`/`erpRef` esta fatura conta
    // como "digitada a mao" e nem `erpConfirmaPagamentos` nem `mensalidadeDoCliente`
    // a enxergam — a Economia do ex-cliente (realizada OU estimada) fica sem nada
    // para ler.
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-saida-${customerId}`,
    ...(paga ? { paidDate: cortadoEm, paidValue: valor.toFixed(2) } : {}),
  };
}

/** MAC determinístico a partir do índice — só para o campo não ficar vazio. */
function macFicticio(indice: number): string {
  const hex = Math.trunc(Math.abs(indice)).toString(16).padStart(8, "0").slice(-8);
  return `9C:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:FF`.toUpperCase();
}

function linhaDoEquipamento(providerId: number, customerId: number, entrada: EntradaDoPlano, descritor: DescritorDeEquipamento): InsertEquipment {
  const posicao = entrada.posicaoNaCategoria;
  const marca = MARCAS_DE_EQUIPAMENTO[posicao % MARCAS_DE_EQUIPAMENTO.length];
  const modelos = MODELOS_POR_MARCA[marca];
  const modelo = modelos[posicao % modelos.length];
  return {
    customerId,
    providerId,
    type: "ONU",
    brand: marca,
    model: modelo,
    serialNumber: `SN${String(entrada.personaIndex).padStart(8, "0")}`,
    mac: macFicticio(entrada.personaIndex),
    status: descritor.status,
    value: descritor.value.toFixed(2),
  };
}

/**
 * Os dois lados do par migrador-serial de EXEMPLO (Tarefa 5, Passo 3.7; refeito
 * em 13/09/2026). O chip promete "saiu devendo de um provedor e contratou outro
 * há pouco tempo", e até ali a base contava o contrário: a dívida no provedor
 * NOVO, o contrato antigo sem dívida e nenhuma consulta recente de ninguém.
 *
 *   - `contrato_antigo` (rede-1): cancelado há `DIAS_DESDE_O_CORTE_DO_MIGRADOR`
 *     dias, com a fatura de saída vencida desde então e motivo financeiro;
 *   - `contrato_novo` (rede-2): ativo e em dia, começado há
 *     `DIAS_DO_CONTRATO_NOVO_DO_MIGRADOR` dias, com a primeira mensalidade paga.
 *
 * Vive no MUNDO BASE, nunca no sandbox: quem consulta é sempre o sandbox do
 * visitante, e `detectMigrator` pula `erp.providerId === consultingProviderId`
 * — colocar o par no próprio sandbox nunca dispararia nada.
 *
 * AIDEV-NOTE: o contrato antigo NÃO tem `contractStartDate`, de propósito.
 * `detectMigrator` (server/services/migrator-detection.service.ts) só aceita o
 * cancelamento como "recente" pela `registrationDate`, que a consulta preenche
 * com o INÍCIO do contrato (`realtime-query.service.ts`, normalizeCustomer) —
 * e um contrato começado há menos de 90 dias não tem como carregar uma saída
 * vencida há mais de 90. Um ERP que não informa a data do contrato é caso real
 * (e é o ramo que a detecção trata como recente). Ver a AIDEV-QUESTION no
 * retorno do pacote: a detecção deveria ler `cortadoEm`.
 */
type PapelDoMigrador = "contrato_antigo" | "contrato_novo";

/** Qual lado do par cada provedor da rede carrega — por posição em `PROVEDORES_DA_DEMO`. */
const PAPEL_DO_MIGRADOR_POR_PROVEDOR: Partial<Record<number, PapelDoMigrador>> = { 0: "contrato_antigo", 1: "contrato_novo" };

function linhaDoMigradorDeExemplo(providerId: number, papel: PapelDoMigrador, agora: Date): InsertCustomer {
  const pessoa = pessoaFicticia(INDICE_MIGRADOR_DE_EXEMPLO);
  const comum: InsertCustomer = {
    providerId,
    name: pessoa.nome,
    cpfCnpj: CPF_DO_MIGRADOR_DE_EXEMPLO,
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
    geoPrecisao: GEO_PRECISAO_DA_DEMO,
    equipmentCount: 0,
    equipmentEstimatedValue: "0.00",
    contractPlan: planoDoContrato(INDICE_MIGRADOR_DE_EXEMPLO),
    // Mesma razao de `linhaDoCliente`: sem isto este par conta como "digitado
    // a mao" para quem le `customers.erpSource`.
    erpSource: FONTE_ERP_DEMO,
  };

  if (papel === "contrato_antigo") {
    const cortadoEm = subtrairDias(agora, DIAS_DESDE_O_CORTE_DO_MIGRADOR);
    const divida = dividaDeSaida(INDICE_MIGRADOR_DE_EXEMPLO, cortadoEm, agora);
    return {
      ...comum,
      status: "cancelled",
      paymentStatus: "overdue",
      totalOverdueAmount: divida.valor.toFixed(2),
      maxDaysOverdue: divida.dias,
      overdueInvoicesCount: 1,
      ispScore: scoreDeExCliente(false, cortadoEm, agora),
      riskTier: faixaDeRiscoDoAtraso(divida.dias),
      motivoCorte: MOTIVOS_DE_CORTE_FINANCEIRO[0],
      cortadoEm,
      contractStartDate: null,
    };
  }
  return {
    ...comum,
    status: "active",
    paymentStatus: "current",
    totalOverdueAmount: "0.00",
    maxDaysOverdue: 0,
    overdueInvoicesCount: 0,
    ispScore: scoreEmDia(INDICE_MIGRADOR_DE_EXEMPLO),
    riskTier: faixaDeRiscoDoAtraso(0),
    contractStartDate: paraDataSemHora(subtrairDias(agora, DIAS_DO_CONTRATO_NOVO_DO_MIGRADOR)),
  };
}

/** A fatura de cada lado do par: a saída vencida do contrato antigo; a primeira mensalidade, paga, do novo. */
function faturaDoMigradorDeExemplo(providerId: number, customerId: number, papel: PapelDoMigrador, agora: Date): InsertInvoice {
  if (papel === "contrato_antigo") {
    return linhaDaFaturaDeSaida(providerId, customerId, INDICE_MIGRADOR_DE_EXEMPLO, false, subtrairDias(agora, DIAS_DESDE_O_CORTE_DO_MIGRADOR));
  }
  const valor = valorMensalidade(INDICE_MIGRADOR_DE_EXEMPLO).toFixed(2);
  return {
    customerId,
    providerId,
    value: valor,
    // Um mês depois do começo do contrato, paga na véspera.
    dueDate: subtrairDias(agora, DIAS_DO_CONTRATO_NOVO_DO_MIGRADOR - 30),
    status: "paid",
    paidDate: subtrairDias(agora, DIAS_DO_CONTRATO_NOVO_DO_MIGRADOR - 29),
    paidValue: valor,
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-fatura-${customerId}`,
  };
}

/**
 * A carteira inteira de um provedor da rede, como ELA DEVE SER no instante
 * `agora` — a única descrição do mundo base, usada pelos dois escritores: a
 * semeadura (que insere) e o complemento (que reescreve um mundo antigo). Uma
 * descrição só é o que garante que os dois chegam ao mesmo lugar.
 *
 * Faturas e equipamentos dependem do `id` de cada cliente, que só existe
 * depois de gravado (semeadura) ou lido (complemento) — por isso vêm como
 * funções dos ids, na MESMA ordem de `clientes`.
 */
interface CarteiraPlanejada {
  clientes: InsertCustomer[];
  faturas(idsDosClientes: readonly number[]): InsertInvoice[];
  equipamentos(idsDosClientes: readonly number[]): InsertEquipment[];
}

function carteiraPlanejada(indiceProvedor: number, providerId: number, agora: Date): CarteiraPlanejada {
  const entradas = planoDeIndices(indiceProvedor);
  const papelDoMigrador = PAPEL_DO_MIGRADOR_POR_PROVEDOR[indiceProvedor];
  const clientes = entradas.map((e) => linhaDoCliente(providerId, e, agora));
  if (papelDoMigrador) clientes.push(linhaDoMigradorDeExemplo(providerId, papelDoMigrador, agora));

  return {
    clientes,
    faturas: (ids) => {
      const linhas: InsertInvoice[] = [];
      entradas.forEach((entrada, k) => {
        if (entrada.categoria === "inadimplente") {
          linhas.push(linhaDaFatura(providerId, ids[k], entrada, agora));
        } else if (entrada.categoria === "cancelado") {
          // Todo ex-cliente leva fatura de saída — sem isto a Economia do ex-cliente,
          // a multa e o prejuízo abrem vazios para a carteira inteira (150/provedor).
          linhas.push(linhaDaFaturaDeSaida(providerId, ids[k], entrada.personaIndex, saidaPaga(entrada), cortadoEmDaEntrada(entrada, agora)!));
        }
      });
      if (papelDoMigrador) linhas.push(faturaDoMigradorDeExemplo(providerId, ids[entradas.length], papelDoMigrador, agora));
      return linhas;
    },
    equipamentos: (ids) => entradas.flatMap((entrada, k) => {
      const descritor = equipamentoDaEntrada(entrada);
      return descritor ? [linhaDoEquipamento(providerId, ids[k], entrada, descritor)] : [];
    }),
  };
}

/**
 * CNPJ fictício determinístico para os 5 provedores — mesma ideia do
 * `cpfFicticio` da Tarefa 2 (dígito verificador válido pelo algoritmo da
 * Receita), com raiz "40" + índice do provedor + filial "0001". CNPJ não tem
 * uma faixa reservada como o "999" do CPF, mas isso não importa aqui: a
 * demonstração roda num banco isolado, que nunca chama SPC/cadastral de
 * verdade (`DEMO_MODE`) — 5 CNPJs fictícios não colidem com nada que este
 * banco algum dia consulte.
 */
function digitoVerificadorCnpj(digitos: number[], pesos: number[]): number {
  const soma = digitos.reduce((acc, d, idx) => acc + d * pesos[idx], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjFicticio(indiceProvedor: number): string {
  const raiz = `40${String(indiceProvedor).padStart(6, "0")}0001`; // 12 dígitos: raiz (8) + filial (4)
  const digitos = raiz.split("").map(Number);
  const d1 = digitoVerificadorCnpj(digitos, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificadorCnpj([...digitos, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${raiz}${d1}${d2}`;
}

/**
 * A mesorregião IBGE das quatro cidades do mundo fictício: Londrina, Ibiporã,
 * Cambé e Apucarana são todas do Norte Central Paranaense — conferido contra
 * `shared/data/cidades-brasil.json` em `sandbox.service.test.ts`, e não
 * digitado de memória.
 *
 * É a chave da busca regional (`getProvidersByMesoregion`, em
 * `server/services/regional.service.ts`). Sem ela, nem os cinco provedores da
 * rede nem o sandbox estavam na região de ninguém, e o painel do visitante
 * mostrava zero provedores parceiros — medido no ar em 12/09/2026.
 */
export const MESORREGIAO_DO_MUNDO_BASE = "Norte Central Paranaense";

/**
 * `typeof providers.$inferInsert`, e não `InsertProvider` (`shared/schema.ts`):
 * aquele tipo vem de `createInsertSchema(providers).omit({id: true, createdAt: true})`
 * — OMITE `created_at` de propósito, para a ROTA de cadastro nunca aceitar um
 * cliente inventando a própria data de criação. Aqui é o oposto: esta função
 * PRECISA escrever `created_at` explícito (ver o comentário no campo, abaixo)
 * — o tipo mais estrito da rota não se aplica a um seed interno que nunca
 * passa por validação de request.
 */
function linhaDoProvedor(indice: number, p: ProvedorDaDemo, agora: Date): typeof providers.$inferInsert {
  return {
    name: p.nome,
    cnpj: cnpjFicticio(indice),
    subdomain: p.subdomain,
    plan: "enterprise",
    status: "active",
    verificationStatus: "approved",
    ispCredits: 999_999,
    // Crédito único (`migrations/0008_credito_unico.sql`): nenhum caminho de
    // consumo debita `spc_credits`, e o painel soma os dois bolsos.
    spcCredits: 0,
    addressCity: p.cidade,
    addressState: "PR",
    // SÓ a mesorregião, de propósito: é ela que o benchmark regional e o card
    // "Provedores parceiros" cruzam (`getProvidersByMesoregion`). As cidades
    // atendidas alimentam outra busca, a da tela de Regionalização, que hoje
    // mostra o NOME de cada provedor vizinho — o contrário do código de
    // parceiro que o resto do produto usa. Enquanto aquela tela mostrar nome, a
    // demonstração não a povoa com a rede.
    mesorregioes: [MESORREGIAO_DO_MUNDO_BASE],
    contactEmail: `contato@${p.subdomain}.demo.consultaisp.com.br`,
    // Explícito, e não o `defaultNow()` do schema: esta coluna dobra como a
    // ÂNCORA do relógio do mundo fictício (ver `atualizarRelogioDoMundoBaseSePreciso`
    // logo abaixo) — precisa ser EXATAMENTE o `agora` que ancorou toda data
    // gravada nesta rodada, não um instante alguns milissegundos depois.
    createdAt: agora,
  };
}

/** Placeholder de token — nunca uma credencial de verdade: o conector "demo" não fala com ERP nenhum, só lê a base local por `config.extra.providerId`. */
const TOKEN_DE_FACHADA = "sem-credencial-real-fonte-demo";
/** URL de fachada — nunca resolvida: só precisa passar em `new URL(...)` para o guard de `realtime-query.service.ts`/`snapshot-ao-vivo.service.ts` liberar a consulta ao vivo. */
const URL_DE_FACHADA = "demo://mundo-base";

/**
 * A integração `erp_integrations` de cada provedor da demo — rodada de
 * correção (11/09/2026): sem `apiUrl`/`apiToken`, `buildErpConfig`
 * (`server/services/realtime-query.service.ts:100-119`) lança antes de
 * `getConnector` ser chamado, e a consulta ao vivo NUNCA alcança o conector
 * "demo" — a mesma falha ("nada consta") que a Tarefa 4 existia para evitar.
 *
 * `apiToken` é campo SENSÍVEL (`SENSITIVE_FIELDS` em
 * `server/storage/erp.storage.ts`) e é decifrado na leitura
 * (`decryptIntegration`/`decryptField`, `server/utils/crypto.ts`) pelo MESMO
 * caminho que a tela de superadmin usa para gravar credencial de verdade —
 * por isso o placeholder passa por `encryptField`, e não por texto cru:
 * `decryptField` até tolera texto legado sem o prefixo `enc:` (não lançaria),
 * mas gravar sem cifrar deixaria esta linha como a ÚNICA em toda a tabela sem
 * o prefixo — o tipo de detalhe que confunde quem um dia auditar
 * `SELECT * FROM erp_integrations` esperando `enc:` em todas.
 *
 * `erpSource` NÃO entra nos caminhos de ESCRITA (`syncProviderToDb` em
 * `server/services/erp-sync.service.ts` pula a fonte `FONTE_ERP_DEMO` antes
 * de qualquer tentativa) — só na leitura ao vivo. Ver `server/erp/fonte-demo.ts`.
 */
export function linhaDaIntegracao(providerId: number): InsertErpIntegration {
  return {
    providerId,
    erpSource: FONTE_ERP_DEMO,
    isEnabled: true,
    status: "idle",
    apiUrl: URL_DE_FACHADA,
    apiToken: encryptField(TOKEN_DE_FACHADA),
  };
}

async function inserirClientesEmBlocos(executor: Executor, linhas: InsertCustomer[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    const bloco = linhas.slice(i, i + TAMANHO_DO_BLOCO);
    const inseridos = await executor.insert(customers).values(bloco).returning({ id: customers.id });
    ids.push(...inseridos.map((r) => r.id));
  }
  return ids;
}

async function inserirFaturasEmBlocos(executor: Executor, linhas: InsertInvoice[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    await executor.insert(invoices).values(linhas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

async function inserirEquipamentosEmBlocos(executor: Executor, linhas: InsertEquipment[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    await executor.insert(equipment).values(linhas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

async function semearUmProvedor(tx: Executor, indice: number, agora: Date): Promise<{ providerId: number; clientes: number }> {
  const provedor = PROVEDORES_DA_DEMO[indice];
  const [criado] = await tx.insert(providers).values(linhaDoProvedor(indice, provedor, agora)).returning({ id: providers.id });
  const providerId = criado.id;

  await tx.insert(erpIntegrations).values(linhaDaIntegracao(providerId));

  // O par migrador-serial de exemplo entra junto com a carteira do provedor
  // que o carrega — mesma transação, mesmo guard de idempotência.
  const plano = carteiraPlanejada(indice, providerId, agora);
  const idsClientes = await inserirClientesEmBlocos(tx, plano.clientes);
  await inserirFaturasEmBlocos(tx, plano.faturas(idsClientes));
  await inserirEquipamentosEmBlocos(tx, plano.equipamentos(idsClientes));

  return { providerId, clientes: CLIENTES_POR_PROVEDOR };
}

// ── Consultas cruzadas da rede (13/09/2026) ─────────────────────────────────

/**
 * Marca no `result` de toda consulta que o mundo base semeia — quem um dia
 * abrir a linha no superadmin ou num export LGPD precisa saber que ela não
 * veio de uma tela.
 */
const ORIGEM_DAS_CONSULTAS_DA_REDE = "mundo_base_da_demonstracao";

/**
 * As consultas do CPF do migrador de exemplo: a rede-2 na véspera do contrato
 * novo, e dois outros provedores nos últimos 30 dias — o "2 a 3 consultas
 * recentes de provedores diferentes" que o alerta de migrador conta
 * (`consultas30d` em consultas.routes.ts). Nenhuma da rede-1, a dona da
 * dívida. Com o relógio andando até 6 dias antes de atualizar, 12 e 4 dias
 * continuam dentro da janela.
 */
const CONSULTAS_DO_MIGRADOR: readonly { indiceProvedor: number; dias: number; score: number }[] = [
  { indiceProvedor: 1, dias: DIAS_DO_CONTRATO_NOVO_DO_MIGRADOR + 1, score: 340 },
  { indiceProvedor: 2, dias: 12, score: 250 },
  { indiceProvedor: 4, dias: 4, score: 230 },
];

/**
 * A régua do score para a decisão, a mesma de `calcularScoreISP`
 * (server/utils/isp-score.ts) e do INSERT da consulta (consultas.routes.ts):
 * 701+ aprova, 501+ aprova com atenção, 301+ vai para análise, abaixo rejeita;
 * `decisionReco` só é Accept/Reject nas pontas. Nenhuma das duas é exportada.
 */
function reguaDoScore(score: number): { faixa: string; nivelRisco: string; sugestaoIA: string; decisionReco: "Accept" | "Review" | "Reject" } {
  if (score >= 701) return { faixa: "excelente", nivelRisco: "baixo", sugestaoIA: "APROVAR", decisionReco: "Accept" };
  if (score >= 501) return { faixa: "bom", nivelRisco: "moderado", sugestaoIA: "APROVAR COM ATENCAO", decisionReco: "Review" };
  if (score >= 301) return { faixa: "baixo", nivelRisco: "alto", sugestaoIA: "ANALISE MANUAL", decisionReco: "Review" };
  return { faixa: "muito_baixo", nivelRisco: "muito_alto", sugestaoIA: "REJEITAR", decisionReco: "Reject" };
}

function linhaDaConsulta(providerId: number, userId: number, cpf: string, score: number, criadaEm: Date, migrador: boolean): typeof ispConsultations.$inferInsert {
  const regua = reguaDoScore(score);
  return {
    providerId,
    userId,
    cpfCnpj: cpf,
    searchType: "cpf",
    score,
    decisionReco: regua.decisionReco,
    // Consulta que achou o CPF em outro provedor custa o crédito ISP.
    cost: CUSTO_EM_CREDITOS.isp,
    approved: score >= 500,
    // `consultaId` fica nulo: o código embute o mês da consulta, e o relógio
    // do mundo desloca a data — um código fixo passaria a apontar para o mês
    // errado. Ninguém de fora do provedor dono vê o código.
    createdAt: criadaEm,
    result: {
      origem: ORIGEM_DAS_CONSULTAS_DA_REDE,
      score,
      faixa: regua.faixa,
      nivelRisco: regua.nivelRisco,
      sugestaoIA: regua.sugestaoIA,
      decisionReco: regua.decisionReco,
      // A linha do tempo lê só `detected` para o selo "Migrador detectado".
      ...(migrador ? { migratorAlert: { detected: true, severity: "high" } } : {}),
    },
  };
}

/**
 * As consultas que os provedores da rede fizeram nos últimos 90 dias. SÓ
 * sobre CPFs que a rede compartilha (`CPFS_COMPARTILHADOS`) e o do migrador:
 * as linhas do mundo base são permanentes (a limpeza de sandbox não as apaga),
 * então uma consulta de provedor base sobre um CPF exclusivo de sandbox seria
 * uma pessoa inventada para um visitante sobrevivendo ao sandbox dele.
 *
 * Quem consulta um CPF compartilhado são os três provedores que NÃO o têm
 * como cliente (a pessoa pedindo instalação no vizinho), de uma a três vezes,
 * com score e data espalhados — é o que dá à linha do tempo o delta de score
 * e ao 360 a "Rede colaborativa" com mais de um provedor. Devedor na rede sai
 * com score baixo; quem está em dia, alto.
 */
function consultasDoMundoBase(idsDosProvedores: readonly number[], idsDosAnalistas: readonly number[], agora: Date): (typeof ispConsultations.$inferInsert)[] {
  const devedoresNaRede = new Set(
    PROVEDORES_DA_DEMO.flatMap((_, i) => planoDeIndices(i).filter((e) => e.categoria === "inadimplente").map((e) => e.personaIndex)),
  );
  const linhas: (typeof ispConsultations.$inferInsert)[] = [];

  INDICES_COMPARTILHADOS.forEach((personaIndex, k) => {
    const aresta = Math.floor(k / COMPARTILHADOS_POR_ARESTA);
    const vizinhos = PROVEDORES_DA_DEMO.map((_, i) => i).filter((i) => i !== aresta && i !== aresta + 1);
    const quantidade = 1 + ((k * 7 + aresta) % 3);
    const devedor = devedoresNaRede.has(personaIndex);
    for (let t = 0; t < quantidade; t++) {
      const consulente = vizinhos[(k + t) % vizinhos.length];
      const dias = 1 + ((k * 37 + t * 29) % 89); // 1..89: dentro dos 90 dias, nunca hoje nem no futuro
      const horas = (k * 5 + t * 7) % 11;
      const score = devedor ? 180 + ((k * 13 + t * 41) % 240) : 560 + ((k * 17 + t * 43) % 380);
      const criadaEm = new Date(agora.getTime() - dias * DIA_MS - horas * HORA_MS);
      linhas.push(linhaDaConsulta(idsDosProvedores[consulente], idsDosAnalistas[consulente], CPFS_COMPARTILHADOS[k], score, criadaEm, false));
    }
  });

  for (const c of CONSULTAS_DO_MIGRADOR) {
    linhas.push(linhaDaConsulta(
      idsDosProvedores[c.indiceProvedor], idsDosAnalistas[c.indiceProvedor], CPF_DO_MIGRADOR_DE_EXEMPLO, c.score, subtrairDias(agora, c.dias), true,
    ));
  }
  return linhas;
}

/** O e-mail do analista que assina as consultas de um provedor da rede. */
function emailDoAnalista(p: ProvedorDaDemo): string {
  return `analise@${p.subdomain}.demo.consultaisp.com.br`;
}

/**
 * `isp_consultations.user_id` é obrigatório, e os provedores da rede nunca
 * tiveram usuário. Um por provedor, papel `user`, com a senha trocada por um
 * hash de bytes aleatórios que ninguém conhece: existe para assinar a
 * consulta, não para entrar no sistema.
 */
function linhaDoAnalista(indice: number, providerId: number, senhaHash: string): typeof users.$inferInsert {
  const p = PROVEDORES_DA_DEMO[indice];
  return {
    email: emailDoAnalista(p),
    password: senhaHash,
    name: `Análise de crédito · ${p.nome}`,
    role: "user",
    providerId,
    emailVerified: true,
  };
}

async function semearConsultasDaRede(tx: Executor, idsDosProvedores: readonly number[], agora: Date): Promise<void> {
  const emails = PROVEDORES_DA_DEMO.map(emailDoAnalista);
  const existentes = await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails));
  const idPorEmail = new Map(existentes.map((u) => [u.email, u.id]));
  const faltando = PROVEDORES_DA_DEMO.map((_, i) => i).filter((i) => !idPorEmail.has(emails[i]));
  if (faltando.length > 0) {
    const senhaHash = await hashPassword(crypto.randomBytes(24).toString("hex"));
    const criados = await tx.insert(users)
      .values(faltando.map((i) => linhaDoAnalista(i, idsDosProvedores[i], senhaHash)))
      .returning({ id: users.id, email: users.email });
    for (const u of criados) idPorEmail.set(u.email, u.id);
  }

  const consultas = consultasDoMundoBase(idsDosProvedores, emails.map((e) => idPorEmail.get(e)!), agora);
  for (let i = 0; i < consultas.length; i += TAMANHO_DO_BLOCO) {
    await tx.insert(ispConsultations).values(consultas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

// ── Complemento: um mundo antigo vira o mundo atual (13/09/2026) ─────────────

type TipoDaColuna = "text" | "numeric" | "integer" | "timestamp" | "date";

/**
 * `update <tabela> set ... from (values ...) where id = v.id`, em blocos: a
 * reescrita da carteira toca ~7.500 clientes, e um UPDATE por linha seria uma
 * ida ao banco por cliente dentro da primeira criação de sandbox depois do
 * deploy. Cada valor já vai no formato que o INSERT gravaria (texto ISO para
 * timestamp, "AAAA-MM-DD" para date) e o cast fica no SET, porque um parâmetro
 * dentro de VALUES chega ao Postgres sem tipo.
 */
async function atualizarPorIdEmBlocos(tx: Executor, tabela: string, colunas: readonly (readonly [string, TipoDaColuna])[], linhas: readonly unknown[][]): Promise<void> {
  const v = sql.identifier("v");
  const t = sql.identifier(tabela);
  const atribuicoes = sql.join(colunas.map(([nome, tipo]) => sql`${sql.identifier(nome)} = ${v}.${sql.identifier(nome)}::${sql.raw(tipo)}`), sql`, `);
  const nomes = sql.join([sql.identifier("id"), ...colunas.map(([nome]) => sql.identifier(nome))], sql`, `);
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    const tuplas = sql.join(
      linhas.slice(i, i + TAMANHO_DO_BLOCO).map((linha) => sql`(${sql.join(linha.map((valor) => sql`${valor}`), sql`, `)})`),
      sql`, `,
    );
    await tx.execute(sql`update ${t} set ${atribuicoes} from (values ${tuplas}) as ${v}(${nomes}) where ${t}.${sql.identifier("id")} = ${v}.${sql.identifier("id")}::integer`);
  }
}

const paraTextoIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** O que muda num cliente entre o formato antigo e o atual. Nome, endereço, plano e agregado de equipamento nunca mudaram. */
const COLUNAS_DO_CLIENTE = [
  ["status", "text"], ["payment_status", "text"], ["total_overdue_amount", "numeric"], ["max_days_overdue", "integer"],
  ["overdue_invoices_count", "integer"], ["geo_precisao", "text"], ["motivo_corte", "text"], ["isp_score", "integer"],
  ["risk_tier", "text"], ["cortado_em", "timestamp"], ["contract_start_date", "date"],
] as const;

function valoresDoCliente(c: InsertCustomer): unknown[] {
  return [
    c.status, c.paymentStatus, c.totalOverdueAmount, c.maxDaysOverdue, c.overdueInvoicesCount, c.geoPrecisao ?? null,
    c.motivoCorte ?? null, c.ispScore, c.riskTier, paraTextoIso(c.cortadoEm), c.contractStartDate ?? null,
  ];
}

const COLUNAS_DA_FATURA = [
  ["value", "numeric"], ["due_date", "timestamp"], ["status", "text"], ["paid_date", "timestamp"], ["paid_value", "numeric"], ["descricao", "text"],
] as const;

function valoresDaFatura(f: InsertInvoice): unknown[] {
  return [f.value, paraTextoIso(f.dueDate), f.status, paraTextoIso(f.paidDate), f.paidValue ?? null, f.descricao ?? null];
}

/**
 * Reescreve a carteira de cada provedor da rede para `carteiraPlanejada` no
 * instante `agora` (a âncora do relógio do mundo). Os clientes são casados
 * pelo CPF, as faturas pelo `erpRef` e os equipamentos pelo número de série —
 * as chaves que a semeadura antiga e a nova escrevem igual. O que falta
 * (a fatura de saída do migrador, a ONU do inadimplente) é inserido.
 *
 * As DATAS também são reescritas a partir da âncora, e não só as colunas
 * novas: o formato antigo andou pelo relógio em dias inteiros sobre datas
 * calculadas em meses de calendário, e a dívida nova de cada ex-cliente é
 * contada do corte. Reescrever o corte e a fatura de saída juntos é o que faz
 * a coluna e a fatura contarem a mesma idade.
 */
async function reescreverCarteiraDaRede(tx: Executor, idsDosProvedores: readonly number[], agora: Date): Promise<void> {
  for (let i = 0; i < idsDosProvedores.length; i++) {
    const providerId = idsDosProvedores[i];
    const plano = carteiraPlanejada(i, providerId, agora);

    const existentes = await tx.select({ id: customers.id, cpfCnpj: customers.cpfCnpj }).from(customers).where(eq(customers.providerId, providerId));
    const idPorCpf = new Map(existentes.map((c) => [c.cpfCnpj, c.id]));
    const idsDosClientes = plano.clientes.map((c) => {
      const id = idPorCpf.get(c.cpfCnpj);
      // Falha alto e desfaz tudo: um mundo que não tem os clientes que a
      // semeadura gravou não está em formato nenhum que este código conheça.
      if (id === undefined) throw new Error(`complementarMundoBase: ${PROVEDORES_DA_DEMO[i].subdomain} sem um cliente da semeadura — mundo base em formato desconhecido`);
      return id;
    });
    await atualizarPorIdEmBlocos(tx, "customers", COLUNAS_DO_CLIENTE, plano.clientes.map((c, k) => [idsDosClientes[k], ...valoresDoCliente(c)]));

    const faturasExistentes = await tx.select({ id: invoices.id, erpRef: invoices.erpRef }).from(invoices).where(eq(invoices.providerId, providerId));
    const idPorRef = new Map(faturasExistentes.map((f) => [f.erpRef, f.id]));
    const faturasParaAtualizar: unknown[][] = [];
    const faturasNovas: InsertInvoice[] = [];
    for (const f of plano.faturas(idsDosClientes)) {
      const id = idPorRef.get(f.erpRef ?? null);
      if (id === undefined) faturasNovas.push(f);
      else faturasParaAtualizar.push([id, ...valoresDaFatura(f)]);
    }
    await atualizarPorIdEmBlocos(tx, "invoices", COLUNAS_DA_FATURA, faturasParaAtualizar);
    await inserirFaturasEmBlocos(tx, faturasNovas);

    const aparelhosExistentes = await tx.select({ serialNumber: equipment.serialNumber }).from(equipment).where(eq(equipment.providerId, providerId));
    const seriaisExistentes = new Set(aparelhosExistentes.map((e) => e.serialNumber));
    const seriaisPorStatus = new Map<string, string[]>();
    const aparelhosNovos: InsertEquipment[] = [];
    for (const e of plano.equipamentos(idsDosClientes)) {
      if (!seriaisExistentes.has(e.serialNumber ?? null)) {
        aparelhosNovos.push(e);
        continue;
      }
      const status = e.status ?? STATUS_DE_EQUIPAMENTO_COMODATO;
      seriaisPorStatus.set(status, [...(seriaisPorStatus.get(status) ?? []), e.serialNumber!]);
    }
    for (const [status, seriais] of Array.from(seriaisPorStatus.entries())) {
      for (let k = 0; k < seriais.length; k += TAMANHO_DO_BLOCO) {
        await tx.update(equipment).set({ status }).where(and(eq(equipment.providerId, providerId), inArray(equipment.serialNumber, seriais.slice(k, k + TAMANHO_DO_BLOCO))));
      }
    }
    await inserirEquipamentosEmBlocos(tx, aparelhosNovos);
  }
}

/** Os ids de rede-1..rede-5, na ordem de `PROVEDORES_DA_DEMO` — ou `null` enquanto o mundo base não existe inteiro. */
async function idsDaRede(executor: Executor): Promise<number[] | null> {
  const linhas = await executor.select({ id: providers.id, subdomain: providers.subdomain }).from(providers)
    .where(inArray(providers.subdomain, PROVEDORES_DA_DEMO.map((p) => p.subdomain)));
  const idPorSubdominio = new Map(linhas.map((l) => [l.subdomain, l.id]));
  const ids = PROVEDORES_DA_DEMO.map((p) => idPorSubdominio.get(p.subdomain));
  return ids.every((id): id is number => id !== undefined) ? ids : null;
}

/**
 * A carteira já está no formato atual? O sinal é o contrato antigo do migrador
 * com procedência `erp`: nenhum cliente do formato antigo tem `geo_precisao`,
 * e a reescrita grava a carteira inteira na mesma transação — se este existe,
 * todos existem. Uma leitura por chave (provedor + CPF), barata o bastante
 * para rodar em toda criação de sandbox.
 */
async function carteiraNoFormatoAtual(executor: Executor, idsDosProvedores: readonly number[]): Promise<boolean> {
  const [sinal] = await executor.select({ id: customers.id }).from(customers)
    .where(and(
      eq(customers.providerId, idsDosProvedores[0]),
      eq(customers.cpfCnpj, CPF_DO_MIGRADOR_DE_EXEMPLO),
      eq(customers.geoPrecisao, GEO_PRECISAO_DA_DEMO),
    ))
    .limit(1);
  return Boolean(sinal);
}

/** As consultas da rede já foram semeadas? O sinal é uma consulta de provedor da rede sobre o CPF do migrador — nenhuma tela grava isso. */
async function consultasDaRedeSemeadas(executor: Executor, idsDosProvedores: readonly number[]): Promise<boolean> {
  const [sinal] = await executor.select({ id: ispConsultations.id }).from(ispConsultations)
    .where(and(inArray(ispConsultations.providerId, [...idsDosProvedores]), eq(ispConsultations.cpfCnpj, CPF_DO_MIGRADOR_DE_EXEMPLO)))
    .limit(1);
  return Boolean(sinal);
}

/**
 * Chave de `pg_advisory_xact_lock` do complemento. Um número fixo qualquer
 * (bigint); só precisa ser o mesmo em todo processo que roda o complemento e
 * não ser usado por mais nada no banco.
 */
const CHAVE_DO_LOCK_DO_COMPLEMENTO = 7_300_913_2026;

export interface ResultadoDoComplemento {
  /** A carteira da rede foi reescrita do formato antigo nesta chamada. */
  carteira: boolean;
  /** As consultas cruzadas da rede (e os analistas que as assinam) foram gravadas nesta chamada. */
  consultas: boolean;
}

/**
 * Leva o mundo base ao formato atual, sem tabela nova e sem apagar nada:
 *
 *   1. a carteira no formato antigo (o do banco da demonstração publicada) é
 *      reescrita para `carteiraPlanejada` — ex-clientes que saíram devendo,
 *      `geo_precisao`, motivo do corte, score e faixa, vocabulário atual de
 *      equipamento, ONU do inadimplente e o par migrador coerente;
 *   2. as consultas cruzadas da rede, que nenhuma semeadura gravou, são
 *      acrescentadas — num mundo recém-semeado, só esta parte roda.
 *
 * Idempotente pelo conteúdo: cada parte tem um sinal que só existe depois de
 * aplicada (`carteiraNoFormatoAtual`, `consultasDaRedeSemeadas`). O caminho
 * comum — tudo aplicado — é duas leituras por chave, sem transação.
 *
 * Quando falta algo, tudo roda numa transação com `pg_advisory_xact_lock`: duas
 * criações de sandbox simultâneas (a API e o worker são processos diferentes)
 * passariam as duas pelo primeiro cheque; o lock faz a segunda esperar a
 * primeira terminar e o segundo cheque, feito dentro do lock, a manda embora.
 * A âncora do relógio (`providers.created_at` de rede-1) é lida `FOR UPDATE`:
 * um refresh do relógio concorrente espera o complemento gravar, e então
 * desloca também as linhas novas.
 *
 * As datas novas são calculadas a partir da ÂNCORA, e não do relógio da
 * máquina: o mundo pode estar até 6 dias atrás de hoje sem o relógio ter
 * rodado, e uma consulta gravada "há 4 dias de hoje" seria empurrada para o
 * futuro no próximo deslocamento.
 *
 * Fica FORA de `semearMundoBase` e da transação do sandbox: quem chama é
 * `criarSandbox`, logo depois de `semearMundoBase()` (a primeira criação depois
 * do deploy paga a reescrita, uma vez), e dá para rodar por script avulso numa
 * janela autorizada, antes do tráfego chegar.
 */
export async function complementarMundoBase(): Promise<ResultadoDoComplemento> {
  const nadaAFazer: ResultadoDoComplemento = { carteira: false, consultas: false };
  const ids = await idsDaRede(db);
  if (!ids) return nadaAFazer;
  if ((await carteiraNoFormatoAtual(db, ids)) && (await consultasDaRedeSemeadas(db, ids))) return nadaAFazer;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CHAVE_DO_LOCK_DO_COMPLEMENTO})`);
    const [ancora] = await tx.select({ createdAt: providers.createdAt }).from(providers).where(eq(providers.id, ids[0])).limit(1).for("update");
    if (!ancora?.createdAt) return nadaAFazer;

    const carteira = !(await carteiraNoFormatoAtual(tx, ids));
    const consultas = !(await consultasDaRedeSemeadas(tx, ids));
    const agoraDoMundo = new Date(ancora.createdAt);
    if (carteira) await reescreverCarteiraDaRede(tx, ids, agoraDoMundo);
    if (consultas) await semearConsultasDaRede(tx, ids, agoraDoMundo);
    return { carteira, consultas };
  });
}

// ── Relógio do mundo ─────────────────────────────────────────────────────────

/**
 * Acima de quantos dias sem atualizar o relógio do mundo é velho demais
 * (rodada de correção, Tarefa 5, 11/09/2026).
 *
 * Os prazos em jogo são os que o relógio real encurta sem nada que o
 * visitante faça: o contrato NOVO do migrador de exemplo, que o chip promete
 * ter no máximo 60 dias (semeado com 45), e as consultas recentes, que o
 * alerta de migrador e o score contam numa janela de 30 dias (as do migrador
 * semeadas a 4 e 12 dias). Até 13/09/2026 o prazo era o da janela de 90 dias
 * de `isRecentCancellation` sobre um contrato de 45 dias, que quebrava entre o
 * dia 44 e o 45 sem atualização.
 *
 * Sete dias mantém os três dentro da promessa (45+6, 12+6 e 4+6) e mantém a
 * OUTRA deriva (o atraso da fatura que só cresce ao vivo, contra
 * `customers.max_days_overdue` congelado no seed) sempre abaixo de uma
 * semana: imperceptível contra faixas de 10 a 300 dias. O refresh em si (a
 * parte cara: UPDATEs em massa tocando ~11 mil linhas) fica raro — no
 * máximo uma vez por semana, não uma vez por visitante — porque o CHEQUE (uma
 * leitura indexada por subdomain) é a parte que roda em toda criação de
 * sandbox, e é ela que precisa ser barata.
 */
const LIMIAR_DE_ATUALIZACAO_DO_MUNDO_DIAS = 7;

/**
 * Desloca toda data que a semeadura e o complemento gravaram por `driftDias`
 * dias — o equivalente a semear de novo com um `agora` mais recente, sem
 * apagar nada.
 *
 * Funciona porque toda data que este arquivo grava é sempre "o `agora`
 * compartilhado da rodada, menos um deslocamento fixo em dias" (idade de
 * fatura, tempo de casa, recência de cancelamento, idade da consulta). Somar
 * o MESMO `driftDias` aos dois lados dessa conta preserva cada deslocamento
 * exatamente, sem precisar saber qual fórmula gerou qual linha — e sem tocar
 * nenhuma coluna que não seja data (mensalidade, motivo do corte, contagem de
 * equipamento... nada disso depende de `agora`).
 *
 * UPDATEs em massa (não um por linha, nem um por provedor): mais barato — e
 * mais seguro do que apagar e re-semear, que exigiria primeiro limpar toda
 * tabela com FK para estes clientes (`anti_fraud_alerts` inclusive, se algum
 * visitante real já tiver disparado um alerta contra a base) — o mesmo
 * problema que `apagarSandbox` existe para resolver, só que aqui contra dados
 * que NUNCA deveriam sumir.
 *
 * As consultas (13/09/2026) andam junto: só as dos provedores da rede, que
 * são as que o complemento semeou — nenhum visitante consulta em nome de um
 * provedor base.
 */
async function deslocarDatasDoMundoBase(tx: Executor, idsDosProvedores: number[], driftDias: number): Promise<void> {
  await tx.update(customers)
    .set({
      contractStartDate: sql`(${customers.contractStartDate} + ${driftDias} * interval '1 day')::date`,
      cortadoEm: sql`${customers.cortadoEm} + ${driftDias} * interval '1 day'`,
    })
    .where(inArray(customers.providerId, idsDosProvedores));

  await tx.update(invoices)
    .set({
      dueDate: sql`${invoices.dueDate} + ${driftDias} * interval '1 day'`,
      paidDate: sql`${invoices.paidDate} + ${driftDias} * interval '1 day'`,
    })
    .where(inArray(invoices.providerId, idsDosProvedores));

  await tx.update(ispConsultations)
    .set({ createdAt: sql`${ispConsultations.createdAt} + ${driftDias} * interval '1 day'` })
    .where(inArray(ispConsultations.providerId, idsDosProvedores));
}

/**
 * Se o relógio do mundo estiver velho demais, desloca todas as datas para a
 * idade voltar a bater com HOJE. `criadoEmRede1` é a ÂNCORA — o `createdAt`
 * de "rede-1", escrito explicitamente com o `agora` da última rodada (seed ou
 * refresh) em vez do `defaultNow()` do schema (ver `linhaDoProvedor`). Só
 * "rede-1" é lido e escrito: os outros quatro provedores nunca precisam da
 * própria âncora (ninguém a lê), e não vale reescrever `created_at` deles só
 * por simetria.
 *
 * Otimista, não travado: duas requisições concorrentes cruzando o limiar ao
 * mesmo tempo poderiam somar o drift duas vezes se ambas escrevessem sem
 * checar. O UPDATE condicional abaixo (subdomain + created_at IGUAL ao que
 * acabamos de ler) só avança o relógio se ninguém tiver mexido nele desde a
 * leitura — quem perde a corrida só pula o refresh desta vez; a próxima
 * criação de sandbox tenta de novo, e a âncora já estará fresca. Mesmo
 * espírito do "check-then-create não atômico" que `criarSandbox`/
 * `contarSandboxesVivos` já aceitam (ver os comentários em sandbox.service.ts) —
 * a janela de corrida é de milissegundos e o pior caso (perder um refresh) se
 * autocorrige na tentativa seguinte.
 */
async function atualizarRelogioDoMundoBaseSePreciso(
  primeiroSubdomain: string,
  idsDosProvedores: number[],
  criadoEmRede1: Date | string | null,
  agora: Date,
): Promise<void> {
  if (!criadoEmRede1) return; // sem âncora, sem como medir o drift — não mexe em nada.
  const driftDias = diasEntre(agora, criadoEmRede1);
  if (driftDias < LIMIAR_DE_ATUALIZACAO_DO_MUNDO_DIAS) return;

  const ancoraLida = new Date(criadoEmRede1);
  await db.transaction(async (tx) => {
    const [ganhou] = await tx.update(providers)
      .set({ createdAt: agora })
      .where(and(eq(providers.subdomain, primeiroSubdomain), eq(providers.createdAt, ancoraLida)))
      .returning({ id: providers.id });
    if (!ganhou) return;
    await deslocarDatasDoMundoBase(tx, idsDosProvedores, driftDias);
  });
}

/**
 * Semeia os cinco provedores da demonstração, a carteira de cada um e a
 * sobreposição de CPFs entre vizinhos. Idempotente: se "rede-1" já existe,
 * não grava nada de novo — só devolve o estado atual (depois de, se
 * preciso, atualizar o relógio do mundo — ver
 * `atualizarRelogioDoMundoBaseSePreciso`). Tudo o que INSERE (do primeiro
 * provedor ao último equipamento) vive numa transação só; o refresh, quando
 * acontece, vive na própria transação dele.
 *
 * Não grava as consultas cruzadas nem reescreve um mundo antigo: isso é
 * `complementarMundoBase`, que quem cria o sandbox chama logo depois desta.
 *
 * `agora` é injetável (nunca `new Date()` espalhado pela função) para que a
 * idade de vencimento de cada fatura, o tempo de casa e a data de saída sejam
 * deslocamentos estáveis a partir de UM só instante.
 */
export async function semearMundoBase(agora: Date = new Date()): Promise<{ provedores: number[]; clientes: number }> {
  const primeiroSubdomain = PROVEDORES_DA_DEMO[0].subdomain;
  const [ancora] = await db.select({ id: providers.id, createdAt: providers.createdAt }).from(providers).where(eq(providers.subdomain, primeiroSubdomain));

  if (ancora) {
    const idsExistentes: number[] = [];
    for (const p of PROVEDORES_DA_DEMO) {
      const [linha] = await db.select({ id: providers.id }).from(providers).where(eq(providers.subdomain, p.subdomain));
      if (linha) idsExistentes.push(linha.id);
    }
    await atualizarRelogioDoMundoBaseSePreciso(primeiroSubdomain, idsExistentes, ancora.createdAt, agora);
    return { provedores: idsExistentes, clientes: idsExistentes.length * CLIENTES_POR_PROVEDOR };
  }

  return db.transaction(async (tx) => {
    const idsDosProvedores: number[] = [];
    let totalDeClientes = 0;

    for (let i = 0; i < PROVEDORES_DA_DEMO.length; i++) {
      const { providerId, clientes } = await semearUmProvedor(tx, i, agora);
      idsDosProvedores.push(providerId);
      totalDeClientes += clientes;
    }

    return { provedores: idsDosProvedores, clientes: totalDeClientes };
  });
}
