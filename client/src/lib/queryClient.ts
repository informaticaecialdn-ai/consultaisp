import { QueryClient, QueryFunction } from "@tanstack/react-query";

function handleUnauthorized() {
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

/**
 * O erro que o resto do client recebe quando a resposta não é 2xx.
 *
 * `status` e `codigo` são campos porque a alternativa — que era o que existia —
 * é procurar substring dentro da mensagem, e mensagem é texto para gente ler.
 */
export interface ErroDaApi extends Error {
  status: number;
  /** O `code` do corpo, quando o servidor manda um. */
  codigo?: string;
}

/**
 * A mensagem que chega ao operador.
 *
 * O servidor responde `{ message, code?, ...}` em JSON. A versão anterior jogava
 * `res.text()` cru dentro da mensagem, então um 409 chegava ao toast como
 * `409: {"message":"Este provedor não pode…","code":"…","acessos":3}` — a frase
 * escrita para a pessoa ler, afogada na serialização e num status HTTP que não
 * diz nada a quem está tentando excluir um provedor.
 *
 * O prefixo `409: ` sai junto pelo mesmo motivo. Quem precisa do status agora
 * lê `erro.status`; quem precisa do código, `erro.codigo`.
 */
function erroDaResposta(status: number, corpo: string): ErroDaApi {
  let mensagem = corpo || "";
  let codigo: string | undefined;
  try {
    const json = JSON.parse(corpo);
    if (json && typeof json === "object") {
      if (typeof json.message === "string" && json.message) mensagem = json.message;
      if (typeof json.code === "string" && json.code) codigo = json.code;
    }
  } catch {
    // Corpo que não é JSON (HTML de proxy, texto do Express) vai inteiro para a
    // mensagem: feio, mas é o que existe, e engolir deixaria o operador sem nada.
  }
  const erro = new Error(mensagem || `Erro ${status}`) as ErroDaApi;
  erro.status = status;
  if (codigo) erro.codigo = codigo;
  return erro;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized();
      throw erroDaResposta(401, JSON.stringify({ message: "Sessão expirada. Redirecionando para o login..." }));
    }
    const text = (await res.text()) || res.statusText;
    throw erroDaResposta(res.status, text);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      handleUnauthorized();
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/** staleTime constants by data category (ms) */
export const STALE_DASHBOARD = 30_000;   // 30s — dashboard stats
export const STALE_LISTS = 60_000;       // 1min — customer/consultation lists
export const STALE_SETTINGS = 300_000;   // 5min — settings, ERP config
export const STALE_STATIC = Infinity;    // static data (plans, ERP catalog)

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
