/**
 * ISP SCORE — Pontuacao de credito setorial 0-1000
 *
 * Metodologia baseada no Serasa Score (2025), adaptada para o setor de ISPs.
 *
 * Fatores:
 * F1. Historico de pagamento ISP  (30% = 300 pts)
 * F2. Tempo no setor ISP          (20% = 200 pts)
 * F3. Inadimplencia ativa          (25% = 250 pts)
 * F4. Padrao de consultas          (10% = 100 pts)
 * F5. Risco do endereco            (10% = 100 pts)
 * F6. Consistencia cadastral       ( 5% =  50 pts)
 *
 * Faixas:
 * 0-300:   Muito Baixo (risco muito alto)
 * 301-500: Baixo       (risco alto)
 * 501-700: Bom         (risco moderado)
 * 701-1000: Excelente  (risco baixo)
 */

export interface ISPScoreInput {
  proprio?: {
    mesesComoCliente: number
    diasAtrasoAtual: number
    faturasAtrasadasTotal: number
    faturasTotal: number
    equipamentosDevolvidos: boolean
    statusContrato: 'ativo' | 'cancelado' | 'suspenso' | 'nunca_teve'
  }
  rede?: {
    ocorrencias: Array<{
      diasAtraso: number
      faturasAtraso: number
      statusContrato: string
      mesesComoCliente?: number
      equipamentosDevolvidos?: boolean
    }>
    totalProvedores: number
    consultasRecentes30d: number
    consultasRecentes90d: number
  }
  endereco?: {
    cpfsDistintosInadimplentes: number
    totalOcorrenciasEndereco: number
  }
  cadastro?: {
    nomeCompleto: boolean
    cpfValido: boolean
    emailValido: boolean
    telefoneValido: boolean
    enderecoCompleto: boolean
  }
}

export interface ScoreFator {
  pontos: number
  maximo: number
  peso: string
  descricao: string
}

export interface ISPScoreResult {
  score: number
  score100: number
  faixa: 'muito_baixo' | 'baixo' | 'bom' | 'excelente'
  faixas100: {
    excelente: number
    bom: number
    baixo: number
    muito_baixo: number
  }
  nivelRisco: 'muito_alto' | 'alto' | 'moderado' | 'baixo'
  sugestaoIA: 'REJEITAR' | 'ANALISE MANUAL' | 'APROVAR COM ATENCAO' | 'APROVAR'
  corIndicador: 'vermelho' | 'laranja' | 'amarelo' | 'verde'
  fatores: {
    f1_historicoPagamento: ScoreFator
    f2_tempoSetor: ScoreFator
    f3_inadimplenciaAtiva: ScoreFator
    f4_padraoConsultas: ScoreFator
    f5_riscoEndereco: ScoreFator
    f6_consistenciaCadastral: ScoreFator
  }
  alertas: string[]
  condicoesSugeridas: string[]
}

export function calcularScoreISP(input: ISPScoreInput): ISPScoreResult {
  const alertas: string[] = []
  const condicoesSugeridas: string[] = []

  // F1 — HISTORICO DE PAGAMENTO ISP (0-300)
  let f1 = 300
  const todasOcorrencias = [
    ...(input.rede?.ocorrencias || []),
    ...(input.proprio && input.proprio.statusContrato !== 'nunca_teve' ? [{
      diasAtraso: input.proprio.diasAtrasoAtual,
      faturasAtraso: input.proprio.faturasAtrasadasTotal,
      statusContrato: input.proprio.statusContrato,
      mesesComoCliente: input.proprio.mesesComoCliente,
      equipamentosDevolvidos: input.proprio.equipamentosDevolvidos,
    }] : [])
  ]

  for (const oc of todasOcorrencias) {
    let ocPenalty = 0

    if (oc.diasAtraso > 365)                         ocPenalty -= 180
    else if (oc.diasAtraso > 180)                    ocPenalty -= 130
    else if (oc.diasAtraso > 90)                     ocPenalty -= 100
    else if (oc.diasAtraso > 60)                     ocPenalty -= 70
    else if (oc.diasAtraso > 30)                     ocPenalty -= 40
    else if (oc.diasAtraso > 0)                      ocPenalty -= 20

    if (oc.faturasAtraso >= 6) ocPenalty -= 25
    else if (oc.faturasAtraso >= 4) ocPenalty -= 20
    else if (oc.faturasAtraso >= 2) ocPenalty -= 15

    if (oc.equipamentosDevolvidos === false) {
      ocPenalty -= 30
      alertas.push('Equipamentos nao devolvidos registrados na rede')
    }

    // CAP: max penalty per occurrence is -120
    f1 += Math.max(-120, ocPenalty)
  }

  if (input.proprio && input.proprio.diasAtrasoAtual === 0) {
    if (input.proprio.mesesComoCliente >= 24) f1 += 35
    else if (input.proprio.mesesComoCliente >= 12) f1 += 20
    else if (input.proprio.mesesComoCliente >= 6) f1 += 10
  }

  // Equipment return bonus: if ALL occurrences in the network returned equipment
  const allEquipmentReturned = todasOcorrencias.length > 0 && todasOcorrencias.every(oc => oc.equipamentosDevolvidos !== false)
  if (allEquipmentReturned) f1 += 15
  f1 = Math.max(0, Math.min(300, f1))

  const f1_descricao = f1 >= 250
    ? 'Excelente historico de pagamento no setor ISP'
    : f1 >= 150 ? 'Historico de pagamento regular com alguns atrasos'
    : f1 >= 50 ? 'Historico de pagamento ruim — multiplos atrasos'
    : 'Historico critico — inadimplencia grave no setor ISP'

  // F2 — TEMPO NO SETOR ISP (0-200)
  const mesesProprio = input.proprio?.mesesComoCliente || 0
  const mesesRede = input.rede?.ocorrencias.reduce((acc, oc) => acc + (oc.mesesComoCliente || 0), 0) || 0
  const totalMeses = mesesProprio + mesesRede

  let f2: number
  if (totalMeses === 0) f2 = 0
  else if (totalMeses <= 3) f2 = 30
  else if (totalMeses <= 6) f2 = 60
  else if (totalMeses <= 12) f2 = 90
  else if (totalMeses <= 24) f2 = 120
  else if (totalMeses <= 36) f2 = 150
  else if (totalMeses <= 60) f2 = 175
  else f2 = 200

  const f2_descricao = totalMeses === 0
    ? 'Sem historico no setor ISP — cliente novo'
    : `${totalMeses} meses de historico no setor ISP`

  // F3 — INADIMPLENCIA ATIVA (0-250)
  let f3 = 250
  const inadimplentesAtivos = todasOcorrencias.filter(oc => oc.diasAtraso > 30)

  if (inadimplentesAtivos.length > 0) {
    f3 = 0
    for (const oc of inadimplentesAtivos) {
      if (oc.diasAtraso > 365) f3 -= 80
      else if (oc.diasAtraso > 180) f3 -= 60
      else if (oc.diasAtraso > 90) f3 -= 40
      else f3 -= 20
    }
    alertas.push(`${inadimplentesAtivos.length} ocorrencia(s) de inadimplencia ativa no setor ISP`)
    condicoesSugeridas.push('Exigir quitacao de pendencias anteriores antes de contratar')
  }
  f3 = Math.max(0, Math.min(250, f3))

  const f3_descricao = f3 === 250
    ? 'Sem inadimplencia ativa no setor ISP'
    : f3 > 100 ? 'Inadimplencia passada — situacao regularizada'
    : 'Inadimplencia ativa no setor ISP'

  // F4 — PADRAO DE CONSULTAS (0-100)
  let f4 = 100
  const consultas30d = input.rede?.consultasRecentes30d || 0
  const consultas90d = input.rede?.consultasRecentes90d || 0

  if (consultas30d >= 5) { f4 -= 50; alertas.push('5+ consultas de ISPs diferentes nos ultimos 30 dias') }
  else if (consultas30d >= 3) { f4 -= 20; alertas.push('3+ consultas de ISPs diferentes nos ultimos 30 dias') }
  if (consultas90d >= 12) { f4 -= 30; alertas.push('Alta frequencia de consultas — possivel busca desesperada por credito ISP') }
  else if (consultas90d >= 8) { f4 -= 20 }
  f4 = Math.max(0, Math.min(100, f4))

  const f4_descricao = consultas30d === 0
    ? 'Nenhuma consulta recente — padrao normal'
    : `${consultas30d} consulta(s) nos ultimos 30 dias`

  // F5 — RISCO DO ENDERECO (0-100)
  let f5 = 100
  const cpfsDistintos = input.endereco?.cpfsDistintosInadimplentes || 0

  if (cpfsDistintos === 0) {
    f5 = 100
  } else if (cpfsDistintos === 1) {
    f5 = 70
    alertas.push('Endereco com 1 ocorrencia de inadimplencia anterior')
    condicoesSugeridas.push('Verificar se e o mesmo morador ou troca de CPF')
  } else if (cpfsDistintos === 2) {
    f5 = 40
    alertas.push('Endereco com 2 CPFs distintos inadimplentes — suspeito de fraude')
    condicoesSugeridas.push('Exigir comprovante de residencia atualizado')
    condicoesSugeridas.push('Exigir pagamento antecipado (minimo 3 meses)')
  } else {
    f5 = 0
    alertas.push(`ALERTA ANTI-FRAUDE: ${cpfsDistintos} CPFs distintos inadimplentes neste endereco`)
    condicoesSugeridas.push('Endereco com alto historico de fraude — recomenda-se rejeitar')
  }

  const f5_descricao = cpfsDistintos === 0
    ? 'Endereco sem historico de inadimplencia'
    : `${cpfsDistintos} CPF(s) distintos com historico no endereco`

  // F6 — CONSISTENCIA CADASTRAL (0-50)
  let f6 = 0
  const cad = input.cadastro
  if (cad) {
    if (cad.nomeCompleto) f6 += 10
    if (cad.cpfValido) f6 += 15
    if (cad.emailValido) f6 += 10
    if (cad.telefoneValido) f6 += 10
    if (cad.enderecoCompleto) f6 += 5
  } else {
    f6 = 25
  }
  f6 = Math.min(50, f6)

  const f6_descricao = f6 >= 45
    ? 'Dados cadastrais completos e consistentes'
    : f6 >= 25 ? 'Dados cadastrais incompletos'
    : 'Dados cadastrais insuficientes'

  // SCORE FINAL
  const score = Math.max(0, Math.min(1000, Math.round(f1 + f2 + f3 + f4 + f5 + f6)))

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

  // Override: if there are ANY active delinquencies in the network (even mild),
  // downgrade from APROVAR to APROVAR COM ATENCAO to flag the risk
  const hasAnyDelinquency = todasOcorrencias.some(oc => oc.diasAtraso > 0)
  if (hasAnyDelinquency && sugestaoIA === 'APROVAR') {
    sugestaoIA = 'APROVAR COM ATENCAO'
    corIndicador = 'amarelo'
    nivelRisco = 'moderado'
    if (!condicoesSugeridas.some(s => s.includes('pendencia'))) {
      condicoesSugeridas.push('Cliente com pendencia financeira na rede ISP — monitorar')
    }
  }

  const score100 = Math.round(score / 10)

  return {
    score, score100, faixa,
    faixas100: { excelente: 71, bom: 51, baixo: 31, muito_baixo: 0 },
    nivelRisco, sugestaoIA, corIndicador,
    fatores: {
      f1_historicoPagamento: { pontos: f1, maximo: 300, peso: '30%', descricao: f1_descricao },
      f2_tempoSetor: { pontos: f2, maximo: 200, peso: '20%', descricao: f2_descricao },
      f3_inadimplenciaAtiva: { pontos: f3, maximo: 250, peso: '25%', descricao: f3_descricao },
      f4_padraoConsultas: { pontos: f4, maximo: 100, peso: '10%', descricao: f4_descricao },
      f5_riscoEndereco: { pontos: f5, maximo: 100, peso: '10%', descricao: f5_descricao },
      f6_consistenciaCadastral: { pontos: f6, maximo: 50, peso: '5%', descricao: f6_descricao },
    },
    alertas,
    condicoesSugeridas,
  }
}
