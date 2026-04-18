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
const VALID_AGENTES = ['carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'diana'];
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

module.exports = {
  createLead,
  prospectar,
  send,
  campanha,
  VALID_AGENTES,
};
