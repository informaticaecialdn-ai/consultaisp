import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import express,{type Request} from 'express';
import type { Server } from 'node:http';
vi.hoisted(()=>{process.env.SESSION_SECRET ||= 'local-test-session-secret-for-comunicacoes';});
const f=vi.hoisted(()=>({config:vi.fn(),salvar:vi.fn(),diario:vi.fn(),pausar:vi.fn(),previa:vi.fn(),userId:8,providerId:7,role:'admin'}));
vi.mock('../storage/cobranca-comunicacao.storage',()=>({configComunicacao:f.config,salvarComunicacao:f.salvar,diarioComunicacao:f.diario,pausarComunicacao:f.pausar}));
vi.mock('../services/cobranca/comunicacao.service',()=>({previaComunicacao:f.previa}));
vi.mock('./provider.routes',()=>({podeAdministrarOProvedor:(s:Request['session'])=>s.role==='admin'}));
import { registerComunicacaoRoutes } from './cobranca-comunicacao.routes';
let server:Server;let base:string;
beforeAll(async()=>{const app=express();app.use(express.json());app.use((req,_res,next)=>{req.session={userId:f.userId,providerId:f.providerId,role:f.role} as Request['session'];next();});app.use(registerComunicacaoRoutes());await new Promise<void>(r=>{server=app.listen(0,'127.0.0.1',r);});const a=server.address();if(!a||typeof a==='string')throw Error('Porta inválida');base=`http://127.0.0.1:${a.port}/api/cobranca/comunicacoes`;});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
beforeEach(()=>{vi.clearAllMocks();f.userId=8;f.providerId=7;f.role='admin';f.config.mockResolvedValue({ligada:false});f.diario.mockResolvedValue([]);f.pausar.mockResolvedValue(true);f.previa.mockResolvedValue({elegiveis:0});});
const enviar=(path:string,body:unknown,method='POST')=>fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
describe('diário por provedor',()=>{
  it('exige autenticação e provedor',async()=>{f.userId=0;expect((await fetch(base)).status).toBe(401);f.userId=8;f.providerId=0;expect((await fetch(base)).status).toBe(401);expect(f.diario).not.toHaveBeenCalled();});
  it('filtra carteira usando somente tenant da sessão',async()=>{expect((await fetch(`${base}?carteira=ex_cliente&providerId=2`)).status).toBe(200);expect(f.diario).toHaveBeenCalledWith(7,'ex_cliente');expect((await fetch(`${base}?carteira=outra`)).status).toBe(400);});
  it('operador não ativa automação',async()=>{f.role='user';expect((await enviar('/config',{ligada:true},'PUT')).status).toBe(403);expect(f.salvar).not.toHaveBeenCalled();});
  it('salva configuração validada sem providerId do corpo',async()=>{expect((await enviar('/config',{ligada:false,providerId:99},'PUT')).status).toBe(200);expect(f.salvar.mock.calls[0][0]).toBe(7);expect(f.salvar.mock.calls[0][1]).not.toHaveProperty('providerId');});
  it('simulação não grava nem envia',async()=>{expect((await enviar('/simular',{})).status).toBe(200);expect(f.previa).toHaveBeenCalledWith(7);expect(f.salvar).not.toHaveBeenCalled();expect(f.pausar).not.toHaveBeenCalled();});
  it('pagamento informado usa somente ação de preferência',async()=>{expect((await enviar('/clientes/4/preferencia',{acao:'pagamento_informado',providerId:99})).status).toBe(200);expect(f.pausar).toHaveBeenCalledWith(7,4,8,'pagamento_informado');});
  it('operador pausa e desliga, mas só administrador retoma o contato desligado',async()=>{
    f.role='user';
    expect((await enviar('/clientes/4/preferencia',{acao:'nao_contatar'})).status).toBe(200);
    const recusa=await enviar('/clientes/4/preferencia',{acao:'retomar'});
    expect(recusa.status).toBe(403);expect((await recusa.json()).message).toMatch(/administradores/);
    expect(f.pausar).toHaveBeenCalledTimes(1);expect(f.pausar).not.toHaveBeenCalledWith(7,4,8,'retomar');
    f.role='admin';
    expect((await enviar('/clientes/4/preferencia',{acao:'retomar'})).status).toBe(200);
    expect(f.pausar).toHaveBeenLastCalledWith(7,4,8,'retomar');
  });
  it('recusa cliente inexistente e identificador inválido',async()=>{expect((await enviar('/clientes/abc/preferencia',{acao:'retomar'})).status).toBe(400);f.pausar.mockResolvedValue(false);expect((await enviar('/clientes/99/preferencia',{acao:'retomar'})).status).toBe(404);});
});

