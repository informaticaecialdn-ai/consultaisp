/**
 * Diagnóstico do sync do ERP — roda no servidor e diz por que a base não atualiza.
 *
 *   npx tsx script/diagnostico-erp.ts
 *
 * Não altera nada, não faz chamada ao ERP e não imprime credencial.
 *
 * Existe porque "a base não atualiza" tem cinco causas diferentes — integração
 * desligada, credencial que o schema não guarda, credencial ilegível, ERP
 * recusando, worker parado — e nenhuma delas aparecia em lugar nenhum: até esta
 * versão nada escrevia em `erp_sync_logs` nem nos contadores de
 * `erp_integrations`, então a tela mostrava "0 registros · Nunca" tanto para uma
 * integração que falha todo dia quanto para uma que nunca foi configurada.
 *
 * Cada bloco termina num veredito, não num despejo de números.
 */
import "dotenv/config";
import { pool } from "../server/db";
import { getConnector, getSupportedSources } from "../server/erp";
import { decryptField } from "../server/utils/crypto";

const OK = "  [ok] ";
const AVISO = "  [!]  ";
const ERRO = "  [X]  ";
const n = (v: any) => Number(v ?? 0).toLocaleString("pt-BR");

function titulo(s: string) {
  console.log(`\n${s}\n${"─".repeat(s.length)}`);
}

function quandoFoi(d: Date | null): string {
  if (!d) return "nunca";
  const horas = (Date.now() - d.getTime()) / 3_600_000;
  const quando = d.toLocaleString("pt-BR");
  if (horas < 26) return `${quando} (há ${Math.round(horas)}h)`;
  return `${quando} (há ${Math.floor(horas / 24)} dias)`;
}

/** A idade da carteira é a prova mais direta: upsertFromErp carimba lastSyncAt. */
async function idadeDaBase() {
  titulo("1. Idade dos dados na carteira");
  const { rows } = await pool.query<any>(
    `SELECT p.name provedor, c.erp_source, count(*)::int total,
            max(c.last_sync_at) mais_recente,
            count(*) FILTER (WHERE c.last_sync_at IS NULL)::int nunca
       FROM customers c JOIN providers p ON p.id = c.provider_id
      GROUP BY 1,2 ORDER BY total DESC`);

  if (rows.length === 0) {
    console.log(AVISO + "Nenhum cliente na base.");
    return;
  }
  let algumRecente = false;
  for (const r of rows) {
    const fonte = r.erp_source || "(sem origem)";
    const d = r.mais_recente ? new Date(r.mais_recente) : null;
    const horas = d ? (Date.now() - d.getTime()) / 3_600_000 : Infinity;
    if (horas < 48) algumRecente = true;
    const marca = horas < 48 ? OK : ERRO;
    console.log(`${marca}${r.provedor} · ${fonte} · ${n(r.total)} clientes · último sync: ${quandoFoi(d)}`);
    if (r.nunca > 0) console.log(`       ${n(r.nunca)} nunca foram tocados por um sync (vieram de import/backup)`);
  }
  if (!algumRecente) {
    console.log(ERRO + "NENHUM provedor sincronizou nas últimas 48h. O sync não está rodando ou está falhando.");
  }
}

async function integracoes() {
  titulo("2. Integrações configuradas");
  const { rows } = await pool.query<any>(
    `SELECT i.provider_id, p.name provedor, i.erp_source, i.is_enabled, i.status,
            i.api_url, i.api_token, i.api_user,
            i.total_synced, i.total_errors, i.last_sync_at, i.last_sync_status
       FROM erp_integrations i JOIN providers p ON p.id = i.provider_id
      ORDER BY i.provider_id, i.erp_source`);

  if (rows.length === 0) {
    console.log(ERRO + "Nenhuma integração cadastrada. Nada para sincronizar.");
    return [];
  }

  let habilitadas = 0;
  for (const r of rows) {
    const temUrl = !!(r.api_url || "").trim();
    const temToken = !!(r.api_token || "").trim();
    const elegivel = r.is_enabled && temUrl && temToken;
    if (elegivel) habilitadas++;

    console.log(`\n  ${r.provedor} · ${r.erp_source}`);
    console.log(`    habilitada: ${r.is_enabled ? "sim" : "NÃO"} · url: ${temUrl ? r.api_url : "VAZIA"} · token: ${temToken ? `${r.api_token.length} chars` : "VAZIO"} · usuário: ${(r.api_user || "").trim() ? "preenchido" : "vazio"}`);
    console.log(`    contadores: ${n(r.total_synced)} sincronizados / ${n(r.total_errors)} erros · último: ${quandoFoi(r.last_sync_at ? new Date(r.last_sync_at) : null)} ${r.last_sync_status ? `(${r.last_sync_status})` : ""}`);

    if (!elegivel) {
      console.log(ERRO + "  Fora do sync: getAllEnabledErpIntegrationsWithCredentials exige is_enabled + api_url + api_token.");
      continue;
    }

    // A credencial é decifrada com chave derivada do SESSION_SECRET. Se ele
    // mudou (troca de servidor, backup de outro ambiente), o AES-GCM lança na
    // verificação da tag — e até esta versão isso derrubava a lista inteira.
    for (const campo of ["api_token", "api_user"] as const) {
      const v = r[campo];
      if (typeof v !== "string" || !v.startsWith("enc:")) continue;
      try {
        decryptField(v);
      } catch (e: any) {
        console.log(ERRO + `  "${campo}" NÃO decifra: ${e.message}`);
        console.log("         A chave vem do SESSION_SECRET. Ele mudou desde que o token foi salvo — reconfigure a integração pela tela.");
      }
    }

    // O conector pede campos que a tabela pode não ter onde guardar.
    const conector = getConnector(r.erp_source);
    if (!conector) {
      console.log(ERRO + `  Conector "${r.erp_source}" não existe. Suportados: ${getSupportedSources().join(", ")}`);
      continue;
    }
    const colunas = new Set(["apiUrl", "apiToken", "apiUser"]);
    const semOndeGuardar = (conector.configFields ?? [])
      .filter((f: any) => f.required)
      .map((f: any) => String(f.key))
      .filter((k: string) => !colunas.has(k));
    if (semOndeGuardar.length > 0) {
      console.log(ERRO + `  ${conector.label ?? r.erp_source} exige ${semOndeGuardar.join(", ")} — e erp_integrations não tem coluna para isso.`);
      console.log("         O valor digitado na tela é aceito, reportado como salvo e descartado pelo Drizzle em silêncio.");
    } else {
      console.log(OK + "  Credenciais que o conector exige cabem na tabela.");
    }
  }

  console.log();
  if (habilitadas === 0) {
    console.log(ERRO + "Nenhuma integração elegível — syncAllProviders não tem o que fazer.");
  } else {
    console.log(OK + `${habilitadas} integração(ões) elegível(is) para o sync das 03:00.`);
  }
  return rows;
}

async function historico() {
  titulo("3. Histórico de sync");
  const { rows: total } = await pool.query<any>(`SELECT count(*)::int c FROM erp_sync_logs`);
  if (total[0].c === 0) {
    console.log(AVISO + "Nenhum registro em erp_sync_logs.");
    console.log("       Se o sistema ainda não foi reiniciado depois desta versão, é o esperado:");
    console.log("       até agora nada gravava aqui. Rode um sync manual e volte a rodar este diagnóstico.");
    return;
  }
  const { rows } = await pool.query<any>(
    `SELECT p.name provedor, l.erp_source, l.status, l.upserted, l.errors,
            l.sync_type, l.synced_at, l.payload
       FROM erp_sync_logs l JOIN providers p ON p.id = l.provider_id
      ORDER BY l.synced_at DESC LIMIT 15`);
  for (const r of rows) {
    const marca = r.status === "success" ? OK : r.status === "partial" ? AVISO : ERRO;
    const msg = r.payload?.mensagem ? ` — ${r.payload.mensagem}` : "";
    console.log(`${marca}${new Date(r.synced_at).toLocaleString("pt-BR")} · ${r.provedor}/${r.erp_source} · ${r.status} · ${n(r.upserted)} gravados, ${n(r.errors)} erros (${r.sync_type})${msg}`);
  }

  const { rows: consec } = await pool.query<any>(
    `SELECT p.name provedor, l.erp_source, count(*)::int seguidas
       FROM erp_sync_logs l JOIN providers p ON p.id = l.provider_id
      WHERE l.status = 'error'
        AND l.synced_at > COALESCE((SELECT max(synced_at) FROM erp_sync_logs x
                                     WHERE x.provider_id = l.provider_id
                                       AND x.erp_source = l.erp_source
                                       AND x.status <> 'error'), '-infinity'::timestamp)
      GROUP BY 1,2 HAVING count(*) >= 3`);
  for (const r of consec) {
    console.log(ERRO + `${r.provedor}/${r.erp_source}: ${r.seguidas} falhas CONSECUTIVAS — integração morta, não ruído de rede.`);
  }
}

async function main() {
  console.log("DIAGNÓSTICO DO SYNC ERP — somente leitura, não imprime credencial");
  await idadeDaBase();
  await integracoes();
  await historico();
  console.log("\nFim. Cole esta saída inteira.\n");
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
