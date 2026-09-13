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
import type {
  InsertCustomer,
  InsertInvoice,
  InsertEquipment,
  InsertCobrancaCaso,
  InsertCobrancaEvento,
  InsertAntiFraudAlert,
  InsertChatBullqConversa,
  EconomiaDaPolitica,
} from "@shared/schema";
import { cobrancaPreAvisos, cobrancaQuitacoes } from "@shared/schema-cobranca-faturas";
import { chatAutonomiaAutorizacao, chatAutonomiaSeguranca } from "@shared/chat-autonomia-seguranca";
import { storage } from "../storage";
import { emailCanonico } from "../storage/users.storage";
import { hashPassword } from "../password";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";
import { PROVEDORES_DA_DEMO, INDICES_COMPARTILHADOS, MESORREGIAO_DO_MUNDO_BASE, semearMundoBase, linhaDaIntegracao } from "./mundo-base";
import { STATUS_DE_CASO, casoFechado, eventoDaTransicaoDeCaso, transicaoDeCaso, type StatusDeCaso } from "@shared/cobranca/estados";
import { etapaParaAtraso } from "@shared/cobranca/regua";
import { severidadeDoAlerta } from "@shared/antifraude-avaliacao";
import {
  MOTIVO_CANCELADO_NO_ERP,
  MOTIVO_DIVIDA_ZERADA,
  dnaDoCaso,
  prioridadeSugerida,
} from "../services/cobranca/regua-diaria.service";
import {
  calcularPrazoRetirada,
  casoEstaEncerrado,
  equipamentoTemRetiradaPendente,
  validarSinalBureau,
  type RecoveryCaseStatus,
} from "../services/equipment-recovery-rules";
import {
  ACAO_AO_RECEBER_MENSAGEM,
  ACAO_PADRAO_APOS_RESPOSTA,
  TAMANHO_MAXIMO_DA_ACAO,
  proximoDiaUtil,
} from "../services/chat/chat-atendimento.service";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { limparChatSimuladoDoProvedor } from "./chat-simulado";

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
 * O saldo do visitante mora TODO em `isp_credits`; `spc_credits` nasce em
 * zero. `providers` ainda tem os dois campos (`shared/schema.ts`), mas desde o
 * crédito único (`migrations/0008_credito_unico.sql`) nenhum caminho de
 * consumo debita `spc_credits` — o saldo que se gasta é um só.
 *
 * Até 12/09/2026 o sandbox semeava OS DOIS com este valor, "porque não custava
 * nada". Custava: o dashboard soma os dois bolsos
 * (`server/storage/dashboard.storage.ts`), e o visitante via 1.000 créditos no
 * painel e 500 na tela de consulta — dois saldos diferentes na primeira tela
 * de quem entrou justamente para entender o produto.
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

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

/**
 * O cliente do caso "baixado" do kanban (`casosDoKanban`). A fatura de saída
 * dele nasce vencida como a de qualquer ex-cliente em posição ímpar, mas a
 * dívida NÃO vai para o cliente: baixar é exatamente o admin tirar a dívida
 * da cobrança, e um card "baixado" apontando para alguém que ainda deve seria
 * a régua reabrindo o caso na primeira passada.
 */
const CURSOR_DO_CASO_BAIXADO = INADIMPLENTES_POR_SANDBOX + 1;

/**
 * Custos de um ISP regional de fibra, por cliente (OPEX por mês) — números
 * plausíveis, não medidos, e marcados `confirmado` de propósito: sem eles a
 * Economia do cliente abria "PENDENTE · faltam os custos do provedor" em
 * TODA ficha 360 da demonstração (print do dono, 12/09/2026). `custosInformados`
 * (shared/cobranca/politica.ts) exige ao menos um custo > 0, e o residual do
 * equipamento é o mesmo valor que a carteira grava em `equipment.value`.
 *
 * `precoPorPlano` usa o MESMO índice de `planoDoContrato`/`valorMensalidade`:
 * o preço cadastrado de cada plano é a mensalidade que as faturas cobram, e
 * tem precedência sobre a mensalidade observada na leitura da Economia.
 */
const ECONOMIA_DA_DEMO: EconomiaDaPolitica = {
  cac: 180,
  capexInstalacao: 350,
  equipamentoResidual: VALOR_DO_EQUIPAMENTO,
  opexLink: 12,
  opexRedePop: 6,
  opexSuporte: 5,
  opexManutencaoNoc: 4,
  impostoReceitaPct: 9.25,
  cicloMeses: 36,
  confirmado: true,
  precoPorPlano: Object.fromEntries(NOMES_DE_PLANO.map((nome, i) => [nome, VALORES_DE_PLANO[i]])),
};

/**
 * As 13 recuperações de equipamento, por POSIÇÃO dentro dos cancelados com
 * ONU retida (0..29). Os abertos ficam todos na coorte de 30 dias
 * (`RECENCIA_CANCELAMENTO_DIAS[pos % 6] === 30`), com o prazo regulatório de
 * 60 dias ainda correndo — é o único jeito de o sinal de bureau do caso em
 * notificação formal passar em `validarSinalBureau`. Concluídos saíram há 60
 * dias; baixados e expirados, há 90 (prazo vencido há 30).
 */
const RECUPERACAO_POR_POSICAO: ReadonlyMap<number, RecoveryCaseStatus> = new Map<number, RecoveryCaseStatus>([
  [0, "pre_recuperacao"],
  [6, "agendado"],
  [12, "nova_tentativa"],
  [18, "notificacao_formal"],
  [24, "contestado"],
  [1, "concluido"],
  [7, "concluido"],
  [13, "concluido"],
  [19, "concluido"],
  [2, "baixado_economico"],
  [8, "baixado_economico"],
  [14, "prazo_expirado"],
  [20, "prazo_expirado"],
]);

function recuperacaoDaEntrada(entrada: EntradaSandbox): RecoveryCaseStatus | null {
  if (entrada.categoria !== "cancelado" || entrada.posicaoNaCategoria >= CANCELADOS_COM_EQUIPAMENTO_RETIDO) return null;
  return RECUPERACAO_POR_POSICAO.get(entrada.posicaoNaCategoria) ?? null;
}

/**
 * O status do `equipment` que a transição REAL deixaria — mesma regra de
 * `updateRecoveryCase` (server/storage/equipment.storage.ts): concluído vai à
 * triagem, qualquer outro encerramento baixa, aberto fica pendente e em
 * processo. Decidido ANTES do insert do equipamento, porque o agregado do
 * cliente (`equipmentCount`) nasce no mesmo lote dos clientes.
 */
function equipamentoNaRecuperacao(status: RecoveryCaseStatus): { status: string; emRecuperacao: boolean } {
  if (status === "concluido") return { status: "recuperado_triagem", emRecuperacao: false };
  if (casoEstaEncerrado(status)) return { status: "baixado", emRecuperacao: false };
  return { status: "retirada_pendente", emRecuperacao: true };
}

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
  /** true = não devolvido (conta no agregado do cliente); false = comodato normal ou já resolvido (não conta). */
  retido: boolean;
  /** `equipment.inRecoveryProcess` — só o equipamento de uma recuperação ABERTA. */
  emRecuperacao: boolean;
}

/**
 * Cancelado: os primeiros `CANCELADOS_COM_EQUIPAMENTO_RETIDO` (por posição)
 * ficam com a ONU não devolvida. Em dia: os ÚLTIMOS `EM_DIA_COM_EQUIPAMENTO_COMODATO`
 * — nunca os primeiros, porque os primeiros de "em dia" são justamente os 150
 * compartilhados com a rede (ver `planoDeIndicesDoSandbox`), e o comodato
 * normal não precisa se concentrar ali.
 *
 * Cancelado com recuperação semeada (`RECUPERACAO_POR_POSICAO`) leva o status
 * que a transição real deixaria, e `retido` segue a MESMA lista que
 * `recalculateCustomerEquipmentAggregate` conta no SQL
 * (`equipamentoTemRetiradaPendente`) — uma ONU já recuperada ou baixada não
 * pode continuar pesando no agregado do cliente que o Anti-Fraude lê.
 */
function equipamentoDaEntrada(entrada: EntradaSandbox): DescritorDeEquipamento | null {
  if (entrada.categoria === "cancelado" && entrada.posicaoNaCategoria < CANCELADOS_COM_EQUIPAMENTO_RETIDO) {
    const recuperacao = recuperacaoDaEntrada(entrada);
    const { status, emRecuperacao } = recuperacao
      ? equipamentoNaRecuperacao(recuperacao)
      : { status: STATUS_DE_EQUIPAMENTO_RETIDO[entrada.posicaoNaCategoria % STATUS_DE_EQUIPAMENTO_RETIDO.length], emRecuperacao: false };
    return { status, value: VALOR_DO_EQUIPAMENTO, retido: equipamentoTemRetiradaPendente(status), emRecuperacao };
  }
  if (entrada.categoria === "em_dia" && entrada.posicaoNaCategoria >= EM_DIA_TOTAL_POR_SANDBOX - EM_DIA_COM_EQUIPAMENTO_COMODATO) {
    return { status: STATUS_DE_EQUIPAMENTO_COMODATO, value: VALOR_DO_EQUIPAMENTO, retido: false, emRecuperacao: false };
  }
  return null;
}

/** A fatura de saída do ex-cliente nasce paga nas posições pares — ver `linhaDaFaturaDeSaida`. */
function saidaPaga(entrada: EntradaSandbox): boolean {
  return entrada.posicaoNaCategoria % 2 === 0;
}

/** Proporcional + multa + equipamento — o valor exato da fatura de saída, um lugar só para fatura e dívida do cliente. */
function valorDaFaturaDeSaida(indice: number): number {
  const proporcional = Number((valorMensalidade(indice) * DIAS_PROPORCIONAL_DE_SAIDA / 30).toFixed(2));
  return Number((MULTA_DE_SAIDA_PADRAO + VALOR_DO_EQUIPAMENTO + proporcional).toFixed(2));
}

/**
 * A dívida que o ex-cliente carrega: a fatura de saída VENCIDA (posição
 * ímpar), com o atraso contado desde o corte — que é o vencimento dela.
 * `null` para quem pagou a saída e para o cliente do caso "baixado"
 * (`CURSOR_DO_CASO_BAIXADO`).
 */
function dividaDeSaidaDaEntrada(providerId: number, entrada: EntradaSandbox, agora: Date): { valor: number; dias: number } | null {
  if (entrada.categoria !== "cancelado" || saidaPaga(entrada) || entrada.cursor === CURSOR_DO_CASO_BAIXADO) return null;
  const cortadoEm = cortadoEmDaEntrada(entrada, agora)!;
  return {
    valor: valorDaFaturaDeSaida(indiceDaEntrada(providerId, entrada)),
    dias: Math.round((agora.getTime() - cortadoEm.getTime()) / DIA_MS),
  };
}

/**
 * Score coerente com a história de cada conta. O default da coluna (100) é o
 * que `ispScoreReal` (cobranca.routes.ts) trata como "nunca calculado" e
 * esconde — a demonstração inteira mostrava score vazio. Em dia fica em
 * 650-900; inadimplente cai com a idade do atraso (588 aos 10 dias, 250 aos
 * 300); ex-cliente depende de como saiu: pagou a saída fica mais alto, saiu
 * devendo fica mais baixo, pior quanto mais antigo o corte.
 */
function scoreDaEntrada(providerId: number, entrada: EntradaSandbox, agora: Date): number {
  const indice = indiceDaEntrada(providerId, entrada);
  if (entrada.categoria === "em_dia") return 650 + (indice % 251);
  if (entrada.categoria === "inadimplente") {
    const idade = Math.min(idadeRepresentativa(entrada.posicaoNaCategoria), 300);
    return Math.round(600 - idade * (350 / 300));
  }
  const cortadoEm = cortadoEmDaEntrada(entrada, agora)!;
  const fracaoDoAno = Math.min((agora.getTime() - cortadoEm.getTime()) / DIA_MS, 365) / 365;
  return saidaPaga(entrada) ? Math.round(550 - fracaoDoAno * 100) : Math.round(400 - fracaoDoAno * 150);
}

/**
 * A faixa de risco com o VOCABULÁRIO e a REGRA do produto: é o que o sync grava
 * em `customers.risk_tier` (`upsertCustomerFromErp`,
 * server/storage/customers.storage.ts:287 — a expressão não é exportada, por
 * isso repetida aqui e travada pelo teste contra o texto daquele arquivo). O
 * painel conta `critical`/`high`/`medium` (dashboard.storage.ts) e a tela de
 * inadimplentes rotula por `RISK_CONFIG`; até 12/09/2026 a semeadura gravava
 * "excelente"/"bom"/"regular"/"baixo", que nenhum dos dois conhece — o painel
 * mostrava zero em todas as faixas e a tela caía em "Baixo" para todo mundo.
 */
function faixaDeRiscoDoAtraso(maxDaysOverdue: number): string {
  return maxDaysOverdue > 180 ? "critical" : maxDaysOverdue > 90 ? "high" : maxDaysOverdue > 60 ? "medium" : "low";
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
    // A carteira "acabou de sincronizar" — sem isto a ficha mostrava "nunca
    // sincronizado" para um cliente que veio do conector da demo.
    lastSyncAt: agora,
    ispScore: scoreDaEntrada(providerId, entrada, agora),
    ...(cortadoEm ? { cortadoEm } : {}),
  };

  if (entrada.categoria === "inadimplente") {
    const maxDaysOverdue = idadeRepresentativa(entrada.posicaoNaCategoria);
    return {
      ...base,
      status: "active",
      paymentStatus: "overdue",
      riskTier: faixaDeRiscoDoAtraso(maxDaysOverdue),
      totalOverdueAmount: valorMensalidade(indice).toFixed(2),
      maxDaysOverdue,
      overdueInvoicesCount: 1,
    };
  }
  if (entrada.categoria === "cancelado") {
    // `paymentStatus` segue a MESMA regra do sync (customers.storage.ts:388 e
    // :426): `overdue` se `totalOverdueAmount > 0`, senão `current` — sem olhar
    // o status do contrato. Um ex-cliente que saiu devendo, sincronizado de um
    // ERP de verdade, chega `cancelled` + `overdue`. Até 12/09/2026 a
    // semeadura o deixava `current`, e todo leitor de "devedor" do produto
    // ficava cego para ele: o card de equipamentos não devolvidos do painel
    // (dashboard.storage.ts, que exige `payment_status != 'current'`) nascia
    // zerado, e o mapa e a lista de inadimplentes perdiam a dívida de saída.
    //
    // A carteira de ATIVOS não infla com isso: cobrança, régua e kanban
    // separam ativo de ex-cliente pelo status do contrato
    // (`carteiraDoStatusErp`, cobranca.storage.ts), nunca por `payment_status`;
    // o que conta devedor por `payment_status` (painel, inadimplentes, mapa,
    // tendência) mostra a coluna de status do contrato ao lado, e o endereço
    // de risco já rotula `cancelled` como "inativo". O painel passa a contar
    // 225 inadimplentes ativos + 74 ex-clientes devendo, que é o que ele
    // contaria com a mesma carteira vinda do ERP.
    const divida = dividaDeSaidaDaEntrada(providerId, entrada, agora);
    const maxDaysOverdue = divida?.dias ?? 0;
    return {
      ...base,
      status: "cancelled",
      paymentStatus: divida ? "overdue" : "current",
      riskTier: faixaDeRiscoDoAtraso(maxDaysOverdue),
      totalOverdueAmount: divida ? divida.valor.toFixed(2) : "0.00",
      maxDaysOverdue,
      overdueInvoicesCount: divida ? 1 : 0,
    };
  }
  return { ...base, status: "active", paymentStatus: "current", riskTier: faixaDeRiscoDoAtraso(0), totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
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
  const valor = valorDaFaturaDeSaida(indiceDaEntrada(providerId, entrada));
  const descricao = `Proporcional ${DIAS_PROPORCIONAL_DE_SAIDA} dias + multa ${formatarReal(MULTA_DE_SAIDA_PADRAO)} + equipamento ${formatarReal(VALOR_DO_EQUIPAMENTO)}`;
  const paga = saidaPaga(entrada);

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
    inRecoveryProcess: descritor.emRecuperacao,
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

/** Devolve os ids na ordem das linhas — as recuperações de equipamento precisam do `equipment.id` de cada ONU. */
async function inserirEquipamentosEmBlocos(tx: Executor, linhas: InsertEquipment[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    const inseridos = await tx.insert(equipment).values(linhas.slice(i, i + TAMANHO_DO_BLOCO)).returning({ id: equipment.id });
    ids.push(...inseridos.map((r) => r.id));
  }
  return ids;
}

/**
 * Um caso em cada uma das 9 colunas do kanban (`ORDEM_DO_KANBAN`,
 * `server/routes/cobranca.routes.ts:1190-1192`, mesmo conjunto de
 * `STATUS_DE_CASO`). Sem isto, um visitante que cai no meio do dia vê o
 * quadro vazio — a régua diária que POPULARIA `cobranca_casos` só roda no
 * worker (boot + 05:00), que este processo HTTP nunca executa.
 *
 * Os 6 status não-terminais — e os 5 casos das conversas de cobrança de
 * ativos, cursores 6..10 — usam clientes que já nasceram inadimplentes
 * (`paymentStatus: "overdue"`); os 3 terminais que fecham o contrato
 * (`cancelamento`, `baixado`, `encerrado`) usam clientes que já nasceram
 * cancelados — nenhum dos 9 toca os clientes de exemplo ("limpo",
 * "devendo_na_rede"), que vivem fora da faixa exclusiva de cursores usada
 * aqui (0..10 e 225..227).
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
  linhasClientes: InsertCustomer[],
  indicePorCursor: Map<number, number>,
  agora: Date,
): InsertCobrancaCaso[] {
  const idDoCursor = (cursor: number): number => idsClientes[indicePorCursor.get(cursor)!];
  const entradaDoCursor = (cursor: number): EntradaSandbox => entradas[indicePorCursor.get(cursor)!];

  // Etapa, prioridade e DNA NÃO são escritos à mão (rodada de coerência,
  // 12/09/2026): saem das funções reais da régua, como em
  // `casosVivosDeExCliente`. À mão, o cursor 1 (45 dias) nascia em
  // "lembrete_atraso" e o 4 (20 dias) em "pre_negativacao", e a primeira
  // passada do worker desfazia os dois cards na frente do visitante.
  //
  // Negativado no cursor 3 (300 dias) e acordo no 4 (20 dias), e não o
  // contrário: negativar exige o pré-aviso da etapa de pré-negativação (D+90,
  // Súmula 359 do STJ), e um card negativado com 20 dias de atraso ensinaria
  // à demonstração justamente o que o produto proíbe.
  const NAO_TERMINAIS: Array<{ status: StatusDeCaso; cursor: number }> = [
    { status: "aberto", cursor: 0 },
    { status: "em_contato", cursor: 1 },
    { status: "negociando", cursor: 2 },
    { status: "negativado", cursor: 3 },
    { status: "acordo_ativo", cursor: 4 },
    { status: "pago", cursor: 5 },
    // Os inadimplentes das 5 conversas de cobrança de ativos (`conversasPlanejadas`).
    // Até 12/09/2026 eles tinham conversa e nenhum caso: devendo e sem caso vivo,
    // eram candidatos de `clientesParaAbrirCaso`, e a primeira passada da régua
    // abria um card "aberto", sem contato, ao lado de uma conversa ativa — o
    // estado que `aplicarLinhaDoTempo` declara impossível. Em contato, pelo
    // contato que a conversa registrou; negociando só na conversa parada na
    // equipe (WAITING), onde a cena termina com a proposta enviada.
    { status: "em_contato", cursor: 6 },
    { status: "negociando", cursor: 7 },
    { status: "em_contato", cursor: 8 },
    { status: "em_contato", cursor: 9 },
    { status: "em_contato", cursor: 10 },
  ];
  /** `motivo: null` = fechado sem motivo automático (ver o comentário da função) — nunca uma string inventada. */
  const TERMINAIS_EX_CLIENTE: Array<{ status: StatusDeCaso; cursor: number; motivo: string | null }> = [
    { status: "cancelamento", cursor: INADIMPLENTES_POR_SANDBOX + 0, motivo: MOTIVO_CANCELADO_NO_ERP },
    { status: "baixado", cursor: CURSOR_DO_CASO_BAIXADO, motivo: null },
    { status: "encerrado", cursor: INADIMPLENTES_POR_SANDBOX + 2, motivo: MOTIVO_DIVIDA_ZERADA },
  ];

  const casos: InsertCobrancaCaso[] = [];

  for (const item of NAO_TERMINAIS) {
    const k = indicePorCursor.get(item.cursor)!;
    const entrada = entradaDoCursor(item.cursor);
    const indice = indiceDaEntrada(providerId, entrada);
    const mensalidade = valorMensalidade(indice);
    const valor = mensalidade.toFixed(2);
    const dias = idadeRepresentativa(entrada.posicaoNaCategoria);
    // "pago" é o único status FECHADO dentro de NAO_TERMINAIS (ver
    // STATUS_FECHADOS_DE_CASO em shared/cobranca/estados.ts) — os outros
    // cinco são vivos e não levam encerradoEm. Caso fechado a régua não
    // revisa: fica sem etapa, como o encerramento real deixa.
    if (item.status === "pago") {
      casos.push({
        providerId,
        customerId: idDoCursor(item.cursor),
        status: item.status,
        carteira: "ativo",
        etapaAtual: null,
        diasAtrasoAbertura: dias,
        valorAbertura: valor,
        valorAtual: valor,
        prioridade: "normal",
        proximoContatoEm: null,
        encerradoEm: agora,
        motivoEncerramento: null,
      });
      continue;
    }
    // A mesma entrada que `revisarCaso` usaria: `diasAtraso` = `maxDaysOverdue`
    // do cliente, uma fatura aberta, a data do contrato. `diasAtrasoAbertura`
    // sai com o atraso de HOJE e `aplicarLinhaDoTempo` o recua até a abertura.
    const etapa = etapaParaAtraso(dias, "ativo").etapa?.id ?? null;
    const dna = dnaDoCaso({ contractStartDate: linhasClientes[k].contractStartDate ?? null, diasAtraso: dias, faturasAbertas: 1 }, agora);
    casos.push({
      providerId,
      customerId: idDoCursor(item.cursor),
      status: item.status,
      carteira: "ativo",
      etapaAtual: etapa,
      diasAtrasoAbertura: dias,
      valorAbertura: valor,
      valorAtual: valor,
      prioridade: prioridadeSugerida(mensalidade, etapa),
      proximoContatoEm: new Date(agora.getTime() + DIA_MS),
      quadranteDna: dna.quadranteDna,
      tom: dna.tom,
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
  // "Ao menos um por status", não "exatamente nove": os casos vivos de
  // ex-cliente (`casosVivosDeExCliente`) somam mais cards às mesmas colunas.
  const statusCobertos = new Set(casos.map((c) => c.status));
  const semCaso = STATUS_DE_CASO.filter((s) => !statusCobertos.has(s));
  if (semCaso.length > 0) {
    throw new Error(`casosDoKanban: nenhum caso para o(s) status ${semCaso.join(", ")} — o kanban nasceria com coluna vazia`);
  }

  return casos;
}

/**
 * Os ~10 casos VIVOS de ex-cliente, além dos 3 terminais do kanban. Sem eles
 * a carteira de ex-clientes da cobrança abria só com cards fechados — e a
 * régua do ex-cliente (sem aviso de suspensão, direto à negociação) nunca
 * aparecia trabalhando.
 *
 * Todos em ex-clientes COM dívida (`dividaDeSaidaDaEntrada`), com posições
 * ímpares fora do cursor do caso "baixado" — e fora das recuperações
 * CONCLUÍDAS (`RECUPERACAO_POR_POSICAO` 1, 7, 13, 19): a fatura de saída cobra
 * "equipamento 290,00", e negociar o aparelho que a tela de Recuperação diz
 * que já voltou seria a demonstração se contradizendo. Nas posições usadas a
 * ONU segue retida, e a cobrança dela é coerente. Etapa, prioridade e DNA saem das
 * funções REAIS da régua diária, com a mesma entrada que ela usaria
 * (`diasAtraso` = `maxDaysOverdue`, uma fatura aberta, a data do contrato do
 * cliente) — um card que a primeira passada do worker mudaria de etapa seria
 * a demonstração desmentindo a si mesma.
 *
 * Sem negociação semeada: `ACORDO_PADRAO` nasce com a origem da cobrança
 * `nao_definida`, e com ela a política só autoriza o valor integral à vista —
 * um parcelamento semeado seria um acordo que o próprio produto recusaria.
 * `negociando`/`acordo_ativo` sem linha de negociação é o mesmo estado dos
 * cards do kanban acima, e a régua não mexe neles (`STATUS_GOVERNADOS_PELO_ACORDO`).
 */
const CASOS_VIVOS_DE_EX_CLIENTE: ReadonlyArray<{ posicao: number; status: StatusDeCaso; proximoContato: "passado" | "hoje" | "futuro" }> = [
  { posicao: 3, status: "aberto", proximoContato: "hoje" },
  { posicao: 11, status: "aberto", proximoContato: "passado" },
  { posicao: 21, status: "aberto", proximoContato: "futuro" },
  { posicao: 9, status: "em_contato", proximoContato: "futuro" },
  { posicao: 15, status: "em_contato", proximoContato: "passado" },
  { posicao: 17, status: "em_contato", proximoContato: "hoje" },
  { posicao: 23, status: "negociando", proximoContato: "hoje" },
  { posicao: 25, status: "negociando", proximoContato: "futuro" },
  { posicao: 27, status: "acordo_ativo", proximoContato: "futuro" },
  { posicao: 5, status: "negativado", proximoContato: "passado" },
];

function casosVivosDeExCliente(
  providerId: number,
  entradas: EntradaSandbox[],
  idsClientes: number[],
  linhasClientes: InsertCustomer[],
  indicePorCursor: Map<number, number>,
  agora: Date,
): InsertCobrancaCaso[] {
  const quando = { passado: new Date(agora.getTime() - 2 * DIA_MS), hoje: agora, futuro: new Date(agora.getTime() + 3 * DIA_MS) };

  return CASOS_VIVOS_DE_EX_CLIENTE.map((item) => {
    const k = indicePorCursor.get(INADIMPLENTES_POR_SANDBOX + item.posicao)!;
    const divida = dividaDeSaidaDaEntrada(providerId, entradas[k], agora);
    if (!divida) {
      throw new Error(`casosVivosDeExCliente: posicao ${item.posicao} nao tem divida de saida — caso vivo sem divida seria encerrado na primeira passada da regua`);
    }
    const etapa = etapaParaAtraso(divida.dias, "ex_cliente").etapa?.id ?? null;
    const dna = dnaDoCaso({ contractStartDate: linhasClientes[k].contractStartDate ?? null, diasAtraso: divida.dias, faturasAbertas: 1 }, agora);
    const valor = divida.valor.toFixed(2);
    return {
      providerId,
      customerId: idsClientes[k],
      status: item.status,
      carteira: "ex_cliente",
      etapaAtual: etapa,
      diasAtrasoAbertura: divida.dias,
      valorAbertura: valor,
      valorAtual: valor,
      prioridade: prioridadeSugerida(divida.valor, etapa),
      proximoContatoEm: quando[item.proximoContato],
      quadranteDna: dna.quadranteDna,
      tom: dna.tom,
    };
  });
}

// ── Chat integrado simulado (a conversa nasce no banco local, nunca no fork do Chat BullQ) ──

type StatusDaConversa = "OPEN" | "PENDING" | "WAITING" | "BOT" | "CLOSED";

/** O canal que o chat simulado da demonstração devolve em `GET /channels`. */
const CANAL_DO_CHAT_DA_DEMO = "demo-canal";

/**
 * Janelas (em horas antes de agora) de abertura e do último evento, por
 * status — as mesmas regras que o roteiro simulado segue: OPEN/PENDING/BOT
 * tiveram movimento nas últimas 24 h; WAITING/CLOSED estão paradas há mais de
 * 24 h. O deslocamento por `ordem` (7 min cada, 21 conversas = menos de 3 h)
 * só desempata a ordenação da lista sem cruzar nenhuma das duas fronteiras.
 */
const JANELA_DA_CONVERSA_HORAS: Record<StatusDaConversa, { aberta: number; ultimoEvento: number }> = {
  OPEN: { aberta: 72, ultimoEvento: 2 },
  PENDING: { aberta: 48, ultimoEvento: 6 },
  BOT: { aberta: 10, ultimoEvento: 9 },
  WAITING: { aberta: 120, ultimoEvento: 48 },
  CLOSED: { aberta: 240, ultimoEvento: 144 },
};

const NOTA_DO_CHAT_POR_STATUS: Record<StatusDaConversa, string> = {
  OPEN: "Cliente respondeu pelo WhatsApp; atendente acompanhando a conversa",
  PENDING: "Mensagem do cliente aguardando resposta da equipe",
  WAITING: "Equipe respondeu pelo WhatsApp; aguardando retorno do cliente",
  BOT: "Primeira mensagem enviada pelo atendimento automático",
  CLOSED: "Conversa encerrada pelo atendente",
};

interface ConversaPlanejada {
  origem: "cobranca" | "equipamentos";
  cursor: number;
  status: StatusDaConversa;
  conversationId: string;
  abertaEm: Date;
  ultimoEventoEm: Date;
}

/**
 * As 21 conversas, decididas ANTES de qualquer insert: os casos precisam do
 * horário do contato (`ultimoContatoEm`, `abertoEm`) no próprio insert, e as
 * recuperações precisam do resultado da tentativa pelo chat para conferir o
 * sinal de bureau.
 *
 * Nenhuma conversa em caso "aberto": no produto, abrir a conversa do caso É o
 * gesto que registra o contato e move o caso para "em contato"
 * (`iniciarContatoDaCobranca`), e a fila de primeiro contato só pega "aberto"
 * sem contato. A conversa do robô (BOT) fica, então, num caso em contato — o
 * contato sem resultado e sem usuário, como a automação grava.
 *
 * Cobrança de ativos: os 4 casos vivos do kanban com contato (cursores 1..4)
 * + os 5 casos em contato/negociando dos cursores 6..10 (o 5 é o caso "pago",
 * fechado, e o 0 é o card "aberto"). Cobrança de ex-clientes: os 7 casos vivos
 * que não estão "aberto". Equipamentos: as 5 recuperações abertas.
 *
 * Nenhuma conversa de cobrança fica sem caso vivo: o cliente dela deve, e
 * devendo sem caso vivo é candidato de `clientesParaAbrirCaso` — a régua
 * abriria um card "aberto" ao lado da conversa, que continuaria sem vínculo.
 */
function conversasPlanejadas(providerId: number, agora: Date): ConversaPlanejada[] {
  const plano: Array<Pick<ConversaPlanejada, "origem" | "cursor" | "status">> = [
    { origem: "cobranca", cursor: 1, status: "OPEN" },
    { origem: "cobranca", cursor: 2, status: "PENDING" },
    { origem: "cobranca", cursor: 3, status: "CLOSED" },
    { origem: "cobranca", cursor: 4, status: "WAITING" },
    { origem: "cobranca", cursor: 6, status: "OPEN" },
    { origem: "cobranca", cursor: 7, status: "WAITING" },
    { origem: "cobranca", cursor: 8, status: "PENDING" },
    { origem: "cobranca", cursor: 9, status: "BOT" },
    { origem: "cobranca", cursor: 10, status: "OPEN" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 9, status: "BOT" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 15, status: "PENDING" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 17, status: "OPEN" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 23, status: "OPEN" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 25, status: "WAITING" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 27, status: "CLOSED" },
    { origem: "cobranca", cursor: INADIMPLENTES_POR_SANDBOX + 5, status: "CLOSED" },
    { origem: "equipamentos", cursor: INADIMPLENTES_POR_SANDBOX + 0, status: "OPEN" },
    { origem: "equipamentos", cursor: INADIMPLENTES_POR_SANDBOX + 6, status: "WAITING" },
    { origem: "equipamentos", cursor: INADIMPLENTES_POR_SANDBOX + 12, status: "PENDING" },
    { origem: "equipamentos", cursor: INADIMPLENTES_POR_SANDBOX + 18, status: "BOT" },
    { origem: "equipamentos", cursor: INADIMPLENTES_POR_SANDBOX + 24, status: "CLOSED" },
  ];
  return plano.map((p, i) => {
    const desvio = (i + 1) * 7 * 60_000;
    const janela = JANELA_DA_CONVERSA_HORAS[p.status];
    return {
      ...p,
      conversationId: `demo-conv-${providerId}-${i + 1}`,
      abertaEm: new Date(agora.getTime() - janela.aberta * HORA_MS - desvio),
      ultimoEventoEm: new Date(agora.getTime() - janela.ultimoEvento * HORA_MS - desvio),
    };
  });
}

/**
 * As próximas ações de um clique que a tela oferece — `PROXIMAS_ACOES_COMUNS`
 * (client/src/components/cobranca/DialogoContato.tsx) e `ACOES_COMUNS_DO_CHAT`
 * (client/src/components/chat/tipos.ts). Moram no client, que o servidor não
 * importa; o teste confere cada texto contra aqueles dois arquivos. As que o
 * próprio servidor grava (`ACAO_AO_RECEBER_MENSAGEM`, `ACAO_PADRAO_APOS_RESPOSTA`)
 * vêm importadas de `chat-atendimento.service`.
 */
const ACAO_ENVIAR_PAGAMENTO = "Enviar boleto / PIX";
const ACAO_PROPOR_ACORDO = "Enviar proposta de acordo";
const ACAO_COBRAR_PROMESSA = "Cobrar a promessa";
const ACAO_RETOMAR_CONVERSA = "Retomar a conversa";

/**
 * A próxima ação que o produto teria deixado no caso — o follow-up que todo
 * contato grava (dono, 05/09/2026). Até 12/09/2026 todo caso vivo tinha a data
 * do próximo contato e a ação nula, e a conversa abria com "caso sem próxima
 * ação — parado na fila" (Atendimento.tsx exige as duas).
 *
 * Com conversa, quem fala por último decide, como no chat de verdade: fala do
 * cliente (OPEN/PENDING) é "Responder no chat" no instante em que chegou
 * (`receberRespostaDoCliente`); só a abertura do robô (BOT) é retomar a
 * conversa no próximo dia útil; conversa parada na equipe (WAITING/CLOSED) é o
 * que o contato registrou — acordo cobra a promessa, recusa do negativado volta
 * à proposta (`SUGESTAO_POR_RESULTADO`), e o resto é o padrão de quem respondeu
 * sem dizer o depois (`followUpAoResponder`). Sem conversa só há caso "aberto":
 * a primeira ação da etapa — o PIX no lembrete do ativo, a proposta na dívida de
 * saída do ex-cliente — e a data que ele já tem.
 */
function followUpDoCaso(caso: InsertCobrancaCaso, conversa: ConversaPlanejada | undefined): { proximaAcao: string; proximoContatoEm?: Date } {
  if (!conversa) return { proximaAcao: caso.carteira === "ex_cliente" ? ACAO_PROPOR_ACORDO : ACAO_ENVIAR_PAGAMENTO };
  if (conversa.status === "OPEN" || conversa.status === "PENDING") {
    return { proximaAcao: ACAO_AO_RECEBER_MENSAGEM, proximoContatoEm: conversa.ultimoEventoEm };
  }
  const proximoContatoEm = proximoDiaUtil(conversa.ultimoEventoEm);
  if (conversa.status === "BOT") return { proximaAcao: ACAO_RETOMAR_CONVERSA, proximoContatoEm };
  if (caso.status === "acordo_ativo") return { proximaAcao: ACAO_COBRAR_PROMESSA, proximoContatoEm };
  if (caso.status === "negativado") return { proximaAcao: ACAO_PROPOR_ACORDO, proximoContatoEm };
  return { proximaAcao: ACAO_PADRAO_APOS_RESPOSTA, proximoContatoEm };
}

/**
 * Desde quando o caso está no status atual, pela transição que a conversa
 * conta: em contato desde o contato que o moveu; negociando desde o meio da
 * conversa (a proposta veio depois de o cliente responder); acordo desde a
 * última fala da equipe ("Acordo registrado"); negativado ANTES da conversa —
 * a abertura dela já fala do registro nos órgãos de proteção.
 */
function statusDesdeComContato(status: string, abertoEm: Date, conversa: ConversaPlanejada): Date {
  const meio = (a: Date, b: Date) => new Date((a.getTime() + b.getTime()) / 2);
  if (status === "em_contato") return conversa.abertaEm;
  if (status === "negociando") return meio(conversa.abertaEm, conversa.ultimoEventoEm);
  if (status === "acordo_ativo") return conversa.ultimoEventoEm;
  return meio(abertoEm, conversa.abertaEm);
}

/**
 * A linha do tempo de cada caso VIVO, decidida antes do insert: abertura,
 * contato, desde quando está no status, o atraso na abertura e o follow-up.
 * Até 12/09/2026 `statusDesde` ficava no default (agora) e
 * `diasAtrasoAbertura` era o atraso de hoje mesmo quando a abertura tinha sido
 * recuada em até 11 dias — a esteira dizia "neste status há minutos" para um
 * caso aberto há uma semana.
 *
 * Com conversa: o contato que a abriu vira `ultimoContatoEm`, e o caso passa a
 * ter nascido um dia antes dele — senão a linha do tempo mostraria contato
 * anterior à abertura. Sem conversa (só "aberto"): a régua abre o caso com o
 * próximo contato no próprio dia (`abrirCaso`), então um próximo contato já
 * vencido É a data da abertura; hoje ou adiante, o caso abriu agora.
 *
 * Os semeadores gravam em `diasAtrasoAbertura` o atraso de HOJE (o que a régua
 * lê do cliente); aqui ele vira o atraso no dia da abertura.
 *
 * Caso "aberto" com conversa é deriva do plano, e falha alto: o produto nunca
 * deixa um caso aberto com contato registrado (ver `conversasPlanejadas`).
 */
function aplicarLinhaDoTempo(casos: InsertCobrancaCaso[], cursorPorCliente: Map<number, number>, conversas: ConversaPlanejada[], agora: Date): void {
  for (const caso of casos) {
    const status = caso.status ?? "aberto";
    if (casoFechado(status)) continue;
    const conversa = conversas.find((c) => c.origem === "cobranca" && c.cursor === cursorPorCliente.get(caso.customerId));

    let abertoEm: Date;
    if (conversa) {
      if (status === "aberto") {
        throw new Error(`aplicarLinhaDoTempo: conversa ${conversa.conversationId} num caso 'aberto' — abrir a conversa move o caso para 'em_contato' no produto`);
      }
      abertoEm = new Date(conversa.abertaEm.getTime() - DIA_MS);
      caso.ultimoContatoEm = conversa.abertaEm;
      caso.statusDesde = statusDesdeComContato(status, abertoEm, conversa);
    } else {
      abertoEm = caso.proximoContatoEm && caso.proximoContatoEm.getTime() < agora.getTime() ? caso.proximoContatoEm : agora;
      caso.statusDesde = abertoEm;
    }
    caso.abertoEm = abertoEm;
    const diasDesdeAbertura = Math.floor((agora.getTime() - abertoEm.getTime()) / DIA_MS);
    caso.diasAtrasoAbertura = Math.max(0, (caso.diasAtrasoAbertura ?? 0) - diasDesdeAbertura);

    const followUp = followUpDoCaso(caso, conversa);
    if (followUp.proximaAcao.length > TAMANHO_MAXIMO_DA_ACAO) {
      throw new Error(`aplicarLinhaDoTempo: proxima acao com mais de ${TAMANHO_MAXIMO_DA_ACAO} caracteres — a rota do chat a recusaria`);
    }
    Object.assign(caso, followUp);
  }
}

type LinhaDaRecuperacao = typeof equipmentRecoveryCases.$inferInsert;
type LinhaDoEventoDeRecuperacao = Omit<typeof equipmentRecoveryEvents.$inferInsert, "caseId">;

/**
 * Uma recuperação de equipamento com a trilha que as transições REAIS
 * deixariam (`createRecoveryCase`/`updateRecoveryCase`/`addRecoveryAttempt`/
 * `validateRecoverySignal`/`expireRecoveryCases`, equipment.storage.ts):
 * `caso_criado` + tentativas + `status_alterado`, e `bureauStatus`/`closedAt`
 * como aquelas funções gravam. 3 a 6 eventos por caso, todos entre o corte
 * e agora. A conversa (quando há) entra como a tentativa pelo WhatsApp e a
 * nota com `origem: "chat_integrado"` — o formato de `registrarEventoDoChat`.
 */
function recuperacaoPlanejada(
  providerId: number,
  adminId: number,
  status: RecoveryCaseStatus,
  ids: { customerId: number; equipmentId: number },
  cortadoEm: Date,
  conversa: ConversaPlanejada | undefined,
  agora: Date,
): { caso: LinhaDaRecuperacao; eventos: LinhaDoEventoDeRecuperacao[] } {
  const depoisDoCorte = (dias: number) => new Date(cortadoEm.getTime() + dias * DIA_MS);
  const deadlineAt = calcularPrazoRetirada(cortadoEm);
  const criadoEm = depoisDoCorte(1);
  const eventos: LinhaDoEventoDeRecuperacao[] = [
    { providerId, userId: adminId, type: "caso_criado", toStatus: "pre_recuperacao", occurredAt: criadoEm },
  ];
  const caso: LinhaDaRecuperacao = {
    providerId,
    equipmentId: ids.equipmentId,
    customerId: ids.customerId,
    status,
    terminationDate: cortadoEm,
    deadlineAt,
    createdById: adminId,
    createdAt: criadoEm,
  };

  switch (status) {
    case "pre_recuperacao":
      break;
    case "agendado":
      Object.assign(caso, { scheduledAt: new Date(agora.getTime() + 2 * DIA_MS), assignedToUserId: adminId, collectionMethod: "retirada" });
      eventos.push({ providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "agendado", notes: "Retirada agendada com o titular", occurredAt: depoisDoCorte(20) });
      break;
    case "nova_tentativa":
      Object.assign(caso, { assignedToUserId: adminId, collectionMethod: "retirada" });
      eventos.push(
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "agendado", occurredAt: depoisDoCorte(3) },
        { providerId, userId: adminId, type: "tentativa", channel: "presencial", result: "ausente_horario_confirmado", occurredAt: depoisDoCorte(5) },
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "agendado", toStatus: "nova_tentativa", occurredAt: depoisDoCorte(5) },
      );
      break;
    case "notificacao_formal": {
      const notificadoEm = depoisDoCorte(10);
      Object.assign(caso, {
        priority: "alta",
        proofReference: `OS de instalação ${ids.equipmentId}`,
        customerNotifiedAt: notificadoEm,
        notificationProtocol: `NOT-${providerId}-${ids.customerId}`,
      });
      eventos.push(
        { providerId, userId: adminId, type: "tentativa", channel: "presencial", result: "recusa_expressa", notes: "Titular recusou a devolução", occurredAt: depoisDoCorte(6) },
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "notificacao_formal", occurredAt: notificadoEm },
      );
      break;
    }
    case "contestado": {
      // Com conversa, a contestação nasce DELA — o titular responde no WhatsApp
      // que já devolveu, e só então o caso vira contestado. Contestado antes da
      // conversa seria impossível no produto: a ponte recusa abrir contato em
      // caso contestado (`iniciarContatoDaRecuperacao`).
      const contestadoEm = conversa
        ? new Date((conversa.abertaEm.getTime() + conversa.ultimoEventoEm.getTime()) / 2)
        : depoisDoCorte(7);
      Object.assign(caso, { bureauStatus: "contestado_bloqueado", disputedAt: contestadoEm, disputeReason: "Titular afirma ter devolvido o equipamento na loja" });
      eventos.push({ providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "contestado", occurredAt: contestadoEm });
      break;
    }
    case "concluido":
      Object.assign(caso, { bureauStatus: "resolvido", closedAt: depoisDoCorte(5), scheduledAt: depoisDoCorte(5), assignedToUserId: adminId, collectionMethod: "retirada" });
      eventos.push(
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "agendado", occurredAt: depoisDoCorte(3) },
        { providerId, userId: adminId, type: "tentativa", channel: "presencial", result: "contato_confirmado", occurredAt: depoisDoCorte(5) },
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "agendado", toStatus: "concluido", notes: "Equipamento recolhido para triagem", occurredAt: depoisDoCorte(5) },
      );
      break;
    case "baixado_economico":
      Object.assign(caso, { bureauStatus: "resolvido", closedAt: depoisDoCorte(20) });
      eventos.push(
        { providerId, userId: adminId, type: "tentativa", channel: "whatsapp", result: "sem_resposta", occurredAt: depoisDoCorte(10) },
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "baixado_economico", notes: "Custo da retirada acima do valor residual do equipamento", occurredAt: depoisDoCorte(20) },
      );
      break;
    case "prazo_expirado": {
      const expiradoEm = new Date(deadlineAt.getTime() + DIA_MS);
      Object.assign(caso, { bureauStatus: "expirado", closedAt: expiradoEm });
      eventos.push(
        { providerId, userId: adminId, type: "tentativa", channel: "telefone", result: "sem_resposta", occurredAt: depoisDoCorte(15) },
        { providerId, userId: null, type: "prazo_expirado", fromStatus: "pre_recuperacao", toStatus: "prazo_expirado", occurredAt: expiradoEm },
      );
      break;
    }
    default:
      throw new Error(`recuperacaoPlanejada: status sem roteiro — ${status}`);
  }

  if (conversa) {
    const doBot = conversa.status === "BOT";
    const metadata = { origem: "chat_integrado", conversationId: conversa.conversationId };
    eventos.push(
      { providerId, userId: doBot ? null : adminId, type: "tentativa", channel: "whatsapp", result: doBot ? "sem_resposta" : "contato_confirmado", metadata, occurredAt: conversa.abertaEm },
      { providerId, userId: doBot ? null : adminId, type: "nota", channel: "whatsapp", notes: NOTA_DO_CHAT_POR_STATUS[conversa.status], metadata, occurredAt: conversa.ultimoEventoEm },
    );
  }

  // O sinal de bureau só nasce validado se a regra REAL aceitar com as
  // tentativas que acabaram de ser semeadas — nunca carimbado à mão.
  if (status === "notificacao_formal") {
    const validacao = validarSinalBureau({
      deadlineAt,
      proofReference: caso.proofReference,
      customerNotifiedAt: caso.customerNotifiedAt,
      disputedAt: caso.disputedAt,
      attemptResults: eventos.filter((e) => e.type === "tentativa").map((e) => e.result ?? null),
      now: agora,
    });
    if (validacao.ok) {
      const validadoEm = new Date(caso.customerNotifiedAt!.getTime() + DIA_MS);
      Object.assign(caso, { evidenceValidatedAt: validadoEm, evidenceValidatedById: adminId, bureauStatus: "ativo_validado" });
      eventos.push({ providerId, userId: adminId, type: "sinal_validado", metadata: { notificationProtocol: caso.notificationProtocol ?? null }, occurredAt: validadoEm });
    }
  }

  caso.updatedAt = eventos.reduce((max, e) => (e.occurredAt! > max ? e.occurredAt! : max), criadoEm);
  return { caso, eventos };
}

/**
 * O contato e a nota que a conversa deixa na linha do tempo do caso de
 * cobrança — `tipo: "contato"` (canal whatsapp) na abertura e `nota` no último
 * evento, os dois com o metadata de `registrarEventoDoChat`. O resultado do
 * contato acompanha o card: acordo é promessa, negativado recusou, conversa
 * só do robô ainda não teve resposta.
 */
function eventosDoChatNaCobranca(
  providerId: number,
  adminId: number,
  caso: { id: number; customerId: number; status: string },
  conversa: ConversaPlanejada,
): InsertCobrancaEvento[] {
  const doBot = conversa.status === "BOT";
  const metadata = { origem: "chat_integrado", conversationId: conversa.conversationId };
  const resultado = doBot ? null : caso.status === "acordo_ativo" ? "promessa_pagamento" : caso.status === "negativado" ? "recusou" : "falou";
  const base = { providerId, casoId: caso.id, customerId: caso.customerId, userId: doBot ? null : adminId, canal: "whatsapp", metadata };
  return [
    { ...base, tipo: "contato", resultado, notas: "Conversa aberta pelo WhatsApp integrado", ocorridoEm: conversa.abertaEm },
    { ...base, tipo: "nota", notas: NOTA_DO_CHAT_POR_STATUS[conversa.status], ocorridoEm: conversa.ultimoEventoEm },
  ];
}

/**
 * O evento que cada mudança de status deixa na linha do tempo do caso, no
 * formato da rota: o tipo de `eventoDaTransicaoDeCaso`, `metadata { de, para }`
 * e o canal nulo de `registrarEventoDeCobranca` (PATCH do caso,
 * cobranca.routes.ts). Até 12/09/2026 os casos semeados tinham status e
 * `statusDesde`, mas nenhuma transição: a linha do tempo dizia "negativado
 * desde" sem a "Negativação" e, pior, propor e cancelar um parcelamento no
 * negativado o devolvia a "aberto" na frente do visitante, porque
 * `statusDeFundoDoCaso` (cobranca.storage.ts) só reconhece o negativado pelo
 * evento `negativacao`, e a máquina de estados proíbe essa volta.
 *
 * O caminho é o que a conversa conta (`statusDesdeComContato`): negativado
 * ANTES do contato, então saiu da fila; negociando depois do contato; acordo
 * pela proposta no meio da conversa e o aceite no último evento. Sem conversa,
 * o caso saiu direto da fila. Cada degrau passa por `transicaoDeCaso`: um plano
 * que peça transição recusada pelo produto falha alto aqui.
 */
function eventosDaTransicaoNaCobranca(
  providerId: number,
  adminId: number,
  caso: { id: number; customerId: number; status: StatusDeCaso; statusDesde: Date },
  conversa: ConversaPlanejada | undefined,
): InsertCobrancaEvento[] {
  const meioDaConversa = conversa && new Date((conversa.abertaEm.getTime() + conversa.ultimoEventoEm.getTime()) / 2);
  const degraus: Array<{ de: StatusDeCaso; para: StatusDeCaso; em: Date }> = [];
  if (caso.status === "negativado") {
    degraus.push({ de: "aberto", para: "negativado", em: caso.statusDesde });
  } else if (caso.status === "negociando") {
    degraus.push({ de: conversa ? "em_contato" : "aberto", para: "negociando", em: caso.statusDesde });
  } else if (caso.status === "acordo_ativo") {
    if (meioDaConversa) degraus.push({ de: "em_contato", para: "negociando", em: meioDaConversa });
    degraus.push({ de: meioDaConversa ? "negociando" : "aberto", para: "acordo_ativo", em: caso.statusDesde });
  }
  return degraus.map(({ de, para, em }) => {
    const tipo = eventoDaTransicaoDeCaso(de, para);
    if (!transicaoDeCaso(de, para).ok || !tipo) {
      throw new Error(`eventosDaTransicaoNaCobranca: ${de} -> ${para} no caso ${caso.id} nao e transicao com evento na maquina de estados`);
    }
    return { providerId, casoId: caso.id, customerId: caso.customerId, userId: adminId, tipo, canal: null, metadata: { de, para }, ocorridoEm: em };
  });
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
      // Zero, e não SALDO_INICIAL: o painel soma os dois bolsos — ver o
      // comentário de `SALDO_INICIAL`.
      spcCredits: 0,
      // Rodada de correção (Tarefa 6): sem isto o modo "Rede" do mapa de
      // calor manda o visitante configurar as próprias cidades antes de
      // mostrar qualquer coisa — numa demonstração sem tela para isso.
      cidadesAtendidas: CIDADES_DO_MUNDO_BASE,
      // A chave da busca regional (`getProvidersByMesoregion`). Sem ela o
      // sandbox não estava na região de ninguém, e o card "Provedores
      // parceiros" do painel mostrava zero — medido no ar em 12/09/2026.
      mesorregioes: [MESORREGIAO_DO_MUNDO_BASE],
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

    // Política com custos e preço por plano: sem ela a Economia de TODA ficha
    // 360 abria pendente. Demais colunas no default do schema.
    await tx.insert(cobrancaPolitica).values({ providerId: provider.id, economia: ECONOMIA_DA_DEMO, pausada: false });

    const entradas = planoDeIndicesDoSandbox();
    const indicePorCursor = new Map(entradas.map((e, i) => [e.cursor, i]));

    const linhasClientes = entradas.map((e) => linhaDoCliente(provider.id, e, agora));
    const idsClientes = await inserirClientesEmBlocos(tx, linhasClientes);
    const cursorPorCliente = new Map(entradas.map((e, k) => [idsClientes[k], e.cursor]));

    const linhasFaturas: InsertInvoice[] = [];
    const linhasEquipamentos: InsertEquipment[] = [];
    /** Posição em `entradas` de cada linha de `linhasEquipamentos`, para casar o `equipment.id` devolvido com o cliente. */
    const entradaDoEquipamento: number[] = [];
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
      if (equip) {
        linhasEquipamentos.push(linhaDoEquipamento(provider.id, customerId, entrada, equip));
        entradaDoEquipamento.push(k);
      }
    }

    await inserirFaturasEmBlocos(tx, linhasFaturas);
    const idsEquipamentos = await inserirEquipamentosEmBlocos(tx, linhasEquipamentos);

    const conversas = conversasPlanejadas(provider.id, agora);

    const casos = [
      ...casosDoKanban(provider.id, entradas, idsClientes, linhasClientes, indicePorCursor, agora),
      ...casosVivosDeExCliente(provider.id, entradas, idsClientes, linhasClientes, indicePorCursor, agora),
    ];
    // O índice único parcial do banco (`cobranca_casos_um_aberto_por_cliente`)
    // derrubaria a transação inteira com um erro cru; aqui a deriva aparece
    // com o nome do defeito.
    const clientesComCasoVivo = casos.filter((c) => !casoFechado(c.status ?? "aberto")).map((c) => c.customerId);
    if (new Set(clientesComCasoVivo).size !== clientesComCasoVivo.length) {
      throw new Error("tentarCriarSandbox: dois casos de cobranca vivos para o mesmo cliente");
    }
    aplicarLinhaDoTempo(casos, cursorPorCliente, conversas, agora);
    const idsCasos = (await tx.insert(cobrancaCasos).values(casos).returning({ id: cobrancaCasos.id })).map((r) => r.id);

    const recuperacoes = entradaDoEquipamento.flatMap((k, i) => {
      const status = recuperacaoDaEntrada(entradas[k]);
      if (!status) return [];
      const conversa = conversas.find((c) => c.origem === "equipamentos" && c.cursor === entradas[k].cursor);
      return [recuperacaoPlanejada(
        provider.id, user.id, status,
        { customerId: idsClientes[k], equipmentId: idsEquipamentos[i] },
        cortadoEmDaEntrada(entradas[k], agora)!, conversa, agora,
      )];
    });
    const idsRecuperacoes = (await tx.insert(equipmentRecoveryCases).values(recuperacoes.map((r) => r.caso)).returning({ id: equipmentRecoveryCases.id })).map((r) => r.id);
    await tx.insert(equipmentRecoveryEvents).values(
      recuperacoes.flatMap((r, i) => r.eventos.map((e) => ({ ...e, caseId: idsRecuperacoes[i] }))),
    );

    const alertas = alertasAntiFraudeDoSandbox(provider.id, entradas, idsClientes, indicePorCursor, provedoresDoMundoBase);
    await tx.insert(antiFraudAlerts).values(alertas);

    // A integração "pronta" que a tela de Conversas exige. Os identificadores
    // são os do chat simulado da demonstração — nenhum aponta para o Chat
    // BullQ de verdade.
    await tx.insert(chatBullqIntegracoes).values({
      providerId: provider.id,
      organizationId: `demo-org-${provider.id}`,
      slug: subdomain,
      ownerEmail: emailDoAdminDaDemo(subdomain),
      canalId: CANAL_DO_CHAT_DA_DEMO,
      canalNome: "WhatsApp da Demonstração",
      status: "ativo",
    });

    // A linha do tempo da cobrança: a transição de cada caso que saiu da fila,
    // e logo abaixo o contato e a nota de cada conversa.
    const eventosDaCobranca: InsertCobrancaEvento[] = [];
    const casoVivoPorCursor = new Map<number, { id: number; customerId: number; status: string }>();
    casos.forEach((c, i) => {
      const status = (c.status ?? "aberto") as StatusDeCaso;
      if (casoFechado(status)) return;
      const cursor = cursorPorCliente.get(c.customerId)!;
      casoVivoPorCursor.set(cursor, { id: idsCasos[i], customerId: c.customerId, status });
      const conversa = conversas.find((x) => x.origem === "cobranca" && x.cursor === cursor);
      eventosDaCobranca.push(...eventosDaTransicaoNaCobranca(provider.id, user.id, { id: idsCasos[i], customerId: c.customerId, status, statusDesde: c.statusDesde! }, conversa));
    });
    const recuperacaoPorCursor = new Map<number, number>();
    recuperacoes.forEach((r, i) => {
      if (!r.caso.closedAt) recuperacaoPorCursor.set(cursorPorCliente.get(r.caso.customerId)!, idsRecuperacoes[i]);
    });

    const linhasConversas: InsertChatBullqConversa[] = [];
    for (const conversa of conversas) {
      const k = indicePorCursor.get(conversa.cursor)!;
      const caso = conversa.origem === "cobranca" ? casoVivoPorCursor.get(conversa.cursor) : undefined;
      const recuperacaoId = conversa.origem === "equipamentos" ? recuperacaoPorCursor.get(conversa.cursor) : undefined;
      if (conversa.origem === "equipamentos" && recuperacaoId === undefined) {
        throw new Error(`tentarCriarSandbox: conversa de equipamento sem recuperacao aberta no cursor ${conversa.cursor}`);
      }
      linhasConversas.push({
        providerId: provider.id,
        customerId: idsClientes[k],
        casoId: caso?.id ?? null,
        recuperacaoId: recuperacaoId ?? null,
        origem: conversa.origem,
        conversationId: conversa.conversationId,
        canalId: CANAL_DO_CHAT_DA_DEMO,
        abertaPorUserId: user.id,
        status: conversa.status,
        abertaEm: conversa.abertaEm,
        ultimoEventoEm: conversa.ultimoEventoEm,
        createdAt: conversa.abertaEm,
      });
      if (caso) eventosDaCobranca.push(...eventosDoChatNaCobranca(provider.id, user.id, caso, conversa));
    }
    await tx.insert(chatBullqConversas).values(linhasConversas);
    await tx.insert(cobrancaEventos).values(eventosDaCobranca);

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
 * daquela função — mais o DELTA que só o sandbox precisa: 28 tabelas com FK
 * para `providers` que `deleteProvider` não conhece, ou conhece só por um
 * dos dois lados (`server/storage/providers.storage.ts:190-226` foi lido
 * inteiro antes de escrever isto; ela NÃO aceita executor de transação —
 * chama `db`/`db.select`/`db.delete` direto, sem parâmetro — por isso roda
 * fora da transação do delta, por conta própria).
 *
 * O universo de "tabelas com FK para providers" é conferido CONTRA O SCHEMA
 * pelo teste (`sandbox.service.test.ts`, "a limpeza cobre toda tabela com FK
 * para providers"), que deriva a lista via `getTableConfig` em vez de uma
 * enumeração solta, **sem exceção nenhuma** — 42 tabelas, 45 pares, contando
 * `shared/schema-cobranca-faturas.ts` e `shared/chat-autonomia-seguranca.ts`,
 * que `@shared/schema` não reexporta — se uma
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
    // Pré-avisos e quitações apontam para `customers`/`invoices`, que só
    // `deleteProvider` apaga — por isso entram aqui, antes dela.
    await tx.delete(cobrancaPreAvisos).where(eq(cobrancaPreAvisos.providerId, providerId));
    await tx.delete(cobrancaQuitacoes).where(eq(cobrancaQuitacoes.providerId, providerId));
    await tx.delete(chatAutonomiaAutorizacao).where(eq(chatAutonomiaAutorizacao.providerId, providerId));
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
    // A FK composta para a conversa tem ON DELETE CASCADE, mas a coluna
    // `provider_id` não: apagar explícito antes da conversa não depende do
    // cascade e mantém a regra "toda tabela com FK para providers aparece aqui".
    await tx.delete(chatAutonomiaSeguranca).where(eq(chatAutonomiaSeguranca.providerId, providerId));
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

  // O que o visitante fez no chat simulado (mensagens, conversas novas,
  // agentes) vive na memória do processo, não no banco — a transação acima não
  // o alcança. Só depois de o provedor sumir de verdade: se o delete lançar, a
  // varredura seguinte tenta de novo e o sandbox, ainda de pé, não perde o chat.
  limparChatSimuladoDoProvedor(providerId);
}
