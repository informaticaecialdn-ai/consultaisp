import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { MessageSquare, Search, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  ALVO_CONTROLE,
  ALVO_TEXTO,
  DESABILITAVEL,
  FOCO,
  FOCO_INTERNO,
  LinhasSkeleton,
} from "@/components/painel/ui";
import { useSkeletonAtrasado } from "@/components/cobranca/ui";
import { NavegacaoCarteiras } from "@/components/cobranca/NavegacaoCarteiras";
import { carteiraDaNavegacao } from "@/components/cobranca/carteiras";
import { Atendimento } from "@/components/chat/Atendimento";
import {
  AvatarChat,
  LINK_CHAT,
  NUM_CHAT,
} from "@/components/chat/PerfilDoCliente";
import {
  API_ATENDIMENTOS,
  rotaChat,
  STATUS_CHAT,
  type OrigemChat,
  type ResumoChat,
} from "@/components/chat/tipos";

/** Botão de paginação com cara de texto: alvo no dedo, foco, desabilitado honesto. */
const BOTAO_PAGINA = `${ALVO_TEXTO} rounded px-1 ${FOCO} ${DESABILITAVEL}`;

export default function ChatOperacional() {
  const [location, navegar] = useLocation();
  const search = useSearch();
  const origem: OrigemChat = location.startsWith("/equipamentos")
    ? "equipamentos"
    : "cobranca";
  const carteira = carteiraDaNavegacao(location, search);
  const selecionada = new URLSearchParams(search).get("conversa");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ origem, pagina: String(pagina) });
  if (origem === "cobranca") params.set("carteira", carteira);
  if (busca.trim()) params.set("busca", busca.trim());
  if (status) params.set("status", status);
  const url = `${API_ATENDIMENTOS}?${params}`;
  const fila = useQuery<{ itens: ResumoChat[]; temMais: boolean }>({
    queryKey: [url],
    queryFn: async () => (await apiRequest("GET", url)).json(),
    refetchInterval: 10000,
  });
  const esqueleto = useSkeletonAtrasado(fila.isPending);
  return (
    <main
      className="flex h-[calc(100dvh-3rem)] min-h-[540px] flex-col text-[var(--text)]"
      data-testid={`chat-${origem}`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex-1">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
            {origem === "cobranca" ? "Cobrança" : "Equipamentos"} / Atendimento
          </p>
          <h1 className="text-base font-semibold tracking-[var(--track-tight)]">
            Conversas
          </h1>
        </div>
        <Link
          href={
            origem === "cobranca"
              ? `/cobranca/fila?carteira=${carteira}`
              : "/recuperacao"
          }
          className={cn(LINK_CHAT, "text-xs")}
        >
          {origem === "cobranca"
            ? "Abrir fila de cobrança"
            : "Abrir recuperação"}{" "}
          →
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--surface)]">
        <aside
          className={cn(
            "w-full shrink-0 flex-col border-r border-[var(--border)] md:w-64 2xl:w-72",
            selecionada ? "hidden md:flex" : "flex",
          )}
          aria-label="Fila de conversas"
        >
          {origem === "cobranca" && (
            <div className="px-3 pt-3">
              <NavegacaoCarteiras
                carteira={carteira}
                destino="/cobranca/chat"
              />
            </div>
          )}
          <div className="space-y-3 border-b border-[var(--border)] p-3">
            <label className="flex items-center gap-2 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 focus-within:shadow-[var(--focus-ring)]">
              <Search
                aria-hidden
                className="h-4 w-4 text-[var(--text-muted)]"
              />
              <input
                aria-label="Buscar cliente ou telefone"
                className={cn(
                  ALVO_CONTROLE,
                  "min-w-0 flex-1 bg-transparent py-2 text-sm outline-none",
                )}
                placeholder="Buscar cliente, telefone…"
                value={busca}
                maxLength={80}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setPagina(1);
                }}
              />
            </label>
            <div
              aria-label="Situação da conversa"
              className="flex rounded-md bg-[var(--surface-inset)] p-1"
            >
              {[
                ["", "Todas"],
                ["PENDING", "Escaladas"],
                ["CLOSED", "Encerradas"],
              ].map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={status === valor}
                  className={cn(
                    ALVO_CONTROLE,
                    FOCO,
                    "flex-1 rounded px-1 py-1.5 text-[11px] font-semibold",
                    status === valor
                      ? "bg-[var(--surface)] text-[var(--text)] shadow-[0_0_0_1px_var(--border)]"
                      : "text-[var(--text-muted)]",
                  )}
                  onClick={() => {
                    setStatus(valor);
                    setPagina(1);
                  }}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {fila.isError ? (
              <p className="p-4 text-sm text-[var(--danger)]" role="alert">
                Não foi possível carregar a fila.{" "}
                <button
                  type="button"
                  onClick={() => fila.refetch()}
                  className={cn(ALVO_TEXTO, FOCO, "rounded underline")}
                >
                  Tentar novamente
                </button>
              </p>
            ) : fila.isPending ? (
              esqueleto ? (
                <div className="p-4" data-testid="fila-chat-skeleton">
                  <LinhasSkeleton linhas={6} />
                </div>
              ) : null
            ) : !fila.data.itens.length ? (
              <p className="p-4 text-sm text-[var(--text-muted)]">
                Nenhuma conversa neste filtro. Inicie o contato a partir de um
                caso.
              </p>
            ) : (
              fila.data.itens.map((c) => (
                <button
                  key={c.conversationId}
                  type="button"
                  aria-current={
                    c.conversationId === selecionada ? "true" : undefined
                  }
                  className={cn(
                    FOCO_INTERNO,
                    "flex w-full gap-3 border-b border-[var(--border)] p-4 text-left hover:bg-[var(--surface-2)]",
                    c.conversationId === selecionada &&
                      "border-l-2 border-l-[var(--brand)] bg-[var(--brand-soft)]",
                  )}
                  onClick={() =>
                    navegar(rotaChat(origem, c.conversationId, carteira))
                  }
                >
                  <AvatarChat nome={c.nome} className="h-10 w-10 text-xs" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold">{c.nome}</p>
                    <p
                      className={cn(
                        "text-[10px] text-[var(--text-muted)]",
                        c.telefone && NUM_CHAT,
                      )}
                    >
                      {c.telefone ?? "Telefone não informado"}
                    </p>
                    <p className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                      {c.status === "PENDING" && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full bg-[var(--gated)]"
                        />
                      )}
                      {STATUS_CHAT[c.status] ?? c.status}
                    </p>
                    <p
                      className={cn(
                        "text-[10px] text-[var(--text-faint)]",
                        c.ultimoEventoEm && NUM_CHAT,
                      )}
                    >
                      {c.ultimoEventoEm
                        ? new Date(c.ultimoEventoEm).toLocaleString("pt-BR")
                        : "Sem atividade recente"}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border)] p-3 text-xs">
            <button
              type="button"
              disabled={pagina === 1}
              className={BOTAO_PAGINA}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              Página <span className={NUM_CHAT}>{pagina}</span>
            </span>
            <button
              type="button"
              disabled={!fila.data?.temMais}
              className={BOTAO_PAGINA}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </aside>
        <div
          className={cn("min-w-0 flex-1", !selecionada && "hidden md:block")}
        >
          {selecionada ? (
            <div className="flex h-full flex-col">
              <button
                type="button"
                className={cn(
                  ALVO_CONTROLE,
                  FOCO,
                  "flex items-center gap-2 rounded p-2 text-xs md:hidden",
                )}
                onClick={() => navegar(rotaChat(origem, undefined, carteira))}
              >
                <ArrowLeft aria-hidden className="h-3 w-3" />
                Voltar às conversas
              </button>
              <div className="min-h-0 flex-1">
                <Atendimento
                  key={`${origem}-${selecionada}`}
                  conversationId={selecionada}
                  origem={origem}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-[var(--text-muted)]">
              <MessageSquare aria-hidden className="h-8 w-8" />
              <p className="text-sm font-medium">
                Selecione uma conversa para atender
              </p>
              <p className="max-w-sm text-xs">
                A equipe continua de onde o primeiro contato parou, com
                histórico e dados do caso no mesmo lugar.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
