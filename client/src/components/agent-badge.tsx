/**
 * AgentBadge — exibe um dos 10 funcionários digitais Provedor.ai com avatar
 * de iniciais (Fraunces), cor canônica (DESIGN.md §5.1) e status opcional.
 *
 * Usado em:
 * - Página /time (variant="large")
 * - Timeline de comunicações (variant="small")
 * - Audit log inline (variant="inline")
 * - Cliente dossie (variant="small")
 *
 * Source-of-truth do catálogo (nome, cor, role): shared/types/team.ts
 */

import { cn } from "@/lib/utils";
import { AGENT_CATALOG, type AgentId, type AgentStatus } from "@shared/types/team";

type Variant = "inline" | "small" | "large";

interface AgentBadgeProps {
  agentId: AgentId;
  variant?: Variant;
  /** Mostra dot de status (verde online / cinza training / vermelho offline). */
  status?: AgentStatus;
  /** Override do role exibido (default: pega do catálogo). */
  roleOverride?: string;
  className?: string;
  onClick?: () => void;
}

const SIZE_CLASSES: Record<Variant, { avatar: string; text: string; role: string }> = {
  inline: { avatar: "w-6 h-6 text-[10px]", text: "hidden", role: "hidden" },
  small: { avatar: "w-8 h-8 text-xs", text: "text-sm font-medium", role: "hidden" },
  large: { avatar: "w-12 h-12 text-base", text: "text-base font-semibold", role: "text-xs text-[var(--color-muted)]" },
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  online: "bg-[var(--color-success)]",
  offline: "bg-[var(--color-muted)]",
  training: "bg-[var(--color-brand-amber-500)]",
};

export function AgentBadge({
  agentId,
  variant = "small",
  status,
  roleOverride,
  className,
  onClick,
}: AgentBadgeProps) {
  const agent = AGENT_CATALOG[agentId];
  const sizes = SIZE_CLASSES[variant];
  const isInteractive = !!onClick;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5",
        isInteractive && "cursor-pointer hover:opacity-80 transition-opacity",
        className,
      )}
      onClick={onClick}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
    >
      <div className="relative flex-shrink-0">
        <div
          className={cn(
            "rounded-full flex items-center justify-center font-display font-semibold",
            sizes.avatar,
          )}
          style={{
            backgroundColor: agent.bgVar,
            color: agent.fgVar,
          }}
          aria-label={`${agent.name} — ${agent.role}`}
        >
          {agent.initials}
        </div>
        {status && (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[var(--color-surface)]",
              STATUS_COLORS[status],
              variant === "inline" ? "w-2 h-2" : variant === "small" ? "w-2.5 h-2.5" : "w-3 h-3",
              status === "online" && "animate-pulse",
            )}
            aria-label={status === "online" ? "Ativo" : status === "training" ? "Em treinamento" : "Inativo"}
          />
        )}
      </div>
      {variant !== "inline" && (
        <div className="flex flex-col min-w-0">
          <span className={cn("text-[var(--color-ink)] leading-tight", sizes.text)}>{agent.name}</span>
          <span className={cn("leading-tight", sizes.role)}>{roleOverride ?? agent.role}</span>
        </div>
      )}
    </div>
  );
}
