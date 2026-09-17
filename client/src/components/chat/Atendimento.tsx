/**
 * A mesma conversa no 360, na recuperação e nas duas filas. Segredos nunca
 * chegam ao navegador.
 *
 * Layout do Provedor.ai (Cobrança › Atendimento › Conversas, pedido do dono de
 * 17/09/2026): cabeçalho com avatar, nome, estado, telefone · canal · janela e
 * as ações; a conversa em balões de mensageiro, agrupados em corridas, com a
 * cauda no último, o chip do dia no topo e a hora com o recibo real do envio;
 * o compositor com as faixas de aviso no topo, os atalhos, a linha de entrada
 * (emoji, mensagens rápidas, campo, enviar) e o rodapé Sessão → Envio com a
 * janela de contato; e, à direita, a ficha do cliente.
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
 * raio de 4px em botão, campo, atalho e pílula (a referência usa 999px), balão
 * com 8px (a referência usa 12px), profundidade por anel de 1px, todo número em
 * mono tabular, skeleton em vez de "Carregando". `--past` aqui só pinta dívida
 * e a janela fechada — nunca botão nem avatar.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useQuery,
} from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CloudOff,
  Headset,
  HeartHandshake,
  Hourglass,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  MessageSquare,
  MessageSquareX,
  MoreHorizontal,
  QrCode,
  RefreshCw,
  Send,
  Smile,
  Split,
  Undo2,
  Zap,
  Clock,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ALVO_CONTROLE,
  BOTAO_SECUNDARIO,
  CAIXA_ICONE,
  Campo,
  CONTROLE_CAMPO,
  DESABILITAVEL,
  FOCO,
  FOCO_INTERNO,
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
import { MulticanalDaConversa, ReforcosDaConversa, useMulticanalDaConversa } from "./MulticanalDaConversa";
import { unirHistorico } from "./multicanal";
import {
  autorDaMensagem,
  chipDoDia,
  EMOJIS_DO_COMPOSITOR,
  esperaDoEnvio,
  filaDoEnvioSegue,
  horaDaMensagem,
  mensagensRapidas,
  mesmaCorrida,
  NOME_DO_CANAL,
  rotuloDoStatus,
  teclaEnviaMensagem,
  TEXTO_DA_ESPERA,
  transferenciaAntesDe,
  type EsperaDoEnvio,
} from "./conversa";
import {
  ATALHO,
  BalaoDaConversa,
  BOTAO_ICONE_COMPOSITOR,
  CabecalhoDoAutor,
  CHIP_CENTRAL,
  CHIP_CENTRAL_BOTAO,
  EstadoVazioChat,
  FaixaDoCompositor,
  ICONE_DO_ATALHO,
  MetaDoBalao,
  PilulaDeTransferencia,
  PilulaDoRodape,
  SkeletonDaConversa,
  TextoDoBalao,
} from "./ConversaUi";
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

/** O teto do campo: é o mesmo que o servidor valida no envio. */
const TAMANHO_MAXIMO_DA_MENSAGEM = 2000;

/** A rolagem só acompanha mensagem nova quando o operador está a menos disto do fim. */
const PERTO_DO_FIM_PX = 120;

/**
 * O ponteiro principal é fino (mouse, trackpad)? Lido na hora da tecla, nunca no
 * render: no toque não há Shift, e o Enter precisa continuar quebrando a linha.
 * Sem `matchMedia`, vale a mesa.
 */
const ponteiroPrincipalFino = () =>
  typeof window === "undefined" ||
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(pointer: fine)").matches;

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

/**
 * Item do menu "Mais ações" do cabeçalho no celular: alvo de 44px no toque (36px
 * na mesa) e o anel de foco por dentro — o fundo de destaque do Radix sozinho
 * não é anel visível.
 */
const ITEM_DO_MENU = cn(ALVO_CONTROLE, "gap-2 text-[13px]", FOCO_INTERNO);

const MOTIVO_ASSISTENTE_DESLIGADO = "assistente desligado";

const TIPOS_COM_ANEXO = ["IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "STICKER"];

function Anexo({ url, tipo }: { url: string; tipo: string }) {
  const midia = useMutation({
    mutationFn: async (): Promise<{ url: string; mimeType: string | null }> =>
      (await apiRequest("GET", url)).json(),
    retry: false,
  });
  if (!midia.data)
    return (
      <div className="mt-1">
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
          className="max-h-64 max-w-full rounded"
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
  carteira,
  compacto = false,
  avisoDoCanal,
  canalPronto,
  aoVoltar,
}: {
  conversationId: string;
  origem: OrigemChat;
  carteira?: string;
  compacto?: boolean;
  /**
   * A faixa do canal (WhatsApp não conectado, chat fora do ar) que a página de
   * Conversas lê. Mora no topo do compositor, como os avisos de canal da
   * referência: é ali que o operador ia tentar escrever. Enquanto a conversa não
   * carrega — ou não carrega porque o serviço caiu —, ela fica acima do erro e
   * do skeleton: é justamente quando o diagnóstico mais importa.
   */
  avisoDoCanal?: ReactNode;
  /**
   * O diagnóstico do canal que a página leu: `true` confirmado pronto, `false`
   * com problema, ausente quando ninguém verificou. A pílula "Envio" do rodapé
   * nunca fica verde por conta própria: só depois de um envio aceito, e nunca
   * com o canal com problema.
   */
  canalPronto?: boolean;
  /**
   * Volta à lista de conversas. A página de Conversas manda quando a lista está
   * escondida: abaixo de sm o botão mora no próprio cabeçalho, no lugar do avatar,
   * e a faixa "Voltar às conversas" da página some — eram 44px a menos de
   * histórico no celular. Enquanto a conversa carrega (ou não carrega) ele fica no
   * topo, para a tela nunca virar um beco.
   */
  aoVoltar?: () => void;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  // O último envio desta conversa, para a pílula "Envio" do rodapé: nada de estado inventado.
  const [ultimoEnvio, setUltimoEnvio] = useState<"ok" | "falhou" | null>(null);
  // O Enter durante uma operação pendente: na fila (envio) ou só o aviso (assumir/encerrar).
  const [espera, setEspera] = useState<EsperaDoEnvio | null>(null);
  const [mostrarContexto, setMostrarContexto] = useState(false);
  const [pagamento, setPagamento] = useState<{ aberto: boolean; ref?: string }>(
    { aberto: false },
  );
  const [negociar, setNegociar] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [emojisAbertos, setEmojisAbertos] = useState(false);
  const [rapidasAbertas, setRapidasAbertas] = useState(false);
  // Follow-up opcional ao responder: recolhido até o atendente querer dizer o depois.
  const [followUpEnvio, setFollowUpEnvio] = useState({
    aberto: false,
    proximaAcao: "",
    proximoContatoEm: "",
  });
  const forcarContexto = useRef(false);
  const historico = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const pertoDoFim = useRef(true);
  const url = `${API_ATENDIMENTOS}/${encodeURIComponent(conversationId)}`;
  const escopo = new URLSearchParams({ origem, ...(carteira ? { carteira } : {}) }).toString();
  const multicanal = useMulticanalDaConversa(url, escopo);
  const contexto = useQuery<ContextoDoChat>({
    queryKey: [`${url}/contexto?${escopo}`],
    queryFn: async () => {
      const forcar = forcarContexto.current;
      forcarContexto.current = false;
      return (
        await apiRequest(
          "GET",
          `${url}/contexto?${escopo}${forcar ? "&atualizar=true" : ""}`,
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
  // Fetcher padrão e conversão FORA do cache, como no 360, no kanban e na aba
  // Cobrança: a chave é a mesma, então o cache guarda um formato só — a resposta
  // crua. Com `queryFn` convertendo aqui, quem lia primeiro decidia o formato, e
  // o 360 de um cliente com conversa entregava a crua ao diálogo de negociação.
  const politica = useQuery<unknown>({
    queryKey: [API_POLITICA],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const politicaLida = useMemo(
    () => (politica.data === undefined ? null : lerPolitica(politica.data)),
    [politica.data],
  );
  const faixaDeHorario = faixaDeContato(politicaLida?.janelaContato);
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
    queryKey: [url, escopo],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<DetalheChat> =>
      (await apiRequest("GET", `${url}?${escopo}&pagina=${pageParam}`)).json(),
    getNextPageParam: (pagina) =>
      pagina.temMais ? pagina.pagina + 1 : undefined,
    // A conversa aberta se atualiza a cada 10 s, como na referência; o React
    // Query já pausa o intervalo com a aba oculta e relê ao voltar.
    refetchInterval: 10_000,
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
  const mensagensWhatsapp = Array.from(
    new Map(
      (query.data?.pages.flatMap((p) => p.mensagens) ?? []).map((m) => [
        m.id,
        m,
      ]),
    ).values(),
  ).sort((a, b) => a.em.localeCompare(b.em));
  const mensagens = unirHistorico(mensagensWhatsapp, multicanal.data?.mensagens ?? []);
  const ultima = mensagens.at(-1)?.id;
  useEffect(() => {
    setTexto("");
    setErroEnvio(null);
    setUltimoEnvio(null);
    setEspera(null);
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
      (await apiRequest("POST", `${url}/acoes?${escopo}`, pedido)).json(),
    onSuccess: async (_r, pedido) => {
      if (pedido.acao === "enviar") {
        setUltimoEnvio("ok");
        setFollowUpEnvio({ aberto: false, proximaAcao: "", proximoContatoEm: "" });
      }
      if (pedido.acao === "encerrar") setEncerrando(false);
      setErroEnvio(null);
      await invalidarAtendimentos();
    },
    onError: (erro: unknown, pedido) => {
      if (pedido.acao === "enviar") {
        setUltimoEnvio("falhou");
        // O campo foi limpo no envio: o texto volta, na frente do que já foi digitado depois.
        setTexto((atual) =>
          atual.trim() && atual !== pedido.texto ? `${pedido.texto}\n\n${atual}` : pedido.texto,
        );
      }
      const status = (erro as { status?: number }).status;
      setErroEnvio(
        pedido.acao === "encerrar"
          ? mensagemDoErro(erro)
          : pedido.acao === "enviar" && (status === 400 || status === 409)
            ? `${mensagemDoErro(erro)} O texto foi preservado.`
            : "O chat não confirmou a operação. O texto foi preservado. Atualize o histórico para conferir antes de tentar novamente.",
      );
    },
    retry: false,
  });
  // O texto que acabou de sair e o POST ainda não confirmou: aparece na hora, com o relógio.
  const variaveis = acao.variables;
  const enviando: string | null =
    acao.isPending && variaveis?.acao === "enviar" ? variaveis.texto : null;
  useEffect(() => {
    const elemento = historico.current;
    if (elemento && pertoDoFim.current)
      elemento.scrollTop = elemento.scrollHeight;
  }, [ultima, enviando]);
  const devolver = useMutation({
    mutationFn: async () =>
      (
        await apiRequest(
          "POST",
          `${API_AUTONOMIA}/conversas/${encodeURIComponent(conversationId)}/devolver?${escopo}`,
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
    if (!texto.trim() || query.isError) return;
    if (acao.isPending) {
      // Envio seguido não trava nem some em silêncio: vai à fila, ou avisa por que espera.
      setEspera(esperaDoEnvio(acao.variables));
      return;
    }
    const erroData = validarProximoContato(
      followUpEnvio.proximoContatoEm,
      new Date(),
    );
    if (erroData) {
      setErroEnvio(erroData);
      return;
    }
    const proximoContatoEm = deInputDataHora(followUpEnvio.proximoContatoEm);
    pertoDoFim.current = true;
    acao.mutate({
      acao: "enviar",
      texto,
      ...(followUpEnvio.proximaAcao.trim()
        ? { proximaAcao: followUpEnvio.proximaAcao.trim() }
        : {}),
      ...(proximoContatoEm ? { proximoContatoEm } : {}),
    });
    // Envio otimista, como na referência: o campo limpa na hora e o balão sai com o relógio.
    setTexto("");
  };
  // Quando a operação pendente volta, a fila anda — só se o envio anterior foi aceito.
  // As dependências são de propósito só a espera e o pendente: é a transição que importa,
  // e o `enviar` desta renderização já enxerga o texto atual.
  useEffect(() => {
    if (!espera || acao.isPending) return;
    const segue = filaDoEnvioSegue(espera, ultimoEnvio);
    setEspera(null);
    if (segue) enviar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espera, acao.isPending]);
  /** Emoji e mensagem rápida entram no cursor; o campo nunca passa do teto do servidor. */
  const inserirNoCampo = (trecho: string, substituir = false) => {
    const el = campo.current;
    const inicio = substituir ? 0 : (el?.selectionStart ?? texto.length);
    const fim = substituir ? texto.length : (el?.selectionEnd ?? texto.length);
    const novo = texto.slice(0, inicio) + trecho + texto.slice(fim);
    if (novo.length > TAMANHO_MAXIMO_DA_MENSAGEM) return;
    setTexto(novo);
    setErroEnvio(null);
    requestAnimationFrame(() => {
      el?.focus();
      const cursor = inicio + trecho.length;
      el?.setSelectionRange(cursor, cursor);
    });
  };
  // Só a falta do dado troca a conversa pelo estado de erro. Uma releitura de fundo que
  // falha (o intervalo de 10 s) mantém o que já foi lido na tela, com o aviso de que o
  // histórico pode estar desatualizado e as travas de envio por `query.isError`.
  if (!dados)
    return (
      <div
        className={cn("flex min-h-0 flex-col text-sm text-[var(--text-muted)]", !compacto && "h-full")}
        role="status"
        aria-busy={!query.isError}
        data-testid="atendimento-carregando"
      >
        {aoVoltar && (
          <button
            type="button"
            className={cn(ALVO_CONTROLE, FOCO, "flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--text)] sm:hidden")}
            onClick={aoVoltar}
            data-testid="chat-voltar-carregando"
          >
            <ArrowLeft aria-hidden className="h-3 w-3" />
            Voltar às conversas
          </button>
        )}
        {/* O detalhe depende do serviço de conversas: quando ele cai, o diagnóstico do canal é a informação que falta. */}
        {avisoDoCanal && <div className="shrink-0 px-5 pt-4">{avisoDoCanal}</div>}
        {query.isError ? (
          <EstadoVazioChat
            Icone={CloudOff}
            titulo="Não foi possível carregar"
            className="m-auto"
            acao={
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                onClick={() => query.refetch()}
              >
                <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                Tentar novamente
              </button>
            }
          >
            A conversa está indisponível. Tente novamente.
          </EstadoVazioChat>
        ) : mostrarSkeleton ? (
          <SkeletonDaConversa />
        ) : null}
      </div>
    );
  const c = dados.cobranca;
  const nomeDoCliente = dados.cliente?.nome ?? "Cliente";
  const emAtendimento = dados.conversa.status === "OPEN";
  const link360 = `/cobranca/cliente/${dados.conversa.customerId}?carteira=${carteira ?? c?.carteira ?? "ativo"}`;
  // A janela de 24 h do WhatsApp sai do que o servidor mandou (direção + instante
  // de cada mensagem). Sem recebimento no histórico carregado ela é DESCONHECIDA,
  // e o cabeçalho escreve "janela —" com o porquê no title.
  const janela = janelaDaConversa(mensagensWhatsapp);
  const diaDoTopo = chipDoDia(mensagens[0]);
  const rapidas = mensagensRapidas(origem);
  const tomAcolhedor = c?.tom === "humanizado_vulneravel";
  // A pílula "Envio" só acende verde com um envio ACEITO nesta conversa, e o
  // canal com problema vence o último envio: conversa aberta não é canal pronto.
  const estadoDoEnvio =
    enviando !== null
      ? "neutro"
      : ultimoEnvio === "falhou"
        ? "bloqueado"
        : canalPronto === false
          ? "atencao"
          : ultimoEnvio === "ok"
            ? "ok"
            : "neutro";
  const pedirEncerrar = () => {
    // Sem caso de cobrança ou caso fechado não há onde gravar o follow-up: encerra direto.
    if (encerrarDispensaFollowUp(c)) acao.mutate({ acao: "encerrar" });
    else setEncerrando(true);
  };
  const atualizarMensagens = () => {
    query.refetch();
    multicanal.refetch();
  };
  // O follow-up por extenso: no celular a linha trunca, e o texto inteiro fica no title.
  const followUpPorExtenso = c
    ? c.proximaAcao && c.proximoContatoEm
      ? `próxima ação: ${c.proximaAcao} · ${dataHoraBr(c.proximoContatoEm)} · ${c.responsavel ?? "sem dono"}`
      : "caso sem próxima ação — parado na fila"
    : undefined;
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col text-[var(--text)]",
        !compacto && "h-full min-[1400px]:flex-row",
      )}
      data-testid="atendimento-integrado"
    >
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]">
        {/* CABEÇALHO — avatar, nome e selos; telefone · canal · janela; as ações quebram de linha quando falta espaço.
            Abaixo de sm ele se recolhe (o histórico ficava com 15% da altura): nome e selos numa linha, o nome do
            canal só para o leitor de tela (o ícone fica), o follow-up numa linha truncada com o texto no title, e as
            ações secundárias no menu "Mais ações" — "Dados do caso" e a ação principal continuam à mão. */}
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3 max-sm:gap-y-1.5 max-sm:py-2">
          {aoVoltar && (
            <button
              type="button"
              className={cn(BOTAO_ICONE_COMPOSITOR, "-ml-2 text-[var(--text-2)] sm:hidden")}
              onClick={aoVoltar}
              aria-label="Voltar às conversas"
              title="Voltar às conversas"
              data-testid="chat-voltar"
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </button>
          )}
          <AvatarChat nome={nomeDoCliente} className={cn("h-10 w-10 text-sm", aoVoltar && "max-sm:hidden")} />
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2 max-sm:flex-nowrap">
              <h2 className="min-w-0 truncate text-[14.5px] font-semibold leading-tight" title={nomeDoCliente}>
                {nomeDoCliente}
              </h2>
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
              <MessageCircle aria-hidden className="h-[11px] w-[11px]" />
              <span className={NUM_CHAT}>
                {dados.cliente?.telefone ?? "Sem telefone"}
              </span>
              <span aria-hidden className="max-sm:hidden">·</span>
              <span className="font-medium text-[var(--text-2)] max-sm:sr-only">WhatsApp</span>
              <span aria-hidden>·</span>
              <span
                data-testid="chat-janela"
                title={janela?.motivo ?? MOTIVO_JANELA_DESCONHECIDA}
                className={
                  janela === null
                    ? "text-[var(--text-muted)]"
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
                className="mt-0.5 text-xs text-[var(--text-muted)] max-sm:truncate"
                title={followUpPorExtenso}
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
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--text-2)]">
                    {/* O âmbar vai ao ícone: --gated em texto de 12px fica em ~4:1, abaixo de AA. */}
                    <AlertCircle aria-hidden className="h-3 w-3 shrink-0 text-[var(--gated)]" />
                    caso sem próxima ação — parado na fila
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {!emAtendimento && (
              <button
                type="button"
                className={BOTAO_CHAT_MARCA}
                disabled={acao.isPending}
                onClick={() => acao.mutate({ acao: "assumir" })}
                data-testid="chat-assumir"
              >
                <Headset aria-hidden className="h-3.5 w-3.5" />
                {dados.conversa.status === "CLOSED" ? (
                  <>
                    <span className="sm:hidden">Reabrir</span>
                    <span className="max-sm:hidden">Reabrir atendimento</span>
                  </>
                ) : (
                  "Tomar conversa"
                )}
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
                  <Undo2 aria-hidden className="h-3.5 w-3.5" />
                  <span className="sm:hidden">Devolver</span>
                  <span className="max-sm:hidden">Devolver ao assistente</span>
                </button>
                <button
                  type="button"
                  className={cn(BOTAO_SECUNDARIO, "max-sm:hidden")}
                  disabled={acao.isPending}
                  onClick={pedirEncerrar}
                  data-testid="chat-encerrar"
                >
                  Encerrar conversa
                </button>
              </>
            )}
            {!compacto && (
              <>
                <button
                  type="button"
                  className={cn(BOTAO_SECUNDARIO, "min-[1400px]:hidden")}
                  onClick={() => setMostrarContexto(true)}
                >
                  Dados do caso
                </button>
                <Link
                  className={cn(BOTAO_SECUNDARIO, "hidden 2xl:inline-flex")}
                  href={link360}
                  data-testid="chat-cabecalho-360"
                >
                  <Layers aria-hidden className="h-3.5 w-3.5" /> Cliente 360
                </Link>
              </>
            )}
            <button
              type="button"
              className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "max-sm:hidden")}
              onClick={atualizarMensagens}
              aria-label="Atualizar mensagens"
              title="Atualizar mensagens"
            >
              <RefreshCw
                aria-hidden
                className={cn(
                  "h-3.5 w-3.5",
                  query.isFetching && "motion-safe:animate-spin",
                )}
              />
            </button>
            {/* Só no celular: o que é secundário cabe num menu. `modal={false}` porque o "Encerrar" abre um
                diálogo, e o menu modal devolvendo o foco ao botão brigaria com o foco preso do diálogo. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "sm:hidden")}
                  aria-label="Mais ações"
                  title="Mais ações"
                  data-testid="chat-mais-acoes"
                >
                  <MoreHorizontal aria-hidden className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[210px]">
                {emAtendimento && (
                  <DropdownMenuItem
                    className={ITEM_DO_MENU}
                    disabled={acao.isPending}
                    onSelect={pedirEncerrar}
                    data-testid="chat-menu-encerrar"
                  >
                    <MessageSquareX aria-hidden className="h-3.5 w-3.5" />
                    Encerrar conversa
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className={ITEM_DO_MENU}
                  onSelect={atualizarMensagens}
                  data-testid="chat-menu-atualizar"
                >
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                  Atualizar mensagens
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {query.isError && (
          <p role="alert" className="flex items-center gap-1.5 px-5 py-2 text-xs text-[var(--text-2)]">
            <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--gated)]" />
            O histórico pode estar desatualizado. Confira a conexão antes de
            enviar.
          </p>
        )}
        {/* CONVERSA — fundo liso, um chip de dia no topo, corridas de balões. */}
        <div
          ref={historico}
          onScroll={(e) => {
            const el = e.currentTarget;
            pertoDoFim.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM_PX;
          }}
          className={cn(
            "flex flex-col overflow-y-auto px-[7%] py-[18px]",
            compacto ? "h-72" : "min-h-0 flex-1",
          )}
          aria-label="Histórico da conversa"
        >
          {query.hasNextPage && (
            <button
              type="button"
              className={CHIP_CENTRAL_BOTAO}
              disabled={query.isFetchingNextPage}
              aria-busy={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              Carregar mensagens anteriores
            </button>
          )}
          {diaDoTopo && (
            <p className={cn(CHIP_CENTRAL, NUM_CHAT)} data-testid="chat-dia">
              {diaDoTopo}
            </p>
          )}
          {!mensagens.length && enviando === null && (
            <EstadoVazioChat
              Icone={MessageSquare}
              titulo="Sem mensagens"
              className="m-auto py-8"
            >
              Esta conversa ainda não tem mensagens.
            </EstadoVazioChat>
          )}
          {mensagens.map((m, i) => {
            const anterior = i > 0 ? mensagens[i - 1] : null;
            const proxima = i + 1 < mensagens.length ? mensagens[i + 1] : null;
            // Corrida: mesma voz, mesma direção, mesmo canal, dentro de cinco minutos.
            const inicioCorrida = !anterior || !mesmaCorrida(anterior, m);
            const fimCorrida = !proxima || !mesmaCorrida(m, proxima);
            const autor = autorDaMensagem(m);
            const transferencia = transferenciaAntesDe(mensagens, i);
            const hora = horaDaMensagem(m.em);
            return (
              <Fragment key={m.id}>
                {transferencia && (
                  <PilulaDeTransferencia
                    de={transferencia.de}
                    para={transferencia.para}
                    hora={hora}
                  />
                )}
                <BalaoDaConversa
                  saida={autor !== "cliente"}
                  inicioCorrida={inicioCorrida}
                  fimCorrida={fimCorrida}
                  cabecalho={
                    autor !== "cliente" && inicioCorrida ? (
                      <CabecalhoDoAutor
                        autor={autor}
                        nome={m.quem ?? "Provedor"}
                      />
                    ) : null
                  }
                  meta={
                    <MetaDoBalao
                      hora={hora}
                      canal={m.canal === "whatsapp" ? null : NOME_DO_CANAL[m.canal]}
                      saida={autor !== "cliente"}
                      status={m.status}
                      rotulo={rotuloDoStatus(m.status)}
                    />
                  }
                >
                  {m.assunto && (
                    <p className="mb-1 text-xs font-semibold">{m.assunto}</p>
                  )}
                  <TextoDoBalao
                    texto={
                      m.texto ||
                      (m.tipo === "TEMPLATE"
                        ? "Template de abertura"
                        : `Mensagem ${m.tipo.toLowerCase()} · anexo recebido`)
                    }
                  />
                  {TIPOS_COM_ANEXO.includes(m.tipo) && (
                    <Anexo
                      tipo={m.tipo}
                      url={`${url}/mensagens/${encodeURIComponent(m.id)}/midia?${escopo}&pagina=${query.data?.pages.find((p) => p.mensagens.some((x) => x.id === m.id))?.pagina ?? 1}`}
                    />
                  )}
                </BalaoDaConversa>
              </Fragment>
            );
          })}
          {enviando !== null && (
            <BalaoDaConversa
              saida
              pendente
              inicioCorrida
              fimCorrida
              meta={
                <MetaDoBalao
                  hora={null}
                  canal={null}
                  saida
                  status="QUEUED"
                  rotulo="enviando"
                />
              }
            >
              <TextoDoBalao texto={enviando} />
            </BalaoDaConversa>
          )}
        </div>
        {/* COMPOSITOR — faixas de aviso, atalhos, linha de entrada e o rodapé do envio. */}
        <form
          className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-3.5 pt-3 max-sm:pb-2.5 max-sm:pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          {avisoDoCanal}
          {!emAtendimento && (
            <FaixaDoCompositor
              tom="neutro"
              Icone={dados.conversa.status === "WAITING" ? Hourglass : Lock}
              testId="chat-aviso-assumir"
            >
              {dados.conversa.status === "WAITING"
                ? "Primeiro contato realizado. A resposta do cliente será encaminhada à equipe."
                : "Assuma o atendimento para continuar a conversa."}
            </FaixaDoCompositor>
          )}
          {negociar && politica.isError && (
            <FaixaDoCompositor
              tom="danger"
              alerta
              Icone={AlertCircle}
              acoes={
                <button
                  type="button"
                  className={cn(LINK_CHAT, "text-xs")}
                  onClick={() => politica.refetch()}
                >
                  Tentar novamente
                </button>
              }
            >
              Não foi possível ler a política.
            </FaixaDoCompositor>
          )}
          {multicanal.isError && (
            <FaixaDoCompositor tom="gated" alerta Icone={CloudOff}>
              Não foi possível atualizar SMS e e-mail. O histórico destes canais pode estar incompleto.
            </FaixaDoCompositor>
          )}
          {erroEnvio && (
            <FaixaDoCompositor
              tom="danger"
              alerta
              Icone={CloudOff}
              testId="chat-erro-envio"
            >
              {erroEnvio}
            </FaixaDoCompositor>
          )}
          {/* No celular os atalhos ficam numa linha que rola de lado (o p-1/-m-1 guarda o anel de
              foco): quebrando em três linhas de 44px, sobravam ~36px para a conversa. */}
          <div
            role="group"
            className="-m-1 mb-1.5 flex gap-[7px] overflow-x-auto p-1 [&>*]:shrink-0 sm:m-0 sm:mb-2.5 sm:flex-wrap sm:overflow-visible sm:p-0"
            aria-label="Ações complementares da conversa"
          >
            <button
              type="button"
              className={ATALHO}
              onClick={() => setPagamento({ aberto: true })}
            >
              <QrCode aria-hidden className={ICONE_DO_ATALHO} /> Enviar PIX / 2ª via
            </button>
            <button
              type="button"
              className={ATALHO}
              disabled={!alvoNegociacao || politica.isPending}
              aria-busy={politica.isPending}
              title={
                !alvoNegociacao
                  ? "Vincule um caso de cobrança para negociar"
                  : undefined
              }
              onClick={() => setNegociar(true)}
            >
              <Split aria-hidden className={ICONE_DO_ATALHO} /> Parcelar
            </button>
            <Link className={ATALHO} href={link360}>
              <Layers aria-hidden className={ICONE_DO_ATALHO} /> Cliente 360
            </Link>
            {emAtendimento &&
              (["sms", "email"] as const).map((opcao) => (
                <MulticanalDaConversa key={`${conversationId}:${escopo}:${opcao}`} url={url} escopo={escopo} canal={opcao} dados={multicanal.data} bloqueado={multicanal.isError || query.isError} />
              ))}
            {multicanal.data && <ReforcosDaConversa key={`${conversationId}:${escopo}`} url={url} escopo={escopo} dados={multicanal.data} />}
          </div>
          <label className="sr-only" htmlFor={`mensagem-${conversationId}`}>
            Mensagem ao cliente
          </label>
          <div className="flex items-end gap-1.5">
            <Popover open={emojisAbertos} onOpenChange={setEmojisAbertos}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={BOTAO_ICONE_COMPOSITOR}
                  disabled={!emAtendimento}
                  aria-label="Emojis"
                  title="Emojis"
                >
                  <Smile aria-hidden className="h-5 w-5" />
                </button>
              </PopoverTrigger>
              {/* No toque a grade abre em 6 colunas de 44px: o alvo de dedo do DESIGN_SYSTEM §7. */}
              <PopoverContent align="start" side="top" className="w-[248px] p-2 [@media(pointer:coarse)]:w-[292px]">
                <div role="group" className="grid grid-cols-8 gap-0.5 [@media(pointer:coarse)]:grid-cols-6" aria-label="Emojis">
                  {EMOJIS_DO_COMPOSITOR.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Inserir ${emoji}`}
                      className={cn("grid h-7 place-items-center rounded text-lg hover:bg-[var(--surface-inset)] [@media(pointer:coarse)]:h-11", FOCO_INTERNO)}
                      onClick={() => {
                        inserirNoCampo(emoji);
                        setEmojisAbertos(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={rapidasAbertas} onOpenChange={setRapidasAbertas}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={BOTAO_ICONE_COMPOSITOR}
                  disabled={!emAtendimento}
                  aria-label="Mensagens rápidas"
                  title="Mensagens rápidas"
                >
                  <Zap aria-hidden className="h-[18px] w-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" className="w-[300px] p-2">
                <p className="px-1.5 pb-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                  Mensagens rápidas
                  {tomAcolhedor && (
                    <span className="text-[var(--text-2)]">
                      {" "}·{" "}
                      <HeartHandshake aria-hidden className="inline h-3 w-3 align-[-2px] text-[var(--gated)]" />{" "}
                      tom acolhedor
                    </span>
                  )}
                </p>
                {rapidas.map((r) => (
                  <button
                    key={r.titulo}
                    type="button"
                    className={cn("block w-full rounded px-1.5 py-[7px] text-left hover:bg-[var(--surface-inset)] [@media(pointer:coarse)]:min-h-11", FOCO_INTERNO)}
                    onClick={() => {
                      // Só PREENCHE o campo: quem envia continua sendo o atendente.
                      inserirNoCampo(r.texto, true);
                      setRapidasAbertas(false);
                    }}
                  >
                    <span className="block text-[12.5px] font-semibold text-[var(--text)]">
                      {r.titulo}
                    </span>
                    <span className="block truncate text-[10.5px] text-[var(--text-muted)]">
                      {r.texto}
                    </span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <div className="flex min-h-11 min-w-0 flex-1 items-center rounded border border-[var(--border-strong)] bg-[var(--bg)] pl-4 pr-2 focus-within:border-[var(--brand)] focus-within:shadow-[var(--focus-ring)] motion-safe:transition-[border-color,box-shadow]">
              <textarea
                ref={campo}
                id={`mensagem-${conversationId}`}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  // O aviso de falha some quando o atendente volta a escrever, como na referência.
                  if (erroEnvio) setErroEnvio(null);
                  if (ultimoEnvio === "falhou") setUltimoEnvio(null);
                  // Escrever depois do Enter tira o texto da fila: ele valia para o que estava no campo.
                  if (espera) setEspera(null);
                }}
                onKeyDown={(e) => {
                  if (
                    teclaEnviaMensagem({
                      key: e.key,
                      shiftKey: e.shiftKey,
                      isComposing: e.nativeEvent.isComposing,
                      ponteiroFino: ponteiroPrincipalFino(),
                    })
                  ) {
                    e.preventDefault();
                    enviar();
                  }
                }}
                disabled={!emAtendimento}
                rows={texto.includes("\n") ? 3 : 1}
                maxLength={TAMANHO_MAXIMO_DA_MENSAGEM}
                className="block max-h-40 min-w-0 flex-1 resize-none bg-transparent py-[11px] text-[13.5px] leading-snug text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)]"
                placeholder={
                  emAtendimento
                    ? "Escreva uma mensagem…"
                    : "Tome a conversa para responder"
                }
              />
            </div>
            {/* O botão é o mesmo caminho do Enter: submete o formulário, e o enviar() decide. Com uma operação
                em andamento ele não trava — o envio vai à fila, e assumir/encerrar ganham o aviso da espera. */}
            <button
              type="submit"
              aria-label="Enviar"
              title="Enviar (Enter) · nova linha com Shift+Enter"
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded bg-[var(--action)] text-[var(--text-on-brand)] hover:bg-[var(--action-hover)] motion-safe:transition-[background-color,transform] motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--surface-3)] disabled:text-[var(--text-faint)]",
                FOCO,
              )}
              disabled={!emAtendimento || !texto.trim() || query.isError}
              data-testid="chat-enviar"
            >
              <Send aria-hidden className="h-[18px] w-[18px]" />
            </button>
          </div>
          {/* Follow-up ao responder: recolhido; vazio, o servidor grava o padrão no próximo dia útil. */}
          {emAtendimento && (
            <div data-testid="chat-followup-envio">
              {followUpEnvio.aberto && (
                <div className="mt-2 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 sm:grid-cols-[1fr_auto]">
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
          )}
          {/* Rodapé honesto: Sessão → Envio com o estado REAL, a contagem, o canal
              e a janela de contato QUE O SERVIDOR mandou. Sem política lida, traço
              com o motivo — nunca as horas padrão exibidas como se fossem as do provedor. */}
          <div className="mt-2 space-y-1 max-sm:mt-1.5" data-testid="chat-rodape-politica">
            {/* No celular a linha das pílulas não quebra: rola de lado, como os atalhos. */}
            <div className="flex flex-wrap items-center gap-[5px] max-sm:flex-nowrap max-sm:gap-1 max-sm:overflow-x-auto max-sm:[&>*]:shrink-0">
              <PilulaDoRodape
                estado={janela === null ? "neutro" : janela.aberta ? "ok" : "atencao"}
                Icone={Clock}
                titulo={janela?.motivo ?? MOTIVO_JANELA_DESCONHECIDA}
                testId="chat-rodape-sessao"
              >
                {janela === null
                  ? "Sessão · —"
                  : janela.aberta
                    ? "Sessão · aberta"
                    : "Sessão · fechada"}
              </PilulaDoRodape>
              <span aria-hidden className="text-[10px] text-[var(--text-faint)]">
                →
              </span>
              <PilulaDoRodape
                estado={estadoDoEnvio}
                Icone={enviando !== null ? Loader2 : ultimoEnvio === "falhou" ? CloudOff : Send}
                girar={enviando !== null}
                titulo={
                  canalPronto === false
                    ? "O canal do WhatsApp está com problema: veja o aviso acima"
                    : !emAtendimento
                      ? "Tome a conversa para responder"
                      : ultimoEnvio === "ok"
                        ? "O último envio foi aceito pelo chat"
                        : "Envio pelo WhatsApp do provedor"
                }
                testId="chat-rodape-envio"
              >
                {enviando !== null
                  ? "enviando…"
                  : ultimoEnvio === "falhou"
                    ? "Envio · falhou"
                    : "Envio"}
              </PilulaDoRodape>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] max-sm:gap-1 max-sm:whitespace-nowrap">
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
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-[var(--text-muted)]">
              <span>
                <span className={NUM_CHAT}>{texto.length}/2000</span>
                {/* A região viva existe sempre (leitor de tela só anuncia o que muda dentro dela), colada à contagem para não abrir um vão vazio. */}
                <span role="status" className="font-medium text-[var(--text-2)]" data-testid="chat-envio-espera">
                  {espera ? ` · ${TEXTO_DA_ESPERA[espera]}` : ""}
                </span>
              </span>
              <span aria-hidden className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">WhatsApp do provedor · atendimento humano</span>
              {tomAcolhedor && (
                <>
                  <span aria-hidden>·</span>
                  {/* O âmbar vai ao ícone: --gated em texto de 10px fica em ~4:1, abaixo de AA. */}
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--text-2)]">
                    <HeartHandshake aria-hidden className="h-3 w-3 shrink-0 text-[var(--gated)]" />
                    Tom acolhedor · sem pressão
                  </span>
                </>
              )}
              {/* O follow-up é do envio: mora ao pé do campo, e o painel abre logo acima deste rodapé. */}
              {emAtendimento && (
                <button
                  type="button"
                  className={cn(LINK_CHAT, "ml-auto gap-1 text-[11px]")}
                  aria-expanded={followUpEnvio.aberto}
                  onClick={() =>
                    setFollowUpEnvio((f) => ({ ...f, aberto: !f.aberto }))
                  }
                  data-testid="chat-followup-envio-abrir"
                >
                  <CalendarClock aria-hidden className="h-3.5 w-3.5" />
                  {followUpEnvio.aberto
                    ? "Ocultar próxima ação"
                    : (
                      // Um item só no flex do link: com dois, o gap trocaria o espaço e a mesa andaria 1px.
                      // No celular sai o "(opcional)": a linha do rodapé cabe numa altura de 44px.
                      <span>
                        Próxima ação<span className="max-sm:hidden"> (opcional)</span>
                      </span>
                    )}
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
      {!compacto && (
        <aside
          className={cn(
            // A terceira coluna do porte: 360px, rolando por si.
            "w-full shrink-0 overflow-y-auto border-[var(--border)] bg-[var(--surface)] min-[1400px]:static min-[1400px]:block min-[1400px]:w-[360px] min-[1400px]:border-l",
            mostrarContexto ? "absolute inset-0 z-20" : "hidden",
          )}
          aria-label="Contexto do atendimento"
        >
          <div className="border-b border-[var(--border)] px-4 py-2 min-[1400px]:hidden">
            <button
              type="button"
              className={BOTAO_SECUNDARIO}
              onClick={() => setMostrarContexto(false)}
            >
              Voltar à conversa
            </button>
          </div>
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
            urlDaSegundaVia={`${url}/segunda-via?${escopo}`}
            propostas={multicanal.data?.propostas}
            linkDo360={link360}
          />
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
        escopo={escopo}
        referencia={pagamento.ref}
        inserir={(mensagem) => {
          if (!emAtendimento)
            throw new Error("Tome a conversa antes de preparar o envio.");
          const novo = texto.trim() ? `${texto}\n\n${mensagem}` : mensagem;
          if (novo.length > TAMANHO_MAXIMO_DA_MENSAGEM)
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
        politica={politicaLida}
        tipoInicial="parcelamento"
        onFechar={() => {
          setNegociar(false);
          qc.invalidateQueries({ queryKey: [url, escopo] });
        }}
      />
    </div>
  );
}
