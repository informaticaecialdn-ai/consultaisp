export type AntiFraudAlert = {
  id: number;
  providerId: number;
  customerId: number | null;
  customerProviderId?: number;
  consultingProviderId: number | null;
  consultingProviderName: string | null;
  customerName: string | null;
  customerCpfCnpj: string | null;
  type: string;
  severity: string;
  message: string;
  riskScore: number | null;
  riskLevel: string | null;
  riskFactors: string[] | null;
  daysOverdue: number | null;
  overdueAmount: string | null;
  equipmentNotReturned: number | null;
  equipmentValue: string | null;
  recentConsultations: number | null;
  resolved: boolean;
  status: string;
  createdAt: string | null;
  /* Vem da regra de fuga (server/services/antifraude-rules.ts). O rótulo do
     card sai daqui, não de uma contagem de dias de atraso. */
  motivos?: string[];
  motivoLabel?: string;
  diasDeContrato?: number | null;
  /* A situação de HOJE do cliente, ao lado da foto que o alerta guardou:
     é o que diz se ele pagou ou saiu desde o aviso. */
  atual?: {
    contractStatus: string | null;
    daysOverdue: number;
    overdueAmount: string;
    emRisco: boolean;
  } | null;
  _source?: "fuga" | "proactive" | "legado";
};


export const valorSeguro = (valor: string | number | null | undefined) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
export function resumirAlertas(alertas: AntiFraudAlert[]) {
  const abertos = alertas.filter(a => !a.resolved && (a.status === "new" || a.status === "active"));
  const clientes = new Map<string, AntiFraudAlert>();
  for (const a of abertos) {
    if (a.customerProviderId !== undefined && a.customerProviderId !== a.providerId) continue;
    const chave = a.customerCpfCnpj?.replace(/\D/g, "") || (a.customerId ? String(a.customerId) : "alerta:" + a.id);
    const anterior = clientes.get(chave);
    if (!anterior || Date.parse(a.createdAt ?? "") > Date.parse(anterior.createdAt ?? "")) clientes.set(chave, a);
  }
  return {
    abertos: abertos.length, clientes: clientes.size,
    prioritarios: abertos.filter(a => ["critical", "high"].includes(a.severity)).length,
    divida: [...clientes.values()].reduce((s, a) => s + valorSeguro(a.atual ? a.atual.overdueAmount : a.overdueAmount), 0),
  };
}
