import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AvisosFaturasSchema, type ConfigAvisosFaturas } from "@shared/cobranca/preventivo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Simulacao {
  dia: string; analisadas: number; elegiveis: number; excluidas: number; limitada: boolean;
  fonte: string; calendarioPermitido: boolean;
  itens: Array<{ faturaId: number; customerId: number; nome: string; vencimento: string; valor: number;
    ultimaSincronizacao: string | null; elegivel: boolean; motivos: string[] }>;
}
const CONFIG_URL = "/api/cobranca/avisos-faturas/config";

export function AvisosFaturas() {
  const { user } = useAuth();
  const administrador = user?.role === "admin" || user?.role === "superadmin";
  const consulta = useQuery<ConfigAvisosFaturas>({ queryKey: [CONFIG_URL] });
  const [rascunho, setRascunho] = useState<ConfigAvisosFaturas | null>(null);
  const config = rascunho ?? consulta.data;
  const [diasTexto, setDiasTexto] = useState<string | null>(null);
  const [dia, setDia] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [filtro, setFiltro] = useState("todos");
  const [pagina, setPagina] = useState(1);
  const [sucesso, setSucesso] = useState(false);
  const validada = AvisosFaturasSchema.safeParse(config && { ...config, diasAntes: diasTexto === null ? config.diasAntes : diasTexto.split(",").map(d => d.trim() === "" ? NaN : Number(d)) });
  const salvar = useMutation({
    mutationFn: async () => {
      if (!validada.success) throw new Error("Informe dias únicos entre 0 e 30 separados por vírgulas.");
      return (await apiRequest("PUT", CONFIG_URL, validada.data)).json() as Promise<ConfigAvisosFaturas>;
    },
    onSuccess: (dados) => { queryClient.setQueryData([CONFIG_URL], dados); setRascunho(null); setDiasTexto(null); setSucesso(true); },
  });
  const simular = useMutation({
    mutationFn: async () => {
      if (!validada.success) throw new Error("Revise os dias e o limite diário antes de simular.");
      return (await apiRequest("POST", "/api/cobranca/avisos-faturas/simular", { dia, config: validada.data })).json() as Promise<Simulacao>;
    },
    onSuccess: () => { setPagina(1); },
  });
  const alterar = (dados: Partial<ConfigAvisosFaturas>) => { if (config) setRascunho({ ...config, ...dados }); setSucesso(false); simular.reset(); };
  if (consulta.isLoading) return <p role="status">Carregando avisos de faturas…</p>;
  if (consulta.error || !config) return <div role="alert"><p>Não foi possível carregar os avisos de faturas.</p><Button variant="outline" onClick={() => consulta.refetch()}>Tentar novamente</Button></div>;
  const itens = simular.data?.itens.filter(i => filtro === "todos" || (filtro === "elegiveis" ? i.elegivel : !i.elegivel)) ?? [];
  const erro = salvar.error ?? simular.error;
  return <section className="space-y-5" aria-label="Avisos de faturas">
    <div><h2 className="text-lg font-medium text-[var(--text)]">Avisos de faturas</h2><p className="text-sm text-[var(--text-muted)]">Lembretes para clientes ativos em dia, antes ou no vencimento. A configuração é exclusiva deste provedor.</p></div>
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
      <div className="flex items-center gap-3"><Switch id="avisos-ligados" checked={config.ligada} disabled={!administrador || salvar.isPending} onCheckedChange={ligada => alterar({ ligada })} /><Label htmlFor="avisos-ligados">Ativar avisos de faturas</Label></div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="avisos-dias">Dias antes do vencimento</Label><Input id="avisos-dias" className="font-mono tabular-nums" value={diasTexto ?? config.diasAntes.join(", ")} disabled={!administrador} onChange={e => { setDiasTexto(e.target.value); setSucesso(false); simular.reset(); }} /><p className="text-xs text-[var(--text-muted)]">Ex.: 7, 3, 1. Use 0 para o dia do vencimento.</p></div>
        <div className="space-y-2"><Label htmlFor="avisos-canal">Canal dos avisos</Label><select id="avisos-canal" className="h-10 w-full rounded border bg-[var(--surface)] px-3 text-sm" value={config.canal} disabled={!administrador} onChange={e => alterar({ canal: e.target.value as ConfigAvisosFaturas["canal"] })}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">E-mail</option></select></div>
        <div className="space-y-2"><Label htmlFor="avisos-limite">Limite de avisos por dia</Label><Input id="avisos-limite" type="number" min={1} max={10000} className="font-mono tabular-nums" value={config.limiteDiario} disabled={!administrador} onChange={e => alterar({ limiteDiario: Number(e.target.value) })} /></div>
      </div>
      {config.canal !== "whatsapp" && <div className="space-y-1"><div className="flex items-center gap-3"><Switch id="avisos-link" checked={config.incluirLinkFatura ?? false} disabled={!administrador} onCheckedChange={incluirLinkFatura => alterar({ incluirLinkFatura })} /><Label htmlFor="avisos-link">Incluir link da fatura confirmado pelo ERP</Label></div><p className="text-xs text-[var(--text-muted)]">O link de pagamento será enviado ao telefone ou e-mail cadastrado. Ative quando esses contatos estiverem conferidos. Sem confirmação atual do ERP, o aviso com link não será enviado.</p></div>}
      {!validada.success && <p role="alert" className="text-sm text-[var(--danger)]">Use até 10 dias únicos entre 0 e 30 e limite entre 1 e 10.000.</p>}
      {administrador && <Button disabled={!validada.success || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar configuração"}</Button>}
      {sucesso && <p role="status" className="text-sm text-[var(--ok)]">Configuração salva.</p>}
    </div>
    <div className="flex flex-wrap items-end gap-3"><div className="space-y-2"><Label htmlFor="avisos-dia">Dia da simulação</Label><Input id="avisos-dia" type="date" className="font-mono tabular-nums" value={dia} onChange={e => { setDia(e.target.value); simular.reset(); }} /></div><Button variant="outline" disabled={!validada.success || !dia || simular.isPending} onClick={() => simular.mutate()}>{simular.isPending ? "Simulando…" : "Simular público"}</Button><p className="text-xs text-[var(--text-muted)]">Usa as opções acima sem salvar nem enviar mensagens.</p></div>
    {erro && <p role="alert" className="text-sm text-[var(--danger)]">{erro.message}</p>}
    {simular.data && <div className="space-y-3">
      <p className="text-sm font-mono tabular-nums">{simular.data.analisadas} faturas analisadas · {simular.data.elegiveis} elegíveis · {simular.data.excluidas} excluídas</p>
      <p className="text-xs text-[var(--text-muted)]">{simular.data.fonte} Consulta faturas com vencimento entre 30 dias antes e 30 dias depois da data escolhida.</p>
      {!simular.data.calendarioPermitido && <p className="text-sm text-[var(--gated)]">A janela de contato não permite envio ao meio-dia nessa data. O agendamento respeita a janela do provedor.</p>}
      {simular.data.limitada && <p role="status" className="text-sm text-[var(--gated)]">Amostra limitada às primeiras 1.000 faturas. Os totais se referem somente à amostra.</p>}
      <Label htmlFor="avisos-filtro">Exibir</Label><select id="avisos-filtro" className="ml-3 h-10 rounded border bg-[var(--surface)] px-3 text-sm" value={filtro} onChange={e => { setFiltro(e.target.value); setPagina(1); }}><option value="todos">Todas as faturas</option><option value="elegiveis">Elegíveis</option><option value="excluidas">Excluídas</option></select>
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-[var(--bg)]"><tr><th className="p-3">Cliente / fatura</th><th className="p-3">Vencimento</th><th className="p-3">Valor</th><th className="p-3">Resultado</th><th className="p-3">Última sincronização</th></tr></thead><tbody>{itens.slice((pagina - 1) * 20, pagina * 20).map(item => <tr key={item.faturaId} className="border-t"><td className="p-3">{item.nome} <span className="font-mono tabular-nums text-[var(--text-muted)]">#{item.faturaId}</span></td><td className="p-3 font-mono tabular-nums">{item.vencimento.split("-").reverse().join("/")}</td><td className="p-3 font-mono tabular-nums">{item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td><td className="p-3">{item.elegivel ? "Elegível para agendamento" : item.motivos.join(" · ")}</td><td className="p-3 font-mono tabular-nums">{item.ultimaSincronizacao ? new Date(item.ultimaSincronizacao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não informada"}</td></tr>)}</tbody></table>{itens.length === 0 && <p className="p-4 text-sm text-[var(--text-muted)]">Nenhuma fatura neste filtro.</p>}</div>
      {itens.length > 20 && <div className="flex items-center gap-3"><Button variant="outline" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button><span className="font-mono text-sm tabular-nums">{pagina} / {Math.ceil(itens.length / 20)}</span><Button variant="outline" disabled={pagina * 20 >= itens.length} onClick={() => setPagina(pagina + 1)}>Próxima</Button></div>}
    </div>}
  </section>;
}
