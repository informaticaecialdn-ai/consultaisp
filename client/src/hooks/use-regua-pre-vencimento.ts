import { useQuery } from "@tanstack/react-query";

export interface ReguaItem {
  attemptId: number;
  step: string;
  status: string;
  scheduledFor: string;
  attemptCount: number;
  nextRetryAt: string | null;
  failureReason: string | null;
  customer: {
    id: number;
    name: string;
    phone: string | null;
    cpfCnpj: string | null;
  } | null;
  invoice: {
    id: number;
    value: string | number;
    dueDate: string;
    status: string;
  } | null;
  pixCharge: {
    id: number;
    asaasPaymentId: string;
    status: string;
    expiresAt: string | null;
    paidAt: string | null;
  } | null;
}

export interface ReguaResponse {
  items: ReguaItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface ReguaFilters {
  from?: string;
  to?: string;
  status?: string;
  step?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(f: ReguaFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  }
  return p.toString();
}

export function useReguaPreVencimento(filters: ReguaFilters = {}) {
  const qs = buildQuery(filters);
  return useQuery<ReguaResponse>({
    queryKey: ["/api/regua/pre-vencimento", qs],
    queryFn: () =>
      fetch(`/api/regua/pre-vencimento?${qs}`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Falha ao carregar régua");
        return r.json();
      }),
    staleTime: 15_000,
  });
}
