/**
 * Abrir caso de recuperação — o que tira um equipamento de "sem data".
 *
 * `POST /api/equipment/recovery-cases`. A rescisão é o dado que dá idade ao
 * card; por isso é obrigatória e não pode estar no futuro. O servidor decide
 * a coluna depois — a tela não chuta a idade.
 *
 * Abre de três jeitos: botão "Abrir caso" do card (equipamento já escolhido),
 * arrasto de `sem_data` para uma idade (idem) e "Novo caso" do cabeçalho
 * (o operador escolhe entre os que estão sem caso).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MONO } from "@/components/localizacao/ui";
import { nomeDoEquipamento, OPCOES_PRIORIDADE } from "./CardEquipamento";
import { hojeInput, invalidarTudoDoCaso, mensagemDoErro } from "./DialogoContato";
import type { CardKanban, Responsavel } from "./tipos";

interface DialogoAbrirCasoProps {
  aberto: boolean;
  onFechar: () => void;
  /** Card já escolhido (botão do card ou arrasto); null = escolher na lista. */
  cardInicial: CardKanban | null;
  /** Cards de `sem_data`, para o "Novo caso" do cabeçalho. */
  candidatos: CardKanban[];
  responsaveis: Responsavel[];
}

const FORM_INICIAL = { equipmentId: "", terminationDate: "", priority: "normal", assignedToUserId: "", proofReference: "", notes: "" };

export function DialogoAbrirCaso({ aberto, onFechar, cardInicial, candidatos, responsaveis }: DialogoAbrirCasoProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({ ...FORM_INICIAL });

  useEffect(() => {
    if (!aberto) return;
    setForm({ ...FORM_INICIAL, terminationDate: hojeInput(), equipmentId: cardInicial ? String(cardInicial.equipamento.id) : "" });
  }, [aberto, cardInicial]);

  const escolhido = useMemo(
    () => cardInicial ?? candidatos.find(card => String(card.equipamento.id) === form.equipmentId) ?? null,
    [cardInicial, candidatos, form.equipmentId],
  );

  const abrir = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/equipment/recovery-cases", {
        equipmentId: Number(form.equipmentId),
        terminationDate: form.terminationDate,
        priority: form.priority,
        assignedToUserId: form.assignedToUserId ? Number(form.assignedToUserId) : undefined,
        proofReference: form.proofReference.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      invalidarTudoDoCaso();
      toast({ title: "Caso de recuperação aberto", description: escolhido ? `${nomeDoEquipamento(escolhido)} · ${escolhido.cliente.nome}` : undefined });
      onFechar();
    },
    onError: (error: Error) => toast({ title: "Não foi possível abrir o caso", description: mensagemDoErro(error), variant: "destructive" }),
  });

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Abrir caso de recuperação</DialogTitle>
          <DialogDescription>A data da rescisão define em qual faixa de idade o equipamento entra.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); abrir.mutate(); }}>
          {cardInicial ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
              <p className="text-[13px] font-medium text-[var(--text)]">{nomeDoEquipamento(cardInicial)}</p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]" style={MONO}>{cardInicial.equipamento.serie ?? cardInicial.equipamento.patrimonio ?? "sem identificação individual"}</p>
              <p className="mt-1 text-[12px] text-[var(--text-2)]">{cardInicial.cliente.nome} · <span style={MONO}>{cardInicial.cliente.documento}</span></p>
            </div>
          ) : (
            <div>
              <Label>Equipamento</Label>
              <Select value={form.equipmentId} onValueChange={value => setForm(atual => ({ ...atual, equipmentId: value }))}>
                <SelectTrigger className="mt-1 min-h-11"><SelectValue placeholder={candidatos.length ? "Selecione o equipamento sem caso" : "Nenhum equipamento aguardando caso"} /></SelectTrigger>
                <SelectContent>
                  {candidatos.map(card => (
                    <SelectItem key={card.chave} value={String(card.equipamento.id)}>
                      {nomeDoEquipamento(card)} · {card.cliente.nome}{card.equipamento.serie ? ` · ${card.equipamento.serie}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Só aparecem equipamentos com retirada pendente e sem caso aberto.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="caso-rescisao">Data da rescisão</Label>
              <Input id="caso-rescisao" type="date" required max={hojeInput()} className="mt-1 min-h-11 font-mono tabular-nums" value={form.terminationDate} onChange={event => setForm(atual => ({ ...atual, terminationDate: event.target.value }))} />
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={value => setForm(atual => ({ ...atual, priority: value }))}>
                <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{OPCOES_PRIORIDADE.map(opcao => <SelectItem key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Responsável</Label>
              <Select value={form.assignedToUserId || "sem"} onValueChange={value => setForm(atual => ({ ...atual, assignedToUserId: value === "sem" ? "" : value }))}>
                <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem responsável</SelectItem>
                  {responsaveis.map(usuario => <SelectItem key={usuario.id} value={String(usuario.id)}>{usuario.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="caso-prova">Termo ou OS</Label>
              <Input id="caso-prova" className="mt-1 min-h-11" placeholder="Ex.: OS-4821" value={form.proofReference} onChange={event => setForm(atual => ({ ...atual, proofReference: event.target.value }))} />
            </div>
          </div>

          <div>
            <Label htmlFor="caso-notas">Observação interna</Label>
            <Textarea id="caso-notas" className="mt-1" value={form.notes} onChange={event => setForm(atual => ({ ...atual, notes: event.target.value }))} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-11" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" className="min-h-11" disabled={abrir.isPending || !form.equipmentId || !form.terminationDate}>{abrir.isPending ? "Abrindo..." : "Abrir caso"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
