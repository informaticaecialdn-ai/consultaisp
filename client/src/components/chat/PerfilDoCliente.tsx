/**
 * Ficha lateral do atendimento — a terceira coluna da tela de Conversas, no
 * desenho do painel do cliente do Provedor.ai: um topo com o ladrilho das
 * iniciais, nome, documento, a linha de plano · telefone · tempo de casa ·
 * cidade e os selos; depois os dados básicos em linhas, a conexão, as ordens em
 * aberto, a grade 2×2 de indicadores, a negociação, as faturas com PIX e 2ª via,
 * os equipamentos, a abordagem e o atalho para o Cliente 360 completo.
 *
 * Só apresentação — o dado vem inteiro de
 * `/api/chat-bullq/atendimentos/:id/contexto` e da rota do detalhe.
 *
 * Pele do DESIGN_SYSTEM v5: selo retangular (`SeloCobranca`), mono tabular em
 * todo número, ação em `--brand`, ausência de dado como traço, skeleton em vez
 * de "Carregando". O topo é `--brand-soft` chapado (a referência usa gradiente,
 * que o sistema proíbe) e o ladrilho tem 8px de raio (a referência usa 14px) e
 * fica em `--surface` com as iniciais em `--brand-ink` (a referência o enche
 * de marca; aqui a marca cheia é ação e não pinta pessoa, como no AvatarChat).
 * `--past` aqui só pinta dívida — nunca botão nem avatar.
 *
 * O PIX copia e cola nunca sai do cache da ficha: o botão de copiar relê a
 * fatura no ERP (a mesma rota da 2ª via, que recusa a fatura que saiu das
 * pendências) e só então copia.
 */
import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  Check,
  Compass,
  Copy,
  ExternalLink,
  FileText,
  Handshake,
  Loader2,
  Package,
  Receipt,
  RefreshCw,
  Router,
} from "lucide-react";
import type { ContextoDoChat, FaturaDoChat } from "@shared/cobranca/contexto-chat";
import type { PagamentoDoChat } from "@shared/cobranca/pagamento-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  ALVO_CONTROLE,
  ALVO_TEXTO,
  BOTAO_SECUNDARIO,
  CAIXA_ICONE,
  DESABILITAVEL,
  FOCO,
  type Icone,
} from "@/components/painel/ui";
import {
  mensagemDoErro,
  SeloCobranca,
  Traco,
  useSkeletonAtrasado,
  type TomDeSelo,
} from "@/components/cobranca/ui";
import {
  BlocoConexao,
  formatarMac,
  origemDoDado,
  type ItemDeInventario,
} from "@/components/cobranca/IdentificacaoTecnica";
import { faixaDoScore } from "@/components/cobranca/formatacao";
import { useAuth } from "@/lib/auth";
import { iniciaisDoLadrilho, situacaoDaFatura, tempoDeCliente } from "./conversa";
import type { DetalheChat } from "./tipos";

/* ── Por que cada ausência é um traço, e o que ela significa ──────────── */

export const MOTIVO_SEM_DIVIDA =
  "Nem o ERP nem a base sincronizada informaram valor em aberto nesta consulta";
export const MOTIVO_SEM_ATRASO =
  "Nem o ERP nem a base sincronizada informaram dias de atraso nesta consulta";
/** O motor de score roda na CONSULTA e grava em `isp_consultations`; a coluna do cliente nasce com o default 100, que o servidor devolve como nulo. */
export const MOTIVO_SEM_SCORE =
  "Sem score ISP calculado para este cliente — quem calcula é a consulta na rede";
export const MOTIVO_SEM_PROPENSAO =
  "Propensão a pagar é um modelo a criar — nada inventado";
export const MOTIVO_SEM_INICIO =
  "O ERP não informou desde quando o cliente tem contrato";
export const MOTIVO_SEM_TELEFONE =
  "Nenhum telefone no cadastro nem na leitura do ERP";
export const MOTIVO_SEM_MAC = "O ERP não devolveu o MAC nesta consulta";
export const MOTIVO_SEM_SERIE = "Sem número de série registrado";
export const MOTIVO_SEM_VENCIMENTO =
  "O ERP devolveu esta fatura sem uma data de vencimento legível";

/* ── Primitivas do chat ───────────────────────────────────────────────── */

/** Botão de marca do chat: `--brand` com `--text-on-brand` (o token vira no
 *  escuro, `text-white` não), alvo de toque e anel de foco. */
export const BOTAO_CHAT_MARCA = `inline-flex items-center justify-center gap-1.5 ${ALVO_CONTROLE} px-3 py-2 rounded bg-[var(--brand)] text-[var(--text-on-brand)] text-[12.5px] font-medium hover:opacity-90 ${FOCO} ${DESABILITAVEL} motion-safe:transition-opacity active:scale-[0.97]`;

/** Link com cara de texto: alvo no dedo e anel de foco. */
export const LINK_CHAT = `${ALVO_TEXTO} rounded text-[var(--brand)] font-semibold ${FOCO}`;

/** Todo número do chat sai assim — valor, data, telefone, contagem. */
export const NUM_CHAT = "font-mono tabular-nums";

export const dinheiroChat = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const iniciaisChat = (nome: string) =>
  nome
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

/** Pessoa: círculo, como a seção 5.1 autoriza para avatar. Neutro — cor de
 *  marca é ação e `--past` é dívida; nenhuma das duas descreve uma pessoa. */
export function AvatarChat({
  nome,
  className,
}: {
  nome: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-inset)] font-semibold text-[var(--text-2)]", // avatar
        className,
      )}
    >
      {iniciaisChat(nome)}
    </span>
  );
}

const CONTRATO: Record<string, { rotulo: string; tom: TomDeSelo }> = {
  active: { rotulo: "Ativo", tom: "ok" },
  suspended: { rotulo: "Suspenso", tom: "gated" },
  cancelled: { rotulo: "Cancelado", tom: "past" },
  inactive: { rotulo: "Inativo", tom: "neutro" },
};
const RISCO: Record<string, { rotulo: string; tom: TomDeSelo }> = {
  low: { rotulo: "Baixo risco", tom: "ok" },
  medium: { rotulo: "Atenção", tom: "gated" },
  high: { rotulo: "Risco alto", tom: "danger" },
  critical: { rotulo: "Risco crítico", tom: "danger" },
};
/** Null quando não há data legível — quem decide como mostrar a ausência é a tela, com o motivo. */
const mesAno = (s?: string | null): string | null => {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
};
/** O servidor manda AAAA-MM-DD; o que não estiver nesse formato não vira data inventada. */
const dataBr = (iso: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : null;

/** O `.conv-mini` da referência: botão de ícone da ficha, 26px na mesa e alvo de dedo no toque. */
const BOTAO_MINI = cn(
  "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] motion-safe:transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
  FOCO,
  DESABILITAVEL,
);

/**
 * O quadrante do DNA no topo da ficha, na pílula escura da referência
 * ("● B2 · quadrante DNA"): o selo retangular do sistema com fundo --text e tinta
 * --surface — contraste alto nos dois temas, raio de 4px, e o ponto é um caractere,
 * não um círculo desenhado. Sem quadrante, o selo neutro com o traço e o motivo.
 */
export function PilulaDoQuadrante({ quadrante, diretiva }: { quadrante: string | null | undefined; diretiva?: string | null }) {
  if (!quadrante)
    return (
      <SeloCobranca tom="neutro" titulo="Sem DNA: o ERP não informou a data do contrato" testId="chat-perfil-quadrante">
        <Traco /> · quadrante DNA
      </SeloCobranca>
    );
  return (
    <SeloCobranca
      tom="neutro"
      titulo={diretiva ? `Quadrante do DNA de pagamento · ${diretiva}` : "Quadrante do DNA de pagamento"}
      className="border-transparent bg-[var(--text)] text-[var(--surface)]"
      testId="chat-perfil-quadrante"
    >
      <span aria-hidden className="text-[8px] leading-none">●</span>
      <span>{quadrante}</span> · quadrante DNA
    </SeloCobranca>
  );
}

/** Uma linha de dado: chave à esquerda, valor à direita, filete fraco embaixo. */
function Linha({
  titulo,
  mono,
  children,
}: {
  titulo: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border-faint)] py-[7px] text-[12.5px]">
      <dt className="shrink-0 font-medium text-[var(--text-muted)]">{titulo}</dt>
      <dd
        className={cn("min-w-0 break-words text-right font-medium text-[var(--text)]", mono && NUM_CHAT)}
      >
        {children ?? <Traco />}
      </dd>
    </div>
  );
}

/** Um bloco da ficha: título com ícone e filete em cima; sem título, só o respiro. */
function Secao({
  Icone: IconeSecao,
  titulo,
  corIcone,
  testId,
  children,
}: {
  Icone?: Icone;
  titulo?: string;
  corIcone?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("py-3.5", titulo && "border-t border-[var(--border)]")}
      data-testid={testId}
    >
      {titulo && (
        <h4 className="mb-2.5 flex items-center gap-[7px] text-[12.5px] font-semibold text-[var(--text)]">
          {IconeSecao && (
            <IconeSecao
              aria-hidden
              className={cn("h-3.5 w-3.5", corIcone ?? "text-[var(--text-muted)]")}
            />
          )}
          {titulo}
        </h4>
      )}
      {children}
    </section>
  );
}

/** Texto auxiliar de uma seção: skeleton enquanto consulta, frase honesta depois. */
function AguardeOuAviso({
  consultando,
  aviso,
}: {
  consultando: boolean;
  aviso: string;
}) {
  return consultando ? (
    <Skeleton className="h-3 w-3/5" />
  ) : (
    <p className="text-[11px] text-[var(--text-muted)]">{aviso}</p>
  );
}

/** Por quanto tempo o PIX recém-relido vale para o segundo clique, quando o navegador recusou copiar depois da leitura. */
export const VALIDADE_DO_PIX_RELIDO_MS = 60_000;

export const AVISO_PIX_SEM_CODIGO =
  "O ERP não devolveu PIX para esta fatura agora. Abra a 2ª via.";
export const AVISO_PIX_NAO_COPIADO =
  "Não foi possível copiar. Abra a 2ª via para copiar o código.";
export const AVISO_PIX_CLIQUE_DE_NOVO =
  "PIX conferido no ERP agora. Clique de novo para copiar.";

export type PixRelido = { pix: string; em: number };

/**
 * Um clique em "copiar PIX", sem DOM: RELÊ a fatura no ERP e só então escreve.
 * O contexto da ficha fica em cache (60 s, sem releitura no foco), e o PIX de
 * uma fatura paga depois disso não pode ir para o chat. A leitura é a da 2ª via
 * (`POST …/segunda-via`, `forcar` no servidor), que recusa a fatura que saiu
 * das pendências — e a frase do servidor vira o aviso.
 *
 * O navegador só deixa copiar logo depois do clique. Se a leitura demorou e a
 * escrita foi recusada, o código RELIDO volta em `guardar`, e o segundo clique,
 * dentro de um minuto, o copia sem nova leitura — nunca o do cache.
 */
export async function copiarPixRelendo({
  guardado,
  agora,
  ler,
  escrever,
}: {
  guardado: PixRelido | null;
  agora: () => number;
  ler: () => Promise<PagamentoDoChat>;
  escrever: (pix: string) => Promise<void>;
}): Promise<{ copiado: boolean; aviso: string | null; guardar: PixRelido | null }> {
  if (guardado && agora() - guardado.em < VALIDADE_DO_PIX_RELIDO_MS) {
    try {
      await escrever(guardado.pix);
      return { copiado: true, aviso: null, guardar: null };
    } catch {
      return { copiado: false, aviso: AVISO_PIX_NAO_COPIADO, guardar: null };
    }
  }
  let pagamento: PagamentoDoChat;
  try {
    pagamento = await ler();
  } catch (erro) {
    return { copiado: false, aviso: mensagemDoErro(erro), guardar: null };
  }
  if (!pagamento.pix) return { copiado: false, aviso: AVISO_PIX_SEM_CODIGO, guardar: null };
  try {
    await escrever(pagamento.pix);
    return { copiado: true, aviso: null, guardar: null };
  } catch {
    return { copiado: false, aviso: AVISO_PIX_CLIQUE_DE_NOVO, guardar: { pix: pagamento.pix, em: agora() } };
  }
}

/** O botão de copiar PIX da fatura: relê no ERP (`copiarPixRelendo`), mostra a leitura e o ✓ por 1,8 s. */
function CopiarPix({
  urlDaSegundaVia,
  fatura,
  onAviso,
}: {
  urlDaSegundaVia: string;
  fatura: string;
  onAviso: (aviso: string | null) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const relido = useRef<PixRelido | null>(null);
  const leitura = useMutation({
    mutationFn: async (): Promise<PagamentoDoChat> =>
      (await apiRequest("POST", urlDaSegundaVia, { ref: fatura })).json(),
    retry: false,
  });
  const aoClicar = async () => {
    if (leitura.isPending) return;
    onAviso(null);
    const r = await copiarPixRelendo({
      guardado: relido.current,
      agora: Date.now,
      ler: () => leitura.mutateAsync(),
      escrever: (pix) => navigator.clipboard.writeText(pix),
    });
    relido.current = r.guardar;
    onAviso(r.aviso);
    if (r.copiado) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    }
  };
  return (
    <button
      type="button"
      className={BOTAO_MINI}
      aria-label={`Copiar PIX da fatura ${fatura}, conferido no ERP na hora`}
      aria-busy={leitura.isPending}
      title="Copiar PIX copia e cola (relido no ERP antes de copiar)"
      data-testid="chat-perfil-copiar-pix"
      onClick={aoClicar}
    >
      {leitura.isPending ? (
        <Loader2 aria-hidden className="h-[13px] w-[13px] text-[var(--text-muted)] motion-safe:animate-spin" />
      ) : copiado ? (
        <Check aria-hidden className="h-[13px] w-[13px] text-[var(--ok)]" />
      ) : (
        <Copy aria-hidden className="h-[13px] w-[13px] text-[var(--brand)]" />
      )}
    </button>
  );
}

/** Uma fatura da ficha: descrição, situação, vencimento, valor, copiar PIX e 2ª via — e o aviso da cópia embaixo. */
function FaturaDaFicha({
  f,
  pagamento,
  urlDaSegundaVia,
}: {
  f: FaturaDoChat;
  pagamento: (ref?: string) => void;
  urlDaSegundaVia?: string;
}) {
  const [aviso, setAviso] = useState<string | null>(null);
  const situacao = situacaoDaFatura(f.vencimento);
  const rotulo = f.descricao || `Fatura ${f.ref}`;
  return (
    <div className="border-b border-[var(--border-faint)] py-[7px] text-[12.5px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-medium" title={rotulo}>
              {rotulo}
            </span>
            {situacao?.tipo === "atraso" ? (
              <SeloCobranca tom="danger" titulo="Dias desde o vencimento informado pelo ERP">
                {situacao.dias}d atraso
              </SeloCobranca>
            ) : situacao ? (
              <SeloCobranca tom="neutro">a vencer</SeloCobranca>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            venc.{" "}
            <span className={NUM_CHAT}>
              {dataBr(f.vencimento) ?? (
                <Traco titulo={MOTIVO_SEM_VENCIMENTO} />
              )}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <strong className={cn("font-semibold", NUM_CHAT)}>{dinheiroChat(f.valor)}</strong>
          {/* O PIX do cache só diz que o ERP costuma ter um: o que se copia é relido agora. */}
          {f.pagamento?.pix && urlDaSegundaVia && (
            <CopiarPix urlDaSegundaVia={urlDaSegundaVia} fatura={f.ref} onAviso={setAviso} />
          )}
          <button
            type="button"
            onClick={() => pagamento(f.ref)}
            className={BOTAO_MINI}
            aria-label={`PIX / 2ª via da fatura ${f.ref}`}
            title="PIX / 2ª via"
          >
            <FileText aria-hidden className="h-[13px] w-[13px]" />
          </button>
        </div>
      </div>
      {aviso && (
        <p role="status" className="mt-1 text-[11px] text-[var(--text-2)]" data-testid="chat-perfil-aviso-pix">
          {aviso}
        </p>
      )}
    </div>
  );
}

export function PerfilDoCliente({
  dados,
  contexto,
  carregando,
  erro,
  atualizar,
  pagamento,
  propostas,
  linkDo360,
  urlDaSegundaVia,
}: {
  dados: DetalheChat;
  contexto?: ContextoDoChat;
  carregando: boolean;
  erro: boolean;
  atualizar: () => void;
  pagamento: (ref?: string) => void;
  /** As negociações do caso (proposta, aceita, ativa) que a rota do multicanal já devolve. */
  propostas?: ReadonlyArray<{ id: number; rotulo: string }>;
  /** O endereço do Cliente 360 completo, com a carteira da tela. */
  linkDo360?: string;
  /**
   * A rota da 2ª via desta conversa (`POST …/segunda-via?escopo`). Sem ela não
   * há botão de copiar PIX: copiar do cache levaria ao chat o PIX de uma fatura
   * que pode ter sido paga depois da leitura.
   */
  urlDaSegundaVia?: string;
}) {
  const p = contexto?.cliente;
  const c = dados.cobranca;
  const nome = p?.nome ?? dados.cliente?.nome ?? "Cliente";
  const risco = RISCO[p?.risco ?? ""];
  const contrato = CONTRATO[p?.statusContrato ?? ""];
  const consultando = useSkeletonAtrasado(carregando);
  const telefone = p?.telefone ?? dados.cliente?.telefone ?? null;
  const cidade =
    [p?.cidade ?? dados.cliente?.cidade, p?.uf].filter(Boolean).join(" / ") ||
    null;
  const tempoDeCasa = tempoDeCliente(p?.clienteDesde);
  // O caso guarda o valor e o atraso com que foi aberto: é leitura, não chute.
  const divida = p?.divida ?? c?.valor ?? null;
  const atraso = p?.diasAtraso ?? c?.diasAtraso ?? null;
  const score = p?.ispScore ?? null;
  const faixa = score !== null ? faixaDoScore(score) : null;
  // Mesmo sinal da faixa de demonstração: o servidor diz se esta instância é a
  // demo pública. Lá o selo da conexão diz "Dados fictícios", como no 360.
  const { demoMode } = useAuth();
  // A conexão só existe quando o ERP respondeu AGORA: `conexoes` sai da leitura
  // ao vivo, nunca da base. Se ele não respondeu, o selo diz "Base
  // sincronizada" com a data do valor — nunca "dados reais".
  const erpRespondeu = !!contexto && contexto.erp.status !== "indisponivel";
  const origemDaConexao = origemDoDado({
    aoVivo: erpRespondeu,
    erpSource: contexto?.erp.fonte,
    lidoEm: erpRespondeu ? contexto!.erp.atualizadoEm : (contexto?.erp.lidoEm ?? null),
    motivo: contexto ? (contexto.erp.mensagem ?? "o ERP não respondeu nesta consulta") : "ainda não respondeu",
    nota:
      contexto && !contexto.erp.financeiroAoVivo
        ? "Valor em aberto e faturas vêm da varredura, não desta leitura."
        : null,
    demonstracao: demoMode,
  });
  const inventario: ItemDeInventario[] = dados.equipamentos.map((e) => ({
    id: e.id,
    mac: e.mac,
    serial: e.serial,
    rotulo: [e.tipo, e.modelo ?? e.marca].filter(Boolean).join(" ") || `#${e.id}`,
  }));
  const metricas: Array<{
    k: string;
    v: ReactNode;
    motivo: string;
    cor?: string;
    style?: CSSProperties;
  }> = [
    {
      k: "Em aberto",
      v: divida == null ? null : dinheiroChat(divida),
      motivo: MOTIVO_SEM_DIVIDA,
      cor: "text-[var(--past)]",
    },
    {
      k: "Atraso",
      v: atraso == null ? null : `${atraso} dias`,
      motivo: MOTIVO_SEM_ATRASO,
      cor: "text-[var(--gated)]",
    },
    {
      // `customers.isp_score`, não score de bureau. A cor é a faixa do
      // DESIGN_SYSTEM (--score-high/medium/low/critical), a mesma da carteira.
      k: "Score ISP",
      v: score,
      motivo: MOTIVO_SEM_SCORE,
      style: faixa ? { color: faixa.cor } : undefined,
    },
    {
      k: "Propensão",
      v:
        c?.orientacao.propensao == null ? null : `${c.orientacao.propensao}%`,
      motivo: MOTIVO_SEM_PROPENSAO,
    },
  ];
  return (
    <>
      {/* TOPO — ladrilho, nome e documento; a linha de meta; os selos. */}
      <div
        className="bg-[var(--brand-soft)] px-4 pb-3.5 pt-[18px]"
        data-testid="chat-perfil-topo"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-lg bg-[var(--surface)] text-lg font-bold tracking-[0.02em] text-[var(--brand-ink)] shadow-[0_0_0_1px_var(--border)]"
          >
            {iniciaisDoLadrilho(nome)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-[17px] font-semibold leading-tight tracking-[var(--track-tight)] text-[var(--text)]">
              {nome}
            </h3>
            {p?.documento ? (
              <p className={cn("mt-0.5 text-[11.5px] text-[var(--text-muted)]", NUM_CHAT)}>
                {p.documento}
              </p>
            ) : consultando ? (
              <Skeleton className="mt-1 h-3 w-28" />
            ) : (
              <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                <Traco titulo="Documento não informado nesta leitura" />
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={carregando}
            onClick={atualizar}
            aria-label="Atualizar dados do cliente no ERP"
            title="Atualizar do ERP"
            className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, DESABILITAVEL)}
          >
            <RefreshCw
              aria-hidden
              className={`h-3.5 w-3.5 ${carregando ? "motion-safe:animate-spin" : ""}`}
            />
          </button>
        </div>
        {/* A linha de meta da referência: plano · Tel. · Cliente desde · cidade, com o ponto entre os itens. */}
        <p
          className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-[3px] text-[11.5px] text-[var(--text-2)]"
          data-testid="chat-perfil-meta"
        >
          {[
            <span key="plano">
              <strong className="font-semibold text-[var(--text)]">
                {p?.plano ?? "Plano não informado"}
              </strong>
              {p?.mensalidade != null && (
                <>
                  {" "}
                  · <span className={NUM_CHAT}>{dinheiroChat(p.mensalidade)}</span>/mês
                </>
              )}
            </span>,
            <span key="telefone">
              Tel.{" "}
              <span className={NUM_CHAT}>
                {telefone ?? <Traco titulo={MOTIVO_SEM_TELEFONE} />}
              </span>
            </span>,
            <span key="desde">
              Cliente desde{" "}
              <strong className={cn("font-semibold", NUM_CHAT)}>
                {mesAno(p?.clienteDesde) ?? <Traco titulo={MOTIVO_SEM_INICIO} />}
              </strong>
              {tempoDeCasa && <> · <span className={NUM_CHAT}>{tempoDeCasa}</span></>}
            </span>,
            ...(cidade ? [<span key="cidade">{cidade}</span>] : []),
          ].map((item, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span aria-hidden className="text-[var(--text-muted)]">
                  ·
                </span>
              )}
              {item}
            </Fragment>
          ))}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {c && <PilulaDoQuadrante quadrante={c.quadrante} diretiva={c.orientacao.diretiva} />}
          {risco && (
            <SeloCobranca tom={risco.tom} titulo="Risco calculado na consulta">
              {risco.rotulo}
            </SeloCobranca>
          )}
          {c?.tom === "humanizado_vulneravel" && (
            <SeloCobranca tom="gated" titulo="O caso pede tom acolhedor e sem pressão">
              Tom acolhedor
            </SeloCobranca>
          )}
        </div>
        {(erro || contexto?.erp.mensagem) && (
          <p role="status" className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--text-2)]">
            {/* O âmbar vai ao ícone: em texto de 11px sobre --brand-soft ele não passa AA. */}
            <AlertCircle aria-hidden className="mt-px h-3 w-3 shrink-0 text-[var(--gated)]" />
            <span>
              {erro
                ? "Não foi possível atualizar a ficha. Tente novamente."
                : contexto?.erp.mensagem}
            </span>
          </p>
        )}
      </div>
      <div className="px-4 pb-4">
        <Secao>
          <dl aria-label="Dados do cliente">
            <Linha titulo="Plano">
              {p?.plano ?? "Não informado"}
              {p?.mensalidade != null && (
                <>
                  {" "}
                  · <span className={NUM_CHAT}>{dinheiroChat(p.mensalidade)}</span>/mês
                </>
              )}
            </Linha>
            <Linha titulo="Contrato">
              {contrato ? (
                <SeloCobranca tom={contrato.tom} titulo="Situação do contrato no ERP">
                  {contrato.rotulo}
                </SeloCobranca>
              ) : p?.statusContrato ? (
                <SeloCobranca tom="neutro" titulo="Situação do contrato como veio do ERP">
                  {p.statusContrato}
                </SeloCobranca>
              ) : (
                <Traco titulo="O ERP não informou a situação do contrato" />
              )}
            </Linha>
            <Linha titulo="Cliente desde" mono>
              {mesAno(p?.clienteDesde) ?? <Traco titulo={MOTIVO_SEM_INICIO} />}
            </Linha>
            <Linha titulo="Cidade">{cidade}</Linha>
            <Linha titulo="Bairro">{p?.bairro}</Linha>
            <Linha titulo="Endereço">
              {p?.endereco ?? dados.cliente?.endereco}
            </Linha>
            <Linha titulo="Telefone" mono>
              {telefone ?? <Traco titulo={MOTIVO_SEM_TELEFONE} />}
            </Linha>
            <Linha titulo="E-mail">{p?.email}</Linha>
            <Linha titulo="Régua">
              {c?.orientacao.etapa?.rotulo ?? "Sem etapa"}
              {c?.orientacao.etapa && (
                <span
                  className={cn(
                    "block text-[10px] text-[var(--text-muted)]",
                    NUM_CHAT,
                  )}
                >
                  {c.orientacao.etapa.diaMin >= 0 ? "D+" : "D"}
                  {c.orientacao.etapa.diaMin} →{" "}
                  {c.orientacao.etapa.diaMax == null
                    ? "em diante"
                    : `D${c.orientacao.etapa.diaMax >= 0 ? "+" : ""}${c.orientacao.etapa.diaMax}`}
                </span>
              )}
            </Linha>
            <Linha titulo="Pagamentos">
              {contexto?.pagamentos.pagas ? (
                <>
                  <span className={NUM_CHAT}>{contexto.pagamentos.pagas}</span>{" "}
                  pagas ·{" "}
                  {contexto.pagamentos.pontualidade == null ? (
                    "sem datas"
                  ) : (
                    <>
                      <span className={NUM_CHAT}>
                        {contexto.pagamentos.pontualidade}%
                      </span>{" "}
                      no prazo
                    </>
                  )}
                  <span className="block text-[10px] text-[var(--text-muted)]">
                    <span className={NUM_CHAT}>{contexto.pagamentos.comData}</span>{" "}
                    com data de pagamento
                  </span>
                </>
              ) : (
                "Sem histórico confirmado"
              )}
            </Linha>
          </dl>
        </Secao>
        {/* CONEXÃO — o MESMO bloco do Cliente 360, não uma segunda versão dele. */}
        <section className="border-t border-[var(--border)] py-3.5">
          <BlocoConexao
            denso
            nivel="h4"
            conexoes={contexto?.conexoes ?? []}
            inventario={inventario}
            origem={origemDaConexao}
            statusContrato={p?.statusContrato}
            testId="chat-bloco-conexao"
          />
        </section>
        <Secao Icone={Package} titulo="Ordens em aberto">
          {contexto?.ordens.length ? (
            contexto.ordens.map((o) => (
              <Link
                key={o.id}
                href={`/recuperacao?caso=${o.id}`}
                className={cn(
                  ALVO_TEXTO,
                  FOCO,
                  "flex w-full items-center justify-between gap-2 rounded border-b border-[var(--border-faint)] py-1.5 text-[12.5px] hover:bg-[var(--surface-2)]",
                )}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-medium text-[var(--brand)]">
                    Retirada <span className={NUM_CHAT}>#{o.id}</span>
                  </span>
                  <SeloCobranca tom="info">{o.status.replaceAll("_", " ")}</SeloCobranca>
                </span>
                {o.agendadoEm && (
                  <span className={cn("shrink-0 text-[11px] text-[var(--text-muted)]", NUM_CHAT)}>
                    {new Date(o.agendadoEm).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </Link>
            ))
          ) : (
            <AguardeOuAviso
              consultando={consultando}
              aviso="Nenhuma ordem de retirada aberta."
            />
          )}
          <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
            Ordens técnicas do ERP não disponíveis nesta integração.
          </p>
        </Secao>
        {/* INDICADORES — grade 2×2; o fio entre as células é a própria cor da borda. */}
        <dl
          className="my-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[var(--border)] text-center shadow-[0_0_0_1px_var(--border)]"
          aria-label="Indicadores do cliente"
        >
          {metricas.map((m) => (
            <div key={m.k} className="bg-[var(--surface)] px-3 py-[11px]">
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
                {m.k}
              </dt>
              <dd
                className={cn("mt-[5px] text-[17px] font-semibold tracking-[var(--track-tight)]", NUM_CHAT, m.v != null && m.cor)}
                style={m.v == null ? undefined : m.style}
              >
                {m.v ?? <Traco titulo={m.motivo} />}
              </dd>
            </div>
          ))}
        </dl>
        {propostas && propostas.length > 0 && (
          <Secao
            Icone={Handshake}
            titulo="Negociações do caso"
            corIcone="text-[var(--brand)]"
            testId="chat-perfil-negociacoes"
          >
            <ul className="space-y-1.5">
              {propostas.map((proposta) => (
                <li
                  key={proposta.id}
                  className={cn(
                    "rounded-lg bg-[var(--brand-soft)] px-3 py-[11px] text-[13px] font-semibold text-[var(--brand-ink)]",
                    NUM_CHAT,
                  )}
                >
                  {proposta.rotulo}
                </li>
              ))}
            </ul>
          </Secao>
        )}
        <Secao Icone={Receipt} titulo="Faturas em aberto" testId="chat-perfil-faturas">
          {contexto?.faturas.map((f) => (
            <FaturaDaFicha
              key={`${f.fonte}-${f.ref}`}
              f={f}
              pagamento={pagamento}
              urlDaSegundaVia={urlDaSegundaVia}
            />
          ))}
          {!contexto?.faturas.length && (
            <AguardeOuAviso
              consultando={consultando}
              aviso="Nenhuma fatura aberta disponível nesta leitura."
            />
          )}
          {contexto?.temMaisFaturas && (
            <p className="mt-1.5 text-[10px]">
              Exibindo as <span className={NUM_CHAT}>50</span> faturas mais
              antigas.
            </p>
          )}
          {!!contexto?.faturasSemData && (
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
              <span className={NUM_CHAT}>{contexto.faturasSemData}</span> sem
              vencimento legível no ERP — exibidas ao fim, fora da ordem.
            </p>
          )}
        </Secao>
        <Secao Icone={Router} titulo="Equipamentos no cliente" testId="chat-perfil-equipamentos">
          {dados.equipamentos.length ? (
            <ul className="space-y-1.5" aria-label="Inventário do cliente">
              {dados.equipamentos.map((e) => (
                <li key={e.id} className="text-[12.5px] text-[var(--text-2)]">
                  <p>{[e.tipo, e.marca, e.modelo].filter(Boolean).join(" ")}</p>
                  <p
                    className={cn(
                      "break-all text-[11.5px] text-[var(--text-muted)]",
                      NUM_CHAT,
                    )}
                  >
                    Série {e.serial ?? <Traco titulo={MOTIVO_SEM_SERIE} />} · MAC{" "}
                    {formatarMac(e.mac) ?? <Traco titulo={MOTIVO_SEM_MAC} />}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <AguardeOuAviso
              consultando={consultando}
              aviso="Nenhum equipamento no inventário deste cliente."
            />
          )}
        </Secao>
        {c && (
          <Secao Icone={Compass} titulo="Abordagem">
            <p className="text-[11.5px] leading-relaxed text-[var(--text-2)]">
              {c.orientacao.diretiva}
            </p>
          </Secao>
        )}
        {linkDo360 && (
          <Link
            href={linkDo360}
            className={cn(
              ALVO_CONTROLE,
              FOCO,
              "mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded text-[12.5px] font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
            )}
            data-testid="chat-perfil-360"
          >
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            Abrir Cliente 360 completo
          </Link>
        )}
        {contexto && (
          <p className="pt-3 text-[10px] text-[var(--text-faint)]">
            {contexto.erp.fonte?.toUpperCase() ?? "Cadastro local"} · consulta{" "}
            <span className={NUM_CHAT}>
              {new Date(contexto.erp.atualizadoEm).toLocaleString("pt-BR")}
            </span>
          </p>
        )}
      </div>
    </>
  );
}
