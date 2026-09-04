import { describe, it, expect } from 'vitest';
import {
  limparNomeDeCidade, municipioUnicoNoPais, pareceNomeTruncadoNaUf,
  resolverMunicipioDaCidade, ufDominante, ufNoNomeDaCidade,
} from './municipio.service';

/**
 * Os casos abaixo são os MEDIDOS na carteira da Amplinet (provedor 6) em
 * 04/09/2026, quando 184 clientes estavam fora do mapa. Não são exemplos
 * inventados: cada um representa uma grafia que existe no cadastro do ERP dele.
 */

const EMBU_GUACU = '3515103';
const ITAPECERICA_DA_SERRA = '3522208';
const ITAPECERICA_MG = '3133501';
const SAO_PAULO = '3550308';

describe('limparNomeDeCidade', () => {
  it('tira o prefixo que a integração grudou', () => {
    expect(limparNomeDeCidade('STRING:SAO PAULO')).toBe('SAO PAULO');
  });

  it('tira a pontuação do fim', () => {
    expect(limparNomeDeCidade('EMBU-GUACU,')).toBe('EMBU-GUACU');
  });

  it('tira a UF grudada, com ou sem separador', () => {
    expect(limparNomeDeCidade('ITAPECERICA DA SERRA SP')).toBe('ITAPECERICA DA SERRA');
    expect(limparNomeDeCidade('Londrina - PR')).toBe('Londrina');
    expect(limparNomeDeCidade('Londrina/PR')).toBe('Londrina');
    expect(limparNomeDeCidade('SAO PAULO, SP')).toBe('SAO PAULO');
  });

  it('NÃO tira palavra de duas letras que não é UF — 10 municípios terminam assim', () => {
    // Sem esta guarda "Santa Fé/PR" virava "SANTA" e a tela acusava de errado
    // um cadastro que estava certo.
    expect(limparNomeDeCidade('SANTA FE')).toBe('SANTA FE');
    expect(limparNomeDeCidade('FRANCISCO SA')).toBe('FRANCISCO SA');
    expect(limparNomeDeCidade('PEDRO II')).toBe('PEDRO II');
    expect(limparNomeDeCidade('XANGRI-LA')).toBe('XANGRI-LA');
  });

  it('aguenta nulo e vazio', () => {
    expect(limparNomeDeCidade(null)).toBe('');
    expect(limparNomeDeCidade('   ')).toBe('');
  });
});

describe('resolverMunicipioDaCidade', () => {
  it('as três grafias de Embu-Guaçu caem no mesmo município', () => {
    for (const grafia of ['EMBU-GUAÇU', 'EMBU GUACU', 'EMBUGUAÇU']) {
      const m = resolverMunicipioDaCidade(grafia, 'SP');
      expect(m, grafia).not.toBeNull();
      expect(m!.ibge, grafia).toBe(EMBU_GUACU);
      expect(m!.uf, grafia).toBe('SP');
    }
  });

  it('"ITAPECERICA" com UF SP é Itapecerica DA SERRA, e nunca a de Minas', () => {
    const m = resolverMunicipioDaCidade('ITAPECERICA', 'SP');
    expect(m?.ibge).toBe(ITAPECERICA_DA_SERRA);
    expect(m?.uf).toBe('SP');
  });

  it('"ITAPECERICA" com UF MG continua sendo a de Minas — a UF é que decide', () => {
    expect(resolverMunicipioDaCidade('ITAPECERICA', 'MG')?.ibge).toBe(ITAPECERICA_MG);
  });

  it('"ITAPECERICA" sem UF não resolve nada', () => {
    // Foi assim que dois clientes de Itapecerica da Serra/SP viraram
    // Itapecerica/MG, com a base de Minas baixada e 500 km de erro em silêncio.
    expect(resolverMunicipioDaCidade('ITAPECERICA')).toBeNull();
    expect(resolverMunicipioDaCidade('ITAPECERICA', null)).toBeNull();
    expect(resolverMunicipioDaCidade('ITAPECERICA', '')).toBeNull();
    expect(resolverMunicipioDaCidade('ITAPECERICA', 'XX')).toBeNull();
  });

  it('a UF sozinha no campo de cidade não é cidade', () => {
    expect(resolverMunicipioDaCidade('SP', 'SP')).toBeNull();
  });

  it('bairro no campo de cidade não vira cidade', () => {
    expect(resolverMunicipioDaCidade('PARQUE JANDAIA', 'SP')).toBeNull();
  });

  it('erro de digitação não é adivinhado por semelhança', () => {
    expect(resolverMunicipioDaCidade('EMBU GAUCU', 'SP')).toBeNull();
    expect(resolverMunicipioDaCidade('SÃO PAUYLO', 'SP')).toBeNull();
    expect(resolverMunicipioDaCidade('ITAP DA SERRA', 'SP')).toBeNull();
  });

  it('resolve o que o ERP sujou: UF grudada, prefixo e pontuação', () => {
    expect(resolverMunicipioDaCidade('ITAPECERICA DA SERRA SP', 'SP')?.ibge).toBe(ITAPECERICA_DA_SERRA);
    expect(resolverMunicipioDaCidade('STRING:SAO PAULO', 'SP')?.ibge).toBe(SAO_PAULO);
    expect(resolverMunicipioDaCidade('EMBU-GUACU,', 'SP')?.ibge).toBe(EMBU_GUACU);
  });

  it('o nome cru salva o município cujo fim parece UF — "Sento Sé/BA"', () => {
    // O limpador tira o "SE" porque SE é uma UF de verdade; a segunda passada,
    // com o nome original, é quem acha a cidade.
    expect(resolverMunicipioDaCidade('SENTO SE', 'BA')?.nome).toBe('Sento Sé');
  });

  it('aguenta nulo e vazio', () => {
    expect(resolverMunicipioDaCidade(null, 'SP')).toBeNull();
    expect(resolverMunicipioDaCidade('   ', 'SP')).toBeNull();
  });
});

describe('ufDominante', () => {
  it('207 cadastros em SP decidem contra 4 espalhadas — o caso da Amplinet', () => {
    expect(ufDominante([['SP', 207], ['RN', 2], ['SE', 1], ['SC', 1]])).toBe('SP');
  });

  it('a ordem de chegada não muda o vencedor', () => {
    expect(ufDominante([['RN', 2], ['SC', 1], ['SP', 207], ['SE', 1]])).toBe('SP');
  });

  it('ignora o que não é UF e o que não tem cadastro', () => {
    expect(ufDominante([['sp', 3], ['', 99], ['ZZ', 99], ['SP', 0]])).toBe('SP');
  });

  it('empate não elege ninguém — não sabemos qual é', () => {
    expect(ufDominante([['SP', 5], ['MG', 5]])).toBeNull();
  });

  it('sem nenhuma UF válida, devolve null', () => {
    expect(ufDominante([])).toBeNull();
    expect(ufDominante([['', 10]])).toBeNull();
  });
});

describe('ufNoNomeDaCidade', () => {
  it('aproveita a UF que o cadastro escreveu no campo errado', () => {
    expect(ufNoNomeDaCidade('ITAPECERICA DA SERRA SP')).toBe('SP');
    expect(ufNoNomeDaCidade('Londrina - PR')).toBe('PR');
    expect(ufNoNomeDaCidade('EMBU-GUACU/SP,')).toBe('SP');
  });

  it('palavra de duas letras que não é UF não vira UF', () => {
    expect(ufNoNomeDaCidade('SANTA FE')).toBeNull();
    expect(ufNoNomeDaCidade('PEDRO II')).toBeNull();
  });

  it('sem sigla no fim, devolve null', () => {
    expect(ufNoNomeDaCidade('EMBU GUACU')).toBeNull();
    expect(ufNoNomeDaCidade(null)).toBeNull();
  });
});

/**
 * DUAS RÉGUAS, e a diferença entre elas custa caro.
 *
 * A expansão por prefixo é casamento por SEMELHANÇA. Para quem pergunta "qual
 * base do IBGE eu baixo?" ela erra barato — um download desperdiçado. Para quem
 * pergunta "o que eu gravo em `customers.city`?" ela reescreve o cadastro do
 * provedor sem caminho de volta, e o plotador leva o cliente para a cidade
 * inventada. São 2.763 expansões distintas resolvendo no país.
 */
describe('resolverMunicipioDaCidade — modo estrito', () => {
  const estrito = { estrito: true } as const;

  it('o nome colado continua resolvendo — é o conserto de "EMBUGUAÇU"', () => {
    expect(resolverMunicipioDaCidade('EMBUGUAÇU', 'SP', estrito)?.ibge).toBe(EMBU_GUACU);
    expect(resolverMunicipioDaCidade('EMBU-GUAÇU', 'SP', estrito)?.ibge).toBe(EMBU_GUACU);
  });

  it('a expansão por prefixo só vale na régua frouxa', () => {
    for (const [cidade, uf] of [
      ['ITAPECERICA', 'SP'], ['CAMPINA', 'SP'], ['ABREU', 'PE'], ['JANDAIA', 'PR'],
    ] as const) {
      expect(resolverMunicipioDaCidade(cidade, uf), cidade).not.toBeNull();
      expect(resolverMunicipioDaCidade(cidade, uf, estrito), cidade).toBeNull();
    }
  });

  it('os municípios terminados em palavra de duas letras resolvem SEM o prefixo', () => {
    /*
     * `normalizarCidade` corta um sufixo de duas letras depois de hífen achando
     * que é UF: "XANGRI-LA" virava "xangri". Antes isto passava despercebido
     * porque a expansão por prefixo salvava o caso — e sem ela o produto
     * acusaria de erro um cadastro correto.
     */
    expect(resolverMunicipioDaCidade('XANGRI-LA', 'RS', estrito)?.nome).toBe('Xangri-lá');
    expect(resolverMunicipioDaCidade('SENTO SE', 'BA', estrito)?.nome).toBe('Sento Sé');
    expect(resolverMunicipioDaCidade('SANTA FE', 'PR', estrito)?.nome).toBe('Santa Fé');
    expect(resolverMunicipioDaCidade('PEDRO II', 'PI', estrito)?.nome).toBe('Pedro II');
  });
});

describe('municipioUnicoNoPais e pareceNomeTruncadoNaUf', () => {
  it('nome inteiro e único no país é achado mesmo sem UF — é material de relatório', () => {
    expect(municipioUnicoNoPais('ITAPECERICA DA SERRA')?.ibge).toBe(ITAPECERICA_DA_SERRA);
    expect(municipioUnicoNoPais('SENTO SE')).toMatchObject({ nome: 'Sento Sé', uf: 'BA' });
  });

  it('nome que se repete no país não elege candidato', () => {
    // Há Bom Jesus em SC, PI, RS e mais. Apontar um seria sorteio.
    expect(municipioUnicoNoPais('BOM JESUS')).toBeNull();
    expect(municipioUnicoNoPais('EMBU GAUCU')).toBeNull();
  });

  it('distingue nome truncado de estado errado — são correções diferentes', () => {
    // "ITAPECERICA"/SP: o estado está certo e o nome foi escrito pela metade.
    expect(pareceNomeTruncadoNaUf('ITAPECERICA', 'SP')).toBe(true);
    expect(pareceNomeTruncadoNaUf('JANDAIA', 'PR')).toBe(true);
    // "ITAPECERICA DA SERRA"/RN: o nome está inteiro, quem não bate é o estado.
    expect(pareceNomeTruncadoNaUf('ITAPECERICA DA SERRA', 'RN')).toBe(false);
    expect(pareceNomeTruncadoNaUf('EMBU-GUAÇU', 'SP')).toBe(false);
  });

  it('sem UF legível não há o que dizer sobre truncamento', () => {
    expect(pareceNomeTruncadoNaUf('ITAPECERICA', null)).toBe(false);
    expect(pareceNomeTruncadoNaUf('ITAPECERICA', 'São Paulo')).toBe(false);
  });
});
