/**
 * Shared utility functions extracted from routes.ts
 * Used by multiple route modules.
 */

export function calculateIspScore(params: {
  maxDaysOverdue: number;
  totalOverdueAmount: number;
  unreturnedEquipmentCount: number;
  contractAgeDays: number;
  recentConsultationsCount: number;
  providersWithDebt: number;
  clientYears: number;
  neverLate: boolean;
  allEquipmentReturned: boolean;
}): { score: number; penalties: { reason: string; points: number }[]; bonuses: { reason: string; points: number }[] } {
  let score = 100;
  const penalties: { reason: string; points: number }[] = [];
  const bonuses: { reason: string; points: number }[] = [];

  if (params.maxDaysOverdue > 90) {
    penalties.push({ reason: "Atraso superior a 90 dias", points: -40 });
    score -= 40;
  } else if (params.maxDaysOverdue > 60) {
    penalties.push({ reason: "Atraso de 61-90 dias", points: -30 });
    score -= 30;
  } else if (params.maxDaysOverdue > 30) {
    penalties.push({ reason: "Atraso de 31-60 dias", points: -20 });
    score -= 20;
  } else if (params.maxDaysOverdue > 0) {
    penalties.push({ reason: "Atraso de 1-30 dias", points: -10 });
    score -= 10;
  }

  const amountPenalty = Math.floor(params.totalOverdueAmount / 100) * 5;
  if (amountPenalty > 0) {
    penalties.push({ reason: `R$ ${params.totalOverdueAmount.toFixed(2)} em aberto (-5 a cada R$100)`, points: -amountPenalty });
    score -= amountPenalty;
  }

  if (params.unreturnedEquipmentCount > 0) {
    const eqPenalty = params.unreturnedEquipmentCount * 15;
    penalties.push({ reason: `${params.unreturnedEquipmentCount} equipamento(s) nao devolvido(s)`, points: -eqPenalty });
    score -= eqPenalty;
  }

  if (params.contractAgeDays < 90) {
    penalties.push({ reason: "Contrato com menos de 3 meses", points: -15 });
    score -= 15;
  } else if (params.contractAgeDays < 180) {
    penalties.push({ reason: "Contrato com menos de 6 meses", points: -10 });
    score -= 10;
  }

  if (params.recentConsultationsCount > 3) {
    penalties.push({ reason: `Consultado por ${params.recentConsultationsCount} provedores nos ultimos 30 dias`, points: -20 });
    score -= 20;
  }

  if (params.providersWithDebt > 1) {
    penalties.push({ reason: "Divida em multiplos provedores", points: -25 });
    score -= 25;
  }

  if (params.clientYears >= 2 && params.maxDaysOverdue === 0) {
    bonuses.push({ reason: "Cliente ha mais de 2 anos (em dia)", points: 10 });
    score += 10;
  }

  if (params.neverLate) {
    bonuses.push({ reason: "Nunca atrasou pagamento", points: 15 });
    score += 15;
  }

  if (params.allEquipmentReturned) {
    bonuses.push({ reason: "Equipamentos sempre devolvidos", points: 5 });
    score += 5;
  }

  return { score: Math.max(0, Math.min(100, score)), penalties, bonuses };
}

export function getRiskTier(score: number): { tier: string; label: string; recommendation: string } {
  if (score >= 80) return { tier: "low", label: "BAIXO RISCO", recommendation: "Aprovar" };
  if (score >= 50) return { tier: "medium", label: "MEDIO RISCO", recommendation: "Aprovar com cautela" };
  if (score >= 25) return { tier: "high", label: "ALTO RISCO", recommendation: "Exigir garantias" };
  return { tier: "critical", label: "CRITICO", recommendation: "Rejeitar" };
}

export function getDecisionReco(score: number): string {
  if (score >= 80) return "Accept";
  if (score >= 50) return "Review";
  return "Reject";
}

export function getOverdueAmountRange(amount: number): string {
  if (amount === 0) return "Sem debito";
  if (amount <= 100) return "Ate R$ 100";
  if (amount <= 300) return "R$ 100 - R$ 300";
  if (amount <= 500) return "R$ 300 - R$ 500";
  if (amount <= 1000) return "R$ 500 - R$ 1.000";
  return "Acima de R$ 1.000";
}

export function getRecommendedActions(score: number, hasUnreturnedEquipment: boolean): string[] {
  const actions: string[] = [];
  if (score < 25) {
    actions.push("Exigir pagamento antecipado (3-6 meses)");
    actions.push("Nao fornecer equipamento em comodato");
    actions.push("Contrato com multa de fidelidade");
    actions.push("Solicitar fiador/avalista");
  } else if (score < 50) {
    actions.push("Exigir pagamento antecipado (1-3 meses)");
    if (hasUnreturnedEquipment) actions.push("Nao fornecer equipamento em comodato");
    actions.push("Contrato com multa de fidelidade");
  } else if (score < 80) {
    actions.push("Monitorar pagamentos nos primeiros 3 meses");
    actions.push("Considerar contrato com fidelidade");
  }
  return actions;
}

export async function testErpConnection(source: string, apiUrl: string, apiUser: string, apiToken: string): Promise<{ ok: boolean; message: string }> {
  const base = apiUrl.replace(/\/+$/, "");
  try {
    if (source === "ixc") {
      const auth = Buffer.from(`${apiUser}:${apiToken}`).toString("base64");
      const r = await fetch(`${base}/webservice/v1/`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json", "ixcsoft": "listar" },
        body: JSON.stringify({ qtype: "fn_areceber.id", query: "1", oper: "=", page: "1", rp: "1", sortname: "fn_areceber.id", sortorder: "asc" }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok || r.status === 200) return { ok: true, message: "Conexao com iXC Soft estabelecida com sucesso" };
      return { ok: false, message: `iXC respondeu com status ${r.status}` };
    }
    if (source === "mk") {
      const r = await fetch(`${base}/api/v1/clientes?limit=1`, {
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return { ok: true, message: "Conexao com MK Solutions estabelecida com sucesso" };
      return { ok: false, message: `MK Solutions respondeu com status ${r.status}` };
    }
    if (source === "sgp") {
      const r = await fetch(`${base}/api/clientes?limit=1`, {
        headers: { "Authorization": `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return { ok: true, message: "Conexao com SGP estabelecida com sucesso" };
      return { ok: false, message: `SGP respondeu com status ${r.status}` };
    }
    const r = await fetch(`${base}/`, { headers: { "Authorization": `Bearer ${apiToken}` }, signal: AbortSignal.timeout(8000) });
    return r.ok ? { ok: true, message: "Conexao estabelecida" } : { ok: false, message: `ERP respondeu com status ${r.status}` };
  } catch (err: any) {
    if (err.name === "TimeoutError") return { ok: false, message: "Timeout: o ERP nao respondeu em 8 segundos" };
    return { ok: false, message: `Erro de conexao: ${err.message}` };
  }
}

export async function fetchErpCustomers(source: string, apiUrl: string, apiUser: string, apiToken: string): Promise<{ ok: boolean; message: string; customers: any[] }> {
  const base = apiUrl.replace(/\/+$/, "");
  try {
    if (source === "ixc") {
      const auth = Buffer.from(`${apiUser}:${apiToken}`).toString("base64");
      const r = await fetch(`${base}/webservice/v1/`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json", "ixcsoft": "listar" },
        body: JSON.stringify({ qtype: "fn_areceber.status", query: "A", oper: "=", page: "1", rp: "1000", sortname: "fn_areceber.id", sortorder: "asc" }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) return { ok: false, message: `iXC respondeu com status ${r.status}`, customers: [] };
      const json: any = await r.json();
      const rows: any[] = json?.registros || json?.records || [];
      const now = new Date();
      const customers = rows
        .filter((row: any) => row.vencimento && new Date(row.vencimento) < now)
        .map((row: any) => ({
          cpfCnpj: row.cpf_cnpj || row.cnpj_cpf || "",
          name: row.razao || row.nome || "",
          email: row.email || "",
          phone: row.fone || row.telefone || "",
          totalOverdueAmount: parseFloat(row.valor || "0"),
          maxDaysOverdue: Math.floor((now.getTime() - new Date(row.vencimento).getTime()) / 86400000),
          erpSource: "ixc",
        }));
      return { ok: true, message: `${customers.length} inadimplentes encontrados`, customers };
    }
    if (source === "mk") {
      const r = await fetch(`${base}/api/v1/financeiro/inadimplentes?limit=1000`, {
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) return { ok: false, message: `MK Solutions respondeu com status ${r.status}`, customers: [] };
      const json: any = await r.json();
      const rows: any[] = Array.isArray(json) ? json : json?.data || json?.clientes || [];
      const customers = rows.map((row: any) => ({
        cpfCnpj: row.cpf_cnpj || row.cpf || row.cnpj || "",
        name: row.nome || row.razao_social || "",
        email: row.email || "",
        phone: row.telefone || row.fone || "",
        totalOverdueAmount: parseFloat(row.valor_total || row.saldo_devedor || "0"),
        maxDaysOverdue: parseInt(row.dias_atraso || row.atraso_dias || "0"),
        erpSource: "mk",
      }));
      return { ok: true, message: `${customers.length} inadimplentes encontrados`, customers };
    }
    return { ok: false, message: `Sincronizacao automatica para ${source} ainda nao implementada. Use a importacao manual.`, customers: [] };
  } catch (err: any) {
    if (err.name === "TimeoutError") return { ok: false, message: "Timeout: o ERP nao respondeu em 30 segundos", customers: [] };
    return { ok: false, message: `Erro de conexao: ${err.message}`, customers: [] };
  }
}
