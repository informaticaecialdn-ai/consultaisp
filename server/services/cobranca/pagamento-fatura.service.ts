import { pool } from "../../db";
import { storage } from "../../storage";
import { buildConnectorConfig, getConnector } from "../../erp";
import { normalizarPagamento } from "@shared/cobranca/pagamento-chat";
import { snapshotAoVivoDoCliente } from "./snapshot-ao-vivo.service";

/** Apenas instrumento já existente no ERP, confirmado para a fatura e cliente deste provedor. */
export async function obterPagamentoFatura(providerId: number, customerId: number, faturaId: number): Promise<{ link: string; valor: number; vencimento: string } | null> {
  const r = await pool.query<{ documento: string; referencia: string; fonte: string; vencimento: string; valor: number }>(`
    select c.cpf_cnpj as documento, f.erp_ref as referencia, f.erp_source as fonte,
      to_char(f.due_date,'YYYY-MM-DD') as vencimento, f.value::float8 as valor
    from invoices f join customers c on c.provider_id=f.provider_id and c.id=f.customer_id
    where f.provider_id=$1 and f.customer_id=$2 and f.id=$3 and f.erp_ref is not null
      and f.status in ('aberta','pending','overdue') and f.value>0
      and c.status='active' and coalesce(c.total_overdue_amount,0)<=0`, [providerId, customerId, faturaId]);
  const local = r.rows[0];
  if (!local) return null;
  const snapshot = await snapshotAoVivoDoCliente(providerId, local.documento, { forcar: true });
  if (!snapshot.ok || !snapshot.encontrado || snapshot.leituraParcial || !snapshot.cliente || snapshot.erpSource !== local.fonte
    || snapshot.cliente.statusContrato !== "active" || snapshot.cliente.dividaAtual > 0) return null;
  const fatura = snapshot.cliente.faturas?.find(f => f.ref === local.referencia);
  if (!fatura || fatura.vencimento !== local.vencimento || Math.abs(fatura.valor - local.valor) > 0.009) return null;
  let instrumento = fatura.pagamento ? normalizarPagamento(fatura.pagamento) : null;
  if (!instrumento?.link) {
    const integracao = (await storage.getErpIntegrations(providerId)).find(i => i.providerId === providerId && i.isEnabled && i.erpSource === local.fonte);
    const conector = integracao ? getConnector(integracao.erpSource) : null;
    if (!integracao || !conector?.fetchSegundaVia) return null;
    const config = buildConnectorConfig(integracao);
    config.extra = { ...config.extra, providerId: String(providerId) };
    try {
      const pagamento = await conector.fetchSegundaVia(config, local.documento, local.referencia);
      instrumento = pagamento ? normalizarPagamento(pagamento) : null;
    } catch { return null; }
  }
  if (!instrumento?.link || !instrumento.link.startsWith("https://")) return null;
  if (instrumento.valor !== null && Math.abs(instrumento.valor - fatura.valor) > 0.009) return null;
  if (instrumento.vencimento !== null && instrumento.vencimento !== fatura.vencimento) return null;
  return { link: instrumento.link, valor: fatura.valor, vencimento: fatura.vencimento };
}
