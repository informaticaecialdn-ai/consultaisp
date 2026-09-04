/**
 * Aba Suporte do Painel do Provedor — a porta, e quem a abre.
 *
 * POR QUE ESTA TELA E DIFERENTE DAS OUTRAS ABAS
 * As demais abas configuram o proprio provedor. Esta autoriza um ESTRANHO a
 * entrar na conta com os poderes de um administrador — inclusive a ver o dado
 * pessoal completo dos clientes dele, que sao titulares que nunca falaram
 * conosco. O isolamento por `providerId` e a invariante central do produto, e a
 * liberacao a atravessa de proposito.
 *
 * Consentimento so vale se a pessoa souber o que esta consentindo. Por isso o
 * escopo esta escrito por extenso na tela ANTES do botao, e repetido na
 * confirmacao — inclusive as duas partes que doem: o suporte ve nome, CPF e
 * endereco dos clientes, e as consultas que ele fizer gastam credito do
 * provedor. Um botao chamado "liberar acesso" com o escopo escondido colheria
 * um consentimento que nao existe.
 *
 * O RELOGIO NAO E O DO NAVEGADOR. Quem autoriza cada requisicao do suporte e o
 * banco (`travaDeAcessoDeSuporte` sobre `acessoDeSuporteValido`). A contagem
 * regressiva daqui e APRESENTACAO: quando ela chega a zero, a tela nao conclui
 * nada — ela pergunta de novo ao servidor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Clock, Eye, Headset, Loader2, Lock, ShieldCheck, Unlock,
} from "lucide-react";
import {
  ALVO_CONTROLE, AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, DESABILITAVEL,
  KickerSecao, LadrilhoIcone, LinhasSkeleton, MolduraModal, RotuloCampo, Selo,
  TITULO_CARTAO, TITULO_MODAL,
} from "./ui";

const ROTA = "/api/provider/acesso-suporte";

/**
 * O corpo que `GET /api/provider/acesso-suporte` devolve.
 *
 * Espelha `EstadoDoAcesso` de `server/routes/suporte-acesso.routes.ts`, campo a
 * campo, inclusive os opcionais — a rota omite o que nao existe em vez de mandar
 * `null`. NAO ha nome nem e-mail de ninguem aqui, e e uma decisao daquele lado:
 * a trilha guarda os ids, a tela nao precisa deles para dizer o que importa.
 */
export interface EstadoDoAcessoDeSuporte {
  /** Existe janela valida agora? Quem responde e o banco, nao o navegador. */
  liberado: boolean;
  expiraEm?: string;
  liberadoEm?: string;
  /** Ja houve pelo menos UMA requisicao do suporte dentro desta janela. E
   *  grudento: continua verdadeiro depois que a pessoa fecha a aba dela. Por
   *  isso a frase da tela nao sai so daqui — ver `presenteAgora`. */
  conectado: boolean;
  primeiroUsoEm?: string;
  ultimoUsoEm?: string;
  /** Amostras de atividade, no maximo uma por minuto. */
  usos: number;
  /** Quanto dura uma liberacao nova. Vem do servidor para o texto nao repetir o
   *  numero num literal proprio — ver `DURACAO_PADRAO_MS`. */
  duracaoPadraoMs?: number;
  /** Relogio do servidor no instante da resposta. Opcional no tipo, e nao na
   *  rota: a rota manda sempre. Fica opcional porque resposta guardada em cache
   *  de antes desta versao nao o tem, e a contagem cai no relogio local nesse
   *  caso — ver `desvioDoRelogio`. */
  agora?: string;
}

/**
 * Duracao mostrada no texto quando o servidor nao a informa.
 *
 * As 2 horas sao decisao do dono e vivem no servidor
 * (`DURACAO_PADRAO_DO_ACESSO_MS`). Aquele modulo importa a conexao com o banco,
 * entao nao da para importa-lo daqui — o valor viaja em `duracaoPadraoMs`, e
 * este literal e so o ultimo recurso. Se a duracao mudar la e a resposta nao
 * trouxer o campo, a tela promete um prazo que o banco nao cumpre.
 */
const DURACAO_PADRAO_MS = 2 * 60 * 60 * 1000;

/**
 * Quanto tempo sem atividade ainda conta como "na conta agora".
 *
 * O `conectado` do servidor responde "ja entrou nesta janela", e nunca volta a
 * ser falso — util para saber que a janela FOI usada, insuficiente para a frase
 * que o provedor le em vermelho. Quem responde "agora" e `ultimoUsoEm`, que a
 * trava atualiza no maximo uma vez por minuto: cinco minutos e curto o bastante
 * para nao chamar de presente quem ja saiu, e folgado o bastante para nao piscar
 * entre uma acao e outra de quem esta trabalhando.
 */
const JANELA_DE_PRESENCA_MS = 5 * 60 * 1000;

/** De quanto em quanto tempo a tela reconfere com o servidor enquanto a porta
 *  esta aberta. E assim que "ninguem entrou" vira "suporte conectado" na frente
 *  do provedor, sem que ele recarregue a pagina. */
const INTERVALO_DE_RECONFERENCIA_MS = 20_000;

/* ------------------------------------------------------------------ */
/* Derivacoes puras — exportadas para teste                            */
/* ------------------------------------------------------------------ */

/**
 * O desvio entre o relogio do servidor e o desta maquina, em ms.
 *
 * Somado a `Date.now()`, da a hora do servidor. Sem isso, um navegador com o
 * relogio 8 minutos adiantado mostra a janela fechando 8 minutos antes da hora,
 * e o provedor conclui que a liberacao nao durou o que prometemos. A rota manda
 * `agora` em toda resposta; sem ele — resposta antiga em cache — o desvio e zero
 * e a contagem confia no relogio local, que e a melhor aproximacao disponivel.
 */
export function desvioDoRelogio(agora: string | null | undefined, recebidoEm: number): number {
  if (!agora) return 0;
  const servidor = Date.parse(agora);
  return Number.isFinite(servidor) ? servidor - recebidoEm : 0;
}

/** Quanto falta para a janela fechar, em ms, nunca negativo. */
export function restanteDaJanela(
  expiraEm: string | null | undefined,
  agoraDoServidor: number,
): number {
  if (!expiraEm) return 0;
  const fim = Date.parse(expiraEm);
  if (!Number.isFinite(fim)) return 0;
  return Math.max(0, fim - agoraDoServidor);
}

/** Alguem do suporte JA entrou nesta janela — grudento, como o campo do servidor.
 *  `primeiroUsoEm` entra como reforco: os dois nascem do mesmo carimbo, e ler os
 *  dois evita que a tela cale caso um deles falte numa resposta. */
export function jaEntrou(
  estado: Pick<EstadoDoAcessoDeSuporte, "conectado" | "primeiroUsoEm">,
): boolean {
  return estado.conectado === true || estado.primeiroUsoEm != null;
}

/**
 * Ha alguem do suporte trabalhando na conta NESTE momento.
 *
 * Separado de `jaEntrou` de proposito. Dizer "o suporte esta na sua conta agora"
 * duas horas depois de a pessoa ter saido nao e um exagero inofensivo: e o
 * provedor lendo um alarme que nao corresponde a nada, e da segunda vez ele
 * deixa de acreditar na faixa vermelha.
 */
export function presenteAgora(
  estado: Pick<EstadoDoAcessoDeSuporte, "ultimoUsoEm">,
  agoraDoServidor: number,
): boolean {
  if (!estado.ultimoUsoEm) return false;
  const ultimo = Date.parse(estado.ultimoUsoEm);
  if (!Number.isFinite(ultimo)) return false;
  return agoraDoServidor - ultimo <= JANELA_DE_PRESENCA_MS;
}

export type FaseDoAcesso = "fechado" | "liberado" | "conectado";

/**
 * Os tres estados da tela.
 *
 * `restanteMs` entra na conta de proposito: entre um tique da contagem e a
 * proxima resposta do servidor a janela pode ter vencido. Mostrar "liberado" com
 * 0:00:00 no relogio seria a tela contando uma coisa e escrevendo outra —
 * `fechado` e a leitura conservadora, e a reconferencia confirma logo em
 * seguida.
 */
export function faseDoAcesso(
  estado: EstadoDoAcessoDeSuporte | undefined,
  restanteMs: number,
): FaseDoAcesso {
  if (!estado?.liberado || restanteMs <= 0) return "fechado";
  return jaEntrou(estado) ? "conectado" : "liberado";
}

/**
 * A contagem regressiva, em h:mm:ss.
 *
 * Largura fixa de proposito (`0:04:03`, e nao `4:03`): o numero fica em mono
 * tabular, e um formato que encolhe faz o bloco pular de largura a cada troca de
 * faixa — o oposto do que a secao 2 do DESIGN_SYSTEM pede de um numero.
 */
export function formatarRestante(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "2 horas", "30 minutos" — o prazo por extenso, para o texto de consentimento. */
export function prazoPorExtenso(ms: number): string {
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `${minutos} minuto${minutos === 1 ? "" : "s"}`;
  const horas = minutos / 60;
  const inteiro = Number.isInteger(horas) ? String(horas) : horas.toFixed(1).replace(".", ",");
  return `${inteiro} hora${horas === 1 ? "" : "s"}`;
}

/** "há 12 minutos". Sem segundos: um carimbo que a trava so atualiza uma vez por
 *  minuto nao tem precisao de segundo para oferecer, e fingir que tem faria a
 *  tela parecer mais informada do que e. */
export function tempoDesde(quando: string | null | undefined, agoraDoServidor: number): string {
  if (!quando) return "";
  const t = Date.parse(quando);
  if (!Number.isFinite(t)) return "";
  const minutos = Math.max(0, Math.floor((agoraDoServidor - t) / 60_000));
  if (minutos < 1) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} minuto${minutos === 1 ? "" : "s"}`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas} hora${horas === 1 ? "" : "s"}`;
}

/** Hora do relogio, para "vale até 14:32". A data so aparece quando a janela
 *  cruza a meia-noite — senao "hoje" e ruido em toda liberacao. */
function horaDoRelogio(quando: string | null | undefined, agoraDoServidor: number): string {
  if (!quando) return "";
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return "";
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const mesmoDia = d.toDateString() === new Date(agoraDoServidor).toDateString();
  return mesmoDia ? hora : `${d.toLocaleDateString("pt-BR")} às ${hora}`;
}

/* ------------------------------------------------------------------ */
/* Botao adverso                                                       */
/* ------------------------------------------------------------------ */

/** ENCERRAR e a acao PROTETIVA, e ainda assim leva a tinta de risco.
 *
 *  Nao e para alarmar: e para ser o unico controle saturado da tela enquanto a
 *  porta esta aberta. Com a tinta neutra do botao secundario ele fica com o
 *  mesmo peso de um "Cancelar" dentro de um bloco ja vermelho, e quem precisa
 *  fechar a porta as pressas perde um segundo procurando. A saturacao aqui
 *  significa risco (secao 3) — o risco e a porta continuar aberta. */
const BOTAO_ENCERRAR = cn(
  BOTAO_SECUNDARIO,
  "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
  "hover:bg-[var(--danger-bg)] hover:border-[var(--danger)]",
  DESABILITAVEL,
);

/* ------------------------------------------------------------------ */
/* Escopo — o que o provedor esta liberando                            */
/* ------------------------------------------------------------------ */

/**
 * O escopo, item a item.
 *
 * A lista NAO e uma amostra amigavel: o acesso e total, e cada item existe
 * porque um provedor poderia se surpreender com ele depois. Os dois ultimos sao
 * os que doem — dado pessoal de terceiro e credito que sai do bolso dele — e
 * ficam por ultimo justamente para nao serem os primeiros a serem pulados numa
 * leitura de cima para baixo.
 */
const ESCOPO = [
  {
    Icone: ShieldCheck,
    titulo: "Tudo que um administrador seu faz",
    texto: "Não há área reservada: usuários, integração com o ERP, regras de anti-fraude, subdomínio, dados da empresa e importação de arquivos.",
  },
  {
    Icone: Eye,
    titulo: "O cadastro completo dos seus clientes",
    texto: "Nome, CPF/CNPJ, endereço, telefone, faturas, equipamentos e o histórico de consultas — sem máscara, do jeito que você vê.",
  },
  {
    Icone: AlertTriangle,
    titulo: "Consultas que gastam os seus créditos",
    texto: "Uma consulta feita pelo suporte sai do seu saldo, igual a uma consulta feita pela sua equipe.",
  },
] as const;

function ListaDeEscopo() {
  return (
    <ul className="space-y-2.5">
      {ESCOPO.map(item => (
        <li key={item.titulo} className="flex gap-2.5">
          <item.Icone
            className="w-4 h-4 mt-px flex-none text-[var(--text-faint)]"
            strokeWidth={2}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-[var(--text)] leading-snug">{item.titulo}</p>
            <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-0.5">{item.texto}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Aba                                                                 */
/* ------------------------------------------------------------------ */

export function AbaSuporte({ podeEditar }: { podeEditar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<EstadoDoAcessoDeSuporte>({
    queryKey: [ROTA],
    staleTime: 0,
    /* Enquanto a porta esta aberta a tela reconfere sozinha: e o unico jeito de
       "ninguem entrou" virar "suporte conectado" na frente do provedor sem que
       ele recarregue. Fechada, nao ha o que vigiar — e um painel deixado aberto
       o dia todo nao deve gerar requisicao por nada. */
    refetchInterval: q =>
      (q.state.data as EstadoDoAcessoDeSuporte | undefined)?.liberado
        ? INTERVALO_DE_RECONFERENCIA_MS
        : false,
    refetchOnWindowFocus: true,
  });

  /* O desvio e medido UMA vez por resposta, no instante em que ela chega.
     Recalculado a cada tique, cada atraso de rede entraria de novo na conta e a
     contagem andaria em passos irregulares. */
  const recebidoEm = useRef(Date.now());
  const desvio = useMemo(() => {
    recebidoEm.current = Date.now();
    return desvioDoRelogio(data?.agora, recebidoEm.current);
  }, [data]);

  const [, setTique] = useState(0);
  useEffect(() => {
    if (!data?.liberado) return;
    const id = setInterval(() => setTique(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [data?.liberado]);

  const agoraDoServidor = Date.now() + desvio;
  const restanteMs = restanteDaJanela(data?.expiraEm, agoraDoServidor);
  const fase = faseDoAcesso(data, restanteMs);
  const duracaoMs = data?.duracaoPadraoMs ?? DURACAO_PADRAO_MS;
  const prazo = prazoPorExtenso(duracaoMs);

  /* Zerou no relogio: a tela NAO conclui que fechou, pergunta. Quem decide a
     validade e o banco — o tique so serve para saber a hora de perguntar. */
  useEffect(() => {
    if (data?.liberado && restanteMs <= 0) void refetch();
  }, [data?.liberado, restanteMs, refetch]);

  const invalidar = () => qc.invalidateQueries({ queryKey: [ROTA] });

  const liberar = useMutation({
    mutationFn: () => apiRequest("POST", `${ROTA}/liberar`),
    onSuccess: () => {
      setConfirmando(false);
      invalidar();
      toast({
        title: "Acesso liberado",
        description: `O suporte pode entrar pelas próximas ${prazo}. Encerre quando quiser, por esta tela.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Não foi possível liberar o acesso",
        description: err?.message || "Tente de novo em instantes.",
        variant: "destructive",
      });
    },
  });

  const revogar = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${ROTA}/revogar`);
      return (await res.json()) as { revogadas?: number };
    },
    /* A rota devolve QUANTAS janelas fechou, e zero nao e erro: a janela pode
       ter expirado sozinha entre o ultimo tique e o clique. Dizer "encerrado"
       nesse caso creditaria ao provedor uma acao que nao aconteceu. */
    onSuccess: (resposta) => {
      invalidar();
      toast(
        resposta?.revogadas === 0
          ? {
              title: "A porta já estava fechada",
              description: "O prazo tinha acabado sozinho. Ninguém do suporte tem acesso agora.",
            }
          : {
              title: "Acesso encerrado",
              description: "A porta está fechada. A sessão do suporte cai na ação seguinte dele.",
            },
      );
    },
    onError: (err: any) => {
      toast({
        title: "Não foi possível encerrar o acesso",
        description: err?.message || "Tente de novo — a porta continua aberta até isto dar certo.",
        variant: "destructive",
      });
    },
  });

  const trabalhando = liberar.isPending || revogar.isPending;

  return (
    <div className="space-y-4" data-testid="tab-content-suporte">
      {/* Cabecalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <LadrilhoIcone
            Icone={fase === "fechado" ? Lock : Unlock}
            /* `risco` porque o tom diz o que ha atras do icone, e o que ha atras
               de uma porta aberta e alguem de fora do seu provedor dentro da
               conta. O ladrilho `marca` prometeria um caminho a seguir; aqui nao
               ha caminho, ha uma decisao com consequencia. */
            tom={fase === "fechado" ? "vazio" : "risco"}
            tamanho="lg"
          />
          <div>
            <h2 className="text-[15px] font-medium tracking-[var(--track-tight)] text-[var(--text)] leading-tight">
              Acesso de suporte
            </h2>
            <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-1 max-w-[62ch]">
              A nossa equipe só entra na sua conta quando você abre a porta — e você fecha
              quando quiser. Enquanto estiver aberta, o suporte age como um administrador seu.
            </p>
          </div>
        </div>
        <SeloDaFase fase={fase} agora={data ? presenteAgora(data, agoraDoServidor) : false} />
      </div>

      {isError && (
        <AvisoNaoCarregou aoTentarDeNovo={() => void refetch()} testId="aviso-acesso-suporte">
          Não foi possível ler o estado do acesso de suporte. Sem ele, esta tela não pode
          afirmar se a porta está aberta ou fechada.
        </AvisoNaoCarregou>
      )}

      {isLoading ? (
        <Card className="p-4">
          <LinhasSkeleton linhas={2} />
        </Card>
      ) : fase === "fechado" ? (
        <BlocoFechado
          prazo={prazo}
          podeEditar={podeEditar}
          trabalhando={trabalhando}
          aoLiberar={() => setConfirmando(true)}
        />
      ) : (
        <BlocoAberto
          estado={data!}
          restanteMs={restanteMs}
          agoraDoServidor={agoraDoServidor}
          podeEditar={podeEditar}
          revogando={revogar.isPending}
          aoEncerrar={() => revogar.mutate()}
        />
      )}

      {/* O escopo fica visivel nos DOIS estados. Antes de abrir ele e o
          consentimento; depois de aberta a porta, e a resposta a pergunta que o
          provedor faz olhando para a faixa vermelha — "o que exatamente essa
          pessoa esta vendo agora?". */}
      <Card className="p-4">
        <KickerSecao>o que o suporte pode fazer</KickerSecao>
        <ListaDeEscopo />
      </Card>

      <p className="text-[12px] text-[var(--text-muted)] leading-snug">
        Toda liberação fica registrada: quem autorizou, quando, quem entrou e por quanto
        tempo ficou. O registro não é apagado quando a janela fecha.
      </p>

      {!podeEditar && (
        <p className="text-[12px] text-[var(--text-muted)]" data-testid="text-suporte-somente-leitura">
          Só o administrador do provedor abre e fecha esta porta.
        </p>
      )}

      {confirmando && (
        <ModalDeConfirmacao
          prazo={prazo}
          liberando={liberar.isPending}
          aoConfirmar={() => liberar.mutate()}
          aoFechar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Selo da fase                                                        */
/* ------------------------------------------------------------------ */

/** A escalada e proposital: `neutro` quando nao ha nada aberto, `gated` quando
 *  ha uma porta aberta que ninguem cruzou ou que ninguem esta usando neste
 *  momento, `danger` so quando ha alguem trabalhando la dentro. Saturacao
 *  somente quando significa risco. */
function SeloDaFase({ fase, agora }: { fase: FaseDoAcesso; agora: boolean }) {
  if (fase === "fechado") {
    return <Selo tom="neutro" Icone={Lock} testId="selo-acesso-suporte">acesso fechado</Selo>;
  }
  if (fase === "conectado" && agora) {
    return <Selo tom="danger" Icone={Headset} testId="selo-acesso-suporte">suporte conectado</Selo>;
  }
  if (fase === "conectado") {
    return <Selo tom="gated" Icone={Headset} testId="selo-acesso-suporte">suporte entrou</Selo>;
  }
  return <Selo tom="gated" Icone={Unlock} testId="selo-acesso-suporte">acesso liberado</Selo>;
}

/* ------------------------------------------------------------------ */
/* Porta fechada                                                       */
/* ------------------------------------------------------------------ */

function BlocoFechado({
  prazo,
  podeEditar,
  trabalhando,
  aoLiberar,
}: {
  prazo: string;
  podeEditar: boolean;
  trabalhando: boolean;
  aoLiberar: () => void;
}) {
  return (
    <Card className="p-4" data-testid="bloco-acesso-fechado">
      <p className={TITULO_CARTAO}>Ninguém do suporte tem acesso à sua conta.</p>
      <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-1 max-w-[70ch]">
        Ao liberar, a porta fica aberta por <strong className="font-medium text-[var(--text-2)]">{prazo}</strong> e
        fecha sozinha no fim do prazo. Você pode encerrar antes, a qualquer momento, por
        esta mesma tela.
      </p>
      {podeEditar && (
        <button
          type="button"
          className={cn(BOTAO_MARCA, DESABILITAVEL, "mt-3.5")}
          onClick={aoLiberar}
          disabled={trabalhando}
          data-testid="button-liberar-acesso-suporte"
        >
          <Unlock className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
          Liberar acesso por {prazo}
        </button>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Porta aberta                                                        */
/* ------------------------------------------------------------------ */

function BlocoAberto({
  estado,
  restanteMs,
  agoraDoServidor,
  podeEditar,
  revogando,
  aoEncerrar,
}: {
  estado: EstadoDoAcessoDeSuporte;
  restanteMs: number;
  agoraDoServidor: number;
  podeEditar: boolean;
  revogando: boolean;
  aoEncerrar: () => void;
}) {
  const entrou = jaEntrou(estado);
  const agora = entrou && presenteAgora(estado, agoraDoServidor);
  const fim = horaDoRelogio(estado.expiraEm, agoraDoServidor);
  const entrada = horaDoRelogio(estado.primeiroUsoEm, agoraDoServidor);
  const ultimaAcao = tempoDesde(estado.ultimoUsoEm, agoraDoServidor);

  return (
    <Card
      className={cn(
        "p-4 border",
        agora
          ? "border-[var(--danger-border)] bg-[var(--danger-bg)]"
          : "border-[var(--gated-border)] bg-[var(--gated-bg)]",
      )}
      data-testid="bloco-acesso-aberto"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {/* `aria-live` fica na FRASE, nunca no relogio: um contador de segundos
              dentro de uma regiao viva faz o leitor de tela falar por cima de
              tudo o que o provedor tenta ler. A frase muda tres vezes na vida da
              janela, e sao exatamente as tres que ele precisa ouvir. */}
          <p
            className={cn(TITULO_CARTAO, agora ? "text-[var(--danger)]" : "text-[var(--gated)]")}
            aria-live="polite"
            data-testid="text-estado-acesso-suporte"
          >
            {agora
              ? "O suporte está na sua conta agora."
              : entrou
                ? "O suporte entrou nesta liberação e ainda tem acesso."
                : "Acesso liberado. Ninguém do suporte entrou até agora."}
          </p>
          <p className="text-[12px] text-[var(--text-2)] leading-snug mt-1 max-w-[70ch]">
            {agora
              ? "Enquanto esta janela estiver aberta, essa pessoa faz na sua conta tudo que um administrador seu faz."
              : entrou
                ? "A porta continua aberta até o fim do prazo, e o suporte pode voltar a qualquer momento dentro dele."
                : "A porta continua aberta até o fim do prazo, mesmo com ninguém dentro."}
          </p>
        </div>

        {podeEditar && (
          <button
            type="button"
            className={cn(BOTAO_ENCERRAR, ALVO_CONTROLE)}
            onClick={aoEncerrar}
            disabled={revogando}
            data-testid="button-encerrar-acesso-suporte"
          >
            {revogando ? (
              <Loader2 className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Lock className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
            )}
            Encerrar agora
          </button>
        )}
      </div>

      <div className="flex items-end gap-6 flex-wrap mt-4 pt-3.5 border-t border-[var(--border)]">
        <div>
          <RotuloCampo>fecha em</RotuloCampo>
          {/* Numero, entao mono tabular (secao 2). Largura fixa para o bloco nao
              pular a cada segundo. */}
          <p
            className="font-mono text-[21px] font-medium tracking-[-0.02em] tabular-nums text-[var(--text)] leading-none"
            role="timer"
            data-testid="text-contagem-acesso-suporte"
          >
            {formatarRestante(restanteMs)}
          </p>
        </div>
        {fim && (
          <div>
            <RotuloCampo>vale até</RotuloCampo>
            <p className="font-mono text-[13px] tabular-nums text-[var(--text-2)] leading-none pb-1">
              {fim}
            </p>
          </div>
        )}
        {entrou && entrada && (
          <div>
            <RotuloCampo>o suporte entrou</RotuloCampo>
            <p
              className="font-mono text-[13px] tabular-nums text-[var(--text-2)] leading-none pb-1"
              data-testid="text-entrada-acesso-suporte"
            >
              {entrada}
              {ultimaAcao && (
                <span className="font-sans text-[12px] text-[var(--text-muted)]">
                  {" · última ação "}
                  {ultimaAcao}
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {podeEditar && (
        <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-3 flex items-start gap-1.5">
          <Clock className="w-3.5 h-3.5 mt-px flex-none" strokeWidth={2} aria-hidden />
          <span>
            Ao encerrar, a sessão do suporte cai na ação seguinte dele — ele deixa de
            enxergar a sua conta na hora.
          </span>
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmacao                                                         */
/* ------------------------------------------------------------------ */

/**
 * A confirmacao repete o escopo em vez de perguntar "tem certeza?".
 *
 * "Tem certeza?" nao informa nada: quem chegou ate aqui ja decidiu clicar, e a
 * caixa vira um passo a ser fechado no automatico. O que faz diferenca e ela
 * dizer, em uma frase, as duas coisas que o provedor pode nao ter lido — o dado
 * pessoal dos clientes dele e o credito que sai do saldo dele.
 */
function ModalDeConfirmacao({
  prazo,
  liberando,
  aoConfirmar,
  aoFechar,
}: {
  prazo: string;
  liberando: boolean;
  aoConfirmar: () => void;
  aoFechar: () => void;
}) {
  return (
    <MolduraModal rotulo="Liberar acesso de suporte" onFechar={aoFechar}>
      <h3 className={TITULO_MODAL}>
        <Unlock className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} aria-hidden />
        Liberar acesso de suporte
      </h3>
      <p className="text-[12.5px] text-[var(--text-2)] leading-snug mt-3">
        Pelas próximas <strong className="font-medium text-[var(--text)]">{prazo}</strong>, a
        equipe de suporte entra na sua conta com os poderes de um administrador seu.
      </p>
      <p className="text-[12.5px] text-[var(--text-2)] leading-snug mt-2">
        Ela vê o cadastro completo dos seus clientes — nome, CPF/CNPJ, endereço e telefone —
        e as consultas que fizer saem do seu saldo de créditos.
      </p>
      <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-2">
        A porta fecha sozinha no fim do prazo, e você pode encerrar antes a qualquer momento.
      </p>
      <div className="flex items-center justify-end gap-2 mt-5">
        <button
          type="button"
          className={cn(BOTAO_SECUNDARIO, DESABILITAVEL)}
          onClick={aoFechar}
          disabled={liberando}
          data-testid="button-cancelar-liberacao"
        >
          Cancelar
        </button>
        <button
          type="button"
          className={cn(BOTAO_MARCA, DESABILITAVEL)}
          onClick={aoConfirmar}
          disabled={liberando}
          data-testid="button-confirmar-liberacao"
        >
          {liberando && (
            <Loader2 className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
          )}
          Liberar por {prazo}
        </button>
      </div>
    </MolduraModal>
  );
}

/* ------------------------------------------------------------------ *
 * CONTRATO CONSUMIDO — server/routes/suporte-acesso.routes.ts
 *
 * GET  /api/provider/acesso-suporte           -> EstadoDoAcessoDeSuporte
 * POST /api/provider/acesso-suporte/liberar   -> abre a janela (duracao padrao)
 * POST /api/provider/acesso-suporte/revogar   -> { ...estado, revogadas: number }
 *
 * A escrita exige admin do provedor E sessao que nao seja de suporte: o
 * superadmin conectado nao renova nem encerra a propria janela. Por isso
 * `podeEditar` chega como `role === "admin"` de quem monta a aba — e a leitura
 * segue liberada para ele, que precisa ver o estado.
 * ------------------------------------------------------------------ */
