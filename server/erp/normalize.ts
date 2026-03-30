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
 * Calculate days overdue from a due date to now.
 * Returns 0 if due date is in the future or invalid.
 */
export function calculateDaysOverdue(dueDate: string | Date | null): number {
  if (!dueDate) return 0;

  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (isNaN(due.getTime())) return 0;

  const now = new Date();
  const diffMs = now.getTime() - due.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
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
    city?: string;
    state?: string;
    cep?: string;
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
    } else {
      map.set(key, {
        cpfCnpj: inv.cpfCnpj,
        name: inv.name,
        email: inv.email,
        phone: inv.phone,
        address: inv.address,
        city: inv.city,
        state: inv.state,
        cep: inv.cep,
        totalOverdueAmount: inv.amount,
        maxDaysOverdue: inv.daysOverdue,
        overdueInvoicesCount: 1,
        erpSource: inv.erpSource,
      });
    }
  }

  return Array.from(map.values());
}
