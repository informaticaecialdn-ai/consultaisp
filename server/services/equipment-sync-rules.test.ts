import { describe, it, expect } from 'vitest';
import { decidirAcaoSync, ehDevolvido } from './equipment-sync-rules';

const erp = (o: Record<string, any> = {}) => ({
  type: 'ONU', brand: 'Huawei', model: 'HG8245',
  serialNumber: 'ABC123', value: '290', inRecoveryProcess: false,
  status: 'retido', ...o,
});

const base = (o: Record<string, any> = {}) => ({
  id: 1, serialNumber: 'ABC123', status: 'installed', ...o,
});

describe('ehDevolvido', () => {
  it.each(['devolvido', 'DEVOLVIDO', 'returned', 'baixa', 'baixado'])(
    'reconhece "%s" como devolvido', (s) => {
      expect(ehDevolvido(s)).toBe(true);
    });

  it.each(['retido', 'em cobranca', 'installed', '', undefined])(
    'nao trata "%s" como devolvido', (s) => {
      expect(ehDevolvido(s)).toBe(false);
    });

  it('ignora espaco em volta', () => {
    expect(ehDevolvido('  Devolvido  ')).toBe(true);
  });
});

describe('decidirAcaoSync', () => {
  it('insere quando a serie nao existe na base', () => {
    expect(decidirAcaoSync(undefined, erp())).toBe('inserir');
  });

  it('marca devolvido quando o ERP confirma devolucao — excecao a "manual vence"', () => {
    expect(decidirAcaoSync(base(), erp({ status: 'devolvido' }))).toBe('marcar-devolvido');
  });

  it('nao toca quando o ERP diz retido e a linha ja existe — manual vence', () => {
    expect(decidirAcaoSync(base(), erp({ status: 'retido' }))).toBe('ignorar');
  });

  it('nao remarca o que ja esta devolvido na base', () => {
    expect(decidirAcaoSync(base({ status: 'devolvido' }), erp({ status: 'devolvido' }))).toBe('ignorar');
  });

  it('nao insere equipamento do ERP sem numero de serie', () => {
    expect(decidirAcaoSync(undefined, erp({ serialNumber: '' }))).toBe('ignorar');
  });

  it('nao insere quando a serie e so espaco', () => {
    expect(decidirAcaoSync(undefined, erp({ serialNumber: '   ' }))).toBe('ignorar');
  });

  it('nao sobrescreve marca e modelo digitados a mao — manual vence', () => {
    // O ERP mandando dado diferente nao autoriza escrita: a linha existe porque
    // alguem digitou, e o sync so pode corrigir para devolvido.
    const existente = base({ status: 'retido' });
    expect(decidirAcaoSync(existente, erp({ brand: 'ZTE', model: 'F660' }))).toBe('ignorar');
  });
});
