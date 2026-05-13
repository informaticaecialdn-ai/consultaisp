/**
 * Sonda endpoints do MK pra descobrir shape das respostas.
 * Não modifica nada. Só faz GET + dump JSON.
 *
 * Uso (na VPS, em /var/www/consulta-isp):
 *   npx tsx script/probe-mk-endpoints.ts <providerId> [cd_pessoa_exemplo]
 *
 * Se não passar cd_pessoa, usa o primeiro cliente retornado por
 * WSMKConsultaClientes. cd_pessoa específico ajuda a achar um cliente
 * que você sabe que está ATIVO + INADIMPLENTE de verdade (não cancelado).
 */
import "dotenv/config";
import { storage } from "../server/storage";

const providerId = Number(process.argv[2] ?? 1);
const cdPessoaArg = process.argv[3];

async function authenticate(base: string, token: string, password: string): Promise<string> {
  const url = `${base}/WSAutenticacao.rule?sys=MK0&token=${encodeURIComponent(token)}&password=${encodeURIComponent(password)}&cd_servico=9999`;
  console.log(`Auth URL: ${url.replace(/token=[^&]+/, "token=***").replace(/password=[^&]+/, "password=***")}`);
  const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
  const bodyText = await r.text();
  console.log(`Auth HTTP: ${r.status}, body: ${bodyText.slice(0, 400)}`);
  if (!r.ok) throw new Error(`Auth HTTP ${r.status}`);
  let j: any;
  try { j = JSON.parse(bodyText); } catch { throw new Error(`Auth retornou non-JSON: ${bodyText.slice(0, 200)}`); }
  const tokenAcesso = j.tokenRetornoAutenticacao || j.token_acesso || j.Token || j.token;
  if (!tokenAcesso) throw new Error(`Auth sem token. Resposta: ${JSON.stringify(j).slice(0, 300)}`);
  return tokenAcesso;
}

async function probe(label: string, url: string): Promise<any> {
  console.log(`\n\n========== ${label} ==========`);
  console.log(`URL: ${url.replace(/token=[^&]+/, "token=***")}`);
  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20000) });
    console.log(`HTTP: ${r.status}`);
    if (!r.ok) {
      console.log(`Body: ${(await r.text()).slice(0, 500)}`);
      return null;
    }
    const j: any = await r.json();
    if (Array.isArray(j)) {
      console.log(`Tipo: array com ${j.length} items`);
      if (j.length > 0) {
        console.log(`Campos do primeiro item: ${Object.keys(j[0]).join(", ")}`);
        console.log(`Primeiro item JSON:\n${JSON.stringify(j[0], null, 2).slice(0, 1500)}`);
        if (j.length > 1) {
          console.log(`\nSegundo item JSON:\n${JSON.stringify(j[1], null, 2).slice(0, 800)}`);
        }
      }
    } else if (typeof j === "object" && j !== null) {
      console.log(`Tipo: object com chaves: ${Object.keys(j).join(", ")}`);
      // Procurar primeiro array nas chaves
      for (const k of Object.keys(j)) {
        if (Array.isArray(j[k]) && j[k].length > 0) {
          console.log(`\nChave "${k}" é array com ${j[k].length} items.`);
          console.log(`Campos do primeiro: ${Object.keys(j[k][0]).join(", ")}`);
          console.log(`Primeiro JSON:\n${JSON.stringify(j[k][0], null, 2).slice(0, 1500)}`);
          break;
        }
      }
      console.log(`\nResponse top-level JSON:\n${JSON.stringify(j, null, 2).slice(0, 800)}`);
    } else {
      console.log(`Tipo: ${typeof j}, valor: ${JSON.stringify(j).slice(0, 300)}`);
    }
    return j;
  } catch (err) {
    console.log(`ERRO: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

(async () => {
  console.log(`\n=== Probe MK para provider ${providerId} ===\n`);

  const integrations = await storage.getErpIntegrations(providerId);
  const intg = integrations.find(i => i.erpSource === "mk");
  if (!intg?.apiUrl || !intg?.apiToken) {
    console.error("MK não configurado");
    process.exit(1);
  }

  const password = (intg as any).mkContraSenha || intg.apiUser || "";
  const tokenAuth = await authenticate(intg.apiUrl, intg.apiToken, password);
  const base = intg.apiUrl;
  console.log(`Autenticado, token: ${tokenAuth.slice(0, 20)}...`);

  // === 1. WSMKConsultaClientes — listar 1 cliente (limit via filtro de data) ===
  const clienteResp = await probe(
    "WSMKConsultaClientes (busca clientes para encontrar 1 ativo inadimplente)",
    `${base}/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&data_alteracao_inicio=01/01/2024`,
  );

  // Pega cd_pessoa pra usar nos próximos probes
  let cdPessoa = cdPessoaArg;
  if (!cdPessoa && clienteResp) {
    const list = Array.isArray(clienteResp)
      ? clienteResp
      : (clienteResp?.Clientes || clienteResp?.clientes || clienteResp?.registros || clienteResp?.data || []);
    // Procura primeiro cliente com Situacao "Ativo"
    const ativo = list.find((c: any) => String(c.Situacao || c.situacao || "").toLowerCase().includes("ativ"));
    cdPessoa = String(ativo?.CodigoPessoa ?? ativo?.codigopessoa ?? list[0]?.CodigoPessoa ?? "");
    console.log(`\n>>> Usando cd_pessoa=${cdPessoa} para próximas chamadas (Situacao=${ativo?.Situacao ?? "?"})`);
  }

  if (!cdPessoa) {
    console.error("Sem cd_pessoa pra continuar");
    process.exit(1);
  }

  // === 2a. WSMKFaturasPendentes — primeiro tenta o cliente atual ===
  await probe(
    "WSMKFaturasPendentes (cliente atual — pode estar vazio se Ativo em dia)",
    `${base}/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 2b. Varre clientes até achar 1 com FaturasPendentes != [] (inadimplente real) ===
  console.log(`\n>>> Varrendo clientes para achar 1 inadimplente real (FaturasPendentes != [])...`);
  const list = Array.isArray(clienteResp)
    ? clienteResp
    : (clienteResp?.Clientes || clienteResp?.clientes || clienteResp?.registros || clienteResp?.data || []);

  let inadimplenteCd: string | null = null;
  let inadimplenteFaturas: any[] = [];
  for (let i = 0; i < Math.min(50, list.length); i++) {
    const c = list[i];
    const cd = String(c.CodigoPessoa ?? c.codigopessoa ?? "");
    if (!cd) continue;
    try {
      const r = await fetch(
        `${base}/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cd)}`,
        { method: "GET", signal: AbortSignal.timeout(10000) },
      );
      if (!r.ok) continue;
      const j: any = await r.json();
      const faturas = j?.FaturasPendentes ?? j?.faturas_pendentes ?? [];
      if (Array.isArray(faturas) && faturas.length > 0) {
        inadimplenteCd = cd;
        inadimplenteFaturas = faturas;
        console.log(`>>> Achou inadimplente real: cd_pessoa=${cd}, Nome=${c.Nome ?? "?"}, ${faturas.length} fatura(s) pendente(s)`);
        break;
      }
    } catch {}
  }

  if (inadimplenteCd) {
    console.log(`\n========== FATURA PENDENTE REAL (shape com dado dentro) ==========`);
    console.log(`Cliente: cd_pessoa=${inadimplenteCd}`);
    console.log(`Total faturas pendentes: ${inadimplenteFaturas.length}`);
    console.log(`Campos da primeira fatura: ${Object.keys(inadimplenteFaturas[0]).join(", ")}`);
    console.log(`Primeira fatura JSON:\n${JSON.stringify(inadimplenteFaturas[0], null, 2)}`);
    if (inadimplenteFaturas.length > 1) {
      console.log(`\nSegunda fatura JSON:\n${JSON.stringify(inadimplenteFaturas[1], null, 2)}`);
    }

    // Também dumpa contratos desse cliente inadimplente (pra ver shape real)
    await probe(
      `WSMKContratosPorCliente (cliente INADIMPLENTE cd=${inadimplenteCd})`,
      `${base}/WSMKContratosPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(inadimplenteCd)}`,
    );
  } else {
    console.log(`>>> Nenhum cliente com FaturasPendentes nos primeiros 50. Estranho — talvez precise filtrar por Situacao=Inadimplente`);
  }

  // === 3. WSMKFaturas — todas faturas do cliente (histórico) ===
  await probe(
    "WSMKFaturas (todas faturas — histórico completo)",
    `${base}/WSMKFaturas.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 4. WSMKContratosPorCliente — contratos deste cliente (pra status ativo/cancelado) ===
  await probe(
    "WSMKContratosPorCliente (contratos do cliente — status, vigência)",
    `${base}/WSMKContratosPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 5. WSMKConsultaCliente (singular) — detalhe completo do cliente ===
  await probe(
    "WSMKConsultaCliente (singular — detalhe completo cliente, talvez tenha contratos inline)",
    `${base}/WSMKConsultaCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 6. WSMKConexoesPorCliente — status técnico de conexão ===
  await probe(
    "WSMKConexoesPorCliente (status conexao — bloqueada, ativa)",
    `${base}/WSMKConexoesPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  console.log(`\n\n=== Probe completo ===\n`);
  process.exit(0);
})();
