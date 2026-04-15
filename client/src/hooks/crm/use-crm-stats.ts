import { useQuery } from "@tanstack/react-query";
import { STALE_DASHBOARD } from "@/lib/queryClient";

export function useCrmStats() {
  return useQuery<any>({
    queryKey: ["/api/crm/stats"],
    staleTime: STALE_DASHBOARD,
  });
}

export function useCrmFunil() {
  return useQuery<any[]>({
    queryKey: ["/api/crm/funil"],
    staleTime: STALE_DASHBOARD,
  });
}

export function useCrmMetricasAgentes() {
  return useQuery<any[]>({
    queryKey: ["/api/crm/metricas/agentes"],
    staleTime: STALE_DASHBOARD,
  });
}
