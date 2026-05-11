import { useMutation } from "@tanstack/react-query";

export interface DossieParams {
  customerId: number;
  from?: string;
  to?: string;
  format: "pdf" | "json";
}

/**
 * Mutation que baixa o dossiê. Para PDF, inicia download via blob URL.
 * Para JSON, retorna o objeto parseado.
 */
export function useDossie() {
  return useMutation({
    mutationFn: async (params: DossieParams) => {
      const q = new URLSearchParams();
      if (params.from) q.set("from", params.from);
      if (params.to) q.set("to", params.to);
      q.set("format", params.format);

      const r = await fetch(`/api/dossie/cliente/${params.customerId}?${q.toString()}`, {
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "request_failed" }));
        throw new Error(err?.message ?? err?.error ?? "Falha ao gerar dossiê");
      }

      if (params.format === "pdf") {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dossie-${params.customerId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return { ok: true };
      }

      return r.json();
    },
  });
}
