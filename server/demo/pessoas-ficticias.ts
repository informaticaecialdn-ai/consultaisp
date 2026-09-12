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
 * Os 6 dígitos "livres" da base do CPF (depois do prefixo fixo "999").
 *
 * "999999999" geraria um CPF com os 11 dígitos iguais — a única sequência que
 * o próprio algoritmo da Receita rejeita por definição —, e é exatamente o
 * que sai quando `indice % 1_000_000 === 999_999`. Esse valor precisa de um
 * substituto — e com 6 dígitos livres (10^6 combinações, uma proibida) é
 * matematicamente impossível ter mais de 999.999 índices consecutivos com
 * CPF distinto: quando o índice 999.999 (o milionésimo) precisa de um valor,
 * os outros 999.999 já usaram os 999.999 valores válidos que sobram, sem
 * folga — ALGUM vai se repetir (princípio da casa dos pombos). A pergunta que
 * dá pra escolher é só QUAL repete.
 *
 * A primeira versão substituía por "999998" — o valor NATURAL do índice
 * vizinho —, então `cpfFicticio(999_998)` e `cpfFicticio(999_999)` saíam
 * iguais: uma colisão silenciosa achada em revisão, não em teste (o CPF
 * continuava válido, só duplicado). "Vizinho mais próximo" é o pior alvo
 * possível: é o primeiro par que qualquer teste de fronteira experimenta.
 * Agora o substituto é **500.000** — longe da faixa realista de uso (a demo
 * semeia, no máximo, dezenas de milhares de linhas) e longe do índice
 * original (999.999), ao contrário de "n-1". A única colisão do gerador
 * inteiro fica isolada em índice 500.000 ≡ índice 999.999 (e qualquer índice
 * ≡ 999.999 mod 1.000.000 depois dele) — ver o comentário de `cpfFicticio`
 * para o período que sobra fora dela.
 */
function seisDigitosLivres(indice: number): string {
  const n = Math.trunc(Math.abs(indice)) % 1_000_000;
  const substituto = n === 999_999 ? 500_000 : n;
  return String(substituto).padStart(6, "0");
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
 * Período de 1.000.000: `cpfFicticio(i) === cpfFicticio(i + 1_000_000)` para
 * qualquer `i` (os 6 dígitos livres vêm de `indice % 1_000_000`). Inofensivo
 * na escala desta demo (dezenas de milhares de índices, no máximo); relevante
 * só se este gerador for reaproveitado além de ~1 milhão de pessoas.
 *
 * Uma única EXCEÇÃO ao período limpo: todo índice ≡ 999.999 (mod 1.000.000)
 * sai igual ao índice 500.000 — ver `seisDigitosLivres` para o porquê (o
 * valor "999999" é proibido, e com 6 dígitos livres alguma colisão é
 * matematicamente inevitável; esta é a única do gerador inteiro).
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
    email: `${paraEmail(prenome)}.${paraEmail(sobrenome1)}${i}@${dominio}`,
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
