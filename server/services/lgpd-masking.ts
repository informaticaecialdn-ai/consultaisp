/**
 * LGPD Masking Module
 *
 * Centralized masking functions for LGPD compliance.
 * Cross-provider data is masked to protect personal information.
 * Same-provider data passes through unmasked.
 */

import { getProviderDisplayName } from '../utils/provider-anonymizer';

/**
 * Masks a full name for cross-provider display.
 * Cross-provider: shows only first name + ***
 * Same-provider: returns full name unchanged.
 */
export function maskName(fullName: string, isSameProvider: boolean): string {
  if (isSameProvider) return fullName;
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ***` : fullName;
}

/**
 * Masks CPF (11 digits) or CNPJ (14 digits) for cross-provider display.
 * CPF: 123.***.***-**
 * CNPJ: 12.***.***\/XXXX-**
 * Same-provider: returns raw value unchanged.
 */
export function maskCpfCnpj(cpfCnpj: string, isSameProvider: boolean): string {
  if (isSameProvider) return cpfCnpj;
  const raw = cpfCnpj.replace(/\D/g, '');
  if (raw.length === 14) {
    return `${raw.substring(0, 2)}.***.***/${raw.substring(8, 12)}-**`;
  }
  return `${raw.substring(0, 3)}.***.***-**`;
}

/**
 * Masks CEP for cross-provider display.
 * Cross-provider: shows prefix only (XXXXX-***)
 * Same-provider: returns formatted CEP.
 */
export function maskCep(rawCep: string, isSameProvider: boolean): string {
  const clean = rawCep.replace(/\D/g, '');
  if (isSameProvider) {
    return clean.length === 8 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : rawCep;
  }
  if (clean.length >= 5) {
    return `${clean.slice(0, 5)}-***`;
  }
  return rawCep;
}

/**
 * Truncates a string to show only the first few characters + ***.
 * "Rua das Flores" → "Rua da***"
 */
function partialMask(value: string, visibleChars: number = 6): string {
  if (!value || value.length <= visibleChars) return '***';
  return value.substring(0, visibleChars) + '***';
}

/**
 * Masks address for cross-provider display.
 * Cross-provider: shows partial street, partial number, partial neighborhood, partial city, partial state.
 * Same-provider: returns full address unchanged.
 */
export function maskAddress(address: string, isSameProvider: boolean): string {
  if (isSameProvider) return address;

  const parts: string[] = [];

  // Split address by comma and mask each part partially
  const segments = address.split(',').map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    // If it's a number-only segment (house number), mask partially
    if (/^\d+$/.test(seg)) {
      parts.push(seg.length > 2 ? seg.substring(0, 2) + '**' : '**');
    } else {
      parts.push(partialMask(seg, Math.min(6, Math.ceil(seg.length * 0.5))));
    }
  }

  return parts.join(', ') || 'End. protegido';
}

/**
 * Masks overdue amount for cross-provider display.
 * Cross-provider: returns a range string (e.g. "R$ 100 - R$ 200")
 * Same-provider: returns exact amount.
 * Zero amount cross-provider: returns undefined (no debt to show).
 */
export function maskOverdueAmount(amount: number, isSameProvider: boolean): number | string | undefined {
  if (isSameProvider) return amount;
  if (amount === 0) return undefined;
  const floor = Math.floor(amount / 100) * 100;
  return `R$ ${floor} - R$ ${floor + 100}`;
}

/**
 * Masks exact service age (months) into a coarse bracket for cross-provider display.
 * Prevents cross-referencing exact tenure to identify customers.
 */
export function maskServiceAge(months: number): string {
  if (months < 6) return '< 6 meses';
  if (months < 12) return '6-12 meses';
  if (months < 24) return '1-2 anos';
  if (months < 36) return '2-3 anos';
  return '> 3 anos';
}

/**
 * Returns a human-readable range bracket for an overdue amount.
 * Used for the local-DB code path display.
 */
export function getOverdueAmountRange(amount: number): string {
  if (amount === 0) return 'Sem debito';
  if (amount <= 100) return 'Ate R$ 100';
  if (amount <= 300) return 'R$ 100 - R$ 300';
  if (amount <= 500) return 'R$ 300 - R$ 500';
  if (amount <= 1000) return 'R$ 500 - R$ 1.000';
  return 'Acima de R$ 1.000';
}

/**
 * Masks exact daysOverdue into a coarse qualitative range for cross-provider display.
 */
export function maskDaysOverdue(days: number): string {
  if (days <= 0) return 'Em dia';
  if (days <= 30) return '1-30 dias';
  if (days <= 60) return '31-60 dias';
  if (days <= 90) return '61-90 dias';
  return '90+ dias';
}

/**
 * Masks exact overdueInvoicesCount into a qualitative bracket for cross-provider display.
 */
export function maskOverdueInvoicesCount(count: number): string {
  if (count <= 0) return 'Nenhuma';
  if (count <= 2) return '1-2 faturas';
  if (count <= 5) return '3-5 faturas';
  return '6+ faturas';
}

/** Fields that are always preserved (not masked) in cross-provider detail */
const PRESERVED_FIELDS: string[] = [
  'providerName',
  'isSameProvider',
  'status',
  'contractStartDate',
  'contractAgeDays',
  'hasUnreturnedEquipment',
  'unreturnedEquipmentCount',
  'equipmentPendingSummary',
  'contractStatus',
];

const PRESERVED_SET: Record<string, boolean> = {};
PRESERVED_FIELDS.forEach((k) => { PRESERVED_SET[k] = true; });

/** Fields stripped entirely from cross-provider detail */
const STRIPPED_FIELDS: string[] = [
  'phone',
  'email',
  'planName',
  'lastPaymentDate',
  'lastPaymentValue',
  'openAmountTotal',
  'openItems',
  'daysOverdue',
  'overdueInvoicesCount',
];

const STRIPPED_SET: Record<string, boolean> = {};
STRIPPED_FIELDS.forEach((k) => { STRIPPED_SET[k] = true; });

/**
 * Masks an entire cross-provider detail object in one call.
 * Same-provider: passes through unchanged.
 * Cross-provider: applies all masking rules, strips sensitive fields.
 */
export function maskCrossProviderDetail(
  detail: Record<string, any>,
  isSameProvider: boolean,
): Record<string, any> {
  if (isSameProvider) return detail;

  const result: Record<string, any> = {};

  // Copy preserved fields
  PRESERVED_FIELDS.forEach((key) => {
    if (key in detail) {
      result[key] = detail[key];
    }
  });

  // Mask specific fields
  if (detail.customerName != null) {
    result.customerName = maskName(detail.customerName, false);
  }
  if (detail.cpfCnpj != null) {
    result.cpfCnpj = maskCpfCnpj(detail.cpfCnpj, false);
  }
  if (detail.address != null) {
    result.address = maskAddress(detail.address, false);
  }
  // Cross-provider: strip CEP entirely (city/state is enough)
  result.cep = undefined;
  // LGPD: Anonymize cross-provider name (use providerId for consistent ISP-XXXX code)
  if (detail.providerName != null) {
    result.providerName = getProviderDisplayName(detail.providerName, false, detail.providerId);
  }

  // LGPD: daysOverdue — convert exact days to qualitative range, strip exact value
  if (detail.daysOverdue != null) {
    result.daysOverdueRange = maskDaysOverdue(detail.daysOverdue);
  }
  result.daysOverdue = undefined;

  // LGPD: overdueInvoicesCount — convert exact count to qualitative bracket, strip exact value
  if (detail.overdueInvoicesCount != null) {
    result.overdueInvoicesCountRange = maskOverdueInvoicesCount(detail.overdueInvoicesCount);
  }
  result.overdueInvoicesCount = undefined;

  // Overdue amount: hide exact, show range
  if (detail.overdueAmount != null && detail.overdueAmount > 0) {
    result.overdueAmount = undefined;
    const floor = Math.floor(detail.overdueAmount / 100) * 100;
    result.overdueAmountRange = `R$ ${floor} - R$ ${floor + 100}`;
  } else {
    result.overdueAmount = undefined;
  }

  // RT-05: Service age — convert exact months to coarse bracket
  if (detail.serviceAgeMonths != null) {
    result.serviceAgeMonthsRange = maskServiceAge(detail.serviceAgeMonths);
    result.serviceAgeMonths = undefined;
  }

  // Stripped fields are explicitly set to undefined (not included)
  STRIPPED_FIELDS.forEach((key) => {
    result[key] = undefined;
  });

  // Copy any other fields not handled above (except stripped ones)
  const maskedKeys: Record<string, boolean> = {
    customerName: true, cpfCnpj: true, address: true, cep: true, city: true, state: true, overdueAmount: true, providerName: true, serviceAgeMonths: true, daysOverdue: true, overdueInvoicesCount: true,
  };
  Object.keys(detail).forEach((key) => {
    if (!(key in result) && !STRIPPED_SET[key] && !PRESERVED_SET[key] && !maskedKeys[key]) {
      result[key] = detail[key];
    }
  });

  return result;
}
