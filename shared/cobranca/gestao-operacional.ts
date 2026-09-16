import { z } from 'zod';

export const ConfigGestaoSchema=z.object({
  maxMensagensDia:z.number().int().min(1).max(100).default(20),
  maxIniciativasSemana:z.number().int().min(1).max(14).default(3),
  custoContato:z.number().min(0).max(1000).default(0),
  probabilidadeSimulada:z.number().min(0).max(100).default(50),
  margemMensalSimulada:z.number().min(0).max(100000).default(0),
  mesesRetencao:z.number().int().min(0).max(24).default(3),
  syncMaxHoras:z.number().int().min(1).max(720).default(48),
});
export type ConfigGestao=z.infer<typeof ConfigGestaoSchema>;
export const ContestacaoSchema=z.object({
  faturaId:z.number().int().positive(),motivo:z.enum(['valor','pagamento','servico','duplicidade','titularidade','outro']),
  relato:z.string().trim().min(10).max(4000),evidencia:z.string().trim().max(2000).default(''),
  responsavelId:z.number().int().positive(),prazo:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,'Data inválida'),
});
export const ResolverContestacaoSchema=z.object({decisao:z.enum(['procedente','improcedente','cancelada']),justificativa:z.string().trim().min(10).max(4000)});
export function avaliarContato(c:{disputa:boolean;optout:boolean;pausado:boolean;promessa:boolean;hoje:number;semana:number;automatico:boolean},config:ConfigGestao):string|null {
  if(c.disputa)return 'Fatura em contestação: conclua a análise antes de retomar os contatos.';
  if(c.optout)return 'Cliente solicitou não receber contatos.';
  if(c.automatico&&(c.pausado||c.promessa))return 'Automação pausada por atendimento, conferência ou promessa vigente.';
  if(c.hoje>=config.maxMensagensDia)return 'Orçamento diário de mensagens deste cliente atingido.';
  if(c.automatico&&c.semana>=config.maxIniciativasSemana)return 'Orçamento semanal de iniciativas deste cliente atingido.';
  return null;
}
const SimulacaoSchema=z.object({saldo:z.number().finite().min(0),custo:z.number().finite().min(0),probabilidade:z.number().finite().min(0).max(100),margemMensal:z.number().finite().min(0),meses:z.number().int().min(0).max(24),carteira:z.enum(['ativo','ex_cliente'])});
export function simularEconomia(entrada:z.infer<typeof SimulacaoSchema>){
  const e=SimulacaoSchema.parse(entrada),p=e.probabilidade/100;
  const cent=(n:number)=>Math.round(n*100)/100;
  const recuperacaoEsperada=cent(e.saldo*p),retencaoEstimada=e.carteira==='ativo'?cent(e.margemMensal*e.meses*p):0;
  return {recuperacaoEsperada,retencaoEstimada,resultado:cent(recuperacaoEsperada+retencaoEstimada-e.custo)};
}
export const taxaCoorte=(confirmados:number,elegiveis:number)=>elegiveis>0?Math.round(confirmados/elegiveis*1000)/10:null;
