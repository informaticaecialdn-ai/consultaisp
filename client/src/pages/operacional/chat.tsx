/**
 * Conversas no layout do módulo Cobrança do Provedor.ai (pedido do dono de
 * 17/09/2026: "fazer o layout do chat, igual o do provedor.ai"): três colunas
 * de verdade em tela larga — lista (310px) · conversa (fluida) · painel do
 * cliente (360px, desenhado por <Atendimento>) —, cada uma rolando por si e a
 * página inteira sem barra de rolagem (a `main` mede a janela e prende o
 * `overflow`).
 *
 * A lista é a da referência: cabeçalho com "Conversas", a contagem (só se o
 * servidor contar), a busca e as abas segmentadas; linhas com avatar e selo do
 * canal, nome e tempo relativo (âmbar quando a conversa foi escalada), prévia e,
 * só quando há o que dizer (escalada, encerrada, sem histórico), a linha de
 * selos. Com a tela larga, abrir a página já seleciona a primeira conversa.
 *
 * A quebra acompanha a da referência (1 coluna até 800px, 2 até 1100px, 3
 * acima), deslocada porque a barra lateral deste app (248px) não vira trilho de
 * ícones: abaixo de `lg` uma coluna por vez, com "Voltar às conversas"; de `lg`
 * a 1399px duas colunas e o painel do cliente pelo botão "Dados do caso"; de
 * 1400px para cima as três lado a lado — é onde a conversa ainda fica com mais
 * de 480px ao lado de 310px de lista e 360px de ficha.
 *
 * O aviso de canal (WhatsApp não conectado, chat fora do ar) mora no topo do
 * compositor, como na referência — e em TODA coluna da direita que não é uma
 * conversa aberta (o estado vazio e o caso que chegou do quadro, carregando, com
 * erro ou sem conversa), na lista estreita, e acima do erro e do skeleton da
 * conversa. Nenhum estado da tela esconde o aviso: é ele que impede o operador
 * de mandar o primeiro contato por um WhatsApp desconectado.
 *
 * Regra de ouro do traço: o que a fila NÃO traz não é preenchido. A contagem
 * do título só aparece se o servidor mandar `total`; a prévia da última
 * mensagem só se ele mandar `ultimaMensagem` — enquanto não manda, a linha
 * mostra o telefone e diz o porquê no `title`. Nada de prévia inventada nem de
 * zero no lugar de "não sei".
 */
import { useEffect, useState } from "react";
import type { DiagnosticoDoChat } from "@shared/chat-diagnostico";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  CloudOff,
  MessageCircle,
  MessageSquareDashed,
  MessageSquarePlus,
  MessagesSquare,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ALVO_CONTROLE,
  ALVO_TEXTO,
  AvisoNaoCarregou,
  BOTAO_MARCA,
  BOTAO_SECUNDARIO,
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
  EstadoVazioChat,
  FaixaDoCompositor,
  SkeletonDaFila,
} from "@/components/chat/ConversaUi";
import {
  AvatarChat,
  LINK_CHAT,
  NUM_CHAT,
} from "@/components/chat/PerfilDoCliente";
import {
  API_ATENDIMENTOS,
  conversaAtiva,
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

/** A busca espera o operador parar de digitar, como na referência: uma leitura, não uma por tecla. */
const ESPERA_DA_BUSCA_MS = 250;

/** A tela larga, onde as colunas cabem lado a lado e a primeira conversa já abre. */
const TELA_COM_COLUNAS = "(min-width: 1024px)";

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
  mostrarCarteira,
  onAbrir,
}: {
  c: ResumoChat;
  ativa: boolean;
  /** Na cobrança a lista já é de uma carteira só: o selo repetiria o espaço em toda linha. */
  mostrarCarteira: boolean;
  onAbrir: () => void;
}) {
  const quando = tempoRelativo(c.ultimoEventoEm);
  const previa = c.ultimaMensagem;
  // Escalada é o "não lido" desta tela: a hora acende em âmbar, como na referência.
  const escalada = c.status === "PENDING";
  // Como na referência, a linha de selos só existe quando há o que dizer: o estado fora do curso
  // normal (escalada, encerrada) ou a conversa sem histórico. A conversa ativa fica em duas linhas.
  const estadoForaDoCurso = !conversaAtiva(c.status);
  return (
    <button
      type="button"
      aria-current={ativa ? "true" : undefined}
      className={cn(
        FOCO_INTERNO,
        "flex w-full gap-[11px] border-b border-[var(--border)] px-3.5 py-3 text-left motion-safe:transition-colors",
        ativa ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-2)]",
      )}
      onClick={onAbrir}
      data-testid="fila-chat-linha"
    >
      <span className="relative shrink-0">
        <AvatarChat nome={c.nome} className="h-11 w-11 text-[13px] font-medium" />
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-[3px] grid h-[17px] w-[17px] place-items-center rounded-full bg-[var(--surface)] shadow-[0_0_0_1px_var(--border)]"
        >
          <MessageCircle className="h-[9px] w-[9px] text-[var(--text-2)]" />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--text)]">
            {c.nome}
          </span>
          {quando ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-[10px]",
                // O âmbar a 10px não passa AA (nem sobre branco, nem sobre a linha ativa): ele vai
                // ao ponto, e a hora fica em --text-2 negrito. A não escalada é --text-muted, o
                // --text-3 da referência: --text-faint ficava em ~3,2:1 no branco e ~2,7:1 na ativa.
                escalada ? "font-bold text-[var(--text-2)]" : "text-[var(--text-muted)]",
                c.ultimoEventoEm && NUM_CHAT,
              )}
              title={dataHoraBr(c.ultimoEventoEm)}
            >
              {escalada && (
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gated)]" />
              )}
              {quando}
              {escalada && <span className="sr-only"> · escalada</span>}
            </span>
          ) : (
            <Traco titulo={MOTIVO_SEM_HISTORICO} />
          )}
        </span>
        <span className="mt-[3px] flex min-w-0 items-center gap-[5px] text-xs text-[var(--text-muted)]">
          {previa ? (
            <span className="min-w-0 flex-1 truncate">
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
              className={cn("min-w-0 flex-1 truncate", c.telefone && NUM_CHAT)}
              title={MOTIVO_SEM_PREVIA}
            >
              {c.telefone ?? "Telefone não informado"}
            </span>
          )}
          {c.quadrante !== undefined && <SeloQuadrante quadrante={c.quadrante} />}
          {mostrarCarteira && c.carteira && <SeloCarteira carteira={c.carteira} />}
        </span>
        {(estadoForaDoCurso || !c.ultimoEventoEm) && (
          <span className="mt-[5px] flex flex-wrap items-center gap-[5px]" data-testid="fila-chat-selos">
            {estadoForaDoCurso && (
              <SeloCobranca tom={TOM_DO_STATUS_CHAT[c.status] ?? "neutro"}>
                {STATUS_CHAT[c.status] ?? c.status}
              </SeloCobranca>
            )}
            {!c.ultimoEventoEm && (
              <SeloCobranca tom="neutro" titulo={MOTIVO_SEM_HISTORICO}>
                sem histórico
              </SeloCobranca>
            )}
          </span>
        )}
        {/* Sem o selo, o leitor de tela ainda ouve em que estado a conversa está. */}
        {!estadoForaDoCurso && <span className="sr-only"> · {STATUS_CHAT[c.status] ?? c.status}</span>}
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
  "O serviço de conversas não está configurado nesta instalação. Solicite a configuração ao administrador.";
export const MOTIVO_SEM_CANAL =
  "O WhatsApp do provedor ainda não está conectado: sem um número pareado, não há de onde mandar a mensagem.";

export const MOTIVO_CANAL_NAO_PRONTO =
  "O WhatsApp do provedor não está pronto para enviar. Veja o aviso acima.";

/**
 * O diagnóstico que PROVA que o primeiro contato não sai. A integração continua
 * `ativo` quando a instância cai depois de configurada (NsLink, 16/09/2026), então
 * `motivoDeNaoIniciar` sozinho deixava o botão ligado. "Não foi possível confirmar
 * a conexão" e "resposta inválida" não provam nada: o aviso aparece, mas o botão
 * fica — como `motivoDeNaoIniciar`, a tela não acusa o que não sabe. Sem leitura
 * (carregando, ou a rota do diagnóstico falhou), idem.
 */
export function canalImpedeOPrimeiroContato(diagnostico: DiagnosticoDoChat | undefined): boolean {
  if (!diagnostico) return false;
  return !["PRONTO", "CONEXAO_NAO_CONFIRMADA", "RESPOSTA_INVALIDA"].includes(diagnostico.codigo);
}

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
  canalImpede,
  onAbrir,
}: {
  casoId: number;
  carteira: string;
  /** O diagnóstico do canal provou que a mensagem não sai (ver `canalImpedeOPrimeiroContato`). */
  canalImpede: boolean;
  onAbrir: (conversationId: string) => void;
}) {
  const { toast } = useToast();
  const { data: integracaoCrua } = useQuery<unknown>({
    queryKey: [`${API_CHAT_BULLQ}/integracao`],
    staleTime: 300_000,
  });
  const integracao = lerIntegracaoDoChat(integracaoCrua);
  const pronto = chatProntoParaEnviar(integracao);
  const motivoDaIntegracao = motivoDeNaoIniciar(integracao);
  // A integração vem primeiro (diz o que configurar); o canal, depois — e o detalhe dele já está no aviso acima.
  const impedimento = motivoDaIntegracao ?? (canalImpede ? MOTIVO_CANAL_NAO_PRONTO : null);

  const iniciar = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `${apiEnviarCasoParaChat(casoId)}?carteira=${carteira}`, {})).json() as Promise<{
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
    <EstadoVazioChat
      Icone={MessageSquarePlus}
      testId="caso-sem-conversa"
      className="min-h-full"
      titulo={
        <>
          O caso <span className={NUM_CHAT}>#{casoId}</span> ainda não tem conversa
        </>
      }
      acao={
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            className={cn(BOTAO_MARCA, DESABILITAVEL)}
            disabled={!pronto || canalImpede || iniciar.isPending}
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
              {/* Com o motivo do canal, o "Configurar WhatsApp" já está no aviso: um link só. */}
              {motivoDaIntegracao && integracao?.ligado && (
                <Link href="/painel-provedor?tab=chat" className={cn(LINK_CHAT, "text-[11px]")}>
                  Conectar o WhatsApp →
                </Link>
              )}
            </p>
          )}
          <Link href={`/cobranca/esteira?carteira=${carteira}`} className={cn(LINK_CHAT, "text-xs")}>
            Voltar ao quadro →
          </Link>
        </div>
      }
    >
      O primeiro contato abre a conversa no WhatsApp do provedor com a mensagem da etapa
      da régua. A partir daí a equipe continua por aqui.
    </EstadoVazioChat>
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
    queryKey: [`${apiConversaDoCaso(casoDoLink ?? 0)}?carteira=${carteira}`],
    queryFn: async () => {
      const r = await fetch(`${apiConversaDoCaso(casoDoLink!)}?carteira=${carteira}`, { credentials: "include" });
      if (r.status === 404) {
        const erro = await r.json();
        if (erro.codigo === "ESCOPO_DIVERGENTE") throw new Error(erro.message);
        return null;
      }
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
  const [buscaAplicada, setBuscaAplicada] = useState("");
  useEffect(() => {
    const espera = setTimeout(() => setBuscaAplicada(busca.trim()), ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(espera);
  }, [busca]);
  const [status, setStatus] = useState("");
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ origem, pagina: String(pagina) });
  if (origem === "cobranca") params.set("carteira", carteira);
  if (buscaAplicada) params.set("busca", buscaAplicada);
  if (status) params.set("status", status);
  const url = `${API_ATENDIMENTOS}?${params}`;
  const fila = useQuery<FilaDeAtendimentos>({
    queryKey: [url],
    queryFn: async () => (await apiRequest("GET", url)).json(),
    // A lista se atualiza a cada 15 s, como na referência; o React Query pausa com a aba oculta.
    refetchInterval: 15_000,
  });
  const transporte = useQuery<DiagnosticoDoChat>({
    queryKey: [`${API_CHAT_BULLQ}/integracao/diagnostico`],
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const esqueleto = useSkeletonAtrasado(fila.isPending);
  /*
   * Seleção inicial da referência: com as colunas lado a lado e nada aberto, a
   * primeira conversa da lista abre. Só na tela larga — na estreita a lista É a
   * tela — e nunca por cima de um `?conversa=` ou `?caso=` que veio de um link:
   * a conversa aberta por link pode não estar na página atual da lista.
   */
  const primeiraDaLista = fila.data?.itens[0]?.conversationId ?? null;
  useEffect(() => {
    if (!primeiraDaLista || selecionada || casoDoLink) return;
    if (typeof window === "undefined" || !window.matchMedia(TELA_COM_COLUNAS).matches) return;
    navegar(rotaChat(origem, primeiraDaLista, carteira), { replace: true });
  }, [primeiraDaLista, selecionada, casoDoLink, origem, carteira, navegar]);
  const canalComProblema =
    transporte.isError || (transporte.data !== undefined && transporte.data.codigo !== "PRONTO");
  const avisoDoCanal = (testId: string) =>
    canalComProblema ? (
      <FaixaDoCompositor
        tom="gated"
        Icone={Plug}
        testId={testId}
        acoes={
          <>
            <button type="button" className={cn(ALVO_TEXTO, FOCO, DESABILITAVEL, "rounded underline")} disabled={transporte.isFetching} onClick={() => transporte.refetch()}>
              {transporte.isFetching ? "Verificando…" : "Verificar novamente"}
            </button>
            <Link href="/painel-provedor?tab=chat" className={cn(LINK_CHAT, "text-xs")}>Configurar WhatsApp →</Link>
          </>
        }
      >
        {transporte.isError ? "Não foi possível verificar a conexão do chat. O estado do serviço ainda não foi confirmado." : transporte.data?.mensagem}
      </FaixaDoCompositor>
    ) : null;
  return (
    <main
      className="flex h-[calc(100dvh-3rem)] min-h-[540px] flex-col overflow-hidden text-[var(--text)]"
      data-testid={`chat-${origem}`}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--surface)]">
        <aside
          className={cn(
            "w-full shrink-0 flex-col border-r border-[var(--border)] lg:w-[260px] xl:w-[310px]",
            selecionada || casoDoLink ? "hidden lg:flex" : "flex",
          )}
          aria-label="Fila de conversas"
        >
          <div className="shrink-0 space-y-3 border-b border-[var(--border)] px-4 pb-[11px] pt-[15px]">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
                {origem === "cobranca" ? "Cobrança" : "Equipamentos"} / Atendimento
              </p>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-[var(--track-tight)]">
                  Conversas
                </h1>
                {/* O número só existe se o servidor contar. Sem `total`, título sem número. */}
                {fila.data?.total !== undefined && (
                  <span
                    className={cn(
                      "rounded bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-ink)]",
                      NUM_CHAT,
                    )}
                    data-testid="fila-chat-total"
                  >
                    {fila.data.total}
                  </span>
                )}
              </div>
            </div>
            <label className="flex items-center gap-2 rounded border border-[var(--border-strong)] bg-[var(--surface)] pl-2.5 pr-2 focus-within:border-[var(--brand)] focus-within:shadow-[var(--focus-ring)]">
              <Search
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
              />
              <input
                aria-label="Buscar cliente ou telefone"
                className={cn(
                  ALVO_CONTROLE,
                  "min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-[var(--text-muted)]",
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
              className="flex gap-1 rounded-md bg-[var(--surface-inset)] p-[3px]"
            >
              {ABAS_DA_FILA.map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={status === valor}
                  className={cn(
                    ALVO_TEXTO,
                    FOCO,
                    "flex-1 justify-center rounded px-1 py-[7px] text-xs font-semibold leading-none motion-safe:transition-colors",
                    status === valor
                      ? "bg-[var(--surface)] text-[var(--text)] shadow-[0_0_0_1px_var(--border)]"
                      : "text-[var(--text-2)] hover:text-[var(--text)]",
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
            {/* Na tela estreita a lista é a tela inteira: o aviso do canal não pode esperar uma conversa abrir. */}
            {canalComProblema && <div className="lg:hidden">{avisoDoCanal("chat-diagnostico-transporte-lista")}</div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {fila.isError ? (
              <EstadoVazioChat
                Icone={CloudOff}
                titulo="Não foi possível carregar"
                acao={
                  <button
                    type="button"
                    onClick={() => fila.refetch()}
                    className={BOTAO_SECUNDARIO}
                  >
                    <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                    Tentar novamente
                  </button>
                }
              >
                <span role="alert">
                  A lista de conversas está indisponível. {mensagemDoErro(fila.error)}
                </span>
              </EstadoVazioChat>
            ) : fila.isPending ? (
              esqueleto ? (
                <div data-testid="fila-chat-skeleton">
                  <SkeletonDaFila linhas={6} />
                </div>
              ) : null
            ) : !fila.data.itens.length ? (
              <EstadoVazioChat Icone={MessageSquareDashed} titulo="Nenhuma conversa">
                {buscaAplicada
                  ? "Nenhum resultado para a busca."
                  : "Sem conversas neste filtro no momento. Inicie o contato a partir de um caso."}
              </EstadoVazioChat>
            ) : (
              fila.data.itens.map((c) => (
                <LinhaDaConversa
                  key={c.conversationId}
                  c={c}
                  ativa={c.conversationId === selecionada}
                  mostrarCarteira={origem === "equipamentos"}
                  onAbrir={() =>
                    navegar(rotaChat(origem, c.conversationId, carteira))
                  }
                />
              ))
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-3.5 py-2 text-xs text-[var(--text-2)]">
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
          {/* Em tela estreita a fila fica escondida: sem esta volta, o caso é um beco. Com a conversa
              aberta, abaixo de sm a volta mora no cabeçalho do atendimento (aoVoltar) e esta faixa some. */}
          {(selecionada || casoDoLink) && (
            <button
              type="button"
              className={cn(
                ALVO_CONTROLE,
                FOCO,
                "flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs lg:hidden",
                selecionada && "max-sm:hidden",
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
                key={`${origem}-${carteira}-${selecionada}`}
                conversationId={selecionada}
                origem={origem}
                carteira={origem === "cobranca" ? carteira : undefined}
                avisoDoCanal={avisoDoCanal("chat-diagnostico-transporte")}
                canalPronto={canalComProblema ? false : transporte.data?.codigo === "PRONTO" ? true : undefined}
                aoVoltar={() => navegar(rotaChat(origem, undefined, carteira))}
              />
            </div>
          ) : (
            /*
             * Tudo o que não é conversa aberta: o caso que veio do quadro e o estado
             * vazio. O aviso do canal fica FORA do ternário, em qualquer largura —
             * dentro dele, o caso carregando, com erro ou sem conversa escondia a
             * faixa, e o "Iniciar conversa" saía por um WhatsApp desconectado.
             */
            <div
              className={cn("flex min-h-0 flex-1 flex-col", !casoDoLink && "bg-[var(--bg)]")}
              data-testid="chat-coluna-sem-conversa"
            >
              {canalComProblema && (
                <div className="shrink-0 px-5 pt-4" data-testid="chat-coluna-aviso-do-canal">
                  {avisoDoCanal("chat-diagnostico-transporte")}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {casoDoLink ? (
                  conversaDoCaso.isPending ? (
                    <div className="flex min-h-full items-center justify-center p-8" aria-busy>
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
                      canalImpede={canalImpedeOPrimeiroContato(transporte.data)}
                      onAbrir={(id) => navegar(rotaChat(origem, id, carteira), { replace: true })}
                    />
                  )
                ) : (
                  <EstadoVazioChat
                    Icone={MessagesSquare}
                    titulo="Selecione uma conversa"
                    className="min-h-full"
                  >
                    Escolha um atendimento na lista para ver a conversa e os dados
                    do cliente.
                  </EstadoVazioChat>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
