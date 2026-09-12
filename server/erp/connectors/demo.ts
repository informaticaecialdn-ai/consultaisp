/**
 * ERP Connector — Demonstracao
 *
 * Nao fala com nenhum ERP de verdade: le direto as tabelas `customers`,
 * `invoices` e `equipment` que `server/demo/mundo-base.ts` semeou para os
 * cinco provedores ficticios da demonstracao publica.
 *
 * Existe porque toda consulta deste produto e SEMPRE AO VIVO —
 * `queryRegionalErps` varre o ERP de cada provedor da rede, nunca a base
 * local (ver `server/services/realtime-query.service.ts`). Sem um "ERP" que
 * responda pelos provedores ficticios, toda consulta na demonstracao
 * devolveria "nada consta" e a tela principal do produto nao demonstraria
 * nada. Este conector faz o papel do ERP, para que a consulta continue
 * passando pelo caminho REAL (varredura, mascaramento LGPD, score, debito de
 * credito) — so a origem do dado muda.
 *
 * So ENTRA NO REGISTRY quando `emModoDemo()` — a linha de baixo deste arquivo
 * decide, e nao `server/erp/index.ts`. Em producao nenhum provedor real pode
 * configurar um "ERP" que le a propria base do Consulta ISP e responde como
 * se fosse o ERP dele. O import deste arquivo pelo barril e SEMPRE
 * incondicional (como qualquer outro conector autorregistravel): so a
 * classe e definida, sem efeito colateral fora do registro — um
 * `await import()` dinamico condicionado no barril quebraria o build de
 * producao (`script/build.ts` empacota o backend com esbuild
 * `format: "cjs"`, que nao aceita top-level await). A condicao mora aqui
 * porque e aqui que o efeito colateral (`registerConnector`) acontece.
 *
 * A identidade do provedor a servir vem de `config.extra.providerId` — a
 * MESMA convencao que o rate limiter e os seis conectores reais ja usam
 * (`config.extra?.providerId`, ver `server/erp/connectors/{ixc,mk,sgp,
 * hubsoft,voalle,rbx}.ts`), gravada por quem monta o config a partir da linha
 * de `erp_integrations` (`realtime-query.service.ts`, `chat-contexto.service.ts`,
 * `snapshot-ao-vivo.service.ts`). `ErpConnectionConfig` nao tem um campo
 * `providerId` de primeira classe — so existe dentro de `extra`. Sem ele,
 * nenhum metodo deste conector le nada: nao ha fallback para "provedor
 * default" nem busca por `apiUrl` (que aqui e sempre vazio — a demo nao tem
 * credencial). Inventar qualquer um dos dois faria a demonstracao responder
 * com a carteira de OUTRO provedor.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, invoices, equipment } from "@shared/schema";
import type { Customer } from "@shared/schema";
import { emModoDemo } from "../../demo/modo-demo";
import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
  NormalizedErpCustomer,
  FaturaAbertaDoErp,
} from "../types.js";
import { cleanCpfCnpj, calculateDaysOverdue, vencimentoIso } from "../normalize.js";
import { registerConnector } from "../registry.js";
import { FONTE_ERP_DEMO } from "../fonte-demo.js";

type EquipamentoNormalizado = NonNullable<NormalizedErpCustomer["equipmentDetails"]>[number];

/**
 * `config.extra.providerId` -> numero, ou `null` quando ausente/invalido.
 *
 * Nunca inventa um provedor: `null` faz todo metodo publico recusar antes de
 * tocar no banco, em vez de supor "o primeiro provedor" ou ler por `apiUrl`
 * (que na demo e sempre vazio).
 */
function resolverProviderId(config: ErpConnectionConfig): number | null {
  const bruto = config.extra?.providerId;
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function semProviderId(): ErpFetchResult {
  return {
    ok: false,
    message: "Conector demo sem providerId em config.extra — impossivel saber de qual provedor ler",
    customers: [],
  };
}

/**
 * As faturas ABERTAS (status "overdue") de todos os clientes do provedor,
 * agrupadas por `customerId` — uma consulta so, e nao uma por cliente.
 *
 * `totalOverdueAmount`/`maxDaysOverdue` do cliente normalizado saem DESTA
 * lista (soma e maior atraso), nunca das colunas agregadas de `customers`:
 * e o que faz o valor e o dia baterem com a fatura de verdade.
 */
async function faturasAbertasPorCliente(providerId: number): Promise<Map<number, FaturaAbertaDoErp[]>> {
  const linhas = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.providerId, providerId), eq(invoices.status, "overdue")));

  const mapa = new Map<number, FaturaAbertaDoErp[]>();
  for (const fatura of linhas) {
    const lista = mapa.get(fatura.customerId) ?? [];
    lista.push({
      ref: String(fatura.id),
      vencimento: vencimentoIso(fatura.dueDate) ?? "",
      valor: Number(fatura.value),
      descricao: fatura.descricao ?? undefined,
    });
    mapa.set(fatura.customerId, lista);
  }
  return mapa;
}

/** O comodato de todos os clientes do provedor, agrupado por `customerId`. */
async function equipamentosPorCliente(providerId: number): Promise<Map<number, EquipamentoNormalizado[]>> {
  const linhas = await db.select().from(equipment).where(eq(equipment.providerId, providerId));

  const mapa = new Map<number, EquipamentoNormalizado[]>();
  for (const item of linhas) {
    if (item.customerId === null) continue;
    const lista = mapa.get(item.customerId) ?? [];
    lista.push({
      type: item.type,
      brand: item.brand ?? "",
      model: item.model ?? "",
      serialNumber: item.serialNumber ?? "",
      mac: item.mac ?? undefined,
      value: item.value ?? "290.00",
      // Todo status seedado por mundo-base.ts (retido, retirada_pendente,
      // nao_localizado, em_cobranca, not_returned) e "nao devolvido" — nenhum
      // representa equipamento ja recuperado. "em_cobranca" e o unico que
      // tambem marca o processo de recuperacao em curso, no mesmo sentido que
      // os conectores reais usam para este campo (ver ixc.ts, rbx.ts).
      inRecoveryProcess: item.status === "em_cobranca",
    });
    mapa.set(item.customerId, lista);
  }
  return mapa;
}

function paraClienteNormalizado(
  cliente: Customer,
  faturas: FaturaAbertaDoErp[] | undefined,
  equipamentos: EquipamentoNormalizado[] | undefined,
): NormalizedErpCustomer {
  const abertas = faturas ?? [];
  const totalOverdueAmount = abertas.reduce((soma, f) => soma + f.valor, 0);
  const maxDaysOverdue = abertas.reduce((max, f) => Math.max(max, calculateDaysOverdue(f.vencimento)), 0);
  const temEquipamento = (equipamentos?.length ?? 0) > 0;

  return {
    cpfCnpj: cliente.cpfCnpj,
    name: cliente.name,
    email: cliente.email ?? undefined,
    phone: cliente.phone ?? undefined,
    address: cliente.address ?? undefined,
    addressNumber: cliente.addressNumber ?? undefined,
    complement: cliente.complement ?? undefined,
    neighborhood: cliente.neighborhood ?? undefined,
    city: cliente.city ?? undefined,
    state: cliente.state ?? undefined,
    cep: cliente.cep ?? undefined,
    latitude: cliente.latitude ?? undefined,
    longitude: cliente.longitude ?? undefined,
    totalOverdueAmount,
    maxDaysOverdue,
    overdueInvoicesCount: abertas.length,
    // Presente (mesmo vazio) para quem tem 0 faturas em aberto: este conector
    // SEMPRE le fatura a fatura. Ausente so quando o cliente nem aparece no
    // mapa — o que aqui nunca acontece, pois o mapa cobre o provedor inteiro.
    faturasAbertas: faturas ?? [],
    hasUnreturnedEquipment: temEquipamento,
    unreturnedEquipmentCount: equipamentos?.length ?? 0,
    equipmentDetails: temEquipamento ? equipamentos : undefined,
    contractStatus: cliente.status === "cancelled" ? "cancelled" : cliente.status === "active" ? "active" : undefined,
    // Sem estes dois o anti-fraude (contrato_novo) e a Economia do 360 nao tem
    // como ler tempo de casa nem plano na demonstracao — ver ixc.ts/sgp.ts para
    // o mesmo par nos conectores reais. `cliente` e uma linha tipada do Drizzle
    // (nunca ""), entao `??` basta: sem inventar data nem string vazia.
    contractPlan: cliente.contractPlan ?? undefined,
    contractStartDate: cliente.contractStartDate ?? undefined,
    erpSource: FONTE_ERP_DEMO,
  };
}

class DemoConnector implements ErpConnector {
  readonly name = FONTE_ERP_DEMO;
  readonly label = "Demonstracao";

  /** Nada a configurar: a demo nao tem credencial, so providerId (via extra). */
  readonly configFields: ErpConfigField[] = [];

  readonly supportsEquipment = true;

  async testConnection(config: ErpConnectionConfig): Promise<ErpTestResult> {
    const providerId = resolverProviderId(config);
    if (providerId === null) {
      return { ok: false, message: "Conector demo sem providerId em config.extra" };
    }
    return { ok: true, message: "Conector de demonstracao — le a base semeada localmente, sem chamada externa" };
  }

  async fetchDelinquents(config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    return this.buscarClientes(config, { apenasInadimplentes: true });
  }

  async fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult> {
    return this.buscarClientes(config, { apenasInadimplentes: false });
  }

  async fetchCustomerByCpf(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult> {
    const providerId = resolverProviderId(config);
    if (providerId === null) return semProviderId();

    const documento = cleanCpfCnpj(cpfCnpj);
    if (!documento) {
      return { ok: true, message: "Documento invalido — nada consta na base de demonstracao", customers: [] };
    }

    const linhas = await db
      .select()
      .from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.cpfCnpj, documento)));

    // Ausencia e resposta, nao erro: o CPF so nao e cliente deste provedor.
    if (linhas.length === 0) {
      return { ok: true, message: "CPF/CNPJ nao encontrado na base de demonstracao", customers: [] };
    }

    const cliente = linhas[0];
    const [faturas, equipamentos] = await Promise.all([
      faturasAbertasPorCliente(providerId),
      equipamentosPorCliente(providerId),
    ]);

    return {
      ok: true,
      message: "Cliente encontrado na base de demonstracao",
      customers: [paraClienteNormalizado(cliente, faturas.get(cliente.id), equipamentos.get(cliente.id))],
    };
  }

  private async buscarClientes(
    config: ErpConnectionConfig,
    opcoes: { apenasInadimplentes: boolean },
  ): Promise<ErpFetchResult> {
    const providerId = resolverProviderId(config);
    if (providerId === null) return semProviderId();

    const condicao = opcoes.apenasInadimplentes
      ? and(eq(customers.providerId, providerId), eq(customers.paymentStatus, "overdue"))
      : eq(customers.providerId, providerId);
    const linhasClientes = await db.select().from(customers).where(condicao);

    if (linhasClientes.length === 0) {
      return { ok: true, message: "Nenhum cliente na base de demonstracao para este provedor", customers: [] };
    }

    const [faturas, equipamentos] = await Promise.all([
      faturasAbertasPorCliente(providerId),
      equipamentosPorCliente(providerId),
    ]);

    return {
      ok: true,
      message: `${linhasClientes.length} cliente(s) lidos da base de demonstracao`,
      customers: linhasClientes.map((cliente) =>
        paraClienteNormalizado(cliente, faturas.get(cliente.id), equipamentos.get(cliente.id)),
      ),
    };
  }
}

const demoConnector = new DemoConnector();

// A UNICA linha condicional deste arquivo — de proposito, ver o comentario no
// topo. Fora do modo demo, `demoConnector` existe em memoria (a classe foi
// carregada, como qualquer outro conector do barril) mas nunca chega ao
// registry: `getConnector("demo")` continua `undefined`, e nenhum provedor
// real consegue selecionar, configurar ou sincronizar por ele.
if (emModoDemo()) {
  registerConnector(demoConnector);
}

export { DemoConnector };
export default demoConnector;
