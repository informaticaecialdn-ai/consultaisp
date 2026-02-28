import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import {
  Users,
  Search,
  Filter,
  Download,
  AlertTriangle,
  Phone,
  Mail,
  MessageSquare,
} from "lucide-react";

export default function InadimplentesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: defaulters, isLoading } = useQuery<any[]>({
    queryKey: ["/api/defaulters"],
  });

  const filtered = defaulters?.filter(d =>
    !searchTerm ||
    d.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.cpfCnpj?.includes(searchTerm)
  ) || [];

  const totalDebt = filtered.reduce((acc, d) => acc + Number(d.invoiceValue || 0), 0);

  const getDaysOverdue = (dueDate: string) => {
    const due = new Date(dueDate);
    const now = new Date();
    const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="inadimplentes-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-inadimplentes-title">Inadimplentes</h1>
            <p className="text-sm text-muted-foreground">Gerencie clientes com faturas em atraso</p>
          </div>
        </div>
        <Button variant="secondary" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/30 dark:to-rose-900/20 border-rose-200/50 dark:border-rose-800/30">
          <span className="text-sm text-muted-foreground">Total de Inadimplentes</span>
          <p className="text-2xl font-bold mt-1" data-testid="text-total-defaulters">
            {isLoading ? <Skeleton className="h-7 w-12" /> : [...new Set(filtered.map(f => f.customerId))].length}
          </p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
          <span className="text-sm text-muted-foreground">Faturas em Atraso</span>
          <p className="text-2xl font-bold mt-1">
            {isLoading ? <Skeleton className="h-7 w-12" /> : filtered.length}
          </p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 border-amber-200/50 dark:border-amber-800/30">
          <span className="text-sm text-muted-foreground">Valor Total em Atraso</span>
          <p className="text-2xl font-bold mt-1" data-testid="text-total-debt">
            {isLoading ? <Skeleton className="h-7 w-24" /> : `R$ ${totalDebt.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          </p>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              data-testid="input-search-defaulters"
              placeholder="Buscar por nome ou CPF/CNPJ..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="secondary" className="gap-2">
            <Filter className="w-4 h-4" />
            Filtros
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum inadimplente encontrado</p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CPF/CNPJ</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Dias Atraso</TableHead>
                  <TableHead>Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d, i) => {
                  const days = getDaysOverdue(d.dueDate);
                  return (
                    <TableRow key={`${d.invoiceId}-${i}`} data-testid={`defaulter-row-${d.invoiceId}`}>
                      <TableCell className="font-medium">{d.customerName}</TableCell>
                      <TableCell className="font-mono text-sm">{d.cpfCnpj}</TableCell>
                      <TableCell>{d.city || "-"}</TableCell>
                      <TableCell className="font-medium">
                        R$ {Number(d.invoiceValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>{new Date(d.dueDate).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>
                        <Badge
                          variant={days > 60 ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {days} dias
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" title="Ligar">
                            <Phone className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" title="Email">
                            <Mail className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" title="WhatsApp">
                            <MessageSquare className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
