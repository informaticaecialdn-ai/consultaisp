import { Router } from 'express';
import { z } from 'zod';
import { requireAuth,requireProvider,requireAdmin } from '../auth';
import { pool } from '../db';
import { ConfigGestaoSchema,ContestacaoSchema,ResolverContestacaoSchema } from '@shared/cobranca/gestao-operacional';
import { painelGestao,configGestao,salvarConfigGestao,abrirContestacao,resolverContestacao,ErroGestao } from '../services/cobranca/gestao-operacional.service';

export function registerGestaoCobrancaRoutes(){
  const r=Router(),base='/api/cobranca/gestao';
  r.use(base,requireAuth,requireProvider,(_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  const erro=(res:import('express').Response,e:unknown)=>res.status(e instanceof ErroGestao?409:503).json({message:e instanceof ErroGestao?e.message:'Não foi possível acessar a gestão de cobrança. Confira a atualização do sistema.'});
  r.get(base,async(req,res)=>{
    const carteira=z.enum(['ativo','ex_cliente']).safeParse(req.query.carteira??'ativo');
    if(!carteira.success){res.status(400).json({message:'Carteira inválida.'});return;}
    try{res.json(await painelGestao(req.session.providerId!,carteira.data));}catch(e){erro(res,e);}
  });
  r.get(`${base}/config`,async(req,res)=>{try{res.json(await configGestao(req.session.providerId!));}catch(e){erro(res,e);}});
  r.put(`${base}/config`,requireAdmin,async(req,res)=>{
    const p=ConfigGestaoSchema.safeParse(req.body);if(!p.success){res.status(400).json({message:'Confira limites e premissas.'});return;}
    try{res.json(await salvarConfigGestao(req.session.providerId!,p.data));}catch(e){erro(res,e);}
  });
  r.get(`${base}/faturas`,async(req,res)=>{
    const p=z.object({busca:z.string().trim().min(2).max(100),carteira:z.enum(['ativo','ex_cliente'])}).safeParse(req.query);
    if(!p.success){res.status(400).json({message:'Informe carteira e ao menos dois caracteres do nome ou número da fatura.'});return;}
    try{const a=await pool.query(`SELECT i.id,c.name nome,c.id "customerId",i.value::float8 valor,i.due_date vencimento,i.status FROM invoices i JOIN customers c ON c.provider_id=i.provider_id AND c.id=i.customer_id WHERE i.provider_id=$1 AND i.status IN ('aberta','pending','overdue','baixada_no_erp') AND (c.name ILIKE $2 OR i.id::text=$3) AND CASE WHEN c.status IN ('active','suspended') THEN 'ativo' WHEN c.status IN ('inactive','cancelled') THEN 'ex_cliente' ELSE 'desconhecida' END=$4 ORDER BY i.due_date,i.id LIMIT 30`,[req.session.providerId!,`%${p.data.busca.replace(/[%_\\]/g,'\\$&')}%`,p.data.busca,p.data.carteira]);res.json(a.rows);}catch(e){erro(res,e);}
  });
  r.post(`${base}/contestacoes`,async(req,res)=>{
    const p=ContestacaoSchema.safeParse(req.body);if(!p.success){res.status(400).json({message:'Preencha fatura, motivo, relato, responsável e prazo válidos.'});return;}
    try{res.status(201).json(await abrirContestacao(req.session.providerId!,req.session.userId!,p.data));}catch(e){erro(res,e);}
  });
  r.post(`${base}/contestacoes/:id/resolver`,requireAdmin,async(req,res)=>{
    const id=z.coerce.number().int().positive().safeParse(req.params.id),p=ResolverContestacaoSchema.safeParse(req.body);
    if(!id.success||!p.success){res.status(400).json({message:'Informe decisão e justificativa com ao menos dez caracteres.'});return;}
    try{res.json(await resolverContestacao(req.session.providerId!,req.session.userId!,id.data,p.data));}catch(e){erro(res,e);}
  });return r;
}
