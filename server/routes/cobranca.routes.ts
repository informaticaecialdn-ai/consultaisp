import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";
import { casoEstaEncerrado } from "../services/equipment-recovery-rules";
import { snapshotAoVivoDoCliente } from "../services/cobranca/snapshot-ao-vivo.service";
import { podeAdministrarOProvedor } from "./provider.routes";
import {
  CODIGOS_DE_ERRO_DE_COBRANCA,
  carteiraDoStatusErp,
  type CandidatoACaso,
  type CodigoDeErroDeCobranca,
  type FaixaDeDivida,
  type FiltrosDaCarteira,
  type LinhaDaCarteira,
  type PatchDeCaso,
  type StatusCasoFechado,
} from "../storage/cobranca.storage";
import type { CobrancaCaso, CobrancaEvento, CobrancaNegociacao, CobrancaParcela, Customer, Equipment } from "@shared/schema";
import {
  ABORDAGEM_POR_QUADRANTE,
  CANAIS_HUMANOS,
  CARTEIRAS,
  DIRETIVA_POR_TOM,
  ETAPA_IDS,
  FRASE_EXEMPLO_POR_QUADRANTE,
  GRADE_DNA,
  POLITICA_PADRAO,
  PRIORIDADES,
  QUADRANTES,
  RESULTADOS_DE_CONTATO,
  ROTULO_MOTIVO_SEM_ETAPA,
  ROTULO_STATUS_DE_CASO,
  STATUS_DE_CASO,
  STATUS_DE_NEGOCIACAO,
  TETOS_LEGAIS,
  TIPOS_DE_EVENTO,
  TIPOS_DE_NEGOCIACAO,
  arredondar,
  casoFechado,
  classificarDna,
  eixosDoQuadrante,
  etapaParaAtraso,
  etapasDaCarteira,
  etapasDaPolitica,
  eventoDaTransicaoDeCaso,
  familiaDoQuadrante,
  gerarParcelas,
  janelaDaEtapa,
  mesesDeContrato,
  prescrita,
  tomEfetivo,
  transicaoDeCaso,
  transicaoDeNegociacao,
  validarNegociacao,
  validarPolitica,
  valorAtualizado,
  type Carteira,
  type Dna,
  type Etapa,
  type EtapaId,
  type MotivoSemEtapa,
  type Politica,
  type Quadrante,
  type StatusDeCaso,
  type StatusDeNegociacao,
  type Tom,
  montarFicha360,
} from "@shared/cobranca";

/**
 * COBRANCA — as rotas do funcionario que cobra.
 *
 * O molde e o CRM de recuperacao de equipamento: um caso por cliente, uma
 * linha do tempo, e o que o sistema faz sozinho deixa evento com usuario
 * nulo. O que muda aqui e quem decide: no Provedor.ai eram agentes; aqui e o
 * operador do provedor, que trabalha a fila, registra o contato, propoe o
 * acordo e marca a parcela paga.
 *
 * Quatro decisoes valem para o arquivo inteiro:
 *
 * 1. A CARTEIRA LISTA CLIENTES, nao casos. O dono pediu "painel de gerencia
 *    por clientes", e a tela (client/src/components/cobranca/tipos.ts) le
 *    `caso: null` e o filtro "sem caso aberto". O storage so pagina casos, e
 *    quem esta devendo sem caso vivo sai de `clientesParaAbrirCaso`. A pagina
 *    e montada em dois segmentos — os casos primeiro, depois os sem caso — e
 *    o total soma os dois. E o unico jeito de a NG (7.300 ex-clientes com
 *    divida) aparecer inteira antes de o job de abertura passar.
 *
 * 2. A MAQUINA DE ESTADOS DECIDE, a rota so devolve 409 com o motivo dela
 *    (shared/cobranca/estados.ts). E `negociando`, `acordo_ativo` e a volta a
 *    `aberto` nao passam por aqui: nascem da negociacao (proposta, aceite,
 *    quebra), que e quem grava as parcelas e o evento junto. Um caso em
 *    "acordo ativo" sem acordo seria uma mentira na linha do tempo.
 *
 * 3. O DNA E CALCULADO AO VIVO das colunas de `customers` a cada leitura, com
 *    `historicoInsuficiente = true` (fase 1: o sync nao traz fatura paga). O
 *    que fica gravado no caso (`quadrante_dna`, `tom`) e a foto que o
 *    motor/job tirou; a tela mostra a de agora.
 *
 * 4. LGPD: o documento sai mascarado na carteira e na fila; completo so na
 *    ficha 360, que e onde o operador confere identidade. Nenhum log leva o
 *    documento — so ids.
 *
 * 5. A TELA OPERACIONAL E UM KANBAN (decisao do dono, 05/09/2026): uma coluna
 *    por status do caso, na ordem em que o operador trabalha, e UM so PATCH
 *    move — o de /casos/:id. Arrastar para "Negociando" nao passa por aqui
 *    (abre a proposta, decisao 2); arrastar para "Cancelamento" exige motivo
 *    e so o admin faz. A etapa da regua e SELO no card e FILTRO, nunca coluna:
 *    ela anda sozinha com os dias de atraso, e coluna que muda sem ninguem
 *    arrastar nao e coluna.
 *
 * 6. O QUE O SERVIDOR AGREGA, O SERVIDOR CALCULA INTEIRO. Os indicadores da
 *    fila somavam a pagina que a tela recebeu (100 casos) e se rotulavam
 *    "todos os casos vivos". Agora `total` e `kpis` saem do recorte inteiro;
 *    quando o recorte passa do teto de varredura, `kpis` vem null — nunca um
 *    numero parcial vestido de total.
 *
 * 7. `customers.isp_score` NAO E SCORE (ver `ispScoreReal`): e o DEFAULT 100
 *    da coluna, que nenhum sync nem motor grava. A carteira pintava a base
 *    inteira de "critica" por causa dele. Sai null ate existir calculo real.
 */

/* ── Sessao e permissao ──────────────────────────────────────────────── */

const providerDaSessao = (req: Request): number => req.session.providerId as number;
const usuarioDaSessao = (req: Request): number => req.session.userId as number;

/* ── Contrato novo do storage ────────────────────────────────────────── */

/**
 * Tres metodos que `CobrancaStorage` ja tem (05/09/2026) e a `IStorage` de
 * server/storage/index.ts ainda nao declara nem proxia: `cancelarCaso`
 * (status terminal `cancelamento`, com motivo, evento e a nota de sugerir a
 * recuperacao do equipamento), `obterNegociacao` e `obterParcela` por id —
 * que tiram o `casoId`/`negociacaoId` redundante do corpo dos PATCH/POST.
 * Este tipo e a ponte de COMPILACAO: a rota fala o contrato combinado, e o
 * cast vira redundante (nao errado) quando a IStorage o declarar, porque a
 * intersecao com o tipo real e o proprio tipo. Em EXECUCAO a chamada so
 * existe depois do proxy em index.ts — sem ele, as tres rotas caem em 500.
 */
interface StorageDaCobrancaFase2 {
  cancelarCaso(providerId: number, id: number, motivo: string, userId: number | null): Promise<CobrancaCaso | undefined>;
  obterNegociacao(providerId: number, id: number): Promise<CobrancaNegociacao | undefined>;
  obterParcela(providerId: number, id: number): Promise<CobrancaParcela | undefined>;
}
const storageFase2 = storage as typeof storage & StorageDaCobrancaFase2;

/**
 * O storage recusa REGRA DE NEGOCIO com `ErroDeCobranca` (campo `codigo`, a
 * convencao de ProvedorComTrilhaDeSuporteError): o estado atual nao permite
 * o que se pediu, e isso e 409, nao 500. Dois codigos ganham a frase da
 * rota, que diz o CAMINHO certo; os outros passam com a mensagem do storage,
 * que ja e para o operador — sao os que a rota pre-checa e que so aparecem
 * numa corrida entre duas telas.
 */
const MENSAGEM_DO_CONFLITO: Partial<Record<CodigoDeErroDeCobranca, string>> = {
  NEGOCIACAO_NAO_ACEITA:
    "A negociacao ainda e uma proposta: registre o aceite (PATCH /api/cobranca/negociacoes/:id status=aceita) antes de marcar parcela paga.",
  NEGOCIACAO_VIVA:
    "O caso ja tem uma negociacao viva: cancele-a ou registre a quebra (PATCH /api/cobranca/negociacoes/:id) antes de propor outra.",
};

function codigoDeCobranca(e: unknown): CodigoDeErroDeCobranca | null {
  const o = e as { codigo?: unknown; code?: unknown } | null;
  const codigo = typeof o?.codigo === "string" ? o.codigo : typeof o?.code === "string" ? o.code : null;
  return codigo !== null && (CODIGOS_DE_ERRO_DE_COBRANCA as readonly string[]).includes(codigo) ? (codigo as CodigoDeErroDeCobranca) : null;
}

/** true = ja respondeu 409; false = nao era conflito de cobranca, e o chamador relanca. */
function conflitoDeCobranca(res: Response, e: unknown): boolean {
  const codigo = codigoDeCobranca(e);
  if (!codigo) return false;
  const message = MENSAGEM_DO_CONFLITO[codigo] ?? (e instanceof Error && e.message ? e.message : "Conflito com o estado atual do caso");
  res.status(409).json({ message, code: codigo });
  return true;
}

/**
 * A mesma recusa do painel do provedor. `exigirAdminDoProvedor` de
 * provider.routes.ts nao e exportado, mas a REGRA (`podeAdministrarOProvedor`)
 * e — e e ela que sabe que o superadmin so administra dentro de uma janela de
 * suporte. Reescrever a condicao aqui a faria divergir no primeiro ajuste.
 */
function exigirAdminDoProvedor(acao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!podeAdministrarOProvedor(req.session)) {
      return res.status(403).json({ message: `Apenas administradores podem ${acao}` });
    }
    next();
  };
}

/**
 * Quem pode por um responsavel num caso: o admin poe qualquer um; o operador
 * so pega o caso para si (da fila geral) ou o devolve a fila quando e dele.
 * Sem esta excecao o operador nao conseguiria "pegar" um caso sem pedir ao
 * admin, e a fila geral existe justamente para isso.
 */
function podeAtribuir(req: Request, alvo: number | null, caso: LinhaDaCarteira | null): boolean {
  if (podeAdministrarOProvedor(req.session)) return true;
  const eu = usuarioDaSessao(req);
  if (alvo === eu) return true;
  // Abrir um caso direto na fila geral (`responsavelUserId: null` sem caso
  // ainda) nao tira o caso de ninguem: nao ha o que proteger.
  if (alvo === null && caso === null) return true;
  return alvo === null && caso !== null && caso.responsavelUserId === eu;
}

/**
 * Nao existe coluna de vulnerabilidade (Lei 14.181) em `customers` nem nas
 * cinco tabelas autorizadas. Ate existir, o tom vem so do DNA e a negociacao
 * nao ganha o piso protetivo. Constante nomeada para o dia em que a origem
 * for decidida ser uma troca em um lugar so.
 */
const VULNERAVEL_FASE_1 = false;

/* ── Utilidades ──────────────────────────────────────────────────────── */

const num = (v: unknown): number => Number(v ?? 0);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** O Express 5 tipa `req.params.x` como `string | string[]`; um id repetido na rota nao e um id. */
function idDaRota(valor: string | string[] | undefined): number | null {
  if (typeof valor !== "string") return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function recusar(res: Response, erro: z.ZodError) {
  return res.status(400).json({ message: "Dados invalidos", errors: erro.flatten().fieldErrors });
}

function falha(res: Response, e: unknown) {
  return res.status(500).json({ message: getSafeErrorMessage(e) });
}

/** A query sem os `?bairro=` vazios que a barra de filtros manda ao limpar uma pilula. */
function semVazios(query: Request["query"]): Record<string, unknown> {
  const limpa: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(query)) {
    if (valor !== "" && valor !== undefined) limpa[chave] = valor;
  }
  return limpa;
}

/**
 * CPF "123.456.***-01"; CNPJ "12.345.*** / 0001-**" (sem o espaco). Mostra o
 * bastante para o operador reconhecer o cliente na lista e esconde o miolo
 * que faz o numero valer como documento. Diferente de `maskCpfCnpj`
 * (lgpd-masking), que e para o OUTRO provedor ver e esconde quase tudo.
 */
export function mascararDocumento(doc: string | null | undefined): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.***/${d.slice(8, 12)}-**`;
  return d.length > 4 ? d.slice(0, 4) + "*".repeat(d.length - 4) : "****";
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "AAAA-MM-DD" das partes LOCAIS — a coluna DATE nao tem fuso, e `toISOString` viraria o dia na VPS em UTC. */
function dataLocal(d: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function dataCivilValida(iso: string): boolean {
  const m = DATA_ISO.exec(iso);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return dt.getUTCFullYear() === ano && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === dia;
}

/** Cinco minutos de folga para relogio de navegador adiantado; alem disso e registro do futuro. */
const FOLGA_DE_RELOGIO_MS = 5 * 60 * 1000;

/**
 * Proximo contato e AGENDA: marcar para ontem poe o caso como "vencido" no
 * mesmo segundo, e a fila ordena os vencidos primeiro — um agendamento no
 * passado furava a fila sem ninguem decidir isso. A mesma folga de relogio
 * do registro de evento, no sentido oposto. `null` (desmarcar) e valido.
 */
function erroDeProximoContato(d: Date | null | undefined, agora: Date): string[] | null {
  if (d === null || d === undefined) return null;
  return d.getTime() < agora.getTime() - FOLGA_DE_RELOGIO_MS ? ["Proximo contato numa data que ja passou"] : null;
}

/** So digitos com 55 na frente, para `wa.me`. A mesma regra de `whatsappDe` no client. */
function whatsappDe(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.startsWith("55") && digitos.length >= 12 ? digitos : `55${digitos}`;
}

/**
 * `equipamentos.routes.ts` acha o cliente do mesmo jeito: nao ha
 * `getCustomer(providerId, id)` no storage. A lista inteira do provedor
 * (~8k linhas na maior) e o preco de nao escrever SQL fora do storage.
 */
async function clienteDoProvedor(providerId: number, customerId: number): Promise<Customer | undefined> {
  return (await storage.getCustomersByProvider(providerId)).find(c => c.id === customerId);
}

interface MembroDaEquipe {
  id: number;
  nome: string;
  role: string;
  email: string;
}

/** Sem o hash de senha: e o unico campo de `users` que nenhuma tela pode receber. */
async function equipeDoProvedor(providerId: number): Promise<MembroDaEquipe[]> {
  const usuarios = await storage.getUsersByProvider(providerId);
  return usuarios
    .map(u => ({ id: u.id, nome: u.name, role: u.role, email: u.email }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ── Politica ────────────────────────────────────────────────────────── */

interface PoliticaCarregada {
  politica: Politica;
  etapas: Etapa[];
  configurada: boolean;
  updatedAt: Date | null;
}

/**
 * A politica que VALE: a gravada, revalidada, ou o padrao. Revalidar o que
 * esta no banco parece redundante — o PUT ja validou —, mas e o que protege
 * o motor de um JSON de outra versao: uma etapa com id que nao existe mais
 * derruba para o padrao com aviso no log, em vez de derrubar a rota.
 */
export async function carregarPolitica(providerId: number): Promise<PoliticaCarregada> {
  const linha = await storage.getPoliticaDeCobranca(providerId);
  if (!linha) {
    return { politica: POLITICA_PADRAO, etapas: etapasDaPolitica(POLITICA_PADRAO), configurada: false, updatedAt: null };
  }
  const r = validarPolitica({
    etapas: linha.etapas,
    negociacao: linha.negociacao,
    encargos: linha.encargos,
    janelaContato: linha.janelaContato,
    pausada: linha.pausada,
    pausadaMotivo: linha.pausadaMotivo,
  });
  if (!r.ok) {
    logger.warn({ providerId, erros: r.erros }, "COBRANCA politica gravada invalida; aplicando o padrao");
    return { politica: POLITICA_PADRAO, etapas: etapasDaPolitica(POLITICA_PADRAO), configurada: true, updatedAt: linha.updatedAt };
  }
  return { politica: r.politica, etapas: etapasDaPolitica(r.politica), configurada: true, updatedAt: linha.updatedAt };
}

/** "encargos.multaPct: máximo 100" → { "encargos.multaPct": ["máximo 100"] } — o formato de `flatten().fieldErrors`. */
function fieldErrorsDe(erros: string[]): Record<string, string[]> {
  const mapa: Record<string, string[]> = {};
  for (const erro of erros) {
    const corte = erro.indexOf(": ");
    const campo = corte > 0 ? erro.slice(0, corte) : "politica";
    const mensagem = corte > 0 ? erro.slice(corte + 2) : erro;
    (mapa[campo] ??= []).push(mensagem);
  }
  return mapa;
}

/* ── DNA e regua ─────────────────────────────────────────────────────── */

interface Classificacao {
  mesesComoCliente: number | null;
  dna: Dna | null;
  tom: Tom | null;
}

/**
 * O DNA do cliente como ele esta HOJE. Sem data de contrato nao ha DNA
 * (`mesesDeContrato` devolve null) — e a tela mostra "—", nunca "novo".
 * `historicoInsuficiente` e sempre true na fase 1: o sync grava agregados, e
 * a taxa de atraso historica que separa "oscila" de "em dia" nao existe.
 */
export function classificarCliente(
  c: { contractStartDate: string | null; diasAtraso: number; faturasAbertas: number },
  hoje: Date,
): Classificacao {
  const meses = mesesDeContrato(c.contractStartDate, hoje);
  if (meses === null) return { mesesComoCliente: null, dna: null, tom: tomEfetivo(null, VULNERAVEL_FASE_1) };
  const dna = classificarDna({
    mesesComoCliente: meses,
    diasAtrasoMax: c.diasAtraso,
    faturasAbertas: c.faturasAbertas,
    historicoInsuficiente: true,
  });
  return { mesesComoCliente: meses, dna, tom: tomEfetivo(dna, VULNERAVEL_FASE_1) };
}

/** A carteira gravada e texto; fora do vocabulario cai em ex-cliente, a regua mais curta. */
export function carteiraValida(valor: string): Carteira {
  return (CARTEIRAS as readonly string[]).includes(valor) ? (valor as Carteira) : "ex_cliente";
}

interface ReguaHoje {
  etapa: Etapa | null;
  motivo: MotivoSemEtapa | null;
  motivoRotulo: string | null;
}

export function reguaParaHoje(diasAtraso: number, carteira: Carteira, etapas: Etapa[]): ReguaHoje {
  const decisao = etapaParaAtraso(diasAtraso, carteira, etapas);
  return decisao.etapa
    ? { etapa: decisao.etapa, motivo: null, motivoRotulo: null }
    : { etapa: null, motivo: decisao.motivo, motivoRotulo: ROTULO_MOTIVO_SEM_ETAPA[decisao.motivo] };
}

/** As faixas do `isp_score` (0–1000) — os mesmos cortes de `--score-*` do DESIGN_SYSTEM e da barra de filtros. */
const FAIXAS_DE_SAUDE = ["boa", "media", "baixa", "critica"] as const;
type FaixaDeSaude = (typeof FAIXAS_DE_SAUDE)[number];

function faixaDaSaude(score: number | null): FaixaDeSaude | null {
  if (score === null) return null;
  if (score >= 701) return "boa";
  if (score >= 501) return "media";
  if (score >= 301) return "baixa";
  return "critica";
}

/** O que a coluna nasce com: `isp_score` DEFAULT 100 e `risk_tier` DEFAULT 'low' (shared/schema.ts). */
const ISP_SCORE_DEFAULT = 100;
const RISK_TIER_DEFAULT = "low";

/**
 * `customers.isp_score` como SCORE, ou null quando e so o default da coluna.
 *
 * Ninguem calcula o score do cliente da base: o motor de score roda na
 * CONSULTA e grava em `isp_consultations`; o sync do ERP nunca toca a coluna;
 * o unico escritor e o seed. Toda linha de producao carrega o par
 * (100, 'low') — e a carteira lia 100 na escala 0–1000 das faixas de saude e
 * pintava a base inteira de "critica".
 *
 * O criterio: o par (100, 'low') e a ASSINATURA do default, porque e
 * contraditorio como resultado — na escala 0–1000 que a tela, o DESIGN_SYSTEM
 * e `faixaDaSaude` usam, 100 e critico, nao 'low'. Um motor que venha a
 * escrever aqui grava score e faixa juntos e coerentes, e o par nunca sai
 * dele. Qualquer outro valor e tratado como calculo gravado. Sem calculo:
 * null nos dois, sem faixa, e a tela mostra "—" — nunca um score inventado.
 */
export function ispScoreReal(c: Pick<Customer, "ispScore" | "riskTier"> | undefined): { ispScore: number | null; riskTier: string | null } {
  if (!c) return { ispScore: null, riskTier: null };
  const score = numOuNull(c.ispScore);
  if (score === null) return { ispScore: null, riskTier: c.riskTier ?? null };
  if (score === ISP_SCORE_DEFAULT && (c.riskTier ?? RISK_TIER_DEFAULT) === RISK_TIER_DEFAULT) return { ispScore: null, riskTier: null };
  return { ispScore: score, riskTier: c.riskTier ?? null };
}

/* ── Formas de resposta ──────────────────────────────────────────────── */

function casoDetalhe(l: LinhaDaCarteira) {
  const { cliente: _cliente, ...caso } = l;
  return caso;
}

function casoResumo(l: LinhaDaCarteira) {
  return {
    id: l.id,
    status: l.status,
    etapa: l.etapaAtual,
    responsavel: l.responsavelUserId === null ? null : { id: l.responsavelUserId, nome: l.responsavelNome ?? "" },
    proximoContatoEm: l.proximoContatoEm,
    prioridade: l.prioridade,
  };
}

/** A linha da fila e do caso: o cliente inteiro, menos o documento em claro. */
function clienteMascarado(c: LinhaDaCarteira["cliente"]) {
  const { cpfCnpj, ...resto } = c;
  const documentoMascarado = mascararDocumento(cpfCnpj);
  return { ...resto, cpfCnpj: documentoMascarado, documentoMascarado };
}

function casoParaApi(l: LinhaDaCarteira) {
  return { ...casoDetalhe(l), cliente: clienteMascarado(l.cliente) };
}

interface ItemDaCarteira {
  customerId: number;
  nome: string;
  documentoMascarado: string;
  telefone: string | null;
  cidade: string | null;
  bairro: string | null;
  /** Sempre null: `customers` nao guarda o plano. */
  plano: null;
  statusErp: string;
  carteira: Carteira;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number;
  mesesComoCliente: number | null;
  quadrante: Quadrante | null;
  tom: Tom | null;
  fidelidade: string | null;
  confiabilidade: string | null;
  regua: { etapa: EtapaId | null; rotulo: string | null; motivo: MotivoSemEtapa | null };
  caso: ReturnType<typeof casoResumo> | null;
  ispScore: number | null;
  riskTier: string | null;
}

function montarItem(
  base: {
    customerId: number; nome: string; cpfCnpj: string; telefone: string | null; cidade: string | null;
    bairro: string | null; statusErp: string; carteira: Carteira; dividaAtual: number; diasAtraso: number;
    faturasAbertas: number; contractStartDate: string | null;
  },
  caso: LinhaDaCarteira | null,
  cliente: Customer | undefined,
  etapas: Etapa[],
  hoje: Date,
): ItemDaCarteira {
  const cls = classificarCliente(base, hoje);
  const regua = reguaParaHoje(base.diasAtraso, base.carteira, etapas);
  return {
    customerId: base.customerId,
    nome: base.nome,
    documentoMascarado: mascararDocumento(base.cpfCnpj),
    telefone: base.telefone,
    cidade: base.cidade,
    bairro: base.bairro,
    plano: null,
    statusErp: base.statusErp,
    carteira: base.carteira,
    dividaAtual: base.dividaAtual,
    diasAtraso: base.diasAtraso,
    faturasAbertas: base.faturasAbertas,
    mesesComoCliente: cls.mesesComoCliente,
    quadrante: cls.dna?.quadrante ?? null,
    tom: cls.tom,
    fidelidade: cls.dna?.fidelidade ?? null,
    confiabilidade: cls.dna?.confiabilidade ?? null,
    regua: { etapa: regua.etapa?.id ?? null, rotulo: regua.etapa?.rotulo ?? null, motivo: regua.motivo },
    caso: caso ? casoResumo(caso) : null,
    ...ispScoreReal(cliente),
  };
}

function itemDoCaso(l: LinhaDaCarteira, cliente: Customer | undefined, etapas: Etapa[], hoje: Date): ItemDaCarteira {
  const c = l.cliente;
  return montarItem({
    customerId: c.id, nome: c.nome, cpfCnpj: c.cpfCnpj, telefone: c.telefone, cidade: c.cidade, bairro: c.bairro,
    statusErp: c.statusErp, carteira: carteiraValida(l.carteira), dividaAtual: c.dividaAtual, diasAtraso: c.diasAtraso,
    faturasAbertas: c.faturasAbertas, contractStartDate: c.contractStartDate,
  }, l, cliente, etapas, hoje);
}

function itemDoCandidato(c: CandidatoACaso, cliente: Customer | undefined, etapas: Etapa[], hoje: Date): ItemDaCarteira {
  return montarItem({
    customerId: c.customerId, nome: c.nome, cpfCnpj: c.cpfCnpj, telefone: cliente?.phone ?? null,
    cidade: cliente?.city ?? null, bairro: cliente?.neighborhood ?? null, statusErp: c.statusErp, carteira: c.carteira,
    dividaAtual: c.dividaAtual, diasAtraso: c.diasAtraso, faturasAbertas: c.faturasAbertas, contractStartDate: c.contractStartDate,
  }, null, cliente, etapas, hoje);
}

function parcelaParaApi(p: CobrancaParcela) {
  return {
    id: p.id,
    negociacaoId: p.negociacaoId,
    numero: p.numero,
    valor: num(p.valor),
    vencimento: p.vencimento,
    pagoEm: p.pagoEm,
    valorPago: numOuNull(p.valorPago),
    status: p.status,
  };
}

function negociacaoParaApi(n: CobrancaNegociacao, parcelamento: CobrancaParcela[]) {
  return {
    id: n.id,
    casoId: n.casoId,
    customerId: n.customerId,
    tipo: n.tipo,
    valorOriginal: num(n.valorOriginal),
    valorNegociado: num(n.valorNegociado),
    descontoPct: num(n.descontoPct),
    entrada: num(n.entrada),
    parcelas: n.parcelas,
    valorParcela: numOuNull(n.valorParcela),
    primeiroVencimento: n.primeiroVencimento,
    status: n.status,
    criadoPorUserId: n.criadoPorUserId,
    aceitaEm: n.aceitaEm,
    quebradaEm: n.quebradaEm,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    parcelamento: parcelamento.map(parcelaParaApi),
  };
}

function eventoParaApi(e: CobrancaEvento, nomes: Map<number, string>) {
  return { ...e, usuarioNome: e.userId === null ? null : nomes.get(e.userId) ?? null };
}

/**
 * O que o health tecnico do Provedor.ai conta: aparelhos ativos e extraviados.
 * "Extraviado" aqui e o que o provedor ja deu por perdido (ou que esta em
 * recuperacao sem devolucao); devolvido e baixado nao contam para nenhum lado.
 */
export function contarEquipamentosParaHealth(lista: Array<{ status: string | null; inRecoveryProcess?: boolean | null }>): { ativos: number; extraviados: number } {
  let ativos = 0;
  let extraviados = 0;
  for (const e of lista) {
    const st = (e.status ?? "").toLowerCase();
    if (st === "extraviado" || st === "perdido" || st === "nao_devolvido" || st === "em_cobranca") extraviados += 1;
    else if (st === "devolvido" || st === "baixado" || st === "recuperado") continue;
    else ativos += 1;
  }
  return { ativos, extraviados };
}

function equipamentoParaApi(e: Equipment) {
  return {
    id: e.id,
    tipo: e.type,
    marca: e.brand,
    modelo: e.model,
    serie: e.serialNumber,
    mac: e.mac,
    patrimonio: e.assetTag,
    status: e.status,
    valor: numOuNull(e.value),
    emRecuperacao: e.inRecoveryProcess === true,
  };
}

/* ── Carteira em dois segmentos ──────────────────────────────────────── */

const FAIXAS_DE_DIVIDA = ["ate-100", "100-300", "300-1000", "1000-mais"] as const;
const LIMITES_DA_FAIXA: Record<FaixaDeDivida, { min: number; max: number | null }> = {
  "ate-100": { min: 0, max: 100 },
  "100-300": { min: 100, max: 300 },
  "300-1000": { min: 300, max: 1000 },
  "1000-mais": { min: 1000, max: null },
};

/** A mesma regra de `condicaoDaFaixa` do storage: piso inclusivo, teto exclusivo, e "ate 100" exige divida positiva. */
function naFaixa(divida: number, faixa: FaixaDeDivida): boolean {
  const { min, max } = LIMITES_DA_FAIXA[faixa];
  if (min === 0 ? divida <= 0 : divida < min) return false;
  return max === null || divida < max;
}

/** Sem acento e sem caixa, para "joao" achar "João": o NFD separa o diacritico, e `\p{M}` o remove. */
const semAcentos = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A busca de `condicaoDaBusca` do storage, em memoria: documento por prefixo de digitos, nome por trecho. */
function bateBusca(candidato: { nome: string; cpfCnpj: string }, busca: string): boolean {
  const texto = busca.trim();
  const digitos = texto.replace(/\D/g, "");
  const pareceDocumento = digitos.length >= 3 && digitos.length === texto.replace(/[.\-/\s]/g, "").length;
  if (pareceDocumento) return candidato.cpfCnpj.replace(/\D/g, "").startsWith(digitos);
  return semAcentos(candidato.nome).includes(semAcentos(texto));
}

/** Ate onde a carteira sem caso vai: acima da maior carteira medida (7.300 na NG), com folga. */
const LIMITE_DE_CANDIDATOS = 20_000;
/** Varredura de casos para o filtro de saude: 40 paginas de 200 cobrem a maior carteira; alem disso a rota recusa. */
const PAGINAS_MAXIMAS_DA_VARREDURA = 40;
const PAGINA_DA_VARREDURA = 200;

interface RecorteDeStatus {
  /** `null` = so os vivos (o padrao do storage); `"nenhum"` = o segmento de casos fica de fora. */
  casos: StatusDeCaso[] | "todos" | "nenhum" | null;
  semCaso: boolean;
}

/**
 * `status` da barra: ausente = vivos + sem caso; `todos` = todos os casos +
 * sem caso; `sem_caso` = so quem deve e nao tem caso vivo; um ou mais status
 * de caso (virgula) = so esses casos. Valor fora do vocabulario e erro, nao
 * "todos": um filtro que silenciosamente mostrasse tudo mentiria no total.
 */
function lerRecorteDeStatus(valor: string | undefined): RecorteDeStatus | { erro: string } {
  if (!valor) return { casos: null, semCaso: true };
  if (valor === "todos") return { casos: "todos", semCaso: true };
  const partes = valor.split(",").map(p => p.trim()).filter(Boolean);
  const semCaso = partes.includes("sem_caso");
  const statuses = partes.filter(p => p !== "sem_caso");
  const invalido = statuses.find(s => !(STATUS_DE_CASO as readonly string[]).includes(s));
  if (invalido) return { erro: `status desconhecido: ${invalido}` };
  if (statuses.length === 0) return { casos: "nenhum", semCaso };
  return { casos: statuses as StatusDeCaso[], semCaso };
}

const CarteiraQuerySchema = z.object({
  carteira: z.enum(CARTEIRAS).optional(),
  status: z.string().trim().max(160).optional(),
  etapa: z.enum(ETAPA_IDS).optional(),
  quadrante: z.string().trim().regex(/^[ABCabc][123]?$/, "use A, B, C ou A1..C3").optional(),
  saude: z.enum(FAIXAS_DE_SAUDE).optional(),
  divida: z.enum(FAIXAS_DE_DIVIDA).optional(),
  bairro: z.string().trim().min(1).max(80).optional(),
  busca: z.string().trim().min(1).max(120).optional(),
  responsavel: z.union([z.literal("eu"), z.literal("geral"), z.coerce.number().int().positive()]).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});
type CarteiraQuery = z.infer<typeof CarteiraQuerySchema>;

interface Varredura {
  linhas: LinhaDaCarteira[];
  /** O total do recorte segundo o storage — exato mesmo quando a varredura parou no teto. */
  total: number;
  /** false = parou no teto: `linhas` e um pedaco, e nada agregado sobre ele pode se chamar total. */
  completa: boolean;
}

/**
 * Todas as paginas de um recorte de casos, para o que o storage nao agrega
 * sozinho: o filtro de saude (sobre `customers.isp_score`), os indicadores da
 * fila e os fechados recentes do kanban. Para no teto e diz que parou:
 * filtrar em memoria dez mil linhas por requisicao nao e servico, e uma
 * falha lenta. O `total` continua exato porque vem do count do storage.
 */
async function varrerCasos(providerId: number, filtros: FiltrosDaCarteira): Promise<Varredura> {
  const todas: LinhaDaCarteira[] = [];
  let total = 0;
  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS_DA_VARREDURA; pagina++) {
    const r = await storage.listarCasosDeCobranca(providerId, filtros, { pagina, porPagina: PAGINA_DA_VARREDURA });
    total = r.total;
    todas.push(...r.linhas);
    if (r.linhas.length < PAGINA_DA_VARREDURA || todas.length >= total) return { linhas: todas, total, completa: true };
  }
  return { linhas: todas, total, completa: false };
}

function filtrosDoStorage(q: CarteiraQuery, recorte: RecorteDeStatus, userId: number): FiltrosDaCarteira {
  const f: FiltrosDaCarteira = {};
  if (recorte.casos === "todos") f.status = "todos";
  else if (Array.isArray(recorte.casos)) f.status = recorte.casos;
  if (q.carteira) f.carteira = q.carteira;
  if (q.etapa) f.etapa = q.etapa;
  if (q.quadrante) f.quadrante = q.quadrante.toUpperCase();
  if (q.divida) f.faixaDivida = q.divida;
  if (q.bairro) f.bairro = q.bairro;
  if (q.busca) f.busca = q.busca;
  if (q.responsavel === "eu") f.responsavelUserId = userId;
  else if (q.responsavel === "geral") f.responsavelUserId = null;
  else if (typeof q.responsavel === "number") f.responsavelUserId = q.responsavel;
  return f;
}

/**
 * O segmento "sem caso", filtrado em memoria com as MESMAS regras que o
 * storage aplica aos casos. Bairro e saude vem de `customers` (o candidato
 * nao os traz); quadrante e etapa sao os calculados ao vivo — o candidato
 * nao tem caso, logo nao tem quadrante gravado.
 */
function filtrarCandidatos(
  candidatos: CandidatoACaso[],
  clientes: Map<number, Customer>,
  q: CarteiraQuery,
  etapas: Etapa[],
  hoje: Date,
): CandidatoACaso[] {
  // Responsavel e atributo de caso: quem nao tem caso nao esta na fila de ninguem.
  if (q.responsavel !== undefined && q.responsavel !== "geral") return [];
  const quadrante = q.quadrante?.toUpperCase();
  return candidatos.filter(c => {
    if (q.carteira && c.carteira !== q.carteira) return false;
    if (q.divida && !naFaixa(c.dividaAtual, q.divida)) return false;
    if (q.busca && !bateBusca(c, q.busca)) return false;
    const cliente = clientes.get(c.customerId);
    if (q.bairro && (cliente?.neighborhood ?? null) !== q.bairro) return false;
    if (q.saude && faixaDaSaude(ispScoreReal(cliente).ispScore) !== q.saude) return false;
    if (quadrante || q.etapa) {
      const cls = classificarCliente(c, hoje);
      if (quadrante) {
        const dele = cls.dna?.quadrante ?? null;
        if (quadrante.length === 1 ? dele?.[0] !== quadrante : dele !== quadrante) return false;
      }
      if (q.etapa && reguaParaHoje(c.diasAtraso, c.carteira, etapas).etapa?.id !== q.etapa) return false;
    }
    return true;
  });
}

/* ── Corpos das escritas ─────────────────────────────────────────────── */

const AbrirCasoSchema = z.object({
  customerId: z.number().int().positive(),
  prioridade: z.enum(PRIORIDADES).optional(),
  responsavelUserId: z.number().int().positive().nullable().optional(),
  proximoContatoEm: z.coerce.date().nullable().optional(),
}).strict();

const PatchCasoSchema = z.object({
  status: z.enum(STATUS_DE_CASO).optional(),
  motivo: z.string().trim().max(300).optional(),
  prioridade: z.enum(PRIORIDADES).optional(),
  responsavelUserId: z.number().int().positive().nullable().optional(),
  proximoContatoEm: z.coerce.date().nullable().optional(),
}).strict();

/**
 * Status que a rota NAO aceita no PATCH, com o caminho certo. Sao os que
 * implicam uma negociacao: o storage grava negociacao, parcelas, status do
 * caso e evento numa transacao so, e um PATCH que mudasse so o status
 * deixaria a linha do tempo sem o acordo que ela afirma existir.
 */
const STATUS_PELA_NEGOCIACAO: Partial<Record<StatusDeCaso, string>> = {
  negociando: "O caso vai a \"Negociando\" quando uma proposta e registrada (POST /api/cobranca/casos/:id/negociacoes).",
  acordo_ativo: "O caso vai a \"Acordo ativo\" quando a negociacao e aceita (PATCH /api/cobranca/negociacoes/:id).",
  aberto: "O caso volta a \"Aberto\" quando a negociacao e cancelada ou quebrada (PATCH /api/cobranca/negociacoes/:id).",
};

/**
 * `aberto` so e "pela negociacao" quando se SAI de uma: de "Em contato" o
 * operador volta o caso a "A contatar" arrastando (numero errado, ligar de
 * novo), e nao ha acordo nenhum para cancelar nesse caminho.
 */
function caminhoPelaNegociacao(de: StatusDeCaso, para: StatusDeCaso): string | null {
  if (para === "negociando" || para === "acordo_ativo") return STATUS_PELA_NEGOCIACAO[para] ?? null;
  if (para === "aberto" && (de === "negociando" || de === "acordo_ativo")) return STATUS_PELA_NEGOCIACAO.aberto ?? null;
  return null;
}

/**
 * Desfechos que so o admin decreta, com o verbo da recusa. Baixar e
 * encerrar sao desistir da divida; cancelamento e o contrato acabando —
 * nenhum deles e trabalho de fila. `pago` fica com o operador: e ele quem
 * recebe o "paguei" e confere no ERP. `negativado` tambem: continua vivo.
 */
const VERBO_SO_ADMIN_FECHA: Partial<Record<StatusDeCaso, string>> = {
  baixado: "baixar um caso de cobranca",
  encerrado: "encerrar um caso de cobranca",
  cancelamento: "registrar o cancelamento de um caso",
};

/** O que o funcionario DECLARA. Os outros tipos sao gravados pelo sistema, e a rota diz por onde. */
const TIPOS_DECLARADOS = ["contato", "promessa", "nota", "suspensao"] as const;
const PORQUE_NAO_DECLARA: Partial<Record<(typeof TIPOS_DE_EVENTO)[number], string>> = {
  negativacao: "A negativacao e registrada ao mudar o status do caso (PATCH status=negativado).",
  encerramento: "O encerramento e registrado ao fechar o caso (PATCH status=pago|baixado|encerrado|cancelamento).",
  negociacao_proposta: "Nasce da negociacao (POST /negociacoes).",
  acordo_aceito: "Nasce do aceite da negociacao (PATCH /negociacoes/:id).",
  acordo_quebrado: "Nasce da quebra da negociacao (PATCH /negociacoes/:id).",
  parcela_paga: "Nasce do pagamento da parcela (POST /parcelas/:id/pagar).",
  etapa_mudou: "O sistema grava ao mudar a etapa.",
  responsavel_mudou: "O sistema grava ao mudar o responsavel.",
};

const EventoSchema = z.object({
  tipo: z.enum(TIPOS_DE_EVENTO),
  canal: z.enum(CANAIS_HUMANOS).optional(),
  resultado: z.enum(RESULTADOS_DE_CONTATO).optional(),
  notas: z.string().trim().max(2000).optional(),
  ocorridoEm: z.coerce.date().optional(),
  /** Promessa de pagamento: o dia prometido, "AAAA-MM-DD". */
  promessaPara: z.string().trim().optional(),
  valorPrometido: z.number().positive().optional(),
  /** Agendar o proximo toque na mesma chamada — "nao atendeu, tentar amanha". */
  proximoContatoEm: z.coerce.date().nullable().optional(),
}).strict();

const NegociacaoSchema = z.object({
  tipo: z.enum(TIPOS_DE_NEGOCIACAO),
  /** O que a tela viu como divida; confere com o servidor para nao negociar sobre valor velho. */
  valorOriginal: z.number().positive().optional(),
  valorNegociado: z.number().positive(),
  entrada: z.number().min(0).optional(),
  parcelas: z.number().int().min(1).optional(),
  primeiroVencimento: z.string().trim().optional(),
  aceita: z.boolean().optional(),
}).strict();

const PatchNegociacaoSchema = z.object({
  /** Opcional desde `obterNegociacao(providerId, id)`; quando vem, tem de bater com a negociacao — senao e outra tela. */
  casoId: z.number().int().positive().optional(),
  status: z.enum(STATUS_DE_NEGOCIACAO),
}).strict();

const PagarSchema = z.object({
  /** Opcional desde `obterParcela(providerId, id)`; quando vem, tem de bater com a parcela. */
  negociacaoId: z.number().int().positive().optional(),
  /** Pode ser menos que a parcela: o storage acumula, e a parcela so vira `paga` quando fecha o valor. */
  valorPago: z.number().positive(),
  pagoEm: z.coerce.date().optional(),
}).strict();

const CHAVES_DA_POLITICA = ["etapas", "negociacao", "encargos", "janelaContato", "pausada", "pausadaMotivo"] as const;

/**
 * `limite` e quantos casos a tela LISTA; os indicadores nao dependem dele
 * (decisao 6). O storage ainda serve no maximo 200 por chamada — a tela le
 * `itens.length` contra `total`, e o que faltou e dito, nao escondido.
 */
const LIMITE_MAXIMO_DA_FILA = 500;
const FilaQuerySchema = z.object({
  responsavel: z.enum(["eu", "todos"]).default("eu"),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_DA_FILA).default(100),
});

/* ── Fila: indicadores sobre o recorte inteiro ───────────────────────── */

interface KpisDaFila {
  /** Casos vivos no escopo. */
  casos: number;
  /** Soma do `valor_atual` dos casos vivos no escopo. */
  valor: number;
  /** Proximo contato vencido, de hoje ou nunca marcado — a mesma regra de `proximoContato` da tela. */
  paraHoje: number;
  /** Prioridade critica. */
  criticos: number;
}

/**
 * O escopo "eu" e dois recortes que o storage sabe filtrar em separado (os
 * meus; os sem responsavel) e nao juntos — a fila e "OR" e `FiltrosDaCarteira`
 * so tem "="; "todos" e o recorte sem filtro. Cada um e varrido inteiro.
 * Acima do teto de varredura os indicadores vem null com o motivo; o `total`
 * sai do count e fica exato de qualquer jeito.
 */
async function agregarFila(
  providerId: number,
  escopoUserId: number | undefined,
  hoje: Date,
): Promise<{ total: number; kpis: KpisDaFila | null; kpisMotivo: string | null }> {
  const recortes: FiltrosDaCarteira[] = escopoUserId === undefined
    ? [{}]
    : [{ responsavelUserId: escopoUserId }, { responsavelUserId: null }];
  const varreduras = await Promise.all(recortes.map(f => varrerCasos(providerId, f)));
  const total = varreduras.reduce((s, v) => s + v.total, 0);
  if (varreduras.some(v => !v.completa)) {
    return {
      total,
      kpis: null,
      kpisMotivo: `Fila com mais de ${PAGINAS_MAXIMAS_DA_VARREDURA * PAGINA_DA_VARREDURA} casos: os indicadores nao sao calculados neste recorte.`,
    };
  }
  const inicioDeAmanha = new Date(hoje);
  inicioDeAmanha.setHours(24, 0, 0, 0);
  const kpis: KpisDaFila = { casos: 0, valor: 0, paraHoje: 0, criticos: 0 };
  for (const v of varreduras) {
    for (const l of v.linhas) {
      kpis.casos += 1;
      kpis.valor += l.valorAtual;
      if (l.proximoContatoEm === null || l.proximoContatoEm.getTime() < inicioDeAmanha.getTime()) kpis.paraHoje += 1;
      if (l.prioridade === "critica") kpis.criticos += 1;
    }
  }
  kpis.valor = arredondar(kpis.valor);
  return { total, kpis, kpisMotivo: null };
}

/** A linha da fila e do kanban: o caso, o cliente mascarado, e o tom e a etapa de AGORA. */
function itemDaFila(l: LinhaDaCarteira, etapas: Etapa[], hoje: Date) {
  const cls = classificarCliente(l.cliente, hoje);
  const regua = reguaParaHoje(l.cliente.diasAtraso, carteiraValida(l.carteira), etapas);
  return {
    ...casoParaApi(l),
    // O tom de AGORA, para o operador ler antes de ligar; `tom` e
    // `quadranteDna` acima sao a foto gravada no caso.
    quadrante: cls.dna?.quadrante ?? null,
    tomSugerido: cls.tom,
    diretiva: cls.tom ? DIRETIVA_POR_TOM[cls.tom] : null,
    regua: { etapa: regua.etapa?.id ?? null, rotulo: regua.etapa?.rotulo ?? null, acao: regua.etapa?.acao ?? null, motivo: regua.motivo },
  };
}

/* ── Kanban ──────────────────────────────────────────────────────────── */

/**
 * As colunas na ordem em que o operador trabalha (decisao 5): TODO status
 * que a maquina de estados conhece tem coluna — um status sem coluna e um
 * caso invisivel no quadro (o teste da rota confere a paridade com
 * `STATUS_DE_CASO`). "Encerrados" (negativado, baixado, encerrado) fica no
 * fim, recolhido pela tela — negativado NAO e fechado, mas e desfecho que o
 * operador so olha quando precisa.
 */
const ORDEM_DO_KANBAN: readonly StatusDeCaso[] = [
  "aberto", "em_contato", "negociando", "acordo_ativo", "pago", "cancelamento", "negativado", "baixado", "encerrado",
];
function colunasDoKanban(): StatusDeCaso[] {
  return [...ORDEM_DO_KANBAN];
}

/** Fechado ha mais de 30 dias nao e trabalho do dia: sai do quadro e fica na carteira (status=todos). */
const JANELA_DE_FECHADOS_DIAS = 30;
/** Cards por coluna. Acima disso a coluna diz `truncado` com o `total` exato — a tela filtra, nao rola 7.000 cards. */
const PADRAO_POR_COLUNA = 100;
const MAXIMO_POR_COLUNA = 200;

const KanbanQuerySchema = z.object({
  etapa: z.enum(ETAPA_IDS).optional(),
  carteira: z.enum(CARTEIRAS).optional(),
  busca: z.string().trim().min(1).max(120).optional(),
  responsavel: z.union([z.literal("eu"), z.literal("geral"), z.coerce.number().int().positive()]).optional(),
  porColuna: z.coerce.number().int().min(1).max(MAXIMO_POR_COLUNA).default(PADRAO_POR_COLUNA),
});
type KanbanQuery = z.infer<typeof KanbanQuerySchema>;

function filtrosDoKanban(q: KanbanQuery, userId: number): FiltrosDaCarteira {
  const f: FiltrosDaCarteira = {};
  if (q.carteira) f.carteira = q.carteira;
  if (q.etapa) f.etapa = q.etapa;
  if (q.busca) f.busca = q.busca;
  if (q.responsavel === "eu") f.responsavelUserId = userId;
  else if (q.responsavel === "geral") f.responsavelUserId = null;
  else if (typeof q.responsavel === "number") f.responsavelUserId = q.responsavel;
  return f;
}

interface ColunaDoKanban {
  status: StatusDeCaso;
  rotulo: string;
  fechada: boolean;
  casos: ReturnType<typeof itemDaFila>[];
  /** Vivos: o count do storage. Fechados: quantos cabem na janela de 30 dias entre os varridos. */
  total: number;
  /** Vivos: ha mais que `porColuna`. Fechados: a varredura parou no teto e a janela pode estar incompleta. */
  truncado: boolean;
}

/**
 * Uma coluna viva e uma pagina do storage com o count exato. Uma fechada e
 * uma varredura filtrada em memoria pela data de encerramento: o storage
 * ordena por valor e nao filtra por `encerrado_em`, entao os 30 dias so se
 * acham lendo — ate a carteira ganhar o filtro `encerradoDesde`, e o que ha.
 */
async function montarColuna(
  providerId: number,
  status: StatusDeCaso,
  filtros: FiltrosDaCarteira,
  porColuna: number,
  fechadosDesde: Date,
  etapas: Etapa[],
  hoje: Date,
): Promise<ColunaDoKanban> {
  const comStatus: FiltrosDaCarteira = { ...filtros, status: [status] };
  const base = { status, rotulo: ROTULO_STATUS_DE_CASO[status], fechada: casoFechado(status) };
  if (!base.fechada) {
    const { linhas, total } = await storage.listarCasosDeCobranca(providerId, comStatus, { pagina: 1, porPagina: porColuna });
    return { ...base, casos: linhas.map(l => itemDaFila(l, etapas, hoje)), total, truncado: total > linhas.length };
  }
  const varredura = await varrerCasos(providerId, comStatus);
  const recentes = varredura.linhas
    .filter(l => l.encerradoEm !== null && l.encerradoEm.getTime() >= fechadosDesde.getTime())
    .sort((a, b) => (b.encerradoEm as Date).getTime() - (a.encerradoEm as Date).getTime());
  return {
    ...base,
    casos: recentes.slice(0, porColuna).map(l => itemDaFila(l, etapas, hoje)),
    total: recentes.length,
    truncado: !varredura.completa || recentes.length > porColuna,
  };
}

/** O storage avisa "ja tem caso" antes de inserir; a corrida entre dois pedidos cai no indice unico (23505). */
function jaTemCaso(e: unknown): boolean {
  const codigo = (e as { code?: unknown })?.code;
  const mensagem = e instanceof Error ? e.message : "";
  return codigo === "23505" || /ja tem caso de cobranca aberto/.test(mensagem);
}

/* ── Router ──────────────────────────────────────────────────────────── */

export function registerCobrancaRoutes(): Router {
  const router = Router();

  // ── Carteira ──────────────────────────────────────────────────────────

  router.get("/api/cobranca/carteira", requireAuth, requireProvider, async (req, res) => {
    const parsed = CarteiraQuerySchema.safeParse(semVazios(req.query));
    if (!parsed.success) return recusar(res, parsed.error);
    const q = parsed.data;
    const recorte = lerRecorteDeStatus(q.status);
    if ("erro" in recorte) return res.status(400).json({ message: "Dados invalidos", errors: { status: [recorte.erro] } });

    const providerId = providerDaSessao(req);
    const hoje = new Date();
    try {
      const [kpis, composicao, bairros, { politica, etapas }, listaDeClientes] = await Promise.all([
        storage.kpisDaCobranca(providerId, hoje),
        storage.composicaoDaCarteira(providerId),
        storage.bairrosDaCarteira(providerId),
        carregarPolitica(providerId),
        storage.getCustomersByProvider(providerId),
      ]);
      const clientes = new Map(listaDeClientes.map(c => [c.id, c]));
      const offset = (q.pagina - 1) * q.porPagina;

      // Segmento 1: os casos, na paginacao do storage — ou varridos, quando
      // o filtro de saude (que so `customers` conhece) entra.
      let totalCasos = 0;
      let casosDaPagina: LinhaDaCarteira[] = [];
      if (recorte.casos !== "nenhum") {
        const filtros = filtrosDoStorage(q, recorte, usuarioDaSessao(req));
        if (q.saude) {
          const varredura = await varrerCasos(providerId, filtros);
          if (!varredura.completa) {
            return res.status(400).json({
              message: "Recorte grande demais para filtrar por saude: combine com carteira, etapa ou bairro.",
              errors: { saude: ["recorte grande demais"] },
            });
          }
          const filtradas = varredura.linhas.filter(l => faixaDaSaude(ispScoreReal(clientes.get(l.cliente.id)).ispScore) === q.saude);
          totalCasos = filtradas.length;
          casosDaPagina = filtradas.slice(offset, offset + q.porPagina);
        } else {
          const { linhas, total } = await storage.listarCasosDeCobranca(providerId, filtros, { pagina: q.pagina, porPagina: q.porPagina });
          totalCasos = total;
          casosDaPagina = linhas;
        }
      }

      // Segmento 2: quem deve e nao tem caso vivo, depois de todos os casos.
      let candidatos: CandidatoACaso[] = [];
      if (recorte.semCaso) {
        const brutos = await storage.clientesParaAbrirCaso(providerId, 0, LIMITE_DE_CANDIDATOS);
        candidatos = filtrarCandidatos(brutos, clientes, q, etapas, hoje);
      }
      const inicioDosCandidatos = Math.max(0, offset - totalCasos);
      const faltam = Math.max(0, q.porPagina - casosDaPagina.length);
      const candidatosDaPagina = faltam > 0 ? candidatos.slice(inicioDosCandidatos, inicioDosCandidatos + faltam) : [];

      const itens = [
        ...casosDaPagina.map(l => itemDoCaso(l, clientes.get(l.cliente.id), etapas, hoje)),
        ...candidatosDaPagina.map(c => itemDoCandidato(c, clientes.get(c.customerId), etapas, hoje)),
      ];

      res.json({
        kpis,
        composicao,
        bairros,
        itens,
        total: totalCasos + candidatos.length,
        totais: { casos: totalCasos, semCaso: candidatos.length },
        pagina: q.pagina,
        porPagina: q.porPagina,
        pausada: politica.pausada,
      });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Cliente 360 ───────────────────────────────────────────────────────

  router.get("/api/cobranca/clientes/:customerId/360", requireAuth, requireProvider, async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const providerId = providerDaSessao(req);
    const hoje = new Date();
    try {
      const cliente = await clienteDoProvedor(providerId, customerId);
      if (!cliente) return res.status(404).json({ message: "Cliente nao encontrado" });

      // A busca por documento e por prefixo de digitos; com o documento
      // inteiro so o proprio cliente (ou um CNPJ que o contenha) volta, e o
      // filtro por id abaixo tira o resto.
      const digitos = cliente.cpfCnpj.replace(/\D/g, "");
      const [{ politica, etapas }, casos, eventos, equipamentos, recuperacoes, equipe, consultasRecentes, alertasDoCliente] = await Promise.all([
        carregarPolitica(providerId),
        storage.listarCasosDeCobranca(providerId, { status: "todos", busca: digitos.length >= 3 ? digitos : cliente.name }, { pagina: 1, porPagina: 200 }),
        storage.listarEventosDoCliente(providerId, customerId),
        storage.getEquipmentByCustomer(customerId, providerId),
        storage.getRecoveryCases(providerId),
        equipeDoProvedor(providerId),
        // O sinal do bureau: quem mais perguntou por este documento. So
        // contagens e datas — o id e o nome de outro tenant nunca saem daqui.
        // Falha aqui nao derruba a ficha: ela abre com o que o banco tem.
        storage.getRecentConsultationsForDocument(digitos, 90).catch(() => []),
        storage.getAlertsByCustomer(customerId).catch(() => []),
      ]);
      const ha30d = new Date(hoje.getTime() - 30 * 86_400_000);
      const deOutros = consultasRecentes.filter(c => c.providerId !== providerId);
      const rede = {
        consultasOutros90d: deOutros.length,
        consultasOutros30d: deOutros.filter(c => c.createdAt && new Date(c.createdAt) >= ha30d).length,
        provedoresDistintos90d: new Set(deOutros.map(c => c.providerId)).size,
        ultimaConsultaEm: deOutros.reduce<string | null>((max, c) => {
          const d = c.createdAt ? new Date(c.createdAt).toISOString() : null;
          return d && (!max || d > max) ? d : max;
        }, null),
      };
      const alertas = alertasDoCliente
        .filter(al => al.providerId === providerId)
        .map(al => ({
          id: al.id,
          tipo: al.type,
          severidade: al.severity,
          status: al.status,
          resolvido: !!al.resolved,
          criadoEm: al.createdAt ? new Date(al.createdAt).toISOString() : null,
          diasAtraso: numOuNull(al.daysOverdue),
          valorEmAberto: numOuNull(al.overdueAmount),
          equipamentoNaoDevolvido: !!al.equipmentNotReturned,
          // `message` e `consultingProviderName` ficam de fora: carregam o nome
          // de outro provedor, que aqui so aparece como codigo pareado.
        }));
      const doCliente = casos.linhas.filter(l => l.cliente.id === customerId);
      const vivo = doCliente.find(l => !casoFechado(l.status)) ?? null;
      const conversaDoChat = vivo ? await storage.getConversaDoChatPorCaso(providerId, vivo.id).catch(() => undefined) : undefined;
      const anteriores = doCliente.filter(l => l !== vivo);
      const negociacoes = (await Promise.all(doCliente.map(l => storage.listarNegociacoesDoCaso(providerId, l.id)))).flat();
      const nomes = new Map(equipe.map(u => [u.id, u.nome]));

      const diasAtraso = num(cliente.maxDaysOverdue);
      const dividaAtual = num(cliente.totalOverdueAmount);
      const faturasAbertas = num(cliente.overdueInvoicesCount);
      const carteira = vivo ? carteiraValida(vivo.carteira) : carteiraDoStatusErp(cliente.status);
      const cls = classificarCliente({ contractStartDate: cliente.contractStartDate, diasAtraso, faturasAbertas }, hoje);
      const regua = reguaParaHoje(diasAtraso, carteira, etapas);

      // A ficha do Provedor.ai, montada com o que o banco tem. O navegador a
      // remonta com o mesmo `montarFicha360` quando o ERP ao vivo traz o
      // plano e a data de contrato que o sync nao guarda.
      const ha90d = new Date(hoje.getTime() - 90 * 86_400_000);
      const contatos = eventos.filter(ev => ev.tipo === "contato");
      const contatos90d = contatos.filter(ev => ev.ocorridoEm && new Date(ev.ocorridoEm) >= ha90d);
      const RESPONDEU = new Set(["falou", "promessa_pagamento", "recusou"]);
      const fichaEntrada = {
        statusErp: cliente.status,
        carteira,
        contractStartDate: cliente.contractStartDate,
        cortadoEm: cliente.cortadoEm,
        plano: null,
        ispScore: numOuNull(cliente.ispScore),
        riskTier: cliente.riskTier,
        dividaAtual,
        diasAtraso,
        faturasAbertas: cliente.overdueInvoicesCount === null || cliente.overdueInvoicesCount === undefined ? null : faturasAbertas,
        equipamentos: contarEquipamentosParaHealth(equipamentos),
        contatos90d: contatos90d.length,
        respostas90d: contatos90d.filter(ev => ev.resultado && RESPONDEU.has(ev.resultado)).length,
        comunicacoes30d: contatos.filter(ev => ev.ocorridoEm && new Date(ev.ocorridoEm) >= ha30d).length,
        totalComunicacoes: contatos.length,
      };
      const ficha = montarFicha360({ hoje, ...fichaEntrada, economia: politica.economia, historicoPagamento: null });
      const endereco = [cliente.address, cliente.addressNumber].filter(Boolean).join(", ")
        + (cliente.complement ? ` - ${cliente.complement}` : "");

      res.json({
        cliente: {
          id: cliente.id,
          nome: cliente.name,
          // Completo so aqui: a ficha e onde o operador confere a identidade.
          documento: cliente.cpfCnpj,
          documentoMascarado: mascararDocumento(cliente.cpfCnpj),
          telefone: cliente.phone,
          whatsapp: whatsappDe(cliente.phone),
          email: cliente.email,
          endereco: endereco || null,
          bairro: cliente.neighborhood,
          cidade: cliente.city,
          uf: cliente.state,
          cep: cliente.cep,
          plano: null,
          statusErp: cliente.status,
          situacaoPagamento: cliente.paymentStatus,
          carteira,
          dividaAtual,
          diasAtraso,
          faturasAbertas,
          contractStartDate: cliente.contractStartDate,
          mesesComoCliente: cls.mesesComoCliente,
          ispScore: numOuNull(cliente.ispScore),
          riskTier: cliente.riskTier,
          motivoCorte: cliente.motivoCorte,
          cortadoEm: cliente.cortadoEm,
          erpSource: cliente.erpSource,
          lastSyncAt: cliente.lastSyncAt,
        },
        divida: {
          valor: dividaAtual,
          diasAtraso,
          faturasAbertas,
          atualizado: valorAtualizado(dividaAtual, diasAtraso, politica.encargos),
          prescrita: prescrita(diasAtraso),
        },
        dna: cls.dna
          ? {
              quadrante: cls.dna.quadrante,
              fidelidade: cls.dna.fidelidade,
              confiabilidade: cls.dna.confiabilidade,
              abordagem: cls.dna.abordagem,
              tom: cls.tom,
              diretiva: cls.tom ? DIRETIVA_POR_TOM[cls.tom] : null,
              fraseExemplo: FRASE_EXEMPLO_POR_QUADRANTE[cls.dna.quadrante],
              mesesComoCliente: cls.mesesComoCliente,
              historicoInsuficiente: cls.dna.historicoInsuficiente,
            }
          : null,
        regua: { etapa: regua.etapa, motivo: regua.motivo, motivoRotulo: regua.motivoRotulo, pausada: politica.pausada },
        caso: vivo ? casoDetalhe(vivo) : null,
        casosAnteriores: anteriores.map(casoDetalhe),
        negociacoes: negociacoes.map(n => negociacaoParaApi(n, n.parcelamento)),
        eventos: eventos.map(e => eventoParaApi(e, nomes)),
        equipamentos: equipamentos.map(equipamentoParaApi),
        ficha,
        fichaEntrada,
        chat: conversaDoChat ? { conversationId: conversaDoChat.conversationId, status: conversaDoChat.status } : null,
        rede,
        alertas,
        recuperacao: recuperacoes
          .filter(r => r.customerId === customerId && !casoEstaEncerrado(r.status))
          .map(r => ({
            id: r.id,
            status: r.status,
            prioridade: r.priority,
            rescisaoEm: r.terminationDate,
            prazoEm: r.deadlineAt,
            equipamento: { tipo: r.equipmentType, marca: r.equipmentBrand, modelo: r.equipmentModel, serie: r.equipmentSerialNumber },
          })),
        // O que a ficha do Provedor.ai tem e esta base nao: nomeado, nao
        // fabricado. A tela mostra "—" pela ausencia da chave, e isto diz por que.
        pendentes: [
          { campo: "plano", motivo: "customers nao guarda o plano do cliente" },
          { campo: "faturas", motivo: "o sync grava agregados; fatura a fatura e a fase 2" },
          { campo: "historicoPagamento", motivo: "sem fatura paga nao ha historico de pontualidade" },
          { campo: "vulneravel", motivo: "nao ha coluna de vulnerabilidade (Lei 14.181)" },
        ],
      });
    } catch (e) {
      falha(res, e);
    }
  });

  /**
   * O snapshot AO VIVO do cliente no ERP do proprio provedor — separado da
   * ficha para a tela abrir com o que o banco tem e o bloco do ERP chegar
   * depois. `?forcar=1` fura o cache de dez minutos.
   */
  router.get("/api/cobranca/clientes/:customerId/360/ao-vivo", requireAuth, requireProvider, async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const providerId = providerDaSessao(req);
    try {
      const cliente = await clienteDoProvedor(providerId, customerId);
      if (!cliente) return res.status(404).json({ message: "Cliente nao encontrado" });
      const forcar = req.query.forcar === "1" || req.query.forcar === "true";
      const snapshot = await snapshotAoVivoDoCliente(providerId, cliente.cpfCnpj, { forcar });
      res.json(snapshot);
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Casos ─────────────────────────────────────────────────────────────

  router.post("/api/cobranca/casos", requireAuth, requireProvider, async (req, res) => {
    const parsed = AbrirCasoSchema.safeParse(req.body);
    if (!parsed.success) return recusar(res, parsed.error);
    const { customerId, prioridade, responsavelUserId, proximoContatoEm } = parsed.data;
    const hoje = new Date();
    const contatoNoPassado = erroDeProximoContato(proximoContatoEm, hoje);
    if (contatoNoPassado) return res.status(400).json({ message: "Dados invalidos", errors: { proximoContatoEm: contatoNoPassado } });

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      const cliente = await clienteDoProvedor(providerId, customerId);
      if (!cliente) return res.status(404).json({ message: "Cliente nao encontrado" });

      const diasAtraso = num(cliente.maxDaysOverdue);
      const dividaAtual = num(cliente.totalOverdueAmount);
      // Sem atraso a regua da fase 1 nao tem onde por o caso: ela anda sobre
      // dias de atraso, e o preventivo depende de fatura.
      if (dividaAtual <= 0 || diasAtraso < 1) {
        return res.status(422).json({ message: "Cliente sem divida vencida: nao ha o que cobrar." });
      }
      if (prescrita(diasAtraso)) {
        return res.status(422).json({ message: `${ROTULO_MOTIVO_SEM_ETAPA.prescrita} (CC art. 206 §5º).` });
      }
      const vivo = await storage.casoAbertoDoCliente(providerId, customerId);
      if (vivo) return res.status(409).json({ message: `Cliente ja tem caso de cobranca aberto (#${vivo.id}).`, casoId: vivo.id });

      if (responsavelUserId !== undefined) {
        if (!podeAtribuir(req, responsavelUserId, null)) {
          return res.status(403).json({ message: "Apenas administradores podem atribuir responsavel" });
        }
        if (responsavelUserId !== null && !(await equipeDoProvedor(providerId)).some(u => u.id === responsavelUserId)) {
          return res.status(400).json({ message: "Dados invalidos", errors: { responsavelUserId: ["nao e usuario deste provedor"] } });
        }
      }

      const carteira = carteiraDoStatusErp(cliente.status);
      const cls = classificarCliente({ contractStartDate: cliente.contractStartDate, diasAtraso, faturasAbertas: num(cliente.overdueInvoicesCount) }, hoje);
      const { etapas } = await carregarPolitica(providerId);
      const decisao = etapaParaAtraso(diasAtraso, carteira, etapas);

      let caso;
      try {
        caso = await storage.abrirCasoDeCobranca(providerId, {
          customerId,
          carteira,
          diasAtrasoAbertura: diasAtraso,
          valorAbertura: dividaAtual,
          etapaAtual: decisao.etapa?.id ?? null,
          responsavelUserId: responsavelUserId ?? null,
          prioridade,
          proximoContatoEm: proximoContatoEm ?? null,
          quadranteDna: cls.dna?.quadrante ?? null,
          tom: cls.tom,
        });
      } catch (e) {
        if (jaTemCaso(e)) return res.status(409).json({ message: "Cliente ja tem caso de cobranca aberto." });
        throw e;
      }
      await storage.registrarEventoDeCobranca(providerId, {
        casoId: caso.id,
        userId,
        tipo: "nota",
        notas: "Caso aberto manualmente",
        metadata: { abertura: "manual" },
      });
      logger.info({ providerId, casoId: caso.id, customerId, userId, carteira }, "COBRANCA caso aberto manualmente");

      const linha = await storage.obterCasoDeCobranca(providerId, caso.id);
      res.status(201).json(linha ? casoParaApi(linha) : { id: caso.id, status: caso.status });
    } catch (e) {
      falha(res, e);
    }
  });

  router.patch("/api/cobranca/casos/:id", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Caso invalido" });
    const parsed = PatchCasoSchema.safeParse(req.body);
    if (!parsed.success) return recusar(res, parsed.error);
    const b = parsed.data;
    if (Object.keys(b).every(k => k === "motivo")) return res.status(400).json({ message: "Nada a alterar" });
    const agora = new Date();
    const contatoNoPassado = erroDeProximoContato(b.proximoContatoEm, agora);
    if (contatoNoPassado) return res.status(400).json({ message: "Dados invalidos", errors: { proximoContatoEm: contatoNoPassado } });
    const cancelando = b.status === "cancelamento";
    if (cancelando && !b.motivo) {
      return res.status(400).json({ message: "Dados invalidos", errors: { motivo: ["Informe o motivo do cancelamento"] } });
    }

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      const caso = await storage.obterCasoDeCobranca(providerId, id);
      if (!caso) return res.status(404).json({ message: "Caso nao encontrado" });

      if (b.responsavelUserId !== undefined) {
        if (!podeAtribuir(req, b.responsavelUserId, caso)) {
          return res.status(403).json({ message: "Apenas administradores podem atribuir responsavel" });
        }
        if (b.responsavelUserId !== null && !(await equipeDoProvedor(providerId)).some(u => u.id === b.responsavelUserId)) {
          return res.status(400).json({ message: "Dados invalidos", errors: { responsavelUserId: ["nao e usuario deste provedor"] } });
        }
      }

      const de = caso.status as StatusDeCaso;
      if (b.status !== undefined) {
        const transicao = transicaoDeCaso(de, b.status);
        if (!transicao.ok) return res.status(409).json({ message: transicao.motivo });
        const pelaNegociacao = caminhoPelaNegociacao(de, b.status);
        if (pelaNegociacao) return res.status(409).json({ message: pelaNegociacao });
        const verbo = VERBO_SO_ADMIN_FECHA[b.status];
        if (verbo && !podeAdministrarOProvedor(req.session)) {
          return res.status(403).json({ message: `Apenas administradores podem ${verbo}` });
        }
      } else if (casoFechado(de)) {
        return res.status(409).json({ message: `Caso ${ROTULO_STATUS_DE_CASO[de].toLowerCase()} nao muda mais.` });
      }

      const patch: PatchDeCaso = {};
      if (b.prioridade !== undefined) patch.prioridade = b.prioridade;
      if (b.responsavelUserId !== undefined) patch.responsavelUserId = b.responsavelUserId;
      if (b.proximoContatoEm !== undefined) patch.proximoContatoEm = b.proximoContatoEm;
      // `em_contato` e `negativado` sao vivos: entram pelo patch comum.
      if (b.status !== undefined && !casoFechado(b.status) && !cancelando) patch.status = b.status;
      if (Object.keys(patch).length > 0) await storage.atualizarCasoDeCobranca(providerId, id, patch, userId);

      if (b.status !== undefined) {
        if (cancelando) {
          // Terminal, com motivo obrigatorio; o storage grava o evento, cancela
          // acordos vivos e deixa a nota de sugerir a recuperacao do equipamento.
          await storageFase2.cancelarCaso(providerId, id, b.motivo as string, userId);
        } else if (casoFechado(b.status)) {
          await storage.fecharCasoDeCobranca(providerId, id, b.status as StatusCasoFechado, b.motivo ?? null, userId);
        } else {
          // `negativado` deixa evento; `em_contato` nao tem evento proprio — o
          // contato registrado e que conta a historia. A maquina de estados decide.
          const evento = eventoDaTransicaoDeCaso(de, b.status);
          if (evento) {
            await storage.registrarEventoDeCobranca(providerId, {
              casoId: id, userId, tipo: evento, notas: b.motivo ?? null, metadata: { de, para: b.status },
            });
          }
        }
        logger.info({ providerId, casoId: id, userId, de, para: b.status }, "COBRANCA status do caso mudou");
      }

      const atualizado = await storage.obterCasoDeCobranca(providerId, id);
      res.json(atualizado ? casoParaApi(atualizado) : { id });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Eventos ───────────────────────────────────────────────────────────

  router.get("/api/cobranca/casos/:id/eventos", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Caso invalido" });
    const providerId = providerDaSessao(req);
    try {
      const caso = await storage.obterCasoDeCobranca(providerId, id);
      if (!caso) return res.status(404).json({ message: "Caso nao encontrado" });
      const [eventos, equipe] = await Promise.all([storage.listarEventosDoCaso(providerId, id), equipeDoProvedor(providerId)]);
      const nomes = new Map(equipe.map(u => [u.id, u.nome]));
      res.json(eventos.map(e => eventoParaApi(e, nomes)));
    } catch (e) {
      falha(res, e);
    }
  });

  router.post("/api/cobranca/casos/:id/eventos", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Caso invalido" });
    const parsed = EventoSchema.safeParse(req.body);
    if (!parsed.success) return recusar(res, parsed.error);
    const b = parsed.data;

    const errors: Record<string, string[]> = {};
    if (!(TIPOS_DECLARADOS as readonly string[]).includes(b.tipo)) {
      errors.tipo = [PORQUE_NAO_DECLARA[b.tipo] ?? "tipo gravado pelo sistema"];
    }
    if (b.tipo === "contato" && !b.canal) errors.canal = ["Informe o canal do contato"];
    const agora = new Date();
    if (b.ocorridoEm && b.ocorridoEm.getTime() > agora.getTime() + FOLGA_DE_RELOGIO_MS) {
      errors.ocorridoEm = ["Registro no futuro nao existe"];
    }
    const pedePromessa = b.tipo === "promessa" || b.resultado === "promessa_pagamento";
    if (pedePromessa && !b.promessaPara) errors.promessaPara = ["Informe a data prometida"];
    if (b.promessaPara !== undefined) {
      if (!dataCivilValida(b.promessaPara)) errors.promessaPara = ["use AAAA-MM-DD"];
      else if (b.promessaPara < dataLocal(agora)) errors.promessaPara = ["Promessa para uma data que ja passou"];
    }
    const contatoNoPassado = erroDeProximoContato(b.proximoContatoEm, agora);
    if (contatoNoPassado) errors.proximoContatoEm = contatoNoPassado;
    if (Object.keys(errors).length > 0) return res.status(400).json({ message: "Dados invalidos", errors });

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      const caso = await storage.obterCasoDeCobranca(providerId, id);
      if (!caso) return res.status(404).json({ message: "Caso nao encontrado" });
      if (casoFechado(caso.status)) {
        return res.status(409).json({ message: `Caso ${ROTULO_STATUS_DE_CASO[caso.status as StatusDeCaso].toLowerCase()} nao recebe registro.` });
      }

      const metadata: Record<string, unknown> = {};
      if (b.promessaPara) metadata.promessaPara = b.promessaPara;
      if (b.valorPrometido !== undefined) metadata.valorPrometido = b.valorPrometido;

      const evento = await storage.registrarEventoDeCobranca(providerId, {
        casoId: id,
        userId,
        tipo: b.tipo,
        canal: b.canal ?? null,
        resultado: b.resultado ?? null,
        notas: b.notas ?? null,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        ocorridoEm: b.ocorridoEm,
      });
      if (b.proximoContatoEm !== undefined) {
        await storage.atualizarCasoDeCobranca(providerId, id, { proximoContatoEm: b.proximoContatoEm }, userId);
      }
      logger.info({ providerId, casoId: id, userId, tipo: b.tipo, canal: b.canal ?? null, resultado: b.resultado ?? null }, "COBRANCA evento registrado");
      res.status(201).json(evento);
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Negociacoes ───────────────────────────────────────────────────────

  router.post("/api/cobranca/casos/:id/negociacoes", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Caso invalido" });
    const parsed = NegociacaoSchema.safeParse(req.body);
    if (!parsed.success) return recusar(res, parsed.error);
    const b = parsed.data;

    const hoje = dataLocal(new Date());
    const errors: Record<string, string[]> = {};
    if (b.primeiroVencimento !== undefined) {
      if (!dataCivilValida(b.primeiroVencimento)) errors.primeiroVencimento = ["use AAAA-MM-DD"];
      else if (b.primeiroVencimento < hoje) errors.primeiroVencimento = ["Vencimento no passado"];
    } else if (b.tipo === "parcelamento") {
      errors.primeiroVencimento = ["Informe o primeiro vencimento"];
    }
    if (Object.keys(errors).length > 0) return res.status(400).json({ message: "Dados invalidos", errors });

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      const caso = await storage.obterCasoDeCobranca(providerId, id);
      if (!caso) return res.status(404).json({ message: "Caso nao encontrado" });
      if (casoFechado(caso.status)) {
        return res.status(409).json({ message: `Caso ${ROTULO_STATUS_DE_CASO[caso.status as StatusDeCaso].toLowerCase()} nao recebe negociacao.` });
      }

      // A divida de referencia e a do servidor; o job espelha o ERP em
      // `valor_atual`, e antes do job vale a divida de hoje do cliente.
      const valorOriginal = caso.valorAtual > 0 ? caso.valorAtual : caso.cliente.dividaAtual;
      if (b.valorOriginal !== undefined && Math.abs(b.valorOriginal - valorOriginal) > 0.005) {
        return res.status(409).json({
          message: `A divida mudou desde que a tela foi carregada (era ${b.valorOriginal.toFixed(2)}, hoje ${valorOriginal.toFixed(2)}). Recarregue e refaca a proposta.`,
          valorOriginal,
        });
      }

      const { politica } = await carregarPolitica(providerId);
      const entrada = b.tipo === "parcelamento" ? b.entrada ?? 0 : 0;
      const veredito = validarNegociacao(
        politica,
        { tipo: b.tipo, valorOriginal, valorNegociado: b.valorNegociado, entrada, parcelas: b.parcelas },
        // `valorMensalidade` fica de fora: `customers` nao guarda o plano, e
        // sem ele o gate de "duas mensalidades" nao roda (fase 1).
        { vulneravel: VULNERAVEL_FASE_1 },
      );
      if (!veredito.ok) return res.status(422).json({ message: veredito.violacoes[0], violacoes: veredito.violacoes });

      // Quitacao e uma parcela so, vencendo no dia combinado (ou hoje): e o
      // que faz "pagar" fechar o caso pelo mesmo caminho do parcelamento.
      const primeiroVencimento = b.primeiroVencimento ?? hoje;
      const parcelas = b.tipo === "parcelamento"
        ? gerarParcelas(b.valorNegociado, b.parcelas as number, entrada, primeiroVencimento)
        : [{ numero: 1, valor: arredondar(b.valorNegociado), vencimento: primeiroVencimento }];
      const descontoPct = Math.max(0, arredondar(((valorOriginal - b.valorNegociado) / valorOriginal) * 100));

      let criada;
      try {
        criada = await storage.criarNegociacao(providerId, {
          casoId: id,
          tipo: b.tipo,
          valorOriginal,
          valorNegociado: b.valorNegociado,
          descontoPct,
          entrada,
          primeiroVencimento,
          criadoPorUserId: userId,
          aceita: b.aceita === true,
        }, parcelas);
      } catch (e) {
        // Duas propostas vivas seriam duas verdades sobre a mesma divida
        // (NEGOCIACAO_VIVA); o storage recusa na transacao, e a rota diz o caminho.
        if (conflitoDeCobranca(res, e)) return;
        throw e;
      }
      logger.info(
        { providerId, casoId: id, negociacaoId: criada.id, userId, tipo: b.tipo, parcelas: parcelas.length, aceita: b.aceita === true },
        "COBRANCA negociacao registrada",
      );
      res.status(201).json(negociacaoParaApi(criada, criada.parcelamento));
    } catch (e) {
      falha(res, e);
    }
  });

  router.patch("/api/cobranca/negociacoes/:id", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Negociacao invalida" });
    const parsed = PatchNegociacaoSchema.safeParse(req.body);
    if (!parsed.success) return recusar(res, parsed.error);
    const { casoId, status } = parsed.data;
    if (status === "cumprida") {
      return res.status(409).json({ message: "Uma negociacao e cumprida pela ultima parcela paga (POST /api/cobranca/parcelas/:id/pagar)." });
    }

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      const atual = await storageFase2.obterNegociacao(providerId, id);
      // Um `casoId` que nao bate e a tela falando de outro caso: nao se
      // corrige em silencio, porque o operador esta olhando para o errado.
      if (!atual || (casoId !== undefined && atual.casoId !== casoId)) return res.status(404).json({ message: "Negociacao nao encontrada" });
      const transicao = transicaoDeNegociacao(atual.status as StatusDeNegociacao, status);
      if (!transicao.ok) return res.status(409).json({ message: transicao.motivo });

      const nova = await storage.atualizarStatusDaNegociacao(providerId, id, status, userId);
      if (!nova) return res.status(404).json({ message: "Negociacao nao encontrada" });
      const [parcelamento, caso] = await Promise.all([
        storage.listarParcelasDaNegociacao(providerId, id),
        storage.obterCasoDeCobranca(providerId, atual.casoId),
      ]);
      logger.info({ providerId, casoId: atual.casoId, negociacaoId: id, userId, de: atual.status, para: status }, "COBRANCA status da negociacao mudou");
      res.json({ negociacao: negociacaoParaApi(nova, parcelamento), caso: caso ? casoParaApi(caso) : null });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Parcelas ──────────────────────────────────────────────────────────

  router.post("/api/cobranca/parcelas/:id/pagar", requireAuth, requireProvider, async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Parcela invalida" });
    const parsed = PagarSchema.safeParse(req.body);
    if (!parsed.success) return recusar(res, parsed.error);
    const { negociacaoId, valorPago } = parsed.data;
    const agora = new Date();
    const pagoEm = parsed.data.pagoEm ?? agora;
    if (pagoEm.getTime() > agora.getTime() + FOLGA_DE_RELOGIO_MS) {
      return res.status(400).json({ message: "Dados invalidos", errors: { pagoEm: ["Pagamento no futuro nao existe"] } });
    }

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      const parcela = await storageFase2.obterParcela(providerId, id);
      if (!parcela || (negociacaoId !== undefined && parcela.negociacaoId !== negociacaoId)) {
        return res.status(404).json({ message: "Parcela nao encontrada" });
      }
      if (parcela.status === "paga") return res.status(409).json({ message: `Parcela ${parcela.numero} ja esta paga.` });
      if (parcela.status === "cancelada") return res.status(409).json({ message: `Parcela ${parcela.numero} foi cancelada com a negociacao.` });

      let r;
      try {
        r = await storage.marcarParcelaPaga(providerId, id, valorPago, pagoEm, userId);
      } catch (e) {
        // Pagar parcela de PROPOSTA (NEGOCIACAO_NAO_ACEITA) faria proposta →
        // ativa por baixo da maquina de estados e deixaria o caso em
        // "negociando" sem acordo. O aceite e um ato registrado, nao uma
        // consequencia do dinheiro.
        if (conflitoDeCobranca(res, e)) return;
        throw e;
      }
      if (!r) return res.status(404).json({ message: "Parcela nao encontrada" });
      const [parcelamento, caso] = await Promise.all([
        storage.listarParcelasDaNegociacao(providerId, parcela.negociacaoId),
        storage.obterCasoDeCobranca(providerId, r.negociacao.casoId),
      ]);
      logger.info(
        { providerId, casoId: r.negociacao.casoId, negociacaoId: parcela.negociacaoId, parcelaId: id, userId, acordoCumprido: r.acordoCumprido },
        "COBRANCA parcela paga",
      );
      res.json({
        parcela: parcelaParaApi(r.parcela),
        negociacao: negociacaoParaApi(r.negociacao, parcelamento),
        acordoCumprido: r.acordoCumprido,
        // Lido da propria parcela devolvida: o valor nao a cobriu e ela segue pendente/atrasada com o acumulado.
        parcial: r.parcela.status !== "paga",
        caso: caso ? casoParaApi(caso) : null,
      });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Fila ──────────────────────────────────────────────────────────────

  router.get("/api/cobranca/fila", requireAuth, requireProvider, async (req, res) => {
    const parsed = FilaQuerySchema.safeParse(semVazios(req.query));
    if (!parsed.success) return recusar(res, parsed.error);
    const providerId = providerDaSessao(req);
    const hoje = new Date();
    const escopoUserId = parsed.data.responsavel === "eu" ? usuarioDaSessao(req) : undefined;
    try {
      const [{ politica, etapas }, linhas, agregado] = await Promise.all([
        carregarPolitica(providerId),
        storage.filaDeCobranca(providerId, { responsavelUserId: escopoUserId, hoje, limite: parsed.data.limite }),
        agregarFila(providerId, escopoUserId, hoje),
      ]);
      res.json({
        itens: linhas.map(l => itemDaFila(l, etapas, hoje)),
        // Sobre o recorte INTEIRO, nao sobre `itens` (decisao 6).
        total: agregado.total,
        kpis: agregado.kpis,
        kpisMotivo: agregado.kpisMotivo,
        escopo: parsed.data.responsavel,
        limite: parsed.data.limite,
        pausada: politica.pausada,
        pausadaMotivo: politica.pausadaMotivo,
      });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Kanban ────────────────────────────────────────────────────────────

  router.get("/api/cobranca/kanban", requireAuth, requireProvider, async (req, res) => {
    const parsed = KanbanQuerySchema.safeParse(semVazios(req.query));
    if (!parsed.success) return recusar(res, parsed.error);
    const q = parsed.data;
    const providerId = providerDaSessao(req);
    const hoje = new Date();
    const fechadosDesde = new Date(hoje.getTime() - JANELA_DE_FECHADOS_DIAS * 24 * 60 * 60 * 1000);
    try {
      const { politica, etapas } = await carregarPolitica(providerId);
      const filtros = filtrosDoKanban(q, usuarioDaSessao(req));
      const [colunas, conversasDoChat] = await Promise.all([
        Promise.all(colunasDoKanban().map(status => montarColuna(providerId, status, filtros, q.porColuna, fechadosDesde, etapas, hoje))),
        // A conversa do Chat BullQ ligada ao caso, quando houver. Falha aqui nao derruba o quadro.
        storage.conversasDoChatPorCaso(providerId).catch(() => new Map()),
      ]);
      // Os indicadores do QUADRO, sobre o mesmo recorte das colunas (a fila usa
      // outro escopo — "eu" la inclui a fila geral — e a tela misturava os dois).
      const varredura = await varrerCasos(providerId, filtros);
      const inicioDeHoje = new Date(hoje); inicioDeHoje.setHours(0, 0, 0, 0);
      const inicioDeAmanha = new Date(hoje); inicioDeAmanha.setHours(24, 0, 0, 0);
      const kpis = varredura.completa
        ? varredura.linhas.reduce((k, l) => ({
            casosVivos: k.casosVivos + 1,
            emAberto: arredondar(k.emAberto + l.valorAtual),
            vencidos: k.vencidos + (l.proximoContatoEm !== null && l.proximoContatoEm.getTime() < inicioDeHoje.getTime() ? 1 : 0),
            paraHoje: k.paraHoje + (l.proximoContatoEm === null || l.proximoContatoEm.getTime() < inicioDeAmanha.getTime() ? 1 : 0),
          }), { casosVivos: 0, emAberto: 0, vencidos: 0, paraHoje: 0 })
        : null;
      const comChat = colunas.map(c => ({
        ...c,
        casos: c.casos.map(item => {
          const v = conversasDoChat.get(item.id);
          return { ...item, chat: v ? { conversationId: v.conversationId, status: v.status } : null };
        }),
      }));
      res.json({
        colunas: comChat,
        total: colunas.reduce((s, c) => s + c.total, 0),
        kpis,
        kpisMotivo: kpis ? null : `Quadro com mais de ${PAGINAS_MAXIMAS_DA_VARREDURA * PAGINA_DA_VARREDURA} casos: os indicadores nao sao calculados neste recorte.`,
        fechadosDesde,
        porColuna: q.porColuna,
        pausada: politica.pausada,
        pausadaMotivo: politica.pausadaMotivo,
      });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Regua e DNA ───────────────────────────────────────────────────────

  router.get("/api/cobranca/regua", requireAuth, requireProvider, async (req, res) => {
    const providerId = providerDaSessao(req);
    try {
      const [{ politica, etapas, configurada }, contagens, equipe] = await Promise.all([
        carregarPolitica(providerId),
        storage.contarCasosPorEtapa(providerId),
        equipeDoProvedor(providerId),
      ]);
      const nomes = new Map(equipe.map(u => [u.id, u.nome]));
      const comNome = (lista: Etapa[]) => lista.map(e => ({
        ...e,
        janela: janelaDaEtapa(e),
        responsavelNome: e.responsavelUserId === null ? null : nomes.get(e.responsavelUserId) ?? null,
      }));
      res.json({
        etapas: comNome(etapas),
        porCarteira: { ativo: comNome(etapasDaCarteira("ativo", etapas)), ex_cliente: comNome(etapasDaCarteira("ex_cliente", etapas)) },
        contagens,
        pausada: politica.pausada,
        pausadaMotivo: politica.pausadaMotivo,
        fonte: configurada ? "politica" : "padrao",
      });
    } catch (e) {
      falha(res, e);
    }
  });

  router.get("/api/cobranca/dna", requireAuth, requireProvider, async (req, res) => {
    const providerId = providerDaSessao(req);
    try {
      const contagens = await storage.contarCasosPorQuadrante(providerId);
      const porQuadrante = new Map<string, { casos: number; valor: number; porCarteira: Record<string, { casos: number; valor: number }> }>();
      let semClassificacao = 0;
      let valorSemClassificacao = 0;
      let total = 0;
      for (const c of contagens) {
        total += c.casos;
        if (!c.quadrante || !(QUADRANTES as readonly string[]).includes(c.quadrante)) {
          semClassificacao += c.casos;
          valorSemClassificacao += c.valor;
          continue;
        }
        const acumulado = porQuadrante.get(c.quadrante) ?? { casos: 0, valor: 0, porCarteira: {} };
        acumulado.casos += c.casos;
        acumulado.valor += c.valor;
        const daCarteira = acumulado.porCarteira[c.carteira] ?? { casos: 0, valor: 0 };
        acumulado.porCarteira[c.carteira] = { casos: daCarteira.casos + c.casos, valor: daCarteira.valor + c.valor };
        porQuadrante.set(c.quadrante, acumulado);
      }
      const quadrantes = QUADRANTES.map(q => {
        const eixos = eixosDoQuadrante(q);
        const abordagem = ABORDAGEM_POR_QUADRANTE[q];
        const contagem = porQuadrante.get(q) ?? { casos: 0, valor: 0, porCarteira: {} };
        return {
          codigo: q,
          fidelidade: eixos.fidelidade,
          confiabilidade: eixos.confiabilidade,
          abordagem,
          diretiva: DIRETIVA_POR_TOM[abordagem],
          fraseExemplo: FRASE_EXEMPLO_POR_QUADRANTE[q],
          familia: familiaDoQuadrante(q),
          casos: contagem.casos,
          valor: contagem.valor,
          porCarteira: contagem.porCarteira,
        };
      });
      res.json({
        grade: GRADE_DNA,
        quadrantes,
        contagens,
        total,
        semClassificacao,
        valorSemClassificacao,
        // Fase 1: a confiabilidade sai so do atraso atual — a tela avisa.
        historicoInsuficiente: true,
      });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Politica ──────────────────────────────────────────────────────────

  router.get("/api/cobranca/politica", requireAuth, requireProvider, async (req, res) => {
    const providerId = providerDaSessao(req);
    try {
      const { politica, etapas, configurada, updatedAt } = await carregarPolitica(providerId);
      res.json({ politica, etapas, configurada, updatedAt, tetos: TETOS_LEGAIS });
    } catch (e) {
      falha(res, e);
    }
  });

  router.put("/api/cobranca/politica", requireAuth, requireProvider, exigirAdminDoProvedor("alterar a politica de cobranca"), async (req, res) => {
    const corpo = req.body;
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
      return res.status(400).json({ message: "Dados invalidos", errors: { politica: ["esperava um objeto"] } });
    }
    // Estrito no topo: chave que a politica nao tem e erro, nao silencio —
    // um `negociacoes` (plural) gravado em silencio pareceria salvo e nao valeria.
    const desconhecidas = Object.keys(corpo).filter(k => !(CHAVES_DA_POLITICA as readonly string[]).includes(k));
    if (desconhecidas.length > 0) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: Object.fromEntries(desconhecidas.map(k => [k, ["campo desconhecido"]])),
      });
    }

    const providerId = providerDaSessao(req);
    const userId = usuarioDaSessao(req);
    try {
      // O corpo entra por cima da politica que vale: o botao "pausar regua"
      // manda so `pausada`, e sem a mescla os defaults do schema apagariam a
      // negociacao configurada.
      const atual = await carregarPolitica(providerId);
      const r = validarPolitica({ ...atual.politica, ...(corpo as Record<string, unknown>) });
      if (!r.ok) return res.status(400).json({ message: "Dados invalidos", errors: fieldErrorsDe(r.erros) });

      const responsaveis = r.politica.etapas.map(e => e.responsavelUserId).filter((v): v is number => typeof v === "number");
      if (responsaveis.length > 0) {
        const equipe = await equipeDoProvedor(providerId);
        const estranho = responsaveis.find(id => !equipe.some(u => u.id === id));
        if (estranho !== undefined) {
          return res.status(400).json({ message: "Dados invalidos", errors: { etapas: [`responsavel ${estranho} nao e usuario deste provedor`] } });
        }
      }

      const politica: Politica = { ...r.politica, pausadaMotivo: r.politica.pausada ? r.politica.pausadaMotivo : null };
      const linha = await storage.upsertPoliticaDeCobranca(providerId, politica);
      logger.info({ providerId, userId, pausada: politica.pausada, ajustes: r.ajustes.length }, "COBRANCA politica gravada");
      res.json({ politica, ajustes: r.ajustes, etapas: etapasDaPolitica(politica), configurada: true, updatedAt: linha.updatedAt, tetos: TETOS_LEGAIS });
    } catch (e) {
      falha(res, e);
    }
  });

  // ── Equipe ────────────────────────────────────────────────────────────

  router.get("/api/cobranca/equipe", requireAuth, requireProvider, async (req, res) => {
    try {
      res.json({ usuarios: await equipeDoProvedor(providerDaSessao(req)) });
    } catch (e) {
      falha(res, e);
    }
  });

  return router;
}
