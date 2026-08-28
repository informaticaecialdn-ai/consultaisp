/**
 * BigDataCorp — Consulta Cadastral de CNPJ.
 *
 * Endpoint: /empresas. NAO e o mesmo de pessoa: mandar CNPJ para /pessoas
 * devolve -114 INVALID DOC nos 43 datasets, medido em 27/08/2026. A rota antes
 * nem chegava la — barrava no `validarCPF` e respondia "CPF invalido: digitos
 * verificadores incorretos" para quem digitava um CNPJ, mensagem que descrevia
 * o documento errado. Eram 2.087 CNPJs na base sem consulta possivel.
 *
 * O combo de empresa custa MENOS que o de pessoa: R$ 0,39 contra R$ 1,09
 * (precos da conta, medidos em POST /precos em 28/08/2026). Empresa nao tem
 * renda familiar, beneficio social nem domicilio — os blocos caros do lado
 * pessoa fisica simplesmente nao existem aqui. Cobra-se 1 credito nos dois
 * casos: a diferenca de custo vira margem, nao preco diferente na tela.
 */

import { logger } from "../logger";
import { withResilience } from "../erp/resilience";
import type { ResultadoVeredito } from "./bigdata-veredito";
import {
  BASE_URL, obterToken, circuitoDe, BigDataError, invalidarToken,
  normalizarEnderecos, normalizarTelefones, normalizarInadimplencia,
  normalizarProcessosDetalhe,
  type Credencial, type EnderecoDetalhado, type TelefoneDetalhado,
  type Inadimplencia, type ProcessoDetalhe,
} from "./bigdata.service";

/**
 * Datasets de /empresas. `registration_data` (R$ 0,12) ficou de fora pela mesma
 * razao do lado pessoa: nada o consome e o que ele traz ja vem em
 * `addresses_extended` / `phones_extended`, la com IsActive e Priority.
 *
 * Preco DA CONTA por dataset, medido em POST /precos {API:"Companies"}:
 *   collections 0,07 · processes 0,07 · addresses_extended 0,05
 *   phones_extended 0,05 · emails_extended 0,05 · government_debtors 0,05
 *   relationships 0,03 · basic_data 0,02
 *   ------------------------------------------------------------
 *   combo = R$ 0,39
 */
export const DATASETS_EMPRESA = [
  // Identidade, situacao na Receita, idade e CNAE
  "basic_data",
  // Contato
  "addresses_extended", "phones_extended", "emails_extended",
  // Inadimplencia e judicial
  "collections", "processes", "government_debtors",
  // Quadro societario — quem responde pela empresa
  "relationships",
] as const;

/** R$ 0,39 dos 8 datasets. Sem address_risk: empresa nao pede risco de area. */
export const CUSTO_EMPRESA_BRL = 0.39;

export interface SocioEmpresa {
  nome: string;
  /** QSA, LEGAL REPRESENTATIVE... como a Receita classifica. */
  vinculo?: string;
  /** Cargo declarado — "SOCIO ADMINISTRADOR" e afins. */
  cargo?: string;
  desde?: string;
  ate?: string;
  /** false quando a saida ja foi averbada. */
  atual: boolean;
}

export interface DadosEmpresa {
  cnpj: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  /** ATIVA, BAIXADA, SUSPENSA, INAPTA — o primeiro filtro de qualquer decisao. */
  situacao?: string;
  motivoSituacao?: string;
  aberturaEm?: string;
  /**
   * Idade em anos, direto da API. Empresa com 0 ano e o equivalente CNPJ do
   * contrato recente: nao ha historico que sustente comodato de equipamento.
   */
  idadeAnos?: number;
  matriz?: boolean;
  ufMatriz?: string;
  /** ME, EPP, DEMAIS — porte pela Receita. */
  porte?: string;
  /** LTDA, SIMPLES, MEI... */
  regime?: string;
  optanteSimples?: boolean;
  naturezaJuridica?: string;
  /** Situacao especial (recuperacao judicial, falencia). Vazio e o normal. */
  situacaoEspecial?: string;
  atividadePrincipal?: string;
  atividadesSecundarias: string[];
  socios: SocioEmpresa[];
}

export interface ResultadoEmpresa {
  encontrado: boolean;
  empresa: DadosEmpresa;
  enderecos: EnderecoDetalhado[];
  telefones: TelefoneDetalhado[];
  emails: string[];
  inadimplencia: Inadimplencia;
  processos: ProcessoDetalhe[];
  datasetsIndisponiveis: string[];
  datasetsComFalha: string[];
  datasetsChamados: string[];
  bruto: any;
  latenciaMs: number;
}

const txt = (v: any): string | undefined => {
  const t = String(v ?? "").trim();
  return t && !/^SEM INFORMACAO$/i.test(t) ? t : undefined;
};

/**
 * Quadro societario a partir de `Relationships`.
 *
 * A API devolve DUAS listas: `Relationships` (historico completo, com socios
 * que ja sairam) e `CurrentRelationships` (quem responde hoje). Marcar quem e
 * atual importa — cobrar um socio que saiu ha dois anos e erro caro.
 */
function normalizarSocios(rel: any): SocioEmpresa[] {
  // Cuidado com o desembrulho: o BLOCO se chama `Relationships` e o array
  // dentro dele TAMBEM. Um `rel?.Relationships ?? rel` ingenuo desce um nivel
  // demais e entrega o array no lugar do bloco — foi o que fez o quadro
  // societario sair vazio na primeira medicao, com os socios na mao.
  const b = Array.isArray(rel?.Relationships) ? rel : (rel?.Relationships ?? rel ?? {});
  const historico: any[] = Array.isArray(b.Relationships) ? b.Relationships : [];
  const atuais: any[] = Array.isArray(b.CurrentRelationships) ? b.CurrentRelationships : [];

  const chave = (r: any) => `${r?.RelatedEntityName ?? ""}|${r?.RelationshipName ?? ""}`;
  const atuaisSet = new Set(atuais.map(chave));

  const vistos = new Set<string>();
  return [...atuais, ...historico]
    .filter(r => r?.RelatedEntityName)
    .filter(r => { const k = chave(r); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .map(r => ({
      nome: String(r.RelatedEntityName),
      vinculo: txt(r.RelationshipType),
      cargo: txt(r.RelationshipName),
      desde: r.RelationshipStartDate || undefined,
      ate: r.RelationshipEndDate || undefined,
      atual: atuaisSet.has(chave(r)),
    }))
    .slice(0, 20);
}

function normalizarEmpresa(basic: any, rel: any, cnpj: string): DadosEmpresa {
  const b = basic ?? {};
  const atividades: any[] = Array.isArray(b.Activities) ? b.Activities : [];
  const principal = atividades.find(a => a?.IsMain);

  return {
    cnpj,
    razaoSocial: txt(b.OfficialName),
    nomeFantasia: txt(b.TradeName),
    situacao: txt(b.TaxIdStatus),
    motivoSituacao: txt(b.TaxIdStatusReason),
    aberturaEm: b.FoundedDate || undefined,
    idadeAnos: Number.isFinite(Number(b.Age)) ? Number(b.Age) : undefined,
    matriz: typeof b.IsHeadquarter === "boolean" ? b.IsHeadquarter : undefined,
    ufMatriz: txt(b.HeadquarterState),
    porte: txt(b.CompanyType_ReceitaFederal),
    regime: txt(b.TaxRegime),
    optanteSimples: typeof b.TaxRegimes?.Simples === "boolean" ? b.TaxRegimes.Simples : undefined,
    // LegalNature vem como { Code, Activity } — "SOCIEDADE EMPRESARIA LIMITADA"
    // mora em Activity. Passar o objeto direto imprimia "[object Object]".
    naturezaJuridica: txt(b.LegalNature?.Activity ?? b.LegalNature),
    situacaoEspecial: txt(b.SpecialSituation),
    atividadePrincipal: txt(principal?.Activity),
    atividadesSecundarias: atividades
      .filter(a => !a?.IsMain).map(a => txt(a?.Activity)).filter(Boolean).slice(0, 8) as string[],
    socios: normalizarSocios(rel),
  };
}

/**
 * CNPJ nao encontrado na Receita. Mesma logica do lado pessoa: status -114 ou
 * envelope sem razao social significa documento que nao existe, nao falha.
 */
function cnpjNaoEncontrado(status: any, basic: any): boolean {
  const codigos = Object.values(status ?? {})
    .map((v: any) => (Array.isArray(v) ? v[0]?.Code : v?.Code));
  if (codigos.some(c => c === -114)) return true;
  return !basic?.OfficialName && !basic?.TaxIdStatus;
}

export async function consultarCnpj(
  providerId: number, cred: Credencial, cnpj: string,
): Promise<ResultadoEmpresa> {
  const t0 = Date.now();
  const datasets = [...DATASETS_EMPRESA];

  const executar = async () => {
    const { token, tokenId } = await obterToken(providerId, cred);
    const r = await fetch(`${BASE_URL}/empresas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", accept: "application/json",
        AccessToken: token, TokenId: tokenId,
      },
      body: JSON.stringify({ Datasets: datasets.join(","), q: `doc{${cnpj}}`, Limit: 1 }),
    });
    const d: any = await r.json().catch(() => ({}));

    // -111 e token invalido (rotacao no painel): limpa o cache para a proxima
    // tentativa gerar um novo em vez de insistir no morto.
    if (d?.Status?.login?.[0]?.Code === -111) {
      invalidarToken(providerId);
      throw new BigDataError("Credencial recusada", -111);
    }
    return d;
  };

  const d = await withResilience(executar, { retries: 1, circuit: circuitoDe(providerId) });

  const R = d?.Result?.[0] ?? {};
  const basic = R.BasicData ?? {};

  const status = Object.entries(d?.Status ?? {}) as Array<[string, any]>;
  const datasetsIndisponiveis = status
    .filter(([, a]) => a?.[0]?.Code === -109).map(([n]) => n);
  const datasetsComFalha = status
    .filter(([, a]) => a?.[0]?.Code !== 0 && a?.[0]?.Code !== -109).map(([n]) => n);

  const encontrado = !cnpjNaoEncontrado(d?.Status, basic);
  if (!encontrado) {
    logger.info({ providerId, datasetsComFalha }, "consulta cadastral CNPJ sem registro");
  }

  return {
    encontrado,
    empresa: normalizarEmpresa(basic, R.Relationships, cnpj),
    enderecos: normalizarEnderecos(R.ExtendedAddresses),
    telefones: normalizarTelefones(R.ExtendedPhones),
    emails: (Array.isArray(R.ExtendedEmails?.Emails) ? R.ExtendedEmails.Emails : [])
      .map((e: any) => e?.EmailAddress).filter(Boolean),
    // O bloco de processos de empresa se chama Lawsuits, igual ao de pessoa —
    // os dois normalizadores servem sem adaptacao.
    inadimplencia: normalizarInadimplencia(R.Collections, R.Lawsuits, R.GovernmentDebtors),
    processos: normalizarProcessosDetalhe(R.Lawsuits, cnpj),
    datasetsIndisponiveis,
    datasetsComFalha,
    datasetsChamados: datasets,
    bruto: d,
    latenciaMs: Date.now() - t0,
  };
}

/* ── Veredito de empresa ─────────────────────────────────────────────────── */

/**
 * Empresa nao se avalia com as regras de pessoa fisica: nao ha renda familiar,
 * beneficio social nem rotatividade de emprego. O que decide um CNPJ e outra
 * coisa — situacao na Receita, idade, divida ativa e execucao.
 *
 * O corte de idade e o mesmo raciocinio do "contrato recente" do anti-fraude:
 * CNPJ recem-aberto nao tem historico que sustente comodato de equipamento.
 * Na medicao de 28/08/2026, o CNPJ adimplente da carteira tinha `Age` 0 e o
 * inadimplente tinha 5 anos com R$ 7.615 de divida previdenciaria — os dois
 * extremos que estas regras precisam separar.
 */

/** Abaixo disso a empresa nao tem historico. Nao e recusa, e caucao. */
const IDADE_MINIMA_ANOS = 1;

/** Divida ativa da Uniao acima disso alerta. Empresa sempre tem algum residuo. */
const DIVIDA_UNIAO_DEMAIS = 1000;

export function decidirVereditoEmpresa(r: ResultadoEmpresa): ResultadoVeredito {
  if (!r.encontrado) {
    return { veredito: "NAO_ENCONTRADO", motivos: ["CNPJ não encontrado na base da Receita Federal"] };
  }

  const e = r.empresa;
  const inad = r.inadimplencia;
  const motivos: string[] = [];
  let recusar = false;

  // ── Veto: a situacao cadastral e o primeiro filtro ────────────────────────
  const situacao = e.situacao?.trim().toUpperCase();
  if (situacao && situacao !== "ATIVA") {
    recusar = true;
    motivos.push(
      `CNPJ com situação "${e.situacao}" na Receita Federal`
      + (e.motivoSituacao ? ` — ${e.motivoSituacao}` : ""),
    );
  }

  // Recuperacao judicial e falencia vem em SpecialSituation, nao em TaxIdStatus:
  // a empresa segue ATIVA enquanto se recupera.
  if (e.situacaoEspecial) {
    recusar = true;
    motivos.push(`Situação especial: ${e.situacaoEspecial}`);
  }

  // ── Alertas ───────────────────────────────────────────────────────────────
  if (e.idadeAnos != null && e.idadeAnos < IDADE_MINIMA_ANOS) {
    motivos.push(
      e.idadeAnos === 0
        ? "CNPJ aberto há menos de um ano — sem histórico para comodato"
        : `CNPJ com ${e.idadeAnos} ano de atividade — histórico curto`,
    );
  }

  if (inad.emCobrancaAgora) {
    motivos.push(
      "Em cobrança agora"
      + (inad.credores365d > 1 ? ` — ${inad.credores365d} credores diferentes` : ""),
    );
  } else if (inad.cobrancas365d > 0) {
    motivos.push(`${inad.cobrancas365d} cobrança(s) nos últimos 12 meses`);
  }

  if (inad.temExecucao) {
    motivos.push("Execução judicial de dívida no histórico");
  } else if (inad.processosComoReu > 0) {
    motivos.push(`${inad.processosComoReu} processo(s) como réu`);
  }

  if (inad.dividaAtiva > DIVIDA_UNIAO_DEMAIS) {
    motivos.push(
      `Dívida ativa da União: R$ ${inad.dividaAtiva.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    );
  }

  // Quadro societario vazio nao e defeito da empresa, e ausencia de dado — mas
  // vale dizer, porque sem socio nao ha a quem cobrar alem da pessoa juridica.
  if (e.socios.filter(s => s.atual).length === 0) {
    motivos.push("Quadro societário não disponível");
  }

  if (recusar) return { veredito: "RECUSAR", motivos };
  if (motivos.length > 0) return { veredito: "ATENCAO", motivos };
  return {
    veredito: "APROVAR",
    motivos: [
      `CNPJ ativo há ${e.idadeAnos ?? "?"} ano(s), sem cobrança, execução ou dívida ativa`,
    ],
  };
}
