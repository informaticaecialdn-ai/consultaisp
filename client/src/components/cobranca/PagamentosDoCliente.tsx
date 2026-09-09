import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO } from "@/components/painel/ui";
import { brl } from "@/components/localizacao/ui";
import { dataCivilBr } from "./formatacao";
import { invalidarCobranca, mensagemDoErro, SeloCobranca } from "./ui";
import { caminhoNaCarteira } from "./carteiras";
import type { Carteira } from "@shared/cobranca";

interface Fatura { id: number; erpRef: string | null; vencimento: string; valor: number; status: string }
export interface RecebimentosDoCliente {
  quitacoes: { faturaId: number; valorPago: string; pagoEm: string; referencia: string; origem: string; divergenciaErpEm: string | null }[];
  faturas: { linhas: Fatura[]; total: number; limite: number; valorVencido: number };
  historico: { historicoInsuficiente: boolean; faturasPagas: number; faturasPagasComAtraso: number; taxaAtraso: number | null };
  /** `false` = o ERP deste provedor nunca confirmou pagamento algum (0036); ausente = desconhecido. */
  erpConfirmaPagamentos?: boolean | null;
}
const STATUS_CONFIRMAVEIS = new Set(["aberta", "pending", "overdue", "baixada_no_erp"]);
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function PagamentosDoCliente({ customerId, carteira, podeAdministrar, saldoAgregado }: { customerId: number; carteira: Carteira; podeAdministrar: boolean; saldoAgregado?: number }) {
  const chave = caminhoNaCarteira(`/api/cobranca/clientes/${customerId}/pagamentos`, carteira);
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery<RecebimentosDoCliente>({ queryKey: [chave], staleTime: 15_000 });
  const [fatura, setFatura] = useState<Fatura | null>(null);
  const [form, setForm] = useState({ valor: "", data: hoje(), referencia: "", conferido: false });
  const confirmar = useMutation({
    mutationFn: async () => {
      if (!fatura || !form.conferido) throw new Error("Confira o recebimento antes de confirmar");
      return (await apiRequest("POST", caminhoNaCarteira(`/api/cobranca/faturas/${fatura.id}/confirmar-quitacao`, carteira), {
        valorPago: Number(form.valor), pagoEm: form.data, referencia: form.referencia.trim(),
      })).json();
    },
    onSuccess: async () => {
      setFatura(null);
      await queryClient.invalidateQueries({ queryKey: [chave] });
      invalidarCobranca();
      toast({ title: "Recebimento confirmado", description: "A data de pagamento passa a compor o histórico do cliente e o DNA." });
    },
    onError: (erro: Error) => toast({ title: "Recebimento não confirmado", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  return <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="pagamentos-cliente">
    <div><h2 className="text-base font-semibold">Faturas e recebimentos confirmados</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Uma fatura que saiu da lista de pendências do ERP fica em conciliação até existir confirmação do pagamento. A conferência registrada aqui não altera o ERP.</p></div>
    {isLoading ? <p role="status" className="text-xs text-[var(--text-muted)]">Consultando faturas…</p>
      : isError ? <div role="alert" className="text-sm"><p>Não foi possível consultar os recebimentos.</p><button className={`${BOTAO_SECUNDARIO} mt-2 min-h-[44px]`} onClick={() => refetch()}>Tentar novamente</button></div>
      : data && <>
        {data.faturas.total > 0 && saldoAgregado !== undefined && Math.abs(data.faturas.valorVencido - saldoAgregado) >= 0.01 && <p className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] p-3 text-xs leading-5 text-[var(--gated)]">O saldo agregado do cliente ({brl(saldoAgregado)}) difere das faturas vencidas registradas ({brl(data.faturas.valorVencido)}). Confira a atualização do ERP e os comprovantes antes de cobrar; os valores não foram ajustados automaticamente.</p>}
        <p className="text-xs text-[var(--text-2)]" data-testid="historico-pagamentos">
          {data.historico.historicoInsuficiente
            ? (data.erpConfirmaPagamentos === false
              ? "O ERP deste provedor ainda não confirma pagamento algum: nenhuma fatura paga foi sincronizada, de nenhum cliente."
              : "Ainda não há pagamentos com data confirmada para calcular a confiabilidade histórica.")
            : <><b className="font-mono tabular-nums">{data.historico.faturasPagas}</b> faturas pagas com data · <b className="font-mono tabular-nums">{data.historico.faturasPagasComAtraso}</b> com atraso</>}
        </p>
        {data.faturas.linhas.length === 0 ? <p className="text-xs text-[var(--text-muted)]">Sem faturas sincronizadas para este cliente.</p>
          : <div className="max-h-[360px] overflow-auto"><table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--surface)] text-[var(--text-muted)]"><tr>{["fatura", "vencimento", "valor", "situação", "conferência"].map(t => <th key={t} className="border-b border-[var(--border)] px-2 py-3 font-medium">{t}</th>)}</tr></thead>
            <tbody>{data.faturas.linhas.map(l => <tr key={l.id} className="border-b border-[var(--border)]">
              <td className="px-2 py-2 font-mono tabular-nums">{l.erpRef ?? l.id}</td>
              <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{dataCivilBr(l.vencimento.slice(0, 10))}</td>
              <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{brl(l.valor)}</td>
              <td className="px-2 py-2"><SeloCobranca tom={l.status === "paid" ? "ok" : l.status === "baixada_no_erp" ? "gated" : "neutro"}>{l.status === "paid" ? "paga" : l.status === "baixada_no_erp" ? "em conciliação" : STATUS_CONFIRMAVEIS.has(l.status) ? "em aberto" : l.status}</SeloCobranca></td>
              <td className="px-2 py-2">{podeAdministrar && STATUS_CONFIRMAVEIS.has(l.status) && <button className={`${BOTAO_SECUNDARIO} min-h-[44px] whitespace-nowrap`} disabled={confirmar.isPending} onClick={() => { setFatura(l); setForm({ valor: l.valor.toFixed(2), data: hoje(), referencia: "", conferido: false }); }}>Conferir recebimento</button>}</td>
            </tr>)}</tbody>
          </table></div>}
        {data.faturas.total > data.faturas.linhas.length && <p className="text-xs text-[var(--text-muted)]">Exibindo as {data.faturas.linhas.length} faturas mais recentes de {data.faturas.total}. O histórico considera todas as faturas.</p>}
        {data.quitacoes?.length > 0 && <details className="border-t border-[var(--border)] pt-3">
          <summary className="min-h-[44px] cursor-pointer text-xs font-medium">Comprovantes e confirmações registrados ({data.quitacoes.length})</summary>
          <ul className="space-y-2 text-xs leading-5">{data.quitacoes.map(q => <li key={q.faturaId} className="rounded border border-[var(--border)] p-3">
            <p>Fatura {q.faturaId} · <span className="font-mono tabular-nums">{brl(Number(q.valorPago))}</span> · {dataCivilBr(q.pagoEm)}</p>
            <p className="text-[var(--text-muted)]">{q.origem === "erp_confirmado" ? "Confirmação do ERP" : "Comprovante conferido"} · referência {q.referencia}</p>
            {q.divergenciaErpEm && <p className="mt-1 text-[var(--gated)]">O ERP voltou a listar esta fatura em aberto. Confira a divergência antes de fazer novo contato; o recebimento confirmado foi preservado.</p>}
          </li>)}</ul>
        </details>}
      </>}
    {fatura && <form onSubmit={e => { e.preventDefault(); confirmar.mutate(); }} className="space-y-3 border-t border-[var(--border)] pt-4" aria-label="Confirmar recebimento da fatura">
      <h3 className="text-sm font-semibold">Conferir fatura {fatura.erpRef ?? fatura.id}</h3>
      <p className="text-xs leading-5 text-[var(--text-muted)]">Registre a quitação integral com a referência do comprovante ou lançamento bancário conferido. Pagamentos parciais de uma negociação devem ser registrados nas parcelas do acordo.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Campo rotulo="valor recebido"><input aria-label="valor recebido" type="number" step="0.01" min={fatura.valor} className={CONTROLE_CAMPO} required value={form.valor} disabled={confirmar.isPending} onChange={e => setForm(f => ({ ...f, valor: e.target.value, conferido: false }))} /></Campo>
        <Campo rotulo="data do recebimento"><input aria-label="data do recebimento" type="date" max={hoje()} className={CONTROLE_CAMPO} required value={form.data} disabled={confirmar.isPending} onChange={e => setForm(f => ({ ...f, data: e.target.value, conferido: false }))} /></Campo>
        <Campo rotulo="referência do comprovante"><input aria-label="referência do comprovante" className={CONTROLE_CAMPO} minLength={3} maxLength={200} required value={form.referencia} disabled={confirmar.isPending} onChange={e => setForm(f => ({ ...f, referencia: e.target.value, conferido: false }))} /></Campo>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-xs"><input type="checkbox" checked={form.conferido} disabled={confirmar.isPending} onChange={e => setForm(f => ({ ...f, conferido: e.target.checked }))} />Conferi o crédito recebido, a data e a referência.</label>
      <div className="flex flex-wrap gap-2"><button type="submit" className={`${BOTAO_MARCA} min-h-[44px]`} disabled={confirmar.isPending || !form.conferido}>{confirmar.isPending ? "Confirmando…" : "Confirmar recebimento"}</button><button type="button" className={`${BOTAO_SECUNDARIO} min-h-[44px]`} disabled={confirmar.isPending} onClick={() => setFatura(null)}>Cancelar</button></div>
    </form>}
  </section>;
}
