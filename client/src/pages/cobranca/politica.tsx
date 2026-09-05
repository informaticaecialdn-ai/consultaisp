/**
 * /cobranca/politica — o que o provedor configura: tetos de negociação,
 * encargos, janela de contato, os custos da Economia do cliente (R24), as
 * etapas da régua (janela, ação, canal, responsável, ligada) e a pausa.
 *
 * O servidor valida e AJUSTA aos tetos legais (`validarPolitica`): multa
 * acima de 2% volta a 2%, juros acima de 1% ao mês voltam a 1%, contato fora
 * de 8h–20h é encolhido, domingo e feriado desligam — e os ajustes voltam na
 * resposta e viram toast. A tela mostra os tetos ao lado de cada caixa para
 * o admin saber antes de digitar.
 *
 * Os custos (decisão (d) do dono, 05/09/2026) vão no mesmo PUT como
 * `economia`. Enquanto o admin não os CONFIRMA, o 360 mostra a Economia com
 * o selo "≈ parâmetros padrão", como o Provedor.ai faz — os números aparecem,
 * rotulados como estimativa. Mudar um custo desconfirma.
 *
 * Só admin grava; operador vê tudo desabilitado com o aviso.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BadgeCheck, Lock, Pause, Route, Save } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CANAIS_HUMANOS, janelaDaEtapa, LIMITES_DA_ECONOMIA, PARCELAMENTO_POR_STATUS, PISO_AVISO_SUSPENSAO_DIAS, ROTULO_CANAL, rotuloDoDia,
  STATUS_DE_PARCELAMENTO, TETOS_LEGAIS, type CanalHumano,
} from "@shared/cobranca";
import { AvisoNaoCarregou, BOTAO_MARCA, BOTAO_SECUNDARIO, CabecalhoPainel, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA } from "@/components/painel/ui";
import { podeAdministrarCobranca } from "@/components/cobranca/permissoes";
import {
  adicionarPlano, confirmarCustos, corpoDoPut, editarCusto, editarEtapa, editarPlano, formDaPolitica, lerPolitica, lerRespostaDoPut, removerPlano, ROTULO_PARCELAMENTO_POR_STATUS,
  type FormPolitica,
} from "@/components/cobranca/politica-form";
import { API_EQUIPE, API_POLITICA, CICLO_MESES_PADRAO, lerEquipe, ROTA_REGUA, type CampoDeCusto } from "@/components/cobranca/tipos";
import { Cartao, descricaoDoErro, invalidarCobranca, mensagemDoErro, SeloCobranca, SeloFase2, useSkeletonAtrasado } from "@/components/cobranca/ui";

const MONO = "font-mono tabular-nums";

/** Número de dado dentro de uma frase: sempre mono tabular (DESIGN_SYSTEM §2). */
function N({ children }: { children: ReactNode }) {
  return <span className={MONO}>{children}</span>;
}

function Teto({ children }: { children: ReactNode }) {
  return <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-[var(--text-faint)]"><Lock className="h-3 w-3" aria-hidden /> {children}</span>;
}

/** As nove caixas de custo, com os rótulos da tela de custos do Provedor.ai (tab-opex-capex). */
interface CaixaDeCusto {
  campo: CampoDeCusto;
  rotulo: string;
  dica: string;
  unidade: string;
  /** Só o ciclo é inteiro; o resto é R$ ou %. */
  inteiro?: boolean;
  max?: number;
}

const OPEX: CaixaDeCusto[] = [
  { campo: "opexLink", rotulo: "Link / transporte", dica: "Banda IP + transporte até o POP, por assinante/mês.", unidade: "R$/mês" },
  { campo: "opexRedePop", rotulo: "Rede & POP", dica: "Energia, aluguel de torre/POP e infra rateados por assinante.", unidade: "R$/mês" },
  { campo: "opexSuporte", rotulo: "Suporte & atendimento", dica: "Equipe de atendimento ÷ assinantes ativos.", unidade: "R$/mês" },
  { campo: "opexManutencaoNoc", rotulo: "Manutenção & NOC", dica: "Manutenção de rede + monitoramento, por assinante/mês.", unidade: "R$/mês" },
];

const INVESTIMENTO: CaixaDeCusto[] = [
  { campo: "cac", rotulo: "CAC · custo de aquisição", dica: "Tudo até fechar a venda: comissão do vendedor, anúncio, visita de viabilidade.", unidade: "R$" },
  { campo: "capexInstalacao", rotulo: "CAPEX · instalação", dica: "Equipamento em comodato + materiais + mão de obra: ONU, roteador, drop, instalador.", unidade: "R$" },
  { campo: "equipamentoResidual", rotulo: "Equipamento residual", dica: "O prejuízo do pior caso — valor do comodato quando o cliente cancela e não devolve.", unidade: "R$" },
];

const IMPOSTO_E_CICLO: CaixaDeCusto[] = [
  { campo: "impostoReceitaPct", rotulo: "Impostos s/ receita", dica: "Simples/ICMS — % sobre a mensalidade.", unidade: "%", max: LIMITES_DA_ECONOMIA.impostoReceitaPct.max },
  { campo: "cicloMeses", rotulo: "Ciclo do assinante", dica: `Permanência média na base — horizonte do LTV de receita (ticket × ciclo). Padrão ${CICLO_MESES_PADRAO} meses.`, unidade: "meses", inteiro: true, max: LIMITES_DA_ECONOMIA.cicloMeses.max },
];

const testIdDoCusto = (campo: CampoDeCusto) => `politica-economia-${campo.replace(/[A-Z]/g, l => `-${l.toLowerCase()}`)}`;

export default function PoliticaPage() {
  const { toast } = useToast();
  const { user, personificando } = useAuth();
  const podeAdministrar = podeAdministrarCobranca(user, personificando);

  const { data: politicaCrua, isLoading, isError, error, refetch } = useQuery<unknown>({ queryKey: [API_POLITICA], staleTime: 60_000 });
  const { data: equipeCrua } = useQuery<unknown>({ queryKey: [API_EQUIPE], staleTime: 300_000 });
  const equipe = useMemo(() => lerEquipe(equipeCrua), [equipeCrua]);
  const gravada = useMemo(() => (politicaCrua === undefined ? null : lerPolitica(politicaCrua)), [politicaCrua]);
  const mostrarSkeleton = useSkeletonAtrasado(isLoading);

  const [form, setForm] = useState<FormPolitica | null>(null);
  const [sujo, setSujo] = useState(false);
  // Hidrata quando a política chega; não sobrescreve o que o admin está editando.
  useEffect(() => { if (gravada && !sujo) setForm(formDaPolitica(gravada)); }, [gravada]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recebe o formulário como argumento: "Confirmar custos" grava o form já
  // confirmado sem esperar o estado do React virar.
  const gravar = useMutation({
    mutationFn: async (f: FormPolitica) => {
      if (!gravada) throw new Error("A política ainda não carregou");
      return (await apiRequest("PUT", API_POLITICA, corpoDoPut(f, gravada))).json();
    },
    onSuccess: resposta => {
      const { politica, ajustes } = lerRespostaDoPut(resposta);
      setSujo(false);
      setForm(formDaPolitica(politica));
      invalidarCobranca();
      toast({ title: "Política gravada", description: ajustes.length ? `Ajustada aos tetos legais: ${ajustes.join(" ")}` : undefined });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível gravar a política", description: descricaoDoErro(erro), variant: "destructive" }),
  });

  const editar = (mudanca: (f: FormPolitica) => FormPolitica) => { setSujo(true); setForm(f => (f ? mudanca(f) : f)); };
  const travado = !podeAdministrar || gravar.isPending || !form;
  const caixa = cn(CONTROLE_CAMPO, MONO);

  const confirmar = () => {
    if (!form || travado) return;
    const confirmado = confirmarCustos(form);
    setForm(confirmado);
    setSujo(true);
    gravar.mutate(confirmado);
  };

  const custosConfirmados = form?.economia.confirmado === true;
  const aVista = STATUS_DE_PARCELAMENTO.filter(s => !PARCELAMENTO_POR_STATUS[s]).map(s => ROTULO_PARCELAMENTO_POR_STATUS[s]);
  const parcela = STATUS_DE_PARCELAMENTO.filter(s => PARCELAMENTO_POR_STATUS[s]).map(s => ROTULO_PARCELAMENTO_POR_STATUS[s]);

  const caixaDeCusto = (c: CaixaDeCusto) => form && (
    <Campo key={c.campo} rotulo={c.rotulo}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={c.inteiro ? 1 : 0}
          max={c.max}
          step={c.inteiro ? 1 : "0.01"}
          className={caixa}
          disabled={travado}
          title={c.dica}
          value={form.economia[c.campo]}
          onChange={e => editar(f => editarCusto(f, c.campo, e.target.value))}
          data-testid={testIdDoCusto(c.campo)}
        />
        <span className={cn("flex-none text-[11px] text-[var(--text-faint)]", MONO)}>{c.unidade}</span>
      </div>
      <span className="mt-1 block text-[10.5px] leading-4 text-[var(--text-faint)]">{c.dica}</span>
    </Campo>
  );

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="cobranca-politica">
      <CabecalhoPainel
        titulo="Política de cobrança"
        descricao="O envelope que o funcionário pode negociar, os encargos, a janela de contato, os custos da Economia do cliente e as etapas da régua. Os tetos legais valem acima de tudo: o servidor ajusta o que passar deles."
        testIdTitulo="titulo-politica"
        acoes={
          <>
            <Link href={ROTA_REGUA} className={BOTAO_SECUNDARIO} data-testid="link-regua"><Route className="h-3.5 w-3.5" aria-hidden /> Ver a régua</Link>
            <button type="button" className={BOTAO_MARCA} disabled={travado || !sujo} onClick={() => form && gravar.mutate(form)} data-testid="salvar-politica"><Save className="h-3.5 w-3.5" aria-hidden /> {gravar.isPending ? "Gravando…" : "Gravar política"}</button>
          </>
        }
      />

      {!podeAdministrar && (
        <p className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2 text-[12px] text-[var(--gated)]" data-testid="aviso-somente-leitura">Só o administrador do provedor altera a política. Você está vendo a configuração em vigor.</p>
      )}

      {isError ? (
        <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testId="erro-politica">Não foi possível carregar a política: {mensagemDoErro(error)}</AvisoNaoCarregou>
      ) : mostrarSkeleton || !form ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-busy>{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[200px] rounded-lg" />)}</div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (!travado) gravar.mutate(form); }}>
          <div className="grid gap-3 lg:grid-cols-2">
            <Cartao kicker="negociação" titulo="O envelope do funcionário" testId="cartao-negociacao">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="máximo de parcelas">
                  <input type="number" min={1} max={TETOS_LEGAIS.maxParcelas} className={caixa} disabled={travado} value={form.negociacao.maxParcelas} onChange={e => editar(f => ({ ...f, negociacao: { ...f.negociacao, maxParcelas: e.target.value } }))} data-testid="politica-max-parcelas" />
                  <Teto>teto <N>{TETOS_LEGAIS.maxParcelas}×</N></Teto>
                </Campo>
                <Campo rotulo="entrada mínima (% do negociado)">
                  <input type="number" min={0} max={100} step="0.5" className={caixa} disabled={travado} value={form.negociacao.entradaMinimaPct} onChange={e => editar(f => ({ ...f, negociacao: { ...f.negociacao, entradaMinimaPct: e.target.value } }))} data-testid="politica-entrada-minima" />
                </Campo>
                <Campo rotulo="desconto máximo (% da dívida)">
                  <input type="number" min={0} max={100} step="0.5" className={caixa} disabled={travado} value={form.negociacao.descontoMaxPct} onChange={e => editar(f => ({ ...f, negociacao: { ...f.negociacao, descontoMaxPct: e.target.value } }))} data-testid="politica-desconto-max" />
                </Campo>
                <Campo rotulo="saldo mínimo para parcelar (R$)">
                  <input type="number" min={0} step="1" className={caixa} disabled={travado} value={form.negociacao.saldoMinimoParcelar} onChange={e => editar(f => ({ ...f, negociacao: { ...f.negociacao, saldoMinimoParcelar: e.target.value } }))} data-testid="politica-saldo-minimo" />
                </Campo>
              </div>
              <p className="mt-3 text-[11px] leading-4 text-[var(--text-muted)]" data-testid="politica-parcelamento-perfil">
                Parcelamento por perfil: à vista para {aVista.join(" e ")}; parcela {parcela.join(" e ")}. <SeloFase2 motivo="Precisa da mensalidade do cliente, que o sync não traz — fase 2" />
              </p>
            </Cartao>

            <Cartao kicker="encargos" titulo="Multa e juros de mora" testId="cartao-encargos">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="multa (%)">
                  <input type="number" min={0} max={100} step="0.1" className={caixa} disabled={travado} value={form.encargos.multaPct} onChange={e => editar(f => ({ ...f, encargos: { ...f.encargos, multaPct: e.target.value } }))} data-testid="politica-multa" />
                  <Teto>teto <N>{TETOS_LEGAIS.multaPct}%</N> · CDC art. 52 §1º</Teto>
                </Campo>
                <Campo rotulo="juros ao mês (%)">
                  <input type="number" min={0} max={100} step="0.1" className={caixa} disabled={travado} value={form.encargos.jurosMesPct} onChange={e => editar(f => ({ ...f, encargos: { ...f.encargos, jurosMesPct: e.target.value } }))} data-testid="politica-juros" />
                  <Teto>teto <N>{TETOS_LEGAIS.jurosMesPct}%</N> ao mês · CC art. 406</Teto>
                </Campo>
              </div>
              <p className="mt-3 text-[11px] leading-4 text-[var(--text-muted)]">Cadeado = teto legal. O servidor reduz o que passar dele e avisa; a atualização da dívida usa multa uma vez e juros pro rata die.</p>
            </Cartao>

            <Cartao kicker="janela de contato" titulo="Quando se pode ligar" testId="cartao-janela">
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo rotulo="dias úteis, das">
                  <input type="number" min={0} max={23} className={caixa} disabled={travado} value={form.janelaContato.horaInicio} onChange={e => editar(f => ({ ...f, janelaContato: { ...f.janelaContato, horaInicio: e.target.value } }))} data-testid="politica-hora-inicio" />
                  <Teto>a partir das <N>{TETOS_LEGAIS.janelaContato.horaInicio}h</N></Teto>
                </Campo>
                <Campo rotulo="até as">
                  <input type="number" min={0} max={23} className={caixa} disabled={travado} value={form.janelaContato.horaFim} onChange={e => editar(f => ({ ...f, janelaContato: { ...f.janelaContato, horaFim: e.target.value } }))} data-testid="politica-hora-fim" />
                  <Teto>até <N>{TETOS_LEGAIS.janelaContato.horaFim}h</N> · CDC art. 42</Teto>
                </Campo>
                <Campo rotulo="sábado até as">
                  <input type="number" min={0} max={23} className={caixa} disabled={travado || !form.janelaContato.sabado} value={form.janelaContato.sabadoHoraFim} onChange={e => editar(f => ({ ...f, janelaContato: { ...f.janelaContato, sabadoHoraFim: e.target.value } }))} data-testid="politica-sabado-fim" />
                  <Teto>até <N>{TETOS_LEGAIS.janelaContato.sabadoHoraFim}h</N></Teto>
                </Campo>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-[12.5px] text-[var(--text-2)]">
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" disabled={travado} checked={form.janelaContato.sabado} onChange={e => editar(f => ({ ...f, janelaContato: { ...f.janelaContato, sabado: e.target.checked } }))} data-testid="politica-sabado" /> sábado</label>
                <label className="inline-flex min-h-9 items-center gap-2 text-[var(--text-faint)]" title="Proibido pelo CDC art. 42 — o servidor desliga"><input type="checkbox" className="h-4 w-4" disabled checked={false} readOnly /> domingo <Lock className="h-3 w-3" aria-hidden /></label>
                <label className="inline-flex min-h-9 items-center gap-2 text-[var(--text-faint)]" title="Proibido pelo CDC art. 42 — o servidor desliga"><input type="checkbox" className="h-4 w-4" disabled checked={false} readOnly /> feriado <Lock className="h-3 w-3" aria-hidden /></label>
              </div>
            </Cartao>

            <Cartao kicker="pausa" titulo="Interruptor geral da régua" testId="cartao-pausa">
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[12.5px] text-[var(--text-2)]">
                <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" disabled={travado} checked={form.pausada} onChange={e => editar(f => ({ ...f, pausada: e.target.checked }))} data-testid="politica-pausada" />
                <Pause className="h-3.5 w-3.5" aria-hidden /> régua pausada — nenhum caso muda de etapa
              </label>
              {form.pausada && (
                <Campo rotulo="motivo" className="mt-2">
                  <textarea className={CONTROLE_CAMPO_MULTILINHA} disabled={travado} maxLength={300} value={form.pausadaMotivo} onChange={e => editar(f => ({ ...f, pausadaMotivo: e.target.value }))} data-testid="politica-pausada-motivo" />
                </Campo>
              )}
            </Cartao>
          </div>

          <Cartao
            kicker="custos e economia · R24"
            titulo="O que um assinante custa — a Economia do cliente no 360"
            acoes={
              custosConfirmados ? (
                <SeloCobranca tom="ok" testId="selo-custos-confirmados" titulo="Os custos abaixo foram confirmados pelo administrador: o 360 usa estes números">confirmado</SeloCobranca>
              ) : (
                <>
                  <SeloCobranca tom="gated" className="normal-case tracking-normal" testId="selo-parametros-padrao" titulo="A Economia do cliente é calculada com os parâmetros vigentes (padrão) — confirme os custos do seu provedor para o 360 tirar o selo">≈ parâmetros padrão</SeloCobranca>
                  <button type="button" className={BOTAO_SECUNDARIO} disabled={travado} onClick={confirmar} data-testid="confirmar-custos"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Confirmar custos</button>
                </>
              )
            }
            testId="cartao-economia"
          >
            <p className="mb-3 text-[11.5px] leading-4 text-[var(--text-muted)]">
              Por assinante. OPEX é o que sai da margem todo mês; CAC e CAPEX são pagos uma vez e voltam pela margem — isso é o payback. O ARPU (mensalidade) vem do contrato de cada cliente, não daqui. Sem confirmação, o 360 mostra a Economia com o selo "≈ parâmetros padrão".
            </p>
            <div className="grid gap-4 lg:grid-cols-[2fr_1.5fr_1fr]">
              <fieldset className="min-w-0">
                <legend className="mb-2 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">opex · operação mensal por assinante</legend>
                <div className="grid gap-3 sm:grid-cols-2">{OPEX.map(caixaDeCusto)}</div>
              </fieldset>
              <fieldset className="min-w-0">
                <legend className="mb-2 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">capex & cac · investimento por cliente novo</legend>
                <div className="grid gap-3">{INVESTIMENTO.map(caixaDeCusto)}</div>
              </fieldset>
              <fieldset className="min-w-0">
                <legend className="mb-2 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">impostos & ciclo de vida</legend>
                <div className="grid gap-3">{IMPOSTO_E_CICLO.map(caixaDeCusto)}</div>
              </fieldset>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-[var(--text-muted)]">
              Mudar um custo desconfirma: o selo atesta os números que estavam na tela. <b>Confirmar custos</b> grava a política com a confirmação.
            </p>

            {/* O ARPU: o sync não traz o valor do plano, só o NOME (pelo ERP ao vivo). A
                mensalidade por nome é o que liga a Economia do cliente no 360; plano sem
                preço fica PENDENTE lá, com o motivo — nunca um chute. */}
            <fieldset className="mt-4 min-w-0 border-t border-[var(--border)] pt-3" id="economia" data-testid="planos-precos">
              <legend className="mb-1 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">planos · mensalidade por nome do plano (ARPU)</legend>
              <p className="mb-2 text-[11px] leading-4 text-[var(--text-muted)]">Escreva o nome exatamente como o ERP o devolve (a ficha mostra o nome que veio). O 360 casa sem diferenciar maiúsculas, acentos ou espaços.</p>
              <div className="flex flex-col gap-2">
                {form.economia.planos.map((p, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_140px_36px] items-center gap-2" data-testid={`plano-${i}`}>
                    <input className={CONTROLE_CAMPO} placeholder="Nome do plano (ex.: Fibra 300)" value={p.nome} disabled={travado} onChange={e => editar(f => editarPlano(f, i, "nome", e.target.value))} aria-label="nome do plano" data-testid={`plano-nome-${i}`} />
                    <div className="flex items-center gap-1.5"><span className="text-[11px] text-[var(--text-muted)]">R$</span><input className={caixa} inputMode="decimal" placeholder="0,00" value={p.preco} disabled={travado} onChange={e => editar(f => editarPlano(f, i, "preco", e.target.value))} aria-label="mensalidade" data-testid={`plano-preco-${i}`} /></div>
                    <button type="button" className={cn(BOTAO_SECUNDARIO, "h-9 w-9 px-0")} disabled={travado} onClick={() => editar(f => removerPlano(f, i))} aria-label="remover plano" data-testid={`plano-remover-${i}`}>×</button>
                  </div>
                ))}
                {form.economia.planos.length === 0 && <p className="text-[11.5px] text-[var(--text-faint)]">nenhum plano cadastrado — a Economia do cliente fica PENDENTE no 360 até haver a mensalidade do plano dele.</p>}
                <button type="button" className={cn(BOTAO_SECUNDARIO, "w-fit")} disabled={travado} onClick={() => editar(adicionarPlano)} data-testid="adicionar-plano">+ adicionar plano</button>
              </div>
            </fieldset>
          </Cartao>

          <Cartao kicker="régua" titulo="As etapas — janela, ação e responsável" acoes={<span className="text-[11px] text-[var(--text-muted)]">o tom não mora aqui: vem do DNA de cada cliente</span>} testId="cartao-etapas">
            <div className="flex flex-col divide-y divide-[var(--border-faint)]">
              {form.etapas.map(e => (
                <div key={e.id} className={cn("grid gap-3 py-3 lg:grid-cols-[180px_minmax(0,1fr)_150px_170px]", !e.ativa && "opacity-60")} data-testid={`politica-etapa-${e.id}`}>
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <b className="text-[13px] text-[var(--text)]">{e.rotulo}</b>
                      {!e.disponivelNaFase1 && <SeloFase2 />}
                    </div>
                    <p className={cn("mt-0.5 text-[11px] text-[var(--text-muted)]", MONO)}>{janelaDaEtapa(e)}</p>
                    {e.baseLegal && <p className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">{e.baseLegal}</p>}
                    <label className="mt-1.5 inline-flex min-h-8 cursor-pointer items-center gap-2 text-[12px] text-[var(--text-2)]">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" disabled={travado} checked={e.ativa} onChange={ev => editar(f => ({ ...f, etapas: editarEtapa(f.etapas, e.id, { ativa: ev.target.checked }) }))} data-testid={`etapa-ativa-${e.id}`} /> ligada
                    </label>
                  </div>
                  <Campo rotulo="ação do funcionário">
                    <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-16")} disabled={travado} maxLength={500} value={e.acao} onChange={ev => editar(f => ({ ...f, etapas: editarEtapa(f.etapas, e.id, { acao: ev.target.value }) }))} data-testid={`etapa-acao-${e.id}`} />
                  </Campo>
                  <div className="grid grid-cols-2 gap-2">
                    <Campo rotulo="de (dia)">
                      <input type="number" className={caixa} disabled={travado} value={e.diaMin} onChange={ev => editar(f => ({ ...f, etapas: editarEtapa(f.etapas, e.id, { diaMin: ev.target.value }) }))} data-testid={`etapa-dia-min-${e.id}`} />
                    </Campo>
                    <Campo rotulo="até (dia)">
                      <input type="number" className={caixa} disabled={travado} placeholder="sem teto" value={e.diaMax ?? ""} onChange={ev => editar(f => ({ ...f, etapas: editarEtapa(f.etapas, e.id, { diaMax: ev.target.value }) }))} data-testid={`etapa-dia-max-${e.id}`} />
                    </Campo>
                  </div>
                  <div className="grid gap-2">
                    <Campo rotulo="canal sugerido">
                      <select className={CONTROLE_CAMPO} disabled={travado} value={e.canalSugerido} onChange={ev => editar(f => ({ ...f, etapas: editarEtapa(f.etapas, e.id, { canalSugerido: ev.target.value as CanalHumano }) }))} data-testid={`etapa-canal-${e.id}`}>
                        {CANAIS_HUMANOS.map(c => <option key={c} value={c}>{ROTULO_CANAL[c]}</option>)}
                      </select>
                    </Campo>
                    <Campo rotulo="responsável">
                      <select className={CONTROLE_CAMPO} disabled={travado} value={e.responsavelUserId ?? ""} onChange={ev => editar(f => ({ ...f, etapas: editarEtapa(f.etapas, e.id, { responsavelUserId: ev.target.value === "" ? null : Number(ev.target.value) }) }))} data-testid={`etapa-responsavel-${e.id}`}>
                        <option value="">qualquer operador</option>
                        {equipe.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                      </select>
                    </Campo>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">
              <SeloCobranca tom="neutro">desligada</SeloCobranca> a etapa seguinte absorve a janela · o aviso de suspensão nunca começa antes de <N>{rotuloDoDia(PISO_AVISO_SUSPENSAO_DIAS)}</N> (Anatel) · só as mudanças em cima do catálogo são gravadas.
            </p>
          </Cartao>

          <div className="flex justify-end">
            <button type="submit" className={BOTAO_MARCA} disabled={travado || !sujo} data-testid="salvar-politica-fim"><Save className="h-3.5 w-3.5" aria-hidden /> {gravar.isPending ? "Gravando…" : "Gravar política"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
