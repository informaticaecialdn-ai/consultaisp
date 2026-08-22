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

/** Os tres datasets cabem numa requisicao — medido em 516ms para CPF existente. */
export const DATASETS = [
  "basic_data", "addresses_extended", "phones_extended",
  "emails_extended", "financial_data",
] as const;

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
    throw new BigDataError(d?.message || "Não foi possível autenticar na BigDataCorp");
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

/** Rotulo legivel de cada fonte de renda, e se ela vem de registro formal. */
const FONTES_RENDA: Record<string, { rotulo: string; formal: boolean }> = {
  MTE: { rotulo: "Vínculo formal (MTE)", formal: true },
  "COMPANY OWNERSHIP": { rotulo: "Participação societária", formal: true },
  BIGDATA_V2: { rotulo: "Estimativa BigData v2", formal: false },
  BIGDATA: { rotulo: "Estimativa BigData", formal: false },
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

export interface Identidade {
  nome?: string; nascimento?: string; idade?: number;
  nomeMae?: string; nomePai?: string; genero?: string;
  situacaoReceita?: string; dataSituacao?: string;
}

export interface ResultadoConsulta {
  dados: DadosCadastrais;
  identidade: Identidade;
  enderecos: EnderecoDetalhado[];
  telefones: TelefoneDetalhado[];
  emails: string[];
  renda: RendaDetalhada;
  /** Payload cru da BigData, para gravar e auditar. */
  bruto: any;
  datasetsChamados: string[];
  /** Datasets que voltaram com Code != 0 — falha parcial nao invalida o resto. */
  datasetsComFalha: string[];
  latenciaMs: number;
}

export async function consultarCpf(
  providerId: number, cred: Credencial, cpf: string,
): Promise<ResultadoConsulta> {
  const t0 = Date.now();

  const executar = async () => {
    const { token, tokenId } = await obterToken(providerId, cred);
    const r = await fetch(`${BASE_URL}/pessoas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", accept: "application/json",
        AccessToken: token, TokenId: tokenId,
      },
      body: JSON.stringify({ Datasets: DATASETS.join(","), q: `doc{${cpf}}`, Limit: 1 }),
    });
    const d: any = await r.json().catch(() => ({}));

    // -111 e token invalido: pode ser rotacao no painel. Limpa o cache para a
    // proxima tentativa gerar um novo em vez de insistir no morto.
    const codigoLogin = d?.Status?.login?.[0]?.Code;
    if (codigoLogin === -111) {
      invalidarToken(providerId);
      throw new BigDataError("Credencial da BigDataCorp recusada", -111);
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

  const datasetsComFalha = Object.entries(d?.Status ?? {})
    .filter(([, arr]: any) => arr?.[0]?.Code !== 0)
    .map(([nome]) => nome);

  const encontrado = !cpfNaoEncontrado(d?.Status, basic);
  const faixa = fin?.IncomeEstimates?.BIGDATA_V2 ?? fin?.IncomeEstimates?.BIGDATA;

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
    bruto: d,
    datasetsChamados: [...DATASETS],
    datasetsComFalha,
    latenciaMs: Date.now() - t0,
  };
}
