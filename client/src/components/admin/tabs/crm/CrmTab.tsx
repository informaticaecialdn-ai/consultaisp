import { useState, useEffect } from "react";

import CrmDashboardTab from "./CrmDashboardTab";
import CrmLeadsTab from "./CrmLeadsTab";
import CrmPipelineTab from "./CrmPipelineTab";
import CrmConversasTab from "./CrmConversasTab";
import CrmAgentesTab from "./CrmAgentesTab";
import CrmProspeccaoTab from "./CrmProspeccaoTab";
import CrmTreinamentoTab from "./CrmTreinamentoTab";

const CRM_SUB_TABS = [
  { key: "crm-dashboard", label: "Dashboard" },
  { key: "crm-leads", label: "Leads" },
  { key: "crm-pipeline", label: "Pipeline" },
  { key: "crm-conversas", label: "Conversas" },
  { key: "crm-agentes", label: "Agentes" },
  { key: "crm-prospeccao", label: "Prospeccao" },
  { key: "crm-treinamento", label: "Treinamento" },
] as const;

type CrmSubTab = (typeof CRM_SUB_TABS)[number]["key"];

export default function CrmTab() {
  const [activeSubTab, setActiveSubTab] = useState<CrmSubTab>("crm-dashboard");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (CRM_SUB_TABS.some(t => t.key === hash)) {
      setActiveSubTab(hash as CrmSubTab);
    }
    const onHashChange = () => {
      const h = window.location.hash.replace("#", "");
      if (CRM_SUB_TABS.some(t => t.key === h)) {
        setActiveSubTab(h as CrmSubTab);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {CRM_SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveSubTab(tab.key);
              window.location.hash = tab.key;
            }}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeSubTab === tab.key
                ? "bg-[var(--color-navy)] text-white"
                : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === "crm-dashboard" && <CrmDashboardTab />}
      {activeSubTab === "crm-leads" && <CrmLeadsTab />}
      {activeSubTab === "crm-pipeline" && <CrmPipelineTab />}
      {activeSubTab === "crm-conversas" && <CrmConversasTab />}
      {activeSubTab === "crm-agentes" && <CrmAgentesTab />}
      {activeSubTab === "crm-prospeccao" && <CrmProspeccaoTab />}
      {activeSubTab === "crm-treinamento" && <CrmTreinamentoTab />}
    </div>
  );
}
