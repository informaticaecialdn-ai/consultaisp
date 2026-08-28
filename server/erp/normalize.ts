/**
 * ERP Connector Engine — Normalization Utilities
 *
 * Shared helpers for cleaning and normalizing data from ERP APIs.
 * Used by all connector implementations to produce NormalizedErpCustomer records.
 */

import type { NormalizedErpCustomer } from "./types.js";

/** Strip all non-digit characters from a CPF or CNPJ string */
export function cleanCpfCnpj(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Strip non-digits from a CEP and pad to 8 characters */
export function cleanCep(raw: string): string {
  return raw.replace(/\D/g, "").padStart(8, "0");
}

/** Strip non-digits from a phone number */
export function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Monta uma data local, devolvendo `null` se os numeros nao formarem esse dia.
 *
 * `new Date(2026, 12, 32)` nao falha: rola para 01/02/2027. Um vencimento
 * corrompido viraria uma data futura valida e a fatura sumiria da cobranca
 * como se estivesse no prazo.
 */
function dataLocal(ano: number, mes: number, dia: number): Date | null {
  const d = new Date(ano, mes - 1, dia);
  const bate = d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
  return bate ? d : null;
}

/**
 * Dias decorridos desde o vencimento, COM SINAL — e `null` quando nao da para
 * saber (data ausente ou ilegivel).
 *
 * Existe porque `calculateDaysOverdue` colapsa tres coisas diferentes em `0`:
 * vence hoje, vence daqui a um mes, e nao sei quando vence. Quem so quer
 * medir atraso pode viver com isso; quem precisa DECIDIR se ha atraso, nao —
 * e foi assim que fatura a vencer virou inadimplencia de "1 dia".
 */
export function diasDesdeVencimento(dueDate: string | Date | null | undefined): number | null {
  if (!dueDate) return null;

  let due: Date;
  if (typeof dueDate === "string") {
    // Duas formas de data-so-dia chegam dos ERPs: DD/MM/AAAA (MK e a maioria
    // dos brasileiros) e AAAA-MM-DD. Ambas sao montadas como meia-noite LOCAL.
    //
    // A ISO precisa disso tanto quanto a BR: `new Date("2026-08-27")` e
    // meia-noite UTC, que em Brasilia ja e dia 26 — a fatura nascia com um dia
    // de atraso a mais. Sem regex de proposito: partir na barra e no traco le
    // melhor e nao esconde escape.
    const barra = dueDate.split("/");
    const traco = dueDate.split("-");
    let montada: Date | null;
    if (barra.length === 3 && barra[0].length === 2 && barra[2].length === 4) {
      montada = dataLocal(Number(barra[2]), Number(barra[1]), Number(barra[0]));
    } else if (traco.length === 3 && traco[0].length === 4) {
      montada = dataLocal(Number(traco[0]), Number(traco[1]), Number(traco[2].slice(0, 2)));
    } else {
      montada = new Date(dueDate);
    }
    if (!montada) return null;
    due = montada;
  } else {
    due = dueDate;
  }
  if (isNaN(due.getTime())) return null;

  // Comparacao por DIA, nao por instante: uma fatura que vence hoje as 00:00
  // nao esta "ha algumas horas em atraso".
  const meiaNoite = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dif = meiaNoite(new Date()) - meiaNoite(due);
  return Math.round(dif / 86_400_000);
}

/**
 * Calculate days overdue from a due date to now.
 * Returns 0 if due date is in the future or invalid.
 */
export function calculateDaysOverdue(dueDate: string | Date | null): number {
  return Math.max(0, diasDesdeVencimento(dueDate) ?? 0);
}

/**
 * Aggregate invoice-level rows into per-customer summaries.
 *
 * Groups by cpfCnpj, summing overdue amounts and taking the max days overdue.
 * The first occurrence of each customer provides name/contact fields.
 */
export function aggregateByCustomer(
  invoices: Array<{
    cpfCnpj: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    addressNumber?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cep?: string;
    latitude?: string;
    longitude?: string;
    amount: number;
    daysOverdue: number;
    erpSource: string;
  }>,
): NormalizedErpCustomer[] {
  const map = new Map<string, NormalizedErpCustomer>();

  for (const inv of invoices) {
    const key = inv.cpfCnpj;
    const existing = map.get(key);

    if (existing) {
      existing.totalOverdueAmount += inv.amount;
      existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, inv.daysOverdue);
      existing.overdueInvoicesCount = (existing.overdueInvoicesCount ?? 0) + 1;
      // Nem toda fatura do mesmo cliente carrega a coordenada da instalacao.
      // A primeira que carregar vale — descartar por chegar na segunda linha
      // deixaria o cliente fora do mapa por acidente de ordenacao.
      if (!existing.latitude && inv.latitude && inv.longitude) {
        existing.latitude = inv.latitude;
        existing.longitude = inv.longitude;
      }
    } else {
      map.set(key, {
        cpfCnpj: inv.cpfCnpj,
        name: inv.name,
        email: inv.email,
        phone: inv.phone,
        address: inv.address,
        addressNumber: inv.addressNumber,
        neighborhood: inv.neighborhood,
        city: inv.city,
        state: inv.state,
        cep: inv.cep,
        latitude: inv.latitude,
        longitude: inv.longitude,
        totalOverdueAmount: inv.amount,
        maxDaysOverdue: inv.daysOverdue,
        overdueInvoicesCount: 1,
        erpSource: inv.erpSource,
      });
    }
  }

  return Array.from(map.values());
}
