/**
 * O caso entra em CANCELAMENTO do contrato — com motivo, e com a ponte para o
 * módulo de equipamentos.
 *
 * "Cancelamento" é terminal para a cobrança (o cliente vai embora), mas é o
 * começo de outra fila: a ONU/roteador que ficou com ele. Por isso o diálogo
 * não fecha só o caso — ele oferece abrir a recuperação do equipamento no CRM
 * que já existe (/recuperacao). É a decisão do dono de 05/09/2026: a cobrança
 * produz o dado que o módulo de equipamentos vai cruzar com a OLT.
 *
 * O motivo é obrigatório porque o servidor exige (400 sem ele) e porque um
 * cancelamento sem motivo não diz nada a quem olhar a linha do tempo daqui a
 * seis meses.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { PackageSearch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, Campo } from "@/components/painel/ui";
import { API_CASOS } from "./tipos";
import { descricaoDoErro, invalidarCobranca } from "./ui";

export interface AlvoDoCancelamento {
  casoId: number;
  customerId: number;
  clienteNome: string;
}

const MOTIVO_MIN = 5;

export function DialogoCancelamento({ alvo, aberto, onFechar, onCancelado }: {
  alvo: AlvoDoCancelamento | null;
  aberto: boolean;
  onFechar: () => void;
  /** Chamado depois do PATCH gravado — o kanban usa para desfazer o otimismo ou invalidar. */
  onCancelado?: (alvo: AlvoDoCancelamento) => void;
}) {
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [concluido, setConcluido] = useState(false);
  useEffect(() => { if (aberto) { setMotivo(""); setConcluido(false); } }, [aberto, alvo]);

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!alvo) throw new Error("Nenhum caso selecionado");
      const texto = motivo.trim();
      if (texto.length < MOTIVO_MIN) throw new Error("Diga o motivo do cancelamento (ao menos algumas palavras).");
      const resposta = await apiRequest("PATCH", `${API_CASOS}/${alvo.casoId}`, { status: "cancelamento", motivo: texto });
      return resposta.json();
    },
    onSuccess: () => {
      invalidarCobranca();
      setConcluido(true);
      toast({ title: "Contrato em cancelamento", description: "O caso saiu da cobrança. Se o cliente ficou com equipamento, abra a recuperação." });
      if (alvo) onCancelado?.(alvo);
    },
    onError: (erro: Error) => toast({ title: "Não foi possível registrar o cancelamento", description: descricaoDoErro(erro), variant: "destructive" }),
  });

  const curto = motivo.trim().length < MOTIVO_MIN;

  return (
    <Dialog open={aberto} onOpenChange={open => { if (!open) onFechar(); }}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialogo-cancelamento">
        <DialogHeader>
          <DialogTitle>Cancelamento do contrato</DialogTitle>
          <DialogDescription>
            {alvo ? <>O caso de <b className="text-[var(--text)]">{alvo.clienteNome}</b> sai da cobrança. </> : null}
            O motivo fica na linha do tempo — é o que explica esta decisão daqui a seis meses.
          </DialogDescription>
        </DialogHeader>

        {!concluido ? (
          <>
            <Campo rotulo="motivo do cancelamento" testId="campo-motivo-cancelamento">
              <Textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={3}
                placeholder="Ex.: cliente pediu cancelamento em 03/09; mudou de cidade; migrou para outro provedor"
                data-testid="input-motivo-cancelamento"
              />
            </Campo>
            <DialogFooter className="gap-2">
              <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="botao-cancelar-cancelamento">Voltar</button>
              <button
                type="button"
                className={cn(BOTAO_MARCA, "disabled:cursor-not-allowed disabled:opacity-50")}
                disabled={curto || cancelar.isPending}
                onClick={() => cancelar.mutate()}
                data-testid="botao-confirmar-cancelamento"
              >
                {cancelar.isPending ? "Registrando..." : "Registrar cancelamento"}
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* A PONTE: cancelou devendo → o equipamento provavelmente ficou. O
                CRM de recuperação já existe; o kanban só leva até ele com o
                cliente pré-selecionado. Nada é aberto sozinho: quem abre o caso
                de retirada precisa da data de rescisão, que a cobrança não tem. */}
            <div className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-3 text-[12.5px] text-[var(--text-2)]" data-testid="sugestao-recuperacao">
              <p className="flex items-center gap-2 font-medium text-[var(--text)]">
                <PackageSearch className="h-4 w-4 text-[var(--gated)]" aria-hidden />
                O cliente ficou com equipamento?
              </p>
              <p className="mt-1">Abra o caso de retirada no CRM de recuperação — é de lá que sai a rota do técnico.</p>
            </div>
            <DialogFooter className="gap-2">
              <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} data-testid="botao-fechar-cancelamento">Fechar</button>
              {alvo && (
                <Link href={`/recuperacao?cliente=${alvo.customerId}`} className={BOTAO_MARCA} data-testid="link-abrir-recuperacao">
                  Abrir recuperação do equipamento
                </Link>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
