import type { RealtimeQueryResult } from "./realtime-query.service";
import { hashAddressForNetwork } from "../utils/address-hash";
import { maskCrossProviderDetail } from "../lgpd-masking";

export interface AddressRiskScore {
  riskScore: number;
  cpfsDistintosInadimplentes: number;
  totalOcorrenciasEndereco: number;
  riskLevel: "baixo" | "moderado" | "alto" | "critico";
  alertas: string[];
}

export interface AddressGroupEntry {
  addressHash: string;
  cep: string;
  numero: string;
  complemento?: string;
  customers: Array<{
    cpfCnpj: string;
    name: string;
    providerName: string;
    providerId: number;
    isSameProvider: boolean;
    maxDaysOverdue: number;
    totalOverdueAmount: number;
    overdueInvoicesCount: number;
    status?: string;
  }>;
}

export interface AddressSearchResult {
  cep: string;
  logradouro?: string;
  addressGroups: AddressGroupEntry[];
  totalCustomersFound: number;
  totalProvidersResponded: number;
  risk: AddressRiskScore;
  erpSummary: {
    total: number;
    responded: number;
    failed: number;
    timedOut: number;
  };
}

export function groupCustomersByAddress(
  erpResults: RealtimeQueryResult[],
  consultingProviderId: number,
): Map<string, Omit<AddressGroupEntry, "addressHash"> & { addressHash: string }> {
  const groups = new Map<string, AddressGroupEntry>();

  for (const erp of erpResults) {
    if (!erp.ok) continue;
    for (const c of erp.customers) {
      const cep = c.cep?.replace(/\D/g, "");
      const numero = c.addressNumber;
      if (!cep || cep.length !== 8 || !numero) continue;

      let hash: string;
      try {
        hash = hashAddressForNetwork(cep, numero, c.complement);
      } catch {
        continue;
      }

      if (!groups.has(hash)) {
        groups.set(hash, {
          addressHash: hash,
          cep,
          numero,
          complemento: c.complement,
          customers: [],
        });
      }

      groups.get(hash)!.customers.push({
        cpfCnpj: c.cpfCnpj,
        name: c.name,
        providerName: erp.providerName,
        providerId: erp.providerId,
        isSameProvider: erp.providerId === consultingProviderId,
        maxDaysOverdue: c.maxDaysOverdue,
        totalOverdueAmount: c.totalOverdueAmount,
        overdueInvoicesCount: c.overdueInvoicesCount,
        status: c.status,
      });
    }
  }

  return groups;
}

export function calculateAddressRisk(
  groups: Map<string, AddressGroupEntry>,
): AddressRiskScore {
  const delinquentCpfs = new Set<string>();
  let totalOcorrencias = 0;
  const alertas: string[] = [];

  for (const [, group] of groups) {
    for (const c of group.customers) {
      if (c.maxDaysOverdue > 0) {
        delinquentCpfs.add(c.cpfCnpj.replace(/\D/g, ""));
        totalOcorrencias++;
      }
    }
  }

  const count = delinquentCpfs.size;
  let riskScore: number;
  let riskLevel: AddressRiskScore["riskLevel"];

  if (count === 0) {
    riskScore = 0;
    riskLevel = "baixo";
  } else if (count === 1) {
    riskScore = 25;
    riskLevel = "moderado";
    alertas.push("1 CPF com inadimplencia neste endereco");
  } else if (count === 2) {
    riskScore = 60;
    riskLevel = "alto";
    alertas.push(`${count} CPFs distintos com inadimplencia neste endereco`);
  } else {
    riskScore = 85;
    riskLevel = "critico";
    alertas.push(`${count} CPFs distintos com inadimplencia neste endereco — possivel endereco de alto risco`);
  }

  return {
    riskScore,
    cpfsDistintosInadimplentes: count,
    totalOcorrenciasEndereco: totalOcorrencias,
    riskLevel,
    alertas,
  };
}

export function buildAddressSearchResult(
  cep: string,
  erpResults: RealtimeQueryResult[],
  consultingProviderId: number,
): AddressSearchResult {
  const groups = groupCustomersByAddress(erpResults, consultingProviderId);
  const risk = calculateAddressRisk(groups);

  const addressGroups: AddressGroupEntry[] = [];
  for (const [, group] of groups) {
    // Apply LGPD masking to cross-provider customers
    const maskedCustomers = group.customers.map(c => {
      if (!c.isSameProvider) {
        const masked = maskCrossProviderDetail({
          providerName: c.providerName,
          isSameProvider: false,
          customerName: c.name,
          cpfCnpj: c.cpfCnpj,
          status: c.status || "",
          daysOverdue: c.maxDaysOverdue,
          overdueAmount: c.totalOverdueAmount,
          overdueInvoicesCount: c.overdueInvoicesCount,
        }, false);
        return { ...c, name: masked.customerName, cpfCnpj: masked.cpfCnpj, providerName: masked.providerName };
      }
      return c;
    });
    addressGroups.push({ ...group, customers: maskedCustomers });
  }

  let totalCustomers = 0;
  for (const g of addressGroups) totalCustomers += g.customers.length;

  return {
    cep,
    addressGroups,
    totalCustomersFound: totalCustomers,
    totalProvidersResponded: erpResults.filter(r => r.ok).length,
    risk,
    erpSummary: {
      total: erpResults.length,
      responded: erpResults.filter(r => r.ok).length,
      failed: erpResults.filter(r => !r.ok).length,
      timedOut: erpResults.filter(r => r.timedOut).length,
    },
  };
}
