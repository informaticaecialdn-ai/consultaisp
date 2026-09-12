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
 * espera.
 *
 * O provedor e o usuário administrador NÃO passam por
 * `storage.createProvider`/`storage.createUser` (rodada de correção,
 * 11/09/2026): nenhuma das duas aceita um executor de transação — conferido
 * em `server/storage/providers.storage.ts:161-164` e
 * `server/storage/users.storage.ts:92-98`, ambas chamam `db.insert` direto,
 * sem parâmetro de executor — e a atomicidade da criação inteira (provedor +
 * usuário + carteira, tudo ou nada) pesa mais do que passar pela camada de
 * storage aqui. As duas inserções abaixo espelham exatamente o que aquelas
 * funções fazem, `emailCanonico` incluído.
 */
import crypto from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import {
  providers,
  customers,
  invoices,
  equipment,
  erpIntegrations,
  acessosSuporte,
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  cobrancaConfissoes,
  cobrancaConfissoesPdf,
  cobrancaPolitica,
  antiFraudAlerts,
  antiFraudRules,
  proactiveAlerts,
  assinaturaIntegracoes,
  bigdataConsultations,
  bigdataIntegrations,
  chatAutonomiaConfig,
  chatAutonomiaEstado,
  chatAutonomiaFila,
  chatBullqConversas,
  chatBullqIntegracoes,
  comissaoLancamentos,
  equipmentRecoveryCases,
  equipmentRecoveryEvents,
  marcaEventos,
  providerDocuments,
  users,
} from "@shared/schema";
import type { InsertCustomer, InsertInvoice, InsertEquipment, InsertCobrancaCaso, InsertAntiFraudAlert } from "@shared/schema";
import { storage } from "../storage";
import { emailCanonico } from "../storage/users.storage";
import { hashPassword } from "../password";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";
import { PROVEDORES_DA_DEMO, INDICES_COMPARTILHADOS, semearMundoBase, linhaDaIntegracao } from "./mundo-base";
import { STATUS_DE_CASO, type StatusDeCaso } from "@shared/cobranca/estados";
import type { EtapaId } from "@shared/cobranca/regua";
import { severidadeDoAlerta } from "@shared/antifraude-avaliacao";
import { MOTIVO_CANCELADO_NO_ERP, MOTIVO_DIVIDA_ZERADA } from "../services/cobranca/regua-diaria.service";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";

/** O que uma transação de verdade e o `pg-proxy` de teste têm em comum. Ver o mesmo tipo em `mundo-base.ts`. */
type Executor = Pick<typeof db, "insert" | "select" | "delete">;

/**
 * O PRIMEIRO dos DOIS sinais de identidade do sandbox — sem coluna nova, sem
 * migração (ver CLAUDE.md/regras do plano). O segundo é o administrador
 * determinístico que `tentarCriarSandbox` grava na MESMA transação
 * (`emailDoAdminDaDemo`/`temSegundoSinal`, logo abaixo de `apagarSandbox`).
 *
 * Até a rodada de correção de 12/09/2026 este prefixo sozinho era A
 * identidade inteira. Deixou de ser: ele é a ÚNICA coisa entre um provedor
 * pagante e a exclusão TOTAL e silenciosa da conta dele, e qualquer caminho
 * futuro (script, migração, rota nova, UPDATE na mão) que esqueça de
 * reservar o prefixo reabre o buraco inteiro. Ver o describe de teste
 * "apagar exige o segundo sinal, nao so o prefixo do subdominio".
 *
 * Exportado (rodada de correção, Tarefa 6) porque a convenção sozinha não
 * reserva nada: `registerSchema.subdomain` (shared/schema.ts) só exige
 * `/^[a-z0-9-]+$/`, e nem `/api/auth/register` nem `/api/auth/check-subdomain`
 * recusavam um provedor pagante escolhendo `sandbox-alguma-coisa`. Isso
 * importa porque a limpeza da demonstração (`sandboxesExpirados`, abaixo)
 * ainda usa este prefixo como PRIMEIRO filtro — sem a reserva, um provedor de
 * verdade cadastrado assim entraria na lista de candidatos (o segundo sinal
 * o salva, mas depender só dele seria abrir mão da primeira linha de defesa).
 * `auth.routes.ts` importa esta mesma constante em vez de repetir o literal.
 */
export const PREFIXO_SANDBOX = "sandbox-";

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
 * Teto de sandboxes VIVOS ao mesmo tempo — acima disso, `GET /demo` recusa em
 * vez de criar (revisão final de segurança antes da demonstração pública,
 * item 5).
 *
 * O numero e 150, e nao 200 (`SANDBOXES_EM_RODIZIO`), por causa de DOIS
 * argumentos que apontam para baixo desse teto:
 *
 *   1. Espaco em disco COMPARTILHADO com producao. Cada sandbox grava ~2.000
 *      linhas (1.500 clientes + faturas + equipamentos + 9 casos de kanban).
 *      150 vivos ao mesmo tempo e ~300.000 linhas no PIOR CASO — um numero
 *      que a limpeza horaria (`limpeza.service.ts`) absorve numa passada ou
 *      duas mesmo se cair para tras, sem competir por espaco com o banco de
 *      producao que mora no MESMO filesystem.
 *   2. A conferencia e check-then-create — duas requisicoes de IPs
 *      diferentes (o limite de 2/10min so trava por IP) podiam ler a
 *      contagem antes de qualquer uma commitar, e `criarSandbox` tambem
 *      consome um id da sequencia do Postgres a cada tentativa que esbarra
 *      em colisao de CNPJ/subdominio (raro, mas gera lacuna). Colar o teto
 *      em 200 apostaria a seguranca de `baseDeIndicesDoSandbox` — nao
 *      colidir index é o que impede DOIS sandboxes vivos de sobrescrever a
 *      carteira um do outro — numa corrida que nunca deveria chegar perto do
 *      limite matematico. 150 deixa 50 sandboxes (25%) de folga.
 *
 *      Revisão final de segurança antes da demonstração pública (item 3):
 *      `GET /demo` (server/routes/demo.routes.ts) agora serializa a
 *      conferência + criação com `p-limit(1)` — dentro deste processo
 *      (`exec_mode: "fork"` na demo, uma instância só), duas requisições
 *      concorrentes não conferem o teto ao mesmo tempo nem constroem duas
 *      carteiras completas em paralelo num processo de 512 MB. A folga desta
 *      lista continua valendo como segunda camada, não como única defesa.
 *
 * 150 visitantes simultaneos dentro da janela de 24h de vida do sandbox e
 * folgado para uma demonstracao publica de autoatendimento — o produto nao
 * promete trafego sustentado, e quem tenta gerar mais que isso de proposito
 * e exatamente quem esta guarda existe para conter.
 */
export const TETO_DE_SANDBOXES_VIVOS = 150;

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
/** Mesmo índice de `VALORES_DE_PLANO` — ver a mesma constante em `mundo-base.ts`. */
const NOMES_DE_PLANO = ["Fibra 200 Mega", "Fibra 300 Mega", "Fibra 500 Mega", "Fibra 600 Mega", "Fibra 800 Mega"];
const TENURE_MESES_REPRESENTATIVOS = [2, 5, 9, 14, 20, 28, 36, 48, 60, 84];
const RECENCIA_CANCELAMENTO_DIAS = [30, 60, 90, 150, 210, 365];

/**
 * As cidades que o mundo base atende (`PROVEDORES_DA_DEMO`, deduplicadas:
 * Londrina aparece em rede-1 e rede-5). O sandbox nasce SEM
 * `cidadesAtendidas` nem `addressState` (rodada de correção, Tarefa 6,
 * 11/09/2026) — sem eles o modo "Rede" do mapa de calor manda o visitante
 * configurar as cidades do PRÓPRIO provedor antes de mostrar qualquer coisa,
 * numa demonstração que não tem onde clicar para configurar.
 */
const CIDADES_DO_MUNDO_BASE = Array.from(new Set(PROVEDORES_DA_DEMO.map((p) => p.cidade)));

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
 * `validarCNPJ` caso algum código um dia confira. Colisão entre dois
 * sandboxes é astronomicamente improvável (12 dígitos aleatórios), mas não
 * impossível — `criarSandbox()` tenta de novo com um CNPJ e subdomínio novos
 * se a violação de unicidade acontecer, em vez de estourar a exceção crua na
 * porta de entrada da demo.
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
  /**
   * Presente só nos 150 clientes que reaproveitam a IDENTIDADE de um CPF da
   * rede — `INDICES_COMPARTILHADOS[k]`, o índice de pessoa fictícia que
   * `mundo-base.ts` usou para gerar `CPFS_COMPARTILHADOS[k]`. Um CPF
   * compartilhado é a MESMA PESSOA em dois provedores: `linhaDoCliente` usa
   * este índice (nunca o índice local do sandbox) para `pessoaFicticia`,
   * então nome/telefone/endereço E documento vêm todos do MESMO lugar — nunca
   * só o documento sobrescrito por cima de uma pessoa diferente (rodada de
   * correção, 12/09/2026: era exatamente isso que fazia o SPC e o cadastral,
   * que decodificam identidade a partir do CPF, mostrarem alguém diferente do
   * relatório da Consulta ISP para o mesmo documento). Mensalidade, plano,
   * tempo de casa e equipamento continuam vindo do índice LOCAL — são a
   * história desta CONTA neste provedor, não a identidade da pessoa.
   */
  personaIndexOverride?: number;
}

/**
 * Monta os 1.500 clientes do sandbox: 1.350 usam a identidade
 * (`pessoaFicticia`/`cpfFicticio`) do índice exclusivo deste sandbox; os
 * outros 150 reaproveitam a IDENTIDADE INTEIRA de
 * `INDICES_COMPARTILHADOS[0..149]` — nome, telefone, endereço e o CPF que ela
 * implica, não só o CPF sozinho sobrescrevendo uma pessoa gerada do índice
 * local (era o defeito desta rodada: SPC e cadastral decodificam identidade a
 * partir do próprio documento, então mostravam OUTRA pessoa para o mesmo CPF
 * que a Consulta ISP acabava de exibir). Estes 150 nascem "em dia" NESTE
 * sandbox de propósito: a história que a demonstração conta é "limpo aqui,
 * mas devendo na rede" — contrastar com um cliente que já nasce inadimplente
 * no próprio sandbox não ensinaria nada sobre a rede.
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
      personaIndexOverride: INDICES_COMPARTILHADOS[k],
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

/** Mesmo índice de `valorMensalidade` — o nome do plano sempre bate com a mensalidade. */
function planoDoContrato(indice: number): string {
  return NOMES_DE_PLANO[Math.abs(indice) % NOMES_DE_PLANO.length];
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
  // A IDENTIDADE (nome, telefone, endereço, e-mail, CPF) vem de UM índice só —
  // o compartilhado quando presente, senão o local. `cpf` deriva de `pessoa`,
  // nunca é recalculado à parte: as duas rodadas anteriores desse bug
  // nasceram exatamente de `pessoa` e `cpf` virem de fontes diferentes que
  // silenciosamente saíam de sincronia. Mensalidade, plano, tempo de casa e
  // equipamento (abaixo) continuam por `indice` — são a conta deste sandbox
  // com a pessoa, não a pessoa em si.
  const indicePessoa = entrada.personaIndexOverride ?? indice;
  const pessoa = pessoaFicticia(indicePessoa);
  const cpf = pessoa.cpf;
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
    contractPlan: planoDoContrato(indice),
    // Default de schema e "manual" — mesma razao de `mundo-base.ts`: sem
    // isto o sandbox conta como carteira digitada a mao para quem le
    // `customers.erpSource` (Cliente 360, o motor de reabertura de caso).
    erpSource: FONTE_ERP_DEMO,
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
    // Ver a mesma marcação em `mundo-base.ts`: `erp_source` nulo = digitado a
    // mao, e sem ela `baseDeFaturas`/`mensalidadesDoProvedor` ficam cegos
    // para a carteira inteira do sandbox.
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-fatura-${customerId}`,
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
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-saida-${customerId}`,
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
 *
 * Rodada de correção (Tarefa 3, 11/09/2026): `montarColuna`
 * (`server/routes/cobranca.routes.ts`) só mostra uma coluna FECHADA
 * (`casoFechado`, `shared/cobranca/estados.ts` — "pago", "baixado",
 * "encerrado", "cancelamento") quando o caso tem `encerradoEm` DENTRO da
 * janela de 30 dias (`JANELA_DE_FECHADOS_DIAS`); sem `encerradoEm` a
 * varredura filtra TUDO fora, e quatro das nove colunas nasciam vazias.
 * `agora` (a própria criação do sandbox) está sempre bem dentro da janela,
 * pelas 24h de vida do sandbox inteiro. `motivoEncerramento` usa o
 * VOCABULÁRIO REAL que a régua diária de verdade grava
 * (`server/services/cobranca/regua-diaria.service.ts`), nunca uma string
 * inventada — "baixado" fica com `null` de propósito: é a única das quatro
 * que só o admin fecha na mão pelo kanban (`SO_ADMIN` em
 * `movimentos-cobranca.ts`), sem motivo automático correspondente, e o PATCH
 * que fecha por essa via não exige motivo (só "cancelamento" exige).
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
  /** `motivo: null` = fechado sem motivo automático (ver o comentário da função) — nunca uma string inventada. */
  const TERMINAIS_EX_CLIENTE: Array<{ status: StatusDeCaso; cursor: number; motivo: string | null }> = [
    { status: "cancelamento", cursor: INADIMPLENTES_POR_SANDBOX + 0, motivo: MOTIVO_CANCELADO_NO_ERP },
    { status: "baixado", cursor: INADIMPLENTES_POR_SANDBOX + 1, motivo: null },
    { status: "encerrado", cursor: INADIMPLENTES_POR_SANDBOX + 2, motivo: MOTIVO_DIVIDA_ZERADA },
  ];

  const casos: InsertCobrancaCaso[] = [];

  for (const item of NAO_TERMINAIS) {
    const entrada = entradaDoCursor(item.cursor);
    const indice = indiceDaEntrada(providerId, entrada);
    const valor = valorMensalidade(indice).toFixed(2);
    // "pago" é o único status FECHADO dentro de NAO_TERMINAIS (ver
    // STATUS_FECHADOS_DE_CASO em shared/cobranca/estados.ts) — os outros
    // cinco são vivos e não levam encerradoEm.
    const fechado = item.status === "pago";
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
      ...(fechado ? { encerradoEm: agora, motivoEncerramento: null } : {}),
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
      encerradoEm: agora,
      motivoEncerramento: item.motivo,
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
 * Cursores de exemplo para os alertas de anti-fraude — um punhado (3), não a
 * carteira inteira: inadimplentes (a categoria que a regra padrão
 * `ativo_inadimplente` exige), fora da faixa 0..5 que `casosDoKanban` já usa
 * — as duas histórias não precisam se sobrepor.
 */
const CURSORES_DE_ALERTA_ANTI_FRAUDE = [20, 21, 22] as const;

/**
 * Um punhado de `anti_fraud_alerts` para o PRÓPRIO sandbox, na FORMA exata
 * que `notifyOwnerProviders` (`server/services/proactive-alert.service.ts`)
 * grava de verdade quando a regra de fuga dispara.
 *
 * Sem isto a aba Anti-Fraude do sandbox SEMPRE abre vazia: o detector só
 * escreve alerta no DONO do cliente consultado, e numa consulta ao vivo de
 * verdade o dono é sempre outro provedor da rede — nunca o PRÓPRIO sandbox
 * que o visitante acabou de logar em (é a Tarefa 4: a segunda funcionalidade
 * que a landing anuncia, e a demonstração nunca mostrava nada nela).
 *
 * `customerId` aponta para um cliente ATIVO e INADIMPLENTE da PRÓPRIA
 * carteira do sandbox — a mesma condição que a regra `ativo_inadimplente`
 * (padrão, ligada) exige antes de um alerta nascer de verdade.
 * `consultingProviderId` é sempre um dos CINCO provedores do mundo base
 * (nunca o próprio sandbox, e nunca inventado): é a "rede" que teria
 * consultado este cliente. `riskFactors` no MESMO formato que
 * `notifyOwnerProviders` grava — é o que a tela lê de volta via
 * `motivosGravados` (`shared/antifraude-avaliacao.ts`); sem "divida_ativa"
 * ali o card cairia no motivo genérico em vez do rótulo real.
 */
function alertasAntiFraudeDoSandbox(
  providerId: number,
  entradas: EntradaSandbox[],
  idsClientes: number[],
  indicePorCursor: Map<number, number>,
  provedoresDoMundoBase: readonly number[],
): InsertAntiFraudAlert[] {
  const idDoCursor = (cursor: number): number => idsClientes[indicePorCursor.get(cursor)!];
  const entradaDoCursor = (cursor: number): EntradaSandbox => entradas[indicePorCursor.get(cursor)!];

  return CURSORES_DE_ALERTA_ANTI_FRAUDE.map((cursor, i) => {
    const entrada = entradaDoCursor(cursor);
    const indice = indiceDaEntrada(providerId, entrada);
    const pessoa = pessoaFicticia(indice);
    const totalOverdueAmount = valorMensalidade(indice);
    const maxDaysOverdue = idadeRepresentativa(entrada.posicaoNaCategoria);
    const diasDeContrato = tenureMeses(indice) * 30;
    const consultingProviderId = provedoresDoMundoBase[i % provedoresDoMundoBase.length];
    const consultingProviderName = PROVEDORES_DA_DEMO[i % PROVEDORES_DA_DEMO.length].nome;
    const severidade = severidadeDoAlerta(["divida_ativa"], { totalOverdueAmount, maxDaysOverdue });

    return {
      providerId,
      customerId: idDoCursor(cursor),
      consultingProviderId,
      consultingProviderName,
      customerName: pessoa.nome,
      customerCpfCnpj: cpfFicticio(indice),
      type: "defaulter_consulted",
      severity: severidade,
      message: `Seu cliente ativo com R$ ${formatarReal(totalOverdueAmount)} vencidos há ${maxDaysOverdue} dia${maxDaysOverdue === 1 ? "" : "s"} foi consultado por outro provedor da rede`,
      riskScore: severidade === "critical" ? 90 : severidade === "high" ? 70 : 50,
      riskLevel: severidade === "critical" ? "critico" : severidade === "high" ? "alto" : "medio",
      riskFactors: [
        "consulta_outro_provedor",
        "divida_ativa",
        `dias_contrato:${diasDeContrato}`,
        "combinacao:qualquer",
        "erp_ao_vivo",
      ],
      daysOverdue: maxDaysOverdue,
      overdueAmount: totalOverdueAmount.toFixed(2),
      recentConsultations: 1,
      resolved: false,
      status: "new",
    };
  });
}

/** Código de erro do Postgres para violação de unicidade (`unique_violation`). */
const CODIGO_UNIQUE_VIOLATION = "23505";

/** Um punhado de tentativas — CNPJ (12 dígitos aleatórios) e subdomínio (16 hex) colidirem é raríssimo; mais que isso é outra coisa quebrada. */
const TENTATIVAS_DE_CRIACAO = 5;

/**
 * Cria o sandbox do visitante: semeia o mundo base (idempotente), gera uma
 * carteira própria de 1.500 clientes e devolve as credenciais/identidade
 * para a rota (Tarefa 6) abrir a sessão.
 *
 * Tenta de novo (CNPJ e subdomínio novos) se a criação esbarrar numa
 * violação de unicidade — ver `cnpjDoSandbox()`. Qualquer outro erro sobe
 * na hora, sem retentativa.
 */
export async function criarSandbox(): Promise<{ providerId: number; userId: number; subdomain: string; expiraEm: Date }> {
  const mundoBase = await semearMundoBase();
  const agora = new Date();

  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_CRIACAO; tentativa++) {
    try {
      return await tentarCriarSandbox(agora, mundoBase.provedores);
    } catch (err) {
      const codigo = (err as { code?: string } | null | undefined)?.code;
      if (codigo !== CODIGO_UNIQUE_VIOLATION || tentativa === TENTATIVAS_DE_CRIACAO) throw err;
    }
  }
  // Inalcançável: o laço acima sempre retorna ou lança na última tentativa.
  throw new Error("criarSandbox: numero de tentativas esgotado");
}

/**
 * Uma tentativa de criação, inteira, numa ÚNICA transação — provedor,
 * usuário administrador e carteira (clientes, faturas, equipamentos, casos
 * de cobrança, integração ERP, alertas de anti-fraude). Falhar em qualquer
 * ponto não deixa par provedor+usuário órfão: a transação inteira desfaz.
 *
 * `provedoresDoMundoBase` (Tarefa 4, 11/09/2026) são os ids que
 * `semearMundoBase()` já devolveu para `criarSandbox()` — os alertas de
 * anti-fraude do sandbox precisam de um "consulente" que exista de verdade
 * (FK de `anti_fraud_alerts.consulting_provider_id` para `providers.id`), e
 * nunca o próprio sandbox.
 */
async function tentarCriarSandbox(agora: Date, provedoresDoMundoBase: readonly number[]): Promise<{ providerId: number; userId: number; subdomain: string; expiraEm: Date }> {
  const subdomain = subdominioDoSandbox();
  const senhaHash = await hashPassword(crypto.randomBytes(24).toString("hex"));

  return db.transaction(async (tx) => {
    // Espelha storage.createProvider (server/storage/providers.storage.ts:161-164).
    const [provider] = await tx.insert(providers).values({
      name: "Provedor Demonstração",
      cnpj: cnpjDoSandbox(),
      subdomain,
      plan: "enterprise",
      status: "active",
      verificationStatus: "approved",
      ispCredits: SALDO_INICIAL,
      spcCredits: SALDO_INICIAL,
      // Rodada de correção (Tarefa 6): sem isto o modo "Rede" do mapa de
      // calor manda o visitante configurar as próprias cidades antes de
      // mostrar qualquer coisa — numa demonstração sem tela para isso.
      cidadesAtendidas: CIDADES_DO_MUNDO_BASE,
      addressState: "PR",
    }).returning();

    // Rodada de correção (Tarefa 1): o MESMO conjunto de campos que o mundo
    // base grava (`linhaDaIntegracao`, mundo-base.ts) — sem integração
    // habilitada `buildErpConfig` lança antes de o conector "demo" ser
    // chamado, e a rede inteira (inclusive a PRÓPRIA carteira do sandbox)
    // fica invisível para a consulta ao vivo.
    await tx.insert(erpIntegrations).values(linhaDaIntegracao(provider.id));

    // Espelha storage.createUser (server/storage/users.storage.ts:92-98),
    // email canonicalizado incluído. `emailDoAdminDaDemo` (não mais o literal
    // inline) porque este e-mail agora é o SEGUNDO sinal de identidade do
    // sandbox — ver o comentário dela, logo antes de `sandboxesExpirados`.
    const [user] = await tx.insert(users).values({
      email: emailDoAdminDaDemo(subdomain),
      password: senhaHash,
      name: "Administrador da Demonstração",
      role: "admin",
      providerId: provider.id,
      emailVerified: true,
    }).returning();

    const entradas = planoDeIndicesDoSandbox();
    const indicePorCursor = new Map(entradas.map((e, i) => [e.cursor, i]));

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

    const alertas = alertasAntiFraudeDoSandbox(provider.id, entradas, idsClientes, indicePorCursor, provedoresDoMundoBase);
    await tx.insert(antiFraudAlerts).values(alertas);

    return {
      providerId: provider.id,
      userId: user.id,
      subdomain,
      expiraEm: new Date(agora.getTime() + VIDA_DO_SANDBOX_MS),
    };
  });
}

/**
 * O e-mail determinístico do administrador que `tentarCriarSandbox` grava —
 * o SEGUNDO sinal de identidade do sandbox (rodada de correção, 12/09/2026;
 * ver `temSegundoSinal`, logo abaixo). Extraído para função só para o
 * ESCRITOR (`tentarCriarSandbox`) e os DOIS LEITORES (`sandboxesExpirados`,
 * `apagarSandbox`) nunca divergirem no formato do e-mail.
 */
function emailDoAdminDaDemo(subdomain: string): string {
  return emailCanonico(`${subdomain}@demo.consultaisp.com.br`);
}

/**
 * Identidade do sandbox, DUAS provas (rodada de correção, 12/09/2026) — ver o
 * comentário grande no teste "apagar exige o segundo sinal, nao so o prefixo
 * do subdominio" (`sandbox.service.test.ts`) para o raciocínio completo.
 *
 * Até esta correção, "é um sandbox descartável" era UMA string só: `subdomain`
 * começando por `sandbox-`. A reserva do namespace no cadastro (Tarefa 6)
 * fecha as portas que existem HOJE, mas esse prefixo sozinho continuava sendo
 * a ÚNICA coisa entre um provedor pagante e a exclusão TOTAL e silenciosa da
 * conta dele — qualquer caminho futuro (script, migração, rota nova, UPDATE na
 * mão) que esqueça de reservar o prefixo reabre o buraco inteiro.
 *
 * Agora a identidade exige as DUAS provas que só `tentarCriarSandbox` grava
 * JUNTAS, na MESMA transação: o prefixo do subdomínio E o administrador
 * determinístico (`emailDoAdminDaDemo`). `adminsDoProvider` é a lista de
 * e-mails de TODOS os usuários do provider (nunca só "o primeiro que a query
 * devolveu") — um sandbox nunca deveria ganhar um segundo usuário, mas nada
 * impede um visitante de criar um pela própria tela de gestão dentro das 24h,
 * e o admin de verdade pode estar em qualquer posição do array.
 */
function temSegundoSinal(subdomain: string | null | undefined, adminsDoProvider: readonly string[]): boolean {
  if (!subdomain || !subdomain.startsWith(PREFIXO_SANDBOX)) return false;
  return adminsDoProvider.includes(emailDoAdminDaDemo(subdomain));
}

/**
 * Todos os `providers.id` cujo sandbox já passou de `VIDA_DO_SANDBOX_MS` E tem
 * os DOIS sinais de identidade (`temSegundoSinal`, acima) — sem migração, sem
 * coluna nova. Um `SELECT *` seguido de filtro em JS: a cardinalidade é baixa
 * (~200 sandboxes no máximo, ver `SANDBOXES_EM_RODIZIO`), então não vale a
 * complexidade de um `LIKE`/`JOIN` no SQL.
 *
 * Um candidato que bate prefixo+idade mas falha o segundo sinal NÃO entra no
 * resultado — mas também nunca deveria desaparecer em silêncio: sem o
 * `logger.warn` abaixo, um sandbox cujo administrador sumiu por qualquer
 * motivo vira um vazamento permanente e invisível (ninguém mais o vê em
 * lugar nenhum, `limparSandboxesExpirados` nem chega a saber que ele existe).
 * O log é o que transforma essa guarda de segurança em algo observável, em
 * vez de um "some sem avisar".
 */
export async function sandboxesExpirados(agora: Date = new Date()): Promise<number[]> {
  const todos = await db.select({ id: providers.id, subdomain: providers.subdomain, createdAt: providers.createdAt }).from(providers);
  const limite = agora.getTime() - VIDA_DO_SANDBOX_MS;

  const candidatosPorPrefixoEIdade = todos
    .filter((p) => (p.subdomain ?? "").startsWith(PREFIXO_SANDBOX))
    .filter((p) => {
      const criadoEm = p.createdAt ? new Date(p.createdAt).getTime() : 0;
      return criadoEm <= limite;
    });
  if (candidatosPorPrefixoEIdade.length === 0) return [];

  const idsCandidatos = candidatosPorPrefixoEIdade.map((p) => p.id);
  const usuarios = await db.select({ providerId: users.providerId, email: users.email }).from(users).where(inArray(users.providerId, idsCandidatos));
  const emailsPorProvider = new Map<number, string[]>();
  for (const u of usuarios) {
    if (u.providerId == null) continue;
    const lista = emailsPorProvider.get(u.providerId) ?? [];
    lista.push(u.email);
    emailsPorProvider.set(u.providerId, lista);
  }

  const confirmados: number[] = [];
  for (const p of candidatosPorPrefixoEIdade) {
    if (temSegundoSinal(p.subdomain, emailsPorProvider.get(p.id) ?? [])) {
      confirmados.push(p.id);
    } else {
      logger.warn(
        { providerId: p.id, subdomain: p.subdomain },
        "demo: provider parece sandbox expirado (prefixo+idade) mas SEM o segundo sinal (administrador da demo) — nao apagado; investigar manualmente",
      );
    }
  }
  return confirmados;
}

/**
 * Quantos sandboxes VIVOS existem AGORA — isto é, ainda dentro de
 * `VIDA_DO_SANDBOX_MS` (24h). É contra isso que `GET /demo` confere
 * `TETO_DE_SANDBOXES_VIVOS` antes de criar mais um.
 *
 * Rodada de correção (revisão final de segurança antes da demonstração
 * pública, item 3): a versão anterior contava TODO sandbox da tabela —
 * "vivo ou expirado-mas-ainda-não-varrido, tanto faz", nas palavras do
 * comentário que ela tinha. Isso inflava o teto: a limpeza roda de HORA em
 * hora (`limpeza.service.ts`), então um sandbox que passou de 24h continuava
 * ocupando vaga no teto até a próxima varredura — e se ela atrasar (ou
 * parar, ver `server/worker.ts`), para sempre. Um punhado de IPs distintos
 * criando 2 sandboxes cada (o limite por IP) bastava para fechar a
 * demonstração pública por um dia inteiro, mesmo com o sweep rodando
 * direitinho: nada impedia os já-expirados de contar até serem fisicamente
 * apagados.
 *
 * Agora o corte por idade é o MESMO de `sandboxesExpirados` — um sandbox
 * expirado para de ocupar vaga no instante em que expira, não no instante em
 * que a próxima varredura horária o alcança.
 */
export async function contarSandboxesVivos(agora: Date = new Date()): Promise<number> {
  const todos = await db.select({ subdomain: providers.subdomain, createdAt: providers.createdAt }).from(providers);
  const limite = agora.getTime() - VIDA_DO_SANDBOX_MS;
  return todos
    .filter((p) => (p.subdomain ?? "").startsWith(PREFIXO_SANDBOX))
    .filter((p) => {
      const criadoEm = p.createdAt ? new Date(p.createdAt).getTime() : 0;
      return criadoEm > limite;
    }).length;
}

/**
 * Apaga um sandbox e tudo que ele (ou o visitante, ao vivo) gravou.
 *
 * REUSA `storage.deleteProvider` (rodada de correção, 11/09/2026) pela
 * cobertura de base — assim a demonstração herda qualquer manutenção futura
 * daquela função — mais o DELTA que só o sandbox precisa: 24 tabelas com FK
 * para `providers` que `deleteProvider` não conhece, ou conhece só por um
 * dos dois lados (`server/storage/providers.storage.ts:190-226` foi lido
 * inteiro antes de escrever isto; ela NÃO aceita executor de transação —
 * chama `db`/`db.select`/`db.delete` direto, sem parâmetro — por isso roda
 * fora da transação do delta, por conta própria).
 *
 * O universo de "tabelas com FK para providers" é conferido CONTRA O SCHEMA
 * pelo teste (`sandbox.service.test.ts`, "a limpeza cobre toda tabela com FK
 * para providers"), que deriva a lista via `getTableConfig` em vez de uma
 * enumeração solta, **sem exceção nenhuma** — 38 tabelas, 41 pares — se uma
 * tabela nova ganhar essa FK no futuro e ninguém atualizar a lista abaixo, é
 * o teste que acende vermelho, não um sandbox zumbi em produção.
 *
 * Ordem do delta: filhas antes de pais (calculada por ordenação topológica
 * do grafo de FKs antes de escrever — ver o relatório da tarefa). Delta
 * inteiro roda ANTES de `storage.deleteProvider`, porque várias dessas
 * tabelas referenciam `customers`/`equipment`, que só `deleteProvider`
 * apaga.
 *
 * `acessos_suporte` ENTRA no delta (rodada de correção 2, 11/09/2026) — não
 * fica de fora. `deleteProvider` RECUSA apagar o provedor (sem apagar a
 * trilha) quando essa tabela tem linha — `ProvedorComTrilhaDeSuporteError`,
 * guarda de LGPD para proteger o TITULAR real cujo dado um inquilino
 * levaria embora ao sair (`providers.storage.ts:41-72`). Essa guarda segue
 * intacta e vale para todo provedor real. Mas para o sandbox ela vira o
 * mesmo zumbi permanente que esta correção existe para consertar, por um
 * caminho que o próprio visitante aciona sem querer: o admin do sandbox tem
 * acesso à aba "Suporte" do painel dele (`POST /api/provider/acesso-suporte/liberar`,
 * `requireAdmin` sem exclusão de demonstração), e "revogar" um acesso NÃO
 * apaga a linha — só marca `revogadoEm`, então a contagem da guarda nunca
 * volta a zero. Como os clientes do sandbox são 100% sintéticos
 * (`pessoaFicticia`/`cpfFicticio`), não há titular real a proteger aqui — a
 * exceção fica estreita o bastante (só `subdomain` com o prefixo `sandbox-`,
 * a mesma trava que a função já faz na linha de baixo) para nunca alcançar
 * um provedor de verdade.
 *
 * Recusa apagar um provedor que não pareça um sandbox: `apagarSandbox` é
 * chamado pela limpeza automática (Tarefa 7) a partir de ids que ELA leu de
 * `sandboxesExpirados()`, mas um id errado em qualquer outro chamador futuro
 * não pode virar exclusão de um provedor de verdade.
 *
 * Rodada de correção (12/09/2026): a checagem agora exige os DOIS sinais de
 * identidade (`temSegundoSinal`) — prefixo do subdomínio E o administrador
 * determinístico da demo —, não só o prefixo. A CHAMADA DIRETA recusa
 * (lança), nunca apenas ignora: um id que chegue aqui por qualquer caminho
 * que não seja `sandboxesExpirados()` (ela mesma já filtra pelo segundo
 * sinal) tem que ser barrado com um erro que o chamador não pode deixar de
 * notar — silenciosamente "não fazer nada" seria a mesma armadilha de novo.
 */
export async function apagarSandbox(providerId: number): Promise<void> {
  const [provider] = await db.select({ subdomain: providers.subdomain }).from(providers).where(eq(providers.id, providerId));
  const subdomain = provider?.subdomain ?? "";
  if (!subdomain.startsWith(PREFIXO_SANDBOX)) {
    throw new Error(`apagarSandbox recusado: provider ${providerId} nao tem subdomain de sandbox`);
  }

  const usuariosDoProvider = await db.select({ email: users.email }).from(users).where(eq(users.providerId, providerId));
  if (!temSegundoSinal(subdomain, usuariosDoProvider.map((u) => u.email))) {
    throw new Error(
      `apagarSandbox recusado: provider ${providerId} (${subdomain}) tem o prefixo de sandbox mas NAO o segundo sinal ` +
      `— nenhum usuario com o e-mail administrador da demo (${emailDoAdminDaDemo(subdomain)})`,
    );
  }

  await db.transaction(async (tx) => {
    // Folhas do grafo (nada mais no delta referencia estas) — ordem entre
    // elas não importa, só precisam vir antes das tabelas que as usam.
    // acessos_suporte primeiro: é o que a guarda de `deleteProvider` conta
    // ANTES de qualquer outro delete — se sobrar aqui, tudo mais é em vão.
    await tx.delete(acessosSuporte).where(eq(acessosSuporte.providerId, providerId));
    await tx.delete(antiFraudAlerts).where(eq(antiFraudAlerts.consultingProviderId, providerId));
    await tx.delete(providerDocuments).where(eq(providerDocuments.uploadedById, providerId));
    await tx.delete(proactiveAlerts).where(eq(proactiveAlerts.providerId, providerId));
    await tx.delete(proactiveAlerts).where(eq(proactiveAlerts.consultingProviderId, providerId));
    await tx.delete(marcaEventos).where(eq(marcaEventos.providerId, providerId));
    await tx.delete(comissaoLancamentos).where(eq(comissaoLancamentos.providerId, providerId));
    await tx.delete(cobrancaPolitica).where(eq(cobrancaPolitica.providerId, providerId));
    await tx.delete(chatBullqIntegracoes).where(eq(chatBullqIntegracoes.providerId, providerId));
    await tx.delete(chatAutonomiaConfig).where(eq(chatAutonomiaConfig.providerId, providerId));
    await tx.delete(bigdataIntegrations).where(eq(bigdataIntegrations.providerId, providerId));
    await tx.delete(bigdataConsultations).where(eq(bigdataConsultations.providerId, providerId));
    await tx.delete(assinaturaIntegracoes).where(eq(assinaturaIntegracoes.providerId, providerId));
    await tx.delete(antiFraudRules).where(eq(antiFraudRules.providerId, providerId));

    // Cadeia da cobrança e do chat/recuperação — filhas antes de pais.
    await tx.delete(cobrancaEventos).where(eq(cobrancaEventos.providerId, providerId));
    await tx.delete(chatAutonomiaFila).where(eq(chatAutonomiaFila.providerId, providerId));
    await tx.delete(chatAutonomiaEstado).where(eq(chatAutonomiaEstado.providerId, providerId));
    await tx.delete(chatBullqConversas).where(eq(chatBullqConversas.providerId, providerId));
    await tx.delete(equipmentRecoveryEvents).where(eq(equipmentRecoveryEvents.providerId, providerId));
    await tx.delete(equipmentRecoveryCases).where(eq(equipmentRecoveryCases.providerId, providerId));
    await tx.delete(cobrancaParcelas).where(eq(cobrancaParcelas.providerId, providerId));
    await tx.delete(cobrancaConfissoesPdf).where(eq(cobrancaConfissoesPdf.providerId, providerId));
    await tx.delete(cobrancaConfissoes).where(eq(cobrancaConfissoes.providerId, providerId));
    await tx.delete(cobrancaNegociacoes).where(eq(cobrancaNegociacoes.providerId, providerId));
    await tx.delete(cobrancaCasos).where(eq(cobrancaCasos.providerId, providerId));
  });

  // Cobertura de base: as ~16 tabelas que `storage.deleteProvider` já
  // mantém (invoices, contracts, antiFraudAlerts[providerId], equipment,
  // customers, isp/spcConsultations, erpSyncLogs, erpIntegrations,
  // planChanges, providerInvoices, creditOrders,
  // providerDocuments[providerId], providerPartners, supportThreads+
  // Messages, users, providers). O guard de `acessosSuporte` que ela roda
  // primeiro já encontra a tabela vazia — o delta acima limpou.
  await storage.deleteProvider(providerId);
}
