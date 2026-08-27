/**
 * Agenda da varredura completa da base local.
 *
 * A base local NAO responde consulta — quem responde e o ERP ao vivo, por
 * documento. Ela alimenta a Localizacao, o mapa de calor e o estado de cliente
 * do anti-fraude, e para isso nao precisa ser de hoje: precisa ser periodica e
 * completa. Por isso a varredura passou de diaria para tres vezes por semana,
 * de madrugada. Cada passada custa ~30 min e dezenas de milhares de chamadas ao
 * ERP do provedor; repetir isso todo dia era carga sem ganho.
 *
 * As funcoes aqui sao puras para poderem ser testadas — a regra de "qual e a
 * proxima madrugada" e o tipo de coisa que erra em virada de mes, de ano e de
 * semana, e o defeito so aparece meses depois.
 */

/** 0=domingo … 6=sabado. Segunda, quarta e sexta. */
export const DIAS_PADRAO = [1, 3, 5];
export const HORA_PADRAO = 3;

/** Le a agenda do ambiente, caindo no padrao quando o valor nao presta. */
export function agendaDoAmbiente(env: NodeJS.ProcessEnv = process.env): { dias: number[]; hora: number } {
  const brutoDias = (env.ERP_SYNC_DIAS ?? "").trim();
  const dias = brutoDias
    ? Array.from(new Set(
        brutoDias.split(",")
          .map(d => Number(d.trim()))
          .filter(d => Number.isInteger(d) && d >= 0 && d <= 6),
      )).sort((a, b) => a - b)
    : DIAS_PADRAO;

  const brutoHora = Number(env.ERP_SYNC_HORA);
  const hora = Number.isInteger(brutoHora) && brutoHora >= 0 && brutoHora <= 23
    ? brutoHora
    : HORA_PADRAO;

  return { dias: dias.length > 0 ? dias : DIAS_PADRAO, hora };
}

/**
 * Proxima madrugada agendada, estritamente depois de `agora`.
 *
 * Avanca dia a dia em vez de calcular deslocamento: assim o horario de verao,
 * a virada de mes e a de ano ficam por conta do proprio Date, e nao de
 * aritmetica de milissegundos que erra em uma dessas tres.
 */
export function proximaExecucao(agora: Date, dias: number[], hora: number): Date {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(agora);
    d.setDate(d.getDate() + i);
    d.setHours(hora, 0, 0, 0);
    if (d > agora && dias.includes(d.getDay())) return d;
  }
  // Inalcancavel com `dias` nao-vazio: em 8 dias todo dia da semana aparece.
  const fallback = new Date(agora);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(hora, 0, 0, 0);
  return fallback;
}

/**
 * A ULTIMA madrugada agendada que ja passou.
 *
 * E com ela que o boot decide se sincroniza, e nao com uma janela fixa de horas.
 * Comparar com "sincronizou nas ultimas N horas" erra dos dois lados: com a
 * varredura 3x por semana, um restart um dia depois do sync dispararia varredura
 * nova sem necessidade; e um processo que ficou fora do ar na madrugada agendada
 * so voltaria a sincronizar na seguinte, perdendo a janela inteira.
 *
 * Comparando com a agenda, o comportamento e o do `Persistent=true` do systemd:
 * perdeu a janela, roda ao subir; nao perdeu, espera a proxima.
 */
export function ultimaExecucaoAgendada(agora: Date, dias: number[], hora: number): Date {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(agora);
    d.setDate(d.getDate() - i);
    d.setHours(hora, 0, 0, 0);
    if (d <= agora && dias.includes(d.getDay())) return d;
  }
  const fallback = new Date(agora);
  fallback.setDate(fallback.getDate() - 1);
  fallback.setHours(hora, 0, 0, 0);
  return fallback;
}

/** Descreve a agenda para o log, em portugues. */
export function descreverAgenda(dias: number[], hora: number): string {
  const nomes = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const lista = dias.map(d => nomes[d]).join(", ");
  return `${lista} as ${String(hora).padStart(2, "0")}:00`;
}
