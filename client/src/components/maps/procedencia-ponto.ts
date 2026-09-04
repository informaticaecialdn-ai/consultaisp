/**
 * Procedência do ponto no mapa — o que ele afirma, e como isso aparece.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O mapa da carteira desenha duas coisas com o mesmo círculo: um ponto que é a
 * casa do cliente e um ponto que é só uma pista de onde ela fica. A distinção
 * já existia para `bairro` (translúcido no mapa, dito no popup) mas morava
 * espalhada — a opacidade num ternário do MapaCarteira, o texto do popup montado
 * com um `split(" ·")` sobre o rótulo compartilhado, e a linha da legenda escrita
 * à mão com a palavra "bairro" cravada. Com UMA procedência aproximada isso se
 * aguentava. Com duas, a próxima a entrar sairia sólida em algum dos três
 * lugares, e o mapa afirmaria uma casa que ninguém sabe qual é.
 *
 * A segunda procedência aproximada é a que chega agora: um ponto tirado das
 * instalações que o PRÓPRIO provedor já tem georreferenciadas na mesma rua
 * (server/services/vizinho-de-rua.service.ts). Não é a casa do cliente e não é
 * a instalação de nenhum vizinho específico: é a MEDIANA de duas ou mais
 * instalações do trecho — o serviço escolheu a mediana justamente porque ela
 * "costuma não ser casa nenhuma", já que devolver um vizinho apontaria o
 * cliente B para o telhado do A.
 *
 * QUANTO ELE ERRA, pelos números do próprio serviço: o trecho que sustenta o
 * ponto vai até 300 m e a gravação soma ±110 m de ruído por LGPD, então a
 * ordem de grandeza é a centena de metros, não a dezena. Por isso o texto aqui
 * não promete distância: promete a RUA. Quem lê esta tela decide ir cobrar num
 * endereço, e a diferença entre "é aqui" e "é nesta rua" é a diferença entre
 * bater na porta certa e bater na porta de um terceiro.
 *
 * A DECISÃO É PURA E TESTADA, e é de propósito — o teste ao lado prova as duas
 * coisas que este arquivo não pode errar: que ponto aproximado nunca sai sólido
 * (nem quando a procedência é desconhecida), e que a tela nunca mostra o nome
 * técnico da fonte para quem só quer saber se pode ir até lá.
 *
 * O QUE ELE DELIBERADAMENTE NÃO FAZ
 * Não distingue os dois graus de aproximação pela opacidade. Translucidez é um
 * sinal binário — "afirma a casa" ou "não afirma" —, e dois níveis de translúcido
 * lado a lado no tile do OpenStreetMap não se distinguem a olho: pareceriam um
 * defeito de renderização, não uma informação. Qual das duas aproximações é
 * dita em PALAVRAS, no popup e na legenda, onde a diferença cabe.
 */
import type { GeoPrecisao } from "@shared/geo-precisao";

/**
 * As procedências que esta tela sabe desenhar — as mesmas do tipo
 * compartilhado, e por construção.
 *
 * Se `shared/geo-precisao.ts` ganhar uma procedência nova, o `Record` abaixo
 * para de compilar até alguém decidir a aparência dela. É o comportamento
 * desejado: procedência nova sem decisão de tela é o bug que este arquivo
 * existe para tornar impossível.
 */
export type ProcedenciaPonto = GeoPrecisao;

/**
 * Opacidade de preenchimento do marcador no canvas do Leaflet. Os dois valores
 * são os que o mapa já usava; ficam nomeados aqui para que a legenda e o
 * marcador não possam divergir.
 */
export const OPACIDADE_AFIRMA = 0.95;
export const OPACIDADE_APROXIMADA = 0.55;

/** Ponto que afirma a casa: sólido, sem nota no popup. */
export type PontoAfirmado = { aproximado: false; opacidade: number };

/** Ponto que não afirma a casa: translúcido, sempre rotulado. */
export type PontoAproximado = {
  aproximado: true;
  opacidade: number;
  /** Chave interna de agrupamento (legenda, data-testid). NUNCA vai para a tela. */
  chave: string;
  /** A linha do popup, sem o símbolo. Português de operador, não de cartógrafo. */
  aviso: string;
  /** O rótulo da linha da legenda do mapa. */
  legenda: string;
  /** O `title` da linha da legenda — a frase inteira, para quem parar o mouse. */
  explicacao: string;
};

export type AparenciaDoPonto = PontoAfirmado | PontoAproximado;

const AFIRMA_A_CASA: PontoAfirmado = { aproximado: false, opacidade: OPACIDADE_AFIRMA };

/**
 * Ponto tirado do trecho da rua onde o próprio provedor já tem instalações.
 *
 * O texto não diz "vizinho de rua" nem "geo_precisao": diz o que o operador
 * precisa saber antes de sair para cobrar — a rua está certa, o número não foi
 * conferido. "Instalações suas" é literal e não vaza nada: o índice que produz
 * este ponto só usa clientes do próprio provedor (filtro por `provider_id` no
 * SQL), então os outros clientes da rua são, necessariamente, clientes de quem
 * está olhando a tela.
 *
 * O que ele NÃO diz, e é uma correção: que o ponto seja "de outra instalação"
 * (é a mediana de várias, e o serviço escolheu a mediana justamente por ela não
 * ser casa nenhuma) nem que esteja "a dezenas de metros" (o trecho vai a 300 m
 * e a gravação soma ±110 m). Prometer distância que o dado não garante é a tela
 * cobrindo um buraco do servidor.
 */
const DO_VIZINHO_DA_RUA: PontoAproximado = {
  aproximado: true,
  opacidade: OPACIDADE_APROXIMADA,
  chave: "mesma-rua",
  aviso: "localização aproximada — a rua está certa, o ponto é o trecho da mesma rua onde você já tem instalações",
  legenda: "aproximados · mesma rua",
  explicacao:
    "A rua está certa. O ponto fica no trecho da rua onde você já tem outras instalações, " +
    "e pode estar a algumas centenas de metros da casa: o número não foi confirmado.",
};

/** Um endereço real do bairro — a rua não foi encontrada. O caso mais fraco que se grava. */
const DO_BAIRRO: PontoAproximado = {
  aproximado: true,
  opacidade: OPACIDADE_APROXIMADA,
  chave: "bairro",
  aviso: "localização aproximada — um endereço do bairro, não a casa",
  legenda: "aproximados · bairro",
  explicacao:
    "Um endereço real do bairro, não a casa: a rua deste cliente não foi encontrada. " +
    "Serve para saber a região, não para bater na porta.",
};

/**
 * Procedência que esta tela não conhece — e que por isso NÃO pode ser desenhada
 * como se afirmasse a casa.
 *
 * O servidor grava `geo_precisao` como texto livre, e o client é implantado em
 * separado: uma procedência nova pode chegar à tela antes desta lista saber
 * dela. Se o desconhecido caísse no ramo sólido, o modo de falha seria
 * exatamente o que o produto proíbe — afirmar um endereço que ninguém apurou —
 * e seria silencioso. Caindo aqui, o pior que acontece é a tela ser cautelosa
 * demais com um ponto que talvez fosse exato: o operador vai até a rua do mesmo
 * jeito. O aviso não inventa uma origem que não sabemos; diz só o que é certo.
 */
const ORIGEM_NAO_IDENTIFICADA: PontoAproximado = {
  aproximado: true,
  opacidade: OPACIDADE_APROXIMADA,
  chave: "nao-identificada",
  aviso: "localização aproximada",
  explicacao:
    "Este ponto veio de uma origem que esta tela ainda não reconhece. Até ser identificada, " +
    "ele é tratado como aproximado — o mapa não afirma a casa.",
  legenda: "aproximados",
};

/**
 * A aparência de cada procedência.
 *
 * ── DÍVIDA CONHECIDA, e não decisão: `logradouro` e `cep` ─────────────────
 * Os dois continuam SÓLIDOS, como o mapa sempre os desenhou, e a hierarquia
 * ficou invertida por isso: `logradouro` é, pela definição do próprio
 * `geocode-local.service` ("a rua bate, o número não"), a MESMA afirmação que
 * `vizinho` — rua certa, casa desconhecida — e num logradouro do censo a rua
 * pode ter quilômetros, sem nenhuma guarda de trecho. Mesmo assim ele sai
 * sólido e sem uma palavra no popup, enquanto o ponto que exige duas
 * instalações reais e passa por uma guarda sai translúcido e rotulado.
 *
 * Não está consertado aqui porque repintar ponto que já está na tela mexe na
 * carteira histórica inteira: é decisão de produto, que pede a medição (quantos
 * pontos da Amplinet estão em `logradouro` e em `cep`) e o aval do dono. O que
 * este comentário garante é que a próxima pessoa leia "dívida", e não "assim
 * deve ser". Quando o dono aprovar, os dois ganham a mesma translucidez e uma
 * frase própria — "a rua está certa, o número não" —, e a legenda passa a ter
 * três linhas, o que cabe nos 218 px do cartão.
 */
export const APARENCIA_POR_PROCEDENCIA: Record<ProcedenciaPonto, AparenciaDoPonto> = {
  erp: AFIRMA_A_CASA,
  endereco: AFIRMA_A_CASA,
  logradouro: AFIRMA_A_CASA,
  cep: AFIRMA_A_CASA,
  vizinho: DO_VIZINHO_DA_RUA,
  bairro: DO_BAIRRO,
};

/**
 * Ordem das linhas de aproximação na legenda: da pista mais estreita para a
 * mais larga. O operador lê de cima para baixo e a primeira linha é a que ainda
 * dá para usar hoje.
 */
const APROXIMACOES_EM_ORDEM: readonly PontoAproximado[] = [
  DO_VIZINHO_DA_RUA,
  DO_BAIRRO,
  ORIGEM_NAO_IDENTIFICADA,
];

/**
 * Como desenhar e como narrar o ponto de uma dada procedência.
 *
 * Aceita `string` crua porque é isso que chega do servidor (a coluna é texto
 * livre). Sem procedência — `null`, `undefined` ou vazio — o ponto segue sólido:
 * é o cadastro antigo, anterior à coluna, e a coordenada dele quase sempre veio
 * do ERP. Tratar ausência como aproximação repintaria metade de uma carteira
 * histórica com base em nada; ausência de informação não é informação.
 */
export function aparenciaDoPonto(precisao: string | null | undefined): AparenciaDoPonto {
  if (!precisao) return AFIRMA_A_CASA;
  return APARENCIA_POR_PROCEDENCIA[precisao as ProcedenciaPonto] ?? ORIGEM_NAO_IDENTIFICADA;
}

/** Uma linha de aproximação na legenda do mapa. */
export type LinhaDeAproximacao = {
  chave: string;
  legenda: string;
  explicacao: string;
  n: number;
};

/**
 * As linhas de aproximação que a legenda deve mostrar, na ordem, com a contagem
 * de cada uma. Só entra quem tem ponto no mapa: a legenda descreve o desenho,
 * e uma linha zerada seria a chave de uma cor que não está na tela.
 *
 * Recebe as procedências e não os pontos de propósito — a legenda não precisa
 * de nome, dívida nem coordenada de ninguém para ser decidida, e o teste desta
 * função não precisa montar um cliente inteiro para provar uma contagem.
 */
export function aproximacoesNaLegenda(
  precisoes: ReadonlyArray<string | null | undefined>,
): LinhaDeAproximacao[] {
  const contagem = new Map<string, number>();
  for (const p of precisoes) {
    const a = aparenciaDoPonto(p);
    if (!a.aproximado) continue;
    contagem.set(a.chave, (contagem.get(a.chave) ?? 0) + 1);
  }
  return APROXIMACOES_EM_ORDEM.flatMap(a => {
    const n = contagem.get(a.chave) ?? 0;
    return n > 0 ? [{ chave: a.chave, legenda: a.legenda, explicacao: a.explicacao, n }] : [];
  });
}
