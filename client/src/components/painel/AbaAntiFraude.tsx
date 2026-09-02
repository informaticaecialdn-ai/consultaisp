/**
 * Aba Anti-Fraude do Painel do Provedor.
 *
 * O provedor escolhe O QUE quer que a rede vigie na base dele (as regras) e
 * POR ONDE quer ser avisado (os canais). O catalogo, o padrao e a validacao
 * vivem em shared/antifraude-regras.ts — a mesma fonte que o servidor usa
 * para decidir.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, Save, Mail, MessageCircle, Webhook, Info, Loader2 } from "lucide-react";
import {
  CATALOGO_DE_REGRAS, REGRAS_PADRAO, TIPOS_DE_REGRA,
  type RegrasAntiFraude, type TipoDeRegra,
} from "@shared/antifraude-regras";

interface Canais {
  proactiveAlertsEnabled: boolean;
  webhookUrl: string;
  /** Para onde o e-mail vai hoje: o contato do provedor ou, sem ele, os admins. */
  emails: string[];
  whatsapp: string | null;
  whatsappDisponivel: boolean;
}

interface ConfigAntiFraude {
  regras: RegrasAntiFraude;
  canais: Canais;
}

const inteiro = (v: string, minimo: number): number => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(minimo, n) : minimo;
};

const valor = (v: string): number => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export function AbaAntiFraude({ podeEditar }: { podeEditar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ConfigAntiFraude>({
    queryKey: ["/api/anti-fraud/rules"],
    staleTime: 30_000,
  });

  const [regras, setRegras] = useState<RegrasAntiFraude>(REGRAS_PADRAO);
  const [avisos, setAvisos] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [sujo, setSujo] = useState(false);

  // O formulario nasce do servidor e so e sobrescrito enquanto o provedor nao
  // mexeu — senao um refetch no meio da edicao apagaria o que ele digitou.
  useEffect(() => {
    if (!data || sujo) return;
    setRegras(data.regras);
    setAvisos(data.canais.proactiveAlertsEnabled);
    setWebhookUrl(data.canais.webhookUrl || "");
  }, [data, sujo]);

  const salvar = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/anti-fraud/rules", {
        regras,
        canais: { proactiveAlertsEnabled: avisos, webhookUrl: webhookUrl.trim() },
      }),
    onSuccess: () => {
      setSujo(false);
      qc.invalidateQueries({ queryKey: ["/api/anti-fraud/rules"] });
      qc.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] });
      toast({ title: "Regras salvas", description: "A próxima consulta a um cliente seu já usa esta configuração." });
    },
    onError: (err: any) => {
      toast({ title: "Não foi possível salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });

  const mudarRegra = <T extends TipoDeRegra>(tipo: T, patch: Partial<RegrasAntiFraude[T]>) => {
    setSujo(true);
    setRegras(r => ({ ...r, [tipo]: { ...r[tipo], ...patch } }));
  };

  const ligadas = TIPOS_DE_REGRA.filter(t => regras[t].ativo).length;
  const canais = data?.canais;
  const bloqueado = !podeEditar || isLoading;

  return (
    <div className="space-y-4" data-testid="tab-content-anti-fraude">
      {/* Cabecalho */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-danger-bg)] flex items-center justify-center">
            <Shield className="w-5 h-5 text-[var(--color-danger)]" />
          </div>
          <div>
            <h2 className="font-bold text-base leading-tight">Anti-Fraude · o que vigiar na sua base</h2>
            <p className="text-xs text-muted-foreground">
              Você é avisado quando um cliente <strong>ativo</strong> seu é consultado por outro provedor da rede. Escolha quais.
            </p>
          </div>
        </div>
        {podeEditar && (
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => salvar.mutate()} disabled={!sujo || salvar.isPending} data-testid="button-salvar-anti-fraude">
            {salvar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
        )}
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Regras ligadas</p>
          <p className="text-lg font-bold font-mono tabular-nums" data-testid="text-regras-ligadas">{ligadas} <span className="text-xs font-normal text-muted-foreground">de {TIPOS_DE_REGRA.length}</span></p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Avisos</p>
          <p className={`text-lg font-bold ${avisos ? "text-[var(--color-success)]" : "text-muted-foreground"}`}>{avisos ? "Ligados" : "Desligados"}</p>
        </Card>
        <Card className="p-3 col-span-2 md:col-span-1">
          <p className="text-xs text-muted-foreground">Ex-cliente</p>
          <p className="text-sm font-medium leading-snug mt-0.5">Nunca gera aviso — não há contrato a proteger.</p>
        </Card>
      </div>

      {/* Regras */}
      <Card className="overflow-hidden" data-testid="card-regras-anti-fraude">
        <div className="px-4 py-3 border-b bg-[var(--surface-2)]">
          <p className="text-sm font-semibold">Regras</p>
          <p className="text-xs text-muted-foreground mt-0.5">Todas exigem contrato ativo (ou suspenso por atraso, que ainda é cliente). Ligue as que a equipe vai tratar.</p>
        </div>
        <div className="divide-y">
          {TIPOS_DE_REGRA.map(tipo => {
            const info = CATALOGO_DE_REGRAS[tipo];
            const regra = regras[tipo];
            return (
              <div key={tipo} className={`px-4 py-3 flex gap-4 ${regra.ativo ? "" : "opacity-70"}`} data-testid={`regra-${tipo}`}>
                <div className="pt-0.5">
                  <Switch
                    checked={regra.ativo}
                    disabled={bloqueado}
                    onCheckedChange={(ativo) => mudarRegra(tipo, { ativo } as Partial<RegrasAntiFraude[typeof tipo]>)}
                    data-testid={`switch-${tipo}`}
                    aria-label={info.titulo}
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{info.titulo}</p>
                    {tipo === "ativo_inadimplente" && (
                      <span className="text-[10px] font-mono uppercase tracking-[var(--track-wide)] px-1.5 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-ink)]">padrão</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{info.descricao}</p>
                  <p className="text-xs text-[var(--text-2)]">{info.porQue}</p>

                  {tipo === "ativo_inadimplente" && (
                    <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                      <span>a partir de</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-muted-foreground">R$</span>
                        <Input
                          type="number" min={0} step="1"
                          className="h-8 w-24 font-mono tabular-nums text-xs"
                          value={regras.ativo_inadimplente.valorMinimo}
                          disabled={bloqueado || !regra.ativo}
                          onChange={e => mudarRegra("ativo_inadimplente", { valorMinimo: valor(e.target.value) })}
                          data-testid="input-valor-minimo"
                        />
                      </span>
                      <span>vencidos há</span>
                      <Input
                        type="number" min={1} step="1"
                        className="h-8 w-20 font-mono tabular-nums text-xs"
                        value={regras.ativo_inadimplente.diasMinimo}
                        disabled={bloqueado || !regra.ativo}
                        onChange={e => mudarRegra("ativo_inadimplente", { diasMinimo: inteiro(e.target.value, 1) })}
                        data-testid="input-dias-minimo"
                      />
                      <span>dia{regras.ativo_inadimplente.diasMinimo === 1 ? "" : "s"} ou mais</span>
                    </div>
                  )}

                  {tipo === "contrato_novo" && (
                    <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                      <span>até</span>
                      <Input
                        type="number" min={1} max={365} step="1"
                        className="h-8 w-20 font-mono tabular-nums text-xs"
                        value={regras.contrato_novo.diasMaximo}
                        disabled={bloqueado || !regra.ativo}
                        onChange={e => mudarRegra("contrato_novo", { diasMaximo: inteiro(e.target.value, 1) })}
                        data-testid="input-dias-maximo"
                      />
                      <span>dias de contrato</span>
                    </div>
                  )}

                  {tipo === "consultas_repetidas" && (
                    <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                      <Input
                        type="number" min={2} max={20} step="1"
                        className="h-8 w-20 font-mono tabular-nums text-xs"
                        value={regras.consultas_repetidas.provedoresMinimos}
                        disabled={bloqueado || !regra.ativo}
                        onChange={e => mudarRegra("consultas_repetidas", { provedoresMinimos: inteiro(e.target.value, 2) })}
                        data-testid="input-provedores-minimos"
                      />
                      <span>ou mais provedores diferentes em 30 dias</span>
                    </div>
                  )}

                  {info.aviso && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1">
                      <Info className="w-3.5 h-3.5 mt-px shrink-0" />
                      <span>{info.aviso}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Canais */}
      <Card className="overflow-hidden" data-testid="card-canais-anti-fraude">
        <div className="px-4 py-3 border-b bg-[var(--surface-2)] flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Por onde avisar</p>
            <p className="text-xs text-muted-foreground mt-0.5">O alerta sempre aparece na tela Anti-Fraude. Os canais abaixo levam o aviso até você na hora.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Receber avisos</span>
            <Switch checked={avisos} disabled={bloqueado} onCheckedChange={(v) => { setSujo(true); setAvisos(v); }} data-testid="switch-avisos" aria-label="Receber avisos" />
          </div>
        </div>
        <div className="divide-y text-sm">
          <div className="px-4 py-3 flex items-start gap-3">
            <Mail className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">E-mail</p>
              {canais?.emails?.length ? (
                <p className="text-xs text-muted-foreground font-mono break-all" data-testid="text-emails-aviso">{canais.emails.join(", ")}</p>
              ) : (
                <p className="text-xs text-[var(--gated)]">Sem e-mail de contato e sem administrador com e-mail. Preencha o contato na aba Empresa.</p>
              )}
            </div>
          </div>
          <div className="px-4 py-3 flex items-start gap-3">
            <MessageCircle className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">WhatsApp</p>
              {!canais?.whatsappDisponivel ? (
                <p className="text-xs text-muted-foreground">Indisponível nesta instalação.</p>
              ) : canais.whatsapp ? (
                <p className="text-xs text-muted-foreground font-mono tabular-nums">{canais.whatsapp}</p>
              ) : (
                <p className="text-xs text-[var(--gated)]">Sem telefone de contato. Preencha na aba Empresa.</p>
              )}
            </div>
          </div>
          <div className="px-4 py-3 flex items-start gap-3">
            <Webhook className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">Webhook</p>
              <p className="text-xs text-muted-foreground mb-2">Recebe um POST em JSON a cada alerta — para integrar com o seu CRM ou automação.</p>
              <Input
                placeholder="https://..."
                value={webhookUrl}
                disabled={bloqueado}
                onChange={e => { setSujo(true); setWebhookUrl(e.target.value); }}
                className="h-8 text-xs font-mono"
                data-testid="input-webhook-url"
              />
            </div>
          </div>
        </div>
      </Card>

      {!podeEditar && (
        <p className="text-xs text-muted-foreground">Só o administrador do provedor altera as regras.</p>
      )}
    </div>
  );
}
