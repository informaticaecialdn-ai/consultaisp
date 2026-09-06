/**
 * O formulário de negociação — estado da caixa, prévia das parcelas e o corpo
 * do `POST /api/cobranca/casos/:id/negociacoes`.
 *
 * A validação de verdade é a do servidor (`validarNegociacao` contra a
 * política gravada, 422 com `violacoes`). A prévia daqui usa a MESMA função
 * com a política que a tela leu, para o funcionário ver a violação antes de
 * apertar o botão — mas o que decide é a resposta da rota, e a tela mostra
 * as violações de lá quando vierem.
 *
 * Dinheiro entra como texto ("1.234,56" ou "1234.56") e sai como número.
 */
import {
  arredondar,
  avaliarPedidoDeAcordo,
  gerarParcelas,
  validarNegociacao,
  type Carteira,
  type OfertaDeAcordo,
  type ParcelaGerada,
  type PedidoDeNegociacao,
  type Politica,
  type TipoDeNegociacao,
} from "@shared/cobranca";

export interface FormNegociacao {
  tipo: TipoDeNegociacao;
  valorNegociado: string;
  entrada: string;
  parcelas: string;
  /** AAAA-MM-DD. */
  primeiroVencimento: string;
  /** Nasce aceita (o cliente já disse sim na ligação) ou fica como proposta. */
  aceita: boolean;
}

/** "1.234,56", "1234,56" e "1234.56" viram 1234.56; vazio e lixo viram null. */
export function lerDinheiro(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const normalizado = /,\d{1,2}$/.test(limpo)
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo.replace(/,/g, "");
  const n = Number(normalizado);
  return Number.isFinite(n) ? arredondar(n) : null;
}

export function formInicial(valorOriginal: number, primeiroVencimento: string): FormNegociacao {
  return {
    tipo: "quitacao_desconto",
    valorNegociado: valorOriginal > 0 ? valorOriginal.toFixed(2).replace(".", ",") : "",
    entrada: "",
    parcelas: "1",
    primeiroVencimento,
    aceita: false,
  };
}

/** Dinheiro para dentro da caixa: 1234.5 vira "1234,50". */
export function escreverDinheiro(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/**
 * Uma OFERTA da política de acordo preenchendo o formulário (0029): o
 * operador clica na oferta em vez de digitar o número que a política já
 * autoriza. `aceita` não vem da oferta — é o operador quem sabe se o cliente
 * disse sim nesta conversa.
 */
export function formDaOferta(oferta: OfertaDeAcordo, atual: FormNegociacao): FormNegociacao {
  return {
    ...atual,
    tipo: oferta.tipo === "a_vista" ? "quitacao_desconto" : "parcelamento",
    valorNegociado: escreverDinheiro(oferta.valor),
    entrada: oferta.entrada > 0 ? escreverDinheiro(oferta.entrada) : "",
    parcelas: String(oferta.parcelas),
    primeiroVencimento: oferta.vencimentos[0] ?? atual.primeiroVencimento,
  };
}

/** O pedido no vocabulário do domínio, ou o campo que falta. */
export function pedidoDoForm(
  form: FormNegociacao,
  valorOriginal: number,
): { ok: true; pedido: PedidoDeNegociacao } | { ok: false; erro: string } {
  const valorNegociado = lerDinheiro(form.valorNegociado);
  if (valorNegociado === null) return { ok: false, erro: "Informe o valor negociado." };
  if (form.tipo !== "parcelamento") {
    return { ok: true, pedido: { tipo: form.tipo, valorOriginal, valorNegociado } };
  }
  const parcelas = Number(form.parcelas);
  if (!Number.isInteger(parcelas) || parcelas < 1) return { ok: false, erro: "Informe o número de parcelas." };
  const entrada = form.entrada.trim() === "" ? 0 : lerDinheiro(form.entrada);
  if (entrada === null) return { ok: false, erro: "A entrada precisa ser um valor." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.primeiroVencimento)) return { ok: false, erro: "Informe o primeiro vencimento." };
  return { ok: true, pedido: { tipo: "parcelamento", valorOriginal, valorNegociado, entrada, parcelas } };
}

export interface PreviaDaNegociacao {
  descontoPct: number;
  /** Só parcelamento; null nas quitações. */
  parcelas: ParcelaGerada[] | null;
  violacoes: string[];
  /** Campo faltando — a prévia não roda e o botão fica travado. */
  erro: string | null;
}

export function previaDaNegociacao(
  form: FormNegociacao,
  valorOriginal: number,
  politica: Pick<Politica, "negociacao"> | null,
): PreviaDaNegociacao {
  const lido = pedidoDoForm(form, valorOriginal);
  if (!lido.ok) return { descontoPct: 0, parcelas: null, violacoes: [], erro: lido.erro };
  const { pedido } = lido;
  const descontoPct = valorOriginal > 0 ? arredondar(((valorOriginal - pedido.valorNegociado) / valorOriginal) * 100) : 0;
  // Sem a política (ainda carregando ou rota fora do ar) a prévia não julga:
  // julgar contra o padrão diria "ok" para o que a política do provedor recusa.
  const violacoes = politica ? (() => { const r = validarNegociacao(politica, pedido); return r.ok ? [] : r.violacoes; })() : [];
  let parcelas: ParcelaGerada[] | null = null;
  if (pedido.tipo === "parcelamento" && pedido.parcelas && (pedido.entrada ?? 0) <= pedido.valorNegociado) {
    parcelas = gerarParcelas(pedido.valorNegociado, pedido.parcelas, pedido.entrada ?? 0, form.primeiroVencimento);
  }
  return { descontoPct, parcelas, violacoes, erro: null };
}

export interface CorpoDaNegociacao {
  tipo: TipoDeNegociacao;
  valorOriginal: number;
  valorNegociado: number;
  entrada?: number;
  parcelas?: number;
  primeiroVencimento?: string;
  aceita: boolean;
}

/** O JSON do POST. Só parcelamento leva entrada, parcelas e vencimento. */
export function corpoDaNegociacao(form: FormNegociacao, valorOriginal: number): CorpoDaNegociacao | null {
  const lido = pedidoDoForm(form, valorOriginal);
  if (!lido.ok) return null;
  const { pedido } = lido;
  if (pedido.tipo !== "parcelamento") {
    return { tipo: pedido.tipo, valorOriginal, valorNegociado: pedido.valorNegociado, aceita: form.aceita };
  }
  return {
    tipo: "parcelamento",
    valorOriginal,
    valorNegociado: pedido.valorNegociado,
    entrada: pedido.entrada ?? 0,
    parcelas: pedido.parcelas,
    primeiroVencimento: form.primeiroVencimento,
    aceita: form.aceita,
  };
}

/**
 * Os motivos pelos quais ESTA proposta vai depender de aprovação, medidos com
 * a mesma função do servidor (`avaliarPedidoDeAcordo`) sobre a política que a
 * tela leu. É prévia, não decisão — quem julga é a rota. Sem carteira, sem
 * atraso ou sem política não há régua, e não prever nada é melhor que prever
 * pela régua errada.
 */
export function excecaoPrevista(
  form: FormNegociacao,
  valorOriginal: number,
  politica: Pick<Politica, "acordo"> | null,
  alvo: { carteira?: Carteira; diasAtraso?: number } | null,
): string[] {
  if (!politica || !alvo?.carteira || alvo.diasAtraso === undefined) return [];
  const lido = pedidoDoForm(form, valorOriginal);
  if (!lido.ok) return [];
  const { pedido } = lido;
  const decisao = avaliarPedidoDeAcordo({
    carteira: alvo.carteira,
    diasAtraso: alvo.diasAtraso,
    valorOriginal,
    valorNegociado: pedido.valorNegociado,
    entrada: pedido.entrada,
    parcelas: pedido.parcelas,
  }, { acordo: politica.acordo });
  return decisao.decisao === "excecao" ? decisao.motivos : [];
}

/* ── O que o servidor respondeu (201) ─────────────────────────────────── */

/**
 * O 201 do POST não é um "ok" mudo: ele diz se a proposta ENTROU como acordo
 * ou se ficou pendente de aprovação. A rota rebaixa a proposta que passou da
 * faixa da política de acordo (`aceita: b.aceita === true && excecao === null`)
 * e devolve `exigeAprovacao` + `motivosDaExcecao` — e é isso que a tela tem de
 * dizer. Escolher a frase pelo checkbox do formulário fazia o toast anunciar
 * "Acordo registrado" para uma proposta que o servidor deixou esperando.
 */
export interface RegistroDaNegociacao {
  exigeAprovacao: boolean;
  motivos: string[];
}

/** Lê o corpo do 201 com desconfiança: corpo estranho vale como "sem exceção". */
export function registroDaResposta(corpo: unknown): RegistroDaNegociacao {
  if (!corpo || typeof corpo !== "object") return { exigeAprovacao: false, motivos: [] };
  const c = corpo as { exigeAprovacao?: unknown; motivosDaExcecao?: unknown };
  const motivos = Array.isArray(c.motivosDaExcecao) ? c.motivosDaExcecao.map(String) : [];
  // Motivo sem a marca também é exceção: a marca é a bandeira, os motivos são
  // o fato — e um deles sem o outro nunca pode virar "acordo registrado".
  return { exigeAprovacao: c.exigeAprovacao === true || motivos.length > 0, motivos };
}

export interface AvisoDoRegistro {
  titulo: string;
  descricao: string;
}

/**
 * O aviso da tela — a verdade da RESPOSTA, não a do checkbox. `contexto` é o
 * "tipo · cliente" que o operador já esperava ver.
 */
export function avisoDoRegistro(registro: RegistroDaNegociacao, aceitaPedida: boolean, contexto: string): AvisoDoRegistro {
  if (!registro.exigeAprovacao) {
    return { titulo: aceitaPedida ? "Acordo registrado" : "Proposta registrada", descricao: contexto };
  }
  const porque = registro.motivos.length > 0
    ? registro.motivos.join(" ")
    : "A proposta passou da faixa da política de acordo desta carteira.";
  return {
    titulo: "Proposta pendente de aprovação",
    descricao: `${porque} Um administrador do provedor precisa aceitá-la para o acordo valer.`,
  };
}

/**
 * As violações de um 422. A rota manda `{ message, violacoes }`, mas
 * `apiRequest` só guarda `status` e `message` (a primeira violação) no erro —
 * então, no 422, a mensagem É a lista quando a lista não veio. Qualquer
 * outro status não é violação de política: é falha, e vai para o toast.
 */
export function violacoesDoErro(erro: unknown): string[] {
  if (!erro || typeof erro !== "object") return [];
  const e = erro as { status?: number; message?: string; violacoes?: unknown };
  if (Array.isArray(e.violacoes)) return e.violacoes.map(String);
  if (typeof e.message === "string") {
    try {
      const json = JSON.parse(e.message) as { violacoes?: unknown };
      if (Array.isArray(json.violacoes)) return json.violacoes.map(String);
    } catch {
      // mensagem simples — não era o corpo do 422
    }
    if (e.status === 422 && e.message.trim() !== "") return [e.message];
  }
  return [];
}
