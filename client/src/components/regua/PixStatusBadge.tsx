import { Badge } from "@/components/ui/badge";

const PIX_VARIANT: Record<string, "default" | "success" | "danger" | "gold" | "outline" | "secondary"> = {
  pending: "gold",
  paid: "success",
  expired: "outline",
  cancelled: "secondary",
  refunded: "danger",
};

const PIX_LABEL: Record<string, string> = {
  pending: "Aguardando",
  paid: "Pago",
  expired: "Expirado",
  cancelled: "Cancelado",
  refunded: "Estornado",
};

export function PixStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="outline">—</Badge>;
  const variant = PIX_VARIANT[status] ?? "outline";
  const label = PIX_LABEL[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
