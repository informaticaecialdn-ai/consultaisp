/**
 * O formulário de agente — o mesmo do "Novo agente" do Chat BullQ, campo a
 * campo, mais o organograma (reporta a · departamento · squad).
 *
 * Valida com o MESMO schema do servidor antes de enviar: o limite estourado
 * aparece embaixo do campo, e não num 400 genérico depois do clique.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA, MolduraModal, RotuloCampo, TITULO_MODAL,
} from "@/components/painel/ui";
import { mensagemDoErro } from "@/components/cobranca/ui";
import { cn } from "@/lib/utils";
import {
  AgenteDoConsoleSchema, DEPARTAMENTOS, LIMITES_DO_CONSOLE, MODELOS_SUGERIDOS, ROTULO_DO_DEPARTAMENTO,
  ROTULO_DO_TIPO, TIPOS_DE_AGENTE_DO_CONSOLE, type AgenteDoConsole,
} from "@shared/chat-console";
import { API_AGENTES, invalidarConsole } from "./tipos";

const CONTADOR = "font-mono text-[10px] tabular-nums text-[var(--text-faint)]";
const ERRO = "mt-1 text-[11px] text-[var(--danger)]";
const numeroOuIndefinido = (v: string) => (v.trim() === "" ? undefined : Number(v));
const vazioParaNulo = (v: string) => (v.trim() === "" ? null : v.trim());

export function DialogoAgente({ agente, agentes, onFechar }: {
  agente: AgenteDoConsole | null;
  agentes: AgenteDoConsole[];
  onFechar: () => void;
}) {
  const { toast } = useToast();
  const editando = agente !== null;
  const [nome, setNome] = useState(agente?.nome ?? "");
  const [descricao, setDescricao] = useState(agente?.descricao ?? "");
  const [tipo, setTipo] = useState<"WORKER" | "ORCHESTRATOR">(agente?.tipo ?? "WORKER");
  const [categoria, setCategoria] = useState(agente?.categoria ?? "");
  const [reportaA, setReportaA] = useState(agente?.reportaA ?? "");
  const [departamento, setDepartamento] = useState(agente?.departamento ?? "");
  const [squad, setSquad] = useState(agente?.squad ?? "");
  const [modelo, setModelo] = useState(agente?.modelo ?? MODELOS_SUGERIDOS[0].id);
  const [instrucoes, setInstrucoes] = useState(agente?.instrucoes ?? "");
  const [contexto, setContexto] = useState(agente?.contextoOperacional ?? "");
  const [temperatura, setTemperatura] = useState(String(agente?.temperatura ?? 0.3));
  const [maxTokens, setMaxTokens] = useState(String(agente?.maxTokens ?? 600));
  const [respondeDireto, setRespondeDireto] = useState(agente?.respondeDireto ?? false);

  const corpo = {
    nome: nome.trim(), descricao: descricao.trim(), tipo, categoria: categoria.trim(),
    reportaA: vazioParaNulo(reportaA), departamento: vazioParaNulo(departamento), squad: vazioParaNulo(squad),
    modelo: modelo.trim(), instrucoes: instrucoes.trim(), contextoOperacional: contexto.trim(),
    temperatura: numeroOuIndefinido(temperatura), maxTokens: numeroOuIndefinido(maxTokens),
    respondeDireto,
  };
  const validacao = useMemo(() => AgenteDoConsoleSchema.safeParse(corpo), [
    nome, descricao, tipo, categoria, reportaA, departamento, squad, modelo, instrucoes, contexto, temperatura, maxTokens, respondeDireto,
  ]);
  const erroDe = (campo: string) =>
    validacao.success ? null : validacao.error.issues.find(i => i.path[0] === campo)?.message ?? null;

  // Só quem já existe pode ser chefia — e nunca o próprio agente (ciclo de um nó).
  const chefias = agentes.filter(a => a.id !== agente?.id);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!validacao.success) throw new Error("Revise os campos do formulário");
      const r = editando
        ? await apiRequest("PATCH", `${API_AGENTES}/${encodeURIComponent(agente.id)}`, validacao.data)
        : await apiRequest("POST", API_AGENTES, validacao.data);
      return r.json();
    },
    onSuccess: () => {
      invalidarConsole();
      toast({
        title: editando ? "Agente salvo" : "Agente criado",
        description: editando ? undefined : "Ele nasce parado e sem canal. Ligue a um canal quando quiser que fale com o cliente.",
      });
      onFechar();
    },
    onError: (e) => toast({ title: "Não deu para salvar", description: mensagemDoErro(e), variant: "destructive" }),
  });

  return (
    <MolduraModal rotulo={editando ? `Editar agente ${agente.nome}` : "Novo agente"} onFechar={onFechar}>
      <h2 className={TITULO_MODAL}>
        <Bot className="h-4 w-4 text-[var(--brand)]" aria-hidden />
        {editando ? "Editar agente" : "Novo agente"}
      </h2>

      <form
        className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="nome">
            <input className={CONTROLE_CAMPO} value={nome} onChange={e => setNome(e.target.value)}
              maxLength={LIMITES_DO_CONSOLE.agente.nome.max} placeholder="Ex.: Cobrança · primeiro contato" data-testid="agente-nome" />
            {erroDe("nome") && <p className={ERRO}>{erroDe("nome")}</p>}
          </Campo>
          <Campo rotulo="categoria">
            <input className={CONTROLE_CAMPO} value={categoria} onChange={e => setCategoria(e.target.value)}
              maxLength={LIMITES_DO_CONSOLE.agente.categoria} placeholder="Ex.: recuperação de crédito" />
          </Campo>
        </div>

        <Campo rotulo="descrição (interna)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[56px]")} value={descricao}
            onChange={e => setDescricao(e.target.value)} maxLength={LIMITES_DO_CONSOLE.agente.descricao}
            placeholder="Para que serve este agente, na sua operação. O cliente não lê isto." />
          <span className={CONTADOR}>{descricao.length}/{LIMITES_DO_CONSOLE.agente.descricao}</span>
        </Campo>

        <fieldset className="rounded-md border border-[var(--border)] p-3">
          <legend className="px-1 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">organograma</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="tipo">
              <select className={CONTROLE_CAMPO} value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)} data-testid="agente-tipo">
                {TIPOS_DE_AGENTE_DO_CONSOLE.map(t => <option key={t} value={t}>{ROTULO_DO_TIPO[t].nome}</option>)}
              </select>
              <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{ROTULO_DO_TIPO[tipo].papel}</p>
            </Campo>
            <Campo rotulo="reporta a">
              <select className={CONTROLE_CAMPO} value={reportaA} onChange={e => setReportaA(e.target.value)}>
                <option value="">— ninguém (raiz)</option>
                {chefias.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="departamento">
              <select className={CONTROLE_CAMPO} value={departamento} onChange={e => setDepartamento(e.target.value)}>
                <option value="">— sem departamento</option>
                {DEPARTAMENTOS.map(d => <option key={d} value={d}>{ROTULO_DO_DEPARTAMENTO[d]}</option>)}
              </select>
            </Campo>
            <Campo rotulo="squad">
              <input className={CONTROLE_CAMPO} value={squad} onChange={e => setSquad(e.target.value)}
                maxLength={LIMITES_DO_CONSOLE.agente.squad} placeholder="Ex.: squad inadimplência" />
            </Campo>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="modelo" className="sm:col-span-1">
            <input className={CONTROLE_CAMPO} value={modelo} onChange={e => setModelo(e.target.value)} list="modelos-do-console" data-testid="agente-modelo" />
            <datalist id="modelos-do-console">
              {MODELOS_SUGERIDOS.map(m => <option key={m.id} value={m.id}>{m.rotulo} · {m.nota}</option>)}
            </datalist>
            {erroDe("modelo") && <p className={ERRO}>{erroDe("modelo")}</p>}
          </Campo>
          <Campo rotulo="temperatura">
            <input className={CONTROLE_CAMPO} type="number" inputMode="decimal"
              min={LIMITES_DO_CONSOLE.agente.temperatura.min} max={LIMITES_DO_CONSOLE.agente.temperatura.max}
              step={LIMITES_DO_CONSOLE.agente.temperatura.passo} value={temperatura} onChange={e => setTemperatura(e.target.value)} />
            {erroDe("temperatura") && <p className={ERRO}>{erroDe("temperatura")}</p>}
          </Campo>
          <Campo rotulo="máximo de tokens">
            <input className={CONTROLE_CAMPO} type="number" inputMode="numeric"
              min={LIMITES_DO_CONSOLE.agente.maxTokens.min} max={LIMITES_DO_CONSOLE.agente.maxTokens.max}
              value={maxTokens} onChange={e => setMaxTokens(e.target.value)} />
            {erroDe("maxTokens") && <p className={ERRO}>{erroDe("maxTokens")}</p>}
          </Campo>
        </div>

        <Campo rotulo="instruções (system prompt)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[160px] font-mono text-[12px]")} value={instrucoes}
            onChange={e => setInstrucoes(e.target.value)} maxLength={LIMITES_DO_CONSOLE.agente.instrucoes.max}
            placeholder="Quem ele é, o que pode e o que não pode. Números, prazos e valores vêm sempre de uma skill — nunca do texto." data-testid="agente-instrucoes" />
          <span className={CONTADOR}>{instrucoes.length}/{LIMITES_DO_CONSOLE.agente.instrucoes.max}</span>
          {erroDe("instrucoes") && <p className={ERRO}>{erroDe("instrucoes")}</p>}
        </Campo>

        <Campo rotulo="contexto operacional (avisos de hoje)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[70px]")} value={contexto}
            onChange={e => setContexto(e.target.value)} maxLength={LIMITES_DO_CONSOLE.agente.contextoOperacional}
            placeholder="O que mudou hoje e o agente precisa saber. Entra no prompt a cada execução." />
          <span className={CONTADOR}>{contexto.length}/{LIMITES_DO_CONSOLE.agente.contextoOperacional}</span>
        </Campo>

        <label className="flex items-start gap-2 text-[12.5px] text-[var(--text-2)]">
          <input type="checkbox" className="mt-0.5" checked={respondeDireto} onChange={e => setRespondeDireto(e.target.checked)} />
          <span>
            <RotuloCampo className="mb-0">responde direto ao cliente</RotuloCampo>
            Sem isto o agente só redige e entrega ao atendente. Ligar não basta para ele falar: é preciso ligá-lo a um canal.
          </span>
        </label>

        <div className="flex justify-end gap-2 border-t border-[var(--border-faint)] pt-3">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={BOTAO_MARCA} disabled={!validacao.success || salvar.isPending} data-testid="agente-salvar">
            {salvar.isPending ? "Salvando…" : editando ? "Salvar agente" : "Criar agente"}
          </button>
        </div>
      </form>
    </MolduraModal>
  );
}
