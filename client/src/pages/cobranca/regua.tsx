/**
 * /cobranca/regua — a régua (QUANDO e O QUE fazer) e o DNA 3×3 (COMO falar).
 *
 * Bloco A: os cartões de etapa por carteira, com janela em dias, ação do
 * funcionário, canal, base legal, o RESPONSÁVEL (um usuário do provedor,
 * escolhido pelo admin aqui mesmo) e a contagem de casos vivos em cada uma.
 * Ex-cliente não tem aviso de suspensão — não há serviço a suspender.
 * Bloco B: a grade DNA com as contagens e a diretiva por quadrante.
 *
 * "Pausar régua" é o interruptor geral: grava `pausada` na política, e o
 * motor deixa de mover casos de etapa. A fila continua existindo — pausar a
 * régua não apaga a dívida de ninguém.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { carteiraDaNavegacao, caminhoNaCarteira } from "@/components/cobranca/carteiras";
import { Pause, Play, Scale, Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  DIAS_PRESCRICAO, ETAPAS_PADRAO, etapasDaCarteira, PISO_AVISO_SUSPENSAO_DIAS, PRESCRICAO_ANOS, ROTULO_CARTEIRA, rotuloDoDia,
  type Carteira, type Etapa, type EtapaId, type Quadrante,
} from "@shared/cobranca";
import { brl, num } from "@/components/localizacao/ui";
import { ABA, AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, CabecalhoPainel, Campo, CONTROLE_CAMPO_MULTILINHA, KickerSecao } from "@/components/painel/ui";
import { CartaoEtapa } from "@/components/cobranca/CartaoEtapa";
import { GradeDna } from "@/components/cobranca/GradeDna";
import { podeAdministrarCobranca } from "@/components/cobranca/permissoes";
import { corpoDaPausa, corpoDoPut, editarEtapa, formDaPolitica, lerPolitica, lerRespostaDoPut } from "@/components/cobranca/politica-form";
import { API_DNA, API_EQUIPE, API_POLITICA, API_REGUA, lerDna, lerEquipe, ROTA_POLITICA, type RespostaDaRegua } from "@/components/cobranca/tipos";
import { descricaoDoErro, invalidarCobranca, mensagemDoErro, SeloCobranca, useSkeletonAtrasado } from "@/components/cobranca/ui";

const MARCAS_DO_EIXO = [1, PISO_AVISO_SUSPENSAO_DIAS, 30, 90, 180, 360];
const MONO = "font-mono tabular-nums";

export default function ReguaPage() {
  const { toast } = useToast();
  const { user, personificando } = useAuth();
  const podeAdministrar = podeAdministrarCobranca(user, personificando);
  const search = useSearch();
  const [caminho, navigate] = useLocation();
  const carteira = carteiraDaNavegacao(caminho, search);
  const setCarteira = (valor: Carteira) => navigate(caminhoNaCarteira(caminho, valor));
  const [quadrante, setQuadrante] = useState<Quadrante>("B3");
  const [pausa, setPausa] = useState<{ aberta: boolean; motivo: string }>({ aberta: false, motivo: "" });

  const { data: regua, isLoading, isError, error, refetch } = useQuery<RespostaDaRegua>({ queryKey: [API_REGUA], staleTime: 60_000 });
  const { data: dnaCru, isLoading: dnaCarregando } = useQuery<unknown>({ queryKey: [API_DNA], staleTime: 60_000 });
  const { data: politicaCrua } = useQuery<unknown>({ queryKey: [API_POLITICA], staleTime: 300_000 });
  const { data: equipeCrua } = useQuery<unknown>({ queryKey: [API_EQUIPE], staleTime: 300_000 });
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  // Lida INTEIRA (economia inclusa): todo PUT daqui a reenvia — pausar a
  // régua não pode apagar os custos confirmados na Política.
  const politica = useMemo(() => (politicaCrua === undefined ? null : lerPolitica(politicaCrua)), [politicaCrua]);
  const equipe = useMemo(() => lerEquipe(equipeCrua), [equipeCrua]);
  const dna = useMemo(() => lerDna(dnaCru), [dnaCru]);
  const catalogo: readonly Etapa[] = regua?.etapas?.length ? regua.etapas : ETAPAS_PADRAO;
  // A rota já manda a lista de cada carteira; sem ela, a mesma regra roda aqui.
  const etapas = useMemo(() => regua?.porCarteira?.[carteira] ?? etapasDaCarteira(carteira, catalogo), [regua?.porCarteira, carteira, catalogo]);
  const pausada = regua?.pausada ?? politica?.pausada ?? false;
  const pausadaMotivo = regua?.pausadaMotivo ?? politica?.pausadaMotivo ?? null;

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

  const gravarPolitica = useMutation({
    mutationFn: async (corpo: unknown) => (await apiRequest("PUT", API_POLITICA, corpo)).json(),
    onSuccess: resposta => {
      invalidarCobranca();
      const { ajustes } = lerRespostaDoPut(resposta);
      toast({ title: "Política gravada", description: ajustes.length ? ajustes.join(" ") : undefined });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível gravar", description: descricaoDoErro(erro), variant: "destructive" }),
  });

  const mudarResponsavel = (id: EtapaId, userId: number | null) => {
    if (!politica) return;
    const form = formDaPolitica(politica);
    form.etapas = editarEtapa(form.etapas, id, { responsavelUserId: userId });
    gravarPolitica.mutate(corpoDoPut(form, politica));
  };

  const alternarPausa = () => {
    if (!politica) return;
    gravarPolitica.mutate(corpoDaPausa(politica, !pausada, pausa.motivo));
    setPausa({ aberta: false, motivo: "" });
  };

  return (
    <div className="flex flex-col gap-5 p-4 lg:p-6" data-testid="cobranca-regua">
      <CabecalhoPainel
        titulo="Régua de cobrança e DNA"
        descricao={<>Do lembrete de atraso (D+1) ao fim de linha (D+360+): a <b>régua</b> decide quando falar e o que fazer; o <b>DNA 3×3</b> decide como falar. Quem executa é o funcionário — cada etapa pode ter um responsável.</>}
        testIdTitulo="titulo-regua"
        acoes={
          <>
            <Link href={ROTA_POLITICA} className={BOTAO_SECUNDARIO} data-testid="link-politica"><Settings2 className="h-3.5 w-3.5" aria-hidden /> Política de cobrança</Link>
            {podeAdministrar && (
              <button type="button" className={cn(pausada ? BOTAO_MARCA : BOTAO_SECUNDARIO)} disabled={!politica || gravarPolitica.isPending} onClick={() => (pausada ? alternarPausa() : setPausa({ aberta: true, motivo: "" }))} data-testid="botao-pausar-regua">
                {pausada ? <><Play className="h-3.5 w-3.5" aria-hidden /> Retomar régua</> : <><Pause className="h-3.5 w-3.5" aria-hidden /> Pausar régua</>}
              </button>
            )}
          </>
        }
      />

      {pausada && (
        <div className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--text-2)]" data-testid="aviso-regua-pausada">
          <Pause className="h-4 w-4 text-[var(--danger)]" aria-hidden />
          <span><b className="text-[var(--danger)]">Régua pausada:</b> o motor não move casos de etapa. {pausadaMotivo ? <>Motivo: <b>{pausadaMotivo}</b>.</> : ""}</span>
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
                <p className="text-[12px] text-[var(--text-muted)]">Determinística pelos dias de atraso da fatura mais antiga de cada cliente, como o ERP os informou no último sync. Cada carteira tem a sua.</p>
              </div>
              <Tabs value={carteira} onValueChange={v => setCarteira(v as Carteira)}>
                <TabsList className="grid h-auto w-[320px] grid-cols-2 rounded-md bg-[var(--surface-inset)] p-1" data-testid="abas-regua">
                  <TabsTrigger value="ativo" className={ABA}>Clientes (ativos)</TabsTrigger>
                  <TabsTrigger value="ex_cliente" className={ABA}>{ROTULO_CARTEIRA.ex_cliente}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {carteira === "ex_cliente" && (
              <p className="mb-3 text-[12px] text-[var(--text-muted)]" data-testid="nota-ex-cliente">Ex-cliente não passa por <b>aviso de suspensão</b>: não há serviço a suspender. Do lembrete vai direto à negociação.</p>
            )}

            <div className="flex gap-3 overflow-x-auto pb-2" data-testid="etapas-regua">
              {etapas.map(e => (
                <CartaoEtapa
                  key={e.id}
                  etapa={e}
                  contagem={contagens.get(e.id) ?? (regua?.contagens ? { casos: 0, valor: 0 } : null)}
                  equipe={equipe}
                  podeEditar={podeAdministrar && politica !== null}
                  onResponsavel={userId => mudarResponsavel(e.id, userId)}
                  salvando={gravarPolitica.isPending}
                  testId={`etapa-${e.id}`}
                />
              ))}
            </div>

            <div className="mt-1 h-px w-full bg-[var(--border-strong)]" aria-hidden />
            <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-[var(--text-faint)]" aria-hidden>
              {MARCAS_DO_EIXO.map(d => <span key={d}>{rotuloDoDia(d)}</span>)}
              <span>{rotuloDoDia(DIAS_PRESCRICAO)} prescreve</span>
            </div>

            <div className="mt-3 grid gap-2 text-[12px] text-[var(--text-2)] md:grid-cols-3">
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><SeloCobranca tom="gated">fase 2</SeloCobranca> <b>Pré-aviso (D-7, D-3, D-1)</b> fica no catálogo mas não dispara: sem fatura a fatura não há vencimento futuro para lembrar.</p>
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><Scale className="mr-1 inline h-3.5 w-3.5 text-[var(--gated)]" aria-hidden /> <b>Aviso de suspensão</b> não começa antes de <span className={MONO}>{rotuloDoDia(PISO_AVISO_SUSPENSAO_DIAS)}</span> (Anatel Res. 765/2023): a contagem é da entrega do aviso, e a política respeita o piso mesmo que alguém mova a janela.</p>
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><Scale className="mr-1 inline h-3.5 w-3.5 text-[var(--danger)]" aria-hidden /> <b>Prescrição:</b> com <span className={MONO}>{PRESCRICAO_ANOS} anos</span> de atraso (CC art. 206 §5º) a dívida não se cobra, não se negativa, não se pressiona. O motor a tira da régua sozinho.{semEtapa ? <> Hoje <b className={MONO}>{num(semEtapa.casos)}</b> casos (<span className={MONO}>{brl(semEtapa.valor)}</span>) estão sem etapa.</> : ""}</p>
            </div>
          </section>

          <section data-testid="bloco-dna">
            <KickerSecao className="mb-1">B · DNA 3×3 — como falar com cada tipo de cliente</KickerSecao>
            <p className="mb-3 text-[12px] text-[var(--text-muted)]">Fidelidade (tempo de casa) × confiabilidade (histórico) → um de nove quadrantes, cada um com um tom. A grade não dirige o timing. Sem data de contrato no ERP não há DNA — e a tela mostra "—" em vez de chutar.</p>
            <GradeDna contagens={dna.contagens} carteira={carteira} carregando={dnaCarregando} selecionado={quadrante} onSelecionar={setQuadrante} testId="grade-dna" />
          </section>
        </>
      )}

      <Dialog open={pausa.aberta} onOpenChange={aberta => setPausa(a => ({ ...a, aberta }))}>
        <DialogContent className="sm:max-w-[440px]" data-testid="dialogo-pausar">
          <DialogHeader>
            <DialogTitle>Pausar a régua?</DialogTitle>
            <DialogDescription>Nenhum caso muda de etapa enquanto estiver pausada. A fila e as negociações continuam.</DialogDescription>
          </DialogHeader>
          <Campo rotulo="motivo (fica registrado)">
            <textarea className={CONTROLE_CAMPO_MULTILINHA} value={pausa.motivo} onChange={e => setPausa(a => ({ ...a, motivo: e.target.value }))} placeholder="Ex.: auditoria da carteira" data-testid="pausa-motivo" />
          </Campo>
          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setPausa({ aberta: false, motivo: "" })}>Cancelar</button>
            <button type="button" className={BOTAO_MARCA} disabled={gravarPolitica.isPending} onClick={alternarPausa} data-testid="confirmar-pausa">Pausar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
