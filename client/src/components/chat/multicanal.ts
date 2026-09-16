import type { DetalheChat } from "./tipos";

export type CanalDaConversa = "whatsapp" | "sms" | "email";
export interface MensagemMulticanal {
  id: string | number;
  canal: "sms" | "email";
  direcao: "entrada" | "saida";
  texto: string;
  assunto?: string | null;
  status: string;
  criadoEm: string;
}
export interface DadosMulticanal {
  mensagens: MensagemMulticanal[];
  canais: { sms: boolean; email: boolean };
  propostas: Array<{ id: number; rotulo: string }>;
  config: { reforcoAtivo: boolean; intervaloHoras: number; canais: string[] };
}
export type MensagemDaConversa = DetalheChat["mensagens"][number] & {
  canal: CanalDaConversa;
  assunto?: string | null;
};

/** IDs recebem namespace; respostas de SMS/e-mail não abrem a janela do WhatsApp. */
export function unirHistorico(
  whatsapp: DetalheChat["mensagens"],
  outras: MensagemMulticanal[],
): MensagemDaConversa[] {
  const mensagens: MensagemDaConversa[] = [
    ...whatsapp.map((m) => ({ ...m, canal: "whatsapp" as const })),
    ...outras.map((m) => ({
      id: `multicanal:${m.canal}:${m.id}`, canal: m.canal,
      direcao: m.direcao === "entrada" ? "INBOUND" : "OUTBOUND",
      texto: m.texto, tipo: "TEXT", status: m.status, quem: null,
      em: m.criadoEm, assunto: m.assunto,
    })),
  ];
  return mensagens.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
}
