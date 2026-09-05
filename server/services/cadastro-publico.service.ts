/**
 * As buscas do cadastro em etapas.
 *
 * Este e o UNICO lugar do sistema onde uma consulta paga sai por uma rota
 * publica, sem sessao. A decisao e deliberada: o cadastro vira a primeira
 * demonstracao do produto — a pessoa ve a consulta funcionando antes de pagar.
 * Mas isso significa que um formulario aberto na internet gasta dinheiro, e o
 * custo e por TENTATIVA:
 *
 *   CNPJ, recorte de onboarding .... R$ 0,21   (/empresas, 4 datasets)
 *   CPF ............................ R$ 0,72   (/pessoas)
 *
 * Entao a economia da rota e: TUDO que for de graca acontece antes, e o que
 * custa so roda depois que o barato ja aprovou.
 *
 *   1. digito verificador          — de graca, derruba lixo
 *   2. CNPJ ja cadastrado?         — banco, derruba quem ja e cliente
 *   3. Receita via BrasilAPI       — de graca, derruba CNPJ inexistente
 *   4. BigDataCorp                 — so aqui gasta
 *
 * O passe da etapa 1 amarra as duas rotas pagas: nao da para bater nelas em
 * laco sem antes ter resolvido um CNPJ de verdade, e o passe vale para UM CNPJ.
 *
 * TEMPO. A BigDataCorp e lenta — medido em producao, o combo de 8 datasets
 * passou de 60s e o nginx cortou a conexao. Por isso ela NAO fica no caminho da
 * etapa 1: a Receita responde em ~500ms e o bloco de bureau vem por uma rota
 * separada, que a tela busca depois. Toda chamada paga tem teto de tempo.
 *
 * ── DE QUEM E A CONTA ──────────────────────────────────────────────────────
 * As credenciais da BigDataCorp sao POR PROVEDOR, e no cadastro ainda nao ha
 * provedor. A busca roda na credencial ja cadastrada do provedor definido em
 * `BIGDATA_PROVEDOR_ONBOARDING` (padrao 1, a NsLink — que e o provedor do DONO
 * da plataforma, entao a conta e de quem paga a fatura da BigDataCorp).
 * Apontar isto para o provedor de um CLIENTE faria ele pagar o onboarding dos
 * concorrentes; e o unico jeito errado de configurar. Sem credencial, as buscas
 * pagas ficam desligadas e o formulario cai no preenchimento manual.
 */
import crypto from "crypto";
import { logger } from "../logger";
import { validarCPF, validarCNPJ } from "../utils/cpf-cnpj-validator";
import { consultarCpf, type Credencial } from "./bigdata.service";
import { consultarCnpj, DATASETS_EMPRESA_ONBOARDING } from "./bigdata-empresa";
import { gerarIdentificadorDeConsulta, protocoloDaOrigem } from "./identificador-consulta";
import { storage } from "../storage";

/**
 * De qual provedor sai a credencial que paga o onboarding.
 *
 * Padrao 1 = NsLink, que e o provedor do DONO da plataforma — a conta e a mesma
 * pessoa que paga a fatura da BigDataCorp, entao nao ha custo cruzado. Vem de
 * variavel de ambiente para o dia em que houver uma conta separada da casa: e
 * so apontar para outro id, ou usar o par LOGIN/SENHA abaixo.
 */
const PROVEDOR_ONBOARDING = Number(process.env.BIGDATA_PROVEDOR_ONBOARDING || 1);

const VALIDADE_PASSE_MS = 30 * 60_000;

export type ContaDeBusca = { providerId: number; cred: Credencial };

/**
 * A conta que roda as buscas do cadastro.
 *
 * Devolve TAMBEM o providerId, e ele importa: `obterToken` guarda o token da
 * BigDataCorp por provedor. Usando o mesmo id do dono da credencial, o
 * onboarding compartilha o token com as consultas normais daquele provedor —
 * uma sessao so na BigDataCorp. Com um id sentinela seriam duas sessoes para a
 * mesma conta, e se a API invalidar a anterior ao emitir a nova, as consultas
 * pagas do provedor comecam a falhar de forma intermitente.
 */
export async function contaDeBusca(): Promise<ContaDeBusca | null> {
  // Conta propria da plataforma, se um dia existir: tem precedencia.
  const login = process.env.BIGDATA_PLATAFORMA_LOGIN;
  const password = process.env.BIGDATA_PLATAFORMA_SENHA;
  if (login && password) return { providerId: PROVEDOR_ONBOARDING, cred: { login, password } };

  try {
    const i = await storage.getBigdataIntegration(PROVEDOR_ONBOARDING);
    if (!i?.isEnabled || !i.login || !i.password) return null;
    return { providerId: PROVEDOR_ONBOARDING, cred: { login: i.login, password: i.password } };
  } catch {
    return null;
  }
}

/** As buscas pagas estao ligadas? A tela pergunta para saber se pede na mao. */
export async function buscaAutomaticaDisponivel(): Promise<boolean> {
  return (await contaDeBusca()) !== null;
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

  /**
   * 2. banco — quem ja e cliente nao paga consulta de novo.
   *
   * `cnpj` aqui ja e digito puro, e e nessa forma que ele atravessa o resto do
   * fluxo: vai no passe, volta para a tela em `cnpj` e e o que o wizard reenvia
   * para `POST /api/auth/register`, que grava. O register nao confia nisso —
   * ele normaliza de novo antes de conferir e gravar (auth.routes.ts) —, mas o
   * caminho inteiro fala uma lingua so.
   *
   * DE QUE ESTA CONFERENCIA DEPENDE: a coluna `providers.cnpj` guardar UMA
   * forma so. A comparacao la embaixo e igualdade exata de string, entao uma
   * linha mascarada ("23.864.873/0001-48") seria invisivel para quem digita os
   * 14 digitos — o visitante passaria da porta, gastaria consulta paga e
   * chegaria ao cadastro como se fosse empresa nova. Quem garante a forma unica
   * nao e este arquivo: e a coluna (migracao 0020) e a escrita nas rotas.
   */
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

  /**
   * A BigDataCorp NAO entra aqui.
   *
   * Ela ficava nesta funcao e o custo apareceu na medicao: 4 a 6 segundos de
   * espera na PRIMEIRA tela do cadastro (17s com o token frio), contra 500ms da
   * Receita. Pior, os campos que ela preenchia — fantasia, situacao, porte,
   * telefone, e-mail — a Receita ja preenche, entao a espera nao mudava um
   * pixel.
   *
   * Agora ela vive em `buscarBureauEmpresa`, chamada pela tela DEPOIS que este
   * cartao ja apareceu. O visitante le e confere a empresa de imediato, e o
   * bloco de bureau — que e o que so a BigDataCorp tem — chega embaixo quando
   * fica pronto. Mesmo dado, mesma conta, sem porta travada.
   */
  return base;
}

/** O que so o bureau sabe. Contagem e sinalizador, nunca o dossie. */
export type BureauEmpresa = {
  ok: true;
  encontrado: boolean;
  emCobrancaAgora: boolean;
  cobrancas365d: number;
  credores365d: number;
  processosTotal: number;
  processosComoReu: number;
  temExecucao: boolean;
  dividaAtiva: number;
  naturezas: string[];
} | { ok: false };

/**
 * O bloco de bureau da empresa — a parte do cadastro que so a BigDataCorp
 * responde. R$ 0,39 por consulta, na conta configurada em `contaDeBusca`.
 *
 * Devolve CONTAGEM e SINALIZADOR, nunca o processo individual nem o credor.
 * A rota e publica: com o detalhe, o cadastro viraria consulta de bureau
 * empresarial gratuita para qualquer visitante que digitasse um CNPJ. O resumo
 * mostra que o produto funciona sem entregar o relatorio.
 */
export async function buscarBureauEmpresa(
  cnpjBruto: string, passe: string | undefined,
): Promise<BureauEmpresa> {
  /**
   * O identificador nasce na primeira linha, igual ao da rota autenticada.
   *
   * Aqui ele NAO vai para o banco nem para a resposta: nao ha provedor dono, e
   * inventar tabela para o onboarding seria guardar consulta de visitante. Ele
   * vive no log — e isso ja e a diferenca entre "alguma chamada gastou R$ 0,21
   * as 14h" e "esta chamada, deste minuto, foi esta". Sem sessao para amarrar
   * as linhas, o codigo e o unico fio.
   */
  const consultaId = gerarIdentificadorDeConsulta();
  const t0 = Date.now();

  const conferido = conferirPasse(passe);
  if (!conferido.ok) {
    logger.info({ consultaId, evento: "cadastro.recusa", tipo: "cnpj", motivo: "passe" },
      "onboarding: bureau da empresa recusado antes de gastar");
    return { ok: false };
  }

  const cnpj = soDigitos(cnpjBruto);
  // O passe e emitido PARA um CNPJ: usar com outro nao vale.
  if (cnpj !== conferido.cnpj || !validarCNPJ(cnpj)) {
    logger.info({ consultaId, evento: "cadastro.recusa", tipo: "cnpj", motivo: "documento" },
      "onboarding: bureau da empresa recusado antes de gastar");
    return { ok: false };
  }

  const conta = await contaDeBusca();
  if (!conta) {
    logger.info({ consultaId, evento: "cadastro.recusa", tipo: "cnpj", motivo: "desligado" },
      "onboarding: bureau da empresa recusado antes de gastar");
    return { ok: false };
  }

  try {
    // O CNPJ sai mascarado como em toda rota que loga documento. Ele estava
    // inteiro nesta linha, e o redact do pino nao o pegava: a lista cobre
    // `cpfCnpj` e `cpf`, nunca `cnpj`.
    logger.info({ consultaId, evento: "cadastro.consulta", tipo: "cnpj", doc: cnpj.slice(0, 4) + "***" },
      "onboarding consultou CNPJ na BigDataCorp");
    /**
     * Recorte de 4 datasets, nao os 8 do combo: o bloco mostra cobrancas,
     * processos e divida ativa, e mais nada. Medido em producao, o combo
     * completo passou de 60s e o nginx cortou. Tambem sai mais barato —
     * R$ 0,21 contra R$ 0,39.
     *
     * TETO DE 10s. Medido: empresa pequena responde em ~4,5s (NsLink, com os 8
     * datasets); empresa gigante passa de 25s mesmo com 4 (Petrobras). O que
     * pesa e o volume de dado da empresa, nao a quantidade de datasets.
     *
     * Quem se cadastra aqui e provedor regional — empresa pequena, dentro dos
     * 10s. Esperar mais so serviria para o visitante olhar um esqueleto girando
     * e ve-lo sumir: e melhor desistir rapido e em silencio.
     */
    const r = await Promise.race([
      consultarCnpj(conta.providerId, conta.cred, cnpj, DATASETS_EMPRESA_ONBOARDING),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (r === null) {
      logger.warn({ consultaId, doc: cnpj.slice(0, 4) + "***", ms: Date.now() - t0 },
        "cadastro: bureau da empresa passou de 10s; o bloco nao aparece");
      return { ok: false };
    }
    logger.info({
      consultaId, evento: "cadastro.consulta.fim", tipo: "cnpj",
      encontrado: r.encontrado,
      // O QueryId da propria BigDataCorp: e o numero que ELA pede quando o dado
      // vem errado. Aqui nao ha linha no banco para consultar depois, entao o
      // log e o unico lugar em que ele existe.
      protocoloOrigem: protocoloDaOrigem("cadastral", { bruto: r.bruto })?.protocolo ?? null,
      ms: Date.now() - t0,
    }, "onboarding: bureau da empresa concluído");
    const i = r.inadimplencia;
    return {
      ok: true,
      encontrado: r.encontrado,
      emCobrancaAgora: Boolean(i?.emCobrancaAgora),
      cobrancas365d: i?.cobrancas365d ?? 0,
      credores365d: i?.credores365d ?? 0,
      processosTotal: i?.processosTotal ?? 0,
      processosComoReu: i?.processosComoReu ?? 0,
      temExecucao: Boolean(i?.temExecucao),
      dividaAtiva: i?.dividaAtiva ?? 0,
      naturezas: (i?.naturezas ?? []).slice(0, 4),
    };
  } catch (erro) {
    logger.warn({ consultaId, err: erro, ms: Date.now() - t0 },
      "cadastro: BigDataCorp falhou no bureau da empresa");
    return { ok: false };
  }
}

// ── Etapa 2: o responsavel ──────────────────────────────────────────────────

export type RespostaResponsavel =
  | { ok: false; motivo: "passe" | "documento" | "nao-socio" | "nao-encontrado" | "desligado"; mensagem: string }
  | { ok: true; cpf: string; nome: string; nascimento: string | null; situacaoReceita: string | null };

/**
 * O CPF informado bate com a mascara de algum socio da Receita?
 *
 * A BrasilAPI devolve o CPF do socio parcialmente coberto — "***208668**",
 * onde so as posicoes 3 a 8 aparecem. Nao da para descobrir o CPF por ali, mas
 * da para CONFERIR um que foi digitado: seis digitos batendo dentro do quadro
 * societario da mesma empresa e prova suficiente para o cadastro.
 *
 * Isso vale mais que economia de digitacao. E a diferenca entre "quem tiver um
 * passe consulta qualquer CPF por R$ 0,72" e "so socio daquele CNPJ dispara a
 * consulta" — e a checagem custa zero, porque o quadro societario ja vem junto
 * com o CNPJ que a etapa 1 buscou.
 */
function cpfBateComSocio(cpf: string, mascara: string | null | undefined): boolean {
  const m = String(mascara ?? "");
  if (m.length !== 11 || cpf.length !== 11) return false;
  for (let i = 0; i < 11; i++) {
    if (m[i] === "*") continue;              // digito coberto: nada a comparar
    if (m[i] !== cpf[i]) return false;
  }
  // Mascara sem digito nenhum nao prova nada.
  return /\d/.test(m);
}

export async function buscarResponsavel(
  cpfBruto: string, passe: string | undefined,
): Promise<RespostaResponsavel> {
  // Mesma regra do bureau da empresa: primeiro do handler, antes do passe.
  // Esta e a consulta mais cara do onboarding (R$ 0,72), e sai sem sessao.
  const consultaId = gerarIdentificadorDeConsulta();
  const t0 = Date.now();

  const recusa = (motivo: string) =>
    logger.info({ consultaId, evento: "cadastro.recusa", tipo: "cpf", motivo },
      "onboarding: CPF recusado antes de gastar");

  // O passe primeiro: e o que impede laco direto nesta rota.
  const conferido = conferirPasse(passe);
  if (!conferido.ok) {
    recusa("passe");
    return {
      ok: false, motivo: "passe",
      mensagem: "Sua sessao de cadastro expirou. Confirme o CNPJ novamente.",
    };
  }

  const cpf = soDigitos(cpfBruto);
  if (!validarCPF(cpf)) {
    recusa("documento");
    return { ok: false, motivo: "documento", mensagem: "CPF invalido. Confira os numeros." };
  }

  /**
   * O CPF precisa pertencer ao quadro societario do CNPJ da etapa 1 — e a
   * ultima porteira gratuita antes da consulta de R$ 0,72.
   *
   * Empresa SEM quadro societario (MEI, empresario individual) passa direto:
   * nao ha contra quem conferir, e barrar fecharia a porta para metade dos
   * provedores pequenos. Quem nao e socio tambem segue, mas pelo preenchimento
   * manual — nao gasta consulta.
   */
  const receita = await daReceita(conferido.cnpj);
  const socios: any[] = receita?.qsa ?? [];
  if (socios.length > 0) {
    const ehSocio = socios.some(s => cpfBateComSocio(cpf, s?.cnpj_cpf_do_socio));
    if (!ehSocio) {
      recusa("nao-socio");
      return {
        ok: false, motivo: "nao-socio",
        mensagem: "Este CPF nao consta no quadro societario da empresa. Confira os numeros ou preencha seus dados abaixo.",
      };
    }
  }

  const conta = await contaDeBusca();
  if (!conta) {
    // Nao e erro: e o modo manual. A tela pede nome e segue.
    recusa("desligado");
    return { ok: false, motivo: "desligado", mensagem: "Preencha seus dados abaixo." };
  }

  try {
    // R$ 0,72 — a mais cara das duas. Ja passou pelo passe da etapa 1 e pelo
    // digito verificador; e por isso que ela e a ultima da fila.
    logger.info({ consultaId, evento: "cadastro.consulta", tipo: "cpf", doc: cpf.slice(0, 4) + "***" },
      "onboarding consultou CPF na BigDataCorp");

    // Mesmo teto do CNPJ, um pouco mais folgado: esta consulta tem mais
    // datasets. Estourou, cai no preenchimento manual — que ja e o caminho
    // previsto. Formulario de cadastro nao pode ficar parado esperando bureau.
    const r = await Promise.race([
      consultarCpf(conta.providerId, conta.cred, cpf),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 8000)),
    ]);
    if (r === null) {
      logger.warn({ consultaId, ms: Date.now() - t0 },
        "cadastro: BigDataCorp passou de 8s no CPF; caindo no preenchimento manual");
      return { ok: false, motivo: "nao-encontrado", mensagem: "A consulta demorou. Preencha seus dados abaixo." };
    }
    // Um so log de conclusao para os dois desfechos pagos: encontrado e nao
    // encontrado. Os dois custaram o mesmo — a busca foi executada.
    logger.info({
      consultaId, evento: "cadastro.consulta.fim", tipo: "cpf",
      // `encontrado` do lado pessoa mora dentro de `dados` — o do lado empresa
      // e no topo. Nao ha simetria a corrigir aqui; e so onde cada um esta.
      encontrado: r.dados.encontrado,
      protocoloOrigem: protocoloDaOrigem("cadastral", { bruto: r.bruto })?.protocolo ?? null,
      ms: Date.now() - t0,
    }, "onboarding: CPF concluído");

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
    logger.warn({ consultaId, err: erro, ms: Date.now() - t0 }, "cadastro: BigDataCorp falhou no CPF");
    return {
      ok: false, motivo: "nao-encontrado",
      mensagem: "A consulta nao respondeu agora. Preencha seus dados abaixo.",
    };
  }
}
