/**
 * Agendar a retirada — data/hora e método de coleta do caso.
 *
 * `PATCH /api/equipment/recovery-cases/:id { scheduledAt, collectionMethod }`.
 * Por padrão também leva a etapa para "agendado", porque agendar sem mudar a
 * etapa deixa o card dizendo "aguardando agendamento" com uma data marcada —
 * o operador desmarca quando não quiser (caso contestado, por exemplo).
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { nomeDoEquipamento } from "./CardEquipamento";
import { deInputDataHora, paraInputDataHora } from "./datas";
import { invalidarTudoDoCaso, mensagemDoErro } from "./DialogoContato";
import { METODOS_COLETA, ROTULO_METODO, type CardKanban } from "./tipos";

interface DialogoAgendarProps {
  card: CardKanban | null;
  aberto: boolean;
  onFechar: () => void;
}

export function DialogoAgendar({ card, aberto, onFechar }: DialogoAgendarProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({ scheduledAt: "", collectionMethod: "retirada", marcarEtapa: true });

  useEffect(() => {
    if (!aberto) return;
    setForm({
      scheduledAt: paraInputDataHora(card?.caso?.agendadoEm),
      collectionMethod: card?.caso?.metodo ?? "retirada",
      // Contestado não vira "agendado" por padrão: a contestação precisa ser resolvida antes.
      marcarEtapa: card?.caso?.status !== "contestado",
    });
  }, [aberto, card]);

  const agendar = useMutation({
    mutationFn: async () => {
      if (!card?.caseId) throw new Error("Este equipamento ainda não tem caso aberto");
      const response = await apiRequest("PATCH", `/api/equipment/recovery-cases/${card.caseId}`, {
        // Com o fuso do navegador resolvido: a string crua do input seria lida no fuso do servidor.
        scheduledAt: deInputDataHora(form.scheduledAt),
        collectionMethod: form.collectionMethod,
        ...(form.marcarEtapa ? { status: "agendado" } : {}),
      });
      return response.json();
    },
    onSuccess: () => {
      invalidarTudoDoCaso(card?.caseId);
      toast({ title: "Retirada agendada", description: new Date(form.scheduledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) });
      onFechar();
    },
    onError: (error: Error) => toast({ title: "Não foi possível agendar", description: mensagemDoErro(error), variant: "destructive" }),
  });

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Agendar retirada</DialogTitle>
          <DialogDescription>{card ? `${nomeDoEquipamento(card)} · ${card.cliente.nome}` : ""}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); agendar.mutate(); }}>
          <div>
            <Label htmlFor="agenda-quando">Data e hora</Label>
            <Input id="agenda-quando" type="datetime-local" required className="mt-1 min-h-11 font-mono tabular-nums" value={form.scheduledAt} onChange={event => setForm(atual => ({ ...atual, scheduledAt: event.target.value }))} />
          </div>
          <div>
            <Label>Método</Label>
            <Select value={form.collectionMethod} onValueChange={value => setForm(atual => ({ ...atual, collectionMethod: value }))}>
              <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{METODOS_COLETA.map(valor => <SelectItem key={valor} value={valor}>{ROTULO_METODO[valor]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-[var(--text-2)]">
            <Checkbox checked={form.marcarEtapa} onCheckedChange={valor => setForm(atual => ({ ...atual, marcarEtapa: valor === true }))} />
            Mudar a etapa do caso para "Agendado"
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-11" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" className="min-h-11" disabled={agendar.isPending || !form.scheduledAt || !card?.caseId}>{agendar.isPending ? "Salvando..." : "Salvar agendamento"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
