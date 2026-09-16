import { describe,it,expect } from 'vitest';
import { lerComunicacaoConfig,motivoExclusaoComunicacao,destinatarioComunicacao,textoComunicacao,type CandidatoComunicacao } from './comunicacao';
const agora=new Date('2026-09-14T13:00:00Z');
const c:CandidatoComunicacao={customerId:1,nome:'Pessoa',email:'pessoa@example.test',telefone:'11999999999',statusCliente:'active',diasAtraso:10,saldo:100,casoId:3,carteira:'ativo',statusCaso:'aberto',tom:null,proximoContato:null,conversaAtiva:false,naoContatar:false,pausaAte:null,ultimoContato:null};
const config=lerComunicacaoConfig({});
describe('comunicação por provedor',()=>{
  it('começa desativada e não habilita configuração inválida',()=>{expect(config.ligada).toBe(false);expect(lerComunicacaoConfig({ligada:true,limiteDiario:0}).ligada).toBe(false);});
  it('aceita caso ativo sem inventar DNA',()=>expect(motivoExclusaoComunicacao(c,config,agora)).toBeNull());
  it.each([{naoContatar:true},{conversaAtiva:true},{statusCliente:'inactive'},{saldo:0},{statusCaso:'pago'},{statusCaso:'acordo_ativo'},{diasAtraso:100},{tom:'humanizado_vulneravel'},{pausaAte:'2026-09-15'},{proximoContato:'2026-09-15'},{ultimoContato:'2026-09-13'}])('exclui impedimento %j',patch=>expect(motivoExclusaoComunicacao({...c,...patch},config,agora)).not.toBeNull());
  it('não confunde revisão humana ativa com conciliação ex-cliente',()=>expect(motivoExclusaoComunicacao({...c,carteira:'ex_cliente',statusCliente:'inactive',diasAtraso:100},{...config,carteiras:['ex_cliente']},agora)).toBeNull());
  it('valida contato para cada canal',()=>{expect(destinatarioComunicacao(c,'sms')).toBe('+5511999999999');expect(destinatarioComunicacao({...c,email:'errado'},'email')).toBeNull();expect(destinatarioComunicacao({...c,telefone:'123'},'sms')).toBeNull();});
  it('primeiro contato não expõe saldo nem fatura individual',()=>expect(textoComunicacao('Provedor','cobranca')).not.toMatch(/R\$|CPF|100/));
});
