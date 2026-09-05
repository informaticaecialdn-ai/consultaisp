/**
 * O snapshot AO VIVO do cliente no ERP do próprio provedor — para a ficha 360.
 *
 * A base sincronizada (`customers`) guarda agregados: dívida, dias, faturas
 * abertas, status. O que a ficha do Provedor.ai mostra e o sync NÃO grava —
 * plano contratado, data do contrato quando a varredura ainda não passou,
 * motivo do corte, os aparelhos com MAC e série — o ERP responde numa
 * requisição por CPF (`fetchCustomerByCpf`), a mesma que a consulta ao vivo
 * usa. Aqui ela é feita para UM cliente, só no ERP do dono, quando a ficha
 * abre.
 *
 * Cache curto em memória por provedor+documento: a ficha é reaberta muitas
 * vezes no mesmo atendimento e o ERP do provedor não pode pagar uma chamada
 * por clique. Falha também entra no cache, por menos tempo, para um ERP fora
 * do ar não virar uma chamada por abertura de tela.
 *
 * Nada daqui é gravado em `customers`: quem escreve a base é o sync, com a
 * trava de leitura parcial. Este serviço só LÊ e mostra — integridade do
 * dado é regra da casa.
 */
import { buildConnectorConfig, getConnector } from "../../erp";
import { logger } from "../../logger";
import { storage } from "../../storage";

export const TTL_SNAPSHOT_OK_MS = 10 * 60_000;
export const TTL_SNAPSHOT_FALHA_MS = 60_000;
export const TIMEOUT_SNAPSHOT_MS = 20_000;

export interface EquipamentoAoVivo {
  tipo: string | null;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  mac: string | null;
  valor: number | null;
  emRecuperacao: boolean;
}

export interface ClienteAoVivo {
  nome: string | null;
  plano: string | null;
  statusContrato: "active" | "cancelled" | "suspended" | null;
  motivoCorte: string | null;
  cortadoEm: string | null;
  contractStartDate: string | null;
  dividaAtual: number;
  diasAtraso: number;
  faturasAbertas: number | null;
  telefone: string | null;
  email: string | null;
  equipamentos: EquipamentoAoVivo[];
}

export interface SnapshotAoVivo {
  ok: boolean;
  /** Qual ERP respondeu (ou tentou). `null` = o provedor não tem integração que sirva. */
  erpSource: string | null;
  /** `true` quando o ERP respondeu e o documento estava lá. */
  encontrado: boolean;
  cliente: ClienteAoVivo | null;
  erro: string | null;
  latenciaMs: number;
  lidoEm: string;
  doCache: boolean;
}

interface Guardado { snapshot: SnapshotAoVivo; ate: number }
const cache = new Map<string, Guardado>();

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Só para os testes: o cache é de módulo. */
export function _limparCacheDoSnapshotParaTestes(): void {
  cache.clear();
}

function semIntegracao(erro: string, inicio: number, agora: () => number): SnapshotAoVivo {
  return { ok: false, erpSource: null, encontrado: false, cliente: null, erro, latenciaMs: agora() - inicio, lidoEm: new Date(agora()).toISOString(), doCache: false };
}

/**
 * Lê o cliente no ERP do provedor. Nunca lança: ERP fora do ar, credencial
 * ausente ou conector que não sabe buscar por CPF voltam como `ok: false`
 * com o motivo em português — a ficha mostra o que tem e diz por que o
 * resto não veio.
 */
export async function snapshotAoVivoDoCliente(
  providerId: number,
  cpfCnpj: string,
  opcoes: { forcar?: boolean; agora?: () => number } = {},
): Promise<SnapshotAoVivo> {
  const agora = opcoes.agora ?? Date.now;
  const inicio = agora();
  const doc = digitos(cpfCnpj);
  if (doc.length < 11) return semIntegracao("Documento do cliente incompleto na base", inicio, agora);

  const chave = `${providerId}:${doc}`;
  const guardado = cache.get(chave);
  if (!opcoes.forcar && guardado && guardado.ate > inicio) {
    return { ...guardado.snapshot, doCache: true };
  }

  let integracoes;
  try {
    integracoes = await storage.getErpIntegrations(providerId);
  } catch (err) {
    logger.warn({ err, providerId }, "Snapshot ao vivo: não foi possível ler a integração do provedor");
    return semIntegracao("Não foi possível ler a integração do ERP", inicio, agora);
  }

  const util = integracoes.find(i => {
    if (!i.isEnabled || !i.apiUrl || !i.apiToken) return false;
    const c = getConnector(i.erpSource);
    return !!c && !c.naoImplementado && typeof c.fetchCustomerByCpf === "function";
  });
  if (!util) {
    const ligada = integracoes.find(i => i.isEnabled && i.apiUrl && i.apiToken);
    return semIntegracao(
      ligada ? `O conector ${ligada.erpSource} não busca cliente por documento` : "Sem integração de ERP ligada para este provedor",
      inicio,
      agora,
    );
  }

  const conector = getConnector(util.erpSource)!;
  let snapshot: SnapshotAoVivo;
  try {
    const apiUrl = (util.apiUrl || "").replace(/\/+$/, "");
    const config = buildConnectorConfig({ ...util, apiUrl });
    // O rate limiter e alguns conectores leem o provedor de dentro do extra —
    // o mesmo que a consulta ao vivo faz.
    config.extra = { ...config.extra, providerId: String(providerId) };

    const resultado = await Promise.race([
      conector.fetchCustomerByCpf!(config, doc),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), TIMEOUT_SNAPSHOT_MS)),
    ]);

    if (!resultado.ok) {
      snapshot = { ok: false, erpSource: util.erpSource, encontrado: false, cliente: null, erro: resultado.message || "O ERP recusou a consulta", latenciaMs: agora() - inicio, lidoEm: new Date(agora()).toISOString(), doCache: false };
    } else {
      const achado = resultado.customers.find(c => digitos(c.cpfCnpj) === doc) ?? null;
      snapshot = {
        ok: true,
        erpSource: util.erpSource,
        encontrado: achado !== null,
        cliente: achado
          ? {
              nome: texto(achado.name),
              plano: texto(achado.contractPlan),
              statusContrato: achado.contractStatus ?? null,
              motivoCorte: texto(achado.motivoCorte),
              cortadoEm: texto(achado.cortadoEm),
              contractStartDate: texto(achado.contractStartDate),
              dividaAtual: numero(achado.totalOverdueAmount) ?? 0,
              diasAtraso: numero(achado.maxDaysOverdue) ?? 0,
              faturasAbertas: numero(achado.overdueInvoicesCount),
              telefone: texto(achado.phone),
              email: texto(achado.email),
              equipamentos: (achado.equipmentDetails ?? []).map(e => ({
                tipo: texto(e.type),
                marca: texto(e.brand),
                modelo: texto(e.model),
                serie: texto(e.serialNumber),
                mac: texto(e.mac),
                valor: numero(e.value),
                emRecuperacao: e.inRecoveryProcess === true,
              })),
            }
          : null,
        erro: null,
        latenciaMs: agora() - inicio,
        lidoEm: new Date(agora()).toISOString(),
        doCache: false,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const timeout = msg === "Timeout" || /timeout/i.test(msg);
    logger.warn({ providerId, erpSource: util.erpSource, doc: doc.slice(0, 4) + "***", error: msg }, "Snapshot ao vivo: ERP falhou");
    snapshot = { ok: false, erpSource: util.erpSource, encontrado: false, cliente: null, erro: timeout ? `O ERP não respondeu em ${TIMEOUT_SNAPSHOT_MS / 1000}s` : msg, latenciaMs: agora() - inicio, lidoEm: new Date(agora()).toISOString(), doCache: false };
  }

  cache.set(chave, { snapshot, ate: agora() + (snapshot.ok ? TTL_SNAPSHOT_OK_MS : TTL_SNAPSHOT_FALHA_MS) });
  return snapshot;
}
