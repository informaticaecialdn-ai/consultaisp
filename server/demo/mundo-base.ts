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
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { providers, customers, invoices, equipment, erpIntegrations } from "@shared/schema";
import type { InsertProvider, InsertCustomer, InsertInvoice, InsertEquipment, InsertErpIntegration } from "@shared/schema";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";
import { encryptField } from "../utils/crypto";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";

/** O que uma transação de verdade e o `pg-proxy` de teste têm em comum: `insert`/`select`/`transaction`. */
type Executor = Pick<typeof db, "insert" | "select">;

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
 * 8% com equipamento (120), mas NÃO tudo retido: rodada de correção
 * (11/09/2026) — o comodato normal (`em_comodato`, o default do schema) é o
 * caso do dia a dia, num cliente ATIVO; só o ex-cliente carrega os estados
 * "não devolvido" que alimentam a recuperação. Antes, os 120 eram todos
 * cancelados com estado retido, e um visitante navegando os 1.350 ativos de
 * qualquer provedor via ZERO equipamento — o módulo de comodato parecia
 * morto para quem olha a carteira viva.
 */
const EM_DIA_COM_EQUIPAMENTO_COMODATO = 90; // ativos, ONU normal, ainda em comodato
const CANCELADOS_COM_EQUIPAMENTO_RETIDO = 30; // ex-clientes, ONU NÃO devolvida
const COM_EQUIPAMENTO_POR_PROVEDOR = EM_DIA_COM_EQUIPAMENTO_COMODATO + CANCELADOS_COM_EQUIPAMENTO_RETIDO; // 120 = 8%

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

/** Idades de vencimento representativas — as quatro que a régua de cobrança usa (10/45/120/300) primeiro, depois uma variedade realista. */
const IDADES_DE_VENCIMENTO_REPRESENTATIVAS = [10, 45, 120, 300, 5, 20, 35, 60, 75, 90, 150, 200, 250, 15, 25];

/** Mensalidades por faixa de plano — cíclico pelo índice da pessoa, só para variedade. */
const VALORES_DE_PLANO = [79.9, 99.9, 119.9, 149.9, 199.9];

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

/** Estados "retido" reais do módulo de recuperação — ver `server/services/equipment-recovery-rules.ts` (`STATUS_EQUIPAMENTO_PENDENTE`). */
const STATUS_DE_EQUIPAMENTO_RETIDO = ["retido", "retirada_pendente", "nao_localizado", "em_cobranca", "not_returned"] as const;
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

// ── Índices de pessoa fictícia: faixas disjuntas de propósito ──────────────
// Únicos: BASE_UNICO + provedor*PASSO_UNICO + cursor (0..9999 de folga por
// provedor — o maior uso real é 1350). Arestas (compartilhamento): bem acima,
// BASE_ARESTA + aresta*PASSO_ARESTA (0..149 por aresta) — nunca colide com a
// faixa única de nenhum provedor.
const BASE_UNICO = 0;
const PASSO_UNICO = 10_000;
const BASE_ARESTA = 500_000;
const PASSO_ARESTA = 1_000;

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

/** Os CPFs que se repetem entre vizinhos — as 4 arestas da linha, achatadas (4 × 150 = 600). */
export const CPFS_COMPARTILHADOS: string[] = Array.from(
  { length: PROVEDORES_DA_DEMO.length - 1 },
  (_, aresta) => indicesDaAresta(aresta),
)
  .flat()
  .map(cpfFicticio);

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
 * (por posição, não por índice de pessoa) ficam com a ONU não devolvida. Em
 * dia: os ÚLTIMOS `EM_DIA_COM_EQUIPAMENTO_COMODATO` — nunca os primeiros,
 * porque os primeiros de "em_dia" são justamente a fatia compartilhada com o
 * vizinho (ver `planoDeIndices`), e o comodato normal não precisa se
 * concentrar ali.
 */
function equipamentoDaEntrada(entrada: EntradaDoPlano): DescritorDeEquipamento | null {
  if (entrada.categoria === "cancelado" && entrada.posicaoNaCategoria < CANCELADOS_COM_EQUIPAMENTO_RETIDO) {
    const status = STATUS_DE_EQUIPAMENTO_RETIDO[entrada.posicaoNaCategoria % STATUS_DE_EQUIPAMENTO_RETIDO.length];
    return { status, value: VALOR_DO_EQUIPAMENTO, retido: true };
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
    contractStartDate,
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
    return {
      ...base,
      status: "active",
      paymentStatus: "overdue",
      totalOverdueAmount: valorMensalidade(entrada.personaIndex).toFixed(2),
      maxDaysOverdue: idadeRepresentativa(entrada.posicaoNaCategoria),
    };
  }
  if (entrada.categoria === "cancelado") {
    return { ...base, status: "cancelled", paymentStatus: "current", totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
  }
  return { ...base, status: "active", paymentStatus: "current", totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
}

function linhaDaFatura(providerId: number, customerId: number, entrada: EntradaDoPlano, agora: Date): InsertInvoice {
  const idadeDias = idadeRepresentativa(entrada.posicaoNaCategoria);
  const vencimento = new Date(agora.getTime() - idadeDias * 86_400_000);
  return {
    customerId,
    providerId,
    value: valorMensalidade(entrada.personaIndex).toFixed(2),
    dueDate: vencimento,
    status: "overdue",
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
 * parser nunca precisa clampar nada. `status` alterna PAGA/ABERTA por posição:
 * paga alimenta `erpConfirmaPagamentos` (server/storage/faturas.storage.ts) e
 * a Economia REALIZADA; aberta alimenta `cobrancasDeSaida` (ela só lê
 * `STATUS_FATURA_ABERTA = ["aberta","pending","overdue"]` — "overdue" está
 * nessa lista, confirmado em faturas.storage.ts:63) e a Economia ESTIMADA.
 * Sem as duas, só um dos dois caminhos teria o que mostrar.
 */
function linhaDaFaturaDeSaida(providerId: number, customerId: number, entrada: EntradaDoPlano, cortadoEm: Date): InsertInvoice {
  const mensalidade = valorMensalidade(entrada.personaIndex);
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

function linhaDoProvedor(indice: number, p: ProvedorDaDemo): InsertProvider {
  return {
    name: p.nome,
    cnpj: cnpjFicticio(indice),
    subdomain: p.subdomain,
    plan: "enterprise",
    status: "active",
    verificationStatus: "approved",
    ispCredits: 999_999,
    spcCredits: 999_999,
    addressCity: p.cidade,
    addressState: "PR",
    contactEmail: `contato@${p.subdomain}.demo.consultaisp.com.br`,
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
function linhaDaIntegracao(providerId: number): InsertErpIntegration {
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
  const [criado] = await tx.insert(providers).values(linhaDoProvedor(indice, provedor)).returning({ id: providers.id });
  const providerId = criado.id;

  await tx.insert(erpIntegrations).values(linhaDaIntegracao(providerId));

  const entradas = planoDeIndices(indice);
  const linhasClientes = entradas.map((e) => linhaDoCliente(providerId, e, agora));
  const idsClientes = await inserirClientesEmBlocos(tx, linhasClientes);

  const linhasFaturas: InsertInvoice[] = [];
  const linhasEquipamentos: InsertEquipment[] = [];
  for (let k = 0; k < entradas.length; k++) {
    const entrada = entradas[k];
    const customerId = idsClientes[k];

    if (entrada.categoria === "inadimplente") {
      linhasFaturas.push(linhaDaFatura(providerId, customerId, entrada, agora));
    } else if (entrada.categoria === "cancelado") {
      // Todo ex-cliente leva fatura de saída — sem isto a Economia do ex-cliente,
      // a multa e o prejuízo abrem vazios para a carteira inteira (150/provedor).
      const cortadoEm = cortadoEmDaEntrada(entrada, agora)!;
      linhasFaturas.push(linhaDaFaturaDeSaida(providerId, customerId, entrada, cortadoEm));
    }

    const equip = equipamentoDaEntrada(entrada);
    if (equip) linhasEquipamentos.push(linhaDoEquipamento(providerId, customerId, entrada, equip));
  }

  await inserirFaturasEmBlocos(tx, linhasFaturas);
  await inserirEquipamentosEmBlocos(tx, linhasEquipamentos);

  return { providerId, clientes: linhasClientes.length };
}

/**
 * Semeia os cinco provedores da demonstração, a carteira de cada um e a
 * sobreposição de CPFs entre vizinhos. Idempotente: se "rede-1" já existe,
 * não grava nada de novo — só devolve o estado atual. Tudo o que grava (do
 * primeiro provedor ao último equipamento) vive numa transação só.
 *
 * `agora` é injetável (nunca `new Date()` espalhado pela função) para que a
 * idade de vencimento de cada fatura, o tempo de casa e a data de saída sejam
 * deslocamentos estáveis a partir de UM só instante.
 */
export async function semearMundoBase(agora: Date = new Date()): Promise<{ provedores: number[]; clientes: number }> {
  const primeiroSubdomain = PROVEDORES_DA_DEMO[0].subdomain;
  const jaSemeado = await db.select({ id: providers.id }).from(providers).where(eq(providers.subdomain, primeiroSubdomain));

  if (jaSemeado.length > 0) {
    const idsExistentes: number[] = [];
    for (const p of PROVEDORES_DA_DEMO) {
      const [linha] = await db.select({ id: providers.id }).from(providers).where(eq(providers.subdomain, p.subdomain));
      if (linha) idsExistentes.push(linha.id);
    }
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
