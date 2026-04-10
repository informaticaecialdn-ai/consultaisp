import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import { PAGE_META, VALID_TABS } from "@/components/admin/constants";
import VisaoGeralTab from "@/components/admin/tabs/VisaoGeralTab";
import ProvedoresTab from "@/components/admin/tabs/ProvedoresTab";
import CadastrosTab from "@/components/admin/tabs/CadastrosTab";
import FinanceiroTab from "@/components/admin/tabs/FinanceiroTab";
import SuporteTab from "@/components/admin/tabs/SuporteTab";
import ConfiguracoesTab from "@/components/admin/tabs/ConfiguracoesTab";

/**
 * Legacy tab hash aliases: old deep links that should map to the new 6 tabs.
 * (Usuarios/Integracoes/Sincronizacao/ERPs all collapsed into their new homes.)
 */
const TAB_ALIASES: Record<string, string> = {
  usuarios: "provedores",         // Users are now per-provider (inside drawer)
  integracoes: "provedores",      // ERP config is now per-provider (inside drawer)
  sincronizacao: "painel",        // Auto-sync widget is on the overview
  erps: "configuracoes",          // ERP catalog is now under Configuracoes
};

function resolveTab(hash: string): string {
  const clean = hash.replace("#", "") || "painel";
  if (VALID_TABS.includes(clean as any)) return clean;
  if (TAB_ALIASES[clean]) return TAB_ALIASES[clean];
  return "painel";
}

export default function AdminSistemaPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";

  const [activeTab, setActiveTab] = useState<string>(() =>
    typeof window !== "undefined" ? resolveTab(window.location.hash) : "painel"
  );

  useEffect(() => {
    const onHashChange = () => setActiveTab(resolveTab(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Shield className="w-16 h-16 text-red-500 opacity-40" />
        <h2 className="text-xl font-bold">Acesso Restrito</h2>
        <p className="text-[var(--color-muted)] text-center">
          Esta area e exclusiva para administradores do sistema Consulta ISP.
        </p>
      </div>
    );
  }

  const meta = PAGE_META[activeTab] || PAGE_META.painel;
  const MetaIcon = meta.icon;

  return (
    <div className="p-4 lg:p-6 space-y-5" data-testid="admin-sistema-page">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded ${meta.color} flex items-center justify-center flex-shrink-0`}>
          <MetaIcon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{meta.title}</h1>
          <p className="text-xs text-[var(--color-muted)]">{meta.desc}</p>
        </div>
        <Badge className="ml-auto bg-red-100 text-[var(--color-danger)] dark:bg-red-900 dark:text-red-300 gap-1.5 flex-shrink-0 text-xs">
          <Shield className="w-3 h-3" />Super Admin
        </Badge>
      </div>

      <div>
        {activeTab === "painel" && <VisaoGeralTab />}
        {activeTab === "provedores" && <ProvedoresTab />}
        {activeTab === "cadastros" && <CadastrosTab />}
        {activeTab === "financeiro" && <FinanceiroTab />}
        {activeTab === "suporte" && <SuporteTab />}
        {activeTab === "configuracoes" && <ConfiguracoesTab />}
      </div>
    </div>
  );
}
