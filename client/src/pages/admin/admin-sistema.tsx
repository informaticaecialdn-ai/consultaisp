import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Shield, ShieldOff } from "lucide-react";
import { CabecalhoPainel, PilulaCabecalho } from "@/components/painel/ui";
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
      <div
        className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center"
        data-testid="admin-acesso-restrito"
      >
        {/* Aqui --danger e legitimo: nao e "quem voce e", e uma porta fechada. */}
        <div className="w-10 h-10 rounded-lg grid place-items-center bg-[var(--danger-bg)]">
          <ShieldOff className="w-5 h-5 text-[var(--danger)]" strokeWidth={2} />
        </div>
        <h2 className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
          Acesso restrito
        </h2>
        <p className="text-[13px] text-[var(--text-muted)] max-w-[46ch] leading-snug">
          Esta área é exclusiva para administradores do sistema Consulta ISP.
        </p>
      </div>
    );
  }

  const meta = PAGE_META[activeTab] || PAGE_META.painel;

  return (
    <div className="p-4 lg:p-6 space-y-6" data-testid="admin-sistema-page">
      {/* Mesmo cabecalho do Painel do Provedor, pela mesma primitiva: titulo leve
          com tracking apertado, descricao muted e pilulas a direita. */}
      <CabecalhoPainel
        titulo={meta.title}
        descricao={meta.desc}
        acoes={
          /* O selo de papel usa o tom `neutro` — o MESMO da pilula "seu codigo"
             do provedor. Papel e identificador, e o que se le e se dita ao
             suporte; nao e estado do sistema. O vermelho anterior
             (--color-danger) prometia erro em tempo integral, e a pele reserva
             saturacao para risco. `--info` foi considerado e descartado: azure
             ainda e "informacao com voz propria", e aqui a voz certa e a mesma
             do identificador do outro painel — e assim que os dois passam a
             parecer o mesmo produto. */
          <PilulaCabecalho
            Icone={Shield}
            valor="Super Admin"
            rotulo="seu acesso"
            testId="selo-super-admin"
            titleAtributo="Você está autenticado como administrador da plataforma: enxerga todos os provedores, não apenas um."
          />
        }
      />

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
