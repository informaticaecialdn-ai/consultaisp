/**
 * Bureaus simulados — SPC e cadastral (BigDataCorp), para a instância pública
 * de demonstração.
 *
 * As duas consultas reais custam dinheiro por chamada (SPC é SOAP pago por
 * consulta; a cadastral custa R$ 0,72 na BigDataCorp) e devolvem dado de
 * pessoa real. Um visitante anônimo nunca pode disparar nenhuma das duas —
 * por isso `emModoDemo()` desvia ANTES de qualquer rede, aqui mesmo neste
 * módulo: nada daqui importa `fetch`, XML, SOAP ou credencial.
 *
 * Determinismo é o requisito do produto: o mesmo documento tem que devolver
 * sempre a mesma HISTÓRIA, para uma demonstração poder ser repetida e um
 * print de tela continuar batendo meses depois. Por isso nunca há
 * `Math.random` — mas a história é feita de DESLOCAMENTOS em dias a partir de
 * hoje ("dívida registrada há 47 dias"), nunca de datas absolutas: um
 * deslocamento fixo preso a um calendário fixo envelheceria (a demonstração
 * diria para sempre "01/09/2026", cada vez mais distante do dia real). A data
 * desta consulta (`consultadoEm` e as demais datas "de hoje") usa o relógio
 * real — a consulta está de fato acontecendo agora —, e cada dia-de-hoje é
 * lido só UMA vez por chamada (`hojeUtcMs()`) para toda a história daquele
 * documento sair consistente entre si.
 *
 * Identidade (nome, endereço, telefone, nascimento) é a MESMA para os dois
 * bureaus quando o documento é o mesmo — um visitante que consulta o mesmo
 * CPF no SPC e na cadastral não pode ver duas pessoas diferentes. A SITUAÇÃO
 * (limpo, uma restrição, várias) é independente por bureau — cada um usa um
 * hash salgado com o próprio nome —, porque são bureaus diferentes medindo
 * coisas diferentes; nada obriga um a repetir o outro.
 *
 * Onde os dois payloads têm campo sem dado hoje na conta real (ex.: `mercado`
 * e `perfil` da cadastral dependem de datasets de bureau/demográfico que a
 * conta não compra — ver os comentários "SEIS SAIRAM" em bigdata.service.ts),
 * a simulação também sai vazia: mostrar aqui o que a produção nunca mostra
 * enganaria o visitante sobre o que o produto de fato entrega hoje.
 */
import type { SpcResult } from "../services/spc/spc-parser";
import type { ResultadoConsulta } from "../services/bigdata.service";

// ── Hash determinístico ──────────────────────────────────────────────────────

/** Só dígitos — mesma normalização usada nas duas entradas reais. */
function normalizarDocumento(documento: string): string {
  return String(documento ?? "").replace(/\D/g, "");
}

/** FNV-1a 32 bits: puro, sem dependências, mesma string sempre vira o mesmo número. */
function hashBase(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deriva, de um hash base e de um "sal", um segundo número bem distribuído —
 * finalizador do MurmurHash3. Permite tirar várias decisões independentes do
 * MESMO documento (situação, score, datas, nome...) sem repetir padrão entre
 * elas nem usar `Math.random`.
 */
function misturar(base: number, sal: number): number {
  let x = (base + sal * 999_983) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  x ^= x >>> 16;
  return x >>> 0;
}

function escolher<T>(lista: readonly T[], base: number, sal: number): T {
  return lista[misturar(base, sal) % lista.length];
}

/** Inteiro determinístico em [min, max], ambos inclusive. */
function intEntre(base: number, sal: number, min: number, max: number): number {
  return min + (misturar(base, sal) % (max - min + 1));
}

/** true em `percentual`% das vezes, de forma determinística. */
function chance(base: number, sal: number, percentual: number): boolean {
  return (misturar(base, sal) % 100) < percentual;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function reais(n: number): string {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-01-05" -> "05/01/2026". */
function paraBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function semAcento(txt: string): string {
  return txt.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Meia-noite UTC do dia real de hoje — a ÚNICA leitura do relógio deste
 * módulo, uma vez por chamada de `spcSimulado`/`cadastralSimulado`. Toda data
 * "de hoje" (`dataIso(hojeMs, 0)`) e todo deslocamento ("há N dias") partem
 * daqui: o deslocamento é fixo por documento (determinismo), mas a
 * data-calendário que ele resolve anda com o dia real — nunca fica presa no
 * dia em que este código foi escrito.
 */
function hojeUtcMs(): number {
  const agora = new Date();
  return Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
}

function dataIso(hojeMs: number, diasAntesDeHoje: number): string {
  return new Date(hojeMs - diasAntesDeHoje * 86_400_000).toISOString().slice(0, 10);
}

// ── Mundo fictício compartilhado pelos dois bureaus ─────────────────────────

interface CidadeSimulada {
  nome: string;
  cepPrefixo: string;
  bairros: readonly string[];
}

/** As quatro cidades já usadas no resto da demonstração (região de Londrina/PR). */
const CIDADES_DEMO: readonly CidadeSimulada[] = [
  { nome: "Londrina", cepPrefixo: "86025", bairros: ["Centro", "Gleba Palhano", "Higienópolis", "Vila Ipiranga"] },
  { nome: "Ibiporã", cepPrefixo: "86200", bairros: ["Centro", "Jardim Planalto", "Boa Vista"] },
  { nome: "Cambé", cepPrefixo: "86180", bairros: ["Centro", "Chácara Manella", "Vila Castelo Branco"] },
  { nome: "Apucarana", cepPrefixo: "86800", bairros: ["Centro", "Jardim América", "Vila Nova"] },
];

const PRENOMES_FEM = ["Maria", "Ana", "Francisca", "Adriana", "Juliana", "Márcia", "Fernanda", "Patrícia", "Camila", "Beatriz"];
const PRENOMES_MASC = ["José", "João", "Carlos", "Paulo", "Pedro", "Lucas", "Marcos", "Rafael", "Gabriel", "Daniel"];
const SOBRENOMES = ["Silva", "Santos", "Souza", "Oliveira", "Pereira", "Ferreira", "Alves", "Costa", "Rodrigues", "Martins"];
const TIPOS_LOGRADOURO = ["Rua", "Avenida", "Travessa", "Alameda"];
const NOMES_LOGRADOURO = ["das Flores", "das Palmeiras", "Rio Grande do Sul", "Santa Catarina", "Paraná", "Sete de Setembro", "São Paulo", "Goiás"];
const OPERADORAS = ["Vivo", "Claro", "TIM", "Oi"];
const DDD_DA_REGIAO = "43";

interface PessoaSimulada {
  nomeCompleto: string;
  nomeMae: string;
  nomePai: string;
  genero: "M" | "F";
  nascimentoIso: string;
  idade: number;
  telefoneDdd: string;
  telefoneNumero: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: "PR";
  cep: string;
  email: string;
}

/**
 * Pessoa fictícia determinística: o mesmo `base` sempre devolve a mesma
 * pessoa. Usado pelos dois bureaus para a MESMA identidade — só a situação de
 * crédito/cadastro diverge entre eles (cada bureau usa um `base` salgado
 * diferente para isso, calculado por quem chama).
 */
function pessoaSimulada(base: number, hojeMs: number): PessoaSimulada {
  const feminino = chance(base, 1, 50);
  const prenome = feminino ? escolher(PRENOMES_FEM, base, 2) : escolher(PRENOMES_MASC, base, 2);
  const sobrenome1 = escolher(SOBRENOMES, base, 3);
  const sobrenome2 = escolher(SOBRENOMES, base, 4);
  const nomeMae = `${escolher(PRENOMES_FEM, base, 5)} ${escolher(SOBRENOMES, base, 6)}`;
  const nomePai = `${escolher(PRENOMES_MASC, base, 7)} ${escolher(SOBRENOMES, base, 8)}`;
  const idade = intEntre(base, 9, 19, 74);
  const cidade = escolher(CIDADES_DEMO, base, 10);
  const bairro = escolher(cidade.bairros, base, 11);
  const linha = String(intEntre(base, 12, 0, 99_999_999)).padStart(8, "0");

  return {
    nomeCompleto: `${prenome} ${sobrenome1} ${sobrenome2}`,
    nomeMae, nomePai,
    genero: feminino ? "F" : "M",
    nascimentoIso: dataIso(hojeMs, idade * 365 + intEntre(base, 13, 0, 364)),
    idade,
    telefoneDdd: DDD_DA_REGIAO,
    telefoneNumero: `9${linha.slice(0, 4)}-${linha.slice(4)}`,
    logradouro: `${escolher(TIPOS_LOGRADOURO, base, 14)} ${escolher(NOMES_LOGRADOURO, base, 15)}`,
    numero: String(intEntre(base, 16, 10, 2400)),
    bairro,
    cidade: cidade.nome,
    uf: "PR",
    cep: `${cidade.cepPrefixo}-${String(intEntre(base, 17, 0, 999)).padStart(3, "0")}`,
    email: `${semAcento(prenome)}.${semAcento(sobrenome1)}@example.com`,
  };
}

/** As três situações que o hash escolhe, iguais em espírito nos dois bureaus. */
type Situacao = "limpo" | "uma" | "varias";

function situacaoDe(base: number): Situacao {
  const r = misturar(base, 500) % 10;
  if (r < 4) return "limpo";   // 40%
  if (r < 8) return "uma";     // 40%
  return "varias";             // 20%
}

// ── SPC ──────────────────────────────────────────────────────────────────────

type Restricao = SpcResult["restrictions"][number];
type ResumoBloco = SpcResult["resumo"]["spc"];
type ConsultaAnteriorSpc = SpcResult["previousConsultations"]["lista"][number];

const TIPOS_RESTRICAO: readonly Restricao["type"][] = ["SPC", "SPC", "CHEQUE_LOJISTA", "PROTESTO", "ACAO_JUDICIAL"];
const CREDORES_FICTICIOS = [
  "Comércio Demonstração Ltda", "Financeira Modelo S.A.", "Loja Exemplo Varejo",
  "Distribuidora Simulação Ltda", "Crediário Amostra S.A.",
];
const RAZOES_SOCIAIS_FICTICIAS = [
  "Comércio Demonstração Ltda", "Distribuidora Modelo Simulação S.A.", "Serviços Amostra Ltda EPP",
];

function quantidadeRestricoesSpc(base: number, situacao: Situacao): number {
  if (situacao === "limpo") return 0;
  if (situacao === "uma") return 1;
  return intEntre(base, 501, 2, 4);
}

function descricaoRestricao(tipo: Restricao["type"]): string {
  switch (tipo) {
    case "CHEQUE_LOJISTA": return "Cheque devolvido";
    case "PROTESTO": return "Protesto em cartório";
    case "ACAO_JUDICIAL": return "Ação judicial de cobrança";
    default: return "Registro de inadimplência";
  }
}

function restricaoFicticia(base: number, indice: number, hojeMs: number): Restricao {
  const sal = 600 + indice * 10;
  const tipo = escolher(TIPOS_RESTRICAO, base, sal + 1);
  const valor = intEntre(base, sal + 2, 90, 3400);
  const dt = dataIso(hojeMs, intEntre(base, sal + 3, 10, 900));
  const credor = escolher(CREDORES_FICTICIOS, base, sal + 4);
  const origin = `${escolher(CIDADES_DEMO, base, sal + 5).nome} / PR`;
  return {
    type: tipo,
    description: descricaoRestricao(tipo),
    severity: valor >= 1500 ? "critical" : valor >= 300 ? "high" : "medium",
    creditor: credor,
    value: valor.toFixed(2),
    date: dt,
    origin,
    detalhes: [
      { rotulo: "Credor (associado)", valor: credor },
      { rotulo: "Cidade", valor: origin },
      { rotulo: "Valor", valor: reais(valor) },
      { rotulo: "Inclusão no SPC", valor: paraBr(dt) },
    ],
  };
}

function restricoesFicticiasSpc(base: number, situacao: Situacao, hojeMs: number): Restricao[] {
  const n = quantidadeRestricoesSpc(base, situacao);
  const restricoes: Restricao[] = [];
  for (let i = 0; i < n; i++) restricoes.push(restricaoFicticia(base, i, hojeMs));
  return restricoes.sort((a, b) => b.date.localeCompare(a.date));
}

function resumoFicticioSpc(restricoes: Restricao[]): SpcResult["resumo"] {
  const vazio: ResumoBloco = { quantidade: 0, valor: 0, ultimaOcorrencia: null };
  const blocoPara = (tipo: Restricao["type"]): ResumoBloco => {
    const doTipo = restricoes.filter(r => r.type === tipo);
    if (doTipo.length === 0) return vazio;
    return {
      quantidade: doTipo.length,
      valor: arredondar(doTipo.reduce((s, r) => s + parseFloat(r.value), 0)),
      ultimaOcorrencia: [...doTipo].sort((a, b) => b.date.localeCompare(a.date))[0].date,
    };
  };
  return {
    spc: blocoPara("SPC"),
    chequeLojista: blocoPara("CHEQUE_LOJISTA"),
    ccf: vazio,
    protesto: blocoPara("PROTESTO"),
    acao: blocoPara("ACAO_JUDICIAL"),
    pendenciaFinanceira: vazio,
    poderJudiciario: vazio,
  };
}

function consultasAnterioresFicticias(base: number, n: number, hojeMs: number): SpcResult["previousConsultations"] {
  const lista: ConsultaAnteriorSpc[] = [];
  for (let i = 0; i < n; i++) {
    lista.push({
      associado: escolher(CREDORES_FICTICIOS, base, 700 + i),
      cidade: escolher(CIDADES_DEMO, base, 710 + i).nome,
      uf: "PR",
      data: dataIso(hojeMs, intEntre(base, 720 + i, 1, 89)),
    });
  }
  return { total: n, last90Days: n, diasConsiderados: 90, bySegment: {}, lista };
}

function scoreSpc(base: number, situacao: Situacao): number {
  if (situacao === "limpo") return intEntre(base, 502, 700, 1000);
  if (situacao === "uma") return intEntre(base, 502, 350, 750);
  return intEntre(base, 502, 0, 450);
}

function vereditoSpc(score: number, restricao: boolean): Pick<SpcResult, "riskLevel" | "riskLabel" | "recommendation"> {
  if (score >= 701) {
    return restricao
      ? { riskLevel: "medium", riskLabel: "Score bom, com restrição", recommendation: "Analisar as restrições" }
      : { riskLevel: "low", riskLabel: "Risco baixo", recommendation: "Aprovar" };
  }
  if (score >= 501) return { riskLevel: "medium", riskLabel: "Risco médio", recommendation: "Aprovar com ressalvas" };
  if (score >= 301) return { riskLevel: "high", riskLabel: "Risco alto", recommendation: "Analisar com cautela" };
  return { riskLevel: "very_high", riskLabel: "Risco muito alto", recommendation: "Recusar" };
}

function cadastralDataSpc(doc: string, pessoa: PessoaSimulada, identidadeBase: number, hojeMs: number): SpcResult["cadastralData"] {
  if (doc.length === 14) {
    const cidade = escolher(CIDADES_DEMO, identidadeBase, 20);
    return {
      tipo: "PJ",
      nome: escolher(RAZOES_SOCIAIS_FICTICIAS, identidadeBase, 21),
      cpfCnpj: doc,
      dataFundacao: dataIso(hojeMs, intEntre(identidadeBase, 22, 500, 9000)),
      situacaoRf: "ATIVA",
      obitoRegistrado: false,
      naturezaJuridica: "Sociedade Empresária Limitada",
      atividadePrincipal: "Comércio varejista de artigos diversos",
      cidade: cidade.nome,
      uf: "PR",
    };
  }
  return {
    tipo: "PF",
    nome: pessoa.nomeCompleto,
    cpfCnpj: doc,
    dataNascimento: pessoa.nascimentoIso,
    nomeMae: pessoa.nomeMae,
    idade: pessoa.idade,
    situacaoRf: "REGULAR",
    obitoRegistrado: false,
    endereco: `${pessoa.logradouro}, ${pessoa.numero} · ${pessoa.bairro}`,
    cidade: pessoa.cidade,
    uf: pessoa.uf,
    telefone: `(${pessoa.telefoneDdd}) ${pessoa.telefoneNumero}`,
  };
}

/**
 * Resultado fictício do SPC, determinístico pelo documento. Nunca toca rede —
 * é chamado no lugar de `consultarSpc` quando `emModoDemo()`.
 */
export function spcSimulado(documento: string): SpcResult {
  const doc = normalizarDocumento(documento);
  const identidadeBase = hashBase(doc);
  const spcBase = hashBase(`${doc}:spc`);
  const hojeMs = hojeUtcMs();
  const pessoa = pessoaSimulada(identidadeBase, hojeMs);

  const situacao = situacaoDe(spcBase);
  const restrictions = restricoesFicticiasSpc(spcBase, situacao, hojeMs);
  const restricao = restrictions.length > 0;
  const score = scoreSpc(spcBase, situacao);
  const nConsultasAnteriores = intEntre(spcBase, 503, 0, 3);

  return {
    cpfCnpj: doc,
    protocolo: `${intEntre(spcBase, 504, 100_000, 999_999)}-${intEntre(spcBase, 505, 0, 9)}`,
    // A consulta está acontecendo AGORA — data real de hoje, não presa a um
    // calendário fixo (ver o comentário de `hojeUtcMs`).
    consultadoEm: dataIso(hojeMs, 0),
    restricao,
    cadastralData: cadastralDataSpc(doc, pessoa, identidadeBase, hojeMs),
    score,
    scoreFonte: "spc-score-12-meses",
    ...vereditoSpc(score, restricao),
    status: restricao ? "restricted" : "clean",
    restrictions,
    totalRestrictions: arredondar(restrictions.reduce((s, r) => s + parseFloat(r.value), 0)),
    resumo: resumoFicticioSpc(restrictions),
    pendenciasFinanceiras: [],
    previousConsultations: consultasAnterioresFicticias(spcBase, nConsultasAnteriores, hojeMs),
    alerts: [],
    // Insumos opcionais (renda presumida, limite sugerido) só vêm quando
    // comprados à parte (SPC_INSUMOS_OPCIONAIS) — a simulação não inventa o
    // que a consulta padrão, sem eles, também não traria.
    rendaPresumida: null,
    limiteCreditoSugerido: null,
    basesInoperantes: [],
    simulado: true,
  };
}

// ── Cadastral (BigDataCorp) ──────────────────────────────────────────────────

const FAIXAS_RENDA = ["ATÉ 1 SM", "1 A 2 SM", "2 A 3 SM", "3 A 5 SM", "5 A 10 SM"];
const NIVEIS_LETRA = ["A", "B", "C", "D", "E", "F", "G", "H"];

interface ContadoresBigData {
  emCobranca: boolean;
  cobrancas365d: number;
  credores365d: number;
  processosComoReu: number;
  processos365d: number;
  temExecucao: boolean;
  dividaAtiva: number;
}

function contadoresBigData(base: number, situacao: Situacao): ContadoresBigData {
  if (situacao === "limpo") {
    return { emCobranca: false, cobrancas365d: 0, credores365d: 0, processosComoReu: 0, processos365d: 0, temExecucao: false, dividaAtiva: 0 };
  }
  if (situacao === "uma") {
    return {
      emCobranca: true, cobrancas365d: 1, credores365d: 1,
      processosComoReu: 0, processos365d: 0, temExecucao: false,
      dividaAtiva: intEntre(base, 40, 150, 900),
    };
  }
  const cobrancas = intEntre(base, 41, 2, 5);
  return {
    emCobranca: true,
    cobrancas365d: cobrancas,
    credores365d: Math.max(1, cobrancas - 1),
    processosComoReu: intEntre(base, 42, 0, 2),
    processos365d: intEntre(base, 43, 0, 1),
    temExecucao: chance(base, 44, 30),
    dividaAtiva: intEntre(base, 45, 900, 6000),
  };
}

/**
 * Score 0-1000, MAIOR é MELHOR (bigdata.service.ts:928) — tem que concordar
 * com `situacao`/`contadoresBigData`, nunca contradizer `emCobrancaAgora`,
 * `temExecucao` ou `dividaAtiva`. Mesma ideia de `scoreSpc()`, faixada pela
 * MESMA `situacao` que decide os contadores — nunca um hash independente:
 * foi assim, independente, que um score de "risco baixo" saiu ao lado de
 * dívida em cobrança com execução judicial (13 em 2.000 documentos medidos).
 */
function scoreBigData(base: number, situacao: Situacao): number {
  if (situacao === "limpo") return intEntre(base, 58, 700, 1000);
  if (situacao === "uma") return intEntre(base, 58, 350, 750);
  return intEntre(base, 58, 0, 450);
}

/** A-H, A é a melhor faixa — a mesma leitura de "maior é melhor" do score. */
function nivelDoScore(score: number): string {
  if (score >= 850) return "A";
  if (score >= 700) return "B";
  if (score >= 550) return "C";
  if (score >= 400) return "D";
  if (score >= 250) return "E";
  if (score >= 150) return "F";
  if (score >= 50) return "G";
  return "H";
}

/**
 * Resultado fictício da consulta cadastral (BigDataCorp), determinístico pelo
 * documento. Nunca toca rede — chamado no lugar de `consultarCpf` quando
 * `emModoDemo()`.
 *
 * `mercado` e `perfil` saem vazios de propósito: os datasets que os alimentam
 * (birô/marketplace e demográfico) não fazem parte do nível "padrão" que a
 * conta real compra hoje (ver comentários "SEIS SAIRAM" em
 * bigdata.service.ts) — uma consulta real, no nível único que existe, também
 * devolveria os dois vazios.
 */
export function cadastralSimulado(cpf: string): ResultadoConsulta {
  const doc = normalizarDocumento(cpf);
  const identidadeBase = hashBase(doc);
  const bdcBase = hashBase(`${doc}:bdc`);
  const hojeMs = hojeUtcMs();
  const pessoa = pessoaSimulada(identidadeBase, hojeMs);
  const faixaRenda = escolher(FAIXAS_RENDA, bdcBase, 46);

  const situacao = situacaoDe(bdcBase);
  const c = contadoresBigData(bdcBase, situacao);
  // Risco pessoal tem que concordar com os contadores acima — ver o
  // comentário de `scoreBigData`.
  const riscoScore = scoreBigData(bdcBase, situacao);

  // Calculado ANTES de `dados`, de propósito: no serviço real os dois campos
  // abaixo são o MESMO valor escrito duas vezes (bigdata.service.ts:1396 e
  // :1425 leem os dois de `dfb?.CreditSeeker`, e :1427 copia
  // `dados.consultas30d` de `rastro.consultas30d` literalmente) — aqui
  // `dados` COPIA de `rastro`, nunca sorteia por conta própria.
  const rastro: ResultadoConsulta["rastro"] = {
    consultas30d: intEntre(bdcBase, 66, 0, 5),
    consultas365d: intEntre(bdcBase, 67, 0, 20),
    passagensRuins: 0,
    primeiraPassagem: dataIso(hojeMs, intEntre(bdcBase, 68, 1000, 6000)),
    ultimaPassagem: dataIso(hojeMs, intEntre(bdcBase, 69, 5, 200)),
    buscaCredito: escolher(NIVEIS_LETRA, bdcBase, 70),
    usoCartao: escolher(NIVEIS_LETRA, bdcBase, 71),
    usoBancoDigital: escolher(NIVEIS_LETRA, bdcBase, 72),
    mudancasNome: 0,
    mudancasStatus: 0,
  };

  return {
    dados: {
      encontrado: true,
      taxIdStatus: "REGULAR",
      temObito: false,
      nascimentoValidadoNaReceita: true,
      homonimos: intEntre(bdcBase, 47, 0, 3),
      enderecos: [{ ratificado: true, ativo: true, ultimaPassagem: dataIso(hojeMs, intEntre(bdcBase, 48, 5, 200)) }],
      badAddressPassages: 0,
      faixaRenda,
      emCobrancaAgora: c.emCobranca,
      cobrancas365d: c.cobrancas365d,
      credoresDistintos365d: c.credores365d,
      processosComoReu: c.processosComoReu,
      processos365d: c.processos365d,
      temExecucao: c.temExecucao,
      dividaAtiva: c.dividaAtiva,
      // Copiado de `rastro` — não é um campo parecido, é o MESMO sinal
      // escrito duas vezes (ver o comentário acima de `rastro`).
      buscaCredito: rastro.buscaCredito,
      mudancasNome: rastro.mudancasNome,
      consultas30d: rastro.consultas30d,
      trocasEmprego10Anos: intEntre(bdcBase, 51, 0, 4),
      mediaAnosPorVinculo: intEntre(bdcBase, 52, 1, 6),
    },
    identidade: {
      nome: pessoa.nomeCompleto,
      nascimento: pessoa.nascimentoIso,
      idade: pessoa.idade,
      nomeMae: pessoa.nomeMae,
      nomePai: pessoa.nomePai,
      genero: pessoa.genero,
      situacaoReceita: "REGULAR",
      dataSituacao: dataIso(hojeMs, intEntre(identidadeBase, 53, 30, 2000)),
    },
    enderecos: [{
      logradouro: pessoa.logradouro,
      numero: pessoa.numero,
      bairro: pessoa.bairro,
      cidade: pessoa.cidade,
      uf: pessoa.uf,
      cep: pessoa.cep,
      ratificado: true,
      ativo: true,
      principal: true,
      naReceita: true,
      ultimaPassagem: dataIso(hojeMs, intEntre(bdcBase, 54, 5, 200)),
      passagens: intEntre(bdcBase, 55, 1, 6),
      passagensRuins: 0,
    }],
    telefones: [{
      numero: pessoa.telefoneNumero.replace("-", ""),
      ddd: pessoa.telefoneDdd,
      tipo: "MOVEL",
      operadora: escolher(OPERADORAS, bdcBase, 56),
      ativo: true,
      principal: true,
      prioridade: 1,
      naoPerturbe: false,
      ultimaPassagem: dataIso(hojeMs, intEntre(bdcBase, 57, 5, 200)),
      passagensRuins: 0,
    }],
    // `emails_extended` não está no combo hoje — uma consulta real também
    // devolveria a lista vazia (ver bigdata.service.ts).
    emails: [],
    renda: {
      faixa: faixaRenda,
      emReais: null,
      fontes: [],
      rendaFormal: null,
      declaracoesIR: [],
      declaraIrRecorrente: false,
      temSegmentoVip: false,
    },
    risco: {
      // Mesma faixa de `situacao` que decide `c` (contadoresBigData) — nunca
      // um hash independente. Ver o comentário de `scoreBigData`.
      score: riscoScore,
      nivel: nivelDoScore(riscoScore),
      empregado: chance(bdcBase, 60, 60),
      socio: chance(bdcBase, 61, 10),
      recebendoAuxilio: chance(bdcBase, 62, 15),
      inicioUltimaOcupacao: dataIso(hojeMs, intEntre(bdcBase, 63, 30, 3000)),
    },
    inadimplencia: {
      emCobrancaAgora: c.emCobranca,
      cobrancas365d: c.cobrancas365d,
      credores365d: c.credores365d,
      mesesConsecutivos: c.emCobranca ? intEntre(bdcBase, 64, 1, 6) : 0,
      ultimaCobranca: c.emCobranca ? dataIso(hojeMs, intEntre(bdcBase, 65, 5, 300)) : undefined,
      processosTotal: c.processosComoReu,
      processosComoReu: c.processosComoReu,
      processos365d: c.processos365d,
      temExecucao: c.temExecucao,
      naturezas: c.processosComoReu > 0 ? ["Execução de título extrajudicial"] : [],
      dividaAtiva: c.dividaAtiva,
    },
    rastro,
    ocupacao: {
      empregadoAgora: chance(bdcBase, 73, 60),
      empreendedor: chance(bdcBase, 74, 10),
      trocasTotal: intEntre(bdcBase, 75, 0, 6),
      trocas5Anos: intEntre(bdcBase, 76, 0, 3),
      trocas10Anos: intEntre(bdcBase, 77, 0, 5),
      mediaAnosPorVinculo: intEntre(bdcBase, 78, 1, 6),
      idadePrimeiroEmprego: intEntre(bdcBase, 79, 16, 24),
      setorPublico: chance(bdcBase, 80, 15),
      setorPrivado: true,
      totalEmpregadores: intEntre(bdcBase, 81, 1, 5),
    },
    // Vazio de propósito — ver o comentário da função.
    perfil: {},
    // Vazio de propósito — ver o comentário da função.
    mercado: { negativacoes: [], quemConsultou: [] },
    domicilio: {
      totalRelacionados: intEntre(bdcBase, 82, 0, 6),
      noDomicilio: intEntre(bdcBase, 83, 1, 4),
      parentes: intEntre(bdcBase, 84, 0, 3),
      conjuges: chance(bdcBase, 85, 40) ? 1 : 0,
      socios: 0,
      colegasTrabalho: intEntre(bdcBase, 86, 0, 2),
      // O portão que libera nome de terceiro (family_financial_risk) não está
      // no combo hoje: sem ele nenhum nome sai por este caminho.
      nomes: [],
      nomesLiberados: false,
    },
    // Sem endereço de instalação informado nesta chamada — nada para cruzar.
    cruzamentoDomicilio: {
      totalComEndereco: 0,
      naMesmaCidade: 0,
      domiciliosDistintos: 0,
      bateComInstalacao: false,
      coincidencias: [],
      cruzou: false,
    },
    // Vazio de propósito (family_financial_risk fora do combo hoje).
    riscoFamiliar: { membros: 0, empregados: 0, emCobranca: 0, ocorrencias365d: 0, distribuicao: {} },
    capacidade: {
      sobraMensal: escolher(FAIXAS_RENDA, bdcBase, 87),
      despesaMensal: escolher(FAIXAS_RENDA, bdcBase, 88),
      rendaFamiliar: faixaRenda,
      dependentes: intEntre(bdcBase, 89, 0, 3),
      ehResponsavel: chance(bdcBase, 90, 70),
      origemRenda: "PRIVATE SECTOR",
      rendaMediaFamiliar: faixaRenda,
      pessoasNaCasa: intEntre(bdcBase, 91, 1, 5),
      // Sem `family_social_assistance` no combo hoje, benefício sai sempre
      // negativo/zerado — ver normalizarCapacidade em bigdata.service.ts.
      recebeBeneficio: false,
      beneficiariosNaFamilia: 0,
      beneficiariosHistoricos: 0,
      beneficioUltimos12m: 0,
      beneficioUltimos3m: 0,
    },
    // Sondas por entidade desligadas no único nível hoje — sempre null.
    validacaoTelefone: null,
    imovel: null,
    processos: c.processosComoReu > 0 ? [{
      data: dataIso(hojeMs, intEntre(bdcBase, 92, 30, 900)),
      tipo: "EXECUÇÃO DE TÍTULO EXTRAJUDICIAL",
      assunto: "DIREITO DO CONSUMIDOR",
      tribunal: "TJPR",
      uf: "PR",
      status: "Em andamento",
      valor: c.dividaAtiva,
      papel: "réu",
    }] : [],
    datasetsIndisponiveis: [],
    bruto: { simulado: true },
    datasetsChamados: ["simulado"],
    nivel: "padrao",
    datasetsComFalha: [],
    latenciaMs: intEntre(bdcBase, 93, 250, 900),
    simulado: true,
  };
}
