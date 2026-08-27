import { useState, useEffect } from "react";
import { LOADING_STEPS } from "./constants";
import { Kicker } from "./report-ui";

interface Etapa { id: number; label: string; detail: string; duration: number }

interface Props {
  /** Sobrescreve o texto do topo. Sem isso, mantem o da Consulta ISP. */
  titulo?: string;
  subtitulo?: string;
  /**
   * Etapas proprias. A Consulta Cadastral nao bate em ERP nenhum — dizer
   * "Consultando ERPs parceiros" seria mentir sobre a origem do dado na tela
   * do operador.
   */
  etapas?: Etapa[];
  /** Documento consultado, para o kicker "CONSULTANDO 078.594.556-33". */
  documento?: string;
}

/**
 * Espera da consulta — lista de passos, não barra de progresso.
 *
 * A barra de percentual anterior era ficção: o número subia por temporizador,
 * sem relação com o que os ERPs estavam devolvendo. Uma lista de passos diz o
 * que está acontecendo sem prometer um prazo que ninguém pode cumprir.
 */
export default function LoadingCard({ titulo, subtitulo, etapas, documento }: Props = {}) {
  const PASSOS: Etapa[] = etapas ?? LOADING_STEPS;
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 100;
      let cum = 0;
      for (let i = 0; i < PASSOS.length; i++) {
        cum += PASSOS[i].duration;
        if (elapsed < cum) { setCurrentStep(i); break; }
        if (i === PASSOS.length - 1) setCurrentStep(i);
      }
    }, 100);
    return () => clearInterval(tick);
  }, []);

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "22px 24px",
        display: "flex", flexDirection: "column", gap: 4,
      }}
      role="status"
      aria-live="polite"
      data-testid="consulta-loading-card"
    >
      <Kicker style={{ marginBottom: 10 }}>
        {titulo ?? (documento ? `Consultando ${documento}` : "Consultando rede ISP colaborativa")}
      </Kicker>

      {subtitulo && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -6, marginBottom: 8 }}>
          {subtitulo}
        </p>
      )}

      {PASSOS.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
            <div style={
              done
                ? { width: 8, height: 8, borderRadius: 999, background: "var(--ok)", flexShrink: 0 }
                : active
                  ? {
                      width: 10, height: 10, borderRadius: 999, boxSizing: "border-box", flexShrink: 0,
                      border: "2px solid var(--action)", borderTopColor: "transparent",
                      animation: "ci-spin .7s linear infinite",
                    }
                  : { width: 8, height: 8, borderRadius: 999, background: "var(--border-strong)", flexShrink: 0 }
            } />
            <span style={{
              fontSize: 13, flex: 1,
              color: done ? "var(--text-2)" : active ? "var(--text)" : "var(--text-faint)",
              fontWeight: active ? 600 : 400,
            }}>
              {step.label}
            </span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
              letterSpacing: "var(--track-wide)",
              color: done ? "var(--ok)" : "var(--text-faint)",
            }}>
              {done ? "ok" : active ? "…" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
