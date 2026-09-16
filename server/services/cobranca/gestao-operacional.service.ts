import { randomUUID } from 'node:crypto';
import { pool } from '../../db';
import { avaliarContato, ConfigGestaoSchema, ContestacaoSchema, ResolverContestacaoSchema, simularEconomia, type PainelGestao } from '@shared/cobranca/gestao-operacional';

export class ErroGestao extends Error {}
/** Um bloqueio anterior ao transporte não pode aparecer como mensagem em trânsito. */
export async function contatoComResultado<T>(executar:()=>Promise<T>):Promise<T|{status:'falhou';motivo:string}>{
  try{return await executar();}catch(e){if(e instanceof ErroGestao)return {status:'falhou',motivo:e.message};throw e;}
}
export async function configGestao(pid:number){
  const r=await pool.query<{config:unknown}>('SELECT config FROM cobranca_gestao_config WHERE provider_id=$1',[pid]);
  return ConfigGestaoSchema.parse(r.rows[0]?.config??{});
}
export async function salvarConfigGestao(pid:number,entrada:unknown){
  const c=ConfigGestaoSchema.parse(entrada);
  await pool.query('INSERT INTO cobranca_gestao_config(provider_id,config) VALUES($1,$2) ON CONFLICT(provider_id) DO UPDATE SET config=excluded.config,updated_at=now()',[pid,JSON.stringify(c)]);
  return c;
}

/** Reserva compartilhada, serializada por provedor/cliente. Incerteza consome orçamento. */
export async function comOrcamentoContato<T>(pid:number,cid:number,canal:'whatsapp'|'sms'|'email',automatico:boolean,enviar:()=>Promise<T>,chave:string=randomUUID()):Promise<T>{
  const cfg=await configGestao(pid),conn=await pool.connect();let id:number;
  try{
    await conn.query('BEGIN');
    await conn.query('SELECT pg_advisory_xact_lock($1,$2)',[pid,cid]);
    const r=await conn.query<{disputa:boolean;optout:boolean;pausado:boolean;promessa:boolean;hoje:number;semana:number}>(`
      SELECT EXISTS(SELECT 1 FROM cobranca_contestacoes d WHERE d.provider_id=c.provider_id AND d.customer_id=c.id AND d.status='aberta') disputa,
      coalesce(p.nao_contatar,false) optout,coalesce(p.pausa_ate>now(),false) pausado,
      coalesce((SELECT e.metadata->>'promessaPara' >= to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD')
        FROM cobranca_eventos e WHERE e.provider_id=c.provider_id AND e.customer_id=c.id
        AND (e.tipo IN ('promessa','acordo_quebrado','acordo_aceito') OR e.resultado IN ('falou','promessa_pagamento') OR e.metadata ? 'acaoContato')
        ORDER BY e.ocorrido_em DESC,e.id DESC LIMIT 1),false) promessa,
      (SELECT count(*)::int FROM cobranca_contatos_orcamento o WHERE o.provider_id=c.provider_id AND o.customer_id=c.id AND o.status<>'falhou'
       AND (o.criado_em AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date) hoje,
      (SELECT count(*)::int FROM cobranca_contatos_orcamento o WHERE o.provider_id=c.provider_id AND o.customer_id=c.id AND o.status<>'falhou' AND o.automatico AND o.criado_em>=now()-interval '7 days') semana
      FROM customers c LEFT JOIN cobranca_preferencias_contato p ON p.provider_id=c.provider_id AND p.customer_id=c.id
      WHERE c.provider_id=$1 AND c.id=$2`,[pid,cid]);
    if(!r.rows[0])throw new ErroGestao('Cliente não encontrado neste provedor.');
    const motivo=avaliarContato({...r.rows[0],automatico},cfg);if(motivo)throw new ErroGestao(motivo);
    const reserva=await conn.query<{id:number}>(`INSERT INTO cobranca_contatos_orcamento(provider_id,customer_id,canal,automatico,chave) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,[pid,cid,canal,automatico,chave]);
    if(!reserva.rows[0])throw new ErroGestao('Esta tentativa já foi registrada. Confira o histórico antes de repetir.');
    id=reserva.rows[0].id;await conn.query('COMMIT');
  }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
  let resultado:T;
  try{resultado=await enviar();}
  catch(e){await pool.query("UPDATE cobranca_contatos_orcamento SET status='incerto',atualizado_em=now() WHERE provider_id=$1 AND id=$2",[pid,id]);throw e;}
  const r=resultado as {ok?:boolean;status?:string|number};
  const status=r?.ok===false?(typeof r.status==='number'&&r.status<500&&r.status!==408?'falhou':'incerto'):r?.status==='falhou'?'falhou':r?.status==='incerto'?'incerto':'enviado';
  await pool.query('UPDATE cobranca_contatos_orcamento SET status=$3,atualizado_em=now() WHERE provider_id=$1 AND id=$2',[pid,id,status]);
  return resultado;
}

export async function abrirContestacao(pid:number,uid:number,entrada:unknown){
  const e=ContestacaoSchema.parse(entrada),conn=await pool.connect();
  try{await conn.query('BEGIN');
    const f=await conn.query<{customer_id:number}>(`SELECT customer_id FROM invoices WHERE provider_id=$1 AND id=$2 AND status IN ('aberta','pending','overdue','baixada_no_erp')`,[pid,e.faturaId]);
    if(!f.rows[0])throw new ErroGestao('Fatura não disponível para contestação.');
    const cid=f.rows[0].customer_id;await conn.query('SELECT pg_advisory_xact_lock($1,$2)',[pid,cid]);
    const u=await conn.query('SELECT id FROM users WHERE provider_id=$1 AND id=$2',[pid,e.responsavelId]);
    if(!u.rowCount)throw new ErroGestao('Responsável não pertence ao provedor.');
    const r=await conn.query(`INSERT INTO cobranca_contestacoes(provider_id,customer_id,fatura_id,motivo,relato,evidencia,responsavel_id,prazo,criado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provider_id,fatura_id) WHERE status='aberta' DO NOTHING RETURNING id`,[pid,cid,e.faturaId,e.motivo,e.relato,e.evidencia,e.responsavelId,e.prazo,uid]);
    if(!r.rowCount)throw new ErroGestao('Esta fatura já tem contestação aberta.');
    await conn.query(`INSERT INTO cobranca_eventos(provider_id,caso_id,customer_id,user_id,tipo,notas,metadata)
      SELECT provider_id,id,customer_id,$3,'nota','Contestação aberta; contatos bloqueados até a conclusão.',$4 FROM cobranca_casos WHERE provider_id=$1 AND customer_id=$2 AND encerrado_em IS NULL`,[pid,cid,uid,JSON.stringify({contestacaoId:r.rows[0].id,faturaId:e.faturaId})]);
    await conn.query('COMMIT');return r.rows[0];
  }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
export async function resolverContestacao(pid:number,uid:number,id:number,entrada:unknown){
  const e=ResolverContestacaoSchema.parse(entrada),conn=await pool.connect();
  try{await conn.query('BEGIN');
    const d=await conn.query<{customer_id:number}>('SELECT customer_id FROM cobranca_contestacoes WHERE provider_id=$1 AND id=$2',[pid,id]);
    if(!d.rows[0])throw new ErroGestao('Contestação não encontrada.');
    const cid=d.rows[0].customer_id;await conn.query('SELECT pg_advisory_xact_lock($1,$2)',[pid,cid]);
    const r=await conn.query(`UPDATE cobranca_contestacoes SET status=$3,justificativa=$4,resolvido_por=$5,resolvido_em=now() WHERE provider_id=$1 AND id=$2 AND status='aberta' RETURNING id`,[pid,id,e.decisao,e.justificativa,uid]);
    if(!r.rowCount)throw new ErroGestao('Contestação já concluída.');
    // Procedente exige correção financeira no ERP antes de retomar a automação.
    if(e.decisao==='procedente')await conn.query(`INSERT INTO cobranca_preferencias_contato(provider_id,customer_id,nao_contatar,motivo,user_id) VALUES($1,$2,true,'Contestação procedente: corrigir no ERP antes de retomar',$3) ON CONFLICT(provider_id,customer_id) DO UPDATE SET nao_contatar=true,motivo=excluded.motivo,user_id=excluded.user_id,updated_at=now()`,[pid,cid,uid]);
    await conn.query(`INSERT INTO cobranca_eventos(provider_id,caso_id,customer_id,user_id,tipo,notas,metadata) SELECT provider_id,id,customer_id,$3,'nota',$4,$5 FROM cobranca_casos WHERE provider_id=$1 AND customer_id=$2 AND encerrado_em IS NULL`,[pid,cid,uid,`Contestação ${e.decisao}: ${e.justificativa}`,JSON.stringify({contestacaoId:id})]);
    await conn.query('COMMIT');return {id};
  }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}

const carteiraSql=`CASE WHEN c.status IN ('active','suspended') THEN 'ativo' WHEN c.status IN ('inactive','cancelled') THEN 'ex_cliente' ELSE 'desconhecida' END`;
type ClienteResumo={id:number;nome:string;saldo:number;sincronizadoEm:string|null;saldoFaturas:number;aguardandoConfirmacao:number;pagamentosParciais:number;valorContestado:number};
type DisputaResumo={id:number;customerId:number;nome:string;faturaId:number;valor:number;motivo:string;relato:string;evidencia:string;prazo:string;status:string;responsavel:string;criadoEm:string;resolvidoEm:string|null;justificativa:string|null};
type ParcelaResumo={id:number;customerId:number;nome:string;data:string;valor:number;status:string;pagoEm:string|null;valorPago:number|null;acordoId:number};
type PromessaResumo={customerId:number;nome:string;data:string;registradaEm:string};
export async function painelGestao(pid:number,carteira:'ativo'|'ex_cliente'):Promise<PainelGestao>{
  const cfg=await configGestao(pid);
  const [clientes,disputas,agenda,promessas,coortes,preventivo,contatos,configPreventivo]=await Promise.all([
    pool.query<ClienteResumo>(`SELECT c.id,c.name nome,c.total_overdue_amount::float8 saldo,c.last_sync_at "sincronizadoEm",
      coalesce(sum(i.value) FILTER(WHERE i.status IN ('aberta','pending','overdue') AND i.due_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date),0)::float8 "saldoFaturas",
      count(i.id) FILTER(WHERE i.status='baixada_no_erp')::int "aguardandoConfirmacao",
      count(i.id) FILTER(WHERE i.paid_value>0 AND i.paid_value<i.value)::int "pagamentosParciais",
      (SELECT coalesce(sum(f.value),0)::float8 FROM cobranca_contestacoes d JOIN invoices f ON f.provider_id=d.provider_id AND f.id=d.fatura_id WHERE d.provider_id=c.provider_id AND d.customer_id=c.id AND d.status='aberta') "valorContestado"
      FROM customers c LEFT JOIN invoices i ON i.provider_id=c.provider_id AND i.customer_id=c.id
      WHERE c.provider_id=$1 AND ${carteiraSql}=$2 GROUP BY c.id ORDER BY c.total_overdue_amount DESC,c.id LIMIT 5001`,[pid,carteira]),
    pool.query<DisputaResumo>(`SELECT d.id,d.customer_id "customerId",c.name nome,d.fatura_id "faturaId",f.value::float8 valor,d.motivo,d.relato,d.evidencia,d.prazo::text,d.status,u.name responsavel,d.criado_em "criadoEm",d.resolvido_em "resolvidoEm",d.justificativa
      FROM cobranca_contestacoes d JOIN customers c ON c.provider_id=d.provider_id AND c.id=d.customer_id JOIN invoices f ON f.provider_id=d.provider_id AND f.customer_id=d.customer_id AND f.id=d.fatura_id JOIN users u ON u.provider_id=d.provider_id AND u.id=d.responsavel_id
      WHERE d.provider_id=$1 AND ${carteiraSql}=$2 ORDER BY (d.status='aberta') DESC,d.prazo,d.id DESC LIMIT 201`,[pid,carteira]),
    pool.query<ParcelaResumo>(`SELECT p.id,c.id "customerId",c.name nome,p.vencimento::text data,p.valor::float8 valor,p.status,p.pago_em "pagoEm",p.valor_pago::float8 "valorPago",n.id "acordoId"
      FROM cobranca_parcelas p JOIN cobranca_negociacoes n ON n.provider_id=p.provider_id AND n.id=p.negociacao_id JOIN customers c ON c.provider_id=n.provider_id AND c.id=n.customer_id
      WHERE p.provider_id=$1 AND ${carteiraSql}=$2 AND n.status IN ('aceita','ativa','cumprida','quebrada') AND p.status<>'cancelada' AND p.vencimento BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date-30 AND (now() AT TIME ZONE 'America/Sao_Paulo')::date+90 ORDER BY p.vencimento,p.id LIMIT 501`,[pid,carteira]),
    pool.query<PromessaResumo>(`SELECT c.id "customerId",c.name nome,e.metadata->>'promessaPara' data,e.ocorrido_em "registradaEm" FROM customers c JOIN LATERAL
      (SELECT metadata,ocorrido_em FROM cobranca_eventos WHERE provider_id=c.provider_id AND customer_id=c.id AND (tipo IN ('promessa','acordo_aceito','acordo_quebrado') OR resultado IN ('falou','promessa_pagamento') OR metadata ? 'acaoContato') ORDER BY ocorrido_em DESC,id DESC LIMIT 1) e ON true
      WHERE c.provider_id=$1 AND ${carteiraSql}=$2 AND e.metadata->>'promessaPara' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND c.total_overdue_amount>0
      AND NOT EXISTS(SELECT 1 FROM cobranca_negociacoes n WHERE n.provider_id=c.provider_id AND n.customer_id=c.id AND n.status IN ('aceita','ativa')) ORDER BY e.metadata->>'promessaPara' LIMIT 201`,[pid,carteira]),
    pool.query<{dias:number;elegiveis:number;regularizados:number}>(`SELECT dias,count(*)::int elegiveis,count(*) FILTER(WHERE pago>=valor_abertura AND valor_abertura>0)::int regularizados FROM (SELECT k.id,k.valor_abertura,d.dias,
      (SELECT coalesce(sum(i.paid_value),0) FROM invoices i WHERE i.provider_id=k.provider_id AND i.customer_id=k.customer_id AND i.status='paid' AND i.paid_date>=k.aberto_em AND i.paid_date<=k.aberto_em+make_interval(days=>d.dias)) pago
      FROM cobranca_casos k CROSS JOIN (VALUES(7),(30)) d(dias) WHERE k.provider_id=$1 AND k.carteira=$2 AND k.aberto_em BETWEEN now()-interval '180 days' AND now()-make_interval(days=>d.dias)
      AND NOT EXISTS(SELECT 1 FROM cobranca_casos outro WHERE outro.provider_id=k.provider_id AND outro.customer_id=k.customer_id AND outro.id<>k.id AND outro.aberto_em>k.aberto_em AND outro.aberto_em<=k.aberto_em+make_interval(days=>d.dias))) x GROUP BY dias ORDER BY dias`,[pid,carteira]),
    pool.query<{faturas:number;clientes:number;semTelefone:number;pausadas:number;avisadas:number}>(`SELECT count(*)::int faturas,count(DISTINCT c.id)::int clientes,count(*) FILTER(WHERE length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))<10)::int "semTelefone",
      count(*) FILTER(WHERE coalesce(p.nao_contatar,false) OR p.pausa_ate>now() OR EXISTS(SELECT 1 FROM cobranca_contestacoes d WHERE d.provider_id=c.provider_id AND d.customer_id=c.id AND d.status='aberta'))::int pausadas,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM cobranca_pre_avisos a WHERE a.provider_id=i.provider_id AND a.fatura_id=i.id AND a.status='enviado') OR EXISTS(SELECT 1 FROM cobranca_comunicacoes m WHERE m.provider_id=i.provider_id AND m.fatura_id=i.id AND m.status='enviado'))::int avisadas
      FROM invoices i JOIN customers c ON c.provider_id=i.provider_id AND c.id=i.customer_id LEFT JOIN cobranca_preferencias_contato p ON p.provider_id=c.provider_id AND p.customer_id=c.id
      WHERE i.provider_id=$1 AND c.status='active' AND coalesce(c.total_overdue_amount,0)<=0 AND i.status IN ('aberta','pending') AND i.due_date::date BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date AND (now() AT TIME ZONE 'America/Sao_Paulo')::date+7`,[pid]),
    pool.query<{canal:string;tentativas:number;enviados:number;incertos:number;falhas:number}>(`SELECT o.canal,count(*)::int tentativas,count(*) FILTER(WHERE o.status='enviado')::int enviados,count(*) FILTER(WHERE o.status IN ('incerto','reservado'))::int incertos,count(*) FILTER(WHERE o.status='falhou')::int falhas
      FROM cobranca_contatos_orcamento o JOIN customers c ON c.provider_id=o.provider_id AND c.id=o.customer_id WHERE o.provider_id=$1 AND ${carteiraSql}=$2 AND o.criado_em>=now()-interval '30 days' GROUP BY o.canal`,[pid,carteira]),
    pool.query<{config:{ligada?:boolean;canal?:string;incluirLinkFatura?:boolean;limiteDiario?:number}}>(`SELECT config FROM cobranca_avisos_config WHERE provider_id=$1`,[pid]),
  ]);
  const agora=Date.now();
  const resultado=await pool.query<{confirmado:number;faturasPagas:number;diasConferencia:number|null;parcelasVencidas:number;parcelasCumpridas:number}>(`
    SELECT coalesce(sum(i.paid_value) FILTER(WHERE i.status='paid' AND i.paid_date>=now()-interval '30 days'),0)::float8 confirmado,
      count(*) FILTER(WHERE i.status='paid' AND i.paid_date>=now()-interval '30 days' AND i.paid_value>0)::int "faturasPagas",
      (SELECT avg(extract(epoch FROM(q.confirmado_em-f.baixada_em))/86400)::float8 FROM cobranca_quitacoes q JOIN invoices f ON f.provider_id=q.provider_id AND f.id=q.fatura_id JOIN customers c ON c.provider_id=q.provider_id AND c.id=q.customer_id WHERE q.provider_id=$1 AND ${carteiraSql}=$2 AND q.confirmado_em>=now()-interval '30 days' AND f.baixada_em<=q.confirmado_em) "diasConferencia",
      (SELECT count(*)::int FROM cobranca_parcelas p JOIN cobranca_negociacoes n ON n.provider_id=p.provider_id AND n.id=p.negociacao_id JOIN customers c ON c.provider_id=n.provider_id AND c.id=n.customer_id WHERE p.provider_id=$1 AND ${carteiraSql}=$2 AND p.vencimento BETWEEN current_date-30 AND current_date-1 AND p.status<>'cancelada' AND n.status IN ('aceita','ativa','cumprida','quebrada')) "parcelasVencidas",
      (SELECT count(*)::int FROM cobranca_parcelas p JOIN cobranca_negociacoes n ON n.provider_id=p.provider_id AND n.id=p.negociacao_id JOIN customers c ON c.provider_id=n.provider_id AND c.id=n.customer_id WHERE p.provider_id=$1 AND ${carteiraSql}=$2 AND p.vencimento BETWEEN current_date-30 AND current_date-1 AND p.status='paga' AND p.valor_pago>=p.valor AND p.pago_em::date<=p.vencimento AND n.status IN ('aceita','ativa','cumprida','quebrada')) "parcelasCumpridas"
    FROM invoices i JOIN customers c ON c.provider_id=i.provider_id AND c.id=i.customer_id WHERE i.provider_id=$1 AND ${carteiraSql}=$2`,[pid,carteira]);
  const base=clientes.rows.slice(0,5000).map(c=>({...c,saldo:Number(c.saldo??0),divergencia:Math.abs(Number(c.saldo??0)-Number(c.saldoFaturas))>0.01,syncPendente:!c.sincronizadoEm||agora-new Date(c.sincronizadoEm).getTime()>cfg.syncMaxHoras*3600000,
    elegivel:Math.max(0,Number(c.saldo??0)-Number(c.valorContestado)),simulacao:simularEconomia({saldo:Math.max(0,Number(c.saldo??0)-Number(c.valorContestado)),custo:cfg.custoContato,probabilidade:cfg.probabilidadeSimulada,margemMensal:cfg.margemMensalSimulada,meses:cfg.mesesRetencao,carteira})}));
  return {config:cfg,carteira,geradoEm:new Date().toISOString(),limites:{clientes:clientes.rows.length>5000,contestacoes:disputas.rows.length>200,agenda:agenda.rows.length>500,promessas:promessas.rows.length>200},
    contestacoes:disputas.rows.slice(0,200),agenda:agenda.rows.slice(0,500),promessas:promessas.rows.slice(0,200),
    diagnostico:base.filter(c=>c.divergencia||c.syncPendente||c.aguardandoConfirmacao>0||c.pagamentosParciais>0).slice(0,200),
    prioridades:base.filter(c=>c.elegivel>0&&c.valorContestado===0).sort((a,b)=>b.simulacao.resultado-a.simulacao.resultado).slice(0,50),
    coortes:coortes.rows,resultados:resultado.rows[0],preventivo:carteira==='ativo'?{...preventivo.rows[0],config:configPreventivo.rows[0]?.config??{ligada:false}}:null,contatos:contatos.rows};
}
