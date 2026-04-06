import { describe, it, expect } from 'vitest';
import { maskAlertForProvider } from '../utils/mask-alert';

const PROVIDER_A = 1;
const PROVIDER_B = 2;

function makeAlert(overrides: Record<string, any> = {}) {
  return {
    id: 100,
    providerId: PROVIDER_A,
    customerId: 10,
    consultingProviderId: PROVIDER_B,
    consultingProviderName: "ISP Beta Telecom",
    customerName: "Maria Silva Santos",
    customerCpfCnpj: "12345678901",
    customerProviderId: PROVIDER_A,
    type: "migrador_serial",
    severity: "high",
    message: "test alert",
    ...overrides,
  };
}

describe('maskAlertForProvider', () => {
  describe('own-customer alerts (customerProviderId === currentProviderId)', () => {
    it('returns full customerName when customer belongs to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_A);
      expect(result.customerName).toBe("Maria Silva Santos");
    });

    it('returns full customerCpfCnpj when customer belongs to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_A);
      expect(result.customerCpfCnpj).toBe("12345678901");
    });
  });

  describe('cross-provider alerts (customerProviderId !== currentProviderId)', () => {
    it('masks customerName when customer does not belong to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerName).toBe("Maria ***");
      expect(result.customerName).not.toBe("Maria Silva Santos");
    });

    it('masks customerCpfCnpj when customer does not belong to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerCpfCnpj).not.toBe("12345678901");
      expect(result.customerCpfCnpj).toContain("***");
    });

    it('anonymizes consultingProviderName when not the requesting provider', () => {
      const alert = makeAlert({ consultingProviderId: PROVIDER_B });
      const result = maskAlertForProvider(alert, PROVIDER_A);
      expect(result.consultingProviderName).toMatch(/^Provedor Parceiro #[A-F0-9]{4}$/);
      expect(result.consultingProviderName).not.toBe("ISP Beta Telecom");
    });

    it('preserves consultingProviderName when it IS the requesting provider', () => {
      const alert = makeAlert({ consultingProviderId: PROVIDER_B });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.consultingProviderName).toBe("ISP Beta Telecom");
    });
  });

  describe('edge cases', () => {
    it('handles null customerName gracefully', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A, customerName: null });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerName).toBeNull();
    });

    it('handles null customerCpfCnpj gracefully', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A, customerCpfCnpj: null });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerCpfCnpj).toBeNull();
    });

    it('uses customerProviderId for ownership, not alert.providerId', () => {
      // Scenario: alert.providerId differs from customerProviderId (e.g. customer transferred)
      const alert = makeAlert({
        providerId: PROVIDER_A,
        customerProviderId: PROVIDER_B, // customer now owned by B
      });
      // Provider B requests: should see unmasked (customer is theirs)
      const resultB = maskAlertForProvider(alert, PROVIDER_B);
      expect(resultB.customerName).toBe("Maria Silva Santos");
      expect(resultB.customerCpfCnpj).toBe("12345678901");

      // Provider A requests: should see masked (customer no longer theirs)
      const resultA = maskAlertForProvider(alert, PROVIDER_A);
      expect(resultA.customerName).toBe("Maria ***");
      expect(resultA.customerCpfCnpj).not.toBe("12345678901");
    });
  });
});
