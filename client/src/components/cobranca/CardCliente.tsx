/**
 * Um cliente da carteira — o card e a linha da tabela, célula a célula com a
 * mesma regra: dado ausente é "—", nunca zero, nunca chute.
 *
 * O molde é o `.ct-card` da tela "Sua carteira" do Provedor.ai (pedido do
 * dono, 05/09/2026: "faça exatamente igual"): avatar · nome · cidade · plano;
 * chips de situação, DNA e histórico; "Em aberto R$" ou "Situação em dia" com
 * a pílula D+atraso; a barra de saúde; e o rodapé Crédito · Propensão · MRR.
 * O que o nosso sync ainda não traz (plano, MRR, propensão, score de crédito
 * externo) sai como "—" com o motivo no title — igual à regra de ouro deles.
 */
import { ROTULO_CONFIABILIDADE, ROTULO_STATUS_DE_CASO, etapaPorId, ROTULO_MOTIVO_SEM_ETAPA, type Confiabilidade, type Etapa, type EtapaId, type MotivoSemEtapa, type StatusDeCaso } from "@shared/cobranca";
import { cn } from "@/lib/utils";
import { brl, num, TRACO } from "@/components/localizacao/ui";
import { FOCO, Td } from "@/components/painel/ui";
import { faixaDoScore, proximoContato } from "./formatacao";
import type { ItemDaCarteira } from "./tipos";
import { Avatar, BarraDeScore, PilulaAtraso, SeloCobranca, SeloErp, SeloQuadrante, SeloStatusCaso, Traco, type TomDeSelo } from "./ui";

export const MOTIVO_SEM_PLANO = "O sync do ERP não traz o plano — fase 2";
export const MOTIVO_SEM_DOCUMENTO = "O cadastro deste cliente no ERP não tem CPF/CNPJ.";
export const MOTIVO_SEM_MRR = "O sync do ERP não traz o valor do plano (MRR) — fase 2";
export const MOTIVO_SEM_PROPENSAO = "Propensão a pagar é um modelo a criar — nada inventado";
export const MOTIVO_SEM_CREDITO = "Score de crédito externo (bureau) — não consultado para este cliente";

const TOM_DA_CONFIABILIDADE: Record<Confiabilidade, TomDeSelo> = { em_dia: "ok", oscila: "gated", cronico: "past" };

/** "Em dia · Oscila · Crônico" do DNA; sem histórico suficiente, diz isso. */
export function SeloHistorico({ confiabilidade }: { confiabilidade: string | null | undefined }) {
  if (!confiabilidade || !(confiabilidade in ROTULO_CONFIABILIDADE)) {
    return <SeloCobranca tom="neutro" titulo="Sem histórico de pagamento suficiente para o DNA">Sem histórico</SeloCobranca>;
  }
  const c = confiabilidade as Confiabilidade;
  return <SeloCobranca tom={TOM_DA_CONFIABILIDADE[c]} titulo="Confiabilidade do DNA de pagamento">{ROTULO_CONFIABILIDADE[c]}</SeloCobranca>;
}

function rotuloDaEtapa(id: string | null, etapas?: readonly Etapa[]): string | null {
  if (!id) return null;
  return etapaPorId(id as EtapaId, etapas)?.rotulo ?? id;
}

/**
 * A etapa gravada no caso; sem caso, a que a régua daria hoje (a rota a
 * manda em `regua`), marcada como "hoje" para não parecer que há caso.
 */
function etapaDoItem(item: ItemDaCarteira, etapas?: readonly Etapa[]) {
  const gravada = rotuloDaEtapa(item.caso?.etapa ?? null, etapas);
  if (gravada) return gravada;
  if (item.regua?.rotulo) return <span title="Sem caso aberto: é a etapa que a régua dá para o atraso de hoje">{item.regua.rotulo} <span className="text-[var(--text-faint)]">· hoje</span></span>;
  if (item.regua?.motivo) return <span className="text-[var(--text-faint)]">{ROTULO_MOTIVO_SEM_ETAPA[item.regua.motivo as MotivoSemEtapa] ?? item.regua.motivo}</span>;
  return <Traco titulo="Sem caso: sem etapa" />;
}

const MINI = "font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]";
const NUM = "font-mono tabular-nums";

export function CardCliente({ item, etapas, hoje, onAbrir }: {
  item: ItemDaCarteira;
  etapas?: readonly Etapa[];
  hoje: Date;
  onAbrir: () => void;
}) {
  const devendo = item.dividaAtual > 0;
  const score = item.ispScore;
  const faixa = score !== null ? faixaDoScore(score) : null;
  void etapas; void hoje;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
      aria-label={`${item.nome} — abrir cliente 360`}
      data-testid={`card-cliente-${item.customerId}`}
      className={cn(
        "flex cursor-pointer flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-[14px] py-3 text-left hover:border-[var(--border-strong)] hover:shadow-[0_0_0_1px_var(--border-strong)] motion-safe:transition-[border-color,box-shadow]",
        FOCO,
      )}
    >
      {/* topo: avatar + nome + cidade · plano */}
      <div className="flex items-center gap-2.5">
        <Avatar nome={item.nome} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-tight text-[var(--text)]">{item.nome}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
            {item.cidade ?? TRACO} · <span title={MOTIVO_SEM_PLANO}>{item.plano ?? TRACO}</span>
          </p>
        </div>
        <span className={cn(NUM, "text-[11px] text-[var(--text-muted)]")}>{item.documento || <Traco titulo={MOTIVO_SEM_DOCUMENTO} />}</span>
      </div>

      {/* chips: situação + DNA + histórico */}
      <div className="flex flex-wrap gap-1.5">
        <SeloErp status={item.statusErp} />
        <SeloQuadrante quadrante={item.quadrante} />
        <SeloHistorico confiabilidade={item.confiabilidade} />
        {item.caso && <SeloStatusCaso status={item.caso.status} />}
      </div>

      {/* grana: em aberto (vencidas) ou "em dia" + D+atraso */}
      <div className="flex items-baseline gap-2 rounded bg-[var(--surface-2)] px-[11px] py-[9px]">
        <div>
          <p className={MINI}>{devendo ? "em aberto" : "situação"}</p>
          <p className={cn(NUM, "text-[17px] font-semibold tracking-[-0.01em]", devendo ? "text-[var(--money-neg)]" : "text-[var(--ok)]")}>
            {devendo ? <><span className="text-[11px] font-medium text-[var(--text-muted)]">R$ </span>{brl(item.dividaAtual).replace(/^R\$\s?/, "")}</> : "em dia"}
          </p>
        </div>
        {item.diasAtraso > 0 && <span className="ml-auto"><PilulaAtraso dias={item.diasAtraso} /></span>}
      </div>

      {/* saúde: barra + número (null → barra vazia + "—") */}
      <div className="flex items-center gap-2">
        <span className={cn(MINI, "w-[42px]")}>saúde</span>
        <BarraDeScore score={score} cor={faixa?.cor ?? "var(--border-strong)"} />
        <span className={cn(NUM, "w-8 text-right text-[12px] font-medium text-[var(--text)]")} title={faixa ? `Score ISP ${score} — ${faixa.rotulo}` : "Sem score ISP calculado"}>
          {score !== null ? num(score) : TRACO}
        </span>
      </div>

      {/* rodapé: crédito · propensão · MRR */}
      <div className="flex items-center gap-2.5 border-t border-[var(--border-faint)] pt-[9px] text-[11px] text-[var(--text-muted)]">
        <span title={MOTIVO_SEM_CREDITO}>Crédito <b className={cn(NUM, "text-[var(--text)]")}>{TRACO}</b></span>
        <span title={MOTIVO_SEM_PROPENSAO}>Propensão <b className={cn(NUM, "text-[var(--text)]")}>{item.propensao != null ? `${num(item.propensao)}%` : TRACO}</b></span>
        <span className="ml-auto" title={MOTIVO_SEM_MRR}>MRR <b className={cn(NUM, "text-[var(--text)]")}>{item.mrr != null ? brl(item.mrr) : TRACO}</b></span>
      </div>
    </article>
  );
}

/** A mesma leitura em forma de linha — a tabela da visão "Tabela" (colunas do Provedor.ai; Agente virou Responsável, que é o que temos). */
export function LinhaDoCliente({ item, etapas, hoje, onAbrir }: {
  item: ItemDaCarteira;
  etapas?: readonly Etapa[];
  hoje: Date;
  onAbrir: () => void;
}) {
  const score = item.ispScore;
  const faixa = score !== null ? faixaDoScore(score) : null;
  const contato = item.caso ? proximoContato(item.caso.proximoContatoEm, hoje) : null;
  return (
    <tr
      onClick={onAbrir}
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter") onAbrir(); }}
      className={cn("cursor-pointer hover:bg-[var(--surface-2)]", FOCO)}
      data-testid={`linha-cliente-${item.customerId}`}
    >
      <Td>
        <div className="flex items-center gap-2">
          <Avatar nome={item.nome} tamanho="sm" />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-[var(--text)]">{item.nome}</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">{item.cidade ?? TRACO}{item.bairro ? ` · ${item.bairro}` : ""}</p>
          </div>
        </div>
      </Td>
      <Td num alinhamento="esquerda">{item.documento || <Traco titulo={MOTIVO_SEM_DOCUMENTO} />}</Td>
      <Td><span title={MOTIVO_SEM_PLANO}>{item.plano ?? <Traco titulo={MOTIVO_SEM_PLANO} />}</span></Td>
      <Td num>{item.mrr != null ? brl(item.mrr) : <Traco titulo={MOTIVO_SEM_MRR} />}</Td>
      <Td num className={item.dividaAtual > 0 ? "text-[var(--money-neg)]" : "text-[var(--ok)]"}>{item.dividaAtual > 0 ? brl(item.dividaAtual) : "em dia"}</Td>
      <Td alinhamento="direita">{item.diasAtraso > 0 ? <PilulaAtraso dias={item.diasAtraso} /> : <Traco />}</Td>
      <Td><span className="inline-flex flex-wrap gap-1"><SeloQuadrante quadrante={item.quadrante} /><SeloHistorico confiabilidade={item.confiabilidade} /></span></Td>
      <Td>
        <span className="inline-flex w-[88px] items-center gap-2">
          <BarraDeScore score={score} cor={faixa?.cor ?? "var(--border-strong)"} />
          <span className={cn(NUM, "text-[12px]")}>{score !== null ? num(score) : TRACO}</span>
        </span>
      </Td>
      <Td num><Traco titulo={MOTIVO_SEM_CREDITO} /></Td>
      <Td num>{item.propensao != null ? `${num(item.propensao)}%` : <Traco titulo={MOTIVO_SEM_PROPENSAO} />}</Td>
      <Td>{etapaDoItem(item, etapas)}</Td>
      <Td>{item.caso ? (item.caso.responsavel?.nome ?? <span className="text-[var(--text-faint)]">fila geral</span>) : <Traco />}</Td>
      <Td num alinhamento="esquerda" className={contato?.urgencia === "vencido" ? "text-[var(--danger)]" : undefined}>{contato ? contato.texto : <Traco />}</Td>
      <Td>
        <span className="inline-flex flex-wrap gap-1">
          <SeloErp status={item.statusErp} />
          {item.caso && <SeloStatusCaso status={item.caso.status} />}
        </span>
      </Td>
    </tr>
  );
}

/** O rótulo de status do caso, para a tabela e os títulos. */
export function rotuloDoCaso(status: string | null | undefined): string | null {
  if (!status) return null;
  return ROTULO_STATUS_DE_CASO[status as StatusDeCaso] ?? status;
}
