/**
 * Dispara a varredura COMPLETA de um provedor, direto pelo serviço de sync,
 * sem sessão nem navegador — qualquer ERP do registry.
 *
 *   npx tsx script/trigger-erp-sync.ts <providerId> <erpSource>
 *   ex.: npx tsx script/trigger-erp-sync.ts 4 ixc
 *
 * Grava no banco exatamente como o scheduler (syncProviderToDb, tipo
 * "manual"), com a mesma trava por provedor/ERP: se já houver varredura em
 * andamento em outro processo, sai sem fazer nada.
 *
 * Por que existe: em 02/09/2026 a varredura da O L I (IXC) foi interrompida
 * quatro vezes por restart do worker durante deploys, e a anterior (31/08)
 * tinha baixado a dívida de todos os ativos em atraso por uma leitura vazia.
 * Rodar por aqui, em processo próprio (nohup), sobrevive ao pm2.
 */
import "dotenv/config";
import { storage } from "../server/storage";
import { syncProviderToDb } from "../server/services/erp-sync.service";

const providerId = Number(process.argv[2]);
const erpSource = String(process.argv[3] ?? "").trim().toLowerCase();

(async () => {
  if (!Number.isInteger(providerId) || providerId <= 0 || !erpSource) {
    console.error("uso: npx tsx script/trigger-erp-sync.ts <providerId> <erpSource>");
    process.exit(1);
  }
  const provider = await storage.getProvider(providerId);
  if (!provider) { console.error(`provedor ${providerId} não existe`); process.exit(1); }

  // getErpIntegrations decripta as credenciais.
  const integrations = await storage.getErpIntegrations(providerId);
  const intg = integrations.find(i => i.erpSource === erpSource);
  if (!intg) { console.error(`provedor ${providerId} não tem integração ${erpSource}`); process.exit(1); }
  if (!intg.apiUrl || !intg.apiToken) { console.error(`integração ${erpSource} sem apiUrl/apiToken`); process.exit(1); }

  console.log(`=== varredura ${erpSource} do provedor ${providerId} (${provider.name}) — ${new Date().toISOString()} ===`);
  const t0 = Date.now();
  const r = await syncProviderToDb(providerId, provider.name, erpSource, intg as any, "manual");
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.jaEmAndamento) {
    console.log(`>>> já havia varredura em andamento para ${providerId}:${erpSource} — nada feito`);
  } else {
    console.log(`>>> concluída em ${s}s — upserted=${r.upserted} errors=${r.errors}`);
  }
  process.exit(r.errors > 0 && r.upserted === 0 ? 2 : 0);
})().catch(err => {
  console.error(">>> falhou:", err);
  process.exit(1);
});
