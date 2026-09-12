/**
 * A UNICA leitura de DEMO_MODE no servidor.
 *
 * Centralizada de proposito: a diferenca entre a instancia de demonstracao e a
 * de producao precisa caber numa linha de grep. Qualquer `process.env.DEMO_MODE`
 * solto no codigo e um caminho que ninguem consegue auditar depois.
 *
 * So a string exata "true" liga. Um `DEMO_MODE=1` esquecido no .env de producao
 * nao pode transformar o sistema real em demonstracao.
 */
export function emModoDemo(): boolean {
  return process.env.DEMO_MODE === "true";
}
