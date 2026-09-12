/**
 * Gerador determinístico de pessoas fictícias para a demonstração pública.
 *
 * Nada aqui usa Math.random, Date.now() ou I/O: uma tarefa futura semeia
 * dezenas de milhares de clientes (5 provedores x 1.500 + um sandbox por
 * visitante), e `pessoaFicticia(i)` precisa devolver sempre a MESMA pessoa
 * para o MESMO índice — inclusive entre um restart do processo e outro.
 *
 * CPF: dígito verificador válido pelo algoritmo da Receita Federal, mas na
 * faixa "999" — que a Receita nunca emite — para nunca colidir com o CPF de
 * uma pessoa real. Cidade e bairro são reais (as quatro cidades que o mapa
 * da rede já cobre); nome, telefone, logradouro, número e e-mail são
 * inventados a partir do índice.
 */

export interface CidadeDaDemo {
  nome: string;
  uf: "PR";
  /** Centro aproximado da cidade, em grau decimal — origem do jitter de coordenada. */
  latitude: number;
  longitude: number;
  /** Prefixo real dos Correios para a cidade (5 primeiros dígitos do CEP). */
  cepPrefixo: string;
  bairros: string[];
}

export interface PessoaFicticia {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  cidade: string;
  uf: "PR";
  bairro: string;
  logradouro: string;
  /** Número do imóvel — o que "logradouro" (termo dos Correios) não inclui. */
  numero: string;
  cep: string;
  /**
   * Coordenada dentro da cidade, já no formato de `customers.latitude` /
   * `customers.longitude` (decimal(10,7) — string) para uma tarefa futura
   * gravar direto na tabela sem geocodificação sob demanda.
   */
  latitude: string;
  longitude: string;
}

/** As quatro cidades que o mapa de calor da rede já cobre — nesta ordem. */
export const CIDADES_DA_DEMO: CidadeDaDemo[] = [
  {
    nome: "Londrina",
    uf: "PR",
    latitude: -23.31,
    longitude: -51.1628,
    cepPrefixo: "86025",
    bairros: [
      "Centro",
      "Gleba Palhano",
      "Jardim Shangri-lá",
      "Higienópolis",
      "Vila Ipiranga",
      "Jardim Bancários",
      "Jardim Alvorada",
      "Vila Casoni",
      "Bela Suíça",
      "Aritana",
      "Boa Vista",
      "Vila Brasil",
    ],
  },
  {
    nome: "Ibiporã",
    uf: "PR",
    latitude: -23.2694,
    longitude: -51.0436,
    cepPrefixo: "86200",
    bairros: [
      "Centro",
      "Jardim Planalto",
      "Jardim Brasília",
      "Boa Vista",
      "Vila Martins",
      "Jardim Paraíso",
      "Panorama",
      "Jardim Santa Luzia",
      "Vila Progresso",
      "Jardim São Manoel",
    ],
  },
  {
    nome: "Cambé",
    uf: "PR",
    latitude: -23.2758,
    longitude: -51.2778,
    cepPrefixo: "86180",
    bairros: [
      "Centro",
      "Chácara Manella",
      "Chácara Santa Maria",
      "Estância Cabral",
      "Conjunto Habitacional Cristal",
      "Conjunto Habitacional Ulysses Guimarães",
      "Conjunto Residencial Roberto Conceição",
      "Vila Castelo Branco",
    ],
  },
  {
    nome: "Apucarana",
    uf: "PR",
    latitude: -23.5508,
    longitude: -51.4608,
    cepPrefixo: "86800",
    bairros: [
      "Centro",
      "Jardim América",
      "Jardim Apucarana",
      "Jardim Diamantina",
      "Jardim Menegazzo",
      "Jardim São Pedro",
      "Vila Nova",
      "Vila Formosa",
      "Barra Funda",
    ],
  },
];

const PRENOMES = [
  "Maria", "José", "Ana", "João", "Antônio", "Francisca", "Carlos", "Adriana",
  "Paulo", "Juliana", "Pedro", "Márcia", "Lucas", "Fernanda", "Luiz", "Patrícia",
  "Marcos", "Aline", "Rafael", "Camila", "Gabriel", "Beatriz", "Daniel", "Larissa",
  "Bruno", "Amanda", "Eduardo", "Débora", "Felipe", "Priscila", "Thiago", "Vanessa",
  "André", "Cristiane", "Rodrigo", "Simone", "Diego", "Renata", "Gustavo", "Bianca",
  "Leonardo", "Fabiana", "Vinícius", "Tatiane", "Matheus", "Aparecida", "Sérgio",
  "Rosana", "Fábio", "Elaine",
];

const SOBRENOMES = [
  "Silva", "Santos", "Souza", "Oliveira", "Pereira", "Ferreira", "Alves", "Costa",
  "Rodrigues", "Martins", "Araújo", "Melo", "Barbosa", "Ribeiro", "Carvalho",
  "Lima", "Gomes", "Nascimento", "Nunes", "Moraes", "Cardoso", "Correia", "Dias",
  "Castro", "Campos", "Cunha", "Pinto", "Teixeira", "Moreira", "Andrade",
];

const TIPOS_LOGRADOURO = ["Rua", "Avenida", "Travessa", "Alameda"];

const NOMES_LOGRADOURO = [
  "das Flores", "das Palmeiras", "das Acácias", "dos Ipês", "Rio Grande do Sul",
  "Santa Catarina", "Paraná", "Minas Gerais", "Sete de Setembro", "Duque de Caxias",
  "Rio de Janeiro", "São Paulo", "Piauí", "Goiás", "Amazonas", "Espírito Santo",
  "Mato Grosso", "Bahia", "Ceará", "Guanabara", "Paraíba", "Pernambuco", "Alagoas",
  "Sergipe", "Tocantins", "Rondônia", "Roraima", "Acre", "Maranhão", "Pará",
];

const DOMINIOS_EMAIL = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br", "bol.com.br"];

/** DDD único: as quatro cidades da demo ficam todas na região de Londrina. */
const DDD_DA_REGIAO = "43";

/**
 * Mistura pseudo-aleatória PURAMENTE determinística de (índice, sal) —
 * variante do finalizador do MurmurHash3. Não é Math.random: o mesmo par
 * sempre volta com o mesmo número. É só isso que dá variedade sem parecer um
 * padrão mecânico (índice 0, 1, 2... escolhendo sempre o item 0, 1, 2... das
 * listas fixas).
 */
function misturar(indice: number, sal: number): number {
  let x = (Math.trunc(Math.abs(indice)) + sal * 999_983) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  x ^= x >>> 16;
  return x >>> 0;
}

function escolher<T>(lista: readonly T[], indice: number, sal: number): T {
  return lista[misturar(indice, sal) % lista.length];
}

/** Desloca `indice` para um número em [-amplitude, +amplitude]. */
function deslocamento(indice: number, sal: number, amplitude: number): number {
  const h = misturar(indice, sal) % 20_001; // 0..20000
  return (h / 10_000 - 1) * amplitude;
}

function paraEmail(txt: string): string {
  return txt
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Sufixo numérico do e-mail — nunca o índice cru.
 *
 * A versão anterior colava `i` direto (`maria.silva510347@gmail.com`): o
 * índice de uma pessoa nasce de milhares de sandboxes e cinco provedores do
 * mundo base, então na prática é sempre um número grande, e um número grande
 * colado no e-mail lê como saída de gerador — ninguém escolhe "510347" para
 * si. Gente de verdade ou não cola número nenhum, ou cola um par de dígitos,
 * ou cola um ano de nascimento plausível; a distribuição abaixo escolhe entre
 * essas três formas, determinística por índice.
 */
function sufixoDeEmail(indice: number): string {
  const h = misturar(indice, 14);
  const forma = h % 5;
  if (forma === 0) return ""; // 1 em 5: sem numero nenhum
  if (forma === 1) return String(1965 + (h % 40)); // 1 em 5: "ano de nascimento", 1965-2004
  return String(10 + (h % 90)); // 3 em 5: dois digitos, 10-99 — o caso mais comum
}

/**
 * Os 6 dígitos "livres" da base do CPF (depois do prefixo fixo "999").
 *
 * Módulo **999.999**, não 1.000.000. "999999999" geraria um CPF com os 11
 * dígitos iguais — a única sequência que o próprio algoritmo da Receita
 * rejeita por definição —, e é exatamente o que sairia se o resto pudesse
 * valer `999999`. Com módulo 999.999 esse resto NUNCA é alcançado (o maior
 * resto possível é 999.998) — o valor proibido simplesmente não existe mais
 * no espaço de saída, então não há nada para substituir. Consequência:
 * **nenhum índice dentro de um período colide com outro** — os primeiros
 * 999.999 índices (`0`..`999_998`) produzem 999.999 CPFs distintos, um por
 * índice, sem exceção. O período do gerador é 999.999 (ver `cpfFicticio`).
 *
 * Duas versões anteriores tentaram outra coisa: **substituir** o único resto
 * proibido (que aparecia só sob módulo 1.000.000) por um valor fixo —
 * primeiro "999998" (o vizinho natural: colidia visivelmente, achado em
 * revisão), depois "500.000" (escolhido por "parecer" longe de qualquer uso
 * real — só que 500.000 é `BASE_ARESTA` em `server/demo/mundo-base.ts`, o
 * índice exato de onde o semeador começa a gerar os CPFs compartilhados da
 * rede: `cpfFicticio(999_999)` saía igual a `CPFS_COMPARTILHADOS[0]`,
 * achado por uma segunda revisão). As duas eram a mesma classe de erro —
 * "escolher um número que parece seguro" — porque QUALQUER valor fixo dentro
 * do espaço de 6 dígitos já pertence a algum índice real; não existe
 * "número neutro" nesse espaço. Reduzir o módulo elimina a pergunta: não há
 * mais valor nenhum para substituir.
 */
function seisDigitosLivres(indice: number): string {
  const n = Math.trunc(Math.abs(indice)) % 999_999;
  return String(n).padStart(6, "0");
}

/** Dígito verificador de CPF: soma ponderada, resto da divisão por 11. */
function digitoVerificadorCpf(digitos: number[], pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) soma += digitos[i] * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/**
 * CPF fictício determinístico: prefixo "999" (faixa não emitida pela Receita)
 * + 6 dígitos derivados do índice + 2 dígitos verificadores calculados pelo
 * algoritmo oficial — por isso `validarCpfCnpj` sempre aceita o resultado.
 *
 * Período de **999.999**, sem exceção: `cpfFicticio(i) === cpfFicticio(i +
 * 999_999)` para qualquer `i` (os 6 dígitos livres vêm de `indice % 999_999`
 * — ver `seisDigitosLivres`). Dentro de um período (uma faixa de 999.999
 * índices consecutivos) todo CPF é distinto; só ao cruzar a fronteira do
 * período um índice repete o CPF de outro — inofensivo na escala desta demo
 * (dezenas de milhares de índices, no máximo); relevante só se este gerador
 * for reaproveitado além de ~999.999 pessoas.
 */
export function cpfFicticio(indice: number): string {
  const base9 = `999${seisDigitosLivres(indice)}`;
  const digitosBase = base9.split("").map(Number);
  const d10 = digitoVerificadorCpf(digitosBase, 10);
  const d11 = digitoVerificadorCpf([...digitosBase, d10], 11);
  return `${base9}${d10}${d11}`;
}

/**
 * Pessoa fictícia determinística: o mesmo índice sempre devolve a mesma
 * pessoa. Nome e sobrenomes vêm de listas fixas de nomes brasileiros comuns;
 * cidade e bairro são reais; logradouro, número, telefone, e-mail e
 * coordenada são inventados a partir do índice — nunca de `Math.random`.
 */
export function pessoaFicticia(indice: number): PessoaFicticia {
  const i = Math.trunc(indice);

  const prenome = escolher(PRENOMES, i, 1);
  const sobrenome1 = escolher(SOBRENOMES, i, 2);
  const sobrenome2 = escolher(SOBRENOMES, i, 3);

  const cidade = escolher(CIDADES_DA_DEMO, i, 4);
  const bairro = escolher(cidade.bairros, i, 5);
  const tipoLogradouro = escolher(TIPOS_LOGRADOURO, i, 6);
  const nomeLogradouro = escolher(NOMES_LOGRADOURO, i, 7);
  const numero = String((misturar(i, 8) % 2000) + 1);

  const sufixoCep = String(misturar(i, 9) % 1000).padStart(3, "0");
  const linhaTelefone = String(misturar(i, 10) % 100_000_000).padStart(8, "0");
  const dominio = escolher(DOMINIOS_EMAIL, i, 11);

  const latitude = cidade.latitude + deslocamento(i, 12, 0.03);
  const longitude = cidade.longitude + deslocamento(i, 13, 0.03);

  return {
    nome: `${prenome} ${sobrenome1} ${sobrenome2}`,
    cpf: cpfFicticio(i),
    email: `${paraEmail(prenome)}.${paraEmail(sobrenome1)}${sufixoDeEmail(i)}@${dominio}`,
    telefone: `(${DDD_DA_REGIAO}) 9${linhaTelefone.slice(0, 4)}-${linhaTelefone.slice(4)}`,
    cidade: cidade.nome,
    uf: cidade.uf,
    bairro,
    logradouro: `${tipoLogradouro} ${nomeLogradouro}`,
    numero,
    cep: `${cidade.cepPrefixo}-${sufixoCep}`,
    latitude: latitude.toFixed(7),
    longitude: longitude.toFixed(7),
  };
}
