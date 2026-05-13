/**
 * Cliente 360º Cobrança — replica visual exato do mockup-cobranca.html
 * (specs/012-5-cliente-360-cobranca/mockup-cobranca.html).
 *
 * IMPORTANTE: dados MOCKADOS (cliente fictícia Maria Silva Souza B3, R$ 179,80).
 * Backend real ainda não existe pra: perfil DNA A1-C3, predições ML, audit Júlia,
 * Score & Decisão Marcos, timeline régua, alertas críticos. Quando cada peça do
 * backend for implementada (Spec 010A/011/012.0), trocar mocks por queries reais.
 *
 * Stack atual: Vite + Wouter + Tailwind. Cores via arbitrary values
 * (bg-[#0F3D2E]) pra manter fidelidade ao mockup sem editar config global.
 */
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

// ─── MOCK DATA (fictícia Maria, replica mockup) ─────────────────────────────
const MOCK_DATA = {
  customer: {
    nome: "Maria Silva Souza",
    cpfMasked: "123.***.**-12",
    idade: 45,
    bairro: "Centro",
    cidade: "Cambé",
    uf: "PR",
    telefoneMasked: "+55 11 *****1234",
    email: "maria@exemplo.com",
    clienteDesde: "Ago/2023",
    tempoRelacaoMeses: 32,
    carteira: "Cambé centro",
    operador: "Carlos Operador",
  },
  perfilDna: {
    atual: "B3",
    anterior30d: "A3",
    quedaFiel: true,
    tom: "extra-gentle",
    cadencia: "gentle pause",
    canalPrimario: "WhatsApp",
    canalFallback: "Voz (humano)",
    descontoMax: 25,
    parcelasMax: 12,
    ofertaRetencao: "downgrade temp 3 meses, reverte auto",
    humanoObrigatorio: true,
  },
  financeiro: {
    saldoDevedor: 179.80,
    faturasAberto: 2,
    pagas12m: 11,
    total12m: 12,
    maisAntiga: "D+32",
    venceuEm: "10/04/2026",
    faturas: [
      { numero: "4521", periodo: "Abril/2026", venceu: "10/04/2026", diasAtraso: 32, principal: 89.90, multa: 1.80, juros: 0.96, total: 92.66, antiga: true },
      { numero: "4587", periodo: "Maio/2026", venceu: "10/05/2026", diasAtraso: 2, principal: 89.90, multa: 1.80, juros: 0.06, total: 89.96, antiga: false },
    ],
    ultimoPagamento: "08/03/2026 — R$ 89,90 via Pix",
    padraoHistorico: "Paga sempre dia 8-12 (32m)",
    taxaAtraso12m: "8% (1 ocorrência)",
    totalPago12m: 1078.80,
  },
  predicoes: {
    pagamentoProximaFatura: 62,
    churn60d: 45,
    procon30d: 5,
    ltv24m: 2157,
    consultaIsp: 720,
    spc: "limpo",
    serasa: "limpo",
  },
  statusTecnico: {
    linkAtivo: true,
    sinalOnu: "-22 dBm",
    sinalClass: "bom",
    uptime30d: "99,8%",
    pop: "POP-3",
    ultimoIncidente: "08/05 (90 min)",
    chamadosAbertos: 0,
  },
  equipamentos: [
    { tipo: "ONU ZTE F660", serial: "ZTE-XYZ-123", mac: "AA:BB:CC:DD:EE:FF", instalado: "20/08/2023", meses: 32, reposicao: 175, termo: true },
    { tipo: "Roteador TP-Link AC1200", serial: "TPL-789", instalado: "20/08/2023", reposicao: 80, termo: true },
  ],
  alertasCriticos: [
    { tipo: "queda_fiel", icon: "🟠", titulo: "A3 → B3 detectado", desc: "Marcos sugeriu humano ligar pessoalmente.", detectado: "12/05 00:30" },
    { tipo: "vulneravel_suspeito", icon: "🛡️", titulo: "Sinal vulnerável suspeito", desc: 'Cliente disse "tô apertado esse mês" há 4 dias. Não confirmado ainda.' },
    { tipo: "pop_incidente", icon: "📡", titulo: "Incidente POP-3 recente", desc: "90min downtime em 08/05. Afetou este cliente. Considerar antes de cobrar." },
    { tipo: "geo_cluster", icon: "📊", titulo: "Geo-cluster ativo", desc: "Bairro Centro tem 6 inadimplentes em raio 500m. Sinal social regional." },
  ],
  flagsCompliance: [
    { label: "Vulnerável (Lei 14.181)", status: "suspeita", badgeClass: "bg-amber-100 text-amber-700", badgeText: "⚠️ Suspeita" },
    { label: "Binding (Procon)", status: "ok" },
    { label: "Super endividado", status: "ok" },
    { label: "Menor de idade", status: "ok" },
    { label: "Prescrita (CC 206)", status: "ok" },
    { label: "Serviço essencial", status: "na" },
    { label: "Pausa Súmula 548", status: "na" },
    { label: "Alegou pagamento", status: "ok", customLabel: "não" },
  ],
  proximasAcoes: [
    {
      rank: 1, primary: true, badge: "RANK 1 ⭐", badgeBg: "bg-[#C9A227]",
      titulo: "Humano ligar pessoalmente", roi: "30,6×",
      desc: "Cliente A3 → B3 (queda fiel após 32 meses). Tratamento humano premium é a abordagem com maior probabilidade de retenção (84%).",
      meta: "Atribuído: Carlos Operador (carteira Cambé centro) · Prazo: 24h, horário comercial · Custo: R$ 5,00 (15min)",
      buttons: [{ label: "Atribuir task", primary: true }, { label: "Eu mesmo vou ligar" }],
    },
    {
      rank: 2, primary: false, badge: "RANK 2", badgeBg: "bg-[#1F3050]",
      titulo: "Rafael oferecer downgrade temporário", roi: "18,2×",
      desc: "Plano 100Mbps por R$ 69,90 (vs atual 200Mbps R$ 89,90) por 3 meses. Reverte automático após período.",
      buttons: [{ label: "Gerar proposta", primary: true }, { label: "Customizar" }],
    },
    {
      rank: 3, primary: false, badge: "RANK 3", badgeBg: "bg-[#8B98B0]",
      titulo: "Pausar régua automática 7 dias", roi: null, custo: "sem custo",
      desc: "Bruno + Carla suspendem envios enquanto humano resolve queda fiel.",
      buttons: [{ label: "Pausar até 19/05" }],
    },
  ],
  naoRecomendado: [
    "Cobrança ostensiva (Bruno D+1) — perfil B3 fragiliza ainda mais",
    "Suspensão D+15 (Carla bloqueada por Júlia — policy B3 exige humano)",
    "Desconto >25% — acima da policy do tenant para B3",
  ],
  timeline: [
    { dia: "HOJE — 12/05/2026", items: [
      { hora: "00:30", tipo: "sistema", color: "amber", label: "🟠 SISTEMA", texto: "Marcos detectou queda fiel A3 → B3. Task atribuída para Carlos Operador." },
    ]},
    { dia: "10/05/2026 — sex", items: [
      { hora: "19:35", tipo: "outbound", color: "green", label: "→ Helena via WhatsApp",
        texto: '"Entendo, sem estresse. Vou abrir opção pra você falar com Rafael, que tem mais flexibilidade. Em 1 min."',
        meta: "sentiment +0.2 · template aprovado Júlia" },
      { hora: "19:30", tipo: "inbound", color: "amber", label: "← Cliente via WhatsApp", badge: "SINAL VULNERÁVEL",
        texto: '"Tô apertado esse mês. Dá pra esperar até dia 20?"', meta: "sentiment -0.1" },
    ]},
    { dia: "08/05/2026 — qua", items: [
      { hora: "14:20", tipo: "incidente", color: "red", label: "⚡ INCIDENTE TÉCNICO",
        texto: "POP-3 ficou offline por 90 min. Afetou 87 clientes (incluindo este)." },
    ]},
    { dia: "05/05/2026 — seg", items: [
      { hora: "09:00", tipo: "outbound", color: "navy", label: "→ Bruno via WhatsApp · template D-5",
        texto: '"Oi Maria! Sua fatura de R$ 89,90 vence em 5 dias (10/05). Tá tudo certo como sempre? 🙂"' },
    ]},
  ],
  reguaTimeline: [
    { dia: "D-5", agente: "Bruno", data: "05/05", status: "done" },
    { dia: "D-3", agente: "Bruno", data: "07/05", status: "done" },
    { dia: "D-1", agente: "Bruno", data: "09/05", status: "done" },
    { dia: "D+0", agente: "venc", data: "10/05", status: "venc" },
    { dia: "D+2", agente: "HOJE", data: "12/05", status: "current" },
    { dia: "D+3", agente: "⏸️ pausado", data: "", status: "paused" },
    { dia: "D+7", agente: "⏸️ pausado", data: "", status: "paused" },
    { dia: "D+10", agente: "Rafael", data: "oferta", status: "future" },
    { dia: "D+12", agente: "Carla", data: "notif", status: "future" },
    { dia: "D+15", agente: "⚠️ suspensão", data: "Anatel", status: "warn" },
    { dia: "D+30", agente: "Daniel", data: "anuência", status: "future" },
    { dia: "D+40", agente: "SPC/Serasa", data: "", status: "danger" },
  ],
  auditJulia: [
    { hora: "10/05 19:31", decisao: "APROVADO COM AJUSTE", decisaoClass: "text-amber-700", icon: "⚠️", iconColor: "text-amber-500",
      acao: "Helena.send_freeform_message",
      texto: "Cliente B3 (queda fiel) — sugerido escalar Marcos antes de qualquer cobrança automatizada.",
      fonte: "Régua DNA policy B3.human_intervention_required" },
    { hora: "10/05 19:35", decisao: "APROVADO", decisaoClass: "text-green-700", icon: "✓", iconColor: "text-green-500",
      acao: "Helena.send_freeform_message (resposta inbound)",
      texto: "Janela 24h ativa, sem violações compliance, sentiment recuperando.",
      fonte: "Meta Cloud API janela 24h" },
    { hora: "08/05 14:25", decisao: "BLOQUEADO", decisaoClass: "text-red-700", icon: "✕", iconColor: "text-red-500",
      acao: "Bruno.send_template (lembrete D+1)",
      texto: "Incidente POP-3 ativo (90 min) — não cobrar enquanto cliente está sem serviço.",
      fonte: "CDC art. 42 + boa-fé objetiva" },
    { hora: "05/05 08:30", decisao: "APROVADO", decisaoClass: "text-green-700", icon: "✓", iconColor: "text-green-500",
      acao: "Bruno.send_template_d_menos_5",
      texto: "Horário válido, perfil B3 permite lembrete preventivo, sem flags ativas.",
      fonte: "Régua DNA + horário comercial" },
  ],
};

// ─── COMPONENT ──────────────────────────────────────────────────────────────
export default function Cliente360CobrancaPage() {
  const [, params] = useRoute("/cliente/:customerId/360-cobranca");
  const customerId = params?.customerId ?? "?";

  // Fetch dados REAIS do cliente. Onde não tem, usa MOCK_DATA como placeholder.
  const { data: realResp } = useQuery<{ ok: boolean; data?: any }>({
    queryKey: [`/api/customers/${customerId}/cliente-360`],
    enabled: !!customerId && customerId !== "?",
    staleTime: 60_000,
  });
  const real = realResp?.ok ? realResp.data : null;

  // Merge: real → sobrescreve mock onde existe
  const d = real ? mergeRealIntoMock(MOCK_DATA, real) : MOCK_DATA;

  return (
    <div className="min-h-screen" style={{ fontFamily: "DM Sans, system-ui, sans-serif", backgroundColor: "#FBF7F2", color: "#0A1628" }}>
      {/* Status banner: real (verde) ou mock fallback (âmbar) */}
      {real ? (
        <div className="bg-emerald-700 text-white text-xs py-1.5 px-4 text-center">
          ✅ Dados REAIS do cliente #{customerId} ({real.cliente.nome}) · Perfil DNA: <strong>{real.perfilDna.atual}</strong> (heurística, Spec 010A Fase B trará modelo treinado) · Predições ML / Audit Júlia / Timeline / Alertas Críticos / Status NMS = <strong>placeholder</strong> até specs respectivas
        </div>
      ) : (
        <div className="bg-amber-500 text-white text-xs py-1.5 px-4 text-center">
          🧪 Carregando dados reais... (fallback temporário: Maria Silva Souza mockada). Cliente real: <Link href={`/cliente/${customerId}/dossie`} className="underline font-semibold">/cliente/{customerId}/dossie</Link>
        </div>
      )}

      {/* HEADER DO CLIENTE (sticky) */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-semibold text-xl" style={{ background: "linear-gradient(to bottom right, #1F6B4A, #0F3D2E)", fontFamily: "Fraunces, serif" }}>
                MS
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h1 className="font-semibold text-2xl text-[#0A1628]" style={{ fontFamily: "Fraunces, serif" }}>{d.customer.nome}</h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-700 text-xs font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                    {d.perfilDna.atual} — Quadrante Crítico
                  </span>
                  <span className="text-xs text-[#3D5278] font-medium">era {d.perfilDna.anterior30d} há 30 dias</span>
                </div>
                <div className="text-sm text-[#3D5278] flex items-center gap-4 flex-wrap">
                  <span className="font-mono text-xs">CPF {d.customer.cpfMasked}</span>
                  <span>• {d.customer.idade} anos</span>
                  <span>• 📍 {d.customer.bairro}, {d.customer.cidade}/{d.customer.uf}</span>
                  <span>• 📞 {d.customer.telefoneMasked}</span>
                  <span>• ✉️ {d.customer.email}</span>
                </div>
                <div className="text-xs text-[#3D5278] mt-1">
                  Cliente desde {d.customer.clienteDesde} ({d.customer.tempoRelacaoMeses} meses) · Carteira <strong className="text-[#1F3050]">{d.customer.carteira}</strong> · Operador <strong className="text-[#1F3050]">{d.customer.operador}</strong>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">📋 Histórico</button>
              <button className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">💬 Conversas</button>
              <button className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">⚖️ Compliance</button>
              <button className="px-3 py-2 text-sm rounded-md text-white font-medium hover:opacity-90" style={{ backgroundColor: "#0F3D2E" }}>✅ Ações</button>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-8 flex-wrap">
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Saldo Devedor</div>
              <div className="font-semibold text-2xl text-[#0A1628] mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>R$ {Math.floor(d.financeiro.saldoDevedor)}<span className="text-lg">,{String(Math.round((d.financeiro.saldoDevedor % 1) * 100)).padStart(2, "0")}</span></div>
              <div className="text-xs text-amber-700 font-medium">{d.financeiro.faturasAberto} faturas em aberto</div>
            </div>
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Mais Antiga</div>
              <div className="font-semibold text-2xl text-amber-700 mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>{d.financeiro.maisAntiga}</div>
              <div className="text-xs text-[#3D5278]">venc. {d.financeiro.venceuEm}</div>
            </div>
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Status</div>
              <div className="inline-flex items-center gap-1.5 mt-0.5 px-2.5 py-1 rounded-md bg-green-100 text-[#0F3D2E] text-sm font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Ativo
              </div>
              <div className="text-xs text-[#3D5278] mt-1">link conectado</div>
            </div>
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Última Interação</div>
              <div className="text-sm font-medium text-[#0A1628] mt-0.5">há 2 dias</div>
              <div className="text-xs text-[#3D5278]">WhatsApp inbound · sentiment <span className="text-amber-700">-0.1</span></div>
            </div>
            <div className="ml-auto">
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">ROI Cobrança</div>
              <div className="font-semibold text-2xl text-[#1F6B4A] mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>30.6×</div>
              <div className="text-xs text-[#1F6B4A] font-medium">recuperação humana</div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="max-w-[1440px] mx-auto px-6 py-6">

        {/* ALERTA QUEDA FIEL */}
        <div className="mb-6 rounded-lg border-2 border-amber-500 bg-amber-100 p-4 flex items-start gap-3">
          <div className="text-2xl">⚠️</div>
          <div className="flex-1">
            <div className="font-semibold text-amber-700">Queda de Fiel Detectada — A3 → B3</div>
            <div className="text-sm text-[#1F3050] mt-1">
              {d.customer.nome.split(" ")[0]} pagou em dia por <strong>{d.customer.tempoRelacaoMeses} meses</strong> sem nenhum atraso significativo. Esta é a <strong>primeira vez</strong> que atrasa mais de 7 dias. Marcos recomenda: <strong>humano ligar pessoalmente nas próximas 24h</strong>. Cobrança automatizada está pausada.
            </div>
            <div className="flex gap-2 mt-2">
              <button className="px-3 py-1.5 text-sm rounded-md bg-amber-700 text-white font-medium hover:bg-amber-500">Atribuir task a Carlos</button>
              <button className="px-3 py-1.5 text-sm rounded-md border border-amber-700 text-amber-700 font-medium hover:bg-amber-50">Ver histórico fidelidade</button>
            </div>
          </div>
          <button className="text-[#3D5278] hover:text-[#0A1628]">×</button>
        </div>

        {/* LAYOUT 2 COLUNAS */}
        <div className="grid grid-cols-12 gap-6">

          {/* COLUNA ESQUERDA (40%) */}
          <div className="col-span-5 space-y-6">

            {/* ALERTAS CRÍTICOS */}
            <Card>
              <CardTitle right={<span className="text-amber-700 font-mono normal-case">{d.alertasCriticos.length} ativos</span>}>⚠️ Alertas Críticos</CardTitle>
              <div className="space-y-3">
                {d.alertasCriticos.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 ${i < d.alertasCriticos.length - 1 ? "pb-3 border-b border-gray-100" : ""}`}>
                    <span className={`text-xl leading-none ${a.tipo === "queda_fiel" || a.tipo === "vulneravel_suspeito" ? "text-amber-500" : "text-[#3D5278]"}`}>{a.icon}</span>
                    <div className="flex-1">
                      <div className="font-medium text-sm text-[#0A1628]">{a.titulo}</div>
                      <div className="text-xs text-[#3D5278] mt-0.5">{a.desc}{a.detectado && <span className="text-amber-700"> Detectado {a.detectado}</span>}</div>
                      {a.tipo === "vulneravel_suspeito" && <button className="text-xs text-[#1F6B4A] font-medium mt-1 hover:underline">Confirmar vulnerável</button>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* RÉGUA DNA */}
            <Card>
              <CardTitle right={<span className="px-2 py-0.5 rounded text-xs font-mono bg-amber-100 text-amber-700 normal-case">{d.perfilDna.atual}</span>}>🎯 Régua DNA — Perfil Aplicado</CardTitle>
              {/* Matriz 3x3 */}
              <div className="grid grid-cols-3 gap-1 mb-4">
                {["A1","A2","A3","B1","B2","B3","C1","C2","C3"].map(p => {
                  const isEra = p === d.perfilDna.anterior30d;
                  const isCurrent = p === d.perfilDna.atual;
                  const row = p[0]; // A/B/C
                  const baseBg = row === "A" ? "bg-green-100 text-[#0F3D2E]" : row === "B" ? (isCurrent ? "bg-amber-500 text-white font-bold animate-pulse" : "bg-amber-100 text-amber-700") : "bg-red-100 text-red-700";
                  const border = isCurrent ? "border-2 border-amber-700" : isEra ? "border-2 border-green-500" : "border border-current/10";
                  return (
                    <div key={p} className={`aspect-square rounded flex items-center justify-center text-xs font-mono ${baseBg} ${border} relative`}>
                      {p}
                      {isEra && <span className="absolute top-0 right-0 text-[8px] text-[#1F6B4A]">era</span>}
                      {isCurrent && <span className="absolute top-0 right-0 text-[8px] text-white">●</span>}
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-amber-700 font-medium mb-3 text-center">⚠️ Quadrante crítico — fiel virou oscilante</div>
              <div className="space-y-2.5 text-sm">
                <Row label="Tom" value={d.perfilDna.tom} />
                <Row label="Cadência" value={d.perfilDna.cadencia} />
                <Row label="Canal primário" value={d.perfilDna.canalPrimario} />
                <Row label="Canal fallback" value={d.perfilDna.canalFallback} />
                <Row label="Desconto máximo" value={`${d.perfilDna.descontoMax}%`} />
                <Row label="Parcelas máximas" value={`${d.perfilDna.parcelasMax}×`} />
                <div className="flex justify-between items-start gap-2">
                  <span className="text-[#3D5278]">Oferta retenção</span>
                  <span className="font-medium text-[#1F6B4A] text-right text-xs">{d.perfilDna.ofertaRetencao}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-100">
                  <span className="text-[#3D5278]">Humano obrigatório</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-semibold">SIM</span>
                </div>
              </div>
            </Card>

            {/* PREDIÇÕES & SCORES */}
            <Card>
              <CardTitle>📊 Predições & Scores</CardTitle>
              <div className="space-y-3 mb-4">
                <ProbBar label="Prob. pagamento próxima fatura" value={d.predicoes.pagamentoProximaFatura} color="amber" classLabel="MÉDIO" />
                <ProbBar label="Prob. churn 60 dias" value={d.predicoes.churn60d} color="red" classLabel="ALTO — atenção retenção" />
                <ProbBar label="Prob. Procon 30 dias" value={d.predicoes.procon30d} color="green" classLabel="BAIXO" />
              </div>
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                <Kpi label="LTV 24m" value={`R$ ${d.predicoes.ltv24m.toLocaleString("pt-BR")}`} color="green" sub="⭐⭐⭐ ouro" subColor="#C9A227" />
                <Kpi label="Consulta ISP" value={String(d.predicoes.consultaIsp)} color="navy" sub="limpo" subColor="#1F6B4A" />
                <Row label="SPC" value="✓ limpo" valueColor="text-[#1F6B4A]" small />
                <Row label="Serasa" value="✓ limpo" valueColor="text-[#1F6B4A]" small />
              </div>
            </Card>

            {/* SITUAÇÃO TÉCNICA */}
            <Card>
              <CardTitle>🔌 Situação Técnica</CardTitle>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#3D5278]">Link</span>
                  <span className="inline-flex items-center gap-1 font-medium text-[#1F6B4A]">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Ativo
                  </span>
                </div>
                <Row label="Sinal ONU" value={<span className="font-mono">{d.statusTecnico.sinalOnu} <span className="text-[#1F6B4A] text-xs">{d.statusTecnico.sinalClass}</span></span>} />
                <Row label="Uptime 30d" value={<span className="font-mono">{d.statusTecnico.uptime30d}</span>} />
                <Row label="POP" value={<span className="font-mono">{d.statusTecnico.pop}</span>} />
                <Row label="Último incidente" value={<span className="text-amber-700">{d.statusTecnico.ultimoIncidente}</span>} />
                <Row label="Chamados abertos" value={<span className="text-[#1F6B4A]">nenhum</span>} />
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-amber-700 bg-amber-100 -mx-2 px-3 py-2 rounded">
                ⚠️ POP-3 caiu 08/05 por 90min. Cliente afetado. Considerar antes de cobrar.
              </div>
            </Card>

            {/* EQUIPAMENTOS */}
            <Card>
              <CardTitle right={<span className="font-mono text-xs normal-case">{d.equipamentos.length} itens</span>}>📦 Equipamentos Comodato</CardTitle>
              <div className="space-y-3">
                {d.equipamentos.map((eq, i) => (
                  <div key={i} className={`flex justify-between items-start text-sm ${i > 0 ? "pt-3 border-t border-gray-100" : ""}`}>
                    <div>
                      <div className="font-medium text-[#0A1628]">{eq.tipo}</div>
                      <div className="text-xs text-[#3D5278] font-mono">{eq.serial}{eq.mac && ` · ${eq.mac}`}</div>
                      <div className="text-xs text-[#3D5278]">Instalado {eq.instalado}{eq.meses && ` (${eq.meses} meses)`}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-semibold text-[#0A1628]">R$ {eq.reposicao}</div>
                      <div className="text-xs text-[#3D5278]">reposição</div>
                      {eq.termo && <div className="text-xs text-[#1F6B4A]">✓ termo</div>}
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-100 flex justify-between items-center text-sm">
                  <span className="text-[#3D5278]">Total se cancelar</span>
                  <span className="font-semibold text-lg text-[#0A1628]" style={{ fontFamily: "Fraunces, serif" }}>R$ {d.equipamentos.reduce((s, e) => s + e.reposicao, 0)},00</span>
                </div>
              </div>
            </Card>

            {/* FLAGS COMPLIANCE */}
            <Card>
              <CardTitle>⚖️ Flags de Compliance</CardTitle>
              <div className="space-y-2 text-sm">
                {d.flagsCompliance.map((f, i) => (
                  <div key={i} className={`flex justify-between items-center py-1.5 ${i < d.flagsCompliance.length - 1 ? "border-b border-gray-100" : ""}`}>
                    <span className="text-[#1F3050]">{f.label}</span>
                    {f.status === "suspeita" ? (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${f.badgeClass}`}>{f.badgeText}</span>
                    ) : f.status === "na" ? (
                      <span className="text-[#8B98B0] text-xs">n/a</span>
                    ) : (
                      <span className="text-[#1F6B4A] text-xs font-medium">{f.customLabel ?? "✓ OK"}</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>

          </div>

          {/* COLUNA DIREITA (60%) */}
          <div className="col-span-7 space-y-6">

            {/* SITUAÇÃO FINANCEIRA */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">Cálculo Anatel 765 art. 88</span>}>💰 Situação Financeira</CardTitle>
              <div className="grid grid-cols-3 gap-4 mb-5 pb-5 border-b border-gray-100">
                <Kpi label="Saldo Devedor" value="R$ 179,80" big />
                <Kpi label="Em Aberto" value="2 faturas" big />
                <Kpi label="Pagas 12m" value="11/12" color="green" big />
              </div>
              <div className="space-y-3">
                {d.financeiro.faturas.map((f, i) => (
                  <div key={i} className={`border rounded-lg p-4 ${f.antiga ? "border-amber-500 bg-amber-100/30" : "border-gray-200"}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-mono text-xs text-[#3D5278]">Fatura #{f.numero}</div>
                        <div className="font-medium text-[#0A1628]">Mensalidade {f.periodo}</div>
                        <div className={`text-xs mt-0.5 ${f.antiga ? "text-amber-700" : "text-[#3D5278]"}`}>Venceu {f.venceu} · <strong>D+{f.diasAtraso}</strong></div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-[#3D5278]">Total atualizado</div>
                        <div className={`font-semibold text-xl ${f.antiga ? "text-amber-700" : "text-[#0A1628]"}`} style={{ fontFamily: "Fraunces, serif" }}>R$ {f.total.toFixed(2).replace(".", ",")}</div>
                      </div>
                    </div>
                    <div className={`grid grid-cols-3 gap-2 text-xs mb-3 pt-3 border-t ${f.antiga ? "border-amber-100" : "border-gray-100"}`}>
                      <div><div className="text-[#3D5278]">Principal</div><div className="font-mono text-sm font-medium">R$ {f.principal.toFixed(2).replace(".", ",")}</div></div>
                      <div><div className="text-[#3D5278]">Multa 2%</div><div className="font-mono text-sm font-medium">R$ {f.multa.toFixed(2).replace(".", ",")}</div></div>
                      <div><div className="text-[#3D5278]">Juros <span className="text-[10px]">({f.diasAtraso}d)</span></div><div className="font-mono text-sm font-medium">R$ {f.juros.toFixed(2).replace(".", ",")}</div></div>
                    </div>
                    <div className="flex gap-2">
                      <button className="flex-1 px-3 py-1.5 text-xs rounded-md text-white font-medium hover:opacity-90" style={{ backgroundColor: "#0F3D2E" }}>Gerar Pix</button>
                      <button className="flex-1 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-[#1F3050] hover:bg-white">2ª via boleto</button>
                      <button className="flex-1 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-[#1F3050] hover:bg-white">Negociar</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-3">Histórico do cliente</div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><div className="text-[#3D5278] text-xs">Último pagamento</div><div className="text-[#0A1628] font-medium">{d.financeiro.ultimoPagamento}</div></div>
                  <div><div className="text-[#3D5278] text-xs">Padrão histórico</div><div className="text-[#0A1628] font-medium">{d.financeiro.padraoHistorico}</div></div>
                  <div><div className="text-[#3D5278] text-xs">Taxa atraso 12m</div><div className="text-[#1F6B4A] font-medium">{d.financeiro.taxaAtraso12m}</div></div>
                  <div><div className="text-[#3D5278] text-xs">Total pago 12m</div><div className="text-[#0A1628] font-medium font-mono">R$ {d.financeiro.totalPago12m.toFixed(2).replace(".", ",")}</div></div>
                </div>
              </div>
            </Card>

            {/* PRÓXIMAS AÇÕES SUGERIDAS */}
            <Card borderLeft="#1F6B4A">
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">por Marcos (Score & Decisão)</span>}>🎬 Próximas Ações Sugeridas</CardTitle>
              {d.proximasAcoes.map((a, i) => (
                <div key={i} className={`rounded-lg p-4 mb-3 ${a.primary ? "bg-green-100 border border-green-500" : "border border-gray-200"}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 ${a.badgeBg} text-white text-[10px] font-bold rounded`}>{a.badge}</span>
                      <span className="font-medium text-[#0A1628]">{a.titulo}</span>
                    </div>
                    {a.roi && <span className={`font-semibold text-lg ${a.primary ? "text-[#1F6B4A]" : "text-[#1F3050]"}`} style={{ fontFamily: "Fraunces, serif" }}>ROI {a.roi}</span>}
                    {a.custo && <span className="text-xs text-[#3D5278]">{a.custo}</span>}
                  </div>
                  <div className="text-sm text-[#1F3050] mb-2">{a.desc}</div>
                  {a.meta && <div className="text-xs text-[#3D5278] mb-3">{a.meta}</div>}
                  <div className="flex gap-2">
                    {a.buttons.map((b, j) => (
                      <button key={j} className={`px-3 py-1.5 text-sm rounded-md font-medium ${
                        b.primary && a.primary ? "bg-[#1F6B4A] text-white hover:bg-[#0F3D2E]" :
                        b.primary ? "bg-[#1F3050] text-white hover:bg-[#0A1628]" :
                        a.primary ? "border border-[#1F6B4A] text-[#1F6B4A] hover:bg-white" :
                        "border border-gray-200 text-[#1F3050] hover:bg-gray-50"
                      }`}>{b.label}</button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs text-red-700 uppercase tracking-wide font-semibold mb-2">❌ Não recomendado agora</div>
                <div className="space-y-1.5 text-sm text-[#3D5278]">
                  {d.naoRecomendado.map((r, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-red-500 mt-0.5">•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* LINHA DO TEMPO */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">últimas 10 de 47</span>}>💬 Linha do Tempo</CardTitle>
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
                {d.timeline.map((day, di) => (
                  <div key={di}>
                    <div className="flex items-center gap-2 text-xs text-[#3D5278] font-semibold mt-2">
                      <div className="flex-1 h-px bg-gray-100"></div>
                      <span>{day.dia}</span>
                      <div className="flex-1 h-px bg-gray-100"></div>
                    </div>
                    {day.items.map((it, ii) => {
                      const borderColor = it.color === "green" ? "border-green-500 bg-green-100/50" : it.color === "amber" ? "border-amber-500 bg-amber-100/30" : it.color === "red" ? "border-red-500 bg-red-100/50" : "border-[#8B98B0] bg-[#8B98B0]/10";
                      const labelColor = it.color === "green" ? "text-[#1F6B4A]" : it.color === "amber" ? "text-amber-700" : it.color === "red" ? "text-red-700" : "text-[#1F3050]";
                      return (
                        <div key={ii} className="flex gap-3 mt-2">
                          <div className="text-xs text-[#3D5278] font-mono w-12 mt-1">{it.hora}</div>
                          <div className={`flex-1 border-l-2 pl-3 py-1 ${borderColor}`}>
                            <div className={`text-xs font-semibold flex items-center gap-1 ${labelColor}`}>
                              {it.label}
                              {it.badge && <span className="ml-1 px-1.5 py-0.5 bg-amber-500 text-white text-[9px] rounded font-bold">{it.badge}</span>}
                            </div>
                            <div className="text-sm text-[#0A1628]">{it.texto}</div>
                            {it.meta && <div className={`text-xs mt-0.5 ${labelColor}`}>{it.meta}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100">
                <button className="text-sm text-[#1F6B4A] font-medium hover:underline">Ver todas 47 interações →</button>
              </div>
            </Card>

          </div>
        </div>

        {/* TIMELINE RÉGUA EM EXECUÇÃO */}
        <div className="mt-6">
          <Card>
            <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">timeline de cobrança</span>}>⚖️ Régua em Execução</CardTitle>
            <div className="relative pt-4 pb-6 px-2">
              <div className="absolute top-12 left-0 right-0 h-0.5 bg-gray-200"></div>
              <div className="relative flex justify-between flex-wrap gap-y-4">
                {d.reguaTimeline.map((step, i) => {
                  const dotClass =
                    step.status === "done" ? "bg-green-500 ring-2 ring-white" :
                    step.status === "venc" ? "bg-red-500 ring-2 ring-white" :
                    step.status === "current" ? "bg-amber-500 ring-4 ring-amber-100 animate-pulse" :
                    step.status === "paused" ? "bg-gray-100 border-2 border-gray-300" :
                    step.status === "warn" ? "bg-white border-2 border-amber-500" :
                    step.status === "danger" ? "bg-white border-2 border-red-500" :
                    "bg-white border-2 border-[#8B98B0]";
                  const labelClass =
                    step.status === "done" ? "text-[#1F6B4A]" :
                    step.status === "venc" ? "text-red-700 font-bold" :
                    step.status === "current" ? "text-amber-700 font-bold" :
                    step.status === "paused" ? "text-[#8B98B0]" :
                    step.status === "warn" ? "text-amber-700 font-medium" :
                    step.status === "danger" ? "text-red-700 font-medium" :
                    "text-[#3D5278]";
                  return (
                    <div key={i} className="flex flex-col items-center w-16">
                      <div className={`text-xs mb-1 ${labelClass}`}>{step.dia}</div>
                      <div className={`w-3 h-3 rounded-full ${dotClass}`}></div>
                      <div className={`text-[10px] text-center mt-2 ${labelClass}`}>{step.agente}<br/>{step.data}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div>
                <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-2">Pausa ativa</div>
                <div className="bg-amber-100 border border-amber-500 rounded-md p-3 text-sm">
                  <div className="font-semibold text-amber-700">⏸️ Régua pausada 7 dias</div>
                  <div className="text-xs text-[#1F3050] mt-1">Motivo: sinal vulnerável suspeita + queda fiel A3→B3</div>
                  <div className="text-xs text-[#3D5278] mt-1">Pausa de 12/05 até 19/05</div>
                  <div className="text-xs text-[#3D5278]">Agentes pausados: Bruno, Carla, Daniel</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-2">Próximos marcos</div>
                <div className="text-sm space-y-1 text-[#1F3050]">
                  <div>📅 <strong>13/05</strong> — Carlos liga (task humana)</div>
                  <div>📅 <strong>15/05</strong> — Rafael oferece downgrade (auto se humano não resolveu)</div>
                  <div>📅 <strong>22/05</strong> — Carla notificação prévia Anatel (se persistir)</div>
                  <div>📅 <strong>25/05</strong> — Carla suspensão D+15 (Júlia gate)</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* AUDITORIA RECENTE */}
        <div className="mt-6">
          <Card className="bg-[#FBF7F2] border-[#F5EDE0]">
            <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">últimas {d.auditJulia.length} de 47 decisões neste cliente</span>}>🛡️ Auditoria Recente — Decisões da Júlia</CardTitle>
            <div className="space-y-3">
              {d.auditJulia.map((aj, i) => (
                <div key={i} className={`flex items-start gap-3 ${i < d.auditJulia.length - 1 ? "pb-3 border-b border-gray-100" : ""}`}>
                  <span className={`text-lg ${aj.iconColor}`}>{aj.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 text-sm flex-wrap">
                      <span className="font-mono text-xs text-[#3D5278]">{aj.hora}</span>
                      <span className={`font-semibold ${aj.decisaoClass}`}>{aj.decisao}</span>
                      <span className="text-[#1F3050]">{aj.acao}</span>
                    </div>
                    <div className="text-sm text-[#1F3050] mt-1">{aj.texto}</div>
                    <div className="text-xs text-[#3D5278] mt-1">Fonte: <code className="bg-[#F5EDE0] px-1.5 py-0.5 rounded font-mono text-[11px]">{aj.fonte}</code></div>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-4 text-sm text-[#1F6B4A] font-medium hover:underline">Ver todas decisões neste cliente (47) →</button>
          </Card>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 flex items-center justify-between text-xs text-[#3D5278] flex-wrap gap-2">
          <div>Provedor.AI · Cliente 360° Cobrança v1.0 (DEMO) · <span className="font-mono">cliente_id: {customerId}</span></div>
          <div>Última sincronização: <span className="font-mono">12/05/2026 08:31:00</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Merge dados reais sobre mock ──────────────────────────────────────────
function mergeRealIntoMock(mock: typeof MOCK_DATA, real: any): typeof MOCK_DATA {
  if (!real?.cliente) return mock;
  const r = real;
  return {
    ...mock,
    customer: {
      ...mock.customer,
      nome: r.cliente.nome ?? mock.customer.nome,
      cpfMasked: r.cliente.cpfMasked ?? mock.customer.cpfMasked,
      bairro: r.cliente.bairro ?? mock.customer.bairro,
      cidade: r.cliente.cidade ?? mock.customer.cidade,
      uf: r.cliente.uf ?? mock.customer.uf,
      telefoneMasked: r.cliente.phoneMasked ?? mock.customer.telefoneMasked,
      email: r.cliente.email ?? mock.customer.email,
      tempoRelacaoMeses: r.cliente.tempoRelacaoMeses ?? mock.customer.tempoRelacaoMeses,
      clienteDesde: r.cliente.clienteDesdeIso ? new Date(r.cliente.clienteDesdeIso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : mock.customer.clienteDesde,
    },
    perfilDna: {
      ...mock.perfilDna,
      atual: r.perfilDna?.atual ?? mock.perfilDna.atual,
      tom: r.perfilDna?.tom ?? mock.perfilDna.tom,
      canalPrimario: r.perfilDna?.canalPrimario ?? mock.perfilDna.canalPrimario,
      descontoMax: r.perfilDna?.descontoMax ?? mock.perfilDna.descontoMax,
      humanoObrigatorio: r.perfilDna?.humanoObrigatorio ?? mock.perfilDna.humanoObrigatorio,
    },
    financeiro: {
      ...mock.financeiro,
      saldoDevedor: r.financeiro?.saldoDevedor ?? mock.financeiro.saldoDevedor,
      faturasAberto: r.financeiro?.faturasAberto ?? mock.financeiro.faturasAberto,
      maisAntiga: r.financeiro?.maxDiasAtraso ? `D+${r.financeiro.maxDiasAtraso}` : mock.financeiro.maisAntiga,
    },
    equipamentos: (r.equipamentos && r.equipamentos.length > 0)
      ? r.equipamentos.map((eq: any) => ({
          tipo: [eq.tipo, eq.marca, eq.modelo].filter(Boolean).join(" ") || eq.tipo,
          serial: eq.serial ?? "",
          mac: eq.mac,
          instalado: "—",
          reposicao: eq.valorReposicao ?? 0,
          termo: true,
        }))
      : mock.equipamentos,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function Card({ children, className = "", borderLeft }: { children: React.ReactNode; className?: string; borderLeft?: string }) {
  return (
    <div className={`bg-white border border-[#F0F0F0] rounded-xl p-5 hover:shadow-md transition-shadow ${borderLeft ? "border-l-4" : ""} ${className}`} style={borderLeft ? { borderLeftColor: borderLeft } : {}}>
      {children}
    </div>
  );
}

function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-[#3D5278] mb-3 flex items-center justify-between">
      <span>{children}</span>
      {right}
    </div>
  );
}

function Row({ label, value, valueColor = "text-[#0A1628]", small = false }: { label: string; value: React.ReactNode; valueColor?: string; small?: boolean }) {
  if (small) {
    return (
      <div>
        <div className="text-xs text-[#3D5278] uppercase tracking-wide">{label}</div>
        <div className={`font-medium text-sm ${valueColor}`}>{value}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-between">
      <span className="text-[#3D5278]">{label}</span>
      <span className={`font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}

function ProbBar({ label, value, color, classLabel }: { label: string; value: number; color: "green" | "amber" | "red"; classLabel: string }) {
  const barColor = color === "green" ? "bg-green-500" : color === "amber" ? "bg-amber-500" : "bg-red-500";
  const labelColor = color === "green" ? "text-[#1F6B4A]" : color === "amber" ? "text-amber-700" : "text-red-700";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#3D5278]">{label}</span>
        <span className="font-mono font-semibold text-[#0A1628]">{value}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full`} style={{ width: `${value}%` }}></div>
      </div>
      <div className={`text-xs ${labelColor} mt-0.5`}>{classLabel}</div>
    </div>
  );
}

function Kpi({ label, value, color = "navy", sub, subColor, big = false }: { label: string; value: string; color?: "green" | "navy" | "red" | "amber"; sub?: string; subColor?: string; big?: boolean }) {
  const valueColor = color === "green" ? "text-[#1F6B4A]" : color === "red" ? "text-red-700" : color === "amber" ? "text-amber-700" : "text-[#0A1628]";
  return (
    <div>
      <div className="text-xs text-[#3D5278] uppercase tracking-wide">{label}</div>
      <div className={`font-semibold ${big ? "text-2xl mt-1" : "text-lg"} ${valueColor}`} style={{ fontFamily: "Fraunces, serif" }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: subColor }}>{sub}</div>}
    </div>
  );
}
