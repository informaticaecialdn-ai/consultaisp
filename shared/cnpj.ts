/**
 * O CNPJ do provedor: cru para guardar e enviar, mascarado para mostrar.
 *
 * POR QUE ESTE MÓDULO EXISTE, e por que ele não podia continuar morando dentro
 * da ficha do superadmin (`pages/admin/cadastro-provedor.ts`) nem, depois, em
 * `client/src/lib/cnpj.ts`.
 *
 * `providers.cnpj` guardou, durante meses, DUAS formas do mesmo dado. Medido em
 * produção em 05/09/2026: dois provedores com os 14 dígitos crus
 * ("22759562000156") e quatro com a pontuação dentro do banco
 * ("23.864.873/0001-48"). A causa está no cadastro público, que validava o CNPJ
 * normalizado e gravava o que foi digitado; e como `getProviderByCnpj` compara
 * com igualdade exata de string, quem se cadastrasse digitando os 14 dígitos
 * não casaria com a linha pontuada — nascia um SEGUNDO provedor para a mesma
 * empresa, com a carteira, os créditos e os alertas partidos em dois tenants.
 *
 * A correção normaliza a coluna: daqui para a frente `providers.cnpj` são 14
 * dígitos, para todo mundo. Só que, para os quatro provedores que hoje veem o
 * próprio CNPJ pontuado na tela, essa pontuação vem do BANCO — nenhuma tela a
 * formatava. Sem este módulo, a correção apareceria para eles como uma
 * REGRESSÃO visível: o CNPJ da empresa deles viraria "23864873000148".
 *
 * Daí a regra, e ela vale para o sistema inteiro: **a máscara é da exibição**. O
 * estado, o corpo de um PATCH e a comparação usam `cnpjCru`; só o que vai para
 * os olhos passa por `cnpjMascarado`.
 *
 * ── POR QUE EM `shared/` E NÃO EM `client/` ────────────────────────────────
 *
 * A varredura da regressão passou pelas telas e parou na borda do navegador. O
 * SERVIDOR também imprime esse CNPJ para uma pessoa ler: o e-mail de
 * boas-vindas (`montarBoasVindas`, em server/services/email.ts) carrega os
 * dados do cadastro num bloco `mono`, e é — pelo comentário do próprio arquivo
 * — "o único e-mail que o provedor guarda", aquele a que ele volta meses depois.
 * Com a coluna canônica, ele passaria a imprimir "22759562000156".
 *
 * O servidor não pode importar de `client/`, e uma segunda cópia da máscara é
 * exatamente a divergência que a varredura das telas existe para impedir (havia
 * QUATRO cópias; uma delas já divergia). Então a função subiu para `shared/`,
 * que é o que os dois lados alcançam. `client/src/lib/cnpj.ts` reexporta daqui,
 * então nada que importava de `@/lib/cnpj` — nem da ficha do superadmin, que
 * reexporta em cascata — precisou mudar.
 */

/** Nulo, indefinido e número viram texto. */
function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Só dígitos, no máximo 14. É esta a forma que se guarda, se envia e se compara. */
export function cnpjCru(v: string | null | undefined): string {
  return texto(v).replace(/\D/g, "").slice(0, 14);
}

/**
 * 00.000.000/0000-00 — só para EXIBIR.
 *
 * Mascara em degraus porque o campo também é digitado: um formatador que só
 * saiba mascarar os 14 dígitos completos devolve o número cru enquanto se
 * digita, e o cursor pula a cada tecla.
 *
 * Aceita entrada já pontuada e devolve o mesmo resultado (`cnpjCru` limpa
 * antes), o que é o que faz esta função servir para os dois mundos que convivem
 * enquanto a migração não roda em todo lugar: a linha antiga com pontuação no
 * banco e a linha nova com 14 dígitos saem idênticas na tela — e na caixa de
 * entrada.
 */
export function cnpjMascarado(v: string | null | undefined): string {
  const d = cnpjCru(v);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
