import { QueryClient, QueryFunction } from "@tanstack/react-query";

function handleUnauthorized() {
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error("401: Sessão expirada. Redirecionando para o login...");
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
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
