/**
 * Abrir negociação — quitação com desconto, parcelamento ou baixa negociada.
 *
 * `POST /api/cobranca/casos/:id/negociacoes`. A prévia (desconto, parcelas,
 * violações) roda aqui com a política que a tela leu, para o funcionário ver
 * o que a política recusa ANTES de apertar; quem decide é a rota, que
 * responde 422 com `violacoes` — e elas aparecem na mesma lista.
 *
 * "O cliente já aceitou" faz a negociação nascer aceita e o caso ir para
 * "acordo ativo" na mesma transação; sem a marca, fica como proposta.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, type ErroDaApi } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { brl, pct, ROTULO_TIPO_DE_NEGOCIACAO, TIPOS_DE_NEGOCIACAO, type Politica, type TipoDeNegociacao } from "@shared/cobranca";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, TabelaPainel, Td, Th } from "@/components/painel/ui";
import { dataCivilBr, hojeInput } from "./formatacao";
import { corpoDaNegociacao, formInicial, previaDaNegociacao, violacoesDoErro, type FormNegociacao } from "./negociacao-form";
import { API_CASOS } from "./tipos";
import { invalidarCobranca, mensagemDoErro } from "./ui";

export interface AlvoDaNegociacao {
  casoId: number;
  clienteNome: string;
  /** `valor_atual` do caso — a dívida de hoje, base do desconto. */
  valorAtual: number;
}

function primeiroVencimentoPadrao(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return hojeInput(d);
}

export function DialogoNegociacao({ alvo, politica, aberto, onFechar }: {
  alvo: AlvoDaNegociacao | null;
  politica: Politica | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormNegociacao>(() => formInicial(alvo?.valorAtual ?? 0, primeiroVencimentoPadrao()));
  const [violacoesDoServidor, setViolacoesDoServidor] = useState<string[]>([]);

  useEffect(() => {
    if (aberto) {
      setForm(formInicial(alvo?.valorAtual ?? 0, primeiroVencimentoPadrao()));
      setViolacoesDoServidor([]);
    }
  }, [aberto, alvo]);

  const valorOriginal = alvo?.valorAtual ?? 0;
  const previa = useMemo(() => previaDaNegociacao(form, valorOriginal, politica), [form, valorOriginal, politica]);
  const violacoes = violacoesDoServidor.length > 0 ? violacoesDoServidor : previa.violacoes;

  const propor = useMutation({
    mutationFn: async () => {
      if (!alvo) throw new Error("Este cliente ainda não tem caso aberto");
      const corpo = corpoDaNegociacao(form, valorOriginal);
      if (!corpo) throw new Error(previa.erro ?? "Preencha a proposta");
      const resposta = await apiRequest("POST", `${API_CASOS}/${alvo.casoId}/negociacoes`, corpo);
      return resposta.json();
    },
    onSuccess: () => {
      invalidarCobranca();
      toast({ title: form.aceita ? "Acordo registrado" : "Proposta registrada", description: `${ROTULO_TIPO_DE_NEGOCIACAO[form.tipo]} · ${alvo?.clienteNome ?? ""}` });
      onFechar();
    },
    onError: (erro: ErroDaApi) => {
      const doServidor = violacoesDoErro(erro);
      if (erro.status === 422 && doServidor.length > 0) {
        setViolacoesDoServidor(doServidor);
        return;
      }
      toast({ title: "Não foi possível registrar a negociação", description: mensagemDoErro(erro), variant: "destructive" });
    },
  });

  const mudar = <K extends keyof FormNegociacao>(chave: K, valor: FormNegociacao[K]) => {
    setViolacoesDoServidor([]);
    setForm(atual => ({ ...atual, [chave]: valor }));
  };

  const parcelamento = form.tipo === "parcelamento";
  const travado = propor.isPending || !alvo || previa.erro !== null || violacoes.length > 0;

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[600px]" data-testid="dialogo-negociacao">
        <DialogHeader>
          <DialogTitle>Abrir negociação</DialogTitle>
          <DialogDescription>
            {alvo ? <>{alvo.clienteNome} · dívida de <span className="font-mono tabular-nums text-[var(--money-neg)]">{brl(alvo.valorAtual)}</span></> : "Sem caso aberto"}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); propor.mutate(); }}>
          <Campo rotulo="tipo">
            <select className={CONTROLE_CAMPO} value={form.tipo} onChange={e => mudar("tipo", e.target.value as TipoDeNegociacao)} data-testid="negociacao-tipo">
              {TIPOS_DE_NEGOCIACAO.map(t => <option key={t} value={t}>{ROTULO_TIPO_DE_NEGOCIACAO[t]}</option>)}
            </select>
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="valor negociado (total que o cliente paga)">
              <input inputMode="decimal" required className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} value={form.valorNegociado} onChange={e => mudar("valorNegociado", e.target.value)} placeholder="0,00" data-testid="negociacao-valor" />
            </Campo>
            <div className="flex flex-col justify-end pb-2 text-[12px] text-[var(--text-muted)]">
              desconto <b className="font-mono tabular-nums text-[var(--text)]">{previa.erro ? "—" : pct(previa.descontoPct)}</b>
              {politica && <span className="ml-1 text-[var(--text-faint)]">· teto {pct(politica.negociacao.descontoMaxPct)}</span>}
            </div>
          </div>
          {parcelamento && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="entrada (à vista)">
                <input inputMode="decimal" className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} value={form.entrada} onChange={e => mudar("entrada", e.target.value)} placeholder="0,00" data-testid="negociacao-entrada" />
              </Campo>
              <Campo rotulo="parcelas">
                <input type="number" min={1} max={politica?.negociacao.maxParcelas ?? 240} required className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} value={form.parcelas} onChange={e => mudar("parcelas", e.target.value)} data-testid="negociacao-parcelas" />
              </Campo>
              <Campo rotulo="1º vencimento">
                <input type="date" required min={hojeInput()} className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} value={form.primeiroVencimento} onChange={e => mudar("primeiroVencimento", e.target.value)} data-testid="negociacao-vencimento" />
              </Campo>
            </div>
          )}

          {violacoes.length > 0 && (
            <ul className="space-y-1 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger)]" data-testid="negociacao-violacoes">
              {violacoes.map(v => <li key={v}>{v}</li>)}
            </ul>
          )}
          {previa.erro && <p className="text-[12px] text-[var(--text-muted)]">{previa.erro}</p>}

          {parcelamento && previa.parcelas && previa.parcelas.length > 0 && (
            <TabelaPainel testId="negociacao-previa">
              <thead><tr><Th>parcela</Th><Th alinhamento="direita">valor</Th><Th>vencimento</Th></tr></thead>
              <tbody>
                {previa.parcelas.map(p => (
                  <tr key={p.numero}>
                    <Td num alinhamento="esquerda">{p.numero}/{previa.parcelas!.length}</Td>
                    <Td num>{brl(p.valor)}</Td>
                    <Td num alinhamento="esquerda">{dataCivilBr(p.vencimento)}</Td>
                  </tr>
                ))}
              </tbody>
            </TabelaPainel>
          )}

          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[12.5px] text-[var(--text-2)]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={form.aceita} onChange={e => mudar("aceita", e.target.checked)} data-testid="negociacao-aceita" />
            O cliente já aceitou nesta conversa (o caso vai para "acordo ativo")
          </label>

          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
            <button type="submit" className={BOTAO_MARCA} disabled={travado} data-testid="negociacao-salvar">
              {propor.isPending ? "Registrando…" : form.aceita ? "Registrar acordo" : "Registrar proposta"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
