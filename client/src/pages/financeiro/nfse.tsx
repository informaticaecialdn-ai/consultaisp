import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileText, Send, RefreshCw, CheckCircle, XCircle, Clock,
  AlertTriangle, ExternalLink, Building2, User, DollarSign,
} from "lucide-react";

interface NfseConfig {
  configured: boolean;
  environment: string;
  cnpjPrestador: string;
  aliquotaIss: number;
  codigoServico: string;
  descricaoPadrao: string;
  /** Só a demonstração manda os quatro abaixo (nfse.routes.ts). */
  codigoMunicipio?: string;
  municipio?: string;
  uf?: string;
  razaoSocialPrestador?: string;
}

interface NfseResult {
  status: "processing" | "authorized" | "cancelled" | "error";
  ref: string;
  numero?: string;
  linkNfse?: string;
  mensagem?: string;
  erros?: Array<{ mensagem: string }>;
  /** Só as notas do histórico simulado da demonstração (GET /api/nfse) trazem estes. */
  tomadorNome?: string;
  valor?: number;
  emitidaEm?: string;
}

/**
 * O selo do ambiente no cabeçalho. Na demonstração pública o servidor responde
 * `environment: "demonstracao"` e emite nota simulada; cair no "HOMOLOGACAO"
 * de antes faria a nota de mentira parecer homologação real da Focus.
 */
export function seloDoAmbienteNfse(environment: string | null | undefined): { rotulo: string; simulado: boolean } {
  if (environment === "demonstracao") return { rotulo: "DEMONSTRACAO", simulado: true };
  return { rotulo: environment === "producao" ? "PRODUCAO" : "HOMOLOGACAO", simulado: false };
}

/**
 * O município da nota, lido da config. A tela tinha "Prefeitura de Sao Paulo"
 * e "Sao Paulo - SP" escritos à mão — e na demonstração o prestador é um
 * provedor de Londrina. Fora da demonstração o servidor não manda município, e
 * a tela segue com o texto de antes.
 */
export function municipioDaNfse(config: Pick<NfseConfig, "municipio" | "uf"> | null | undefined): { nome: string; uf: string } {
  if (config?.municipio && config.uf) return { nome: config.municipio, uf: config.uf };
  return { nome: "Sao Paulo", uf: "SP" };
}

/** "RAZAO SOCIAL · CNPJ 00.000.000/0000-00" — ou null, quando a config não diz quem é o prestador. */
export function prestadorDaNfse(config: Pick<NfseConfig, "razaoSocialPrestador" | "cnpjPrestador"> | null | undefined): string | null {
  if (!config?.razaoSocialPrestador) return null;
  const cnpj = String(config.cnpjPrestador ?? "").replace(/\D/g, "")
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return `${config.razaoSocialPrestador} · CNPJ ${cnpj}`;
}

export default function NfsePage() {
  const { provider, demoMode } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: config } = useQuery<NfseConfig>({
    queryKey: ["/api/nfse/config"],
  });
  const municipio = municipioDaNfse(config);
  const prestador = prestadorDaNfse(config);

  /* Histórico de notas: só a demonstração tem a rota (GET /api/nfse, simulada).
     Fora dela a query nem nasce — seria um pedido para rota que não existe —, e
     o que houver no cache é ignorado. */
  const { data: historicoDaDemo } = useQuery<NfseResult[]>({
    queryKey: ["/api/nfse"],
    enabled: demoMode === true,
  });

  const [form, setForm] = useState({
    // Tomador
    cnpjCpf: "",
    razaoSocial: "",
    email: "",
    telefone: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cep: "",
    uf: "",
    codigoMunicipio: "",
    // Servico
    descricao: "",
    valor: "",
  });

  const [emittedNotes, setEmittedNotes] = useState<NfseResult[]>([]);
  const [checkingRef, setCheckingRef] = useState<string | null>(null);
  /* As emitidas nesta visita primeiro; depois o histórico, sem repetir a mesma referência. */
  const notas = demoMode === true
    ? [...emittedNotes, ...(historicoDaDemo ?? []).filter(h => !emittedNotes.some(n => n.ref === h.ref))]
    : emittedNotes;

  const emitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/nfse/emit", {
        tomador: {
          cnpjCpf: form.cnpjCpf,
          razaoSocial: form.razaoSocial,
          email: form.email,
          telefone: form.telefone,
          logradouro: form.logradouro,
          numero: form.numero,
          complemento: form.complemento,
          bairro: form.bairro,
          cep: form.cep,
          uf: form.uf || config?.uf || "SP",
          codigoMunicipio: form.codigoMunicipio || config?.codigoMunicipio || "3550308",
        },
        descricao: form.descricao || config?.descricaoPadrao || "Licenciamento SaaS - Consulta ISP",
        valor: parseFloat(form.valor),
        codigoServico: config?.codigoServico || "01.07",
        aliquotaIss: config?.aliquotaIss || 2.90,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json() as Promise<NfseResult>;
    },
    onSuccess: (data) => {
      setEmittedNotes(prev => [data, ...prev]);
      toast({ title: "NFS-e enviada para processamento", description: `Ref: ${data.ref}` });
      // Limpar formulario
      setForm(f => ({ ...f, cnpjCpf: "", razaoSocial: "", email: "", valor: "" }));
    },
    onError: (e: any) => toast({ title: "Erro ao emitir NFS-e", description: e.message, variant: "destructive" }),
  });

  const checkStatus = async (ref: string) => {
    setCheckingRef(ref);
    try {
      const res = await apiRequest("GET", `/api/nfse/${ref}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      const result = await res.json() as NfseResult;
      // Nota do histórico da demonstração ainda não está em `emittedNotes`: entra
      // no topo, com tomador e valor preservados.
      setEmittedNotes(prev => prev.some(n => n.ref === ref)
        ? prev.map(n => n.ref === ref ? result : n)
        : [{ ...historicoDaDemo?.find(n => n.ref === ref), ...result }, ...prev]);
      if (result.status === "authorized") {
        toast({ title: "NFS-e autorizada!", description: `Numero: ${result.numero}` });
      }
    } catch (e: any) {
      toast({ title: "Erro ao consultar", description: e.message, variant: "destructive" });
    } finally {
      setCheckingRef(null);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "authorized": return <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />;
      case "cancelled": return <XCircle className="w-4 h-4 text-[var(--color-danger)]" />;
      case "error": return <AlertTriangle className="w-4 h-4 text-[var(--color-danger)]" />;
      default: return <Clock className="w-4 h-4 text-[var(--color-gold)]" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "authorized": return "Autorizada";
      case "cancelled": return "Cancelada";
      case "error": return "Erro";
      default: return "Processando";
    }
  };

  return (
    <div className="p-4 lg:p-5 pb-10 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--color-brand-bg)] flex items-center justify-center">
          <FileText className="w-5 h-5 text-[var(--color-brand)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">Notas Fiscais de Servico</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Emissao de NFS-e via Focus NFe — Prefeitura de {municipio.nome}
            {config && (
              <span className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded bg-[var(--color-tag-bg)]">
                {seloDoAmbienteNfse(config.environment).rotulo}
              </span>
            )}
          </p>
          {prestador && (
            <p className="text-xs text-[var(--color-muted)] mt-1" data-testid="nfse-prestador">Prestador: {prestador}</p>
          )}
          {config && seloDoAmbienteNfse(config.environment).simulado && (
            <p className="text-xs text-[var(--color-muted)] mt-1" data-testid="nfse-aviso-demonstracao">
              Ambiente de demonstração: as notas emitidas aqui são simuladas — nada vai para a Focus NFe nem para a prefeitura.
            </p>
          )}
        </div>
      </div>

      {!config?.configured && (
        <div className="rounded-lg border border-[var(--color-gold)] bg-[var(--color-gold-bg)] p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--color-gold)] mt-0.5" />
          <div>
            <p className="text-sm font-bold text-[var(--color-gold)]">Focus NFe nao configurado</p>
            <p className="text-xs text-[var(--color-muted)] mt-1">
              Adicione <code className="bg-[var(--color-tag-bg)] px-1 rounded">FOCUS_NFE_TOKEN</code> no arquivo .env do servidor.
              Crie uma conta em <a href="https://focusnfe.com.br" target="_blank" className="underline text-[var(--color-brand)]">focusnfe.com.br</a>
            </p>
          </div>
        </div>
      )}

      {/* Formulario de Emissao */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
          <Send className="w-4 h-4 text-[var(--color-muted)]" />
          <span className="text-sm font-bold uppercase tracking-wider text-[var(--color-ink)]">Emitir NFS-e</span>
        </div>

        <div className="p-5 space-y-5">
          {/* Tomador */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-4 h-4 text-[var(--color-muted)]" />
              <span className="text-sm font-bold text-[var(--color-ink)]">Tomador do Servico</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">CNPJ/CPF *</Label>
                <Input value={form.cnpjCpf} onChange={e => setForm(f => ({ ...f, cnpjCpf: e.target.value }))} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <Label className="text-xs">Razao Social *</Label>
                <Input value={form.razaoSocial} onChange={e => setForm(f => ({ ...f, razaoSocial: e.target.value }))} placeholder="Nome da empresa" />
              </div>
              <div>
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@empresa.com" />
              </div>
              <div>
                <Label className="text-xs">Telefone</Label>
                <Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} placeholder="(11) 99999-9999" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="col-span-2">
                <Label className="text-xs">Logradouro *</Label>
                <Input value={form.logradouro} onChange={e => setForm(f => ({ ...f, logradouro: e.target.value }))} placeholder="Rua, Av, etc" />
              </div>
              <div>
                <Label className="text-xs">Numero *</Label>
                <Input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="123" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-3">
              <div>
                <Label className="text-xs">Bairro *</Label>
                <Input value={form.bairro} onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))} placeholder="Centro" />
              </div>
              <div>
                <Label className="text-xs">CEP *</Label>
                <Input value={form.cep} onChange={e => setForm(f => ({ ...f, cep: e.target.value }))} placeholder="00000-000" />
              </div>
              <div>
                <Label className="text-xs">UF</Label>
                <Input value={form.uf} onChange={e => setForm(f => ({ ...f, uf: e.target.value }))} placeholder={municipio.uf} />
              </div>
              <div>
                <Label className="text-xs">Cod. Municipio</Label>
                <Input value={form.codigoMunicipio} onChange={e => setForm(f => ({ ...f, codigoMunicipio: e.target.value }))} placeholder={config?.codigoMunicipio || "3550308"} />
              </div>
            </div>
          </div>

          {/* Servico */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-[var(--color-muted)]" />
              <span className="text-sm font-bold text-[var(--color-ink)]">Servico</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Descricao do Servico</Label>
                <Input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder={config?.descricaoPadrao || "Licenciamento SaaS - Consulta ISP"} />
              </div>
              <div>
                <Label className="text-xs">Valor (R$) *</Label>
                <Input type="number" step="0.01" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} placeholder="149,00" />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-muted)]">
              <span>Codigo ISS: <strong>{config?.codigoServico || "01.07"}</strong></span>
              <span>Aliquota: <strong>{config?.aliquotaIss || 2.90}%</strong></span>
              <span>Municipio: <strong>{municipio.nome} - {municipio.uf}</strong></span>
            </div>
          </div>

          <Button
            className="w-full gap-2 bg-[var(--color-brand)] hover:opacity-90 text-white"
            onClick={() => emitMutation.mutate()}
            disabled={emitMutation.isPending || !form.cnpjCpf || !form.razaoSocial || !form.valor || !config?.configured}
          >
            {emitMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Emitir NFS-e
          </Button>
        </div>
      </div>

      {/* Notas Emitidas */}
      {notas.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--color-muted)]" />
            <span className="text-sm font-bold uppercase tracking-wider text-[var(--color-ink)]">Notas Emitidas</span>
            <span className="text-xs text-[var(--color-muted)] ml-auto">{notas.length} nota(s)</span>
          </div>

          <div className="divide-y divide-[var(--color-border)]">
            {notas.map(note => (
              <div key={note.ref} className="px-5 py-3 flex items-center gap-3">
                {statusIcon(note.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-ink)]">
                      {note.numero ? `NFS-e #${note.numero}` : note.ref}
                    </span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      note.status === "authorized" ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" :
                      note.status === "error" ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" :
                      "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
                    }`}>
                      {statusLabel(note.status)}
                    </span>
                  </div>
                  {(note.tomadorNome || note.valor != null) && (
                    <p className="text-xs text-[var(--color-ink)]">
                      {[
                        note.tomadorNome,
                        note.valor != null ? note.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null,
                        note.emitidaEm ? new Date(note.emitidaEm).toLocaleDateString("pt-BR") : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {note.mensagem && <p className="text-xs text-[var(--color-muted)]">{note.mensagem}</p>}
                  {note.erros && note.erros.length > 0 && (
                    <p className="text-xs text-[var(--color-danger)]">{note.erros.map(e => e.mensagem).join(", ")}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {note.linkNfse && (
                    <a href={note.linkNfse} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                        <ExternalLink className="w-3.5 h-3.5" /> Ver NFS-e
                      </Button>
                    </a>
                  )}
                  {note.status === "processing" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => checkStatus(note.ref)}
                      disabled={checkingRef === note.ref}
                    >
                      {checkingRef === note.ref ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Verificar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
