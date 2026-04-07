import type { ConsultaResult } from "./types";
import { formatCpfCnpj, escHtml } from "./utils";

export function generatePDF(result: ConsultaResult): string | null {
  const doc = result;
  const now = new Date().toLocaleString("pt-BR");
  const docFormatted = formatCpfCnpj(doc.cpfCnpj);
  const riskColor = doc.riskTier === "critical" ? "#dc2626" : doc.riskTier === "high" ? "#ea580c" : doc.riskTier === "medium" ? "#d97706" : "#16a34a";
  const decisionColor = doc.decisionReco === "Reject" ? "#dc2626" : "#16a34a";

  const providerRows = doc.providerDetails.map(d => {
    const cStatus = d.contractStatus === "active" ? "Ativo" : d.contractStatus === "cancelled" ? "Cancelado" : d.contractStatus === "suspended" ? "Suspenso" : "Sem Contrato";
    const pStatus = d.daysOverdue === 0 ? "Em dia" : `${d.daysOverdue} dias atraso`;
    const debtStr = d.isSameProvider && d.overdueAmount != null
      ? `R$ ${d.overdueAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
      : d.overdueAmountRange || "—";
    return `<tr>
      <td>${escHtml(d.customerName)}</td>
      <td>${escHtml(d.providerName)}</td>
      <td style="color:${d.contractStatus === "active" ? "#16a34a" : d.contractStatus === "cancelled" ? "#dc2626" : "#92400e"}">${cStatus}</td>
      <td style="color:${d.daysOverdue === 0 ? "#16a34a" : "#dc2626"}">${pStatus}</td>
      <td>${debtStr}</td>
      <td>${d.hasUnreturnedEquipment ? `${d.unreturnedEquipmentCount} pendente(s)` : "Devolvidos"}</td>
    </tr>`;
  }).join("");

  const alertRows = doc.alerts.length > 0 ? doc.alerts.map(a => `<li>${escHtml(a)}</li>`).join("") : "<li>Nenhum alerta</li>";
  const actionRows = doc.recommendedActions.length > 0 ? doc.recommendedActions.map(a => `<li>${escHtml(a)}</li>`).join("") : "<li>Nenhuma acao especifica recomendada</li>";
  const addrRows = (doc.addressMatches || []).filter(m => m.hasDebt).map(m =>
    `<li>${escHtml(m.customerName)} — ${escHtml(m.address)}, ${escHtml(m.city)}${m.state ? `/${escHtml(m.state)}` : ""} — ${m.daysOverdue != null ? `${m.daysOverdue} dias atraso` : escHtml(m.daysOverdueRange) || "Inadimplente"}</li>`
  ).join("");

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Relatorio de Consulta ISP — ${docFormatted}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;padding:24px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #2563eb;padding-bottom:12px;margin-bottom:20px}
  .header h1{font-size:18px;color:#2563eb;font-weight:700}
  .header .meta{font-size:10px;color:#64748b;text-align:right}
  .score-block{display:flex;gap:24px;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px}
  .score-circle{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;background:${riskColor}}
  .score-info h2{font-size:15px;font-weight:700;color:${riskColor}}
  .score-info p{font-size:11px;color:#64748b;margin-top:2px}
  .decision{display:inline-block;margin-top:8px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:${decisionColor}}
  section{margin-bottom:16px}
  section h3{font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.05em;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#f1f5f9;text-align:left;padding:6px 8px;font-weight:600;color:#475569}
  td{padding:5px 8px;border-bottom:1px solid #f1f5f9;color:#334155}
  ul{padding-left:16px}
  li{margin-bottom:4px;font-size:11px;color:#334155}
  .footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:10px;font-size:10px;color:#94a3b8;text-align:center}
  @media print{body{padding:0} @page{margin:16mm}}
</style></head><body>
<div class="header">
  <div>
    <h1>Consulta ISP — Relatorio de Credito</h1>
    <p style="font-size:11px;color:#64748b;margin-top:4px">Documento: <strong>${docFormatted}</strong> &nbsp;|&nbsp; Tipo: ${doc.searchType.toUpperCase()}</p>
  </div>
  <div class="meta">
    <div><strong>Emitido em</strong></div><div>${now}</div>
  </div>
</div>

<div class="score-block">
  <div class="score-circle">${doc.score}</div>
  <div class="score-info">
    <h2>${doc.riskLabel}</h2>
    <p>${doc.providersFound} provedor(es) encontrado(s)</p>
    <span class="decision">${doc.recommendation}</span>
  </div>
</div>

<section>
  <h3>Provedores Encontrados</h3>
  ${doc.providerDetails.length > 0 ? `<table>
    <thead><tr><th>Cliente</th><th>Provedor</th><th>Contrato</th><th>Pagamento</th><th>Divida</th><th>Equipamentos</th></tr></thead>
    <tbody>${providerRows}</tbody>
  </table>` : "<p style='font-size:11px;color:#64748b'>Nenhum registro encontrado na base colaborativa.</p>"}
</section>

<section>
  <h3>Alertas do Sistema</h3>
  <ul>${alertRows}</ul>
</section>

<section>
  <h3>Acoes Recomendadas</h3>
  <ul>${actionRows}</ul>
</section>

${addrRows ? `<section>
  <h3>Cruzamento de Endereco</h3>
  <ul>${addrRows}</ul>
</section>` : ""}

<div class="footer">Relatorio gerado por Consulta ISP &nbsp;|&nbsp; ${now} &nbsp;|&nbsp; Documento: ${docFormatted}</div>
</body></html>`;

  return html;
}
