/**
 * A lógica da conversa no porte do Provedor.ai (Cobrança › Atendimento ›
 * Conversas), separada do desenho para ser provada sem DOM: quem escreveu cada
 * balão, onde começa e termina a corrida, quando a conversa passou de uma voz
 * para outra, como a hora e o dia se escrevem, o negrito e o bloco do
 * WhatsApp, e as contas da ficha do cliente (atraso da fatura, tempo de casa).
 *
 * Tudo aqui trabalha com o que o servidor mandou. Instante ilegível devolve
 * `null` e quem desenha escreve traço — nada é preenchido por palpite.
 */
import type { CanalDaConversa } from "./multicanal";

/* ── Quem escreveu ─────────────────────────────────────────────────────── */

export type AutorDaMensagem = "cliente" | "funcionaria" | "equipe";

/**
 * Entrada é o cliente. Saída com `ia` é a funcionária digital — o fork gravou o
 * agente na mensagem (`metadata.aiAgentId`). Qualquer outra saída foi pela conta
 * do provedor: atendente, primeiro contato, reserva da autonomia. Por isso ela é
 * "equipe" e não "humano": o envio comum não diz se foi gente ou servidor.
 */
export function autorDaMensagem(m: { direcao: string; ia?: boolean }): AutorDaMensagem {
  if (m.direcao !== "OUTBOUND") return "cliente";
  return m.ia === true ? "funcionaria" : "equipe";
}

/* ── Corridas ──────────────────────────────────────────────────────────── */

/** Mensagens seguidas da mesma voz dentro de cinco minutos formam uma corrida. */
export const GRUPO_JANELA_MS = 5 * 60_000;

/** Data ilegível não quebra a corrida: dado ruim não vira desenho errado. */
export function dentroDaJanelaDeGrupo(aIso: string, bIso: string): boolean {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(b - a) < GRUPO_JANELA_MS;
}

export interface MensagemDaCorrida {
  direcao: string;
  canal: CanalDaConversa;
  quem: string | null;
  ia?: boolean;
  em: string;
}

/**
 * A corrida da referência: mesma direção, mesma voz (cliente, funcionária ou
 * equipe, e o mesmo nome) e menos de cinco minutos entre uma e outra. Aqui o
 * canal também separa — SMS e e-mail entram no mesmo histórico do WhatsApp.
 */
export function mesmaCorrida(anterior: MensagemDaCorrida, m: MensagemDaCorrida): boolean {
  return (
    anterior.direcao === m.direcao &&
    anterior.canal === m.canal &&
    autorDaMensagem(anterior) === autorDaMensagem(m) &&
    (anterior.quem ?? "") === (m.quem ?? "") &&
    dentroDaJanelaDeGrupo(anterior.em, m.em)
  );
}

/**
 * "Conversa transferida: Clara → Equipe NsLink". A API não emite o evento; ele é
 * derivado, como na referência, da troca de quem fala pelo provedor entre duas
 * corridas de WhatsApp. Só com os dois nomes conhecidos — sem nome não há o que
 * afirmar — e só no começo de uma corrida de saída.
 */
export function transferenciaAntesDe(
  mensagens: ReadonlyArray<MensagemDaCorrida>,
  i: number,
): { de: string; para: string } | null {
  const m = mensagens[i];
  if (!m || m.direcao !== "OUTBOUND" || m.canal !== "whatsapp" || !m.quem) return null;
  if (i > 0 && mesmaCorrida(mensagens[i - 1], m)) return null;
  for (let j = i - 1; j >= 0; j--) {
    const anterior = mensagens[j];
    if (anterior.direcao !== "OUTBOUND" || anterior.canal !== "whatsapp") continue;
    if (!anterior.quem) return null;
    return anterior.quem !== m.quem ? { de: anterior.quem, para: m.quem } : null;
  }
  return null;
}

/* ── Tempo ─────────────────────────────────────────────────────────────── */

const mesmoDia = (a: Date, b: Date) =>
  a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

/** "Hoje" · "Ontem" · dd/mm/aaaa. Null quando a data não é legível. */
export function rotuloDoDia(iso: string, hoje = new Date()): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  if (mesmoDia(d, hoje)) return "Hoje";
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR");
}

export const NOME_DO_CANAL: Record<CanalDaConversa, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "E-mail",
};

/** O chip único do topo da conversa: o dia e o canal da PRIMEIRA mensagem carregada. */
export function chipDoDia(primeira: { em: string; canal: CanalDaConversa } | undefined, hoje = new Date()): string | null {
  if (!primeira) return null;
  const dia = rotuloDoDia(primeira.em, hoje);
  return dia ? `${dia} · ${NOME_DO_CANAL[primeira.canal]}` : null;
}

/** "14:02" hoje; "dd/mm 14:02" em outro dia — a data mora na hora, não em réguas no meio da conversa. */
export function horaDaMensagem(iso: string, agora = new Date()): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (mesmoDia(d, agora)) return hora;
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${dia} ${hora}`;
}

/* ── O texto do balão ──────────────────────────────────────────────────── */

export type TrechoDoTexto =
  | { tipo: "texto"; valor: string }
  | { tipo: "negrito"; valor: string }
  | { tipo: "bloco"; valor: string };

/**
 * O markdown leve do WhatsApp, como o cliente vê: `*negrito*` e ```bloco mono```
 * (a linha digitável e o PIX copia e cola). Vira dado, não HTML: quem desenha
 * monta nós do React, e nenhum texto do cliente chega ao DOM como marcação.
 */
export function trechosDoTexto(texto: string): TrechoDoTexto[] {
  const trechos: TrechoDoTexto[] = [];
  const padrao = /```([\s\S]+?)```|\*([^*\n]+)\*/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  while ((m = padrao.exec(texto)) !== null) {
    if (m.index > ultimo) trechos.push({ tipo: "texto", valor: texto.slice(ultimo, m.index) });
    if (m[1] !== undefined) trechos.push({ tipo: "bloco", valor: m[1] });
    else trechos.push({ tipo: "negrito", valor: m[2] });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) trechos.push({ tipo: "texto", valor: texto.slice(ultimo) });
  return trechos;
}

/* ── Recibo de entrega ─────────────────────────────────────────────────── */

/** A situação do envio por extenso, como o fork a mandou — o título do recibo e o texto do leitor de tela. */
export const ROTULO_DO_STATUS: Readonly<Record<string, string>> = {
  SENT: "enviada",
  DELIVERED: "entregue",
  READ: "lida",
  QUEUED: "na fila de envio",
  FAILED: "falha no envio",
  RECEIVED: "recebida",
  PENDING: "pendente",
};

/** Status que não está na tabela sai cru: não se traduz o que não se conhece. */
export const rotuloDoStatus = (status: string): string => ROTULO_DO_STATUS[status] ?? status;

export type Recibo = "enviando" | "enviada" | "entregue" | "lida" | "falhou";

/** O ícone do recibo sai do status que o fork mandou; status desconhecido não vira tique. */
export function reciboDoStatus(status: string): Recibo | null {
  switch (status) {
    case "QUEUED":
    case "PENDING":
      return "enviando";
    case "SENT":
      return "enviada";
    case "DELIVERED":
      return "entregue";
    case "READ":
      return "lida";
    case "FAILED":
      return "falhou";
    default:
      return null;
  }
}

/* ── A ficha do cliente ────────────────────────────────────────────────── */

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * "38d atraso" ou "a vencer", contado em dias de calendário a partir do
 * vencimento que o ERP devolveu (AAAA-MM-DD). Vence hoje ainda não é atraso.
 * Vencimento ilegível devolve null — a linha mostra traço, não um atraso chutado.
 */
export function situacaoDaFatura(
  vencimento: string,
  hoje = new Date(),
): { tipo: "atraso"; dias: number } | { tipo: "a_vencer" } | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vencimento);
  if (!partes) return null;
  const venc = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  const dia = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.round((dia - venc) / DIA_MS);
  return dias > 0 ? { tipo: "atraso", dias } : { tipo: "a_vencer" };
}

/** "4 anos" · "1 ano" · "8 meses". Sem data legível, ou com menos de um mês, null. */
export function tempoDeCliente(desde: string | null | undefined, hoje = new Date()): string | null {
  if (!desde) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(desde) ? `${desde}T12:00:00` : desde);
  if (!Number.isFinite(d.getTime())) return null;
  let meses = (hoje.getFullYear() - d.getFullYear()) * 12 + (hoje.getMonth() - d.getMonth());
  if (hoje.getDate() < d.getDate()) meses -= 1;
  if (meses < 1) return null;
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  return `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

/** "Maria da Silva" → "MS": o ladrilho da ficha ignora as partículas de até duas letras. */
export function iniciaisDoLadrilho(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  const fortes = palavras.filter((p) => p.length > 2);
  return (fortes.length ? fortes : palavras)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/* ── O compositor ──────────────────────────────────────────────────────── */

/** Os emojis do compositor da referência: uma grade fixa, sem busca. */
export const EMOJIS_DO_COMPOSITOR = [
  "😊", "🙂", "😉", "🙏", "👍", "👋", "✅", "📌",
  "📅", "⏰", "💳", "🧾", "📄", "📞", "💬", "📶",
  "🏠", "🔧", "📦", "🤝", "💡", "⚠️", "❤️", "😀",
] as const;

/**
 * As mensagens rápidas do compositor: clicar PREENCHE o campo, nunca envia. Hoje
 * é uma por tela — a continuidade que já existia —, porque o Consulta ISP não
 * tem os modelos por selo de pagamento que a referência usa.
 */
export function mensagensRapidas(origem: "cobranca" | "equipamentos"): ReadonlyArray<{ titulo: string; texto: string }> {
  return [
    {
      titulo: "Mensagem de continuidade",
      texto:
        origem === "equipamentos"
          ? "Obrigado por responder. Qual dia e período são melhores para combinar a retirada? Pode confirmar o endereço?"
          : "Obrigado por responder. Vou conferir seu contrato e ajudar com as opções disponíveis.",
    },
  ];
}

/**
 * Enter envia; Shift+Enter quebra a linha; a composição do IME nunca dispara envio.
 *
 * Só com ponteiro fino (mouse, trackpad): teclado de celular e tablet não tem
 * Shift, e lá o Enter continua quebrando a linha — quem envia é o botão. Quem
 * chama lê o ponteiro na hora da tecla; sem a informação, vale a mesa.
 */
export function teclaEnviaMensagem(e: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  ponteiroFino?: boolean;
}): boolean {
  return e.key === "Enter" && !e.shiftKey && e.isComposing !== true && e.ponteiroFino !== false;
}

/** O que o Enter fez enquanto a operação anterior ainda não voltou. */
export type EsperaDoEnvio = "fila" | "aguarde";

/**
 * Envio seguido não trava, como na referência: o Enter durante um ENVIO pendente
 * põe o texto na fila, e ele sai quando o anterior for aceito. Durante assumir ou
 * encerrar não há o que enfileirar — a conversa pode fechar —, então só o aviso.
 * Nunca em silêncio: o Enter que não fazia nada foi o achado da revisão.
 */
export function esperaDoEnvio(pendente: { acao: string } | null | undefined): EsperaDoEnvio | null {
  if (!pendente) return null;
  return pendente.acao === "enviar" ? "fila" : "aguarde";
}

/**
 * A fila só segue se o envio anterior foi ACEITO. Na falha, o texto dele volta ao
 * campo na frente do novo, e quem decide o que mandar é o atendente.
 */
export function filaDoEnvioSegue(
  espera: EsperaDoEnvio | null,
  ultimoEnvio: "ok" | "falhou" | null,
): boolean {
  return espera === "fila" && ultimoEnvio === "ok";
}

export const TEXTO_DA_ESPERA: Record<EsperaDoEnvio, string> = {
  fila: "Na fila: sai assim que o envio anterior for confirmado.",
  aguarde: "Aguarde a operação em andamento para enviar.",
};
