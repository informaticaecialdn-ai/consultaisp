/**
 * Sonda `WSMKConexoesPorCliente` no MK para descobrir COMO a instalacao se
 * identifica (login, MAC, IP, ONU) — o conector ja chama esse endpoint e hoje
 * le apenas `bloqueada`.
 *
 * Nao modifica nada: so GET + dump dos NOMES das chaves com amostras
 * MASCARADAS. Nunca imprime token, contra-senha, documento, nome, telefone ou
 * endereco; MAC sai com os 6 ultimos hex e IP com o ultimo octeto trocado por
 * `x`. Rode de dentro da VPS — o MK so responde do IP liberado.
 *
 * Uso (na VPS, em /var/www/consulta-isp):
 *   npx tsx script/probe-mk-conexoes.ts [providerId] [cd_cliente...]
 */
import "dotenv/config";
// Sai por IPv4 antes de qualquer rede: a VPS tem um IPv6 que nenhum parceiro
// libera na allowlist (custou 3 dias no SGP da Amplinet). Travado por
// script/rede-saida-nos-scripts.test.ts.
import { preferirIPv4NaSaida } from "../server/rede-saida";
preferirIPv4NaSaida();
import { storage } from "../server/storage";

const providerId = Number(process.argv[2] ?? 1);
const cdsArg = process.argv.slice(3).filter(Boolean);
const QUANTOS_CLIENTES = 3;

/** Chave cujo VALOR nunca pode sair no log. */
const SENSIVEL =
  /(nome|razao|fantasia|cpf|cnpj|doc|senha|password|pass|token|secret|email|mail|fone|telefone|celular|contato|endereco|logradouro|complement|cep|bairro|latitude|longitude)/i;

function mascararMac(v: string): string {
  const hex = v.replace(/[:.\-\s]/g, "");
  if (!/^[0-9a-f]{12}$/i.test(hex)) return v;
  return `**:**:**:${hex.slice(6, 8)}:${hex.slice(8, 10)}:${hex.slice(10, 12)}`.toUpperCase();
}

function mascararIp(v: string): string {
  return v.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, "$1.x");
}

/** Serial de ONU: 4 letras do fabricante + 8 hex, com sufixo de porta opcional. */
const FORMA_DE_SERIAL = /^[A-Z]{4}[0-9A-F]{8}(-\d{1,3})?$/i;

/**
 * O login e o campo mais delicado desta sonda: em ISP brasileiro o PPPoE e,
 * muitas vezes, o CPF do assinante — e foi por ele que o serial da ONU
 * apareceu (ALCLFCC84ABD-000). Sai so quando tem a forma de serial; qualquer
 * outra coisa vira contagem de caracteres.
 */
function amostraDeLogin(s: string): string {
  const v = s.trim();
  if (FORMA_DE_SERIAL.test(v)) return v.toUpperCase();
  return v === "" ? '""' : `«omitido:${v.length} chars, sem forma de serial»`;
}

function amostra(chave: string, valor: unknown): string {
  if (valor === null) return "null";
  if (valor === undefined) return "undefined";
  if (typeof valor === "boolean" || typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) return `array[${valor.length}]`;
  if (typeof valor === "object") return `objeto{${Object.keys(valor as object).join("|")}}`;
  const s = String(valor);
  if (/^(username|usuario|login|user|motivo_bloqueio|motivo)$/i.test(chave)) return amostraDeLogin(s);
  if (SENSIVEL.test(chave)) return s.trim() === "" ? '""' : `«omitido:${s.length} chars»`;
  if (/^[0-9a-f]{2}([:.\-][0-9a-f]{2}){5}$/i.test(s.trim()) || /^[0-9a-f]{12}$/i.test(s.trim())) {
    return mascararMac(s.trim());
  }
  if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(s)) return mascararIp(s);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

function descrever(rotulo: string, item: unknown): void {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    console.log(`  ${rotulo}: ${amostra(rotulo, item)}`);
    return;
  }
  console.log(`  ${rotulo}:`);
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    console.log(`    ${k} = ${amostra(k, v)}`);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        console.log(`      ${k}.${k2} = ${amostra(k2, v2)}`);
      }
    }
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0]) {
      for (const [k2, v2] of Object.entries(v[0] as Record<string, unknown>)) {
        console.log(`      ${k}[0].${k2} = ${amostra(k2, v2)}`);
      }
    }
  }
}

async function autenticar(base: string, token: string, contraSenha: string): Promise<string> {
  const url = `${base}/mk/WSAutenticacao.rule?sys=MK0&token=${encodeURIComponent(token)}&password=${encodeURIComponent(contraSenha)}&cd_servico=9999`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Autenticacao HTTP ${r.status}`);
  const j: any = await r.json();
  const t = j?.tokenRetornoAutenticacao || j?.token_acesso || j?.Token || j?.access_token;
  if (!t) throw new Error(`Autenticacao sem token. Chaves: ${Object.keys(j ?? {}).join(", ")}`);
  return t;
}

(async () => {
  const integracoes = await storage.getErpIntegrations(providerId);
  const intg = integracoes.find((i: any) => i.erpSource === "mk");
  if (!intg?.apiUrl || !intg?.apiToken) {
    console.error(`Provedor ${providerId} sem MK configurado`);
    process.exit(1);
  }
  const base = String(intg.apiUrl).replace(/\/+$/, "").replace(/\/mk$/i, "");
  const tokenAuth = await autenticar(base, intg.apiToken, (intg as any).mkContraSenha || intg.apiUser || "");
  console.log(`Autenticado no MK do provedor ${providerId}.`);

  const conexoesDe = (j: any): unknown[] | null => {
    const c = Array.isArray(j) ? j : (j?.Conexoes ?? j?.conexoes ?? j?.registros ?? j?.data);
    return Array.isArray(c) ? c : null;
  };
  const urlConexoes = (cd: string) =>
    `${base}/mk/WSMKConexoesPorCliente.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&cd_cliente=${encodeURIComponent(cd)}`;

  let cds = cdsArg;
  if (cds.length === 0) {
    const r = await fetch(
      `${base}/mk/WSMKConsultaClientes.rule?sys=MK0&token=${encodeURIComponent(tokenAuth)}&data_alteracao_inicio=01/01/2020`,
      { signal: AbortSignal.timeout(60000) },
    );
    const j: any = await r.json().catch(() => null);
    const lista: any[] = Array.isArray(j) ? j : (j?.Clientes ?? j?.clientes ?? j?.registros ?? j?.data ?? []);
    console.log(`WSMKConsultaClientes devolveu ${lista.length} cadastros.`);
    // Cadastro ativo nem sempre tem conexao cadastrada: varre ate achar os que
    // TEM, senao a sonda so mostra `Conexoes: array[0]` e nao ensina nada.
    const candidatos = lista
      .filter((c) => String(c?.Situacao ?? c?.situacao ?? "").toLowerCase().includes("ativ"))
      .map((c) => String(c?.CodigoPessoa ?? c?.codigopessoa ?? c?.cd_cliente ?? ""))
      .filter(Boolean);
    let vazios = 0;
    for (const cd of candidatos.slice(0, 200)) {
      if (cds.length >= QUANTOS_CLIENTES) break;
      try {
        const resp = await fetch(urlConexoes(cd), { signal: AbortSignal.timeout(20000) });
        if (!resp.ok) continue;
        const corpo: any = await resp.json().catch(() => null);
        const cx = conexoesDe(corpo);
        if (cx && cx.length > 0) cds.push(cd);
        else vazios++;
      } catch {
        /* segue */
      }
    }
    console.log(`Varredura: ${cds.length} cadastro(s) com conexao, ${vazios} sem nenhuma.`);
  }
  if (cds.length === 0) {
    console.error("Nenhum cd_cliente ativo para sondar");
    process.exit(1);
  }

  for (const cd of cds) {
    console.log(`\n===== WSMKConexoesPorCliente cd_cliente=${cd} =====`);
    try {
      const r = await fetch(urlConexoes(cd), { signal: AbortSignal.timeout(20000) });
      console.log(`HTTP ${r.status}`);
      const bruto = await r.text();
      let j: any;
      try {
        j = JSON.parse(bruto);
      } catch {
        console.log(`Resposta nao-JSON (${bruto.length} chars): ${bruto.slice(0, 120)}`);
        continue;
      }
      if (Array.isArray(j)) {
        console.log(`Topo: array[${j.length}]`);
        if (j[0]) descrever("[0]", j[0]);
        continue;
      }
      console.log(`Topo: objeto com chaves: ${Object.keys(j ?? {}).join(", ")}`);
      for (const [k, v] of Object.entries(j ?? {})) {
        if (Array.isArray(v)) {
          console.log(`  ${k}: array[${v.length}]`);
          if (v[0]) descrever(`${k}[0]`, v[0]);
          if (v[1]) descrever(`${k}[1]`, v[1]);
        } else {
          console.log(`  ${k} = ${amostra(k, v)}`);
        }
      }
    } catch (err) {
      console.log(`ERRO: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log("\n=== fim da sonda ===");
  process.exit(0);
})();
