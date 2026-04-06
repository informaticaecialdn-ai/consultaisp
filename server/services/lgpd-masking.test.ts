import { describe, it, expect } from 'vitest';
import {
  maskName,
  maskCpfCnpj,
  maskCep,
  maskAddress,
  maskOverdueAmount,
  getOverdueAmountRange,
  maskDaysOverdue,
  maskOverdueInvoicesCount,
  maskServiceAge,
  maskCrossProviderDetail,
} from './lgpd-masking';

describe('maskName', () => {
  it('returns full name for same provider', () => {
    expect(maskName('Joao Silva Santos', true)).toBe('Joao Silva Santos');
  });

  it('returns first name + *** for cross provider', () => {
    expect(maskName('Joao Silva Santos', false)).toBe('Joao ***');
  });

  it('returns single name unchanged for cross provider', () => {
    expect(maskName('Joao', false)).toBe('Joao');
  });
});

describe('maskCpfCnpj', () => {
  it('returns full CPF for same provider', () => {
    expect(maskCpfCnpj('12345678901', true)).toBe('12345678901');
  });

  it('masks CPF for cross provider (11 digits)', () => {
    const result = maskCpfCnpj('12345678901', false);
    expect(result).toBe('123.***.***-**');
  });

  it('masks CNPJ for cross provider (14 digits)', () => {
    const result = maskCpfCnpj('12345678000190', false);
    expect(result).toBe('12.***.***/' + '0001-**');
  });
});

describe('maskCep', () => {
  it('returns full CEP for same provider', () => {
    expect(maskCep('12345678', true)).toBe('12345-678');
  });

  it('masks CEP for cross provider', () => {
    expect(maskCep('12345678', false)).toBe('12345-***');
  });
});

describe('maskAddress', () => {
  it('returns full address for same provider', () => {
    expect(maskAddress('Rua das Flores, 123', true)).toBe('Rua das Flores, 123');
  });

  it('strips house number for cross provider', () => {
    const result = maskAddress('Rua das Flores, 123', false);
    expect(result).toContain('Rua das Flores');
    expect(result).toContain('***');
    expect(result).not.toContain('123');
  });
});

describe('maskOverdueAmount', () => {
  it('returns exact amount for same provider', () => {
    expect(maskOverdueAmount(150, true)).toBe(150);
  });

  it('returns undefined for zero amount cross provider', () => {
    expect(maskOverdueAmount(0, false)).toBeUndefined();
  });

  it('returns range string for cross provider amount', () => {
    const result = maskOverdueAmount(150, false);
    expect(result).toBe('R$ 100 - R$ 200');
  });

  it('returns range for amount at boundary', () => {
    expect(maskOverdueAmount(100, false)).toBe('R$ 100 - R$ 200');
  });

  it('returns range for small amount', () => {
    expect(maskOverdueAmount(50, false)).toBe('R$ 0 - R$ 100');
  });

  it('returns range for large amount', () => {
    expect(maskOverdueAmount(1500, false)).toBe('R$ 1500 - R$ 1600');
  });
});

describe('getOverdueAmountRange', () => {
  it('returns "Sem debito" for 0', () => {
    expect(getOverdueAmountRange(0)).toBe('Sem debito');
  });

  it('returns "Ate R$ 100" for small amounts', () => {
    expect(getOverdueAmountRange(50)).toBe('Ate R$ 100');
  });

  it('returns "R$ 100 - R$ 300" for 200', () => {
    expect(getOverdueAmountRange(200)).toBe('R$ 100 - R$ 300');
  });

  it('returns "R$ 300 - R$ 500" for 400', () => {
    expect(getOverdueAmountRange(400)).toBe('R$ 300 - R$ 500');
  });

  it('returns "R$ 500 - R$ 1.000" for 700', () => {
    expect(getOverdueAmountRange(700)).toBe('R$ 500 - R$ 1.000');
  });

  it('returns "Acima de R$ 1.000" for large amounts', () => {
    expect(getOverdueAmountRange(2000)).toBe('Acima de R$ 1.000');
  });
});

describe('maskDaysOverdue', () => {
  it('returns "Em dia" for 0 days', () => {
    expect(maskDaysOverdue(0)).toBe('Em dia');
  });

  it('returns "1-30 dias" for days within 1-30', () => {
    expect(maskDaysOverdue(1)).toBe('1-30 dias');
    expect(maskDaysOverdue(30)).toBe('1-30 dias');
  });

  it('returns "31-60 dias" for days within 31-60', () => {
    expect(maskDaysOverdue(31)).toBe('31-60 dias');
    expect(maskDaysOverdue(60)).toBe('31-60 dias');
  });

  it('returns "61-90 dias" for days within 61-90', () => {
    expect(maskDaysOverdue(61)).toBe('61-90 dias');
    expect(maskDaysOverdue(90)).toBe('61-90 dias');
  });

  it('returns "90+ dias" for days above 90', () => {
    expect(maskDaysOverdue(91)).toBe('90+ dias');
    expect(maskDaysOverdue(365)).toBe('90+ dias');
  });
});

describe('maskOverdueInvoicesCount', () => {
  it('returns "Nenhuma" for 0 invoices', () => {
    expect(maskOverdueInvoicesCount(0)).toBe('Nenhuma');
  });

  it('returns "1-2 faturas" for 1-2 invoices', () => {
    expect(maskOverdueInvoicesCount(1)).toBe('1-2 faturas');
    expect(maskOverdueInvoicesCount(2)).toBe('1-2 faturas');
  });

  it('returns "3-5 faturas" for 3-5 invoices', () => {
    expect(maskOverdueInvoicesCount(3)).toBe('3-5 faturas');
    expect(maskOverdueInvoicesCount(5)).toBe('3-5 faturas');
  });

  it('returns "6+ faturas" for 6+ invoices', () => {
    expect(maskOverdueInvoicesCount(6)).toBe('6+ faturas');
    expect(maskOverdueInvoicesCount(20)).toBe('6+ faturas');
  });
});

describe('maskServiceAge', () => {
  it('returns "< 6 meses" for under 6 months', () => {
    expect(maskServiceAge(0)).toBe('< 6 meses');
    expect(maskServiceAge(5)).toBe('< 6 meses');
  });

  it('returns "6-12 meses" for 6-11 months', () => {
    expect(maskServiceAge(6)).toBe('6-12 meses');
    expect(maskServiceAge(11)).toBe('6-12 meses');
  });

  it('returns "1-2 anos" for 12-23 months', () => {
    expect(maskServiceAge(12)).toBe('1-2 anos');
    expect(maskServiceAge(23)).toBe('1-2 anos');
  });

  it('returns "2-3 anos" for 24-35 months', () => {
    expect(maskServiceAge(24)).toBe('2-3 anos');
    expect(maskServiceAge(35)).toBe('2-3 anos');
  });

  it('returns "> 3 anos" for 36+ months', () => {
    expect(maskServiceAge(36)).toBe('> 3 anos');
    expect(maskServiceAge(60)).toBe('> 3 anos');
  });
});

describe('maskCrossProviderDetail', () => {
  const sampleDetail = {
    customerName: 'Maria Santos Oliveira',
    cpfCnpj: '12345678901',
    address: 'Rua das Flores, 123, Centro',
    cep: '86000100',
    overdueAmount: 350,
    providerName: 'ISP Alpha',
    isSameProvider: false,
    status: 'Inadimplente',
    daysOverdue: 45,
    overdueInvoicesCount: 3,
    contractStartDate: '2024-01-01',
    contractAgeDays: 365,
    hasUnreturnedEquipment: true,
    unreturnedEquipmentCount: 1,
    equipmentPendingSummary: '1 ONU',
    contractStatus: 'active',
    phone: '43999998888',
    email: 'maria@email.com',
    planName: 'Fibra 300MB',
    lastPaymentDate: '2024-12-01',
    lastPaymentValue: 99.90,
    openAmountTotal: 500,
    openItems: [{ id: 1, value: 100 }],
  };

  it('returns object unchanged for same provider', () => {
    const result = maskCrossProviderDetail({ ...sampleDetail, isSameProvider: true }, true);
    expect(result.customerName).toBe('Maria Santos Oliveira');
    expect(result.cpfCnpj).toBe('12345678901');
    expect(result.phone).toBe('43999998888');
    expect(result.email).toBe('maria@email.com');
    expect(result.overdueAmount).toBe(350);
  });

  it('masks name for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    expect(result.customerName).toBe('Maria ***');
  });

  it('masks CPF for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    expect(result.cpfCnpj).toBe('123.***.***-**');
  });

  it('masks address for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    expect(result.address).not.toBe(sampleDetail.address);
    expect(result.address).toContain('***');
  });

  it('masks CEP for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    expect(result.cep).toBe('86000-***');
  });

  it('sets overdueAmount to undefined and adds range for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    expect(result.overdueAmount).toBeUndefined();
    expect(result.overdueAmountRange).toBe('R$ 300 - R$ 400');
  });

  it('strips sensitive fields for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    expect(result.phone).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.planName).toBeUndefined();
    expect(result.lastPaymentDate).toBeUndefined();
    expect(result.lastPaymentValue).toBeUndefined();
    expect(result.openAmountTotal).toBeUndefined();
    expect(result.openItems).toBeUndefined();
  });

  it('preserves non-sensitive fields for cross provider', () => {
    const result = maskCrossProviderDetail(sampleDetail, false);
    // LGPD: providerName is anonymized for cross-provider display
    expect(result.providerName).toMatch(/^Provedor Parceiro #[A-F0-9]{4}$/);
    expect(result.providerName).not.toBe('ISP Alpha');
    expect(result.status).toBe('Inadimplente');
    // LGPD: exact daysOverdue is stripped for cross-provider, replaced with qualitative range
    expect(result.daysOverdue).toBeUndefined();
    expect(result.daysOverdueRange).toBe('31-60 dias');
    // LGPD: exact overdueInvoicesCount is stripped for cross-provider, replaced with qualitative bracket
    expect(result.overdueInvoicesCount).toBeUndefined();
    expect(result.overdueInvoicesCountRange).toBe('3-5 faturas');
    expect(result.contractAgeDays).toBe(365);
    expect(result.hasUnreturnedEquipment).toBe(true);
    expect(result.unreturnedEquipmentCount).toBe(1);
    expect(result.equipmentPendingSummary).toBe('1 ONU');
    expect(result.contractStatus).toBe('active');
    expect(result.contractStartDate).toBe('2024-01-01');
  });
});
