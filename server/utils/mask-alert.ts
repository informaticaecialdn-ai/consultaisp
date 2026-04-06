import { maskName, maskCpfCnpj } from "../services/lgpd-masking";
import { anonymizeProvider } from "./provider-anonymizer";

/**
 * V-03 LGPD: Masks cross-provider data in an alert.
 * - customerName/customerCpfCnpj masked when customer doesn't belong to authenticated provider
 * - consultingProviderName anonymized when consulting provider is not the authenticated one
 *
 * Uses `customerProviderId` (derived from customers table join) as the authoritative
 * ownership signal, not `alert.providerId` which could be ambiguous.
 */
export function maskAlertForProvider(alert: any, currentProviderId: number) {
  const isOwnCustomer = alert.customerProviderId === currentProviderId;
  const isOwnConsultation = alert.consultingProviderId === currentProviderId;

  return {
    ...alert,
    customerName: isOwnCustomer
      ? alert.customerName
      : (alert.customerName ? maskName(alert.customerName, false) : alert.customerName),
    customerCpfCnpj: isOwnCustomer
      ? alert.customerCpfCnpj
      : (alert.customerCpfCnpj ? maskCpfCnpj(alert.customerCpfCnpj, false) : alert.customerCpfCnpj),
    consultingProviderName: isOwnConsultation
      ? alert.consultingProviderName
      : (alert.consultingProviderName ? anonymizeProvider(alert.consultingProviderName) : alert.consultingProviderName),
  };
}
