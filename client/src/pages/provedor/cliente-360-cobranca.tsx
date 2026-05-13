/**
 * Cliente 360º Cobrança — versão honesta (Spec 012.5).
 *
 * Mostra APENAS dados reais vindos de GET /api/customers/:id/cliente-360.
 * Cards que dependem de specs ainda não implementadas (Audit Júlia, Timeline,
 * Predições ML, Alertas Críticos, Régua em Execução, Status NMS) NÃO são
 * mockados — aparecem como placeholders explícitos com o nome da spec que
 * destrava cada um.
 *
 * Lição da sessão 2026-05-13: telas com 30% real + 70% mock geram ruído.
 * Melhor mostrar pouco e verdadeiro.
 */
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface Cliente360 {
  cliente: {
    id: number;
    nome: string;
    cpfMasked: string;
    phoneMasked: string | null;
    email: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    enderecoCompleto: string | null;
    contractStatus: "active" | "cancelled" | "suspended";
    erpSource: string | null;
    clienteDesdeIso: string | null;
    tempoRelacaoMeses: number;
  };
  financeiro: {
    saldoDevedor: number;
    faturasAberto: number;
    maxDiasAtraso: number;
    ultimoSync: string | null;
  };
  equipamentos: Array<{
    id: number;
    tipo: string;
    marca: string | null;
    modelo: string | null;
    serial: string | null;
    mac: string | null;
    status: string;
    valorReposicao: number | null;
  }>;
  contratos: Array<{
    id: number;
    plano: string;
    valor: number;
    status: string;
    inicio: string | null;
    fim: string | null;
  }>;
  perfilDna: {
    atual: string;
    tom: string;
    canalPrimario: string;
    descontoMax: number;
    humanoObrigatorio: boolean;
    confianca: "alta" | "media" | "baixa_heuristica";
  };
  healthScore: {
    score: number;
    tier: string;
    inadimplenciaRisk30d: number;
    churnRisk60d: number;
    recommendation: { action: string; agent: string; severity: string };
  };
  roi: {
    valorRecuperar: number;
    probEstimada: number;
    valorEsperado: number;
    custoEstimado: number;
    estimado: number;
    decisao: string;
  };
  _pending: Record<string, string>;
}

export default function Cliente360CobrancaPage() {
  const [, params] = useRoute("/cliente/:customerId/360-cobranca");
  const customerId = params?.customerId ?? "?";

  const { data: resp, isLoading, error } = useQuery<{ ok: boolean; data?: Cliente360 }>({
    queryKey: [`/api/customers/${customerId}/cliente-360`],
    enabled: !!customerId && customerId !== "?",
    staleTime: 60_000,
  });

  if (isLoading) {
    return <CenteredMessage>Carregando dados do cliente...</CenteredMessage>;
  }
  if (error || !resp?.ok || !resp.data) {
    return (
      <CenteredMessage>
        <div className="text-red-700 font-semibold mb-2">Não foi possível carregar o cliente.</div>
        <Link href={`/cliente/${customerId}/dossie`} className="text-[#1F6B4A] underline text-sm">
          Voltar ao dossiê
        </Link>
      </CenteredMessage>
    );
  }

  const d = resp.data;
  const iniciais = d.cliente.nome.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  const clienteDesde = d.cliente.clienteDesdeIso
    ? new Date(d.cliente.clienteDesdeIso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    : "—";

  return (
    <div className="min-h-screen" style={{ fontFamily: "DM Sans, system-ui, sans-serif", backgroundColor: "#FBF7F2", color: "#0A1628" }}>
      <div className="bg-emerald-700 text-white text-xs py-1.5 px-4 text-center">
        ✅ Dados reais do cliente #{customerId}. Cards sem dado real ainda foram removidos
        — aparecem abaixo como "Em construção" com a spec que destrava cada um.
      </div>

      {/* HEADER (sticky) */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-6 py-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-start gap-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-white font-semibold text-xl"
                style={{ background: "linear-gradient(to bottom right, #1F6B4A, #0F3D2E)", fontFamily: "Fraunces, serif" }}
              >
                {iniciais || "?"}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h1 className="font-semibold text-2xl text-[#0A1628]" style={{ fontFamily: "Fraunces, serif" }}>{d.cliente.nome}</h1>
                  <ContractBadge status={d.cliente.contractStatus} />
                </div>
                <div className="text-sm text-[#3D5278] flex items-center gap-4 flex-wrap">
                  <span className="font-mono text-xs">CPF {d.cliente.cpfMasked}</span>
                  {d.cliente.phoneMasked && <span>📞 {d.cliente.phoneMasked}</span>}
                  {d.cliente.email && <span>✉️ {d.cliente.email}</span>}
                </div>
                {d.cliente.enderecoCompleto && (
                  <div className="text-xs text-[#3D5278] mt-1">📍 {d.cliente.enderecoCompleto}</div>
                )}
                <div className="text-xs text-[#3D5278] mt-1">
                  Cliente desde {clienteDesde} ({d.cliente.tempoRelacaoMeses} {d.cliente.tempoRelacaoMeses === 1 ? "mês" : "meses"})
                  {d.cliente.erpSource && <span> · ERP: <strong className="uppercase text-[#1F3050]">{d.cliente.erpSource}</strong></span>}
                </div>
              </div>
            </div>
            <Link href={`/cliente/${customerId}/dossie`} className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">
              ← Dossiê completo
            </Link>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-6">
            <KpiHeader label="Saldo Devedor" value={formatBrl(d.financeiro.saldoDevedor)} color={d.financeiro.saldoDevedor > 0 ? "amber" : "green"} />
            <KpiHeader label="Faturas em Aberto" value={String(d.financeiro.faturasAberto)} color={d.financeiro.faturasAberto > 0 ? "amber" : "green"} />
            <KpiHeader label="Dias em Atraso" value={d.financeiro.maxDiasAtraso > 0 ? `D+${d.financeiro.maxDiasAtraso}` : "0"} color={d.financeiro.maxDiasAtraso > 30 ? "red" : d.financeiro.maxDiasAtraso > 0 ? "amber" : "green"} />
            <KpiHeader label="Último Sync ERP" value={d.financeiro.ultimoSync ? new Date(d.financeiro.ultimoSync).toLocaleDateString("pt-BR") : "—"} />
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div className="max-w-[1440px] mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* COLUNA ESQUERDA */}
          <div className="col-span-12 lg:col-span-5 space-y-6">

            {/* HEALTH SCORE (REAL) */}
            <Card>
              <CardTitle right={<TierBadge tier={d.healthScore.tier} />}>🩺 Health Score 360</CardTitle>
              <div className="flex items-end gap-3 mb-3">
                <div className="font-semibold text-4xl text-[#0A1628]" style={{ fontFamily: "Fraunces, serif" }}>{d.healthScore.score}</div>
                <div className="text-xs text-[#3D5278] mb-1">/ 100</div>
              </div>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#3D5278]">Risco inadimplência 30d</span>
                  <span className={`font-medium ${riskColor(d.healthScore.inadimplenciaRisk30d)}`}>{d.healthScore.inadimplenciaRisk30d}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#3D5278]">Risco churn 60d</span>
                  <span className={`font-medium ${riskColor(d.healthScore.churnRisk60d)}`}>{d.healthScore.churnRisk60d}%</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-1">Ação recomendada</div>
                <div className="text-sm text-[#0A1628]">
                  <span className="font-semibold">{d.healthScore.recommendation.agent}</span> — {d.healthScore.recommendation.action}
                </div>
                <div className="text-xs text-[#3D5278] mt-0.5">Severidade: {d.healthScore.recommendation.severity}</div>
              </div>
            </Card>

            {/* PERFIL DNA HEURÍSTICO */}
            <Card>
              <CardTitle right={<HeuristicaBadge confianca={d.perfilDna.confianca} />}>🎯 Perfil DNA (heurístico)</CardTitle>
              <div className="text-center mb-4">
                <div className="text-xs text-[#3D5278] uppercase tracking-wide">Perfil atual</div>
                <div className="font-semibold text-3xl text-amber-700 mt-1" style={{ fontFamily: "Fraunces, serif" }}>{d.perfilDna.atual}</div>
              </div>
              <div className="space-y-2.5 text-sm">
                <Row label="Tom recomendado" value={d.perfilDna.tom} />
                <Row label="Canal primário" value={d.perfilDna.canalPrimario} />
                <Row label="Desconto máximo" value={`${d.perfilDna.descontoMax}%`} />
                <Row label="Humano obrigatório" value={d.perfilDna.humanoObrigatorio ? "Sim" : "Não"} />
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-[#3D5278]">
                Baseado em dias de atraso, taxa histórica e tempo de relação.
                Modelo treinado virá na <strong>Spec 010A Fase B</strong>.
              </div>
            </Card>

            {/* EQUIPAMENTOS (REAL) */}
            <Card>
              <CardTitle right={<span className="font-mono text-xs normal-case">{d.equipamentos.length} {d.equipamentos.length === 1 ? "item" : "itens"}</span>}>📦 Equipamentos</CardTitle>
              {d.equipamentos.length === 0 ? (
                <div className="text-sm text-[#3D5278] py-2">Nenhum equipamento registrado para este cliente.</div>
              ) : (
                <div className="space-y-3">
                  {d.equipamentos.map((eq, i) => (
                    <div key={eq.id} className={`flex justify-between items-start text-sm ${i > 0 ? "pt-3 border-t border-gray-100" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[#0A1628]">
                          {[eq.tipo, eq.marca, eq.modelo].filter(Boolean).join(" ") || eq.tipo}
                        </div>
                        {eq.serial && <div className="text-xs text-[#3D5278] font-mono truncate">SN: {eq.serial}</div>}
                        {eq.mac && <div className="text-xs text-[#3D5278] font-mono truncate">MAC: {eq.mac}</div>}
                        <div className="text-xs text-[#3D5278]">Status: <span className="font-medium text-[#1F3050]">{eq.status}</span></div>
                      </div>
                      {eq.valorReposicao != null && (
                        <div className="text-right ml-3 shrink-0">
                          <div className="font-mono font-semibold text-[#0A1628]">{formatBrl(eq.valorReposicao)}</div>
                          <div className="text-xs text-[#3D5278]">reposição</div>
                        </div>
                      )}
                    </div>
                  ))}
                  {d.equipamentos.some(e => e.valorReposicao != null) && (
                    <div className="pt-3 border-t border-gray-100 flex justify-between items-center text-sm">
                      <span className="text-[#3D5278]">Total reposição</span>
                      <span className="font-semibold text-lg text-[#0A1628]" style={{ fontFamily: "Fraunces, serif" }}>
                        {formatBrl(d.equipamentos.reduce((s, e) => s + (e.valorReposicao ?? 0), 0))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>

          </div>

          {/* COLUNA DIREITA */}
          <div className="col-span-12 lg:col-span-7 space-y-6">

            {/* SITUAÇÃO FINANCEIRA AGREGADA (REAL) */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">agregado do ERP</span>}>💰 Situação Financeira</CardTitle>
              <div className="grid grid-cols-3 gap-4">
                <Kpi label="Saldo Devedor" value={formatBrl(d.financeiro.saldoDevedor)} color={d.financeiro.saldoDevedor > 0 ? "amber" : "green"} big />
                <Kpi label="Faturas em Aberto" value={String(d.financeiro.faturasAberto)} color={d.financeiro.faturasAberto > 0 ? "amber" : "green"} big />
                <Kpi label="Maior Atraso" value={d.financeiro.maxDiasAtraso > 0 ? `D+${d.financeiro.maxDiasAtraso}` : "0"} color={d.financeiro.maxDiasAtraso > 30 ? "red" : d.financeiro.maxDiasAtraso > 0 ? "amber" : "green"} big />
              </div>
              <div className="mt-5 pt-4 border-t border-gray-100 text-xs text-[#3D5278]">
                <strong>Detalhamento por fatura</strong> (número, vencimento, multa, juros) ainda não está
                no banco local — apenas o agregado vem do MK. Precisa persistir <code className="font-mono bg-[#F5EDE0] px-1.5 py-0.5 rounded">WSMKFaturasPendentes</code> em
                tabela própria. Veja <strong>Spec 012/013</strong> (faturas detalhadas).
              </div>
            </Card>

            {/* CONTRATOS (REAL) */}
            <Card>
              <CardTitle right={<span className="font-mono text-xs normal-case">{d.contratos.length}</span>}>📄 Contratos</CardTitle>
              {d.contratos.length === 0 ? (
                <div className="text-sm text-[#3D5278] py-2">Nenhum contrato registrado para este cliente no banco local.</div>
              ) : (
                <div className="space-y-3">
                  {d.contratos.map((c, i) => (
                    <div key={c.id} className={`flex justify-between items-start text-sm ${i > 0 ? "pt-3 border-t border-gray-100" : ""}`}>
                      <div>
                        <div className="font-medium text-[#0A1628]">{c.plano}</div>
                        <div className="text-xs text-[#3D5278]">
                          {c.inicio && new Date(c.inicio).toLocaleDateString("pt-BR")}
                          {c.fim && ` → ${new Date(c.fim).toLocaleDateString("pt-BR")}`}
                          <span> · status: <span className="font-medium text-[#1F3050]">{c.status}</span></span>
                        </div>
                      </div>
                      <div className="font-mono font-semibold text-[#0A1628]">{formatBrl(c.valor)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ROI HEURÍSTICO */}
            <Card borderLeft="#C9A227">
              <CardTitle right={<HeuristicaBadge confianca="baixa_heuristica" />}>💸 ROI estimado (heurístico)</CardTitle>
              <div className="space-y-2 text-sm mb-3">
                <Row label="Valor a recuperar" value={formatBrl(d.roi.valorRecuperar)} />
                <Row label="Probabilidade estimada" value={`${d.roi.probEstimada}%`} />
                <Row label="Valor esperado" value={<span className="text-[#1F6B4A]">{formatBrl(d.roi.valorEsperado)}</span>} />
                <Row label="Custo estimado" value={<span className="text-amber-700">{formatBrl(d.roi.custoEstimado)}</span>} />
                <div className="flex justify-between pt-2 border-t border-gray-100">
                  <span className="font-semibold text-[#0A1628]">ROI estimado</span>
                  <span className="font-semibold text-2xl text-[#1F6B4A]" style={{ fontFamily: "Fraunces, serif" }}>{d.roi.estimado}×</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#3D5278]">Decisão</span>
                  <span className="font-medium text-[#0A1628]">{d.roi.decisao}</span>
                </div>
              </div>
              <div className="text-xs text-[#3D5278] mt-3 pt-3 border-t border-gray-100">
                Cálculo simples (probabilidade ∝ health score, custo fixo por estágio).
                Modelo treinado virá nas <strong>Specs 010A/011</strong>.
              </div>
            </Card>

            {/* EM CONSTRUÇÃO */}
            <Card className="border-dashed">
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">specs ainda não entregues</span>}>🚧 Em construção</CardTitle>
              <div className="space-y-2 text-sm">
                {Object.entries(d._pending).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-3 py-1.5">
                    <span className="text-amber-500 mt-0.5">•</span>
                    <div className="flex-1">
                      <div className="font-medium text-[#1F3050] capitalize">{labelOf(key)}</div>
                      <div className="text-xs text-[#3D5278]">{value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 flex items-center justify-between text-xs text-[#3D5278] flex-wrap gap-2">
          <div>Provedor.AI · Cliente 360° Cobrança · <span className="font-mono">cliente_id: {customerId}</span></div>
          {d.financeiro.ultimoSync && (
            <div>Última sincronização ERP: <span className="font-mono">{new Date(d.financeiro.ultimoSync).toLocaleString("pt-BR")}</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function labelOf(key: string): string {
  const labels: Record<string, string> = {
    auditJulia: "Auditoria Júlia (decisões compliance)",
    predicoesMl: "Predições ML",
    statusTecnicoNms: "Status técnico (sinal ONU, uptime)",
    timelineComunicacao: "Timeline de comunicações",
    consultaIspScore: "Score Consulta ISP",
    reguaExecucao: "Régua em execução",
    alertasCriticos: "Alertas críticos (queda fiel, POP, geo-cluster)",
  };
  return labels[key] ?? key;
}

function riskColor(value: number): string {
  if (value >= 70) return "text-red-700";
  if (value >= 40) return "text-amber-700";
  return "text-[#1F6B4A]";
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FBF7F2" }}>
      <div className="text-center text-sm text-[#3D5278]">{children}</div>
    </div>
  );
}

function ContractBadge({ status }: { status: "active" | "cancelled" | "suspended" }) {
  const map = {
    active: { bg: "bg-green-100 text-[#0F3D2E]", dot: "bg-green-500", label: "Ativo" },
    suspended: { bg: "bg-amber-100 text-amber-700", dot: "bg-amber-500", label: "Suspenso" },
    cancelled: { bg: "bg-red-100 text-red-700", dot: "bg-red-500", label: "Cancelado" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ${m.bg} text-xs font-semibold`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`}></span>
      {m.label}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const upper = tier.toUpperCase();
  const cls = upper.includes("CRITIC") || upper.includes("CRÍTIC")
    ? "bg-red-100 text-red-700"
    : upper.includes("HIGH") || upper.includes("ALTO")
    ? "bg-amber-100 text-amber-700"
    : upper.includes("MED")
    ? "bg-amber-100 text-amber-700"
    : "bg-green-100 text-[#0F3D2E]";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{upper}</span>;
}

function HeuristicaBadge({ confianca }: { confianca: "alta" | "media" | "baixa_heuristica" }) {
  const map = {
    alta: { cls: "bg-green-100 text-[#0F3D2E]", label: "alta confiança" },
    media: { cls: "bg-amber-100 text-amber-700", label: "média confiança" },
    baixa_heuristica: { cls: "bg-[#F5EDE0] text-[#3D5278]", label: "heurística" },
  };
  const m = map[confianca];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold normal-case ${m.cls}`}>{m.label}</span>;
}

function Card({ children, className = "", borderLeft }: { children: React.ReactNode; className?: string; borderLeft?: string }) {
  return (
    <div className={`bg-white border border-[#F0F0F0] rounded-xl p-5 hover:shadow-md transition-shadow ${borderLeft ? "border-l-4" : ""} ${className}`} style={borderLeft ? { borderLeftColor: borderLeft } : {}}>
      {children}
    </div>
  );
}

function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-[#3D5278] mb-3 flex items-center justify-between gap-3">
      <span>{children}</span>
      {right}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[#3D5278]">{label}</span>
      <span className="font-medium text-[#0A1628] text-right">{value}</span>
    </div>
  );
}

function KpiHeader({ label, value, color }: { label: string; value: string; color?: "green" | "amber" | "red" }) {
  const valueColor = color === "amber" ? "text-amber-700" : color === "red" ? "text-red-700" : color === "green" ? "text-[#1F6B4A]" : "text-[#0A1628]";
  return (
    <div>
      <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">{label}</div>
      <div className={`font-semibold text-2xl mt-0.5 ${valueColor}`} style={{ fontFamily: "Fraunces, serif" }}>{value}</div>
    </div>
  );
}

function Kpi({ label, value, color = "navy", big = false }: { label: string; value: string; color?: "green" | "navy" | "red" | "amber"; big?: boolean }) {
  const valueColor = color === "green" ? "text-[#1F6B4A]" : color === "red" ? "text-red-700" : color === "amber" ? "text-amber-700" : "text-[#0A1628]";
  return (
    <div>
      <div className="text-xs text-[#3D5278] uppercase tracking-wide">{label}</div>
      <div className={`font-semibold ${big ? "text-2xl mt-1" : "text-lg"} ${valueColor}`} style={{ fontFamily: "Fraunces, serif" }}>{value}</div>
    </div>
  );
}
