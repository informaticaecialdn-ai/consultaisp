/**
 * Cidade escrita no cadastro do ERP → município do IBGE.
 *
 * POR QUE ISTO EXISTE. Até 04/09/2026 esta lógica vivia só em
 * `script/cobertura-geo.ts`, e por isso só existia para quem tinha acesso ao
 * servidor. O resultado apareceu na Amplinet: a base de endereços carregada
 * cobria 9 municípios, TODOS do Paraná — a região de outro provedor —, e 184
 * clientes ficavam fora do mapa com a tela dizendo "carteira sem
 * geocodificação", que o dono leu como "o sistema não plota". A cidade de
 * atendimento não é uma escolha de quem opera: ela está escrita na carteira.
 * Para o produto perguntar isso sozinho, a resolução precisa ser código do
 * produto — é este arquivo.
 *
 * O NOME DA CIDADE É TEXTO LIVRE no cadastro do ERP. "EMBU-GUAÇU",
 * "EMBU GUACU" e "EMBUGUAÇU" são a mesma cidade, e viram uma chave só pela
 * mesma `normalizarCidade` que o geocodificador usa. O que não casa com
 * município nenhum é dito como tal, e não adivinhado: erro de digitação
 * ("EMBU GAUCU", "SÃO PAUYLO") e bairro no campo de cidade ("PARQUE JANDAIA")
 * param aqui de propósito. Adivinhar por semelhança planta um ponto no lugar
 * errado sem ninguém desconfiar, e este produto proíbe isso.
 *
 * Módulo puro: só a lista oficial de municípios e a normalização. Sem banco,
 * sem rede — é o que permite testá-lo com os casos reais medidos.
 */
import citiesData from "../../shared/data/cidades-brasil.json";
import { normalizarCidade } from "./area-atendida";

export interface Municipio {
  nome: string;
  uf: string;
  /** Código IBGE de 7 dígitos — é por ele que o CNEFE é baixado. */
  ibge: string;
}

const MUNICIPIOS = citiesData as Municipio[];

/**
 * As 27 siglas, tiradas da própria lista de municípios em vez de digitadas
 * aqui: a régua de "isto é uma UF" tem de ser a mesma lista contra a qual a
 * cidade é resolvida, senão as duas podem divergir sem ninguém notar.
 */
const SIGLAS_UF = new Set(MUNICIPIOS.map(m => m.uf));

/* ── Limpeza do que o ERP acrescenta ao nome ─────────────────────────────── */

/** "STRING:SAO PAULO" — prefixo de alguma integração mal feita. */
const PREFIXO_DE_INTEGRACAO = /^\s*[A-Za-z_]+\s*:\s*/;
/** "EMBU-GUACU," — pontuação no fim. */
const PONTUACAO_NO_FIM = /[,.;/\\]+\s*$/;
/** " SP", " - SP", "/SP" — a UF grudada no fim do nome. */
const SIGLA_NO_FIM = /[\s\-–—/]\s*([A-Za-z]{2})\s*$/;

/**
 * Limpa o que o cadastro do ERP acrescenta ao nome da cidade.
 *
 * Casos reais medidos na carteira da Amplinet em 04/09/2026:
 *   "EMBU-GUACU,"              vírgula no fim
 *   "ITAPECERICA DA SERRA SP"  UF grudada, sem separador
 *   "STRING:SAO PAULO"         prefixo de alguma integração mal feita
 *
 * A sigla do fim só sai quando é UF DE VERDADE. A primeira versão removia
 * qualquer palavra de duas letras no fim, e isso mutila 10 municípios do país:
 * "Santa Fé/PR" virava "SANTA", "Francisco Sá/MG" virava "FRANCISCO",
 * "Pedro II/PI" virava "PEDRO", "Xangri-lá/RS" virava "XANGRI". Nenhum deles
 * resolveria depois — e a tela acusaria o cadastro do provedor de estar errado
 * quando o errado era o limpador.
 *
 * A pontuação é removida duas vezes, antes e depois da sigla: "SAO PAULO, SP"
 * termina em "SP", então a primeira passada não vê a vírgula, que só fica
 * exposta quando a sigla sai.
 */
export function limparNomeDeCidade(bruto: string | null | undefined): string {
  return (bruto || "")
    .replace(PREFIXO_DE_INTEGRACAO, "")
    .replace(PONTUACAO_NO_FIM, "")
    .replace(SIGLA_NO_FIM, (todo, sigla: string) =>
      SIGLAS_UF.has(sigla.toUpperCase()) ? "" : todo)
    .replace(PONTUACAO_NO_FIM, "")
    .trim();
}

/**
 * A UF grudada no próprio nome, quando há: "ITAPECERICA DA SERRA SP" → "SP".
 *
 * É evidência real e não custa nada aproveitá-la. Existe para o caso em que o
 * cadastro tem a cidade e NÃO tem o campo de estado — sem isto a grafia cairia
 * na lista de "não casa com município nenhum", acusando de erro um cadastro
 * que na verdade disse a UF, só que no campo errado.
 */
export function ufNoNomeDaCidade(bruto: string | null | undefined): string | null {
  const achado = (bruto || "").replace(PONTUACAO_NO_FIM, "").match(SIGLA_NO_FIM);
  const sigla = achado?.[1]?.toUpperCase();
  return sigla && SIGLAS_UF.has(sigla) ? sigla : null;
}

/* ── Índice da lista oficial ─────────────────────────────────────────────── */

interface Indice {
  /** nome normalizado → municípios com aquele nome (240 nomes se repetem no país). */
  porNome: Map<string, Municipio[]>;
  /** nome normalizado SEM espaço nenhum → municípios. */
  porNomeColado: Map<string, Municipio[]>;
  /** UF → os municípios dela, já normalizados, para a busca por prefixo. */
  porUf: Map<string, Array<{ norm: string; municipio: Municipio }>>;
}

let indice: Indice | null = null;

/** Montado uma vez: são 5.571 linhas, e a resolução é chamada por cidade. */
function comoIndice(): Indice {
  if (indice) return indice;
  const porNome = new Map<string, Municipio[]>();
  const porNomeColado = new Map<string, Municipio[]>();
  const porUf = new Map<string, Array<{ norm: string; municipio: Municipio }>>();

  const juntar = (mapa: Map<string, Municipio[]>, chave: string, m: Municipio) => {
    const lista = mapa.get(chave);
    if (lista) lista.push(m); else mapa.set(chave, [m]);
  };

  for (const municipio of MUNICIPIOS) {
    const norm = normalizarCidade(municipio.nome);
    if (!norm) continue;
    juntar(porNome, norm, municipio);
    juntar(porNomeColado, norm.replace(/ /g, ""), municipio);
    const daUf = porUf.get(municipio.uf);
    if (daUf) daUf.push({ norm, municipio });
    else porUf.set(municipio.uf, [{ norm, municipio }]);
  }

  indice = { porNome, porNomeColado, porUf };
  return indice;
}

/* ── Resolução ───────────────────────────────────────────────────────────── */

/** O único da UF pedida, ou nada. Dois candidatos é o mesmo que nenhum. */
function unicoNaUf(achados: Municipio[] | undefined, uf: string): Municipio | null {
  const naUf = (achados ?? []).filter(m => m.uf === uf);
  return naUf.length === 1 ? naUf[0] : null;
}

/**
 * O que a resolução pode usar.
 *
 * `estrito` desliga a terceira regra — a expansão por prefixo. Ver o bloco
 * "DUAS RÉGUAS" em `resolverMunicipioDaCidade`.
 */
export interface OpcoesDeResolucao {
  estrito?: boolean;
}

function tentarResolver(cidadeNorm: string, uf: string, estrito: boolean): Municipio | null {
  // "SP" no campo de cidade não é cidade nenhuma.
  if (!cidadeNorm || cidadeNorm.length < 3) return null;
  const { porNome, porNomeColado, porUf } = comoIndice();

  // 1) Nome igual, já normalizado (hífen e acento fora).
  const exato = unicoNaUf(porNome.get(cidadeNorm), uf);
  if (exato) return exato;

  // 2) Sem espaço nenhum: "EMBUGUACU" e "Embu-Guaçu" são a mesma cidade
  //    digitada sem a barra de espaço. 23 cadastros da Amplinet estavam assim.
  const colado = unicoNaUf(porNomeColado.get(cidadeNorm.replace(/ /g, "")), uf);
  if (colado) return colado;

  if (estrito) return null;

  // 3) Prefixo único DENTRO DA UF: "ITAPECERICA" com UF SP só pode ser
  //    Itapecerica da Serra. É a regra que mais depende da UF — ver o comentário
  //    de `resolverMunicipioDaCidade`.
  const prefixo = (porUf.get(uf) ?? []).filter(c => c.norm.startsWith(`${cidadeNorm} `));
  if (prefixo.length === 1) return prefixo[0].municipio;

  return null;
}

/**
 * Cidade da carteira → município do IBGE.
 *
 * TRÊS tentativas, cada uma exigindo resultado ÚNICO **e** UF batendo.
 *
 * A UF NÃO É OPCIONAL, e sem ela nada é resolvido. "ITAPECERICA" é nome único
 * no país (Itapecerica/MG), e sem conferir a UF o resolvedor casou dois
 * clientes de Itapecerica DA SERRA/SP com a cidade mineira: a base de Minas foi
 * baixada e os dois teriam sido plotados a 500 km da casa, sem erro nenhum na
 * tela. Foi medido em 04/09/2026 e desfeito na mesma hora. Uma cidade sem UF é
 * uma cidade que não sabemos qual é, e o produto diz isso em vez de chutar.
 *
 * A segunda passada, com o nome CRU, existe por causa de "Sento Sé/BA": o
 * limpador tira o "SE" do fim porque SE é uma UF de verdade, e "SENTO" não
 * resolve. Quando a limpeza estraga o nome, o nome original ainda tem chance —
 * e as três regras continuam valendo para ele.
 *
 * ── DUAS RÉGUAS, e a diferença entre elas custa caro ─────────────────────
 *
 * A regra 3 (prefixo único dentro da UF) é casamento por SEMELHANÇA, e o que
 * ela pode custar depende de quem pergunta:
 *
 *   · quem pergunta para escolher QUAL BASE BAIXAR (`cobertura-geo.service`)
 *     erra barato — no pior caso um download desperdiçado, e a plotagem
 *     continua chaveada pelo texto do próprio cliente;
 *   · quem pergunta para decidir O QUE GRAVAR na linha do cliente
 *     (`cidade-canonica.service`) erra caro: reescreve `customers.city` sem
 *     caminho de volta, e o plotador leva o cliente para a cidade inventada.
 *
 * A superfície foi medida: 2.763 expansões por prefixo distintas resolvem no
 * país. "CAMPINA"/SP vira Campina do Monte Alegre (6 mil habitantes, 200 km de
 * Campinas); "ABREU"/PE vira Abreu e Lima; "JANDAIA"/PR vira Jandaia do Sul. E
 * o risco não é hipotético: o cadastro medido da Amplinet já tem truncamento
 * ("ITAP DA SERRA"), que só não explodiu por não ser prefixo único.
 *
 * Daí `estrito`. Com ele valem só as regras 1 e 2 — nome exato e nome colado,
 * que é a que conserta "EMBUGUAÇU" —, e "ITAPECERICA"/SP sai como cadastro a
 * corrigir em vez de virar "Itapecerica da Serra". É o mesmo lado seguro que
 * este arquivo já escolhe para "EMBU GAUCU".
 */
export function resolverMunicipioDaCidade(
  cidade: string | null | undefined,
  uf?: string | null,
  opcoes: OpcoesDeResolucao = {},
): Municipio | null {
  const sigla = (uf || "").trim().toUpperCase();
  if (!SIGLAS_UF.has(sigla)) return null;
  const estrito = opcoes.estrito === true;

  for (const chave of chavesDoNome(cidade)) {
    const achado = tentarResolver(chave, sigla, estrito);
    if (achado) return achado;
  }
  return null;
}

/**
 * As chaves pelas quais um nome do cadastro pode ser procurado no índice.
 *
 * 1. O nome LIMPO — sem o prefixo de integração, a pontuação e a UF grudada.
 * 2. O nome CRU: "Sento Sé/BA" perde o "SE" na limpeza (SE é UF de verdade) e
 *    "SENTO" não resolve; o original ainda tem chance.
 * 3. O nome limpo com o hífen já virado espaço. `normalizarCidade` corta um
 *    sufixo de duas letras depois de hífen achando que é UF — "XANGRI-LA" vira
 *    "xangri", que não é município nenhum. Antes isto passava despercebido
 *    porque a expansão por prefixo salvava o caso; sem ela (modo estrito, que é
 *    o que grava na linha do cliente) os dez municípios do país terminados em
 *    palavra de duas letras deixariam de resolver, e o produto acusaria de erro
 *    um cadastro correto.
 */
function chavesDoNome(cidade: string | null | undefined): string[] {
  const limpo = limparNomeDeCidade(cidade);
  return [...new Set([
    normalizarCidade(limpo),
    normalizarCidade(cidade),
    normalizarCidade(limpo.replace(/-/g, " ")),
  ].filter(Boolean))];
}

/**
 * O nome parece um município daquela UF ESCRITO PELA METADE?
 *
 * "ITAPECERICA" com UF SP é prefixo de Itapecerica da Serra; "JANDAIA" com PR é
 * prefixo de Jandaia do Sul. Nos dois o cadastro tem o ESTADO certo e o NOME
 * truncado — o oposto de "ITAPECERICA DA SERRA"/RN, onde o nome está inteiro e
 * o estado é que não bate.
 *
 * Serve só ao RELATÓRIO, para mandar o provedor olhar o campo certo do ERP.
 * Nada é gravado com base nisto: a expansão por prefixo continua fora da
 * escrita, pelo motivo escrito em "DUAS RÉGUAS" acima.
 */
export function pareceNomeTruncadoNaUf(
  cidade: string | null | undefined,
  uf: string | null | undefined,
): boolean {
  const sigla = (uf || "").trim().toUpperCase();
  if (!SIGLAS_UF.has(sigla)) return false;
  const daUf = comoIndice().porUf.get(sigla) ?? [];
  return chavesDoNome(cidade).some(chave =>
    chave.length >= 3 && daUf.some(c => c.norm.startsWith(`${chave} `)));
}

/**
 * O município que este nome designa quando se IGNORA a UF do cadastro — e só
 * quando ele é único no país inteiro.
 *
 * Existe para o RELATÓRIO, não para gravar nada: é o que permite dizer
 * "Itapecerica da Serra existe, mas em SP, e o cadastro diz RN — confira o
 * campo de estado" em vez de acusar o provedor de erro de digitação num nome
 * que está escrito corretamente. Sempre estrito: um candidato de relatório
 * também vira instrução para alguém mexer no ERP.
 */
export function municipioUnicoNoPais(cidade: string | null | undefined): Municipio | null {
  const { porNome, porNomeColado } = comoIndice();
  const unico = (achados: Municipio[] | undefined) =>
    achados && achados.length === 1 ? achados[0] : null;

  for (const norm of chavesDoNome(cidade)) {
    if (norm.length < 3) continue;
    const achado = unico(porNome.get(norm)) ?? unico(porNomeColado.get(norm.replace(/ /g, "")));
    if (achado) return achado;
  }
  return null;
}

/**
 * A UF da MAIORIA dos cadastros daquela grafia, e não de uma linha.
 *
 * Na carteira da Amplinet, "ITAPECERICA DA SERRA" aparece com SP em 207
 * cadastros e com RN, SE e SC em quatro. Uma linha ruim não pode decidir por
 * 207 — e não pode mandar baixar a base do estado errado.
 *
 * Empate devolve null de propósito: dois estados com a mesma contagem é
 * exatamente "não sabemos qual é", e é melhor a tela pedir a correção do
 * cadastro do que o mapa plotar no estado sorteado.
 */
export function ufDominante(contagens: Iterable<[string, number]>): string | null {
  const soma = new Map<string, number>();
  for (const [bruta, quantos] of contagens) {
    const uf = (bruta || "").trim().toUpperCase();
    if (!SIGLAS_UF.has(uf) || !(quantos > 0)) continue;
    soma.set(uf, (soma.get(uf) ?? 0) + quantos);
  }

  let campea: string | null = null;
  let max = 0;
  let empatada = false;
  for (const [uf, quantos] of soma) {
    if (quantos > max) { campea = uf; max = quantos; empatada = false; }
    else if (quantos === max) empatada = true;
  }
  return empatada ? null : campea;
}
