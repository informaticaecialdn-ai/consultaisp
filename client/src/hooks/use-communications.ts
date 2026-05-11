import { useQuery } from "@tanstack/react-query";

export interface CommunicationRow {
  id: number;
  providerId: number;
  customerId: number;
  channel: string;
  direction: string;
  templateName: string | null;
  content: string;
  status: string;
  externalMessageId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  agentId: string | null;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
}

export function useCommunications(customerId?: number, limit = 50) {
  const params = new URLSearchParams();
  if (customerId) params.set("customerId", String(customerId));
  params.set("limit", String(limit));

  return useQuery<CommunicationRow[]>({
    queryKey: ["/api/provider/whatsapp/communications", customerId ?? null, limit],
    queryFn: () =>
      fetch(`/api/provider/whatsapp/communications?${params.toString()}`, {
        credentials: "include",
      }).then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar comunicacoes");
        return r.json();
      }),
    staleTime: 30_000,
  });
}
