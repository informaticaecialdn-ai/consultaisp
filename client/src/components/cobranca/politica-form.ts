/**
 * O formulário da política — leitura da resposta do GET, estado das caixas e
 * o corpo do PUT.
 *
 * O PUT manda a política INTEIRA (a rota valida com `validarPolitica` e
 * devolve `{ politica, ajustes }`), mas as etapas vão só como as MUDANÇAS do
 * provedor em cima do catálogo (`EtapaConfig[]`): é o que o JSONB guarda, e
 * gravar o catálogo inteiro faria uma correção futura no texto padrão de uma
 * etapa não chegar a ninguém.
 *
 * A `economia` (custos do R24) é parte da política e viaja no mesmo PUT:
 * quem grava a pausa pela tela da régua reenvia a economia gravada, senão um
 * "Pausar régua" apagaria os custos que o admin confirmou na outra tela.
 *
 * Números vivem como texto nas caixas e são convertidos na saída; um campo
 * vazio ou inválido cai no valor que estava gravado, nunca em NaN.
 */
import {
  ETAPAS_PADRAO,
  POLITICA_PADRAO,
  PoliticaSchema,
  resolverEtapas,
  type CanalHumano,
  type Etapa,
  type EtapaConfig,
  type EtapaId,
  type Politica,
  type PoliticaEntrada,
  type StatusDeParcelamento,
} from "@shared/cobranca";
import { CAMPOS_DE_CUSTO, type CampoDeCusto, type EconomiaDaPolitica } from "./tipos";

/** O GET pode devolver a política crua, `{ politica }`, ou nada (nunca configurou). */
export function lerPolitica(resposta: unknown): Politica {
  const cru =
    resposta && typeof resposta === "object" && "politica" in (resposta as Record<string, unknown>)
      ? (resposta as { politica: unknown }).politica
      : resposta;
  const parsed = PoliticaSchema.safeParse(cru ?? {});
  return parsed.success ? parsed.data : PoliticaSchema.parse(POLITICA_PADRAO);
}

/** O perfil de parcelamento em português — o enum cru (`acumulado_multi_mes`) não é texto para operador. */
export const ROTULO_PARCELAMENTO_POR_STATUS: Record<StatusDeParcelamento, string> = {
  ativo: "resíduo (menos de meia mensalidade)",
  inadimplente_recente: "atraso recente (até duas mensalidades)",
  acumulado_multi_mes: "acumulado (duas mensalidades ou mais)",
};

/** As caixas da economia: texto, como as outras; `confirmado` é a única que não é número. */
export type FormEconomia = Record<CampoDeCusto, string> & { confirmado: boolean };

export interface FormPolitica {
  negociacao: { maxParcelas: string; entradaMinimaPct: string; descontoMaxPct: string; saldoMinimoParcelar: string };
  encargos: { multaPct: string; jurosMesPct: string };
  janelaContato: { horaInicio: string; horaFim: string; sabado: boolean; sabadoHoraFim: string; domingo: boolean; feriado: boolean };
  pausada: boolean;
  pausadaMotivo: string;
  etapas: Etapa[];
  economia: FormEconomia;
}

const texto = (n: number) => String(n);

function formDaEconomia(e: EconomiaDaPolitica): FormEconomia {
  const form = { confirmado: e.confirmado } as FormEconomia;
  for (const campo of CAMPOS_DE_CUSTO) form[campo] = texto(e[campo]);
  return form;
}

export function formDaPolitica(p: Politica): FormPolitica {
  return {
    negociacao: {
      maxParcelas: texto(p.negociacao.maxParcelas),
      entradaMinimaPct: texto(p.negociacao.entradaMinimaPct),
      descontoMaxPct: texto(p.negociacao.descontoMaxPct),
      saldoMinimoParcelar: texto(p.negociacao.saldoMinimoParcelar),
    },
    encargos: { multaPct: texto(p.encargos.multaPct), jurosMesPct: texto(p.encargos.jurosMesPct) },
    janelaContato: {
      horaInicio: texto(p.janelaContato.horaInicio),
      horaFim: texto(p.janelaContato.horaFim),
      sabado: p.janelaContato.sabado,
      sabadoHoraFim: texto(p.janelaContato.sabadoHoraFim),
      domingo: p.janelaContato.domingo,
      feriado: p.janelaContato.feriado,
    },
    pausada: p.pausada,
    pausadaMotivo: p.pausadaMotivo ?? "",
    etapas: resolverEtapas(p),
    economia: formDaEconomia(p.economia),
  };
}

/** Texto → número; vazio ou lixo devolve o que estava gravado. */
function numeroOu(textoDoCampo: string, gravado: number): number {
  const n = Number(String(textoDoCampo).replace(",", "."));
  return textoDoCampo.trim() !== "" && Number.isFinite(n) ? n : gravado;
}

/**
 * As caixas da economia → números. Negativo não existe em custo: cai no
 * gravado, como vazio. O ciclo é inteiro e nunca menor que 1 mês (o teto o
 * servidor ajusta e avisa, como faz com os tetos legais).
 */
export function economiaDoForm(form: FormEconomia, gravada: EconomiaDaPolitica): EconomiaDaPolitica {
  const economia: EconomiaDaPolitica = { ...gravada, confirmado: form.confirmado };
  for (const campo of CAMPOS_DE_CUSTO) {
    const n = numeroOu(form[campo], gravada[campo]);
    economia[campo] = n < 0 ? gravada[campo] : n;
  }
  economia.cicloMeses = Math.max(1, Math.round(economia.cicloMeses));
  return economia;
}

/**
 * Mudar um custo DESCONFIRMA: o "confirmado" atesta os números que estavam
 * na tela, não os que o admin acabou de digitar. Ele confirma de novo com o
 * botão, e só então o 360 tira o selo "≈ parâmetros padrão".
 */
export function editarCusto(form: FormPolitica, campo: CampoDeCusto, valor: string): FormPolitica {
  return { ...form, economia: { ...form.economia, [campo]: valor, confirmado: false } };
}

export function confirmarCustos(form: FormPolitica): FormPolitica {
  return { ...form, economia: { ...form.economia, confirmado: true } };
}

/**
 * Só o que difere do catálogo padrão, campo a campo. Uma etapa igual ao
 * padrão não entra — e se o provedor voltar um campo ao valor padrão, ele
 * sai do JSON em vez de ficar gravado como "mudança" idêntica.
 */
export function etapasParaConfig(etapas: readonly Etapa[]): EtapaConfig[] {
  const config: EtapaConfig[] = [];
  for (const e of etapas) {
    const padrao = ETAPAS_PADRAO.find(p => p.id === e.id);
    if (!padrao) continue;
    const c: EtapaConfig = { id: e.id };
    if (e.diaMin !== padrao.diaMin) c.diaMin = e.diaMin;
    if (e.diaMax !== padrao.diaMax) c.diaMax = e.diaMax;
    if (e.acao.trim() !== padrao.acao) c.acao = e.acao.trim();
    if (e.canalSugerido !== padrao.canalSugerido) c.canalSugerido = e.canalSugerido;
    if (e.responsavelUserId !== padrao.responsavelUserId) c.responsavelUserId = e.responsavelUserId;
    if (e.ativa !== padrao.ativa) c.ativa = e.ativa;
    if (Object.keys(c).length > 1) config.push(c);
  }
  return config;
}

/** O corpo do PUT, com os números já convertidos e `gravada` como rede para campo vazio. */
export function corpoDoPut(form: FormPolitica, gravada: Politica): PoliticaEntrada {
  return {
    etapas: etapasParaConfig(form.etapas),
    negociacao: {
      maxParcelas: Math.round(numeroOu(form.negociacao.maxParcelas, gravada.negociacao.maxParcelas)),
      entradaMinimaPct: numeroOu(form.negociacao.entradaMinimaPct, gravada.negociacao.entradaMinimaPct),
      descontoMaxPct: numeroOu(form.negociacao.descontoMaxPct, gravada.negociacao.descontoMaxPct),
      saldoMinimoParcelar: numeroOu(form.negociacao.saldoMinimoParcelar, gravada.negociacao.saldoMinimoParcelar),
    },
    encargos: {
      multaPct: numeroOu(form.encargos.multaPct, gravada.encargos.multaPct),
      jurosMesPct: numeroOu(form.encargos.jurosMesPct, gravada.encargos.jurosMesPct),
    },
    janelaContato: {
      horaInicio: Math.round(numeroOu(form.janelaContato.horaInicio, gravada.janelaContato.horaInicio)),
      horaFim: Math.round(numeroOu(form.janelaContato.horaFim, gravada.janelaContato.horaFim)),
      sabado: form.janelaContato.sabado,
      sabadoHoraFim: Math.round(numeroOu(form.janelaContato.sabadoHoraFim, gravada.janelaContato.sabadoHoraFim)),
      domingo: form.janelaContato.domingo,
      feriado: form.janelaContato.feriado,
    },
    economia: economiaDoForm(form.economia, gravada.economia),
    pausada: form.pausada,
    pausadaMotivo: form.pausada ? form.pausadaMotivo.trim() || null : null,
  };
}

/** Uma etapa editada no formulário; `diaMax` vazio na última etapa é "sem teto". */
export function editarEtapa(
  etapas: readonly Etapa[],
  id: EtapaId,
  mudanca: Partial<Pick<Etapa, "acao" | "canalSugerido" | "responsavelUserId" | "ativa">> & {
    diaMin?: string;
    diaMax?: string;
  },
): Etapa[] {
  return etapas.map(e => {
    if (e.id !== id) return e;
    const nova: Etapa = { ...e };
    if (mudanca.acao !== undefined) nova.acao = mudanca.acao;
    if (mudanca.canalSugerido !== undefined) nova.canalSugerido = mudanca.canalSugerido as CanalHumano;
    if (mudanca.responsavelUserId !== undefined) nova.responsavelUserId = mudanca.responsavelUserId;
    if (mudanca.ativa !== undefined) nova.ativa = mudanca.ativa;
    if (mudanca.diaMin !== undefined) nova.diaMin = Math.round(numeroOu(mudanca.diaMin, e.diaMin));
    if (mudanca.diaMax !== undefined) {
      nova.diaMax = mudanca.diaMax.trim() === "" ? null : Math.round(numeroOu(mudanca.diaMax, e.diaMax ?? e.diaMin));
    }
    return nova;
  });
}

/**
 * Só a pausa muda — o botão "Pausar régua" da tela da régua reenvia a
 * política gravada inteira (economia inclusa) trocando só a pausa.
 */
export function corpoDaPausa(gravada: Politica, pausada: boolean, motivo: string): PoliticaEntrada {
  return {
    etapas: gravada.etapas,
    negociacao: gravada.negociacao,
    encargos: gravada.encargos,
    janelaContato: gravada.janelaContato,
    economia: gravada.economia,
    pausada,
    pausadaMotivo: pausada ? motivo.trim() || null : null,
  };
}

/** O que a rota devolve no PUT: `{ politica, ajustes }` ou a política crua. */
export function lerRespostaDoPut(resposta: unknown): { politica: Politica; ajustes: string[] } {
  const ajustes =
    resposta && typeof resposta === "object" && Array.isArray((resposta as { ajustes?: unknown }).ajustes)
      ? ((resposta as { ajustes: unknown[] }).ajustes).map(String)
      : [];
  return { politica: lerPolitica(resposta), ajustes };
}
