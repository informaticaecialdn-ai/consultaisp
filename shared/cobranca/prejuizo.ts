/**
 * O PREJUÍZO ACUMULADO da carteira — a Economia do cliente (R24) somada, por
 * período, nas duas carteiras de cobrança.
 *
 * Pedido do dono (09/09/2026): "um card que mostre os valores de prejuízo
 * acumulado que os clientes ou ex-clientes [dão] baseado na economia do
 * cliente, com filtro por mês, trimestre, semestre e ano".
 *
 * ── O que é o prejuízo de UM cliente ──────────────────────────────────────
 * Nada novo: é o lucro acumulado do ledger quando ele é negativo —
 * `max(0, −lucro_acumulado)`. O ledger já é "de vida inteira" (é daí que vem
 * o "acumulado" do nome), e o card só o decompõe, a partir dos PRÓPRIOS campos
 * do ledger, para o operador ver o que é dívida real (ERP) e o que é
 * instalação/aquisição que a margem ainda não pagou:
 *
 *   sobra                    = max(0, lucro_acumulado + inadimplencia_aberta)
 *   abatida                  = min(inadimplencia_aberta, sobra)
 *   instalacaoNaoRecuperada  = max(0, −(lucro_acumulado + inadimplencia_aberta))
 *   prejuizo                 = dividaAvaliada + instalacaoNaoRecuperada − abatida
 *
 * Identidade EXATA nos dois regimes (antes do payback sobra = 0; depois,
 * instalação = 0 e o prejuízo é a dívida menos o que a margem já cobriu).
 * Derivar de `lucro_acumulado` em vez de recomputar `investimento − margem ×
 * meses` é o que evita a divergência de centavos: `margem_mes` sai arredondado
 * do ledger e a recomputação erra (530,03 onde o ledger dá 530,07).
 *
 * Em modo "recebida" (pagamento real sincronizado) o ledger NÃO subtrai a
 * dívida — então a decomposição muda de forma; hoje nenhum provedor está nesse
 * modo (não existe fatura paga na base), mas o card não pode quebrar em
 * silêncio no dia em que ficar mais verdadeiro.
 *
 * ── Quem entra ───────────────────────────────────────────────────────────
 * Só DEVEDOR: a mesma população do KPI "Vencido" (`total_overdue_amount > 0`
 * na carteira). Cliente em dia no mês 6 tem investimento por recuperar, mas
 * isso é payback em curso, não prejuízo — somar o lucro negativo da carteira
 * inteira daria seis dígitos falsos (−R$ 317,50 por cliente com 12 meses e os
 * parâmetros da NsLink, × 561 ativos).
 *
 * ── O eixo do período ────────────────────────────────────────────────────
 * O cliente é atribuído ao mês em que DEVE DESDE: o vencimento da fatura
 * vencida mais antiga que o ERP mantém aberta — dado gravado, o mesmo
 * `vencimentoMaisAntigo` do 360. Não é data de cancelamento (`cortado_em` é
 * nulo em todos os cancelados do MK) nem prova de quando "parou de pagar";
 * o rótulo diz "devem desde". Devedor sem fatura vencida gravada não recebe
 * data inventada: vai ao balde "sem data", visível, para a soma fechar.
 *
 * "Acumulado" é a SOMA DENTRO DA JANELA do resultado de vida inteira de cada
 * um, como está hoje: o período escolhe QUEM, não fatia o dinheiro. O número
 * de um período passado só diminui — quem quita sai; quem paga só a fatura
 * mais antiga MUDA de período.
 *
 * Módulo puro: sem banco, sem React, sem I/O. Datas entram como 'AAAA-MM-DD'.
 */
import type { EconomiaLedger } from "./economia";
import { economiaDoCliente, type EntradaDaEconomia } from "./ficha360";
import type { Economia } from "./politica";
import { formatarPeriodo, mesDoDia, mesesDoPeriodo, periodoDoMes, type Periodo } from "./periodo";

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface DecomposicaoDoPrejuizo {
  prejuizo: number;
  /** A dívida vencida do cliente, segundo o ERP (o mesmo `inadimplencia_aberta` do ledger). */
  dividaAvaliada: number;
  /** CAC + instalação que a margem acumulada ainda não pagou. */
  instalacaoNaoRecuperada: number;
  /** Parte da dívida que a margem já acumulada cobre — só existe depois do payback. */
  abatida: number;
}

export function decomporPrejuizo(L: EconomiaLedger, dividaReal: number): DecomposicaoDoPrejuizo {
  const prejuizo = r2(Math.max(0, -L.lucro_acumulado));
  if (L.fonte_receita === "recebida") {
    // O ledger recebido não subtrai a dívida: o que sobra negativo é só instalação.
    return { prejuizo, dividaAvaliada: r2(dividaReal), instalacaoNaoRecuperada: prejuizo, abatida: 0 };
  }
  const d = L.inadimplencia_aberta;
  const lucroSemDivida = r2(L.lucro_acumulado + d);
  const sobra = Math.max(0, lucroSemDivida);
  return {
    prejuizo,
    dividaAvaliada: d,
    instalacaoNaoRecuperada: r2(Math.max(0, -lucroSemDivida)),
    abatida: r2(Math.min(d, sobra)),
  };
}

/** Uma linha da carteira, como o storage a devolve — só texto e número. */
export interface DevedorDaCarteira {
  id: number;
  statusErp: string | null;
  /** Dívida vencida segundo o ERP (`customers.total_overdue_amount`). */
  dividaAtual: number;
  contractStartDate: string | null;
  cortadoEm: string | null;
  /** Vencimento da fatura vencida mais antiga em aberto — o eixo. 'AAAA-MM-DD'. */
  devemDesde: string | null;
  /** Vencimento da fatura vencida EM ABERTO mais recente — o fim do ciclo do ex-cliente. */
  ultimaFatura: string | null;
}

export interface MensalidadeParaPrejuizo { valor: number; concordam: number; faturas: number; baixadas: number }

export interface MotivoDoTraco { motivo: string; clientes: number; divida: number }

export interface ResumoDoPrejuizo {
  /** Devedores da carteira cujo "devem desde" cai no período. */
  devedores: number;
  /** Destes, quantos passaram pelo gate da Economia. */
  avaliados: number;
  noPrejuizo: number;
  /**
   * Σ prejuízo dos avaliados. null SÓ quando há devedor no período e nenhum
   * passou no gate — a tela desenha "—". Período sem devedor é 0: conjunto
   * vazio soma zero por construção, e "—" ali leria como "não sei".
   */
  prejuizo: number | null;
  dividaAvaliada: number;
  instalacaoNaoRecuperada: number | null;
  abatida: number;
  /** Σ dívida de TODOS os devedores do período, segundo o ERP — o número real. */
  dividaDoRecorte: number;
  /** Σ dívida de todos os devedores da carteira (reconcilia com o KPI Vencido). */
  dividaDaCarteira: number;
  devedoresDaCarteira: number;
  /** dividaDoRecorte ÷ dividaDaCarteira, em %; null sem dívida na carteira. */
  fatiaDaCarteira: number | null;
  motivosDoTraco: MotivoDoTraco[];
  /** Devedores sem fatura vencida gravada — fora de qualquer período. */
  semData: { clientes: number; divida: number };
}

export interface SerieDoPrejuizo { mes: string; devedores: number; dividaReal: number; prejuizo: number | null }

export interface ResultadoDoPrejuizo {
  resumo: ResumoDoPrejuizo;
  serie: SerieDoPrejuizo[];
  /** Os ids dos devedores do período — o recorte que o clique aplica à lista. */
  ids: number[];
}

/**
 * A soma da carteira. Cada devedor passa por `economiaDoCliente` — o MESMO
 * gate da ficha do 360 —, então o card é a soma das fichas do servidor por
 * construção (com `plano: null`, como a rota do 360 monta).
 */
export function agregarPrejuizo(entrada: {
  devedores: readonly DevedorDaCarteira[];
  mensalidades: ReadonlyMap<number, MensalidadeParaPrejuizo>;
  economia: Economia | null;
  hoje: Date;
  periodo: Periodo;
  carteira: "ativo" | "ex_cliente";
}): ResultadoDoPrejuizo {
  const { devedores, mensalidades, economia, hoje, periodo, carteira } = entrada;
  const alvo = formatarPeriodo(periodo);
  const meses = mesesDoPeriodo(periodo);
  const porMes = new Map<string, SerieDoPrejuizo & { avaliados: number }>(
    meses.map(m => [m, { mes: m, devedores: 0, dividaReal: 0, prejuizo: null, avaliados: 0 }]),
  );

  const resumo: ResumoDoPrejuizo = {
    devedores: 0, avaliados: 0, noPrejuizo: 0, prejuizo: null, dividaAvaliada: 0, instalacaoNaoRecuperada: null, abatida: 0,
    dividaDoRecorte: 0, dividaDaCarteira: 0, devedoresDaCarteira: 0, fatiaDaCarteira: null,
    motivosDoTraco: [], semData: { clientes: 0, divida: 0 },
  };
  const motivos = new Map<string, MotivoDoTraco>();
  const ids: number[] = [];
  let somaPrejuizo = 0;
  let somaInstalacao = 0;

  for (const d of devedores) {
    resumo.devedoresDaCarteira++;
    resumo.dividaDaCarteira = r2(resumo.dividaDaCarteira + d.dividaAtual);
    if (!d.devemDesde) {
      resumo.semData.clientes++;
      resumo.semData.divida = r2(resumo.semData.divida + d.dividaAtual);
      continue;
    }
    const mes = mesDoDia(d.devemDesde);
    const periodoDoDevedor = periodoDoMes(mes, periodo.granularidade);
    if (!periodoDoDevedor || formatarPeriodo(periodoDoDevedor) !== alvo) continue;

    resumo.devedores++;
    resumo.dividaDoRecorte = r2(resumo.dividaDoRecorte + d.dividaAtual);
    ids.push(d.id);
    const linha = porMes.get(mes);
    if (linha) { linha.devedores++; linha.dividaReal = r2(linha.dividaReal + d.dividaAtual); }

    const obs = mensalidades.get(d.id) ?? null;
    const eco = economiaDoCliente({
      hoje,
      statusErp: d.statusErp,
      carteira,
      contractStartDate: d.contractStartDate,
      cortadoEm: d.cortadoEm,
      ultimaFaturaEmitidaEm: d.ultimaFatura,
      plano: null,
      dividaAtual: d.dividaAtual,
      economia,
      mensalidadeObservada: obs,
      historicoPagamento: null,
    } satisfies EntradaDaEconomia);

    if (!eco.economia) {
      const m = eco.economiaPendente ?? "sem economia";
      const acc = motivos.get(m) ?? { motivo: m, clientes: 0, divida: 0 };
      acc.clientes++;
      acc.divida = r2(acc.divida + d.dividaAtual);
      motivos.set(m, acc);
      continue;
    }
    const dec = decomporPrejuizo(eco.economia, d.dividaAtual);
    resumo.avaliados++;
    if (dec.prejuizo > 0) resumo.noPrejuizo++;
    somaPrejuizo = r2(somaPrejuizo + dec.prejuizo);
    somaInstalacao = r2(somaInstalacao + dec.instalacaoNaoRecuperada);
    resumo.dividaAvaliada = r2(resumo.dividaAvaliada + dec.dividaAvaliada);
    resumo.abatida = r2(resumo.abatida + dec.abatida);
    if (linha) { linha.avaliados++; linha.prejuizo = r2((linha.prejuizo ?? 0) + dec.prejuizo); }
  }

  if (resumo.avaliados > 0 || resumo.devedores === 0) {
    resumo.prejuizo = somaPrejuizo;
    resumo.instalacaoNaoRecuperada = somaInstalacao;
  }
  resumo.fatiaDaCarteira = resumo.dividaDaCarteira > 0 ? Math.round((resumo.dividaDoRecorte / resumo.dividaDaCarteira) * 1000) / 10 : null;
  resumo.motivosDoTraco = Array.from(motivos.values()).sort((a, b) => b.clientes - a.clientes);

  return {
    resumo,
    serie: meses.map(m => { const l = porMes.get(m)!; return { mes: l.mes, devedores: l.devedores, dividaReal: l.dividaReal, prejuizo: l.prejuizo }; }),
    ids,
  };
}
