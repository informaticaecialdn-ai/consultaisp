import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AgentToggles {
  id: number;
  providerId: number;
  brunoAtivo: boolean;
  sofiaAtiva: boolean;
  schedulerHoraLocal: string;
  janelaInicio: string;
  janelaFim: string;
  permiteSabado: boolean;
  permiteDomingo: boolean;
  templateBrunoNome: string | null;
  templateSofiaNome: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export type AgentTogglesPatch = Partial<Omit<AgentToggles, "id" | "providerId" | "createdAt" | "updatedAt">>;

export function useAgentToggles() {
  return useQuery<AgentToggles>({
    queryKey: ["/api/regua/agente-config"],
    queryFn: () =>
      fetch("/api/regua/agente-config", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar configuração de agentes");
        return r.json();
      }),
    staleTime: 30_000,
  });
}

export function useUpdateAgentToggles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: AgentTogglesPatch) => {
      const r = await fetch("/api/regua/agente-config", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.message ?? data?.error ?? "Falha ao atualizar configuração");
      }
      return data as AgentToggles;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/regua/agente-config"] });
    },
  });
}
