import { z } from "zod";
import { orientarContato } from "./contato";
import type { Etapa } from "./regua";

export const ComunicacaoConfigSchema = z.object({
  ligada: z.boolean().default(false),
  canal: z.enum(["sms", "email"]).default("email"),
  limiteDiario: z.number().int().min(1).max(10000).default(10),
  intervaloDias: z.number().int().min(1).max(30).default(3),
  carteiras: z.array(z.enum(["ativo", "ex_cliente"])).min(1).default(["ativo"]),
});
export type ComunicacaoConfig = z.infer<typeof ComunicacaoConfigSchema>;
export function lerComunicacaoConfig(raw: unknown): ComunicacaoConfig {
  const r = ComunicacaoConfigSchema.safeParse(raw);
  return r.success ? r.data : ComunicacaoConfigSchema.parse({});
}
export interface CandidatoComunicacao {
  customerId: number; nome: string; email: string | null; telefone: string | null;
  statusCliente: string; diasAtraso: number; saldo: number; casoId: number | null;
  carteira: string | null; statusCaso: string | null; tom: string | null;
  proximoContato: string | Date | null; conversaAtiva: boolean; naoContatar: boolean;
  pausaAte: string | Date | null; ultimoContato: string | Date | null;
}
export function motivoExclusaoComunicacao(c: CandidatoComunicacao, config: ComunicacaoConfig, agora: Date, etapas?: readonly Etapa[]): string | null {
  if (c.naoContatar) return "Cliente com contato desativado";
  if (c.pausaAte && new Date(c.pausaAte) > agora) return "Contato pausado para atendimento ou conferência";
  if (c.conversaAtiva) return "Conversa já em andamento";
  if (!c.casoId || !config.carteiras.includes(c.carteira as "ativo" | "ex_cliente")) return "Carteira fora da configuração";
  const carteiraAtual = ["active", "suspended"].includes(c.statusCliente) ? "ativo" : ["inactive", "cancelled"].includes(c.statusCliente) ? "ex_cliente" : null;
  if (carteiraAtual !== c.carteira) return "Situação do contrato precisa ser reconciliada";
  if (!(c.saldo > 0)) return "Sem saldo vencido";
  if (c.statusCaso !== "aberto") return "Caso já em atendimento ou encerrado";
  if (c.proximoContato && new Date(c.proximoContato) > agora) return "Próximo contato ainda não venceu";
  if (c.ultimoContato && agora.getTime() - new Date(c.ultimoContato).getTime() < config.intervaloDias * 86400000) return "Intervalo entre contatos ainda não cumprido";
  if (!orientarContato({ carteira: c.carteira ?? undefined, diasAtraso: c.diasAtraso, tom: c.tom, status: c.statusCaso, etapas }).automatizavel) return "Etapa ou perfil exige revisão humana";
  return null;
}
export function destinatarioComunicacao(c: Pick<CandidatoComunicacao, "email" | "telefone">, canal: "sms" | "email"): string | null {
  if (canal === "email") return c.email && z.string().email().safeParse(c.email.trim()).success ? c.email.trim() : null;
  let n = (c.telefone ?? "").replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  return /^55[1-9]\d\d{8,9}$/.test(n) ? `+${n}` : null;
}
/** Primeiro contato sem saldo, documento ou instrumento financeiro em destino ainda não confirmado. */
export function textoComunicacao(provedor: string, finalidade: "cobranca" | "preventivo") {
  const nome = provedor.replace(/[\r\n]/g, " ").slice(0, 70);
  return finalidade === "preventivo"
    ? `${nome}: seu atendimento de faturas está disponível. Entre em contato pelo canal habitual para consultar sua fatura e as opções de pagamento.`
    : `${nome}: gostaríamos de conversar sobre seu atendimento financeiro. Entre em contato pelo canal habitual para conferir suas informações com nossa equipe.`;
}
