import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface WhatsappAccountResponse {
  connected: boolean;
  wabaId?: string;
  phoneNumberId?: string;
  displayName?: string | null;
  qualityRating?: string | null;
  wabaStatus?: string | null;
  tokenExpiresAt?: string | null;
  verifiedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export function useWhatsappAccount() {
  return useQuery<WhatsappAccountResponse>({
    queryKey: ["/api/provider/whatsapp/account"],
    queryFn: () =>
      fetch("/api/provider/whatsapp/account", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar conta WhatsApp");
        return r.json();
      }),
    staleTime: 60_000,
  });
}

export function useDisconnectWhatsapp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch("/api/provider/whatsapp/disconnect", {
        method: "POST",
        credentials: "include",
      }).then((r) => {
        if (!r.ok) throw new Error("Falha ao desconectar");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/whatsapp/account"] });
    },
  });
}

export interface WhatsappTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: unknown[];
}

export function useWhatsappTemplates(enabled = true) {
  return useQuery<WhatsappTemplate[]>({
    queryKey: ["/api/provider/whatsapp/templates"],
    queryFn: () =>
      fetch("/api/provider/whatsapp/templates", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar templates");
        return r.json();
      }),
    enabled,
    staleTime: 5 * 60_000,
  });
}
