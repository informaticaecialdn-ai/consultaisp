/**
 * Cartão de uma etapa da régua — QUANDO e O QUE o funcionário faz.
 *
 * Janela em dias (D+1 → D+14), a ação escrita para uma pessoa, o canal
 * sugerido, a base legal quando há, o responsável (um usuário do provedor,
 * escolhido pelo admin; vazio = qualquer operador da fila) e quantos casos
 * estão nela hoje. O tom NÃO mora aqui: vem do DNA de cada cliente.
 *
 * O pré-aviso (D-7..D0) fica no catálogo marcado "fase 2": sem fatura a
 * fatura não há vencimento futuro para lembrar, e o motor o pula.
 */
import { CalendarClock, Mail, MapPin, MessageCircle, PhoneCall, Scale, UserRound } from "lucide-react";
import { janelaDaEtapa, ROTULO_CANAL, type CanalHumano, type Etapa } from "@shared/cobranca";
import { cn } from "@/lib/utils";
import { brl, num } from "@/components/localizacao/ui";
import { CONTROLE_CAMPO, type Icone } from "@/components/painel/ui";
import type { MembroDaEquipe } from "./tipos";
import { SeloCobranca, SeloFase2, Traco } from "./ui";

/** Família visual por gravidade da etapa — a mesma escala do selo de atraso. */
const COR_DA_ETAPA: Record<string, string> = {
  lembrete_pre_vencimento: "var(--info)",
  lembrete_atraso: "var(--ok)",
  aviso_suspensao: "var(--gated)",
  negociacao_recuperacao: "var(--gated)",
  pre_negativacao: "var(--past)",
  divida_antiga: "var(--past)",
  fim_de_linha: "var(--danger)",
};

const ICONE_DO_CANAL: Record<CanalHumano, Icone> = {
  telefone: PhoneCall,
  whatsapp: MessageCircle,
  email: Mail,
  presencial: MapPin,
};

export function CartaoEtapa({ etapa, contagem, equipe, podeEditar, onResponsavel, salvando, testId }: {
  etapa: Etapa;
  contagem: { casos: number; valor: number } | null;
  equipe: MembroDaEquipe[];
  podeEditar: boolean;
  onResponsavel?: (userId: number | null) => void;
  salvando?: boolean;
  testId?: string;
}) {
  const cor = COR_DA_ETAPA[etapa.id] ?? "var(--text-muted)";
  const IconeCanal = ICONE_DO_CANAL[etapa.canalSugerido] ?? PhoneCall;
  const responsavel = equipe.find(u => u.id === etapa.responsavelUserId) ?? null;
  const apagada = !etapa.ativa || !etapa.disponivelNaFase1;

  return (
    <article
      className={cn("flex min-w-[220px] flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)]", apagada && "opacity-70")}
      data-testid={testId}
      aria-label={`${etapa.rotulo}, ${janelaDaEtapa(etapa)}`}
    >
      <div className="h-[3px] rounded-t-lg" style={{ background: cor }} aria-hidden />
      <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[12px] font-semibold tabular-nums" style={{ color: cor }}>{janelaDaEtapa(etapa)}</span>
          {!etapa.disponivelNaFase1 && <SeloFase2 />}
          {!etapa.ativa && <SeloCobranca tom="neutro" titulo="Desligada pelo provedor: a etapa seguinte absorve a janela">desligada</SeloCobranca>}
        </div>
        <h3 className="text-[13.5px] font-semibold leading-tight text-[var(--text)]">{etapa.rotulo}</h3>
        <p className="text-[12px] leading-4 text-[var(--text-2)]">{etapa.acao}</p>

        <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
          <dt className="flex items-center gap-1 text-[var(--text-faint)]"><IconeCanal className="h-3 w-3" aria-hidden /> canal</dt>
          <dd className="text-[var(--text-2)]">{ROTULO_CANAL[etapa.canalSugerido]}</dd>
          {etapa.baseLegal && (
            <>
              <dt className="flex items-center gap-1 text-[var(--text-faint)]"><Scale className="h-3 w-3" aria-hidden /> base</dt>
              <dd className="text-[var(--text-2)]">{etapa.baseLegal}</dd>
            </>
          )}
          <dt className="flex items-center gap-1 text-[var(--text-faint)]"><UserRound className="h-3 w-3" aria-hidden /> resp.</dt>
          <dd className="min-w-0">
            {podeEditar && onResponsavel ? (
              <select
                aria-label={`Responsável pela etapa ${etapa.rotulo}`}
                className={cn(CONTROLE_CAMPO, "!min-h-[30px] px-2 text-[11.5px]")}
                value={etapa.responsavelUserId ?? ""}
                disabled={salvando}
                onChange={e => onResponsavel(e.target.value === "" ? null : Number(e.target.value))}
                data-testid={`etapa-responsavel-${etapa.id}`}
              >
                <option value="">qualquer operador</option>
                {equipe.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            ) : (
              <span className="text-[var(--text-2)]">{responsavel?.nome ?? (etapa.responsavelUserId ? `usuário #${etapa.responsavelUserId}` : "qualquer operador")}</span>
            )}
          </dd>
          <dt className="flex items-center gap-1 text-[var(--text-faint)]"><CalendarClock className="h-3 w-3" aria-hidden /> hoje</dt>
          <dd className="font-mono tabular-nums text-[var(--text-2)]">
            {contagem ? <>{num(contagem.casos)} casos · {brl(contagem.valor)}</> : <Traco titulo="Sem contagem: a rota não devolveu casos por etapa" />}
          </dd>
        </dl>
      </div>
    </article>
  );
}
