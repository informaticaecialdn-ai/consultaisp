/**
 * As buscas do cadastro em etapas.
 *
 * Este e o UNICO lugar do sistema onde uma consulta paga sai por uma rota
 * publica, sem sessao. A decisao e deliberada: o cadastro vira a primeira
 * demonstracao do produto — a pessoa ve a consulta funcionando antes de pagar.
 * Mas isso significa que um formulario aberto na internet gasta dinheiro, e o
 * custo e por TENTATIVA:
 *
 *   CNPJ na BigDataCorp .... R$ 0,39   (preco da conta, /empresas)
 *   CPF  na BigDataCorp .... R$ 1,09   (preco da conta, /pessoas)
 *
 * R$ 1,48 por cadastro completo. Dez mil requisicoes abusivas seriam R$ 14.800.
 * Entao a economia da rota e: TUDO que for de graca acontece antes, e o que
 * custa so roda depois que o barato ja aprovou.
 *
 *   1. digito verificador          — de graca, derruba lixo
 *   2. CNPJ ja cadastrado?         — banco, derruba quem ja e cliente
 *   3. Receita via BrasilAPI       — de graca, derruba CNPJ inexistente
 *   4. BigDataCorp                 — so aqui gasta
 *
 * O passe da etapa 1 amarra a etapa 2: nao da para bater na busca de CPF em
 * laco sem antes ter resolvido um CNPJ de verdade.
 *
 * ── DE QUEM E A CONTA ──────────────────────────────────────────────────────
 * As credenciais da BigDataCorp sao POR PROVEDOR. No cadastro ainda nao existe
 * provedor, entao a consulta roda na conta da PLATAFORMA, lida do ambiente.
 * Sem ela, as buscas pagas ficam desligadas e o formulario cai no preenchimento
 * manual — o cadastro continua funcionando, so perde o preenchimento
 * automatico. Nunca usar a credencial de um provedor aqui: faria um cliente
 * pagar o onboarding dos concorrentes dele.
 */
import crypto from "crypto";
import { logger } from "../logger";
import { validarCPF, validarCNPJ } from "../utils/cpf-cnpj-validator";
import { consultarCpf, type Credencial } from "./bigdata.service";
import { consultarCnpj } from "./bigdata-empresa";
import { storage } from "../storage";

/**
 * Id sentinela da conta da casa. Nao existe provedor 0; serve para o cache de
 * token e o disjuntor da BigDataCorp ficarem SEPARADOS dos provedores reais —
 * um problema no onboarding nao derruba a consulta de quem esta pagando.
 */
const PROVEDOR_PLATAFORMA = 0;

const VALIDADE_PASSE_MS = 30 * 60_000;

export function credencialDaPlataforma(): Credencial | null {
  const login = process.env.BIGDATA_PLATAFORMA_LOGIN;
  const password = process.env.BIGDATA_PLATAFORMA_SENHA;
  return login && password ? { login, password } : null;
}

/** As buscas pagas estao ligadas? A tela pergunta para saber se pede na mao. */
export function buscaAutomaticaDisponivel(): boolean {
  return credencialDaPlataforma() !== null;
}

// ── Passe da etapa 1 ────────────────────────────────────────────────────────

function segredo(): string {
  // O mesmo segredo da sessao: se ele existe, o processo esta configurado.
  return process.env.SESSION_SECRET || "";
}

function assinar(conteudo: string): string {
  return crypto.createHmac("sha256", segredo()).update(conteudo).digest("base64url");
}

/**
 * Prova de que a etapa 1 foi cumprida para ESTE CNPJ.
 *
 * Sem isso, a rota de CPF seria um consultor de bureau aberto na internet:
 * bastaria bater nela em laco. Com isso, cada consulta de CPF custa antes uma
 * de CNPJ que passou por tres filtros gratuitos.
 */
export function emitirPasse(cnpj: string): string {
  const expira = Date.now() + VALIDADE_PASSE_MS;
  const corpo = `${cnpj}.${expira}`;
  return `${corpo}.${assinar(corpo)}`;
}

export function conferirPasse(passe: string | undefined): { ok: true; cnpj: string } | { ok: false } {
  if (!passe || !segredo()) return { ok: false };
  const partes = passe.split(".");
  if (partes.length !== 3) return { ok: false };

  const [cnpj, expiraTexto, assinatura] = partes;
  const esperada = assinar(`${cnpj}.${expiraTexto}`);
  // Comparacao de tempo constante: comparar com === vaza o prefixo correto.
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  if (Number(expiraTexto) < Date.now()) return { ok: false };
  return { ok: true, cnpj };
}

// ── Etapa 1: a empresa ──────────────────────────────────────────────────────

export type Socio = { nome: string; qualificacao: string | null; cpfMascarado: string | null };

export type RespostaEmpresa =
  | { ok: false; motivo: "documento" | "ja-cadastrado" | "nao-encontrado" | "indisponivel"; mensagem: string }
  | {
      ok: true;
      passe: string;
      cnpj: string;
      razaoSocial: string;
      nomeFantasia: string | null;
      situacao: string | null;
      /** true so quando a Receita diz ATIVA. A tela avisa quando nao for. */
      ativa: boolean;
      aberturaEm: string | null;
      atividade: string | null;
      porte: string | null;
      endereco: {
        cep: string | null; logradouro: string | null; numero: string | null;
        complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null;
      };
      telefone: string | null;
      email: string | null;
      socios: Socio[];
      /** true quando a BigDataCorp complementou; false quando so veio da Receita. */
      enriquecido: boolean;
    };

/**
 * O que a Receita devolve pela BrasilAPI. De graca, e e a fonte oficial.
 *
 * O User-Agent NAO e cortesia: sem ele a BrasilAPI responde 403 Forbidden ao
 * `fetch` do Node. Antes desta rota a consulta saia do NAVEGADOR, que manda UA
 * proprio — mover para o servidor quebrou em silencio, e o formulario dizia
 * "CNPJ nao encontrado" para CNPJ que existe. Mesmo formato que o projeto ja
 * usa com o Nominatim (server/services/geocoding.ts).
 */
async function daReceita(cnpj: string): Promise<any | null> {
  try {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), 8000);
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: controle.signal,
      headers: {
        "User-Agent": "ConsultaISP/1.0 (https://consultaisp.com.br)",
        "Accept": "application/json",
      },
    });
    clearTimeout(t);
    if (!r.ok) {
      logger.warn({ status: r.status }, "cadastro: BrasilAPI recusou a consulta de CNPJ");
      return null;
    }
    return await r.json();
  } catch (erro) {
    logger.warn({ err: erro }, "cadastro: BrasilAPI indisponivel");
    return null;
  }
}

function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

export async function buscarEmpresa(cnpjBruto: string): Promise<RespostaEmpresa> {
  const cnpj = soDigitos(cnpjBruto);

  // 1. de graca
  if (!validarCNPJ(cnpj)) {
    return { ok: false, motivo: "documento", mensagem: "CNPJ invalido. Confira os numeros." };
  }

  // 2. banco — quem ja e cliente nao paga consulta de novo
  const existente = await storage.getProviderByCnpj(cnpj).catch(() => undefined);
  if (existente) {
    return {
      ok: false, motivo: "ja-cadastrado",
      mensagem: "Ja existe uma conta para este CNPJ. Faca login ou recupere sua senha.",
    };
  }

  // 3. Receita, de graca
  const receita = await daReceita(cnpj);
  if (!receita || !receita.razao_social) {
    return {
      ok: false, motivo: "nao-encontrado",
      mensagem: "Nao encontramos este CNPJ na Receita Federal. Confira os numeros.",
    };
  }

  const socios: Socio[] = (receita.qsa ?? []).map((s: any) => ({
    nome: String(s.nome_socio ?? "").trim(),
    qualificacao: s.qualificacao_socio ?? null,
    cpfMascarado: s.cnpj_cpf_do_socio ?? null,
  })).filter((s: Socio) => s.nome);

  const base = {
    ok: true as const,
    passe: emitirPasse(cnpj),
    cnpj,
    razaoSocial: String(receita.razao_social),
    nomeFantasia: receita.nome_fantasia || null,
    situacao: receita.descricao_situacao_cadastral || null,
    ativa: String(receita.descricao_situacao_cadastral || "").toUpperCase() === "ATIVA",
    aberturaEm: receita.data_inicio_atividade || null,
    atividade: receita.cnae_fiscal_descricao || null,
    porte: receita.porte || null,
    endereco: {
      cep: soDigitos(receita.cep) || null,
      logradouro: receita.logradouro || null,
      numero: receita.numero || null,
      complemento: receita.complemento || null,
      bairro: receita.bairro || null,
      cidade: receita.municipio || null,
      uf: receita.uf || null,
    },
    telefone: receita.ddd_telefone_1 || null,
    email: receita.email || null,
    socios,
    enriquecido: false,
  };

  // 4. so agora gasta — e a falha aqui NAO derruba a etapa, porque o dado da
  //    Receita ja basta para o cadastro seguir.
  const cred = credencialDaPlataforma();
  if (!cred) return base;

  try {
    const bdc = await consultarCnpj(PROVEDOR_PLATAFORMA, cred, cnpj);
    if (bdc.encontrado) {
      return {
        ...base,
        enriquecido: true,
        nomeFantasia: base.nomeFantasia ?? bdc.empresa.nomeFantasia ?? null,
        situacao: base.situacao ?? bdc.empresa.situacao ?? null,
        porte: base.porte ?? bdc.empresa.porte ?? null,
        telefone: base.telefone ?? (bdc.telefones[0]?.numero ?? null),
        email: base.email ?? (bdc.emails[0] ?? null),
      };
    }
  } catch (erro) {
    logger.warn({ err: erro }, "cadastro: BigDataCorp falhou no CNPJ; seguindo com a Receita");
  }
  return base;
}

// ── Etapa 2: o responsavel ──────────────────────────────────────────────────

export type RespostaResponsavel =
  | { ok: false; motivo: "passe" | "documento" | "nao-encontrado" | "desligado"; mensagem: string }
  | { ok: true; cpf: string; nome: string; nascimento: string | null; situacaoReceita: string | null };

export async function buscarResponsavel(
  cpfBruto: string, passe: string | undefined,
): Promise<RespostaResponsavel> {
  // O passe primeiro: e o que impede laco direto nesta rota.
  const conferido = conferirPasse(passe);
  if (!conferido.ok) {
    return {
      ok: false, motivo: "passe",
      mensagem: "Sua sessao de cadastro expirou. Confirme o CNPJ novamente.",
    };
  }

  const cpf = soDigitos(cpfBruto);
  if (!validarCPF(cpf)) {
    return { ok: false, motivo: "documento", mensagem: "CPF invalido. Confira os numeros." };
  }

  const cred = credencialDaPlataforma();
  if (!cred) {
    // Nao e erro: e o modo manual. A tela pede nome e segue.
    return { ok: false, motivo: "desligado", mensagem: "Preencha seus dados abaixo." };
  }

  try {
    const r = await consultarCpf(PROVEDOR_PLATAFORMA, cred, cpf);
    const nome = r.identidade?.nome?.trim();
    if (!nome) {
      return {
        ok: false, motivo: "nao-encontrado",
        mensagem: "Nao encontramos este CPF. Confira os numeros ou preencha na mao.",
      };
    }
    // So o que a tela mostra. Devolver o resultado inteiro transformaria o
    // cadastro numa API de bureau gratuita para quem soubesse ler a resposta.
    return {
      ok: true, cpf, nome,
      nascimento: r.identidade?.nascimento ?? null,
      situacaoReceita: r.identidade?.situacaoReceita ?? null,
    };
  } catch (erro) {
    logger.warn({ err: erro }, "cadastro: BigDataCorp falhou no CPF");
    return {
      ok: false, motivo: "nao-encontrado",
      mensagem: "A consulta nao respondeu agora. Preencha seus dados abaixo.",
    };
  }
}
