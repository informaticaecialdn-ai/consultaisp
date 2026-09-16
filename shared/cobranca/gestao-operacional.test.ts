import { describe, expect, it } from 'vitest';
import { avaliarContato, simularEconomia, taxaCoorte, ConfigGestaoSchema } from './gestao-operacional';
describe('gestão operacional da cobrança', () => {
  const config=ConfigGestaoSchema.parse({});
  const base={disputa:false,optout:false,pausado:false,promessa:false,hoje:0,semana:0,automatico:true};
  it('bloqueia todos os canais em contestação, inclusive o atendente',()=>{
    expect(avaliarContato({...base,disputa:true,automatico:false},config)).toMatch(/contestação/);
  });
  it('pausa iniciativa automática, mas permite resposta humana',()=>{
    expect(avaliarContato({...base,pausado:true},config)).toBeTruthy();
    expect(avaliarContato({...base,pausado:true,automatico:false},config)).toBeNull();
    expect(avaliarContato({...base,promessa:true},config)).toBeTruthy();
  });
  it('reserva inclui envios concorrentes no orçamento',()=>{
    expect(avaliarContato({...base,hoje:config.maxMensagensDia},config)).toMatch(/diário/);
    expect(avaliarContato({...base,semana:config.maxIniciativasSemana},config)).toMatch(/semanal/);
  });
  it('ex-cliente não recebe margem futura e cálculo é simulação',()=>{
    expect(simularEconomia({saldo:100,custo:10,probabilidade:50,margemMensal:20,meses:3,carteira:'ex_cliente'})).toEqual({recuperacaoEsperada:50,retencaoEstimada:0,resultado:40});
    expect(simularEconomia({saldo:100,custo:10,probabilidade:50,margemMensal:20,meses:3,carteira:'ativo'}).resultado).toBe(70);
  });
  it('sem denominador não inventa taxa e não aceita probabilidade inválida',()=>{
    expect(taxaCoorte(0,0)).toBeNull(); expect(taxaCoorte(2,4)).toBe(50);
    expect(()=>simularEconomia({saldo:100,custo:1,probabilidade:101,margemMensal:0,meses:0,carteira:'ativo'})).toThrow();
  });
});
