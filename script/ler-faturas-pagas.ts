/**
 * A LEITURA INICIAL das faturas pagas de um provedor — a historia inteira,
 * por janelas de data de pagamento, direto pelo conector e sem sessao.
 *
 *   npx tsx script/ler-faturas-pagas.ts <providerId> <ixc|sgp|mk> [desde] [ate] [mesesPorJanela]
 *   ex.: nohup npx tsx script/ler-faturas-pagas.ts 4 ixc 2019-01-01 > /root/pagas-ng.log 2>&1 &
 *
 * Por que existe: a varredura regular so le INCREMENTAL (desde o ultimo
 * pagamento gravado); sem uma primeira leitura ela nao le nada e diz isso no
 * log. A historia de um provedor de 28 mil clientes tem centenas de milhares
 * de titulos — nao cabe numa chamada: aqui vai em janelas de N meses, cada
 * uma gravada antes da seguinte, para uma queda no meio nao perder o que ja
 * veio. Rodar de novo e idempotente (upsert por referencia).
 *
 * MK: a leitura e por cliente (WSMKFaturas, API licenciada); a janela nao se
 * aplica — uma passada pelos clientes com id no ERP, historia inteira.
 */
import "dotenv/config";
import { preferirIPv4NaSaida } from "../server/rede-saida";
preferirIPv4NaSaida();
import { storage } from "../server/storage";
import "../server/erp";
import { getConnector } from "../server/erp/registry";
import { buildConnectorConfig } from "../server/erp/config";

const providerId = Number(process.argv[2]);
const erpSource = String(process.argv[3] ?? "").trim().toLowerCase();
const desdeArg = process.argv[4] ?? "2019-01-01";
const ateArg = process.argv[5] ?? new Date().toISOString().slice(0, 10);
const mesesPorJanela = Math.max(1, Number(process.argv[6] ?? 6));

const dia = (d: Date) => d.toISOString().slice(0, 10);
const somarMeses = (iso: string, n: number) => { const [a, m, d] = iso.split("-").map(Number); return dia(new Date(Date.UTC(a, m - 1 + n, d))); };

(async () => {
  if (!Number.isInteger(providerId) || !erpSource || !/^\d{4}-\d{2}-\d{2}$/.test(desdeArg) || !/^\d{4}-\d{2}-\d{2}$/.test(ateArg)) {
    console.error("uso: npx tsx script/ler-faturas-pagas.ts <providerId> <ixc|sgp|mk> [desde AAAA-MM-DD] [ate AAAA-MM-DD] [mesesPorJanela]");
    process.exit(1);
  }
  const intg = (await storage.getErpIntegrations(providerId)).find(i => i.erpSource === erpSource);
  if (!intg?.apiUrl || !intg.apiToken) { console.error("integracao sem apiUrl/apiToken"); process.exit(1); }
  const cfg = buildConnectorConfig(intg as any);
  const config = { ...cfg, extra: { ...(cfg.extra ?? {}), providerId: String(providerId) } };
  const conector = getConnector(erpSource);
  if (!conector?.fetchFaturasPagas) { console.error(`o conector ${erpSource} nao le faturas pagas`); process.exit(1); }

  const t0 = Date.now();
  let totalGravadas = 0, totalSemCliente = 0, totalLidas = 0;
  const janelas: Array<{ desde: string | null; ate: string | null }> = [];
  if (conector.faturasPagasPorCliente) {
    janelas.push({ desde: null, ate: null });
  } else {
    for (let ini = desdeArg; ini < ateArg; ini = somarMeses(ini, mesesPorJanela)) {
      const fim = somarMeses(ini, mesesPorJanela);
      janelas.push({ desde: ini, ate: fim < ateArg ? fim : ateArg });
    }
  }
  const clientes = conector.faturasPagasPorCliente
    ? (await storage.getCustomersByProvider(providerId)).filter(c => c.erpCustomerId).map(c => ({ erpCustomerId: c.erpCustomerId!, cpfCnpj: c.cpfCnpj }))
    : [];
  console.log(`=== faturas pagas · provedor ${providerId} · ${erpSource} · ${janelas.length} janela(s)` + (conector.faturasPagasPorCliente ? ` · ${clientes.length} clientes com id no ERP` : ` · ${desdeArg} → ${ateArg}`) + ` ===`);

  for (const j of janelas) {
    const r = await conector.fetchFaturasPagas(config, { desde: j.desde, ate: j.ate, clientes });
    if (r.indisponivel) { console.log(`>>> indisponivel: ${r.message}`); break; }
    if (!r.ok) { console.log(`>>> janela ${j.desde}→${j.ate} falhou: ${r.message}`); continue; }
    const g = await storage.upsertFaturasPagasDoErp(providerId, erpSource, r.faturas);
    totalLidas += r.faturas.length; totalGravadas += g.gravadas; totalSemCliente += g.semCliente;
    console.log(`janela ${j.desde ?? "inicio"} → ${j.ate ?? "hoje"}: ${r.faturas.length} lidas · ${g.gravadas} gravadas · ${g.semCliente} sem cliente` + (r.parcial ? " · PARCIAL (reduza a janela)" : ""));
  }
  console.log(`>>> ${totalLidas} lidas, ${totalGravadas} gravadas, ${totalSemCliente} sem cliente na base, em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
})().catch(e => { console.error(">>> falhou:", e?.message ?? e); process.exit(1); });
