import { describe, it, expect } from 'vitest';
import { escolherArea } from './area-atendida';

const cidadesDaMeso = (m: string[]) => m.includes('Norte Central Paranaense')
  ? ['Londrina', 'Ibiporã', 'Cambé'] : [];

describe('escolherArea', () => {
  it('usa cidadesAtendidas quando preenchido', () => {
    const r = escolherArea(['Londrina', 'Ibiporã'], ['Norte Central Paranaense'], 'PR', cidadesDaMeso);
    expect(r).toEqual({ cidades: ['Londrina', 'Ibiporã'], origem: 'cidades' });
  });

  it('cai para as cidades da mesorregiao quando cidadesAtendidas esta vazio', () => {
    const r = escolherArea([], ['Norte Central Paranaense'], 'PR', cidadesDaMeso);
    expect(r.origem).toBe('meso');
    expect(r.cidades).toEqual(['Londrina', 'Ibiporã', 'Cambé']);
  });

  it('cai para a UF quando nao ha cidade nem mesorregiao', () => {
    expect(escolherArea([], [], 'PR', cidadesDaMeso)).toEqual({ cidades: null, uf: 'PR', origem: 'uf' });
  });

  it('nao filtra quando nao ha cidade, meso nem UF — caso da NsLink hoje', () => {
    expect(escolherArea([], [], null, cidadesDaMeso)).toEqual({ cidades: null, uf: null, origem: 'nenhuma' });
  });

  it('trata null como vazio', () => {
    expect(escolherArea(null, null, null, cidadesDaMeso).origem).toBe('nenhuma');
  });

  it('cai para UF quando a mesorregiao nao resolve nenhuma cidade', () => {
    expect(escolherArea([], ['Mesorregiao Inexistente'], 'PR', cidadesDaMeso).origem).toBe('uf');
  });
});
