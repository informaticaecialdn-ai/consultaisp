/**
 * Quick win Cliente 360 — cards de Identidade + Cobrança + Equipamentos
 * acima do Health Score no dossiê.
 *
 * Spec completa: specs/012-5-cliente-360-cobranca/spec.md (12 cards, predições
 * ML, régua DNA, score & decisão Marcos, timeline, audit Júlia, etc).
 * Esse painel cobre o MVP — apenas dados que já existem no DB hoje.
 *
 * Princípios aplicados:
 * - CPF/telefone mascarado (LGPD)
 * - Status do contrato visível como badge (Ativo/Cancelado)
 * - Densidade calculada (cards compactos)
 * - Tolerante a equipment/contracts vazios
 */
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { User, MapPin, FileText, Package, AlertCircle, Wifi, Calendar } from "lucide-react";

interface CustomerProfilePanelProps {
  customerId: number;
}

interface ProfileResponse {
  customer: {
    id: number;
    name: string;
    cpfCnpj: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    addressNumber: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    cep: string | null;
    status: string | null;
    paymentStatus: string | null;
    erpSource: string | null;
    riskTier: string | null;
    totalOverdueAmount: string | null;
    maxDaysOverdue: number | null;
    overdueInvoicesCount: number | null;
    lastSyncAt: string | null;
    createdAt: string | null;
  };
  equipment: Array<{
    id: number;
    type: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    mac: string | null;
    status: string;
    value: string | null;
    inRecoveryProcess: boolean | null;
  }>;
  contracts: Array<{
    id: number;
    plan: string;
    value: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
  }>;
}

function maskCpf(raw: string | null): string {
  if (!raw) return "—";
  const clean = raw.replace(/\D/g, "");
  if (clean.length === 11) return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
  if (clean.length === 14) return `**.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
  return clean;
}

function maskPhone(raw: string | null): string {
  if (!raw) return "—";
  const clean = raw.replace(/\D/g, "");
  if (clean.length < 4) return raw;
  return `(${clean.slice(0, 2)}) ****-${clean.slice(-4)}`;
}

function formatBRL(value: string | null): string {
  if (!value) return "R$ 0,00";
  const n = Number(value);
  if (isNaN(n)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return d.toLocaleDateString("pt-BR");
  if (days >= 1) return `há ${days}d`;
  if (hours >= 1) return `há ${hours}h`;
  if (minutes >= 1) return `há ${minutes}min`;
  return "agora";
}

function StatusBadge({ status }: { status: string | null }) {
  const cfg: Record<string, { label: string; className: string }> = {
    active: { label: "Contrato Ativo", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
    cancelled: { label: "Cancelado", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    suspended: { label: "Suspenso", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  };
  const c = cfg[status ?? "active"] ?? cfg.active;
  return <Badge className={`${c.className} border-0 font-semibold`}>{c.label}</Badge>;
}

function RiskBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const cfg: Record<string, { label: string; className: string }> = {
    critical: { label: "Crítico", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
    high: { label: "Alto", className: "bg-amber-100 text-amber-700" },
    medium: { label: "Médio", className: "bg-amber-50 text-amber-600" },
    low: { label: "Baixo", className: "bg-green-100 text-green-700" },
  };
  const c = cfg[tier] ?? cfg.low;
  return <Badge className={`${c.className} border-0 text-xs`}>Risco {c.label}</Badge>;
}

function EquipmentStatusBadge({ status, inRecovery }: { status: string; inRecovery: boolean | null }) {
  const cfg: Record<string, { label: string; className: string }> = {
    installed: { label: "Em uso", className: "bg-green-100 text-green-700" },
    returned: { label: "Devolvido", className: "bg-gray-100 text-gray-600" },
    not_returned: { label: inRecovery ? "Em recuperação" : "Não devolvido", className: "bg-rose-100 text-rose-700" },
    defective: { label: "Defeito", className: "bg-amber-100 text-amber-700" },
  };
  const c = cfg[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return <Badge className={`${c.className} border-0 text-[10px]`}>{c.label}</Badge>;
}

export function CustomerProfilePanel({ customerId }: CustomerProfilePanelProps) {
  const { data, isLoading, error } = useQuery<ProfileResponse>({
    queryKey: [`/api/customers/${customerId}/profile`],
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-32 mb-3" />
            <Skeleton className="h-3 w-full mb-2" />
            <Skeleton className="h-3 w-3/4" />
          </Card>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-4 border-rose-200 bg-rose-50/40">
        <div className="flex items-center gap-2 text-rose-700">
          <AlertCircle className="w-4 h-4" />
          <p className="text-sm">Erro ao carregar perfil do cliente.</p>
        </div>
      </Card>
    );
  }

  const c = data.customer;
  const enderecoCompleto = [
    c.address,
    c.addressNumber ? `nº ${c.addressNumber}` : null,
    c.complement,
    c.neighborhood,
    c.city && c.state ? `${c.city}/${c.state}` : c.city || c.state,
    c.cep ? `CEP ${c.cep}` : null,
  ].filter(Boolean).join(" · ");

  const tempoCliente = c.createdAt ? (() => {
    const meses = Math.floor((Date.now() - new Date(c.createdAt).getTime()) / (30 * 24 * 3600 * 1000));
    if (meses < 1) return "menos de 1 mês";
    if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
    const anos = Math.floor(meses / 12);
    return `${anos} ${anos === 1 ? "ano" : "anos"} e ${meses % 12}m`;
  })() : null;

  return (
    <div className="space-y-3">
      {/* Card 1 — Identidade & Contato */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
            {c.name?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base truncate" data-testid="customer-name">{c.name || "Sem nome"}</h3>
              <StatusBadge status={c.status} />
              <RiskBadge tier={c.riskTier} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <User className="w-3 h-3 flex-shrink-0" />
                <span className="font-mono">{maskCpf(c.cpfCnpj)}</span>
              </div>
              <div className="truncate">
                📞 <span className="font-mono">{maskPhone(c.phone)}</span>
              </div>
              {c.email && (
                <div className="truncate col-span-2">
                  ✉️ {c.email}
                </div>
              )}
              {tempoCliente && (
                <div className="col-span-2 text-[11px] text-muted-foreground/70 mt-1">
                  Cliente há {tempoCliente} · ERP {c.erpSource ?? "manual"}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Card 2 — Localização */}
      {enderecoCompleto && (
        <Card className="p-4">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Localização</p>
              <p className="text-sm">{enderecoCompleto}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Card 3 — Cobrança & Contrato */}
      <Card className="p-4">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cobrança & Contrato</p>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                sync {relativeDate(c.lastSyncAt)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Em aberto</p>
                <p className="text-base font-bold text-rose-600">{formatBRL(c.totalOverdueAmount)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Faturas</p>
                <p className="text-base font-bold">{c.overdueInvoicesCount ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Atraso</p>
                <p className="text-base font-bold">{c.maxDaysOverdue ?? 0}d</p>
              </div>
            </div>
            {data.contracts.length > 0 && (
              <div className="mt-3 pt-3 border-t space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase">Contratos no DB</p>
                {data.contracts.map(ct => (
                  <div key={ct.id} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{ct.plan}</span>
                    <span className="text-muted-foreground">
                      {formatBRL(ct.value)}/mês · {ct.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.contracts.length === 0 && c.status === "cancelled" && (
              <p className="mt-3 pt-3 border-t text-[11px] text-muted-foreground italic">
                Cliente cancelado — sem contrato ativo. Cobranças remanescentes são geralmente
                rescisão, multa ou equipamento em comodato não devolvido.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Card 4 — Equipamentos (se houver) */}
      {data.equipment.length > 0 && (
        <Card className="p-4">
          <div className="flex items-start gap-2">
            <Package className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Equipamentos ({data.equipment.length})
              </p>
              <div className="space-y-1.5">
                {data.equipment.map(eq => (
                  <div key={eq.id} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Wifi className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate">
                        {eq.type} {eq.brand} {eq.model}
                      </span>
                      {eq.serialNumber && (
                        <span className="text-[10px] font-mono text-muted-foreground truncate">
                          SN {eq.serialNumber}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {eq.value && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatBRL(eq.value)}
                        </span>
                      )}
                      <EquipmentStatusBadge status={eq.status} inRecovery={eq.inRecoveryProcess} />
                    </div>
                  </div>
                ))}
              </div>
              {data.equipment.some(eq => eq.status === "not_returned") && (
                <p className="mt-2 pt-2 border-t text-[11px] text-muted-foreground italic">
                  Lucas (recuperação comodato) pode atuar nos equipamentos não devolvidos.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
