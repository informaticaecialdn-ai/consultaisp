/**
 * Registrar contato — o funcionário conta o que aconteceu na ligação e
 * FECHA O FOLLOW-UP: com que ação e em que dia o caso volta à fila.
 *
 * `POST /api/cobranca/casos/:id/eventos` com tipo "contato", canal,
 * resultado, notas e, na mesma chamada, `proximaAcao` + `proximoContatoEm` —
 * é o que faz o cliente voltar à fila na data certa, com a ação já escrita
 * ("não atendeu → ligar de novo amanhã"). "Prometeu pagar" exige
 * `promessaPara`: a rota recusa a promessa sem data, porque promessa sem dia
 * não se cobra. O corpo é estrito: só estes campos.
 *
 * Regra do follow-up (conceito de vendas que o dono trouxe, 05/09/2026):
 * todo contato termina com a próxima ação, o dono, o quando e o status. Caso
 * sem próxima ação vira dívida perdida — por isso ação e data são
 * OBRIGATÓRIAS aqui. O resultado SUGERE as duas (a caixa vem preenchida e o
 * operador só confirma ou troca); o que o operador digitou nunca é
 * sobrescrito por uma sugestão.
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

/** As próximas ações mais comuns da cobrança — um clique em vez de digitar. */
export const PROXIMAS_ACOES_COMUNS = [
  "Ligar de novo",
  "Cobrar a promessa",
  "Enviar boleto / PIX",
  "Enviar proposta de acordo",
  "Confirmar o pagamento",
  "Buscar outro telefone",
] as const;

/** O que cada resultado sugere como próxima ação e em quantos dias — o operador confirma ou troca. */
export const SUGESTAO_POR_RESULTADO: Record<ResultadoDeContato, { acao: string; emDias: number }> = {
  falou: { acao: "Confirmar o pagamento", emDias: 2 },
  nao_atendeu: { acao: "Ligar de novo", emDias: 1 },
  caixa_postal: { acao: "Ligar de novo em outro horário", emDias: 1 },
  promessa_pagamento: { acao: "Cobrar a promessa", emDias: 0 },
  recusou: { acao: "Enviar proposta de acordo", emDias: 3 },
  numero_errado: { acao: "Buscar outro telefone", emDias: 1 },
};

const HORA_DO_FOLLOW_UP = 9;

/** "AAAA-MM-DDTHH:MM" local, daqui a N dias às 9h — o valor de um `datetime-local`. */
export function inputDeFollowUp(emDias: number, agora: Date = new Date()): string {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + emDias, HORA_DO_FOLLOW_UP, 0, 0, 0);
  if (d.getTime() <= agora.getTime()) d.setTime(agora.getTime() + 60 * 60 * 1000); // hoje as 9h ja passou: daqui a uma hora
  return paraInputDataHora(d.toISOString());
}

/** A promessa vale como data do follow-up: cobra-se no dia prometido, às 9h. */
export function inputDaPromessa(prometidoPara: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(prometidoPara);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}T${String(HORA_DO_FOLLOW_UP).padStart(2, "0")}:00`;
}

interface Form {
  /** Vazio até o operador escolher (ou a etapa sugerir). */
  canal: CanalHumano | "";
  /** Vazio até o operador escolher: o resultado é o fato, não um padrão. */
  resultado: ResultadoDeContato | "";
  ocorridoEm: string;
  notas: string;
  proximaAcao: string;
  proximoContatoEm: string;
  prometidoPara: string;
  /** true enquanto o valor veio de uma sugestão (o operador ainda não mexeu) — só esses podem ser trocados por outra sugestão. */
  acaoSugerida: boolean;
  dataSugerida: boolean;
}

function formInicial(alvo: AlvoDoContato | null): Form {
  return {
    canal: alvo?.canalSugerido ?? "",
    resultado: "",
    ocorridoEm: paraInputDataHora(new Date().toISOString()),
    notas: "",
    proximaAcao: "",
    proximoContatoEm: "",
    prometidoPara: "",
    acaoSugerida: true,
    dataSugerida: true,
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
      const acao = form.proximaAcao.trim();
      if (!acao || !proximo) throw new Error("Todo contato termina com a próxima ação e o dia em que ela acontece");
      const resposta = await apiRequest("POST", `${API_CASOS}/${alvo.casoId}/eventos`, {
        tipo: "contato",
        canal: form.canal,
        resultado: form.resultado,
        ...(form.notas.trim() ? { notas: form.notas.trim() } : {}),
        ...(deInputDataHora(form.ocorridoEm) ? { ocorridoEm: deInputDataHora(form.ocorridoEm) } : {}),
        ...(promessa && form.prometidoPara ? { promessaPara: form.prometidoPara } : {}),
        proximaAcao: acao,
        proximoContatoEm: proximo,
      });
      return resposta.json();
    },
    onSuccess: () => {
      invalidarCobranca();
      toast({
        title: "Contato registrado",
        description: `${form.canal ? ROTULO_CANAL[form.canal] : ""} · ${form.resultado ? ROTULO_RESULTADO[form.resultado] : ""} · próxima ação: ${form.proximaAcao.trim()}`,
      });
      onFechar();
    },
    onError: (erro: Error) => toast({ title: "Não foi possível registrar o contato", description: descricaoDoErro(erro), variant: "destructive" }),
  });

  const mudar = <K extends keyof Form>(chave: K, valor: Form[K]) => setForm(atual => ({ ...atual, [chave]: valor }));

  /** O resultado sugere a próxima ação e a data — só sobre o que o operador ainda não escreveu. */
  const escolherResultado = (resultado: ResultadoDeContato | "") => setForm(atual => {
    const sugestao = resultado ? SUGESTAO_POR_RESULTADO[resultado] : null;
    const proximaAcao = atual.acaoSugerida && sugestao ? sugestao.acao : atual.proximaAcao;
    const proximoContatoEm = atual.dataSugerida && sugestao
      ? (resultado === "promessa_pagamento" ? (atual.prometidoPara ? inputDaPromessa(atual.prometidoPara) : atual.proximoContatoEm) : inputDeFollowUp(sugestao.emDias))
      : atual.proximoContatoEm;
    return { ...atual, resultado, proximaAcao, proximoContatoEm };
  });

  /** A data prometida vira a data do follow-up, enquanto o operador não escolher outra. */
  const escolherPromessa = (prometidoPara: string) => setForm(atual => ({
    ...atual,
    prometidoPara,
    proximoContatoEm: atual.dataSugerida && prometidoPara ? inputDaPromessa(prometidoPara) : atual.proximoContatoEm,
  }));

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
  const semFollowUp = !form.proximaAcao.trim() || !form.proximoContatoEm;
  const motivoDoBloqueio = semEscolha ? "Escolha o canal e o resultado" : semFollowUp ? "Diga a próxima ação e quando ela acontece" : undefined;

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="sm:max-w-[560px]" data-testid="dialogo-contato">
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
            <select className={CONTROLE_CAMPO} required value={form.resultado} onChange={e => escolherResultado(e.target.value as ResultadoDeContato | "")} data-testid="contato-resultado">
              <option value="" disabled>escolha o resultado</option>
              {RESULTADOS_DE_CONTATO.map(r => <option key={r} value={r}>{ROTULO_RESULTADO[r]}</option>)}
            </select>
          </Campo>
          {form.resultado === "promessa_pagamento" && (
            <Campo rotulo="prometeu pagar em (obrigatório)">
              <input type="date" required className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} min={hojeInput()} value={form.prometidoPara} onChange={e => escolherPromessa(e.target.value)} data-testid="contato-prometido-para" />
            </Campo>
          )}
          <Campo rotulo="anotações">
            <textarea className={CONTROLE_CAMPO_MULTILINHA} placeholder="O que o cliente disse, em uma ou duas frases" value={form.notas} onChange={e => mudar("notas", e.target.value)} data-testid="contato-notas" />
          </Campo>

          {/* Follow-up: o contato só fecha com a próxima ação e o dia — caso sem próxima ação vira dívida perdida. */}
          <fieldset className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3" data-testid="contato-followup">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">follow-up · o que acontece depois</legend>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Campo rotulo="próxima ação (obrigatório)">
                <input
                  type="text"
                  required
                  maxLength={120}
                  className={CONTROLE_CAMPO}
                  placeholder="ex.: ligar de novo, enviar boleto"
                  value={form.proximaAcao}
                  onChange={e => setForm(atual => ({ ...atual, proximaAcao: e.target.value, acaoSugerida: false }))}
                  data-testid="contato-proxima-acao"
                />
              </Campo>
              <Campo rotulo="quando (obrigatório)">
                <input
                  type="datetime-local"
                  required
                  className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                  min={agoraInput()}
                  value={form.proximoContatoEm}
                  onChange={e => setForm(atual => ({ ...atual, proximoContatoEm: e.target.value, dataSugerida: false }))}
                  data-testid="contato-proximo"
                />
              </Campo>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="próximas ações comuns">
              {PROXIMAS_ACOES_COMUNS.map(acao => (
                <button
                  key={acao}
                  type="button"
                  className={cn(
                    "rounded border px-2 py-1 text-[11px] leading-4 transition-colors",
                    form.proximaAcao === acao ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--border-strong)]",
                  )}
                  onClick={() => setForm(atual => ({ ...atual, proximaAcao: acao, acaoSugerida: false }))}
                  data-testid={`contato-acao-${acao}`}
                >
                  {acao}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">O caso volta à fila nesta data, com esta ação escrita no card. O dono continua sendo quem está no caso.</p>
          </fieldset>

          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
            <button
              type="submit"
              className={BOTAO_MARCA}
              title={motivoDoBloqueio}
              disabled={registrar.isPending || !alvo || semEscolha || semFollowUp || (form.resultado === "promessa_pagamento" && !form.prometidoPara)}
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
