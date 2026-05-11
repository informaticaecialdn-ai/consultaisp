import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecks, ChevronLeft, ChevronRight } from "lucide-react";
import { useReguaPreVencimento, type ReguaFilters } from "@/hooks/use-regua-pre-vencimento";
import { PixStatusBadge } from "@/components/regua/PixStatusBadge";
import { EnvioStatusBadge } from "@/components/regua/EnvioStatusBadge";

const PAGE_SIZE = 50;

export default function ReguaPreVencimentoPage() {
  const [filters, setFilters] = useState<ReguaFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  const { data, isLoading, isError } = useReguaPreVencimento(filters);

  const total = data?.pagination.total ?? 0;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? PAGE_SIZE;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function setFilter<K extends keyof ReguaFilters>(key: K, value: ReguaFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value, offset: 0 }));
  }

  function formatBR(value: string | number | null | undefined): string {
    if (value == null) return "—";
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ListChecks className="w-6 h-6" /> Régua Pré-Vencimento
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acompanhe cada execução do Bruno e Sofia. Filtre por status, passo e data.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilter("from", e.target.value || undefined)}
              data-testid="input-filter-from"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilter("to", e.target.value || undefined)}
              data-testid="input-filter-to"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Passo</Label>
            <Select
              value={filters.step ?? "all"}
              onValueChange={(v) => setFilter("step", v === "all" ? undefined : v)}
            >
              <SelectTrigger data-testid="select-filter-step">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="D-3">D-3 (Bruno)</SelectItem>
                <SelectItem value="D-1">D-1 (Bruno)</SelectItem>
                <SelectItem value="THANK_YOU">Agradecimento (Sofia)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={filters.status ?? "all"}
              onValueChange={(v) => setFilter("status", v === "all" ? undefined : v)}
            >
              <SelectTrigger data-testid="select-filter-status">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="scheduled">Agendado</SelectItem>
                <SelectItem value="waiting_window">Fora da janela</SelectItem>
                <SelectItem value="awaiting_compliance">Aguardando Júlia</SelectItem>
                <SelectItem value="sent">Enviado</SelectItem>
                <SelectItem value="vetoed">Vetado</SelectItem>
                <SelectItem value="failed">Falhou</SelectItem>
                <SelectItem value="needs_human_review">Revisar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : isError ? (
          <div className="p-6 text-destructive">Erro ao carregar régua.</div>
        ) : (data?.items?.length ?? 0) === 0 ? (
          <div className="p-6 text-muted-foreground text-center">
            Nenhum item encontrado com os filtros atuais.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Passo</TableHead>
                <TableHead>Pix</TableHead>
                <TableHead>Envio</TableHead>
                <TableHead>Tentativas</TableHead>
                <TableHead>Agendado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.items.map((item) => (
                <TableRow key={item.attemptId} data-testid={`row-attempt-${item.attemptId}`}>
                  <TableCell>
                    <div className="font-medium">{item.customer?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{item.customer?.phone ?? ""}</div>
                  </TableCell>
                  <TableCell>{formatBR(item.invoice?.value)}</TableCell>
                  <TableCell>
                    {item.invoice?.dueDate
                      ? new Date(item.invoice.dueDate).toLocaleDateString("pt-BR")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{item.step}</code>
                  </TableCell>
                  <TableCell>
                    <PixStatusBadge status={item.pixCharge?.status} />
                  </TableCell>
                  <TableCell>
                    <EnvioStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-center">{item.attemptCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(item.scheduledFor).toLocaleString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {offset + 1}–{Math.min(offset + limit, total)} de {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setFilters((prev) => ({ ...prev, offset: Math.max(0, offset - limit) }))}
              data-testid="button-page-prev"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
            </Button>
            <span className="text-sm">
              Página {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setFilters((prev) => ({ ...prev, offset: offset + limit }))}
              data-testid="button-page-next"
            >
              Próxima <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
