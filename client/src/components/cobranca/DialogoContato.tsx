/**
 * Registrar contato — o funcionário conta o que aconteceu na ligação.
 *
 * `POST /api/cobranca/casos/:id/eventos` com tipo "contato", canal,
 * resultado, notas e, na mesma chamada, `proximoContatoEm` — é o que faz o
 * cliente voltar à fila na data certa ("não atendeu, tentar amanhã").
 * "Prometeu pagar" exige `promessaPara`: a rota recusa a promessa sem data,
 * porque promessa sem dia não se cobra. O corpo é estrito: só estes campos.
 *
 * Canal e resultado NÃO têm padrão: um contato registrado com "falou com o
 * cliente" porque a caixa já vinha assim é um fato inventado na linha do
 * tempo. O canal só vem preenchido quando a etapa o sugere.
 *
 * O diálogo é dono da própria mutação (molde: DialogoContato de recuperação):
 * quem o abre só diz qual caso.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { CANAIS_HUMANOS, RESULTADOS_DE_CONTATO, ROTULO_CANAL, ROTULO_RESULTADO, type CanalHumano, type ResultadoDeContato } from "@shared/cobranca";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA } from "@/components/painel/ui";
import { agoraInput, deInputDataHora, hojeInput, paraInputDataHora, validarProximoContato } from "./formatacao";
import { API_CASOS } from "./tipos";
import { descricaoDoErro, invalidarCobranca } from "./ui";

export interface AlvoDoContato {
  casoId: number;
  clienteNome: string;
  /** Canal que a etapa sugere — vira o padrão da caixa. */
  canalSugerido?: CanalHumano | null;
}

interface Form {
  /** Vazio até o operador escolher (ou a etapa sugerir). */
  canal: CanalHumano | "";
  /** Vazio até o operador escolher: o resultado é o fato, não um padrão. */
  resultado: ResultadoDeContato | "";
  ocorridoEm: string;
  notas: string;
  proximoContatoEm: string;
  prometidoPara: string;
}

function formInicial(alvo: AlvoDoContato | null): Form {
  return {
    canal: alvo?.canalSugerido ?? "",
    resultado: "",
    ocorridoEm: paraInputDataHora(new Date().toISOString()),
    notas: "",
    proximoContatoEm: "",
    prometidoPara: "",
  };
}

export function DialogoContato({ alvo, aberto, onFechar }: { alvo: AlvoDoContato | null; aberto: boolean; onFechar: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => formInicial(alvo));

  // Cada abertura começa limpa: o contato de ontem não é o de hoje.
  useEffect(() => { if (aberto) setForm(formInicial(alvo)); }, [aberto, alvo]);

  const registrar = useMutation({
    mutationFn: async () => {
      if (!alvo) throw new Error("Este cliente ainda não tem caso aberto");
      if (!form.canal || !form.resultado) throw new Error("Escolha o canal e o resultado do contato");
      const promessa = form.resultado === "promessa_pagamento";
      const proximo = deInputDataHora(form.proximoContatoEm);
      const resposta = await apiRequest("POST", `${API_CASOS}/${alvo.casoId}/eventos`, {
        tipo: "contato",
        canal: form.canal,
        resultado: form.resultado,
        ...(form.notas.trim() ? { notas: form.notas.trim() } : {}),
        ...(deInputDataHora(form.ocorridoEm) ? { ocorridoEm: deInputDataHora(form.ocorridoEm) } : {}),
        ...(promessa && form.prometidoPara ? { promessaPara: form.prometidoPara } : {}),
        ...(proximo ? { proximoContatoEm: proximo } : {}),
      });
      return resposta.json();
    },
    onSuccess: () => {
      invalidarCobranca();
      toast({
        title: "Contato registrado",
        description: `${form.canal ? ROTULO_CANAL[form.canal] : ""} · ${form.resultado ? ROTULO_RESULTADO[form.resultado] : ""}`,
      });
      onFechar();
    },
    onError: (erro: Error) => toast({ title: "Não foi possível registrar o contato", description: descricaoDoErro(erro), variant: "destructive" }),
  });

  const mudar = <K extends keyof Form>(chave: K, valor: Form[K]) => setForm(atual => ({ ...atual, [chave]: valor }));

  // Recusado antes de ir ao servidor: `min` no input só segura quem usa o seletor.
  const enviar = () => {
    const erroProximo = validarProximoContato(form.proximoContatoEm, new Date());
    if (erroProximo) {
      toast({ title: "Próximo contato no passado", description: erroProximo, variant: "destructive" });
      return;
    }
    registrar.mutate();
  };

  const semEscolha = !form.canal || !form.resultado;

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="sm:max-w-[540px]" data-testid="dialogo-contato">
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          <DialogDescription>{alvo ? `${alvo.clienteNome} · caso #${alvo.casoId}` : "Sem caso aberto"}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); enviar(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="canal">
              <select className={CONTROLE_CAMPO} required value={form.canal} onChange={e => mudar("canal", e.target.value as CanalHumano | "")} data-testid="contato-canal">
                <option value="" disabled>escolha o canal</option>
                {CANAIS_HUMANOS.map(c => <option key={c} value={c}>{ROTULO_CANAL[c]}</option>)}
              </select>
            </Campo>
            <Campo rotulo="quando">
              <input type="datetime-local" required className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} value={form.ocorridoEm} max={`${hojeInput()}T23:59`} onChange={e => mudar("ocorridoEm", e.target.value)} />
            </Campo>
          </div>
          <Campo rotulo="resultado">
            <select className={CONTROLE_CAMPO} required value={form.resultado} onChange={e => mudar("resultado", e.target.value as ResultadoDeContato | "")} data-testid="contato-resultado">
              <option value="" disabled>escolha o resultado</option>
              {RESULTADOS_DE_CONTATO.map(r => <option key={r} value={r}>{ROTULO_RESULTADO[r]}</option>)}
            </select>
          </Campo>
          {form.resultado === "promessa_pagamento" && (
            <Campo rotulo="prometeu pagar em (obrigatório)">
              <input type="date" required className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} min={hojeInput()} value={form.prometidoPara} onChange={e => mudar("prometidoPara", e.target.value)} data-testid="contato-prometido-para" />
            </Campo>
          )}
          <Campo rotulo="anotações">
            <textarea className={CONTROLE_CAMPO_MULTILINHA} placeholder="O que o cliente disse, em uma ou duas frases" value={form.notas} onChange={e => mudar("notas", e.target.value)} data-testid="contato-notas" />
          </Campo>
          <Campo rotulo="próximo contato (volta à fila nesta data)">
            <input type="datetime-local" className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} min={agoraInput()} value={form.proximoContatoEm} onChange={e => mudar("proximoContatoEm", e.target.value)} data-testid="contato-proximo" />
          </Campo>
          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
            <button
              type="submit"
              className={BOTAO_MARCA}
              title={semEscolha ? "Escolha o canal e o resultado" : undefined}
              disabled={registrar.isPending || !alvo || semEscolha || (form.resultado === "promessa_pagamento" && !form.prometidoPara)}
              data-testid="contato-salvar"
            >
              {registrar.isPending ? "Registrando…" : "Registrar contato"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
