import OpenAI from "openai";

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

const ANTIFRAUD_SYSTEM_PROMPT = `Voce e um especialista em prevencao de fraudes para provedores de internet (ISPs) brasileiros.
Analise os dados de risco e fraude fornecidos e apresente insights estrategicos em Portugues do Brasil.
Use linguagem profissional e objetiva. Foque em acoes praticas e imediatas.
Estruture sua resposta com as seguintes secoes exatas (use os titulos em MAIUSCULO):

CENARIO ATUAL DE RISCO
[2-3 frases descrevendo o nivel geral de risco da base do provedor]

PADROES DE FRAUDE IDENTIFICADOS
[Liste de 2-4 padroes detectados nos dados com detalhes especificos]

CLIENTES PRIORITARIOS
[Liste os 2-3 casos mais urgentes com justificativa]

ACOES IMEDIATAS RECOMENDADAS
[Liste de 3-5 acoes especificas com prazo sugerido (imediato/proxima semana/proximo mes)]

MEDIDAS PREVENTIVAS
[1-2 paragrafos com politicas preventivas para evitar novos casos]

${'' /* Max 500 palavras total */}`;

function buildConsultationPrompt(data: any): string {
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

function buildAntiFraudPrompt(alerts: any[], customers: any[]): string {
  const highRisk = customers.filter(c => c.riskScore >= 50);
  const criticalCustomers = customers.filter(c => c.riskScore >= 70);

  const customersText = customers.slice(0, 8).map(c => {
    return `  - ${c.name} | Score: ${c.riskScore}/100 | Nivel: ${c.riskLevel} | Atraso: ${c.daysOverdue} dias | Divida: R$ ${c.overdueAmount?.toFixed(2) || "0.00"} | Equipamentos nao devolvidos: ${c.equipmentNotReturned} | Fatores: ${c.riskFactors?.join(", ") || "Nenhum"}`;
  }).join("\n");

  const alertsText = alerts.slice(0, 5).map(a => {
    return `  - [${a.severity?.toUpperCase()}] ${a.customerName || "?"} | Tipo: ${a.type} | Score: ${a.riskScore} | Mensagem: ${a.message}`;
  }).join("\n");

  const totalOverdue = customers.reduce((s, c) => s + (c.overdueAmount || 0), 0);
  const totalEquipmentValue = customers.reduce((s, c) => s + (c.equipmentValue || 0), 0);

  return `DADOS DE RISCO E FRAUDE DO PROVEDOR

RESUMO GERAL:
- Total de clientes na base: ${customers.length}
- Clientes alto risco (score >= 50): ${highRisk.length}
- Clientes criticos (score >= 70): ${criticalCustomers.length}
- Total em divida ativa: R$ ${totalOverdue.toFixed(2)}
- Valor de equipamentos em risco: R$ ${totalEquipmentValue.toFixed(2)}
- Alertas ativos: ${alerts.filter(a => a.status === "new").length}
- Alertas totais: ${alerts.length}

CLIENTES COM MAIOR RISCO:
${customersText || "Nenhum cliente de alto risco"}

ALERTAS RECENTES:
${alertsText || "Nenhum alerta recente"}

Analise este cenario e forneca recomendacoes estrategicas para o provedor.`;
}

export async function streamConsultationAnalysis(
  consultationData: any,
  onChunk: (text: string) => void
): Promise<void> {
  const openai = getOpenAIClient();
  const prompt = buildConsultationPrompt(consultationData);

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
  alerts: any[],
  customers: any[],
  onChunk: (text: string) => void
): Promise<void> {
  const openai = getOpenAIClient();
  const prompt = buildAntiFraudPrompt(alerts, customers);

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
