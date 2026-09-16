import { pool } from "../db";
import { lerComunicacaoConfig, type ComunicacaoConfig, type CandidatoComunicacao } from "@shared/cobranca/comunicacao";

export async function configComunicacao(providerId: number) {
  const r = await pool.query<{ config: unknown }>("select config from cobranca_comunicacao_config where provider_id=$1", [providerId]);
  return lerComunicacaoConfig(r.rows[0]?.config);
}
export async function salvarComunicacao(providerId: number, config: ComunicacaoConfig) {
  await pool.query("insert into cobranca_comunicacao_config(provider_id,config) values($1,$2) on conflict(provider_id) do update set config=excluded.config,updated_at=now()", [providerId, JSON.stringify(config)]);
}
export async function provedoresComunicacao() {
  const r = await pool.query<{ provider_id: number }>("select provider_id from cobranca_comunicacao_config where config->>'ligada'='true' union select provider_id from cobranca_avisos_config where config->>'ligada'='true'");
  return r.rows.map(r => r.provider_id);
}
/** Uma mesma projeção serve prévia e envio. Todos os joins repetem o provedor. */
export async function candidatosComunicacao(providerId: number, customerId?: number, excluir: { comunicacaoId?: number; preAvisoId?: number } = {}) {
  const r = await pool.query<CandidatoComunicacao>(`
    select c.id as "customerId", c.name as nome,c.email,c.phone as telefone,c.status as "statusCliente",
      coalesce(c.max_days_overdue,0) as "diasAtraso",coalesce(c.total_overdue_amount,0)::float8 as saldo,
      k.id as "casoId",k.carteira,k.status as "statusCaso",k.tom,k.proximo_contato_em as "proximoContato",
      exists(select 1 from chat_bullq_conversas b where b.provider_id=c.provider_id and b.customer_id=c.id and b.status<>'CLOSED') as "conversaAtiva",
      coalesce(p.nao_contatar,false) as "naoContatar",p.pausa_ate as "pausaAte",
      greatest((select max(m.criado_em) from cobranca_comunicacoes m where m.provider_id=c.provider_id and m.customer_id=c.id and m.status in('enviando','enviado','incerto') and ($3::int is null or m.id<>$3)),
        (select max(a.atualizado_em) from cobranca_pre_avisos a where a.provider_id=c.provider_id and a.customer_id=c.id and a.status in('enviando','enviado','incerto') and ($4::int is null or a.id<>$4)),
        (select max(e.ocorrido_em) from cobranca_eventos e where e.provider_id=c.provider_id and e.customer_id=c.id and e.tipo in('contato','promessa'))) as "ultimoContato"
    from customers c left join cobranca_casos k on k.provider_id=c.provider_id and k.customer_id=c.id and k.status not in('pago','baixado','encerrado','cancelamento')
    left join cobranca_preferencias_contato p on p.provider_id=c.provider_id and p.customer_id=c.id
    where c.provider_id=$1 and ($2::int is null or c.id=$2)
    order by k.proximo_contato_em nulls first,c.id limit 10001`, [providerId, customerId ?? null, excluir.comunicacaoId ?? null, excluir.preAvisoId ?? null]);
  return r.rows;
}
export async function reservarComunicacao(d: {providerId:number;customerId:number;casoId:number|null;faturaId:number|null;canal:string;finalidade:string;dia:string;chave:string}) {
  const r = await pool.query<{id:number}>(`insert into cobranca_comunicacoes(provider_id,customer_id,caso_id,fatura_id,canal,finalidade,chave,dia,status)
    select $1,$2,$3,$4,$5,$6,$7,$8,'enviando' where exists(select 1 from customers where provider_id=$1 and id=$2)
    and exists(select 1 from providers where id=$1 and status='active')
    and ($3::int is null or exists(select 1 from cobranca_casos where provider_id=$1 and customer_id=$2 and id=$3))
    and ($4::int is null or exists(select 1 from invoices where provider_id=$1 and customer_id=$2 and id=$4))
    and not exists(select 1 from cobranca_preferencias_contato where provider_id=$1 and customer_id=$2 and (nao_contatar or pausa_ate>now()))
    on conflict do nothing returning id`, [d.providerId,d.customerId,d.casoId,d.faturaId,d.canal,d.finalidade,d.chave,d.dia]);
  return r.rows[0]?.id ?? null;
}
export async function concluirComunicacao(providerId:number,id:number,r:{status:string;motivo?:string;providerMessageId?:string}) {
  // O evento e o resultado são confirmados na mesma transação. Se o gateway já aceitou e o DB falha,
  // a reserva permanece e impede reenvio silencioso.
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`with atualizado as (update cobranca_comunicacoes set status=$3,motivo=$4,provider_message_id=$5,atualizado_em=now()
      where provider_id=$1 and id=$2 and status='enviando' returning *),
      contato_do_caso as (update cobranca_casos k set ultimo_contato_em=greatest(k.ultimo_contato_em,a.criado_em)
        from atualizado a where k.provider_id=a.provider_id and k.id=a.caso_id and k.customer_id=a.customer_id
        and a.status in ('enviado','incerto') returning k.id)
      insert into cobranca_eventos(provider_id,caso_id,customer_id,tipo,canal,resultado,notas,metadata)
      select provider_id,caso_id,customer_id,case when status='enviado' then 'contato' else 'nota' end,canal,
      case when status='enviado' then 'mensagem_enviada' else null end,
      case when status='enviado' then 'Mensagem aceita pelo fornecedor; entrega e resposta ainda não confirmadas.' else coalesce(motivo,'Envio sem confirmação') end,
      jsonb_build_object('comunicacaoId',id,'status',status,'providerMessageId',provider_message_id)
      from atualizado where caso_id is not null`,[providerId,id,r.status,r.motivo?.slice(0,250) ?? null,r.providerMessageId ?? null]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
export async function consumoComunicacao(providerId:number,dia:string,finalidade?:string) {
  const r=await pool.query<{n:number}>("select count(*)::int n from cobranca_comunicacoes where provider_id=$1 and dia=$2 and status in('enviando','enviado','incerto') and ($3::text is null or finalidade=$3)",[providerId,dia,finalidade??null]);
  return r.rows[0]?.n ?? 0;
}
/** Releitura final do espelho financeiro, inclusive após tomar a reserva do aviso. */
export async function faturaAtualComunicacao(providerId: number, customerId: number, faturaId: number) {
  const r = await pool.query<{ id: number; status: string; vencimento: Date; valor: number }>(`
    select f.id,f.status,f.due_date as vencimento,f.value::float8 as valor
    from invoices f join customers c on c.provider_id=f.provider_id and c.id=f.customer_id
    join providers p on p.id=f.provider_id and p.status='active'
    where f.provider_id=$1 and f.customer_id=$2 and f.id=$3 and f.erp_ref is not null
      and f.status in ('aberta','pending','overdue') and c.status='active'
      and coalesce(c.total_overdue_amount,0)<=0 and f.value>0`, [providerId,customerId,faturaId]);
  return r.rows[0] ?? null;
}
export async function diarioComunicacao(providerId:number,carteira?:"ativo"|"ex_cliente") {
  const r=await pool.query(`select m.id,m.customer_id as "customerId",c.name as cliente,m.canal,m.finalidade,m.status,m.motivo,m.criado_em as "criadoEm",m.caso_id as "casoId",m.provider_message_id as "providerMessageId"
    from cobranca_comunicacoes m join customers c on c.provider_id=m.provider_id and c.id=m.customer_id
    left join cobranca_casos k on k.provider_id=m.provider_id and k.customer_id=m.customer_id and k.id=m.caso_id
    where m.provider_id=$1 and ($2::text is null or
      ((case when c.status in ('active','suspended') then 'ativo' when c.status in ('inactive','cancelled') then 'ex_cliente' end)=$2
      and (m.caso_id is null or k.carteira=$2))) order by m.id desc limit 100`,[providerId,carteira??null]);
  return r.rows;
}
export async function pausarComunicacao(providerId:number,customerId:number,userId:number,acao:"respondeu"|"pagamento_informado"|"nao_contatar"|"retomar") {
  const c=await pool.connect();
  try {
    await c.query("begin");
    const result=await c.query(`insert into cobranca_preferencias_contato(provider_id,customer_id,user_id,nao_contatar,pausa_ate,motivo)
      select $1,$2,$3,$4,case when $5 then now()+interval '48 hours' else null end,$6
      where exists(select 1 from customers where provider_id=$1 and id=$2)
      on conflict(provider_id,customer_id) do update set user_id=excluded.user_id,
      nao_contatar=case when excluded.motivo='retomar' then false else cobranca_preferencias_contato.nao_contatar or excluded.nao_contatar end,
      pausa_ate=excluded.pausa_ate,motivo=excluded.motivo,updated_at=now()
      returning customer_id`,[providerId,customerId,userId,acao==='nao_contatar',acao==='respondeu'||acao==='pagamento_informado',acao]);
    if(!result.rowCount){await c.query("rollback");return false;}
    await c.query(`insert into cobranca_eventos(provider_id,caso_id,customer_id,user_id,tipo,canal,notas,metadata)
      select provider_id,id,customer_id,$3,'nota','sistema',$4,jsonb_build_object('acaoContato',$5) from cobranca_casos
      where provider_id=$1 and customer_id=$2 and status not in('pago','baixado','encerrado','cancelamento')`,[providerId,customerId,userId,acao==='pagamento_informado'?'Cliente informou pagamento: contato pausado por 48 horas para conferência. Nenhuma baixa financeira realizada.':`Preferência de contato atualizada: ${acao}`,acao]);
    await c.query("commit");return true;
  }catch(e){await c.query("rollback");throw e;}finally{c.release();}
}
