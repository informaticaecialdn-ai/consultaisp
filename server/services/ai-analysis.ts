import OpenAI from "openai";
import { emModoDemo } from "../demo/modo-demo";

// Modelo configurável via env var. Default = DeepSeek (compatível com OpenAI SDK).
// Override possível: AI_ANALYSIS_MODEL="gpt-4o-mini" ou "deepseek-reasoner" etc.
const AI_MODEL = process.env.AI_ANALYSIS_MODEL || "deepseek-chat";

function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

const CONSULTATION_SYSTEM_PROMPT = `Voce e um analista de credito especialista em provedores de internet (ISPs) brasileiros. 
Analise os dados de consulta de inadimplencia ISP e forneca uma analise concisa, objetiva e acionavel em Portugues do Brasil.
Use linguagem profissional mas acessivel. Seja direto e pratico.
Estruture sua resposta com as seguintes secoes exatas (use os titulos em MAIUSCULO):

RESUMO EXECUTIVO
[2-3 frases descrevendo o perfil de risco do cliente]

PRINCIPAIS FATORES DE RISCO
[Liste de 2-5 pontos com os riscos especificos identificados]

ANALISE DE PADRAO
[1-2 paragrafos analisando se ha padrao de inadimplencia, fraude ou comportamento de risco]

CONDICOES RECOMENDADAS
[Liste de 3-5 condicoes especificas para contratacao ou recusa baseadas nos dados]

${'' /* Max 400 palavras total */}`;

const ANTIFRAUD_SYSTEM_PROMPT = `Voce e um especialista em prevencao de fraudes por migracao serial em provedores de internet (ISPs) brasileiros.

CONTEXTO DO PROBLEMA QUE VOCE ANALISA:
O principal tipo de fraude em ISPs brasileiros e o cliente "migrador serial": ele contrata o servico, nao paga a 1a, 2a ou 3a mensalidade e migra para outro provedor antes de ser cobrado efetivamente. O ciclo se repete em varios provedores. Cada ISP perde:
- O custo da instalacao (mao de obra + materiais)
- O equipamento em comodato (ONU/roteador, normalmente R$200-800)
- As mensalidades nao pagas (normalmente 1-3 meses)
O banco colaborativo de dados detecta quando um cliente inadimplente de um provedor e consultado por outro provedor (sinal de que esta tentando migrar).

TIPOS DE ALERTA QUE VOCE VAI ANALISAR:
- "defaulter_consulted" = Tentativa de Fuga: cliente inadimplente seu esta sendo prospectado por outro ISP
- "multiple_consultations" = Migrador Serial: CPF consultado por 3+ provedores em 30 dias — ciclo em andamento
- "equipment_risk" = Risco de Equipamento: cliente com equipamento pendente quer migrar — perda certa
- "recent_contract" = Contrato Recente: cliente com menos de 90 dias tentando migrar — padrao de golpe rapido

ESTRUTURE SUA RESPOSTA EM PORTUGUES DO BRASIL com as secoes em MAIUSCULO:

CENARIO DE MIGRACAO
[2-3 frases sobre a situacao atual — quantas tentativas de fuga, migradores, valor em risco]

PERFIS DE MAIOR RISCO
[2-3 clientes especificos mais preocupantes com motivo concreto — use nomes e valores dos dados]

PADRAO DE FRAUDE DETECTADO
[Descreva o ciclo de migracao que os dados revelam — quantas etapas, tempo medio, valor medio de perda]

ACOES URGENTES
[3-5 acoes concretas e especificas para os proximos dias — contatar quem, recuperar o que, bloquear como]

PREVENCAO FUTURA
[1-2 paragrafos sobre politicas para reduzir exposicao: cobranca antecipada, seguro de equipamento, clausula de fidelidade]

Use linguagem direta, profissional e objetiva. Maximo 600 palavras.`;

/** Data shape for ISP consultation analysis */
interface ConsultationAnalysisData {
  score: number;
  riskTier?: string;
  riskLabel?: string;
  recommendation?: string;
  decisionReco?: string;
  notFound?: boolean;
  penalties?: Array<{ reason: string; points: number }>;
  bonuses?: Array<{ reason: string; points: number }>;
  alerts?: string[];
  providerDetails?: Array<{
    customerName?: string;
    providerName?: string;
    isSameProvider?: boolean;
    status?: string;
    daysOverdue?: number;
    overdueAmount?: number;
    overdueAmountRange?: string;
    overdueInvoicesCount?: number;
    contractAgeDays?: number;
    hasUnreturnedEquipment?: boolean;
    unreturnedEquipmentCount?: number;
    equipmentPendingSummary?: string;
  }>;
  recommendedActions?: string[];
  cpfCnpj?: string;
}

/** Data shape for anti-fraud alert records */
interface AntiFraudAlert {
  type: string;
  status: string;
  customerName?: string;
  daysOverdue?: number;
  overdueAmount?: string;
  equipmentValue?: string;
  equipmentNotReturned?: number;
  consultingProviderName?: string;
  recentConsultations?: number;
}

/** Data shape for anti-fraud customer records */
interface AntiFraudCustomer {
  name?: string;
  riskScore: number;
  riskLevel: string;
  daysOverdue?: number;
  overdueAmount?: number;
  equipmentValue?: number;
  equipmentNotReturned?: number;
}

function buildConsultationPrompt(data: ConsultationAnalysisData): string {
  const { score, riskTier, riskLabel, recommendation, decisionReco, notFound,
    penalties, bonuses, alerts, providerDetails, recommendedActions, cpfCnpj } = data;

  if (notFound) {
    return `Consulta ISP realizada para o documento ${cpfCnpj}.
RESULTADO: Nenhum registro encontrado na base colaborativa ISP.
Score: 100/100 (sem ocorrencias)
Decisao: Aprovar
Por favor, analise este perfil sem historico negativo.`;
  }

  const customerName = providerDetails?.[0]?.customerName || "Cliente";
  const isSameProvider = providerDetails?.some((d: any) => d.isSameProvider);
  const hasMultipleProviders = (providerDetails?.filter((d: any) => !d.isSameProvider).length || 0) > 0;

  const detailsText = (providerDetails || []).map((d: any, i: number) => {
    const own = d.isSameProvider ? "(Seu proprio provedor)" : "(Outro provedor)";
    const eqInfo = d.hasUnreturnedEquipment
      ? `${d.unreturnedEquipmentCount} equipamento(s) nao devolvido(s)${d.equipmentPendingSummary ? ` - ${d.equipmentPendingSummary}` : ""}`
      : "Equipamentos em dia";
    return `  Provedor ${i + 1}: ${d.providerName} ${own}
    - Status: ${d.status}
    - Dias em atraso: ${d.daysOverdue}
    - Valor em aberto: ${d.overdueAmount ? `R$ ${d.overdueAmount.toFixed(2)}` : d.overdueAmountRange || "N/A"}
    - Faturas em atraso: ${d.overdueInvoicesCount}
    - Tempo de contrato: ${d.contractAgeDays} dias
    - Equipamentos: ${eqInfo}`;
  }).join("\n");

  const penaltiesText = (penalties || []).map((p: any) => `  - ${p.reason} (${p.points} pontos)`).join("\n");
  const bonusesText = (bonuses || []).map((b: any) => `  + ${b.reason} (+${b.points} pontos)`).join("\n");
  const alertsText = (alerts || []).map((a: string) => `  ! ${a}`).join("\n");

  return `DADOS DA CONSULTA ISP

Cliente: ${customerName}
Documento: ${cpfCnpj}
Score ISP: ${score}/100
Classificacao de Risco: ${riskLabel}
Decisao Recomendada: ${decisionReco === "Accept" ? "APROVAR" : decisionReco === "Review" ? "REVISAR" : "REJEITAR"}
Provedores encontrados: ${providerDetails?.length || 0}
Inadimplente em multiplos provedores: ${hasMultipleProviders ? "SIM" : "NAO"}
Cliente proprio do provedor: ${isSameProvider ? "SIM" : "NAO"}

DETALHES POR PROVEDOR:
${detailsText || "Nenhum detalhe disponivel"}

PENALIDADES APLICADAS:
${penaltiesText || "Nenhuma penalidade"}

BONUS APLICADOS:
${bonusesText || "Nenhum bonus"}

ALERTAS:
${alertsText || "Nenhum alerta"}

ACOES JA SUGERIDAS PELO SISTEMA:
${(recommendedActions || []).map((a: string) => `  - ${a}`).join("\n") || "Nenhuma"}

Analise estes dados e forneca sua avaliacao especializada.`;
}

function buildAntiFraudPrompt(alerts: AntiFraudAlert[], customers: AntiFraudCustomer[]): string {
  const activeAlerts = alerts.filter(a => a.status === "new");
  const fugaAlerts = activeAlerts.filter(a => a.type === "defaulter_consulted");
  const serialAlerts = activeAlerts.filter(a => a.type === "multiple_consultations");
  const equipmentAlerts = activeAlerts.filter(a => a.type === "equipment_risk");
  const criticalCustomers = customers.filter(c => c.riskScore >= 70);

  const totalOverdue = customers.reduce((s, c) => s + (c.overdueAmount || 0), 0);
  const totalEquipmentValue = customers.reduce((s, c) => s + (c.equipmentValue || 0), 0);
  const totalPrejuizoEmRisco = fugaAlerts.reduce((s, a) => s + parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0"), 0);

  const customersText = criticalCustomers.slice(0, 6).map(c => {
    const prejudizoTotal = (c.overdueAmount || 0) + (c.equipmentValue || 0);
    return `  - ${c.name} | Score: ${c.riskScore}/100 (${c.riskLevel.toUpperCase()}) | Atraso: ${c.daysOverdue} dias | Divida: R$ ${(c.overdueAmount || 0).toFixed(2)} | Equipamentos nao devolvidos: ${c.equipmentNotReturned} (R$ ${(c.equipmentValue || 0).toFixed(2)}) | Prejuizo potencial: R$ ${prejudizoTotal.toFixed(2)}`;
  }).join("\n");

  const fugaText = fugaAlerts.slice(0, 5).map(a => {
    const prejuizo = parseFloat(a.overdueAmount || "0") + parseFloat(a.equipmentValue || "0");
    return `  - TENTATIVA DE FUGA: ${a.customerName} | ${a.daysOverdue} dias sem pagar | Divida: R$ ${a.overdueAmount} | Equipamentos: ${a.equipmentNotReturned || 0} item(ns) (R$ ${a.equipmentValue || "0"}) | Consultando: ${a.consultingProviderName} | Prejuizo em risco: R$ ${prejuizo.toFixed(2)}`;
  }).join("\n");

  const serialText = serialAlerts.slice(0, 3).map(a => {
    return `  - MIGRADOR SERIAL: ${a.customerName} | Consultado por ${a.recentConsultations} provedores em 30 dias | ${a.daysOverdue} dias sem pagar em algum provedor`;
  }).join("\n");

  return `DADOS DE FRAUDE POR MIGRACAO — PROVEDOR ISP

SITUACAO ATUAL:
- Tentativas de fuga detectadas (clientes inadimplentes consultando outros ISPs): ${fugaAlerts.length}
- Migradores seriais (consultado por 3+ ISPs em 30 dias): ${serialAlerts.length}
- Clientes com equipamento em risco de perda: ${equipmentAlerts.length}
- Clientes com risco critico (score >= 70): ${criticalCustomers.length}
- Total de divida ativa na base: R$ ${totalOverdue.toFixed(2)}
- Valor total de equipamentos em risco: R$ ${totalEquipmentValue.toFixed(2)}
- Prejuizo imediato em risco (fuga iminente): R$ ${totalPrejuizoEmRisco.toFixed(2)}

TENTATIVAS DE FUGA ATIVAS (cliente inadimplente sendo consultado por outro ISP):
${fugaText || "Nenhuma tentativa de fuga ativa"}

MIGRADORES SERIAIS DETECTADOS:
${serialText || "Nenhum migrador serial identificado"}

CLIENTES COM RISCO CRITICO DE PERDA:
${customersText || "Nenhum cliente de risco critico"}

Analise estes dados com foco no ciclo de migracao serial e forneca recomendacoes praticas.`;
}

/**
 * O parecer SIMULADO da demonstração pública.
 *
 * A instância de demonstração não pode chamar o modelo: cada parecer custa
 * token na conta da plataforma e o visitante clica quantas vezes quiser. Mas o
 * botão "Analisar com IA" é parte do relatório, e sumir com ele esconde o
 * recurso. Então o parecer é MONTADO do próprio resultado da consulta — score,
 * decisão, penalidades, alertas, atraso, equipamento, ações sugeridas —, nas
 * mesmas quatro seções que o prompt pede ao modelo, e sai pelo MESMO stream.
 *
 * Determinístico de propósito: o mesmo relatório dá sempre o mesmo texto, sem
 * relógio e sem sorteio. A primeira linha diz que é simulado — um texto de
 * aparência de IA numa carteira fictícia, sem aviso, lê como o produto real.
 */
export function parecerSimulado(data: ConsultationAnalysisData): string {
  const decisao = data.decisionReco === "Accept" ? "aprovar" : data.decisionReco === "Review" ? "revisar" : "rejeitar";
  const detalhes = data.providerDetails ?? [];
  const comDivida = detalhes.filter(d => (d.daysOverdue ?? 0) > 0 || (d.overdueAmount ?? 0) > 0);
  const maiorAtraso = detalhes.reduce((m, d) => Math.max(m, d.daysOverdue ?? 0), 0);
  const outrosComDivida = comDivida.filter(d => !d.isSameProvider).length;
  const comEquipamento = detalhes.filter(d => d.hasUnreturnedEquipment).length;

  const linhas = [
    "Parecer simulado da demonstração: montado a partir do próprio relatório acima, sem modelo de IA.",
    "",
    "RESUMO EXECUTIVO",
  ];

  if (data.notFound) {
    linhas.push(
      `Documento sem nenhum registro na base colaborativa dos provedores. Score ${data.score}; decisão sugerida: aprovar.`,
      "",
      "PRINCIPAIS FATORES DE RISCO",
      "- Nenhuma ocorrência na rede — ausência de histórico não é prova de bom pagador.",
      "",
      "ANÁLISE DE PADRÃO",
      "Sem atraso, sem equipamento pendente e sem passagem por outro provedor da rede.",
      "",
      "CONDIÇÕES RECOMENDADAS",
      "- Contratação nas condições padrão.",
      "- Confirmar identidade e endereço de instalação antes do agendamento.",
    );
    return linhas.join("\n");
  }

  const nome = detalhes[0]?.customerName || "O cliente";
  linhas.push(
    `${nome} tem score ISP ${data.score}${data.riskLabel ? ` (${data.riskLabel})` : ""} e decisão sugerida: ${decisao}. `
      + `${detalhes.length} provedor(es) com registro, ${comDivida.length} com valor em aberto.`,
    "",
    "PRINCIPAIS FATORES DE RISCO",
  );
  const fatores = [
    ...(data.penalties ?? []).map(p => `- ${p.reason} (${p.points} pontos)`),
    ...(data.alerts ?? []).map(a => `- ${a}`),
  ].slice(0, 5);
  linhas.push(...(fatores.length > 0 ? fatores : ["- Nenhum fator de risco registrado no relatório."]));

  linhas.push("", "ANÁLISE DE PADRÃO");
  if (outrosComDivida >= 2) {
    linhas.push(`Há dívida em ${outrosComDivida} outros provedores da rede: é o desenho do migrador serial, que deixa o débito para trás a cada troca.`);
  } else if (comDivida.length > 0) {
    linhas.push(`Há valor em aberto, com maior atraso de ${maiorAtraso} dia(s).`);
  } else {
    linhas.push("Sem atraso registrado nos provedores consultados.");
  }
  if (comEquipamento > 0) {
    linhas.push(`Equipamento em comodato não devolvido em ${comEquipamento} provedor(es): o prejuízo não é só a mensalidade.`);
  }

  linhas.push("", "CONDIÇÕES RECOMENDADAS");
  const acoes = (data.recommendedActions ?? []).slice(0, 5).map(a => `- ${a}`);
  if (acoes.length > 0) linhas.push(...acoes);
  else if (decisao === "aprovar") linhas.push("- Contratação nas condições padrão.");
  else if (decisao === "revisar") linhas.push("- Exigir a primeira mensalidade na instalação.", "- Confirmar identidade e endereço antes do agendamento.");
  else linhas.push("- Não contratar enquanto houver débito em aberto na rede.");

  return linhas.join("\n");
}

export async function streamConsultationAnalysis(
  consultationData: ConsultationAnalysisData,
  onChunk: (text: string) => void
): Promise<void> {
  // Na demonstração o SDK nem é instanciado: o parecer sai do próprio
  // relatório, linha a linha, pelo mesmo `onChunk` que o stream do modelo usa.
  if (emModoDemo()) {
    for (const linha of parecerSimulado(consultationData).split("\n")) onChunk(`${linha}\n`);
    return;
  }

  const openai = getOpenAIClient();
  const prompt = buildConsultationPrompt(consultationData);

  const stream = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: CONSULTATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    stream: true,
    max_tokens: 700,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || "";
    if (text) onChunk(text);
  }
}

export async function streamAntiFraudAnalysis(
  alerts: AntiFraudAlert[],
  customers: AntiFraudCustomer[],
  onChunk: (text: string) => void
): Promise<void> {
  // Nenhuma tela chama esta analise hoje, mas a rota esta no ar para qualquer
  // provedor logado — o visitante da demonstracao incluso. Recusa sem tocar o
  // SDK; a rota transforma o erro no `data: { error }` do stream.
  if (emModoDemo()) {
    throw new Error("Nesta demonstração, a análise anti-fraude por IA não é processada.");
  }

  const openai = getOpenAIClient();
  const prompt = buildAntiFraudPrompt(alerts, customers);

  const stream = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: ANTIFRAUD_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    stream: true,
    max_tokens: 800,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || "";
    if (text) onChunk(text);
  }
}
