import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AsaasAccountResponse {
  connected: boolean;
  mode?: "sandbox" | "production";
  accountStatus?: string;
  lastUsedAt?: string | null;
  maskedApiKey?: string | null;
}

export function useAsaasAccount() {
  return useQuery<AsaasAccountResponse>({
    queryKey: ["/api/asaas/account"],
    queryFn: () =>
      fetch("/api/asaas/account", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar conta Asaas");
        return r.json();
      }),
    staleTime: 30_000,
  });
}

export function useConnectAsaas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { apiKey: string; webhookToken: string }) => {
      const r = await fetch("/api/asaas/account", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.message ?? data?.error ?? "Falha ao conectar Asaas");
      }
      return data as AsaasAccountResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/asaas/account"] });
    },
  });
}

export function useDisconnectAsaas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/asaas/account", {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) {
        throw new Error("Falha ao desconectar");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/asaas/account"] });
      qc.invalidateQueries({ queryKey: ["/api/regua/agente-config"] });
    },
  });
}
