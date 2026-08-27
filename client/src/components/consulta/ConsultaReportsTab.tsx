import { BarChart3 } from "lucide-react";
import { Kicker } from "./report-ui";

interface Props {
  consultations: any[];
  approvedCount: number;
  rejectedCount: number;
  avgScore: number;
}

function Metrica({ label, valor, cor }: { label: string; valor: string | number; cor?: string }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "12px 14px",
    }}>
      <Kicker style={{ color: "var(--text-muted)" }}>{label}</Kicker>
      <div style={{
        marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 21, fontWeight: 500,
        letterSpacing: "var(--track-tight)", fontVariantNumeric: "tabular-nums",
        color: cor ?? "var(--text)",
      }}>
        {valor}
      </div>
    </div>
  );
}

function LinhaResumo({ label, valor, cor }: { label: string; valor: number; cor?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 14px", background: "var(--surface)",
      border: "1px solid var(--border)", borderRadius: 8,
    }}>
      <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{label}</span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
        fontVariantNumeric: "tabular-nums", color: cor ?? "var(--text)",
      }}>
        {valor}
      </span>
    </div>
  );
}

export default function ConsultaReportsTab({ consultations, approvedCount, rejectedCount, avgScore }: Props) {
  if (consultations.length === 0) {
    return (
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "48px 24px", textAlign: "center",
      }}>
        <BarChart3 size={28} style={{ margin: "0 auto 12px", color: "var(--text-faint)" }} />
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Realize consultas para ver o resumo</p>
      </div>
    );
  }

  const freeCount = consultations.filter((c: any) => c.cost === 0).length;
  const paidCount = consultations.filter((c: any) => c.cost > 0).length;
  const totalSpent = consultations.reduce((s: number, c: any) => s + (c.cost || 0), 0);
  const withAlerts = consultations.filter((c: any) => (c.result as any)?.alerts?.length > 0).length;
  const pctAprov = (approvedCount / consultations.length) * 100;
  const pctRejei = (rejectedCount / consultations.length) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <Metrica label="Total de consultas" valor={consultations.length} />
        <Metrica label="Aprovadas" valor={approvedCount} cor="var(--ok)" />
        <Metrica label="Rejeitadas" valor={rejectedCount} cor="var(--danger)" />
        {/* Escala do motor é 0-1000; o "/100" daqui vinha da versão antiga. */}
        <Metrica label="Score médio" valor={`${avgScore}/1000`} />
      </div>

      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "18px 20px",
      }}>
        <Kicker>Distribuição por sugestão de decisão</Kicker>
        <div style={{
          display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden",
          background: "var(--surface-inset)", marginTop: 12,
        }}>
          {approvedCount > 0 && <div style={{ background: "var(--ok)", width: `${pctAprov}%` }} />}
          {rejectedCount > 0 && <div style={{ background: "var(--danger)", width: `${pctRejei}%` }} />}
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", marginTop: 10,
          fontSize: 12, color: "var(--text-muted)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--ok)" }} />
            Aprovadas ({approvedCount})
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--danger)" }} />
            Rejeitadas ({rejectedCount})
          </span>
        </div>
      </div>

      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "18px 20px",
      }}>
        <Kicker>Créditos e alertas</Kicker>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <LinhaResumo label="Consultas gratuitas" valor={freeCount} cor="var(--ok)" />
          <LinhaResumo label="Consultas pagas" valor={paidCount} />
          <LinhaResumo label="Total de créditos consumidos" valor={totalSpent} />
          <LinhaResumo label="Consultas com alerta anti-fraude" valor={withAlerts} cor="var(--gated)" />
        </div>
      </div>
    </div>
  );
}
