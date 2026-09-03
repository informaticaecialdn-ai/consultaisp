/**
 * Os planos, como o cliente os nomeia.
 *
 * O CATÁLOGO tem dois: Gratuito e Profissional — os mesmos da landing.
 * Decisão do dono em 03/09/2026. `basic` e `enterprise` saíram: ninguém mais
 * pode ser posto neles, e a migração 0014 moveu quem estava para `pro`.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────
 * Havia CINCO mapas de rótulo de plano espalhados pelo cliente (barra lateral,
 * painel do provedor, dois no financeiro, um na tela do provedor no admin), e
 * eles já discordavam entre si: o mesmo plano aparecia como "Pro" numa tela e
 * "Profissional" na outra. É o mesmo defeito que a tabela de preço tinha antes
 * de virar fonte única — só que em texto, que ninguém percebe até o cliente
 * perguntar por que o nome mudou.
 *
 * O PREÇO não mora aqui: preço varia por marca revendedora e só o servidor
 * sabe qual é (`usePrecos`). Rótulo é constante — o mesmo em qualquer marca.
 */

/** As chaves que o sistema oferece hoje. Seletor nenhum mostra outra coisa. */
export const PLANOS_DO_CATALOGO = ["free", "pro"] as const;
export type PlanoDoCatalogo = typeof PLANOS_DO_CATALOGO[number];

const ROTULOS: Record<string, string> = {
  free: "Gratuito",
  pro: "Profissional",
  // Fora do catálogo. Continuam aqui porque `plan_changes` e o `plan_at_time`
  // das faturas são registro histórico: mostram o que existia na época, e a
  // tela não pode renderizar a chave crua no lugar do nome.
  basic: "Básico",
  enterprise: "Enterprise",
};

/** Nunca devolve vazio: plano desconhecido volta como a própria chave. */
export function rotuloDoPlano(chave: string | null | undefined): string {
  const k = (chave || "").trim();
  if (!k) return ROTULOS.free;
  return ROTULOS[k] || k;
}

/** Plano fora do catálogo: existe em dado antigo, não pode ser escolhido. */
export function ehPlanoLegado(chave: string | null | undefined): boolean {
  const k = (chave || "").trim();
  return k.length > 0 && !(PLANOS_DO_CATALOGO as readonly string[]).includes(k);
}

/** Qualquer plano pago. Usado para liberar o que o Gratuito não tem. */
export function ehPlanoPago(chave: string | null | undefined): boolean {
  const k = (chave || "").trim();
  return k.length > 0 && k !== "free";
}
