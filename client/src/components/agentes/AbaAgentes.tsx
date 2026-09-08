/**
 * A aba Agentes — a lista em organograma, o formulário e o vínculo com skills.
 *
 * Um agente do console nasce PARADO. Ligá-lo a um canal é o gesto que o coloca
 * falando com cliente, e por isso ele é separado da criação e sinalizado no
 * card: "sem canal · não fala com ninguém".
 *
 * Os três perfis da cobrança aparecem aqui como leitura (`daPonte`): eles são
 * administrados no Painel do Provedor, onde a política e a régua entram no
 * prompt. Editar por aqui quebraria o atendimento em andamento.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Pencil, Plug, Trash2, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, EstadoVazio, LinhasSkeleton } from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { cn } from "@/lib/utils";
import {
  COR_DO_DEPARTAMENTO, ROTULO_DO_DEPARTAMENTO, ROTULO_DO_TIPO,
  type AgenteDoConsole, type SkillDoConsole,
} from "@shared/chat-console";
import { API_AGENTES, API_SKILLS, invalidarConsole } from "./tipos";
import { DialogoAgente } from "./DialogoAgente";
import { DialogoSkillsDoAgente } from "./DialogoSkillsDoAgente";

export function AbaAgentes({ podeAdministrar }: { podeAdministrar: boolean }) {
  const agentes = useQuery<{ agentes: AgenteDoConsole[] }>({ queryKey: [API_AGENTES], staleTime: 20_000, retry: false });
  const [emEdicao, setEmEdicao] = useState<AgenteDoConsole | null>(null);
  const [criando, setCriando] = useState(false);
  const [skillsDe, setSkillsDe] = useState<AgenteDoConsole | null>(null);

  const lista = agentes.data?.agentes ?? [];
  const porDepartamento = agrupar(lista);

  return (
    <section className="space-y-4" data-testid="console-aba-agentes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[12.5px] leading-5 text-[var(--text-2)]">
          Cada agente é um papel: quem ele é, com que modelo pensa e quais skills pode chamar.
          Um agente novo nasce parado — ligue a um canal quando quiser que ele fale.
        </p>
        {podeAdministrar && (
          <button className={BOTAO_MARCA} onClick={() => setCriando(true)} data-testid="console-novo-agente">
            <Bot className="h-3.5 w-3.5" aria-hidden /> Novo agente
          </button>
        )}
      </div>

      {agentes.isLoading ? <LinhasSkeleton linhas={3} />
        : agentes.isError ? <p role="alert" className="text-[12.5px] text-[var(--danger)]">{mensagemDoErro(agentes.error)}</p>
        : lista.length === 0 ? (
          <EstadoVazio
            Icone={Bot}
            titulo="Nenhum agente ainda"
            descricao="Um agente é quem conversa com o cliente pelo WhatsApp seguindo as suas regras. Crie o primeiro e ligue as skills que ele pode usar."
          />
        ) : (
          <div className="space-y-5">
            {porDepartamento.map(([departamento, doGrupo]) => (
              <div key={departamento}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: COR_DO_DEPARTAMENTO[departamento] ?? "var(--cat-slate)" }} aria-hidden />
                  <h3 className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
                    {ROTULO_DO_DEPARTAMENTO[departamento] ?? departamento}
                  </h3>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">{doGrupo.length}</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {doGrupo.map(a => (
                    <CardDoAgente
                      key={a.id} agente={a} agentes={lista} podeAdministrar={podeAdministrar}
                      onEditar={() => setEmEdicao(a)} onSkills={() => setSkillsDe(a)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      {(criando || emEdicao) && (
        <DialogoAgente agente={emEdicao} agentes={lista} onFechar={() => { setCriando(false); setEmEdicao(null); }} />
      )}
      {skillsDe && <DialogoSkillsDoAgente agente={skillsDe} onFechar={() => setSkillsDe(null)} />}
    </section>
  );
}

/** Sem departamento vira "OUTRO" — um card órfão fora de qualquer grupo some da leitura. */
function agrupar(lista: AgenteDoConsole[]): [string, AgenteDoConsole[]][] {
  const grupos = new Map<string, AgenteDoConsole[]>();
  for (const a of lista) {
    const chave = a.departamento?.trim().toUpperCase() || "OUTRO";
    const atual = grupos.get(chave) ?? [];
    atual.push(a);
    grupos.set(chave, atual);
  }
  return [...grupos.entries()].sort((a, b) => (a[0] === "OUTRO" ? 1 : b[0] === "OUTRO" ? -1 : a[0].localeCompare(b[0])));
}

function CardDoAgente({ agente, agentes, podeAdministrar, onEditar, onSkills }: {
  agente: AgenteDoConsole;
  agentes: AgenteDoConsole[];
  podeAdministrar: boolean;
  onEditar: () => void;
  onSkills: () => void;
}) {
  const { toast } = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const chefe = agente.reportaA ? agentes.find(a => a.id === agente.reportaA) : null;
  const ligados = agente.canais.filter(c => c.modo !== "DISABLED");

  const apagar = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `${API_AGENTES}/${encodeURIComponent(agente.id)}`)).json(),
    onSuccess: () => { invalidarConsole(); toast({ title: "Agente removido" }); },
    onError: (e) => toast({ title: "Não deu para remover", description: mensagemDoErro(e), variant: "destructive" }),
  });

  return (
    <article
      className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5"
      style={{ borderLeft: `3px solid ${COR_DO_DEPARTAMENTO[agente.departamento?.toUpperCase() ?? "OUTRO"] ?? "var(--cat-slate)"}` }}
      data-testid={`console-agente-${agente.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-[13.5px] font-semibold leading-tight text-[var(--text)]" title={agente.nome}>{agente.nome}</h4>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">
            {ROTULO_DO_TIPO[agente.tipo].nome}{agente.squad ? ` · ${agente.squad}` : ""}
          </p>
        </div>
        <SeloCobranca tom={agente.ativo ? "ok" : "neutro"}>{agente.ativo ? "ativo" : "parado"}</SeloCobranca>
      </div>

      {agente.descricao && <p className="mt-2 line-clamp-2 text-[12px] leading-4 text-[var(--text-2)]">{agente.descricao}</p>}

      <dl className="mt-2.5 grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-[var(--text-faint)]">modelo</dt>
        <dd className="truncate font-mono tabular-nums text-[var(--text-2)]" title={agente.modelo}>{agente.modelo || "—"}</dd>
        <dt className="text-[var(--text-faint)]">reporta a</dt>
        <dd className="truncate text-[var(--text-2)]">{chefe?.nome ?? "—"}</dd>
        <dt className="text-[var(--text-faint)]">canais</dt>
        <dd className="truncate text-[var(--text-2)]">
          {ligados.length ? ligados.map(c => c.nome).join(", ") : <span className="text-[var(--gated)]">sem canal · não fala com ninguém</span>}
        </dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-faint)] pt-3">
        {agente.daPonte ? (
          <span className="text-[11px] text-[var(--text-muted)]">
            Perfil da cobrança — edite no Painel do Provedor → Chat.
          </span>
        ) : podeAdministrar ? (
          <>
            <button className={cn(BOTAO_SECUNDARIO, "h-8 flex-1 text-[11.5px]")} onClick={onEditar}>
              <Pencil className="h-3 w-3" aria-hidden /> Editar
            </button>
            <button className={cn(BOTAO_SECUNDARIO, "h-8 flex-1 text-[11.5px]")} onClick={onSkills}>
              <Sparkles className="h-3 w-3" aria-hidden /> Skills
            </button>
            {confirmando ? (
              <span className="flex w-full items-center gap-1.5 pt-1">
                <span className="flex-1 text-[11px] text-[var(--past)]">Remover este agente?</span>
                <button className={cn(BOTAO_SECUNDARIO, "h-7 text-[11px]")} onClick={() => setConfirmando(false)}>Não</button>
                <button className={cn(BOTAO_SECUNDARIO, "h-7 border-[var(--danger-border)] text-[11px] text-[var(--danger)]")}
                  onClick={() => apagar.mutate()} disabled={apagar.isPending}>Remover</button>
              </span>
            ) : (
              <button className={cn(BOTAO_SECUNDARIO, "h-8 w-8 !px-0 text-[var(--text-muted)]")}
                aria-label={`Remover ${agente.nome}`} onClick={() => setConfirmando(true)}>
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            )}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Plug className="h-3 w-3" aria-hidden /> Só administradores editam agentes.
          </span>
        )}
      </div>
    </article>
  );
}

/** Reexportado para o teste de costura não precisar do componente inteiro. */
export type { AgenteDoConsole, SkillDoConsole };
