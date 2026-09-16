export type ModoWorkerChat = "ensaio" | "envio";
export interface OperacaoChat {
  verificadoEm: string;
  processo: { online: boolean; modo: ModoWorkerChat | null; verificadoEm: string | null };
  bloqueios: string[];
  limiteDiario: number;
  usadosHoje: number;
  respostaAutonoma: boolean;
  limitado: boolean;
  carteiras: { carteira: string; pendentes: number; elegiveis: number; revisao: number }[];
  motivos: { motivo: string; quantidade: number }[];
  etapas: { carteira: string; etapa: string; agente: string; quantidade: number }[];
}
