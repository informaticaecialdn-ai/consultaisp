/**
 * Dispara MK sync direto via connector, sem auth/HTTP/browser.
 *
 * Uso (na VPS, em /var/www/consulta-isp):
 *   npx tsx script/trigger-mk-sync.ts <providerId>
 *
 * Imprime logs verbose do MK connector (incluindo DIAG) direto no terminal.
 * Não atualiza o DB — só roda o fetchDelinquents e dumpa primeira fatura.
 *
 * Útil para descobrir nome dos campos retornados pelo MK do cliente quando
 * o sync produz "1 dia" para todos inadimplentes (data não parseada).
 */
import "dotenv/config";
import { storage } from "../server/storage";
import { MkConnector } from "../server/erp/connectors/mk";

const mkConnector = new MkConnector();

const providerId = Number(process.argv[2] ?? 1);

(async () => {
  console.log(`\n=== MK sync debug para provider ${providerId} ===\n`);

  // Usa storage.getErpIntegrations que decripta as credentials sensíveis
  const integrations = await storage.getErpIntegrations(providerId);
  const intg = integrations.find(i => i.erpSource === "mk");

  if (!intg) {
    console.error(`Sem integração MK configurada para provider ${providerId}`);
    process.exit(1);
  }
  if (!intg.apiUrl || !intg.apiToken) {
    console.error(`Provider ${providerId} tem MK mas falta apiUrl/apiToken`);
    process.exit(1);
  }

  console.log(`apiUrl: ${intg.apiUrl}`);
  console.log(`apiUser (decriptado): ${intg.apiUser ? "(set, " + intg.apiUser.length + " chars)" : "—"}`);
  console.log(`apiToken (decriptado): ${intg.apiToken ? "(set, " + intg.apiToken.length + " chars)" : "—"}`);
  console.log(`mkContraSenha (decriptado): ${(intg as any).mkContraSenha ? "(set, " + (intg as any).mkContraSenha.length + " chars)" : "—"}\n`);

  console.log(`>>> Chamando mkConnector.fetchDelinquents()...\n`);
  const started = Date.now();

  try {
    const result = await mkConnector.fetchDelinquents({
      apiUrl: intg.apiUrl,
      apiToken: intg.apiToken,
      apiUser: intg.apiUser ?? undefined,
      mkContraSenha: (intg as any).mkContraSenha ?? undefined,
      extra: {},
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n>>> Concluído em ${elapsed}s — ok=${result.ok}, message="${result.message}"`);
    console.log(`>>> Total clientes retornados: ${result.customers?.length ?? 0}`);
    if (result.customers && result.customers.length > 0) {
      console.log(`\n>>> Distribuição maxDaysOverdue:`);
      const dist = new Map<number, number>();
      for (const c of result.customers) {
        const d = c.maxDaysOverdue ?? 0;
        dist.set(d, (dist.get(d) ?? 0) + 1);
      }
      const sorted = Array.from(dist.entries()).sort((a, b) => a[0] - b[0]);
      for (const [days, count] of sorted) {
        console.log(`  ${days}d → ${count} clientes`);
      }
      console.log(`\n>>> Primeiros 3 clientes:`);
      for (const c of result.customers.slice(0, 3)) {
        console.log(`  ${c.name?.slice(0, 30)} — ${c.maxDaysOverdue}d — R$ ${c.totalOverdueAmount}`);
      }
    }
  } catch (err) {
    console.error(`\n>>> Erro:`, err);
  }

  process.exit(0);
})();
