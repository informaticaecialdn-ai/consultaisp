import { describe, it, expect } from 'vitest';
import { escolherArea, normalizarCidade } from './area-atendida';

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

describe('normalizarCidade', () => {
  it('remove o sufixo de UF que cidadesAtendidas carrega', () => {
    expect(normalizarCidade('Abatiá - PR')).toBe('abatia');
    expect(normalizarCidade('Londrina - PR')).toBe('londrina');
  });

  it('remove acento, para casar com customers.city que vem sem', () => {
    expect(normalizarCidade('São Paulo')).toBe('sao paulo');
    expect(normalizarCidade('Sao Paulo')).toBe('sao paulo');
  });

  it('casa os dois formatos entre si — o bug que o dado de demo mascarava', () => {
    expect(normalizarCidade('Ibiporã - PR')).toBe(normalizarCidade('Ibipora'));
  });

  it('nao quebra com nulo ou vazio', () => {
    expect(normalizarCidade(null)).toBe('');
    expect(normalizarCidade(undefined)).toBe('');
  });

  it('preserva nome que termina em palavra de duas letras sem hifen', () => {
    expect(normalizarCidade('Xique-Xique')).toBe('xique-xique');
  });
});
