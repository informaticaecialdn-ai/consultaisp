import { Kicker } from "./report-ui";

const CARDS = [
  {
    titulo: "Como o score é calculado",
    texto: "Todo documento parte de 700 — nada consta na rede. A partir daí o motor DEDUZ por sinal: tempo de atraso, valor em aberto, número de faturas, dívida em mais de um provedor, equipamento em comodato não devolvido, risco do endereço e rajada de consultas. Bônus só entram com histórico comprovado, e ficam bloqueados enquanto existir dívida ativa. A conta completa aparece no próprio relatório, linha a linha.",
  },
  {
    titulo: "Custos",
    texto: "Registros do seu próprio ERP e resultados \"nada consta\" são gratuitos. Cada ocorrência revelada de provedor parceiro consome 1 crédito. O custo aparece antes da consulta, no rodapé do formulário, e de novo dentro do relatório.",
  },
  {
    titulo: "Base legal · LGPD",
    texto: "Consultas amparadas no legítimo interesse — LGPD art. 7º, IX, para proteção ao crédito. Dados de terceiros chegam anonimizados e com valores em faixa; toda consulta gera registro de auditoria com hash e finalidade declarada.",
  },
];

export default function ConsultaInfoTab() {
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 14, alignItems: "start",
      }}
      data-testid="tab-content-info"
    >
      {CARDS.map(c => (
        <div key={c.titulo} style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "18px 20px",
        }}>
          <Kicker>{c.titulo}</Kicker>
          <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginTop: 10 }}>
            {c.texto}
          </p>
        </div>
      ))}
    </div>
  );
}
