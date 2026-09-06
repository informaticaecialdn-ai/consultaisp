/**
 * Todo processo que fala com ERP de parceiro precisa sair por IPv4 — a VPS
 * tem um IPv6 que nenhum provedor tem na lista de IP liberado, e o Node o
 * prefere (memoria "saida-ipv6-vs-ip-liberado": 3 dias perdidos no SGP da
 * Amplinet). A API e o worker chamam `preferirIPv4NaSaida()` na primeira
 * linha; os scripts de varredura manual nao chamavam, e a varredura do SGP
 * por script dava 403 em 06/09/2026 com a mesma credencial que o worker usa.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPTS_QUE_FALAM_COM_ERP = ["script/trigger-erp-sync.ts", "script/trigger-mk-sync.ts", "script/probe-mk-conexoes.ts", "server/index.ts", "server/worker.ts"];

describe("saida por IPv4", () => {
  it.each(SCRIPTS_QUE_FALAM_COM_ERP)("%s chama preferirIPv4NaSaida() antes de qualquer rede", (arquivo) => {
    const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
    expect(fonte).toContain('from "./rede-saida"'.replace("./", arquivo.startsWith("script/") ? "../server/" : "./"));
    expect(fonte).toContain("preferirIPv4NaSaida();");
  });
});
