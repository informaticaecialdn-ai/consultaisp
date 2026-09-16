import { describe,it,expect } from 'vitest';
import { diagnosticarCliente,textoCorrompido } from './qualidade-cliente';
const agora=new Date('2026-09-15T12:00:00Z');
const cliente={nome:'João Gonçalves',telefone:'43999990000',email:null,lastSyncAt:'2026-09-15T11:00:00Z',dividaAtual:100,diasAtraso:10,contractStartDate:'2024-01-01'};
describe('diagnóstico sem inventar dados',()=>{
 it('preserva nomes acentuados válidos',()=>expect(textoCorrompido(cliente.nome)).toBe(false));
 it('detecta perda de caracteres e mojibake',()=>{expect(textoCorrompido('GON�‡ALVES')).toBe(true);expect(textoCorrompido('JoÃ£o')).toBe(true);});
 it('não acusa divergência por precisão decimal',()=>expect(diagnosticarCliente(cliente,agora,{dividaAtual:100.00000001,diasAtraso:10})).toEqual([]));
 it('detecta pagamento recente divergente',()=>expect(diagnosticarCliente(cliente,agora,{dividaAtual:0,diasAtraso:0})).toHaveLength(1));
 it('distingue ausência de data de sincronização antiga',()=>{expect(diagnosticarCliente({...cliente,lastSyncAt:null},agora)[0].titulo).toContain('sem data');expect(diagnosticarCliente({...cliente,lastSyncAt:'2026-09-10'},agora)[0].titulo).toContain('48 horas');});
});
