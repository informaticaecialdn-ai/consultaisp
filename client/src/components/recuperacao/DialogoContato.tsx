/**
 * Registrar contato — uma tentativa de recuperação no caso.
 *
 * `POST /api/equipment/recovery-cases/:id/attempts`. O diálogo é dono da sua
 * mutação: quem o abre só precisa dizer qual card; a invalidação do board e
 * dos eventos sai daqui, para o card e o drawer refletirem a tentativa sem o
 * pai precisar saber.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { nomeDoEquipamento } from "./CardEquipamento";
import { CANAIS, QUERIES_AFETADAS, RESULTADOS_TENTATIVA, ROTULO_CANAL, ROTULO_RESULTADO, type CardKanban } from "./tipos";

import { hojeInput } from "./datas";

/** Reexportado: os outros diálogos já o buscam aqui. */
export { hojeInput };

/** `apiRequest` lança "409: {"message":"..."}"; aqui sai só a frase. */
export function mensagemDoErro(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  const corpo = texto.replace(/^\d{3}:\s*/, "");
  try {
    const json = JSON.parse(corpo) as { message?: unknown };
    if (typeof json.message === "string") return json.message;
  } catch {
    // não era JSON — devolve o texto como veio
  }
  return corpo;
}

export function invalidarTudoDoCaso(caseId?: number | null) {
  for (const chave of QUERIES_AFETADAS) queryClient.invalidateQueries({ queryKey: [chave] });
  if (caseId) queryClient.invalidateQueries({ queryKey: [`/api/equipment/recovery-cases/${caseId}/events`] });
}

interface DialogoContatoProps {
  card: CardKanban | null;
  aberto: boolean;
  onFechar: () => void;
}

const FORM_INICIAL = { channel: "whatsapp", result: "sem_resposta", occurredAt: hojeInput(), notes: "" };

export function DialogoContato({ card, aberto, onFechar }: DialogoContatoProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({ ...FORM_INICIAL });

  // Cada abertura começa limpa: a tentativa de ontem não é a de hoje.
  useEffect(() => { if (aberto) setForm({ ...FORM_INICIAL, occurredAt: hojeInput() }); }, [aberto]);

  const registrar = useMutation({
    mutationFn: async () => {
      if (!card?.caseId) throw new Error("Este equipamento ainda não tem caso aberto");
      const response = await apiRequest("POST", `/api/equipment/recovery-cases/${card.caseId}/attempts`, {
        ...form,
        notes: form.notes.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      invalidarTudoDoCaso(card?.caseId);
      toast({ title: "Contato registrado", description: `${ROTULO_CANAL[form.channel]} · ${ROTULO_RESULTADO[form.result]}` });
      onFechar();
    },
    onError: (error: Error) => toast({ title: "Não foi possível registrar o contato", description: mensagemDoErro(error), variant: "destructive" }),
  });

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          <DialogDescription>
            {card ? `${nomeDoEquipamento(card)} · ${card.cliente.nome}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); registrar.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Canal</Label>
              <Select value={form.channel} onValueChange={value => setForm(atual => ({ ...atual, channel: value }))}>
                <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{CANAIS.map(valor => <SelectItem key={valor} value={valor}>{ROTULO_CANAL[valor]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="contato-data">Data</Label>
              <Input id="contato-data" type="date" max={hojeInput()} required className="mt-1 min-h-11 font-mono tabular-nums" value={form.occurredAt} onChange={event => setForm(atual => ({ ...atual, occurredAt: event.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Resultado</Label>
            <Select value={form.result} onValueChange={value => setForm(atual => ({ ...atual, result: value }))}>
              <SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{RESULTADOS_TENTATIVA.map(valor => <SelectItem key={valor} value={valor}>{ROTULO_RESULTADO[valor]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="contato-notas">Observação</Label>
            <Textarea id="contato-notas" className="mt-1" placeholder="Contexto objetivo da tentativa" value={form.notes} onChange={event => setForm(atual => ({ ...atual, notes: event.target.value }))} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-11" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" className="min-h-11" disabled={registrar.isPending || !card?.caseId}>{registrar.isPending ? "Registrando..." : "Registrar contato"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
