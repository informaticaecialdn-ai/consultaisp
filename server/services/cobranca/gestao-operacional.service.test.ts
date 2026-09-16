import { beforeEach,describe,it,expect,vi } from 'vitest';
const f=vi.hoisted(()=>({query:vi.fn(),tx:vi.fn(),release:vi.fn()}));
vi.mock('../../db',()=>({pool:{query:f.query,connect:async()=>({query:f.tx,release:f.release})}}));
import { comOrcamentoContato,abrirContestacao,resolverContestacao } from './gestao-operacional.service';
beforeEach(()=>{vi.clearAllMocks();f.query.mockResolvedValue({rows:[],rowCount:0});f.tx.mockImplementation(async(sql:string)=>{
 if(sql.includes('SELECT EXISTS'))return {rows:[{disputa:false,optout:false,pausado:false,promessa:false,hoje:0,semana:0}],rowCount:1};
 if(sql.includes('INSERT INTO cobranca_contatos_orcamento'))return {rows:[{id:8}],rowCount:1};
 return {rows:[],rowCount:0};
});});
describe('controle comum dos canais',()=>{
 it.each(['whatsapp','sms','email'] as const)('não chama %s quando há contestação',async canal=>{
  f.tx.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT EXISTS')?[{disputa:true,optout:false,pausado:false,promessa:false,hoje:0,semana:0}]:[],rowCount:1}));
  const enviar=vi.fn();await expect(comOrcamentoContato(7,9,canal,false,enviar)).rejects.toThrow(/contestação/);expect(enviar).not.toHaveBeenCalled();expect(f.tx).toHaveBeenCalledWith('ROLLBACK');expect(f.release).toHaveBeenCalled();
 });
 it('serializa reserva no cliente e mantém incerteza sem liberar orçamento',async()=>{
  await expect(comOrcamentoContato(7,9,'email',true,async()=>{throw Error('timeout')})).rejects.toThrow('timeout');
  expect(f.tx).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1,$2)',[7,9]);
  expect(f.query.mock.calls.at(-1)?.[0]).toContain("status='incerto'");
 });
 it('não repete chave já reservada',async()=>{
  f.tx.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT EXISTS')?[{disputa:false,optout:false,pausado:false,promessa:false,hoje:0,semana:0}]:[],rowCount:0}));
  const enviar=vi.fn();await expect(comOrcamentoContato(7,9,'sms',true,enviar,'mesma')).rejects.toThrow(/já foi registrada/);expect(enviar).not.toHaveBeenCalled();
 });
 it('não abre contestação para fatura de outro provedor',async()=>{
  await expect(abrirContestacao(7,3,{faturaId:42,motivo:'valor',relato:'Valor incorreto no título',responsavelId:3,prazo:'2026-10-01'})).rejects.toThrow(/Fatura/);
  expect(f.tx.mock.calls.find(c=>c[0].includes('FROM invoices'))?.[1]).toEqual([7,42]);
  expect(f.tx.mock.calls.some(c=>c[0].includes('INSERT INTO cobranca_contestacoes'))).toBe(false);
 });
 it('não resolve contestação de outro provedor',async()=>{
  await expect(resolverContestacao(7,3,42,{decisao:'improcedente',justificativa:'Validado junto ao ERP'})).rejects.toThrow(/não encontrada/);
  expect(f.tx.mock.calls.find(c=>c[0].includes('FROM cobranca_contestacoes'))?.[1]).toEqual([7,42]);
 });
});
