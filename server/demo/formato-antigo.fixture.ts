/**
 * Fixture de teste compartilhada — nenhum código de produção importa isto.
 *
 * Extraída de `mundo-base.test.ts` (13/09/2026) para que
 * `sandbox.service.test.ts` monte o MESMO mundo no formato antigo sem copiar a
 * regressão. Recebe o mapa de linhas do banco de mentira de quem chama (cada
 * arquivo de teste tem o seu) e o altera no lugar.
 */
import { INDICE_MIGRADOR_DE_EXEMPLO, PROVEDORES_DA_DEMO } from "./mundo-base";
import { cpfFicticio } from "./pessoas-ficticias";

type Linha = Record<string, unknown>;

const DIA_MS = 86_400_000;
const CPF_DO_MIGRADOR = cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO);

/**
 * O mundo base no FORMATO ANTIGO — o que está gravado no banco da demonstração
 * publicada, semeado pelo `mundo-base.ts` de a5be66c. Cada regra abaixo
 * reproduz um fato medido por SELECT (só leitura) no banco local
 * consultaisp_demo_local, que nasceu do mesmo código, em 13/09/2026:
 *
 *   - cancelados 150 por provedor, todos `payment_status 'current'` e
 *     `total_overdue_amount 0`; nenhum `geo_precisao`, nenhum `motivo_corte`;
 *   - `isp_score`/`risk_tier` no default do schema (100/'low') e
 *     `overdue_invoices_count` no default (0), inclusive nos 225 inadimplentes;
 *   - equipamento: 450 em_comodato (90 por provedor, só em dia) e 30 de cada
 *     um de retido, retirada_pendente, nao_localizado, em_cobranca, not_returned;
 *   - migrador: rede-1 cancelado HÁ 10 DIAS sem fatura e contrato de 45 dias;
 *     rede-2 ativo devendo R$ 80,00 há 20 dias, contrato de 24 meses (a rede-2
 *     medida tem 226 inadimplentes: 225 + ele);
 *   - nenhum usuário nos provedores da rede e nenhuma `isp_consultations`.
 *
 * Parte de um mundo NOVO e desfaz o que mudou, em vez de copiar o semeador
 * antigo inteiro para dentro do teste: as linhas que não mudaram de formato
 * (nome, endereço, plano, faturas dos inadimplentes) continuam idênticas por
 * construção.
 */
export function regredirParaOFormatoAntigo(linhas: Map<string, Linha[]>, agora: Date): void {
  const linhasDe = (tabela: string): Linha[] => linhas.get(tabela) ?? [];
  const idDoProvedor = (subdomain: string): number => {
    const linha = linhasDe("providers").find((p) => p.subdomain === subdomain);
    if (!linha) throw new Error(`Provedor nao semeado: ${subdomain}`);
    return linha.id as number;
  };
  const migradorEm = (subdomain: string): Linha => {
    const providerId = idDoProvedor(subdomain);
    const linha = linhasDe("customers").find((c) => c.providerId === providerId && c.cpfCnpj === CPF_DO_MIGRADOR);
    if (!linha) throw new Error(`migrador nao semeado em ${subdomain}`);
    return linha;
  };

  const idsDaRede = new Set(PROVEDORES_DA_DEMO.map((p) => idDoProvedor(p.subdomain)));
  const dataLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const menosDias = (dias: number) => new Date(agora.getTime() - dias * DIA_MS);

  const antigo = migradorEm("rede-1");
  const novo = migradorEm("rede-2");

  for (const c of linhasDe("customers")) {
    if (!idsDaRede.has(c.providerId as number)) continue;
    c.geoPrecisao = null;
    c.motivoCorte = null;
    c.ispScore = 100;
    c.riskTier = "low";
    c.overdueInvoicesCount = 0;
    if (c.status === "cancelled") {
      c.paymentStatus = "current";
      c.totalOverdueAmount = "0.00";
      c.maxDaysOverdue = 0;
    }
  }
  Object.assign(antigo, { contractStartDate: dataLocal(menosDias(45)), cortadoEm: menosDias(10).toISOString() });
  const vinteQuatroMeses = new Date(agora.getTime());
  vinteQuatroMeses.setMonth(vinteQuatroMeses.getMonth() - 24);
  Object.assign(novo, { paymentStatus: "overdue", totalOverdueAmount: "80.00", maxDaysOverdue: 20, contractStartDate: dataLocal(vinteQuatroMeses) });

  linhas.set("invoices", linhasDe("invoices").filter((f) => f.erpRef !== `demo-saida-${antigo.id}`));
  const faturaDoNovo = linhasDe("invoices").find((f) => f.erpRef === `demo-fatura-${novo.id}`)!;
  Object.assign(faturaDoNovo, { value: "80.00", dueDate: menosDias(20).toISOString(), status: "overdue", paidDate: null, paidValue: null, descricao: null });

  const clientesPorId = new Map(linhasDe("customers").map((c) => [c.id, c] as const));
  linhas.set("equipment", linhasDe("equipment").filter((e) => {
    const dono = clientesPorId.get(e.customerId)!;
    return !(e.status === "em_comodato" && dono.paymentStatus === "overdue");
  }));
  const LEGADO = ["retido", "retirada_pendente", "nao_localizado", "em_cobranca", "not_returned"];
  const porProvedor = new Map<unknown, number>();
  for (const e of linhasDe("equipment")) {
    if (e.status === "em_comodato") continue;
    const n = porProvedor.get(e.providerId) ?? 0;
    e.status = LEGADO[n % LEGADO.length];
    porProvedor.set(e.providerId, n + 1);
  }

  linhas.set("users", linhasDe("users").filter((u) => !idsDaRede.has(u.providerId as number)));
  linhas.set("isp_consultations", []);
}
