import { describe, it, expect } from 'vitest';
import {
  classificarCobertura, somenteCidadesDoMapa, type LinhaDaCarteira,
} from './cobertura-geo.service';

/**
 * A classificação com a carteira REAL da Amplinet (provedor 6), medida em
 * 04/09/2026: 9 municípios de base carregada — todos do Paraná, a região de
 * outro provedor — e 184 clientes fora do mapa numa região que nunca foi
 * carregada. É o cenário que a tela precisa saber contar.
 */

const EMBU_GUACU = '3515103';
const ITAPECERICA_DA_SERRA = '3522208';
const SAO_PAULO = '3550308';
const LONDRINA = '4113700';

const linha = (
  cidade: string | null, uf: string | null, clientes: number, semCoordenada = clientes,
): LinhaDaCarteira => ({ cidade, uf, clientes, semCoordenada });

describe('classificarCobertura', () => {
  it('colapsa as grafias da mesma cidade numa linha só', () => {
    const c = classificarCobertura([
      linha('EMBU-GUAÇU', 'SP', 100),
      linha('EMBU GUACU', 'SP', 23),
      linha('EMBUGUAÇU', 'SP', 5),
    ], new Set());

    expect(c.cidades).toBe(1);
    expect(c.semBase).toHaveLength(1);
    expect(c.semBase[0].municipio.ibge).toBe(EMBU_GUACU);
    expect(c.semBase[0].clientes).toBe(128);
    expect(c.semBase[0].grafias.sort()).toEqual(['EMBU GUACU', 'EMBU-GUAÇU', 'EMBUGUAÇU']);
    // "EMBUGUACU" e "EMBU GUACU" são chaves normalizadas diferentes; só o
    // município as junta. Sem a fusão, o IBGE seria consultado duas vezes pela
    // mesma cidade e a tela mostraria Embu-Guaçu duplicada.
    expect(c.semBase[0].chaves.sort()).toEqual(['embu guacu', 'embuguacu']);
  });

  it('separa o que já tem base do que falta baixar', () => {
    const c = classificarCobertura([
      linha('LONDRINA', 'PR', 800, 0),
      linha('EMBU-GUAÇU', 'SP', 120, 100),
    ], new Set([LONDRINA]));

    expect(c.comBase.map(x => x.municipio.nome)).toEqual(['Londrina']);
    expect(c.semBase.map(x => x.municipio.nome)).toEqual(['Embu-Guaçu']);
    expect(c.clientes).toBe(920);
    expect(c.semCoordenada).toBe(100);
  });

  it('a UF da maioria decide — 207 em SP contra 4 espalhadas', () => {
    // Sem isto, quatro cadastros com a UF errada mandariam baixar a base de
    // Minas e plotariam 207 clientes a 500 km da casa.
    const c = classificarCobertura([
      linha('ITAPECERICA DA SERRA', 'SP', 207),
      linha('ITAPECERICA DA SERRA', 'RN', 2),
      linha('ITAPECERICA DA SERRA', 'SE', 1),
      linha('ITAPECERICA DA SERRA', 'SC', 1),
    ], new Set());

    expect(c.semBase).toHaveLength(1);
    expect(c.semBase[0].municipio.ibge).toBe(ITAPECERICA_DA_SERRA);
    expect(c.semBase[0].municipio.uf).toBe('SP');
    expect(c.semBase[0].clientes).toBe(211);
  });

  it('a terceira lista é o relatório de qualidade do cadastro', () => {
    const c = classificarCobertura([
      linha('EMBU GAUCU', 'SP', 6),
      linha('SÃO PAUYLO', 'SP', 4),
      linha('PARQUE JANDAIA', 'SP', 9),
      linha('ITAP DA SERRA', 'SP', 3),
    ], new Set());

    expect(c.comBase).toHaveLength(0);
    expect(c.semBase).toHaveLength(0);
    // Ordenada por quantos clientes cada grafia prende.
    expect(c.semMunicipio.map(x => x.grafias[0]))
      .toEqual(['PARQUE JANDAIA', 'EMBU GAUCU', 'SÃO PAUYLO', 'ITAP DA SERRA']);
    expect(c.semMunicipio.every(x => x.motivo === 'nao_encontrada')).toBe(true);
  });

  it('sem UF no cadastro, o motivo é outro — e não é culpa do nome', () => {
    // "ITAPECERICA" sem UF pode ser SP ou MG; dizer "não existe" seria mentira,
    // e a correção que o provedor precisa fazer é outra.
    const c = classificarCobertura([linha('ITAPECERICA', null, 12)], new Set());
    expect(c.semMunicipio).toHaveLength(1);
    expect(c.semMunicipio[0].motivo).toBe('sem_uf');
  });

  it('aproveita a UF que o cadastro escreveu junto do nome', () => {
    const c = classificarCobertura([linha('ITAPECERICA DA SERRA SP', null, 12)], new Set());
    expect(c.semBase[0]?.municipio.ibge).toBe(ITAPECERICA_DA_SERRA);
  });

  it('limpa o que a integração sujou antes de resolver', () => {
    const c = classificarCobertura([
      linha('STRING:SAO PAULO', 'SP', 40),
      linha('SAO PAULO', 'SP', 60),
      linha('EMBU-GUACU,', 'SP', 10),
    ], new Set());

    const porIbge = new Map(c.semBase.map(x => [x.municipio.ibge, x]));
    expect(porIbge.get(SAO_PAULO)?.clientes).toBe(100);
    expect(porIbge.get(EMBU_GUACU)?.clientes).toBe(10);
  });

  it('cidade em branco não conta como cidade', () => {
    const c = classificarCobertura([linha('', 'SP', 5), linha(null, 'SP', 3)], new Set());
    expect(c.cidades).toBe(0);
    expect(c.clientes).toBe(0);
  });

  it('quem tem mais gente fora do mapa vem primeiro', () => {
    const c = classificarCobertura([
      linha('EMBU-GUAÇU', 'SP', 300, 10),
      linha('ITAPECERICA DA SERRA', 'SP', 50, 45),
      linha('SAO PAULO', 'SP', 20, 20),
    ], new Set());

    expect(c.semBase.map(x => x.municipio.nome))
      .toEqual(['Itapecerica da Serra', 'São Paulo', 'Embu-Guaçu']);
  });

  it('carrega o providerId no resultado — a medição é de um tenant', () => {
    expect(classificarCobertura([], new Set(), 6).providerId).toBe(6);
    expect(classificarCobertura([], new Set()).providerId).toBeNull();
  });
});

/**
 * O recorte que existe para os dois números da mesma tela não discordarem.
 *
 * A medição vira duas coisas: o que a tela anuncia ("N clientes esperam a base
 * de endereços de X") e a FILA de download do FTP do IBGE. Sem o recorte as
 * duas erram juntas — a tela promete que carregar a base põe no mapa gente que
 * o mapa não mostra de qualquer jeito, e a fila encabeça pela capital que o
 * provedor excluiu à mão, que é o CNEFE mais pesado do país.
 */
describe('somenteCidadesDoMapa', () => {
  const daCarteira = (
    providerId: number, cidade: string, clientes: number, semCoordenada = clientes,
  ): LinhaDaCarteira => ({ providerId, cidade, uf: 'SP', clientes, semCoordenada });

  it('a cidade que o provedor tirou do mapa sai da conta e da fila', () => {
    const linhas = [
      daCarteira(6, 'EMBU-GUAÇU', 96, 62),
      daCarteira(6, 'SAO PAULO', 40, 40),
    ];

    const so = somenteCidadesDoMapa(linhas, new Map([[6, ['São Paulo']]]));

    expect(so.map(l => l.cidade)).toEqual(['EMBU-GUAÇU']);
    // E o que a tela anuncia passa a ser só quem a base de fato destrava.
    const c = classificarCobertura(so, new Set(), 6);
    expect(c.semCoordenada).toBe(62);
  });

  it('cidade abaixo do piso de massa não é prometida ao provedor', () => {
    // Ela não vai ao mapa nem com a base carregada — anunciá-la seria repetir,
    // em escala menor, a frase verdadeira que levou à conclusão errada.
    const so = somenteCidadesDoMapa([
      daCarteira(6, 'EMBU-GUAÇU', 96),
      daCarteira(6, 'CAMPINAS', 3),
    ]);

    expect(so.map(l => l.cidade)).toEqual(['EMBU-GUAÇU']);
  });

  it('as grafias da mesma cidade somam antes de o piso ser aplicado', () => {
    // Sete grafias de 5 clientes são 35 clientes de uma praça, e não sete
    // endereços avulsos. Contar cada linha sozinha jogaria a cidade fora.
    const so = somenteCidadesDoMapa([
      daCarteira(6, 'EMBU-GUAÇU', 12),
      daCarteira(6, 'EMBU GUACU', 8),
      daCarteira(6, 'embu  guaçu', 5),
    ]);

    expect(so).toHaveLength(3);
  });

  it('o piso e a exclusão são de cada carteira, não da soma', () => {
    // Na passada da base inteira (o worker), a capital que um provedor excluiu
    // continua entrando se for praça de verdade de outro.
    const so = somenteCidadesDoMapa(
      [daCarteira(6, 'SAO PAULO', 40), daCarteira(9, 'SAO PAULO', 900)],
      new Map([[6, ['São Paulo']]]),
    );

    expect(so.map(l => l.providerId)).toEqual([9]);
  });
});
