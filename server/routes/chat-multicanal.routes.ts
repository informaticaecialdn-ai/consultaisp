import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireProvider } from '../auth';
import { exigirEscopoDoChat } from './chat-escopo';
import { configurarMulticanal, enviarMulticanal, ErroMulticanal, listarMulticanal, propostaMulticanal } from '../services/chat/chat-multicanal.service';
import { logger } from '../logger';

export function registerChatMulticanalRoutes(){
 const r=Router();const base='/api/chat-bullq/atendimentos/:conversationId/multicanal';
 const proteger=[requireAuth,requireProvider,exigirEscopoDoChat];
 const executar=(fn:(pid:number,cid:string,body:unknown,uid:number)=>Promise<unknown>):import('express').RequestHandler=>async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{res.json(await fn(req.session.providerId!,String(req.params.conversationId),req.body,req.session.userId!));}
  catch(e){if(e instanceof z.ZodError||e instanceof ErroMulticanal){res.status(400).json({message:e instanceof ErroMulticanal?e.message:'Revise os campos da mensagem'});return;}logger.error({err:e},'Falha na conversa multicanal');res.status(503).json({message:'Não foi possível concluir. Confira o histórico antes de tentar novamente.'});}
 };
 r.get(base,...proteger,executar((p,c)=>listarMulticanal(p,c)));
 r.post(base+'/config',...proteger,executar((p,c,b)=>configurarMulticanal(p,c,b)));
 r.post(base+'/proposta',...proteger,executar((p,c,b)=>propostaMulticanal(p,c,z.object({propostaId:z.number().int().positive()}).parse(b).propostaId)));
 r.post(base+'/enviar',...proteger,executar((p,c,b,u)=>enviarMulticanal(p,c,u,b)));
 return r;
}
