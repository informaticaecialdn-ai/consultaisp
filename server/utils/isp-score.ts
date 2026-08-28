/**
 * ISP SCORE v2 — Pontuacao de credito setorial 0-1000, por DEDUCAO.
 *
 * Por que deducao, e nao "pontos ganhos por categoria": o motor antigo somava
 * seis fatores independentes, e um caloteiro com R$ 10 mil ativos saia com
 * 410/1000 ("analise manual") porque ganhava 200 pontos gratis por AUSENCIA de
 * dado (consultas zeradas + endereco limpo) e o VALOR da divida nao entrava em
 * fator nenhum. Alem disso a tela mostrava "Inadimplencia 0/250" com barra
 * vazia — penalidade maxima lida como "sem problema".
 *
 * O modelo novo e o mesmo do veredito da Consulta Cadastral: comeca de uma
 * base, cada sinal negativo SUBTRAI com um motivo escrito, cada sinal positivo
 * comprovado SOMA, e guarda-corpos deterministas impedem que bonus lavem
 * divida ativa. A tela mostra a conta, nao categorias.
 *
 * Base 700 — "nada consta, nada comprova": quem a rede nao conhece nao e
 * excelente nem suspeito. So se chega a 1000 com historico positivo real
 * (tempo de casa em dia, equipamentos devolvidos). Faixas (mesmas do produto):
 *   0-300 muito baixo (rejeitar) · 301-500 baixo (analise manual)
 *   501-700 bom (aprovar com atencao) · 701-1000 excelente (aprovar)
 */

export interface OcorrenciaRede {
  diasAtraso: number
  faturasAtraso: number
  statusContrato: string
  mesesComoCliente?: number
  equipamentosDevolvidos?: boolean
  /** Valor em aberto (R$). O motor antigo ignorava — dever R$ 100 ou R$ 10.000 pontuava igual. */
  valorAtraso?: number
}

export interface ISPScoreInput {
  proprio?: {
    mesesComoCliente: number
    diasAtrasoAtual: number
    faturasAtrasadasTotal: number
    faturasTotal: number
    equipamentosDevolvidos?: boolean
    /**
     * `nunca_teve` significa "nao e cliente do consultante" e FAZ A OCORRENCIA
     * SUMIR da conta. `desconhecido` e diferente: o cliente existe na base do
     * consultante, a divida dele pontua, mas o ERP nao provou o contrato — e
     * sem prova nao ha bonus de bom pagador. Nao confunda os dois: usar
     * `nunca_teve` para quem existe apaga a divida dele do score.
     */
    statusContrato: 'ativo' | 'cancelado' | 'suspenso' | 'desconhecido' | 'nunca_teve'
    valorAtrasoAtual?: number
  }
  rede?: {
    ocorrencias: OcorrenciaRede[]
    totalProvedores: number
    consultasRecentes30d: number
    consultasRecentes90d: number
  }
  endereco?: {
    cpfsDistintosInadimplentes: number
    totalOcorrenciasEndereco: number
  }
  /**
   * Mantido por compatibilidade de chamada, mas NAO pontua mais: avaliar a
   * completude do cadastro que o CONSULTANTE tem sobre um estranho media o
   * proprio consultante, nao o risco do CPF. A Consulta Cadastral faz esse
   * papel com dado de verdade.
   */
  cadastro?: {
    nomeCompleto: boolean
    cpfValido: boolean
    emailValido: boolean
    telefoneValido: boolean
    enderecoCompleto: boolean
  }
}

/** Uma linha da conta: pontos com sinal e o motivo em portugues. */
export interface ItemComposicao {
  pontos: number
  motivo: string
  detalhe?: string
}

export interface ComposicaoScore {
  /** Ponto de partida (700 = "nada consta, nada comprova"). */
  base: number
  /** Sinais negativos, pontos < 0, do mais grave para o mais leve. */
  deducoes: ItemComposicao[]
  /** Historico positivo comprovado, pontos > 0. */
  bonus: ItemComposicao[]
  /** Guarda-corpo aplicado: o score nao passa deste valor, com o motivo. */
  teto?: { valor: number; motivo: string }
}

export interface ISPScoreResult {
  score: number
  score100: number
  faixa: 'muito_baixo' | 'baixo' | 'bom' | 'excelente'
  faixas100: { excelente: number; bom: number; baixo: number; muito_baixo: number }
  nivelRisco: 'muito_alto' | 'alto' | 'moderado' | 'baixo'
  sugestaoIA: 'REJEITAR' | 'ANALISE MANUAL' | 'APROVAR COM ATENCAO' | 'APROVAR'
  corIndicador: 'vermelho' | 'laranja' | 'amarelo' | 'verde'
  composicao: ComposicaoScore
  alertas: string[]
  condicoesSugeridas: string[]
}

// ── Reguas do motor — numeros com nome, para a manutencao discutir regua e
//    nao cacar literais. Mensalidade tipica do setor: R$ 100-150.

const BASE_SEM_HISTORICO = 700

/** Deducao pela idade do atraso ativo. Quanto mais velho, menos e esquecimento. */
const DEDUCAO_TEMPO: Array<[diasAcimaDe: number, pontos: number]> = [
  [365, -280], [180, -240], [90, -200], [30, -140], [0, -80],
]

/** Deducao pelo valor em aberto da ocorrencia. */
const DEDUCAO_VALOR: Array<[valorAcimaDe: number, pontos: number]> = [
  [5000, -200], [2000, -160], [1000, -120], [500, -90], [200, -60], [0, -30],
]

/** Atraso ativo sem valor informado: nao da para inocentar por falta do numero. */
const DEDUCAO_VALOR_DESCONHECIDO = -40

const DEDUCAO_FATURAS: Array<[faturasAcimaDe: number, pontos: number]> = [
  [6, -40], [4, -30], [2, -20],
]

/** Divida em mais de um provedor: cada credor extra alem do primeiro. */
const DEDUCAO_CREDOR_EXTRA = -60
const CAP_CREDORES_EXTRAS = -120

/** Ja atrasou no passado, hoje em dia: historico conta, mas pouco. */
const DEDUCAO_ATRASO_PASSADO = -30

const DEDUCAO_EQUIPAMENTO = -150
const CAP_EQUIPAMENTOS = -250

const DEDUCAO_ENDERECO: Record<number, number> = { 1: -40, 2: -100 }
const DEDUCAO_ENDERECO_FRAUDE = -250 // 3+ CPFs distintos inadimplentes

const DEDUCAO_CONSULTAS_30D_3 = -60
const DEDUCAO_CONSULTAS_30D_5 = -120
const DEDUCAO_CONSULTAS_90D_8 = -30
const DEDUCAO_CONSULTAS_90D_12 = -60

/** Bonus por tempo de casa comprovado EM DIA (meses somados na rede + proprio). */
const BONUS_TEMPO: Array<[mesesAcimaDe: number, pontos: number]> = [
  [60, 200], [36, 150], [24, 100], [12, 60], [6, 30],
]
const BONUS_NUNCA_ATRASOU = 60

/**
 * O contrato desta ocorrencia prova relacao viva?
 *
 * Aceita as duas grafias que chegam: o portugues do proprio consultante
 * (`ativo`/`suspenso`) e a uniao em ingles que vem do conector via
 * `contractStatus` (`active`/`suspended`). Suspenso conta porque suspensao por
 * atraso e um cliente que o provedor ainda tem.
 *
 * Qualquer outra coisa — cancelado, inativo, `unknown`, vazio — devolve false.
 * Nao e "ruim": e "nao comprovado", e o que nao se comprova nao ganha bonus.
 */
function contratoVigente(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  return s === 'ativo' || s === 'active' || s === 'suspenso' || s === 'suspended'
}
const BONUS_EQUIPAMENTOS_DEVOLVIDOS = 40
const CAP_BONUS = 300 // 700 + 300 = 1000: so chega ao topo quem comprova tudo

// ── Guarda-corpos: bonus nao lava caloteiro. O mais restritivo vence.
const TETO_DIVIDA_RELEVANTE = 300   // valor >= R$300 ou atraso > 60 dias → rejeitar
const TETO_DIVIDA_QUALQUER = 450    // qualquer divida ativa → no maximo analise manual
const TETO_EQUIPAMENTO_RETIDO = 400
const TETO_ENDERECO_FRAUDE = 300
const DIVIDA_RELEVANTE_VALOR = 300
const DIVIDA_RELEVANTE_DIAS = 60

const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`

function degrau(tabela: Array<[number, number]>, valor: number): number {
  for (const [acimaDe, pontos] of tabela) if (valor > acimaDe) return pontos
  return 0
}

export function calcularScoreISP(input: ISPScoreInput): ISPScoreResult {
  const alertas: string[] = []
  const condicoesSugeridas: string[] = []
  const deducoes: ItemComposicao[] = []
  const bonus: ItemComposicao[] = []

  // O proprio cliente entra na mesma lista: divida com o consultante pontua
  // igual a divida com a rede.
  const ocorrencias: OcorrenciaRede[] = [
    ...(input.rede?.ocorrencias || []),
    ...(input.proprio && input.proprio.statusContrato !== 'nunca_teve' ? [{
      diasAtraso: input.proprio.diasAtrasoAtual,
      faturasAtraso: input.proprio.faturasAtrasadasTotal,
      statusContrato: input.proprio.statusContrato,
      mesesComoCliente: input.proprio.mesesComoCliente,
      equipamentosDevolvidos: input.proprio.equipamentosDevolvidos,
      valorAtraso: input.proprio.valorAtrasoAtual,
    }] : []),
  ]

  const ativas = ocorrencias.filter(oc => oc.diasAtraso > 0)
  const passadas = ocorrencias.filter(oc => oc.diasAtraso === 0 && oc.faturasAtraso > 0)

  // ── Deducoes: inadimplencia ativa ─────────────────────────────────────────
  for (const oc of ativas) {
    const tempo = degrau(DEDUCAO_TEMPO, oc.diasAtraso)
    if (tempo) {
      deducoes.push({
        pontos: tempo,
        motivo: `Inadimplência ativa há ${oc.diasAtraso} dia${oc.diasAtraso === 1 ? '' : 's'}`,
      })
    }

    if (oc.valorAtraso != null && oc.valorAtraso > 0) {
      deducoes.push({
        pontos: degrau(DEDUCAO_VALOR, oc.valorAtraso),
        motivo: `Valor em aberto de ${brl(oc.valorAtraso)}`,
      })
    } else if (oc.valorAtraso == null) {
      deducoes.push({
        pontos: DEDUCAO_VALOR_DESCONHECIDO,
        motivo: 'Valor da dívida não informado pelo provedor credor',
        detalhe: 'Atraso ativo sem valor não é inocência — é dado incompleto.',
      })
    }

    const faturas = degrau(DEDUCAO_FATURAS, oc.faturasAtraso - 1)
    if (faturas) {
      deducoes.push({ pontos: faturas, motivo: `${oc.faturasAtraso} faturas em atraso` })
    }
  }

  if (ativas.length > 0) {
    alertas.push(`${ativas.length} ocorrência(s) de inadimplência ativa no setor ISP`)
    condicoesSugeridas.push('Exigir quitação de pendências anteriores antes de contratar')
  }

  if (ativas.length > 1) {
    const extras = Math.max(CAP_CREDORES_EXTRAS, (ativas.length - 1) * DEDUCAO_CREDOR_EXTRA)
    deducoes.push({
      pontos: extras,
      motivo: `Deve a ${ativas.length} provedores ao mesmo tempo`,
      detalhe: 'Dívida espalhada é o padrão do migrador serial.',
    })
  }

  for (const oc of passadas) {
    deducoes.push({
      pontos: DEDUCAO_ATRASO_PASSADO,
      motivo: `Histórico de ${oc.faturasAtraso} fatura(s) atrasada(s), hoje em dia`,
    })
  }

  // ── Deducoes: equipamento ─────────────────────────────────────────────────
  const equipamentosRetidos = ocorrencias.filter(oc => oc.equipamentosDevolvidos === false)
  if (equipamentosRetidos.length > 0) {
    deducoes.push({
      pontos: Math.max(CAP_EQUIPAMENTOS, equipamentosRetidos.length * DEDUCAO_EQUIPAMENTO),
      motivo: `Equipamento não devolvido em ${equipamentosRetidos.length} provedor(es)`,
      detalhe: 'ONU custa R$ 200-800 — o prejuízo além das mensalidades.',
    })
    alertas.push('Equipamentos nao devolvidos registrados na rede')
    condicoesSugeridas.push('Revisar a ocorrencia validada de equipamento antes de fornecer novo comodato')
  }

  // ── Deducoes: endereco ────────────────────────────────────────────────────
  const cpfsEndereco = input.endereco?.cpfsDistintosInadimplentes || 0
  if (cpfsEndereco >= 3) {
    deducoes.push({
      pontos: DEDUCAO_ENDERECO_FRAUDE,
      motivo: `${cpfsEndereco} CPFs distintos inadimplentes no mesmo endereço`,
      detalhe: 'Padrão clássico de fraude por troca de CPF.',
    })
    alertas.push(`ALERTA ANTI-FRAUDE: ${cpfsEndereco} CPFs distintos inadimplentes neste endereco`)
    condicoesSugeridas.push('Endereco com alto historico de fraude — recomenda-se rejeitar')
  } else if (cpfsEndereco > 0) {
    deducoes.push({
      pontos: DEDUCAO_ENDERECO[cpfsEndereco],
      motivo: `${cpfsEndereco} CPF(s) com inadimplência neste endereço`,
    })
    alertas.push(`Endereco com ${cpfsEndereco} ocorrencia(s) de inadimplencia anterior`)
    condicoesSugeridas.push(cpfsEndereco === 1
      ? 'Verificar se e o mesmo morador ou troca de CPF'
      : 'Exigir comprovante de residencia atualizado')
  }

  // ── Deducoes: padrao de consultas ─────────────────────────────────────────
  const c30 = input.rede?.consultasRecentes30d || 0
  const c90 = input.rede?.consultasRecentes90d || 0
  if (c30 >= 5) {
    deducoes.push({ pontos: DEDUCAO_CONSULTAS_30D_5, motivo: `Consultado por ${c30} provedores em 30 dias` })
    alertas.push('5+ consultas de ISPs diferentes nos ultimos 30 dias')
  } else if (c30 >= 3) {
    deducoes.push({ pontos: DEDUCAO_CONSULTAS_30D_3, motivo: `Consultado por ${c30} provedores em 30 dias` })
    alertas.push('3+ consultas de ISPs diferentes nos ultimos 30 dias')
  }
  if (c90 >= 12) {
    deducoes.push({ pontos: DEDUCAO_CONSULTAS_90D_12, motivo: `${c90} consultas em 90 dias` })
    alertas.push('Alta frequencia de consultas — possivel busca desesperada por credito ISP')
  } else if (c90 >= 8) {
    deducoes.push({ pontos: DEDUCAO_CONSULTAS_90D_8, motivo: `${c90} consultas em 90 dias` })
  }

  // ── Bonus: historico positivo comprovado ──────────────────────────────────
  // Bloqueado com divida ativa ou equipamento retido: bonus nao lava calote.
  const podeBonus = ativas.length === 0 && equipamentosRetidos.length === 0
  if (podeBonus) {
    const mesesEmDia = ocorrencias
      .filter(oc => oc.diasAtraso === 0 && contratoVigente(oc.statusContrato))
      .reduce((s, oc) => s + (oc.mesesComoCliente || 0), 0)
    const bTempo = degrau(BONUS_TEMPO, mesesEmDia)
    if (bTempo) {
      bonus.push({ pontos: bTempo, motivo: `${mesesEmDia} meses de casa no setor, em dia` })
    }

    /* O bonus exige RELACAO VIVA, nao so ausencia de atraso.
       O campo `statusContrato` existia na ocorrencia e o motor nunca o lia:
       um CPF que a rede so conhece como contrato CANCELADO tirava os +60 de
       "nunca atrasou" e fechava em 760/excelente — melhor do que os 700 de um
       CPF totalmente desconhecido. Ser ex-cliente melhorava a nota, que e o
       oposto do que um bureau existe para dizer.
       Cancelado, inativo e desconhecido agora sao NEUTROS: nada consta, nada
       comprova. E a mesma regra que o bonus de equipamento ja aplicava ao
       exigir `=== true`. */
    const nuncaAtrasou = ocorrencias.length > 0
      && ocorrencias.every(oc =>
        oc.diasAtraso === 0 && oc.faturasAtraso === 0 && contratoVigente(oc.statusContrato))
    if (nuncaAtrasou) {
      bonus.push({ pontos: BONUS_NUNCA_ATRASOU, motivo: 'Nunca atrasou em nenhum provedor da rede' })
    }

    // Ausencia de informacao nao e devolucao confirmada: o bonus exige
    // confirmacao explicita em todas as ocorrencias.
    const todosDevolvidos = ocorrencias.length > 0
      && ocorrencias.every(oc => oc.equipamentosDevolvidos === true)
    if (todosDevolvidos) {
      bonus.push({ pontos: BONUS_EQUIPAMENTOS_DEVOLVIDOS, motivo: 'Equipamentos sempre devolvidos' })
    }
  }

  // Cap do bonus preservando as linhas: reduz proporcional se estourar.
  const somaBonus = bonus.reduce((s, b) => s + b.pontos, 0)
  if (somaBonus > CAP_BONUS) {
    const fator = CAP_BONUS / somaBonus
    for (const b of bonus) b.pontos = Math.round(b.pontos * fator)
  }

  // ── Guarda-corpos ─────────────────────────────────────────────────────────
  let teto: ComposicaoScore['teto']
  const aplicarTeto = (valor: number, motivo: string) => {
    if (!teto || valor < teto.valor) teto = { valor, motivo }
  }

  const dividaRelevante = ativas.some(oc =>
    (oc.valorAtraso ?? 0) >= DIVIDA_RELEVANTE_VALOR || oc.diasAtraso > DIVIDA_RELEVANTE_DIAS)
  if (dividaRelevante) {
    aplicarTeto(TETO_DIVIDA_RELEVANTE, 'Dívida ativa relevante na rede ISP')
  } else if (ativas.length > 0) {
    aplicarTeto(TETO_DIVIDA_QUALQUER, 'Dívida ativa na rede ISP')
  }
  if (equipamentosRetidos.length > 0) {
    aplicarTeto(TETO_EQUIPAMENTO_RETIDO, 'Equipamento retido validado na rede')
  }
  if (cpfsEndereco >= 3) {
    aplicarTeto(TETO_ENDERECO_FRAUDE, 'Endereço com padrão de fraude')
  }

  // ── Score final ───────────────────────────────────────────────────────────
  const somaDeducoes = deducoes.reduce((s, d) => s + d.pontos, 0)
  const somaBonusFinal = bonus.reduce((s, b) => s + b.pontos, 0)
  let score = BASE_SEM_HISTORICO + somaBonusFinal + somaDeducoes
  if (teto) score = Math.min(score, teto.valor)
  score = Math.max(0, Math.min(1000, Math.round(score)))

  if (ocorrencias.length === 0) {
    alertas.push('Sem histórico na rede ISP — score baseado apenas em sinais externos')
  }

  // ── Faixa e sugestao — mesmas reguas do produto ───────────────────────────
  let faixa: ISPScoreResult['faixa']
  let nivelRisco: ISPScoreResult['nivelRisco']
  let sugestaoIA: ISPScoreResult['sugestaoIA']
  let corIndicador: ISPScoreResult['corIndicador']

  if (score >= 701) {
    faixa = 'excelente'; nivelRisco = 'baixo'; sugestaoIA = 'APROVAR'; corIndicador = 'verde'
  } else if (score >= 501) {
    faixa = 'bom'; nivelRisco = 'moderado'; sugestaoIA = 'APROVAR COM ATENCAO'; corIndicador = 'amarelo'
    condicoesSugeridas.push('Monitorar pagamentos nos primeiros 3 meses')
  } else if (score >= 301) {
    faixa = 'baixo'; nivelRisco = 'alto'; sugestaoIA = 'ANALISE MANUAL'; corIndicador = 'laranja'
    condicoesSugeridas.push('Exigir pagamento antecipado (1-3 meses)')
    condicoesSugeridas.push('Nao fornecer equipamento em comodato')
  } else {
    faixa = 'muito_baixo'; nivelRisco = 'muito_alto'; sugestaoIA = 'REJEITAR'; corIndicador = 'vermelho'
    condicoesSugeridas.push('Exigir pagamento antecipado (3-6 meses) se decidir aprovar')
    condicoesSugeridas.push('Nao fornecer equipamento em comodato')
    condicoesSugeridas.push('Solicitar fiador ou comprovante de renda')
  }

  // Divida ativa leve (abaixo dos tetos de rejeicao) nunca sai "APROVAR" puro.
  if (ativas.length > 0 && sugestaoIA === 'APROVAR') {
    sugestaoIA = 'APROVAR COM ATENCAO'
    corIndicador = 'amarelo'
    nivelRisco = 'moderado'
    condicoesSugeridas.push('Cliente com pendencia financeira na rede ISP — monitorar')
  }

  // Ordena a conta do impacto maior para o menor: a tela conta a historia.
  deducoes.sort((a, b) => a.pontos - b.pontos)
  bonus.sort((a, b) => b.pontos - a.pontos)

  return {
    score,
    score100: Math.round(score / 10),
    faixa,
    faixas100: { excelente: 71, bom: 51, baixo: 31, muito_baixo: 0 },
    nivelRisco, sugestaoIA, corIndicador,
    composicao: { base: BASE_SEM_HISTORICO, deducoes, bonus, teto },
    alertas,
    condicoesSugeridas,
  }
}