/**
 * Cliente 360º Recuperação Pós-Cancelamento — replica visual exato do
 * mockup-recuperacao.html (specs/012-5-cliente-360-cobranca/).
 *
 * IMPORTANTE: dados MOCKADOS (cliente fictícia Maria Silva Souza, cancelada
 * há 28 dias, R$ 543 dívida total, 5 estágios Daniel + workflow Lucas paralelo).
 * Backend real será construído nas Specs 012/013/014.
 */
import { useRoute, Link } from "wouter";

const MOCK = {
  customer: {
    nome: "Maria Silva Souza",
    cpfMasked: "123.***.**-12",
    idade: 45,
    bairro: "Centro",
    cidade: "Cambé",
    uf: "PR",
    telefoneMasked: "+55 11 *****1234",
    email: "maria@exemplo.com",
    foiClienteMeses: 35,
    dataInicio: "Ago/2023",
    dataFim: "Jul/2026",
    canceladoEm: "15/07/2026",
    diasDesdeCancelamento: 28,
    motivo: "rescisão automática Anatel D+60",
    perfilNoCancelamento: "C2",
    carteira: "Recuperação Cambé",
    operador: "João Recuperação",
  },
  header: {
    dividaTotal: 543.00,
    dividaFinanceira: 288.00,
    dividaEquipamento: 255.00,
    estagioAtual: "2/5",
    estagioNome: "pré-negativação",
    diasUteisRestantes: 3,
    probRecuperacao: 18,
    roiRecuperacao: 1.46,
    decisao: "PROSSEGUIR até Estágio 3",
  },
  alertas: {
    vulneravel: {
      titulo: "Sinal Vulnerável Suspeito (Lei 14.181)",
      data: "15/06/2026",
      declaracao: "estou desempregado",
      contexto: "durante negociação ativa (14 dias antes do cancelamento)",
      naoConfirmado: true,
    },
    revenda: {
      titulo: "Suspeita de Revenda Ilegal do Equipamento",
      mac: "AA:BB:CC:DD:EE:FF",
    },
  },
  postMortem: {
    categoria: "Inadimplência → Rescisão Anatel D+60",
    ofertas: ["3x desconto 20% → recusada", "Downgrade temporário 100Mbps → recusada"],
    ultimaResposta: '"Estou desempregado, não tenho como pagar agora."',
    sentimentBars: [
      { height: 40, color: "#2EA86B" },
      { height: 35, color: "#2EA86B" },
      { height: 25, color: "#E8A020" },
      { height: 15, color: "#E8A020" },
      { height: 10, color: "#C73E3E" },
      { height: 5, color: "#C73E3E" },
    ],
    trajetoria: "+0.1 → -0.7 (deterioração severa)",
    lessonsLearned: [
      "Retenção humana acionada D+45 — talvez tarde demais",
      "Sinal vulnerável (15/06) não confirmado a tempo",
      "C2 com queda sentiment severa = preditor de churn",
    ],
  },
  historicoRecuperacao: [
    { data: "20/07", titulo: "Daniel D+5 amigável", oferta: "10% desconto à vista", canal: "WhatsApp", outcome: "Sem resposta" },
    { data: "28/07", titulo: "Daniel D+13 reforço", oferta: "20% desconto à vista", canal: "WhatsApp", outcome: "Sem resposta" },
    { data: "03/08", titulo: "Daniel D+19 última amigável", oferta: "30% desconto à vista OU 6x sem juros", canal: "Tripla", outcome: "Sem resposta" },
    { data: "05/08", titulo: "📋 Anuência Prévia CDC 43§2 + Súmula 359", oferta: "Notificação tripla formal", canal: "WhatsApp + SMS + Email PDF", outcome: "✓ Entrega comprovada · WhatsApp lido 18:30 · Email aberto 06/08 09:00", isAnuencia: true },
  ],
  predicoes: [
    { label: "Prob. pagamento acordo", value: 18, color: "red", classLabel: "BAIXO" },
    { label: "Prob. devolução voluntária equip.", value: 22, color: "amber", classLabel: "BAIXO" },
    { label: "Prob. compra equip. (downsell)", value: 15, color: "amber", classLabel: "BAIXO" },
    { label: "Prob. litígio judicial", value: 8, color: "green", classLabel: "BAIXO" },
    { label: "Prob. reconquista 12m", value: 5, color: "red", classLabel: "MUITO BAIXO" },
  ],
  scoreConsultaIsp: { atual: 380, projetado: 200 },
  decisaoEconomica: {
    valorRecuperar: 543.00,
    probTotal: 18,
    valorEsperado: 97.74,
    custoTotal: 66.80,
    roi: 1.46,
    decisao: "✓ PROSSEGUIR até Estágio 3",
    rationale: "ROI positivo mas marginal. Negativação D+91 tem boa relação custo-benefício. Protesto D+121 só se mantida fundamentação.",
    reavaliarEm: "D+120",
    alternativaPerda: 66.80,
    alternativaValor: 97.74,
  },
  compliance: [
    { label: "Vulnerável (Lei 14.181)", status: "suspeita", text: "⚠️ Suspeita", color: "amber" },
    { label: "Binding (Procon)", status: "ok" },
    { label: "Super endividado (rede)", status: "ok" },
    { label: "Menor de idade", status: "ok" },
    { label: "Prescrição CC 206 §5 I", status: "ok", subtext: "(5 anos)" },
    { label: "Falecido", status: "ok" },
    { label: "Boleto falso circulando", status: "ok", text: "✓ não detectado" },
    { label: "Termo comodato", status: "ok", text: "✓ válido" },
  ],
  dividaFinanceira: {
    total: 288.00,
    diasMaisAntiga: 95,
    venceuMaisAntiga: "10/04/2026",
    prescricao: "5 anos",
    prescricaoData: "10/04/2031",
    faturas: [
      { numero: "4521", periodo: "Abril/2026", venceu: "10/04/2026", dias: 95, principal: 89.90, multa: 1.80, juros: 2.85, total: 94.55, color: "red" },
      { numero: "4587", periodo: "Maio/2026", venceu: "10/05/2026", dias: 65, principal: 89.90, multa: 1.80, juros: 1.95, total: 93.65, color: "red" },
      { numero: "4621", periodo: "Junho/2026", venceu: "10/06/2026", dias: 35, principal: 89.90, multa: 1.80, juros: 1.05, total: 92.75, color: "amber" },
    ],
    anuencia: {
      enviadaEm: "05/08/2026",
      comprovacao: "lida em 05/08 18:30",
      negativarEm: "19/08/2026",
      diasRestantes: 3,
    },
  },
  equipamentos: [
    { tipo: "ONU ZTE F660", serial: "ZTE-XYZ-123", meses: 35, aquisicao: 250, reposicao: 175, oferta: 122.50, revendaIlegal: true, mac: "AA:BB:CC:DD:EE:FF" },
    { tipo: "Roteador TP-Link AC1200", serial: "TPL-789", meses: 35, aquisicao: 120, reposicao: 80, oferta: 56.00, revendaIlegal: false },
  ],
  tentativasLucas: [
    { dia: "15/07", titulo: "Dia 0 — 3 caminhos oferecidos", status: "done", outcome: "sem resposta" },
    { dia: "18/07", titulo: "Dia 3 — reforço com prazo", status: "done", outcome: "sem resposta" },
    { dia: "22/07", titulo: "Dia 7 — downsell compra -10% adicional", status: "current", outcome: "aguardando 6 dias" },
    { dia: "30/07", titulo: "Dia 15 — notificação formal + boleto", status: "future" },
    { dia: "14/08", titulo: "Dia 30 — soma à negativação Daniel", status: "future" },
    { dia: "13/09", titulo: "Dia 60 — avaliar pequenas causas", status: "future" },
  ],
  proximasAcoes: [
    {
      rank: 1, bg: "bg-amber-100 border-amber-500", badge: "RANK 1 ⏳", badgeBg: "bg-amber-700",
      titulo: "Aguardar 3 dias úteis (Súmula 359)", data: "19/08/2026",
      desc: "Anuência prévia enviada 05/08. Prazo mínimo de 10 dias úteis (Súmula 359 STJ + CDC 43§2) vence em 19/08. Júlia bloqueia negativação antes disso.",
      meta: "Agente: Daniel · Tipo: aguardar prazo · Custo: R$ 0",
      fontes: "CDC art. 43 §2 · Súmula 359 STJ",
    },
    {
      rank: 2, bg: "bg-red-100/30 border-red-500", badge: "RANK 2 ⚠️", badgeBg: "bg-red-700",
      titulo: "Lucas notificação formal equipamento", data: "30/07/2026",
      desc: "Dia 15 desde tentativa downsell. Enviar notificação formal R$ 175 (ONU) + R$ 80 (roteador) com boleto + evidência adicional: MAC ativo em outro provedor (revenda ilegal suspeita).",
      meta: "Agente: Lucas · Canal: WhatsApp + SMS + Email · Custo: R$ 1,50",
      action: { label: "Enviar notificação tripla", bg: "bg-red-700" },
    },
    {
      rank: 3, bg: "bg-amber-100/30 border-amber-500", badge: "RANK 3 👤", badgeBg: "bg-amber-700",
      titulo: "Validar vulnerabilidade Lei 14.181",
      desc: 'Cliente declarou "estou desempregado" em 15/06 (14d antes do cancelamento). Não foi confirmado pelo humano. Se confirmar agora, dispensa cobrança (Lei 14.181) e arquiva caso.',
      meta: "Agente: humano jurídico · Tipo: validação manual · Custo: R$ 5",
      fontes: "Lei 14.181/2021 · CDC arts. 54-A a 54-G",
      action: { label: "Atribuir task humano", bg: "border border-amber-700 text-amber-700" },
    },
  ],
  naoRecomendado: [
    "Negativar SPC+Serasa antes de 19/08 — Júlia bloqueia (Súmula 359 STJ)",
    "Cobrança ostensiva diária (CDC art. 42 — anti-fadiga máx 1x/semana)",
    "Protesto cartório antes de D+121 (custo R$ 50, sem retorno garantido)",
    "Cessão a assessoria antes de D+180 (última opção)",
    "Marketing/reconquista neste momento (cliente irritado, score 0.25)",
  ],
  estagiosFunil: [
    { num: 1, status: "done", label: "Estágio 1 ✓", periodo: "D+60→D+75", titulo: "Amigável", sub: "10/20/30% desc." },
    { num: 2, status: "current", label: "Estágio 2 ⏳", periodo: "D+76→D+90", titulo: "Anuência prévia", sub: "CDC 43§2 + Súm. 359" },
    { num: 3, status: "next", label: "Estágio 3 ◯", periodo: "D+91→D+120", titulo: "Negativar SPC", sub: "+ Consulta ISP" },
    { num: 4, status: "future", label: "Estágio 4 ◯", periodo: "D+121→D+180", titulo: "Protesto", sub: "cartório" },
    { num: 5, status: "future", label: "Estágio 5 ◯", periodo: "D+180+", titulo: "Cessão", sub: "ou arquivar" },
  ],
  auditJulia: [
    { hora: "13/08 08:00", decisao: "BLOQUEADO", color: "red", icon: "✕",
      acao: "daniel.incluir_negativacao_spc_serasa",
      texto: "Aguardar 3 dias úteis restantes Súmula 359 STJ. Data mínima: 19/08/2026.",
      fonte: "CDC 43 §2, Súmula 359 STJ" },
    { hora: "05/08 10:00", decisao: "APROVADO", color: "green", icon: "✓",
      acao: "daniel.enviar_anuencia_previa_cdc",
      texto: "Estágio 2 cumprido. 3 tentativas amigáveis sem resposta. Notificação tripla obrigatória OK.",
      fonte: "CDC 43 §2, Súmula 359 STJ, Súmula 404 STJ" },
    { hora: "15/07 16:00", decisao: "APROVADO COM AJUSTE", color: "amber", icon: "⚠️",
      acao: "marcos.iniciar_recuperacao_pos_cancelamento",
      texto: "Cliente possivelmente vulnerável Lei 14.181. Sugerido humano validar antes de cobrança agressiva.",
      fonte: "Lei 14.181/2021" },
  ],
  reconquista: {
    score: 0.25,
    probabilidade: 5,
    razoes: [
      "Cancelou por inadimplência, não voluntário",
      "Sentiment severamente negativo nos últimos 30 dias",
      "Não respondeu nenhuma das 4 tentativas pós-cancelamento",
      'Mencionou "desempregado" — questão financeira não resolvida',
    ],
    estrategia: "PASSIVA",
    quandoVoltar: [
      "Exigir Pix de instalação",
      "3 primeiras mensalidades upfront",
      "Plano básico inicial (R$ 59,90)",
      "Monitoramento 90 dias antes de upgrade",
      "Score ConsultaISP precisa ter melhorado",
    ],
    proibido: [
      "Qualquer comunicação comercial",
      "Telemarketing voluntário",
      'Spam de promoções "vem voltar"',
    ],
  },
};

export default function Cliente360RecuperacaoPage() {
  const [, params] = useRoute("/cliente/:customerId/360-recuperacao");
  const customerId = params?.customerId ?? "?";
  const d = MOCK;

  return (
    <div className="min-h-screen" style={{ fontFamily: "DM Sans, system-ui, sans-serif", backgroundColor: "#FBF7F2", color: "#0A1628" }}>
      {/* Demo banner */}
      <div className="bg-red-500 text-white text-xs py-1.5 px-4 text-center">
        🧪 MODO DEMO — dados mockados (Maria Silva Souza ex-cliente). Backend será construído nas Specs 012/013. Cliente real: <Link href={`/cliente/${customerId}/dossie`} className="underline font-semibold">/cliente/{customerId}/dossie</Link>
      </div>

      {/* HEADER EX-CLIENTE */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-semibold text-xl opacity-70" style={{ background: "linear-gradient(to bottom right, #1F3050, #0A1628)", fontFamily: "Fraunces, serif" }}>MS</div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs">🚫</div>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h1 className="font-semibold text-2xl text-[#0A1628]" style={{ fontFamily: "Fraunces, serif" }}>{d.customer.nome}</h1>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-100 text-red-700 text-xs font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                    EX-CLIENTE
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-mono bg-[#8B98B0]/20 text-[#1F3050]">era {d.customer.perfilNoCancelamento} no cancelamento</span>
                </div>
                <div className="text-sm text-[#3D5278] flex items-center gap-4 flex-wrap">
                  <span className="font-mono text-xs">CPF {d.customer.cpfMasked}</span>
                  <span>• {d.customer.idade} anos</span>
                  <span>• 📍 {d.customer.bairro}, {d.customer.cidade}/{d.customer.uf}</span>
                  <span>• 📞 {d.customer.telefoneMasked}</span>
                  <span>• ✉️ {d.customer.email}</span>
                </div>
                <div className="text-xs text-[#3D5278] mt-1 flex items-center gap-3 flex-wrap">
                  <span>Foi cliente <strong className="text-[#1F3050]">{d.customer.foiClienteMeses} meses</strong> ({d.customer.dataInicio} → {d.customer.dataFim})</span>
                  <span className="text-red-700">• Cancelado em <strong>{d.customer.canceladoEm}</strong> ({d.customer.diasDesdeCancelamento} dias atrás)</span>
                  <span>• Motivo: <strong className="text-[#1F3050]">{d.customer.motivo}</strong></span>
                </div>
                <div className="text-xs text-[#3D5278] mt-1">
                  Carteira <strong className="text-[#1F3050]">{d.customer.carteira}</strong> · Responsável <strong className="text-[#1F3050]">{d.customer.operador}</strong>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">📋 Histórico</button>
              <button className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">⚖️ Compliance</button>
              <button className="px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50 text-[#1F3050]">📦 Equipamentos</button>
              <button className="px-3 py-2 text-sm rounded-md text-white font-medium hover:opacity-90" style={{ backgroundColor: "#1F3050" }}>▶️ Ações Recuperação</button>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-8 flex-wrap">
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Dívida Total</div>
              <div className="font-semibold text-2xl text-red-700 mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>R$ {Math.floor(d.header.dividaTotal)}<span className="text-lg">,00</span></div>
              <div className="text-xs text-[#3D5278]">R$ {d.header.dividaFinanceira} financeiro + R$ {d.header.dividaEquipamento} equip.</div>
            </div>
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Estágio Atual</div>
              <div className="font-semibold text-xl text-amber-700 mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>Estágio {d.header.estagioAtual}</div>
              <div className="text-xs text-amber-700">{d.header.estagioNome}</div>
            </div>
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Pode Negativar</div>
              <div className="font-semibold text-xl text-[#0A1628] mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>{d.header.diasUteisRestantes} dias</div>
              <div className="text-xs text-[#3D5278]">úteis restantes (Súmula 359)</div>
            </div>
            <div>
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">Prob. Recuperação</div>
              <div className="font-semibold text-xl text-amber-700 mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>{d.header.probRecuperacao}%</div>
              <div className="text-xs text-amber-700">BAIXO</div>
            </div>
            <div className="ml-auto">
              <div className="text-xs text-[#3D5278] font-medium uppercase tracking-wide">ROI Recuperação</div>
              <div className="font-semibold text-2xl text-[#1F6B4A] mt-0.5" style={{ fontFamily: "Fraunces, serif" }}>{d.header.roiRecuperacao}×</div>
              <div className="text-xs text-[#1F6B4A] font-medium">{d.header.decisao}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        {/* BANNER DUAL: vulnerável + revenda ilegal */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border-2 border-amber-500 bg-amber-100 p-4 flex items-start gap-3">
            <div className="text-2xl">🛡️</div>
            <div className="flex-1">
              <div className="font-semibold text-amber-700">{d.alertas.vulneravel.titulo}</div>
              <div className="text-sm text-[#1F3050] mt-1">
                Em <strong>{d.alertas.vulneravel.data}</strong>, cliente declarou <em>"{d.alertas.vulneravel.declaracao}"</em> {d.alertas.vulneravel.contexto}. <strong>Não foi confirmado</strong> pelo time humano antes do cancelamento.
              </div>
              <div className="text-xs text-[#3D5278] mt-1">
                Decisão sugerida: <strong>humano validar</strong> se configura Lei 14.181. Se confirmar, <strong>dispensar cobrança</strong> e arquivar com fundamentação.
              </div>
              <div className="flex gap-2 mt-2">
                <button className="px-3 py-1.5 text-sm rounded-md bg-amber-700 text-white font-medium hover:bg-amber-500">Validar com humano</button>
                <button className="px-3 py-1.5 text-sm rounded-md border border-amber-700 text-amber-700 font-medium hover:bg-amber-50">Confirmar e dispensar</button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border-2 border-red-500 bg-red-100 p-4 flex items-start gap-3">
            <div className="text-2xl">🚨</div>
            <div className="flex-1">
              <div className="font-semibold text-red-700">{d.alertas.revenda.titulo}</div>
              <div className="text-sm text-[#1F3050] mt-1">
                MAC <code className="bg-white px-1.5 py-0.5 rounded text-xs font-mono">{d.alertas.revenda.mac}</code> da ONU foi detectado <strong>ativo em outro provedor</strong> via Consulta ISP. Pode ser revenda ilegal ou venda no OLX.
              </div>
              <div className="text-xs text-[#3D5278] mt-1">
                Evidência reforça <strong>cobrança formal do equipamento</strong> e pode justificar pequenas causas posteriormente.
              </div>
              <div className="flex gap-2 mt-2">
                <button className="px-3 py-1.5 text-sm rounded-md bg-red-700 text-white font-medium hover:bg-red-500">Ver detalhes Consulta ISP</button>
                <button className="px-3 py-1.5 text-sm rounded-md border border-red-700 text-red-700 font-medium hover:bg-red-50">Registrar evidência</button>
              </div>
            </div>
          </div>
        </div>

        {/* LAYOUT 2 COLUNAS */}
        <div className="grid grid-cols-12 gap-6">
          {/* COLUNA ESQUERDA */}
          <div className="col-span-5 space-y-6">

            {/* POST-MORTEM */}
            <Card>
              <CardTitle>📉 Análise Post-Mortem</CardTitle>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-[#3D5278]">Categoria</div>
                  <div className="font-medium text-[#0A1628]">{d.postMortem.categoria}</div>
                </div>
                <div className="pt-3 border-t border-gray-100">
                  <div className="text-xs text-[#3D5278]">Ofertas oferecidas (antes do cancelamento)</div>
                  <ul className="text-[#1F3050] mt-1 space-y-0.5">
                    {d.postMortem.ofertas.map((o, i) => <li key={i}>• {o}</li>)}
                  </ul>
                </div>
                <div className="pt-3 border-t border-gray-100">
                  <div className="text-xs text-[#3D5278]">Última resposta do cliente (14 dias antes)</div>
                  <div className="bg-amber-100 border-l-2 border-amber-500 pl-3 py-1.5 mt-1 italic text-[#1F3050] text-xs">
                    "{d.postMortem.ultimaResposta.replace(/^"|"$/g, "")}"
                  </div>
                  <div className="text-xs text-red-700 mt-1">⚠️ Sinal vulnerável Lei 14.181 — não confirmado a tempo</div>
                </div>
                <div className="pt-3 border-t border-gray-100">
                  <div className="text-xs text-[#3D5278] mb-1">Sentiment 30 dias antes do cancelamento</div>
                  <div className="h-8 flex items-end gap-1">
                    {d.postMortem.sentimentBars.map((b, i) => (
                      <div key={i} className="flex-1 rounded-t" style={{ height: `${b.height * 2}%`, backgroundColor: b.color, minWidth: "4px" }}></div>
                    ))}
                  </div>
                  <div className="text-xs text-red-700 mt-1">Trajetória: {d.postMortem.trajetoria}</div>
                </div>
                <div className="pt-3 border-t border-gray-100">
                  <div className="text-xs text-[#3D5278] mb-1">Lessons Learned (para Pedro melhorar prevenção)</div>
                  <ul className="text-xs text-[#1F3050] space-y-1">
                    {d.postMortem.lessonsLearned.map((l, i) => <li key={i}>• {l}</li>)}
                  </ul>
                </div>
              </div>
            </Card>

            {/* HISTÓRICO DE RECUPERAÇÃO */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-red-700 font-semibold">{d.historicoRecuperacao.length} tentativas / 0 respostas</span>}>🗓️ Histórico de Recuperação</CardTitle>
              <div className="space-y-3">
                {d.historicoRecuperacao.map((h, i) => (
                  <div key={i} className={`flex items-start gap-3 ${i < d.historicoRecuperacao.length - 1 ? "pb-3 border-b border-gray-100" : ""}`}>
                    <div className="font-mono text-xs text-[#3D5278] w-12">{h.data}</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#0A1628]">{h.titulo}</div>
                      <div className="text-xs text-[#3D5278]">Oferta: <strong>{h.oferta}</strong> · {h.canal}</div>
                      <div className={`text-xs mt-0.5 ${h.isAnuencia ? "text-[#1F6B4A]" : "text-red-700"}`}>{h.outcome}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* PREDIÇÕES ML */}
            <Card>
              <CardTitle>🎯 Predições ML — Recuperação</CardTitle>
              <div className="space-y-3 mb-4">
                {d.predicoes.map((p, i) => <ProbBar key={i} {...p} />)}
              </div>
              <div className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-[#3D5278] uppercase tracking-wide">Score ConsultaISP</div>
                  <div className="font-semibold text-xl text-amber-700" style={{ fontFamily: "Fraunces, serif" }}>{d.scoreConsultaIsp.atual}</div>
                  <div className="text-xs text-[#3D5278]">cairá para ~{d.scoreConsultaIsp.projetado} ao negativar</div>
                </div>
                <div>
                  <div className="text-xs text-[#3D5278] uppercase tracking-wide">SPC / Serasa</div>
                  <div className="font-medium text-sm text-[#1F6B4A]">✓ limpo</div>
                  <div className="text-xs text-[#3D5278]">por enquanto</div>
                </div>
              </div>
            </Card>

            {/* DECISÃO ECONÔMICA ROI */}
            <Card borderLeft="#1F6B4A">
              <CardTitle>💸 Decisão Econômica (ROI)</CardTitle>
              <div className="space-y-2 text-sm mb-4">
                <Row label="Valor a recuperar" value={<span className="font-mono font-medium">R$ {d.decisaoEconomica.valorRecuperar.toFixed(2).replace(".", ",")}</span>} />
                <Row label="Probabilidade total" value={<span className="font-mono font-medium">{d.decisaoEconomica.probTotal}%</span>} />
                <Row label="Valor esperado" value={<span className="font-mono font-medium text-[#1F6B4A]">R$ {d.decisaoEconomica.valorEsperado.toFixed(2).replace(".", ",")}</span>} />
                <div className="pb-2 border-b border-gray-100"><Row label="Custo total (5 estágios)" value={<span className="font-mono font-medium text-amber-700">R$ {d.decisaoEconomica.custoTotal.toFixed(2).replace(".", ",")}</span>} /></div>
                <div className="flex justify-between text-base pt-1">
                  <span className="font-semibold text-[#0A1628]">ROI estimado</span>
                  <span className="font-semibold text-2xl text-[#1F6B4A]" style={{ fontFamily: "Fraunces, serif" }}>{d.decisaoEconomica.roi}×</span>
                </div>
              </div>
              <div className="bg-green-100 border border-green-500 rounded-md p-3 mb-3">
                <div className="font-semibold text-[#0F3D2E] text-sm">{d.decisaoEconomica.decisao}</div>
                <div className="text-xs text-[#1F3050] mt-1">{d.decisaoEconomica.rationale}</div>
                <div className="text-xs text-[#3D5278] mt-1.5"><strong>Reavaliar após {d.decisaoEconomica.reavaliarEm}</strong> se não recuperar.</div>
              </div>
              <div className="bg-[#F5EDE0] rounded-md p-3 text-xs">
                <div className="font-semibold text-[#1F3050] mb-1">Alternativa: arquivar agora</div>
                <div className="text-[#3D5278]">Perda evitada: <strong>R$ {d.decisaoEconomica.alternativaPerda.toFixed(2).replace(".", ",")}</strong> · Valor não recuperado: <strong>R$ {d.decisaoEconomica.alternativaValor.toFixed(2).replace(".", ",")}</strong></div>
                <div className="text-red-700 mt-1 font-medium">Não recomendado ainda</div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="flex-1 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-[#1F3050] hover:bg-gray-50">Recalcular ROI</button>
                <button className="flex-1 px-3 py-1.5 text-xs rounded-md border border-red-500 text-red-700 hover:bg-red-50">Arquivar caso</button>
              </div>
            </Card>

            {/* COMPLIANCE EX-CLIENTE */}
            <Card>
              <CardTitle>⚖️ Compliance Ex-Cliente</CardTitle>
              <div className="space-y-2 text-sm">
                {d.compliance.map((f, i) => (
                  <div key={i} className={`flex justify-between items-center py-1.5 ${i < d.compliance.length - 1 ? "border-b border-gray-100" : ""}`}>
                    <span className="text-[#1F3050]">{f.label}</span>
                    {f.status === "suspeita" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-semibold">{f.text}</span>
                    ) : (
                      <span className="text-[#1F6B4A] text-xs font-medium">{f.text ?? "✓ OK"} {f.subtext && <span className="text-[#3D5278]">{f.subtext}</span>}</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>

          </div>

          {/* COLUNA DIREITA */}
          <div className="col-span-7 space-y-6">

            {/* DÍVIDA FINANCEIRA */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">{d.dividaFinanceira.faturas.length} faturas em aberto · Anatel 765 art. 88</span>}>💰 Dívida Financeira</CardTitle>
              <div className="grid grid-cols-3 gap-4 mb-5 pb-5 border-b border-gray-100">
                <Kpi label="Total a Cobrar" value={`R$ ${Math.floor(d.dividaFinanceira.total)},00`} color="red" big />
                <Kpi label="Dívida Mais Antiga" value={`D+${d.dividaFinanceira.diasMaisAntiga}`} color="red" big sub={`venc ${d.dividaFinanceira.venceuMaisAntiga}`} />
                <Kpi label="Prescrição" value={d.dividaFinanceira.prescricao} big sub={`até ${d.dividaFinanceira.prescricaoData}`} />
              </div>
              <div className="space-y-3">
                {d.dividaFinanceira.faturas.map((f, i) => (
                  <div key={i} className={`border rounded-lg p-4 ${f.color === "red" ? "border-red-500 bg-red-100/" + (i === 0 ? "30" : "20") : "border-amber-500 bg-amber-100/20"}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-mono text-xs text-[#3D5278]">Fatura #{f.numero} · Mensalidade {f.periodo}</div>
                        <div className={`text-sm ${f.color === "red" ? "text-red-700" : "text-amber-700"}`}>Venceu {f.venceu} · <strong>D+{f.dias}</strong></div>
                      </div>
                      <div className={`font-semibold text-xl ${f.color === "red" ? "text-red-700" : "text-amber-700"}`} style={{ fontFamily: "Fraunces, serif" }}>R$ {f.total.toFixed(2).replace(".", ",")}</div>
                    </div>
                    <div className={`grid grid-cols-3 gap-2 text-xs pt-2 border-t ${f.color === "red" ? "border-red-100" : "border-amber-100"}`}>
                      <div><div className="text-[#3D5278]">Principal</div><div className="font-mono text-sm">R$ {f.principal.toFixed(2).replace(".", ",")}</div></div>
                      <div><div className="text-[#3D5278]">Multa 2%</div><div className="font-mono text-sm">R$ {f.multa.toFixed(2).replace(".", ",")}</div></div>
                      <div><div className="text-[#3D5278]">Juros <span className="text-[10px]">({f.dias}d)</span></div><div className="font-mono text-sm">R$ {f.juros.toFixed(2).replace(".", ",")}</div></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="bg-amber-100 border border-amber-500 rounded-md p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">📋</span>
                    <div className="flex-1">
                      <div className="font-semibold text-amber-700">Anuência Prévia Enviada</div>
                      <div className="text-sm text-[#1F3050] mt-1">Notificação tripla (WhatsApp + SMS + Email PDF) enviada em <strong>{d.dividaFinanceira.anuencia.enviadaEm}</strong>. Comprovação: <strong>{d.dividaFinanceira.anuencia.comprovacao}</strong>.</div>
                      <div className="text-xs text-[#3D5278] mt-1">Fundamentação: <code className="bg-white px-1.5 py-0.5 rounded text-[11px] font-mono">CDC art. 43 §2 + Súmula 359 STJ</code></div>
                      <div className="text-sm text-amber-700 font-medium mt-2">⏳ Negativação liberada em <strong>{d.dividaFinanceira.anuencia.negativarEm}</strong> ({d.dividaFinanceira.anuencia.diasRestantes} dias úteis restantes)</div>
                    </div>
                  </div>
                  <button className="mt-3 w-full px-3 py-2 text-sm rounded-md bg-amber-500 text-white font-medium opacity-50 cursor-not-allowed">🔒 Negativar SPC+Serasa (bloqueado até {d.dividaFinanceira.anuencia.negativarEm.slice(0,5)})</button>
                </div>
              </div>
            </Card>

            {/* DÍVIDA EQUIPAMENTOS LUCAS */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-red-700 font-semibold">{d.equipamentos.length} itens · {d.customer.diasDesdeCancelamento} dias aguardando</span>}>📦 Dívida Equipamentos (Lucas)</CardTitle>
              <div className="grid grid-cols-2 gap-3">
                {d.equipamentos.map((eq, i) => (
                  <div key={i} className={`border ${eq.revendaIlegal ? "border-2 border-red-500 bg-red-100/30" : "border-gray-200"} rounded-lg p-4`}>
                    <div className="text-sm font-semibold text-[#0A1628] mb-1">{eq.tipo}</div>
                    <div className="text-xs text-[#3D5278] font-mono mb-2">{eq.serial} · {eq.meses} meses uso</div>
                    {eq.revendaIlegal && (
                      <div className="bg-red-100 border-2 border-red-500 rounded-md p-2 mb-3 animate-pulse">
                        <div className="text-xs font-bold text-red-700">🚨 REVENDA ILEGAL DETECTADA</div>
                        <div className="text-xs text-[#1F3050] mt-0.5">MAC <code className="font-mono text-[10px]">{eq.mac}</code> ativo em outro provedor</div>
                      </div>
                    )}
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-[#3D5278]">Valor aquisição</span><span className="font-mono">R$ {eq.aquisicao.toFixed(2).replace(".", ",")}</span></div>
                      <div className="flex justify-between"><span className="text-[#3D5278]">Reposição ({eq.meses}m)</span><span className="font-mono font-semibold">R$ {eq.reposicao.toFixed(2).replace(".", ",")}</span></div>
                      <div className="flex justify-between text-amber-700"><span>Oferta compra (-30%)</span><span className="font-mono font-semibold">R$ {eq.oferta.toFixed(2).replace(".", ",")}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-2">Tentativas Lucas</div>
                <div className="space-y-2 text-xs">
                  {d.tentativasLucas.map((t, i) => {
                    const icon = t.status === "done" ? "✓" : t.status === "current" ? "🟡" : "◯";
                    const iconColor = t.status === "done" ? "text-[#1F6B4A]" : t.status === "current" ? "text-amber-500" : "text-[#8B98B0]";
                    const opacity = t.status === "future" ? "opacity-50" : "";
                    const textColor = t.status === "current" ? "text-amber-700" : t.status === "future" ? "text-[#3D5278]" : "text-red-700";
                    return (
                      <div key={i} className={`flex items-center gap-2 ${opacity}`}>
                        <span className={iconColor}>{icon}</span>
                        <span className={t.status === "future" ? "text-[#3D5278]" : "text-[#1F3050]"}><strong>{t.dia}</strong> {t.titulo}</span>
                        {t.outcome && <span className={`ml-auto ${textColor}`}>{t.outcome}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button className="flex-1 px-3 py-2 text-sm rounded-md bg-amber-700 text-white font-medium hover:bg-amber-500">Notificação D+15</button>
                <button className="flex-1 px-3 py-2 text-sm rounded-md border border-red-500 text-red-700 hover:bg-red-50">Pequenas causas</button>
                <button className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-200 text-[#1F3050] hover:bg-gray-50">Arquivar equip.</button>
              </div>
            </Card>

            {/* PRÓXIMAS AÇÕES */}
            <Card borderLeft="#1F3050">
              <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">por Marcos (Score & Decisão)</span>}>🎬 Próximas Ações (Daniel + Lucas coordenados)</CardTitle>
              {d.proximasAcoes.map((a, i) => (
                <div key={i} className={`rounded-lg border p-4 mb-3 ${a.bg}`}>
                  <div className="flex items-start justify-between mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 ${a.badgeBg} text-white text-[10px] font-bold rounded`}>{a.badge}</span>
                      <span className="font-medium text-[#0A1628]">{a.titulo}</span>
                    </div>
                    {a.data && <span className="font-mono text-sm font-semibold text-amber-700">{a.data}</span>}
                  </div>
                  <div className="text-sm text-[#1F3050] mb-2">{a.desc}</div>
                  {a.meta && <div className="text-xs text-[#3D5278]">{a.meta}</div>}
                  {a.fontes && <div className="text-xs text-amber-700 mt-1 font-mono">Fontes: {a.fontes}</div>}
                  {a.action && (
                    <button className={`mt-2 px-3 py-1.5 text-xs rounded-md font-medium ${a.action.bg.startsWith("border") ? a.action.bg + " hover:bg-amber-50" : a.action.bg + " text-white hover:opacity-90"}`}>
                      {a.action.label}
                    </button>
                  )}
                </div>
              ))}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs text-red-700 uppercase tracking-wide font-semibold mb-2">❌ Não Recomendado Agora</div>
                <div className="space-y-1.5 text-sm text-[#3D5278]">
                  {d.naoRecomendado.map((r, i) => (
                    <div key={i} className="flex items-start gap-2"><span className="text-red-500 mt-0.5">•</span><span>{r}</span></div>
                  ))}
                </div>
              </div>
            </Card>

            {/* LOOP CONSULTA ISP - MOAT */}
            <Card borderLeft="#C9A227">
              <CardTitle right={<span className="text-xs normal-case text-[#C9A227] font-bold">⭐ MOAT PRINCIPAL</span>}>🌐 Loop Consulta ISP</CardTitle>
              <div className="bg-[#F5EDE0] rounded-md p-4 mb-3">
                <div className="text-sm font-semibold text-[#0A1628] mb-2">Evento a ser registrado em 19/08/2026:</div>
                <div className="font-mono text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto">
                  <div className="text-[#1F6B4A]">{`// Consulta ISP MCP`}</div>
                  <div className="text-[#1F3050]">
                    <span className="text-amber-700">consulta_isp</span>.<span className="text-[#1F6B4A]">registrar_evento</span>{"({"}<br/>
                    &nbsp;&nbsp;tipo: <span className="text-red-700">"inadimplencia_confirmada"</span>,<br/>
                    &nbsp;&nbsp;cpf_hash: <span className="text-red-700">"SHA256..."</span>,<br/>
                    &nbsp;&nbsp;valor_centavos: <span className="text-[#0A1628]">54300</span>,<br/>
                    &nbsp;&nbsp;data_evento: <span className="text-red-700">"2026-07-15"</span>,<br/>
                    &nbsp;&nbsp;tipo_divida: [<span className="text-red-700">"mensalidade"</span>, <span className="text-red-700">"equipamento"</span>]<br/>
                    {"});"}
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2"><span className="text-green-500">→</span><div className="flex-1 text-[#1F3050]"><strong>Score ConsultaISP</strong> de Maria cairá: <strong className="text-amber-700">380 → ~200</strong></div></div>
                <div className="flex items-start gap-2"><span className="text-green-500">→</span><div className="flex-1 text-[#1F3050]">Outros provedores parceiros consultarão antes de instalar</div></div>
                <div className="flex items-start gap-2"><span className="text-green-500">→</span><div className="flex-1 text-[#1F3050]">Maria precisará pagar <strong>Pix upfront</strong> ou <strong>3 mensalidades antecipadas</strong> em qualquer provedor da rede</div></div>
                <div className="flex items-start gap-2"><span className="text-green-500">→</span><div className="flex-1 text-[#1F3050]">Reduz inadimplência sistêmica do mercado de ISP regional</div></div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 bg-[#F5EDE0]/50 -mx-2 px-3 py-2 rounded">
                <div className="text-xs text-[#C9A227] font-semibold mb-1">⭐ Valor estratégico</div>
                <div className="text-xs text-[#1F3050]">Este é o <strong>moat principal</strong> do Provedor.AI. Quanto mais provedores na rede, mais valioso fica para todos. Cliente que não pagou um, não consegue contratar outro sem antecipar.</div>
              </div>
            </Card>

            {/* POTENCIAL RECONQUISTA */}
            <Card>
              <CardTitle right={<span className="text-xs normal-case text-red-700 font-semibold">Score {d.reconquista.score} / 1.0 — BAIXA</span>}>🔄 Potencial Reconquista</CardTitle>
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[#3D5278]">Probabilidade reconquista 12 meses</span>
                  <span className="font-mono font-semibold text-[#0A1628]">{d.reconquista.probabilidade}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: `${d.reconquista.probabilidade}%` }}></div>
                </div>
              </div>
              <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-2">Razões da baixa probabilidade</div>
              <ul className="text-sm text-[#1F3050] space-y-1.5 mb-4">
                {d.reconquista.razoes.map((r, i) => <li key={i} className="flex items-start gap-2"><span className="text-red-500 mt-0.5">•</span><span>{r}</span></li>)}
              </ul>
              <div className="bg-[#F5EDE0] rounded-md p-3 mb-3">
                <div className="text-xs font-semibold text-[#1F3050] mb-2">Estratégia recomendada: {d.reconquista.estrategia}</div>
                <div className="text-xs text-[#3D5278] mb-2">Aguardar 6-12 meses. Se cliente voltar a procurar:</div>
                <ul className="text-xs text-[#1F3050] space-y-0.5">
                  {d.reconquista.quandoVoltar.map((q, i) => <li key={i}>• {q}</li>)}
                </ul>
              </div>
              <div className="bg-red-100 border border-red-500 rounded-md p-3">
                <div className="text-xs font-semibold text-red-700 mb-1">❌ Ofertas proibidas neste momento</div>
                <ul className="text-xs text-[#1F3050] space-y-0.5">
                  {d.reconquista.proibido.map((p, i) => <li key={i}>• {p}</li>)}
                </ul>
              </div>
            </Card>
          </div>
        </div>

        {/* TIMELINE 5 ESTÁGIOS DANIEL */}
        <div className="mt-6">
          <Card>
            <CardTitle right={<span className="text-xs normal-case text-[#3D5278]">funil pós-cancelamento (D+60 a D+180+)</span>}>⚖️ Timeline 5 Estágios de Recuperação</CardTitle>
            <div className="mb-6">
              <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-3">Daniel (recuperação financeira)</div>
              <div className="relative pt-4 pb-6 px-2">
                <div className="absolute top-12 left-0 right-0 h-0.5 bg-gray-200"></div>
                <div className="relative flex justify-between flex-wrap gap-y-4">
                  {d.estagiosFunil.map((e, i) => {
                    const dotClass =
                      e.status === "done" ? "bg-green-500 ring-2 ring-white" :
                      e.status === "current" ? "bg-amber-500 ring-4 ring-amber-100 animate-pulse" :
                      e.status === "next" ? "bg-white border-2 border-red-500" :
                      "bg-white border-2 border-[#8B98B0]";
                    const labelColor =
                      e.status === "done" ? "text-[#1F6B4A]" :
                      e.status === "current" ? "text-amber-700 font-bold" :
                      e.status === "next" ? "text-red-700" :
                      "text-[#8B98B0]";
                    return (
                      <div key={i} className="flex flex-col items-center w-32">
                        <div className={`text-xs mb-1 font-semibold ${labelColor}`}>{e.label}</div>
                        <div className={`w-3 h-3 rounded-full ${dotClass}`}></div>
                        <div className={`text-[10px] text-center mt-2 font-medium ${labelColor}`}>{e.periodo}<br/>{e.titulo}<br/>{e.sub}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="pt-4 border-t border-gray-100">
              <div className="text-xs text-[#3D5278] uppercase tracking-wide font-semibold mb-3">Lucas (equipamentos) — paralelo</div>
              <div className="flex gap-2 flex-wrap">
                {d.tentativasLucas.map((t, i) => {
                  const cls = t.status === "done" ? "bg-green-100 text-[#1F6B4A] border-green-500" : t.status === "current" ? "bg-amber-100 text-amber-700 border-amber-500 animate-pulse" : "bg-white text-[#3D5278] border-[#8B98B0]";
                  return (
                    <div key={i} className={`border rounded-md px-2 py-1 text-xs ${cls}`}>
                      <strong>{t.dia}</strong>: {t.titulo}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>

        {/* AUDITORIA JÚLIA */}
        <div className="mt-6">
          <Card className="bg-[#FBF7F2] border-[#F5EDE0]">
            <CardTitle>🛡️ Audit Júlia — Decisões neste ex-cliente</CardTitle>
            <div className="space-y-3">
              {d.auditJulia.map((aj, i) => {
                const iconColor = aj.color === "green" ? "text-green-500" : aj.color === "red" ? "text-red-500" : "text-amber-500";
                const decisaoColor = aj.color === "green" ? "text-[#1F6B4A]" : aj.color === "red" ? "text-red-700" : "text-amber-700";
                return (
                  <div key={i} className={`flex items-start gap-3 ${i < d.auditJulia.length - 1 ? "pb-3 border-b border-gray-100" : ""}`}>
                    <span className={`text-lg ${iconColor}`}>{aj.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 text-sm flex-wrap">
                        <span className="font-mono text-xs text-[#3D5278]">{aj.hora}</span>
                        <span className={`font-semibold ${decisaoColor}`}>{aj.decisao}</span>
                        <span className="text-[#1F3050]">{aj.acao}</span>
                      </div>
                      <div className="text-sm text-[#1F3050] mt-1">{aj.texto}</div>
                      <div className="text-xs text-[#3D5278] mt-1">Fonte: <code className="bg-[#F5EDE0] px-1.5 py-0.5 rounded font-mono text-[11px]">{aj.fonte}</code></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 flex items-center justify-between text-xs text-[#3D5278] flex-wrap gap-2">
          <div>Provedor.AI · Cliente 360° Recuperação Pós-Cancelamento v1.0 (DEMO) · <span className="font-mono">cliente_id: {customerId}</span></div>
          <div>Última atualização: <span className="font-mono">13/08/2026 08:30:00</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers (mesmos da tela cobrança) ─────────────────────────────────────
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#3D5278]">{label}</span>
      <span className="text-[#0A1628]">{value}</span>
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

function Kpi({ label, value, color = "navy", sub, big = false }: { label: string; value: string; color?: "green" | "navy" | "red" | "amber"; sub?: string; big?: boolean }) {
  const valueColor = color === "green" ? "text-[#1F6B4A]" : color === "red" ? "text-red-700" : color === "amber" ? "text-amber-700" : "text-[#0A1628]";
  return (
    <div>
      <div className="text-xs text-[#3D5278] uppercase tracking-wide">{label}</div>
      <div className={`font-semibold ${big ? "text-2xl mt-1" : "text-lg"} ${valueColor}`} style={{ fontFamily: "Fraunces, serif" }}>{value}</div>
      {sub && <div className="text-xs mt-0.5 text-[#3D5278]">{sub}</div>}
    </div>
  );
}
