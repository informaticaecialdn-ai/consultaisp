import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SESSION_SECRET` precisa existir ANTES de qualquer import avaliar
 * `server/utils/crypto.ts` (a chave do `apiToken` cifrado da integração
 * "demo" deriva dele) ou `server/auth.ts`. `DEMO_MODE` precisa existir antes
 * do import de `server/erp/connectors/demo.ts` (auto-registro condicionado a
 * `emModoDemo()`, avaliado uma vez, na carga do módulo). Os dois em
 * `vi.hoisted` — mesmo padrão de `server/demo/mundo-base.test.ts`.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sandbox";
  process.env.DEMO_MODE = "true";
});

/**
 * Banco de mentira, no mesmo molde de `server/demo/mundo-base.test.ts`: o
 * compilador SQL REAL do Drizzle (via `drizzle-orm/pg-proxy`) fala com o
 * callback abaixo, que reconstrói cada INSERT/SELECT/DELETE e acumula as
 * linhas em memória. Estende o de `mundo-base.test.ts` com um handler de
 * DELETE, porque `apagarSandbox` apaga de verdade (mundo-base.ts nunca
 * apagava nada).
 *
 * Sem `beforeEach` limpando `banco.linhas`: os `it()` abaixo são
 * deliberadamente sequenciais (mesmo padrão do arquivo irmão).
 */
const banco = vi.hoisted(() => ({
  linhas: new Map<string, Record<string, unknown>[]>(),
  proximoId: new Map<string, number>(),
  db: null as any,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

/**
 * O chat simulado guarda o que o visitante fez na memória do processo, fora do
 * banco de mentira — o único jeito de ver que `apagarSandbox` o esvazia é
 * espiar a chamada. O espião repassa para a função real (que
 * `chat-simulado.test.ts` já prova esvaziar só aquele provedor).
 */
vi.mock("./chat-simulado", async (importOriginal) => {
  const real = await importOriginal<typeof import("./chat-simulado")>();
  return { ...real, limparChatSimuladoDoProvedor: vi.fn(real.limparChatSimuladoDoProvedor) };
});

/**
 * O complemento do mundo base também passa por um espião que repassa para a
 * função real: só os testes do fim do arquivo o fazem falhar, uma vez cada,
 * para provar que o `/demo` não cai com ele.
 */
vi.mock("./mundo-base", async (importOriginal) => {
  const real = await importOriginal<typeof import("./mundo-base")>();
  return { ...real, complementarMundoBase: vi.fn(real.complementarMundoBase) };
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import {
  providers,
  users,
  customers,
  invoices,
  equipment,
  erpIntegrations,
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  antiFraudAlerts,
  proactiveAlerts,
  ispConsultations,
  spcConsultations,
  // As tabelas abaixo não são escritas por `criarSandbox`, mas
  // `storage.deleteProvider` (reusada por `apagarSandbox`, rodada de
  // correção 11/09/2026) lê/escreve nelas, e o teste de completude semeia
  // TODA tabela com FK para `providers` — o banco de mentira precisa do
  // mapa de colunas de cada uma delas para não estourar "Tabela sem mapa".
  contracts,
  providerInvoices,
  creditOrders,
  planChanges,
  providerPartners,
  erpSyncLogs,
  supportThreads,
  supportMessages,
  acessosSuporte,
  cobrancaConfissoes,
  cobrancaConfissoesPdf,
  cobrancaPolitica,
  antiFraudRules,
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
} from "@shared/schema";
// Os módulos de schema que `@shared/schema` NÃO reexporta. O teste "sem
// exceção" deriva o universo de tabelas da lista `schema` do
// `drizzle.config.ts` (ver `MODULOS_DO_SCHEMA`, no describe) — cada arquivo
// listado lá precisa estar importado aqui, senão o teste acende vermelho.
import * as schemaCrm from "@shared/crm-schema";
import * as schemaComunicacao from "@shared/schema-comunicacao";
import * as schemaCobrancaFaturas from "@shared/schema-cobranca-faturas";
import * as schemaGestaoCobranca from "@shared/schema-gestao-cobranca";
import * as schemaChatAutonomiaSeguranca from "@shared/chat-autonomia-seguranca";
import { cobrancaPreAvisos, cobrancaQuitacoes } from "@shared/schema-cobranca-faturas";
import { chatAutonomiaAutorizacao, chatAutonomiaSeguranca } from "@shared/chat-autonomia-seguranca";
// As tabelas das migrações 0039–0042 (comunicação, canais, chat multicanal e
// gestão operacional da cobrança): `criarSandbox` não as escreve, mas a
// limpeza precisa apagá-las e o teste de completude as semeia — o banco de
// mentira precisa do mapa de colunas de cada uma.
import {
  chatMulticanalConfig,
  chatMulticanalMensagens,
  cobrancaAvisosConfig,
  cobrancaCanaisConfig,
  cobrancaComunicacaoConfig,
  cobrancaComunicacoes,
  cobrancaPreferenciasContato,
} from "@shared/schema-comunicacao";
import { cobrancaContatosOrcamento, cobrancaContestacoes, cobrancaGestaoConfig } from "@shared/schema-gestao-cobranca";
import {
  criarSandbox,
  sandboxesExpirados,
  contarSandboxesVivos,
  apagarSandbox,
  SALDO_INICIAL,
} from "./sandbox.service";
import { custosInformados, validarPolitica, type Economia } from "@shared/cobranca/politica";
import { janelaDoChat } from "@shared/cobranca/automacao-chat";
import { TIPOS_DE_AGENTE } from "@shared/chat-agentes";
import { dataLocal } from "../services/chat/chat-autonomia-politica";
import { empresaPublicaSimulada } from "./cnpj-simulado";
import { primeiraNegativacaoPermitida } from "./semeadura-negociacoes";
import { regrasAntiFraudeDaDemo } from "./semeadura-consultas";
import { precoDoPlano } from "@shared/cobranca/economia";
import { EtapasConfigSchema, etapaParaAtraso, etapasDaCarteira, prescrita, resolverEtapas } from "@shared/cobranca/regua";
import { AcordoSchema } from "@shared/cobranca/acordo";
import { parcelasDaDescricao } from "@shared/cobranca/multa";
import { normalizarMotivoCorte } from "@shared/motivo-corte";
import { PLAN_PRICES } from "@shared/planos";
import { montarBoard, type EntradaCasoBoard } from "../services/recovery-board.service";
import { STATUS_DE_CASO, eventoDaTransicaoDeCaso, statusAposNegociacaoDesfeita, transicaoDeCaso, type StatusDeCaso } from "@shared/cobranca/estados";
import { DIVIDA_MINIMA_PARA_CASO, MOTIVO_DIVIDA_ZERADA, dnaDoCaso, prioridadeSugerida } from "../services/cobranca/regua-diaria.service";
import { carteiraDoStatusErp, STATUS_DE_CLIENTE_ATUAL } from "../storage/cobranca.storage";
import { ACAO_AO_RECEBER_MENSAGEM, ACAO_PADRAO_APOS_RESPOSTA, TAMANHO_MAXIMO_DA_ACAO } from "../services/chat/chat-atendimento.service";
import { ACOES_COMUNS_DO_CHAT } from "@/components/chat/tipos";
import {
  EQUIPMENT_STATUSES,
  calcularPrazoRetirada,
  casoEstaEncerrado,
  equipamentoTemRetiradaPendente,
  validarSinalBureau,
} from "../services/equipment-recovery-rules";
import { PROVEDORES_DA_DEMO, INDICE_MIGRADOR_DE_EXEMPLO, CPFS_COMPARTILHADOS, complementarMundoBase, semearMundoBase } from "./mundo-base";
import { regredirParaOFormatoAntigo } from "./formato-antigo.fixture";
import { limparSandboxesExpirados } from "./limpeza.service";
import { AGENTES_DA_DEMO, agenteConfigDaDemo, limparChatSimuladoDoProvedor, roteiroDaConversa, type LinhaDaConversa } from "./chat-simulado";
import { economiaDoCliente } from "@shared/cobranca/ficha360";
import { cpfFicticio } from "./pessoas-ficticias";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
import { detectMigrator } from "../services/migrator-detection.service";
import { decryptField } from "../utils/crypto";
import { motivosGravados, rotuloDoAlerta } from "@shared/antifraude-avaliacao";
import { maskAlertForProvider } from "../utils/mask-alert";
import { casoFechado } from "@shared/cobranca/estados";
import { logger } from "../logger";
// Efeito colateral: com DEMO_MODE=true (acima), registra o conector "demo" no registry.
import "../erp/connectors/demo";

const TABELAS = [
  providers,
  users,
  customers,
  invoices,
  equipment,
  erpIntegrations,
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  antiFraudAlerts,
  proactiveAlerts,
  ispConsultations,
  spcConsultations,
  contracts,
  providerInvoices,
  creditOrders,
  planChanges,
  providerPartners,
  erpSyncLogs,
  supportThreads,
  supportMessages,
  acessosSuporte,
  cobrancaConfissoes,
  cobrancaConfissoesPdf,
  cobrancaPolitica,
  antiFraudRules,
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
  cobrancaPreAvisos,
  cobrancaQuitacoes,
  chatAutonomiaAutorizacao,
  chatAutonomiaSeguranca,
  chatMulticanalConfig,
  chatMulticanalMensagens,
  cobrancaAvisosConfig,
  cobrancaCanaisConfig,
  cobrancaComunicacaoConfig,
  cobrancaComunicacoes,
  cobrancaPreferenciasContato,
  cobrancaContatosOrcamento,
  cobrancaContestacoes,
  cobrancaGestaoConfig,
];
/** tabela (nome real do banco) -> (coluna do banco -> chave camelCase que o Drizzle usa em JS). */
const chavePorColuna = new Map(
  TABELAS.map((t) => [
    getTableName(t),
    new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave])),
  ]),
);
/** tabela (nome real do banco) -> (chave camelCase -> objeto de coluna do Drizzle) — usado por `valorPadraoDaColuna` para checar `hasDefault`/`default`/`dataType` sem reconstruir o schema à mão. */
const colunaPorCampo = new Map(TABELAS.map((t) => [getTableName(t), getTableColumns(t) as Record<string, any>]));

function proximoId(tabela: string): number {
  const atual = (banco.proximoId.get(tabela) ?? 0) + 1;
  banco.proximoId.set(tabela, atual);
  return atual;
}

/** `"id"` ou `"tabela"."id"` -> `"id"`. */
function nomesDeColuna(textoDeColunas: string): string[] {
  return textoDeColunas.split(", ").map((c) => {
    const m = c.match(/^(?:"(\w+)"\.)?"(\w+)"$/);
    if (!m) throw new Error(`Coluna nao reconhecida pelo banco de mentira: ${c}`);
    return m[2];
  });
}

/**
 * O decoder de TIMESTAMP do drizzle-orm (`PgTimestamp.mapFromDriverValue`,
 * para uma coluna sem `withTimezone` — o caso de `invoices.dueDate`,
 * `customers.cortadoEm` etc.) monta a data como `valor + "+0000"`: ele
 * espera de volta exatamente o que um driver real de Postgres devolveria
 * para "timestamp without time zone", uma string SEM sufixo de fuso. A
 * GRAVAÇÃO (`mapToDriverValue`) grava `date.toISOString()`, que termina em
 * "Z" — devolver essa mesma string na LEITURA vira "...Z+0000", uma data
 * invalida (confirmado por sonda isolada contra o drizzle-orm real antes de
 * escrever isto). `mundo-base.test.ts` nunca precisou disto porque seus
 * helpers leem `banco.linhas` direto, sem passar pelo decoder — este arquivo
 * precisa porque o conector "demo" (produção) FAZ um SELECT de verdade e lê
 * `fatura.dueDate` já decidido.
 */
function paraFormatoDeDriverReal(valor: unknown): unknown {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valor)) {
    return valor.slice(0, -1);
  }
  return valor;
}

/** Linhas (objeto, chave camelCase) -> array-of-arrays na ordem das colunas pedidas — o formato que o pg-proxy espera de volta. */
function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => paraFormatoDeDriverReal(mapa.get(c) ? linha[mapa.get(c)!] ?? null : null)));
}

/**
 * O valor que um Postgres de verdade aplicaria para uma coluna que o INSERT
 * marcou como `default` (rodada de correção, 12/09/2026). Antes desta função
 * TODA coluna não-`id` virava `null` aqui — `defaultNow()` incluído —, e isso
 * era o defeito real por trás do "sweep apaga 20" documentado no relatório da
 * rodada: `providers.createdAt` (`defaultNow()`) nascia `null` para todo
 * provider inserido sem valor explícito (todo sandbox de `criarSandbox()`, que
 * nunca passa `createdAt`), e `sandboxesExpirados()` trata `createdAt` nulo
 * como epoch — mais velho que 24h, sempre "expirado". Como este arquivo é
 * sequencial e cumulativo (ver o comentário no topo), cada sandbox de um
 * `it()` anterior que nunca chamou `envelhecer`/`apagarSandbox` ficava
 * empilhado como "já expirado" por este defeito, não pela idade real.
 *
 * Só dois casos dão para calcular em JS puro, sem um Postgres de verdade para
 * avaliar a expressão:
 *   1. um literal puro (`.default(valor)`, sem `sql\`...\``) — usa direto;
 *   2. `defaultNow()` — que o Drizzle grava como `default: sql\`now()\``,
 *      nunca como `defaultFn` — vira "agora". Só entra aqui quando a coluna é
 *      `dataType "date"` (timestamp): conferido por grep em `shared/schema.ts`
 *      antes de escrever isto — nenhuma OUTRA coluna date/timestamp do schema
 *      usa `sql\`...\`` como default, então a checagem por dataType basta e
 *      não depende de inspecionar o texto interno do fragmento SQL.
 * Qualquer outra expressão SQL (ex.: `sql\`'{}'::text[]\`` num array, ou
 * `sql\`'[]'::jsonb\`` num jsonb) cai em `null` — o MESMO comportamento de
 * antes desta correção, porque não há Postgres aqui para avaliar a expressão,
 * e nenhum teste deste arquivo depende do valor dessas colunas.
 */
function valorPadraoDaColuna(coluna: { hasDefault: boolean; default?: unknown; defaultFn?: () => unknown; dataType: string } | undefined): unknown {
  if (!coluna?.hasDefault) return null;
  if (typeof coluna.defaultFn === "function") return coluna.defaultFn();
  const bruto = coluna.default;
  if (bruto === undefined) return null;
  if (is(bruto, SQL)) return coluna.dataType === "date" ? new Date().toISOString() : null;
  return bruto;
}

/**
 * Reconstrói um INSERT de verdade — `insert into "t" ("a","b") values ($1,$2),($3,$4) [returning ...]`
 * — e acumula cada tupla como linha (camelCase), atribuindo `id` auto-incremental
 * quando a coluna não veio na lista (bulk insert nunca informa `id`, e um
 * `.returning()` SEM argumento — `storage.createProvider`/`createUser` — lista
 * TODAS as colunas da tabela, mas isso não muda o formato: é só uma lista
 * mais longa de identificadores entre aspas).
 */
function processarInsert(sqlTexto: string, params: unknown[]): { tabela: string; linhasCriadas: Record<string, unknown>[] } {
  const m = sqlTexto.match(/^insert into "(\w+)" \(([^)]*)\) values (.+?)(?: returning (.+))?$/s);
  if (!m) throw new Error(`INSERT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const tabela = m[1];
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunasDaTabela = colunaPorCampo.get(tabela);
  const colunas = m[2].split(", ").map((c) => c.replace(/"/g, ""));
  const tuplas = Array.from(m[3].matchAll(/\(([^()]*)\)/g)).map((t) => t[1].split(", "));

  const acumulado = banco.linhas.get(tabela) ?? [];
  const linhasCriadas: Record<string, unknown>[] = [];
  for (const tupla of tuplas) {
    const linha: Record<string, unknown> = {};
    colunas.forEach((coluna, idx) => {
      const chave = mapa.get(coluna);
      if (!chave) throw new Error(`Coluna "${coluna}" nao mapeada em "${tabela}"`);
      const valorBruto = tupla[idx];
      if (valorBruto === "default") {
        linha[chave] = coluna === "id" ? proximoId(tabela) : valorPadraoDaColuna(colunasDaTabela?.[chave]);
        return;
      }
      const ref = valorBruto?.match(/^\$(\d+)$/);
      if (!ref) throw new Error(`Valor inesperado (nao e parametro nem default) em ${tabela}.${coluna}: ${valorBruto}`);
      linha[chave] = params[Number(ref[1]) - 1];
    });
    acumulado.push(linha);
    linhasCriadas.push(linha);
  }
  banco.linhas.set(tabela, acumulado);
  return { tabela, linhasCriadas };
}

/**
 * Avalia um trecho de WHERE contra uma linha — três formas, que juntas
 * cobrem tudo que este par de arquivos e `storage.deleteProvider` emitem:
 * `"t"."col" = $N` (igualdade), `"t"."col" in ($N, $M, ...)` (usada pelo
 * `inArray` de `deleteProvider` para apagar `support_messages` pelos ids de
 * thread), e o literal `false` (o que o Drizzle gera para um `inArray` com
 * lista VAZIA — nenhuma linha bate). Todas as condições encontradas são
 * combinadas em E, que é tudo que os dois arquivos precisam.
 *
 * Compilado UMA vez por comando, e não a cada linha (Leva 2, fase B): com as
 * faturas históricas e as consultas da rede, reler o texto do WHERE linha a
 * linha sobre dezenas de milhares de linhas levava a criação do sandbox para
 * perto do tempo-limite de cada `it()`.
 */
function compilarCondicoes(whereTexto: string, mapa: Map<string, string>, params: unknown[]): (linha: Record<string, unknown>) => boolean {
  if (whereTexto.trim() === "false") return () => false;
  const igualdades = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" = \$(\d+)/g), (c) => [mapa.get(c[1])!, params[Number(c[2]) - 1]] as const);
  const listas = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" in \(([^)]*)\)/g), (c) =>
    [mapa.get(c[1])!, new Set(c[2].split(", ").map((ref) => params[Number(ref.replace("$", "")) - 1]))] as const);
  return (linha) => igualdades.every(([chave, valor]) => linha[chave] === valor) && listas.every(([chave, permitidos]) => permitidos.has(linha[chave]));
}

/** `select <cols> from "t" [where ...]` — igualdade, `in` ou `false`, ver `compilarCondicoes`. */
function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    linhas = linhas.filter(compilarCondicoes(whereTexto, mapa, params));
  }
  return projetar(tabela, linhas, textoDeColunas);
}

/**
 * `select count(*)::int from "t" [where ...]` — o guard de LGPD de
 * `storage.deleteProvider` (`server/storage/providers.storage.ts:191-194`),
 * que conta `acessos_suporte` antes de decidir se apaga. Formato conferido
 * por sonda isolada contra o drizzle-orm real antes de escrever isto: SEM
 * alias (`sql<number>` é só o tipo do TypeScript, não aparece no SQL).
 */
function processarCount(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select count\(\*\)::int from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`COUNT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, whereTexto] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const passa = whereTexto ? compilarCondicoes(whereTexto, mapa, params) : () => true;
  const linhas = (banco.linhas.get(tabela) ?? []).filter(passa);
  return [[String(linhas.length)]];
}

/**
 * `delete from "t" [where ...]` — `apagarSandbox` e `storage.deleteProvider`
 * (reusada por ela, rodada de correção 11/09/2026) são os únicos códigos
 * deste par de arquivos que apagam (mundo-base.ts nunca precisou). Remove do
 * banco de mentira toda linha que bater com as condições — mesmo avaliador
 * que `processarSelect` usa, igualdade/`in`/`false` incluídos.
 */
function processarDelete(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^delete from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`DELETE nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, whereTexto] = m;
  const linhasAtuais = banco.linhas.get(tabela) ?? [];
  if (!whereTexto) {
    banco.linhas.set(tabela, []);
    return;
  }
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const passa = compilarCondicoes(whereTexto, mapa, params);
  const restantes = linhasAtuais.filter((linha) => !passa(linha));
  banco.linhas.set(tabela, restantes);
}

/**
 * `update "t" set "a" = $1, "b" = $2 where ...` — só a forma de valores
 * simples, a que `tentarCriarSandbox` usa para zerar a dívida dos clientes da
 * recuperação dos últimos 30 dias (Leva 2, fase B). Qualquer expressão SQL no
 * `set` (o relógio do mundo base, por exemplo) continua recusada alto.
 */
function processarUpdate(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^update "(\w+)" set (.+?) where (.+)$/s);
  if (!m) throw new Error(`UPDATE nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, textoDoSet, whereTexto] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const atribuicoes = textoDoSet.split(", ").map((trecho) => {
    const a = trecho.match(/^"(\w+)" = \$(\d+)$/);
    if (!a || !mapa.get(a[1])) throw new Error(`SET nao reconhecido pelo banco de mentira: ${trecho}`);
    return [mapa.get(a[1])!, params[Number(a[2]) - 1]] as const;
  });
  const passa = compilarCondicoes(whereTexto, mapa, params);
  for (const linha of banco.linhas.get(tabela) ?? []) {
    if (!passa(linha)) continue;
    for (const [chave, valor] of atribuicoes) linha[chave] = valor;
  }
}

/**
 * `insert into "t" ("a", "b") select * from unnest($1::tipo[], $2::tipo[])` — a
 * escrita por coluna de `tentarCriarSandbox` (clientes e faturas,
 * `inserirPorColunas`): cada parâmetro é a coluna inteira. Coluna fora da lista
 * leva o default, como no INSERT de verdade.
 */
function processarInsertPorColunas(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^insert into "(\w+)" \(([^)]*)\) select \* from unnest\((.+)\)$/s);
  if (!m) throw new Error(`INSERT por colunas nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, textoDeColunas, textoDasListas] = m;
  const mapa = chavePorColuna.get(tabela);
  const colunasDaTabela = colunaPorCampo.get(tabela);
  if (!mapa || !colunasDaTabela) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const chaves = textoDeColunas.split(", ").map((c) => {
    const chave = mapa.get(c.replace(/"/g, ""));
    if (!chave) throw new Error(`Coluna ${c} nao mapeada em "${tabela}"`);
    return chave;
  });
  const listas = Array.from(textoDasListas.matchAll(/\$(\d+)::/g), (r) => params[Number(r[1]) - 1] as unknown[]);
  if (listas.length !== chaves.length) throw new Error(`INSERT por colunas com ${chaves.length} colunas e ${listas.length} listas em "${tabela}"`);
  const acumulado = banco.linhas.get(tabela) ?? [];
  for (let i = 0; i < listas[0].length; i++) {
    const linha: Record<string, unknown> = {};
    for (const [chave, coluna] of Object.entries(colunasDaTabela)) {
      if (!chaves.includes(chave)) linha[chave] = chave === "id" ? proximoId(tabela) : valorPadraoDaColuna(coluna);
    }
    chaves.forEach((chave, j) => { linha[chave] = listas[j][i]; });
    acumulado.push(linha);
  }
  banco.linhas.set(tabela, acumulado);
}

beforeAll(() => {
  const proxy = drizzle(async (sqlTexto: string, params: unknown[]) => {
    if (/^insert into "\w+" \([^)]*\) select \* from unnest\(/.test(sqlTexto)) {
      processarInsertPorColunas(sqlTexto, params);
      return { rows: [] };
    }
    // O lock do complemento do mundo base (`complementarMundoBase`): aqui não há concorrência a travar.
    if (sqlTexto.startsWith("select pg_advisory_xact_lock(")) {
      return { rows: [] };
    }
    if (sqlTexto.startsWith("update ")) {
      processarUpdate(sqlTexto, params);
      return { rows: [] };
    }
    if (sqlTexto.startsWith("insert into")) {
      const retorno = sqlTexto.match(/ returning (.+)$/s);
      const { tabela, linhasCriadas } = processarInsert(sqlTexto, params);
      return { rows: retorno ? projetar(tabela, linhasCriadas, retorno[1]) : [] };
    }
    if (sqlTexto.startsWith("select count(*)::int from")) {
      return { rows: processarCount(sqlTexto, params) };
    }
    if (sqlTexto.startsWith("select")) {
      return { rows: processarSelect(sqlTexto, params) };
    }
    if (sqlTexto.startsWith("delete from")) {
      processarDelete(sqlTexto, params);
      return { rows: [] };
    }
    throw new Error(`SQL nao suportado pelo banco de mentira: ${sqlTexto}`);
  });
  // O `pg-proxy` de verdade RECUSA transação. `criarSandbox`/`apagarSandbox`
  // usam `db.transaction(...)` — mesmo substituto de `mundo-base.test.ts`:
  // chama o callback com o MESMO proxy, o que basta para provar que as
  // escritas/remoções acontecem "dentro".
  banco.db = Object.assign(proxy, {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxy),
  });
});

// ── Leituras diretas do banco de mentira ────────────────────────────────────

async function clientesDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("customers") ?? []).filter((c) => c.providerId === providerId);
}

async function equipamentosDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("equipment") ?? []).filter((e) => e.providerId === providerId);
}

async function providerDe(providerId: number): Promise<Record<string, unknown>> {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.id === providerId);
  if (!linha) throw new Error(`Provider nao encontrado: ${providerId}`);
  return linha;
}

async function casosDeCobrancaDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("cobranca_casos") ?? []).filter((c) => c.providerId === providerId);
}

async function faturasDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("invoices") ?? []).filter((f) => f.providerId === providerId);
}

async function integracaoDe(providerId: number): Promise<Record<string, unknown> | undefined> {
  return (banco.linhas.get("erp_integrations") ?? []).find((i) => i.providerId === providerId);
}

async function alertasAntiFraudeDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("anti_fraud_alerts") ?? []).filter((a) => a.providerId === providerId);
}

function idDe(subdomain: string): number {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.subdomain === subdomain);
  if (!linha) throw new Error(`Provedor nao semeado: ${subdomain}`);
  return linha.id as number;
}

/** Todos os CPFs de clientes dos 5 provedores do mundo base — lidos do banco de mentira, sem recalcular índice nenhum. */
async function todosOsCpfsDaBase(): Promise<Set<string>> {
  const idsDaBase = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));
  const cpfs = (banco.linhas.get("customers") ?? [])
    .filter((c) => idsDaBase.has(c.providerId as number))
    .map((c) => c.cpfCnpj as string);
  return new Set(cpfs);
}

/** Um CPF de cada situação, para a tela sugerir o que testar — deduzido por PROPRIEDADE, nunca por fórmula de índice. */
async function cpfsDeExemplo(providerId: number): Promise<Array<{ situacao: string; cpf: string }>> {
  const clientes = await clientesDe(providerId);
  const cpfsDaBase = await todosOsCpfsDaBase();

  const limpo = clientes.find(
    (c) => c.paymentStatus === "current" && c.status === "active" && !cpfsDaBase.has(c.cpfCnpj as string),
  );
  // Em dia AQUI e o primeiro CPF da rede: o sandbox também tem inadimplentes e
  // quem pagou nos últimos 30 dias com CPF da rede (revisão da fase B).
  const posicaoNaRede = new Map(CPFS_COMPARTILHADOS.map((cpf, i) => [cpf, i]));
  const devendoNaRede = clientes
    .filter((c) => c.paymentStatus === "current" && c.status === "active" && cpfsDaBase.has(c.cpfCnpj as string))
    .sort((a, b) => (posicaoNaRede.get(a.cpfCnpj as string) ?? Infinity) - (posicaoNaRede.get(b.cpfCnpj as string) ?? Infinity))[0];
  if (!limpo) throw new Error("nenhum cliente 'limpo' encontrado no sandbox");
  if (!devendoNaRede) throw new Error("nenhum cliente 'devendo_na_rede' encontrado no sandbox");

  return [
    { situacao: "limpo", cpf: limpo.cpfCnpj as string },
    { situacao: "devendo_na_rede", cpf: devendoNaRede.cpfCnpj as string },
    { situacao: "migrador_serial", cpf: cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO) },
  ];
}

/**
 * A faixa de risco que o sync grava (server/storage/customers.storage.ts:287).
 * A expressão não é exportada; o teste "risk_tier usa o vocabulario e a regra
 * do sync" confere que ela continua escrita assim naquele arquivo.
 */
function faixaDeRiscoDoSync(maxDaysOverdue: number): string {
  return maxDaysOverdue > 180 ? "critical" : maxDaysOverdue > 90 ? "high" : maxDaysOverdue > 60 ? "medium" : "low";
}

/** Move `createdAt` do sandbox `ms` milissegundos para trás — simula o tempo passar sem esperar 24h de verdade. */
async function envelhecer(providerId: number, ms: number): Promise<void> {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.id === providerId);
  if (!linha) throw new Error(`Provider nao encontrado: ${providerId}`);
  linha.createdAt = new Date(Date.now() - ms);
}

describe("sandbox do visitante", () => {
  it("nasce com a carteira de um provedor de verdade", async () => {
    const inicio = performance.now();
    const s = await criarSandbox();
    // eslint-disable-next-line no-console
    console.log(`[medicao] criarSandbox() contra o banco de mentira: ${(performance.now() - inicio).toFixed(1)}ms (inclui semearMundoBase, primeira chamada)`);
    expect(s.subdomain).toMatch(/^sandbox-[a-f0-9]{16}$/);
    const clientes = await clientesDe(s.providerId);
    expect(clientes).toHaveLength(1500);
    // 225 inadimplentes ATIVOS, menos os 3 que pagaram nos últimos 30 dias
    // (Leva 2, fase B); os ex-clientes que saíram devendo também são
    // `overdue` (a regra do sync), mas nunca contam na carteira de ativos.
    expect(clientes.filter((c) => c.status === "active" && c.paymentStatus === "overdue")).toHaveLength(222);
    expect(clientes.filter((c) => c.status === "cancelled")).toHaveLength(150);
    // 90 em dia + 30 ex-clientes + 75 inadimplentes ativos com a ONU em comodato
    // (Leva 2): um provedor FTTH não tem só o cliente em dia com equipamento.
    expect(await equipamentosDe(s.providerId)).toHaveLength(195);
    // O saldo do visitante mora todo em ispCredits; spcCredits nasce em zero.
    // O dashboard SOMA os dois bolsos (server/storage/dashboard.storage.ts), e
    // ate 12/09/2026 os dois nasciam em SALDO_INICIAL: o visitante via 1.000
    // creditos no painel e 500 na tela de consulta, que le so ispCredits.
    const provider = await providerDe(s.providerId);
    expect(provider.ispCredits).toBe(SALDO_INICIAL);
    expect(provider.spcCredits, "o painel somaria um saldo que nenhuma consulta gasta").toBe(0);
    // Primeiro criarSandbox do processo: paga o mundo base inteiro. Sob a carga da
    // suíte completa passou de 5 s (5,7 s no deploy de 16/09/2026); mesmo teto do
    // teste de concorrência.
  }, 60_000);

  it("273 CPFs da carteira tambem existem na rede — 150 em dia e 123 inadimplentes — senao a consulta so diz 'nada consta' e nenhum alerta tem consulta de verdade", async () => {
    const s = await criarSandbox();
    const cpfsDaBase = await todosOsCpfsDaBase();
    const clientes = await clientesDe(s.providerId);
    const naRede = clientes.filter((c) => cpfsDaBase.has(c.cpfCnpj as string));
    expect(naRede).toHaveLength(273);
    // Revisão da fase B (13/09/2026): o alerta de fuga nasce de consulta da rede,
    // e a rede só consulta CPF compartilhado — o devedor precisa ser um deles.
    expect(naRede.filter((c) => c.status === "active" && c.paymentStatus === "current")).toHaveLength(153);
    expect(naRede.filter((c) => c.status === "active" && c.paymentStatus === "overdue")).toHaveLength(120);
  });

  it("todo cliente ja nasce com coordenada — o mapa de calor nao espera geocodificacao", async () => {
    const s = await criarSandbox();
    const semCoordenada = (await clientesDe(s.providerId)).filter((c) => !c.latitude || !c.longitude);
    expect(semCoordenada).toHaveLength(0);
  });

  it("tres CPFs de exemplo, um de cada situacao, para a tela sugerir o que testar", async () => {
    const s = await criarSandbox();
    const exemplos = await cpfsDeExemplo(s.providerId);
    expect(exemplos.map((e) => e.situacao).sort()).toEqual(["devendo_na_rede", "limpo", "migrador_serial"]);
  });

  /**
   * Teste dedicado da rodada de correção (12/09/2026) — prova, isolada de
   * qualquer outro `it()`, que o banco de mentira aplica o default REAL de
   * `providers.createdAt` (`defaultNow()`) num INSERT sem valor explícito
   * (exatamente o que `tentarCriarSandbox` faz), em vez de gravar `null`.
   *
   * Sem `valorPadraoDaColuna` (o fix), `criadoEm` seria `null`, este teste
   * falharia nas duas asserções abaixo (`null` não é uma `Date` válida, e
   * `sandboxesExpirados()` trataria este sandbox recém-nascido como epoch —
   * "mais velho que 24h" — incluindo-o na lista logo após criar).
   */
  it("um sandbox recem-criado nasce com createdAt de AGORA (defaultNow() aplicado pelo banco de mentira), nunca null — e por isso nao aparece como expirado", async () => {
    const s = await criarSandbox();
    const provider = await providerDe(s.providerId);

    expect(provider.createdAt, "createdAt nulo — o banco de mentira nao aplicou o default de providers.createdAt").not.toBeNull();
    const idadeMs = Date.now() - new Date(provider.createdAt as string).getTime();
    expect(idadeMs, "createdAt deveria ser proximo de agora, nao uma data arbitraria").toBeLessThan(60_000);

    // Prova pelo caminho REAL (db.select + decode de verdade do Drizzle):
    // um sandbox recem-criado nunca deveria aparecer como candidato a apagar.
    expect(await sandboxesExpirados()).not.toContain(s.providerId);
  });

  /**
   * Usa `toContain`/`not.toContain`, não `toEqual([velho.providerId])`: este
   * arquivo é sequencial e cumulativo, e outros `it()` (antes e depois deste)
   * também chamam `criarSandbox()` sem envelhecer nem apagar o resultado — a
   * lista de `sandboxesExpirados()` pode legitimamente conter outros ids além
   * de `velho`. O teste prova exatamente as duas coisas do seu nome (o
   * sandbox velho ENTRA, a rede NUNCA entra) e nada além disso.
   *
   * Nota da rodada de correção (12/09/2026): antes desta correção a lista
   * também vinha inflada por um defeito do banco de mentira — todo sandbox
   * criado sem `envelhecer`/`apagarSandbox` ficava com `createdAt` NULO
   * (tratado como epoch, "sempre expirado"), não só pela acumulação legítima
   * de outros `it()`. As duas asserções abaixo já passavam antes E continuam
   * passando agora, mas antes toleravam RUÍDO por acidente (a lista incluía
   * dezenas de ids que não deveriam estar expirados); agora toleram apenas a
   * acumulação legítima do desenho do arquivo. Ver `valorPadraoDaColuna`
   * (acima) e o relatório da rodada para a contagem medida antes/depois.
   */
  it("expira so o sandbox, nunca o mundo base", async () => {
    const velho = await criarSandbox();
    await envelhecer(velho.providerId, 25 * 60 * 60 * 1000);
    const ids = await sandboxesExpirados();
    expect(ids).toContain(velho.providerId);
    for (const p of PROVEDORES_DA_DEMO) expect(ids).not.toContain(idDe(p.subdomain));
  });

  /**
   * Revisão final de segurança antes da demonstração pública (item 3):
   * `contarSandboxesVivos` contava TODO sandbox da tabela, expirado ou não —
   * um sandbox com mais de 24h continuava ocupando vaga no teto até a
   * limpeza HORÁRIA o alcançar (ou para sempre, se a limpeza atrasar ou
   * parar). O teste mede por DELTA, não por valor absoluto: os `it()` deste
   * arquivo são deliberadamente sequenciais e acumulam sandboxes no mesmo
   * banco de mentira desde o início da suíte.
   *
   * `envelhecer(id, 0)` dá ao "vivo" um `createdAt` explícito de AGORA —
   * deixa o teste claro e determinístico, sem depender de quão rápido o
   * relógio de fundo anda entre a criação e a leitura.
   *
   * Nota da rodada de correção (12/09/2026): até esta correção o banco de
   * mentira NÃO simulava o `defaultNow()` da coluna — todo sandbox nascia com
   * `createdAt` NULO, que este filtro (o MESMO corte de `sandboxesExpirados`)
   * tratava como epoch e portanto já expirado, e `envelhecer(id, 0)` era a
   * ÚNICA coisa que salvava o "vivo" de contar como expirado por acidente.
   * Agora `processarInsert`/`valorPadraoDaColuna` aplicam o default REAL da
   * coluna (`defaultNow()` vira "agora"), então um sandbox recém-criado já
   * nasce corretamente "vivo" mesmo sem `envelhecer` — a chamada abaixo
   * continua por clareza (fixa o instante em vez de depender do relógio de
   * fundo), não mais por necessidade.
   */
  it("contarSandboxesVivos NAO conta sandbox ja expirado, mesmo que a linha ainda exista (limpeza horaria ainda nao passou)", async () => {
    const antes = await contarSandboxesVivos();

    const vivo = await criarSandbox();
    await envelhecer(vivo.providerId, 0);
    const expirado = await criarSandbox();
    await envelhecer(expirado.providerId, 25 * 60 * 60 * 1000);

    const depois = await contarSandboxesVivos();

    // So o "vivo" soma ao teto — o "expirado" existe na tabela (a limpeza
    // ainda nao rodou), mas nao ocupa mais vaga.
    expect(depois).toBe(antes + 1);
  });

  it("contarSandboxesVivos conta um sandbox recem-criado normalmente", async () => {
    const antes = await contarSandboxesVivos();
    const s = await criarSandbox();
    await envelhecer(s.providerId, 0);
    const depois = await contarSandboxesVivos();
    expect(depois).toBe(antes + 1);
  });

  it("apagar leva junto as linhas do provedor", async () => {
    const s = await criarSandbox();
    await apagarSandbox(s.providerId);
    expect(await clientesDe(s.providerId)).toHaveLength(0);
  });

  it("apagar esvazia o chat simulado daquele provedor, e so depois de o provedor sumir do banco", async () => {
    const s = await criarSandbox();
    const limpar = vi.mocked(limparChatSimuladoDoProvedor);
    limpar.mockClear();
    let provedorAindaExistia: boolean | null = null;
    limpar.mockImplementationOnce((providerId) => {
      provedorAindaExistia = (banco.linhas.get("providers") ?? []).some((p) => p.id === providerId);
    });

    await apagarSandbox(s.providerId);

    expect(limpar).toHaveBeenCalledTimes(1);
    expect(limpar).toHaveBeenCalledWith(s.providerId);
    // Antes do delete, um erro no banco deixaria o sandbox de pé e sem o chat.
    expect(provedorAindaExistia).toBe(false);
  });

  // ── Alocação de índices: prova por EXECUÇÃO, não por fórmula reconstruída ──

  it("os 1.500 clientes do sandbox nao colidem com o mundo base: 273 REAPROVEITAM CPF da rede de proposito, os outros 1.227 sao exclusivos", async () => {
    const s = await criarSandbox();
    const cpfsDoSandbox = (await clientesDe(s.providerId)).map((c) => c.cpfCnpj as string);
    expect(new Set(cpfsDoSandbox).size, "CPF repetido dentro do proprio sandbox").toBe(1500);

    const cpfsDaBase = await todosOsCpfsDaBase();
    const compartilhados = cpfsDoSandbox.filter((cpf) => cpfsDaBase.has(cpf));
    const exclusivos = cpfsDoSandbox.filter((cpf) => !cpfsDaBase.has(cpf));
    expect(compartilhados).toHaveLength(273);
    expect(exclusivos).toHaveLength(1227);
  });

  it("dois sandboxes concorrentes nunca geram o mesmo CPF exclusivo (prova por execucao contra o gerador real, nao por formula)", async () => {
    const cpfsDaBase = await todosOsCpfsDaBase();
    const exclusivosDe = async (providerId: number) =>
      (await clientesDe(providerId)).map((c) => c.cpfCnpj as string).filter((cpf) => !cpfsDaBase.has(cpf));

    const a = await criarSandbox();
    const b = await criarSandbox();
    const exclusivosA = await exclusivosDe(a.providerId);
    const exclusivosB = await exclusivosDe(b.providerId);
    expect(exclusivosA).toHaveLength(1227);
    expect(exclusivosB).toHaveLength(1227);
    expect(exclusivosA.filter((cpf) => exclusivosB.includes(cpf))).toHaveLength(0);
  });

  it("cada sandbox nasce com administrador proprio — dois sandboxes seguidos nao colidem em users.email (notNull+unique)", async () => {
    const a = await criarSandbox();
    const b = await criarSandbox();
    expect(a.userId).not.toBe(b.userId);
  });

  it("o quadro de cobranca ja nasce com um caso em cada uma das 9 colunas do kanban", async () => {
    const s = await criarSandbox();
    const casos = await casosDeCobrancaDe(s.providerId);
    const ORDEM_DO_KANBAN = ["aberto", "em_contato", "negociando", "acordo_ativo", "pago", "cancelamento", "negativado", "baixado", "encerrado"];
    expect(new Set(casos.map((c) => c.status))).toEqual(new Set(ORDEM_DO_KANBAN));
  });

  /**
   * Rodada de correção (Tarefa 3, 11/09/2026): ter uma LINHA por status não
   * prova que a COLUNA aparece no quadro. `montarColuna`
   * (`server/routes/cobranca.routes.ts`) só mostra uma coluna FECHADA
   * (`casoFechado`: pago, baixado, encerrado, cancelamento) quando o caso tem
   * `encerradoEm` DENTRO da janela de 30 dias (`JANELA_DE_FECHADOS_DIAS`) —
   * o mesmo filtro está reproduzido aqui, contra o que `criarSandbox()`
   * REALMENTE gravou. Antes desta correção, `encerradoEm` nascia sempre
   * `null` para as quatro, e as quatro colunas apareciam vazias no quadro
   * mesmo com o caso existindo (o teste acima, sozinho, nunca pegava isso).
   */
  it("as quatro colunas FECHADAS do kanban tem encerradoEm dentro da janela de 30 dias que montarColuna exige — senao a coluna aparece vazia mesmo com o caso existindo", async () => {
    const s = await criarSandbox();
    const casos = await casosDeCobrancaDe(s.providerId);
    const hoje = new Date();
    const fechadosDesde = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000); // JANELA_DE_FECHADOS_DIAS

    const statusFechados = casos.filter((c) => casoFechado(c.status as string));
    // As quatro colunas, e mais os 6 casos de quem pagou nos últimos 30 dias (Leva 2, fase B), fechados na conciliação.
    expect([...new Set(statusFechados.map((c) => c.status))].sort()).toEqual(["baixado", "cancelamento", "encerrado", "pago"]);
    expect(statusFechados).toHaveLength(4 + 6);

    for (const caso of statusFechados) {
      const encerradoEm = caso.encerradoEm as Date | string | null;
      expect(encerradoEm, `${caso.status}: encerradoEm nulo — a coluna nasce vazia`).not.toBeNull();
      const quando = new Date(encerradoEm as string | Date).getTime();
      expect(quando, `${caso.status}: encerradoEm fora da janela de 30 dias`).toBeGreaterThanOrEqual(fechadosDesde.getTime());
    }
  });

  it("faturas e clientes do sandbox saem marcados como vindos do ERP demo, com plano preenchido — sem isto a Economia e a carteira/mes ficam sem nada para contar", async () => {
    const s = await criarSandbox();
    const clientes = await clientesDe(s.providerId);
    for (const c of clientes) {
      expect(c.erpSource, JSON.stringify(c)).toBe(FONTE_ERP_DEMO);
      expect(c.contractPlan, JSON.stringify(c)).toEqual(expect.any(String));
    }

    const faturas = await faturasDe(s.providerId);
    expect(faturas.length).toBeGreaterThan(0);
    for (const f of faturas) {
      expect(f.erpSource, JSON.stringify(f)).toBe(FONTE_ERP_DEMO);
      expect((f.erpRef as string | null)?.length ?? 0, JSON.stringify(f)).toBeGreaterThan(0);
    }
    const refs = faturas.map((f) => f.erpRef as string);
    expect(new Set(refs).size, "erpRef duplicado dentro do mesmo sandbox").toBe(refs.length);
  });

  it("o provedor do sandbox nasce com cidadesAtendidas e addressState — senao o modo Rede do mapa manda o visitante configurar as proprias cidades", async () => {
    const s = await criarSandbox();
    const provider = await providerDe(s.providerId);
    expect(provider.addressState).toBe("PR");
    // `cidadesAtendidas` e coluna ARRAY: o pg-proxy nunca decodifica de volta
    // para JS (o banco de mentira le `banco.linhas` direto, sem passar pelo
    // decoder do Drizzle) — o que chega e o literal de array do Postgres que
    // `mapToDriverValue` gerou ao gravar, tipo `{"Londrina","Ibiporã",...}`.
    const cidades = provider.cidadesAtendidas as string;
    expect(cidades, "cidadesAtendidas vazio ou nulo").toBeTruthy();
    for (const cidade of ["Londrina", "Ibiporã", "Cambé", "Apucarana"]) {
      expect(cidades, cidades).toContain(cidade);
    }

    // Sem mesorregiao o sandbox fica fora de toda busca regional
    // (`getProvidersByMesoregion` devolve vazio) e o card "Provedores
    // parceiros" do painel mostrava zero — medido no ar em 12/09/2026. Mesmo
    // formato de literal de array que `cidadesAtendidas`, acima.
    const mesos = provider.mesorregioes as string;
    expect(mesos, "mesorregioes vazio ou nulo").toBeTruthy();
    expect(mesos).toContain("Norte Central Paranaense");

    // E e a mesorregiao de VERDADE dessas cidades, na tabela do IBGE que a tela
    // de regionalizacao usa — nao um nome digitado que so parece certo.
    const { cidadesDasMesorregioes } = await import("../services/area-atendida");
    const doIbge = cidadesDasMesorregioes(["Norte Central Paranaense"]);
    for (const cidade of ["Londrina", "Ibiporã", "Cambé", "Apucarana"]) {
      expect(doIbge, `${cidade} fora do Norte Central Paranaense`).toContain(cidade);
    }

    // O sandbox de OUTRO visitante nunca e parceiro: a busca regional exclui o
    // padrao de sandbox no SQL, e esse padrao tem que ser o prefixo de verdade.
    const { PADRAO_DE_SANDBOX_NO_SQL } = await import("../services/regional.service");
    const { PREFIXO_SANDBOX } = await import("./sandbox.service");
    expect(PADRAO_DE_SANDBOX_NO_SQL).toBe(`${PREFIXO_SANDBOX}%`);
  });

  it("o sandbox tem integracao 'demo' habilitada — sem ela a consulta ao vivo nunca alcanca o conector, nem para a PROPRIA carteira do sandbox", async () => {
    const s = await criarSandbox();
    const integracao = await integracaoDe(s.providerId);
    expect(integracao).toMatchObject({ erpSource: FONTE_ERP_DEMO, isEnabled: true });

    const apiUrl = (integracao?.apiUrl as string) ?? "";
    expect(apiUrl).not.toBe("");
    expect(() => new URL(apiUrl)).not.toThrow();
    expect(decryptField(integracao?.apiToken as string | null)).toBeTruthy();
  });

  /**
   * Rodada de correção (Tarefa 1, 11/09/2026): a raiz do defeito que motivou
   * esta rodada inteira — o visitante abre a PRÓPRIA carteira, vê um cliente
   * devendo, consulta o MESMO CPF, e a consulta respondia "nada consta"
   * porque o sandbox não tinha integração ERP nenhuma. Prova pelo caminho
   * REAL: o conector "demo" de verdade, respondendo pela integração que
   * `criarSandbox()` gravou — não por uma linha em `customers` inspecionada
   * isoladamente.
   */
  it("um cliente da PROPRIA carteira do sandbox e encontrado pela consulta ao vivo — a raiz do defeito que esta rodada corrige", async () => {
    const s = await criarSandbox();
    const clientes = await clientesDe(s.providerId);
    const inadimplente = clientes.find((c) => c.paymentStatus === "overdue")!;

    const integracao = (await integracaoDe(s.providerId))!;
    const config = buildConnectorConfig({
      apiUrl: integracao.apiUrl as string,
      apiToken: decryptField(integracao.apiToken as string | null),
      apiUser: null, clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
    });
    config.extra = { ...config.extra, providerId: String(s.providerId) };

    const conector = getConnector(FONTE_ERP_DEMO)!;
    const resultado = await conector.fetchCustomerByCpf!(config, inadimplente.cpfCnpj as string);
    expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
    expect(resultado.customers).toHaveLength(1);
    expect(resultado.customers[0].totalOverdueAmount).toBeGreaterThan(0);
  });

  /**
   * Rodada de correção (Tarefa 4, 11/09/2026): sem alertas seedados, a aba
   * Anti-Fraude do sandbox SEMPRE abre vazia — a segunda funcionalidade que a
   * landing anuncia, e a demonstração nunca mostrava nada nela. Prova pelas
   * MESMAS transformações que `GET /api/anti-fraud/alerts`
   * (`server/routes/antifraude.routes.ts`) aplica antes de mandar para a
   * tela: `maskAlertForProvider` (o dono vê o próprio cliente sem máscara) e
   * `motivosGravados`/`rotuloDoAlerta` (o motivo que o card mostra) — não só
   * a existência da linha em `anti_fraud_alerts`.
   */
  it("o sandbox nasce com alertas de anti-fraude, na forma que a tela realmente le (mascaramento + motivo)", async () => {
    const s = await criarSandbox();
    const alertas = await alertasAntiFraudeDe(s.providerId);
    expect(alertas.length).toBeGreaterThan(0);

    const idsDaRede = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));
    for (const alerta of alertas) {
      // Só "defaulter_consulted" chega na tela — "migrador_serial" é ignorado por design.
      expect(alerta.type).toBe("defaulter_consulted");
      // O consulente é sempre outro provedor de VERDADE da rede, nunca o próprio sandbox.
      expect(idsDaRede.has(alerta.consultingProviderId as number), JSON.stringify(alerta)).toBe(true);
      expect(alerta.consultingProviderId).not.toBe(s.providerId);

      // `riskFactors` e coluna JSONB: o pg-proxy grava o JSON.stringify que o
      // Drizzle gerou como parametro, e o banco de mentira devolve esse texto
      // cru (le `banco.linhas` direto, sem passar pelo decoder) — um
      // Postgres de verdade devolveria o array ja desserializado.
      const riskFactors = typeof alerta.riskFactors === "string" ? JSON.parse(alerta.riskFactors) : alerta.riskFactors;
      // Leva 2, fase B: além dos 3 de dívida, os alertas extras trazem consultas
      // repetidas e contrato novo — todo alerta com um motivo que a tela conhece.
      const motivos = motivosGravados(riskFactors);
      expect(motivos.length, JSON.stringify(alerta)).toBeGreaterThan(0);
      if (motivos.includes("divida_ativa")) expect(rotuloDoAlerta(motivos)).toBe("Fuga · cliente ativo com dívida");

      // `customerProviderId` simula o JOIN que `getAlertsByProvider` faz de
      // verdade (server/storage/antifraude.storage.ts) — sem ele
      // `maskAlertForProvider` não sabe que o cliente É do próprio dono.
      const mascarado = maskAlertForProvider({ ...alerta, customerProviderId: s.providerId }, s.providerId);
      expect(mascarado.customerName, "cliente do proprio dono nao deveria sair mascarado").toBe(alerta.customerName);
      expect(mascarado.customerCpfCnpj).toBe(alerta.customerCpfCnpj);
      // O nome do parceiro nunca sai cru — sempre o código anonimizado.
      expect(mascarado.consultingProviderName as string).toMatch(/^Provedor Parceiro ISP-/);
    }

    const deDivida = alertas.filter((a) => motivosGravados(typeof a.riskFactors === "string" ? JSON.parse(a.riskFactors) : a.riskFactors).includes("divida_ativa"));
    expect(deDivida.length).toBeGreaterThanOrEqual(3);

    // Clientes distintos — os alertas não apontam todos para o mesmo cliente.
    expect(new Set(alertas.map((a) => a.customerId)).size).toBe(alertas.length);
  });

  // ── O sinal de migrador serial: prova pelo CAMINHO REAL, nao pela linha ──

  it("o CPF de exemplo 'migrador_serial' e detectado pelo caminho real (conector demo + detectMigrator) — nao so por uma linha inserida", async () => {
    const s = await criarSandbox();
    const exemplos = await cpfsDeExemplo(s.providerId);
    const migrador = exemplos.find((e) => e.situacao === "migrador_serial")!;

    const conector = getConnector(FONTE_ERP_DEMO)!;
    const erpResults = await Promise.all(
      PROVEDORES_DA_DEMO.map(async (p) => {
        const providerId = idDe(p.subdomain);
        const config = buildConnectorConfig({
          apiUrl: "demo://mundo-base", apiToken: "x", apiUser: null,
          clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
        });
        config.extra = { ...config.extra, providerId: String(providerId) };
        const r = await conector.fetchCustomerByCpf!(config, migrador.cpf);
        return {
          providerId, providerName: p.nome, erpSource: FONTE_ERP_DEMO, ok: r.ok,
          customers: r.customers.map((c) => ({
            ...c,
            // Mesmo operador de normalizeCustomer (server/services/realtime-query.service.ts:352,357):
            // `||`, não `??` — por igual a produção, não só "equivalente na prática".
            status: c.contractStatus || (c as any).status,
            registrationDate: c.contractStartDate || (c as any).registrationDate,
          })),
        };
      }),
    );

    const resultado = detectMigrator({
      cpfCnpj: migrador.cpf,
      consultingProviderId: s.providerId,
      consultingProviderName: "Provedor Demonstração",
      erpResults: erpResults as any,
      recentConsultationsByDistinctProviders: 1,
    });

    expect(resultado?.detected, JSON.stringify(erpResults)).toBe(true);
  });
});

/**
 * Leva 1 da demonstração com todos os recursos (spec 2026-09-12, Frente C):
 * o que o visitante abria VAZIO — Economia pendente, carteira de ex-clientes
 * só com cards fechados, recuperação de equipamento sem caso, Conversas sem
 * nenhuma conversa. Cada `it()` prova um invariante contra o que
 * `criarSandbox()` REALMENTE gravou, e as regras vêm das funções reais
 * (régua, DNA, prazo de retirada, sinal de bureau), nunca de números
 * reescritos aqui.
 *
 * Um sandbox só para o bloco inteiro (`beforeAll`): os testes leem, e só o
 * último apaga — o arquivo continua sequencial e cumulativo como o resto.
 */
describe("a semeadura cobre os recursos da demonstracao (Leva 1, Frente C)", () => {
  const DIA_MS = 86_400_000;
  let s: Awaited<ReturnType<typeof criarSandbox>>;

  /** Timestamp gravado (ISO string no banco de mentira, ou Date) -> ms. */
  const ms = (valor: unknown): number => new Date(valor as string | Date).getTime();
  /** JSONB chega como o texto que o Drizzle serializou — ver o teste de anti-fraude acima. */
  const json = (valor: unknown): any => (typeof valor === "string" ? JSON.parse(valor) : valor);
  /**
   * O recorte que `FaturasStorage.historicosDePagamentosDoProvedor(paraDna)` faz
   * para o ex-cliente, refeito sobre o que `criarSandbox()` REALMENTE gravou:
   * faturas pagas e datadas, vencidas E pagas dentro de [início do contrato,
   * corte]; o encerramento confirmado é o dia UTC do corte, como
   * `to_char(cortado_em,'YYYY-MM-DD')` num timestamp sem fuso devolve do ISO
   * que o Drizzle grava. É com ESTE histórico e a carteira `ex_cliente` que a
   * régua (`revisarCaso` → `dnaDoCaso`) recalcula o DNA na primeira passada —
   * a semeadura tem de chegar ao mesmo quadrante e tom, senão o worker
   * reescreve a grade de ex-clientes na frente do visitante.
   */
  const historicoDeExCliente = (cliente: Record<string, unknown>, faturas: Record<string, unknown>[]) => {
    const dia = (valor: unknown) => new Date(valor as string | Date).toISOString().slice(0, 10);
    const inicio = cliente.contractStartDate as string;
    const corte = dia(cliente.cortadoEm);
    const pagas = faturas.filter((f) => f.customerId === cliente.id && f.status === "paid" && f.paidDate
      && dia(f.dueDate) >= inicio && dia(f.paidDate) >= inicio && dia(f.dueDate) <= corte && dia(f.paidDate) <= corte);
    return {
      historicoInsuficiente: pagas.length === 0, faturasPagas: pagas.length,
      faturasPagasComAtraso: pagas.filter((f) => dia(f.paidDate) > dia(f.dueDate)).length,
      recebido: 0, taxaAtraso: null, ultimaConfirmacaoEm: null, fonte: "pagamentos_com_data" as const, encerramentoConfirmadoEm: corte,
    };
  };
  const linhasDe = (tabela: string, providerId: number) => (banco.linhas.get(tabela) ?? []).filter((l) => l.providerId === providerId);
  const adminDe = (providerId: number) => (banco.linhas.get("users") ?? []).find((u) => u.providerId === providerId)!;

  beforeAll(async () => {
    s = await criarSandbox();
  });

  it("uma politica de cobranca com custos informados e preco para todo plano da carteira — a Economia deixa de ser pendente", async () => {
    const politicas = linhasDe("cobranca_politica", s.providerId);
    expect(politicas).toHaveLength(1);
    expect(politicas[0].pausada).toBe(false);

    const economia = json(politicas[0].economia) as Economia;
    expect(custosInformados(economia), JSON.stringify(economia)).toBe(true);
    expect(economia.confirmado).toBe(true);

    // Todo plano da carteira tem preço cadastrado — pela MESMA função que a
    // ficha 360 usa para casar o nome — e o preço é a mensalidade cobrada.
    const clientes = await clientesDe(s.providerId);
    for (const c of clientes) {
      expect(precoDoPlano(economia.precoPorPlano, c.contractPlan as string), c.contractPlan as string).not.toBeNull();
    }
    const faturas = await faturasDe(s.providerId);
    for (const c of clientes.filter((x) => x.status === "active" && x.paymentStatus === "overdue")) {
      const fatura = faturas.find((f) => f.customerId === c.id)!;
      expect(precoDoPlano(economia.precoPorPlano, c.contractPlan as string)).toBe(Number(fatura.value));
    }
  });

  it("clientes nascem sincronizados e com score coerente — nunca o default 100/'low' que a tela esconde", async () => {
    const clientes = await clientesDe(s.providerId);
    for (const c of clientes) {
      expect(c.lastSyncAt, JSON.stringify(c)).toBeTruthy();
      expect(c.ispScore === 100 && c.riskTier === "low", JSON.stringify(c)).toBe(false);
    }

    // Quem pagou nos últimos 30 dias (Leva 2, fase B) está em dia com o score de
    // quem acabou de sair do atraso: o score conta a história, não só o hoje.
    const recuperados = new Set((await casosDeCobrancaDe(s.providerId)).filter((c) => c.motivoEncerramento === MOTIVO_DIVIDA_ZERADA && c.status === "encerrado" && c.ultimoContatoEm).map((c) => c.customerId));
    expect(recuperados.size).toBe(6);
    const emDiaAgora = clientes.filter((c) => c.status === "active" && c.paymentStatus === "current");
    const emDia = emDiaAgora.filter((c) => !recuperados.has(c.id));
    const inadimplentes = clientes.filter((c) => c.status === "active" && c.paymentStatus === "overdue");
    expect(emDiaAgora).toHaveLength(1125 + 3);
    expect(emDia).toHaveLength(1125);
    for (const c of emDia) {
      expect(c.ispScore as number).toBeGreaterThanOrEqual(650);
      expect(c.ispScore as number).toBeLessThanOrEqual(900);
    }
    for (const c of inadimplentes) {
      // A dívida e, quando o dia dela já passou neste mês, a mensalidade do mês (revisão da fase B).
      expect([1, 2], JSON.stringify(c)).toContain(c.overdueInvoicesCount);
      expect(c.ispScore as number).toBeGreaterThanOrEqual(250);
      expect(c.ispScore as number).toBeLessThanOrEqual(600);
    }
    // A faixa é a do produto para TODO cliente — vocabulário e regra do sync.
    for (const c of clientes) {
      expect(c.riskTier, JSON.stringify(c)).toBe(faixaDeRiscoDoSync(c.maxDaysOverdue as number));
    }
  });

  it("risk_tier usa o vocabulario e a regra do sync (low/medium/high/critical) — o painel conta as tres faixas de risco", async () => {
    // A regra repetida em `faixaDeRiscoDoSync` é a desta linha do sync; se ela
    // mudar lá, este teste acende antes de a demonstração divergir do produto.
    const fonte = readFileSync(new URL("../storage/customers.storage.ts", import.meta.url), "utf8");
    expect(fonte).toContain('const riskTier = data.maxDaysOverdue > 180 ? "critical" : data.maxDaysOverdue > 90 ? "high" : data.maxDaysOverdue > 60 ? "medium" : "low";');

    const clientes = await clientesDe(s.providerId);
    const conhecidas = ["low", "medium", "high", "critical"]; // RISK_CONFIG (inadimplentes.tsx) e formatacao.ts
    for (const c of clientes) expect(conhecidas, JSON.stringify(c)).toContain(c.riskTier);
    // O que `getDashboardStats` conta (dashboard.storage.ts) não nasce zerado.
    for (const faixa of ["critical", "high", "medium"]) {
      expect(clientes.filter((c) => c.riskTier === faixa).length, faixa).toBeGreaterThan(0);
    }
  });

  it("payment_status segue a regra do sync: ex-cliente devendo aparece como devedor onde o produto conta devedor, sem entrar na carteira de ativos", async () => {
    const fonte = readFileSync(new URL("../storage/customers.storage.ts", import.meta.url), "utf8");
    expect(fonte).toContain('paymentStatus = data.totalOverdueAmount > 0 ? "overdue" : "current"');

    const clientes = await clientesDe(s.providerId);
    for (const c of clientes) {
      expect(c.paymentStatus, JSON.stringify(c)).toBe(Number(c.totalOverdueAmount) > 0 ? "overdue" : "current");
    }
    const devedores = clientes.filter((c) => c.paymentStatus !== "current");
    // Menos os 3 ativos e os 3 ex-clientes que pagaram nos últimos 30 dias (Leva 2, fase B).
    expect(devedores.filter((c) => c.status === "active")).toHaveLength(222);
    expect(devedores.filter((c) => c.status === "cancelled")).toHaveLength(71);
    // A carteira de cobrança separa pelo status do CONTRATO, não por payment_status.
    const carteiraAtiva = clientes.filter((c) => carteiraDoStatusErp(c.status as string) === "ativo" && Number(c.totalOverdueAmount) > 0);
    expect(carteiraAtiva).toHaveLength(222);

    // O card "equipamentos não devolvidos" do painel, com o MESMO filtro de
    // `getDashboardStats`: cliente com payment_status != 'current' e ONU num
    // dos status de retida. Nascia zerado com o ex-cliente devedor em `current`.
    const retidos = ["retirada_pendente", "nao_localizado", "retido", "em_cobranca", "not_returned"];
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const naoDevolvidos = (await equipamentosDe(s.providerId)).filter(
      (e) => porId.get(e.customerId)?.paymentStatus !== "current" && retidos.includes(String(e.status).toLowerCase()),
    );
    expect(naoDevolvidos.length).toBeGreaterThan(0);
  });

  it("a divida do ex-cliente e exatamente a fatura de saida vencida (soma e contagem batem) — o caso 'baixado' tira a fatura dos vencidos junto com a divida", async () => {
    const clientes = await clientesDe(s.providerId);
    const cancelados = clientes.filter((c) => c.status === "cancelled");
    // O contrato continua cancelado; o status de pagamento segue a dívida (regra do sync).
    for (const c of cancelados) expect(c.paymentStatus).toBe(Number(c.totalOverdueAmount) > 0 ? "overdue" : "current");

    const idsCancelados = new Set(cancelados.map((c) => c.id));
    const saidaVencida = new Map(
      (await faturasDe(s.providerId))
        .filter((f) => idsCancelados.has(f.customerId as number) && f.status === "overdue")
        .map((f) => [f.customerId as number, f]),
    );
    const clienteDoBaixado = (await casosDeCobrancaDe(s.providerId)).find((c) => c.status === "baixado")!.customerId as number;
    // Até a Leva 2 a fatura do baixado continuava "overdue" com o agregado zerado,
    // e a ficha acendia "o saldo agregado difere das faturas vencidas".
    expect(saidaVencida.has(clienteDoBaixado), "o cliente do caso baixado ainda tem a fatura de saida vencida").toBe(false);

    const comDivida = cancelados.filter((c) => Number(c.totalOverdueAmount) > 0);
    expect(comDivida).toHaveLength(saidaVencida.size);
    expect(comDivida.map((c) => c.id)).not.toContain(clienteDoBaixado);

    for (const c of comDivida) {
      const fatura = saidaVencida.get(c.id as number);
      expect(fatura, `ex-cliente ${c.id} com divida sem fatura de saida vencida`).toBeTruthy();
      expect(c.totalOverdueAmount).toBe(fatura!.value);
      expect(c.overdueInvoicesCount).toBe(1);
      expect(c.maxDaysOverdue).toBe(Math.round((Date.now() - ms(c.cortadoEm)) / DIA_MS));
      expect(c.riskTier).toBe(faixaDeRiscoDoSync(c.maxDaysOverdue as number));
    }
    for (const c of cancelados.filter((x) => Number(x.totalOverdueAmount) === 0)) {
      expect(c.overdueInvoicesCount).toBe(0);
      expect(c.maxDaysOverdue).toBe(0);
    }

    const centavos = (v: unknown) => Math.round(Number(v) * 100);
    const somaDividas = comDivida.reduce((acc, c) => acc + centavos(c.totalOverdueAmount), 0);
    const somaFaturas = Array.from(saidaVencida.entries())
      .filter(([customerId]) => customerId !== clienteDoBaixado)
      .reduce((acc, [, f]) => acc + centavos(f.value), 0);
    expect(somaDividas).toBe(somaFaturas);
  });

  it("casos vivos de ex-cliente com etapa, prioridade e DNA das funcoes reais da regua — e nunca dois casos vivos para o mesmo cliente", async () => {
    const casos = await casosDeCobrancaDe(s.providerId);
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));

    for (const status of STATUS_DE_CASO) expect(casos.map((c) => c.status), status).toContain(status);

    const vivos = casos.filter((c) => !casoFechado(c.status as string));
    expect(new Set(vivos.map((c) => c.customerId)).size, "dois casos vivos para o mesmo cliente").toBe(vivos.length);

    const vivosEx = vivos.filter((c) => c.carteira === "ex_cliente");
    const porStatus: Record<string, number> = {};
    for (const c of vivosEx) porStatus[c.status as string] = (porStatus[c.status as string] ?? 0) + 1;
    // Os 71 ex-clientes devendo têm caso (Leva 2, carteira completa; 74 menos os
    // 3 que pagaram nos últimos 30 dias): os que a equipe já trabalhou são os
    // mesmos 7; o resto está na fila, "aberto".
    const { aberto, ...trabalhados } = porStatus;
    expect(trabalhados).toEqual({ em_contato: 3, negociando: 2, acordo_ativo: 1, negativado: 1 });
    expect(vivosEx).toHaveLength(71);
    expect(aberto).toBe(71 - 7);

    const agora = new Date();
    const faturas = await faturasDe(s.providerId);
    for (const caso of vivosEx) {
      const cliente = clientes.get(caso.customerId as number)!;
      expect(cliente.status).toBe("cancelled");
      expect(Number(cliente.totalOverdueAmount), "caso vivo de ex-cliente sem divida").toBeGreaterThan(0);
      expect(caso.valorAbertura).toBe(cliente.totalOverdueAmount);
      expect(caso.valorAtual).toBe(cliente.totalOverdueAmount);

      const dias = cliente.maxDaysOverdue as number;
      // O atraso NA ABERTURA: o de hoje menos os dias desde que o caso abriu.
      expect(caso.diasAtrasoAbertura).toBe(dias - Math.floor((Date.now() - ms(caso.abertoEm)) / DIA_MS));
      const etapa = etapaParaAtraso(dias, "ex_cliente").etapa?.id ?? null;
      expect(caso.etapaAtual, JSON.stringify(caso)).toBe(etapa);
      expect(caso.prioridade).toBe(prioridadeSugerida(Number(caso.valorAtual), etapa));

      // O DNA de ex-cliente como a régua o calcula: relação encerrada (meses até o
      // corte, confiabilidade só pelo histórico pago) e tons `ex_*`. Antes a
      // semeadura usava a taxonomia de ATIVO, e a primeira passada reescrevia os 71.
      const dna = dnaDoCaso({ contractStartDate: cliente.contractStartDate as string, diasAtraso: dias, faturasAbertas: 1 }, agora, historicoDeExCliente(cliente, faturas), "ex_cliente");
      expect(dna.quadranteDna, "o ex-cliente tem contrato, corte e mensalidades pagas: o DNA nao pode sair nulo").not.toBeNull();
      expect(caso.quadranteDna).toBe(dna.quadranteDna);
      expect(caso.tom).toBe(dna.tom);
      expect(caso.tom, "tom de ex-cliente e da taxonomia encerrada").toMatch(/^ex_/);

      if (["em_contato", "negociando", "acordo_ativo"].includes(caso.status as string)) {
        expect(caso.ultimoContatoEm, `${caso.status} sem ultimoContatoEm`).toBeTruthy();
      }
    }

    // A fila mistura atrasado, hoje e futuro — senão "vencidos hoje" ou "próximos" nasce vazio.
    const proximos = vivosEx.map((c) => ms(c.proximoContatoEm));
    expect(proximos.some((t) => t < Date.now() - DIA_MS)).toBe(true);
    expect(proximos.some((t) => Math.abs(t - Date.now()) < 60 * 60 * 1000)).toBe(true);
    expect(proximos.some((t) => t > Date.now() + DIA_MS)).toBe(true);
  });

  it("todo caso vivo semeado ja esta onde a regua o deixaria hoje — a primeira passada do worker nao move nenhum card", async () => {
    // `revisarCaso` não é exportada: a decisão dela é refeita com as MESMAS
    // funções puras e a MESMA entrada (`maxDaysOverdue`, as faturas abertas, a
    // data do contrato). O DNA do ATIVO sai aqui sem o histórico de pagamentos:
    // as mensalidades pagas da Leva 2 (fase B) seguem o perfil do próprio DNA, e
    // `semeadura-faturas.test.ts` prova que recalculado com elas o quadrante não
    // muda. O do EX-CLIENTE só existe com o histórico da relação encerrada
    // (`historicoDeExCliente`, o recorte do storage) — a régua de verdade
    // confere no banco local.
    const casos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const faturas = await faturasDe(s.providerId);
    const agora = new Date();
    // Um caso vivo por devedor (Leva 2, carteira completa): 222 inadimplentes ativos + 71
    // ex-clientes devendo (os 6 que pagaram nos últimos 30 dias têm o caso fechado).
    // Antes eram 20, e a primeira passada abria os outros na frente do visitante.
    expect(casos).toHaveLength(293);

    for (const caso of casos) {
      const cliente = clientes.get(caso.customerId as number)!;
      const rotulo = `caso ${caso.id} (${caso.status}, ${caso.carteira})`;
      const dias = cliente.maxDaysOverdue as number;
      // Nada que a revisão encerre (prescrita, dívida zerada) ou cancele (ativo com contrato fora).
      expect(prescrita(dias), rotulo).toBe(false);
      expect(Number(cliente.totalOverdueAmount), rotulo).toBeGreaterThan(0);
      if (caso.carteira === "ativo") expect((STATUS_DE_CLIENTE_ATUAL as readonly string[]).includes(cliente.status as string), rotulo).toBe(true);
      // A fatura em aberto continua em aberto: nenhuma paga venceu depois dela.
      const aberta = faturas.find((f) => f.customerId === cliente.id && f.status === "overdue")!;
      for (const paga of faturas.filter((f) => f.customerId === cliente.id && f.status === "paid")) {
        expect(ms(paga.dueDate), `${rotulo}: ${paga.erpRef} paga depois da divida`).toBeLessThan(ms(aberta.dueDate));
      }

      const etapa = etapaParaAtraso(dias, caso.carteira === "ex_cliente" ? "ex_cliente" : "ativo").etapa?.id ?? null;
      expect(caso.etapaAtual, rotulo).toBe(etapa);
      expect(Math.abs(Number(cliente.totalOverdueAmount) - Number(caso.valorAtual)), rotulo).toBeLessThan(0.005);
      expect(caso.prioridade, rotulo).toBe(prioridadeSugerida(Number(caso.valorAtual), etapa));
      const entradaDna = { contractStartDate: cliente.contractStartDate as string, diasAtraso: dias, faturasAbertas: cliente.overdueInvoicesCount as number };
      const dna = caso.carteira === "ex_cliente" ? dnaDoCaso(entradaDna, agora, historicoDeExCliente(cliente, faturas), "ex_cliente") : dnaDoCaso(entradaDna, agora);
      expect(dna.quadranteDna, `${rotulo}: o cliente tem data de contrato, o DNA nao pode sair nulo`).not.toBeNull();
      expect(caso.quadranteDna, rotulo).toBe(dna.quadranteDna);
      expect(caso.tom, rotulo).toBe(dna.tom);
    }

    // Negativar exige o pré-aviso da pré-negativação (D+90, Súmula 359 do STJ).
    const negativados = casos.filter((c) => c.status === "negativado");
    expect(negativados.length).toBeGreaterThan(0);
    for (const caso of negativados) {
      expect(clientes.get(caso.customerId as number)!.maxDaysOverdue as number, `caso ${caso.id} negativado antes da pre-negativacao`).toBeGreaterThanOrEqual(90);
    }
  });

  it("todo caso vivo tem a proxima acao no vocabulario do produto — a conversa nunca abre 'caso sem proxima acao, parado na fila'", async () => {
    // As ações de um clique da cobrança moram num componente .tsx, que este
    // ambiente sem DOM não carrega: lidas do texto da própria constante.
    const dialogo = readFileSync(new URL("../../client/src/components/cobranca/DialogoContato.tsx", import.meta.url), "utf8");
    const bloco = /export const PROXIMAS_ACOES_COMUNS = \[([\s\S]*?)\] as const;/.exec(dialogo);
    expect(bloco, "PROXIMAS_ACOES_COMUNS nao encontrada em DialogoContato.tsx").not.toBeNull();
    const comuns = Array.from(bloco![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    const vocabulario = new Set<string>([ACAO_AO_RECEBER_MENSAGEM, ACAO_PADRAO_APOS_RESPOSTA, ...ACOES_COMUNS_DO_CHAT, ...comuns]);

    const casos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const conversas = linhasDe("chat_bullq_conversas", s.providerId);
    for (const caso of casos) {
      const rotulo = `caso ${caso.id} (${caso.status})`;
      // A mesma condição de Atendimento.tsx para não mostrar "caso sem próxima ação — parado na fila".
      expect(Boolean(caso.proximaAcao && caso.proximoContatoEm), rotulo).toBe(true);
      expect(vocabulario.has(caso.proximaAcao as string), `${rotulo}: "${caso.proximaAcao}" fora do vocabulario`).toBe(true);
      expect((caso.proximaAcao as string).length, rotulo).toBeLessThanOrEqual(TAMANHO_MAXIMO_DA_ACAO);

      const conversa = conversas.find((c) => c.casoId === caso.id);
      if (!conversa) {
        expect(caso.status, `${rotulo}: caso vivo alem de 'aberto' sem conversa`).toBe("aberto");
        continue;
      }
      if (conversa.status === "OPEN" || conversa.status === "PENDING") {
        // Fala do cliente sem resposta: o que `receberRespostaDoCliente` grava, no instante em que ela chegou.
        expect(caso.proximaAcao, rotulo).toBe(ACAO_AO_RECEBER_MENSAGEM);
        expect(ms(caso.proximoContatoEm), rotulo).toBe(ms(conversa.ultimoEventoEm));
      }
      if (conversa.status === "BOT") expect(caso.proximaAcao, rotulo).toBe("Retomar a conversa");
    }
  });

  it("abertura, contato, statusDesde e atraso na abertura contam a mesma historia — a esteira nao diz 'neste status ha minutos' para um caso de dias", async () => {
    const agora = Date.now();
    const casos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const conversas = linhasDe("chat_bullq_conversas", s.providerId);

    for (const caso of casos) {
      const rotulo = `caso ${caso.id} (${caso.status})`;
      const abertoEm = ms(caso.abertoEm);
      const statusDesde = ms(caso.statusDesde);
      expect(abertoEm, rotulo).toBeLessThanOrEqual(statusDesde);
      expect(statusDesde, rotulo).toBeLessThanOrEqual(agora);
      const dias = clientes.get(caso.customerId as number)!.maxDaysOverdue as number;
      expect(caso.diasAtrasoAbertura, rotulo).toBe(dias - Math.floor((agora - abertoEm) / DIA_MS));
      expect(caso.diasAtrasoAbertura as number, rotulo).toBeGreaterThan(0);

      const conversa = conversas.find((c) => c.casoId === caso.id);
      if (!conversa) {
        expect(statusDesde, rotulo).toBe(abertoEm);
        continue;
      }
      // O contato que abriu a conversa; `ultimoContatoEm` pode ser a última fala da equipe, depois (Leva 2, fase B).
      const contato = ms(conversa.abertaEm);
      expect(ms(caso.ultimoContatoEm), rotulo).toBeGreaterThanOrEqual(contato);
      expect(abertoEm, rotulo).toBeLessThan(contato);
      if (caso.status === "em_contato") expect(statusDesde, rotulo).toBe(contato);
      if (caso.status === "negociando" || caso.status === "acordo_ativo") {
        expect(statusDesde, rotulo).toBeGreaterThanOrEqual(contato);
        expect(statusDesde, rotulo).toBeLessThanOrEqual(ms(conversa.ultimoEventoEm));
      }
      // Negativado antes da conversa: a abertura dela já fala do registro nos órgãos de proteção.
      if (caso.status === "negativado") expect(statusDesde, rotulo).toBeLessThan(contato);
    }
    expect(casos.some((c) => agora - ms(c.statusDesde) > 3 * DIA_MS), "nenhum caso recuado: statusDesde no default").toBe(true);
  });

  it("13 recuperacoes de equipamento com status do equipamento, prazo e trilha iguais aos que as transicoes reais deixariam", async () => {
    const recuperacoes = linhasDe("equipment_recovery_cases", s.providerId);
    expect(recuperacoes).toHaveLength(13);
    const porStatus: Record<string, number> = {};
    for (const r of recuperacoes) porStatus[r.status as string] = (porStatus[r.status as string] ?? 0) + 1;
    expect(porStatus).toEqual({
      pre_recuperacao: 1, agendado: 1, nova_tentativa: 1, notificacao_formal: 1, contestado: 1,
      concluido: 4, baixado_economico: 2, prazo_expirado: 2,
    });

    const admin = adminDe(s.providerId);
    const equipamentos = await equipamentosDe(s.providerId);
    expect(equipamentos).toHaveLength(195); // 120 + as 75 ONUs em comodato de inadimplentes ativos (Leva 2)
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const eventos = linhasDe("equipment_recovery_events", s.providerId);

    for (const r of recuperacoes) {
      const equip = equipamentos.find((e) => e.id === r.equipmentId)!;
      expect(equip, `recuperacao ${r.id} sem equipamento do proprio provedor`).toBeTruthy();
      expect(equip.customerId).toBe(r.customerId);
      const cliente = clientes.get(r.customerId as number)!;
      expect(cliente.status).toBe("cancelled");
      expect(ms(r.terminationDate)).toBe(ms(cliente.cortadoEm));
      expect(ms(r.deadlineAt)).toBe(calcularPrazoRetirada(new Date(ms(cliente.cortadoEm))).getTime());
      expect(r.createdById).toBe(admin.id);

      if (casoEstaEncerrado(r.status as string)) {
        expect(r.closedAt, `${r.status} sem closedAt`).toBeTruthy();
        expect(equip.status).toBe(r.status === "concluido" ? "recuperado_triagem" : "baixado");
        expect(equip.inRecoveryProcess).toBe(false);
      } else {
        expect(r.closedAt ?? null, `${r.status} aberto com closedAt`).toBeNull();
        expect(equip.status).toBe("retirada_pendente");
        expect(equip.inRecoveryProcess).toBe(true);
      }

      const trilha = eventos.filter((e) => e.caseId === r.id);
      expect(trilha.length, `${r.status}: ${trilha.length} eventos`).toBeGreaterThanOrEqual(3);
      expect(trilha.length, `${r.status}: ${trilha.length} eventos`).toBeLessThanOrEqual(6);
      expect(trilha.map((e) => e.type)).toContain("caso_criado");
      for (const e of trilha) {
        expect(ms(e.occurredAt), `${r.status}/${e.type} no futuro`).toBeLessThanOrEqual(Date.now());
        expect(ms(e.occurredAt), `${r.status}/${e.type} antes do corte`).toBeGreaterThanOrEqual(ms(r.terminationDate));
      }

      if (r.status === "agendado") {
        expect(ms(r.scheduledAt)).toBeGreaterThan(Date.now() + DIA_MS);
        expect(r.assignedToUserId).toBe(admin.id);
      }
      if (r.status === "notificacao_formal") {
        // O sinal validado tem que passar na regra REAL com as tentativas semeadas.
        const validacao = validarSinalBureau({
          deadlineAt: new Date(ms(r.deadlineAt)),
          proofReference: r.proofReference as string,
          customerNotifiedAt: new Date(ms(r.customerNotifiedAt)),
          disputedAt: r.disputedAt ? new Date(ms(r.disputedAt)) : null,
          attemptResults: trilha.filter((e) => e.type === "tentativa").map((e) => e.result as string | null),
        });
        expect(validacao).toEqual({ ok: true });
        expect(r.evidenceValidatedAt).toBeTruthy();
        expect(r.bureauStatus).toBe("ativo_validado");
      }
    }

    // O agregado do cliente é o que `recalculateCustomerEquipmentAggregate` calcularia agora.
    for (const c of clientes.values()) {
      const pendentes = equipamentos.filter((e) => e.customerId === c.id && equipamentoTemRetiradaPendente(e.status as string)).length;
      expect(c.equipmentCount, `cliente ${c.id}`).toBe(pendentes);
    }
  });

  it("integracao do chat simulado e 21 conversas que apontam para caso ou recuperacao do MESMO provedor, com o contato na linha do tempo", async () => {
    const admin = adminDe(s.providerId);
    const integracoes = linhasDe("chat_bullq_integracoes", s.providerId);
    expect(integracoes).toHaveLength(1);
    expect(integracoes[0]).toMatchObject({
      organizationId: `demo-org-${s.providerId}`,
      slug: s.subdomain,
      ownerEmail: admin.email,
      canalId: "demo-canal",
      canalNome: "WhatsApp da Demonstração",
      status: "ativo",
    });

    const conversas = linhasDe("chat_bullq_conversas", s.providerId);
    expect(conversas).toHaveLength(21);
    const ids = conversas.map((c) => c.conversationId as string);
    expect(new Set(ids).size).toBe(21);
    for (const id of ids) expect(id).toMatch(new RegExp(`^demo-conv-${s.providerId}-\\d+$`));

    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const casos = new Map((await casosDeCobrancaDe(s.providerId)).map((c) => [c.id as number, c]));
    const recuperacoes = new Map(linhasDe("equipment_recovery_cases", s.providerId).map((r) => [r.id as number, r]));
    const eventosCobranca = linhasDe("cobranca_eventos", s.providerId);
    const eventosRecuperacao = linhasDe("equipment_recovery_events", s.providerId);

    const filas = {
      ativos: conversas.filter((c) => c.origem === "cobranca" && clientes.get(c.customerId as number)?.status === "active"),
      ex: conversas.filter((c) => c.origem === "cobranca" && clientes.get(c.customerId as number)?.status === "cancelled"),
      equipamentos: conversas.filter((c) => c.origem === "equipamentos"),
    };
    expect(filas.ativos).toHaveLength(9);
    // 7, e não 8: os 3 casos "aberto" de ex-cliente ficam sem conversa — abrir a conversa move o caso para "em contato".
    expect(filas.ex).toHaveLength(7);
    expect(filas.equipamentos).toHaveLength(5);
    for (const [nome, fila] of Object.entries(filas)) {
      const status = fila.map((c) => c.status as string);
      for (const esperado of ["OPEN", "PENDING", "WAITING", "BOT"]) expect(status, `${nome} sem ${esperado}`).toContain(esperado);
      const fechadas = status.filter((x) => x === "CLOSED").length;
      expect(fechadas, `${nome}: ${fechadas} CLOSED`).toBeGreaterThanOrEqual(1);
      expect(fechadas, `${nome}: ${fechadas} CLOSED`).toBeLessThanOrEqual(2);
    }

    for (const conversa of conversas) {
      const rotulo = `${conversa.conversationId} (${conversa.status})`;
      expect(conversa.canalId).toBe("demo-canal");
      expect(clientes.has(conversa.customerId as number), `${rotulo}: cliente de outro provedor`).toBe(true);

      const aberta = ms(conversa.abertaEm);
      const ultimo = ms(conversa.ultimoEventoEm);
      expect(aberta, rotulo).toBeLessThanOrEqual(ultimo);
      expect(ultimo, rotulo).toBeLessThanOrEqual(Date.now());
      if (conversa.status === "OPEN" || conversa.status === "PENDING") expect(Date.now() - ultimo, rotulo).toBeLessThan(DIA_MS);
      if (conversa.status === "WAITING" || conversa.status === "CLOSED") expect(Date.now() - ultimo, rotulo).toBeGreaterThan(DIA_MS);

      const metadataDaConversa = (e: Record<string, unknown>) => json(e.metadata)?.conversationId === conversa.conversationId;

      if (conversa.casoId != null) {
        const caso = casos.get(conversa.casoId as number);
        expect(caso, `${rotulo}: caso de outro provedor`).toBeTruthy();
        expect(caso!.customerId).toBe(conversa.customerId);
        expect(casoFechado(caso!.status as string), `${rotulo}: conversa em caso fechado`).toBe(false);

        const doCaso = eventosCobranca.filter((e) => e.casoId === caso!.id && metadataDaConversa(e));
        const contato = doCaso.find((e) => e.tipo === "contato");
        expect(contato, `${rotulo}: sem evento de contato`).toBeTruthy();
        expect(contato!.canal).toBe("whatsapp");
        expect(json(contato!.metadata)).toEqual({ origem: "chat_integrado", conversationId: conversa.conversationId });
        expect(doCaso.map((e) => e.tipo)).toContain("nota");
        // O contato que abriu a conversa; o último contato do caso é o mais recente (a última fala da equipe, quando houve).
        expect(ms(contato!.ocorridoEm)).toBe(ms(conversa.abertaEm));
        expect(ms(caso!.ultimoContatoEm)).toBe(Math.max(...doCaso.filter((e) => e.tipo === "contato").map((e) => ms(e.ocorridoEm))));
      }

      if (conversa.origem === "equipamentos") {
        expect(conversa.casoId ?? null).toBeNull();
        const recuperacao = recuperacoes.get(conversa.recuperacaoId as number);
        expect(recuperacao, `${rotulo}: recuperacao de outro provedor`).toBeTruthy();
        expect(recuperacao!.customerId).toBe(conversa.customerId);
        expect(recuperacao!.closedAt ?? null, `${rotulo}: conversa em recuperacao encerrada`).toBeNull();
        const doChat = eventosRecuperacao.filter((e) => e.caseId === recuperacao!.id && metadataDaConversa(e));
        expect(doChat.map((e) => e.type).sort()).toEqual(["nota", "tentativa"]);
        expect(json(doChat[0].metadata)).toEqual({ origem: "chat_integrado", conversationId: conversa.conversationId });
      }
    }
    // Toda conversa de cobrança — ativo ou ex-cliente — nasce de um caso vivo.
    for (const conversa of [...filas.ativos, ...filas.ex]) expect(conversa.casoId, String(conversa.conversationId)).not.toBeNull();
  });

  it("caso 'aberto' nunca tem contato nem conversa — no produto, abrir a conversa move o caso para 'em contato'", async () => {
    const abertos = (await casosDeCobrancaDe(s.providerId)).filter((c) => c.status === "aberto");
    expect(abertos.length).toBeGreaterThan(0);
    const conversas = linhasDe("chat_bullq_conversas", s.providerId);
    const eventos = linhasDe("cobranca_eventos", s.providerId);
    for (const caso of abertos) {
      expect(caso.ultimoContatoEm ?? null, JSON.stringify(caso)).toBeNull();
      expect(conversas.some((c) => c.casoId === caso.id), `caso ${caso.id} aberto com conversa`).toBe(false);
      expect(eventos.some((e) => e.casoId === caso.id && e.tipo === "contato"), `caso ${caso.id} aberto com contato`).toBe(false);
    }
  });

  it("todo caso que saiu da fila tem o evento da transicao que o produto grava — propor e desfazer num negativado nao o devolve a fila", async () => {
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const eventos = linhasDe("cobranca_eventos", s.providerId);
    const alvos = vivos.filter((c) => ["negociando", "acordo_ativo", "negativado"].includes(c.status as string));
    expect(new Set(alvos.map((c) => c.status))).toEqual(new Set(["negociando", "acordo_ativo", "negativado"]));

    for (const caso of alvos) {
      const rotulo = `caso ${caso.id} (${caso.status}, ${caso.carteira})`;
      const doCaso = eventos.filter((e) => e.casoId === caso.id);
      // `etapa_mudou` (a régua, Leva 2 fase B) também leva `para` — de etapa, não de status.
      const transicoes = doCaso.filter((e) => e.tipo !== "etapa_mudou" && json(e.metadata)?.para != null);

      // A transição que pôs o caso no status de hoje, no instante que `statusDesde` diz.
      const atual = transicoes.find((e) => json(e.metadata).para === caso.status);
      expect(atual, `${rotulo}: sem o evento da transicao para ${caso.status}`).toBeTruthy();
      expect(ms(atual!.ocorridoEm), rotulo).toBe(ms(caso.statusDesde));

      // Cada degrau no formato da rota (cobranca.routes.ts, PATCH do caso): tipo da máquina de estados, metadata { de, para }.
      for (const t of transicoes) {
        const { de, para } = json(t.metadata) as { de: StatusDeCaso; para: StatusDeCaso };
        expect(transicaoDeCaso(de, para), `${rotulo}: ${de} -> ${para}`).toEqual({ ok: true });
        expect(t.tipo, `${rotulo}: ${de} -> ${para}`).toBe(eventoDaTransicaoDeCaso(de, para));
        expect(ms(t.ocorridoEm), rotulo).toBeGreaterThanOrEqual(ms(caso.abertoEm));
        expect(ms(t.ocorridoEm), rotulo).toBeLessThanOrEqual(ms(caso.statusDesde));
        // De onde ele saiu tem de estar contado antes: "em contato" pelo contato, o resto pela transição anterior.
        const antes = (e: Record<string, unknown>) => ms(e.ocorridoEm) <= ms(t.ocorridoEm);
        if (de === "em_contato") expect(doCaso.some((e) => e.tipo === "contato" && antes(e)), `${rotulo}: saiu de em_contato sem contato`).toBe(true);
        else if (de !== "aberto") expect(transicoes.some((e) => e !== t && json(e.metadata).para === de && antes(e)), `${rotulo}: saiu de ${de} sem ter chegado`).toBe(true);
      }
    }

    // O defeito de verdade: criar a proposta leva o negativado a "negociando"; cancelar chama
    // `statusDeFundoDoCaso` (cobranca.storage.ts), que só devolve "negativado" achando o evento
    // `negativacao` do caso — sem ele o caso voltava a "aberto", o que estados.ts proíbe.
    const negativados = vivos.filter((c) => c.status === "negativado");
    expect(negativados.length).toBeGreaterThan(0);
    for (const caso of negativados) {
      const negativacao = eventos.filter((e) => e.casoId === caso.id && e.tipo === "negativacao");
      expect(negativacao, `caso ${caso.id} negativado sem o evento negativacao`).toHaveLength(1);
      expect(ms(negativacao[0].ocorridoEm)).toBeLessThanOrEqual(ms(caso.statusDesde));
      const fundoAposPropor = negativacao.length > 0 ? "negativado" : "aberto";
      expect(statusAposNegociacaoDesfeita(fundoAposPropor), `caso ${caso.id}`).toBe("negativado");
    }
  });

  it("nenhum cliente com conversa de cobranca e candidato da regua — a primeira passada do worker nao abre um card 'aberto' ao lado da conversa", async () => {
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const conversas = linhasDe("chat_bullq_conversas", s.providerId).filter((c) => c.origem === "cobranca");
    expect(conversas).toHaveLength(16);

    for (const conversa of conversas) {
      const rotulo = `${conversa.conversationId} (${conversa.status})`;
      const cliente = clientes.get(conversa.customerId as number)!;
      // A conversa é de cobrança porque o cliente deve — é justamente o que faria dele candidato sem caso vivo.
      expect(Number(cliente.totalOverdueAmount), rotulo).toBeGreaterThan(DIVIDA_MINIMA_PARA_CASO);
      expect(cliente.maxDaysOverdue as number, rotulo).toBeGreaterThanOrEqual(1);

      const caso = vivos.find((c) => c.id === conversa.casoId);
      expect(caso, `${rotulo}: conversa de cobranca sem caso vivo — a regua abriria um card 'aberto' para o cliente`).toBeTruthy();
      expect(caso!.customerId, rotulo).toBe(conversa.customerId);
      expect(caso!.status, `${rotulo}: conversa num caso 'aberto'`).not.toBe("aberto");

      // As condições de `clientesParaAbrirCaso` (cobranca.storage.ts): dívida acima do mínimo, atraso >= 1 e nenhum caso vivo.
      const candidato = Number(cliente.totalOverdueAmount) > DIVIDA_MINIMA_PARA_CASO
        && (cliente.maxDaysOverdue as number) >= 1
        && !vivos.some((c) => c.customerId === cliente.id);
      expect(candidato, rotulo).toBe(false);
    }
  });

  it("nenhum caso vivo cobra o equipamento de uma recuperacao concluida — o aparelho cobrado segue retido", async () => {
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const recuperacoes = linhasDe("equipment_recovery_cases", s.providerId);
    const equipamentos = await equipamentosDe(s.providerId);
    const faturas = await faturasDe(s.providerId);
    let conferidos = 0;
    for (const caso of vivos) {
      const cobraEquipamento = faturas.some((f) => f.customerId === caso.customerId && f.status === "overdue" && /equipamento/.test(String(f.descricao ?? "")));
      if (!cobraEquipamento) continue;
      conferidos++;
      const rotulo = `caso ${caso.id} (${caso.status})`;
      expect(recuperacoes.filter((r) => r.customerId === caso.customerId).map((r) => r.status), rotulo).not.toContain("concluido");
      const doCliente = equipamentos.filter((e) => e.customerId === caso.customerId);
      expect(doCliente.some((e) => equipamentoTemRetiradaPendente(e.status as string)), `${rotulo}: cobra equipamento que nao esta retido`).toBe(true);
    }
    // As 11 posições ímpares abaixo de 30 sem recuperação: ONU retida, saída devida
    // cobrando o aparelho — e, com a carteira completa, todas com caso vivo.
    expect(conferidos, "os casos vivos de ex-cliente cobram a fatura de saida").toBe(11);
  });

  it("o roteiro de cada conversa semeada conta a mesma historia que o caso, a recuperacao e a linha do tempo", async () => {
    const agora = Date.now();
    const provedor = (banco.linhas.get("providers") ?? []).find((p) => p.id === s.providerId)!;
    const admin = adminDe(s.providerId);
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const casos = new Map((await casosDeCobrancaDe(s.providerId)).map((c) => [c.id as number, c]));
    const recuperacoes = new Map(linhasDe("equipment_recovery_cases", s.providerId).map((r) => [r.id as number, r]));
    const equipamentos = new Map((await equipamentosDe(s.providerId)).map((e) => [e.id as number, e]));
    const eventosCobranca = linhasDe("cobranca_eventos", s.providerId);
    const eventosRecuperacao = linhasDe("equipment_recovery_events", s.providerId);
    const conversas = linhasDe("chat_bullq_conversas", s.providerId);
    expect(conversas.length).toBeGreaterThan(0);

    for (const conversa of conversas) {
      const cliente = clientes.get(conversa.customerId as number)!;
      const caso = conversa.casoId != null ? casos.get(conversa.casoId as number) : undefined;
      const recuperacao = conversa.recuperacaoId != null ? recuperacoes.get(conversa.recuperacaoId as number) : undefined;
      const equip = recuperacao ? equipamentos.get(recuperacao.equipmentId as number) : undefined;
      const linha: LinhaDaConversa = {
        conversationId: conversa.conversationId as string, status: conversa.status as string, origem: conversa.origem as string, canalId: conversa.canalId as string,
        abertaEm: new Date(ms(conversa.abertaEm)), ultimoEventoEm: new Date(ms(conversa.ultimoEventoEm)),
        clienteNome: cliente.name as string, clienteTelefone: (cliente.phone as string) ?? null,
        clienteDivida: (cliente.totalOverdueAmount as string) ?? null, clienteDias: (cliente.maxDaysOverdue as number) ?? null,
        provedorNome: provedor.name as string, provedorFantasia: (provedor.tradeName as string) ?? null, atendenteNome: admin.name as string,
        casoStatus: (caso?.status as string) ?? null, casoCarteira: (caso?.carteira as string) ?? null,
        casoValor: (caso?.valorAtual as string) ?? null, casoDias: (caso?.diasAtrasoAbertura as number) ?? null,
        recuperacaoStatus: (recuperacao?.status as string) ?? null, recuperacaoAgendadaEm: recuperacao?.scheduledAt ? new Date(ms(recuperacao.scheduledAt)) : null,
        equipamentoTipo: (equip?.type as string) ?? null, equipamentoMarca: (equip?.brand as string) ?? null, equipamentoModelo: (equip?.model as string) ?? null,
      };
      const msgs = roteiroDaConversa(linha, agora);
      const texto = msgs.map((m) => m.content.text).join(" | ");
      const rotulo = `${linha.conversationId} (${linha.status}, caso ${linha.casoStatus}, recuperacao ${linha.recuperacaoStatus})`;
      const doChat = (e: Record<string, unknown>) => json(e.metadata)?.conversationId === linha.conversationId;

      if (linha.status === "BOT") {
        // O robô só mandou a abertura, e a linha do tempo diz o mesmo: contato sem resultado e sem usuário.
        expect(msgs.every((m) => m.direction === "OUTBOUND" && m.senderName === "Assistente virtual"), rotulo).toBe(true);
        if (caso) expect(eventosCobranca.find((e) => doChat(e) && e.tipo === "contato"), rotulo).toMatchObject({ resultado: null, userId: null });
        if (recuperacao) expect(eventosRecuperacao.find((e) => doChat(e) && e.type === "tentativa"), rotulo).toMatchObject({ result: "sem_resposta", userId: null });
        continue;
      }
      expect(msgs.some((m) => m.direction === "INBOUND"), `${rotulo}: resposta registrada sem fala do cliente`).toBe(true);
      if (caso) expect(eventosCobranca.find((e) => doChat(e) && e.tipo === "contato")?.resultado ?? null, rotulo).not.toBeNull();
      if (caso && !casoFechado(linha.casoStatus!)) expect(texto, rotulo).not.toMatch(/paguei|Pagamento localizado/);
      if (linha.casoStatus === "negativado") {
        expect(texto, rotulo).toMatch(/não vou pagar/);
        expect(texto, rotulo).not.toMatch(/PIX|esquecimento/);
      }
      if (linha.casoStatus === "acordo_ativo") expect(texto, rotulo).toMatch(/Acordo registrado/);
      if (!caso && linha.origem === "cobranca" && (linha.clienteDias ?? 0) > 14) expect(texto, rotulo).not.toMatch(/esquecimento/);
      if (linha.recuperacaoStatus === "contestado") {
        expect(texto, rotulo).not.toMatch(/Recebemos o equipamento|Pode vir buscar/);
        // A contestação nasce da conversa: depois de o contato abrir, antes do último evento.
        const contestadoEm = ms(recuperacao!.disputedAt);
        expect(contestadoEm, rotulo).toBeGreaterThan(linha.abertaEm.getTime());
        expect(contestadoEm, rotulo).toBeLessThan(linha.ultimoEventoEm!.getTime());
      }
      if (linha.status === "CLOSED") expect(msgs.at(-1)!.content.text, rotulo).toMatch(/encerrar/);
    }
  });

  it("a Economia sai calculada, nunca pendente, para em dia, inadimplente, ex-cliente devendo e ex-cliente que pagou", async () => {
    const economia = json(linhasDe("cobranca_politica", s.providerId)[0].economia) as Economia;
    const clientes = await clientesDe(s.providerId);
    const faturas = await faturasDe(s.providerId);
    const hoje = new Date();
    const amostras: Record<string, Record<string, unknown> | undefined> = {
      emDia: clientes.find((c) => c.status === "active" && c.paymentStatus === "current"),
      inadimplente: clientes.find((c) => c.paymentStatus === "overdue"),
      exDevendo: clientes.find((c) => c.status === "cancelled" && Number(c.totalOverdueAmount) > 0),
      exPagou: clientes.find((c) => c.status === "cancelled" && Number(c.totalOverdueAmount) === 0),
    };
    for (const [nome, c] of Object.entries(amostras)) {
      expect(c, nome).toBeTruthy();
      const doCliente = faturas.filter((f) => f.customerId === c!.id);
      const vencidas = doCliente.filter((f) => f.status === "overdue").map((f) => ms(f.dueDate));
      const r = economiaDoCliente({
        hoje,
        statusErp: c!.status as string,
        carteira: c!.status === "cancelled" ? "ex_cliente" : "ativo",
        contractStartDate: c!.contractStartDate as string,
        cortadoEm: c!.cortadoEm ? new Date(ms(c!.cortadoEm)) : null,
        ultimaFaturaEmitidaEm: vencidas.length ? new Date(Math.max(...vencidas)) : null,
        primeiraFaturaVencidaEm: vencidas.length ? new Date(Math.min(...vencidas)) : null,
        plano: c!.contractPlan as string,
        dividaAtual: Number(c!.totalOverdueAmount),
        economia,
        mensalidadeObservada: null,
        historicoPagamento: null,
        erpConfirmaPagamentos: null,
        erpSource: FONTE_ERP_DEMO,
        cobrancaDeSaida: null,
      });
      expect(r.economiaPendente, `${nome}: ${r.economiaPendente}`).toBeNull();
      expect(r.economia, nome).not.toBeNull();
    }
  });

  it("nada da semeadura nova sai do proprio provedor nem inventa pessoa: todo cliente referenciado e da carteira de 1.500", async () => {
    const idsClientes = new Set((await clientesDe(s.providerId)).map((c) => c.id));
    expect(idsClientes.size).toBe(1500);
    const referencias = [
      ...(await casosDeCobrancaDe(s.providerId)),
      ...linhasDe("equipment_recovery_cases", s.providerId),
      ...linhasDe("chat_bullq_conversas", s.providerId),
      ...linhasDe("cobranca_eventos", s.providerId),
    ];
    for (const linha of referencias) {
      expect(idsClientes.has(linha.customerId), JSON.stringify(linha)).toBe(true);
    }
    const idsRecuperacoes = new Set(linhasDe("equipment_recovery_cases", s.providerId).map((r) => r.id));
    for (const e of linhasDe("equipment_recovery_events", s.providerId)) {
      expect(idsRecuperacoes.has(e.caseId), JSON.stringify(e)).toBe(true);
    }
  });

  it("apagarSandbox leva a semeadura inteira — politica, recuperacoes, eventos, integracao e conversas incluidos", async () => {
    await apagarSandbox(s.providerId);
    const residuos: string[] = [];
    for (const tabela of TABELAS) {
      const nome = getTableName(tabela);
      if (!("providerId" in getTableColumns(tabela))) continue;
      const sobra = linhasDe(nome, s.providerId).length;
      if (sobra > 0) residuos.push(`${nome} (${sobra})`);
    }
    expect(residuos).toEqual([]);
  });
});

/**
 * Leva 2, pacote P2 (fase A): o que a auditoria de telas da rodada 2 achou de
 * incoerente DENTRO da semeadura — cada `it()` é um achado virado invariante,
 * conferido contra a função real do produto que lê aquele dado. Um sandbox
 * próprio, criado uma vez: os `it()` só leem.
 */
describe("a semeadura conta a mesma historia em todas as telas (Leva 2, fase A do P2)", () => {
  const DIA_MS = 86_400_000;
  let s: Awaited<ReturnType<typeof criarSandbox>>;

  const ms = (valor: unknown): number => new Date(valor as string | Date).getTime();
  const json = (valor: unknown): any => (typeof valor === "string" ? JSON.parse(valor) : valor);
  const linhasDe = (tabela: string, providerId: number) => (banco.linhas.get(tabela) ?? []).filter((l) => l.providerId === providerId);
  const adminDe = (providerId: number) => (banco.linhas.get("users") ?? []).find((u) => u.providerId === providerId)!;
  const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  /** O literal de array que o pg-proxy grava (`{"Londrina - PR",...}`) — ver o teste de `cidadesAtendidas` acima. */
  const listaDoArray = (literal: unknown): string[] =>
    String(literal ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean).map((x) => x.replace(/^"|"$/g, ""));

  beforeAll(async () => {
    s = await criarSandbox();
  });

  it("o caso 'pago' e pago de fato: fatura paga, cliente sem divida e o encerramento na linha do tempo", async () => {
    const pagos = (await casosDeCobrancaDe(s.providerId)).filter((c) => c.status === "pago");
    expect(pagos).toHaveLength(1);
    const caso = pagos[0];
    const cliente = (await clientesDe(s.providerId)).find((c) => c.id === caso.customerId)!;
    // Até aqui o card "pago" apontava para um cliente com R$ 79,90 vencidos: sumia
    // da lista da carteira e o cabeçalho (1.349) brigava com o KPI (1.350).
    expect(cliente.status).toBe("active");
    expect(cliente.paymentStatus).toBe("current");
    expect(Number(cliente.totalOverdueAmount)).toBe(0);
    expect(cliente.overdueInvoicesCount ?? 0).toBe(0);
    expect(cliente.maxDaysOverdue ?? 0).toBe(0);

    const faturas = (await faturasDe(s.providerId)).filter((f) => f.customerId === cliente.id);
    expect(faturas.filter((f) => f.status !== "paid"), "fatura em aberto para quem pagou").toEqual([]);
    const paga = faturas.find((f) => f.status === "paid");
    expect(paga, "caso pago sem fatura paga").toBeTruthy();
    expect(paga!.paidValue).toBe(paga!.value);
    expect(ms(paga!.paidDate)).toBeGreaterThan(ms(paga!.dueDate));
    expect(ms(paga!.paidDate)).toBeLessThanOrEqual(Date.now());

    // A régua abre depois do vencimento; o caso fecha quando o pagamento entra.
    expect(ms(caso.abertoEm)).toBeGreaterThan(ms(paga!.dueDate));
    expect(ms(caso.abertoEm)).toBeLessThan(ms(caso.encerradoEm));
    expect(ms(caso.encerradoEm)).toBe(ms(paga!.paidDate));
    expect(ms(caso.statusDesde)).toBe(ms(caso.encerradoEm));

    // O evento que `encerrarCaso` (cobranca.storage.ts) grava ao fechar pelo kanban.
    const encerramentos = linhasDe("cobranca_eventos", s.providerId).filter((e) => e.casoId === caso.id && e.tipo === "encerramento");
    expect(encerramentos, "caso pago sem o encerramento na linha do tempo").toHaveLength(1);
    const { status, de } = json(encerramentos[0].metadata) as { status: string; de: StatusDeCaso };
    expect(status).toBe("pago");
    expect(transicaoDeCaso(de, "pago")).toEqual({ ok: true });
    expect(ms(encerramentos[0].ocorridoEm)).toBe(ms(caso.encerradoEm));
  });

  it("todo devedor ja nasce com o seu caso vivo — a primeira passada da regua nao abre card nenhum na frente do visitante", async () => {
    const clientes = await clientesDe(s.providerId);
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    // As condições de `clientesParaAbrirCaso` (cobranca.storage.ts) que dependem do cliente.
    const devedores = clientes.filter((c) => Number(c.totalOverdueAmount) > DIVIDA_MINIMA_PARA_CASO && (c.maxDaysOverdue as number) >= 1);
    expect(devedores).toHaveLength(293);
    for (const d of devedores) {
      const doCliente = vivos.filter((c) => c.customerId === d.id);
      expect(doCliente, `cliente ${d.id} (${d.status}, ${d.maxDaysOverdue} dias) sem caso vivo`).toHaveLength(1);
      expect(doCliente[0].carteira, `cliente ${d.id}`).toBe(carteiraDoStatusErp(d.status as string));
    }
    const idsDevedores = new Set(devedores.map((d) => d.id));
    for (const c of vivos) expect(idsDevedores.has(c.customerId), `caso ${c.id} vivo para quem nao deve`).toBe(true);
  });

  it("parte dos casos vivos e do administrador e parte fica na fila geral — 'Minha fila', 'Toda a equipe' e 'Fila geral' diferem", async () => {
    const admin = adminDe(s.providerId);
    const etapasDoAdmin = new Set(
      (json(linhasDe("cobranca_politica", s.providerId)[0].etapas) as Array<{ id: string; responsavelUserId?: number | null }>)
        .filter((e) => e.responsavelUserId === admin.id)
        .map((e) => e.id),
    );
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const conversas = linhasDe("chat_bullq_conversas", s.providerId);

    expect(vivos.some((c) => c.responsavelUserId === admin.id), "nenhum caso na fila do admin").toBe(true);
    expect(vivos.some((c) => (c.responsavelUserId ?? null) === null), "nenhum caso na fila geral").toBe(true);
    for (const caso of vivos) {
      // Quem conversou pelo chat é dono do caso; sem conversa humana, vale o responsável da etapa.
      const conversa = conversas.find((c) => c.casoId === caso.id);
      const esperado = (conversa && conversa.status !== "BOT") || etapasDoAdmin.has(caso.etapaAtual as string) ? admin.id : null;
      expect(caso.responsavelUserId ?? null, `caso ${caso.id} (${caso.status}, ${caso.etapaAtual}, conversa ${conversa?.status ?? "-"})`).toBe(esperado);
    }
    const abertas = conversas.filter((c) => c.origem === "cobranca" && c.status === "OPEN");
    expect(abertas.length).toBeGreaterThan(0);
    for (const conversa of abertas) {
      expect(vivos.find((c) => c.id === conversa.casoId)?.responsavelUserId, String(conversa.conversationId)).toBe(admin.id);
    }
  });

  it("politica com a origem da cobranca 'manual' nas duas carteiras e etapas com responsavel — sem mudar a janela de etapa nenhuma", async () => {
    const admin = adminDe(s.providerId);
    const politica = linhasDe("cobranca_politica", s.providerId)[0];
    const acordo = json(politica.acordo);
    // `nao_definida` só autoriza o valor integral à vista, e contradizia os casos negociando e com acordo.
    expect(acordo.ativo.origemDaCobranca).toBe("manual");
    expect(acordo.ex_cliente.origemDaCobranca).toBe("manual");
    expect(AcordoSchema.safeParse(acordo).success, JSON.stringify(AcordoSchema.safeParse(acordo))).toBe(true);

    const etapas = json(politica.etapas);
    expect(EtapasConfigSchema.safeParse(etapas).success).toBe(true);
    expect((etapas as Array<{ responsavelUserId?: number | null }>).some((e) => e.responsavelUserId === admin.id)).toBe(true);
    // A régua lê as janelas desta política: mexer nelas moveria todo card semeado.
    const janelas = (lista: ReturnType<typeof resolverEtapas>) => lista.map((e) => [e.id, e.diaMin, e.diaMax, e.ativa]);
    expect(janelas(resolverEtapas({ etapas }))).toEqual(janelas(resolverEtapas(null)));
  });

  it("cidades atendidas no formato que a Regionalizacao grava, e plano que a tabela de precos conhece", async () => {
    const provider = await providerDe(s.providerId);
    const cidades = listaDoArray(provider.cidadesAtendidas);
    // PUT /api/regional/cidades recusa qualquer outra forma (regional.routes.ts), e a busca
    // de cidades devolvia "Londrina - PR" de novo ao lado de "Londrina".
    for (const cidade of cidades) expect(cidade).toMatch(/^.+ - [A-Z]{2}$/);
    expect([...cidades].sort()).toEqual(["Apucarana - PR", "Cambé - PR", "Ibiporã - PR", "Londrina - PR"]);
    expect(Object.keys(PLAN_PRICES)).toContain(provider.plan);
  });

  it("todo cliente com coordenada diz de onde ela veio — o modo Rede do mapa so plota procedencia confiavel", async () => {
    const clientes = await clientesDe(s.providerId);
    const comCoordenada = clientes.filter((c) => c.latitude && c.longitude);
    expect(comCoordenada).toHaveLength(1500);
    for (const c of comCoordenada) expect(c.geoPrecisao, `cliente ${c.id}`).toBe("erp");
  });

  it("status de equipamento e canal de tentativa no vocabulario que o produto aceita hoje", async () => {
    for (const e of await equipamentosDe(s.providerId)) {
      expect(EQUIPMENT_STATUSES as readonly string[], `equipamento ${e.id}: ${e.status}`).toContain(e.status);
    }
    // `tentativaSchema` não é exportado: o enum é lido do texto da rota.
    const rota = readFileSync(new URL("../routes/equipamentos.routes.ts", import.meta.url), "utf8");
    const bloco = /const tentativaSchema = z\.object\(\{\s*channel: z\.enum\(\[([^\]]*)\]\)/.exec(rota);
    expect(bloco, "tentativaSchema nao encontrado em equipamentos.routes.ts").not.toBeNull();
    const canais = Array.from(bloco![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    const tentativas = linhasDe("equipment_recovery_events", s.providerId).filter((e) => e.type === "tentativa");
    expect(tentativas.length).toBeGreaterThan(0);
    for (const t of tentativas) expect(canais, `tentativa ${t.id}: ${t.channel}`).toContain(t.channel);
  });

  it("os KPIs da recuperacao acendem pelo montador real: prazo critico e recuperados nos ultimos 30 dias", async () => {
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const equipamentos = new Map((await equipamentosDe(s.providerId)).map((e) => [e.id as number, e]));
    const casos: EntradaCasoBoard[] = linhasDe("equipment_recovery_cases", s.providerId).map((r) => {
      const e = equipamentos.get(r.equipmentId as number)!;
      const c = clientes.get(r.customerId as number)!;
      return {
        id: r.id as number, status: r.status as string, prioridade: (r.priority as string) ?? "normal",
        rescisaoEm: new Date(ms(r.terminationDate)), prazoAt: new Date(ms(r.deadlineAt)),
        agendadoEm: null, metodo: null, responsavelId: null, responsavelNome: null, notificadoEm: null,
        bureauStatus: (r.bureauStatus as string) ?? "pendente", contestadoEm: null,
        encerradoEm: r.closedAt ? new Date(ms(r.closedAt)) : null, notas: null,
        equipamento: { id: e.id as number, tipo: e.type as string, marca: e.brand as string, modelo: e.model as string, serie: e.serialNumber as string, mac: e.mac as string, patrimonio: null, valor: e.value as string, status: e.status as string },
        cliente: { id: c.id as number, nome: c.name as string, cpfCnpj: c.cpfCnpj as string, telefone: c.phone as string, endereco: c.address as string, numero: c.addressNumber as string, bairro: c.neighborhood as string, cidade: c.city as string, uf: c.state as string, situacao: c.status as string, dividaEmAberto: c.totalOverdueAmount as string, diasEmAtraso: c.maxDaysOverdue as number },
      };
    });
    const board = montarBoard({ casos, equipamentosSemCaso: [], tentativas: [], usuarios: [] });

    expect(board.kpis.prazoCritico, JSON.stringify(board.kpis)).toBeGreaterThanOrEqual(1);
    expect(board.kpis.prazoCritico, JSON.stringify(board.kpis)).toBeLessThanOrEqual(2);
    for (const card of board.cards.filter((c) => c.caso && c.coluna !== "recuperado" && c.coluna !== "baixado" && c.caso.diasRestantes <= 10)) {
      expect(card.caso!.diasRetido, card.chave).toBeGreaterThanOrEqual(50);
      expect(card.caso!.diasRetido, card.chave).toBeLessThanOrEqual(55);
      expect(card.coluna, card.chave).toBe("31a60");
    }
    expect(board.kpis.recuperados30d, JSON.stringify(board.kpis)).toBe(2);
    expect(board.kpis.valorRecuperado30d).toBe(580);
  });

  it("a fatura de saida so cobra o equipamento que nao voltou nem esta voltando", async () => {
    const recuperacoes = linhasDe("equipment_recovery_cases", s.providerId);
    const equipamentos = await equipamentosDe(s.providerId);
    const saidas = (await faturasDe(s.providerId)).filter((f) => String(f.erpRef).startsWith("demo-saida-"));
    expect(saidas).toHaveLength(150);
    let emRecuperacao = 0;
    for (const f of saidas) {
      const doCliente = recuperacoes.filter((r) => r.customerId === f.customerId);
      // Aberta: o provedor quer o aparelho de volta. Concluída: o aparelho voltou.
      const voltaOuVoltou = doCliente.some((r) => !casoEstaEncerrado(r.status as string) || r.status === "concluido");
      const semAparelho = !equipamentos.some((e) => e.customerId === f.customerId);
      if (doCliente.some((r) => !casoEstaEncerrado(r.status as string))) emRecuperacao++;
      const { equipamento, multa, indeterminada } = parcelasDaDescricao(f.descricao as string, Number(f.value));
      const rotulo = `${f.erpRef}: ${f.descricao}`;
      expect(indeterminada, rotulo).toBe(false);
      expect(multa, rotulo).toBe(300);
      expect(equipamento, rotulo).toBe(voltaOuVoltou || semAparelho ? 0 : 290);
    }
    expect(emRecuperacao, "as 5 recuperacoes abertas").toBe(5);
  });

  it("o caso 'baixado' leva a fatura para fora dos vencidos — agregado e faturas vencidas contam a mesma soma no provedor inteiro", async () => {
    const baixado = (await casosDeCobrancaDe(s.providerId)).find((c) => c.status === "baixado")!;
    const faturas = await faturasDe(s.providerId);
    const saida = faturas.find((f) => f.customerId === baixado.customerId && String(f.erpRef).startsWith("demo-saida-"))!;
    expect(saida.status, "a fatura do caso baixado segue vencida").toBe("baixada_no_erp");
    expect(saida.baixadaEm).toBeTruthy();
    expect(ms(saida.baixadaEm)).toBeLessThanOrEqual(Date.now());

    const clientes = await clientesDe(s.providerId);
    const vencidas = faturas.filter((f) => f.status === "overdue");
    expect(clientes.reduce((soma, c) => soma + centavos(c.totalOverdueAmount), 0)).toBe(vencidas.reduce((soma, f) => soma + centavos(f.value), 0));
    for (const c of clientes) {
      const doCliente = vencidas.filter((f) => f.customerId === c.id);
      expect(c.overdueInvoicesCount ?? 0, `cliente ${c.id}`).toBe(doCliente.length);
    }
  });

  it("ex-clientes devendo em todas as etapas da regua do ex-cliente, com saida vencida no mes corrente — sem quebrar recuperacao nem sinal de bureau", async () => {
    const vivosEx = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string) && c.carteira === "ex_cliente");
    const etapas = new Set(vivosEx.map((c) => c.etapaAtual));
    // Antes as saídas só tinham 60, 150 e 365 dias: lembrete e dívida antiga nunca tinham ninguém.
    for (const etapa of etapasDaCarteira("ex_cliente")) expect([...etapas], etapa.id).toContain(etapa.id);

    const agora = new Date();
    const mesCorrente = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
    // No dia 1 não existe saída vencida no próprio mês (vencer hoje ainda não é atraso).
    if (Math.min(agora.getDate(), agora.getUTCDate()) > 1) {
      const idsEx = new Set(vivosEx.map((c) => c.customerId));
      const doMes = (await faturasDe(s.providerId)).filter((f) =>
        idsEx.has(f.customerId) && f.status === "overdue" && new Date(ms(f.dueDate)).toISOString().slice(0, 7) === mesCorrente);
      expect(doMes.length, "o card de prejuizo abre o mes corrente zerado").toBeGreaterThan(0);
    }
    // O sinal de bureau da notificação formal continua passando na regra real.
    const formal = linhasDe("equipment_recovery_cases", s.providerId).find((r) => r.status === "notificacao_formal")!;
    expect(formal.bureauStatus).toBe("ativo_validado");
  });

  it("todo cancelado tem o motivo do corte que o ERP daria — e quem saiu devendo foi cortado pelo financeiro", async () => {
    const clientes = await clientesDe(s.providerId);
    const familias = new Set<string | null>();
    for (const c of clientes) {
      if (c.status !== "cancelled") {
        expect(c.motivoCorte ?? null, `cliente ${c.id}`).toBeNull();
        continue;
      }
      const familia = normalizarMotivoCorte(c.motivoCorte as string);
      familias.add(familia);
      expect(familia, `cliente ${c.id}: "${c.motivoCorte}"`).not.toBeNull();
      if (Number(c.totalOverdueAmount) > 0) expect(familia, `cliente ${c.id}`).toBe("financeiro");
    }
    expect(familias).toEqual(new Set(["financeiro", "administrativo"]));
  });

  it("inadimplente ativo tambem tem ONU em comodato — e o comodato normal nao pesa no agregado de nao devolvidos", async () => {
    const equipamentos = await equipamentosDe(s.providerId);
    const inadimplentes = (await clientesDe(s.providerId)).filter((c) => c.status === "active" && c.paymentStatus === "overdue");
    const comOnu = inadimplentes.filter((c) => equipamentos.some((e) => e.customerId === c.id && e.status === "em_comodato"));
    expect(comOnu.length).toBeGreaterThan(0);
    for (const c of comOnu) {
      expect(c.equipmentCount, `cliente ${c.id}`).toBe(0);
      expect(c.equipmentEstimatedValue, `cliente ${c.id}`).toBe("0.00");
    }
  });

  it("o CPF do chip 'devendo na rede' divide o imovel com um inadimplente de outro CPF — o cruzamento de endereco da consulta acende", async () => {
    const clientes = await clientesDe(s.providerId);
    const devendo = (await cpfsDeExemplo(s.providerId)).find((e) => e.situacao === "devendo_na_rede")!;
    const chip = clientes.find((c) => c.cpfCnpj === devendo.cpf)!;
    const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
    const numero = (v: unknown) => digitos(v).replace(/^0+/, "");
    // O critério de `getCustomersByAddressForAlert` (customers.storage.ts) com CEP específico: CEP + número.
    const vizinhos = clientes.filter((c) => c.cpfCnpj !== chip.cpfCnpj && c.paymentStatus === "overdue"
      && digitos(c.cep) === digitos(chip.cep) && numero(c.addressNumber) === numero(chip.addressNumber));
    expect(vizinhos, `chip ${chip.id} em ${chip.address}, ${chip.addressNumber} (${chip.cep})`).toHaveLength(1);
    expect(vizinhos[0].status).toBe("active");
    expect(vizinhos[0].address).toBe(chip.address);
    expect(vizinhos[0].city).toBe(chip.city);
  });
});

/**
 * Leva 2, pacote P2 (fase B): a FIAÇÃO dos módulos que os outros pacotes
 * entregaram puros — chat (P1), faturas históricas (P4), trilha dos casos (P5),
 * complemento do mundo base (P8), consultas e alertas (P9) e ficha do provedor
 * (P11). Cada `it()` confere que a linha gravada é a que o módulo devolveu E que
 * ela conta a mesma história que o resto do sandbox.
 *
 * O relógio fica parado numa quarta-feira às 15h de São Paulo: o roteiro do
 * chat, a janela de contato e o "hoje" do KPI dependem da hora, e a suíte roda
 * a qualquer hora (inclusive de madrugada, quando a equipe não fala com
 * ninguém e "contatados hoje" é zero de verdade).
 */
describe("a semeadura liga os modulos da leva 2 (fase B do P2)", () => {
  const DIA_MS = 86_400_000;
  const AGORA = new Date("2026-09-16T18:00:00.000Z");
  let s: Awaited<ReturnType<typeof criarSandbox>>;

  const ms = (valor: unknown): number => new Date(valor as string | Date).getTime();
  const json = (valor: unknown): any => (typeof valor === "string" ? JSON.parse(valor) : valor);
  const linhasDe = (tabela: string, providerId: number) => (banco.linhas.get(tabela) ?? []).filter((l) => l.providerId === providerId);
  const adminDe = (providerId: number) => (banco.linhas.get("users") ?? []).find((u) => u.providerId === providerId)!;
  const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    s = await criarSandbox();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  /** A política que a régua leria desta linha — a mesma leitura de `politicaDoProvedor` (confissao-base.service.ts). */
  function politicaGravada(providerId: number) {
    const linha = linhasDe("cobranca_politica", providerId)[0];
    const r = validarPolitica({
      etapas: json(linha.etapas), negociacao: json(linha.negociacao), encargos: json(linha.encargos), janelaContato: json(linha.janelaContato),
      economia: json(linha.economia), acordo: json(linha.acordo), pausada: linha.pausada, pausadaMotivo: linha.pausadaMotivo ?? null,
    });
    if (!r.ok) throw new Error(`politica gravada invalida: ${r.erros.join("; ")}`);
    return r.politica;
  }

  it("a integracao do chat nasce com os tres perfis prontos e o primeiro contato ligado (P1)", () => {
    const [integracao] = linhasDe("chat_bullq_integracoes", s.providerId);
    // Sem isto a API da demo mostrava os perfis "nao_configurado" e "Iniciar contato" de equipamento dava 409.
    expect(integracao.agenteId).toBe(AGENTES_DA_DEMO.cobranca_ativos.id);
    const config = json(integracao.agenteConfig);
    expect(config).toEqual(JSON.parse(JSON.stringify(agenteConfigDaDemo())));
    for (const tipo of TIPOS_DE_AGENTE) {
      expect(config.agentes[tipo], tipo).toMatchObject({ id: AGENTES_DA_DEMO[tipo].id, modelo: AGENTES_DA_DEMO[tipo].modelo, etapa: "pronto", habilitado: true });
    }
    expect(config.primeiroContato.ligada).toBe(true);
  });

  it("toda conversa em que a equipe falou tem o contato no instante da ultima fala da equipe no roteiro — e ha contatados hoje (P1)", async () => {
    const provedor = await providerDe(s.providerId);
    const admin = adminDe(s.providerId);
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const casos = new Map((await casosDeCobrancaDe(s.providerId)).map((c) => [c.id as number, c]));
    const eventos = linhasDe("cobranca_eventos", s.providerId);
    const conversas = linhasDe("chat_bullq_conversas", s.providerId).filter((c) => c.casoId != null);
    expect(conversas).toHaveLength(16);

    let comFalaDaEquipe = 0;
    for (const conversa of conversas) {
      const cliente = clientes.get(conversa.customerId as number)!;
      const caso = casos.get(conversa.casoId as number)!;
      // A MESMA linha que o chat simulado monta ao ler a conversa (`camposDaConversa`).
      const linha: LinhaDaConversa = {
        conversationId: conversa.conversationId as string, status: conversa.status as string, origem: conversa.origem as string, canalId: conversa.canalId as string,
        abertaEm: new Date(ms(conversa.abertaEm)), ultimoEventoEm: new Date(ms(conversa.ultimoEventoEm)),
        clienteNome: cliente.name as string, clienteTelefone: (cliente.phone as string) ?? null,
        clienteDivida: (cliente.totalOverdueAmount as string) ?? null, clienteDias: (cliente.maxDaysOverdue as number) ?? null,
        provedorNome: provedor.name as string, provedorFantasia: (provedor.tradeName as string) ?? null, semeadaEm: new Date(ms(provedor.createdAt)), atendenteNome: admin.name as string,
        casoStatus: caso.status as string, casoCarteira: caso.carteira as string, casoValor: caso.valorAtual as string, casoDias: caso.diasAtrasoAbertura as number,
        recuperacaoStatus: null, recuperacaoAgendadaEm: null, equipamentoTipo: null, equipamentoMarca: null, equipamentoModelo: null,
      };
      // O chat congela o roteiro no `createdAt` do provedor (`roteiroCongelado`): ele é o `agora` da semeadura.
      expect(ms(provedor.createdAt), "o provedor do sandbox tem de nascer com o agora da semeadura").toBe(AGORA.getTime());
      // Lido 20 h depois (ou depois de um reinício da API), o chat usa o mesmo instante.
      const falasDaEquipe = roteiroDaConversa(linha, ms(provedor.createdAt)).filter((m) => m.direction === "OUTBOUND" && m.senderName === admin.name);
      const contatos = eventos
        .filter((e) => e.casoId === caso.id && e.tipo === "contato" && json(e.metadata)?.conversationId === conversa.conversationId)
        .map((e) => ms(e.ocorridoEm))
        .sort((a, b) => a - b);
      const rotulo = `${conversa.conversationId} (${conversa.status}, caso ${caso.status})`;

      const ultima = falasDaEquipe.at(-1);
      if (ultima && ms(ultima.createdAt) > ms(conversa.abertaEm)) {
        comFalaDaEquipe++;
        expect(contatos, rotulo).toEqual([ms(conversa.abertaEm), ms(ultima.createdAt)]);
      } else {
        expect(contatos, rotulo).toEqual([ms(conversa.abertaEm)]);
      }
      // O que `registrarEventoDeCobranca` grava a cada contato: o último é o do caso.
      expect(ms(caso.ultimoContatoEm), rotulo).toBe(Math.max(...eventos.filter((e) => e.casoId === caso.id && e.tipo === "contato").map((e) => ms(e.ocorridoEm))));
    }
    expect(comFalaDaEquipe, "nenhuma conversa com fala da equipe").toBeGreaterThan(0);

    // O mesmo recorte de `kpisDaCobranca`: contato desde a meia-noite do processo.
    const inicioDoDia = new Date(Date.now());
    inicioDoDia.setHours(0, 0, 0, 0);
    const contatadosHoje = new Set(eventos.filter((e) => e.tipo === "contato" && ms(e.ocorridoEm) >= inicioDoDia.getTime()).map((e) => e.customerId));
    expect(contatadosHoje.size, "Contatados hoje nasce zerado em plena tarde de quarta-feira").toBeGreaterThan(0);
    for (const e of eventos.filter((x) => x.tipo === "contato")) expect(ms(e.ocorridoEm), `contato ${e.id} no futuro`).toBeLessThanOrEqual(Date.now());
  });

  it("mensalidades pagas e fatura do mes para a carteira inteira, e a divida muda so pela mensalidade do mes que ja venceu (P4)", async () => {
    const faturas = await faturasDe(s.providerId);
    const clientes = await clientesDe(s.providerId);
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const mensalidades = faturas.filter((f) => String(f.erpRef).startsWith("demo-mens-"));
    expect(mensalidades.length, "o sandbox nasceu sem historico de faturas").toBeGreaterThan(5_000);
    const mesCorrente = AGORA.toISOString().slice(0, 7);
    for (const f of mensalidades) {
      const rotulo = String(f.erpRef);
      expect(["paid", "aberta", "overdue"], rotulo).toContain(f.status);
      if (f.status === "paid") expect(ms(f.paidDate), rotulo).toBeLessThanOrEqual(Date.now());
      else if (f.status === "aberta") expect(ms(f.dueDate), `${rotulo}: a vencer que ja venceu`).toBeGreaterThan(Date.now());
      else {
        // Revisão da fase B: a mensalidade deste mês do inadimplente ativo, que já venceu — soma na dívida dele.
        expect(new Date(ms(f.dueDate)).toISOString().slice(0, 7), rotulo).toBe(mesCorrente);
        expect(ms(f.dueDate), rotulo).toBeLessThan(Date.now());
        expect(porId.get(f.customerId)).toMatchObject({ status: "active", paymentStatus: "overdue" });
      }
    }
    const comPaga = new Set(mensalidades.filter((f) => f.status === "paid").map((f) => f.customerId));
    for (const c of clientes.filter((x) => x.status === "active" && x.paymentStatus === "current")) {
      expect(comPaga.has(c.id), `cliente ${c.id} em dia sem nenhuma mensalidade paga`).toBe(true);
    }
    // O cliente do caso "pago" já tem a fatura daquela competência (a paga hoje): nada de segunda mensalidade no mesmo mês.
    const pago = (await casosDeCobrancaDe(s.providerId)).find((c) => c.status === "pago")!;
    const doPago = faturas.filter((f) => f.customerId === pago.customerId);
    const competencias = doPago.map((f) => new Date(ms(f.dueDate)).toISOString().slice(0, 7));
    expect(new Set(competencias).size, `competencias do caso pago: ${competencias.join(", ")}`).toBe(competencias.length);

    const vencidas = faturas.filter((f) => f.status === "overdue");
    expect(clientes.reduce((soma, c) => soma + centavos(c.totalOverdueAmount), 0)).toBe(vencidas.reduce((soma, f) => soma + centavos(f.value), 0));
    for (const c of clientes) expect(c.overdueInvoicesCount ?? 0, `cliente ${c.id}`).toBe(vencidas.filter((f) => f.customerId === c.id).length);
  });

  it("tres recuperacoes por carteira nos ultimos 30 dias: a fatura sai dos vencidos, a divida zera e o caso fecha na conciliacao depois do contato (P4)", async () => {
    const admin = adminDe(s.providerId);
    const faturas = await faturasDe(s.providerId);
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const casos = await casosDeCobrancaDe(s.providerId);
    const eventos = linhasDe("cobranca_eventos", s.providerId);
    const quitacoes = linhasDe("cobranca_quitacoes", s.providerId);
    const clienteDoBaixado = casos.find((c) => c.status === "baixado")!.customerId;

    const baixadas = faturas.filter((f) => f.status === "baixada_no_erp" && f.customerId !== clienteDoBaixado);
    const recuperacoes = [
      ...baixadas.map((f) => ({ fatura: f, em: ms(f.baixadaEm) })),
      ...quitacoes.map((q) => ({ fatura: faturas.find((f) => f.id === q.faturaId)!, em: ms(q.confirmadoEm) })),
    ];
    // A baixa acende a esteira (`recuperacaoAposContato`); a quitação, o "Recuperado 30 d" da carteira.
    expect(baixadas).toHaveLength(4);
    expect(quitacoes).toHaveLength(2);
    const porCarteira = (carteira: string) => recuperacoes.filter((r) => carteiraDoStatusErp(clientes.get(r.fatura.customerId as number)!.status as string) === carteira).length;
    expect(porCarteira("ativo")).toBe(3);
    expect(porCarteira("ex_cliente")).toBe(3);

    for (const q of quitacoes) {
      const fatura = faturas.find((f) => f.id === q.faturaId);
      expect(fatura, `quitacao ${q.id} sem fatura do proprio provedor`).toBeTruthy();
      // O que a rota de confirmação grava: comprovante conferido pelo administrador, valor integral, fatura paga.
      expect(q).toMatchObject({ origem: "comprovante_conferido", userId: admin.id, customerId: fatura!.customerId, valorPago: fatura!.value });
      expect(fatura!.status).toBe("paid");
    }

    for (const { fatura, em } of recuperacoes) {
      const cliente = clientes.get(fatura.customerId as number)!;
      const rotulo = `${fatura.erpRef} (cliente ${cliente.id}, ${cliente.status})`;
      expect(String(fatura.erpRef), rotulo).toMatch(/^demo-(fatura|saida)-/);
      expect(em, rotulo).toBeLessThanOrEqual(Date.now());
      expect(Date.now() - em, rotulo).toBeLessThan(30 * DIA_MS);
      // Quem deixou de dever sai da carteira de devedores pela regra do sync.
      expect(cliente, rotulo).toMatchObject({ totalOverdueAmount: "0.00", overdueInvoicesCount: 0, maxDaysOverdue: 0, paymentStatus: "current", riskTier: "low" });

      // O contato que antecedeu a recuperação, na janela que o indicador conta (até 7 dias antes).
      const contatos = eventos.filter((e) => e.customerId === cliente.id && e.tipo === "contato" && ms(e.ocorridoEm) <= em && ms(e.ocorridoEm) >= em - 7 * DIA_MS);
      expect(contatos, `${rotulo}: recuperacao sem contato antes`).toHaveLength(1);
      expect(janelaDoChat(new Date(ms(contatos[0].ocorridoEm)), politicaGravada(s.providerId).janelaContato).permitida, `${rotulo}: contato fora da janela`).toBe(true);

      const doCliente = casos.filter((c) => c.customerId === cliente.id);
      expect(doCliente, rotulo).toHaveLength(1);
      const caso = doCliente[0];
      // Dívida zerada no ERP: a régua fecha para conciliação (`revisarCaso`), não como "pago".
      expect(caso, rotulo).toMatchObject({ status: "encerrado", motivoEncerramento: MOTIVO_DIVIDA_ZERADA });
      expect(ms(caso.encerradoEm), rotulo).toBe(em);
      expect(ms(caso.ultimoContatoEm), rotulo).toBe(ms(contatos[0].ocorridoEm));
      expect(ms(caso.abertoEm), rotulo).toBeLessThan(ms(contatos[0].ocorridoEm));
      const encerramentos = eventos.filter((e) => e.casoId === caso.id && e.tipo === "encerramento");
      expect(encerramentos, rotulo).toHaveLength(1);
      const { status, de } = json(encerramentos[0].metadata) as { status: StatusDeCaso; de: StatusDeCaso };
      expect(status).toBe("encerrado");
      expect(transicaoDeCaso(de, "encerrado"), rotulo).toEqual({ ok: true });
      expect(ms(encerramentos[0].ocorridoEm), rotulo).toBe(em);
    }
  });

  it("negociando tem a proposta e acordo ativo tem o acordo, com parcelas a vencer e a metadata que o storage grava — sem duplicar a transicao (P5)", async () => {
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const negociacoes = linhasDe("cobranca_negociacoes", s.providerId);
    const parcelas = linhasDe("cobranca_parcelas", s.providerId);
    const eventos = linhasDe("cobranca_eventos", s.providerId);
    const hoje = dataLocal(new Date());

    const comNegociacao = vivos.filter((c) => c.status === "negociando" || c.status === "acordo_ativo");
    expect(comNegociacao.length).toBeGreaterThan(0);
    expect(negociacoes).toHaveLength(comNegociacao.length);
    for (const caso of vivos) {
      const rotulo = `caso ${caso.id} (${caso.status}, ${caso.carteira})`;
      const doCaso = negociacoes.filter((n) => n.casoId === caso.id);
      if (caso.status === "negociando") expect(doCaso.map((n) => n.status), rotulo).toEqual(["proposta"]);
      else if (caso.status === "acordo_ativo") expect(["ativa", "aceita"], rotulo).toContain(doCaso[0]?.status);
      else expect(doCaso, rotulo).toHaveLength(0);

      for (const n of doCaso) {
        expect(n.customerId, rotulo).toBe(caso.customerId);
        for (const p of parcelas.filter((x) => x.negociacaoId === n.id)) {
          if (p.status === "pendente") expect(String(p.vencimento) > hoje, `${rotulo}: parcela ${p.numero} vence ${p.vencimento}`).toBe(true);
          if (p.status === "paga") {
            const paga = eventos.filter((e) => e.casoId === caso.id && e.tipo === "parcela_paga" && json(e.metadata)?.parcelaId === p.id);
            expect(paga, `${rotulo}: parcela ${p.numero} paga sem o evento`).toHaveLength(1);
          }
        }
        const propostas = eventos.filter((e) => e.casoId === caso.id && e.tipo === "negociacao_proposta");
        expect(propostas, `${rotulo}: a proposta duplicada ou ausente na linha do tempo`).toHaveLength(1);
        // A metadata real mesclada por cima da transição: sem o registro, o aceite trataria a proposta como exceção.
        expect(json(propostas[0].metadata), rotulo).toMatchObject({ negociacaoId: n.id, para: "negociando", exigeAprovacao: false, versaoAprovacao: 1 });
        if (caso.status === "acordo_ativo") {
          const aceites = eventos.filter((e) => e.casoId === caso.id && e.tipo === "acordo_aceito");
          expect(aceites, rotulo).toHaveLength(1);
          expect(json(aceites[0].metadata), rotulo).toMatchObject({ negociacaoId: n.id, para: "acordo_ativo" });
        }
      }
    }
  });

  it("todo caso vivo tem a trilha da regua ate a etapa de hoje, e o negativado o pre-aviso a 10 dias uteis da inscricao (P5)", async () => {
    const politica = politicaGravada(s.providerId);
    const clientes = new Map((await clientesDe(s.providerId)).map((c) => [c.id as number, c]));
    const vivos = (await casosDeCobrancaDe(s.providerId)).filter((c) => !casoFechado(c.status as string));
    const eventos = linhasDe("cobranca_eventos", s.providerId);

    for (const caso of vivos) {
      const rotulo = `caso ${caso.id} (${caso.status}, ${caso.carteira})`;
      const etapas = eventos.filter((e) => e.casoId === caso.id && e.tipo === "etapa_mudou").sort((a, b) => ms(a.ocorridoEm) - ms(b.ocorridoEm));
      expect(etapas.length, `${rotulo}: sem a abertura da regua`).toBeGreaterThan(0);
      expect(json(etapas[0].metadata).abertura, rotulo).toBe(true);
      expect(ms(etapas[0].ocorridoEm), rotulo).toBe(ms(caso.abertoEm));
      expect(json(etapas.at(-1)!.metadata).para ?? null, rotulo).toBe(caso.etapaAtual ?? null);
      for (const e of etapas) expect(ms(e.ocorridoEm), rotulo).toBeLessThanOrEqual(Date.now());
    }

    const negativados = vivos.filter((c) => c.status === "negativado");
    expect(negativados.length).toBeGreaterThan(0);
    for (const caso of negativados) {
      const rotulo = `caso ${caso.id} (${caso.carteira})`;
      const preAvisos = eventos.filter((e) => e.casoId === caso.id && e.tipo === "contato" && e.canal === "email");
      expect(preAvisos, `${rotulo}: negativado sem o pre-aviso`).toHaveLength(1);
      const preAviso = ms(preAvisos[0].ocorridoEm);
      expect(preAviso, rotulo).toBeGreaterThanOrEqual(ms(caso.abertoEm));
      expect(preAviso, rotulo).toBeLessThan(ms(caso.statusDesde));
      expect(janelaDoChat(new Date(preAviso), politica.janelaContato).permitida, `${rotulo}: pre-aviso fora da janela`).toBe(true);
      const permitida = primeiraNegativacaoPermitida(
        { id: caso.id as number, carteira: caso.carteira as "ativo" | "ex_cliente", abertoEm: new Date(ms(caso.abertoEm)), diasAtraso: clientes.get(caso.customerId as number)!.maxDaysOverdue as number },
        politica,
        new Date(),
      );
      expect(ms(caso.statusDesde), `${rotulo}: negativado antes dos 10 dias uteis do pre-aviso (Sumula 359 do STJ)`).toBeGreaterThanOrEqual(permitida.getTime());
    }
  });

  it("todo alerta nasce de uma consulta da rede sobre o CPF, um minuto antes dele, com a contagem daquele instante e a divida nunca mais velha que o contrato (revisao da fase B)", async () => {
    // Até 13/09/2026 o alerta escolhia qualquer cliente — CPF que só o sandbox
    // tem, "consultado por 3 provedores" — e o 360 contava zero consultas de outros.
    const base = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));
    const consultasDaRede = (banco.linhas.get("isp_consultations") ?? []).filter((c) => base.has(c.providerId as number));
    const alertas = await alertasAntiFraudeDe(s.providerId);
    expect(alertas.length).toBeGreaterThanOrEqual(12);
    expect(alertas.length).toBeLessThanOrEqual(16);
    for (const a of alertas) {
      const doCpf = consultasDaRede.filter((c) => c.cpfCnpj === a.customerCpfCnpj);
      const origem = doCpf.find((c) => c.providerId === a.consultingProviderId && ms(c.createdAt) < ms(a.createdAt) && ms(a.createdAt) - ms(c.createdAt) <= 60_000);
      expect(origem, `alerta ${a.id}: ${a.consultingProviderId} nunca consultou ${a.customerCpfCnpj} antes dele`).toBeDefined();
      const naJanela = doCpf.filter((c) => ms(c.createdAt) <= ms(origem!.createdAt) && ms(origem!.createdAt) - ms(c.createdAt) <= 30 * DIA_MS);
      expect(a.recentConsultations, `alerta ${a.id}`).toBe(new Set(naJanela.map((c) => c.providerId)).size);
      const diasDeContrato = Number((json(a.riskFactors) as string[]).find((f) => f.startsWith("dias_contrato:"))!.split(":")[1]);
      expect(a.daysOverdue as number, `alerta ${a.id}: ${a.message}`).toBeLessThanOrEqual(diasDeContrato);
    }
    const motivos = new Set(alertas.flatMap((a) => motivosGravados(json(a.riskFactors))));
    for (const m of ["divida_ativa", "consultas_repetidas", "contrato_novo"] as const) expect(motivos.has(m), m).toBe(true);
    expect(alertas.some((a) => a.status === "resolved") && alertas.some((a) => a.status === "dismissed")).toBe(true);
  });

  it("a consulta semeada conta os provedores que consultaram o CPF nos 30 dias antes dela — sem o sandbox de outro visitante, como a consulta refeita ao vivo (revisao da fase B)", async () => {
    const outrosSandboxes = new Set((banco.linhas.get("providers") ?? [])
      .filter((p) => String(p.subdomain ?? "").startsWith("sandbox-") && p.id !== s.providerId).map((p) => p.id));
    const todas = banco.linhas.get("isp_consultations") ?? [];
    const alerta = "3+ consultas de ISPs diferentes nos ultimos 30 dias";
    let comRedeNaJanela = 0;
    for (const c of linhasDe("isp_consultations", s.providerId)) {
      const quando = ms(c.createdAt);
      const antes = todas.filter((x) => x.cpfCnpj === c.cpfCnpj && !outrosSandboxes.has(x.providerId) && ms(x.createdAt) < quando && quando - ms(x.createdAt) <= 30 * DIA_MS);
      const em30d = new Set(antes.map((x) => x.providerId)).size;
      if (antes.some((x) => x.providerId !== s.providerId)) comRedeNaJanela++;
      expect((json(c.result).alerts as string[]).includes(alerta), `${c.cpfCnpj}: ${em30d} provedores em 30 dias`).toBe(em30d >= 3 && em30d < 5);
    }
    expect(comRedeNaJanela, "nenhuma consulta semeada de CPF com consulta da rede na janela").toBeGreaterThan(0);
  });

  it("nenhuma fatura vence antes do contrato, todo ativo tem fatura no mes corrente e a divida e a soma das vencidas (revisao da fase B)", async () => {
    const clientes = await clientesDe(s.providerId);
    const faturas = linhasDe("invoices", s.providerId);
    const inicio = new Map(clientes.map((c) => [c.id, String(c.contractStartDate)]));
    for (const f of faturas) {
      const dia = new Date(ms(f.dueDate)).toISOString().slice(0, 10);
      expect(dia >= inicio.get(f.customerId)!, `fatura ${f.erpRef} vence em ${dia}, antes do contrato de ${inicio.get(f.customerId)}`).toBe(true);
    }
    // A carteira do mês abria 200 ativos "sem fatura" contra 222 devendo.
    const mes = AGORA.toISOString().slice(0, 7);
    const comFaturaNoMes = new Set(faturas.filter((f) => new Date(ms(f.dueDate)).toISOString().slice(0, 7) === mes).map((f) => f.customerId));
    expect(clientes.filter((c) => c.status === "active" && !comFaturaNoMes.has(c.id)).map((c) => c.id)).toEqual([]);
    // 16/09: as dívidas de 45 e 250 dias venceram nos dias 2 e 9 — a mensalidade deste mês também venceu.
    const vencidasPorCliente = new Map<unknown, typeof faturas>();
    for (const f of faturas.filter((x) => x.status === "overdue")) vencidasPorCliente.set(f.customerId, [...(vencidasPorCliente.get(f.customerId) ?? []), f]);
    expect(clientes.filter((c) => c.status === "active" && (vencidasPorCliente.get(c.id)?.length ?? 0) === 2).length).toBeGreaterThan(0);
    for (const c of clientes) {
      const vencidas = vencidasPorCliente.get(c.id) ?? [];
      expect(centavos(c.totalOverdueAmount), `cliente ${c.id}`).toBe(vencidas.reduce((soma, f) => soma + centavos(f.value), 0));
      expect(c.overdueInvoicesCount ?? 0, `cliente ${c.id}`).toBe(vencidas.length);
    }
  });

  it("o historico de consultas, os alertas extras e as regras do anti-fraude sao do proprio sandbox (P9)", async () => {
    const admin = adminDe(s.providerId);
    const cpfsDaCarteira = new Set((await clientesDe(s.providerId)).map((c) => c.cpfCnpj));
    const idsDaCarteira = new Set((await clientesDe(s.providerId)).map((c) => c.id));
    const base = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));

    const isp = linhasDe("isp_consultations", s.providerId);
    expect(isp.length).toBeGreaterThanOrEqual(9);
    expect(isp.length).toBeLessThanOrEqual(11);
    expect(new Set(isp.map((c) => c.decisionReco))).toEqual(new Set(["Accept", "Review", "Reject"]));
    const spc = linhasDe("spc_consultations", s.providerId);
    const cadastral = linhasDe("bigdata_consultations", s.providerId);
    expect(spc).toHaveLength(4);
    expect(cadastral).toHaveLength(3);
    for (const c of [...isp, ...spc, ...cadastral]) {
      expect(c.userId, JSON.stringify(c)).toBe(admin.id);
      expect(cpfsDaCarteira.has(c.cpfCnpj ?? c.cpf), `consulta sobre CPF fora da carteira: ${c.cpfCnpj ?? c.cpf}`).toBe(true);
    }

    const alertas = await alertasAntiFraudeDe(s.providerId);
    expect(alertas).toHaveLength(3 + 13);
    for (const a of alertas) {
      expect(base.has(a.consultingProviderId as number), `alerta ${a.id} consultado por quem nao e da rede`).toBe(true);
      expect(idsDaCarteira.has(a.customerId), `alerta ${a.id} de cliente fora da carteira`).toBe(true);
    }
    expect(linhasDe("anti_fraud_rules", s.providerId)).toHaveLength(regrasAntiFraudeDaDemo(s.providerId).length);
  });

  it("a ficha, os socios, os documentos, a equipe, o historico de sync e os pedidos de credito contam a mesma empresa do cadastro simulado (P11)", async () => {
    const provider = await providerDe(s.providerId);
    const receita = empresaPublicaSimulada("");
    // A sede no mapa e na ficha é o endereço que "buscar na Receita" devolveria.
    expect(provider).toMatchObject({
      name: "Provedor Demonstração", tradeName: receita.nomeFantasia, addressCity: receita.cidade, addressState: "PR",
      addressStreet: receita.logradouro, addressNumber: receita.numero, addressZip: receita.cep,
    });
    expect(linhasDe("provider_partners", s.providerId).map((p) => p.name)).toEqual(receita.socios.map((x) => x.nome));

    const documentos = linhasDe("provider_documents", s.providerId);
    expect(documentos.map((d) => d.status)).toEqual(["approved", "approved", "approved"]);
    for (const d of documentos) expect(d.uploadedById).toBe(s.providerId);

    const equipe = (banco.linhas.get("users") ?? []).filter((u) => u.providerId === s.providerId);
    expect(equipe).toHaveLength(4);
    // O segundo sinal da limpeza continua sendo o administrador da demo — e é o primeiro usuário.
    expect(adminDe(s.providerId).email).toBe(`${s.subdomain}@demo.consultaisp.com.br`);

    const logs = linhasDe("erp_sync_logs", s.providerId);
    expect(logs).toHaveLength(10);
    const integracao = (await integracaoDe(s.providerId))!;
    expect(ms(integracao.lastSyncAt)).toBe(Math.max(...logs.map((l) => ms(l.syncedAt))));
    expect(integracao).toMatchObject({ lastSyncStatus: "success", totalSynced: 1500 });

    const pedidos = linhasDe("credit_orders", s.providerId);
    expect(pedidos.map((p) => p.status).sort()).toEqual(["cancelled", "paid", "pending"]);
  });

  it("o mundo base e complementado antes do sandbox: consultas cruzadas da rede e os analistas que as assinam (P8)", () => {
    const base = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));
    const consultasDaRede = (banco.linhas.get("isp_consultations") ?? []).filter((c) => base.has(c.providerId as number));
    expect(consultasDaRede.length, "complementarMundoBase nao rodou").toBeGreaterThan(1_000);
    expect((banco.linhas.get("users") ?? []).filter((u) => base.has(u.providerId as number))).toHaveLength(5);
  });

  it("apagarSandbox leva toda linha nova da fiacao — nenhuma tabela com o provedor fica com sobra", async () => {
    await apagarSandbox(s.providerId);
    const residuos: string[] = [];
    for (const tabela of TABELAS) {
      const nome = getTableName(tabela);
      if (!("providerId" in getTableColumns(tabela))) continue;
      const sobra = linhasDe(nome, s.providerId).length;
      if (sobra > 0) residuos.push(`${nome} (${sobra})`);
    }
    const documentosPorAutor = (banco.linhas.get("provider_documents") ?? []).filter((d) => d.uploadedById === s.providerId);
    if (documentosPorAutor.length > 0) residuos.push(`provider_documents.uploadedById (${documentosPorAutor.length})`);
    expect(residuos).toEqual([]);
  });
});

/**
 * A limpeza do sandbox, cobrindo TODA tabela com FK para `providers` — não
 * as que alguém lembrou de listar. Achado real da rodada de correção
 * (11/09/2026): `apagarSandbox` cobria ~15 das 38 tabelas do schema com FK
 * para `providers`; qualquer linha numa das outras 23 fazia o
 * `DELETE FROM providers` final estourar violação de chave estrangeira —
 * dentro de uma transação, então a limpeza inteira revertia, e a Tarefa 7
 * (que captura por sandbox e segue para o próximo) nunca tentava de novo:
 * zumbi permanente.
 *
 * A lista de tabelas-alvo é DERIVADA DO SCHEMA (`getTableConfig`), nunca
 * digitada à mão: uma enumeração escrita a mão envelhece na primeira tabela
 * que outra feature criar amanhã; esta, não — ganha a FK, o teste passa a
 * semeá-la, e se `apagarSandbox` não souber limpá-la, ACENDE VERMELHO aqui.
 *
 * E o universo de MÓDULOS de schema também é derivado, da lista `schema` do
 * `drizzle.config.ts` — a mesma fronteira que `server/migracoes-cobrem-o-schema.test.ts`
 * usa (16/09/2026). Até aqui os módulos eram três, nomeados à mão, e foi
 * exatamente por isso que as sete tabelas das migrações 0039 e 0042
 * (`shared/schema-comunicacao.ts`, `shared/schema-gestao-cobranca.ts`) ficaram
 * INVISÍVEIS a este teste: FK para `providers`, `customers`, `invoices` e
 * `cobranca_casos` sem ON DELETE CASCADE, nenhuma na limpeza — a faxina
 * horária da demonstração travava por FK na primeira hora em que um
 * visitante gravasse uma preferência de contato, e a exclusão de provedor em
 * produção idem. Arquivo novo de schema entra no config e, com isso, entra
 * aqui (falta importá-lo → vermelho, ver `MODULOS_DO_SCHEMA`).
 *
 * Os PAIS também cresceram na mesma data: além de `providers`, conta FK para
 * `customers`, `invoices` e `cobranca_casos` — as três tabelas por cliente que
 * a limpeza apaga por `provider_id`. Uma tabela nova que aponte para o
 * cliente sem apontar para o provedor (ou que aponte para o caso e seja
 * apagada DEPOIS do caso) trava a limpeza do mesmo jeito, e só a FK para
 * `providers` não a revelaria.
 *
 * SEM EXCEÇÃO — zero exclusões (rodada de correção 2, 11/09/2026; recontado
 * em 12/09/2026, quando a derivação passou a ler também
 * `shared/schema-cobranca-faturas.ts` e `shared/chat-autonomia-seguranca.ts`
 * — módulos que `@shared/schema` não reexporta, e por isso ficavam
 * INVISÍVEIS a este teste: pré-avisos, quitações e a autorização da
 * autonomia do chat sobravam depois da limpeza sem acender nada; o número
 * exato de pares está na asserção do teste). A primeira versão deste teste excluía
 * `acessos_suporte` (a guarda de LGPD de `storage.deleteProvider` recusa
 * apagar um provedor real com trilha de acesso de suporte, e o raciocínio
 * era "então não é resíduo, é desenho"). Isso reabria o MESMO zumbi
 * permanente por outro caminho: o admin do sandbox tem acesso à aba
 * "Suporte" do próprio painel, `POST /api/provider/acesso-suporte/liberar`
 * grava a linha na hora, e "revogar" NUNCA apaga — só marca `revogadoEm`. A
 * guarda ficava presa em ">0" para sempre a partir de UM clique de
 * curiosidade. `apagarSandbox` agora limpa `acessos_suporte` para
 * provedores `sandbox-*` (a guarda em si continua intacta para provedor
 * real — ver o comentário em `sandbox.service.ts`), então este teste não
 * tem mais nenhuma tabela para excluir.
 */
describe("limpeza do sandbox cobre toda tabela com FK para providers, customers, invoices e cobranca_casos (derivado do drizzle.config.ts, sem excecao)", () => {
  /** Os pais cuja FK conta: o provedor e as três tabelas por cliente que a limpeza apaga por `provider_id`. */
  const PAIS = ["providers", "customers", "invoices", "cobranca_casos"] as const;
  type Pai = (typeof PAIS)[number];

  interface AlvoDeFk {
    tabela: PgTable;
    nomeTabela: string;
    chaveCamelCase: string;
    pai: Pai;
  }

  /**
   * Caminho, como está na lista `schema` do `drizzle.config.ts` -> módulo
   * importado no topo deste arquivo. A LISTA vem do config (lida do próprio
   * arquivo, abaixo); este mapa só liga cada caminho ao seu `import *`, porque
   * o teste precisa dos objetos de tabela em memória, e um `import()` com
   * caminho variável não passa pelo alias `@shared` nem pelo `tsc`. Arquivo
   * listado lá e ausente aqui é erro do TESTE, e acende vermelho — nunca uma
   * exceção silenciosa.
   *
   * `shared/chat-autonomia-seguranca.ts` NÃO está no config (as duas tabelas
   * dele nascem da migração 0034, e o `drizzle-kit push` nunca as criou), mas
   * tem FK para `providers` — entra à parte, como já entrava desde 12/09/2026.
   */
  const MODULOS_DO_SCHEMA: Record<string, object> = {
    "shared/schema.ts": schema,
    "shared/crm-schema.ts": schemaCrm,
    "shared/schema-comunicacao.ts": schemaComunicacao,
    "shared/schema-cobranca-faturas.ts": schemaCobrancaFaturas,
    "shared/schema-gestao-cobranca.ts": schemaGestaoCobranca,
  };
  const MODULOS_FORA_DO_CONFIG: Record<string, object> = {
    "shared/chat-autonomia-seguranca.ts": schemaChatAutonomiaSeguranca,
  };

  /** A lista `schema` do `drizzle.config.ts`, lida do próprio arquivo — o mesmo leitor de `server/migracoes-cobrem-o-schema.test.ts`. */
  function arquivosDoSchemaDoDrizzle(): string[] {
    const config = readFileSync(path.resolve(__dirname, "../../drizzle.config.ts"), "utf-8");
    const lista = config.match(/schema\s*:\s*\[([^\]]*)\]/);
    const unico = config.match(/schema\s*:\s*["']([^"']+)["']/);
    const brutos = lista
      ? Array.from(lista[1].matchAll(/["']([^"']+)["']/g), (m) => m[1])
      : unico
        ? [unico[1]]
        : [];
    return brutos.map((p) => p.replace(/^\.\//, ""));
  }

  /** Os módulos de schema a varrer: todos os do config, na ordem dele, mais os de fora dele. */
  function modulosDoSchema(): object[] {
    const arquivos = arquivosDoSchemaDoDrizzle();
    // Um leitor quebrado que não lê NADA faria o teste passar em silêncio.
    expect(arquivos, "o leitor do drizzle.config.ts nao achou a lista `schema`").toContain("shared/schema.ts");
    const semModulo = arquivos.filter((arquivo) => !(arquivo in MODULOS_DO_SCHEMA));
    expect(
      semModulo,
      `arquivo(s) na lista \`schema\` do drizzle.config.ts sem \`import *\` neste teste — importe-os e acrescente a MODULOS_DO_SCHEMA: ${semModulo.join(", ")}`,
    ).toEqual([]);
    return [...arquivos.map((arquivo) => MODULOS_DO_SCHEMA[arquivo]), ...Object.values(MODULOS_FORA_DO_CONFIG)];
  }

  /**
   * Toda tabela exportada pelos módulos de schema com uma FK (de qualquer
   * coluna) apontando para um dos `PAIS`. Um par (tabela, coluna, pai) por FK;
   * a mesma tabela aparece mais de uma vez quando tem mais de uma dessas FKs
   * (`cobranca_comunicacoes` aponta para os quatro).
   */
  function tabelasComFkParaOsPais(): AlvoDeFk[] {
    const alvos: AlvoDeFk[] = [];
    const vistos = new Set<string>();
    for (const modulo of modulosDoSchema()) {
      for (const valor of Object.values(modulo)) {
        if (!valor || typeof valor !== "object" || !is(valor as object, PgTable)) continue;
        const tabela = valor as PgTable;
        const cfg = getTableConfig(tabela);
        const colunasDaTabela = getTableColumns(tabela);
        for (const fk of cfg.foreignKeys ?? []) {
          const ref = fk.reference();
          const pai = getTableName(ref.foreignTable) as Pai;
          if (!PAIS.includes(pai)) continue;
          for (const colunaRef of ref.columns) {
            const entrada = Object.entries(colunasDaTabela).find(([, c]) => c === colunaRef);
            if (!entrada) throw new Error(`Nao encontrei a chave JS da coluna FK em ${cfg.name}`);
            // Um módulo que reexporte a tabela de outro não pode contá-la duas vezes.
            const assinatura = `${cfg.name}.${entrada[0]}->${pai}`;
            if (vistos.has(assinatura)) continue;
            vistos.add(assinatura);
            alvos.push({ tabela, nomeTabela: cfg.name, chaveCamelCase: entrada[0], pai });
          }
        }
      }
    }
    return alvos;
  }

  /**
   * Uma linha mínima e válida para QUALQUER tabela: a coluna-alvo recebe
   * `providerId`; toda outra coluna NOT NULL sem default recebe um valor
   * genérico pelo `dataType` do drizzle (conferido por sonda isolada:
   * "number"/"string"/"boolean"/"json"/"date" cobrem as colunas deste
   * schema). O banco de mentira não confere integridade referencial nem
   * unicidade, então um `1`/`"x"` cru em outra FK (customerId, userId...)
   * não quebra a inserção — só a coluna sob teste importa.
   */
  function linhaGenericaParaTeste(tabela: PgTable, chaveAlvo: string, providerId: number): Record<string, unknown> {
    const colunas = getTableColumns(tabela);
    const linha: Record<string, unknown> = {};
    for (const [chave, colunaUntyped] of Object.entries(colunas)) {
      const coluna = colunaUntyped as { notNull: boolean; hasDefault: boolean; dataType: string };
      if (chave === chaveAlvo) {
        linha[chave] = providerId;
        continue;
      }
      if (!coluna.notNull || coluna.hasDefault) continue; // deixa o default (ou null) cuidar
      switch (coluna.dataType) {
        case "number": linha[chave] = 1; break;
        case "boolean": linha[chave] = false; break;
        case "json": linha[chave] = {}; break;
        case "date": linha[chave] = new Date("2026-01-01T00:00:00.000Z"); break;
        default: linha[chave] = "x"; // string — inclui DATE-como-texto (ver customers.contractStartDate)
      }
    }
    return linha;
  }

  it("apagarSandbox limpa toda tabela com FK para os pais — lista derivada do drizzle.config.ts, nunca digitada a mao, sem excecao", async () => {
    const alvos = tabelasComFkParaOsPais();
    const inventario = alvos.map((a) => `${a.nomeTabela}.${a.chaveCamelCase} -> ${a.pai}`).sort().join("\n  ");
    // Contagem EXATA, não só "> 30": 51 tabelas / 79 pares. Até 16/09/2026
    // eram 42 tabelas / 45 pares, só FK para providers (3 tabelas —
    // anti_fraud_alerts, proactive_alerts, provider_documents — têm duas
    // colunas cada uma apontando para providers). Na mesma data entraram os
    // outros três pais (16 pares para customers, 4 para invoices, 5 para
    // cobranca_casos) e as 9 tabelas com FK para providers das migrações
    // 0039–0042 (`chat_multicanal_mensagens` fica de fora: só aponta para a
    // conversa). A mensagem de falha imprime o inventário inteiro para a
    // recontagem ser conferida par a par. Se o schema mudar de forma e esse
    // número desviar, é melhor um teste vermelho apontando o número exato do
    // que um "> 30" que deixa passar uma tabela a menos.
    expect(alvos.length, `universo de FKs para os pais mudou — recontar antes de ajustar este numero:\n  ${inventario}`).toBe(79);
    expect(new Set(alvos.map((a) => a.nomeTabela)).size).toBe(51);

    const s = await criarSandbox();

    // UM pai de cada tipo, do PRÓPRIO sandbox: é para ele que a linha semeada
    // aponta, e é por ele que a sobra é procurada depois. Para o provedor, o
    // id do sandbox; para os outros três, a primeira linha que a carteira
    // gerou.
    const primeiroId = async (linhas: Promise<Record<string, unknown>[]>, pai: Pai): Promise<number> => {
      const [primeira] = await linhas;
      if (!primeira) throw new Error(`o sandbox nasceu sem nenhuma linha em ${pai} — o teste nao tem para onde apontar`);
      return primeira.id as number;
    };
    const idDoPai: Record<Pai, number> = {
      providers: s.providerId,
      customers: await primeiroId(clientesDe(s.providerId), "customers"),
      invoices: await primeiroId(faturasDe(s.providerId), "invoices"),
      cobranca_casos: await primeiroId(casosDeCobrancaDe(s.providerId), "cobranca_casos"),
    };

    for (const alvo of alvos) {
      const linha = linhaGenericaParaTeste(alvo.tabela, alvo.chaveCamelCase, idDoPai[alvo.pai]);
      // A linha de um cliente, fatura ou caso do sandbox é do MESMO provedor —
      // é assim que ela existiria de verdade, e é por `provider_id` que a
      // limpeza a alcança. Para a FK ao próprio provedor a coluna-alvo já é
      // essa, e as demais ficam genéricas DE PROPÓSITO: uma FK para providers
      // por outra coluna (`consulting_provider_id`, `uploaded_by_id`) só está
      // provada se a limpeza a apagar por ELA, não por um `provider_id` que o
      // teste tivesse preenchido junto.
      if (alvo.pai !== "providers" && "providerId" in getTableColumns(alvo.tabela)) linha.providerId = s.providerId;
      await banco.db.insert(alvo.tabela).values(linha);
    }

    const linhasDoAlvo = (alvo: AlvoDeFk) => (banco.linhas.get(alvo.nomeTabela) ?? []).filter((l) => l[alvo.chaveCamelCase] === idDoPai[alvo.pai]);

    // A semeadura funcionou? (Distingue "meu teste nao semeou" de "apagarSandbox nao limpou".)
    const naoSemeadas = alvos.filter((alvo) => linhasDoAlvo(alvo).length === 0).map((alvo) => `${alvo.nomeTabela}.${alvo.chaveCamelCase}`);
    expect(naoSemeadas, `semeadura do teste falhou em: ${naoSemeadas.join(", ")}`).toEqual([]);

    await apagarSandbox(s.providerId);

    const residuos = alvos
      .filter((alvo) => linhasDoAlvo(alvo).length > 0)
      .map((alvo) => `${alvo.nomeTabela}.${alvo.chaveCamelCase} -> ${alvo.pai} (${linhasDoAlvo(alvo).length} linha[s])`);
    expect(residuos, `apagarSandbox nao limpou: ${residuos.join(", ")}`).toEqual([]);
  });
});

/**
 * Tarefa 7 (`server/demo/limpeza.service.ts`) delega TODA a seleção para
 * `sandboxesExpirados`/`apagarSandbox` — os mesmos dois já provados acima
 * ("expira so o sandbox, nunca o mundo base"). Esta prova roda a passada REAL
 * (nada de `./sandbox.service` mockado neste arquivo) contra o mundo base já
 * semeado: os 5 provedores da rede e a carteira deles têm que sobreviver a um
 * sweep que encontrou outro sandbox para apagar. Sem isto, o teste de
 * `sandboxesExpirados()` sozinho prova a seleção, mas não prova que o sweep
 * INTEIRO (que também chama `apagarSandbox`) deixa a rede intacta.
 *
 * O relógio dos 5 provedores da rede TAMBÉM é expirado aqui, de propósito —
 * não só o do sandbox alvo. Em produção o mundo base é semeado uma vez e fica
 * no ar para sempre: passadas 24h do primeiro seed, `rede-1..5` estão
 * genuinamente "velhos" pelo relógio, exatamente como o teste irmão acima
 * ("expira so o sandbox, nunca o mundo base") NÃO simula. Quem os protege do
 * sweep é só o prefixo do subdomain (`PREFIXO_SANDBOX`), nunca a idade — um
 * teste que deixasse a rede "nova" provaria a sobrevivência dela por
 * acidente de cronômetro, não pela trava de verdade.
 */
describe("a limpeza periodica (Tarefa 7) nunca alcanca o mundo base", () => {
  it("mundo base semeado E com o relogio expirado, sweep de verdade: os 5 provedores da rede e os clientes deles sobrevivem", async () => {
    const alvo = await criarSandbox();

    const idsDaBase = PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain));
    const clientesDaBaseAntes = new Map<number, number>();
    for (const id of idsDaBase) {
      const total = (await clientesDe(id)).length;
      expect(total, `mundo base ${id} deveria ja ter clientes semeados`).toBeGreaterThan(0);
      clientesDaBaseAntes.set(id, total);
    }

    // Expira o relogio de TODO MUNDO — o sandbox alvo e os 5 da rede — mais
    // velho que VIDA_DO_SANDBOX_MS. So o prefixo do subdomain pode salvar a
    // rede agora; a idade sozinha nao salva mais ninguem.
    await envelhecer(alvo.providerId, 25 * 60 * 60 * 1000);
    for (const id of idsDaBase) await envelhecer(id, 25 * 60 * 60 * 1000);

    // `>= 1`, nao `=== 1`, de proposito: este arquivo e sequencial e cumulativo
    // (ver o comentario no topo) — "velho" (teste "expira so o sandbox...") e
    // "expirado" (teste "contarSandboxesVivos NAO conta...") tambem ficaram
    // no banco, genuinamente envelhecidos 25h por `envelhecer()`, e nenhum dos
    // dois testes os apagou. Este sweep varre os dois JUNTO com o "alvo" desta
    // rodada — 3 candidatos legitimos, nao so 1 — e nada garante que nenhum
    // outro `it()` futuro passe a deixar mais sobras genuinas. O que importa
    // aqui e SO o alvo e a rede, verificados abaixo por id; o numero exato de
    // "apagados" e um detalhe de quantos outros testes tambem envelheceram um
    // sandbox sem limpar, nao desta prova.
    //
    // Ate a rodada de correcao de 12/09/2026 este numero vinha inflado por um
    // MOTIVO DIFERENTE: o banco de mentira nao simulava o `defaultNow()` de
    // `providers.createdAt`, entao TODO sandbox de um `it()` anterior que
    // nunca chamou `envelhecer`/`apagarSandbox` nascia com `createdAt` nulo,
    // tratado como epoch (sempre "expirado") e varrido aqui tambem — 17
    // sobras acidentais, medidas, empilhadas em cima dos 3 candidatos
    // legitimos (apagados=20 num sweep medido antes da correcao). O `>= 1` ja
    // tolerava esse ruido sem intencao; agora tolera so a acumulacao legitima
    // documentada acima. Ver `valorPadraoDaColuna` (topo do arquivo) e o
    // relatorio da rodada.
    const resultado = await limparSandboxesExpirados();
    expect(resultado.apagados, "o sandbox envelhecido deveria ter sido varrido").toBeGreaterThanOrEqual(1);

    // O sandbox alvo sumiu...
    expect(await clientesDe(alvo.providerId)).toHaveLength(0);

    // ...mas os 5 provedores da rede e a carteira de cada um continuam
    // intactos, mesmo tao "velhos pelo relogio" quanto o sandbox apagado.
    for (const id of idsDaBase) {
      expect(await providerDe(id)).toBeTruthy();
      expect(await clientesDe(id)).toHaveLength(clientesDaBaseAntes.get(id)!);
    }
  });
});

/**
 * Segundo sinal de identidade do sandbox (12/09/2026).
 *
 * Até aqui "é um sandbox descartável" era UMA string: `subdomain` começando
 * por `sandbox-`. A reserva do namespace no cadastro (rodada da Tarefa 6,
 * `auth.routes.ts` + `admin.routes.ts`) fecha as quatro portas por onde um
 * subdomínio entra hoje — mas ela é a ÚNICA coisa entre um provedor pagante e
 * a exclusão TOTAL e silenciosa da conta dele. Qualquer porta futura (um
 * script, uma migração, uma rota nova, um UPDATE na mão) que esqueça a
 * reserva reabre o buraco inteiro.
 *
 * E o estrago não tem volta nem aviso: desde que `apagarSandbox` limpa
 * `acessos_suporte` dentro do próprio delta, a guarda de LGPD de
 * `deleteProvider` — que ANTES salvava a conta por acidente, ao contar uma
 * trilha de suporte não-zero e lançar antes de apagar `users`/`customers`/o
 * próprio provedor — enxerga zero e deixa passar. Sem exceção, sem linha de
 * log que distinga "apaguei um sandbox" de "apaguei a NsLink".
 *
 * Então a identidade passa a exigir DUAS provas que só `criarSandbox` produz
 * juntas, na MESMA transação: o prefixo do subdomínio E o administrador
 * determinístico (`<subdomain>@demo.consultaisp.com.br`). Um provedor de
 * verdade teria que ter as duas ao mesmo tempo — e a segunda ninguém digita
 * por acidente.
 */
describe("apagar exige o segundo sinal, nao so o prefixo do subdominio", () => {
  it("provedor com subdominio 'sandbox-' mas SEM o administrador da demo sobrevive ao sweep e a chamada direta", async () => {
    const impostor = await criarSandbox();

    /**
     * Vira um provedor "de verdade": mesmo prefixo no subdomínio,
     * administrador com e-mail de gente. É exatamente o estado que a reserva
     * do cadastro impede HOJE — e que qualquer caminho futuro sem a reserva
     * volta a produzir.
     */
    const admin = (banco.linhas.get("users") ?? []).find((u) => u.providerId === impostor.providerId);
    expect(admin, "o sandbox deveria ter nascido com administrador proprio").toBeTruthy();
    admin!.email = "contato@provedorreal.com.br";

    const clientesAntes = (await clientesDe(impostor.providerId)).length;
    expect(clientesAntes, "o impostor precisa ter carteira para o teste provar algo").toBeGreaterThan(0);

    await envelhecer(impostor.providerId, 25 * 60 * 60 * 1000);

    // 1. A varredura nao o seleciona — velho pelo relogio e com o prefixo,
    //    mas sem o segundo sinal.
    expect(await sandboxesExpirados()).not.toContain(impostor.providerId);

    // 2. A chamada DIRETA recusa: um id errado vindo de qualquer chamador
    //    futuro nao pode virar exclusao de um provedor de verdade.
    vi.mocked(limparChatSimuladoDoProvedor).mockClear();
    await expect(apagarSandbox(impostor.providerId)).rejects.toThrow();

    // 3. E a passada real da limpeza deixa a conta inteira de pe.
    await limparSandboxesExpirados();
    expect(await providerDe(impostor.providerId)).toBeTruthy();
    expect(await clientesDe(impostor.providerId)).toHaveLength(clientesAntes);
    // A recusa tambem nao mexe no chat simulado de quem sobreviveu.
    expect(vi.mocked(limparChatSimuladoDoProvedor)).not.toHaveBeenCalledWith(impostor.providerId);
  });

  /**
   * Escolha da rodada de correção (12/09/2026): um administrador que sumiu
   * (por qualquer motivo) faz o provider FALHAR o segundo sinal e nunca mais
   * ser apagado por `sandboxesExpirados()`/`limparSandboxesExpirados()` —
   * undeletable para sempre. Silenciar essa exclusão seria transformar a
   * guarda de segurança nova (Part 2) num vazamento lento e invisível: nada
   * distinguiria "este provider nunca foi um sandbox" de "este sandbox
   * perdeu o administrador e ficou preso". Por isso `sandboxesExpirados()`
   * loga um `logger.warn` — com `providerId` E `subdomain`, os dois dados
   * que uma investigação manual precisa — toda vez que um candidato bate
   * prefixo+idade mas falha o segundo sinal.
   *
   * Este teste prova exatamente esse log: sem ele (ou se o campo `providerId`
   * sumir do contexto do log), esta asserção falha.
   */
  it("provider sem o segundo sinal e avisado em log com o id do provider — sem isto o vazamento fica invisivel", async () => {
    const impostor = await criarSandbox();
    const admin = (banco.linhas.get("users") ?? []).find((u) => u.providerId === impostor.providerId);
    admin!.email = "outra-pessoa@provedorreal.com.br";
    await envelhecer(impostor.providerId, 25 * 60 * 60 * 1000);

    const espiao = vi.spyOn(logger, "warn").mockImplementation((() => undefined) as any);
    try {
      await sandboxesExpirados();
      const chamada = espiao.mock.calls.find(([contexto]) => (contexto as any)?.providerId === impostor.providerId);
      expect(chamada, "deveria logar um warn identificando o provider sem segundo sinal, pelo id").toBeTruthy();
      expect((chamada![0] as any).subdomain, "o log deveria trazer o subdomain tambem, para investigacao manual").toBe(impostor.subdomain);
    } finally {
      espiao.mockRestore();
    }
  });
});

/**
 * O `/demo` não cai pelo complemento do mundo base (13/09/2026).
 *
 * `criarSandbox` chama `complementarMundoBase()` logo depois de
 * `semearMundoBase()`. Sem proteção, um complemento que lança derruba a criação
 * e TODO visitante novo recebe a página 500 "Não foi possível abrir sua
 * demonstração agora" até alguém corrigir a causa — e o sandbox não depende do
 * complemento para nascer. O erro vai ao log em nível error, com evento fixo e
 * só nome e mensagem: o erro do `pg` carrega `detail` com a linha que bateu.
 */
describe("o /demo nao cai pelo complemento do mundo base", () => {
  const EVENTO = "demo.complemento_do_mundo_falhou";

  /** Um erro do jeito que o `pg` entrega: `name` "error", e o `detail` com o dado da linha. */
  function erroDoPostgres(mensagem: string, campos: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(mensagem), { name: "error", ...campos });
  }

  it("complemento lancando: o sandbox nasce e o erro vai UMA vez ao log, com o evento fixo e so nome e mensagem", async () => {
    const emailNaLinha = "analista.rede-1@demo.consultaisp.com.br";
    const mensagem = 'duplicate key value violates unique constraint "users_email_unique"';
    vi.mocked(complementarMundoBase).mockRejectedValueOnce(
      erroDoPostgres(mensagem, { code: "23505", detail: `Key (email)=(${emailNaLinha}) already exists.`, table: "users" }),
    );
    const espiao = vi.spyOn(logger, "error").mockImplementation((() => undefined) as any);
    try {
      const s = await criarSandbox();
      expect(s.subdomain).toMatch(/^sandbox-[a-f0-9]{16}$/);
      expect(s.providerId).toEqual(expect.any(Number));
      expect(s.userId).toEqual(expect.any(Number));
      expect(await clientesDe(s.providerId)).toHaveLength(1500);

      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao.mock.calls[0][0]).toStrictEqual({ evento: EVENTO, erroNome: "error", erroMensagem: mensagem });
      expect(JSON.stringify(espiao.mock.calls[0]), "o detail do pg (com o dado da linha) nao pode ir ao log").not.toContain(emailNaLinha);
    } finally {
      espiao.mockRestore();
    }
  });

  /**
   * O caso que importa no deploy: o banco publicado está no formato antigo, e é
   * a primeira criação depois do deploy que paga a reescrita. Se ela falhar, o
   * sandbox nasce sobre a rede antiga (a semeadura só acha menos consultas da
   * rede) e a próxima criação tenta de novo.
   *
   * Zera só as LINHAS do banco de mentira, como o describe do formato antigo de
   * `mundo-base.test.ts` zera o dele: os ids continuam subindo, para nenhum
   * provedor novo herdar o id de um sandbox dos testes de cima. Por mexer no
   * banco inteiro, fica por último no arquivo.
   */
  it("mundo base no FORMATO ANTIGO e o complemento falhando: o sandbox nasce, e a rede continua como estava", async () => {
    banco.linhas.clear();
    const agora = new Date();
    await semearMundoBase(agora);
    regredirParaOFormatoAntigo(banco.linhas, agora);
    const CPF_DO_MIGRADOR = cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO);
    const migradorDaRede2 = () => (banco.linhas.get("customers") ?? []).find((c) => c.providerId === idDe("rede-2") && c.cpfCnpj === CPF_DO_MIGRADOR);
    expect(migradorDaRede2()?.totalOverdueAmount, "a fixture deveria deixar o migrador antigo na rede-2").toBe("80.00");

    const mensagem = "canceling statement due to lock timeout";
    vi.mocked(complementarMundoBase).mockClear();
    vi.mocked(complementarMundoBase).mockRejectedValueOnce(erroDoPostgres(mensagem, { code: "55P03" }));
    const espiao = vi.spyOn(logger, "error").mockImplementation((() => undefined) as any);
    try {
      const s = await criarSandbox();
      expect(s.subdomain).toMatch(/^sandbox-[a-f0-9]{16}$/);
      expect(s.providerId).toEqual(expect.any(Number));
      expect(s.userId).toEqual(expect.any(Number));
      expect(await clientesDe(s.providerId)).toHaveLength(1500);

      expect(vi.mocked(complementarMundoBase)).toHaveBeenCalledTimes(1);
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao.mock.calls[0][0]).toStrictEqual({ evento: EVENTO, erroNome: "error", erroMensagem: mensagem });
      // Nada do complemento foi gravado: a rede segue no formato antigo, para a próxima criação reescrever.
      expect(migradorDaRede2()?.totalOverdueAmount).toBe("80.00");
    } finally {
      espiao.mockRestore();
    }
  }, 60_000);
});
