/**
 * Quais skills este agente pode chamar — e quais precisam de aprovação humana.
 *
 * O conjunto é enviado INTEIRO (o fork apaga e recria os vínculos), então a
 * tela manda todas as marcadas, nunca a diferença. Desmarcar e salvar tira a
 * skill do agente na hora.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, LinhasSkeleton, MolduraModal, TITULO_MODAL } from "@/components/painel/ui";
import { mensagemDoErro } from "@/components/cobranca/ui";
import type { AgenteDoConsole, SkillDoConsole } from "@shared/chat-console";
import { API_AGENTES, API_SKILLS, invalidarConsole } from "./tipos";

interface Ligadas { ligadas: { skillId: string; nome: string; exigeAprovacao: boolean }[] }

export function DialogoSkillsDoAgente({ agente, onFechar }: { agente: AgenteDoConsole; onFechar: () => void }) {
  const { toast } = useToast();
  const caminho = `${API_AGENTES}/${encodeURIComponent(agente.id)}/skills`;
  const catalogo = useQuery<{ skills: SkillDoConsole[] }>({ queryKey: [API_SKILLS], staleTime: 20_000, retry: false });
  const ligadas = useQuery<Ligadas>({ queryKey: [caminho], staleTime: 0, retry: false });
  const [marcadas, setMarcadas] = useState<Set<string> | null>(null);

  // O estado só nasce quando o servidor responde: começar com Set vazio e
  // salvar antes da resposta chegar desligaria todas as skills do agente.
  useEffect(() => {
    if (ligadas.data && marcadas === null) setMarcadas(new Set(ligadas.data.ligadas.map(l => l.skillId)));
  }, [ligadas.data, marcadas]);

  const aprovacaoDe = (skillId: string) => ligadas.data?.ligadas.find(l => l.skillId === skillId)?.exigeAprovacao ?? false;

  const salvar = useMutation({
    mutationFn: async () => (await apiRequest("PUT", caminho, { skillIds: [...(marcadas ?? new Set())] })).json(),
    onSuccess: () => {
      invalidarConsole();
      void ligadas.refetch();
      toast({ title: "Skills do agente salvas" });
      onFechar();
    },
    onError: (e) => toast({ title: "Não deu para salvar", description: mensagemDoErro(e), variant: "destructive" }),
  });

  const aprovacao = useMutation({
    mutationFn: async ({ skillId, exige }: { skillId: string; exige: boolean }) =>
      (await apiRequest("PATCH", `${caminho}/${encodeURIComponent(skillId)}`, { exigeAprovacao: exige })).json(),
    onSuccess: () => void ligadas.refetch(),
    onError: (e) => toast({ title: "Não deu para mudar a aprovação", description: mensagemDoErro(e), variant: "destructive" }),
  });

  const skills = catalogo.data?.skills ?? [];
  const carregando = catalogo.isLoading || ligadas.isLoading || marcadas === null;

  return (
    <MolduraModal rotulo={`Skills de ${agente.nome}`} onFechar={onFechar}>
      <h2 className={TITULO_MODAL}>
        <Sparkles className="h-4 w-4 text-[var(--brand)]" aria-hidden /> Skills de {agente.nome}
      </h2>
      <p className="mt-2 text-[12px] leading-4 text-[var(--text-2)]">
        O que este agente pode chamar. O que não estiver marcado ele não consegue executar, mesmo que peçam.
      </p>

      <div className="mt-3 max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
        {carregando ? <LinhasSkeleton linhas={4} />
          : catalogo.isError || ligadas.isError ? (
            <p role="alert" className="text-[12px] text-[var(--danger)]">{mensagemDoErro(catalogo.error ?? ligadas.error)}</p>
          ) : skills.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]">Nenhuma skill cadastrada ainda. Crie uma na aba Skills.</p>
          ) : skills.map(s => {
            const marcada = marcadas.has(s.id);
            return (
              <label key={s.id} className="flex items-start gap-2 rounded-md border border-[var(--border-faint)] bg-[var(--surface-2)] p-2.5">
                <input
                  type="checkbox" className="mt-0.5" checked={marcada}
                  onChange={e => setMarcadas(atual => {
                    const proximo = new Set(atual ?? []);
                    if (e.target.checked) proximo.add(s.id); else proximo.delete(s.id);
                    return proximo;
                  })}
                  data-testid={`skill-do-agente-${s.nome}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12px] text-[var(--text)]">{s.nome}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-4 text-[var(--text-muted)]">{s.descricao}</span>
                  {marcada && (
                    <button
                      type="button"
                      className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-[var(--brand)] underline-offset-2 hover:underline"
                      onClick={() => aprovacao.mutate({ skillId: s.id, exige: !aprovacaoDe(s.id) })}
                      disabled={aprovacao.isPending}
                    >
                      {aprovacaoDe(s.id) ? "exige aprovação humana · desligar" : "roda sozinha · exigir aprovação"}
                    </button>
                  )}
                </span>
              </label>
            );
          })}
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t border-[var(--border-faint)] pt-3">
        <button className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
        <button className={BOTAO_MARCA} onClick={() => salvar.mutate()} disabled={carregando || salvar.isPending}>
          {salvar.isPending ? "Salvando…" : "Salvar skills"}
        </button>
      </div>
    </MolduraModal>
  );
}
