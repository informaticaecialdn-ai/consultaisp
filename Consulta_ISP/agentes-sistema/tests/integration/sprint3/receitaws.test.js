// Milestone pos-M3: teste da integracao ReceitaWS (com fetch mockado).

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { freshDb, seedLead, canUseSqlite } = require('../../helpers/db');

beforeEach(() => {
  if (!canUseSqlite) return;
  freshDb();
  mockFetch.mockReset();
});

describe.skipIf(!canUseSqlite)('receitaws service', () => {
  it('valida CNPJ (DV check)', () => {
    const { isValidCnpj, normalizeCnpj } = require('../../../src/services/receitaws');
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false); // todos iguais
    // CNPJ valido conhecido (Magazine Luiza)
    expect(isValidCnpj('47.960.950/0001-21')).toBe(true);
  });

  it('lookup retorna dados da API quando status=OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        cnpj: '47.960.950/0001-21',
        nome: 'MAGAZINE LUIZA SA',
        fantasia: 'MAGAZINE LUIZA',
        situacao: 'ATIVA',
        porte: 'DEMAIS',
        municipio: 'FRANCA',
        uf: 'SP',
        atividade_principal: [{ code: '47.54-7-01', text: 'Comercio varejista' }],
        qsa: [{ nome: 'FREDERICO TRAJANO', qual: '49-Diretor' }]
      })
    });
    const receitaws = require('../../../src/services/receitaws');
    const r = await receitaws.lookup('47960950000121');
    expect(r.ok).toBe(true);
    expect(r.data.nome).toBe('MAGAZINE LUIZA SA');
    const s = receitaws.summarize(r.data);
    expect(s.razao_social).toBe('MAGAZINE LUIZA SA');
    expect(s.municipio).toBe('FRANCA');
    expect(s.atividade_principal).toContain('Comercio');
  });

  it('lookup retorna erro quando status=ERROR', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ERROR', message: 'CNPJ rejeitado' })
    });
    const receitaws = require('../../../src/services/receitaws');
    const r = await receitaws.lookup('11222333000181');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('receita_error');
  });

  it('lookup rejeita CNPJ com DV invalido sem chamar API', async () => {
    const receitaws = require('../../../src/services/receitaws');
    const r = await receitaws.lookup('11222333000199'); // DV errado
    expect(r.ok).toBe(false);
    expect(r.error).toBe('cnpj_dv_invalido');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe.skipIf(!canUseSqlite)('tool lookup_cnpj', () => {
  it('persiste dados no lead quando lead_id fornecido', async () => {
    const lead = seedLead({ telefone: '5511999990100' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        cnpj: '47.960.950/0001-21',
        nome: 'MAGAZINE LUIZA SA',
        fantasia: 'MAGALU',
        situacao: 'ATIVA',
        porte: 'DEMAIS',
        municipio: 'FRANCA',
        uf: 'SP',
        email: 'ri@magazineluiza.com.br',
        atividade_principal: [{ code: '47.54-7-01', text: 'Comercio varejista' }],
        qsa: []
      })
    });

    const tool = require('../../../src/tools/lookup_cnpj');
    const r = await tool.handler({ lead_id: lead.id, cnpj: '47960950000121' }, { agente: 'carlos' });
    expect(r.ok).toBe(true);
    expect(r.summary.razao_social).toBe('MAGAZINE LUIZA SA');

    const { getDb } = require('../../../src/models/database');
    const saved = getDb().prepare('SELECT cnpj, razao_social, situacao_receita, dados_receita FROM leads WHERE id = ?').get(lead.id);
    expect(saved.cnpj).toBe('47960950000121');
    expect(saved.razao_social).toBe('MAGAZINE LUIZA SA');
    expect(saved.situacao_receita).toBe('ATIVA');
    expect(saved.dados_receita).toContain('MAGAZINE');
  });

  it('usa cache do DB se dados_receita_at < 24h', async () => {
    const lead = seedLead({ telefone: '5511999990101' });
    const { getDb } = require('../../../src/models/database');
    getDb()
      .prepare(
        `UPDATE leads SET cnpj = ?, dados_receita = ?, dados_receita_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(
        '47960950000121',
        JSON.stringify({ status: 'OK', nome: 'CACHED CO', municipio: 'SP', uf: 'SP', atividade_principal: [{ text: 'varejo' }] }),
        lead.id
      );

    const tool = require('../../../src/tools/lookup_cnpj');
    const r = await tool.handler({ lead_id: lead.id }, { agente: 'carlos' });
    expect(r.ok).toBe(true);
    expect(r.cached).toBe('db');
    expect(r.summary.razao_social).toBe('CACHED CO');
    // NAO chamou API
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
