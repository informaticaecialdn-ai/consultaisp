/**
 * A mesma conversa no 360, na recuperação e nas duas filas. Segredos nunca
 * chegam ao navegador.
 *
 * Regra do follow-up (dono, 05/09/2026): todo contato termina com a próxima
 * ação, o dono, o quando e o status. Aqui:
 *  - "Encerrar" abre o diálogo de follow-up — ação e data obrigatórias — a
 *    menos que não haja onde gravar (sem caso de cobrança, ou caso fechado);
 *  - "Enviar" leva um campo recolhido de próxima ação; vazio, o servidor grava
 *    "Aguardar resposta do cliente" no próximo dia útil;
 *  - "Devolver ao assistente" entrega a conversa de volta ao motor autônomo,
 *    quando o provedor o ligou.
 *
 * Pele do DESIGN_SYSTEM v5: botão de marca em `--brand` com `--text-on-brand`,
 * raio de 4px em botão e campo, todo número em mono tabular, skeleton em vez
 * de "Carregando". `--past` aqui só pinta dívida — nunca botão nem avatar.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useQuery,
} from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Bot,
  CalendarClock,
  Send,
  UserRoundCheck,
  RefreshCw,
  QrCode,
  GitBranch,
  Layers,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BOTAO_SECUNDARIO,
  CAIXA_ICONE,
  Campo,
  CONTROLE_CAMPO,
  CONTROLE_CAMPO_MULTILINHA,
  DESABILITAVEL,
  FOCO,
} from "@/components/painel/ui";
import { PROXIMAS_ACOES_COMUNS } from "@/components/cobranca/DialogoContato";
import {
  agoraInput,
  dataHoraBr,
  deInputDataHora,
  validarProximoContato,
} from "@/components/cobranca/formatacao";
import {
  mensagemDoErro,
  SeloCobranca,
  SeloQuadrante,
  Traco,
  useSkeletonAtrasado,
} from "@/components/cobranca/ui";
import {
  AvatarChat,
  BOTAO_CHAT_MARCA,
  LINK_CHAT,
  NUM_CHAT,
  PerfilDoCliente,
} from "./PerfilDoCliente";
import { PagamentosDoChat } from "./PagamentosDoChat";
import { DialogoNegociacao } from "@/components/cobranca/DialogoNegociacao";
import { lerPolitica } from "@/components/cobranca/politica-form";
import { API_POLITICA } from "@/components/cobranca/tipos";
import {
  ACAO_PADRAO_APOS_RESPOSTA,
  ACOES_COMUNS_DO_CHAT,
  API_ATENDIMENTOS,
  API_AUTONOMIA,
  AVISO_CDC_42,
  MOTIVO_JANELA_DESCONHECIDA,
  MOTIVO_SEM_JANELA_DE_CONTATO,
  STATUS_CHAT,
  TAMANHO_MAXIMO_DA_ACAO,
  TOM_DO_STATUS_CHAT,
  encerrarDispensaFollowUp,
  faixaDeContato,
  janelaDaConversa,
  type AcaoChat,
  type DetalheChat,
  type EstadoAutonomiaChat,
  type FollowUpChat,
  type OrigemChat,
} from "./tipos";

const hora = (valor: string) =>
  new Date(valor).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Balões de mensageiro: o dia separa, e mensagens seguidas do MESMO autor
 * dentro de cinco minutos formam um grupo — o nome de quem falou só aparece na
 * primeira do grupo. Data ilegível não quebra o grupo (dado ruim não vira
 * desenho errado).
 */
const GRUPO_JANELA_MS = 5 * 60_000;
const dentroDaJanelaDeGrupo = (aIso: string, bIso: string) => {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(b - a) < GRUPO_JANELA_MS;
};

/** "Hoje" · "Ontem" · dd/mm/aaaa. Null quando a data não é legível — aí não há régua de dia. */
function rotuloDoDia(iso: string, hoje = new Date()): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const mesmoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
  if (mesmoDia(d, hoje)) return "Hoje";
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR");
}

/** Chip de próxima ação: um clique em vez de digitar. Retangular, 4px. */
const CHIP =
  "rounded border px-2 py-1 text-[11px] leading-4 motion-safe:transition-colors";
const chip = (ativo: boolean) =>
  cn(
    CHIP,
    FOCO,
    ativo
      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]"
      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--border-strong)]",
  );

const ACOES_SUGERIDAS = [...ACOES_COMUNS_DO_CHAT, ...PROXIMAS_ACOES_COMUNS];

const MOTIVO_ASSISTENTE_DESLIGADO = "assistente desligado";

function Anexo({ url, tipo }: { url: string; tipo: string }) {
  const midia = useMutation({
    mutationFn: async (): Promise<{ url: string; mimeType: string | null }> =>
      (await apiRequest("GET", url)).json(),
    retry: false,
  });
  if (!midia.data)
    return (
      <div>
        <button
          type="button"
          className={cn(LINK_CHAT, "text-xs", DESABILITAVEL)}
          disabled={midia.isPending}
          aria-busy={midia.isPending}
          onClick={() => midia.mutate()}
        >
          {`Abrir ${tipo.toLowerCase()}`}
        </button>
        {midia.isError && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            Anexo indisponível. Atualize o histórico e tente novamente.
          </p>
        )}
      </div>
    );
  const mime = midia.data.mimeType ?? "";
  return (
    <div className="mt-2">
      {mime.startsWith("image/") && mime !== "image/svg+xml" ? (
        <img
          src={midia.data.url}
          alt="Imagem recebida do cliente"
          className="max-h-64 max-w-full rounded-lg"
        />
      ) : mime.startsWith("audio/") ? (
        <audio
          src={midia.data.url}
          controls
          preload="none"
          className="max-w-full"
        />
      ) : mime.startsWith("video/") ? (
        <video
          src={midia.data.url}
          controls
          preload="none"
          className="max-h-64 max-w-full"
        />
      ) : null}
      <a
        href={midia.data.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(LINK_CHAT, "text-xs")}
      >
        Abrir arquivo
      </a>
    </div>
  );
}

/* ── Follow-up ao encerrar ────────────────────────────────────────────── */

/**
 * O diálogo que fecha o atendimento: próxima ação e data OBRIGATÓRIAS. O
 * servidor recusa encerrar sem as duas; aqui o botão nem habilita. Chips das
 * ações comuns do chat e da cobrança para não digitar; a data tem o `min`
 * de agora e é validada de novo no submit (quem digita passa pelo `min`).
 */
function DialogoFollowUpDoChat({
  aberto,
  clienteNome,
  casoId,
  pendente,
  erro,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  clienteNome: string;
  casoId: number | null;
  pendente: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (followUp: FollowUpChat) => void;
}) {
  const [proximaAcao, setProximaAcao] = useState("");
  const [proximoContatoEm, setProximoContatoEm] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  // Cada abertura começa limpa: o follow-up de ontem não é o de hoje.
  useEffect(() => {
    if (aberto) {
      setProximaAcao("");
      setProximoContatoEm("");
      setErroLocal(null);
    }
  }, [aberto]);

  const semFollowUp = !proximaAcao.trim() || !proximoContatoEm;
  const confirmar = () => {
    const erroData = validarProximoContato(proximoContatoEm, new Date());
    const iso = deInputDataHora(proximoContatoEm);
    if (erroData || !iso) {
      setErroLocal(erroData ?? "Data do próximo contato inválida.");
      return;
    }
    setErroLocal(null);
    onConfirmar({ proximaAcao: proximaAcao.trim(), proximoContatoEm: iso });
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onFechar();
      }}
    >
      <DialogContent
        className="sm:max-w-[520px]"
        data-testid="dialogo-followup-chat"
      >
        <DialogHeader>
          <DialogTitle>Encerrar atendimento</DialogTitle>
          <DialogDescription>
            {clienteNome}
            {casoId !== null ? (
              <>
                {" "}
                · caso <span className={NUM_CHAT}>#{casoId}</span>
              </>
            ) : null}
            . Todo contato termina com a próxima ação e o dia em que ela
            acontece.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <Campo rotulo="próxima ação (obrigatório)">
            <input
              type="text"
              required
              maxLength={TAMANHO_MAXIMO_DA_ACAO}
              className={CONTROLE_CAMPO}
              placeholder="ex.: cobrar a promessa, enviar boleto"
              value={proximaAcao}
              onChange={(e) => setProximaAcao(e.target.value)}
              data-testid="followup-chat-acao"
            />
          </Campo>
          <div
            className="flex flex-wrap gap-1.5"
            aria-label="próximas ações comuns"
          >
            {ACOES_SUGERIDAS.map((acao) => (
              <button
                key={acao}
                type="button"
                className={chip(proximaAcao === acao)}
                onClick={() => setProximaAcao(acao)}
                data-testid={`followup-chat-chip-${acao}`}
              >
                {acao}
              </button>
            ))}
          </div>
          <Campo rotulo="quando (obrigatório)">
            <input
              type="datetime-local"
              required
              className={cn(CONTROLE_CAMPO, NUM_CHAT)}
              min={agoraInput()}
              value={proximoContatoEm}
              onChange={(e) => setProximoContatoEm(e.target.value)}
              data-testid="followup-chat-quando"
            />
          </Campo>
          <p className="text-[11px] text-[var(--text-muted)]">
            O caso volta à fila nesta data, com esta ação escrita no card. O
            dono continua sendo quem assumiu a conversa.
          </p>
          {(erroLocal || erro) && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {erroLocal ?? erro}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              className={BOTAO_SECUNDARIO}
              onClick={onFechar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={BOTAO_CHAT_MARCA}
              disabled={pendente || semFollowUp}
              title={
                semFollowUp
                  ? "Diga a próxima ação e quando ela acontece"
                  : undefined
              }
              data-testid="followup-chat-confirmar"
            >
              Encerrar com follow-up
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Atendimento ──────────────────────────────────────────────────────── */

export function Atendimento({
  conversationId,
  origem,
  compacto = false,
}: {
  conversationId: string;
  origem: OrigemChat;
  compacto?: boolean;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [mostrarContexto, setMostrarContexto] = useState(false);
  const [pagamento, setPagamento] = useState<{ aberto: boolean; ref?: string }>(
    { aberto: false },
  );
  const [negociar, setNegociar] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  // Follow-up opcional ao responder: recolhido até o atendente querer dizer o depois.
  const [followUpEnvio, setFollowUpEnvio] = useState({
    aberto: false,
    proximaAcao: "",
    proximoContatoEm: "",
  });
  const forcarContexto = useRef(false);
  const historico = useRef<HTMLDivElement>(null);
  const pertoDoFim = useRef(true);
  const url = `${API_ATENDIMENTOS}/${encodeURIComponent(conversationId)}`;
  const contexto = useQuery<ContextoDoChat>({
    queryKey: [`${url}/contexto`],
    queryFn: async () => {
      const forcar = forcarContexto.current;
      forcarContexto.current = false;
      return (
        await apiRequest(
          "GET",
          `${url}/contexto${forcar ? "?atualizar=true" : ""}`,
        )
      ).json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // A política é lida sempre, não só ao parcelar: o rodapé do compositor anuncia
  // a janela de contato do provedor, e ela vem daqui. Sem resposta, o rodapé
  // mostra traço com o motivo — nunca as 8–20h "de fábrica" como se fossem dele.
  const politica = useQuery({
    queryKey: [API_POLITICA],
    queryFn: async () =>
      lerPolitica(await (await apiRequest("GET", API_POLITICA)).json()),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const faixaDeHorario = faixaDeContato(politica.data?.janelaContato);
  // Sem estado (rota ausente, fila sem migração) o botão de devolver fica desligado — nunca finge.
  const autonomia = useQuery<EstadoAutonomiaChat>({
    queryKey: [API_AUTONOMIA],
    queryFn: async () => (await apiRequest("GET", API_AUTONOMIA)).json(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const assistenteLigado = autonomia.data?.config?.ativa === true;
  const query = useInfiniteQuery({
    queryKey: [url],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<DetalheChat> =>
      (await apiRequest("GET", `${url}?pagina=${pageParam}`)).json(),
    getNextPageParam: (pagina) =>
      pagina.temMais ? pagina.pagina + 1 : undefined,
    refetchInterval: 8000,
    retry: 1,
  });
  const dados = query.data?.pages[0];
  const mostrarSkeleton = useSkeletonAtrasado(!dados && !query.isError);
  const alvoNegociacao = useMemo(
    () =>
      dados?.cobranca
        ? {
            casoId: dados.cobranca.id,
            clienteNome: dados.cliente?.nome ?? "Cliente",
            valorAtual: dados.cobranca.valor,
          }
        : null,
    [dados?.cobranca?.id, dados?.cobranca?.valor, dados?.cliente?.nome],
  );
  const mensagens = Array.from(
    new Map(
      (query.data?.pages.flatMap((p) => p.mensagens) ?? []).map((m) => [
        m.id,
        m,
      ]),
    ).values(),
  ).sort((a, b) => a.em.localeCompare(b.em));
  const ultima = mensagens.at(-1)?.id;
  useEffect(() => {
    const elemento = historico.current;
    if (elemento && pertoDoFim.current)
      elemento.scrollTop = elemento.scrollHeight;
  }, [ultima]);
  useEffect(() => {
    setTexto("");
    setErroEnvio(null);
    setEncerrando(false);
    setFollowUpEnvio({ aberto: false, proximaAcao: "", proximoContatoEm: "" });
  }, [conversationId]);
  const invalidarAtendimentos = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith(API_ATENDIMENTOS),
    });
  const acao = useMutation({
    mutationFn: async (pedido: AcaoChat) =>
      (await apiRequest("POST", `${url}/acoes`, pedido)).json(),
    onSuccess: async (_r, pedido) => {
      if (pedido.acao === "enviar") {
        setTexto("");
        setFollowUpEnvio({ aberto: false, proximaAcao: "", proximoContatoEm: "" });
      }
      if (pedido.acao === "encerrar") setEncerrando(false);
      setErroEnvio(null);
      await invalidarAtendimentos();
    },
    onError: (erro: unknown, pedido) =>
      setErroEnvio(
        pedido.acao === "encerrar"
          ? mensagemDoErro(erro)
          : "O chat não confirmou a operação. O texto foi preservado. Atualize o histórico para conferir antes de tentar novamente.",
      ),
    retry: false,
  });
  const devolver = useMutation({
    mutationFn: async () =>
      (
        await apiRequest(
          "POST",
          `${API_AUTONOMIA}/conversas/${encodeURIComponent(conversationId)}/devolver`,
        )
      ).json(),
    onSuccess: async () => {
      setErroEnvio(null);
      await invalidarAtendimentos();
    },
    onError: (erro: unknown) =>
      setErroEnvio(
        (erro as { status?: number }).status === 404
          ? `${MOTIVO_ASSISTENTE_DESLIGADO}: a devolução não está disponível nesta instalação.`
          : mensagemDoErro(erro),
      ),
    retry: false,
  });
  const enviar = () => {
    if (!texto.trim() || acao.isPending || query.isError) return;
    const erroData = validarProximoContato(
      followUpEnvio.proximoContatoEm,
      new Date(),
    );
    if (erroData) {
      setErroEnvio(erroData);
      return;
    }
    const proximoContatoEm = deInputDataHora(followUpEnvio.proximoContatoEm);
    acao.mutate({
      acao: "enviar",
      texto,
      ...(followUpEnvio.proximaAcao.trim()
        ? { proximaAcao: followUpEnvio.proximaAcao.trim() }
        : {}),
      ...(proximoContatoEm ? { proximoContatoEm } : {}),
    });
  };
  if (!dados)
    return (
      <div
        className="p-6 text-sm text-[var(--text-muted)]"
        role="status"
        aria-busy={!query.isError}
        data-testid="atendimento-carregando"
      >
        {query.isError ? (
          <>
            <p>Não foi possível carregar a conversa.</p>
            <button
              type="button"
              className={cn(BOTAO_SECUNDARIO, "mt-2")}
              onClick={() => query.refetch()}
            >
              Tentar novamente
            </button>
          </>
        ) : mostrarSkeleton ? (
          <div className="space-y-3" aria-hidden>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-16 w-4/5" />
            <Skeleton className="ml-auto h-16 w-3/5" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : null}
      </div>
    );
  const c = dados.cobranca;
  const nomeDoCliente = dados.cliente?.nome ?? "Cliente";
  const emAtendimento = dados.conversa.status === "OPEN";
  // A janela de 24 h do WhatsApp sai do que o servidor mandou (direção + instante
  // de cada mensagem). Sem recebimento no histórico carregado ela é DESCONHECIDA,
  // e o cabeçalho escreve "janela —" com o porquê no title.
  const janela = janelaDaConversa(mensagens);
  const pedirEncerrar = () => {
    // Sem caso de cobrança ou caso fechado não há onde gravar o follow-up: encerra direto.
    if (encerrarDispensaFollowUp(c)) acao.mutate({ acao: "encerrar" });
    else setEncerrando(true);
  };
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col text-[var(--text)]",
        !compacto && "h-full xl:flex-row",
      )}
      data-testid="atendimento-integrado"
    >
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <AvatarChat nome={nomeDoCliente} className="h-10 w-10 text-sm" />
          <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{nomeDoCliente}</h2>
              <SeloCobranca
                tom={TOM_DO_STATUS_CHAT[dados.conversa.status] ?? "neutro"}
                testId="chat-selo-estado"
              >
                {STATUS_CHAT[dados.conversa.status] ?? dados.conversa.status}
              </SeloCobranca>
              {c && (
                <SeloQuadrante
                  quadrante={c.quadrante}
                  testId="chat-selo-quadrante"
                />
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span className={NUM_CHAT}>
                {dados.cliente?.telefone ?? "Sem telefone"}
              </span>
              <span aria-hidden>·</span>
              <span className="font-medium text-[var(--text-2)]">WhatsApp</span>
              <span aria-hidden>·</span>
              <span
                data-testid="chat-janela"
                title={janela?.motivo ?? MOTIVO_JANELA_DESCONHECIDA}
                className={
                  janela === null
                    ? "text-[var(--text-faint)]"
                    : janela.aberta
                      ? "text-[var(--ok)]"
                      : "text-[var(--past)]"
                }
              >
                {janela === null
                  ? "janela —"
                  : janela.aberta
                    ? "janela aberta · 24h"
                    : "janela fechada · só template"}
              </span>
            </p>
            {c && (
              <p
                className="text-xs text-[var(--text-muted)]"
                data-testid="atendimento-followup-atual"
              >
                {c.proximaAcao && c.proximoContatoEm ? (
                  <>
                    próxima ação: {c.proximaAcao} ·{" "}
                    <span className={NUM_CHAT}>
                      {dataHoraBr(c.proximoContatoEm)}
                    </span>
                    {c.responsavel ? ` · ${c.responsavel}` : " · sem dono"}
                  </>
                ) : (
                  <span className="text-[var(--gated)]">
                    caso sem próxima ação — parado na fila
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE)}
            onClick={() => query.refetch()}
            aria-label="Atualizar mensagens"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                query.isFetching && "motion-safe:animate-spin",
              )}
            />
          </button>
          {!compacto && (
            <>
              <button
                type="button"
                className={cn(BOTAO_SECUNDARIO, "xl:hidden")}
                onClick={() => setMostrarContexto(true)}
              >
                Dados do caso
              </button>
              <Link
                className={cn(BOTAO_SECUNDARIO, "hidden sm:inline-flex")}
                href={`/cobranca/cliente/${dados.conversa.customerId}?carteira=${c?.carteira ?? "ativo"}`}
                data-testid="chat-cabecalho-360"
              >
                <Layers className="h-3.5 w-3.5" /> Cliente 360
              </Link>
            </>
          )}
          {!emAtendimento && (
            <button
              type="button"
              className={BOTAO_CHAT_MARCA}
              disabled={acao.isPending}
              onClick={() => acao.mutate({ acao: "assumir" })}
              data-testid="chat-assumir"
            >
              <UserRoundCheck className="h-4 w-4" />
              {dados.conversa.status === "CLOSED"
                ? "Reabrir atendimento"
                : "Tomar conversa"}
            </button>
          )}
          {emAtendimento && (
            <>
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                disabled={
                  !assistenteLigado || devolver.isPending || acao.isPending
                }
                title={
                  assistenteLigado
                    ? "O assistente retoma a conversa dentro das permissões do provedor"
                    : MOTIVO_ASSISTENTE_DESLIGADO
                }
                onClick={() => devolver.mutate()}
                data-testid="chat-devolver-assistente"
              >
                <Bot className="h-4 w-4" />
                Devolver ao assistente
              </button>
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                disabled={acao.isPending}
                onClick={pedirEncerrar}
                data-testid="chat-encerrar"
              >
                Encerrar conversa
              </button>
            </>
          )}
        </header>
        {query.isError && (
          <p role="alert" className="px-4 py-2 text-xs text-[var(--gated)]">
            O histórico pode estar desatualizado. Confira a conexão antes de
            enviar.
          </p>
        )}
        <div
          ref={historico}
          onScroll={(e) => {
            const el = e.currentTarget;
            pertoDoFim.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className={cn(
            "flex flex-col overflow-y-auto bg-[var(--surface-2)] p-4",
            compacto ? "h-72" : "min-h-0 flex-1",
          )}
          aria-label="Histórico da conversa"
        >
          {query.hasNextPage && (
            <button
              type="button"
              className={cn(BOTAO_SECUNDARIO, "mx-auto mb-3")}
              disabled={query.isFetchingNextPage}
              aria-busy={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              Carregar mensagens anteriores
            </button>
          )}
          {!mensagens.length && (
            <p className="m-auto text-sm text-[var(--text-muted)]">
              Ainda não há mensagens nesta conversa.
            </p>
          )}
          {mensagens.map((m, i) => {
            const anterior = i > 0 ? mensagens[i - 1] : null;
            const dia = rotuloDoDia(m.em);
            const novoDia =
              dia !== null && (!anterior || rotuloDoDia(anterior.em) !== dia);
            const meu = m.direcao === "OUTBOUND";
            // Grupo: mesmo autor, mesma direção, dentro de cinco minutos e no mesmo dia.
            const novoGrupo =
              novoDia ||
              !anterior ||
              anterior.direcao !== m.direcao ||
              (anterior.quem ?? "") !== (m.quem ?? "") ||
              !dentroDaJanelaDeGrupo(anterior.em, m.em);
            const autor = m.quem ?? (meu ? "Provedor" : nomeDoCliente);
            return (
              <Fragment key={m.id}>
                {novoDia && (
                  <div className="my-3 flex justify-center">
                    <span
                      className={cn(
                        "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]",
                        NUM_CHAT,
                      )}
                    >
                      {dia}
                    </span>
                  </div>
                )}
                <article
                  className={cn(
                    "max-w-[80%] rounded-lg border border-[var(--border)] px-3 py-2 text-sm",
                    novoDia ? "" : novoGrupo ? "mt-3" : "mt-0.5",
                    meu
                      ? "self-end bg-[var(--ok-bg)]"
                      : "self-start bg-[var(--surface)]",
                  )}
                  data-testid="chat-balao"
                >
                  {novoGrupo && (
                    <p className="mb-0.5 text-[10px] font-semibold text-[var(--text-2)]">
                      {autor}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">
                    {m.texto ||
                      (m.tipo === "TEMPLATE"
                        ? "Template de abertura"
                        : `Mensagem ${m.tipo.toLowerCase()} · anexo recebido`)}
                  </p>
                  {["IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "STICKER"].includes(
                    m.tipo,
                  ) && (
                    <Anexo
                      tipo={m.tipo}
                      url={`${url}/mensagens/${encodeURIComponent(m.id)}/midia?pagina=${query.data?.pages.find((p) => p.mensagens.some((x) => x.id === m.id))?.pagina ?? 1}`}
                    />
                  )}
                  {/* Hora e situação do envio como o servidor as mandou — nada de recibo inventado. */}
                  <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">
                    <span className={NUM_CHAT}>{hora(m.em)}</span> ·{" "}
                    {(
                      {
                        SENT: "enviada",
                        DELIVERED: "entregue",
                        READ: "lida",
                        QUEUED: "na fila de envio",
                        FAILED: "falha no envio",
                        RECEIVED: "recebida",
                        PENDING: "pendente",
                      } as Record<string, string>
                    )[m.status] ?? m.status}
                  </p>
                </article>
              </Fragment>
            );
          })}
        </div>
        <form
          className="shrink-0 space-y-2 border-t border-[var(--border)] bg-[var(--surface)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <div className="flex flex-wrap gap-2 pb-1">
            <button
              type="button"
              className={BOTAO_SECUNDARIO}
              onClick={() => setPagamento({ aberto: true })}
            >
              <QrCode className="h-3.5 w-3.5" /> Enviar PIX / 2ª via
            </button>
            <button
              type="button"
              className={BOTAO_SECUNDARIO}
              disabled={!alvoNegociacao || politica.isPending}
              aria-busy={politica.isPending}
              title={
                !alvoNegociacao
                  ? "Vincule um caso de cobrança para negociar"
                  : undefined
              }
              onClick={() => setNegociar(true)}
            >
              <GitBranch className="h-3.5 w-3.5" /> Parcelar
            </button>
            <Link
              className={BOTAO_SECUNDARIO}
              href={`/cobranca/cliente/${dados.conversa.customerId}?carteira=${c?.carteira ?? "ativo"}`}
            >
              <Layers className="h-3.5 w-3.5" /> Cliente 360
            </Link>
          </div>
          {negociar && politica.isError && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              Não foi possível ler a política.{" "}
              <button
                type="button"
                className={cn(LINK_CHAT, "text-xs")}
                onClick={() => politica.refetch()}
              >
                Tentar novamente
              </button>
            </p>
          )}
          {!emAtendimento ? (
            <p className="text-xs text-[var(--text-muted)]">
              {dados.conversa.status === "WAITING"
                ? "Primeiro contato realizado. A resposta do cliente será encaminhada à equipe."
                : "Assuma o atendimento para continuar a conversa."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cn(LINK_CHAT, "text-xs")}
                  onClick={() =>
                    setTexto(
                      origem === "equipamentos"
                        ? "Obrigado por responder. Qual dia e período são melhores para combinar a retirada? Pode confirmar o endereço?"
                        : "Obrigado por responder. Vou conferir seu contrato e ajudar com as opções disponíveis.",
                    )
                  }
                >
                  Usar mensagem de continuidade
                </button>
                {c?.tom === "humanizado_vulneravel" && (
                  <span className="text-xs text-[var(--text-muted)]">
                    Tom acolhedor · sem pressão
                  </span>
                )}
              </div>
              <label className="sr-only" htmlFor={`mensagem-${conversationId}`}>
                Mensagem ao cliente
              </label>
              <div className="flex items-end gap-2">
                <textarea
                  id={`mensagem-${conversationId}`}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  disabled={acao.isPending}
                  rows={texto.includes("\n") ? 3 : 1}
                  maxLength={2000}
                  className={cn(
                    CONTROLE_CAMPO_MULTILINHA,
                    "min-h-11 min-w-0 flex-1 resize-none bg-[var(--surface-2)] text-sm",
                  )}
                  placeholder="Escreva uma mensagem…"
                />
                <button
                  type="submit"
                  aria-label={acao.isPending ? "Enviando…" : "Enviar"}
                  title={acao.isPending ? "Enviando…" : "Enviar"}
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded bg-[var(--brand)] text-[var(--text-on-brand)] hover:opacity-90",
                    FOCO,
                    DESABILITAVEL,
                  )}
                  disabled={!texto.trim() || acao.isPending || query.isError}
                  data-testid="chat-enviar"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              {/* Follow-up ao responder: recolhido; vazio, o servidor grava o padrão no próximo dia útil. */}
              <div data-testid="chat-followup-envio">
                <button
                  type="button"
                  className={cn(LINK_CHAT, "text-xs")}
                  aria-expanded={followUpEnvio.aberto}
                  onClick={() =>
                    setFollowUpEnvio((f) => ({ ...f, aberto: !f.aberto }))
                  }
                  data-testid="chat-followup-envio-abrir"
                >
                  <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                  {followUpEnvio.aberto
                    ? "Ocultar próxima ação"
                    : "Próxima ação (opcional)"}
                </button>
                {followUpEnvio.aberto && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Campo rotulo="próxima ação">
                      <input
                        type="text"
                        maxLength={TAMANHO_MAXIMO_DA_ACAO}
                        className={CONTROLE_CAMPO}
                        placeholder={ACAO_PADRAO_APOS_RESPOSTA}
                        list={`acoes-${conversationId}`}
                        value={followUpEnvio.proximaAcao}
                        onChange={(e) =>
                          setFollowUpEnvio((f) => ({
                            ...f,
                            proximaAcao: e.target.value,
                          }))
                        }
                        data-testid="chat-followup-envio-acao"
                      />
                      <datalist id={`acoes-${conversationId}`}>
                        {ACOES_SUGERIDAS.map((a) => (
                          <option key={a} value={a} />
                        ))}
                      </datalist>
                    </Campo>
                    <Campo rotulo="quando">
                      <input
                        type="datetime-local"
                        className={cn(CONTROLE_CAMPO, NUM_CHAT)}
                        min={agoraInput()}
                        value={followUpEnvio.proximoContatoEm}
                        onChange={(e) =>
                          setFollowUpEnvio((f) => ({
                            ...f,
                            proximoContatoEm: e.target.value,
                          }))
                        }
                        data-testid="chat-followup-envio-quando"
                      />
                    </Campo>
                    <p className="text-[11px] text-[var(--text-muted)] sm:col-span-2">
                      Sem preencher: “{ACAO_PADRAO_APOS_RESPOSTA}” no próximo
                      dia útil.
                    </p>
                  </div>
                )}
              </div>
              {/* Rodapé honesto: contagem, canal e a janela de contato QUE O SERVIDOR
                  mandou. Sem política lida, traço com o motivo — nunca as horas
                  padrão exibidas como se fossem as do provedor. */}
              <p
                className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-[var(--text-muted)]"
                data-testid="chat-rodape-politica"
              >
                <span className={NUM_CHAT}>{texto.length}/2000</span>
                <span aria-hidden>·</span>
                <span>WhatsApp do provedor · atendimento humano</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span>janela de contato</span>
                  {faixaDeHorario ? (
                    <span className={NUM_CHAT} title={AVISO_CDC_42}>
                      {faixaDeHorario}
                    </span>
                  ) : (
                    <Traco titulo={MOTIVO_SEM_JANELA_DE_CONTATO} />
                  )}
                  <span aria-hidden>·</span>
                  <span title={AVISO_CDC_42}>CDC 42</span>
                </span>
              </p>
            </>
          )}
          {erroEnvio && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {erroEnvio}
            </p>
          )}
        </form>
      </section>
      {!compacto && (
        <aside
          className={cn(
            // O painel do cliente é a terceira coluna do porte: ~360px, rolando por si.
            "w-full shrink-0 overflow-y-auto border-[var(--border)] bg-[var(--surface)] px-4 xl:static xl:block xl:w-[344px] xl:border-l 2xl:w-[360px]",
            mostrarContexto ? "absolute inset-0 z-20" : "hidden",
          )}
          aria-label="Contexto do atendimento"
        >
          <button
            type="button"
            className={cn(BOTAO_SECUNDARIO, "my-3 xl:hidden")}
            onClick={() => setMostrarContexto(false)}
          >
            Voltar à conversa
          </button>
          <div className="pt-4">
            <PerfilDoCliente
              dados={dados}
              contexto={contexto.data}
              carregando={contexto.isFetching}
              erro={contexto.isError}
              atualizar={() => {
                forcarContexto.current = true;
                contexto.refetch();
              }}
              pagamento={(ref) => setPagamento({ aberto: true, ref })}
            />
          </div>
        </aside>
      )}
      <DialogoFollowUpDoChat
        aberto={encerrando}
        clienteNome={nomeDoCliente}
        casoId={c?.id ?? null}
        pendente={acao.isPending}
        erro={encerrando ? erroEnvio : null}
        onFechar={() => setEncerrando(false)}
        onConfirmar={(followUp) => acao.mutate({ acao: "encerrar", ...followUp })}
      />
      <PagamentosDoChat
        aberto={pagamento.aberto}
        fechar={() => setPagamento({ aberto: false })}
        contexto={contexto.data}
        carregando={contexto.isFetching}
        url={url}
        referencia={pagamento.ref}
        inserir={(mensagem) => {
          if (!emAtendimento)
            throw new Error("Tome a conversa antes de preparar o envio.");
          const novo = texto.trim() ? `${texto}\n\n${mensagem}` : mensagem;
          if (novo.length > 2000)
            throw new Error(
              "A mensagem atual mais os dados de pagamento excedem 2.000 caracteres. Edite o rascunho antes de inserir.",
            );
          setTexto(novo);
          setMostrarContexto(false);
        }}
      />
      <DialogoNegociacao
        alvo={alvoNegociacao}
        aberto={negociar && politica.isSuccess}
        politica={politica.data ?? null}
        tipoInicial="parcelamento"
        onFechar={() => {
          setNegociar(false);
          qc.invalidateQueries({ queryKey: [url] });
        }}
      />
    </div>
  );
}
