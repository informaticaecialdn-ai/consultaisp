/**
 * As duas coisas que toda tela de verificacao de e-mail precisa fazer certo:
 * pedir outro link, e ir para o lugar onde o login e aceito.
 *
 * As duas estavam espalhadas e cada copia errava de um jeito:
 *
 * - REENVIO: `login.tsx` e `verificar-email.tsx` chamavam a rota por
 *   `apiRequest`, que transforma qualquer resposta ruim em `Error("429: ...")`
 *   e joga fora o status. As duas telas caiam no mesmo `catch` generico
 *   ("Nao foi possivel reenviar") tanto para servidor fora do ar quanto para
 *   limite de tentativas — e o limite e justamente o caso em que o usuario
 *   precisa ouvir "voce JA pediu, espere", nao "deu erro, tente de novo".
 *
 * - REDIRECIONAMENTO: o servidor descobre por qual endereco ESTE provedor
 *   entra (`urlDeEntrada`) e a tela mandava para `/login` no host atual. Quem
 *   abriu o link pelo dominio da plataforma caia numa tela que recusa o login
 *   por desenho, e lia "Email ou senha incorretos" sem ter errado nada.
 *
 * Funcoes puras aqui embaixo para o que da para testar sem DOM.
 */

export interface ResultadoDeReenvio {
  ok: boolean;
  /** Texto pronto para a tela. Sempre preenchido, nunca vazio. */
  mensagem: string;
}

/** Texto util de um corpo de resposta, quando ele tiver algum. */
function textoDoCorpo(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const msg = (corpo as { message?: unknown }).message;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

/**
 * Traduz a resposta da rota de reenvio para o que a tela mostra.
 *
 * Separada do `fetch` de proposito: e a regra, e regra se testa.
 *
 * O 429 nao e erro do sistema — e o limitador dizendo que o pedido anterior
 * saiu. Contar isso como falha faz o usuario pedir de novo em looping e
 * empurra o proprio limite para mais longe.
 */
export function mensagemDeReenvio(
  status: number,
  corpo: unknown,
  minutos?: number | null,
): ResultadoDeReenvio {
  if (status === 429) {
    const espera = minutos && minutos > 0
      ? `Tente de novo em ${minutos} minuto${minutos > 1 ? "s" : ""}.`
      : "Tente de novo em alguns minutos.";
    return { ok: false, mensagem: `Você já pediu um link há pouco. ${espera}` };
  }
  if (status >= 200 && status < 300) {
    return {
      ok: true,
      mensagem: textoDoCorpo(corpo) || "Novo link de verificação enviado. Confira sua caixa de entrada.",
    };
  }
  return {
    ok: false,
    mensagem: textoDoCorpo(corpo) || "Não foi possível reenviar agora. Tente de novo em instantes.",
  };
}

/** Quantos minutos o cabecalho `Retry-After` pede, quando pede em segundos. */
export function minutosDoRetryAfter(cabecalho: string | null): number | null {
  if (!cabecalho) return null;
  const segundos = Number(cabecalho.trim());
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  return Math.ceil(segundos / 60);
}

/**
 * Pede outro link de verificacao.
 *
 * `fetch` cru, e nao `apiRequest`, porque aqui o STATUS e a informacao — ver a
 * nota do 429 no topo do arquivo.
 */
export async function reenviarVerificacao(email: string): Promise<ResultadoDeReenvio> {
  try {
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    const corpo = await res.json().catch(() => null);
    return mensagemDeReenvio(res.status, corpo, minutosDoRetryAfter(res.headers.get("Retry-After")));
  } catch {
    return { ok: false, mensagem: "Sem conexão com o servidor. Tente de novo em instantes." };
  }
}

/**
 * Para onde mandar quem acabou de confirmar o e-mail.
 *
 * `valor` e o `urlDeEntrada` que o SERVIDOR devolveu — o unico que sabe se
 * este provedor entra pelo subdominio dele ou pelo dominio da marca.
 *
 * NUNCA passe aqui algo lido da URL da pagina: seria redirecionamento aberto
 * com a nossa propria tela de sucesso servindo de trampolim. Por isso a funcao
 * tambem descarta o caminho e a query do que recebe e remonta `/login` sobre a
 * ORIGEM — mesmo que o valor chegue sujo, o destino continua sendo uma tela de
 * login, e so.
 */
export function enderecoDeLoginDoServidor(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  let url: URL;
  try {
    url = new URL(valor.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.origin}/login`;
}
