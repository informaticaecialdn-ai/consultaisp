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
import { equipamentoTemRetiradaPendente } from "../../services/equipment-recovery-rules";
import { normalizarMac, type AutenticacaoCliente } from "@shared/equipamentos/identificacao";
import { normalizarPagamento, type PagamentoDoChat } from "@shared/cobranca/pagamento-chat";
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
type LinhaDeEquipamento = typeof equipment.$inferSelect;

/**
 * Status de `invoices` que ainda são fatura A PAGAR — a mesma lista que
 * `contextoFinanceiroDoChat` (server/storage/chat-bullq.storage.ts) usa para
 * montar as faturas do painel do chat. Segunda via de fatura paga ou baixada
 * não existe.
 */
const STATUS_DE_FATURA_ABERTA = new Set(["aberta", "pending", "overdue"]);

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

/** Uma linha de `invoices` -> o formato de fatura aberta que o restante do arquivo consome. */
function paraFaturaAberta(fatura: typeof invoices.$inferSelect): FaturaAbertaDoErp {
  return {
    ref: String(fatura.id),
    vencimento: vencimentoIso(fatura.dueDate) ?? "",
    valor: Number(fatura.value),
    descricao: fatura.descricao ?? undefined,
  };
}

/**
 * Uma linha de `equipment` -> o formato normalizado que o restante do arquivo consome.
 *
 * `equipmentDetails` e o INVENTARIO do cliente, nao a lista de pendencias: a
 * base semeada tem ONU `em_comodato` (instalada, funcionando), `retirada_pendente`
 * e as ja resolvidas (`recuperado_triagem`, `baixado`). Quem diz o que esta
 * pendente e `hasUnreturnedEquipment`, em `paraClienteNormalizado`.
 *
 * `inRecoveryProcess` segue a coluna que a recuperacao grava
 * (`equipment.in_recovery_process`, ligada pelo sandbox nas recuperacoes
 * ABERTAS); `em_cobranca` continua contando porque e o status legado que ja
 * nasce em recuperacao, no mesmo sentido dos conectores reais (ixc.ts, rbx.ts).
 */
function paraEquipamentoNormalizado(item: LinhaDeEquipamento): EquipamentoNormalizado {
  return {
    type: item.type,
    brand: item.brand ?? "",
    model: item.model ?? "",
    serialNumber: item.serialNumber ?? "",
    mac: item.mac ?? undefined,
    value: item.value ?? "290.00",
    inRecoveryProcess: item.inRecoveryProcess === true || item.status === "em_cobranca",
  };
}

/** IP da faixa de CGNAT (100.64.0.0/10), derivado do id: o mesmo cliente tem sempre o mesmo IP. */
function ipDaConexao(customerId: number): string {
  return `100.64.${Math.floor(customerId / 254) % 256}.${(customerId % 254) + 1}`;
}

/**
 * A autenticacao PPPoE do cliente, no formato que o bloco "Conexao" do
 * Cliente 360 e o painel do chat leem (`AutenticacaoCliente`). Sem ela os dois
 * mostravam "o ERP nao devolveu login, MAC nem serial" na demonstracao inteira.
 *
 * Tudo deterministico — duas leituras do mesmo cliente devolvem a mesma
 * conexao. MAC e serial vem do aparelho que a PROPRIA base tem para o cliente
 * (o de menor id), para o cruzamento com o inventario casar; sem aparelho, os
 * dois ficam nulos em vez de inventados.
 *
 * Estado, pelas mesmas regras do produto:
 * - `online` so para contrato ativo sem fatura vencida nesta leitura;
 * - `bloqueada` e decisao de CONTRATO: o MK so bloqueia a conexao de quem esta
 *   suspenso (ativo + bloqueada vira `suspended`, mk.ts), e a base da demo nao
 *   tem suspenso — ativo sai liberado, cancelado sai bloqueado;
 * - sem sessao nao ha IP.
 */
function autenticacoesDoCliente(cliente: Customer, emAtraso: boolean, aparelhos: LinhaDeEquipamento[]): AutenticacaoCliente[] {
  const onu = aparelhos.reduce<LinhaDeEquipamento | null>((menor, e) => (menor === null || e.id < menor.id ? e : menor), null);
  const ativo = cliente.status === "active";
  const online = ativo && !emAtraso;
  return [{
    login: `cliente${cliente.id}@demonstracao`,
    mac: normalizarMac(onu?.mac),
    serial: onu?.serialNumber || null,
    ip: online ? ipDaConexao(cliente.id) : null,
    contrato: String(cliente.id),
    online,
    bloqueada: ativo ? false : cliente.status === "cancelled" ? true : null,
    fonte: FONTE_ERP_DEMO,
  }];
}

/**
 * Linha digitavel FICTICIA: 47 digitos no desenho de um boleto, com o banco
 * "000", que nao existe — nenhum aplicativo de banco paga esta linha. A fatura
 * e o valor entram nos campos livres so para cada fatura ter a sua.
 */
function linhaDigitavelFicticia(faturaId: number, valor: number): string {
  const id = String(faturaId).padStart(10, "0").slice(-10);
  const centavos = String(Math.round(valor * 100)).padStart(10, "0").slice(-10);
  return `00090.00000 ${id.slice(0, 5)}.${id.slice(5)}0 00000.000000 0 0000${centavos}`;
}

/** Um campo TLV do BR Code (id de 2 digitos + tamanho de 2 digitos + valor). */
const campoPix = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/**
 * PIX copia-e-cola FICTICIO: o desenho do BR Code, com chave num dominio
 * `.invalid` (que nunca resolve) e o CRC final escrito "DEMO" — que nao e
 * hexadecimal, entao qualquer aplicativo recusa o codigo antes de procurar a
 * chave.
 */
function pixCopiaEColaFicticio(faturaId: number, valor: number): string {
  const conta = campoPix("00", "br.gov.bcb.pix") + campoPix("01", "cobranca@demonstracao.invalid");
  return [
    campoPix("00", "01"),
    campoPix("26", conta),
    campoPix("52", "0000"),
    campoPix("53", "986"),
    campoPix("54", valor.toFixed(2)),
    campoPix("58", "BR"),
    campoPix("59", "DEMONSTRACAO"),
    campoPix("60", "LONDRINA"),
    campoPix("62", campoPix("05", `DEMO${faturaId}`)),
  ].join("") + "6304DEMO";
}

/**
 * As faturas ABERTAS (status "overdue") de todos os clientes do provedor,
 * agrupadas por `customerId` — uma consulta so, e nao uma por cliente. Usado
 * por `buscarClientes` (fetchDelinquents/fetchCustomers), que legitimamente
 * precisa da base inteira.
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
    lista.push(paraFaturaAberta(fatura));
    mapa.set(fatura.customerId, lista);
  }
  return mapa;
}

/** O comodato de todos os clientes do provedor, agrupado por `customerId`. Usado por `buscarClientes`. */
async function equipamentosPorCliente(providerId: number): Promise<Map<number, LinhaDeEquipamento[]>> {
  const linhas = await db.select().from(equipment).where(eq(equipment.providerId, providerId));

  const mapa = new Map<number, LinhaDeEquipamento[]>();
  for (const item of linhas) {
    if (item.customerId === null) continue;
    const lista = mapa.get(item.customerId) ?? [];
    lista.push(item);
    mapa.set(item.customerId, lista);
  }
  return mapa;
}

/**
 * As faturas abertas e o comodato de UM SO cliente — usado por
 * `fetchCustomerByCpf` (rodada de correcao, 11/09/2026). Antes, uma consulta
 * de CPF carregava as tabelas `invoices`/`equipment` do PROVEDOR INTEIRO para
 * depois descartar tudo que nao fosse deste cliente (o `.get(cliente.id)` no
 * Map escondia isso: a resposta ja saia certa, so o custo estava errado). Com
 * ate 150 sandboxes vivos e 1.500 clientes cada, uma unica consulta ao vivo
 * virava 2 varreduras de tabela inteira — 155 quando multiplicado pelo teto
 * de sandboxes. Aqui o filtro por `customerId` vai na propria query.
 */
async function faturasAbertasDoCliente(providerId: number, customerId: number): Promise<FaturaAbertaDoErp[]> {
  const linhas = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.providerId, providerId), eq(invoices.customerId, customerId), eq(invoices.status, "overdue")));
  return linhas.map(paraFaturaAberta);
}

/** O comodato de UM SO cliente — ver `faturasAbertasDoCliente`. */
async function equipamentosDoCliente(providerId: number, customerId: number): Promise<LinhaDeEquipamento[]> {
  return db
    .select()
    .from(equipment)
    .where(and(eq(equipment.providerId, providerId), eq(equipment.customerId, customerId)));
}

function paraClienteNormalizado(
  cliente: Customer,
  faturas: FaturaAbertaDoErp[] | undefined,
  equipamentos: LinhaDeEquipamento[] | undefined,
): NormalizedErpCustomer {
  const abertas = faturas ?? [];
  const totalOverdueAmount = abertas.reduce((soma, f) => soma + f.valor, 0);
  const maxDaysOverdue = abertas.reduce((max, f) => Math.max(max, calculateDaysOverdue(f.vencimento)), 0);
  const aparelhos = equipamentos ?? [];
  // "Nao devolvido" pelo MESMO criterio que o painel, o anti-fraude e o
  // agregado do cliente usam (`equipamentoTemRetiradaPendente`), como o MK usa
  // `retidos > 0`. Contar todo aparelho fazia a ONU em comodato de quem esta em
  // dia virar pendencia na consulta — teto de 400, "Analisar" no chip limpo.
  const pendentes = aparelhos.filter((e) => equipamentoTemRetiradaPendente(e.status)).length;

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
    hasUnreturnedEquipment: pendentes > 0,
    unreturnedEquipmentCount: pendentes,
    equipmentDetails: aparelhos.length > 0 ? aparelhos.map(paraEquipamentoNormalizado) : undefined,
    autenticacoes: autenticacoesDoCliente(cliente, abertas.length > 0, aparelhos),
    contractStatus: cliente.status === "cancelled" ? "cancelled" : cliente.status === "active" ? "active" : undefined,
    // Motivo e data do corte como a base guarda — a ficha 360 e o historico de
    // execucao leem os dois da leitura ao vivo. `cortado_em` e TIMESTAMP; o
    // ERP informa o dia, entao sai AAAA-MM-DD, o mesmo recorte que a rota do
    // 360 faz para a base (cobranca.routes.ts).
    motivoCorte: cliente.motivoCorte ?? undefined,
    cortadoEm: cliente.cortadoEm ? cliente.cortadoEm.toISOString().slice(0, 10) : undefined,
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
    // Escopado por customerId — nao a base do provedor inteiro. Ver o
    // comentario de `faturasAbertasDoCliente`.
    const [faturas, equipamentos] = await Promise.all([
      faturasAbertasDoCliente(providerId, cliente.id),
      equipamentosDoCliente(providerId, cliente.id),
    ]);

    return {
      ok: true,
      message: "Cliente encontrado na base de demonstracao",
      customers: [paraClienteNormalizado(cliente, faturas, equipamentos)],
    };
  }

  /**
   * A segunda via da fatura, sem sair do processo: linha digitavel e PIX
   * copia-e-cola FICTICIOS (ver `linhaDigitavelFicticia` e
   * `pixCopiaEColaFicticio`) e nenhum link — a demonstracao nao manda o
   * visitante para fora dela. Sem este metodo toda fatura do painel do chat
   * saia `consultavel: false` e a acao de segunda via nao tinha o que mostrar.
   *
   * So para fatura ABERTA do PROPRIO cliente, deste provedor: a referencia e o
   * `invoices.id` que `paraFaturaAberta` devolveu, e qualquer outra coisa
   * (fatura de outro CPF, paga, de outro provedor, id que nao e numero) e
   * `null` — o mesmo "nao ha instrumento" que o chat ja trata.
   */
  async fetchSegundaVia(config: ErpConnectionConfig, documento: string, referencia: string): Promise<PagamentoDoChat | null> {
    const providerId = resolverProviderId(config);
    const doc = cleanCpfCnpj(documento);
    // Ate 9 digitos: cabe em `invoices.id` (integer) sem estourar no banco.
    if (providerId === null || !doc || !/^\d{1,9}$/.test(referencia)) return null;

    const [cliente] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.cpfCnpj, doc)));
    if (!cliente) return null;

    const [fatura] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.providerId, providerId), eq(invoices.customerId, cliente.id), eq(invoices.id, Number(referencia))));
    if (!fatura || !STATUS_DE_FATURA_ABERTA.has(fatura.status)) return null;

    const valor = Number(fatura.value);
    return normalizarPagamento({
      link: null,
      linhaDigitavel: linhaDigitavelFicticia(fatura.id, valor),
      pix: pixCopiaEColaFicticio(fatura.id, valor),
      valor: fatura.value,
      vencimento: vencimentoIso(fatura.dueDate),
    });
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
