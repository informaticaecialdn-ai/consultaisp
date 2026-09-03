/**
 * O identificador de uma consulta: `CI-2609-K7F3M2`.
 *
 * Toda consulta do sistema — ISP, SPC e cadastral — ganha um. Ele aparece no
 * topo do relatorio, entra no log do servidor e e o que o provedor apresenta
 * ao suporte: "a consulta CI-2609-K7F3M2 deu erro". Sem ele, achar UMA consulta
 * especifica no log significava procurar por CPF, que e exatamente o dado que
 * nao deveria estar la.
 *
 * ── Por que sorteado, e nao um hash do CPF ─────────────────────────────────
 * O pedido falou em "hash", e a tentacao seria derivar o codigo do documento
 * consultado. Nao se faz isso, por dois motivos concretos:
 *
 * 1. CPF tem 11 digitos — pouco mais de 10^11 combinacoes, e as regras de
 *    digito verificador cortam isso em 100 vezes. Qualquer maquina reverte um
 *    hash de CPF por forca bruta em minutos. O codigo viraria o proprio CPF
 *    escrito de outro jeito, e ele vai para log, tela e chamado de suporte.
 * 2. Um hash e estavel: duas consultas do mesmo CPF por provedores diferentes
 *    teriam o MESMO codigo, e cruzar dois relatorios revelaria que se trata da
 *    mesma pessoa — entre tenants que nao podem saber isso um do outro.
 *
 * Um sorteio nao diz nada sobre quem foi consultado. E o que se quer: o codigo
 * identifica a CONSULTA, nao a pessoa.
 *
 * ── O formato ──────────────────────────────────────────────────────────────
 * `CI-AAMM-XXXXXX`, onde AAMM e o ano e o mes da consulta e XXXXXX sao seis
 * caracteres sorteados. O mes embutido serve ao suporte: ao ouvir o codigo por
 * telefone ja se sabe onde procurar, mesmo antes de consultar o banco.
 *
 * O alfabeto exclui `0 1 I O U`: zero e O, um e I se confundem em qualquer
 * fonte e em qualquer ditado por telefone, e sem U nao se formam palavras
 * indesejadas por acidente. Sobram 31 simbolos; 31^6 e cerca de 887 milhoes de
 * combinacoes por mes, contra alguns milhares de consultas. A colisao e
 * improvavel, e o indice unico no banco a transforma em nova tentativa em vez
 * de dado errado.
 */
import { randomBytes } from "crypto";

/** Sem 0, 1, I, O e U — ver a nota de formato acima. */
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTVWXYZ";
const TAMANHO_DO_SORTEIO = 6;

export const PREFIXO = "CI";

/** `CI-AAMM-XXXXXX`, em maiusculas. */
export const FORMATO_DO_IDENTIFICADOR = /^CI-\d{4}-[23456789ABCDEFGHJKLMNPQRSTVWXYZ]{6}$/;

/**
 * Ano e mes no fuso de Brasilia, que e onde o provedor e o suporte estao.
 *
 * `getMonth()` cru devolveria o mes do SERVIDOR, e a VPS roda em UTC: as 21h
 * do dia 30 em Brasilia ja e dia 1 do mes seguinte em UTC, e o codigo sairia
 * apontando para o mes errado — justo o campo que existe para orientar a busca.
 */
function anoMes(agora: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", year: "2-digit", month: "2-digit",
  }).formatToParts(agora);
  const ano = partes.find(p => p.type === "year")?.value ?? "00";
  const mes = partes.find(p => p.type === "month")?.value ?? "00";
  return `${ano}${mes}`;
}

/**
 * Seis caracteres sorteados, sem vies.
 *
 * `byte % 31` pareceria suficiente e nao e: 256 nao e multiplo de 31, entao os
 * primeiros simbolos do alfabeto sairiam com mais frequencia que os ultimos.
 * O sorteio descarta os bytes da faixa que sobra e tenta de novo — e o custo
 * disso e desprezivel diante de nao ter um codigo enviesado.
 */
function sorteio(): string {
  const limite = Math.floor(256 / ALFABETO.length) * ALFABETO.length;
  let saida = "";
  while (saida.length < TAMANHO_DO_SORTEIO) {
    // Indice, e nao `for...of`: o alvo do tsconfig nao itera Buffer sem a flag
    // `downlevelIteration`, e ligar uma flag de compilacao por causa de um laco
    // seria trocar o custo de lugar.
    const bytes = randomBytes(TAMANHO_DO_SORTEIO * 2);
    for (let i = 0; i < bytes.length && saida.length < TAMANHO_DO_SORTEIO; i++) {
      const byte = bytes[i];
      if (byte >= limite) continue;
      saida += ALFABETO[byte % ALFABETO.length];
    }
  }
  return saida;
}

/** Um identificador novo. Cada chamada devolve outro. */
export function gerarIdentificadorDeConsulta(agora: Date = new Date()): string {
  return `${PREFIXO}-${anoMes(agora)}-${sorteio()}`;
}

/**
 * O que o provedor digitou virando um identificador, ou `null`.
 *
 * Quem cola um codigo no suporte cola com espaco, em minusculas, as vezes sem
 * os tracos. Recusar isso obrigaria a pessoa a acertar a digitacao de um codigo
 * que ela nao escolheu. O que NAO se aceita e trocar caractere parecido por
 * outro: `0` nao vira `O` — o alfabeto nao tem nenhum dos dois, entao um codigo
 * com eles esta errado de verdade e dizer isso e melhor que adivinhar.
 */
export function normalizarIdentificador(entrada: string | null | undefined): string | null {
  const cru = String(entrada ?? "").trim().toUpperCase().replace(/[\s.]/g, "");
  if (!cru) return null;

  const comTracos = FORMATO_DO_IDENTIFICADOR.test(cru)
    ? cru
    : /^CI\d{4}[23456789ABCDEFGHJKLMNPQRSTVWXYZ]{6}$/.test(cru)
      ? `${cru.slice(0, 2)}-${cru.slice(2, 6)}-${cru.slice(6)}`
      : null;

  return comTracos;
}

export function ehIdentificadorDeConsulta(valor: string | null | undefined): boolean {
  return normalizarIdentificador(valor) !== null;
}

// ── O protocolo da origem ────────────────────────────────────────────────────

/** De quem e o protocolo, para a tela poder dizer a quem reclamar. */
export type OrigemDaConsulta = "isp" | "spc" | "cadastral";

export interface ProtocoloDaOrigem {
  /** "SPC Brasil", "BigDataCorp" — quem emitiu. */
  origem: string;
  /** O numero como a origem o escreveu, sem reformatar. */
  protocolo: string;
}

/**
 * O protocolo que a ORIGEM do dado ja devolvia e ninguem mostrava.
 *
 * Descoberto olhando o que esta gravado: a BigDataCorp devolve um `QueryId`
 * (UUID) que fica em `result.bruto.QueryId`, e o SPC devolve um `protocolo`
 * no topo do resultado. Os dois estavam guardados e invisiveis.
 *
 * Isso importa quando o problema NAO e do Consulta ISP: se o dado cadastral
 * veio errado, quem resolve e a BigDataCorp, e ela pede o QueryId dela. Sem
 * este numero na tela, escalar significava abrir o banco e cavar o JSON.
 *
 * A consulta ISP nao tem protocolo de origem porque nao ha origem externa: o
 * score sai da rede de provedores, calculado aqui.
 */
export function protocoloDaOrigem(tipo: OrigemDaConsulta, resultado: unknown): ProtocoloDaOrigem | null {
  if (!resultado || typeof resultado !== "object") return null;
  const r = resultado as Record<string, any>;

  if (tipo === "cadastral") {
    const id = r?.bruto?.QueryId ?? r?.bruto?.queryId ?? r?.QueryId;
    return typeof id === "string" && id.trim() ? { origem: "BigDataCorp", protocolo: id.trim() } : null;
  }

  if (tipo === "spc") {
    const p = r?.protocolo;
    return typeof p === "string" && p.trim() ? { origem: "SPC Brasil", protocolo: p.trim() } : null;
  }

  return null;
}
