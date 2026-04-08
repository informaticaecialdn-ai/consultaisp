import { Card } from "@/components/ui/card";
import { Search, Shield, FileText, Building2, MapPin } from "lucide-react";

export default function ConsultaInfoTab() {
  return (
    <Card className="rounded overflow-hidden" data-testid="tab-content-info">
      <div className="px-6 py-4 flex items-center gap-3">
        <Shield className="w-5 h-5 text-[var(--color-muted)]" />
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Sobre a Consulta ISP</h2>
      </div>
      <div className="px-6 pb-6 space-y-5">
        <div className="bg-[var(--color-navy-bg)] border border-[var(--color-border)] rounded px-5 py-4 flex items-center gap-3">
          <Search className="w-5 h-5 text-[var(--color-navy)] flex-shrink-0" />
          <p className="text-sm text-[var(--color-ink)]">
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
              iconColor: "text-[var(--color-navy)]",
              iconBg: "bg-[var(--color-navy-bg)]",
              border: "border-[var(--color-border)]",
              headerBg: "bg-[var(--color-navy-bg)]",
              labelColor: "text-[var(--color-navy)]",
            },
            {
              icon: Building2,
              label: "CNPJ",
              digits: "14 digitos",
              example: "Exemplo: 12.345.678/0001-00",
              iconColor: "text-[var(--color-success)]",
              iconBg: "bg-[var(--color-success-bg)]",
              border: "border-[var(--color-border)]",
              headerBg: "bg-[var(--color-success-bg)]",
              labelColor: "text-[var(--color-success)]",
            },
            {
              icon: MapPin,
              label: "CEP",
              digits: "8 digitos",
              example: "Exemplo: 12345-678",
              iconColor: "text-[var(--color-gold)]",
              iconBg: "bg-[var(--color-gold-bg)]",
              border: "border-[var(--color-border)]",
              headerBg: "bg-[var(--color-gold-bg)]",
              labelColor: "text-[var(--color-gold)]",
            },
          ].map(t => (
            <div
              key={t.label}
              className={`rounded border ${t.border} overflow-hidden`}
              data-testid={`card-type-${t.label.toLowerCase()}`}
            >
              <div className={`${t.headerBg} px-5 py-4 flex items-center gap-3 border-b ${t.border}`}>
                <div className={`w-9 h-9 rounded ${t.iconBg} flex items-center justify-center`}>
                  <t.icon className={`w-5 h-5 ${t.iconColor}`} />
                </div>
                <span className={`text-base font-semibold ${t.labelColor}`}>{t.label}</span>
              </div>
              <div className="bg-[var(--color-surface)] px-5 py-4">
                <p className="text-sm text-[var(--color-ink)] font-medium">{t.digits}</p>
                <p className="text-xs text-[var(--color-muted)] mt-1">{t.example}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
