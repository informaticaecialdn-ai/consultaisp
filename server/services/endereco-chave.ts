/**
 * Identidade de endereço para o cruzamento da consulta.
 *
 * O cruzamento antigo era chaveado por CEP: `sha256(cep:numero)`. Medido na
 * produção em 27/08/2026, isso deixava de fora **39% da carteira da NsLink** —
 * 1.237 de 3.214 clientes sem CEP de 8 dígitos. E CEP errado é pior que CEP
 * ausente: o de uma cidade inteira, o do centro, o que o atendente digitou para
 * o campo aceitar. Em cidade pequena metade do cadastro carrega o CEP geral.
 *
 * Aqui o endereço é identificado pelo que o operador de fato conhece e o ERP de
 * fato guarda: **logradouro, número, bairro e cidade**. O CEP entra só como
 * reforço quando existe nos dois lados, nunca como requisito.
 *
 * A normalização reaproveita o que já foi validado no trabalho de localização
 * (`logradouro.ts`, `localidade.ts`): "Av. Tiradentes", "AVENIDA TIRADENTES" e
 * "av tiradentes" viram a mesma chave, e o número grudado no logradouro —
 * "Rua Mato Grosso, 1435 - Centro, Londrina", que é como o MK devolve — é
 * separado antes da comparação.
 */
import { createHash } from "crypto";
import { chaveLogradouro, numeroDoEndereco, separarLogradouroENumero } from "./logradouro";
import { normalizarLocalidade } from "./localidade";

export interface EnderecoBruto {
  address?: string | null;
  addressNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

export interface ChaveEndereco {
  logradouro: string;
  numero: number;
  cidade: string;
  uf: string;
  /** Pode ser "" — bairro ausente é comum e não invalida o endereço. */
  bairro: string;
}

/**
 * Extrai a chave. Devolve `null` quando falta o mínimo para afirmar que dois
 * cadastros são o mesmo imóvel: logradouro, número e cidade.
 *
 * Número zero ou vazio conta como ausente — no ERP o "0" é o que se digita
 * quando não se sabe, e agrupar por ele juntaria a cidade inteira num endereço
 * só.
 */
export function chaveDeEndereco(e: EnderecoBruto): ChaveEndereco | null {
  const { logradouro, numero } = separarLogradouroENumero(e.address, e.addressNumber);
  const num = numero ?? numeroDoEndereco(e.addressNumber);
  const cidade = normalizarLocalidade(e.city);

  if (!logradouro || !num || !cidade) return null;

  return {
    logradouro: chaveLogradouro(logradouro),
    numero: num,
    cidade,
    uf: normalizarLocalidade(e.state).slice(0, 2),
    bairro: normalizarLocalidade(e.neighborhood),
  };
}

/**
 * A parte que define o imóvel: logradouro, número e cidade.
 *
 * Bairro e UF ficam de fora — os dois são frequentemente ausentes no cadastro, e
 * só servem para DESEMPATAR quando ambos os lados os declaram (ver
 * `mesmoEndereco`). Pô-los aqui separaria "Rua X, 100, Londrina" de
 * "Rua X, 100, Londrina/PR" só porque um dos cadastros não preencheu o estado —
 * exatamente o falso negativo que esconde uma pendência.
 */
function raiz(k: ChaveEndereco): string {
  return `${k.logradouro}|${k.numero}|${k.cidade}`;
}

/**
 * Dois endereços são o mesmo imóvel?
 *
 * Logradouro, número, cidade e UF têm que bater. O bairro só DESEMPATA: quando
 * os dois cadastros o informam e discordam, são endereços diferentes — a mesma
 * cidade pode ter "Rua das Flores, 100" no Centro e outra no Jardim Nova
 * Esperança. Quando um dos lados não informa, não separa: ausência de bairro é
 * cadastro incompleto, não prova de que é outro lugar. Separar nesse caso
 * produziria o pior erro possível aqui — deixar de mostrar uma pendência que
 * existe no endereço.
 */
export function mesmoEndereco(a: ChaveEndereco, b: ChaveEndereco): boolean {
  if (raiz(a) !== raiz(b)) return false;
  if (a.bairro && b.bairro && a.bairro !== b.bairro) return false;
  // UF segue a mesma regra do bairro: separa quando os dois declaram e
  // discordam, nunca por ausência.
  if (a.uf && b.uf && a.uf !== b.uf) return false;
  return true;
}

/**
 * Agrupa cadastros por imóvel.
 *
 * Duas passadas, porque a regra do bairro não cabe numa chave de hash: primeiro
 * agrupa pela raiz, depois quebra o grupo por bairro quando há mais de um bairro
 * declarado ali dentro. Quem não declarou bairro fica com o grupo majoritário —
 * é o desfecho que mantém a pendência visível.
 */
export function agruparPorEndereco<T>(
  itens: T[],
  extrair: (item: T) => EnderecoBruto,
): Array<{ chave: ChaveEndereco; itens: T[] }> {
  const porRaiz = new Map<string, Array<{ item: T; chave: ChaveEndereco }>>();

  for (const item of itens) {
    const chave = chaveDeEndereco(extrair(item));
    if (!chave) continue;
    const r = raiz(chave);
    const lista = porRaiz.get(r) ?? [];
    lista.push({ item, chave });
    porRaiz.set(r, lista);
  }

  const saida: Array<{ chave: ChaveEndereco; itens: T[] }> = [];
  for (const lista of Array.from(porRaiz.values())) {
    const bairros = Array.from(new Set(lista.map(l => l.chave.bairro).filter(Boolean)));

    if (bairros.length <= 1) {
      saida.push({ chave: { ...lista[0].chave, bairro: bairros[0] ?? "" }, itens: lista.map(l => l.item) });
      continue;
    }

    // Mais de um bairro na mesma rua e número: são imóveis diferentes.
    const contagem = new Map<string, number>();
    for (const l of lista) if (l.chave.bairro) contagem.set(l.chave.bairro, (contagem.get(l.chave.bairro) ?? 0) + 1);
    const majoritario = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1])[0][0];

    for (const bairro of bairros) {
      const doBairro = lista.filter(l =>
        l.chave.bairro === bairro || (!l.chave.bairro && bairro === majoritario));
      if (doBairro.length > 0) {
        saida.push({ chave: { ...doBairro[0].chave, bairro }, itens: doBairro.map(l => l.item) });
      }
    }
  }
  return saida;
}

/**
 * Hash salgado da chave, para trafegar entre provedores sem expor o endereço.
 *
 * Mesmo salt e mesmo propósito de `utils/address-hash.ts` — o que muda é o que
 * entra: lá era CEP + número, aqui é o endereço por extenso.
 */
export function hashEndereco(k: ChaveEndereco, salt: string): string {
  return createHash("sha256")
    .update(`${raiz(k)}|${k.bairro}${salt}`)
    .digest("hex");
}
