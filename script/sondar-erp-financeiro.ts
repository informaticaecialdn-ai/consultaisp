/**
 * Sonda, com UMA chamada por pergunta, o que cada ERP devolve para as tres
 * coisas que a Economia do contrato encerrado precisa e o sync ainda nao le:
 *
 *   1. faturas PAGAS, com data e valor pago;
 *   2. o valor (mensalidade) do plano do contrato;
 *   3. a data de cancelamento/desativacao do contrato.
 *
 *   npx tsx script/sondar-erp-financeiro.ts <providerId> <mk|ixc|sgp>
 *
 * Imprime CHAVES e amostras MASCARADAS (nome, documento, contato e endereco
 * viram "•••"): o que interessa e a forma do payload, nao a pessoa. O
 * documento do cliente usado como exemplo fica no processo e nao vai ao log.
 *
 * Por que existe: em 09/09/2026 o dono decidiu que a Economia do ex-cliente e
 * o RESULTADO do contrato (inicio → cancelamento) com os valores realmente
 * pagos — e o conector so lia fatura aberta. Desenhar a leitura sem ver o
 * payload real seria chute (regra do dono: so dado verificavel).
 */
import "dotenv/config";
import { preferirIPv4NaSaida } from "../server/rede-saida";
preferirIPv4NaSaida();
import { storage } from "../server/storage";
// O barril registra os conectores; o registry sozinho esta vazio.
import "../server/erp";
import { getConnector } from "../server/erp/registry";
import { buildConnectorConfig } from "../server/erp/config";

const providerId = Number(process.argv[2]);
const erpSource = String(process.argv[3] ?? "").trim().toLowerCase();
const SENSIVEL = /nome|name|razao|cpf|cnpj|documento|\bdoc\b|email|telefone|fone|celular|endereco|logradouro|numero_casa|complemento|contato|whats/i;

function mascarar(v: unknown, prof = 0): unknown {
  if (Array.isArray(v)) return v.slice(0, 2).map(x => mascarar(x, prof + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = SENSIVEL.test(k) ? "•••" : mascarar(x, prof + 1);
    return o;
  }
  return v;
}
const mostrar = (rotulo: string, corpo: unknown) => {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(mascarar(corpo));
  console.log(`\n--- ${rotulo} ---`);
  console.log(texto.slice(0, 1800));
};
const chaves = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as object).join(", ") : typeof o);
const enc = encodeURIComponent;

(async () => {
  if (!Number.isInteger(providerId) || !["mk", "ixc", "sgp"].includes(erpSource)) {
    console.error("uso: npx tsx script/sondar-erp-financeiro.ts <providerId> <mk|ixc|sgp>");
    process.exit(1);
  }
  const intg = (await storage.getErpIntegrations(providerId)).find(i => i.erpSource === erpSource);
  if (!intg?.apiUrl || !intg.apiToken) { console.error("integracao sem apiUrl/apiToken"); process.exit(1); }
  const cfg = buildConnectorConfig(intg as any);
  const config = { ...cfg, extra: { ...(cfg.extra ?? {}), providerId: String(providerId) } };
  const c: any = getConnector(erpSource);
  if (!c) { console.error("conector nao registrado"); process.exit(1); }

  const clientes = await storage.getCustomersByProvider(providerId);
  const ex = clientes.find(x => x.status === "cancelled" && Number(x.totalOverdueAmount ?? 0) > 0)
    ?? clientes.find(x => x.status === "cancelled") ?? clientes[0];
  const doc = (ex?.cpfCnpj ?? "").replace(/\D/g, "");
  console.log(`provedor ${providerId} · ${erpSource} · cliente de exemplo: id ${ex?.id} (${ex?.status})`);

  if (erpSource === "mk") {
    const token: string = await c.authenticate(config);
    const base: string = c.baseUrl(config);
    const get = async (rule: string, qs: string) => {
      const r = await fetch(`${base}/mk/${rule}.rule?sys=MK0&token=${enc(token)}&${qs}`, { signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: t }; }
    };
    const cd = await get("WSMKConsultaDoc", `doc=${enc(doc)}`);
    const dados = cd.json;
    const cdCliente = dados?.CodigoPessoa ?? dados?.cd_cliente ?? dados?.codigo ?? dados?.id;
    console.log(`ConsultaDoc HTTP ${cd.status} · chaves: ${chaves(dados)} · CodigoPessoa presente: ${!!cdCliente}`);
    if (!cdCliente) { mostrar("ConsultaDoc corpo", dados); process.exit(0); }
    // O conector chama WSMKFaturas com codigo_cliente/liquidado/quantidade_meses
    // e ninguem nunca viu a resposta (o fallback nao disparava). Variantes de
    // parametro, uma chamada cada, com o corpo do erro em texto.
    const variantes = [
      `codigo_cliente=${enc(String(cdCliente))}&liquidado=true&quantidade_meses=12`,
      `cd_cliente=${enc(String(cdCliente))}&liquidado=true&quantidade_meses=12`,
      `codigo_cliente=${enc(String(cdCliente))}&liquidado=S&quantidade_meses=12`,
      `codigo_cliente=${enc(String(cdCliente))}`,
      `cd_cliente=${enc(String(cdCliente))}`,
    ];
    for (const qs of variantes) {
      const f = await get("WSMKFaturas", qs);
      const j = f.json;
      const lista = Array.isArray(j) ? j : (j && typeof j === "object" ? (j.Faturas ?? j.faturas ?? j.registros ?? j.data ?? Object.values(j).find(v => Array.isArray(v)) ?? []) : []);
      console.log(`\nWSMKFaturas ?${qs.replace(/token=[^&]*&?/, "")} → HTTP ${f.status} · raiz: ${typeof j === "string" ? "texto" : chaves(j)} · itens: ${Array.isArray(lista) ? lista.length : "?"}`);
      if (typeof j === "string") console.log(`  corpo: ${j.slice(0, 400).replace(/\s+/g, " ")}`);
      if (Array.isArray(lista) && lista[0]) { console.log(`  chaves da fatura: ${chaves(lista[0])}`); mostrar("amostra", lista.slice(0, 2)); }
      if (Array.isArray(lista) && lista.length > 0) break;
    }
    const v2 = await get("WSMKContratosPorClienteV2", `cd_cliente=${enc(String(cdCliente))}`);
    const jv = v2.json;
    console.log(`\nContratosV2 HTTP ${v2.status} · chaves raiz: ${chaves(jv)}`);
    const listas = jv && typeof jv === "object" ? Object.entries(jv).filter(([, v]) => Array.isArray(v)) : [];
    for (const [k, v] of listas) {
      console.log(`  lista ${k}: ${(v as unknown[]).length} · chaves do contrato: ${chaves((v as unknown[])[0])}`);
      mostrar(`ContratosV2.${k} amostra`, (v as unknown[]).slice(0, 2));
    }
    if (listas.length === 0) mostrar("ContratosV2 corpo", jv);
  }

  if (erpSource === "ixc") {
    const recebidas = await c.listWithFilter(config, "fn_areceber", [{ TB: "fn_areceber.status", OP: "=", P: "R", C: "AND", G: "" }], 2, 1);
    console.log(`\nfn_areceber status=R: ${recebidas.length} linha(s) · chaves: ${chaves(recebidas[0])}`);
    mostrar("fn_areceber status=R amostra", recebidas.slice(0, 2));
    const contratos = await c.listAll(config, "cliente_contrato", { qtype: "cliente_contrato.id", query: "0", oper: ">", sortname: "cliente_contrato.id", sortorder: "asc" }, 2, 1);
    console.log(`\ncliente_contrato: ${contratos.length} linha(s) · chaves: ${chaves(contratos[0])}`);
    mostrar("cliente_contrato amostra", contratos.slice(0, 2));
    // Um contrato cancelado/inativo, para ver as datas de fim preenchidas.
    const inativos = await c.listWithFilter(config, "cliente_contrato", [{ TB: "cliente_contrato.status", OP: "=", P: "I", C: "AND", G: "" }], 2, 1);
    console.log(`\ncliente_contrato status=I: ${inativos.length} linha(s)`);
    mostrar("cliente_contrato status=I amostra", inativos.slice(0, 2));
  }

  if (erpSource === "sgp") {
    const r1 = await c.post(config, "/api/ura/titulos/", { status: "pagos", limit: 2 }, { timeoutMs: 30000, retries: 1 });
    const j1: any = await c.lerJson(r1);
    console.log(`\ntitulos status=pagos HTTP ${r1.status} · chaves raiz: ${chaves(j1)} · total: ${j1?.paginacao?.total ?? "?"}`);
    if (j1?.titulos?.[0]) console.log(`  chaves do titulo: ${chaves(j1.titulos[0])}`);
    mostrar("titulos pagos amostra", j1?.titulos?.slice(0, 2) ?? j1);
    if (doc) {
      const r2 = await c.post(config, "/api/ura/consultacliente/", { cpfcnpj: doc }, { timeoutMs: 30000, retries: 1 });
      const j2: any = await c.lerJson(r2);
      console.log(`\nconsultacliente HTTP ${r2.status} · chaves raiz: ${chaves(j2)}`);
      if (j2?.contratos?.[0]) console.log(`  chaves do contrato: ${chaves(j2.contratos[0])}`);
      mostrar("consultacliente contratos amostra", j2?.contratos?.slice(0, 2) ?? j2);
    }
  }
  process.exit(0);
})().catch(e => { console.error("falhou:", e?.message ?? e); process.exit(1); });
