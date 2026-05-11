import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "success" | "danger" | "gold" | "outline" | "secondary"> = {
  scheduled: "outline",
  waiting_window: "secondary",
  awaiting_compliance: "gold",
  sent: "success",
  vetoed: "danger",
  failed: "danger",
  needs_human_review: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendado",
  waiting_window: "Fora da janela",
  awaiting_compliance: "Aguardando Júlia",
  sent: "Enviado",
  vetoed: "Vetado",
  failed: "Falhou",
  needs_human_review: "Revisar (humano)",
};

export function EnvioStatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? "outline";
  const label = STATUS_LABEL[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
