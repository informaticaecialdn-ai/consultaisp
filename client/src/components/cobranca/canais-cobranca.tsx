import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ConfiguracaoCanais, type ResumoCanais } from "@shared/cobranca/canais-comunicacao";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const endpoint = "/api/cobranca/canais";
export function CanaisCobranca({ podeEditar = false }: { podeEditar?: boolean }) {
  const id = useId();
  const { provider } = useAuth();
  const baseWebhook = typeof window !== "undefined" ? window.location.origin : "";
  const smsWebhook = `${baseWebhook}/api/webhooks/canais/sms/${provider?.id || "PROVEDOR"}`;
  const emailWebhook = `${baseWebhook}/api/webhooks/canais/email/${provider?.id || "PROVEDOR"}`;
  const { toast } = useToast();
  const cache = useQueryClient();
  const consulta = useQuery<ResumoCanais>({ queryKey: [endpoint] });
  const [form, setForm] = useState<ConfiguracaoCanais | null>(null);
  const [alterado, setAlterado] = useState(false);
  useEffect(() => {
    if (consulta.data && !alterado) {
      const { configurado: _sms, recebimentoConfigurado: _smsRetorno, ...sms } = consulta.data.sms;
      const { configurado: _email, recebimentoConfigurado: _emailRetorno, ...email } = consulta.data.email;
      setForm({ sms: { ...sms, authToken: "" }, email: { ...email, apiKey: "", webhookSecret: "" } });
    }
  }, [consulta.data, alterado]);
  const salvar = useMutation({
    mutationFn: async () => (await apiRequest("PUT", endpoint, form)).json() as Promise<ResumoCanais>,
    onSuccess: (dados) => {
      cache.setQueryData([endpoint], dados);
      setForm(f => f ? { sms: { ...f.sms, authToken: "" }, email: { ...f.email, apiKey: "", webhookSecret: "" } } : f);
      setAlterado(false);
      toast({ title: "Canais salvos", description: "A configuração não dispara mensagens." });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível salvar", description: erro.message, variant: "destructive" }),
  });
  if (consulta.isLoading) return <p className="text-sm text-muted-foreground">Carregando canais…</p>;
  if (consulta.isError) return <div role="alert" className="text-sm">Não foi possível carregar os canais. <Button variant="outline" onClick={() => consulta.refetch()}>Tentar novamente</Button></div>;
  if (!form) return null;
  const desabilitado = !podeEditar || salvar.isPending;
  const campo = (canal: "sms" | "email", chave: string, valor: string | boolean) => {
    setForm(f => f ? { ...f, [canal]: { ...f[canal], [chave]: valor } } : f);
    setAlterado(true);
  };
  return <form onSubmit={e => { e.preventDefault(); salvar.mutate(); }} className="space-y-4">
    <div><h3 className="text-sm font-medium">SMS e e-mail</h3><p className="text-xs text-muted-foreground mt-1">Use sua conta Twilio para SMS e Resend para e-mail. Os custos são cobrados pelos fornecedores.</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      <fieldset disabled={desabilitado} className="rounded-lg border p-4 space-y-3">
        <legend className="px-1 text-sm font-medium">SMS · Twilio</legend>
        <div className="flex items-center justify-between gap-2"><Label htmlFor={`${id}-sms`}>Ativar SMS</Label><Switch id={`${id}-sms`} checked={form.sms.ativado} onCheckedChange={v => campo("sms", "ativado", v)} /></div>
        <p className="text-xs text-muted-foreground">{consulta.data?.sms.configurado ? "Credenciais salvas" : "Aguardando configuração"}</p>
        <div className="space-y-1"><Label htmlFor={`${id}-sid`}>Account SID</Label><Input id={`${id}-sid`} value={form.sms.accountSid} onChange={e => campo("sms", "accountSid", e.target.value)} placeholder="AC…" autoComplete="off" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-token`}>Auth Token</Label><Input id={`${id}-token`} type="password" value={form.sms.authToken || ""} onChange={e => campo("sms", "authToken", e.target.value)} placeholder={consulta.data?.sms.configurado ? "Salvo · deixe vazio para manter" : "Token da conta Twilio"} autoComplete="new-password" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-numero`}>Número remetente</Label><Input id={`${id}-numero`} type="tel" value={form.sms.remetente} onChange={e => campo("sms", "remetente", e.target.value)} placeholder="+5511999999999" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-sms-webhook`}>URL de recebimento no chat</Label><Input id={`${id}-sms-webhook`} type="url" value={form.sms.webhookUrl || ""} onChange={e => campo("sms", "webhookUrl", e.target.value)} placeholder={smsWebhook} /></div>
        <p className="text-xs text-muted-foreground">Cadastre esta mesma URL HTTPS no número Twilio, em “A message comes in”, com método POST. O número precisa receber SMS. <a className="underline" href="https://www.twilio.com/docs/messaging/guides/webhook-request" target="_blank" rel="noreferrer">Instruções da Twilio</a></p>
        <p className="text-xs text-muted-foreground">{consulta.data?.sms.recebimentoConfigurado ? "Respostas de SMS entram no chat quando a URL de recebimento estiver configurada na Twilio e aqui: confirme a mesma URL no painel Twilio." : "Respostas de SMS entram no chat quando a URL de recebimento estiver configurada na Twilio e aqui; sem ela, o canal é só envio."}</p>
      </fieldset>
      <fieldset disabled={desabilitado} className="rounded-lg border p-4 space-y-3">
        <legend className="px-1 text-sm font-medium">E-mail · Resend</legend>
        <div className="flex items-center justify-between gap-2"><Label htmlFor={`${id}-email`}>Ativar e-mail</Label><Switch id={`${id}-email`} checked={form.email.ativado} onCheckedChange={v => campo("email", "ativado", v)} /></div>
        <p className="text-xs text-muted-foreground">{consulta.data?.email.configurado ? "Credenciais salvas" : "Aguardando configuração"}</p>
        <div className="space-y-1"><Label htmlFor={`${id}-key`}>Chave de API</Label><Input id={`${id}-key`} type="password" value={form.email.apiKey || ""} onChange={e => campo("email", "apiKey", e.target.value)} placeholder={consulta.data?.email.configurado ? "Salva · deixe vazio para manter" : "re_…"} autoComplete="new-password" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-nome`}>Nome do remetente</Label><Input id={`${id}-nome`} value={form.email.nomeRemetente} maxLength={120} onChange={e => campo("email", "nomeRemetente", e.target.value)} placeholder="Seu provedor" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-from`}>E-mail remetente</Label><Input id={`${id}-from`} type="email" value={form.email.remetente} onChange={e => campo("email", "remetente", e.target.value)} placeholder="financeiro@seuprovedor.com.br" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-reply`}>Receber respostas em</Label><Input id={`${id}-reply`} type="email" value={form.email.responderPara} onChange={e => campo("email", "responderPara", e.target.value)} placeholder="atendimento@seuprovedor.com.br" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-receiving`}>Domínio de respostas no chat</Label><Input id={`${id}-receiving`} value={form.email.receivingDomain || ""} onChange={e => campo("email", "receivingDomain", e.target.value)} placeholder="respostas.seuprovedor.com.br" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-email-secret`}>Segredo do webhook Resend</Label><Input id={`${id}-email-secret`} type="password" autoComplete="new-password" value={form.email.webhookSecret || ""} onChange={e => campo("email", "webhookSecret", e.target.value)} placeholder={consulta.data?.email.recebimentoConfigurado ? "Salvo · deixe vazio para manter" : "whsec_…"} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-email-webhook`}>URL para cadastrar no Resend</Label><Input id={`${id}-email-webhook`} readOnly value={emailWebhook} /></div>
        <p className="text-xs text-muted-foreground">Verifique o domínio de envio e habilite o domínio de recebimento com os registros DNS indicados pelo Resend. Cadastre a URL HTTPS acima com o evento “email.received” e use uma chave de API que permita ler os e-mails recebidos. <a className="underline" href="https://resend.com/docs/dashboard/receiving/introduction" target="_blank" rel="noreferrer">Configurar recebimento</a></p>
        <p className="text-xs text-muted-foreground">{consulta.data?.email.recebimentoConfigurado ? "Recebimento configurado aqui; confirme domínio e webhook no Resend. Respostas às mensagens enviadas pelo chat retornam à conversa." : "Sem domínio e webhook de recebimento, as respostas vão para a caixa de e-mail indicada acima."}</p>
      </fieldset>
    </div>
    {podeEditar && <Button type="submit" disabled={!alterado || salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar canais"}</Button>}
  </form>;
}
