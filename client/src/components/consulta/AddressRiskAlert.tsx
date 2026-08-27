import { AlertTriangle } from "lucide-react";
import { pillStyle } from "./report-ui";

interface AddressRiskAlertProps {
  data: {
    type: string;
    message: string;
    matches: {
      cpfMasked: string;
      overdueRange: string;
      maxDaysOverdue: number;
      status: string;
    }[];
  };
}

/**
 * Inadimplência de OUTROS documentos no mesmo imóvel.
 *
 * O sinal mais forte contra fraude por troca de documento: o CPF consultado
 * pode estar limpo e o endereço não estar. Por isso este bloco vive dentro da
 * seção de endereço do relatório, com a tinta do risco — não como card solto.
 */
export default function AddressRiskAlert({ data }: AddressRiskAlertProps) {
  return (
    <div
      style={{
        marginTop: 12, borderRadius: 10, padding: "14px 16px",
        background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
      }}
      data-testid="address-risk-alert"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <AlertTriangle size={14} style={{ color: "var(--danger)", flexShrink: 0 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "var(--track-wide)",
          color: "var(--danger)",
        }}>
          Alerta de endereço
        </span>
        <span style={{ marginLeft: "auto", ...pillStyle("danger") }}>
          {data.matches.length} {data.matches.length === 1 ? "registro" : "registros"}
        </span>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, marginTop: 8 }}>
        {data.message}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {data.matches.map((match, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 10, flexWrap: "wrap",
              background: "var(--surface)", border: "1px solid var(--danger-border)",
              borderRadius: 8, padding: "8px 12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 12,
                fontVariantNumeric: "tabular-nums", color: "var(--text)",
              }}>
                {match.cpfMasked}
              </span>
              <span style={pillStyle("past")}>{match.status}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 11,
                fontVariantNumeric: "tabular-nums", color: "var(--text-muted)",
              }}>
                {match.maxDaysOverdue}d em atraso
              </span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600,
                fontVariantNumeric: "tabular-nums", color: "var(--money-neg)",
              }}>
                {match.overdueRange}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
