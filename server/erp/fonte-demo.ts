/**
 * O `erpSource` "demo" — a fonte que identifica os cinco provedores fictícios
 * da demonstração pública, tanto para o CONECTOR
 * (`server/erp/connectors/demo.ts`, que lê a base local em vez de chamar um
 * ERP de verdade) quanto para a SEMEADURA (`server/demo/mundo-base.ts`, que
 * grava `erp_integrations` com esta fonte) quanto para a VARREDURA
 * (`server/services/erp-sync.service.ts`, que PULA esta fonte na escrita —
 * ver o comentário em `syncProviderToDb`).
 *
 * Uma constante só, para as três pontas nunca discordarem sobre o nome.
 *
 * Fica fora de `server/demo/modo-demo.ts` de propósito: aquele arquivo é o
 * leitor ÚNICO de `DEMO_MODE` (a env var que liga a instância inteira em modo
 * demonstração). Isto aqui é outro conceito — QUAL `erpSource` é o da
 * demonstração, não qual modo o processo está rodando. Confundir os dois
 * levaria alguém a "simplificar" apagando um em favor do outro.
 */
export const FONTE_ERP_DEMO = "demo";

export function ehFonteDeDemonstracao(erpSource: string): boolean {
  return erpSource === FONTE_ERP_DEMO;
}
