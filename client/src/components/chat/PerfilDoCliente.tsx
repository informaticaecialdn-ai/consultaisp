/**
 * Ficha lateral do atendimento: quem é o cliente, o que deve, como está a
 * conexão, o que há para pagar. Só apresentação — o dado vem inteiro de
 * `/api/chat-bullq/atendimentos/:id/contexto` e da rota do detalhe.
 *
 * Pele do DESIGN_SYSTEM v5: selo retangular (`SeloCobranca`), mono tabular em
 * todo número, ação em `--brand`, ausência de dado como traço, skeleton em vez
 * de "Carregando". `--past` aqui só pinta dívida — nunca botão nem avatar.
 */
import type { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import { Box, RefreshCw } from "lucide-react";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ALVO_CONTROLE,
  ALVO_TEXTO,
  BOTAO_SECUNDARIO,
  CAIXA_ICONE,
  DESABILITAVEL,
  FOCO,
} from "@/components/painel/ui";
import {
  SeloCobranca,
  SeloQuadrante,
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
    <div className="flex justify-between gap-4 border-b border-[var(--border-faint)] py-2 text-xs">
      <dt className="shrink-0 text-[var(--text-muted)]">{titulo}</dt>
      <dd
        className={cn("break-words text-right font-medium", mono && NUM_CHAT)}
      >
        {children ?? <Traco />}
      </dd>
    </div>
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

export function PerfilDoCliente({
  dados,
  contexto,
  carregando,
  erro,
  atualizar,
  pagamento,
}: {
  dados: DetalheChat;
  contexto?: ContextoDoChat;
  carregando: boolean;
  erro: boolean;
  atualizar: () => void;
  pagamento: (ref?: string) => void;
}) {
  const p = contexto?.cliente;
  const c = dados.cobranca;
  const nome = p?.nome ?? dados.cliente?.nome ?? "Cliente";
  const risco = RISCO[p?.risco ?? ""];
  const contrato = CONTRATO[p?.statusContrato ?? ""];
  const consultando = useSkeletonAtrasado(carregando);
  const telefone = p?.telefone ?? dados.cliente?.telefone ?? null;
  // O caso guarda o valor e o atraso com que foi aberto: é leitura, não chute.
  const divida = p?.divida ?? c?.valor ?? null;
  const atraso = p?.diasAtraso ?? c?.diasAtraso ?? null;
  const score = p?.ispScore ?? null;
  const faixa = score !== null ? faixaDoScore(score) : null;
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
      <div className="space-y-3 border-b border-[var(--border)] pb-4">
        <div className="flex items-start gap-3">
          <AvatarChat nome={nome} className="h-12 w-12 text-lg" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold uppercase leading-5">
              {nome}
            </h3>
            {p?.documento ? (
              <p className={cn("mt-1 text-[11px] text-[var(--text-muted)]", NUM_CHAT)}>
                {p.documento}
              </p>
            ) : consultando ? (
              <Skeleton className="mt-1 h-3 w-28" />
            ) : (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                <Traco titulo="Documento não informado nesta leitura" />
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={carregando}
            onClick={atualizar}
            aria-label="Atualizar dados do cliente no ERP"
            className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, DESABILITAVEL)}
          >
            <RefreshCw
              aria-hidden
              className={`h-3.5 w-3.5 ${carregando ? "motion-safe:animate-spin" : ""}`}
            />
          </button>
        </div>
        <p className="text-xs">
          <strong>{p?.plano ?? "Plano não informado"}</strong>
          {p?.mensalidade != null && (
            <>
              {" "}
              · <span className={NUM_CHAT}>{dinheiroChat(p.mensalidade)}</span>/mês
            </>
          )}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          Tel.{" "}
          <span className={NUM_CHAT}>
            {telefone ?? <Traco titulo={MOTIVO_SEM_TELEFONE} />}
          </span>{" "}
          · Cliente desde{" "}
          <strong className={NUM_CHAT}>
            {mesAno(p?.clienteDesde) ?? <Traco titulo={MOTIVO_SEM_INICIO} />}
          </strong>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {c && (
            <span
              className="inline-flex items-center gap-1.5"
              title="Quadrante do DNA de pagamento"
            >
              <SeloQuadrante quadrante={c.quadrante} />
              <span className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">
                DNA
              </span>
            </span>
          )}
          {risco && (
            <SeloCobranca tom={risco.tom} titulo="Risco calculado na consulta">
              {risco.rotulo}
            </SeloCobranca>
          )}
        </div>
        {(erro || contexto?.erp.mensagem) && (
          <p role="status" className="text-[11px] text-[var(--gated)]">
            {erro
              ? "Não foi possível atualizar a ficha. Tente novamente."
              : contexto?.erp.mensagem}
          </p>
        )}
      </div>
      <dl className="py-3" aria-label="Dados do cliente">
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
        <Linha titulo="Cidade">
          {[p?.cidade ?? dados.cliente?.cidade, p?.uf]
            .filter(Boolean)
            .join(" / ") || null}
        </Linha>
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
      {/* CONEXÃO — o MESMO bloco do Cliente 360, não uma segunda versão dele. */}
      <div className="border-b border-[var(--border)] py-4">
        <BlocoConexao
          denso
          nivel="h4"
          conexoes={contexto?.conexoes ?? []}
          inventario={inventario}
          origem={origemDaConexao}
          statusContrato={p?.statusContrato}
          testId="chat-bloco-conexao"
          rodape={
            dados.equipamentos.length ? (
              <ul className="mt-3 space-y-1.5" aria-label="Inventário do cliente">
                {dados.equipamentos.map((e) => (
                  <li key={e.id} className="text-[11px]">
                    <p>{[e.tipo, e.marca, e.modelo].filter(Boolean).join(" ")}</p>
                    <p
                      className={cn(
                        "break-all text-[10px] text-[var(--text-muted)]",
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
            )
          }
        />
      </div>
      <section className="space-y-2 border-b border-[var(--border)] py-4">
        <h4 className="flex items-center gap-2 text-xs font-semibold">
          <Box aria-hidden className="h-3.5 w-3.5" /> Ordens em aberto
        </h4>
        {contexto?.ordens.length ? (
          contexto.ordens.map((o) => (
            <Link
              key={o.id}
              href={`/recuperacao?caso=${o.id}`}
              className={cn(LINK_CHAT, "block text-xs")}
            >
              Retirada <span className={NUM_CHAT}>#{o.id}</span> ·{" "}
              {o.status.replaceAll("_", " ")}
              {o.agendadoEm && (
                <>
                  {" "}
                  ·{" "}
                  <span className={NUM_CHAT}>
                    {new Date(o.agendadoEm).toLocaleDateString("pt-BR")}
                  </span>
                </>
              )}{" "}
              →
            </Link>
          ))
        ) : (
          <AguardeOuAviso
            consultando={consultando}
            aviso="Nenhuma ordem de retirada aberta."
          />
        )}
        <p className="text-[10px] text-[var(--text-muted)]">
          Ordens técnicas do ERP não disponíveis nesta integração.
        </p>
      </section>
      <dl className="grid grid-cols-2 divide-x divide-[var(--border)] border-b border-[var(--border)] py-4 text-center">
        {metricas.map((m) => (
          <div key={m.k} className="py-3">
            <dt className="font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
              {m.k}
            </dt>
            <dd
              className={cn("mt-2 text-sm font-medium", NUM_CHAT, m.v != null && m.cor)}
              style={m.v == null ? undefined : m.style}
            >
              {m.v ?? <Traco titulo={m.motivo} />}
            </dd>
          </div>
        ))}
      </dl>
      <section className="space-y-3 py-4">
        <h4 className="text-xs font-semibold">Faturas · PIX e segunda via</h4>
        {contexto?.faturas.map((f) => (
          <div
            key={`${f.fonte}-${f.ref}`}
            className="border-b border-[var(--border-faint)] pb-3 text-xs"
          >
            <p className={cn("flex justify-between gap-2", NUM_CHAT)}>
              <strong>{dinheiroChat(f.valor)}</strong>
              <span>
                {dataBr(f.vencimento) ?? (
                  <Traco titulo={MOTIVO_SEM_VENCIMENTO} />
                )}
              </span>
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {f.descricao || `Fatura ${f.ref}`}
            </p>
            <button
              type="button"
              onClick={() => pagamento(f.ref)}
              className={cn(LINK_CHAT, "mt-1")}
            >
              PIX / 2ª via →
            </button>
          </div>
        ))}
        {!contexto?.faturas.length && (
          <AguardeOuAviso
            consultando={consultando}
            aviso="Nenhuma fatura aberta disponível nesta leitura."
          />
        )}
        {contexto?.temMaisFaturas && (
          <p className="text-[10px]">
            Exibindo as <span className={NUM_CHAT}>50</span> faturas mais
            antigas.
          </p>
        )}
        {!!contexto?.faturasSemData && (
          <p className="text-[10px] text-[var(--text-muted)]">
            <span className={NUM_CHAT}>{contexto.faturasSemData}</span> sem
            vencimento legível no ERP — exibidas ao fim, fora da ordem.
          </p>
        )}
      </section>
      {c && (
        <p className="border-t border-[var(--border)] py-3 text-[11px] text-[var(--text-muted)]">
          <strong>Abordagem:</strong> {c.orientacao.diretiva}
        </p>
      )}
      {contexto && (
        <p className="pb-3 text-[10px] text-[var(--text-faint)]">
          {contexto.erp.fonte?.toUpperCase() ?? "Cadastro local"} · consulta{" "}
          <span className={NUM_CHAT}>
            {new Date(contexto.erp.atualizadoEm).toLocaleString("pt-BR")}
          </span>
        </p>
      )}
    </>
  );
}
