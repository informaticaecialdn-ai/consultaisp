vi.mock("./gestao-operacional.service", () => ({ contatoComResultado: (executar: () => Promise<unknown>) => executar(), comOrcamentoContato: vi.fn(async (_pid: number, _cid: number, _canal: string, _automatico: boolean, enviar: () => Promise<unknown>) => enviar()) }));
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CandidatoComunicacao } from "@shared/cobranca/comunicacao";
const m=vi.hoisted(()=>({
  query:vi.fn(),provedoresComunicacao:vi.fn(),configComunicacao:vi.fn(),candidatosComunicacao:vi.fn(),
  consumoComunicacao:vi.fn(),reservarComunicacao:vi.fn(),concluirComunicacao:vi.fn(),faturaAtualComunicacao:vi.fn(),
  getPoliticaDeCobranca:vi.fn(),getUsersByProvider:vi.fn(),obterConfiguracaoCanais:vi.fn(),enviarComunicacaoCobranca:vi.fn(),
  obterConfigAvisos:vi.fn(),prepararPreAvisos:vi.fn(),listarPreAvisosPendentes:vi.fn(),reservarPreAviso:vi.fn(),concluirPreAviso:vi.fn(),contatosReservadosNoDia:vi.fn(),
  executarPreAviso:vi.fn(),warn:vi.fn(),travas:new Set<string>(),
  obterPagamentoFatura:vi.fn(),
}));
vi.mock("../../db",()=>({pool:m}));
vi.mock("../../storage",()=>({storage:m}));
vi.mock("../../storage/cobranca-comunicacao.storage",()=>m);
vi.mock("../../storage/cobranca-preventivo.storage",()=>({CobrancaPreventivoStorage:class { obterConfigAvisos=m.obterConfigAvisos;prepararPreAvisos=m.prepararPreAvisos;listarPreAvisosPendentes=m.listarPreAvisosPendentes;reservarPreAviso=m.reservarPreAviso;concluirPreAviso=m.concluirPreAviso;contatosReservadosNoDia=m.contatosReservadosNoDia; }}));
vi.mock("./canais-comunicacao.service",()=>m);
vi.mock("./pagamento-fatura.service",()=>m);
vi.mock("../chat/chat-preventivo.service",()=>m);
vi.mock("../../logger",()=>({logger:m}));
vi.mock("../chat/chat-trava",()=>({comTravaDoChat:async(chave:string,fn:()=>Promise<unknown>)=>{
  if(m.travas.has(chave))return null;m.travas.add(chave);try{return await fn();}finally{m.travas.delete(chave);}
}}));
import { executarComunicacoes } from "./comunicacao.service";
const agora=new Date("2026-09-14T13:00:00Z");
const cliente=():CandidatoComunicacao=>({customerId:11,nome:"Pessoa",email:"pessoa@example.test",telefone:"11999999999",statusCliente:"active",diasAtraso:10,saldo:100,casoId:22,carteira:"ativo",statusCaso:"aberto",tom:null,proximoContato:null,conversaAtiva:false,naoContatar:false,pausaAte:null,ultimoContato:null});
const config=()=>({ligada:true,canal:"email",limiteDiario:10,intervaloDias:3,carteiras:["ativo"]});
const canais=()=>({email:{ativado:true,configurado:true},sms:{ativado:true,configurado:true}});
const avisos=()=>({ligada:true,canal:"email",limiteDiario:10,diasAntes:[7,3,1],incluirLinkFatura:false});
function preventivo(){
  m.configComunicacao.mockResolvedValue({...config(),ligada:false});
  m.obterConfigAvisos.mockResolvedValue(avisos());
  m.listarPreAvisosPendentes.mockResolvedValue([{id:30,faturaId:40,customerId:11,status:"pending",vencimento:new Date("2026-09-15T00:00:00Z"),valor:"100"}]);
  m.candidatosComunicacao.mockResolvedValue([{...cliente(),saldo:0,diasAtraso:0,casoId:null}]);
  m.faturaAtualComunicacao.mockResolvedValue({id:40,status:"pending",vencimento:new Date("2026-09-15T00:00:00Z"),valor:100});
}
beforeEach(()=>{
  vi.resetAllMocks();m.travas.clear();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(agora);
  m.provedoresComunicacao.mockResolvedValue([7]);m.query.mockResolvedValue({rows:[{name:"ISP"}]});
  m.configComunicacao.mockResolvedValue(config());m.getPoliticaDeCobranca.mockResolvedValue(null);
  m.obterConfigAvisos.mockResolvedValue(null);m.listarPreAvisosPendentes.mockResolvedValue([]);
  m.candidatosComunicacao.mockResolvedValue([cliente()]);m.obterConfiguracaoCanais.mockResolvedValue(canais());
  m.consumoComunicacao.mockResolvedValue(0);m.reservarComunicacao.mockResolvedValue(50);
  m.reservarPreAviso.mockResolvedValue(true);m.contatosReservadosNoDia.mockResolvedValue(0);
  m.getUsersByProvider.mockResolvedValue([{id:8,role:"admin"}]);
  m.enviarComunicacaoCobranca.mockResolvedValue({status:"enviado",providerMessageId:"msg-1"});
});
afterEach(()=>vi.useRealTimers());
describe("agenda SMS/e-mail",()=>{
  it("desligada não reserva nem envia",async()=>{m.configComunicacao.mockResolvedValue({...config(),ligada:false});await executarComunicacoes(agora);expect(m.reservarComunicacao).not.toHaveBeenCalled();expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();});
  it("respeita política pausada e janela",async()=>{
    m.getPoliticaDeCobranca.mockResolvedValue({pausada:true});await executarComunicacoes(agora);
    m.getPoliticaDeCobranca.mockResolvedValue(null);await executarComunicacoes(new Date("2026-09-14T23:00:00Z"));
    expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
  });
  it("envio tem tenant, reserva, idempotência e conclusão",async()=>{
    await executarComunicacoes(agora);
    expect(m.reservarComunicacao).toHaveBeenCalledWith(expect.objectContaining({providerId:7,customerId:11,casoId:22}));
    expect(m.candidatosComunicacao).toHaveBeenLastCalledWith(7,11,{comunicacaoId:50});
    expect(m.enviarComunicacaoCobranca).toHaveBeenCalledWith(7,expect.objectContaining({idempotencyKey:"cisp:7:50",canal:"email"}));
    expect(m.concluirComunicacao).toHaveBeenCalledWith(7,50,{status:"enviado",providerMessageId:"msg-1"});
  });
  it("rodadas concorrentes usam a trava da agenda WhatsApp",async()=>{await Promise.all([executarComunicacoes(agora),executarComunicacoes(agora)]);expect(m.enviarComunicacaoCobranca).toHaveBeenCalledTimes(1);});
  it("reserva já tomada não envia",async()=>{m.reservarComunicacao.mockResolvedValue(null);await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();});
  it("falha de configuração não dispara nem cria reserva",async()=>{m.obterConfiguracaoCanais.mockRejectedValue(new Error("chave cifrada inválida"));await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();expect(m.reservarComunicacao).not.toHaveBeenCalled();});
  it.each([{saldo:0},{naoContatar:true},{conversaAtiva:true},{pausaAte:new Date("2026-09-15")},{casoId:90}])("releitura após reserva impede envio com mudança %j",async(patch)=>{
    m.reservarComunicacao.mockImplementation(async()=>{m.candidatosComunicacao.mockResolvedValue([{...cliente(),...patch}]);return 50;});
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
    expect(m.concluirComunicacao).toHaveBeenCalledWith(7,50,expect.objectContaining({status:"ignorado"}));
  });
  it("desligamento do canal após reserva interrompe envio",async()=>{
    m.reservarComunicacao.mockImplementation(async()=>{m.obterConfiguracaoCanais.mockResolvedValue({...canais(),email:{ativado:false,configurado:true}});return 50;});
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
  });
  it("relógio avança e para quando a janela fecha durante a rodada",async()=>{
    const perto=new Date("2026-09-14T22:59:59Z");vi.setSystemTime(perto);
    m.reservarComunicacao.mockImplementation(async()=>{vi.setSystemTime(new Date("2026-09-14T23:00:01Z"));return 50;});
    await executarComunicacoes(perto);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
  });
  it("10 mil inelegíveis não causam N+1",async()=>{
    m.candidatosComunicacao.mockResolvedValue(Array.from({length:10000},(_,i)=>({...cliente(),customerId:i+1,saldo:0})));
    await executarComunicacoes(agora);expect(m.candidatosComunicacao).toHaveBeenCalledTimes(1);expect(m.configComunicacao).toHaveBeenCalledTimes(1);
  });
  it("rodada limita a cinco tentativas externas",async()=>{
    const lista=Array.from({length:20},(_,i)=>({...cliente(),customerId:i+1,casoId:i+100}));
    m.candidatosComunicacao.mockImplementation(async(_p:number,id?:number)=>id?lista.filter(c=>c.customerId===id):lista);
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).toHaveBeenCalledTimes(5);
  });
  it("reserva permanece se gateway lança: não inventa falha definitiva",async()=>{m.enviarComunicacaoCobranca.mockRejectedValue(new Error("incerto"));await executarComunicacoes(agora);expect(m.concluirComunicacao).not.toHaveBeenCalled();expect(m.warn).toHaveBeenCalled();});
  it("pré-aviso pago após reserva não é enviado",async()=>{
    preventivo();m.reservarPreAviso.mockImplementation(async()=>{m.faturaAtualComunicacao.mockResolvedValue(null);return true;});
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
    expect(m.concluirPreAviso).toHaveBeenCalledWith(7,30,expect.objectContaining({status:"ignorado"}));
  });
  it("pré-aviso relê fatura e exclui somente suas próprias reservas",async()=>{
    preventivo();await executarComunicacoes(agora);
    expect(m.faturaAtualComunicacao).toHaveBeenCalledWith(7,11,40);
    expect(m.candidatosComunicacao).toHaveBeenLastCalledWith(7,11,{comunicacaoId:50,preAvisoId:30});
    expect(m.enviarComunicacaoCobranca).toHaveBeenCalledTimes(1);
  });
  it("contato prévio hoje exclui pré-aviso mesmo com WhatsApp encerrado",async()=>{
    preventivo();m.candidatosComunicacao.mockResolvedValue([{...cliente(),saldo:0,conversaAtiva:false,ultimoContato:new Date("2026-09-14T12:30:00Z")}]);
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
  });
  it("link só entra quando configurado e confirmado no ERP",async()=>{
    preventivo();m.obterConfigAvisos.mockResolvedValue({...avisos(),incluirLinkFatura:true});
    m.obterPagamentoFatura.mockResolvedValue({link:"https://financeiro.example.test/f/abc",valor:100,vencimento:"2026-09-15"});
    await executarComunicacoes(agora);
    expect(m.obterPagamentoFatura).toHaveBeenCalledWith(7,11,40);
    expect(m.enviarComunicacaoCobranca).toHaveBeenCalledWith(7,expect.objectContaining({texto:expect.stringContaining("https://financeiro.example.test/f/abc")}));
  });
  it("link não confirmado registra ignorado sem enviar",async()=>{
    preventivo();m.obterConfigAvisos.mockResolvedValue({...avisos(),incluirLinkFatura:true});m.obterPagamentoFatura.mockResolvedValue(null);
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
    expect(m.concluirComunicacao).toHaveBeenCalledWith(7,50,expect.objectContaining({status:"ignorado",motivo:expect.stringContaining("Link da fatura")}));
  });
  it("canal pausado durante leitura ERP não envia link",async()=>{
    preventivo();m.obterConfigAvisos.mockResolvedValue({...avisos(),incluirLinkFatura:true});
    m.obterPagamentoFatura.mockImplementation(async()=>{m.obterConfigAvisos.mockResolvedValue({...avisos(),ligada:false});return {link:"https://example.test/f",valor:100,vencimento:"2026-09-15"};});
    await executarComunicacoes(agora);expect(m.enviarComunicacaoCobranca).not.toHaveBeenCalled();
  });
});
