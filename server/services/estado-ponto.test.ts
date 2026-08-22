import { describe, it, expect } from 'vitest';
import { estadoDoPonto } from './estado-ponto';

const c = (o: Record<string, any> = {}) => ({
  status: 'active', totalOverdueAmount: '0', ...o,
});

describe('estadoDoPonto', () => {
  it('ativo sem divida e em dia', () => {
    expect(estadoDoPonto(c())).toBe('em_dia');
  });

  it('ativo com divida esta em cobranca', () => {
    expect(estadoDoPonto(c({ totalOverdueAmount: '150.00' }))).toBe('em_cobranca');
  });

  it('inativo com divida e ex-cliente com divida', () => {
    expect(estadoDoPonto(c({ status: 'inactive', totalOverdueAmount: '900' }))).toBe('ex_divida');
  });

  it('cancelled com divida tambem e ex-cliente com divida', () => {
    expect(estadoDoPonto(c({ status: 'cancelled', totalOverdueAmount: '900' }))).toBe('ex_divida');
  });

  it('inativo sem divida nao vira ex_divida', () => {
    expect(estadoDoPonto(c({ status: 'inactive' }))).toBe('em_dia');
  });

  it('suspenso tem estado proprio', () => {
    expect(estadoDoPonto(c({ status: 'suspended' }))).toBe('suspenso');
  });

  // O bug que motivou derivar de valor: payment_status tem dois vocabularios.
  it('ignora payment_status em faixa e usa o valor da divida', () => {
    expect(estadoDoPonto(c({ paymentStatus: '90+', totalOverdueAmount: '500' }))).toBe('em_cobranca');
    expect(estadoDoPonto(c({ paymentStatus: '90+', totalOverdueAmount: '0' }))).toBe('em_dia');
  });

  it('trata valor invalido como sem divida', () => {
    expect(estadoDoPonto(c({ totalOverdueAmount: 'abc' }))).toBe('em_dia');
    expect(estadoDoPonto(c({ totalOverdueAmount: null }))).toBe('em_dia');
  });
});
