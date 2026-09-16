/**
 * /cobranca/regua — a régua (QUANDO e O QUE fazer) e o DNA 3×3 (COMO falar).
 *
 * Bloco A: os cartões de etapa por carteira, com janela em dias, ação do
 * funcionário, canal, base legal, o RESPONSÁVEL configurado pelo provedor
 * e a contagem de casos vivos desta carteira em cada uma.
 * Ex-cliente não tem aviso de suspensão — não há serviço a suspender.
 * Bloco B: a grade DNA com as contagens e a diretiva por quadrante.
 *
 * A configuração geral é administrada no Painel do Provedor. Esta página
 * não altera as regras ou a pausa de outra carteira.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { carteiraDaNavegacao, caminhoNaCarteira, NOME_DA_CARTEIRA } from "@/components/cobranca/carteiras";
import { NavegacaoCarteiras } from "@/components/cobranca/NavegacaoCarteiras";
import { Pause, Scale, Settings2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DIAS_PRESCRICAO, ETAPAS_PADRAO, etapasDaCarteira, PISO_AVISO_SUSPENSAO_DIAS, PRESCRICAO_ANOS, rotuloDoDia,
  type Etapa, type Quadrante,
} from "@shared/cobranca";
import { brl, num } from "@/components/localizacao/ui";
import { AvisoNaoCarregou, BOTAO_SECUNDARIO, CabecalhoPainel, KickerSecao } from "@/components/painel/ui";
import { CartaoEtapa } from "@/components/cobranca/CartaoEtapa";
import { GradeDna } from "@/components/cobranca/GradeDna";
import { API_DNA, API_EQUIPE, API_REGUA, lerDna, lerEquipe, ROTA_POLITICA, type RespostaDaRegua } from "@/components/cobranca/tipos";
import { mensagemDoErro, useSkeletonAtrasado } from "@/components/cobranca/ui";

const MONO = "font-mono tabular-nums";

export default function ReguaPage() {
  const search = useSearch();
  const [caminho] = useLocation();
  const carteira = carteiraDaNavegacao(caminho, search);
  const [quadrante, setQuadrante] = useState<Quadrante>("B3");

  const { data: regua, isLoading, isError, error, refetch } = useQuery<RespostaDaRegua>({ queryKey: [caminhoNaCarteira(API_REGUA, carteira)], staleTime: 60_000 });
  const { data: dnaCru, isLoading: dnaCarregando } = useQuery<unknown>({ queryKey: [caminhoNaCarteira(API_DNA, carteira)], staleTime: 60_000 });
  const { data: equipeCrua } = useQuery<unknown>({ queryKey: [API_EQUIPE], staleTime: 300_000 });
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const equipe = useMemo(() => lerEquipe(equipeCrua), [equipeCrua]);
  const dna = useMemo(() => lerDna(dnaCru), [dnaCru]);
  const catalogo: readonly Etapa[] = regua?.etapas?.length ? regua.etapas : ETAPAS_PADRAO;
  // A rota já manda a lista de cada carteira; sem ela, a mesma regra roda aqui.
  const etapas = useMemo(() => regua?.porCarteira?.[carteira] ?? etapasDaCarteira(carteira, catalogo), [regua?.porCarteira, carteira, catalogo]);
  const marcasDoEixo = [...new Set(etapas.map(e => e.diaMin))];
  const pausada = regua?.pausada ?? false;
  const pausadaMotivo = regua?.pausadaMotivo ?? null;

  const contagens = useMemo(() => {
    const mapa = new Map<string, { casos: number; valor: number }>();
    for (const c of regua?.contagens ?? []) {
      if (c.carteira !== carteira) continue;
      const chave = c.etapa ?? "sem_etapa";
      const atual = mapa.get(chave) ?? { casos: 0, valor: 0 };
      mapa.set(chave, { casos: atual.casos + c.casos, valor: atual.valor + c.valor });
    }
    return mapa;
  }, [regua?.contagens, carteira]);
  const semEtapa = contagens.get("sem_etapa") ?? null;

  return (
    <div className="flex flex-col gap-5 p-4 lg:p-6" data-testid="cobranca-regua">
      <CabecalhoPainel
        titulo={`Régua e DNA · ${NOME_DA_CARTEIRA[carteira]}`}
        descricao={<>{carteira === "ex_cliente" ? "Recuperação de dívidas de contratos encerrados." : "Acompanhamento de faturas e da relação com clientes ativos."} A <b>régua</b> decide quando falar e o que fazer; o <b>DNA 3×3</b> orienta o tom da conversa.</>}
        testIdTitulo="titulo-regua"
        acoes={
          <>
            <Link href={ROTA_POLITICA} className={BOTAO_SECUNDARIO} data-testid="link-politica"><Settings2 className="h-3.5 w-3.5" aria-hidden /> Configurações do provedor</Link>
          </>
        }
      />
      <NavegacaoCarteiras carteira={carteira} destino={caminho} />

      {pausada && (
        <div className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--text-2)]" data-testid="aviso-regua-pausada">
          <Pause className="h-4 w-4 text-[var(--danger)]" aria-hidden />
          <span><b className="text-[var(--danger)]">Régua pausada pelo provedor:</b> o motor não move casos de etapa. A pausa geral é administrada no Painel do Provedor. {pausadaMotivo ? <>Motivo: <b>{pausadaMotivo}</b>.</> : ""}</span>
        </div>
      )}

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-regua">Não foi possível carregar a régua: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton ? (
        <div className="space-y-3" aria-busy><Skeleton className="h-9 w-[360px] rounded-md" /><div className="flex gap-3">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[260px] w-[240px] flex-none rounded-lg" />)}</div></div>
      ) : (
        <>
          <section data-testid="bloco-regua">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <KickerSecao className="mb-1">A · régua operacional — quando e o que fazer</KickerSecao>
                <p className="text-[12px] text-[var(--text-muted)]">As etapas acompanham os dias de atraso da fatura mais antiga, informados pelo ERP na última sincronização. O lembrete antes do vencimento depende de uma fatura identificada.</p>
              </div>
            </div>

            {carteira === "ativo" && (
              <p className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text-2)]" data-testid="nota-cliente-ativo"><b>Regularizar o pagamento e preservar o contrato.</b> Inclui clientes com serviço suspenso. O atraso não muda a carteira: o encerramento precisa estar confirmado no ERP. A etapa orienta o contato; suspensão, negativação e encerramento exigem avaliação humana.</p>
            )}
            {carteira === "ex_cliente" && (
              <p className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text-2)]" data-testid="nota-ex-cliente"><b>Dívida de contrato encerrado.</b> A régua começa pela conferência dos títulos vencidos e segue para acordo e recuperação. As condições de negociação são as da política de ex-clientes.</p>
            )}

            <div className="flex gap-3 overflow-x-auto pb-2" data-testid="etapas-regua">
              {etapas.map(e => (
                <CartaoEtapa
                  key={e.id}
                  etapa={e}
                  contagem={contagens.get(e.id) ?? (regua?.contagens ? { casos: 0, valor: 0 } : null)}
                  equipe={equipe}
                  podeEditar={false}
                  testId={`etapa-${e.id}`}
                />
              ))}
            </div>

            <div className="mt-1 h-px w-full bg-[var(--border-strong)]" aria-hidden />
            <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-[var(--text-faint)]" aria-hidden>
              {marcasDoEixo.map(d => <span key={d}>{rotuloDoDia(d)}</span>)}
              <span>{rotuloDoDia(DIAS_PRESCRICAO)} prescreve</span>
            </div>

            <div className="mt-3 grid gap-2 text-[12px] text-[var(--text-2)] md:grid-cols-3">
              {carteira === "ativo" && <><p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><b>Pré-aviso (D-7, D-3, D-1)</b> acompanha faturas a vencer quando habilitado no Painel do Provedor. Não abre caso de inadimplência.</p>
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><Scale className="mr-1 inline h-3.5 w-3.5 text-[var(--gated)]" aria-hidden /> <b>Regularização do serviço</b> começa a partir de <span className={MONO}>{rotuloDoDia(PISO_AVISO_SUSPENSAO_DIAS)}</span>, conforme configuração. Entrar nesta etapa não suspende o serviço. O atendente deve conferir a notificação, os prazos e a situação atual antes de qualquer medida.</p></>}
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><Scale className="mr-1 inline h-3.5 w-3.5 text-[var(--danger)]" aria-hidden /> <b>Prescrição:</b> com <span className={MONO}>{PRESCRICAO_ANOS} anos</span> de atraso (CC art. 206 §5º) a dívida não se cobra, não se negativa, não se pressiona. O motor a tira da régua sozinho.{semEtapa ? <> Hoje <b className={MONO}>{num(semEtapa.casos)}</b> casos (<span className={MONO}>{brl(semEtapa.valor)}</span>) estão sem etapa.</> : ""}</p>
            </div>
          </section>

          <section data-testid="bloco-dna">
            <KickerSecao className="mb-1">B · DNA 3×3 — como falar com cada tipo de cliente</KickerSecao>
            <p className="mb-3 text-[12px] text-[var(--text-muted)]">{carteira === "ex_cliente"
              ? "O DNA cruza a duração da relação encerrada com o histórico de pagamentos confirmado durante essa relação. O tempo após o encerramento não aumenta o vínculo, e a idade atual da dívida não muda esse histórico. Sem datas ou histórico suficiente, o DNA fica indisponível."
              : "Fidelidade (tempo de casa) × confiabilidade (histórico) → um de nove quadrantes, cada um com um tom. Sem data de contrato no ERP não há DNA — a tela mostra \"—\" em vez de chutar."} O DNA orienta somente a linguagem; etapa, contato e condições vêm da régua e da política.</p>
            <GradeDna contagens={dna.contagens} carteira={carteira} carregando={dnaCarregando} selecionado={quadrante} onSelecionar={setQuadrante} testId="grade-dna" />
          </section>
        </>
      )}

    </div>
  );
}
