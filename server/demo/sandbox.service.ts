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
 * Clientes e faturas, as duas escritas grandes, vão por coluna
 * (`inserirPorColunas`, Leva 2 fase B): com as faturas históricas, montar o
 * `INSERT ... VALUES` no Drizzle virou o maior custo da criação.
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
import { and, eq, getTableColumns, inArray, is, sql, SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
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
  providerPartners,
  erpSyncLogs,
  creditOrders,
  ispConsultations,
  spcConsultations,
  users,
} from "@shared/schema";
import type {
  InsertCustomer,
  InsertInvoice,
  InsertEquipment,
  InsertCobrancaCaso,
  InsertCobrancaEvento,
  InsertChatBullqConversa,
  EconomiaDaPolitica,
  AcordoDaPolitica,
} from "@shared/schema";
import { cobrancaPreAvisos, cobrancaQuitacoes } from "@shared/schema-cobranca-faturas";
import { chatAutonomiaAutorizacao, chatAutonomiaSeguranca } from "@shared/chat-autonomia-seguranca";
import { storage } from "../storage";
import { emailCanonico } from "../storage/users.storage";
import { carteiraDoStatusErp } from "../storage/cobranca.storage";
import { hashPassword } from "../password";
import { pessoaFicticia } from "./pessoas-ficticias";
import { PROVEDORES_DA_DEMO, INDICES_COMPARTILHADOS, MESORREGIAO_DO_MUNDO_BASE, complementarMundoBase, semearMundoBase, linhaDaIntegracao } from "./mundo-base";
import { STATUS_DE_CASO, casoFechado, eventoDaTransicaoDeCaso, statusAposContato, transicaoDeCaso, type Carteira, type StatusDeCaso } from "@shared/cobranca/estados";
import { etapaParaAtraso, prescrita, type EtapaId } from "@shared/cobranca/regua";
import { ACORDO_PADRAO } from "@shared/cobranca/acordo";
import { POLITICA_PADRAO, validarPolitica } from "@shared/cobranca/politica";
import { janelaDoChat } from "@shared/cobranca/automacao-chat";
import {
  DIVIDA_MINIMA_PARA_CASO,
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
import { AGENTES_DA_DEMO, agenteConfigDaDemo, limparChatSimuladoDoProvedor, roteiroDaConversa, type LinhaDaConversa } from "./chat-simulado";
import { MESES_DE_HISTORICO_REDUZIDO, faturasHistoricasDoSandbox, type ClienteDoHistorico, type ContatoDoHistorico, type RecuperacaoDaDemo } from "./semeadura-faturas";
import { eventosDaNegociacao, primeiraNegativacaoPermitida, trilhaDosCasos, type CasoDaTrilha, type PoliticaDaTrilha } from "./semeadura-negociacoes";
import { alertasExtrasDoSandbox, consultasDoSandbox, regrasAntiFraudeDaDemo, type ClienteDaConsulta, type ClienteDaRede, type ConsultaDaRede } from "./semeadura-consultas";
import {
  documentosDaDemo,
  fichaDoProvedorDaDemo,
  integracaoErpSincronizada,
  logsDeSyncDaDemo,
  pedidosDeCreditoDaDemo,
  sociosDaDemo,
  usuariosExtrasDaDemo,
} from "./semeadura-ficha";

/** O que uma transação de verdade e o `pg-proxy` de teste têm em comum. Ver o mesmo tipo em `mundo-base.ts`. */
type Executor = Pick<typeof db, "insert" | "select" | "delete" | "update" | "execute">;

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
/** Um em cada três inadimplentes ativos com a ONU em comodato (75) — ver `equipamentoDaEntrada`. */
const INADIMPLENTE_COM_COMODATO_A_CADA = 3;

const IDADES_DE_VENCIMENTO_REPRESENTATIVAS = [10, 45, 120, 300, 20, 60, 90, 150, 250];
const VALORES_DE_PLANO = [79.9, 99.9, 119.9, 149.9, 199.9];
/** Mesmo índice de `VALORES_DE_PLANO` — ver a mesma constante em `mundo-base.ts`. */
const NOMES_DE_PLANO = ["Fibra 200 Mega", "Fibra 300 Mega", "Fibra 500 Mega", "Fibra 600 Mega", "Fibra 800 Mega"];
const TENURE_MESES_REPRESENTATIVOS = [2, 5, 9, 14, 20, 28, 36, 48, 60, 84];
const RECENCIA_CANCELAMENTO_DIAS = [30, 60, 90, 150, 210, 365];

/**
 * Leva 2 (auditoria de telas, rodada 2): as saídas DEVIDAS só tinham 60, 150 e
 * 365 dias — as posições ímpares de `RECENCIA_CANCELAMENTO_DIAS` —, e a régua do
 * ex-cliente nunca tinha ninguém no lembrete (D+1..14) nem na dívida antiga
 * (D+180..359); o card de prejuízo, que abre no mês corrente, abria R$ 0,00.
 *
 * Só mudam as posições a partir de `CANCELADOS_COM_EQUIPAMENTO_RETIDO`: nelas
 * não há ONU, recuperação nem conversa, então a idade nova não mexe no sinal de
 * bureau da notificação formal, nas trilhas das recuperações nem nos roteiros do
 * chat, que moram nas posições abaixo de 30. Uma idade por etapa do ex-cliente,
 * em ciclo; `null` é a coorte que venceu no mês corrente
 * (`diasDaSaidaNoMesCorrente`), que também cai no lembrete.
 */
const RECENCIA_DA_SAIDA_DEVIDA_SEM_EQUIPAMENTO_DIAS: ReadonlyArray<number | null> = [null, 60, 150, 240, 365];

/**
 * Duas recuperações abertas com o prazo de 60 dias quase no fim, por posição —
 * sem elas o KPI "prazo crítico" (<= 10 dias, `recovery-board.service.ts`) e a
 * coluna "31 a 60 dias" nasciam zerados. Nenhuma das duas tem sinal de bureau: a
 * notificação formal (posição 18) segue na coorte de 30 dias, o único jeito de o
 * sinal passar em `validarSinalBureau`.
 */
const DIAS_DESDE_O_CORTE_NO_FIM_DO_PRAZO: ReadonlyMap<number, number> = new Map([[0, 52], [12, 55]]);

/**
 * As cidades que o mundo base atende (`PROVEDORES_DA_DEMO`, deduplicadas:
 * Londrina aparece em rede-1 e rede-5). O sandbox nasce SEM
 * `cidadesAtendidas` nem `addressState` (rodada de correção, Tarefa 6,
 * 11/09/2026) — sem eles o modo "Rede" do mapa de calor manda o visitante
 * configurar as cidades do PRÓPRIO provedor antes de mostrar qualquer coisa,
 * numa demonstração que não tem onde clicar para configurar.
 *
 * No formato que a tela de Regionalização grava, "Cidade - UF" (Leva 2): o
 * `PUT /api/regional/cidades` recusava a lista semeada com 400, e a busca de
 * cidades oferecia "Londrina - PR" de novo ao lado de "Londrina". Os leitores
 * tiram o sufixo (`normalizarCidade`, area-atendida.ts). As quatro são do PR.
 */
const CIDADES_DO_MUNDO_BASE = Array.from(new Set(PROVEDORES_DA_DEMO.map((p) => `${p.cidade} - PR`)));

/**
 * Status de ONU retida SEM recuperação, no vocabulário atual
 * (`EQUIPMENT_STATUSES`, equipment-recovery-rules.ts). Até a Leva 2 a lista
 * incluía `retido`, `em_cobranca` e `not_returned`, legados de importação
 * antiga que o produto não grava mais.
 */
const STATUS_DE_EQUIPAMENTO_RETIDO = ["retirada_pendente", "nao_localizado"] as const;
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
 * O cliente do caso "baixado" do kanban (`casosDoKanban`). Saiu devendo como
 * qualquer ex-cliente em posição ímpar, mas a dívida NÃO vai para o cliente:
 * baixar é exatamente o admin tirar a dívida da cobrança, e um card "baixado"
 * apontando para alguém que ainda deve seria a régua reabrindo o caso na
 * primeira passada. A fatura de saída dele nasce `baixada_no_erp` (Leva 2 —
 * ver `linhaDaFaturaDeSaida`).
 */
const CURSOR_DO_CASO_BAIXADO = INADIMPLENTES_POR_SANDBOX + 1;

/**
 * O cliente do caso "pago" do kanban: o segundo em dia exclusivo (o primeiro,
 * cursor 375, é o chip "limpo" de `cpfsDeExemplo`). Leva 2: o caso morava num
 * inadimplente com a fatura ainda vencida — o cliente sumia da lista da
 * carteira, o cabeçalho (1.349) brigava com o KPI (1.350) e o detalhe do caso
 * mostrava dívida num card pago. Ver `linhaDaFaturaDoCasoPago`.
 */
const CURSOR_DO_CASO_PAGO = INADIMPLENTES_POR_SANDBOX + CANCELADOS_POR_SANDBOX + 1;
/** Quantos dias a fatura do caso "pago" ficou vencida até ser paga hoje. */
const DIAS_DE_ATRASO_DO_CASO_PAGO = 12;

/**
 * O inadimplente que mora no mesmo imóvel do cliente do chip "devendo na rede"
 * (o primeiro compartilhado, cursor 1.350: `cpfsDeExemplo` pega o cliente em
 * dia com o primeiro CPF de `CPFS_COMPARTILHADOS`). Sem ele o cruzamento de endereço da consulta
 * (`getCustomersByAddressForAlert`) nunca acendia na demonstração. Muda o
 * imóvel do INADIMPLENTE, nunca o do chip: o CPF compartilhado é a mesma pessoa
 * na rede, e o endereço dela precisa bater nos dois provedores.
 */
const CURSOR_DO_VIZINHO_DO_DEVENDO_NA_REDE = 30;

/**
 * As etapas em que a política da demonstração nomeia o administrador como
 * responsável — a negociação e a pré-negativação, onde a decisão é de gente; as
 * outras ficam com "qualquer operador". Só o responsável: a janela de cada etapa
 * é a do catálogo, e é por ela que os cards semeados já estão onde a régua os
 * deixaria.
 */
const ETAPAS_DO_ADMINISTRADOR_DA_DEMO = ["negociacao_recuperacao", "pre_negativacao"] as const;

/**
 * A política de acordo padrão com a origem da cobrança `manual` nas duas
 * carteiras (Leva 2). `nao_definida` só autoriza o valor integral à vista
 * (`chat-autonomia-negociacao.service.ts`) e contradizia os cards negociando e
 * com acordo que a própria semeadura mostra. `manual` é origem disponível
 * (`ORIGEM_INDISPONIVEL`, shared/cobranca/acordo.ts, só recusa `erp`).
 */
function acordoDaDemo(): AcordoDaPolitica {
  return {
    ativo: { ...ACORDO_PADRAO.ativo, origemDaCobranca: "manual" },
    ex_cliente: { ...ACORDO_PADRAO.ex_cliente, origemDaCobranca: "manual" },
  };
}

/**
 * A política da demonstração em duas formas: a `gravada` (o que vai para
 * `cobranca_politica`; as outras colunas ficam no default do schema) e a `lida`,
 * que é o que a régua e a trilha dos casos enxergam dessa linha — a mesma
 * validação de `politicaDoProvedor`, com os padrões no lugar das colunas não
 * gravadas. A trilha (`trilhaDosCasos`) e o negativado precisam da LIDA: uma
 * política montada à parte poderia divergir da que a régua lê amanhã.
 */
function politicaDaDemo(adminId: number) {
  const gravada = {
    economia: ECONOMIA_DA_DEMO,
    etapas: ETAPAS_DO_ADMINISTRADOR_DA_DEMO.map((id) => ({ id, responsavelUserId: adminId })),
    acordo: acordoDaDemo(),
    pausada: false,
  };
  const lida = validarPolitica({ ...POLITICA_PADRAO, ...gravada });
  if (!lida.ok) throw new Error(`politicaDaDemo: a politica da demonstracao nao passa na validacao do produto — ${lida.erros.join("; ")}`);
  return { gravada, lida: lida.politica };
}

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
 * ONU retida (0..29). Os abertos ficam na coorte de 30 dias
 * (`RECENCIA_CANCELAMENTO_DIAS[pos % 6] === 30`), com o prazo regulatório de
 * 60 dias ainda correndo — é o único jeito de o sinal de bureau do caso em
 * notificação formal passar em `validarSinalBureau` —, exceto 0 e 12, com o
 * prazo quase no fim (`DIAS_DESDE_O_CORTE_NO_FIM_DO_PRAZO`). Concluídos saíram
 * há 60 dias (dois deles recolhidos neste mês,
 * `RECUPERACOES_CONCLUIDAS_NO_ULTIMO_MES`); baixados e expirados, há 90 (prazo
 * vencido há 30).
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

/**
 * Duas das quatro concluídas foram recolhidas NESTE mês, por posição — o KPI
 * "recuperados 30 d" da tela de Recuperação nascia zerado (as quatro fechavam
 * cinco dias depois do corte, há 55 dias). Mesmo corte de 60 dias; a retirada é
 * que veio depois, ainda dentro do prazo.
 */
const RECUPERACOES_CONCLUIDAS_NO_ULTIMO_MES: ReadonlySet<number> = new Set([7, 13]);
const DIAS_DO_CORTE_A_RETIRADA = 5;
const DIAS_DO_CORTE_A_RETIRADA_NO_ULTIMO_MES = 40;

/**
 * Os devedores que PAGARAM nos últimos 30 dias (Leva 2, fase B): três ativos e
 * três ex-clientes, por cursor, com a idade do contato que antecedeu o
 * pagamento. Sem eles o "Recuperado 30 d" da carteira e o da esteira
 * (`recuperacaoAposContato`) nasciam sem base. Quem decide o mecanismo (baixa no
 * ERP ou quitação conferida) e a data do pagamento é `faturasHistoricasDoSandbox`.
 *
 * Nenhum tem conversa, recuperação de equipamento nem o imóvel do chip
 * "devendo na rede": quem pagou teve o caso fechado, e uma conversa ativa num
 * caso fechado seria a demonstração se contradizendo. Alerta, só o de antes do
 * pagamento: os ativos são pessoas da rede (`inadimplenteComCpfDaRede`), e uma
 * consulta de provedor da rede entre o vencimento e o pagamento vira o aviso
 * "pagou depois" — a foto com a dívida, a situação de hoje em dia. O contato é por telefone,
 * registrado pelo administrador. Ativos com 120, 60 e 150 dias de atraso; ex-clientes
 * nas posições ímpares acima de 30 (saída devida sem ONU) de 60, 150 e 240 dias —
 * sempre mais velhos que o contato, que só cobra dívida já vencida.
 */
const RECUPERACOES_DOS_ULTIMOS_30_DIAS: ReadonlyArray<{ cursor: number; diasDesdeOContato: number }> = [
  { cursor: 11, diasDesdeOContato: 4 },
  { cursor: 14, diasDesdeOContato: 11 },
  { cursor: 16, diasDesdeOContato: 19 },
  { cursor: INADIMPLENTES_POR_SANDBOX + 33, diasDesdeOContato: 6 },
  { cursor: INADIMPLENTES_POR_SANDBOX + 35, diasDesdeOContato: 13 },
  { cursor: INADIMPLENTES_POR_SANDBOX + 37, diasDesdeOContato: 22 },
];

/**
 * A partir desta posição o inadimplente é uma PESSOA DA REDE — a identidade de
 * um CPF compartilhado, como os 150 em dia (`personaIndexOverride`).
 *
 * Revisão da fase B (13/09/2026): o alerta de fuga só existe porque um
 * provedor da rede consultou o CPF, e o mundo base só consulta CPF
 * compartilhado (uma consulta de provedor base sobre CPF exclusivo sobreviveria
 * ao sandbox). Com todos os devedores exclusivos, o Anti-Fraude fingia a
 * consulta — "consultado por 3 provedores" com o 360 contando zero. As
 * primeiras posições continuam exclusivas: o kanban e as conversas (0 a 10) e
 * o vizinho do chip (`CURSOR_DO_VIZINHO_DO_DEVENDO_NA_REDE`), e é deles que a
 * Consulta ISP semeada tira o devedor que só este provedor conhece. Os ativos
 * da recuperação dos últimos 30 dias também são da rede: é o aviso de antes do
 * pagamento.
 */
const PRIMEIRO_INADIMPLENTE_COM_CPF_DA_REDE = 105;

function inadimplenteComCpfDaRede(cursor: number): boolean {
  return cursor >= PRIMEIRO_INADIMPLENTE_COM_CPF_DA_REDE || RECUPERACOES_DOS_ULTIMOS_30_DIAS.some((r) => r.cursor === cursor);
}

/**
 * O caso negativado abriu este tanto de dias antes da conversa: cabem o
 * pré-aviso (na abertura, que já passou de D+90) e os 10 dias úteis até a
 * inscrição (`primeiraNegativacaoPermitida`), com folga para feriado emendado.
 */
const DIAS_DA_ABERTURA_DO_NEGATIVADO_ATE_A_CONVERSA = 30;
/** A inscrição sai às 10h do primeiro dia permitido, não à meia-noite que a função devolve. */
const HORAS_DO_DIA_PERMITIDO_ATE_A_NEGATIVACAO = 10;

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

  // Os inadimplentes com a identidade de uma pessoa da rede (ver
  // `inadimplenteComCpfDaRede`) usam a aresta seguinte à dos 150 em dia: CPFs
  // que nenhum outro cliente do sandbox tem.
  let proximoDaRede = CLIENTES_COMPARTILHADOS_POR_SANDBOX;
  for (let k = 0; k < INADIMPLENTES_POR_SANDBOX; k++) {
    entradas.push({
      cursor: k,
      categoria: "inadimplente",
      posicaoNaCategoria: k,
      ...(inadimplenteComCpfDaRede(k) ? { personaIndexOverride: INDICES_COMPARTILHADOS[proximoDaRede++] } : {}),
    });
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

/** Quando este cliente saiu — só para "cancelado". Função pura: mesma entrada e mesmo `agora`, mesma data sempre. */
function cortadoEmDaEntrada(entrada: EntradaSandbox, agora: Date): Date | null {
  if (entrada.categoria !== "cancelado") return null;
  return subtrairDias(agora, diasDesdeOCorte(entrada, agora));
}

/** A idade da saída por posição — ver `RECENCIA_DA_SAIDA_DEVIDA_SEM_EQUIPAMENTO_DIAS` e `DIAS_DESDE_O_CORTE_NO_FIM_DO_PRAZO`. */
function diasDesdeOCorte(entrada: EntradaSandbox, agora: Date): number {
  const posicao = entrada.posicaoNaCategoria;
  const noFimDoPrazo = DIAS_DESDE_O_CORTE_NO_FIM_DO_PRAZO.get(posicao);
  if (noFimDoPrazo !== undefined) return noFimDoPrazo;
  if (posicao >= CANCELADOS_COM_EQUIPAMENTO_RETIDO && !saidaPaga(entrada)) {
    const ciclo = RECENCIA_DA_SAIDA_DEVIDA_SEM_EQUIPAMENTO_DIAS;
    return ciclo[Math.floor((posicao - CANCELADOS_COM_EQUIPAMENTO_RETIDO) / 2) % ciclo.length] ?? diasDaSaidaNoMesCorrente(agora);
  }
  return RECENCIA_CANCELAMENTO_DIAS[posicao % RECENCIA_CANCELAMENTO_DIAS.length];
}

/**
 * Dias de atraso de uma saída que venceu NO MÊS de `agora` — o período padrão do
 * card de prejuízo. O menor dos dois dias do mês (local e UTC) porque a fatura é
 * lida pelo dia em UTC (`to_char(due_date)`, faturas.storage.ts) e o período
 * pelo relógio local (`periodoDaData`); até 10 dias, dentro do lembrete. No dia 1
 * não há como: vencer hoje ainda não é atraso, e a coorte cai no mês anterior.
 */
function diasDaSaidaNoMesCorrente(agora: Date): number {
  return Math.max(1, Math.min(10, Math.min(agora.getDate(), agora.getUTCDate()) - 1));
}

/**
 * O `motivo_status` cru que o ERP grava no contrato (shared/motivo-corte.ts,
 * medido no SGP): quem saiu devendo a saída foi cortado pelo financeiro; quem a
 * pagou pediu para sair. O cliente do caso "baixado" também saiu devendo — a
 * baixa veio depois.
 */
function motivoDoCorte(entrada: EntradaSandbox): string {
  return saidaPaga(entrada) ? "Administrativo" : "Financeiro";
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
  // Leva 2: o inadimplente ativo também tem a ONU instalada — o 360 dele dizia
  // "nenhum equipamento registrado". Comodato normal: fora do agregado.
  if (entrada.categoria === "inadimplente" && entrada.posicaoNaCategoria % INADIMPLENTE_COM_COMODATO_A_CADA === 1) {
    return { status: STATUS_DE_EQUIPAMENTO_COMODATO, value: VALOR_DO_EQUIPAMENTO, retido: false, emRecuperacao: false };
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

/**
 * A saída cobra o aparelho só quando ele não voltou nem vai voltar: ONU retida
 * sem recuperação, ou recuperação que terminou sem o aparelho (baixa econômica,
 * prazo expirado). Leva 2: até aqui TODA saída cobrava "equipamento 290,00" —
 * de quem nunca teve ONU, de quem a devolveu (recuperação concluída) e de quem
 * tem a retirada aberta, que a Recuperação mostrava como aparelho a buscar
 * depois de pago.
 */
function saidaCobraEquipamento(entrada: EntradaSandbox): boolean {
  if (entrada.categoria !== "cancelado" || entrada.posicaoNaCategoria >= CANCELADOS_COM_EQUIPAMENTO_RETIDO) return false;
  const recuperacao = recuperacaoDaEntrada(entrada);
  return recuperacao === null || (casoEstaEncerrado(recuperacao) && recuperacao !== "concluido");
}

/** Proporcional + multa (+ equipamento, quando cobra) — o valor exato da fatura de saída, um lugar só para fatura e dívida do cliente. */
function valorDaFaturaDeSaida(providerId: number, entrada: EntradaSandbox): number {
  const proporcional = Number((valorMensalidade(indiceDaEntrada(providerId, entrada)) * DIAS_PROPORCIONAL_DE_SAIDA / 30).toFixed(2));
  const equipamento = saidaCobraEquipamento(entrada) ? VALOR_DO_EQUIPAMENTO : 0;
  return Number((MULTA_DE_SAIDA_PADRAO + equipamento + proporcional).toFixed(2));
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
    valor: valorDaFaturaDeSaida(providerId, entrada),
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
  // O imóvel é o da própria pessoa, exceto o do vizinho do chip "devendo na rede"
  // (`CURSOR_DO_VIZINHO_DO_DEVENDO_NA_REDE`), que mora onde mora o chip.
  const moradia = entrada.cursor === CURSOR_DO_VIZINHO_DO_DEVENDO_NA_REDE ? pessoaFicticia(INDICES_COMPARTILHADOS[0]) : pessoa;
  const equip = equipamentoDaEntrada(entrada);
  const cortadoEm = cortadoEmDaEntrada(entrada, agora);
  // O contrato nunca começa depois da fatura que o inadimplente deixou de pagar:
  // no mínimo um mês antes dela. Revisão da fase B (13/09/2026): o tempo de casa
  // contado de hoje deixava 20 ativos com dívida mais velha que o contrato, e o
  // Anti-Fraude dizia "57 dias de contrato" e "145 dias vencidos" no mesmo card.
  const peloTempoDeCasa = subtrairMeses(cortadoEm ?? agora, tenureMeses(indice));
  const umMesAntesDaDivida = entrada.categoria === "inadimplente" ? subtrairMeses(subtrairDias(agora, idadeRepresentativa(entrada.posicaoNaCategoria)), 1) : null;
  const contractStartDate = paraDataSemHora(umMesAntesDaDivida && umMesAntesDaDivida < peloTempoDeCasa ? umMesAntesDaDivida : peloTempoDeCasa);

  const base: InsertCustomer = {
    providerId,
    name: pessoa.nome,
    cpfCnpj: cpf,
    email: pessoa.email,
    phone: pessoa.telefone,
    address: moradia.logradouro,
    addressNumber: moradia.numero,
    neighborhood: moradia.bairro,
    city: moradia.cidade,
    state: moradia.uf,
    cep: moradia.cep,
    latitude: moradia.latitude,
    longitude: moradia.longitude,
    // A coordenada é a do cadastro do ERP da demo — a procedência que o sync grava
    // (erp-sync.service.ts). Nula, o modo Rede do mapa não plotava ninguém
    // (`PRECISAO_CONFIAVEL`, rede-regional.service.ts).
    geoPrecisao: "erp",
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
    ...(cortadoEm ? { cortadoEm, motivoCorte: motivoDoCorte(entrada) } : {}),
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
 * A fatura que o cliente do caso "pago" quitou (`CURSOR_DO_CASO_PAGO`): um
 * cliente em dia que atrasou `DIAS_DE_ATRASO_DO_CASO_PAGO` dias e pagou HOJE, o
 * valor inteiro — o instante do pagamento é o do encerramento do caso.
 */
function linhaDaFaturaDoCasoPago(providerId: number, customerId: number, entrada: EntradaSandbox, agora: Date): InsertInvoice {
  const valor = valorMensalidade(indiceDaEntrada(providerId, entrada)).toFixed(2);
  return {
    customerId,
    providerId,
    value: valor,
    dueDate: subtrairDias(agora, DIAS_DE_ATRASO_DO_CASO_PAGO),
    status: "paid",
    paidDate: agora,
    paidValue: valor,
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-fatura-${customerId}`,
  };
}

/**
 * A fatura de SAÍDA do ex-cliente — mesmo formato que `shared/cobranca/multa.ts`
 * (`parcelasDaDescricao`) lê, no molde de `mundo-base.ts`: sem ela a carteira
 * de ex-clientes do sandbox abriria vazia (Economia, multa, prejuízo). A parcela
 * do equipamento só entra quando a saída o cobra (`saidaCobraEquipamento`).
 */
function linhaDaFaturaDeSaida(providerId: number, customerId: number, entrada: EntradaSandbox, cortadoEm: Date, agora: Date): InsertInvoice {
  const valor = valorDaFaturaDeSaida(providerId, entrada);
  const equipamento = saidaCobraEquipamento(entrada) ? ` + equipamento ${formatarReal(VALOR_DO_EQUIPAMENTO)}` : "";
  const descricao = `Proporcional ${DIAS_PROPORCIONAL_DE_SAIDA} dias + multa ${formatarReal(MULTA_DE_SAIDA_PADRAO)}${equipamento}`;
  const paga = saidaPaga(entrada);
  // O caso "baixado": o admin tirou a dívida da cobrança e a varredura seguinte
  // viu a fatura sumir dos pendentes do ERP — `baixada_no_erp` com `baixadaEm`,
  // como `baixarFaturasSumidas` (faturas.storage.ts) grava. Vencida, ela brigava
  // com o agregado zerado do cliente ("o saldo agregado difere das faturas vencidas").
  const baixada = entrada.cursor === CURSOR_DO_CASO_BAIXADO;

  return {
    customerId,
    providerId,
    value: valor.toFixed(2),
    dueDate: cortadoEm,
    status: paga ? "paid" : baixada ? "baixada_no_erp" : "overdue",
    descricao,
    erpSource: FONTE_ERP_DEMO,
    erpRef: `demo-saida-${customerId}`,
    ...(paga ? { paidDate: cortadoEm, paidValue: valor.toFixed(2) } : {}),
    ...(baixada ? { baixadaEm: agora } : {}),
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

/**
 * INSERT em massa com UM parâmetro por coluna — `insert into t (...) select *
 * from unnest($1::tipo[], ...)` — em vez de um por célula. Medido no banco local
 * (13/09/2026): montar o `INSERT ... VALUES` de 9,6 mil faturas no Drizzle
 * custava ~750 ms só de JavaScript, antes de o banco receber qualquer coisa, e o
 * dos 1.500 clientes ~330 dos ~480 ms do insert.
 *
 * Grava o mesmo que o `values()` do Drizzle: cada célula passa pelo
 * `mapToDriverValue` da coluna; a célula que falta numa linha leva o default
 * literal da coluna (o que o `default` do VALUES aplicaria); a coluna que
 * nenhuma linha traz fica fora da lista e o banco aplica o default dela. Coluna
 * de array e default SQL faltando só em parte das linhas não cabem nessa forma, e
 * falham alto.
 *
 * Sem `returning`: a ordem das linhas devolvidas por um INSERT ... SELECT não é
 * garantida. Quem precisa do id relê pela chave natural (CPF, `erp_ref`).
 */
async function inserirPorColunas(tx: Executor, tabela: PgTable, linhas: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  if (linhas.length === 0) return;
  const colunas = Object.entries(getTableColumns(tabela) as Record<string, PgColumn>).filter(([chave]) => linhas.some((l) => l[chave] !== undefined));
  const listas = colunas.map(([chave, coluna]) => {
    const tipo = coluna.getSQLType();
    if (tipo.endsWith("]")) throw new Error(`inserirPorColunas: a coluna ${chave} e um array, e unnest a achataria`);
    const valores = linhas.map((linha) => {
      let valor = linha[chave];
      if (valor === undefined && coluna.hasDefault) {
        if (is(coluna.default, SQL)) throw new Error(`inserirPorColunas: ${chave} falta em parte das linhas e o default e SQL`);
        valor = coluna.default;
      }
      return valor === undefined || valor === null ? null : coluna.mapToDriverValue(valor);
    });
    return sql`${sql.param(valores)}::${sql.raw(tipo)}[]`;
  });
  const nomes = sql.join(colunas.map(([, coluna]) => sql.identifier(coluna.name)), sql`, `);
  await tx.execute(sql`insert into ${tabela} (${nomes}) select * from unnest(${sql.join(listas, sql`, `)})`);
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
 * Os 5 status vivos — e os 5 casos das conversas de cobrança de ativos,
 * cursores 6..10 — usam clientes que já nasceram inadimplentes
 * (`paymentStatus: "overdue"`); o "pago" usa um cliente em dia que pagou hoje
 * (`CURSOR_DO_CASO_PAGO`, Leva 2); os 3 terminais que fecham o contrato
 * (`cancelamento`, `baixado`, `encerrado`) usam clientes que já nasceram
 * cancelados — nenhum dos 9 toca os clientes de exemplo ("limpo",
 * "devendo_na_rede"), que vivem fora dos cursores usados aqui (0..10,
 * 225..227 e 376).
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
    // A dívida do cliente, e não a mensalidade: a do mês que já venceu soma nela
    // (`dividasDoMes`, semeadura-faturas.ts).
    const divida = Number(linhasClientes[k].totalOverdueAmount ?? 0);
    const valor = divida.toFixed(2);
    const dias = idadeRepresentativa(entrada.posicaoNaCategoria);
    // A mesma entrada que `revisarCaso` usaria: `diasAtraso` = `maxDaysOverdue`
    // do cliente, as faturas abertas, a data do contrato. `diasAtrasoAbertura`
    // sai com o atraso de HOJE e `aplicarLinhaDoTempo` o recua até a abertura.
    const etapa = etapaParaAtraso(dias, "ativo").etapa?.id ?? null;
    const dna = dnaDoCaso({ contractStartDate: linhasClientes[k].contractStartDate ?? null, diasAtraso: dias, faturasAbertas: linhasClientes[k].overdueInvoicesCount ?? 1 }, agora);
    casos.push({
      providerId,
      customerId: idDoCursor(item.cursor),
      status: item.status,
      carteira: "ativo",
      etapaAtual: etapa,
      diasAtrasoAbertura: dias,
      valorAbertura: valor,
      valorAtual: valor,
      prioridade: prioridadeSugerida(divida, etapa),
      proximoContatoEm: new Date(agora.getTime() + DIA_MS),
      quadranteDna: dna.quadranteDna,
      tom: dna.tom,
    });
  }

  // O "pago": a régua abriu o caso no dia seguinte ao vencimento (`abrirCaso`,
  // D+1) e o pagamento o fechou agora — `statusDesde` e `encerradoEm` no mesmo
  // instante, como `encerrarCaso` grava. Caso fechado a régua não revisa: fica
  // sem etapa, como os outros fechados deste semeador.
  const mensalidadeDoPago = valorMensalidade(indiceDaEntrada(providerId, entradaDoCursor(CURSOR_DO_CASO_PAGO))).toFixed(2);
  casos.push({
    providerId,
    customerId: idDoCursor(CURSOR_DO_CASO_PAGO),
    status: "pago",
    carteira: "ativo",
    etapaAtual: null,
    abertoEm: subtrairDias(agora, DIAS_DE_ATRASO_DO_CASO_PAGO - 1),
    statusDesde: agora,
    diasAtrasoAbertura: 1,
    valorAbertura: mensalidadeDoPago,
    valorAtual: mensalidadeDoPago,
    prioridade: "normal",
    proximoContatoEm: null,
    encerradoEm: agora,
    motivoEncerramento: null,
  });

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
 * Sem negociação semeada aqui: a política já nasce com a origem da cobrança
 * `manual` (`acordoDaDemo`, Leva 2), e as linhas de negociação de TODO caso
 * `negociando`/`acordo_ativo` — deste semeador e do kanban — saem da trilha dos
 * casos (`trilhaDosCasos`), depois do insert, em `tentarCriarSandbox`.
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

/**
 * A carteira completa (Leva 2): todo devedor que ainda não tem caso nasce com o
 * caso "aberto" que a primeira passada da régua abriria — os filtros de
 * `clientesParaAbrirCaso` (dívida acima do mínimo, atraso de ao menos um dia,
 * sem caso) e a decisão de `abrirCaso` (prescrita não abre; etapa, prioridade e
 * DNA pelas funções reais). Até aqui só 20 dos 299 devedores tinham caso, e o
 * worker abria os outros 279 na frente do visitante.
 *
 * `abrirCaso` marca o próximo contato para o dia da abertura. Um em cada três
 * abriu dois dias atrás e ninguém tocou — a fila de vencidos não nasce vazia —,
 * quando o atraso de hoje comporta a abertura recuada (`aplicarLinhaDoTempo`
 * recua `abertoEm` até o próximo contato já vencido). O resto abriu hoje.
 */
function casosAbertosDaCarteira(
  providerId: number,
  idsClientes: number[],
  linhasClientes: InsertCustomer[],
  jaTemCaso: ReadonlySet<number>,
  agora: Date,
): InsertCobrancaCaso[] {
  const casos: InsertCobrancaCaso[] = [];
  linhasClientes.forEach((linha, k) => {
    const divida = Number(linha.totalOverdueAmount ?? 0);
    const dias = linha.maxDaysOverdue ?? 0;
    if (divida <= DIVIDA_MINIMA_PARA_CASO || dias < 1 || jaTemCaso.has(idsClientes[k]) || prescrita(dias)) return;
    const carteira = carteiraDoStatusErp(linha.status ?? "active");
    const etapa = etapaParaAtraso(dias, carteira).etapa?.id ?? null;
    const dna = dnaDoCaso({ contractStartDate: linha.contractStartDate ?? null, diasAtraso: dias, faturasAbertas: linha.overdueInvoicesCount ?? 0 }, agora);
    const abriuHaDoisDias = casos.length % 3 === 0 && dias > 2;
    casos.push({
      providerId,
      customerId: idsClientes[k],
      status: "aberto",
      carteira,
      etapaAtual: etapa,
      diasAtrasoAbertura: dias,
      valorAbertura: divida.toFixed(2),
      valorAtual: divida.toFixed(2),
      prioridade: prioridadeSugerida(divida, etapa),
      proximoContatoEm: abriuHaDoisDias ? subtrairDias(agora, 2) : agora,
      quadranteDna: dna.quadranteDna,
      tom: dna.tom,
    });
  });
  return casos;
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

/** O meio da conversa: a proposta veio depois de o cliente responder e antes do último evento. */
function meioDaConversa(conversa: ConversaPlanejada): Date {
  return new Date((conversa.abertaEm.getTime() + conversa.ultimoEventoEm.getTime()) / 2);
}

/**
 * Desde quando o caso está no status atual, pela transição que a conversa
 * conta: em contato desde o contato que o moveu; negociando desde o meio da
 * conversa; acordo desde a última fala da equipe ("Acordo registrado"). O
 * negativado tem conta própria (`negativacaoDoCaso`): ele é anterior à
 * conversa e depende do pré-aviso.
 */
function statusDesdeComContato(status: string, conversa: ConversaPlanejada): Date {
  if (status === "em_contato") return conversa.abertaEm;
  if (status === "negociando") return meioDaConversa(conversa);
  if (status === "acordo_ativo") return conversa.ultimoEventoEm;
  throw new Error(`statusDesdeComContato: status ${status} sem transicao contada pela conversa ${conversa.conversationId}`);
}

/**
 * O instante da negativação, ANTES da conversa (a abertura dela já fala do
 * registro nos órgãos de proteção) e nunca antes dos 10 dias úteis do
 * pré-aviso — a data sai de `primeiraNegativacaoPermitida`, a mesma regra que a
 * trilha dos casos confere; aqui ela só é chamada. Até a fase B o negativado
 * abria um dia antes da conversa e era inscrito 12 h depois, sem espaço para o
 * aviso que a Súmula 359 do STJ exige.
 *
 * `diasAtrasoAbertura` ainda é o atraso de HOJE neste ponto (ver `aplicarLinhaDoTempo`).
 */
function negativacaoDoCaso(caso: InsertCobrancaCaso, abertoEm: Date, conversa: ConversaPlanejada, politica: PoliticaDaTrilha, agora: Date): Date {
  const permitida = primeiraNegativacaoPermitida(
    // O caso ainda não foi inserido: sem id, o zero só aparece nas mensagens de erro do módulo.
    { id: 0, carteira: caso.carteira as Carteira, abertoEm, diasAtraso: caso.diasAtrasoAbertura ?? 0 },
    politica,
    agora,
  );
  const negativadoEm = new Date(permitida.getTime() + HORAS_DO_DIA_PERMITIDO_ATE_A_NEGATIVACAO * HORA_MS);
  if (negativadoEm.getTime() >= conversa.abertaEm.getTime()) {
    throw new Error(`negativacaoDoCaso: a negativacao so caberia em ${negativadoEm.toISOString()}, depois da conversa ${conversa.conversationId} que ja fala dela`);
  }
  return negativadoEm;
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
 *
 * O negativado abre `DIAS_DA_ABERTURA_DO_NEGATIVADO_ATE_A_CONVERSA` antes da
 * conversa, e não um dia: o pré-aviso e o prazo até a inscrição vêm antes dela.
 */
function aplicarLinhaDoTempo(casos: InsertCobrancaCaso[], cursorPorCliente: Map<number, number>, conversas: ConversaPlanejada[], politica: PoliticaDaTrilha, agora: Date): void {
  for (const caso of casos) {
    const status = caso.status ?? "aberto";
    if (casoFechado(status)) continue;
    const conversa = conversas.find((c) => c.origem === "cobranca" && c.cursor === cursorPorCliente.get(caso.customerId));

    let abertoEm: Date;
    if (conversa) {
      if (status === "aberto") {
        throw new Error(`aplicarLinhaDoTempo: conversa ${conversa.conversationId} num caso 'aberto' — abrir a conversa move o caso para 'em_contato' no produto`);
      }
      caso.ultimoContatoEm = conversa.abertaEm;
      if (status === "negativado") {
        abertoEm = new Date(conversa.abertaEm.getTime() - DIAS_DA_ABERTURA_DO_NEGATIVADO_ATE_A_CONVERSA * DIA_MS);
        caso.statusDesde = negativacaoDoCaso(caso, abertoEm, conversa, politica, agora);
      } else {
        abertoEm = new Date(conversa.abertaEm.getTime() - DIA_MS);
        caso.statusDesde = statusDesdeComContato(status, conversa);
      }
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

/**
 * Quem cuida de cada caso vivo (Leva 2): o dono da conversa humana do chat —
 * quem abriu e responde a conversa é o administrador — e, sem ela, o responsável
 * da etapa na política (`ETAPAS_DO_ADMINISTRADOR_DA_DEMO`); o resto fica na
 * fila geral. Com todos nulos, "Minha fila", "Toda a equipe" e "Fila geral"
 * mostravam o mesmo quadro. A conversa só do robô não dá dono ao caso.
 */
function atribuirResponsaveis(casos: InsertCobrancaCaso[], cursorPorCliente: Map<number, number>, conversas: ConversaPlanejada[], adminId: number): void {
  const etapasDoAdmin = new Set<string>(ETAPAS_DO_ADMINISTRADOR_DA_DEMO);
  for (const caso of casos) {
    if (casoFechado(caso.status ?? "aberto")) continue;
    const conversa = conversas.find((c) => c.origem === "cobranca" && c.cursor === cursorPorCliente.get(caso.customerId));
    const conversaHumana = conversa !== undefined && conversa.status !== "BOT";
    caso.responsavelUserId = conversaHumana || etapasDoAdmin.has(caso.etapaAtual ?? "") ? adminId : null;
  }
}

/**
 * O encerramento que o kanban grava ao levar o caso a "Pago" — o evento de
 * `encerrarCaso` (cobranca.storage.ts): tipo `encerramento`, canal nulo de quem
 * fechou pela tela, sem motivo e `metadata { status, de }`. Sem ele o caso
 * "pago" abria a linha do tempo vazia (auditoria de telas, rodada 2).
 */
function eventoDoCasoPago(providerId: number, adminId: number, caso: { id: number; customerId: number; encerradoEm: Date }): InsertCobrancaEvento {
  if (!transicaoDeCaso("aberto", "pago").ok) {
    throw new Error(`eventoDoCasoPago: aberto -> pago no caso ${caso.id} nao e transicao da maquina de estados`);
  }
  return {
    providerId, casoId: caso.id, customerId: caso.customerId, userId: adminId,
    tipo: "encerramento", canal: null, notas: null, metadata: { status: "pago", de: "aberto" }, ocorridoEm: caso.encerradoEm,
  };
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
  /** Só para "concluido": quantos dias depois do corte o aparelho foi recolhido. */
  diasAteARetirada: number,
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
        // "visita", e não "presencial": o canal que `tentativaSchema` (equipamentos.routes.ts) aceita.
        { providerId, userId: adminId, type: "tentativa", channel: "visita", result: "ausente_horario_confirmado", occurredAt: depoisDoCorte(5) },
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
        { providerId, userId: adminId, type: "tentativa", channel: "visita", result: "recusa_expressa", notes: "Titular recusou a devolução", occurredAt: depoisDoCorte(6) },
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
      Object.assign(caso, { bureauStatus: "resolvido", closedAt: depoisDoCorte(diasAteARetirada), scheduledAt: depoisDoCorte(diasAteARetirada), assignedToUserId: adminId, collectionMethod: "retirada" });
      eventos.push(
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "pre_recuperacao", toStatus: "agendado", occurredAt: depoisDoCorte(diasAteARetirada - 2) },
        { providerId, userId: adminId, type: "tentativa", channel: "visita", result: "contato_confirmado", occurredAt: depoisDoCorte(diasAteARetirada) },
        { providerId, userId: adminId, type: "status_alterado", fromStatus: "agendado", toStatus: "concluido", notes: "Equipamento recolhido para triagem", occurredAt: depoisDoCorte(diasAteARetirada) },
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
 *
 * Leva 2, fase B: quando a equipe falou depois da abertura, um segundo contato
 * no instante da ÚLTIMA fala dela no roteiro (`ultimaFalaDaEquipe`, calculada
 * por `roteiroDaConversa`). Sem ele o KPI "Contatados hoje" nascia zerado com a
 * equipe respondendo no chat há duas horas.
 *
 * AIDEV-QUESTION: no produto, a resposta do atendente pelo chat grava `nota`
 * (`registrarEventoDoChat`, chat-bullq.storage.ts), e só a abertura grava
 * `contato` — "Contatados hoje" não conta quem só respondeu no chat. A
 * semeadura segue o pedido do plano (contato na última fala da equipe); se o
 * KPI deve contar a resposta pelo chat, a mudança é do produto, fora da demo.
 */
function eventosDoChatNaCobranca(
  providerId: number,
  adminId: number,
  caso: { id: number; customerId: number; status: string },
  conversa: ConversaPlanejada,
  ultimaFalaDaEquipe: Date | undefined,
): InsertCobrancaEvento[] {
  const doBot = conversa.status === "BOT";
  const metadata = { origem: "chat_integrado", conversationId: conversa.conversationId };
  const resultado = doBot ? null : caso.status === "acordo_ativo" ? "promessa_pagamento" : caso.status === "negativado" ? "recusou" : "falou";
  const base = { providerId, casoId: caso.id, customerId: caso.customerId, userId: doBot ? null : adminId, canal: "whatsapp", metadata };
  return [
    { ...base, tipo: "contato", resultado, notas: "Conversa aberta pelo WhatsApp integrado", ocorridoEm: conversa.abertaEm },
    ...(ultimaFalaDaEquipe
      ? [{ ...base, userId: adminId, tipo: "contato", resultado, notas: "Atendente respondeu pelo WhatsApp integrado", ocorridoEm: ultimaFalaDaEquipe }]
      : []),
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
  const proposta = conversa && meioDaConversa(conversa);
  const degraus: Array<{ de: StatusDeCaso; para: StatusDeCaso; em: Date }> = [];
  if (caso.status === "negativado") {
    degraus.push({ de: "aberto", para: "negativado", em: caso.statusDesde });
  } else if (caso.status === "negociando") {
    degraus.push({ de: conversa ? "em_contato" : "aberto", para: "negociando", em: caso.statusDesde });
  } else if (caso.status === "acordo_ativo") {
    if (proposta) degraus.push({ de: "em_contato", para: "negociando", em: proposta });
    degraus.push({ de: proposta ? "negociando" : "aberto", para: "acordo_ativo", em: caso.statusDesde });
  }
  return degraus.map(({ de, para, em }) => {
    const tipo = eventoDaTransicaoDeCaso(de, para);
    if (!transicaoDeCaso(de, para).ok || !tipo) {
      throw new Error(`eventosDaTransicaoNaCobranca: ${de} -> ${para} no caso ${caso.id} nao e transicao com evento na maquina de estados`);
    }
    return { providerId, casoId: caso.id, customerId: caso.customerId, userId: adminId, tipo, canal: null, metadata: { de, para }, ocorridoEm: em };
  });
}

// ── Fiação dos módulos da Leva 2 (fase B) ──

/**
 * O último instante até `ate` em que a política deixa falar com o cliente — o
 * contato é contato, e o CDC art. 42 vale para ele. Volta no tempo (e nunca
 * avança): o contato da recuperação precisa ficar a pelo menos
 * `diasDesdeOContato` de hoje, senão `faturasHistoricasDoSandbox` o recusaria
 * como recente demais num fim de semana emendado.
 */
function ultimoInstanteNaJanela(ate: Date, janela: PoliticaDaTrilha["janelaContato"]): Date {
  let t = ate.getTime();
  // Quinze dias de horas cobre qualquer janela válida, com sábado, domingo e feriado emendados.
  for (let i = 0; i < 15 * 24; i++) {
    if (janelaDoChat(new Date(t), janela).permitida) return new Date(t);
    t = Math.floor(t / HORA_MS) * HORA_MS - HORA_MS / 2;
  }
  throw new Error(`ultimoInstanteNaJanela: nenhuma hora dentro da janela de contato nos 15 dias antes de ${ate.toISOString()}`);
}

/** Os contatos que antecederam as recuperações dos últimos 30 dias, NA ORDEM de `RECUPERACOES_DOS_ULTIMOS_30_DIAS`. */
function contatosDaRecuperacao30d(
  indicePorCursor: ReadonlyMap<number, number>,
  idsClientes: readonly number[],
  janela: PoliticaDaTrilha["janelaContato"],
  agora: Date,
): ContatoDoHistorico[] {
  return RECUPERACOES_DOS_ULTIMOS_30_DIAS.map(({ cursor, diasDesdeOContato }) => ({
    customerId: idsClientes[indicePorCursor.get(cursor)!],
    contatoEm: ultimoInstanteNaJanela(subtrairDias(agora, diasDesdeOContato), janela),
  }));
}

/**
 * A carteira como `faturasHistoricasDoSandbox` a lê: um item por cliente, com a
 * fatura VENCIDA que a semeadura já montou (a mensalidade do inadimplente, a
 * saída de quem saiu devendo) — é o limite do histórico e a única fatura que
 * uma recuperação fecha.
 */
function clientesDoHistorico(
  providerId: number,
  entradas: readonly EntradaSandbox[],
  idsClientes: readonly number[],
  linhasClientes: readonly InsertCustomer[],
  linhasFaturas: readonly InsertInvoice[],
): ClienteDoHistorico[] {
  const vencidaPorCliente = new Map(linhasFaturas.filter((f) => f.status === "overdue").map((f) => [f.customerId, f]));
  return entradas.map((entrada, k) => {
    const linha = linhasClientes[k];
    const vencida = vencidaPorCliente.get(idsClientes[k]);
    return {
      customerId: idsClientes[k],
      categoria: entrada.categoria,
      mensalidade: valorMensalidade(indiceDaEntrada(providerId, entrada)),
      contractStartDate: linha.contractStartDate ?? null,
      cortadoEm: linha.cortadoEm ?? null,
      maxDaysOverdue: linha.maxDaysOverdue ?? 0,
      overdueInvoicesCount: linha.overdueInvoicesCount ?? 0,
      faturaEmAberto: vencida ? { erpRef: vencida.erpRef!, valor: Number(vencida.value), vencimento: vencida.dueDate } : null,
    };
  });
}

/** O agregado de quem deixou de dever, pela regra do sync: sem dívida, `current` e a faixa de risco de zero dia. */
const CLIENTE_SEM_DIVIDA = {
  totalOverdueAmount: "0.00",
  overdueInvoicesCount: 0,
  maxDaysOverdue: 0,
  paymentStatus: "current",
  riskTier: faixaDeRiscoDoAtraso(0),
} satisfies Partial<InsertCustomer>;

/** O resultado de um contato por telefone em que o cliente prometeu pagar — e pagou no dia seguinte. */
const RESULTADO_DO_CONTATO_DA_RECUPERACAO = "promessa_pagamento";

/**
 * O caso de quem pagou nos últimos 30 dias, já FECHADO: a régua o abriu um dia
 * antes do contato, o contato por telefone o levou a "em contato"
 * (`statusAposContato`, a esteira da rota de eventos), e a dívida zerada no ERP
 * o fechou na passada seguinte — `encerrado` com `MOTIVO_DIVIDA_ZERADA`, que é o
 * que `revisarCaso` grava ("só o recebimento explícito confirma dinheiro"), nunca
 * `pago`. Etapa nula, como os outros fechados deste semeador; etapa, prioridade
 * e DNA da foto de antes do pagamento (`originais`).
 */
function casosDaRecuperacao30d(
  providerId: number,
  recuperacoes: readonly RecuperacaoDaDemo[],
  originais: ReadonlyMap<number, InsertCustomer>,
  agora: Date,
): InsertCobrancaCaso[] {
  return recuperacoes.map((r) => {
    const cliente = originais.get(r.customerId)!;
    const dias = cliente.maxDaysOverdue ?? 0;
    const abertoEm = new Date(r.contatoEm.getTime() - DIA_MS);
    const diasNaAbertura = Math.max(0, dias - Math.floor((agora.getTime() - abertoEm.getTime()) / DIA_MS));
    const etapa = etapaParaAtraso(diasNaAbertura, r.carteira).etapa?.id ?? null;
    const dna = dnaDoCaso({ contractStartDate: cliente.contractStartDate ?? null, diasAtraso: dias, faturasAbertas: cliente.overdueInvoicesCount ?? 0 }, agora);
    const valor = r.valor.toFixed(2);
    return {
      providerId,
      customerId: r.customerId,
      status: "encerrado",
      carteira: r.carteira,
      etapaAtual: null,
      abertoEm,
      statusDesde: r.recuperadoEm,
      diasAtrasoAbertura: diasNaAbertura,
      valorAbertura: valor,
      valorAtual: valor,
      prioridade: prioridadeSugerida(r.valor, etapa),
      ultimoContatoEm: r.contatoEm,
      proximoContatoEm: null,
      encerradoEm: r.recuperadoEm,
      motivoEncerramento: MOTIVO_DIVIDA_ZERADA,
      quadranteDna: dna.quadranteDna,
      tom: dna.tom,
    };
  });
}

/**
 * O contato no formato do POST /casos/:id/eventos (telefone, pelo administrador,
 * sem metadata) e o encerramento que `encerrarCaso` grava quando é o motor que
 * fecha (`userId` nulo, canal `sistema`, o motivo nas notas).
 */
function eventosDaRecuperacao30d(providerId: number, adminId: number, caso: { id: number; customerId: number }, r: RecuperacaoDaDemo): InsertCobrancaEvento[] {
  const emContato = statusAposContato("aberto", RESULTADO_DO_CONTATO_DA_RECUPERACAO);
  if (!emContato || eventoDaTransicaoDeCaso(emContato, "encerrado") !== "encerramento" || !transicaoDeCaso(emContato, "encerrado").ok) {
    throw new Error(`eventosDaRecuperacao30d: aberto -> contato -> encerrado no caso ${caso.id} nao e caminho da maquina de estados`);
  }
  const base = { providerId, casoId: caso.id, customerId: caso.customerId };
  return [
    { ...base, userId: adminId, tipo: "contato", canal: "telefone", resultado: RESULTADO_DO_CONTATO_DA_RECUPERACAO, notas: null, metadata: null, ocorridoEm: r.contatoEm },
    { ...base, userId: null, tipo: "encerramento", canal: "sistema", notas: MOTIVO_DIVIDA_ZERADA, metadata: { status: "encerrado", de: emContato }, ocorridoEm: r.recuperadoEm },
  ];
}

/**
 * A linha que o chat simulado monta ao LER a conversa semeada
 * (`camposDaConversa`, chat-simulado.ts) — os mesmos valores que o banco
 * devolverá, para o roteiro calculado aqui ser o que o visitante vê.
 */
function linhaDaConversaDeCobranca(
  conversa: ConversaPlanejada,
  cliente: InsertCustomer,
  caso: InsertCobrancaCaso,
  provedor: { name: string; tradeName: string | null; createdAt: Date | null },
  atendenteNome: string,
): LinhaDaConversa {
  return {
    conversationId: conversa.conversationId,
    status: conversa.status,
    origem: conversa.origem,
    canalId: CANAL_DO_CHAT_DA_DEMO,
    abertaEm: conversa.abertaEm,
    ultimoEventoEm: conversa.ultimoEventoEm,
    clienteNome: cliente.name,
    clienteTelefone: cliente.phone ?? null,
    clienteDivida: cliente.totalOverdueAmount ?? null,
    clienteDias: cliente.maxDaysOverdue ?? null,
    provedorNome: provedor.name,
    provedorFantasia: provedor.tradeName,
    semeadaEm: provedor.createdAt,
    atendenteNome,
    casoStatus: caso.status ?? "aberto",
    casoCarteira: caso.carteira,
    casoValor: caso.valorAtual ?? null,
    casoDias: caso.diasAtrasoAbertura ?? null,
    recuperacaoStatus: null,
    recuperacaoAgendadaEm: null,
    equipamentoTipo: null,
    equipamentoMarca: null,
    equipamentoModelo: null,
  };
}

/**
 * O instante da última fala da equipe no roteiro da conversa, quando ela veio
 * depois da abertura — `roteiroDaConversa` decide (janela de contato, regras de
 * 24 h); aqui só se lê. A equipe fala com o nome do atendente que abriu a
 * conversa (o assistente fala como "Assistente virtual").
 */
function ultimaFalaDaEquipe(linha: LinhaDaConversa, agora: Date): Date | undefined {
  const falas = roteiroDaConversa(linha, agora.getTime()).filter((m) => m.direction === "OUTBOUND" && m.senderName === linha.atendenteNome);
  const ultima = falas.at(-1);
  const em = ultima ? new Date(ultima.createdAt) : undefined;
  return em && em.getTime() > linha.abertaEm.getTime() ? em : undefined;
}

/**
 * A metadata que o storage grava na proposta e no aceite, mesclada POR CIMA do
 * `{ de, para }` da transição que `eventosDaTransicaoNaCobranca` já gravou — a
 * trilha não duplica o evento. Sem a transição para mesclar, o plano derivou, e
 * falha alto.
 */
function mesclarNaTransicao(eventos: InsertCobrancaEvento[], casoId: number, tipo: string, metadata: Record<string, unknown> | null): void {
  if (!metadata) return;
  const transicao = eventos.find((e) => e.casoId === casoId && e.tipo === tipo);
  if (!transicao) throw new Error(`mesclarNaTransicao: caso ${casoId} com negociacao e sem o evento ${tipo} da transicao`);
  transicao.metadata = { ...(transicao.metadata ?? {}), ...metadata };
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
  // Fora da transação do sandbox, com transação e lock próprios (mundo-base.ts):
  // no caminho comum são duas leituras; num mundo no formato antigo, a primeira
  // criação depois do deploy paga a reescrita, uma vez. As consultas do sandbox
  // leem a rede já no formato atual.
  //
  // O /demo não cai pelo complemento: sem ele o sandbox nasce igual (rede no
  // formato antigo), e ele é transacional e tenta de novo na próxima criação.
  // Nível error de propósito (o deploy conta logs 50/60). Só nome e mensagem:
  // o erro do pg traz linha de dado, e o redact censura `name` aninhado.
  try {
    await complementarMundoBase();
  } catch (err) {
    const erro = err as Error | null | undefined;
    logger.error(
      { evento: "demo.complemento_do_mundo_falhou", erroNome: erro?.name, erroMensagem: erro?.message },
      "demo: complemento do mundo base falhou — sandbox criado sem ele; a proxima criacao tenta de novo",
    );
  }
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
 * Leva 2, fase B: os módulos puros dos outros pacotes entram aqui, na ordem das
 * FKs — ficha, equipe, sócios, documentos, sync e créditos logo depois do
 * administrador (`semeadura-ficha.ts`); faturas históricas e recuperação dos
 * últimos 30 dias antes de faturas e casos (`semeadura-faturas.ts`); consultas e
 * alertas depois da carteira (`semeadura-consultas.ts`); a trilha dos casos
 * depois do insert deles (`semeadura-negociacoes.ts`); e o `agenteConfig` do
 * chat simulado na integração (`chat-simulado.ts`).
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
      // A ficha da aba Empresa — nome fantasia, sede em Londrina, contato — é o
      // cadastro que "buscar na Receita" devolve para este CNPJ (cnpj-simulado.ts).
      ...fichaDoProvedorDaDemo(subdomain),
      name: "Provedor Demonstração",
      cnpj: cnpjDoSandbox(),
      subdomain,
      // Um plano da tabela de preços (`PLAN_PRICES`, shared/planos.ts): "enterprise"
      // saiu do catálogo em 03/09/2026 e a vitrine do painel não reconhecia o
      // plano do visitante (Leva 2).
      plan: "pro",
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
      // O MESMO instante da semeadura, e não o `now()` da transação: o chat
      // simulado congela o roteiro das conversas nele (`roteiroCongelado`), e o
      // contato da última fala da equipe é gravado abaixo com este `agora`.
      createdAt: agora,
    }).returning();

    // Rodada de correção (Tarefa 1): o MESMO conjunto de campos que o mundo
    // base grava (`linhaDaIntegracao`, mundo-base.ts) — sem integração
    // habilitada `buildErpConfig` lança antes de o conector "demo" ser
    // chamado, e a rede inteira (inclusive a PRÓPRIA carteira do sandbox)
    // fica invisível para a consulta ao vivo.
    // Leva 2: com a última sincronização igual ao histórico semeado abaixo — a
    // aba Integração dizia "Nunca sincronizou" sobre 1.500 clientes sincronizados.
    await tx.insert(erpIntegrations).values({ ...linhaDaIntegracao(provider.id), ...integracaoErpSincronizada(agora, CLIENTES_POR_SANDBOX) });

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

    // A empresa por trás do selo "Verificado": a equipe além do administrador
    // (que segue sendo o primeiro usuário e o segundo sinal da limpeza), os
    // sócios do QSA simulado, os documentos do KYC, o histórico de
    // sincronização e os pedidos de crédito.
    await tx.insert(users).values(usuariosExtrasDaDemo(subdomain, senhaHash).map((u) => ({ ...u, providerId: provider.id })));
    await tx.insert(providerPartners).values(sociosDaDemo().map((socio) => ({ ...socio, providerId: provider.id })));
    await tx.insert(providerDocuments).values(documentosDaDemo(provider.id));
    await tx.insert(erpSyncLogs).values(logsDeSyncDaDemo(provider.id, CLIENTES_POR_SANDBOX, agora));
    await tx.insert(creditOrders).values(pedidosDeCreditoDaDemo(provider.id, agora));

    // Política com custos e preço por plano: sem ela a Economia de TODA ficha
    // 360 abria pendente. Leva 2: a origem da cobrança `manual` (`acordoDaDemo`)
    // e o administrador como responsável das etapas de decisão
    // (`ETAPAS_DO_ADMINISTRADOR_DA_DEMO`), só o responsável — a janela é a do
    // catálogo. Demais colunas no default do schema.
    const politica = politicaDaDemo(user.id);
    await tx.insert(cobrancaPolitica).values({ providerId: provider.id, ...politica.gravada });

    const entradas = planoDeIndicesDoSandbox();
    const indicePorCursor = new Map(entradas.map((e, i) => [e.cursor, i]));

    const linhasClientes = entradas.map((e) => linhaDoCliente(provider.id, e, agora));
    await inserirPorColunas(tx, customers, linhasClientes);
    // O id de cada cliente relido pelo CPF, único dentro do sandbox (ver `inserirPorColunas`).
    const idPorCpf = new Map((await tx.select({ id: customers.id, cpfCnpj: customers.cpfCnpj }).from(customers).where(eq(customers.providerId, provider.id))).map((c) => [c.cpfCnpj, c.id]));
    const idsClientes = linhasClientes.map((linha) => {
      const id = idPorCpf.get(linha.cpfCnpj);
      if (id === undefined) throw new Error(`tentarCriarSandbox: cliente ${linha.cpfCnpj} nao foi gravado`);
      return id;
    });
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
        linhasFaturas.push(linhaDaFaturaDeSaida(provider.id, customerId, entrada, cortadoEm, agora));
      } else if (entrada.cursor === CURSOR_DO_CASO_PAGO) {
        linhasFaturas.push(linhaDaFaturaDoCasoPago(provider.id, customerId, entrada, agora));
      }

      const equip = equipamentoDaEntrada(entrada);
      if (equip) {
        linhasEquipamentos.push(linhaDoEquipamento(provider.id, customerId, entrada, equip));
        entradaDoEquipamento.push(k);
      }
    }

    // Faturas históricas e a recuperação dos últimos 30 dias, ANTES de inserir
    // faturas e casos: quem pagou já entra com a fatura fechada, a dívida zerada e
    // o caso encerrado — a carteira de devedores e os casos vivos contam sem ele.
    const indiceDoCliente = new Map(idsClientes.map((id, k) => [id, k]));
    const contatosDaRecuperacao = contatosDaRecuperacao30d(indicePorCursor, idsClientes, politica.lida.janelaContato, agora);
    const historico = faturasHistoricasDoSandbox({
      providerId: provider.id,
      adminId: user.id,
      clientes: clientesDoHistorico(provider.id, entradas, idsClientes, linhasClientes, linhasFaturas),
      contatos: contatosDaRecuperacao,
      agora,
      // 3 meses nos em dia, e não 6: medido no banco local (13/09/2026), as ~9,2 mil
      // mensalidades de 6 meses sozinhas levavam a criação a ~1,7 s, acima do
      // orçamento (~1,2 s local, ~3 s no banco real). Três meses ainda dão
      // pontualidade, recebido e a fatura do mês a todo cliente em dia.
      mesesDeHistoricoEmDia: MESES_DE_HISTORICO_REDUZIDO,
    });
    // O plano escolhe quem pagou; o módulo confere se o contato serve. Divergir
    // deixaria caso fechado para quem ainda deve (ou o contrário): falha alto.
    const recuperados = historico.recuperacoes.map((r) => r.customerId);
    if (recuperados.join(",") !== contatosDaRecuperacao.map((c) => c.customerId).join(",")) {
      throw new Error(`tentarCriarSandbox: recuperacoes dos ultimos 30 dias [${recuperados.join(",")}] divergem do plano`);
    }
    const recuperacaoPorCliente = new Map(historico.recuperacoes.map((r) => [r.customerId, r]));
    const alteracaoDaFatura = new Map(historico.recuperacoes.map((r) => [r.erpRef, r.alteracaoDaFatura]));
    linhasFaturas.forEach((f, i) => {
      const alteracao = alteracaoDaFatura.get(f.erpRef ?? "");
      if (alteracao) linhasFaturas[i] = { ...f, ...alteracao };
    });
    /** A foto de quem pagou ANTES de pagar — etapa, prioridade e DNA do caso encerrado saem dela. */
    const originais = new Map<number, InsertCustomer>();
    for (const r of historico.recuperacoes) {
      const k = indiceDoCliente.get(r.customerId)!;
      originais.set(r.customerId, linhasClientes[k]);
      linhasClientes[k] = { ...linhasClientes[k], ...CLIENTE_SEM_DIVIDA };
    }
    if (recuperados.length > 0) {
      await tx.update(customers).set(CLIENTE_SEM_DIVIDA).where(and(eq(customers.providerId, provider.id), inArray(customers.id, recuperados)));
    }
    // A mensalidade do mês que já venceu sem pagamento soma na dívida do
    // inadimplente, antes de casos, conversas, consultas e alertas lerem a
    // carteira. Todo inadimplente nasce com UMA fatura de uma mensalidade: o
    // novo agregado é o dobro dela, e um UPDATE por valor resolve.
    const acrescidos = new Map<string, number[]>();
    for (const d of historico.dividasDoMes) {
      const k = indiceDoCliente.get(d.customerId)!;
      const linha = linhasClientes[k];
      if ((linha.overdueInvoicesCount ?? 0) !== 1) throw new Error(`tentarCriarSandbox: mensalidade do mes vencida para o cliente ${d.customerId}, que nao tem uma fatura em aberto`);
      const total = (Number(linha.totalOverdueAmount) + d.valor).toFixed(2);
      linhasClientes[k] = { ...linha, totalOverdueAmount: total, overdueInvoicesCount: 2 };
      acrescidos.set(total, [...(acrescidos.get(total) ?? []), d.customerId]);
    }
    for (const [total, ids] of acrescidos) {
      await tx.update(customers).set({ totalOverdueAmount: total, overdueInvoicesCount: 2 }).where(and(eq(customers.providerId, provider.id), inArray(customers.id, ids)));
    }
    // O cliente do caso "pago" já tem a fatura da competência que pagou hoje
    // (`linhaDaFaturaDoCasoPago`): a mensalidade do mesmo mês seria uma segunda cobrança.
    const faturaDoPago = linhasFaturas.find((f) => f.customerId === idsClientes[indicePorCursor.get(CURSOR_DO_CASO_PAGO)!])!;
    const mesmaCompetenciaDoPago = (f: InsertInvoice) =>
      f.customerId === faturaDoPago.customerId && f.dueDate.toISOString().slice(0, 7) === faturaDoPago.dueDate.toISOString().slice(0, 7);
    const mensalidades = historico.faturas.filter((f) => !mesmaCompetenciaDoPago(f));

    await inserirPorColunas(tx, invoices, [...linhasFaturas, ...mensalidades]);
    if (historico.quitacoes.length > 0) {
      const refs = historico.quitacoes.map((q) => q.erpRef);
      const idDaFatura = new Map((await tx.select({ id: invoices.id, erpRef: invoices.erpRef }).from(invoices)
        .where(and(eq(invoices.providerId, provider.id), inArray(invoices.erpRef, refs)))).map((f) => [f.erpRef, f.id]));
      await tx.insert(cobrancaQuitacoes).values(historico.quitacoes.map(({ erpRef, ...quitacao }) => {
        const faturaId = idDaFatura.get(erpRef);
        if (faturaId === undefined) throw new Error(`tentarCriarSandbox: quitacao sem a fatura ${erpRef}`);
        return { ...quitacao, faturaId };
      }));
    }
    const idsEquipamentos = await inserirEquipamentosEmBlocos(tx, linhasEquipamentos);

    const conversas = conversasPlanejadas(provider.id, agora);

    const casosTrabalhados = [
      ...casosDoKanban(provider.id, entradas, idsClientes, linhasClientes, indicePorCursor, agora),
      ...casosVivosDeExCliente(provider.id, entradas, idsClientes, linhasClientes, indicePorCursor, agora),
    ];
    const casos = [
      ...casosTrabalhados,
      ...casosAbertosDaCarteira(provider.id, idsClientes, linhasClientes, new Set(casosTrabalhados.map((c) => c.customerId)), agora),
      ...casosDaRecuperacao30d(provider.id, historico.recuperacoes, originais, agora),
    ];
    // O índice único parcial do banco (`cobranca_casos_um_aberto_por_cliente`)
    // derrubaria a transação inteira com um erro cru; aqui a deriva aparece
    // com o nome do defeito.
    const clientesComCasoVivo = casos.filter((c) => !casoFechado(c.status ?? "aberto")).map((c) => c.customerId);
    if (new Set(clientesComCasoVivo).size !== clientesComCasoVivo.length) {
      throw new Error("tentarCriarSandbox: dois casos de cobranca vivos para o mesmo cliente");
    }
    aplicarLinhaDoTempo(casos, cursorPorCliente, conversas, politica.lida, agora);
    atribuirResponsaveis(casos, cursorPorCliente, conversas, user.id);
    // O contato da última fala da equipe em cada conversa de cobrança, decidido
    // antes do insert: `ultimoContatoEm` do caso é o último contato gravado.
    const ultimaFalaPorConversa = new Map<string, Date>();
    for (const conversa of conversas) {
      if (conversa.origem !== "cobranca") continue;
      const k = indicePorCursor.get(conversa.cursor)!;
      const caso = casos.find((c) => c.customerId === idsClientes[k] && !casoFechado(c.status ?? "aberto"));
      if (!caso) continue;
      const em = ultimaFalaDaEquipe(linhaDaConversaDeCobranca(conversa, linhasClientes[k], caso, provider, user.name), agora);
      if (!em) continue;
      ultimaFalaPorConversa.set(conversa.conversationId, em);
      caso.ultimoContatoEm = em;
    }
    const idsCasos = (await tx.insert(cobrancaCasos).values(casos).returning({ id: cobrancaCasos.id })).map((r) => r.id);

    const recuperacoes = entradaDoEquipamento.flatMap((k, i) => {
      const status = recuperacaoDaEntrada(entradas[k]);
      if (!status) return [];
      const conversa = conversas.find((c) => c.origem === "equipamentos" && c.cursor === entradas[k].cursor);
      return [recuperacaoPlanejada(
        provider.id, user.id, status,
        { customerId: idsClientes[k], equipmentId: idsEquipamentos[i] },
        cortadoEmDaEntrada(entradas[k], agora)!, conversa, agora,
        RECUPERACOES_CONCLUIDAS_NO_ULTIMO_MES.has(entradas[k].posicaoNaCategoria) ? DIAS_DO_CORTE_A_RETIRADA_NO_ULTIMO_MES : DIAS_DO_CORTE_A_RETIRADA,
      )];
    });
    const idsRecuperacoes = (await tx.insert(equipmentRecoveryCases).values(recuperacoes.map((r) => r.caso)).returning({ id: equipmentRecoveryCases.id })).map((r) => r.id);
    await tx.insert(equipmentRecoveryEvents).values(
      recuperacoes.flatMap((r, i) => r.eventos.map((e) => ({ ...e, caseId: idsRecuperacoes[i] }))),
    );

    // O histórico de consultas do mês (Consulta ISP, SPC, cadastral), os alertas
    // pelas regras reais e as regras que os produzem, sobre a carteira no
    // estado final — quem pagou nos últimos 30 dias já está em dia.
    //
    // A dívida de cada cliente fatura a fatura — as vencidas de hoje e as que a
    // recuperação quitou, com a data: é a foto de um aviso de dias atrás.
    const quitadaEm = new Map(historico.recuperacoes.map((r) => [r.erpRef, r.recuperadoEm]));
    const vencidasPorCliente = new Map<number, Array<{ valor: number; vencimento: Date; quitadaEm?: Date }>>();
    for (const f of [...linhasFaturas, ...mensalidades]) {
      const quitada = quitadaEm.get(f.erpRef ?? "");
      if (f.status !== "overdue" && !quitada) continue;
      vencidasPorCliente.set(f.customerId, [...(vencidasPorCliente.get(f.customerId) ?? []), { valor: Number(f.value), vencimento: f.dueDate, ...(quitada ? { quitadaEm: quitada } : {}) }]);
    }
    const clientesDaConsulta: ClienteDaConsulta[] = linhasClientes.map((linha, k) => ({
      ...linha,
      id: idsClientes[k],
      mensalidade: valorMensalidade(indiceDaEntrada(provider.id, entradas[k])),
      faturasVencidas: vencidasPorCliente.get(idsClientes[k]) ?? [],
    }));
    // A rede lida do mundo base, e não imaginada: consulta que custa crédito é a de CPF que a rede conhece.
    const cpfsCompartilhados = entradas.flatMap((e, k) => (e.personaIndexOverride === undefined ? [] : [linhasClientes[k].cpfCnpj]));
    const rede: ClienteDaRede[] = await tx.select({
      providerId: customers.providerId,
      name: customers.name,
      cpfCnpj: customers.cpfCnpj,
      status: customers.status,
      totalOverdueAmount: customers.totalOverdueAmount,
      maxDaysOverdue: customers.maxDaysOverdue,
      overdueInvoicesCount: customers.overdueInvoicesCount,
      contractStartDate: customers.contractStartDate,
      city: customers.city,
      state: customers.state,
    }).from(customers).where(and(inArray(customers.providerId, [...provedoresDoMundoBase]), inArray(customers.cpfCnpj, cpfsCompartilhados)));
    // As consultas que os provedores da rede fizeram sobre esses CPFs (as do
    // complemento do mundo base): entram na contagem de 30 e 90 dias da consulta
    // semeada, e cada alerta nasce de uma delas. A data se filtra em memória —
    // são poucas centenas de linhas.
    const consultasDaRede: ConsultaDaRede[] = (await tx.select({ providerId: ispConsultations.providerId, cpfCnpj: ispConsultations.cpfCnpj, createdAt: ispConsultations.createdAt })
      .from(ispConsultations)
      .where(and(inArray(ispConsultations.providerId, [...provedoresDoMundoBase]), inArray(ispConsultations.cpfCnpj, cpfsCompartilhados))))
      .flatMap((c) => (c.createdAt ? [{ providerId: c.providerId, cpfCnpj: c.cpfCnpj, createdAt: new Date(c.createdAt) }] : []));
    const consultas = consultasDoSandbox({ providerId: provider.id, nomeDoProvedor: provider.name, adminId: user.id, clientes: clientesDaConsulta, rede, consultasDaRede, agora });
    await tx.insert(ispConsultations).values(consultas.isp);
    await tx.insert(spcConsultations).values(consultas.spc);
    await tx.insert(bigdataConsultations).values(consultas.cadastral);
    const alertas = alertasExtrasDoSandbox({
      providerId: provider.id,
      clientes: clientesDaConsulta,
      equipamentos: linhasEquipamentos.map((e) => ({ customerId: e.customerId, status: e.status, value: e.value })),
      provedoresDaRede: provedoresDoMundoBase.map((id, i) => ({ id, nome: PROVEDORES_DA_DEMO[i].nome })),
      consultasDaRede,
      agora,
    });
    if (alertas.length > 0) await tx.insert(antiFraudAlerts).values(alertas);
    await tx.insert(antiFraudRules).values(regrasAntiFraudeDaDemo(provider.id));

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
      // Os três perfis prontos e o primeiro contato ligado, com os MESMOS ids da
      // coleção de agentes do simulado — sem isto os perfis apareciam "não
      // configurados" e "Iniciar contato" de equipamento respondia 409.
      agenteId: AGENTES_DA_DEMO.cobranca_ativos.id,
      agenteConfig: { ...agenteConfigDaDemo() },
    });

    // A linha do tempo da cobrança: a transição de cada caso que saiu da fila,
    // e logo abaixo o contato e a nota de cada conversa.
    const eventosDaCobranca: InsertCobrancaEvento[] = [];
    const casoVivoPorCursor = new Map<number, { id: number; customerId: number; status: string }>();
    casos.forEach((c, i) => {
      const status = (c.status ?? "aberto") as StatusDeCaso;
      if (status === "pago") eventosDaCobranca.push(eventoDoCasoPago(provider.id, user.id, { id: idsCasos[i], customerId: c.customerId, encerradoEm: c.encerradoEm! }));
      const recuperacao = recuperacaoPorCliente.get(c.customerId);
      if (recuperacao) eventosDaCobranca.push(...eventosDaRecuperacao30d(provider.id, user.id, { id: idsCasos[i], customerId: c.customerId }, recuperacao));
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
      if (caso) eventosDaCobranca.push(...eventosDoChatNaCobranca(provider.id, user.id, caso, conversa, ultimaFalaPorConversa.get(conversa.conversationId)));
    }

    // A trilha mecânica dos casos vivos: a negociação que a conversa promete, a
    // régua andando até a etapa de hoje e o pré-aviso do negativado. As
    // transições já estão acima; a trilha só mescla nelas a metadata do storage.
    const trilha = trilhaDosCasos({
      providerId: provider.id,
      adminId: user.id,
      politica: politica.lida,
      agora,
      casos: casos.flatMap((c, i): CasoDaTrilha[] => {
        const status = (c.status ?? "aberto") as StatusDeCaso;
        if (casoFechado(status)) return [];
        const cursor = cursorPorCliente.get(c.customerId)!;
        const conversa = conversas.find((x) => x.origem === "cobranca" && x.cursor === cursor);
        return [{
          id: idsCasos[i],
          customerId: c.customerId,
          status,
          carteira: c.carteira as Carteira,
          etapaAtual: (c.etapaAtual ?? null) as EtapaId | null,
          quadranteDna: c.quadranteDna ?? null,
          tom: c.tom ?? null,
          abertoEm: c.abertoEm!,
          statusDesde: c.statusDesde!,
          // A proposta que `eventosDaTransicaoNaCobranca` gravou no meio da conversa.
          propostaEm: conversa ? meioDaConversa(conversa) : null,
          valorAtual: Number(c.valorAtual),
          diasAtraso: linhasClientes[indicePorCursor.get(cursor)!].maxDaysOverdue ?? 0,
        }];
      }),
    });
    if (trilha.negociacoes.length > 0) {
      const idsNegociacoes = (await tx.insert(cobrancaNegociacoes).values(trilha.negociacoes.map((n) => n.linha)).returning({ id: cobrancaNegociacoes.id })).map((r) => r.id);
      const idsParcelas = (await tx.insert(cobrancaParcelas)
        .values(trilha.negociacoes.flatMap((n, i) => n.parcelas.map((p) => ({ ...p, negociacaoId: idsNegociacoes[i] }))))
        .returning({ id: cobrancaParcelas.id })).map((r) => r.id);
      let primeiraParcela = 0;
      trilha.negociacoes.forEach((n, i) => {
        const parcelaIds = idsParcelas.slice(primeiraParcela, primeiraParcela + n.parcelas.length);
        primeiraParcela += n.parcelas.length;
        const r = eventosDaNegociacao(n, { negociacaoId: idsNegociacoes[i], parcelaIds });
        mesclarNaTransicao(eventosDaCobranca, n.casoId, "negociacao_proposta", r.metadataDaProposta);
        mesclarNaTransicao(eventosDaCobranca, n.casoId, "acordo_aceito", r.metadataDoAceite);
        eventosDaCobranca.push(...r.eventos);
      });
    }
    eventosDaCobranca.push(...trilha.eventos);

    await tx.insert(chatBullqConversas).values(linhasConversas);
    await inserirPorColunas(tx, cobrancaEventos, eventosDaCobranca);

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
