/**
 * REGRAS DO ANTI-FRAUDE — o que o provedor escolhe monitorar na propria base.
 *
 * O anti-fraude avisa o DONO quando um cliente DELE e consultado por outro
 * provedor da rede. Qual cliente merece aviso e decisao do provedor: um quer
 * saber so de quem esta devendo (o padrao — e o conceito do modulo), outro
 * quer saber de todo cliente novo que ja esta cotando concorrente.
 *
 * Todas as regras exigem que o cliente seja ATIVO (ou suspenso por atraso,
 * que ainda e cliente). Ex-cliente nunca gera aviso: nao ha contrato a
 * proteger, o caso e de bureau e ja aparece no resultado da consulta de quem
 * consultou.
 *
 * Este arquivo e compartilhado: o servidor avalia com ele, a tela do painel
 * lista e edita com ele. Uma fonte para titulo, descricao e padrao.
 */
import { z } from "zod";

export const TIPOS_DE_REGRA = [
  "ativo_inadimplente",
  "contrato_novo",
  "consultas_repetidas",
  "ativo_qualquer",
] as const;

export type TipoDeRegra = (typeof TIPOS_DE_REGRA)[number];

export interface RegrasAntiFraude {
  /** Ausente preserva o comportamento das configurações anteriores. */
  combinacao?: "qualquer" | "todas";
  /** Cliente ativo com fatura vencida — o alerta de fuga classico. */
  ativo_inadimplente: { ativo: boolean; valorMinimo: number; diasMinimo: number };
  /** Cliente com pouco tempo de contrato, em dia ou nao. */
  contrato_novo: { ativo: boolean; diasMaximo: number };
  /** Cliente ativo consultado por varios provedores diferentes em 30 dias. */
  consultas_repetidas: { ativo: boolean; provedoresMinimos: number };
  /** Qualquer cliente ativo consultado — retencao, nao cobranca. */
  ativo_qualquer: { ativo: boolean };
}

export const REGRAS_PADRAO: RegrasAntiFraude = {
  ativo_inadimplente: { ativo: true, valorMinimo: 20, diasMinimo: 1 },
  contrato_novo: { ativo: false, diasMaximo: 90 },
  consultas_repetidas: { ativo: false, provedoresMinimos: 2 },
  ativo_qualquer: { ativo: false },
};

export interface DescricaoDeRegra {
  titulo: string;
  descricao: string;
  /** O que o provedor ganha ligando a regra. */
  porQue: string;
  /** Limitacao honesta, quando existe. */
  aviso?: string;
}

export const CATALOGO_DE_REGRAS: Record<TipoDeRegra, DescricaoDeRegra> = {
  ativo_inadimplente: {
    titulo: "Cliente ativo com pendência financeira",
    descricao: "Um cliente seu, com contrato ativo ou suspenso por atraso, tem fatura vencida e foi consultado por outro provedor.",
    porQue: "Ajuda a priorizar uma conversa sobre a pendência e entender se o cliente precisa de uma negociação.",
  },
  contrato_novo: {
    titulo: "Cliente novo consultado",
    descricao: "Um cliente com pouco tempo de contrato, em dia ou não, foi consultado por outro provedor.",
    porQue: "Permite acompanhar o início do relacionamento. Combine com pendência financeira para monitorar apenas novos clientes inadimplentes.",
    aviso: "Usa a data de início do contrato informada pelo ERP ou pela base sincronizada. Sem data válida, este critério não é atendido.",
  },
  consultas_repetidas: {
    titulo: "Cliente consultado por vários provedores",
    descricao: "Um cliente ativo seu foi consultado por dois ou mais provedores diferentes nos últimos 30 dias.",
    porQue: "Destaca consultas de origens distintas; consultas repetidas pelo mesmo provedor contam apenas uma vez.",
  },
  ativo_qualquer: {
    titulo: "Qualquer cliente ativo consultado",
    descricao: "Todo cliente ativo seu, mesmo em dia, consultado por outro provedor.",
    porQue: "Amplia o acompanhamento de retenção. A consulta é um sinal para analisar, não comprovação de fraude ou de intenção de cancelar.",
  },
};

export const regrasAntiFraudeSchema = z.object({
  combinacao: z.enum(["qualquer", "todas"]).optional(),
  ativo_inadimplente: z.object({
    ativo: z.boolean(),
    valorMinimo: z.number().min(0).max(100_000),
    diasMinimo: z.number().int().min(1).max(365),
  }),
  contrato_novo: z.object({
    ativo: z.boolean(),
    diasMaximo: z.number().int().min(1).max(365),
  }),
  consultas_repetidas: z.object({
    ativo: z.boolean(),
    provedoresMinimos: z.number().int().min(2).max(20),
  }),
  ativo_qualquer: z.object({
    ativo: z.boolean(),
  }),
});

export interface LinhaDeRegra {
  tipo: string;
  ativo: boolean;
  parametros: unknown;
}

const pModo = (raw: unknown) => raw && typeof raw === "object" && "todas" in raw ? raw.todas : 0;

const numero = (v: unknown, padrao: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : padrao;

/**
 * Linhas do banco -> regras completas. O que o provedor nunca salvou vem do
 * padrao; o que salvou com parametro invalido tambem — a tela nunca fica sem
 * valor para mostrar.
 */
export function montarRegras(linhas: LinhaDeRegra[]): RegrasAntiFraude {
  const porTipo = new Map<string, LinhaDeRegra>();
  for (const l of linhas) porTipo.set(l.tipo, l);
  const p = (tipo: TipoDeRegra): Record<string, unknown> => {
    const raw = porTipo.get(tipo)?.parametros;
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  };
  const ativo = (tipo: TipoDeRegra): boolean =>
    porTipo.has(tipo) ? porTipo.get(tipo)!.ativo : REGRAS_PADRAO[tipo].ativo;

  const combinacao = porTipo.get("combinacao");
  return {
    ...(combinacao ? { combinacao: (pModo(combinacao.parametros) === 1 ? "todas" : "qualquer") as "todas" | "qualquer" } : {}),
    ativo_inadimplente: {
      ativo: ativo("ativo_inadimplente"),
      valorMinimo: numero(p("ativo_inadimplente").valorMinimo, REGRAS_PADRAO.ativo_inadimplente.valorMinimo),
      diasMinimo: numero(p("ativo_inadimplente").diasMinimo, REGRAS_PADRAO.ativo_inadimplente.diasMinimo),
    },
    contrato_novo: {
      ativo: ativo("contrato_novo"),
      diasMaximo: numero(p("contrato_novo").diasMaximo, REGRAS_PADRAO.contrato_novo.diasMaximo),
    },
    consultas_repetidas: {
      ativo: ativo("consultas_repetidas"),
      provedoresMinimos: numero(p("consultas_repetidas").provedoresMinimos, REGRAS_PADRAO.consultas_repetidas.provedoresMinimos),
    },
    ativo_qualquer: {
      ativo: ativo("ativo_qualquer"),
    },
  };
}

/** Regras completas -> uma linha por tipo, prontas para gravar. */
export function desmontarRegras(regras: RegrasAntiFraude): Array<{ tipo: TipoDeRegra | "combinacao"; ativo: boolean; parametros: Record<string, number> }> {
  return [
    ...(regras.combinacao ? [{ tipo: "combinacao" as const, ativo: true, parametros: { todas: regras.combinacao === "todas" ? 1 : 0 } }] : []),
    {
      tipo: "ativo_inadimplente",
      ativo: regras.ativo_inadimplente.ativo,
      parametros: { valorMinimo: regras.ativo_inadimplente.valorMinimo, diasMinimo: regras.ativo_inadimplente.diasMinimo },
    },
    { tipo: "contrato_novo", ativo: regras.contrato_novo.ativo, parametros: { diasMaximo: regras.contrato_novo.diasMaximo } },
    {
      tipo: "consultas_repetidas",
      ativo: regras.consultas_repetidas.ativo,
      parametros: { provedoresMinimos: regras.consultas_repetidas.provedoresMinimos },
    },
    { tipo: "ativo_qualquer", ativo: regras.ativo_qualquer.ativo, parametros: {} },
  ];
}
