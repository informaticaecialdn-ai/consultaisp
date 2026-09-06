import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Atendimento } from "./Atendimento";
import { BOTAO_CHAT_MARCA, LINK_CHAT } from "./PerfilDoCliente";
import { rotaChat } from "./tipos";

export function ChatDaRecuperacao({ casoId }: { casoId: number }) {
  const qc = useQueryClient();
  const base = `/api/chat-bullq/recuperacao/${casoId}`;
  const conversa = useQuery<{ conversationId: string; status: string } | null>({
    queryKey: [`${base}/conversa`],
  });
  const iniciar = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `${base}/enviar`, {})).json(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [`${base}/conversa`] });
    },
    retry: false,
  });
  return (
    <section
      className="overflow-hidden rounded-lg border border-[var(--border)]"
      aria-label="Chat da recuperação"
    >
      <div className="flex items-center justify-between gap-3 p-3 text-xs">
        <strong>Conversa sobre a retirada</strong>
        {conversa.data && (
          <Link
            href={rotaChat("equipamentos", conversa.data.conversationId)}
            className={LINK_CHAT}
          >
            Abrir atendimento →
          </Link>
        )}
      </div>
      {conversa.data ? (
        <Atendimento
          conversationId={conversa.data.conversationId}
          origem="equipamentos"
          compacto
        />
      ) : (
        <div className="space-y-2 p-3 text-xs text-[var(--text-muted)]">
          <p>
            O assistente inicia o contato. Após a resposta, a equipe combina e
            registra a retirada.
          </p>
          <button
            type="button"
            disabled={
              conversa.isPending || iniciar.isPending || conversa.isError
            }
            className={BOTAO_CHAT_MARCA}
            onClick={() => iniciar.mutate()}
          >
            {iniciar.isPending ? "Iniciando…" : "Iniciar contato"}
          </button>
        </div>
      )}
      {(iniciar.isError || conversa.isError) && (
        <p role="alert" className="p-3 text-xs text-[var(--danger)]">
          Não foi possível abrir o chat. Confira a integração no Painel do
          Provedor e atualize antes de tentar novamente.
        </p>
      )}
    </section>
  );
}
