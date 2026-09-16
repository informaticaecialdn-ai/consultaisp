import { pgTable,integer,serial,bigserial,text,jsonb,timestamp,date,boolean,unique,index,primaryKey,check,foreignKey,uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { providers,customers,cobrancaCasos,invoices,users,chatBullqConversas } from './schema';

export const chatMulticanalConfig=pgTable('chat_multicanal_config',{
 providerId:integer('provider_id').notNull().references(()=>providers.id,{onDelete:'cascade'}),conversationId:text('conversation_id').notNull(),replyToken:text('reply_token').notNull().unique(),reforcoAtivo:boolean('reforco_ativo').notNull().default(false),intervaloHoras:integer('intervalo_horas').notNull().default(72),canais:jsonb('canais').notNull().default(['email']),ultimoReforcoEm:timestamp('ultimo_reforco_em',{withTimezone:true}),
},t=>[primaryKey({columns:[t.providerId,t.conversationId]}),foreignKey({columns:[t.providerId,t.conversationId],foreignColumns:[chatBullqConversas.providerId,chatBullqConversas.conversationId]}).onDelete('cascade'),check('chat_multicanal_config_intervalo_horas_check',sql`${t.intervaloHoras} between 24 and 720`)]);
export const chatMulticanalMensagens=pgTable('chat_multicanal_mensagens',{
 id:bigserial('id',{mode:'number'}).primaryKey(),providerId:integer('provider_id').notNull(),conversationId:text('conversation_id').notNull(),canal:text('canal').notNull(),direcao:text('direcao').notNull(),texto:text('texto').notNull(),assunto:text('assunto'),status:text('status').notNull(),chave:text('chave').notNull(),externalId:text('external_id'),criadoEm:timestamp('criado_em',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique().on(t.providerId,t.chave),foreignKey({columns:[t.providerId,t.conversationId],foreignColumns:[chatBullqConversas.providerId,chatBullqConversas.conversationId]}).onDelete('cascade'),uniqueIndex('chat_multicanal_retorno_unico').on(t.providerId,t.canal,t.externalId).where(sql`${t.direcao}='entrada'`),index('chat_multicanal_historico').on(t.providerId,t.conversationId,t.criadoEm),check('chat_multicanal_mensagens_canal_check',sql`${t.canal} in ('sms','email')`),check('chat_multicanal_mensagens_direcao_check',sql`${t.direcao} in ('entrada','saida')`)]);

export const cobrancaAvisosConfig=pgTable('cobranca_avisos_config',{
  providerId:integer('provider_id').primaryKey().references(()=>providers.id),config:jsonb('config').notNull().default({}),updatedAt:timestamp('updated_at').notNull().defaultNow(),
});
export const cobrancaComunicacaoConfig=pgTable('cobranca_comunicacao_config',{
  providerId:integer('provider_id').primaryKey().references(()=>providers.id),config:jsonb('config').notNull().default({}),updatedAt:timestamp('updated_at').notNull().defaultNow(),
});
export const cobrancaCanaisConfig=pgTable('cobranca_canais_config',{
  providerId:integer('provider_id').primaryKey().references(()=>providers.id,{onDelete:'cascade'}),configCifrada:text('config_cifrada').notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
export const cobrancaPreferenciasContato=pgTable('cobranca_preferencias_contato',{
  providerId:integer('provider_id').notNull().references(()=>providers.id),customerId:integer('customer_id').notNull().references(()=>customers.id),naoContatar:boolean('nao_contatar').notNull().default(false),pausaAte:timestamp('pausa_ate'),motivo:text('motivo'),userId:integer('user_id').references(()=>users.id),updatedAt:timestamp('updated_at').notNull().defaultNow(),
},t=>[primaryKey({columns:[t.providerId,t.customerId]})]);
export const cobrancaComunicacoes=pgTable('cobranca_comunicacoes',{
  id:serial('id').primaryKey(),providerId:integer('provider_id').notNull().references(()=>providers.id),customerId:integer('customer_id').notNull().references(()=>customers.id),casoId:integer('caso_id').references(()=>cobrancaCasos.id),faturaId:integer('fatura_id').references(()=>invoices.id),canal:text('canal').notNull(),finalidade:text('finalidade').notNull(),chave:text('chave').notNull(),dia:date('dia').notNull(),status:text('status').notNull(),motivo:text('motivo'),providerMessageId:text('provider_message_id'),criadoEm:timestamp('criado_em').notNull().defaultNow(),atualizadoEm:timestamp('atualizado_em').notNull().defaultNow(),
},t=>[unique().on(t.providerId,t.chave),unique().on(t.providerId,t.customerId,t.dia),index('cobranca_comunicacoes_diario_idx').on(t.providerId,t.criadoEm.desc()),index('cobranca_comunicacoes_cliente_idx').on(t.providerId,t.customerId,t.criadoEm.desc()),check('cobranca_comunicacoes_canal_check',sql`${t.canal} in ('sms','email','whatsapp')`),check('cobranca_comunicacoes_finalidade_check',sql`${t.finalidade} in ('cobranca','preventivo')`),check('cobranca_comunicacoes_status_check',sql`${t.status} in ('enviando','enviado','falhou','incerto','ignorado')`)]);
