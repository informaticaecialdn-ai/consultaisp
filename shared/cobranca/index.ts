/**
 * COBRANÇA — o miolo compartilhado entre servidor e cliente.
 *
 * `dna`      → COMO falar (quadrante, abordagem, tom; vulnerável sobrepõe)
 * `regua`    → QUANDO e O QUE fazer (etapas por dias de atraso e carteira; prescrição)
 * `politica` → o que o provedor configura e as regras de negociação e parcelas
 * `acordo`   → a política de acordo POR CARTEIRA e as ofertas que ela autoriza
 * `estados`  → vocabulário e as máquinas de estado de caso e negociação
 *
 * Tudo puro: sem banco, sem React, sem I/O.
 */
export * from "./dna";
export * from "./regua";
export * from "./politica";
export * from "./acordo";
export * from "./estados";
export * from "./economia";
export * from "./cliente360";
export * from "./ficha360";
