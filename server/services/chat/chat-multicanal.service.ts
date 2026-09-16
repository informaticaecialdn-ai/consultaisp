import { comOrcamentoContato, contatoComResultado } from "../cobranca/gestao-operacional.service";
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../../db';
import { storage } from '../../storage';
import { autonomiaStorage } from '../../storage/chat-autonomia.storage';
import { comTravaDoChat } from './chat-trava';
import { ErroDaPonteDoChat } from './chat-ponte.service';
import { enviarComunicacaoCobranca, obterConfiguracaoCanais, obterConfiguracaoCanaisInterna } from '../cobranca/canais-comunicacao.service';
import { orientarContato } from '@shared/cobranca/contato';
import { resolverEtapas } from '@shared/cobranca/regua';
import { janelaDoChat } from '@shared/cobranca/automacao-chat';
import * as diario from '../../storage/cobranca-comunicacao.storage';

export class ErroMulticanal extends Error {}
export const ConfigMulticanal = z.object({reforcoAtivo:z.boolean(),intervaloHoras:z.number().int().min(24).max(720),canais:z.array(z.enum(['sms','email'])).min(1).max(2)});
export const EnvioMulticanal = z.object({canal:z.enum(['sms','email']),texto:z.string().trim().max(10000).default(''),assunto:z.string().trim().max(200).optional(),propostaId:z.number().int().positive().optional(),confirmarProposta:z.boolean().optional(),chave:z.string().uuid()});
type Vinculo = {customer_id:number;caso_id:number|null;status:string;name:string;email:string|null;phone:string|null;provider_name:string;etapa_atual:string|null;carteira:string|null};
async function vinculo(pid:number,cid:string):Promise<Vinculo>{
 // A etapa e a carteira do CASO da conversa: é delas que sai a base legal do evento de contato.
 const r=await pool.query<Vinculo>(`SELECT v.customer_id,v.caso_id,v.status,c.name,c.email,c.phone,p.name provider_name,k.etapa_atual,k.carteira FROM chat_bullq_conversas v JOIN customers c ON c.id=v.customer_id AND c.provider_id=v.provider_id JOIN providers p ON p.id=v.provider_id LEFT JOIN cobranca_casos k ON k.provider_id=v.provider_id AND k.id=v.caso_id WHERE v.provider_id=$1 AND v.conversation_id=$2 AND p.status='active'`,[pid,cid]);
 if(!r.rows[0])throw new ErroMulticanal('Conversa não encontrada');return r.rows[0];
}
async function config(pid:number,cid:string){
 await pool.query(`INSERT INTO chat_multicanal_config(provider_id,conversation_id,reply_token) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[pid,cid,randomBytes(24).toString('hex')]);
 const r=await pool.query<{reply_token:string;reforco_ativo:boolean;intervalo_horas:number;canais:('sms'|'email')[]}>(`SELECT * FROM chat_multicanal_config WHERE provider_id=$1 AND conversation_id=$2`,[pid,cid]);return r.rows[0];
}
export async function listarMulticanal(pid:number,cid:string){
 const v=await vinculo(pid,cid);const cfg=await config(pid,cid);const canais=await obterConfiguracaoCanais(pid);
 const mensagens=await pool.query(`SELECT id::text,canal,direcao,texto,assunto,status,criado_em AS "criadoEm" FROM (SELECT * FROM chat_multicanal_mensagens WHERE provider_id=$1 AND conversation_id=$2 ORDER BY id DESC LIMIT 500) m ORDER BY criado_em,id`,[pid,cid]);
 const propostas=await pool.query(`SELECT id,'Proposta #'||id||' · R$ '||valor_negociado AS rotulo FROM cobranca_negociacoes WHERE provider_id=$1 AND caso_id=$2 AND customer_id=$3 AND status IN ('proposta','aceita','ativa') ORDER BY id DESC LIMIT 30`,[pid,v.caso_id,v.customer_id]);
 return {mensagens:mensagens.rows,canais:{sms:canais.sms.ativado&&canais.sms.configurado,email:canais.email.ativado&&canais.email.configurado},propostas:propostas.rows,config:{reforcoAtivo:cfg.reforco_ativo,intervaloHoras:cfg.intervalo_horas,canais:cfg.canais}};
}
export async function configurarMulticanal(pid:number,cid:string,entrada:unknown){
 await vinculo(pid,cid);const c=ConfigMulticanal.parse(entrada);await config(pid,cid);
 await pool.query(`UPDATE chat_multicanal_config SET reforco_ativo=$3,intervalo_horas=$4,canais=$5::jsonb WHERE provider_id=$1 AND conversation_id=$2`,[pid,cid,c.reforcoAtivo,c.intervaloHoras,JSON.stringify([...new Set(c.canais)])]);return c;
}
export function escaparHtml(s:string){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
export function formatarProposta(nome:string,empresa:string,p:{id:number;valor_negociado:string;entrada:string;parcelas:number;valor_parcela:string;primeiro_vencimento:string}){
 const moeda=(v:string)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const dia=String(p.primeiro_vencimento).slice(0,10).split('-').reverse().join('/');
 const assunto=`Proposta de negociação #${p.id} · ${empresa}`;
 const texto=`Olá, ${nome}.\n\nConfira a proposta #${p.id} de ${empresa}:\nValor total: ${moeda(p.valor_negociado)}\nEntrada: ${moeda(p.entrada||'0')}\nParcelamento: ${p.parcelas} parcela(s) de ${moeda(p.valor_parcela)}\nPrimeiro vencimento: ${dia}\n\nResponda este e-mail para conversar com nossa equipe. O envio não confirma a aceitação nem o pagamento da proposta.`;
 const html=`<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172554"><div style="max-width:600px;margin:24px auto;background:white;border-radius:16px;overflow:hidden"><div style="padding:24px;background:#1746a2;color:white"><strong>${escaparHtml(empresa)}</strong><h1 style="font-size:24px">Sua proposta de negociação</h1></div><div style="padding:28px;white-space:pre-line;line-height:1.7">${escaparHtml(texto)}</div></div></body></html>`;
 return {assunto,texto,html};
}
export async function propostaMulticanal(pid:number,cid:string,id:number){
 const v=await vinculo(pid,cid);const r=await pool.query(`SELECT id,valor_negociado,entrada,parcelas,valor_parcela,primeiro_vencimento::text FROM cobranca_negociacoes WHERE provider_id=$1 AND caso_id=$2 AND customer_id=$3 AND id=$4 AND status IN ('proposta','aceita','ativa')`,[pid,v.caso_id,v.customer_id,id]);
 if(!r.rows[0])throw new ErroMulticanal('Proposta indisponível nesta conversa');
 const p=r.rows[0];
 if(!p.primeiro_vencimento||p.valor_parcela===null||!Number.isFinite(Number(p.valor_negociado))||!Number.isFinite(Number(p.valor_parcela)))throw new ErroMulticanal('Complete os valores e o vencimento da negociação antes de gerar a proposta');
 return formatarProposta(v.name,v.provider_name,p);
}
export async function enviarMulticanal(pid:number,cid:string,userId:number|null,entrada:unknown,automatico=false){
 const e=EnvioMulticanal.parse(entrada);
 const resultado=await comTravaDoChat(`autonomia:${pid}:${cid}`,async()=>{
  const v=await vinculo(pid,cid);
  if(!automatico&&v.status!=='OPEN')throw new ErroMulticanal('Assuma a conversa antes de enviar');
  // A pausa (cliente respondeu, informou pagamento, conferência) foi o cliente quem
  // pediu: vale para o atendente igual, não só para o reforço automático.
  const impedimento=await pool.query(`SELECT 1 FROM cobranca_preferencias_contato WHERE provider_id=$1 AND customer_id=$2 AND (nao_contatar OR pausa_ate>now())`,[pid,v.customer_id]);
  if(impedimento.rowCount)throw new ErroDaPonteDoChat('CONFLITO','Contato pausado para este cliente: pedido de não contato, resposta recente ou pagamento informado. Aguarde a pausa terminar antes de enviar.');
  if(!automatico){
   // Horário de contato é limite duro (CDC art. 42 / Anatel 765) e vale para a mão
   // humana: SMS e e-mail chegam ao cliente na mesma hora. O reforço automático já
   // passou pela janela em podeReforcar.
   const politica=await storage.getPoliticaDeCobranca(pid);
   if(!janelaDoChat(new Date(),politica?.janelaContato).permitida)throw new ErroDaPonteDoChat('CONFLITO','Fora do horário de contato da política de cobrança (CDC art. 42 / Anatel 765). SMS e e-mail só saem dentro da janela permitida.');
  }
  if(automatico&&!await podeReforcar(pid,cid))return {status:'ignorado'};
  let texto=e.texto,assunto=e.assunto,html:string|undefined;
  if(e.propostaId){if(e.canal!=='email'||!e.confirmarProposta)throw new ErroMulticanal('Revise e confirme a proposta antes do envio');const p=await propostaMulticanal(pid,cid,e.propostaId);({texto,assunto,html}=p);}
  if(!texto|| (e.canal==='sms'&&texto.length>1000))throw new ErroMulticanal('Escreva a mensagem; SMS aceita até 1.000 caracteres');
  const destinatario=e.canal==='email'?v.email:v.phone;if(!destinatario)throw new ErroMulticanal('Cliente sem contato cadastrado para este canal');
  const cfg=await config(pid,cid);const canais=await obterConfiguracaoCanaisInterna(pid);
  const replyTo=e.canal==='email'&&canais.email.receivingDomain?`chat+${cfg.reply_token}@${canais.email.receivingDomain}`:undefined;
  const reserva=await pool.query<{id:string}>(`INSERT INTO chat_multicanal_mensagens(provider_id,conversation_id,canal,direcao,texto,assunto,status,chave) VALUES($1,$2,$3,'saida',$4,$5,'enviando',$6) ON CONFLICT DO NOTHING RETURNING id`,[pid,cid,e.canal,texto,assunto||null,e.chave]);
  if(!reserva.rows[0])return {status:'ja_registrado'};
  if(!automatico)await autonomiaStorage.cancelar(pid,cid,'Atendente enviou mensagem multicanal');
  const id=reserva.rows[0].id;
  // Uma tentativa interrompida fica visível e bloqueia repetição automática.
  if(automatico)await pool.query(`UPDATE chat_multicanal_config SET ultimo_reforco_em=now() WHERE provider_id=$1 AND conversation_id=$2`,[pid,cid]);
  const r=await contatoComResultado(()=>comOrcamentoContato(pid,v.customer_id,e.canal,automatico,()=>enviarComunicacaoCobranca(pid,{canal:e.canal,destinatario,texto,assunto,idempotencyKey:`chat:${pid}:${id}`},{html,replyTo}),`chat:${pid}:${id}`));
  const conn=await pool.connect();try{await conn.query('BEGIN');
   // Bloqueio anterior ao transporte não tem id do fornecedor: nada saiu.
   await conn.query(`UPDATE chat_multicanal_mensagens SET status=$3,external_id=$4 WHERE provider_id=$1 AND id=$2`,[pid,id,r.status,('providerMessageId' in r&&r.providerMessageId)||null]);
   await conn.query(`UPDATE chat_bullq_conversas SET ultimo_evento_em=now() WHERE provider_id=$1 AND conversation_id=$2`,[pid,cid]);
   if(automatico)await conn.query(`UPDATE chat_multicanal_config SET ultimo_reforco_em=now() WHERE provider_id=$1 AND conversation_id=$2`,[pid,cid]);
   if(v.caso_id&&r.status==='enviado'){
    // `etapa`/`baseLegal`/`motivoLegal` como no evento da régua (`concluirComunicacao`): a
    // auditoria lê a mesma base legal no contato do atendente, no reforço e na régua.
    await conn.query(`INSERT INTO cobranca_eventos(provider_id,caso_id,customer_id,user_id,tipo,canal,resultado,notas,metadata) VALUES($1,$2,$3,$4,'contato',$5,'mensagem_enviada',$6,$7::jsonb)`,[pid,v.caso_id,v.customer_id,userId,e.canal,automatico?'Reforço automático aceito pelo canal':'Mensagem do atendente aceita pelo canal',JSON.stringify(diario.baseLegalDaEtapa(v.carteira,v.etapa_atual))]);
    await conn.query(`UPDATE cobranca_casos SET ultimo_contato_em=now(),updated_at=now(),proxima_acao=CASE WHEN $3 THEN proxima_acao ELSE 'Aguardar resposta do cliente' END,proximo_contato_em=CASE WHEN $3 THEN proximo_contato_em ELSE now()+interval '1 day' END WHERE provider_id=$1 AND id=$2`,[pid,v.caso_id,automatico]);
   }await conn.query('COMMIT');
  }catch(err){await conn.query('ROLLBACK');throw err;}finally{conn.release();}
  return r;
 });if(!resultado)throw new ErroMulticanal('Conversa em atualização. Tente novamente');return resultado;
}

export async function persistirRetornoMulticanal(pid:number,e:{canal:'sms'|'email';externalId:string;remetente:string;destinatario:string;texto:string;assunto?:string;replyToken?:string}){
 if(!Number.isSafeInteger(pid)||pid<=0||!e.externalId||e.externalId.length>200||!e.texto.trim())return {recebido:false};
 type DestinoRetorno={conversation_id:string;customer_id:number;caso_id:number|null};
 // Compare the full international number. Local Brazilian ERP numbers receive
 // DDI 55; matching only the suffix could attach a foreign number to this client.
 const localizar=`SELECT v.conversation_id,v.customer_id,v.caso_id FROM chat_bullq_conversas v JOIN customers c ON c.id=v.customer_id AND c.provider_id=v.provider_id JOIN providers p ON p.id=v.provider_id AND p.status='active' LEFT JOIN chat_multicanal_config cfg ON cfg.provider_id=v.provider_id AND cfg.conversation_id=v.conversation_id WHERE v.provider_id=$1 AND (($2='email' AND cfg.reply_token=$3 AND lower(trim(c.email))=lower($4)) OR ($2='sms' AND (CASE WHEN length(regexp_replace(c.phone,'[^0-9]','','g')) IN (10,11) THEN '55'||regexp_replace(c.phone,'[^0-9]','','g') ELSE regexp_replace(c.phone,'[^0-9]','','g') END)=regexp_replace($4,'[^0-9]','','g') AND EXISTS(SELECT 1 FROM chat_multicanal_mensagens m WHERE m.provider_id=v.provider_id AND m.conversation_id=v.conversation_id AND m.canal='sms' AND m.direcao='saida' AND m.status IN ('enviado','incerto','enviando')))) LIMIT 2`;
 const parametros=[pid,e.canal,e.replyToken||null,e.remetente];
 const r=await pool.query<DestinoRetorno>(localizar,parametros);
 if(r.rows.length!==1)return {recebido:false};const v=r.rows[0];
 const resultado=await comTravaDoChat(`autonomia:${pid}:${v.conversation_id}`,async()=>{
 const conn=await pool.connect();try{await conn.query('BEGIN');
  const atual=await conn.query<DestinoRetorno>(localizar+' FOR UPDATE OF v,c',parametros);
  if(atual.rows.length!==1||atual.rows[0].conversation_id!==v.conversation_id||atual.rows[0].customer_id!==v.customer_id||atual.rows[0].caso_id!==v.caso_id){await conn.query('COMMIT');return {recebido:false};}
  const inserida=await conn.query(`INSERT INTO chat_multicanal_mensagens(provider_id,conversation_id,canal,direcao,texto,assunto,status,chave,external_id) VALUES($1,$2,$3,'entrada',$4,$5,'recebido',$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[pid,v.conversation_id,e.canal,e.texto.slice(0,30000),e.assunto?.slice(0,200)||null,`retorno:${e.canal}:${e.externalId}`,e.externalId]);
  if(!inserida.rowCount){await conn.query('COMMIT');return {recebido:true,repetido:true};}
  await conn.query(`UPDATE chat_multicanal_config SET reforco_ativo=false WHERE provider_id=$1 AND conversation_id=$2`,[pid,v.conversation_id]);
  await conn.query(`UPDATE chat_bullq_conversas SET status=CASE WHEN status='OPEN' THEN 'OPEN' ELSE 'PENDING' END,ultimo_evento_em=now() WHERE provider_id=$1 AND conversation_id=$2`,[pid,v.conversation_id]);
  await conn.query(`INSERT INTO chat_autonomia_estado(provider_id,conversation_id,humano,motivo) VALUES($1,$2,true,'Cliente respondeu por SMS/e-mail') ON CONFLICT(provider_id,conversation_id) DO UPDATE SET humano=true,proposta=null,motivo=excluded.motivo,updated_at=now()`,[pid,v.conversation_id]);
  await conn.query(`UPDATE chat_autonomia_fila SET status='cancelado',motivo='Cliente respondeu por SMS/e-mail',updated_at=now() WHERE provider_id=$1 AND conversation_id=$2 AND status='pendente'`,[pid,v.conversation_id]);
  await conn.query(`INSERT INTO cobranca_preferencias_contato(provider_id,customer_id,pausa_ate,motivo) VALUES($1,$2,now()+interval '48 hours','Cliente respondeu no chat') ON CONFLICT(provider_id,customer_id) DO UPDATE SET pausa_ate=greatest(cobranca_preferencias_contato.pausa_ate,excluded.pausa_ate),motivo=excluded.motivo,updated_at=now()`,[pid,v.customer_id]);
  if(v.caso_id){
   await conn.query(`UPDATE cobranca_casos SET proxima_acao='Responder no chat',proximo_contato_em=now(),updated_at=now() WHERE provider_id=$1 AND id=$2 AND encerrado_em IS NULL`,[pid,v.caso_id]);
   await conn.query(`INSERT INTO cobranca_eventos(provider_id,caso_id,customer_id,tipo,canal,resultado,notas) VALUES($1,$2,$3,'contato',$4,'falou','Cliente respondeu; encaminhado ao atendimento humano')`,[pid,v.caso_id,v.customer_id,e.canal]);
  }await conn.query('COMMIT');return {recebido:true};
 }catch(err){await conn.query('ROLLBACK');throw err;}finally{conn.release();}
 });
 // A busy lock must produce a retryable webhook response, never acknowledge
 // and lose the customer's reply while the worker is sending.
 if(!resultado)throw new ErroMulticanal('Conversa em atualização; tente o retorno novamente');
 return resultado;
}

export async function podeReforcar(pid:number,cid:string,agora=new Date()){
 // O interruptor geral de SMS/e-mail (Comunicações → ligada) manda no reforço:
 // desligar o canal tem de desligar o reforço por conversa também, senão a
 // configuração da conversa vira um canal paralelo que ninguém desligou.
 if(!(await diario.configComunicacao(pid)).ligada)return false;
 const politica=await storage.getPoliticaDeCobranca(pid);if(politica?.pausada||!janelaDoChat(agora,politica?.janelaContato).permitida)return false;
 const r=await pool.query(`SELECT cli.max_days_overdue AS atraso,c.carteira,c.status,c.tom,c.quadrante_dna AS quadrante FROM chat_multicanal_config cfg JOIN chat_bullq_conversas v USING(provider_id,conversation_id) JOIN cobranca_casos c ON c.id=v.caso_id AND c.provider_id=v.provider_id JOIN customers cli ON cli.id=v.customer_id AND cli.provider_id=v.provider_id LEFT JOIN chat_autonomia_estado a ON a.provider_id=v.provider_id AND a.conversation_id=v.conversation_id LEFT JOIN cobranca_preferencias_contato p ON p.provider_id=v.provider_id AND p.customer_id=v.customer_id WHERE cfg.provider_id=$1 AND cfg.conversation_id=$2 AND cfg.reforco_ativo AND v.status IN ('BOT','WAITING') AND NOT coalesce(a.humano,false) AND c.encerrado_em IS NULL AND c.status='aberto' AND cli.total_overdue_amount>0 AND coalesce(c.tom,'') NOT LIKE '%vulneravel%' AND NOT coalesce(p.nao_contatar,false) AND (p.pausa_ate IS NULL OR p.pausa_ate<now()) AND greatest(coalesce(cfg.ultimo_reforco_em,v.aberta_em),coalesce(c.ultimo_contato_em,v.aberta_em)) < now()-make_interval(hours=>cfg.intervalo_horas) AND NOT EXISTS(SELECT 1 FROM chat_multicanal_mensagens m WHERE m.provider_id=v.provider_id AND m.conversation_id=v.conversation_id AND m.direcao='entrada')`,[pid,cid]);const c=r.rows[0];return Boolean(c && orientarContato({diasAtraso:Number(c.atraso),carteira:c.carteira,status:c.status,tom:c.tom,quadrante:c.quadrante,etapas:resolverEtapas(politica)}).automatizavel);
}
export async function executarReforcosMulticanal(){
 const candidatos=await pool.query<{provider_id:number;conversation_id:string;canais:('sms'|'email')[]}>(`SELECT provider_id,conversation_id,canais FROM chat_multicanal_config WHERE reforco_ativo ORDER BY ultimo_reforco_em NULLS FIRST LIMIT 100`);
 for(const c of candidatos.rows){await comTravaDoChat(`agenda:${c.provider_id}`,async()=>{
  if(!await podeReforcar(c.provider_id,c.conversation_id))return;
  const v=await vinculo(c.provider_id,c.conversation_id);const disponibilidade=await obterConfiguracaoCanais(c.provider_id);
  const anteriores=await pool.query<{canal:string}>(`SELECT canal FROM chat_multicanal_mensagens WHERE provider_id=$1 AND conversation_id=$2 AND direcao='saida' ORDER BY id DESC LIMIT 1`,[c.provider_id,c.conversation_id]);
  const canais=c.canais.filter(x=>disponibilidade[x].ativado&&disponibilidade[x].configurado&&(x==='email'?v.email:v.phone));
  const canal=canais.find(x=>x!==anteriores.rows[0]?.canal)||canais[0];if(!canal)return;
  const politica=await storage.getPoliticaDeCobranca(c.provider_id);
  const dia=janelaDoChat(new Date(),politica?.janelaContato).dia;
  // Relido aqui, depois das leituras lentas: o interruptor pode ter sido desligado entre podeReforcar e a reserva.
  const limites=await diario.configComunicacao(c.provider_id);
  if(!limites.ligada||await diario.consumoComunicacao(c.provider_id,dia,'cobranca')>=limites.limiteDiario)return;
  const reserva=await diario.reservarComunicacao({providerId:c.provider_id,customerId:v.customer_id,casoId:v.caso_id,faturaId:null,canal,finalidade:'cobranca',dia,chave:`reforco:${c.conversation_id}:${dia}`});
  if(!reserva)return;
  const {randomUUID}=await import('node:crypto');
  const envio=await enviarMulticanal(c.provider_id,c.conversation_id,null,{canal,chave:randomUUID(),assunto:`Atendimento · ${v.provider_name}`,texto:`Olá! Aqui é a equipe da ${v.provider_name}. Estamos disponíveis para ajudar com seu atendimento. Responda por este canal para falar com um atendente.`},true);
  await pool.query(`UPDATE cobranca_comunicacoes SET status=$3,atualizado_em=now() WHERE provider_id=$1 AND id=$2`,[c.provider_id,reserva,['enviado','falhou','incerto'].includes(envio.status)?envio.status:'ignorado']);
 });}
}

