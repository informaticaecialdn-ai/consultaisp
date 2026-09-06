import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CATALOGO_DE_AGENTES, TIPOS_DE_AGENTE } from "@shared/chat-agentes";
import type { TemplateDatafy, TemplatesDeAbertura } from "@shared/chat-whatsapp";
import { analisarTemplateDeAbertura } from "@shared/chat-templates";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, CONTROLE_CAMPO } from "@/components/painel/ui";
import { mensagemDoErro } from "@/components/cobranca/ui";

const API = "/api/chat-bullq/integracao/canal/templates";
export function TemplatesDatafy({ podeAdministrar }: { podeAdministrar: boolean }) {
  const catalogo = useQuery<{ data: TemplateDatafy[]; templates: TemplatesDeAbertura }>({ queryKey: [API], enabled: podeAdministrar, retry: false });
  const [templates, setTemplates] = useState<TemplatesDeAbertura>({});
  useEffect(() => { if (catalogo.data) setTemplates(catalogo.data.templates); }, [catalogo.data]);
  const salvar = useMutation({ mutationFn: async () => (await apiRequest("PUT", API, { templates })).json(), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [API] }); } });
  if (!podeAdministrar) return null;
  return <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="chat-templates-datafy">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Datafy · abertura por template</h3><button type="button" className={BOTAO_SECUNDARIO} disabled={catalogo.isFetching} onClick={() => catalogo.refetch()}>Atualizar catálogo</button></div>
    <p className="text-xs leading-5 text-[var(--text-muted)]">Escolha a mensagem aprovada para cada operação. Na Datafy, o primeiro contato usa este template; a primeira resposta segue para a equipe humana. O texto livre preparado pelos agentes é usado nos canais Zappfy e Uazapi.</p>
    {catalogo.isLoading && <div className="grid gap-3 lg:grid-cols-3" aria-hidden data-testid="chat-templates-skeleton">{TIPOS_DE_AGENTE.map(tipo => <div key={tipo} className="space-y-2 rounded-md border border-[var(--border)] p-3"><Skeleton className="h-3 w-2/5" /><Skeleton className="h-9 w-full" /><Skeleton className="h-3 w-4/5" /></div>)}</div>}
    <fieldset disabled={catalogo.isLoading || catalogo.isError || salvar.isPending} className="grid gap-3 lg:grid-cols-3">
      {TIPOS_DE_AGENTE.map(tipo => {
        const atual = templates[tipo];
        const selecionado = catalogo.data?.data.find(t => t.name === atual?.nome && t.language === atual.idioma);
        const analise = selecionado ? analisarTemplateDeAbertura(selecionado) : null;
        return <div key={tipo} className="space-y-3 rounded-md border border-[var(--border)] p-3"><label className="space-y-2 text-xs"><span className="block font-semibold">{CATALOGO_DE_AGENTES[tipo].nome}</span><select className={CONTROLE_CAMPO} value={atual ? `${atual.nome}|${atual.idioma}` : ""} onChange={e => {
          const t = catalogo.data?.data.find(t => `${t.name}|${t.language}` === e.target.value);
          setTemplates(v => { const novo = { ...v }; if (!t) delete novo[tipo]; else novo[tipo] = { nome: t.name, idioma: t.language, variaveis: Array.from({ length: analisarTemplateDeAbertura(t).variaveis }, () => "nomeCliente" as const) }; return novo; });
        }}><option value="">Selecione um template</option>{catalogo.data?.data.map(t => { const a = analisarTemplateDeAbertura(t); return <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!a.compativel}>{t.name} · {t.language}{!a.compativel ? ` · ${a.motivo}` : ""}</option>; })}</select></label>
        {analise && <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--text-2)]">{analise.texto}</p>}
        {atual?.variaveis.map((v, i) => <label key={i} className="block space-y-1 text-xs"><span>Variável {`{{${i + 1}}}`}</span><select className={CONTROLE_CAMPO} value={v} onChange={e => { const valor = e.target.value as "nomeCliente" | "nomeProvedor"; setTemplates(c => ({ ...c, [tipo]: { ...atual, variaveis: atual.variaveis.map((x, j) => j === i ? valor : x) } })); }}><option value="nomeCliente">Primeiro nome do cliente</option><option value="nomeProvedor">Nome do provedor</option></select></label>)}
        </div>;
      })}
    </fieldset>
    {(catalogo.isError || salvar.isError) && <p role="alert" className="text-xs text-[var(--danger)]">{mensagemDoErro(catalogo.error ?? salvar.error)}</p>}
    {salvar.isSuccess && <p role="status" className="text-xs text-[var(--ok)]">Templates de abertura salvos.</p>}
    <button type="button" className={BOTAO_MARCA} disabled={catalogo.isLoading || catalogo.isError || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar templates"}</button>
  </section>;
}
