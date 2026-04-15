import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";

export function useCrmLeads(filters: Record<string, string> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  return useQuery<any>({
    queryKey: ["/api/crm/leads" + (qs ? `?${qs}` : "")],
    staleTime: STALE_LISTS,
  });
}

export function useCrmLeadDetail(id: number | null) {
  return useQuery<any>({
    queryKey: ["/api/crm/leads/" + id],
    enabled: id !== null,
  });
}

export function useCreateCrmLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/crm/leads", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      qc.invalidateQueries({ queryKey: ["/api/crm/stats"] });
    },
  });
}

export function useUpdateCrmLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/crm/leads/${id}`, data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      qc.invalidateQueries({ queryKey: ["/api/crm/leads/" + variables.id] });
      qc.invalidateQueries({ queryKey: ["/api/crm/stats"] });
    },
  });
}

export function useTransferCrmLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { leadId: number; paraAgente: string; motivo?: string }) => {
      const res = await apiRequest("POST", "/api/crm/transferir", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      qc.invalidateQueries({ queryKey: ["/api/crm/stats"] });
    },
  });
}
