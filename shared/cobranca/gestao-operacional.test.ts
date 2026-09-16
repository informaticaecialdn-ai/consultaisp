import { describe, expect, it } from 'vitest';
import { avaliarContato, simularEconomia, taxaCoorte, ConfigGestaoSchema, PainelGestaoSchema } from './gestao-operacional';
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
  // O contrato de GET /api/cobranca/gestao mora aqui para o client não importar do server.
  it('o painel da gestão é um contrato compartilhado: aceita a resposta real e recusa a incompleta',()=>{
    const cliente={id:1,nome:'Maria',saldo:120,sincronizadoEm:null,saldoFaturas:120,aguardandoConfirmacao:0,pagamentosParciais:0,valorContestado:0,divergencia:false,syncPendente:true,elegivel:120,simulacao:simularEconomia({saldo:120,custo:0,probabilidade:50,margemMensal:0,meses:3,carteira:'ativo'})};
    const painel={config,carteira:'ativo',geradoEm:'2026-09-16T12:00:00.000Z',limites:{clientes:false,contestacoes:false,agenda:false,promessas:false},
      contestacoes:[{id:3,customerId:1,nome:'Maria',faturaId:9,valor:120,motivo:'valor',relato:'Cobrança em duplicidade',evidencia:'',prazo:'2026-09-20',status:'aberta',responsavel:'Operador',criadoEm:'2026-09-16T12:00:00.000Z',resolvidoEm:null,justificativa:null}],
      agenda:[{id:5,customerId:1,nome:'Maria',data:'2026-09-30',valor:60,status:'pendente',pagoEm:null,valorPago:null,acordoId:2}],
      promessas:[{customerId:1,nome:'Maria',data:'2026-09-18',registradaEm:'2026-09-16T12:00:00.000Z'}],
      diagnostico:[cliente],prioridades:[cliente],coortes:[{dias:7,elegiveis:2,regularizados:1}],
      resultados:{confirmado:0,faturasPagas:0,diasConferencia:null,parcelasVencidas:0,parcelasCumpridas:0},
      preventivo:{faturas:1,clientes:1,semTelefone:0,pausadas:0,avisadas:0,config:{ligada:false}},
      contatos:[{canal:'sms',tentativas:1,enviados:1,falhas:0,incertos:0}]};
    expect(PainelGestaoSchema.parse(painel)).toEqual(painel);
    expect(PainelGestaoSchema.safeParse({...painel,carteira:'ex_cliente',preventivo:null}).success).toBe(true);
    const {resultados:_r,...semResultados}=painel;
    expect(PainelGestaoSchema.safeParse(semResultados).success).toBe(false);
    expect(PainelGestaoSchema.safeParse({...painel,carteira:'outra'}).success).toBe(false);
  });
});
