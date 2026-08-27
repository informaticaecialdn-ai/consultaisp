import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Lock } from "lucide-react";

interface Props {
  open: boolean;
  accepted: boolean;
  onAccept: () => void;
  onCancel: () => void;
  onToggle: (checked: boolean) => void;
}

/** Linha do quadro legal: rótulo fixo à esquerda, texto corrido à direita. */
function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{rotulo}</span>
      <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

export default function LgpdDisclaimerModal({ open, accepted, onAccept, onCancel, onToggle }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent
        className="p-0 gap-0 border-0 sm:max-w-[480px]"
        style={{ background: "transparent", boxShadow: "none" }}
        data-testid="dialog-lgpd-disclaimer"
      >
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, padding: "28px 28px 22px",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          {/* Identidade do aviso */}
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 10, textAlign: "center",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 999,
              background: "var(--brand-soft)", color: "var(--brand-ink)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Lock size={18} />
            </div>
            <div>
              <DialogTitle asChild>
                <div style={{
                  fontSize: 17, fontWeight: 600, letterSpacing: "var(--track-tight)",
                  color: "var(--text)",
                }}>
                  Aviso legal — LGPD.
                </div>
              </DialogTitle>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
                Antes de prosseguir com a consulta na rede colaborativa
              </div>
            </div>
          </div>

          {/* Quadro legal */}
          <div style={{
            background: "var(--surface-2)", border: "1px solid var(--border-faint)",
            borderRadius: 10, padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <Linha rotulo="Base legal">Legítimo interesse — LGPD art. 7º, IX</Linha>
            <Linha rotulo="Finalidade">Análise e proteção ao crédito no âmbito de telecomunicações</Linha>
            <Linha rotulo="Dados tratados">
              Indicadores de adimplência anonimizados; dados pessoais mascarados conforme a LGPD
            </Linha>
          </div>

          {/* Declaração — o portão */}
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: "var(--info-bg)", border: "1px solid var(--info-border)",
            borderRadius: 10, padding: "12px 14px", cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => onToggle(e.target.checked)}
              className="ds-ctl"
              data-testid="lgpd-accept-checkbox"
              style={{ marginTop: 2, width: 15, height: 15, cursor: "pointer", accentColor: "var(--action)" }}
            />
            <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
              Declaro que esta consulta tem finalidade legítima de análise de crédito e estou ciente
              das obrigações da LGPD quanto ao tratamento dos dados obtidos.
            </span>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              onClick={onCancel}
              className="ds-ctl"
              data-testid="lgpd-cancel-btn"
              style={{
                height: 40, borderRadius: 8, cursor: "pointer",
                fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
                background: "var(--surface)", color: "var(--text-2)",
                border: "1px solid var(--border-strong)",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!accepted}
              onClick={onAccept}
              className="ds-ctl"
              data-testid="lgpd-accept-btn"
              style={{
                height: 40, padding: "0 18px", borderRadius: 8, border: "none",
                fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: accepted ? "var(--action)" : "var(--surface-3)",
                color: accepted ? "var(--text-on-brand)" : "var(--text-faint)",
                cursor: accepted ? "pointer" : "not-allowed",
              }}
            >
              Prosseguir com consulta
            </button>
          </div>

          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
            letterSpacing: "var(--track-wide)", color: "var(--text-faint)", textAlign: "center",
          }}>
            Lei nº 13.709/2018 · LGPD
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
