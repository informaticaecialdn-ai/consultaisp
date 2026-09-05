/**
 * A RÉGUA DA COBRANÇA — decide QUANDO e O QUE o funcionário faz. Nunca o tom.
 *
 * Porte de `packages/policy/src/regua-stages.ts` e de `apps/agents/src/runtime/
 * regua.ts` do Provedor.ai, trocando o agente de IA pelo FUNCIONÁRIO: cada
 * etapa diz a ação a executar e, se o provedor quiser, quem é o responsável.
 * O tom vem do DNA (`dna.ts`), não da etapa — os dois se cruzam só no caso.
 *
 * FASE 1 (fatos de produção, 05/09/2026): não existe fatura a fatura. O sync
 * grava só agregados em `customers`, e a régua roda POR CLIENTE sobre
 * `max_days_overdue`. Consequência: a etapa preventiva (D-7..D0) não tem como
 * disparar — sem fatura não há vencimento futuro. Ela fica no catálogo,
 * marcada `disponivelNaFase1: false`, e o motor a pula com o motivo
 * `depende_de_fatura`, para a tela dizer por que a coluna está vazia.
 *
 * Módulo puro: sem banco, sem React, sem I/O.
 */
import { z } from "zod";
import { CANAIS_HUMANOS, type CanalHumano, type Carteira } from "./estados";

export const ETAPA_IDS = [
  "lembrete_pre_vencimento",
  "lembrete_atraso",
  "aviso_suspensao",
  "negociacao_recuperacao",
  "pre_negativacao",
  "divida_antiga",
  "fim_de_linha",
] as const;
export type EtapaId = (typeof ETAPA_IDS)[number];

export interface Etapa {
  id: EtapaId;
  rotulo: string;
  /** Dias de atraso, inclusivo. Negativo é antes do vencimento. */
  diaMin: number;
  /** `null` = sem teto (a última etapa). */
  diaMax: number | null;
  /** O que o funcionário faz nesta etapa — o provedor pode reescrever. */
  acao: string;
  canalSugerido: CanalHumano;
  baseLegal?: string;
  /** false = precisa de fatura a fatura; o motor pula até a fase 2. */
  disponivelNaFase1: boolean;
  /** `null` = qualquer operador da fila. */
  responsavelUserId: number | null;
  /** Desligada pelo provedor: a etapa seguinte absorve a janela. */
  ativa: boolean;
}

/**
 * Piso legal: a suspensão do serviço só pode acontecer 15 dias depois da
 * notificação do débito (Anatel Res. 765/2023). A etapa que ameaça suspensão
 * não começa antes de D+15, e a ação manda registrar a data da notificação —
 * a contagem dos 15 dias é da ENTREGA do aviso, não do vencimento.
 */
export const PISO_AVISO_SUSPENSAO_DIAS = 15;

/**
 * Dias-toque do preventivo: D-7 (antecedência), D-3 (reforço), D-1 (véspera).
 * Fora deles o lembrete não vai — lembrar todo dia é assédio ao bom pagador
 * (CDC art. 42). Decisão do dono no Provedor.ai, 2026-06-19.
 */
export const PREVENTIVO_DIAS_TOQUE: ReadonlySet<number> = new Set([-7, -3, -1]);

export const ETAPAS_PADRAO: readonly Etapa[] = [
  {
    id: "lembrete_pre_vencimento",
    rotulo: "Pré-aviso",
    diaMin: -7,
    diaMax: 0,
    acao: "Lembrar do vencimento só nos dias-toque (D-7, D-3, D-1), com o PIX ou a segunda via em mãos. Não é cobrança: a fatura ainda não venceu.",
    canalSugerido: "whatsapp",
    baseLegal: "CDC art. 42 — sem assédio: só nos dias-toque",
    disponivelNaFase1: false,
    responsavelUserId: null,
    ativa: true,
  },
  {
    id: "lembrete_atraso",
    rotulo: "Lembrete de atraso",
    diaMin: 1,
    diaMax: 14,
    acao: "Enviar a segunda via ou o PIX e confirmar se o meio de pagamento falhou. Tratar como esquecimento, não como dívida.",
    canalSugerido: "whatsapp",
    disponivelNaFase1: true,
    responsavelUserId: null,
    ativa: true,
  },
  {
    id: "aviso_suspensao",
    rotulo: "Aviso de suspensão",
    diaMin: 15,
    diaMax: 29,
    acao: "Notificar formalmente que o serviço será suspenso e registrar a data da notificação. A suspensão só pode acontecer 15 dias depois de o aviso ser entregue.",
    canalSugerido: "telefone",
    baseLegal: "Anatel Res. 765/2023 — 15 dias da notificação",
    disponivelNaFase1: true,
    responsavelUserId: null,
    ativa: true,
  },
  {
    id: "negociacao_recuperacao",
    rotulo: "Negociação",
    diaMin: 30,
    diaMax: 89,
    acao: "Propor acordo: quitação com desconto ou parcelamento dentro da política. Buscar a decisão na mesma ligação.",
    canalSugerido: "telefone",
    disponivelNaFase1: true,
    responsavelUserId: null,
    ativa: true,
  },
  {
    id: "pre_negativacao",
    rotulo: "Pré-negativação",
    diaMin: 90,
    diaMax: 179,
    acao: "Enviar o pré-aviso formal de negativação com prazo para pagar e guardar o comprovante de envio. Só negativar depois do prazo. Ex-cliente: conferir antes que a dívida é de serviço prestado.",
    canalSugerido: "email",
    baseLegal: "Súmula 359 do STJ — pré-aviso ao devedor",
    disponivelNaFase1: true,
    responsavelUserId: null,
    ativa: true,
  },
  {
    id: "divida_antiga",
    rotulo: "Dívida antiga",
    diaMin: 180,
    diaMax: 359,
    acao: "Campanha de quitação com desconto escalonado, até o teto da política. Atualizar telefone e endereço a cada contato.",
    canalSugerido: "whatsapp",
    disponivelNaFase1: true,
    responsavelUserId: null,
    ativa: true,
  },
  {
    id: "fim_de_linha",
    rotulo: "Fim de linha",
    diaMin: 360,
    diaMax: null,
    acao: "Última proposta de quitação e decisão: baixar ou manter negativado. Conferir a prescrição — dívida com cinco anos não se cobra.",
    canalSugerido: "telefone",
    baseLegal: "CC art. 206 §5º I — prescreve em 5 anos",
    disponivelNaFase1: true,
    responsavelUserId: null,
    ativa: true,
  },
];

/* ── Prescrição ───────────────────────────────────────────────────────── */

export const PRESCRICAO_ANOS = 5;

/**
 * Cinco anos em dias, SEM contar bissexto: 1825. Cinco anos civis têm 1826 ou
 * 1827 dias, então este limiar acusa a prescrição um ou dois dias antes do
 * aniversário. É o lado certo do erro: parar de cobrar dois dias cedo não
 * custa nada; cobrar dívida prescrita é vedado.
 */
export const DIAS_PRESCRICAO = PRESCRICAO_ANOS * 365;

/** Dívida com cinco anos ou mais de atraso: NUNCA cobrar, negativar nem pressionar. */
export function prescrita(diasAtraso: number): boolean {
  return diasAtraso >= DIAS_PRESCRICAO;
}

/* ── Configuração do provedor ─────────────────────────────────────────── */

/**
 * O que o provedor pode mudar numa etapa. Rótulo, base legal e
 * `disponivelNaFase1` são fatos do sistema e não entram aqui: se o JSON
 * pudesse ligar o preventivo na fase 1, o motor mandaria lembrar de uma
 * fatura que ninguém tem.
 */
export const EtapaConfigSchema = z
  .object({
    id: z.enum(ETAPA_IDS),
    diaMin: z.number().int().optional(),
    diaMax: z.number().int().nullable().optional(),
    acao: z.string().trim().min(1).max(500).optional(),
    canalSugerido: z.enum(CANAIS_HUMANOS).optional(),
    responsavelUserId: z.number().int().positive().nullable().optional(),
    ativa: z.boolean().optional(),
  })
  .refine(c => c.diaMax === undefined || c.diaMax === null || c.diaMin === undefined || c.diaMax >= c.diaMin, {
    message: "diaMax precisa ser maior ou igual a diaMin",
    path: ["diaMax"],
  });
export type EtapaConfig = z.infer<typeof EtapaConfigSchema>;

export const EtapasConfigSchema = z.array(EtapaConfigSchema).superRefine((lista, ctx) => {
  const vistos = new Set<string>();
  lista.forEach((c, i) => {
    if (vistos.has(c.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `etapa repetida: ${c.id}`, path: [i, "id"] });
    vistos.add(c.id);
  });
});

/**
 * Mescla as mudanças do provedor sobre o catálogo padrão. Config inválida cai
 * no padrão de propósito: quem grava valida antes com `PoliticaSchema` e
 * recusa com 400, então aqui só chega JSON bom ou JSON de outra versão — e
 * régua padrão é melhor que régua nenhuma.
 */
export function resolverEtapas(politica: { etapas?: unknown } | null | undefined): Etapa[] {
  const parsed = EtapasConfigSchema.safeParse(politica?.etapas ?? []);
  const config = parsed.success ? parsed.data : [];
  const porId = new Map(config.map(c => [c.id, c]));

  const etapas = ETAPAS_PADRAO.map(padrao => {
    const c = porId.get(padrao.id);
    if (!c) return { ...padrao };
    const diaMin = c.diaMin ?? padrao.diaMin;
    const diaMax = c.diaMax === undefined ? padrao.diaMax : c.diaMax;
    return {
      ...padrao,
      diaMin,
      // A config pode ter movido diaMin acima do diaMax padrão; o teto acompanha.
      diaMax: diaMax !== null && diaMax < diaMin ? diaMin : diaMax,
      acao: c.acao ?? padrao.acao,
      canalSugerido: c.canalSugerido ?? padrao.canalSugerido,
      responsavelUserId: c.responsavelUserId === undefined ? padrao.responsavelUserId : c.responsavelUserId,
      ativa: c.ativa ?? padrao.ativa,
    };
  });

  return clampEtapas(etapas);
}

/** Aplica o piso legal e devolve a lista em ordem de diaMin — o motor casa a primeira janela que contém o dia. */
export function clampEtapas(etapas: readonly Etapa[]): Etapa[] {
  return etapas
    .map(e => {
      if (e.id !== "aviso_suspensao" || e.diaMin >= PISO_AVISO_SUSPENSAO_DIAS) return { ...e };
      const diaMax = e.diaMax !== null && e.diaMax < PISO_AVISO_SUSPENSAO_DIAS ? PISO_AVISO_SUSPENSAO_DIAS : e.diaMax;
      return { ...e, diaMin: PISO_AVISO_SUSPENSAO_DIAS, diaMax };
    })
    .sort((a, b) => a.diaMin - b.diaMin);
}

/* ── O motor ──────────────────────────────────────────────────────────── */

export type MotivoSemEtapa =
  /** Cinco anos de atraso: cobrar é vedado. */
  | "prescrita"
  /** Etapa preventiva precisa de fatura a fatura (fase 2). */
  | "depende_de_fatura"
  /** Dentro da janela preventiva, mas hoje não é dia-toque. */
  | "fora_toque_preventivo"
  /** Nenhuma janela contém o dia (só acontece com config que abre buraco). */
  | "sem_etapa";

export type DecisaoDaRegua = { etapa: Etapa; motivo: null } | { etapa: null; motivo: MotivoSemEtapa };

export const ROTULO_MOTIVO_SEM_ETAPA: Record<MotivoSemEtapa, string> = {
  prescrita: "Dívida prescrita — não se cobra",
  depende_de_fatura: "Depende de fatura a fatura (fase 2)",
  fora_toque_preventivo: "Fora do dia-toque do pré-aviso",
  sem_etapa: "Nenhuma etapa cobre este atraso",
};

/**
 * As etapas que valem para uma carteira. Ex-cliente não tem aviso de
 * suspensão — não há serviço a suspender (CORRECAO-03 do Provedor.ai) — e
 * vai do lembrete direto à negociação: a etapa seguinte absorve a janela.
 * Etapa desligada pelo provedor some do mesmo jeito.
 */
export function etapasDaCarteira(carteira: Carteira, etapas: readonly Etapa[] = ETAPAS_PADRAO): Etapa[] {
  let lista = etapas.map(e => ({ ...e }));
  for (const e of etapas) {
    const foraDaCarteira = carteira === "ex_cliente" && e.id === "aviso_suspensao";
    if (foraDaCarteira || !e.ativa) lista = removerAbsorvendo(lista, e.id);
  }
  // Absorver a janela de quem saiu pode puxar o aviso de suspensão para antes
  // do piso; o clamp devolve o piso e deixa o buraco à vista (sem_etapa) em
  // vez de ameaçar suspensão no segundo dia de atraso.
  return clampEtapas(lista);
}

function removerAbsorvendo(lista: Etapa[], id: EtapaId): Etapa[] {
  const i = lista.findIndex(e => e.id === id);
  if (i < 0) return lista;
  const removida = lista[i];
  const resto = lista.filter(e => e.id !== id);
  const seguinte = resto[i];
  const anterior = resto[i - 1];
  if (seguinte) {
    seguinte.diaMin = Math.min(seguinte.diaMin, removida.diaMin);
  } else if (anterior && anterior.diaMax !== null) {
    anterior.diaMax = removida.diaMax === null ? null : Math.max(anterior.diaMax, removida.diaMax);
  }
  return resto;
}

export function etapaParaAtraso(
  diasAtraso: number,
  carteira: Carteira,
  etapas: readonly Etapa[] = ETAPAS_PADRAO,
): DecisaoDaRegua {
  if (prescrita(diasAtraso)) return { etapa: null, motivo: "prescrita" };

  const etapa = etapasDaCarteira(carteira, etapas).find(
    e => diasAtraso >= e.diaMin && (e.diaMax === null || diasAtraso <= e.diaMax),
  );
  if (!etapa) return { etapa: null, motivo: "sem_etapa" };

  if (etapa.id === "lembrete_pre_vencimento") {
    if (!etapa.disponivelNaFase1) return { etapa: null, motivo: "depende_de_fatura" };
    if (!PREVENTIVO_DIAS_TOQUE.has(diasAtraso)) return { etapa: null, motivo: "fora_toque_preventivo" };
  }
  return { etapa, motivo: null };
}

/* ── Apresentação ─────────────────────────────────────────────────────── */

export function rotuloDoDia(dia: number): string {
  if (dia === 0) return "D0";
  return dia > 0 ? `D+${dia}` : `D${dia}`;
}

/** "D+1 → D+14", "D-7 → D0", "D+360+". */
export function janelaDaEtapa(etapa: Pick<Etapa, "diaMin" | "diaMax">): string {
  if (etapa.diaMax === null) return `${rotuloDoDia(etapa.diaMin)}+`;
  return `${rotuloDoDia(etapa.diaMin)} → ${rotuloDoDia(etapa.diaMax)}`;
}

export function etapaPorId(id: EtapaId, etapas: readonly Etapa[] = ETAPAS_PADRAO): Etapa | null {
  return etapas.find(e => e.id === id) ?? null;
}
