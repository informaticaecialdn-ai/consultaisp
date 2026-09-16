/**
 * Separa, na rodada de primeiros contatos, a recusa que é DESTE candidato da
 * falha que é do transporte.
 *
 * Recusa definitiva: o Chat BullQ respondeu 4xx à abertura da conversa
 * ("Este número não tem WhatsApp.", telefone inválido) ou a ponte recusou antes
 * de chamar (cadastro sem telefone, caso que sumiu). Insistir no mesmo
 * candidato não muda nada — em 16/09/2026 a rodada da NsLink parou 25 vezes
 * seguidas, uma por minuto, no mesmo caso, e nenhum outro cliente foi contatado.
 *
 * Tudo o mais (timeout, 5xx, chat desligado, canal em troca, conflito de
 * configuração, cota) continua sendo "não confirmado": a rodada para e tenta
 * de novo na próxima, como sempre foi.
 *
 * Lê `codigo`/`status` pela forma, não pela classe: os testes trocam a ponte
 * inteira por um mock, e um `instanceof` contra a classe mockada mentiria.
 */
export function recusaDefinitivaDoContato(erro: unknown): string | null {
  if (!erro || typeof erro !== "object") return null;
  const e = erro as { codigo?: unknown; status?: unknown; message?: unknown };
  if (typeof e.codigo !== "string") return null;
  const mensagem = typeof e.message === "string" && e.message ? e.message : e.codigo;
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) return mensagem;
  if (e.codigo === "SEM_TELEFONE" || e.codigo === "CASO_NAO_ENCONTRADO") return mensagem;
  return null;
}
