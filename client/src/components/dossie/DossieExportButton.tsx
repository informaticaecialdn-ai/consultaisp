import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDossie } from "@/hooks/use-dossie";
import { FileDown, Loader2 } from "lucide-react";

interface DossieExportButtonProps {
  customerId: number;
  from?: string;
  to?: string;
  format: "pdf" | "json";
  label?: string;
}

export function DossieExportButton({ customerId, from, to, format, label }: DossieExportButtonProps) {
  const dossie = useDossie();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    try {
      await dossie.mutateAsync({ customerId, from, to, format });
    } catch (err) {
      setError((err as Error)?.message ?? "Falha ao gerar dossiê");
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={format === "pdf" ? "default" : "outline"}
        onClick={handleClick}
        disabled={dossie.isPending}
        data-testid={`button-dossie-${format}`}
      >
        {dossie.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="mr-2 h-4 w-4" />
        )}
        {label ?? (format === "pdf" ? "Baixar PDF" : "Baixar JSON")}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
