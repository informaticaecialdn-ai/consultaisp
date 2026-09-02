import type { RealtimeQueryResult } from "./realtime-query.service";
import { saltDeRede } from "../utils/address-hash";
import { agruparPorEndereco, hashEndereco, chaveDeEndereco, mesmoEndereco, type ChaveEndereco } from "./endereco-chave";
import { maskCrossProviderDetail } from "./lgpd-masking";

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
  logradouro?: string;
  bairro?: string;
  cidade?: string;
  customers: Array<{
    cpfCnpj: string;
    name: string;
    providerName: string;
    /** So o proprio provedor mantem o id; o do parceiro nunca sai daqui. */
    providerId?: number;
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

/**
 * Agrupa os cadastros por IMOVEL — logradouro, numero, bairro e cidade.
 *
 * Era chaveado por CEP (`sha256(cep:numero)`) e descartava, em silencio, todo
 * cadastro sem CEP de 8 digitos. Medido em producao em 27/08/2026: 1.237 dos
 * 3.214 clientes da NsLink, 39% da carteira, nunca entravam no cruzamento. E
 * CEP errado e pior que ausente — em cidade pequena metade do cadastro carrega
 * o CEP geral do municipio, o que juntaria imoveis diferentes num grupo so.
 *
 * O endereco por extenso resolve os dois lados: "Av. Tiradentes" e "AVENIDA
 * TIRADENTES" casam, o numero grudado no logradouro ("Rua Mato Grosso, 1435 -
 * Centro, Londrina", como o MK devolve) e separado antes, e o CEP deixa de ser
 * requisito. Ver `endereco-chave.ts` para a regra do bairro.
 */
export function groupCustomersByAddress(
  erpResults: RealtimeQueryResult[],
  consultingProviderId: number,
): Map<string, AddressGroupEntry> {
  type Linha = {
    c: RealtimeQueryResult["customers"][0];
    providerName: string;
    providerId: number;
  };

  const linhas: Linha[] = [];
  for (const erp of erpResults) {
    if (!erp.ok) continue;
    for (const c of erp.customers) {
      linhas.push({ c, providerName: erp.providerName, providerId: erp.providerId });
    }
  }

  const salt = saltDeRede();
  const groups = new Map<string, AddressGroupEntry>();

  for (const grupo of agruparPorEndereco(linhas, l => l.c)) {
    const hash = hashEndereco(grupo.chave, salt);
    groups.set(hash, {
      addressHash: hash,
      cep: grupo.itens[0].c.cep?.replace(/\D/g, "") ?? "",
      numero: String(grupo.chave.numero),
      complemento: grupo.itens[0].c.complement,
      logradouro: grupo.chave.logradouro,
      bairro: grupo.chave.bairro || undefined,
      cidade: grupo.chave.cidade,
      customers: grupo.itens.map(l => ({
        cpfCnpj: l.c.cpfCnpj,
        name: l.c.name,
        providerName: l.providerName,
        providerId: l.providerId,
        isSameProvider: l.providerId === consultingProviderId,
        maxDaysOverdue: l.c.maxDaysOverdue,
        totalOverdueAmount: l.c.totalOverdueAmount,
        overdueInvoicesCount: l.c.overdueInvoicesCount,
        status: l.c.status,
      })),
    });
  }

  return groups;
}


/** Reconstroi a chave de endereco a partir de um grupo ja montado. */
function chaveDoGrupo(g: AddressGroupEntry): ChaveEndereco | null {
  return chaveDeEndereco({
    address: g.logradouro,
    addressNumber: g.numero,
    neighborhood: g.bairro,
    city: g.cidade,
    cep: g.cep,
  });
}

/**
 * @param documentoConsultado Excluído da conta.
 *
 *   O cruzamento responde "há MAIS alguém devendo neste endereço", e o titular
 *   não é "mais alguém": a dívida dele já entra no score pelo caminho próprio, e
 *   contá-la de novo aqui a pesaria duas vezes. Medido em produção em
 *   27/08/2026: consultando a Rua Mato Grosso, 1435, o único inadimplente do
 *   imóvel era o próprio consultado, e sem esta exclusão o endereço dele seria
 *   marcado como de risco por causa dele mesmo.
 */
export function calculateAddressRisk(
  groups: Map<string, AddressGroupEntry>,
  documentoConsultado?: string,
): AddressRiskScore {
  const delinquentCpfs = new Set<string>();
  let totalOcorrencias = 0;
  const alertas: string[] = [];
  const titular = (documentoConsultado ?? "").replace(/\D/g, "");

  groups.forEach((group) => {
    for (const c of group.customers) {
      const doc = c.cpfCnpj.replace(/\D/g, "");
      if (titular && doc === titular) continue;
      if (c.maxDaysOverdue > 0) {
        delinquentCpfs.add(doc);
        totalOcorrencias++;
      }
    }
  });

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

/**
 * @param alvo Endereço consultado. Quando informado, o risco é calculado SÓ
 *   sobre o imóvel dele.
 *
 *   Isto não é detalhe. A busca no ERP é por LOGRADOURO — precisa ser, porque
 *   filtrar por número no servidor perde metade dos vizinhos —, então volta a
 *   rua inteira. Sem recortar, o risco somava os inadimplentes de toda a rua e
 *   anunciava "3 CPFs com inadimplência NESTE ENDEREÇO". Medido em produção em
 *   27/08/2026 consultando a Rua Mato Grosso, 1435: os três devedores estavam
 *   nos números 590 e vizinhos, e o 1435 saía como "endereço de alto risco".
 *   Alarme falso numa decisão de crédito é tão caro quanto o alarme que falta.
 */
export function buildAddressSearchResult(
  cep: string,
  erpResults: RealtimeQueryResult[],
  consultingProviderId: number,
  alvo?: ChaveEndereco,
  documentoConsultado?: string,
): AddressSearchResult {
  const todos = groupCustomersByAddress(erpResults, consultingProviderId);

  // Só o imóvel consultado entra no risco. Os demais da rua continuam na
  // resposta como contexto, mas não pontuam.
  const groups = alvo
    ? new Map(Array.from(todos.entries()).filter(([, g]) =>
        chaveDoGrupo(g) !== null && mesmoEndereco(chaveDoGrupo(g)!, alvo)))
    : todos;

  const risk = calculateAddressRisk(groups, documentoConsultado);

  /* O titular sai da LISTA tambem, nao so da conta do risco.
     `calculateAddressRisk` ja o excluia, mas os grupos devolvidos aqui
     alimentam a secao "Verificacao por endereco" do relatorio — e la ele
     reaparecia, contado como "1 inadimplente no endereco" e rotulado
     "Possivel fraude por troca de documento". A propria pessoa nao e troca de
     documento, e a divida dela ja aparece na secao de ocorrencias: contar de
     novo aqui a pesa duas vezes e transforma um cliente comum em suspeito.
     O cruzamento responde "ha MAIS alguem devendo neste imovel", e o titular
     nao e "mais alguem". */
  const titular = (documentoConsultado ?? "").replace(/\D/g, "");
  const semTitular = (cs: AddressGroupEntry["customers"]) =>
    titular ? cs.filter(c => c.cpfCnpj.replace(/\D/g, "") !== titular) : cs;

  const addressGroups: AddressGroupEntry[] = [];
  groups.forEach((group) => {
    // Apply LGPD masking to cross-provider customers
    const maskedCustomers = semTitular(group.customers).map((c: AddressGroupEntry["customers"][0]) => {
      if (!c.isSameProvider) {
        const masked = maskCrossProviderDetail({
          providerName: c.providerName,
          providerId: c.providerId,
          isSameProvider: false,
          customerName: c.name,
          cpfCnpj: c.cpfCnpj,
          status: c.status || "",
          daysOverdue: c.maxDaysOverdue,
          overdueAmount: c.totalOverdueAmount,
          overdueInvoicesCount: c.overdueInvoicesCount,
        }, false, consultingProviderId);
        // Campo a campo, sem `...c`: o spread levava o providerId CRU do
        // parceiro junto com o nome ja anonimizado — e isso era gravado.
        return {
          cpfCnpj: masked.cpfCnpj,
          name: masked.customerName,
          providerName: masked.providerName,
          isSameProvider: false,
          maxDaysOverdue: c.maxDaysOverdue,
          totalOverdueAmount: c.totalOverdueAmount,
          overdueInvoicesCount: c.overdueInvoicesCount,
          status: c.status,
        };
      }
      return c;
    });
    // Imovel que so tinha o titular deixa de ser um grupo: sem ele nao sobra
    // nada para mostrar, e um grupo vazio na tela le como "achei algo aqui".
    if (maskedCustomers.length > 0) {
      addressGroups.push({ ...group, customers: maskedCustomers });
    }
  });

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
