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
  const url = `${base}/mk/WSAutenticacao.rule?sys=MK0&token=${encodeURIComponent(token)}&password=${encodeURIComponent(password)}&cd_servico=9999`;
  const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Auth HTTP ${r.status}`);
  const j: any = await r.json();
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
    `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&data_alteracao_inicio=01/01/2024`,
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

  // === 2. WSMKFaturasPendentes — faturas em aberto deste cliente (provavelmente tem datas) ===
  await probe(
    "WSMKFaturasPendentes (faturas pendentes do cliente — esperando ter dt_vencimento)",
    `${base}/mk/WSMKFaturasPendentes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 3. WSMKFaturas — todas faturas do cliente (histórico) ===
  await probe(
    "WSMKFaturas (todas faturas — histórico completo)",
    `${base}/mk/WSMKFaturas.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 4. WSMKContratosPorCliente — contratos deste cliente (pra status ativo/cancelado) ===
  await probe(
    "WSMKContratosPorCliente (contratos do cliente — status, vigência)",
    `${base}/mk/WSMKContratosPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 5. WSMKConsultaCliente (singular) — detalhe completo do cliente ===
  await probe(
    "WSMKConsultaCliente (singular — detalhe completo cliente, talvez tenha contratos inline)",
    `${base}/mk/WSMKConsultaCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  // === 6. WSMKConexoesPorCliente — status técnico de conexão ===
  await probe(
    "WSMKConexoesPorCliente (status conexao — bloqueada, ativa)",
    `${base}/mk/WSMKConexoesPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cdPessoa)}`,
  );

  console.log(`\n\n=== Probe completo ===\n`);
  process.exit(0);
})();
