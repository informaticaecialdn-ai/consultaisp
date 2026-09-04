/**
 * A data que o ERP escreveu, virando `Date` — ou nada.
 *
 * Cada ERP tem o seu formato, e o mesmo ERP tem mais de um: o SGP devolve
 * `data_status` como "2024-10-04 11:16:49" no `listacontrato` e `dataCadastro`
 * como "20/03/2024 11:43:25" no `consultacliente`. O IXC manda ISO puro. Um
 * `new Date(texto)` sobre o formato brasileiro devolve `Invalid Date` em alguns
 * runtimes e uma data ERRADA em outros (mes e dia trocados), que e pior:
 * "05/03/2024" viraria 3 de maio, e um corte de dois meses atras entraria no
 * sistema como de dois meses adiante.
 *
 * Devolve `undefined` para o que nao souber ler. A regra desta casa e que
 * ausencia de informacao nao vira dado — e uma data inventada e pior que uma
 * data ausente, porque o score a usa para pesar quanto tempo faz.
 */
export function dataDoErp(bruto: string | null | undefined): Date | undefined {
  const t = String(bruto ?? "").trim();
  if (!t) return undefined;

  // "20/03/2024" e "20/03/2024 11:43:25"
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, a, hh = "0", mm = "0", ss = "0"] = br;
    return valida(new Date(Number(a), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
  }

  // "2024-10-04" e "2024-10-04 11:16:49" (o espaco no lugar do T e o que o
  // Django serializa por padrao, e nem todo runtime aceita).
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, a, m, d, hh = "0", mm = "0", ss = "0"] = iso;
    return valida(new Date(Number(a), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
  }

  return undefined;
}

/**
 * Recusa o que nao e data e o que e absurdo.
 *
 * O ano zero e o ano 9999 aparecem em cadastro de ERP com mais frequencia do
 * que se imagina — sao o resultado de campo vazio convertido, e passariam pelo
 * `Number.isFinite` sem reclamar.
 */
function valida(d: Date): Date | undefined {
  if (Number.isNaN(d.getTime())) return undefined;
  const ano = d.getFullYear();
  return ano >= 1990 && ano <= 2100 ? d : undefined;
}
