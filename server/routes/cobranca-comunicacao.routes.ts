import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireProvider, requireAdmin } from "../auth";
import { ComunicacaoConfigSchema } from "@shared/cobranca/comunicacao";
import { configComunicacao,salvarComunicacao,diarioComunicacao,pausarComunicacao } from "../storage/cobranca-comunicacao.storage";
import { previaComunicacao } from "../services/cobranca/comunicacao.service";
import { logger } from "../logger";

export function registerComunicacaoRoutes() {
  const r=Router();
  r.use('/api/cobranca/comunicacoes',requireAuth,requireProvider,(_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  r.get('/api/cobranca/comunicacoes',async(req,res)=>{
    const carteira=req.query.carteira;
    if(carteira!==undefined&&carteira!=='ativo'&&carteira!=='ex_cliente'){res.status(400).json({message:'Carteira inválida.'});return;}
    try{res.json({config:await configComunicacao(req.session.providerId!),itens:await diarioComunicacao(req.session.providerId!,carteira)});}
    catch{res.status(503).json({message:'Diário indisponível. Confira as migrações do sistema.'});}
  });
  r.put('/api/cobranca/comunicacoes/config',requireAdmin,async(req,res)=>{
    const p=ComunicacaoConfigSchema.safeParse(req.body);
    if(!p.success){res.status(400).json({message:'Confira canal, limite diário e intervalo de contato.'});return;}
    try{await salvarComunicacao(req.session.providerId!,p.data);res.json(p.data);}
    catch{res.status(503).json({message:'Não foi possível salvar a configuração.'});}
  });
  r.post('/api/cobranca/comunicacoes/simular',async(req,res)=>{
    try{res.json(await previaComunicacao(req.session.providerId!));}
    catch{res.status(503).json({message:'Não foi possível simular os contatos agora.'});}
  });
  r.post('/api/cobranca/comunicacoes/clientes/:id/preferencia',async(req,res)=>{
    const p=z.object({acao:z.enum(['respondeu','pagamento_informado','nao_contatar','retomar'])}).safeParse(req.body);
    const id=Number(req.params.id);
    if(!p.success||!Number.isSafeInteger(id)||id<=0){res.status(400).json({message:'Informe cliente e ação válidos.'});return;}
    try{
      const ok=await pausarComunicacao(req.session.providerId!,id,req.session.userId!,p.data.acao);
      res.status(ok?200:404).json({message:ok?'Preferência registrada. Nenhuma baixa financeira foi realizada.':'Cliente não encontrado.'});
    }catch{logger.warn('Não foi possível registrar preferência de comunicação');res.status(503).json({message:'Não foi possível registrar a preferência.'});}
  });
  return r;
}
