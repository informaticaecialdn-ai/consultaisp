import { sql } from "drizzle-orm";
import { pgTable, text, integer, boolean, timestamp, numeric, serial, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ========== CRM LEADS ==========
export const crmLeads = pgTable("crm_leads", {
  id: serial("id").primaryKey(),
  telefone: text("telefone").notNull().unique(),
  nome: text("nome"),
  provedor: text("provedor"),
  cidade: text("cidade"),
  estado: text("estado"),
  regiao: text("regiao"),
  porte: text("porte").notNull().default("desconhecido"),
  erp: text("erp"),
  numClientes: integer("num_clientes"),
  decisor: text("decisor"),
  email: text("email"),
  cargo: text("cargo"),
  site: text("site"),
  scorePerfil: integer("score_perfil").notNull().default(0),
  scoreComportamento: integer("score_comportamento").notNull().default(0),
  scoreTotal: integer("score_total").notNull().default(0),
  classificacao: text("classificacao").notNull().default("frio"),
  etapaFunil: text("etapa_funil").notNull().default("novo"),
  agenteAtual: text("agente_atual").notNull().default("carlos"),
  origem: text("origem").notNull().default("manual"),
  valorEstimado: numeric("valor_estimado", { precision: 10, scale: 2 }).notNull().default("0"),
  motivoPerda: text("motivo_perda"),
  dataProximaAcao: timestamp("data_proxima_acao"),
  observacoes: text("observacoes"),
  criadoEm: timestamp("criado_em").defaultNow(),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
});

// ========== CRM CONVERSAS ==========
export const crmConversas = pgTable("crm_conversas", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id),
  agente: text("agente").notNull(),
  direcao: text("direcao").notNull(),
  mensagem: text("mensagem").notNull(),
  tipo: text("tipo").notNull().default("texto"),
  canal: text("canal").notNull().default("whatsapp"),
  tokensUsados: integer("tokens_usados").notNull().default(0),
  tempoRespostaMs: integer("tempo_resposta_ms").notNull().default(0),
  metadata: jsonb("metadata"),
  criadoEm: timestamp("criado_em").defaultNow(),
});

// ========== CRM ATIVIDADES ==========
export const crmAtividades = pgTable("crm_atividades", {
  id: serial("id").primaryKey(),
  agente: text("agente").notNull(),
  tipo: text("tipo").notNull(),
  descricao: text("descricao").notNull(),
  leadId: integer("lead_id"),
  decisao: text("decisao"),
  scoreAntes: integer("score_antes"),
  scoreDepois: integer("score_depois"),
  tokensUsados: integer("tokens_usados").notNull().default(0),
  tempoMs: integer("tempo_ms").notNull().default(0),
  metadata: jsonb("metadata"),
  criadoEm: timestamp("criado_em").defaultNow(),
});

// ========== CRM HANDOFFS ==========
export const crmHandoffs = pgTable("crm_handoffs", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id),
  deAgente: text("de_agente").notNull(),
  paraAgente: text("para_agente").notNull(),
  motivo: text("motivo"),
  scoreNoMomento: integer("score_no_momento"),
  criadoEm: timestamp("criado_em").defaultNow(),
});

// ========== CRM TAREFAS ==========
export const crmTarefas = pgTable("crm_tarefas", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  agente: text("agente").notNull(),
  tipo: text("tipo").notNull(),
  descricao: text("descricao").notNull(),
  status: text("status").notNull().default("pendente"),
  prioridade: text("prioridade").notNull().default("normal"),
  dataLimite: timestamp("data_limite"),
  dados: jsonb("dados"),
  criadoEm: timestamp("criado_em").defaultNow(),
  concluidoEm: timestamp("concluido_em"),
});

// ========== CRM METRICAS DIARIAS ==========
export const crmMetricasDiarias = pgTable("crm_metricas_diarias", {
  id: serial("id").primaryKey(),
  data: text("data").notNull(),
  agente: text("agente").notNull(),
  mensagensEnviadas: integer("mensagens_enviadas").notNull().default(0),
  mensagensRecebidas: integer("mensagens_recebidas").notNull().default(0),
  leadsNovos: integer("leads_novos").notNull().default(0),
  leadsQualificados: integer("leads_qualificados").notNull().default(0),
  leadsConvertidos: integer("leads_convertidos").notNull().default(0),
  leadsPerdidos: integer("leads_perdidos").notNull().default(0),
  demosAgendadas: integer("demos_agendadas").notNull().default(0),
  propostasEnviadas: integer("propostas_enviadas").notNull().default(0),
  contratosFechados: integer("contratos_fechados").notNull().default(0),
  tokensConsumidos: integer("tokens_consumidos").notNull().default(0),
  tempoMedioRespostaMs: integer("tempo_medio_resposta_ms").notNull().default(0),
  valorPipeline: numeric("valor_pipeline", { precision: 10, scale: 2 }).notNull().default("0"),
}, (table) => [
  uniqueIndex("crm_metricas_data_agente_idx").on(table.data, table.agente),
]);

// ========== CRM CAMPANHAS ==========
export const crmCampanhas = pgTable("crm_campanhas", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull(),
  agente: text("agente").notNull(),
  regiao: text("regiao"),
  status: text("status").notNull().default("rascunho"),
  totalEnviados: integer("total_enviados").notNull().default(0),
  totalRespondidos: integer("total_respondidos").notNull().default(0),
  totalQualificados: integer("total_qualificados").notNull().default(0),
  mensagemTemplate: text("mensagem_template"),
  criadoEm: timestamp("criado_em").defaultNow(),
  finalizadoEm: timestamp("finalizado_em"),
});

// ========== CRM SESSOES AGENTES ==========
export const crmSessoesAgentes = pgTable("crm_sessoes_agentes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id),
  agente: text("agente").notNull(),
  sessionId: text("session_id"),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em").defaultNow(),
});

// ========== ZOD SCHEMAS ==========
export const insertCrmLeadSchema = createInsertSchema(crmLeads).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertCrmTarefaSchema = createInsertSchema(crmTarefas).omit({
  id: true,
  criadoEm: true,
  concluidoEm: true,
});

export const insertCrmCampanhaSchema = createInsertSchema(crmCampanhas).omit({
  id: true,
  criadoEm: true,
  finalizadoEm: true,
});
