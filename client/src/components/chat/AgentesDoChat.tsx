import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA, ROTULO_CAMPO } from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { cn } from "@/lib/utils";
import { ConfiguracaoDeAgenteSchema, LIMITES_DO_AGENTE, ORIGENS_DE_MODELO, type AgenteDoChat, type ModeloDoAgente, type ModelosDosAgentes, type PrimeiroContatoPreparado, type PromptDoAgente } from "@shared/chat-agentes";

const API = "/api/chat-bullq/integracao/agentes";
const ESTADOS = { nao_configurado: "aguardando configuração", configurado: "aguardando provisionamento", criando: "criando no Chat BullQ", criado: "finalizando vínculos", pronto: "pronto para preparar", erro: "precisa de atenção" };
const ROTULO_DA_ORIGEM = { chat_bullq: "credencial do Chat BullQ", openai_vps: "OpenAI · só na VPS" } as const;
const CONTADOR = "font-mono text-[10px] tabular-nums text-[var(--text-faint)]";
const SEM_CREDENCIAL = "O Chat BullQ respondeu que está sem credencial de IA configurada. Configure a credencial no serviço antes de aplicar ou testar.";
/** Campo numérico vazio é “não definido”, nunca 0: `Number("")` daria 0 e gravaria temperatura zero em silêncio. */
const numeroOuIndefinido = (v: string) => v.trim() === "" ? undefined : Number(v);

export function AgentesDoChat({ podeAdministrar }: { podeAdministrar: boolean }) {
  const agentes = useQuery<{ agentes: AgenteDoChat[] }>({ queryKey: [API], staleTime: 30_000 });
  const modelos = useQuery<ModelosDosAgentes>({ queryKey: [`${API}/modelos`], enabled: podeAdministrar, retry: false, staleTime: 60_000 });
  useEffect(() => { if (modelos.data) void queryClient.invalidateQueries({ queryKey: ["/api/chat-bullq/integracao"] }); }, [modelos.dataUpdatedAt]);
  const origens = modelos.data?.origens ?? ORIGENS_DE_MODELO;
  const origensPresentes = Array.from(new Set((modelos.data?.models ?? []).map(m => m.origem ?? "chat_bullq")));
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="chat-catalogo-agentes">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-[var(--brand)]" aria-hidden /><h3 className="text-sm font-semibold text-[var(--text)]">Agentes do chat</h3></div>
      {podeAdministrar && <button className={cn(BOTAO_SECUNDARIO, "h-8 text-xs")} onClick={() => modelos.refetch()} disabled={modelos.isFetching}><RefreshCw className={cn("h-3 w-3", modelos.isFetching && "animate-spin")} aria-hidden /> Atualizar modelos</button>}
    </div>
    <p className="mt-2 text-xs leading-5 text-[var(--text-2)]">Cada agente abre o contato da sua carteira e, no atendimento autônomo, só escolhe entre as ações que o Consulta ISP permite: texto, valor e data vêm do motor, nunca da IA. Testar gera uma prévia com um cliente fictício e não envia mensagens.</p>
    {modelos.isError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{mensagemDoErro(modelos.error)}</p>}
    {modelos.data && !modelos.data.configured && <p role="alert" className="mt-3 text-xs text-[var(--gated)]">A credencial de IA precisa ser configurada no Chat BullQ para preparar mensagens. Aplicar e testar ficam bloqueados até lá — os modelos abaixo são só o que o catálogo conhece, nenhum roda sem a credencial.</p>}
    {modelos.data?.configured && !modelos.data.models.length && <p className="mt-3 text-xs text-[var(--gated)]">Nenhum modelo compatível está disponível na credencial atual.</p>}
    {origensPresentes.length > 0 && <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]" data-testid="chat-origens-modelos">{origensPresentes.map(o => <li key={o}><span className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-2)]">{ROTULO_DA_ORIGEM[o]}</span> · {origens[o]}</li>)}</ul>}
    {agentes.isLoading ? <div className="mt-4 grid gap-3 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="h-72 rounded-md bg-[var(--surface-inset)] motion-safe:animate-pulse" />)}</div> : agentes.isError ? <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{mensagemDoErro(agentes.error)}</p> :
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{agentes.data?.agentes.map(a => <ConfiguracaoDoAgente key={`${a.tipo}:${a.atualizadoEm}`} agente={a} modelos={modelos.data?.models ?? []} credencialAusente={modelos.data ? !modelos.data.configured : false} podeAdministrar={podeAdministrar} />)}</div>}
  </section>;
}

function ConfiguracaoDoAgente({ agente, modelos, credencialAusente, podeAdministrar }: { agente: AgenteDoChat; modelos: ModeloDoAgente[]; credencialAusente: boolean; podeAdministrar: boolean }) {
  const { toast } = useToast();
  const [modelo, setModelo] = useState(agente.modelo ?? "");
  const [descricao, setDescricao] = useState(agente.descricao ?? "");
  const [instrucoes, setInstrucoes] = useState(agente.instrucoes);
  const [contextoOperacional, setContextoOperacional] = useState(agente.contextoOperacional ?? "");
  const [temperatura, setTemperatura] = useState(String(agente.temperatura ?? 0.3));
  const [maxTokens, setMaxTokens] = useState(String(agente.maxTokens ?? 600));
  const [habilitado, setHabilitado] = useState(agente.habilitado);
  const [previa, setPrevia] = useState<PrimeiroContatoPreparado | null>(null);
  const [promptAberto, setPromptAberto] = useState(false);
  const prompt = useQuery<PromptDoAgente>({ queryKey: [`${API}/${agente.tipo}/prompt`, agente.atualizadoEm], enabled: promptAberto && podeAdministrar, retry: false, staleTime: 30_000 });

  const corpo = { modelo: modelo || null, descricao, instrucoes, contextoOperacional, habilitado, temperatura: numeroOuIndefinido(temperatura), maxTokens: numeroOuIndefinido(maxTokens) };
  // A mesma validação do servidor, antes de salvar: o operador vê o limite estourado no campo, não num 400.
  const validacao = useMemo(() => ConfiguracaoDeAgenteSchema.safeParse(corpo), [modelo, descricao, instrucoes, contextoOperacional, habilitado, temperatura, maxTokens]);
  const erroDe = (campo: string) => validacao.success ? null : validacao.error.issues.find(i => i.path[0] === campo)?.message ?? null;
  // Campo vazio não conta como mudança: ele significa “não mexi nisso”, e o servidor mantém o valor que já estava gravado.
  const mudou = modelo !== (agente.modelo ?? "") || descricao !== (agente.descricao ?? "") || instrucoes !== agente.instrucoes || contextoOperacional !== (agente.contextoOperacional ?? "")
    || (corpo.temperatura !== undefined && corpo.temperatura !== (agente.temperatura ?? 0.3)) || (corpo.maxTokens !== undefined && corpo.maxTokens !== (agente.maxTokens ?? 600)) || habilitado !== agente.habilitado;
  const acao = useMutation({
    mutationFn: async (tipo: "salvar" | "provisionar" | "testar") => {
      if (tipo === "salvar") return { tipo, valor: await (await apiRequest("PUT", `${API}/${agente.tipo}`, corpo)).json() };
      return { tipo, valor: await (await apiRequest("POST", `${API}/${agente.tipo}/${tipo}`, {})).json() };
    },
    onSuccess: (r: { tipo: string; valor: PrimeiroContatoPreparado }) => {
      if (r.tipo === "testar") setPrevia(r.valor);
      else { queryClient.invalidateQueries({ queryKey: [API] }); queryClient.invalidateQueries({ queryKey: ["/api/chat-bullq/integracao"] }); }
      toast({ title: r.tipo === "testar" ? "Prévia gerada; nenhum envio realizado" : r.tipo === "salvar" ? "Configuração salva" : "Agente provisionado" });
    },
    onError: (e: Error) => { queryClient.invalidateQueries({ queryKey: [API] }); toast({ title: "Não foi possível concluir", description: mensagemDoErro(e), variant: "destructive" }); },
  });
  const bloqueado = !podeAdministrar || acao.isPending;
  const origemDoModelo = modelos.find(m => m.id === modelo)?.origem;
  return <article className="flex flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4" data-testid={`agente-${agente.tipo}`}>
    <div><h4 className="text-xs font-semibold text-[var(--text)]">{agente.nome}</h4><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{agente.papel}</p></div>
    <div><SeloCobranca tom={agente.etapa === "pronto" && agente.habilitado ? "ok" : agente.erro ? "danger" : "neutro"}>{!agente.habilitado ? "pausado" : ESTADOS[agente.etapa]}</SeloCobranca></div>

    <label className="block"><span className={ROTULO_CAMPO}>modelo</span>
      <select aria-label={`Modelo de ${agente.nome}`} className={cn(CONTROLE_CAMPO, "w-full font-mono text-xs tabular-nums")} value={modelo} onChange={e => setModelo(e.target.value)} disabled={bloqueado}>
        <option value="">Selecione um modelo</option>
        {modelo && !modelos.some(m => m.id === modelo) && <option value={modelo}>{modelo} · não verificado</option>}
        {modelos.map(m => <option value={m.id} key={m.id}>{m.id} · {ROTULO_DA_ORIGEM[m.origem ?? "chat_bullq"]}</option>)}
      </select>
      {origemDoModelo && <span className={cn("mt-1 block text-[11px]", origemDoModelo === "openai_vps" ? "text-[var(--gated)]" : "text-[var(--text-muted)]")}>{ORIGENS_DE_MODELO[origemDoModelo]}</span>}
      {erroDe("modelo") && <span role="alert" className="mt-1 block text-[11px] text-[var(--danger)]">{erroDe("modelo")}</span>}
    </label>

    <label className="block"><span className={ROTULO_CAMPO}>descrição do agente</span>
      <input aria-label={`Descrição de ${agente.nome}`} className={cn(CONTROLE_CAMPO, "w-full")} maxLength={LIMITES_DO_AGENTE.descricao} value={descricao} onChange={e => setDescricao(e.target.value)} disabled={bloqueado} placeholder="Ex.: assistente de cobrança da NsLink, atende de segunda a sexta." />
      <span className={cn(CONTADOR, "mt-1 block text-right")}>{descricao.length}/{LIMITES_DO_AGENTE.descricao}</span>
    </label>

    <label className="block"><span className={ROTULO_CAMPO}>preferências de escrita</span>
      <textarea aria-label={`Preferências de ${agente.nome}`} className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-24")} rows={4} maxLength={LIMITES_DO_AGENTE.instrucoes} value={instrucoes} onChange={e => setInstrucoes(e.target.value)} disabled={bloqueado} placeholder="Ex.: linguagem simples, cordial e breve." />
      <span className={cn(CONTADOR, "mt-1 block text-right")}>{instrucoes.length}/{LIMITES_DO_AGENTE.instrucoes}</span>
    </label>

    <label className="block"><span className={ROTULO_CAMPO}>contexto operacional do dia</span>
      <textarea aria-label={`Contexto operacional de ${agente.nome}`} className={CONTROLE_CAMPO_MULTILINHA} rows={3} maxLength={LIMITES_DO_AGENTE.contextoOperacional} value={contextoOperacional} onChange={e => setContextoOperacional(e.target.value)} disabled={bloqueado} placeholder="Avisos que valem hoje. Ex.: instabilidade no bairro Centro até as 18h; não prometer visita antes de quinta." />
      <span className="mt-1 block text-[11px] leading-4 text-[var(--text-muted)]">Vai gravado no prompt do agente ao aplicar, abaixo das regras da casa — só chega ao modelo depois de “{agente.id ? "Aplicar no agente" : "Provisionar"}”. Não substitui a política: desconto, baixa e negativação continuam fora da IA.</span>
      <span className={cn(CONTADOR, "mt-1 block text-right")}>{contextoOperacional.length}/{LIMITES_DO_AGENTE.contextoOperacional}</span>
    </label>

    <div className="grid grid-cols-2 gap-3">
      <label className="block"><span className={ROTULO_CAMPO}>temperatura</span>
        <input type="number" inputMode="decimal" aria-label={`Temperatura de ${agente.nome}`} className={cn(CONTROLE_CAMPO, "w-full font-mono text-xs tabular-nums")} min={LIMITES_DO_AGENTE.temperatura.min} max={LIMITES_DO_AGENTE.temperatura.max} step={LIMITES_DO_AGENTE.temperatura.passo} value={temperatura} onChange={e => setTemperatura(e.target.value)} disabled={bloqueado} />
        <span className={cn(CONTADOR, "mt-1 block")}>{LIMITES_DO_AGENTE.temperatura.min} a {LIMITES_DO_AGENTE.temperatura.max} · vazio mantém o atual</span>
        {erroDe("temperatura") && <span role="alert" className="mt-1 block text-[11px] text-[var(--danger)]">{erroDe("temperatura")}</span>}
      </label>
      <label className="block"><span className={ROTULO_CAMPO}>máximo de tokens</span>
        <input type="number" inputMode="numeric" aria-label={`Máximo de tokens de ${agente.nome}`} className={cn(CONTROLE_CAMPO, "w-full font-mono text-xs tabular-nums")} min={LIMITES_DO_AGENTE.maxTokens.min} max={LIMITES_DO_AGENTE.maxTokens.max} step={1} value={maxTokens} onChange={e => setMaxTokens(e.target.value)} disabled={bloqueado} />
        <span className={cn(CONTADOR, "mt-1 block")}>{LIMITES_DO_AGENTE.maxTokens.min} a {LIMITES_DO_AGENTE.maxTokens.max} · vazio mantém o atual</span>
        {erroDe("maxTokens") && <span role="alert" className="mt-1 block text-[11px] text-[var(--danger)]">{erroDe("maxTokens")}</span>}
      </label>
    </div>

    <label className="flex items-center gap-2 text-xs text-[var(--text-2)]"><input type="checkbox" checked={habilitado} onChange={e => setHabilitado(e.target.checked)} disabled={bloqueado} /> Habilitado para abrir contato</label>
    {agente.erro && <p role="alert" className="text-xs leading-5 text-[var(--danger)]">{agente.erro}</p>}
    <div className="mt-auto flex flex-wrap gap-2">
      <button className={cn(BOTAO_SECUNDARIO, "h-8 text-xs")} disabled={bloqueado || !mudou || !validacao.success} onClick={() => acao.mutate("salvar")}>Salvar</button>
      <button className={cn(BOTAO_MARCA, "h-8 text-xs")} disabled={bloqueado || mudou || !modelo || credencialAusente} title={credencialAusente ? SEM_CREDENCIAL : undefined} onClick={() => acao.mutate("provisionar")}>{agente.id ? "Aplicar no agente" : "Provisionar"}</button>
      <button className={cn(BOTAO_SECUNDARIO, "h-8 text-xs")} disabled={bloqueado || mudou || !habilitado || agente.etapa !== "pronto" || credencialAusente} title={credencialAusente ? SEM_CREDENCIAL : undefined} onClick={() => acao.mutate("testar")}>Testar sem enviar</button>
    </div>
    {credencialAusente && <p role="alert" className="text-[11px] leading-4 text-[var(--gated)]">{SEM_CREDENCIAL}</p>}
    {mudou && <p className="text-xs text-[var(--text-muted)]">Salve as alterações antes de aplicar ou testar.</p>}
    {previa && <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-3"><p className="text-xs leading-5 text-[var(--text)]">{previa.texto}</p><p className="mt-2 break-all font-mono text-[10px] text-[var(--text-muted)] tabular-nums">IA · {previa.modelo} · {previa.runId}</p></div>}

    {podeAdministrar && <details className="rounded border border-[var(--border)] bg-[var(--surface)]" onToggle={e => setPromptAberto((e.currentTarget as HTMLDetailsElement).open)} data-testid={`prompt-${agente.tipo}`}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--text-2)]">O que o agente recebe</summary>
      <div className="border-t border-[var(--border)] px-3 py-2">
        {prompt.isLoading ? <div className="h-24 rounded bg-[var(--surface-inset)] motion-safe:animate-pulse" aria-busy="true" /> : prompt.isError ? <p role="alert" className="text-xs text-[var(--danger)]">{mensagemDoErro(prompt.error)}</p> : prompt.data ? <>
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">É este texto que vai gravado no agente ao aplicar, e é ele que o modelo lê em toda geração. Gerado com a configuração salva{mudou ? " — as alterações ainda não salvas não aparecem" : ""}. As regras da casa vêm antes e mandam; as preferências e o contexto do dia ficam subordinados a elas.</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-[var(--text)]">{prompt.data.prompt}</pre>
          <p className={cn(CONTADOR, "mt-2")}>{prompt.data.caracteres} caracteres · {prompt.data.nomeProvedor}</p>
        </> : null}
      </div>
    </details>}
  </article>;
}
