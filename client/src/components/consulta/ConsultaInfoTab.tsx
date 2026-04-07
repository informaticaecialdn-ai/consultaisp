import { Card } from "@/components/ui/card";
import { Search, Shield, FileText, Building2, MapPin } from "lucide-react";

export default function ConsultaInfoTab() {
  return (
    <Card className="shadow-lg rounded-2xl overflow-hidden" data-testid="tab-content-info">
      <div className="px-6 py-4 flex items-center gap-3">
        <Shield className="w-5 h-5 text-slate-600" />
        <h2 className="text-lg font-semibold text-slate-900">Sobre a Consulta ISP</h2>
      </div>
      <div className="px-6 pb-6 space-y-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <Search className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <p className="text-sm text-blue-900">
            <span className="font-semibold">Busca Inteligente:</span> O sistema detecta automaticamente se voce digitou um{" "}
            <span className="font-semibold">CPF</span> (11 digitos),{" "}
            <span className="font-semibold">CNPJ</span> (14 digitos) ou{" "}
            <span className="font-semibold">CEP</span> (8 digitos).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: FileText,
              label: "CPF",
              digits: "11 digitos",
              example: "Exemplo: 123.456.789-00",
              iconColor: "text-blue-600",
              iconBg: "bg-blue-100",
              border: "border-blue-200",
              headerBg: "bg-blue-50",
              labelColor: "text-blue-700",
            },
            {
              icon: Building2,
              label: "CNPJ",
              digits: "14 digitos",
              example: "Exemplo: 12.345.678/0001-00",
              iconColor: "text-emerald-600",
              iconBg: "bg-emerald-100",
              border: "border-emerald-200",
              headerBg: "bg-emerald-50",
              labelColor: "text-emerald-700",
            },
            {
              icon: MapPin,
              label: "CEP",
              digits: "8 digitos",
              example: "Exemplo: 12345-678",
              iconColor: "text-purple-600",
              iconBg: "bg-purple-100",
              border: "border-purple-200",
              headerBg: "bg-purple-50",
              labelColor: "text-purple-700",
            },
          ].map(t => (
            <div
              key={t.label}
              className={`rounded-xl border ${t.border} overflow-hidden shadow-sm`}
              data-testid={`card-type-${t.label.toLowerCase()}`}
            >
              <div className={`${t.headerBg} px-5 py-4 flex items-center gap-3 border-b ${t.border}`}>
                <div className={`w-9 h-9 rounded-lg ${t.iconBg} flex items-center justify-center`}>
                  <t.icon className={`w-5 h-5 ${t.iconColor}`} />
                </div>
                <span className={`text-base font-semibold ${t.labelColor}`}>{t.label}</span>
              </div>
              <div className="bg-white px-5 py-4">
                <p className="text-sm text-slate-800 font-medium">{t.digits}</p>
                <p className="text-xs text-slate-500 mt-1">{t.example}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
