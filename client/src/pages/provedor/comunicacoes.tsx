import { useState } from "react";
import {
  Card,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  MessageCircle,
  Mail,
  Phone,
  Search,
} from "lucide-react";
import { useCommunications, type CommunicationRow } from "@/hooks/use-communications";

function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `••••${digits.slice(-4)}`;
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "whatsapp") return <MessageCircle className="w-4 h-4 text-green-600" />;
  if (channel === "email") return <Mail className="w-4 h-4 text-blue-600" />;
  if (channel === "sms") return <Phone className="w-4 h-4 text-purple-600" />;
  return <MessageCircle className="w-4 h-4" />;
}

function DirectionIcon({ direction }: { direction: string }) {
  return direction === "inbound" ? (
    <ArrowDownLeft className="w-4 h-4 text-blue-600" />
  ) : (
    <ArrowUpRight className="w-4 h-4 text-green-600" />
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    sent: "bg-blue-100 text-blue-800",
    delivered: "bg-green-100 text-green-800",
    read: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
    received: "bg-purple-100 text-purple-800",
  };
  return <Badge className={map[s] || "bg-gray-100 text-gray-800"}>{s}</Badge>;
}

function truncate(s: string, n = 60) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function ComunicacoesPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CommunicationRow | null>(null);
  const { data, isLoading, isError } = useCommunications(undefined, 100);

  const filtered = (data || []).filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.customerName?.toLowerCase().includes(s) ||
      c.customerPhone?.includes(s) ||
      c.content?.toLowerCase().includes(s) ||
      c.templateName?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Comunicacoes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historico de mensagens trocadas com clientes (WhatsApp, e-mail, SMS).
        </p>
      </div>

      <Card className="p-4">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, telefone, conteudo ou template..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-comunicacoes-search"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-red-600 text-sm py-8 text-center">
            Erro ao carregar comunicacoes.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            {search ? "Nenhum resultado para a busca." : "Nenhuma comunicacao registrada ainda."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="w-[80px]">Canal</TableHead>
                  <TableHead className="w-[80px]">Direcao</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>Conteudo</TableHead>
                  <TableHead className="w-[120px]">Agente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelected(c)}
                    data-testid={`row-comunicacao-${c.id}`}
                  >
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{c.customerName || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {maskPhone(c.customerPhone)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs">
                        <ChannelIcon channel={c.channel} />
                        <span className="capitalize">{c.channel}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DirectionIcon direction={c.direction} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.templateName && (
                        <Badge variant="outline" className="mr-1 text-xs">
                          {c.templateName}
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        {truncate(c.content)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.agentId || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes da Comunicacao</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selected.customerName || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {maskPhone(selected.customerPhone)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Canal</p>
                  <div className="flex items-center gap-1">
                    <ChannelIcon channel={selected.channel} />
                    <span className="capitalize">{selected.channel}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Direcao</p>
                  <p className="capitalize">{selected.direction}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Status</p>
                  <StatusBadge status={selected.status} />
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Criado em</p>
                  <p>{new Date(selected.createdAt).toLocaleString("pt-BR")}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Agente</p>
                  <p>{selected.agentId || "—"}</p>
                </div>
                {selected.templateName && (
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Template</p>
                    <p>{selected.templateName}</p>
                  </div>
                )}
                {selected.externalMessageId && (
                  <div className="col-span-2">
                    <p className="text-xs uppercase text-muted-foreground">External ID (wamid)</p>
                    <code className="text-xs break-all">{selected.externalMessageId}</code>
                  </div>
                )}
                {selected.sentAt && (
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Enviado</p>
                    <p>{new Date(selected.sentAt).toLocaleString("pt-BR")}</p>
                  </div>
                )}
                {selected.deliveredAt && (
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Entregue</p>
                    <p>{new Date(selected.deliveredAt).toLocaleString("pt-BR")}</p>
                  </div>
                )}
                {selected.readAt && (
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Lido</p>
                    <p>{new Date(selected.readAt).toLocaleString("pt-BR")}</p>
                  </div>
                )}
              </div>
              <div className="border-t pt-3">
                <p className="text-xs uppercase text-muted-foreground mb-1">Conteudo</p>
                <div className="bg-muted/50 rounded p-3 whitespace-pre-wrap text-sm">
                  {selected.content}
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Fechar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
