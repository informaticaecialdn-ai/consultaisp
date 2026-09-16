import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),tx:vi.fn(),release:vi.fn(),trava:vi.fn()}));
vi.mock('../../db',()=>({pool:{query:mocks.query,connect:mocks.connect}}));
vi.mock('../../storage',()=>({storage:{}}));
vi.mock('../../storage/chat-autonomia.storage',()=>({autonomiaStorage:{}}));
vi.mock('./chat-trava',()=>({comTravaDoChat:mocks.trava}));
vi.mock('../cobranca/canais-comunicacao.service',()=>({enviarComunicacaoCobranca:vi.fn(),obterConfiguracaoCanais:vi.fn(),obterConfiguracaoCanaisInterna:vi.fn()}));
import { persistirRetornoMulticanal } from './chat-multicanal.service';
const destino={conversation_id:'conversa-9',customer_id:44,caso_id:71};
const email={canal:'email' as const,externalId:'email-externo',remetente:'cliente@example.com',destinatario:'chat+abc@respostas.example.com',texto:'Quero conversar',replyToken:'abc'};
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.query.mockResolvedValue({rows:[destino],rowCount:1});
 mocks.connect.mockResolvedValue({query:mocks.tx,release:mocks.release});
 mocks.trava.mockImplementation(async(_chave:string,fn:()=>Promise<unknown>)=>fn());
 mocks.tx.mockImplementation(async(sql:string)=>sql.startsWith('SELECT')?{rows:[destino],rowCount:1}:sql.startsWith('INSERT INTO chat_multicanal_mensagens')?{rows:[{id:1}],rowCount:1}:{rows:[],rowCount:1});
});
describe('persistência de resposta multicanal',()=>{
 it('desconhecido e vínculo ambíguo não recebem conversa nem alterações',async()=>{
  for(const rows of [[],[destino,{...destino,conversation_id:'outra'}]]){
   mocks.query.mockResolvedValueOnce({rows});
   expect(await persistirRetornoMulticanal(9,email)).toEqual({recebido:false});
  }
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.trava).not.toHaveBeenCalled();
 });
 it('usa trava comum, revalida tenant e pausa automação atomicamente',async()=>{
  expect(await persistirRetornoMulticanal(9,email)).toEqual({recebido:true});
  expect(mocks.trava).toHaveBeenCalledWith('autonomia:9:conversa-9',expect.any(Function));
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("p.status='active'"),[9,'email','abc','cliente@example.com']);
  const chamadas=mocks.tx.mock.calls;
  expect(chamadas[0][0]).toBe('BEGIN');
  expect(chamadas[1][0]).toContain('FOR UPDATE OF v,c');
  expect(chamadas.find(([sql])=>sql.startsWith('INSERT INTO chat_multicanal_mensagens'))?.[1]).toEqual([9,'conversa-9','email','Quero conversar',null,'retorno:email:email-externo','email-externo']);
  expect(chamadas.find(([sql])=>sql.startsWith('UPDATE chat_multicanal_config'))?.[1]).toEqual([9,'conversa-9']);
  expect(chamadas.find(([sql])=>sql.startsWith('INSERT INTO cobranca_preferencias_contato'))?.[1]).toEqual([9,44]);
  expect(chamadas.at(-1)?.[0]).toBe('COMMIT');
  expect(mocks.release).toHaveBeenCalledOnce();
 });
 it('duplicata não prolonga pausa nem reabre conversa',async()=>{
  mocks.tx.mockImplementation(async(sql:string)=>sql.startsWith('SELECT')?{rows:[destino],rowCount:1}:{rows:[],rowCount:0});
  expect(await persistirRetornoMulticanal(9,email)).toEqual({recebido:true,repetido:true});
  expect(mocks.tx.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
  expect(mocks.tx.mock.calls.at(-1)?.[0]).toBe('COMMIT');
 });
 it('trava ocupada exige retry; não perde resposta com 2xx',async()=>{
  mocks.trava.mockResolvedValue(null);
  await expect(persistirRetornoMulticanal(9,email)).rejects.toThrow('atualização');
  expect(mocks.connect).not.toHaveBeenCalled();
 });
 it('vínculo alterado antes da trava aborta recebimento',async()=>{
  mocks.tx.mockImplementation(async(sql:string)=>sql.startsWith('SELECT')?{rows:[{...destino,customer_id:99}],rowCount:1}:{rows:[],rowCount:0});
  expect(await persistirRetornoMulticanal(9,email)).toEqual({recebido:false});
  expect(mocks.tx.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
 });
 it('falha ao pausar causa rollback do recebimento e libera conexão',async()=>{
  mocks.tx.mockImplementation(async(sql:string)=>{
   if(sql.startsWith('UPDATE chat_multicanal_config'))throw new Error('banco indisponível');
   return {rows:[destino],rowCount:1};
  });
  await expect(persistirRetornoMulticanal(9,email)).rejects.toThrow('banco indisponível');
  expect(mocks.tx.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  expect(mocks.release).toHaveBeenCalledOnce();
 });
});
