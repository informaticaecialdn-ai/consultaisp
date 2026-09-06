import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BOTAO_SECUNDARIO, CONTROLE_CAMPO } from "@/components/painel/ui";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";
import {
  mensagemDePagamento,
  type PagamentoDoChat,
} from "@shared/cobranca/pagamento-chat";
import {
  BOTAO_CHAT_MARCA,
  dinheiroChat,
  LINK_CHAT,
  NUM_CHAT,
} from "./PerfilDoCliente";

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export function PagamentosDoChat({
  aberto,
  fechar,
  contexto,
  carregando,
  url,
  referencia,
  inserir,
}: {
  aberto: boolean;
  fechar: () => void;
  contexto?: ContextoDoChat;
  carregando: boolean;
  url: string;
  referencia?: string;
  inserir: (texto: string) => void;
}) {
  const [selecionada, setSelecionada] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const consulta = useMutation({
    mutationFn: async (ref: string): Promise<PagamentoDoChat> =>
      (await apiRequest("POST", `${url}/segunda-via`, { ref })).json(),
    retry: false,
  });
  useEffect(() => {
    if (aberto) {
      setSelecionada(referencia ?? "");
      setAviso(null);
      consulta.reset();
    }
  }, [aberto, referencia]);
  const fatura = contexto?.faturas.find((f) => f.ref === selecionada);
  const copiar = async (valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setAviso("Copiado.");
    } catch {
      setAviso(
        "Não foi possível copiar. Selecione o código para copiar manualmente.",
      );
    }
  };
  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) fechar();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Enviar PIX / 2ª via</DialogTitle>
          <DialogDescription>
            Selecione a fatura, confira os dados devolvidos pelo ERP e prepare a
            mensagem para o cliente.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-2 text-xs">
          <span className="block font-semibold">Fatura do cliente</span>
          <select
            aria-label="Fatura do cliente"
            className={cn(CONTROLE_CAMPO, NUM_CHAT)}
            value={selecionada}
            disabled={consulta.isPending}
            onChange={(e) => {
              setSelecionada(e.target.value);
              consulta.reset();
              setAviso(null);
            }}
          >
            <option value="">Selecione uma fatura</option>
            {contexto?.faturas.map((f) => (
              <option key={`${f.fonte}-${f.ref}`} value={f.ref}>
                {f.ref} · {dinheiroChat(f.valor)} · venc. {dataBr(f.vencimento)}
              </option>
            ))}
          </select>
        </label>
        {carregando && (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        )}
        {!carregando && !contexto?.faturas.length && (
          <p className="text-xs text-[var(--text-muted)]">
            Não há faturas disponíveis para consultar a segunda via. Atualize os
            dados do cliente.
          </p>
        )}
        {fatura && !consulta.data && (
          <>
            <button
              type="button"
              disabled={consulta.isPending || !fatura.consultavel}
              onClick={() => consulta.mutate(fatura.ref)}
              className={BOTAO_CHAT_MARCA}
            >
              {consulta.isPending
                ? "Consultando segunda via…"
                : "Consultar PIX / boleto no ERP"}
            </button>
            {!fatura.consultavel && (
              <p className="text-xs text-[var(--text-muted)]">
                Esta fatura não tem instrumento de pagamento disponível pela
                integração.
              </p>
            )}
          </>
        )}
        {consulta.data && (
          <div className="space-y-4 rounded-lg border border-[var(--border)] p-4">
            <p className={cn("text-sm font-semibold", NUM_CHAT)}>
              {dinheiroChat(consulta.data.valor)}
              {consulta.data.vencimento &&
                ` · venc. ${dataBr(consulta.data.vencimento)}`}
            </p>
            {consulta.data.link && (
              <a
                href={consulta.data.link}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(LINK_CHAT, "gap-2 text-sm")}
              >
                <ExternalLink aria-hidden className="h-4 w-4" /> Abrir segunda
                via do boleto
              </a>
            )}
            {[
              { titulo: "PIX copia e cola", valor: consulta.data.pix },
              {
                titulo: "Linha digitável",
                valor: consulta.data.linhaDigitavel,
              },
              { titulo: "Link de pagamento", valor: consulta.data.link },
            ]
              .filter((p) => p.valor)
              .map((p) => (
                <div key={p.titulo}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <strong>{p.titulo}</strong>
                    <button
                      type="button"
                      onClick={() => copiar(p.valor!)}
                      className={cn(BOTAO_SECUNDARIO, "text-[11.5px]")}
                    >
                      <Copy aria-hidden className="h-3 w-3" /> Copiar
                    </button>
                  </div>
                  <p
                    className={cn(
                      "break-all rounded bg-[var(--surface-inset)] p-2 text-[11px]",
                      NUM_CHAT,
                    )}
                  >
                    {p.valor}
                  </p>
                </div>
              ))}
            <button
              type="button"
              className={cn(BOTAO_CHAT_MARCA, "w-full")}
              onClick={() => {
                try {
                  inserir(mensagemDePagamento(consulta.data));
                  fechar();
                } catch (e) {
                  setAviso(
                    e instanceof Error
                      ? e.message
                      : "Não foi possível preparar a mensagem.",
                  );
                }
              }}
            >
              Inserir na mensagem
            </button>
            <p className="text-[11px] text-[var(--text-muted)]">
              Confira o destinatário e pressione Enviar na conversa.
            </p>
          </div>
        )}
        {consulta.isError && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            Não foi possível obter a segunda via. Atualize as faturas e confira
            as permissões da integração.
          </p>
        )}
        {aviso && (
          <p role="status" className="text-xs">
            {aviso}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
