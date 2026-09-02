/**
 * "Setor N" nao e bairro: e a zona interna de cadastro do MK Solutions, que
 * alguns provedores usam no lugar do bairro real. Nunca vai casar com IBGE
 * CNEFE nem ANEEL BDGD — e a tela precisa dizer isso em vez de deixar o
 * operador achar que as bases publicas falharam.
 *
 * Fica em shared/ porque ranking e raio-X precisam concordar sobre o que e
 * zona interna; dois regex iguais em dois arquivos divergem com o tempo.
 *
 * Nome sozinho nao basta: cidades do interior de GO/TO tem bairros oficiais
 * "Setor 1", "Setor 2"… que casam no CNEFE. Um provedor IXC ou SGP la veria
 * "zona interna MK" sobre um bairro de verdade. Por isso o aviso so sai quando
 * o provedor tem o MK ligado em erp_integrations — a tela le isso de
 * GET /api/provider/erp-integrations, que /api/localizacao nao repete.
 */
export function isSetorInterno(bairro: string | null | undefined): boolean {
  if (!bairro) return false;
  return /^setor\s*\d+$/i.test(bairro.trim());
}

/** O que a tela precisa saber de cada linha de erp_integrations. */
export interface ErpIntegracaoResumo {
  erpSource: string;
  isEnabled: boolean;
}

/** Lista ausente (query ainda carregando ou falhou) vale "nao usa": na duvida
 *  o rotulo generico "sem bases publicas" e o honesto. */
export function provedorUsaMk(erps: ErpIntegracaoResumo[] | null | undefined): boolean {
  return erps?.some(e => e.erpSource === "mk" && e.isEnabled) ?? false;
}

/** Recorte territorial de um bairro — o que decide se o aviso faz sentido. */
export interface BairroTerritorio {
  bairro: string;
  hps: number | null;
  ucsVivas: number | null;
}

/**
 * Aviso de zona interna so quando as TRES coisas batem: nenhuma base casou,
 * o provedor usa MK e o nome tem a cara de "Setor N". Se um "Setor N" casou
 * com alguma coisa, o funil tem numero e o aviso mentiria dizendo que nao ha
 * match; sem MK, "Setor 3" e bairro real e o rotulo generico e o correto.
 */
export function mostrarAvisoSetor(b: BairroTerritorio, usaMk: boolean): boolean {
  const semBases = b.hps === null && b.ucsVivas === null;
  return semBases && usaMk && isSetorInterno(b.bairro);
}
