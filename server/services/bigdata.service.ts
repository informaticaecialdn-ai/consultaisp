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
import type { DadosCadastrais, EnderecoCadastral } from "./bigdata-veredito";

const BASE_URL = process.env.BIGDATA_BASE_URL || "https://plataforma.bigdatacorp.com.br";

/** Os tres datasets cabem numa requisicao — medido em 516ms para CPF existente. */
export const DATASETS = ["basic_data", "addresses_extended", "financial_data"] as const;

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

function normalizarEnderecos(bloco: any): { enderecos: EnderecoCadastral[]; bad: number } {
  const lista: any[] = Array.isArray(bloco?.Addresses) ? bloco.Addresses : [];
  return {
    enderecos: lista.map(a => ({
      ratificado: !!a?.IsRatified,
      ativo: !!a?.IsActive,
      ultimaPassagem: a?.EntityLastPassageDate ?? null,
    })),
    bad: Number(bloco?.TotalBadAddressPassages ?? 0) || 0,
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

export interface ResultadoConsulta {
  dados: DadosCadastrais;
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
  const { enderecos, bad } = normalizarEnderecos(R.ExtendedAddresses);

  const datasetsComFalha = Object.entries(d?.Status ?? {})
    .filter(([, arr]: any) => arr?.[0]?.Code !== 0)
    .map(([nome]) => nome);

  const encontrado = !cpfNaoEncontrado(d?.Status, basic);

  const dados: DadosCadastrais = {
    encontrado,
    taxIdStatus: basic.TaxIdStatus,
    temObito: !!basic.HasObitIndication,
    nascimentoValidadoNaReceita: basic.IsValidBirthDateInRFSource,
    homonimos: Number(basic.NumberOfFullNameNamesakes ?? 0) || 0,
    enderecos,
    badAddressPassages: bad,
    faixaRenda: fin?.IncomeEstimates?.BIGDATA_V2 ?? fin?.IncomeEstimates?.BIGDATA,
  };

  return {
    dados, bruto: d,
    datasetsChamados: [...DATASETS],
    datasetsComFalha,
    latenciaMs: Date.now() - t0,
  };
}
