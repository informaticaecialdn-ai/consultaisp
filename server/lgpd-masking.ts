/**
 * LGPD data masking utilities for inter-provider data sharing.
 * When isSameProvider is true, full data is returned.
 * When false, data is partially masked per LGPD requirements.
 */

export function maskName(fullName: string, isSameProvider: boolean): string {
  if (isSameProvider) return fullName;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 1) return `${parts[0]} ***`;
  return fullName;
}

export function maskCpfCnpj(cpfCnpj: string, isSameProvider: boolean): string {
  if (isSameProvider) return cpfCnpj;
  const raw = cpfCnpj.replace(/\D/g, "");
  if (raw.length === 14) {
    // CNPJ: XX.***.***\/XXXX-**
    return `${raw.substring(0, 2)}.***.***/${raw.substring(8, 12)}-**`;
  }
  // CPF: XXX.***.***-**
  return `${raw.substring(0, 3)}.***.***-**`;
}

export function maskCep(rawCep: string, isSameProvider: boolean): string {
  const cleaned = rawCep.replace(/\D/g, "");
  if (isSameProvider) {
    if (cleaned.length >= 8) {
      return `${cleaned.slice(0, 5)}-${cleaned.slice(5, 8)}`;
    }
    return rawCep;
  }
  if (cleaned.length >= 5) {
    return `${cleaned.slice(0, 5)}-***`;
  }
  return rawCep;
}

export function maskAddress(address: string, isSameProvider: boolean): string {
  if (isSameProvider) return address;
  // Remove house number: digits after comma, or "n" followed by digits, or "nro" patterns
  return address
    .replace(/,\s*\d+/, "")
    .replace(/\b[Nn][ºo.]?\s*\d+/, "")
    .replace(/\s+\d+\s*$/, "")
    .trim();
}
