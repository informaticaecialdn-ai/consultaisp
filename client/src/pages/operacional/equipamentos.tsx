import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Equipamento = {
  id: number; customerId: number | null; type: string;
  brand: string | null; model: string | null; serialNumber: string | null;
  status: string; inRecoveryProcess: boolean | null; value: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  installed:   { label: "Em campo",    cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  retido:      { label: "Retido",      cls: "bg-[var(--past-bg)] text-[var(--past)]" },
  em_cobranca: { label: "Em cobrança", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
  devolvido:   { label: "Devolvido",   cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
  baixado:     { label: "Baixado",     cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]" },
};

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Devolvido e baixado saem da conta de exposicao: o aparelho voltou ou foi perdido de vez. */
const EM_RISCO = ["installed", "retido", "em_cobranca"];

function Kpi({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg px-[14px] py-3 border border-[var(--border)]">
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </span>
      <p className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">
        {valor}
      </p>
      {sub && <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export default function EquipamentosPage() {
  const { data = [], isLoading } = useQuery<Equipamento[]>({ queryKey: ["/api/equipment"] });

  const emRisco = data.filter(e => EM_RISCO.includes(e.status));
  const retidos = data.filter(e => e.status === "retido" || e.status === "em_cobranca");
  const exposicao = emRisco.reduce((s, e) => s + (Number(e.value) || 0), 0);
  const emRecuperacao = data.filter(e => e.inRecoveryProcess).length;

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="equipamentos-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
            Equipamentos
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            Comodato em campo e equipamento não devolvido
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-6 py-12 text-center">
          <Package className="w-8 h-8 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
          <h3 className="font-medium text-base text-[var(--text)]">Nenhum equipamento cadastrado</h3>
          <p className="mt-2 mb-6 mx-auto max-w-[46ch] text-sm text-[var(--text-muted)]">
            Se o seu ERP tem cadastro de comodato, o equipamento aparece aqui após a
            sincronização. Caso contrário, importe por planilha ou cadastre manualmente.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Kpi label="Em campo" valor={String(emRisco.length)} sub={`de ${data.length} cadastrados`} />
            <Kpi label="Exposição" valor={brl(exposicao)} sub="valor não devolvido" />
            <Kpi label="Retidos" valor={String(retidos.length)} sub="retido ou em cobrança" />
            <Kpi label="Em recuperação" valor={String(emRecuperacao)} sub="processo aberto" />
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[640px]">
                <thead>
                  <tr>
                    {["Tipo", "Marca / Modelo", "Série", "Valor", "Status"].map(h => (
                      <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2 border-b border-[var(--border-faint)]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map(e => {
                    const s = STATUS[e.status] ?? STATUS.installed;
                    return (
                      <tr key={e.id} className="border-b border-[var(--border-faint)] last:border-b-0" data-testid={`equipamento-${e.id}`}>
                        <td className="px-4 py-2.5 text-[var(--text)]">{e.type}</td>
                        <td className="px-4 py-2.5 text-[var(--text-2)]">{[e.brand, e.model].filter(Boolean).join(" ") || "—"}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-2)]">{e.serialNumber || "—"}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text)]">
                          {e.value ? brl(Number(e.value)) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 rounded ${s.cls}`}>
                            {s.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
