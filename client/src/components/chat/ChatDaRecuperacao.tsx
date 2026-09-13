import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Atendimento } from "./Atendimento";
import { BOTAO_CHAT_MARCA, LINK_CHAT } from "./PerfilDoCliente";
import { rotaChat } from "./tipos";

const AVISO_GENERICO =
  "Não foi possível abrir o chat. Confira a integração no Painel do Provedor e atualize antes de tentar novamente.";

/**
 * A frase do alerta. Quando o servidor recusa o contato ele já diz por quê
 * (caso encerrado ou contestado, chat desligado) e o `apiRequest` entrega essa
 * frase em `error.message`. Trocá-la por "confira a integração" mandava o
 * operador caçar defeito numa integração que estava funcionando. O palpite só
 * vale quando não veio frase nenhuma ou quando a própria leitura da conversa
 * falhou.
 */
export function avisoDoChat(
  erroAoIniciar: Error | null,
  conversaFalhou: boolean,
): string | null {
  if (erroAoIniciar) return erroAoIniciar.message.trim() || AVISO_GENERICO;
  return conversaFalhou ? AVISO_GENERICO : null;
}

/**
 * `encerrado` vem da regra do kanban (coluna recuperado/baixado, que é o
 * `closedAt` do caso). Caso encerrado não tem retirada a combinar e o servidor
 * recusa o contato com 409, então nem se oferece o botão. A conversa que já
 * existe continua visível: é o histórico do caso.
 *
 * AIDEV-QUESTION: o servidor também recusa caso `contestado` (etapa aberta no
 * kanban). O botão continua lá e o 409 agora mostra o motivo. Esconder também
 * na contestação é decisão de produto.
 */
export function ChatDaRecuperacao({
  casoId,
  encerrado,
}: {
  casoId: number;
  encerrado: boolean;
}) {
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
  const aviso = avisoDoChat(iniciar.error, conversa.isError);
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
      ) : encerrado ? (
        <p className="p-3 text-xs text-[var(--text-muted)]">
          Caso encerrado: não há retirada a combinar, então o contato não é
          iniciado por aqui.
        </p>
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
      {aviso && (
        <p role="alert" className="p-3 text-xs text-[var(--danger)]">
          {aviso}
        </p>
      )}
    </section>
  );
}
