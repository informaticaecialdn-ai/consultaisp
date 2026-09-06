import { z } from "zod";
import { TipoDeAgenteSchema } from "./chat-agentes";

export const ProvedorWhatsappSchema = z.enum(["ZAPPFY", "UAZAPI", "DATAFY"]);
export type ProvedorWhatsapp = z.infer<typeof ProvedorWhatsappSchema>;
const CredenciaisComuns = {
  nome: z.string().trim().min(2).max(80),
  token: z.string().trim().min(8).max(500),
  webhookSecret: z.string().trim().min(8).max(200).optional(),
};
export const CanalWhatsappSchema = z.preprocess(
  (valor) => valor && typeof valor === "object" && !Array.isArray(valor) ? { provider: "ZAPPFY", ...valor } : valor,
  z.discriminatedUnion("provider", [
    z.object({ ...CredenciaisComuns, provider: z.literal("ZAPPFY") }).strict(),
    z.object({ ...CredenciaisComuns, provider: z.literal("UAZAPI"), baseUrl: z.string().trim().url().max(250).refine(v => { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && (!u.port || u.port === "443"); }, "Use a URL HTTPS da sua instância Uazapi") }).strict(),
    z.object({ ...CredenciaisComuns, provider: z.literal("DATAFY"), phoneNumberId: z.string().regex(/^\d{5,30}$/), businessAccountId: z.string().regex(/^\d{5,30}$/).optional(), webhookSecret: z.string().trim().min(12).max(200).regex(/^whsec_/) }).strict(),
  ]),
);
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
});
export type EstadoDaConexaoWhatsapp = z.infer<typeof EstadoDaConexaoWhatsappSchema>;

export const ConectarWhatsappSchema = z.object({
  phone: z.string().regex(/^55\d{10,11}$/, "Informe o número com DDI 55 e DDD").optional(),
}).strict();
