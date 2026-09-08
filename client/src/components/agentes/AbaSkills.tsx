/**
 * A aba Skills — as funções que o modelo pode chamar.
 *
 * Uma skill é: um nome (que o modelo vê como nome de função), a descrição que
 * o faz decidir chamá-la, o JSON Schema do input e a chamada HTTP que sai numa
 * conexão. É onde entra a regra que dá certo aqui: número, valor e prazo vêm
 * de uma skill que LÊ o dado — nunca do texto do prompt.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { History, Pencil, Sparkles, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA, EstadoVazio,
  LinhasSkeleton, MolduraModal, TITULO_MODAL,
} from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { cn } from "@/lib/utils";
import {
  LIMITES_DO_CONSOLE, METODOS_DA_SKILL, SkillDoConsoleSchema,
  type SkillDoConsole, type ToolDoConsole, type VersaoDaSkill,
} from "@shared/chat-console";
import { API_SKILLS, API_TOOLS, EXEMPLO_DE_PARAMETROS, invalidarConsole, textoDeQuando } from "./tipos";

const ERRO = "mt-1 text-[11px] text-[var(--danger)]";
const CONTADOR = "font-mono text-[10px] tabular-nums text-[var(--text-faint)]";

export function AbaSkills({ podeAdministrar }: { podeAdministrar: boolean }) {
  const skills = useQuery<{ skills: SkillDoConsole[] }>({ queryKey: [API_SKILLS], staleTime: 20_000, retry: false });
  const tools = useQuery<{ tools: ToolDoConsole[] }>({ queryKey: [API_TOOLS], staleTime: 20_000, retry: false });
  const [emEdicao, setEmEdicao] = useState<SkillDoConsole | null>(null);
  const [criando, setCriando] = useState(false);
  const [versoesDe, setVersoesDe] = useState<SkillDoConsole | null>(null);

  const lista = skills.data?.skills ?? [];
  const conexoes = (tools.data?.tools ?? []).filter(t => t.ativa);

  return (
    <section className="space-y-4" data-testid="console-aba-skills">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[12.5px] leading-5 text-[var(--text-2)]">
          Uma skill é uma função que o agente pode executar durante a conversa. A descrição é o que o
          modelo lê para decidir chamá-la — escreva-a para ele, não para você.
        </p>
        {podeAdministrar && (
          <button className={BOTAO_MARCA} onClick={() => setCriando(true)} disabled={conexoes.length === 0} data-testid="console-nova-skill">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Nova skill
          </button>
        )}
      </div>

      {podeAdministrar && conexoes.length === 0 && !tools.isLoading && (
        <p className="rounded-md border border-[var(--gated-border)] bg-[var(--gated-bg)] p-2.5 text-[12px] text-[var(--gated)]">
          Toda skill sai por uma conexão. Cadastre uma na aba Conexões antes de criar a primeira skill.
        </p>
      )}

      {skills.isLoading ? <LinhasSkeleton linhas={3} />
        : skills.isError ? <p role="alert" className="text-[12.5px] text-[var(--danger)]">{mensagemDoErro(skills.error)}</p>
        : lista.length === 0 ? (
          <EstadoVazio Icone={Sparkles} titulo="Nenhuma skill ainda"
            descricao="Sem skills o agente só conversa: ele não consulta saldo, não registra promessa e não faz nada no sistema." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[var(--surface-2)]">
                  {["skill", "chamada", "conexão", "agentes", "v", ""].map((h, i) => (
                    <th key={i} className="border-b border-[var(--border)] px-3 py-2 text-left font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map(s => (
                  <tr key={s.id} className="border-b border-[var(--border-faint)] last:border-0" data-testid={`console-skill-${s.nome}`}>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] text-[var(--text)]">{s.nome}</span>
                        {!s.ativa && <SeloCobranca tom="neutro">desativada</SeloCobranca>}
                        {s.daPonte && <SeloCobranca tom="info" titulo="Skill da cobrança: o prompt do agente a chama por este nome.">cobrança</SeloCobranca>}
                      </div>
                      <p className="mt-0.5 max-w-[48ch] text-[11.5px] leading-4 text-[var(--text-muted)]">{s.descricao}</p>
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-[11.5px] tabular-nums text-[var(--text-2)]">
                      {s.metodo ?? "—"} {s.caminho ?? ""}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--text-2)]">{s.toolNome ?? "—"}</td>
                    <td className="px-3 py-2.5 align-top text-[11.5px] text-[var(--text-2)]">
                      {s.agentes.length ? s.agentes.map(a => a.nome).join(", ") : <span className="text-[var(--text-faint)]">nenhum</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono tabular-nums text-[var(--text-muted)]">{s.versao}</td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex justify-end gap-1">
                        <button className={cn(BOTAO_SECUNDARIO, "h-7 !px-2 text-[11px]")} onClick={() => setVersoesDe(s)} aria-label={`Versões de ${s.nome}`}>
                          <History className="h-3 w-3" aria-hidden />
                        </button>
                        {podeAdministrar && !s.daPonte && (
                          <>
                            <button className={cn(BOTAO_SECUNDARIO, "h-7 !px-2 text-[11px]")} onClick={() => setEmEdicao(s)} aria-label={`Editar ${s.nome}`}>
                              <Pencil className="h-3 w-3" aria-hidden />
                            </button>
                            <BotaoApagarSkill skill={s} />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {(criando || emEdicao) && (
        <DialogoSkill skill={emEdicao} conexoes={conexoes} onFechar={() => { setCriando(false); setEmEdicao(null); }} />
      )}
      {versoesDe && <DialogoVersoes skill={versoesDe} onFechar={() => setVersoesDe(null)} />}
    </section>
  );
}

function BotaoApagarSkill({ skill }: { skill: SkillDoConsole }) {
  const { toast } = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const apagar = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `${API_SKILLS}/${encodeURIComponent(skill.id)}`)).json(),
    onSuccess: () => { invalidarConsole(); toast({ title: "Skill removida" }); },
    onError: (e) => toast({ title: "Não deu para remover", description: mensagemDoErro(e), variant: "destructive" }),
  });
  if (confirmando) {
    return (
      <span className="inline-flex items-center gap-1">
        <button className={cn(BOTAO_SECUNDARIO, "h-7 !px-2 text-[11px]")} onClick={() => setConfirmando(false)}>Não</button>
        <button className={cn(BOTAO_SECUNDARIO, "h-7 !px-2 border-[var(--danger-border)] text-[11px] text-[var(--danger)]")}
          onClick={() => apagar.mutate()} disabled={apagar.isPending}>Remover</button>
      </span>
    );
  }
  return (
    <button className={cn(BOTAO_SECUNDARIO, "h-7 !px-2 text-[11px] text-[var(--text-muted)]")}
      onClick={() => setConfirmando(true)} aria-label={`Remover ${skill.nome}`}>
      <Trash2 className="h-3 w-3" aria-hidden />
    </button>
  );
}

function DialogoSkill({ skill, conexoes, onFechar }: {
  skill: SkillDoConsole | null;
  conexoes: ToolDoConsole[];
  onFechar: () => void;
}) {
  const { toast } = useToast();
  const editando = skill !== null;
  const [nome, setNome] = useState(skill?.nome ?? "");
  const [descricao, setDescricao] = useState(skill?.descricao ?? "");
  const [categoria, setCategoria] = useState(skill?.categoria ?? "");
  const [instrucoes, setInstrucoes] = useState(skill?.instrucoes ?? "");
  const [toolId, setToolId] = useState(skill?.toolId ?? conexoes[0]?.id ?? "");
  const [metodo, setMetodo] = useState<(typeof METODOS_DA_SKILL)[number]>(
    (METODOS_DA_SKILL.find(m => m === skill?.metodo?.toUpperCase()) ?? "POST"),
  );
  const [caminho, setCaminho] = useState(skill?.caminho ?? "");
  const [parametros, setParametros] = useState(
    skill ? JSON.stringify(skill.parametros, null, 2) : EXEMPLO_DE_PARAMETROS,
  );
  const [corpo, setCorpo] = useState(skill?.corpo ?? "");
  const [timeout, setTimeout_] = useState(String(skill?.timeoutMs ?? 10000));
  const [nota, setNota] = useState("");

  const entrada = {
    nome: nome.trim(), descricao: descricao.trim(), categoria: categoria.trim(), instrucoes: instrucoes.trim(),
    toolId, parametros, metodo, caminho: caminho.trim(), corpo: corpo.trim(),
    timeoutMs: timeout.trim() === "" ? undefined : Number(timeout), nota: nota.trim(),
  };
  const validacao = useMemo(() => SkillDoConsoleSchema.safeParse(entrada), [
    nome, descricao, categoria, instrucoes, toolId, parametros, metodo, caminho, corpo, timeout, nota,
  ]);
  const erroDe = (campo: string) =>
    validacao.success ? null : validacao.error.issues.find(i => i.path[0] === campo)?.message ?? null;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!validacao.success) throw new Error("Revise os campos do formulário");
      // O schema TRANSFORMA `parametros` de texto em objeto; mandar o texto cru
      // faria o fork recusar com `parameters must be an object`.
      const r = editando
        ? await apiRequest("PATCH", `${API_SKILLS}/${encodeURIComponent(skill.id)}`, validacao.data)
        : await apiRequest("POST", API_SKILLS, validacao.data);
      return r.json();
    },
    onSuccess: () => { invalidarConsole(); toast({ title: editando ? "Skill salva" : "Skill criada" }); onFechar(); },
    onError: (e) => toast({ title: "Não deu para salvar", description: mensagemDoErro(e), variant: "destructive" }),
  });

  return (
    <MolduraModal rotulo={editando ? `Editar skill ${skill.nome}` : "Nova skill"} onFechar={onFechar}>
      <h2 className={TITULO_MODAL}>
        <Sparkles className="h-4 w-4 text-[var(--brand)]" aria-hidden /> {editando ? "Editar skill" : "Nova skill"}
      </h2>
      <form className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="nome da função">
            <input className={cn(CONTROLE_CAMPO, "font-mono")} value={nome} onChange={e => setNome(e.target.value)}
              maxLength={LIMITES_DO_CONSOLE.skill.nome.max} placeholder="consultarSaldo" data-testid="skill-nome" />
            {erroDe("nome") && <p className={ERRO}>{erroDe("nome")}</p>}
          </Campo>
          <Campo rotulo="categoria">
            <input className={CONTROLE_CAMPO} value={categoria} onChange={e => setCategoria(e.target.value)}
              maxLength={LIMITES_DO_CONSOLE.skill.categoria} placeholder="Ex.: cobrança" />
          </Campo>
        </div>

        <Campo rotulo="descrição (é o que o modelo lê)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[56px]")} value={descricao}
            onChange={e => setDescricao(e.target.value)} maxLength={LIMITES_DO_CONSOLE.skill.descricao.max}
            placeholder="Consulta o saldo em aberto do cliente pelo telefone. Use antes de citar qualquer valor." data-testid="skill-descricao" />
          {erroDe("descricao") && <p className={ERRO}>{erroDe("descricao")}</p>}
        </Campo>

        <div className="grid gap-3 sm:grid-cols-[1fr_110px_1fr]">
          <Campo rotulo="conexão">
            <select className={CONTROLE_CAMPO} value={toolId} onChange={e => setToolId(e.target.value)} data-testid="skill-conexao">
              {conexoes.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            {erroDe("toolId") && <p className={ERRO}>{erroDe("toolId")}</p>}
          </Campo>
          <Campo rotulo="método">
            <select className={CONTROLE_CAMPO} value={metodo} onChange={e => setMetodo(e.target.value as typeof metodo)}>
              {METODOS_DA_SKILL.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Campo>
          <Campo rotulo="caminho">
            <input className={cn(CONTROLE_CAMPO, "font-mono")} value={caminho} onChange={e => setCaminho(e.target.value)}
              maxLength={LIMITES_DO_CONSOLE.skill.caminho} placeholder="/caso" data-testid="skill-caminho" />
            {erroDe("caminho") && <p className={ERRO}>{erroDe("caminho")}</p>}
          </Campo>
        </div>

        <Campo rotulo="parâmetros (JSON Schema do input)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[140px] font-mono text-[12px]")} value={parametros}
            onChange={e => setParametros(e.target.value)} spellCheck={false} data-testid="skill-parametros" />
          {erroDe("parametros") && <p className={ERRO}>{erroDe("parametros")}</p>}
        </Campo>

        <Campo rotulo="corpo da chamada (opcional)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[70px] font-mono text-[12px]")} value={corpo}
            onChange={e => setCorpo(e.target.value)} spellCheck={false}
            placeholder={'{"telefone": "{{telefone}}"}'} />
          <span className={CONTADOR}>Deixe vazio para mandar os parâmetros como vieram.</span>
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="tempo limite (ms)">
            <input className={CONTROLE_CAMPO} type="number" inputMode="numeric" value={timeout}
              min={LIMITES_DO_CONSOLE.skill.timeoutMs.min} max={LIMITES_DO_CONSOLE.skill.timeoutMs.max}
              onChange={e => setTimeout_(e.target.value)} />
            {erroDe("timeoutMs") && <p className={ERRO}>{erroDe("timeoutMs")}</p>}
          </Campo>
          <Campo rotulo="nota da versão">
            <input className={CONTROLE_CAMPO} value={nota} onChange={e => setNota(e.target.value)}
              maxLength={300} placeholder="O que mudou nesta versão" />
          </Campo>
        </div>

        <Campo rotulo="instruções extras para o modelo (opcional)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[56px]")} value={instrucoes}
            onChange={e => setInstrucoes(e.target.value)} maxLength={LIMITES_DO_CONSOLE.skill.instrucoes}
            placeholder="Quando chamar, quando não chamar, o que fazer com a resposta." />
        </Campo>

        <div className="flex justify-end gap-2 border-t border-[var(--border-faint)] pt-3">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={BOTAO_MARCA} disabled={!validacao.success || salvar.isPending} data-testid="skill-salvar">
            {salvar.isPending ? "Salvando…" : editando ? "Salvar skill" : "Criar skill"}
          </button>
        </div>
      </form>
    </MolduraModal>
  );
}

function DialogoVersoes({ skill, onFechar }: { skill: SkillDoConsole; onFechar: () => void }) {
  const versoes = useQuery<{ versoes: VersaoDaSkill[] }>({
    queryKey: [`${API_SKILLS}/${skill.id}/versoes`], staleTime: 30_000, retry: false,
  });
  return (
    <MolduraModal rotulo={`Versões da skill ${skill.nome}`} onFechar={onFechar}>
      <h2 className={TITULO_MODAL}>
        <History className="h-4 w-4 text-[var(--brand)]" aria-hidden /> Versões de {skill.nome}
      </h2>
      <div className="mt-3 max-h-[56vh] space-y-1.5 overflow-y-auto pr-1">
        {versoes.isLoading ? <LinhasSkeleton linhas={3} />
          : versoes.isError ? <p role="alert" className="text-[12px] text-[var(--danger)]">{mensagemDoErro(versoes.error)}</p>
          : (versoes.data?.versoes ?? []).length === 0 ? <p className="text-[12px] text-[var(--text-muted)]">Só a versão atual.</p>
          : versoes.data!.versoes.map(v => (
            <div key={v.id} className="rounded-md border border-[var(--border-faint)] bg-[var(--surface-2)] p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11.5px] tabular-nums text-[var(--text)]">v{v.versao} · {v.metodo ?? "—"} {v.caminho ?? ""}</span>
                <span className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">{textoDeQuando(v.criadaEm)}</span>
              </div>
              {v.nota && <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-2)]">{v.nota}</p>}
            </div>
          ))}
      </div>
      <div className="mt-4 flex justify-end border-t border-[var(--border-faint)] pt-3">
        <button className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
      </div>
    </MolduraModal>
  );
}
