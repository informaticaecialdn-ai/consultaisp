vi.mock("../cobranca/gestao-operacional.service", () => ({ contatoComResultado: (executar: () => Promise<unknown>) => executar(), comOrcamentoContato: vi.fn(async (_pid: number, _cid: number, _canal: string, _automatico: boolean, enviar: () => Promise<unknown>) => enviar()) }));
import { beforeEach,describe,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),enviar:vi.fn(),cancelar:vi.fn()}));
vi.mock('../../db',()=>({pool:{query:m.query}}));
vi.mock('../../storage',()=>({storage:{}}));
vi.mock('../../storage/cobranca-comunicacao.storage',()=>({}));
vi.mock('../../storage/chat-autonomia.storage',()=>({autonomiaStorage:{cancelar:m.cancelar}}));
vi.mock('./chat-trava',()=>({comTravaDoChat:async(_k:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock('../cobranca/canais-comunicacao.service',()=>({enviarComunicacaoCobranca:m.enviar,obterConfiguracaoCanais:vi.fn(),obterConfiguracaoCanaisInterna:async()=>({email:{receivingDomain:'reply.example.com'}})}));
import { enviarMulticanal,formatarProposta,propostaMulticanal } from './chat-multicanal.service';
const envio={canal:'email',texto:'Olá',chave:'11111111-1111-4111-8111-111111111111'};
beforeEach(()=>{vi.clearAllMocks();});
describe('envio multicanal',()=>{
 it('nega conversa alheia antes do transporte',async()=>{m.query.mockResolvedValue({rows:[]});await expect(enviarMulticanal(2,'alheia',1,envio)).rejects.toThrow('não encontrada');expect(m.enviar).not.toHaveBeenCalled();});
 it('exige atendimento assumido',async()=>{m.query.mockResolvedValue({rows:[{status:'BOT'}]});await expect(enviarMulticanal(2,'a',1,envio)).rejects.toThrow('Assuma');expect(m.enviar).not.toHaveBeenCalled();});
 it('respeita não contatar também no envio humano',async()=>{m.query.mockResolvedValueOnce({rows:[{status:'OPEN',customer_id:3}]}).mockResolvedValueOnce({rowCount:1});await expect(enviarMulticanal(2,'a',1,envio)).rejects.toThrow('pausado');expect(m.enviar).not.toHaveBeenCalled();});
 it('proposta exige vínculo ao cliente e caso',async()=>{m.query.mockResolvedValueOnce({rows:[{customer_id:3,caso_id:8}]}).mockResolvedValueOnce({rows:[]});await expect(propostaMulticanal(2,'a',10)).rejects.toThrow('indisponível');expect(m.query.mock.calls[1][1]).toEqual([2,8,3,10]);});
 it('escapa HTML e usa valores da proposta',()=>{const p=formatarProposta('<script>x</script>','Empresa',{id:5,valor_negociado:'120',entrada:'0',parcelas:2,valor_parcela:'60',primeiro_vencimento:'2026-10-12'});expect(p.texto).toContain('12/10/2026');expect(p.texto).toContain('2 parcela');expect(p.html).not.toContain('<script>');expect(p.html).toContain('&lt;script&gt;');});
});
