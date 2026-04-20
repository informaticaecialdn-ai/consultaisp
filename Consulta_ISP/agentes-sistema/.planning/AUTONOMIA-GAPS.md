# Analise honesta — o que falta pra autonomia total

Data: 2026-04-20
Estado atual: `heatmap-fix` branch

Objetivo: mapear **todo** gap que impede o sistema de rodar 24h sem
intervencao humana, por agente. Prioridade honesta (P0=critico, P3=nice-to-have).

---

## Resumo executivo

### O que ja e autonomo
- **Prospeccao**: Apify Google Maps cron seg/qua/sex → validator → leads auto
- **Enrichment**: Apify contact-info + ReceitaWS + ERP detector cron diario
- **Cold outbound Carla**: cron 2h em horario comercial BR
- **Inbound conversation**: orchestrator + platform-agent-client com 17 tools
- **Handoff Carla→Lucas→Rafael**: automatico por score
- **Supervisao Iani**: cron 1h monitora funil + reassign_stuck
- **Auto-healing**: kill switches por custo/erro/Z-API down
- **Midia paga Marcos**: cron diario pode criar/pausar/escalar campanhas

### O que NAO e autonomo (gaps reais)
Listados abaixo por agente e categoria.

---

## POR AGENTE — gaps por persona

### Carla (SDR)  —  95% autonoma
- [P2] **Detecta concorrente mencionado** — Hoje ignora. Deveria tagear no
  lead ("mencionou Brisanet") pra Lucas usar no pitch.
- [P2] **Respeita horario de resposta do lead** — Se lead so responde sabado,
  Carla deveria agendar followup pra sabado, nao mandar durante a semana.
- [P3] **Audio/imagem WhatsApp** — Carla so processa texto. Cliente manda
  audio = ignorado.

### Lucas (Vendas)  —  80% autonoma
- [P0] **Gera proposta em PDF automaticamente** — Hoje tool `create_proposal`
  so registra em tarefa. Falta integrar `pdf-report.js` pra gerar PDF real e
  enviar via Z-API documento.
- [P1] **Agenda demo automaticamente** — Nao tem integracao com Google
  Calendar ou Calendly. Lucas diz "vamos marcar", mas marca em que? Falta
  tool `schedule_demo` que cria evento real.
- [P1] **Calcula ROI com dados reais do lead** — ROI calculator da skill
  assume valores genericos. Se lead informou num_clientes e ticket medio
  via enrich_lead, Lucas deveria usar ESSES numeros.

### Rafael (Closer)  —  60% autonoma
- [P0] **Gera contrato PDF** — Tool `mark_closed_won` requer contrato_pdf_url
  em producao, mas NADA gera o PDF. Precisa integracao com template de
  contrato (tipo DocuSign ou ClickSign ou template estatico preenchido).
- [P0] **Cria cobranca Asaas/Stripe** — Fechou lead? Cadastra cobranca onde?
  Integracao com Asaas (app principal Consulta ISP ja tem) seria natural.
- [P1] **Reativa lead com boleto vencido** — Se Asaas webhook avisa
  inadimplencia do proprio cliente, Rafael deveria fazer save automatico
  (1 followup, senao escalar Iani).

### Sofia (Marketing)  —  40% autonoma
- [P0] **Cron semanal de estrategia** — Hoje Sofia so e invocada se Iani
  delegar ou operador chamar. Deveria ter worker `sofia-strategy.js` cron
  domingo 20h analisando cobertura por mesorregiao e decidindo:
  - ativar nova mesorregiao no prospector
  - pedir copy nova pro Leo se engagement caiu
  - sugerir budget Marcos
- [P1] **ICP refinement dinamico** — Sofia deveria analisar quais porte/
  ERP/regiao tem maior conversao e sugerir ajustes no prospector_config
  automaticamente.
- [P2] **Email sequence nurturing** — Sofia tem skills de nurturing mas
  NAO envia email (sem email-sender integrado). Resend (ja configurado
  opcional) + sequence de 5 emails.

### Leo (Copywriter)  —  20% autonoma
- [P0] **Gera ad creatives automaticamente** — Hoje Leo so responde on-demand.
  Deveria ter tool `generate_ad_creative(mesorregiao, objetivo)` que Marcos
  chama ao criar campanha nova. Sem isso, Marcos cria campanha sem ad.
- [P1] **A/B test de copy** — Tabela `ab_tests` existe mas nao ha
  gerador automatico de variantes pelo Leo. Deveria criar 3 variantes
  de uma copy quando solicitado.
- [P1] **Landing page specifica por mesorregiao** — Hoje aponta tudo pra
  mesma landing. Leo deveria poder gerar landing regional (via tool
  `create_landing_regional(cidade, mesorregiao)`) — mesmo que estatica
  em /landings/:slug servida pelo nginx.

### Marcos (Midia Paga)  —  70% autonoma  [NOVO commit]
- [P0] **Tokens Meta/Google configurados** — Codigo pronto mas sem OAuth
  ativo em producao. META_ACCESS_TOKEN precisa ser long-lived (60d) e
  ter refresh automatico. GOOGLE_ADS_REFRESH_TOKEN idem.
- [P1] **Creatives via Leo** — Quando Marcos cria campanha, precisa chamar
  `generate_ad_creative` do Leo (tool que nao existe ainda).
- [P2] **Pixel tracking real** — Meta Pixel / Google Ads conversion tag
  precisam estar configurados na landing pra otimizer contar leads.
- [P3] **LinkedIn Ads** — mencionado na doc mas nao implementado.

### Iani (Operacoes)  —  85% autonoma
- [P1] **Delegacao multi-agente real** — Iani hoje so usa reassign/notify/
  pause. Tool `delegate_task({agente, tarefa, prazo})` pra orquestrar
  trabalho dos outros agentes (ex: "Marcos, crie campanha pra [regiao]").
  O service `src/services/supervisor.js` faz isso on-demand, mas worker
  cron nao usa.
- [P2] **Dashboard diario automatico** — Cron 18h BR gera relatorio 3P
  e envia via webhook (Discord/Slack) sem precisar operador pedir.
- [P2] **Detecta anomalias estatisticas** — Hoje usa thresholds fixos
  (CPL > 2x, erro > 5%). Deveria usar z-score sobre historico do lead
  pra flag anomalia real (ex: "queda de 30% nas conversoes vs media").

---

## POR INFRA — gaps tecnicos

### Z-API / WhatsApp  —  CRITICO
- [P0] **Z-API Instance not found** (bloqueador original). Sem isso,
  nenhum envio sai. Sistema todo depende.
- [P1] **Templates HSM cadastrados no Meta** — Pra janela 24h fechada,
  Carla precisa enviar template aprovado. Hoje zero templates cadastrados
  na Meta Business.
- [P1] **Numero verificado Green Tick** — WhatsApp com tick verde e
  melhor taxa de entrega. Hoje usa numero comum.

### ERPs (conexao real pros clientes)  —  ALTO
- [P0] **IXC connector producao** — Existe teste mostrou 6331 inadimplentes
  em 256ms, mas precisa ser ativado por provedor cliente (nao nos agentes).
  Quando fechamos lead, precisa agendar configuracao do connector.
- [P1] **MK/SGP/Hubsoft/Voalle/RBX connectors** — Stubs existem
  (server/erp-connector.ts no app principal), mas nao testados em producao.
  Onboarding apos fechamento exige isso.

### Pagamento / Cobranca  —  ALTO
- [P0] **Asaas integration no agentes-sistema** — Main app tem Asaas.
  Rafael precisa criar cobranca apos fechamento. Tool ausente.
- [P2] **Retry de boleto vencido** — Se cliente nao paga, Rafael deveria
  reativar (1 followup apos 3 dias).

### Landing Pages  —  MEDIO
- [P1] **Landing page dinamica por mesorregiao** — Hoje aponta pra homepage
  generica. "Prospector Internet em Pouso Alegre" deveria ter landing
  local com cases regionais.
- [P2] **Captura inbound** — Sem form de lead na landing, trafego pago
  sem conversao. Integrar com Meta Lead Ads ou form Webflow → webhook.

### Observabilidade  —  BAIXO
- [P2] **Alertas Slack/Discord automaticos** — Hoje notify_operator gera
  entry em errors_log. Deveria disparar webhook externo automaticamente
  quando severity=critical.
- [P3] **Grafana/Prometheus** — Metricas agregadas via painel externo.

### Segurança  —  BAIXO
- [P2] **Rotacao automatica de API keys** — Claude/Apify/ReceitaWS keys
  nao rotacionam. Se vazar, operador precisa trocar manual.
- [P2] **Audit log de acoes sensitivas** — Quem marcou closed_won? Com
  quais dados? Hoje ta em agent_tool_calls mas sem UI de auditoria.

---

## PRIORIZACAO — o que fazer proximo

### Semana 1 (se ja tem Z-API funcionando)
1. **P0** Gerar contrato PDF no mark_closed_won (Rafael)
2. **P0** Integrar Asaas pra cobranca no Rafael
3. **P0** Tokens Meta/Google OAuth long-lived no .env (Marcos)

### Semana 2
4. **P0** Tool `generate_ad_creative` do Leo (desbloqueia Marcos autônomo real)
5. **P1** Tool `schedule_demo` do Lucas (Calendly/Google Cal)
6. **P1** Worker `sofia-strategy.js` cron semanal

### Semana 3
7. **P1** ICP refinement dinamico (Sofia analisa performance)
8. **P1** Email sequence nurturing (Sofia + Resend)
9. **P1** Landing page dinamica por mesorregiao (Leo + nginx static)

### Semana 4+
10. **P2** Demais items P2 conforme necessidade

---

## Numero real: quanto falta?

**Linhas de codigo estimadas** pra fechar gaps P0+P1:
- Contract PDF + Asaas integration: ~800 LOC (Rafael)
- Leo ad creative + landing generation: ~600 LOC
- Sofia worker + ICP refinement: ~400 LOC
- schedule_demo + Calendly: ~200 LOC
- **Total: ~2000 LOC + 4-6 migrations**

Tempo estimado: **~15-20 dias de trabalho focado** pra cobrir P0+P1 completo.

Estado hoje (Abril 2026): **~75% do caminho da autonomia total** (dos
60% iniciais no Milestone 1). Cada commit subsequente sobe 2-5%.

---

## O que e autonomia 100% impossivel

Seja realista:
- **Decisoes eticas/compliance** (LGPD, TCU) precisam humano
- **Disputas com cliente** (cancelamento forcado, reembolso) precisam humano
- **Aprovacao de contrato no Meta Business** (HSM templates) e manual
- **OAuth inicial** de Meta/Google Ads e handshake humano
- **Resposta a reclamacoes severas** (reclame aqui, procon) precisa humano

Autonomia real = **95%+ operacional**, com humano intervindo no nao-previsto.
Nao 100% idealizado.
