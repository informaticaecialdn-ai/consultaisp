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

  it('nome com hifen nao perde metade para a regra do sufixo de UF', () => {
    /**
     * O que este caso protege e a regex do sufixo: ela nao pode confundir o
     * hifen INTERNO de "Xique-Xique" com o " - BA" do fim e comer a segunda
     * metade do nome.
     *
     * O valor esperado mudou em 04/09/2026, junto com o conserto que fez hifen
     * e espaco darem a mesma chave: "EMBU-GUAÇU" do ERP tinha de casar com
     * "EMBU GUACU" do CNEFE, e 80 clientes da Amplinet estavam fora do mapa por
     * causa desse traco. A intencao do teste continua a mesma — nada do nome se
     * perde —, e as duas metades continuam aqui.
     */
    expect(normalizarCidade('Xique-Xique')).toBe('xique xique');
    expect(normalizarCidade('Xique-Xique - BA')).toBe('xique xique');
  });
});

/**
 * O HIFEN QUE TIRAVA 80 CLIENTES DO MAPA (04/09/2026).
 *
 * A Amplinet tinha 179 clientes fora do mapa e a tela dizia "carteira sem
 * geocodificacao". A base de enderecos de Embu-Guacu ESTAVA carregada, com
 * 20.651 pontos — o casador nao chegava nela porque o CNEFE do IBGE grava
 * "EMBU GUACU" e o cadastro do ERP grava "EMBU-GUAÇU". Um traco.
 *
 * O provedor leu isso como "o sistema nao plota", e nao havia nada na tela que
 * o levasse a pensar em grafia de cidade.
 */
describe("normalizarCidade — a mesma cidade escrita de varios jeitos", () => {
  it("hifen, espaco e espaco duplo dao a MESMA chave", () => {
    const alvo = normalizarCidade("EMBU GUACU");
    expect(normalizarCidade("EMBU-GUAÇU")).toBe(alvo);
    expect(normalizarCidade("Embu-Guaçu")).toBe(alvo);
    expect(normalizarCidade("EMBU  GUAÇU")).toBe(alvo);
    expect(normalizarCidade("  embu guacu  ")).toBe(alvo);
  });

  it("o sufixo de UF sai ANTES do hifen — senao o traco dele viraria espaco", () => {
    // Esta e a ordem que o codigo precisa manter: colapsar o hifen primeiro
    // transformaria " - PR" em " pr" e a regex do sufixo nao casaria mais,
    // deixando a UF grudada no nome da cidade.
    expect(normalizarCidade("Abatiá - PR")).toBe("abatia");
    expect(normalizarCidade("Embu-Guaçu - SP")).toBe("embu guacu");
    expect(normalizarCidade("São José dos Pinhais - PR")).toBe("sao jose dos pinhais");
  });

  it("nao funde cidades que sao mesmo diferentes", () => {
    expect(normalizarCidade("Embu das Artes")).not.toBe(normalizarCidade("Embu-Guaçu"));
    expect(normalizarCidade("Santo André")).not.toBe(normalizarCidade("Santo Antônio"));
  });

  it("nulo e vazio continuam vazios", () => {
    expect(normalizarCidade(null)).toBe("");
    expect(normalizarCidade(undefined)).toBe("");
    expect(normalizarCidade("   ")).toBe("");
  });
});
