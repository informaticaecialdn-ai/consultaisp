import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Users,
  Wifi,
  DollarSign,
  AlertTriangle,
  Search,
  ShieldAlert,
  Settings,
  UserPlus,
  RefreshCw,
  CreditCard,
} from "lucide-react";

export default function DashboardPage() {
  const { provider } = useAuth();
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: defaulters } = useQuery<any[]>({
    queryKey: ["/api/defaulters"],
  });

  const now = new Date();
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="dashboard-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="default" className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 gap-1.5 px-3 py-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            Creditos ISP: {stats?.ispCredits ?? "..."}
          </Badge>
          <Badge variant="default" className="bg-gradient-to-r from-pink-500 to-rose-500 text-white border-0 gap-1.5 px-3 py-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            Creditos SPC: {stats?.spcCredits ?? "..."}
          </Badge>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-card-border p-4">
        <p className="text-sm font-medium">Ultima atualizacao: {timeStr}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Os dados serao recarregados automaticamente quando houver modificacoes nos indicadores
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </Card>
          ))
        ) : (
          <>
            <Card className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200/50 dark:border-blue-800/30">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-sm text-muted-foreground font-medium">Total de Clientes</span>
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-total-customers">{stats?.totalCustomers}</p>
              <p className="text-xs text-muted-foreground mt-1">Inadimplentes</p>
            </Card>
            <Card className="p-5 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200/50 dark:border-emerald-800/30">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-sm text-muted-foreground font-medium">Equipamentos</span>
                <Wifi className="w-5 h-5 text-emerald-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-equipment-value">
                R$ {Number(stats?.equipmentValue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.totalEquipment} equipamentos</p>
            </Card>
            <Card className="p-5 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200/50 dark:border-orange-800/30">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-sm text-muted-foreground font-medium">Total do Mes</span>
                <DollarSign className="w-5 h-5 text-orange-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-monthly-revenue">
                R$ {Number(stats?.monthlyRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Faturas recebidas este mes</p>
            </Card>
            <Card className="p-5 bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/30 dark:to-rose-900/20 border-rose-200/50 dark:border-rose-800/30">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-sm text-muted-foreground font-medium">Debitos Acumulados</span>
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <p className="text-3xl font-bold" data-testid="text-overdue-total">
                R$ {Number(stats?.overdueTotal || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Dividas acumuladas</p>
            </Card>
          </>
        )}
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            </div>
            <h2 className="text-lg font-semibold">Mapa de Inadimplencia</h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Meu Provedor
            </Badge>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>{provider?.name}</span>
          </div>
          <span className="text-sm font-medium" data-testid="text-defaulter-count">
            {stats?.defaulters || 0} clientes inadimplentes
          </span>
        </div>

        <div className="bg-muted/50 rounded-lg p-8 flex items-center justify-center text-muted-foreground text-sm">
          <MapPin className="w-5 h-5 mr-2" />
          Mapa disponivel com integracao Google Maps
        </div>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          Acoes Rapidas
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/consulta-isp">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-3">
                <Search className="w-7 h-7 text-blue-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-consultar-clientes">Consultar Clientes</span>
            </Card>
          </Link>
          <Link href="/anti-fraude">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-3">
                <ShieldAlert className="w-7 h-7 text-rose-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-anti-fraude">Anti-Fraude</span>
            </Card>
          </Link>
          <Link href="/administracao">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-3">
                <Settings className="w-7 h-7 text-amber-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-equipamentos">Equipamentos</span>
            </Card>
          </Link>
          <Link href="/inadimplentes">
            <Card className="p-6 text-center cursor-pointer hover-elevate">
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                <UserPlus className="w-7 h-7 text-emerald-600" />
              </div>
              <span className="text-sm font-medium" data-testid="link-novo-cliente">Novo Cliente</span>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}

function MapPin({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
