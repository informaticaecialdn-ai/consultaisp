// Schemas Zod para sanitizacao de inputs (Sprint 2 / T4).
// Aplicados via middleware validate() em /api/leads, /api/prospectar, /api/send, /api/campanhas.

const { z } = require('zod');

const phoneRegex = /^\d{10,15}$/;
const estadoRegex = /^[A-Za-z]{2}$/;

// POST /api/leads
const createLead = z.object({
  telefone: z.string().trim().regex(phoneRegex, 'telefone deve conter 10-15 digitos'),
  nome: z.string().trim().max(200).optional(),
  provedor: z.string().trim().max(200).optional(),
  cidade: z.string().trim().max(100).optional(),
  estado: z.string().trim().regex(estadoRegex, 'estado deve ter 2 letras').optional(),
  regiao: z.string().trim().max(100).optional(),
  porte: z.string().trim().max(50).optional(),
  erp: z.string().trim().max(100).optional(),
  origem: z.enum(['manual', 'whatsapp', 'instagram', 'email', 'importacao', 'outbound', 'smoke_test']).optional(),
}).strict();

// POST /api/prospectar
const prospectar = z.object({
  telefones: z.array(z.string().trim().regex(phoneRegex, 'telefone invalido')).min(1).max(100),
  regiao: z.string().trim().max(100).optional(),
  mensagem_base: z.string().trim().max(500).optional(),
}).strict();

// POST /api/send
const VALID_AGENTES = ['carla', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'bia'];
const send = z.object({
  phone: z.string().trim().regex(phoneRegex, 'phone invalido'),
  message: z.string().trim().min(1).max(4096),
  agente: z.enum(VALID_AGENTES).optional(),
}).strict();

// POST /api/campanhas
const campanha = z.object({
  nome: z.string().trim().min(1).max(100),
  tipo: z.string().trim().max(50).optional(),
  agente_remetente: z.enum(VALID_AGENTES),
  audiencia_id: z.number().int().positive(),
  template_id: z.number().int().positive(),
  regiao: z.string().trim().max(100).optional(),
  mensagem_template: z.string().trim().max(500).optional(),
  rate_limit_per_min: z.number().int().min(1).max(60).optional(),
  jitter_min_sec: z.number().int().min(0).max(60).optional(),
  jitter_max_sec: z.number().int().min(0).max(60).optional(),
  agendada_para: z.string().trim().max(50).optional().nullable(),
  criada_por: z.string().trim().max(100).optional().nullable(),
}).passthrough();

// Sprint 4 / T2: template + audiencia.
const template = z.object({
  nome: z.string().trim().min(1).max(120),
  conteudo: z.string().trim().min(1).max(4096),
  agente: z.enum(VALID_AGENTES).optional().nullable(),
  descricao: z.string().trim().max(500).optional().nullable(),
  categoria: z.string().trim().max(50).optional().nullable(),
  meta_template_id: z.string().trim().max(100).optional().nullable(),
  ja_aprovado_meta: z.boolean().optional(),
  variaveis_obrigatorias: z.array(z.string().min(1).max(50)).optional().nullable(),
}).strict();

const templateUpdate = template.partial().extend({
  ativo: z.boolean().optional(),
}).strict();

// Audiencia create: discriminated union { tipo: 'estatica'|'dinamica' }.
const filtrosSchema = z.object({
  classificacao: z.string().max(20).optional(),
  etapa_funil: z.string().max(30).optional(),
  exclui_etapas: z.array(z.string().max(30)).optional(),
  regiao: z.string().max(100).optional(),
  agente_atual: z.enum(VALID_AGENTES).optional(),
  score_min: z.number().min(0).max(100).optional(),
  score_max: z.number().min(0).max(100).optional(),
  tem_optin: z.boolean().optional(),
  ultima_atividade_dias_max: z.number().int().min(0).max(365).optional(),
}).passthrough();

const audienciaEstaticaCreate = z.object({
  tipo: z.literal('estatica'),
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(500).optional().nullable(),
  lead_ids: z.array(z.number().int().positive()).max(50000).optional(),
  criada_por: z.string().trim().max(100).optional().nullable(),
});

const audienciaDinamicaCreate = z.object({
  tipo: z.literal('dinamica'),
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(500).optional().nullable(),
  filtros: filtrosSchema,
  criada_por: z.string().trim().max(100).optional().nullable(),
});

const audienciaCreate = z.discriminatedUnion('tipo', [
  audienciaEstaticaCreate,
  audienciaDinamicaCreate,
]);

const audienciaUpdate = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  descricao: z.string().trim().max(500).optional().nullable(),
  filtros: filtrosSchema.optional(),
  ativa: z.boolean().optional(),
}).strict();

// Sprint 7: Apify run config.
const apifyRun = z.object({
  actor_id: z.string().min(1).max(200),
  input: z.object({}).passthrough().optional(),
  sync: z.boolean().optional(),               // se true, aguarda ate timeoutSec
  timeout_sec: z.number().int().min(30).max(300).optional(),
  iniciada_por: z.string().trim().max(100).optional().nullable(),
  auto_import: z.boolean().optional().default(true),  // importa automaticamente os leads quando sync OK
}).strict();

module.exports = {
  createLead,
  prospectar,
  send,
  campanha,
  template,
  templateUpdate,
  audienciaCreate,
  audienciaUpdate,
  filtrosSchema,
  apifyRun,
  VALID_AGENTES,
};
