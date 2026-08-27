/**
 * BigDataCorp — Consulta Cadastral
 *
 * Endpoint: https://plataforma.bigdatacorp.com.br/pessoas
 * Auth: headers AccessToken + TokenId
 *
 * ATENCAO ao TokenId: ele NAO e o `jti` do JWT. E um identificador de 24 hex
 * que so existe na resposta de POST /tokens/gerar. Um token copiado do painel
 * nunca autentica sozinho — falta um dado que nao esta dentro dele. Medido em
 * 2026-08-22 contra a API real.
 *
 * Credencial e POR PROVEDOR (bigdata_integrations): um usuario de integracao
 * por tenant, para consumo e custo aparecerem separados tambem no bureau.
 */

import { logger } from "../logger";
import { CircuitBreaker, withResilience } from "../erp/resilience";
import { faixaRendaEmReais, type DadosCadastrais, type EnderecoCadastral } from "./bigdata-veredito";

/** Endereco completo para exibir — o operador precisa ver, nao so contar. */
export interface EnderecoDetalhado {
  logradouro: string; numero?: string; complemento?: string;
  bairro?: string; cidade?: string; uf?: string; cep?: string;
  ratificado: boolean; ativo: boolean; principal: boolean;
  naReceita: boolean;
  ultimaPassagem?: string | null; passagens: number; passagensRuins: number;
  lat?: number; lon?: number;
}

export interface TelefoneDetalhado {
  numero: string; ddd?: string; tipo?: string; operadora?: string;
  ativo: boolean; principal: boolean; prioridade?: number;
  naoPerturbe: boolean;
  ultimaPassagem?: string | null; passagensRuins: number;
}

const BASE_URL = process.env.BIGDATA_BASE_URL || "https://plataforma.bigdatacorp.com.br";


/**
 * Combo de credito. Todos verificados como liberados na conta em 2026-08-22.
 * Uma unica requisicao traz todos — a falha de um nao invalida os outros.
 *
 * PRECO POR DATASET (faixa 1-10 mil consultas/mes, tabela publica da BigData
 * em 2026-08-22). Cada um e cobrado a parte: tirar um economiza de verdade,
 * adicionar um encarece toda consulta. Some antes de mexer.
 *   basic_data 0,04 · historical_basic_data 0,04
 *   addresses_extended 0,06 · phones_extended 0,06 · emails_extended 0,06
 *   financial_data 0,06 · financial_risk 0,06 · collections 0,06
 *   government_debtors 0,06 · digital_finance_behaviors 0,06 · passages 0,06
 *   vehicles 0,06 · social_assistance_extended 0,06 · processes 0,08
 *   professional_turnover 0,06 · demographic_data 0,06
 *   ------------------------------------------------------------------
 *   combo = R$ 0,94   (+ R$ 0,08 do address_risk, chamada separada = R$ 1,02)
 */
export const DATASETS = [
  // Identidade
  "basic_data",
  // Contato e vinculo com endereco
  "addresses_extended", "phones_extended", "emails_extended",
  // Capacidade de pagar
  "financial_data", "financial_risk",
  // Inadimplencia
  "collections", "processes", "government_debtors",
  // Comportamento e rastro
  "digital_finance_behaviors", "passages", "historical_basic_data",
  // Patrimonio e beneficio — calibram a faixa de plano
  "vehicles", "social_assistance_extended",
  // Estabilidade de renda e perfil. Renda em faixa diz QUANTO a pessoa ganha;
  // rotatividade diz se ela vai continuar ganhando nos 12 meses do contrato.
  "professional_turnover", "demographic_data",
] as const;

/**
 * Bureau de mercado do nivel COMPLETA. R$ 1,80 sobre a base (preco DA CONTA,
 * medido na API de Precos em 2026-08-26 — abaixo da tabela publica de R$ 3,02).
 * Estes datasets respondem SOMENTE no endpoint /marketplace.
 *
 * `..._details_person` e superconjunto de `partner_quod_credit_risk_person`
 * (R$ 1,21): os dois devolvem o envelope QUODCreditRiskPerson, e o de detalhes
 * traz valor da divida, protestos e consultas por segmento alem dos booleanos.
 * Pedir os dois pagaria duas vezes pelo mesmo envelope.
 *
 * `partner_quod_credit_score_person` (R$ 2,41) tambem ficou de fora: entrega um
 * score, e o Quantum entrega score por R$ 0,61.
 */
const DATASETS_COMPLETA = [
  // R$ 2,41 — divida em reais, negativacoes ativas/quitadas, protestos,
  // consultas em 30/60/90 dias e por segmento do mercado.
  "partner_quod_credit_risk_details_person",
  // R$ 0,61 — score 0-999 de inadimplencia. O mais barato do marketplace.
  "partner_quantum_custom_score_person",
] as const;


/**
 * Deliberadamente FORA de todos os niveis — nao e esquecimento.
 *
 * Todo dataset listado vira cobranca no instante em que o provedor habilita no
 * BDC Center. So entra aqui o que a consulta consegue de fato usar.
 *
 * - `partner_b2e_score_person` (R$ 1,21): classifica a coerencia da FICHA
 *   preenchida (A-D). Exige name, birthdate, phone, address, city, uf e zipcode
 *   no `q`; mandamos apenas doc{cpf}, entao devolveria -102 ou classificacao
 *   degradada. So passa a valer com um modo "conferir ficha" no formulario.
 * - `partner_scorepositivo_individual_finance` (R$ 7,01): SCR do Banco Central,
 *   exige autorizacao formal do titular registrada — nao ha esse fluxo aqui.
 * - `partner_boavista_one_score_person` (R$ 13,02): score multidados, redundante
 *   com o Quantum por 20x o preco.
 * - `partner_boavista_credit_score_person` (R$ 13,02): unico que devolve NOME —
 *   credor de cada negativacao e empresas que ja consultaram o CPF. O nivel
 *   Premium que o usava foi removido a pedido. O parser e a tela continuam
 *   prontos (ficam dormentes, guardados por `.length > 0`), entao reativar e
 *   voltar este nome para um nivel.
 */
export const DATASETS_FORA_DE_USO = [
  "partner_b2e_score_person",
  "partner_scorepositivo_individual_finance",
  "partner_boavista_one_score_person",
  "partner_boavista_credit_score_person",
] as const;

export type NivelConsulta = "padrao" | "completa";

/**
 * Os tres niveis de consulta. O provedor escolhe a cada busca.
 *
 * `creditos` e quanto sai do saldo do provedor. `custoBrl` e o que a BigData
 * cobra de nos na faixa de entrada (1-10 mil/mes), somando o preco de cada
 * dataset mais R$ 0,08 do address_risk (chamada separada a /enderecos).
 *
 * A margem vive na diferenca entre `creditos` e `custoBrl`: com o credito
 * vendido a R$ 1,00 os tres saem no zero a zero. Quem define a margem e o preco
 * dos pacotes em BIGDATA_CREDIT_PACKAGES (shared/schema.ts), nao esta tabela.
 */
export const NIVEIS: Record<NivelConsulta, {
  rotulo: string;
  descricao: string;
  datasets: readonly string[];
  /**
   * Sondas por entidade da Completa: validam o telefone principal
   * (partner_telesign_phone_id_standard_person, R$ 0,10 — linha ativa,
   * operadora real pos-portabilidade, tipo) e o imovel do endereco principal
   * (partner_rede_vistorias_address, R$ 0,25 — tipologia, area, comodos).
   * Ficam FORA de `datasets` porque o `q` delas nao e doc{cpf}: sao chamadas
   * proprias ao /marketplace com phone{...} e zipcode{...},addressnumber{...},
   * melhor-esforco como o address_risk — falha nao derruba nem estorna.
   */
  sondas: boolean;
  creditos: number;
  custoBrl: number;
}> = {
  padrao: {
    rotulo: "Padrão",
    descricao: "Receita, endereço, renda, cobranças e processos",
    datasets: DATASETS,
    sondas: false,
    creditos: 1,
    // Preco DA CONTA (API de Precos, 2026-08-26): R$ 0,80 + R$ 0,08 address_risk.
    custoBrl: 0.88,
  },
  completa: {
    rotulo: "Completa",
    descricao: "Padrão + negativação, dívida, protestos, score de mercado, linha do telefone e imóvel",
    datasets: [...DATASETS, ...DATASETS_COMPLETA],
    sondas: true,
    creditos: 4,
    // Padrao (0,88) + parceiros doc{cpf} (1,80) + sondas de telefone e imovel (0,35).
    custoBrl: 3.03,
  },
};

export const NIVEL_PADRAO: NivelConsulta = "padrao";

/**
 * Datasets que o nivel cobra ALEM do padrao. Se todos voltarem -109, o provedor
 * pagou por bureau que a conta dele nao tem habilitado — e a rota estorna a
 * diferenca em vez de cobrar por dado que nao chegou.
 */
export function extrasDoNivel(nivel: NivelConsulta): string[] {
  const base = new Set<string>(NIVEIS[NIVEL_PADRAO].datasets);
  return NIVEIS[nivel].datasets.filter(d => !base.has(d));
}

/** Circuito por provedor: a credencial de um nao deve derrubar a consulta de outro. */
const circuitos = new Map<number, CircuitBreaker>();
function circuitoDe(providerId: number): CircuitBreaker {
  let c = circuitos.get(providerId);
  if (!c) { c = new CircuitBreaker({ maxFailures: 3, resetTimeMs: 60_000 }); circuitos.set(providerId, c); }
  return c;
}

/** Cache de token por provedor. Global vazaria credencial entre tenants. */
interface TokenCacheado { token: string; tokenId: string; expiraEm: number }
const tokens = new Map<number, TokenCacheado>();

/** Renova quando faltar menos de 24h — token vencido em producao e apagao silencioso. */
const MARGEM_RENOVACAO_MS = 24 * 60 * 60 * 1000;

export class BigDataError extends Error {
  constructor(message: string, readonly codigo?: number) {
    super(message);
    this.name = "BigDataError";
  }
}

export interface Credencial { login: string; password: string }

/** Limpa o token em cache — chamado quando a credencial do provedor muda. */
export function invalidarToken(providerId: number): void {
  tokens.delete(providerId);
}

async function gerarToken(providerId: number, cred: Credencial): Promise<TokenCacheado> {
  const r = await fetch(`${BASE_URL}/tokens/gerar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ login: cred.login, password: cred.password, expires: 8760 }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!d?.success || !d.token || !d.tokenID) {
    throw new BigDataError(d?.message || "Não foi possível autenticar");
  }
  const cacheado: TokenCacheado = {
    token: d.token,
    tokenId: d.tokenID,
    expiraEm: d.expiration ? Date.parse(d.expiration) : Date.now() + 365 * 24 * 3600 * 1000,
  };
  tokens.set(providerId, cacheado);
  logger.info({ providerId, expira: d.expiration }, "[BigData] token gerado");
  return cacheado;
}

async function obterToken(providerId: number, cred: Credencial): Promise<TokenCacheado> {
  const atual = tokens.get(providerId);
  if (atual && atual.expiraEm - Date.now() > MARGEM_RENOVACAO_MS) return atual;
  return gerarToken(providerId, cred);
}

/** Valida a credencial sem gastar consulta: só gera token. */
export async function testarCredencial(
  providerId: number, cred: Credencial,
): Promise<{ ok: boolean; message: string }> {
  try {
    invalidarToken(providerId);
    const t = await gerarToken(providerId, cred);
    return { ok: true, message: `Credencial válida até ${new Date(t.expiraEm).toLocaleDateString("pt-BR")}` };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Falha ao autenticar" };
  }
}

// ── Normalizacao ─────────────────────────────────────────────────────────────

/** Mais recente primeiro, principal na frente: e a ordem que o operador le. */
function ordenarPorRelevancia<T extends { principal: boolean; ultimaPassagem?: string | null }>(l: T[]): T[] {
  return [...l].sort((a, b) => {
    if (a.principal !== b.principal) return a.principal ? -1 : 1;
    return String(b.ultimaPassagem ?? "").localeCompare(String(a.ultimaPassagem ?? ""));
  });
}

function normalizarEnderecos(bloco: any): EnderecoDetalhado[] {
  const lista: any[] = Array.isArray(bloco?.Addresses) ? bloco.Addresses : [];
  return ordenarPorRelevancia(lista.map(a => ({
    logradouro: [a?.Typology, a?.AddressMain].filter(Boolean).join(" ").trim() || "Sem logradouro",
    numero: a?.Number || undefined,
    complemento: a?.Complement || undefined,
    bairro: a?.Neighborhood || undefined,
    cidade: a?.City || undefined,
    uf: a?.State || undefined,
    cep: a?.ZipCode || undefined,
    ratificado: !!a?.IsRatified,
    ativo: !!a?.IsActive,
    principal: !!a?.IsMainForEntity,
    naReceita: !!a?.AddressCurrentlyInRFSite,
    ultimaPassagem: a?.EntityLastPassageDate ?? null,
    passagens: Number(a?.AddressEntityTotalPassages ?? 0) || 0,
    passagensRuins: Number(a?.AddressEntityBadPassages ?? 0) || 0,
    lat: typeof a?.Latitude === "number" ? a.Latitude : undefined,
    lon: typeof a?.Longitude === "number" ? a.Longitude : undefined,
  })));
}

function normalizarTelefones(bloco: any): TelefoneDetalhado[] {
  const lista: any[] = Array.isArray(bloco?.Phones) ? bloco.Phones : [];
  return ordenarPorRelevancia(lista.map(t => ({
    numero: String(t?.Number ?? ""),
    ddd: t?.AreaCode || undefined,
    tipo: t?.Type || undefined,
    operadora: t?.CurrentCarrier || undefined,
    ativo: !!t?.IsActive,
    principal: !!t?.IsMainForEntity,
    prioridade: Number(t?.Priority ?? 0) || undefined,
    naoPerturbe: !!t?.IsInDoNotCallList,
    ultimaPassagem: t?.EntityLastPassageDate ?? null,
    passagensRuins: Number(t?.PhoneEntityBadPassages ?? 0) || 0,
  })));
}

/**
 * Rotulo de cada fonte de renda, e se ela vem de registro formal.
 * Os rotulos NAO nomeiam o fornecedor: a origem do dado e informacao sensivel
 * de negocio e esses textos vao direto para a tela do provedor. MTE e IBGE
 * ficam porque sao orgaos publicos, nao o bureau que vendemos.
 */
const FONTES_RENDA: Record<string, { rotulo: string; formal: boolean }> = {
  MTE: { rotulo: "Vínculo formal (MTE)", formal: true },
  "COMPANY OWNERSHIP": { rotulo: "Participação societária", formal: true },
  BIGDATA_V2: { rotulo: "Estimativa consolidada", formal: false },
  BIGDATA: { rotulo: "Estimativa consolidada (v1)", formal: false },
  IBGE: { rotulo: "Média IBGE da região", formal: false },
};

function normalizarRenda(fin: any): RendaDetalhada {
  const est = fin?.IncomeEstimates ?? {};
  const fontes: FonteRenda[] = Object.entries(est)
    .filter(([, v]) => v && String(v).toUpperCase() !== "SEM INFORMACAO")
    .map(([k, v]) => ({
      fonte: FONTES_RENDA[k]?.rotulo ?? k,
      faixa: String(v),
      emReais: faixaRendaEmReais(String(v)),
      formal: FONTES_RENDA[k]?.formal ?? false,
    }));

  const rendaFormal = fontes.find(f => f.formal) ?? null;

  const declaracoesIR: DeclaracaoIR[] = (Array.isArray(fin?.TaxReturns) ? fin.TaxReturns : [])
    .map((t: any) => ({
      ano: String(t?.Year ?? ""),
      status: t?.Status || undefined,
      banco: t?.Bank || undefined,
      agencia: t?.Branch || undefined,
      segmentoVip: !!t?.IsVipBranch,
    }))
    .filter((t: DeclaracaoIR) => t.ano)
    .sort((a: DeclaracaoIR, b: DeclaracaoIR) => b.ano.localeCompare(a.ano));

  return {
    // A faixa que decide continua sendo a BIGDATA_V2: e a que cobre mais gente.
    faixa: est.BIGDATA_V2 ?? est.BIGDATA,
    emReais: faixaRendaEmReais(est.BIGDATA_V2 ?? est.BIGDATA),
    patrimonio: fin?.TotalAssets,
    fontes,
    rendaFormal,
    // Tres anos ou mais de declaracao indica renda estavel e rastreavel — quem
    // some da Receita costuma ser quem some da cobranca.
    declaraIrRecorrente: declaracoesIR.length >= 3,
    temSegmentoVip: declaracoesIR.some(d => d.segmentoVip),
    declaracoesIR,
  };
}

/**
 * Risco de area pela coordenada. Chamada separada, na API de enderecos.
 * Nao e risco de credito: e risco OPERACIONAL — seguranca do tecnico e chance
 * de o equipamento nao voltar. Nenhum bureau responde essa pergunta.
 *
 * O parametro exige COLCHETES: latlong[lat,lon]. Com chaves a API devolve -131.
 */
async function consultarRiscoArea(
  headers: Record<string, string>, enderecos: EnderecoDetalhado[],
): Promise<RiscoArea[]> {
  // So o principal. Cada coordenada custa R$ 0,07 (medido na API de precos da
  // conta), entao tres enderecos triplicariam esse pedaco da consulta. O
  // principal e o mais provavel de ser o de instalacao; subir para 2 ou 3 e
  // mudar este slice.
  const comCoord = enderecos.filter(e => e.lat != null && e.lon != null).slice(0, 1);
  const saida: RiscoArea[] = [];

  for (const e of comCoord) {
    try {
      const r = await fetch(`${BASE_URL}/enderecos`, {
        method: "POST", headers,
        body: JSON.stringify({
          Datasets: "address_risk", q: `latlong[${e.lat},${e.lon}]`, Limit: 1,
        }),
      });
      const d: any = await r.json();
      const bloco = d?.Result?.[0]?.AddressRiskData;
      if (d?.Status?.address_risk?.[0]?.Code === 0 && bloco) {
        saida.push({
          endereco: [e.logradouro, e.numero, e.cidade].filter(Boolean).join(", "),
          ponto: bloco.Point,
          raio100m: bloco.Radius100m,
        });
      }
    } catch {
      // Melhor esforco: risco de area e complemento, nao pode derrubar a consulta.
    }
  }
  return saida;
}

/**
 * Valida o telefone principal no bureau de telefonia. So o principal: cada
 * numero custa R$ 0,10, e o principal e o que o provedor vai usar para cobrar.
 * Melhor-esforco — enquanto o dataset estiver -1203 na conta, devolve null.
 */
async function validarTelefonePrincipal(
  headers: Record<string, string>, telefones: TelefoneDetalhado[],
): Promise<ValidacaoTelefone | null> {
  const principal = telefones.find(t => t.principal) ?? telefones[0];
  if (!principal?.numero) return null;
  const digitos = `${principal.ddd ?? ""}${principal.numero}`.replace(/\D/g, "");
  if (digitos.length < 10) return null;

  try {
    const r = await fetch(`${BASE_URL}/marketplace`, {
      method: "POST", headers,
      body: JSON.stringify({
        Datasets: "partner_telesign_phone_id_standard_person",
        // Formato E.164 sem "+": DDI 55 + DDD + numero (exemplo da doc).
        q: `phone{55${digitos}}`, Limit: 1,
      }),
    });
    const d: any = await r.json();
    if (d?.Status?.partner_telesign_phone_id_standard_person?.[0]?.Code !== 0) return null;
    return normalizarTelefoneValidado(
      d?.Result?.[0]?.TelesignPhoneIDData,
      `(${principal.ddd ?? ""}) ${principal.numero}`,
    );
  } catch {
    return null;
  }
}

/**
 * Qualifica o imovel do endereco principal (CEP + numero). So o principal,
 * pelo mesmo motivo do address_risk: e o endereco de instalacao.
 */
async function qualificarImovelPrincipal(
  headers: Record<string, string>, enderecos: EnderecoDetalhado[],
): Promise<Imovel | null> {
  const principal = enderecos.find(e => e.principal) ?? enderecos[0];
  const cep = (principal?.cep ?? "").replace(/\D/g, "");
  const numero = (principal?.numero ?? "").replace(/\D/g, "");
  if (cep.length !== 8 || !numero) return null;

  try {
    const r = await fetch(`${BASE_URL}/marketplace`, {
      method: "POST", headers,
      body: JSON.stringify({
        Datasets: "partner_rede_vistorias_address",
        q: `zipcode{${cep}},addressnumber{${numero}}`, Limit: 1,
      }),
    });
    const d: any = await r.json();
    if (d?.Status?.partner_rede_vistorias_address?.[0]?.Code !== 0) return null;
    return normalizarImovel(
      d?.Result?.[0]?.RedeVistoriasData,
      [principal.logradouro, principal.numero, principal.cidade].filter(Boolean).join(", "),
    );
  } catch {
    return null;
  }
}

/**
 * Um processo individual, no formato de linha de relatorio de bureau (modelo
 * Serasa: cada categoria e uma tabela de ocorrencias, nao um contador).
 * Dado publico de tribunal — pode aparecer por inteiro.
 */
export interface ProcessoDetalhe {
  data?: string;
  /** "EMBARGOS À EXECUÇÃO", "EXECUÇÃO DE TÍTULO EXTRAJUDICIAL"... */
  tipo?: string;
  /** Assunto CNJ amplo: "DIREITO DO CONSUMIDOR"... */
  assunto?: string;
  tribunal?: string;
  uf?: string;
  status?: string;
  valor?: number;
  /** Papel do CPF consultado neste processo. So "réu" pesa no risco. */
  papel: "réu" | "autor" | "outro";
}

/** Lawsuits do bruto -> linhas de relatorio. Exportado para teste. */
export function normalizarProcessosDetalhe(proc: any, cpf: string): ProcessoDetalhe[] {
  const lawsuits: any[] = Array.isArray(proc?.Lawsuits) ? proc.Lawsuits : [];
  const dataReal = (v: any) => {
    const s = String(v ?? "");
    return s && !s.startsWith("0001-01-01") ? s : undefined;
  };

  return lawsuits
    .map((l): ProcessoDetalhe => {
      // O papel vem da parte cujo Doc e o CPF consultado: polo PASSIVO e reu.
      const parte = (Array.isArray(l?.Parties) ? l.Parties : [])
        .find((p: any) => String(p?.Doc ?? "").replace(/\D/g, "") === cpf);
      const polaridade = String(parte?.Polarity ?? "").toUpperCase();
      const valor = numeroBr(l?.Value);
      return {
        data: dataReal(l?.NoticeDate) ?? dataReal(l?.LastMovementDate),
        tipo: l?.InferredCNJProcedureTypeName || l?.Type || undefined,
        assunto: l?.InferredBroadCNJSubjectName || undefined,
        tribunal: l?.CourtName || undefined,
        uf: l?.State || undefined,
        status: l?.Status || undefined,
        // -1 e o "nao informado" da BigData, nao um valor.
        valor: valor != null && valor > 0 ? valor : undefined,
        papel: !parte ? "outro" : polaridade === "PASSIVE" ? "réu" : polaridade === "ACTIVE" ? "autor" : "outro",
      };
    })
    .sort((a, b) => String(b.data ?? "").localeCompare(String(a.data ?? "")))
    // 15 linhas cobrem o percentil alto sem transformar a tela num diario oficial.
    .slice(0, 15);
}

/** Naturezas processuais que significam cobranca judicial de divida. */
const NATUREZAS_EXECUCAO = ["EXECUCAO", "EXECUÇÃO", "MONITORIA", "MONITÓRIA", "BUSCA E APREENSAO"];

function normalizarInadimplencia(col: any, proc: any, gov: any): Inadimplencia {
  const lawsuits: any[] = Array.isArray(proc?.Lawsuits) ? proc.Lawsuits : [];

  // So conta execucao onde a pessoa e RE. Executar alguem nao diz nada sobre
  // pagar as proprias contas — ser executado, sim.
  const comoReu = lawsuits.filter(l =>
    String(l?.Status ?? "").toUpperCase().includes("EXECU") ||
    NATUREZAS_EXECUCAO.some(n => String(l?.Type ?? "").toUpperCase().includes(n)));

  const naturezas = Array.from(new Set(
    lawsuits.map(l => String(l?.CourtType ?? "").trim()).filter(Boolean),
  ));

  return {
    emCobrancaAgora: !!col?.IsCurrentlyOnCollection,
    cobrancas365d: Number(col?.Last365DaysCollectionOccurrences ?? 0) || 0,
    credores365d: Number(col?.Last365DaysCollectionOrigins ?? 0) || 0,
    mesesConsecutivos: Number(col?.MaxConsecutiveCollectionMonths ?? 0) || 0,
    ultimaCobranca: col?.LastCollectionDate || undefined,
    processosTotal: Number(proc?.TotalLawsuits ?? 0) || 0,
    processosComoReu: Number(proc?.TotalLawsuitsAsDefendant ?? 0) || 0,
    processos365d: Number(proc?.Last365DaysLawsuits ?? 0) || 0,
    temExecucao: comoReu.length > 0 && Number(proc?.TotalLawsuitsAsDefendant ?? 0) > 0,
    naturezas,
    dividaAtiva: Number(gov?.TotalDebtValue ?? 0) || 0,
  };
}

/** A BigData devolve numero decimal como string com virgula em varios campos. */
function numeroBr(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function normalizarOcupacao(turnover: any): Ocupacao {
  const empresas = Array.isArray(turnover?.CompaniesWorkedFor) ? turnover.CompaniesWorkedFor : [];
  return {
    empregadoAgora: typeof turnover?.IsCurrentlyEmployed === "boolean" ? turnover.IsCurrentlyEmployed : undefined,
    empreendedor: typeof turnover?.IsEntrepeneur === "boolean" ? turnover.IsEntrepeneur : undefined,
    trocasTotal: Number(turnover?.TotalProfessionalTurnover ?? 0) || 0,
    trocas5Anos: Number(turnover?.TotalProfessionalTurnoverIn5Years ?? 0) || 0,
    trocas10Anos: Number(turnover?.TotalProfessionalTurnoverIn10Years ?? 0) || 0,
    mediaAnosPorVinculo: numeroBr(turnover?.AvgYearsBetweenProfessionalTurnover),
    idadePrimeiroEmprego: numeroBr(turnover?.AgeOfFirstJob),
    primeiroVinculo: turnover?.FirstJobAdmissionDate || undefined,
    setorPublico: typeof turnover?.HasWorkedInPublicSector === "boolean" ? turnover.HasWorkedInPublicSector : undefined,
    setorPrivado: typeof turnover?.HasWorkedInPrivateSector === "boolean" ? turnover.HasWorkedInPrivateSector : undefined,
    // A lista de empregadores identifica onde a pessoa trabalha. Guardamos so a
    // contagem: o provedor precisa saber se ha vinculo, nao onde ela bate ponto.
    totalEmpregadores: empresas.length,
  };
}

/**
 * Granularidade da estimativa demografica, da mais fina para a mais grossa.
 * Setor censitario e a quadra; cidade inteira diz pouco sobre um endereco.
 */
const GRANULARIDADE = ["CENSUS SECTOR", "NEIGHBORHOOD", "CITY", "STATE", "COUNTRY"];

/**
 * `demographic_data` devolve um ARRAY, uma entrada por fonte (MTE, IBGE), cada
 * uma num nivel de agregacao diferente. Tratar como objeto — que foi o erro
 * original — deixava tudo vazio mesmo com o dataset respondendo Code 0.
 *
 * Os valores vem com codigo na frente ("2 - 2 A 4 SM", "05 - FUND COMPL"), que
 * e ruido de catalogo e nao entra na tela.
 */
export function normalizarPerfil(demo: any): Perfil {
  const entradas: any[] = Array.isArray(demo) ? demo : demo ? [demo] : [];
  if (entradas.length === 0) return {};

  const limpar = (v: any) => {
    const s = String(v ?? "").trim().replace(/^\d+\s*-\s*/, "").trim();
    return s && s.toUpperCase() !== "SEM INFORMACAO" ? s : undefined;
  };
  const posicao = (e: any) => {
    const i = GRANULARIDADE.indexOf(String(e?.DataAgregationLevel ?? "").trim().toUpperCase());
    return i === -1 ? GRANULARIDADE.length : i;
  };

  // Mais fino primeiro; dentro do mesmo nivel, a ordem da resposta decide.
  const ordenadas = [...entradas].sort((a, b) => posicao(a) - posicao(b));

  // Campo a campo: a entrada mais granular que tiver aquele campo preenchido.
  // O IBGE traz setor censitario mas nem sempre classe social; o MTE e o
  // contrario. Pegar a primeira entrada inteira jogaria fora metade do dado.
  const primeiro = (campo: string) => {
    for (const e of ordenadas) {
      const v = limpar(e?.[campo]);
      if (v) return v;
    }
    return undefined;
  };

  return {
    classeSocial: primeiro("SocialClass"),
    faixaRenda: primeiro("EstimatedIncomeRange"),
    escolaridade: primeiro("EstimatedInstructionLevel"),
    origem: ordenadas[0]?.DataAgregationLevel === "CENSUS SECTOR" ? "setor censitário"
      : ordenadas[0]?.DataAgregationLevel === "CITY" ? "município" : undefined,
  };
}

/**
 * Junta os blocos de bureau parceiro numa leitura so. Cada dataset responde num
 * envelope proprio; a tela nao deve saber o nome de nenhum deles.
 */
function normalizarMercado(R: any): Mercado {
  const quantum = R?.QuantumCustomScorePersonData ?? R?.QuantumScorePersonData;
  // Os dois datasets Quod (flags e detalhes) compartilham o mesmo envelope; o
  // de detalhes e superconjunto do de flags. Ler um so cobre os dois casos.
  const quod = R?.QUODCreditRiskPerson;
  const b2e = R?.B2eScoreData;
  const birô = Array.isArray(R?.PersonCreditData) ? R.PersonCreditData[0] : undefined;

  const linhaB2e = Array.isArray(b2e?.ScoreResults) ? b2e.ScoreResults[0] : undefined;

  // Data zero do .NET ("0001-01-01") significa "nunca aconteceu", nao uma data.
  const dataReal = (v: any) => {
    const s = String(v ?? "");
    return s && !s.startsWith("0001-01-01") ? s : undefined;
  };

  const negativacoes: Negativacao[] = (Array.isArray(birô?.Occurrences) ? birô.Occurrences : [])
    .map((o: any): Negativacao => ({
      credor: String(o?.Name ?? "").trim() || "Credor não identificado",
      valor: numeroBr(o?.TotalValue) ?? 0,
      ocorrencias: Number(o?.TotalCount ?? 0) || 0,
      primeira: dataReal(o?.FirstOccurrenceDate),
      ultima: dataReal(o?.LastOccurrenceDate),
    }))
    .sort((a: Negativacao, b: Negativacao) => b.valor - a.valor);

  const quemConsultou: ConsultaAnterior[] = (Array.isArray(birô?.PreviousQueries) ? birô.PreviousQueries : [])
    .map((c: any): ConsultaAnterior => ({
      empresa: String(c?.Name ?? "").trim() || "Empresa não identificada",
      data: dataReal(c?.QueryDate),
      cidadeUf: String(c?.CityAndState ?? "").trim() || undefined,
    }));

  const segmentos = quod?.TotalInquiriesBySegment;

  return {
    // O birô traz o score com explicacao; o Quantum traz so o numero. Quando os
    // dois estao ligados, o do birô vence por vir acompanhado da leitura.
    score: numeroBr(birô?.Score?.Score) ?? numeroBr(quantum?.Score),
    scoreExplicacao: birô?.Score?.Class || undefined,
    scoreProbabilidade: birô?.Score?.Probability || undefined,

    negativado: typeof quod?.HasNegativeIndicator === "boolean" ? quod.HasNegativeIndicator : undefined,
    temRegistroMinimo: typeof quod?.HasMinRegister === "boolean" ? quod.HasMinRegister : undefined,
    consultouCredito: typeof quod?.HasInquiryIndicator === "boolean" ? quod.HasInquiryIndicator : undefined,

    dividaTotal: numeroBr(quod?.TotalIndebtednessValue) ?? numeroBr(birô?.TotalDebts),
    negativacoesAtivas: numeroBr(quod?.TotalActiveNegativeAppointments),
    negativacoesInativas: numeroBr(quod?.TotalInactiveNegativeAppointments),
    protestos: numeroBr(quod?.TotalRegisteredProtests),
    apontamentosJudiciais: numeroBr(quod?.TotalLawsuitsAppointments),
    ultimaNegativacao: dataReal(quod?.LastNegativeAppointmentDate),
    negativacoes,

    consultas30d: numeroBr(quod?.TotalInquiriesLast30Days),
    consultas60d: numeroBr(quod?.TotalInquiriesLast60Days),
    consultas90d: numeroBr(quod?.TotalInquiriesLast90Days),
    consultasPorSegmento: segmentos && typeof segmentos === "object" ? segmentos : undefined,
    quemConsultou,

    classeCadastral: linhaB2e?.RiskClass || undefined,
    classeCadastralDescricao: linhaB2e?.Description || undefined,
  };
}

/**
 * `basic_data` devolve -1200 para CPF inexistente em vez de "nao encontrado".
 * Os outros dois datasets no mesmo CPF respondem Code 0 com contadores zerados.
 * Se esse erro vazar para a tela, o operador conclui que o sistema quebrou.
 */
function cpfNaoEncontrado(status: any, basic: any): boolean {
  const code = status?.basic_data?.[0]?.Code;
  const temNome = !!basic?.Name;
  return code !== 0 && !temNome;
}

/**
 * As cinco fontes de renda nao valem o mesmo.
 * MTE vem de registro do Ministerio do Trabalho — e vinculo formal, nao
 * estimativa estatistica. Quando existe, e o numero mais confiavel dos cinco.
 */
export interface FonteRenda { fonte: string; faixa: string; emReais: string | null; formal: boolean }

export interface DeclaracaoIR {
  ano: string; status?: string; banco?: string; agencia?: string; segmentoVip: boolean;
}

export interface RendaDetalhada {
  faixa?: string;
  emReais: string | null;
  patrimonio?: string;
  fontes: FonteRenda[];
  /** Renda de vinculo formal (MTE), quando existir. */
  rendaFormal: FonteRenda | null;
  declaracoesIR: DeclaracaoIR[];
  /** Declara IR de forma recorrente — sinal de renda estavel e rastreavel. */
  declaraIrRecorrente: boolean;
  temSegmentoVip: boolean;
}

/** Score de risco da propria BigData, com o porque. */
export interface RiscoFinanceiro {
  score?: number;            // 0-1000, maior e melhor
  nivel?: string;            // A (melhor) a H (pior)
  empregado?: boolean;
  socio?: boolean;
  recebendoAuxilio?: boolean;
  inicioUltimaOcupacao?: string;
}

/** Rastro do CPF no mercado. Consulta recente demais e sinal de quem esta rodando. */
export interface Rastro {
  consultas30d: number;
  consultas365d: number;
  passagensRuins: number;
  primeiraPassagem?: string;
  ultimaPassagem?: string;
  /** Comportamento financeiro digital: A e altissima intensidade, H e nenhuma. */
  buscaCredito?: string;
  usoCartao?: string;
  usoBancoDigital?: string;
  /** Mudancas de nome e de status na Receita ao longo da vida do CPF. */
  mudancasNome: number;
  mudancasStatus: number;
}

/** Area do endereco: 1 e comunidade setorizada, 3 e sem comunidade delimitada. */
export interface RiscoArea {
  endereco: string;
  ponto?: number;
  raio100m?: number;
}

/**
 * Validacao viva do telefone principal. Diferente do `phones_extended`, que e
 * historico batido, isto e a operadora AGORA (pos-portabilidade) e se a linha
 * esta bloqueada — um candidato cujo telefone principal nao recebe chamada e
 * um cadastro que nao cobra.
 */
export interface ValidacaoTelefone {
  /** Numero validado, com DDD — para a tela casar com a linha certa da lista. */
  numero: string;
  /** FIXED_LINE, MOBILE, VOIP... */
  tipo?: string;
  operadoraAtual?: string;
  bloqueado?: boolean;
  cidade?: string;
}

/**
 * Qualificacao do imovel no endereco de instalacao. Nao entra no veredito de
 * credito: serve para dimensionar a visita tecnica (casa terrea vs predio) e
 * conferir se o endereco informado existe como imovel.
 */
export interface Imovel {
  endereco: string;
  /** APARTAMENTO, CASA... */
  tipologia?: string;
  /** RESIDENCIAL ou COMERCIAL. */
  uso?: string;
  areaM2?: number;
  comodos?: number;
  /** O CEP+numero bateu exatamente com um imovel conhecido. */
  correspondenciaExata?: boolean;
}

/** Envelope TelesignPhoneIDData -> ValidacaoTelefone. Exportado para teste. */
export function normalizarTelefoneValidado(env: any, numero: string): ValidacaoTelefone | null {
  if (!env || typeof env !== "object") return null;
  const bloq = String(env.Blocked ?? "").trim().toLowerCase();
  return {
    numero,
    tipo: env.PhoneType || undefined,
    operadoraAtual: env.Carrier || undefined,
    bloqueado: bloq ? bloq !== "not blocked" : undefined,
    cidade: env.Location?.City || undefined,
  };
}

/** Envelope RedeVistoriasData -> Imovel. Exportado para teste. */
export function normalizarImovel(env: any, endereco: string): Imovel | null {
  if (!env || typeof env !== "object") return null;
  return {
    endereco,
    tipologia: env.Tipology || undefined,
    uso: env.ResidenceType || undefined,
    areaM2: numeroBr(env.PropertyAreaInM2),
    comodos: numeroBr(env.TotalRooms),
    correspondenciaExata: typeof env.IsExactMatch === "boolean" ? env.IsExactMatch : undefined,
  };
}

export interface Patrimonio {
  veiculos: number;
  recebeAuxilio: boolean;
  auxiliosAtivos: number;
  valorAuxilio: number;
}

export interface Inadimplencia {
  emCobrancaAgora: boolean;
  cobrancas365d: number;
  credores365d: number;
  mesesConsecutivos: number;
  ultimaCobranca?: string;
  processosTotal: number;
  processosComoReu: number;
  processos365d: number;
  temExecucao: boolean;
  naturezas: string[];
  dividaAtiva: number;
}

export interface Identidade {
  nome?: string; nascimento?: string; idade?: number;
  nomeMae?: string; nomePai?: string; genero?: string;
  situacaoReceita?: string; dataSituacao?: string;
}

/**
 * Estabilidade do vinculo de trabalho. `financial_risk` ja diz se a pessoa esta
 * empregada HOJE; isso nao responde se ela continuara empregada durante os 12
 * meses do contrato. Quem troca de emprego a cada seis meses e um risco
 * diferente de quem esta no mesmo lugar ha oito anos, com a mesma renda.
 */
export interface Ocupacao {
  empregadoAgora?: boolean;
  empreendedor?: boolean;
  /** Total de trocas de vinculo na vida e nas janelas recentes. */
  trocasTotal: number;
  trocas5Anos: number;
  trocas10Anos: number;
  /** Media de anos entre uma troca e outra. Abaixo de 1 e rotatividade alta. */
  mediaAnosPorVinculo?: number;
  idadePrimeiroEmprego?: number;
  primeiroVinculo?: string;
  setorPublico?: boolean;
  setorPrivado?: boolean;
  /** Quantidade de empregadores identificados — o nome deles nao sai do servidor. */
  totalEmpregadores: number;
}

/**
 * Perfil socio-demografico estimado pela regiao. E aproximacao estatistica,
 * nao declaracao do titular — serve para calibrar QUAL plano oferecer, nunca
 * para recusar. Recusar por classe social e discriminacao.
 */
export interface Perfil {
  classeSocial?: string;
  faixaRenda?: string;
  escolaridade?: string;
  /** Granularidade da estimativa: setor censitario diz muito mais que municipio. */
  origem?: string;
}

/**
 * Sinais de bureau de mercado. Todos vem de datasets de marketplace: quando o
 * provedor nao habilitou no BDC Center, tudo fica undefined e a tela some com
 * o bloco — nao e erro, e upgrade disponivel.
 */
export interface Negativacao {
  /** Nome do credor. So o birô devolve; o Quod entrega apenas contagens. */
  credor: string;
  valor: number;
  ocorrencias: number;
  primeira?: string;
  ultima?: string;
}

/**
 * Empresa que consultou este CPF antes de nos. Para um bureau colaborativo de
 * provedores e o dado mais revelador que existe: se tres provedores da mesma
 * cidade consultaram nos ultimos 30 dias, o candidato esta rodando o mercado.
 */
export interface ConsultaAnterior {
  empresa: string;
  data?: string;
  cidadeUf?: string;
}

export interface Mercado {
  /** Score 0-999 de probabilidade de inadimplencia. Maior e melhor. */
  score?: number;
  /**
   * A mesma leitura em portugues, como o bureau escreve: "E provavel que 91%
   * das pessoas com esse mesmo comportamento paguem suas contas nos proximos 6
   * meses". Vale mais que o numero para quem esta no balcao.
   */
  scoreExplicacao?: string;
  /** Probabilidade de inadimplencia declarada pelo bureau, ex "9,00%". */
  scoreProbabilidade?: string;

  /** Indicio de negativacao no mercado. A pergunta que o SPC responderia. */
  negativado?: boolean;
  /** Tem cadastro minimo nos bureaus — quem nao tem, nao tem historico algum. */
  temRegistroMinimo?: boolean;
  /** Houve consulta de credito recente por outra empresa. */
  consultouCredito?: boolean;

  // ── Detalhe da negativacao ────────────────────────────────────────────────
  /** Soma devida em reais. */
  dividaTotal?: number;
  negativacoesAtivas?: number;
  /** Quitadas: contam historico, nao impedimento. */
  negativacoesInativas?: number;
  protestos?: number;
  apontamentosJudiciais?: number;
  ultimaNegativacao?: string;
  /** Detalhado por credor — so vem do birô. */
  negativacoes: Negativacao[];

  // ── Rastro de consulta no mercado ─────────────────────────────────────────
  consultas30d?: number;
  consultas60d?: number;
  consultas90d?: number;
  /** Consultas agrupadas por ramo, ex { "Serviços": 23 }. */
  consultasPorSegmento?: Record<string, number>;
  /** Quem consultou, com nome — so vem do birô. */
  quemConsultou: ConsultaAnterior[];

  /** Classe A-D de coerencia da ficha preenchida (B2E). */
  classeCadastral?: string;
  /** Rotulo legivel da classe cadastral. */
  classeCadastralDescricao?: string;
}

export interface ResultadoConsulta {
  dados: DadosCadastrais;
  identidade: Identidade;
  enderecos: EnderecoDetalhado[];
  telefones: TelefoneDetalhado[];
  emails: string[];
  renda: RendaDetalhada;
  risco: RiscoFinanceiro;
  inadimplencia: Inadimplencia;
  rastro: Rastro;
  patrimonio: Patrimonio;
  ocupacao: Ocupacao;
  perfil: Perfil;
  /** Vazio quando os datasets de bureau nao estao habilitados na conta. */
  mercado: Mercado;
  /** Preenchido em chamada separada a /enderecos; vazio quando falha. */
  riscoArea: RiscoArea[];
  /** Sondas da Completa. null quando o nivel nao as inclui ou o bureau falhou. */
  validacaoTelefone: ValidacaoTelefone | null;
  imovel: Imovel | null;
  /** Tabela de processos individuais, modelo relatorio de bureau. */
  processos: ProcessoDetalhe[];
  /** Datasets bloqueados na conta — nao sao falha, sao upgrade disponivel. */
  datasetsIndisponiveis: string[];
  /** Payload cru da BigData, para gravar e auditar. */
  bruto: any;
  datasetsChamados: string[];
  /** Nivel efetivamente consultado — vai para o historico e para a tela. */
  nivel: NivelConsulta;
  /** Datasets que voltaram com Code != 0 — falha parcial nao invalida o resto. */
  datasetsComFalha: string[];
  latenciaMs: number;
}

export async function consultarCpf(
  providerId: number, cred: Credencial, cpf: string,
  nivel: NivelConsulta = NIVEL_PADRAO,
): Promise<ResultadoConsulta> {
  const t0 = Date.now();
  const datasets = NIVEIS[nivel].datasets;
  // Dataset de parceiro NAO responde no /pessoas: la ele devolve -109 mesmo
  // habilitado na conta (verificado em 2026-08-26 — a API de Precos confirmava
  // os 14 partners ativos enquanto o /pessoas recusava todos). O endpoint dos
  // parceiros e /marketplace, entao a consulta Completa faz DUAS chamadas em
  // paralelo e funde as respostas, que tem o mesmo formato.
  const nativos = datasets.filter(ds => !ds.startsWith("partner_"));
  const parceiros = datasets.filter(ds => ds.startsWith("partner_"));

  let headersUsados: Record<string, string> = {};

  const executar = async () => {
    const { token, tokenId } = await obterToken(providerId, cred);
    headersUsados = {
      "Content-Type": "application/json", accept: "application/json",
      AccessToken: token, TokenId: tokenId,
    };
    const corpo = (lista: string[]) => ({
      method: "POST" as const,
      headers: headersUsados,
      body: JSON.stringify({ Datasets: lista.join(","), q: `doc{${cpf}}`, Limit: 1 }),
    });

    // A falha do /marketplace NAO pode derrubar nem re-executar o /pessoas:
    // um retry do par re-cobraria os datasets nativos que ja rodaram. Por isso
    // o marketplace vira null em erro e entra como falha parcial no Status.
    const [rp, dm] = await Promise.all([
      fetch(`${BASE_URL}/pessoas`, corpo(nativos)),
      parceiros.length === 0
        ? Promise.resolve(null)
        : fetch(`${BASE_URL}/marketplace`, corpo(parceiros))
            .then(r => r.json() as Promise<any>)
            .catch(() => null),
    ]);
    const d: any = await rp.json().catch(() => ({}));

    // -111 e token invalido: pode ser rotacao no painel. Limpa o cache para a
    // proxima tentativa gerar um novo em vez de insistir no morto.
    const codigoLogin = d?.Status?.login?.[0]?.Code;
    if (codigoLogin === -111) {
      invalidarToken(providerId);
      throw new BigDataError("Credencial recusada", -111);
    }

    if (parceiros.length > 0) {
      if (dm?.Result || dm?.Status) {
        // Funde envelopes e status — a tela e o parser leem um payload so.
        d.Result = [{ ...(d?.Result?.[0] ?? {}), ...(dm.Result?.[0] ?? {}) }];
        d.Status = { ...(d?.Status ?? {}), ...(dm.Status ?? {}) };
      } else {
        // Sem resposta do marketplace: registra cada parceiro como falha para
        // o estorno e o aviso da tela enxergarem o que nao veio.
        d.Status = d.Status ?? {};
        for (const p of parceiros) {
          d.Status[p] = d.Status[p] ?? [{ Code: -1, Message: "MARKETPLACE SEM RESPOSTA" }];
        }
      }
    }
    return d;
  };

  const d = await withResilience(executar, { retries: 1, circuit: circuitoDe(providerId) });

  const R = d?.Result?.[0] ?? {};
  const basic = R.BasicData ?? {};
  const fin = R.FinantialData ?? {};
  const enderecos = normalizarEnderecos(R.ExtendedAddresses);
  const telefones = normalizarTelefones(R.ExtendedPhones);
  const emails: string[] = (Array.isArray(R.ExtendedEmails?.Emails) ? R.ExtendedEmails.Emails : [])
    .map((e: any) => e?.EmailAddress).filter(Boolean);

  // -109 e "nao habilitado na conta", nao falha. Misturar os dois faria a tela
  // acusar erro onde ha apenas um upgrade disponivel.
  const status = Object.entries(d?.Status ?? {}) as Array<[string, any]>;
  const datasetsIndisponiveis = status
    .filter(([, arr]) => arr?.[0]?.Code === -109).map(([nome]) => nome);
  const datasetsComFalha = status
    .filter(([, arr]) => arr?.[0]?.Code !== 0 && arr?.[0]?.Code !== -109)
    .map(([nome]) => nome);

  const encontrado = !cpfNaoEncontrado(d?.Status, basic);
  const faixa = fin?.IncomeEstimates?.BIGDATA_V2 ?? fin?.IncomeEstimates?.BIGDATA;
  const risco = R.FinancialRisk ?? {};
  const dfb = R.DigitalFinanceBehaviors ?? {};
  const pas = R.Passages ?? {};
  const hist = R.HistoricalBasicData ?? {};
  const aux = R.ExtendedSocialAssistancePrograms ?? {};
  const veic = R.Vehicles ?? {};
  const ocupacao = normalizarOcupacao(R.ProfessionalTurnover);
  const perfil = normalizarPerfil(R.DemographicData);
  const mercado = normalizarMercado(R);

  const rastro: Rastro = {
    consultas30d: Number(pas?.Last30DaysTotalPassages ?? 0) || 0,
    consultas365d: Number(pas?.Last365DaysTotalPassages ?? 0) || 0,
    passagensRuins: Number(pas?.BadPassages ?? 0) || 0,
    primeiraPassagem: pas?.FirstPassageDate || undefined,
    ultimaPassagem: pas?.LastPassageDate || undefined,
    buscaCredito: dfb?.CreditSeeker,
    usoCartao: dfb?.CreditCardScore,
    usoBancoDigital: dfb?.OnlineBankingUser,
    mudancasNome: Number(hist?.NameChangesTotal ?? 0) || 0,
    mudancasStatus: Number(hist?.StatusChangesTotal ?? 0) || 0,
  };

  const patrimonio: Patrimonio = {
    veiculos: Array.isArray(veic?.Vehicles) ? veic.Vehicles.length : 0,
    recebeAuxilio: !!aux?.IsReceivingAssistance,
    auxiliosAtivos: Number(aux?.TotalActiveAssistances ?? 0) || 0,
    valorAuxilio: Number(aux?.TotalIncome ?? 0) || 0,
  };
  const inad = normalizarInadimplencia(R.Collections, R.Processes, R.GovernmentDebtors);

  // O veredito le a forma reduzida; a tela le a completa. Manter as duas
  // separadas evita que mudar a tela mexa sem querer na regra de decisao.
  const dados: DadosCadastrais = {
    encontrado,
    taxIdStatus: basic.TaxIdStatus,
    temObito: !!basic.HasObitIndication,
    nascimentoValidadoNaReceita: basic.IsValidBirthDateInRFSource,
    homonimos: Number(basic.NumberOfFullNameNamesakes ?? 0) || 0,
    enderecos: enderecos.map<EnderecoCadastral>(e => ({
      ratificado: e.ratificado, ativo: e.ativo, ultimaPassagem: e.ultimaPassagem,
    })),
    badAddressPassages: Number(R.ExtendedAddresses?.TotalBadAddressPassages ?? 0) || 0,
    faixaRenda: faixa,
    emCobrancaAgora: inad.emCobrancaAgora,
    cobrancas365d: inad.cobrancas365d,
    credoresDistintos365d: inad.credores365d,
    processosComoReu: inad.processosComoReu,
    processos365d: inad.processos365d,
    temExecucao: inad.temExecucao,
    dividaAtiva: inad.dividaAtiva,
    buscaCredito: dfb?.CreditSeeker,
    mudancasNome: rastro.mudancasNome,
    consultas30d: rastro.consultas30d,
    // Sinais novos. Os de mercado ficam undefined enquanto o provedor nao
    // habilitar os datasets de bureau — e undefined nao gera motivo nenhum.
    negativadoNoMercado: mercado.negativado,
    scoreMercado: mercado.score,
    dividaMercado: mercado.dividaTotal,
    negativacoesAtivas: mercado.negativacoesAtivas,
    protestos: mercado.protestos,
    // Consultas de credito no mercado inteiro. Diferente de `consultas30d`, que
    // conta passagem na web — esta e consulta de bureau feita por credor.
    consultasCredito30d: mercado.consultas30d,
    trocasEmprego5Anos: ocupacao.trocas5Anos,
    mediaAnosPorVinculo: ocupacao.mediaAnosPorVinculo,
  };

  return {
    dados,
    identidade: {
      nome: basic.Name, nascimento: basic.BirthDate, idade: basic.Age,
      nomeMae: basic.MotherName, nomePai: basic.FatherName, genero: basic.Gender,
      situacaoReceita: basic.TaxIdStatus, dataSituacao: basic.TaxIdStatusDate,
    },
    enderecos, telefones, emails,
    renda: normalizarRenda(fin),
    risco: {
      score: typeof risco?.FinancialRiskScore === "number" ? risco.FinancialRiskScore : undefined,
      nivel: risco?.FinancialRiskLevel,
      empregado: typeof risco?.IsCurrentlyEmployed === "boolean" ? risco.IsCurrentlyEmployed : undefined,
      socio: typeof risco?.IsCurrentlyOwner === "boolean" ? risco.IsCurrentlyOwner : undefined,
      recebendoAuxilio: typeof risco?.IsCurrentlyReceivingAssistance === "boolean" ? risco.IsCurrentlyReceivingAssistance : undefined,
      inicioUltimaOcupacao: risco?.LastOccupationStartDate || undefined,
    },
    inadimplencia: inad,
    processos: normalizarProcessosDetalhe(R.Processes, cpf),
    rastro,
    patrimonio,
    ocupacao,
    perfil,
    mercado,
    // As tres sondas por entidade em paralelo: dependem dos enderecos e
    // telefones da resposta principal, mas nao umas das outras.
    ...(await (async () => {
      const [riscoArea, validacaoTelefone, imovel] = await Promise.all([
        consultarRiscoArea(headersUsados, enderecos),
        NIVEIS[nivel].sondas ? validarTelefonePrincipal(headersUsados, telefones) : null,
        NIVEIS[nivel].sondas ? qualificarImovelPrincipal(headersUsados, enderecos) : null,
      ]);
      return { riscoArea, validacaoTelefone, imovel };
    })()),
    datasetsIndisponiveis,
    bruto: d,
    datasetsChamados: [...datasets],
    nivel,
    datasetsComFalha,
    latenciaMs: Date.now() - t0,
  };
}
