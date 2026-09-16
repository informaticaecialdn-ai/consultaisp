import { z } from "zod";

const telefone = z.string().regex(/^\+[1-9]\d{7,14}$/, "Use o formato internacional, por exemplo +5511999999999");
export const ConfiguracaoCanaisSchema = z.object({
  sms: z.object({
    ativado: z.boolean(),
    accountSid: z.string().regex(/^AC[a-fA-F0-9]{32}$/).or(z.literal("")),
    authToken: z.string().trim().max(256).optional(),
    remetente: telefone.or(z.literal("")),
    webhookUrl: z.string().max(1000).url().refine(v => { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash; }, "Use uma URL HTTPS sem parâmetros").or(z.literal("")).optional(),
  }).strict(),
  email: z.object({
    ativado: z.boolean(),
    apiKey: z.string().trim().max(256).optional(),
    remetente: z.string().email().or(z.literal("")),
    nomeRemetente: z.string().trim().max(120).regex(/^[^\r\n<>]*$/),
    responderPara: z.string().email().or(z.literal("")).default(""),
    receivingDomain: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).or(z.literal("")).optional(),
    webhookSecret: z.string().trim().max(256).regex(/^whsec_[A-Za-z0-9+/=]+$/).or(z.literal("")).optional(),
  }).strict(),
}).strict();
export type ConfiguracaoCanais = z.infer<typeof ConfiguracaoCanaisSchema>;
export type ResumoCanais = {
  sms: Omit<ConfiguracaoCanais["sms"], "authToken"> & { configurado: boolean; recebimentoConfigurado?: boolean };
  email: Omit<ConfiguracaoCanais["email"], "apiKey" | "webhookSecret"> & { configurado: boolean; recebimentoConfigurado?: boolean };
};
export const MensagemCobrancaSchema = z.object({
  canal: z.enum(["sms", "email"]),
  destinatario: z.string().trim().max(320),
  assunto: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/).optional(),
  texto: z.string().trim().min(1).max(20000),
  idempotencyKey: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:/.-]+$/),
}).superRefine((v, ctx) => {
  if (!(v.canal === "sms" ? telefone : z.string().email()).safeParse(v.destinatario).success)
    ctx.addIssue({ code: "custom", path: ["destinatario"], message: "Destino inválido para o canal" });
  if (v.canal === "sms" && v.texto.length > 1600)
    ctx.addIssue({ code: "custom", path: ["texto"], message: "SMS limitado a 1600 caracteres" });
});
export type MensagemCobranca = z.infer<typeof MensagemCobrancaSchema>;
export type ResultadoComunicacao = { status: "enviado" | "falhou" | "incerto"; providerMessageId?: string; motivo?: string };
