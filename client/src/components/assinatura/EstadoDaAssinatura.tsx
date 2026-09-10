/**
 * A assinatura eletrônica como o PROVEDOR a enxerga: só leitura, no molde de
 * `GET provider/erp-integrations`. Quem grava o token é o superadmin na ficha
 * do provedor; o admin do provedor faz uma coisa aqui — marca o modelo padrão
 * como revisado pelo jurídico dele, e o aviso "sem parecer jurídico" sai das
 * emissões seguintes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CUSTO_DO_AUTH_MODE, type EstadoDaAssinatura as Estado } from "@shared/cobranca/confissao";

export function EstadoDaAssinatura({ podeAdministrar }: { podeAdministrar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chave = ["/api/cobranca/confissoes/estado"];
  const { data, isLoading, isError } = useQuery<Estado>({ queryKey: chave, queryFn: async () => (await apiRequest("GET", "/api/cobranca/confissoes/estado")).json() });
  const revisar = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/cobranca/confissoes/modelo/revisado")).json() as Promise<Estado>,
    onSuccess: novo => { qc.setQueryData(chave, novo); toast({ title: "Modelo marcado como revisado", description: "As próximas confissões saem sem o aviso de parecer jurídico" }); },
    onError: (e: Error) => toast({ title: "Não foi possível", description: e.message, variant: "destructive" }),
  });
  const linha = (rotulo: string, valor: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-faint)] py-1.5 text-[12.5px] last:border-0">
      <span className="text-[var(--text-muted)]">{rotulo}</span><span className="text-right text-[var(--text)]">{valor}</span>
    </div>
  );
  return (
    <Card className="p-4" data-testid="card-assinatura-eletronica">
      <div className="mb-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}><FileSignature className="w-5 h-5" /></div>
        <div>
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--text)", letterSpacing: "var(--track-tight)" }}>Assinatura eletrônica (confissão de dívida)</h3>
          <p className="text-[12px] text-[var(--text-muted)]">Conta ZapSign do provedor, cadastrada pelo superadmin. Os custos por documento são da sua conta ZapSign.</p>
        </div>
      </div>
      {isError ? <p className="text-[12px] text-[var(--danger)]" data-testid="assinatura-erro">Não foi possível ler o estado da assinatura eletrônica.</p>
        : isLoading || !data ? <p className="text-[12px] text-[var(--text-muted)]">Lendo…</p> : (
        <div>
          {linha("estado", data.ativa ? "ativa" : data.configurada ? "salva, não ativada" : "não configurada — peça ao superadmin")}
          {linha("ambiente", data.ambiente === "producao" ? "produção" : data.ambiente === "sandbox" ? "sandbox — sem validade jurídica, nada é enviado ao cliente" : "—")}
          {linha("modelo do documento", data.modelo === "zapsign" ? "modelo próprio no ZapSign" : `modelo padrão do Consulta ISP v1.0${data.modeloRevisado ? " · revisado" : " · sem parecer jurídico"}`)}
          {linha("prova de quem assina", data.authMode ? `${CUSTO_DO_AUTH_MODE[data.authMode].rotulo} — ${CUSTO_DO_AUTH_MODE[data.authMode].prova}` : "—")}
          {linha("custo por emissão", data.custo?.texto ?? "—")}
          {linha("prazo para assinar", data.prazoAssinaturaDias ? `${data.prazoAssinaturaDias} dias` : "—")}
          {linha("o provedor também assina", data.provedorAssina ? "sim" : "não (o título exige só a assinatura do devedor)")}
          {data.motivo && <p className="mt-2 text-[12px] text-[var(--gated)]">{data.motivo}</p>}
          {data.modelo === "padrao" && !data.modeloRevisado && podeAdministrar && (
            <button type="button" className="mt-3 h-9 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[13px] font-medium text-[var(--text)] disabled:opacity-60" disabled={revisar.isPending} onClick={() => { if (window.confirm("Confirmar que o texto do modelo padrão foi revisado pelo jurídico do provedor? O aviso 'sem parecer jurídico' deixa de sair.")) revisar.mutate(); }} data-testid="marcar-modelo-revisado">
              Marcar o modelo padrão como revisado
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
