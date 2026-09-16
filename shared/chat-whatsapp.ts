import { z } from "zod";
import { TipoDeAgenteSchema } from "./chat-agentes";

/**
 * LEITURA: os quatro valores que existem em canais já gravados e nas respostas
 * de status do fork. `EVOLUTION` é o WhatsApp da PLATAFORMA (a Evolution API na
 * VPS, 11/09/2026): o provedor não digita token nem segredo — o Chat BullQ cria
 * a instância, gera os dois e guarda.
 */
export const ProvedorWhatsappSchema = z.enum(["ZAPPFY", "UAZAPI", "DATAFY", "EVOLUTION"]);
export type ProvedorWhatsapp = z.infer<typeof ProvedorWhatsappSchema>;
/**
 * CRIAÇÃO: só estes dois (dono, 16/09/2026: "deixar somente o Datafy e o
 * Evolution no sistema"). Zappfy e Uazapi não são mais oferecidos; um canal
 * antigo desses tipos continua legível até ser substituído — e "um número por
 * provedor" apaga o antigo ao salvar o novo.
 */
export const PROVEDORES_OFERECIDOS = ["EVOLUTION", "DATAFY"] as const;
export type ProvedorOferecido = (typeof PROVEDORES_OFERECIDOS)[number];
const CredenciaisComuns = {
  nome: z.string().trim().min(2).max(80),
  token: z.string().trim().min(8).max(500),
  webhookSecret: z.string().trim().min(8).max(200).optional(),
};
// Sem serviço padrão: quem cria escolhe. `.strict()` de propósito — token ou
// segredo mandados por engano para a Evolution são recusados, não ignorados.
export const CanalWhatsappSchema = z.discriminatedUnion("provider", [
  z.object({ nome: CredenciaisComuns.nome, provider: z.literal("EVOLUTION") }).strict(),
  z.object({ ...CredenciaisComuns, provider: z.literal("DATAFY"), phoneNumberId: z.string().regex(/^\d{5,30}$/), businessAccountId: z.string().regex(/^\d{5,30}$/).optional(), webhookSecret: z.string().trim().min(12).max(200).regex(/^whsec_/) }).strict(),
]);
export type CanalWhatsapp = z.infer<typeof CanalWhatsappSchema>;

export const TemplateDeAberturaSchema = z.object({
  nome: z.string().regex(/^[a-z0-9_]{1,100}$/),
  idioma: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/),
  variaveis: z.array(z.enum(["nomeCliente", "nomeProvedor"])).max(10),
}).strict();
export type TemplateDeAbertura = z.infer<typeof TemplateDeAberturaSchema>;
export const TemplatesDeAberturaSchema = z.object({ templates: z.record(TipoDeAgenteSchema, TemplateDeAberturaSchema) }).strict();
export type TemplatesDeAbertura = z.infer<typeof TemplatesDeAberturaSchema>["templates"];
export const TemplateDatafySchema = z.object({
  name: z.string(), language: z.string(), status: z.string(),
  components: z.array(z.record(z.unknown())).default([]),
});
export const CatalogoTemplatesDatafySchema = z.object({ data: z.array(TemplateDatafySchema) });
export type TemplateDatafy = z.infer<typeof TemplateDatafySchema>;

// Contrato reduzido: tokens e a configuração bruta da instância nunca saem do chat.
export const EstadoDaConexaoWhatsappSchema = z.object({
  provider: ProvedorWhatsappSchema,
  status: z.enum(["connected", "connecting", "disconnected", "unknown"]),
  connected: z.boolean(),
  loggedIn: z.boolean(),
  phone: z.string().regex(/^\d{8,15}$/).nullable(),
  qrCode: z.string().max(500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).nullable(),
  pairCode: z.string().max(30).regex(/^[A-Za-z0-9-]+$/).nullable(),
  /** O que o servidor decidiu NAO fazer, e por que (ex.: numero ja conectado — nao pede QR). */
  aviso: z.string().max(300).nullable().optional(),
});
export type EstadoDaConexaoWhatsapp = z.infer<typeof EstadoDaConexaoWhatsappSchema>;

export const ConectarWhatsappSchema = z.object({
  phone: z.string().regex(/^55\d{10,11}$/, "Informe o número com DDI 55 e DDD").optional(),
}).strict();
