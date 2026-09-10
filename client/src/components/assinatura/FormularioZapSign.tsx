/**
 * A conta ZapSign do provedor, configurada pelo superadmin na ficha do
 * provedor (aba Integração), ao lado do ERP. "Salvar" grava; "Ativar" testa o
 * token no ZapSign e liga — separados como "Salvar" e "Testar" do ERP.
 *
 * O servidor nunca devolve o token: o campo é de senha, vazio, e o que se
 * mostra é "gravado · final 1234". Token vazio ao salvar = "não mexe".
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  AMBIENTES_DE_ASSINATURA, AUTH_MODES_DO_CLIENTE, CUSTO_DO_AUTH_MODE, custoDaEmissao,
  type AmbienteDeAssinatura, type AuthModeDoCliente,
} from "@shared/cobranca/confissao";

interface EstadoDaConta {
  configurada: boolean;
  apiTokenGravado: boolean;
  apiTokenIlegivel: boolean;
  apiTokenFinal: string | null;
  ambiente: AmbienteDeAssinatura;
  templateId: string | null;
  signatarioNome: string | null;
  signatarioCpf: string | null;
  signatarioEmail: string | null;
  signatarioTelefone: string | null;
  provedorAssina: boolean;
  authModeCliente: AuthModeDoCliente;
  exigirSelfie: boolean;
  prazoAssinaturaDias: number;
  enviarArquivoAssinadoWhatsapp: boolean;
  modeloRevisadoEm: string | null;
  isEnabled: boolean;
  ativadaEm: string | null;
}

type Formulario = Omit<EstadoDaConta, "configurada" | "apiTokenGravado" | "apiTokenIlegivel" | "apiTokenFinal" | "modeloRevisadoEm" | "isEnabled" | "ativadaEm"> & { apiToken: string };

const ROTULO_AMBIENTE: Record<AmbienteDeAssinatura, string> = { sandbox: "Sandbox (testes — sem validade jurídica)", producao: "Produção" };

function formularioDe(e: EstadoDaConta): Formulario {
  return {
    apiToken: "",
    ambiente: e.ambiente, templateId: e.templateId, signatarioNome: e.signatarioNome, signatarioCpf: e.signatarioCpf, signatarioEmail: e.signatarioEmail,
    signatarioTelefone: e.signatarioTelefone, provedorAssina: e.provedorAssina, authModeCliente: e.authModeCliente, exigirSelfie: e.exigirSelfie,
    prazoAssinaturaDias: e.prazoAssinaturaDias, enviarArquivoAssinadoWhatsapp: e.enviarArquivoAssinadoWhatsapp,
  };
}

const CAMPO = "h-9 rounded text-[13px]";

export function FormularioZapSign({ providerId, ativo }: { providerId: number; ativo: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chave = ["/api/admin/providers", providerId, "assinatura", "zapsign"];
  const { data, isLoading, isError } = useQuery<EstadoDaConta>({
    queryKey: chave,
    queryFn: async () => (await apiRequest("GET", `/api/admin/providers/${providerId}/assinatura/zapsign`)).json(),
    enabled: ativo,
  });
  const [form, setForm] = useState<Formulario | null>(null);
  useEffect(() => { if (data && !form) setForm(formularioDe(data)); }, [data, form]);

  const salvar = useMutation({
    mutationFn: async (f: Formulario) => {
      const corpo: Record<string, unknown> = { ...f };
      if (!f.apiToken.trim()) delete corpo.apiToken;
      const res = await apiRequest("PUT", `/api/admin/providers/${providerId}/assinatura/zapsign`, corpo);
      return res.json() as Promise<EstadoDaConta>;
    },
    onSuccess: novo => { qc.setQueryData(chave, novo); setForm(formularioDe(novo)); toast({ title: "Configuração do ZapSign salva", description: novo.isEnabled ? "Integração ativa" : "Clique em Ativar para testar o token e ligar" }); },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });
  const ativar = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/providers/${providerId}/assinatura/zapsign/ativar`)).json() as Promise<EstadoDaConta>,
    onSuccess: novo => { qc.setQueryData(chave, novo); toast({ title: "ZapSign ativo", description: `Ambiente: ${ROTULO_AMBIENTE[novo.ambiente]}` }); },
    onError: (e: Error) => toast({ title: "O ZapSign recusou o token", description: e.message, variant: "destructive" }),
  });

  if (!ativo) return null;
  if (isLoading || !form) return <Card className="p-4 text-[12px] text-[var(--text-muted)]" data-testid="zapsign-carregando">Lendo a configuração do ZapSign…</Card>;
  if (isError) return <Card className="p-4 text-[12px] text-[var(--danger)]" data-testid="zapsign-erro">Não foi possível ler a configuração do ZapSign.</Card>;

  const custo = custoDaEmissao({ authMode: form.authModeCliente, ambiente: form.ambiente, enviarWhatsapp: form.enviarArquivoAssinadoWhatsapp, exigirSelfie: form.exigirSelfie });
  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const ocupado = salvar.isPending || ativar.isPending;

  return (
    <Card className="p-4 space-y-4" data-testid="card-zapsign">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}><FileSignature className="w-5 h-5" /></div>
          <div>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--text)", letterSpacing: "var(--track-tight)" }}>Assinatura eletrônica · ZapSign</h3>
            <p className="text-[12px] text-[var(--text-muted)]">A conta é do provedor: ele cria em zapsign.com.br, gera o token em Configurações › Integrações › API ZapSign e paga os documentos dele.</p>
          </div>
        </div>
        <span className={cn("inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[var(--track-wide)]", data?.isEnabled ? "border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok)]" : "border-[var(--gated-border)] bg-[var(--gated-bg)] text-[var(--gated)]")} data-testid="zapsign-status">
          {data?.isEnabled ? `ativa · ${ROTULO_AMBIENTE[data.ambiente]}` : data?.configurada ? "salva · não ativada" : "não configurada"}
        </span>
      </div>

      {data?.apiTokenIlegivel && (
        <p className="flex items-start gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[12px] text-[var(--danger)]" data-testid="zapsign-ilegivel">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> O token gravado não abre neste servidor (o segredo de sessão mudou). Redigite o token para salvar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="zapsign-ambiente" className="text-[12px]">Ambiente</Label>
          <Select value={form.ambiente} onValueChange={v => set("ambiente", v as AmbienteDeAssinatura)}>
            <SelectTrigger id="zapsign-ambiente" className={CAMPO}><SelectValue /></SelectTrigger>
            <SelectContent>{AMBIENTES_DE_ASSINATURA.map(a => <SelectItem key={a} value={a}>{ROTULO_AMBIENTE[a]}</SelectItem>)}</SelectContent>
          </Select>
          {form.ambiente === "sandbox" && <p className="text-[11px] text-[var(--gated)]">Sandbox: documento sem validade jurídica; nada é enviado ao cliente — o operador só copia o link.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="zapsign-token" className="text-[12px]">Token da API</Label>
          <Input id="zapsign-token" type="password" autoComplete="new-password" className={CAMPO} value={form.apiToken} onChange={e => set("apiToken", e.target.value)}
            placeholder={data?.apiTokenGravado ? `gravado · final ${data.apiTokenFinal ?? "????"} — deixe vazio para manter` : "cole o token da conta do provedor"} />
          <p className="text-[11px] text-[var(--text-faint)]">Trocar token ou ambiente exige Ativar de novo; o segredo do webhook é regenerado.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="zapsign-template" className="text-[12px]">Modelo do ZapSign (opcional)</Label>
          <Input id="zapsign-template" className={CAMPO} value={form.templateId ?? ""} onChange={e => set("templateId", e.target.value || null)} placeholder="template_id — vazio usa o modelo padrão do Consulta ISP" />
          <p className="text-[11px] text-[var(--text-faint)]">Variáveis do modelo: {"{{CREDOR_RAZAO_SOCIAL}}"}, {"{{DEVEDOR_NOME}}"}, {"{{VALOR_TOTAL}}"}, {"{{PARCELAS}}"}, {"{{ANEXO_FATURAS}}"} e as demais listadas na spec.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="zapsign-prazo" className="text-[12px]">Prazo para assinar (dias)</Label>
          <Input id="zapsign-prazo" type="number" min={1} max={90} className={cn(CAMPO, "font-mono tabular-nums")} value={form.prazoAssinaturaDias} onChange={e => set("prazoAssinaturaDias", Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="zapsign-auth-mode" className="text-[12px]">Como o cliente prova quem é (auth_mode)</Label>
          <Select value={form.authModeCliente} onValueChange={v => set("authModeCliente", v as AuthModeDoCliente)}>
            <SelectTrigger id="zapsign-auth-mode" className={CAMPO}><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUTH_MODES_DO_CLIENTE.map(m => (
                <SelectItem key={m} value={m}>{CUSTO_DO_AUTH_MODE[m].rotulo} · {CUSTO_DO_AUTH_MODE[m].creditos > 0 ? `${CUSTO_DO_AUTH_MODE[m].creditos} créditos` : CUSTO_DO_AUTH_MODE[m].reais > 0 ? `R$ ${CUSTO_DO_AUTH_MODE[m].reais.toFixed(2).replace(".", ",")}` : "sem custo"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-[var(--text-faint)]">Base legal: assinatura eletrônica admitida pelas partes (MP 2.200-2/2001, art. 10, §2º) e título executivo extrajudicial (CPC, art. 784, III e §4º). A prova é {CUSTO_DO_AUTH_MODE[form.authModeCliente].prova}. Custo por emissão: {custo.texto}.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-start gap-2 text-[12px]">
          <Switch checked={form.exigirSelfie} onCheckedChange={v => set("exigirSelfie", v)} aria-label="Exigir selfie" />
          <span>Exigir selfie do cliente<br /><span className="text-[11px] text-[var(--text-faint)]">Dado biométrico (LGPD art. 11, II, d) — desligado por padrão; 15 a 50 créditos por assinatura.</span></span>
        </label>
        <label className="flex items-start gap-2 text-[12px]">
          <Switch checked={form.enviarArquivoAssinadoWhatsapp} onCheckedChange={v => set("enviarArquivoAssinadoWhatsapp", v)} aria-label="Enviar o PDF assinado por WhatsApp" />
          <span>Enviar o PDF assinado por WhatsApp<br /><span className="text-[11px] text-[var(--text-faint)]">R$ 0,50 por envio, só em produção.</span></span>
        </label>
        <label className="flex items-start gap-2 text-[12px]">
          <Switch checked={form.provedorAssina} onCheckedChange={v => set("provedorAssina", v)} aria-label="O provedor também assina" />
          <span>O provedor também assina<br /><span className="text-[11px] text-[var(--text-faint)]">O título exige só a assinatura do devedor; ligar acrescenta um fluxo e trava o status até o representante assinar.</span></span>
        </label>
      </div>

      {form.provedorAssina && (
        <div className="grid gap-3 sm:grid-cols-4" data-testid="zapsign-representante">
          <div className="space-y-1"><Label htmlFor="zapsign-rep-nome" className="text-[12px]">Representante · nome</Label><Input id="zapsign-rep-nome" className={CAMPO} value={form.signatarioNome ?? ""} onChange={e => set("signatarioNome", e.target.value || null)} /></div>
          <div className="space-y-1"><Label htmlFor="zapsign-rep-cpf" className="text-[12px]">CPF</Label><Input id="zapsign-rep-cpf" className={cn(CAMPO, "font-mono tabular-nums")} value={form.signatarioCpf ?? ""} onChange={e => set("signatarioCpf", e.target.value || null)} /></div>
          <div className="space-y-1"><Label htmlFor="zapsign-rep-email" className="text-[12px]">E-mail</Label><Input id="zapsign-rep-email" type="email" className={CAMPO} value={form.signatarioEmail ?? ""} onChange={e => set("signatarioEmail", e.target.value || null)} /></div>
          <div className="space-y-1"><Label htmlFor="zapsign-rep-telefone" className="text-[12px]">Telefone</Label><Input id="zapsign-rep-telefone" className={cn(CAMPO, "font-mono tabular-nums")} value={form.signatarioTelefone ?? ""} onChange={e => set("signatarioTelefone", e.target.value || null)} /></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" className="h-9 rounded bg-[var(--action)] px-4 text-[13px] font-medium text-[var(--text-on-brand)] hover:bg-[var(--action-hover)] disabled:opacity-60" disabled={ocupado} onClick={() => salvar.mutate(form)} data-testid="zapsign-salvar">Salvar</button>
        <button type="button" className="h-9 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[13px] font-medium text-[var(--text)] disabled:opacity-60" disabled={ocupado || !data?.apiTokenGravado || data?.apiTokenIlegivel} onClick={() => ativar.mutate()} title="Testa no ZapSign o token da configuração SALVA e liga a integração — salve antes o que alterou" data-testid="zapsign-ativar">Ativar</button>
        <span className="text-[11px] text-[var(--text-faint)]">
          {data?.modeloRevisadoEm ? `Modelo padrão marcado como revisado pelo provedor em ${new Date(data.modeloRevisadoEm).toLocaleDateString("pt-BR")}.` : "O modelo padrão sai com o aviso \"sem parecer jurídico\" até um admin do provedor marcá-lo como revisado."}
        </span>
      </div>
    </Card>
  );
}
