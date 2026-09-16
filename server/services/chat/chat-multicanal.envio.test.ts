vi.mock("../cobranca/gestao-operacional.service", () => ({ contatoComResultado: (executar: () => Promise<unknown>) => executar(), comOrcamentoContato: vi.fn(async (_pid: number, _cid: number, _canal: string, _automatico: boolean, enviar: () => Promise<unknown>) => enviar()) }));
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),conn:vi.fn(),enviar:vi.fn(),cancelar:vi.fn(),politica:vi.fn(),configComunicacao:vi.fn(),consumo:vi.fn(),reservar:vi.fn(),obterCanais:vi.fn()}));
vi.mock('../../db',()=>({pool:{query:m.query,connect:async()=>({query:m.conn,release:()=>undefined})}}));
vi.mock('../../storage',()=>({storage:{getPoliticaDeCobranca:m.politica}}));
// `baseLegalDaEtapa` é a real: o evento do envio manual tem de carregar a MESMA base legal da régua.
vi.mock('../../storage/cobranca-comunicacao.storage',async()=>({configComunicacao:m.configComunicacao,consumoComunicacao:m.consumo,reservarComunicacao:m.reservar,
 baseLegalDaEtapa:(await vi.importActual<typeof import('../../storage/cobranca-comunicacao.storage')>('../../storage/cobranca-comunicacao.storage')).baseLegalDaEtapa}));
vi.mock('../../storage/chat-autonomia.storage',()=>({autonomiaStorage:{cancelar:m.cancelar}}));
vi.mock('./chat-trava',()=>({comTravaDoChat:async(_k:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock('./chat-ponte.service',()=>({ErroDaPonteDoChat:class extends Error{constructor(public readonly codigo:string,mensagem:string){super(mensagem);}}}));
vi.mock('../cobranca/canais-comunicacao.service',()=>({enviarComunicacaoCobranca:m.enviar,obterConfiguracaoCanais:m.obterCanais,obterConfiguracaoCanaisInterna:async()=>({email:{receivingDomain:'reply.example.com'}})}));
import { enviarMulticanal,executarReforcosMulticanal,formatarProposta,podeReforcar,propostaMulticanal } from './chat-multicanal.service';
import { ErroDaPonteDoChat } from './chat-ponte.service';
const envio={canal:'email',texto:'Olá',chave:'11111111-1111-4111-8111-111111111111'};
const interruptor=(ligada:boolean)=>({ligada,canal:'email' as const,limiteDiario:10,intervaloDias:3,carteiras:['ativo' as const]});
// Segunda-feira, 10h em Brasília: dentro da janela padrão (8h–20h). Quem não fala
// de horário não pode depender da hora em que a suíte roda.
const dentroDaJanela=new Date('2026-09-14T13:00:00Z');
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(dentroDaJanela);m.politica.mockResolvedValue(null);m.configComunicacao.mockResolvedValue(interruptor(true));});
afterEach(()=>vi.useRealTimers());
describe('envio multicanal',()=>{
 it('nega conversa alheia antes do transporte',async()=>{m.query.mockResolvedValue({rows:[]});await expect(enviarMulticanal(2,'alheia',1,envio)).rejects.toThrow('não encontrada');expect(m.enviar).not.toHaveBeenCalled();});
 it('exige atendimento assumido',async()=>{m.query.mockResolvedValue({rows:[{status:'BOT'}]});await expect(enviarMulticanal(2,'a',1,envio)).rejects.toThrow('Assuma');expect(m.enviar).not.toHaveBeenCalled();});
 it('respeita não contatar e a pausa também no envio humano',async()=>{
  m.query.mockResolvedValueOnce({rows:[{status:'OPEN',customer_id:3}]}).mockResolvedValueOnce({rowCount:1});
  const erro=await enviarMulticanal(2,'a',1,envio).catch(e=>e);
  expect(erro).toBeInstanceOf(ErroDaPonteDoChat);expect(erro.message).toMatch(/pausado/);
  // A pausa (cliente respondeu, informou pagamento) foi o cliente quem pediu: a
  // cláusula não depende mais de `automatico` — só provedor e cliente entram.
  const [sql,params]=m.query.mock.calls[1];
  expect(sql).toMatch(/nao_contatar OR pausa_ate>now\(\)\)/);expect(params).toEqual([2,3]);
  expect(m.enviar).not.toHaveBeenCalled();
 });
 it('fora do horário de contato o envio manual é recusado pela ponte, sem tocar o transporte',async()=>{
  vi.setSystemTime(new Date('2026-09-14T23:30:00Z')); // 20h30 em Brasília
  m.query.mockResolvedValueOnce({rows:[{status:'OPEN',customer_id:3,email:'c@example.com'}]}).mockResolvedValueOnce({rowCount:0});
  const erro=await enviarMulticanal(2,'a',1,envio).catch(e=>e);
  expect(erro).toBeInstanceOf(ErroDaPonteDoChat);expect(erro.codigo).toBe('CONFLITO');expect(erro.message).toMatch(/horário/);
  expect(m.politica).toHaveBeenCalledWith(2);expect(m.enviar).not.toHaveBeenCalled();
 });
 it('dentro do horário o envio manual segue até o próximo bloqueio',async()=>{
  m.query.mockResolvedValueOnce({rows:[{status:'OPEN',customer_id:3,email:null}]}).mockResolvedValueOnce({rowCount:0});
  await expect(enviarMulticanal(2,'a',1,envio)).rejects.toThrow('sem contato');
  expect(m.politica).toHaveBeenCalledWith(2);
 });
 it('o evento do envio manual carrega etapa e base legal do caso, como o da régua (concluirComunicacao)',async()=>{
  // Dois contatos ao mesmo cliente no mesmo dia — um pela régua, outro pelo atendente — têm
  // de sair com a MESMA base legal, senão a auditoria fica coxa. A etapa é a do CASO da conversa.
  m.query.mockResolvedValueOnce({rows:[{customer_id:3,caso_id:8,status:'OPEN',name:'Maria',email:'c@example.com',phone:null,provider_name:'ISP',etapa_atual:'aviso_suspensao',carteira:'ativo'}]})
   .mockResolvedValueOnce({rowCount:0}) // pausa/não contatar
   .mockResolvedValueOnce({rows:[]}) // config: insert on conflict
   .mockResolvedValueOnce({rows:[{reply_token:'tok',reforco_ativo:false,intervalo_horas:48,canais:['email']}]})
   .mockResolvedValueOnce({rows:[{id:'55'}]}); // reserva da mensagem
  m.conn.mockResolvedValue({rows:[]});
  m.enviar.mockResolvedValue({status:'enviado',providerMessageId:'pm1'});
  await expect(enviarMulticanal(2,'a',1,envio)).resolves.toMatchObject({status:'enviado'});
  const [sqlVinculo]=m.query.mock.calls[0];
  expect(sqlVinculo).toMatch(/LEFT JOIN cobranca_casos k ON k\.provider_id=v\.provider_id AND k\.id=v\.caso_id/);expect(sqlVinculo).toContain('k.etapa_atual,k.carteira');
  const evento=m.conn.mock.calls.find(([sql])=>String(sql).includes('INSERT INTO cobranca_eventos'));
  expect(evento,'evento de contato gravado').toBeTruthy();
  const [sql,params]=evento!;
  expect(sql).toContain('notas,metadata)');expect(sql).toContain('$7::jsonb');
  expect(params.slice(0,6)).toEqual([2,8,3,1,'email','Mensagem do atendente aceita pelo canal']);
  expect(JSON.parse(params[6])).toEqual({etapa:'aviso_suspensao',baseLegal:'Anatel Res. 765/2023 — 15 dias da notificação',motivoLegal:'Etapa "Regularização do serviço" da régua de cobrança · Anatel Res. 765/2023 — 15 dias da notificação'});
 });
 it('proposta exige vínculo ao cliente e caso',async()=>{m.query.mockResolvedValueOnce({rows:[{customer_id:3,caso_id:8}]}).mockResolvedValueOnce({rows:[]});await expect(propostaMulticanal(2,'a',10)).rejects.toThrow('indisponível');expect(m.query.mock.calls[1][1]).toEqual([2,8,3,10]);});
 it('escapa HTML e usa valores da proposta',()=>{const p=formatarProposta('<script>x</script>','Empresa',{id:5,valor_negociado:'120',entrada:'0',parcelas:2,valor_parcela:'60',primeiro_vencimento:'2026-10-12'});expect(p.texto).toContain('12/10/2026');expect(p.texto).toContain('2 parcela');expect(p.html).not.toContain('<script>');expect(p.html).toContain('&lt;script&gt;');});
});
describe('reforço automático',()=>{
 // O interruptor geral de SMS/e-mail (Comunicações → ligada) manda no reforço:
 // desligar o canal tem de desligar o reforço por conversa, senão a configuração
 // da conversa vira um canal paralelo que ninguém desligou.
 it('interruptor geral desligado: nenhum reforço, nem leitura da fila',async()=>{
  m.configComunicacao.mockResolvedValue(interruptor(false));
  expect(await podeReforcar(2,'a')).toBe(false);
  expect(m.query).not.toHaveBeenCalled();
 });
 it('ligado, a elegibilidade da conversa é lida no banco',async()=>{
  m.query.mockResolvedValue({rows:[]});
  expect(await podeReforcar(2,'a')).toBe(false);
  expect(m.query).toHaveBeenCalledWith(expect.stringContaining('cfg.reforco_ativo'),[2,'a']);
 });
 it('a agenda não reserva nem envia com o interruptor desligado, mesmo com reforço ativo na conversa',async()=>{
  m.configComunicacao.mockResolvedValue(interruptor(false));
  m.query.mockResolvedValueOnce({rows:[{provider_id:2,conversation_id:'a',canais:['email']}]});
  await executarReforcosMulticanal();
  expect(m.reservar).not.toHaveBeenCalled();expect(m.enviar).not.toHaveBeenCalled();
 });
});
