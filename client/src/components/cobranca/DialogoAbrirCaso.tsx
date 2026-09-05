/**
 * Abrir caso de cobrança — o que põe um cliente com dívida na fila.
 *
 * `POST /api/cobranca/casos { customerId, prioridade, responsavelUserId,
 * proximoContatoEm }`. A carteira, os dias de atraso e o valor de abertura o
 * servidor lê do próprio `customers` — a tela não os manda, para não abrir
 * um caso com a foto de um cliente que o sync já mudou.
 *
 * Cliente sem atraso não abre caso: na fase 1 `etapaParaAtraso(0)` cai na
 * janela do pré-aviso, que depende de fatura; o botão fica travado e a caixa
 * diz por quê.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { brl, PRIORIDADES, prescrita, ROTULO_MOTIVO_SEM_ETAPA, ROTULO_PRIORIDADE, type Prioridade } from "@shared/cobranca";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO } from "@/components/painel/ui";
import { agoraInput, deInputDataHora, validarProximoContato } from "./formatacao";
import { API_CASOS, type MembroDaEquipe } from "./tipos";
import { descricaoDoErro, invalidarCobranca, SeloCarteira } from "./ui";

export interface ClienteParaCaso {
  customerId: number;
  nome: string;
  carteira: string;
  dividaAtual: number;
  diasAtraso: number;
}

interface Form {
  prioridade: Prioridade;
  responsavelUserId: string;
  proximoContatoEm: string;
}

const FORM_INICIAL: Form = { prioridade: "normal", responsavelUserId: "", proximoContatoEm: "" };

export function DialogoAbrirCaso({ cliente, equipe, podeAtribuir, usuarioAtual, aberto, onFechar, onAberto }: {
  cliente: ClienteParaCaso | null;
  equipe: MembroDaEquipe[];
  /** Admin: escolhe qualquer um da equipe. Operador: só a fila geral ou ele mesmo (a rota permite "pegar para mim"). */
  podeAtribuir: boolean;
  usuarioAtual: { id: number; nome: string } | null;
  aberto: boolean;
  onFechar: () => void;
  onAberto?: (casoId: number) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(FORM_INICIAL);

  useEffect(() => { if (aberto) setForm(FORM_INICIAL); }, [aberto, cliente]);

  const semAtraso = !!cliente && cliente.diasAtraso <= 0;
  const dividaPrescrita = !!cliente && prescrita(cliente.diasAtraso);

  const abrir = useMutation({
    mutationFn: async () => {
      if (!cliente) throw new Error("Escolha o cliente");
      // Sem responsável a chave nem vai: a rota trata `null` como atribuição e a recusa a quem não é admin.
      const proximo = deInputDataHora(form.proximoContatoEm);
      const resposta = await apiRequest("POST", API_CASOS, {
        customerId: cliente.customerId,
        prioridade: form.prioridade,
        ...(form.responsavelUserId ? { responsavelUserId: Number(form.responsavelUserId) } : {}),
        ...(proximo ? { proximoContatoEm: proximo } : {}),
      });
      return resposta.json() as Promise<{ id?: number }>;
    },
    onSuccess: caso => {
      invalidarCobranca();
      toast({ title: "Caso de cobrança aberto", description: cliente?.nome });
      if (caso?.id && onAberto) onAberto(caso.id);
      onFechar();
    },
    onError: (erro: Error) => toast({ title: "Não foi possível abrir o caso", description: descricaoDoErro(erro), variant: "destructive" }),
  });

  // Recusado antes de ir ao servidor: `min` no input só segura quem usa o seletor.
  const enviar = () => {
    const erroProximo = validarProximoContato(form.proximoContatoEm, new Date());
    if (erroProximo) {
      toast({ title: "Primeiro contato no passado", description: erroProximo, variant: "destructive" });
      return;
    }
    abrir.mutate();
  };

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialogo-abrir-caso">
        <DialogHeader>
          <DialogTitle>Abrir caso de cobrança</DialogTitle>
          <DialogDescription>O caso guarda a foto de hoje (dívida e atraso) e coloca o cliente na fila.</DialogDescription>
        </DialogHeader>
        {cliente && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-[var(--text)]">{cliente.nome}</p>
              <SeloCarteira carteira={cliente.carteira} />
            </div>
            <p className="mt-1 font-mono text-[12px] tabular-nums text-[var(--text-2)]">
              <span className="text-[var(--money-neg)]">{brl(cliente.dividaAtual)}</span> · {cliente.diasAtraso} dias de atraso
            </p>
          </div>
        )}
        {semAtraso && (
          <p className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2 text-[12px] text-[var(--gated)]" data-testid="abrir-caso-sem-atraso">
            Sem atraso não há o que cobrar: o lembrete antes do vencimento {ROTULO_MOTIVO_SEM_ETAPA.depende_de_fatura.toLowerCase()}.
          </p>
        )}
        {dividaPrescrita && (
          <p className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger)]" data-testid="abrir-caso-prescrita">
            {ROTULO_MOTIVO_SEM_ETAPA.prescrita}: cinco anos de atraso (CC art. 206 §5º). Cobrar dívida prescrita é vedado.
          </p>
        )}
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); enviar(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="prioridade">
              <select className={CONTROLE_CAMPO} value={form.prioridade} onChange={e => setForm(a => ({ ...a, prioridade: e.target.value as Prioridade }))} data-testid="abrir-caso-prioridade">
                {PRIORIDADES.map(p => <option key={p} value={p}>{ROTULO_PRIORIDADE[p]}</option>)}
              </select>
            </Campo>
            <Campo rotulo="responsável">
              <select className={CONTROLE_CAMPO} value={form.responsavelUserId} title={podeAtribuir ? undefined : "Operador só pega o caso para si; quem distribui é o administrador"} onChange={e => setForm(a => ({ ...a, responsavelUserId: e.target.value }))} data-testid="abrir-caso-responsavel">
                <option value="">fila geral (qualquer operador)</option>
                {podeAtribuir
                  ? equipe.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)
                  : usuarioAtual && <option value={usuarioAtual.id}>{usuarioAtual.nome} (eu)</option>}
              </select>
            </Campo>
          </div>
          <Campo rotulo="primeiro contato em (opcional)">
            <input type="datetime-local" className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} min={agoraInput()} value={form.proximoContatoEm} onChange={e => setForm(a => ({ ...a, proximoContatoEm: e.target.value }))} data-testid="abrir-caso-proximo" />
          </Campo>
          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
            <button type="submit" className={BOTAO_MARCA} disabled={abrir.isPending || !cliente || semAtraso || dividaPrescrita} data-testid="abrir-caso-salvar">
              {abrir.isPending ? "Abrindo…" : "Abrir caso"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
