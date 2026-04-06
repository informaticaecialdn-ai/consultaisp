/**
 * Validação algorítmica de CPF e CNPJ com dígitos verificadores.
 */

/**
 * Valida CPF com dígito verificador (algoritmo Receita Federal).
 */
export function validarCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  // Rejeita CPFs com todos os dígitos iguais (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;

  // Segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;

  return true;
}

/**
 * Valida CNPJ com dígito verificador (algoritmo Receita Federal).
 */
export function validarCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  // Primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weights1[i];
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;
  if (d1 !== parseInt(digits[12])) return false;

  // Segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weights2[i];
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;
  if (d2 !== parseInt(digits[13])) return false;

  return true;
}

/**
 * Valida CPF ou CNPJ automaticamente pelo comprimento.
 * Retorna { valid, type, cleaned } ou { valid: false, error }.
 */
export function validarCpfCnpj(input: string): { valid: true; type: "cpf" | "cnpj" | "cep"; cleaned: string } | { valid: false; error: string } {
  const cleaned = input.replace(/\D/g, "");

  if (cleaned.length === 8) {
    // CEP — sem validação de dígito (não tem)
    return { valid: true, type: "cep", cleaned };
  }

  if (cleaned.length === 11) {
    if (!validarCPF(cleaned)) return { valid: false, error: "CPF invalido: digitos verificadores incorretos" };
    return { valid: true, type: "cpf", cleaned };
  }

  if (cleaned.length === 14) {
    if (!validarCNPJ(cleaned)) return { valid: false, error: "CNPJ invalido: digitos verificadores incorretos" };
    return { valid: true, type: "cnpj", cleaned };
  }

  return { valid: false, error: "CPF/CNPJ invalido: deve ter 11 (CPF), 14 (CNPJ) ou 8 (CEP) digitos" };
}
