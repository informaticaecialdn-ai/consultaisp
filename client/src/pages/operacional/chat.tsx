/**
 * Conversas no porte do módulo Cobrança do Provedor.ai: três colunas de
 * verdade em tela larga — fila (~320px) · conversa (fluida) · painel do cliente
 * (~360px, desenhado por <Atendimento>) —, cada uma rolando por si e a página
 * inteira sem barra de rolagem (a `main` mede a janela e prende o `overflow`).
 *
 * A quebra segue a da referência: abaixo de `lg` uma coluna por vez, com
 * "Voltar às conversas"; entre `lg` e `xl` duas colunas e o painel do cliente
 * pelo botão "Dados do caso"; de `xl` para cima as três lado a lado.
 *
 * Regra de ouro do traço: o que a fila NÃO traz não é preenchido. A contagem
 * do título só aparece se o servidor mandar `total`; a prévia da última
 * mensagem só se ele mandar `ultimaMensagem` — enquanto não manda, a linha
 * mostra o telefone e diz o porquê no `title`. Nada de prévia inventada nem de
 * zero no lugar de "não sei".
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { MessageCircle, MessageSquare, MessageSquarePlus, Plug, Search, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ALVO_CONTROLE,
  ALVO_TEXTO,
  AvisoNaoCarregou,
  BOTAO_MARCA,
  DESABILITAVEL,
  FOCO,
  FOCO_INTERNO,
  LinhasSkeleton,
} from "@/components/painel/ui";
import {
  SeloCarteira,
  SeloCobranca,
  SeloQuadrante,
  Traco,
  useSkeletonAtrasado,
} from "@/components/cobranca/ui";
import { dataHoraBr } from "@/components/cobranca/formatacao";
import { NavegacaoCarteiras } from "@/components/cobranca/NavegacaoCarteiras";
import { carteiraDaNavegacao } from "@/components/cobranca/carteiras";
import {
  API_CHAT_BULLQ,
  apiConversaDoCaso,
  apiEnviarCasoParaChat,
  chatProntoParaEnviar,
  lerIntegracaoDoChat,
} from "@/components/cobranca/tipos";
import { invalidarCobranca, mensagemDoErro } from "@/components/cobranca/ui";
import { Atendimento } from "@/components/chat/Atendimento";
import {
  AvatarChat,
  LINK_CHAT,
  NUM_CHAT,
} from "@/components/chat/PerfilDoCliente";
import {
  API_ATENDIMENTOS,
  MOTIVO_SEM_HISTORICO,
  MOTIVO_SEM_PREVIA,
  rotaChat,
  STATUS_CHAT,
  TOM_DO_STATUS_CHAT,
  tempoRelativo,
  type FilaDeAtendimentos,
  type OrigemChat,
  type ResumoChat,
} from "@/components/chat/tipos";

/** Botão de paginação com cara de texto: alvo no dedo, foco, desabilitado honesto. */
const BOTAO_PAGINA = `${ALVO_TEXTO} rounded px-1 ${FOCO} ${DESABILITAVEL}`;

/**
 * As abas da fila. Cada uma é um `status` que a rota REALMENTE aceita
 * (`PENDING · OPEN · WAITING · BOT · CLOSED`); "Escaladas" é o PENDING, a
 * conversa que o agente passou para a equipe. Não há aba sem status atrás.
 */
const ABAS_DA_FILA = [
  ["", "Todas"],
  ["PENDING", "Escaladas"],
  ["CLOSED", "Encerradas"],
] as const;

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/** A linha da fila: avatar com o canal, nome, tempo relativo, prévia e os selos reais. */
function LinhaDaConversa({
  c,
  ativa,
  onAbrir,
}: {
  c: ResumoChat;
  ativa: boolean;
  onAbrir: () => void;
}) {
  const quando = tempoRelativo(c.ultimoEventoEm);
  const previa = c.ultimaMensagem;
  return (
    <button
      type="button"
      aria-current={ativa ? "true" : undefined}
      className={cn(
        FOCO_INTERNO,
        "flex w-full gap-3 border-b border-[var(--border)] px-3.5 py-3 text-left hover:bg-[var(--surface-2)]",
        ativa && "border-l-2 border-l-[var(--brand)] bg-[var(--brand-soft)]",
      )}
      onClick={onAbrir}
      data-testid="fila-chat-linha"
    >
      <span className="relative shrink-0">
        <AvatarChat nome={c.nome} className="h-11 w-11 text-xs" />
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 grid h-[17px] w-[17px] place-items-center rounded-full bg-[var(--surface)] shadow-[0_0_0_1px_var(--border)]"
        >
          <MessageCircle className="h-2.5 w-2.5 text-[var(--text-2)]" />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
            {c.nome}
          </span>
          {quando ? (
            <span
              className={cn(
                "shrink-0 text-[10px] text-[var(--text-faint)]",
                c.ultimoEventoEm && NUM_CHAT,
              )}
              title={dataHoraBr(c.ultimoEventoEm)}
            >
              {quando}
            </span>
          ) : (
            <Traco titulo={MOTIVO_SEM_HISTORICO} />
          )}
        </span>
        <span className="flex min-w-0 items-center text-[11.5px] text-[var(--text-muted)]">
          {previa ? (
            <span className="min-w-0 truncate">
              <b className="font-semibold text-[var(--text-2)]">
                {previa.de === "cliente"
                  ? primeiroNome(c.nome)
                  : (previa.quem ?? "Provedor")}
                :{" "}
              </b>
              {previa.texto ?? "anexo"}
            </span>
          ) : (
            /* A fila não devolve a prévia: mostrar o telefone é dizer a verdade, e o title explica. */
            <span
              className={cn("truncate", c.telefone && NUM_CHAT)}
              title={MOTIVO_SEM_PREVIA}
            >
              {c.telefone ?? "Telefone não informado"}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <SeloCobranca tom={TOM_DO_STATUS_CHAT[c.status] ?? "neutro"}>
            {STATUS_CHAT[c.status] ?? c.status}
          </SeloCobranca>
          <SeloCarteira carteira={c.carteira} />
          {c.quadrante !== undefined && <SeloQuadrante quadrante={c.quadrante} />}
          {!c.ultimoEventoEm && (
            <SeloCobranca tom="neutro" titulo={MOTIVO_SEM_HISTORICO}>
              sem histórico
            </SeloCobranca>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * O caso que chegou pelo botão do card e ainda NÃO tem conversa.
 *
 * Pedido do dono (06/09/2026): "a conversa não está ativa". Ela não estava: em
 * produção a integração do chat está `provisionado`, sem canal de WhatsApp
 * ligado, e o botão do card virava um texto cinza. Agora o botão sempre navega
 * até aqui, e é aqui que se diz o que falta — com o nome do estado e o caminho
 * para resolver, em vez de um controle inerte.
 *
 * Iniciar a conversa é o mesmo `POST .../enviar` do quadro: abre no WhatsApp do
 * provedor com a mensagem da etapa da régua e devolve a `conversationId`, para
 * onde a tela navega em seguida.
 */
export const MOTIVO_CHAT_DESLIGADO =
  "Esta instalação não tem o Chat BullQ configurado (CHAT_BULLQ_URL). Nenhuma conversa sai daqui enquanto isso.";
export const MOTIVO_SEM_CANAL =
  "O WhatsApp do provedor ainda não está conectado: sem um número pareado, não há de onde mandar a mensagem.";

export function motivoDeNaoIniciar(integracao: ReturnType<typeof lerIntegracaoDoChat>): string | null {
  if (!integracao) return null; // ainda carregando: não acusa o que não sabe
  if (!integracao.ligado) return MOTIVO_CHAT_DESLIGADO;
  if (!integracao.canal) return MOTIVO_SEM_CANAL;
  if (integracao.status !== "ativo") {
    return `A integração do chat está em "${integracao.status ?? "sem estado"}"${integracao.ultimoErro ? ` — ${integracao.ultimoErro}` : ""}.`;
  }
  return null;
}

function CasoSemConversa({
  casoId,
  carteira,
  onAbrir,
}: {
  casoId: number;
  carteira: string;
  onAbrir: (conversationId: string) => void;
}) {
  const { toast } = useToast();
  const { data: integracaoCrua } = useQuery<unknown>({
    queryKey: [`${API_CHAT_BULLQ}/integracao`],
    staleTime: 300_000,
  });
  const integracao = lerIntegracaoDoChat(integracaoCrua);
  const pronto = chatProntoParaEnviar(integracao);
  const impedimento = motivoDeNaoIniciar(integracao);

  const iniciar = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", apiEnviarCasoParaChat(casoId), {})).json() as Promise<{
        conversationId: string;
        reaproveitada?: boolean;
      }>,
    onSuccess: (r) => {
      invalidarCobranca();
      toast({
        title: r.reaproveitada ? "Conversa existente aberta" : "Primeiro contato enviado",
      });
      if (r.conversationId) onAbrir(r.conversationId);
    },
    onError: (erro: Error) =>
      toast({
        title: "Não foi possível iniciar a conversa",
        description: mensagemDoErro(erro),
        variant: "destructive",
      }),
  });

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="caso-sem-conversa"
    >
      <MessageSquarePlus aria-hidden className="h-8 w-8 text-[var(--text-muted)]" />
      <p className="text-sm font-medium text-[var(--text)]">
        O caso <span className={NUM_CHAT}>#{casoId}</span> ainda não tem conversa
      </p>
      <p className="max-w-sm text-xs text-[var(--text-muted)]">
        O primeiro contato abre a conversa no WhatsApp do provedor com a mensagem da etapa
        da régua. A partir daí a equipe continua por aqui.
      </p>
      <button
        type="button"
        className={cn(BOTAO_MARCA, DESABILITAVEL)}
        disabled={!pronto || iniciar.isPending}
        title={impedimento ?? "Envia o primeiro contato e abre a conversa"}
        onClick={() => iniciar.mutate()}
        data-testid="iniciar-conversa"
      >
        {iniciar.isPending ? "Iniciando…" : "Iniciar conversa"}
      </button>
      {impedimento && (
        <p
          className="max-w-sm rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2 text-left text-[11px] leading-5 text-[var(--text-2)]"
          data-testid="motivo-sem-conversa"
        >
          <Plug aria-hidden className="mr-1 inline h-3 w-3 text-[var(--gated)]" />
          {impedimento}{" "}
          {integracao?.ligado && (
            <Link href="/painel-provedor?tab=chat" className={cn(LINK_CHAT, "text-[11px]")}>
              Conectar o WhatsApp →
            </Link>
          )}
        </p>
      )}
      <Link href={`/cobranca/kanban?carteira=${carteira}`} className={cn(LINK_CHAT, "text-xs")}>
        Voltar ao quadro →
      </Link>
    </div>
  );
}

export default function ChatOperacional() {
  const [location, navegar] = useLocation();
  const search = useSearch();
  const origem: OrigemChat = location.startsWith("/equipamentos")
    ? "equipamentos"
    : "cobranca";
  const carteira = carteiraDaNavegacao(location, search);
  const selecionada = new URLSearchParams(search).get("conversa");
  /*
   * `?caso=` é como o card do quadro chega aqui quando ainda não há conversa.
   * A rota do caso responde 404 quando nenhuma foi aberta — que não é erro, é a
   * resposta —, então a leitura mapeia 404 para `null` e a tela oferece iniciar.
   */
  const casoDoLink = origem === "cobranca" ? Number(new URLSearchParams(search).get("caso")) || null : null;
  const conversaDoCaso = useQuery<{ conversationId: string } | null>({
    queryKey: [apiConversaDoCaso(casoDoLink ?? 0)],
    queryFn: async () => {
      const r = await fetch(apiConversaDoCaso(casoDoLink!), { credentials: "include" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: casoDoLink !== null && !selecionada,
    staleTime: 15_000,
  });
  /*
   * Caso já conversado: troca o `?caso=` pelo `?conversa=` e abre o atendimento.
   *
   * A guarda de `casoDoLink && !selecionada` não é decorativa: depois da troca
   * o dado fica no cache do React Query, então `conversaEncontrada` continua
   * preenchido. Sem ela, qualquer render que mudasse a identidade de `navegar`
   * dispararia a navegação de novo, em cima da tela que o operador já está
   * usando.
   */
  const conversaEncontrada = conversaDoCaso.data?.conversationId ?? null;
  useEffect(() => {
    if (!conversaEncontrada || !casoDoLink || selecionada) return;
    navegar(rotaChat(origem, conversaEncontrada, carteira), { replace: true });
  }, [conversaEncontrada, casoDoLink, selecionada, origem, carteira, navegar]);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ origem, pagina: String(pagina) });
  if (origem === "cobranca") params.set("carteira", carteira);
  if (busca.trim()) params.set("busca", busca.trim());
  if (status) params.set("status", status);
  const url = `${API_ATENDIMENTOS}?${params}`;
  const fila = useQuery<FilaDeAtendimentos>({
    queryKey: [url],
    queryFn: async () => (await apiRequest("GET", url)).json(),
    refetchInterval: 10000,
  });
  const esqueleto = useSkeletonAtrasado(fila.isPending);
  return (
    <main
      className="flex h-[calc(100dvh-3rem)] min-h-[540px] flex-col overflow-hidden text-[var(--text)]"
      data-testid={`chat-${origem}`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex-1">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
            {origem === "cobranca" ? "Cobrança" : "Equipamentos"} / Atendimento
          </p>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-[var(--track-tight)]">
              Conversas
            </h1>
            {/* O número só existe se o servidor contar. Sem `total`, título sem número. */}
            {fila.data?.total !== undefined && (
              <span
                className={cn(
                  "rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--brand-ink)]",
                  NUM_CHAT,
                )}
                data-testid="fila-chat-total"
              >
                {fila.data.total}
              </span>
            )}
          </div>
        </div>
        <Link
          href={
            origem === "cobranca"
              ? `/cobranca/kanban?carteira=${carteira}`
              : "/recuperacao"
          }
          className={cn(LINK_CHAT, "text-xs")}
        >
          {origem === "cobranca"
            ? "Abrir quadro de cobrança"
            : "Abrir recuperação"}{" "}
          →
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--surface)]">
        <aside
          className={cn(
            "w-full shrink-0 flex-col border-r border-[var(--border)] lg:w-[320px] 2xl:w-[352px]",
            selecionada || casoDoLink ? "hidden lg:flex" : "flex",
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
          <div className="shrink-0 space-y-3 border-b border-[var(--border)] p-3">
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
              {ABAS_DA_FILA.map(([valor, rotulo]) => (
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
                  data-testid={`fila-chat-aba-${valor || "todas"}`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
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
                <LinhaDaConversa
                  key={c.conversationId}
                  c={c}
                  ativa={c.conversationId === selecionada}
                  onAbrir={() =>
                    navegar(rotaChat(origem, c.conversationId, carteira))
                  }
                />
              ))
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] p-3 text-xs">
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
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            !selecionada && !casoDoLink && "hidden lg:flex",
          )}
        >
          {/* Em tela estreita a fila fica escondida: sem esta volta, o caso é um beco. */}
          {(selecionada || casoDoLink) && (
            <button
              type="button"
              className={cn(
                ALVO_CONTROLE,
                FOCO,
                "flex shrink-0 items-center gap-2 rounded p-2 text-xs lg:hidden",
              )}
              onClick={() => navegar(rotaChat(origem, undefined, carteira))}
            >
              <ArrowLeft aria-hidden className="h-3 w-3" />
              Voltar às conversas
            </button>
          )}
          {selecionada ? (
            <div className="min-h-0 flex-1">
              <Atendimento
                key={`${origem}-${selecionada}`}
                conversationId={selecionada}
                origem={origem}
              />
            </div>
          ) : casoDoLink ? (
            conversaDoCaso.isPending ? (
              <div className="flex h-full items-center justify-center p-8" aria-busy>
                <LinhasSkeleton linhas={3} />
              </div>
            ) : conversaDoCaso.isError ? (
              <div className="p-6">
                <AvisoNaoCarregou aoTentarDeNovo={() => conversaDoCaso.refetch()} testId="erro-conversa-do-caso">
                  Não foi possível saber se este caso já tem conversa: {mensagemDoErro(conversaDoCaso.error)}
                </AvisoNaoCarregou>
              </div>
            ) : (
              <CasoSemConversa
                casoId={casoDoLink}
                carteira={carteira}
                onAbrir={(id) => navegar(rotaChat(origem, id, carteira), { replace: true })}
              />
            )
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
