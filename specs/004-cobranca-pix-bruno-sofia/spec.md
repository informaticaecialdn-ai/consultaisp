# Feature Specification: Bruno (preventivo) + Sofia (agradecimento) + Pix dinâmico via gateway de pagamento

**Feature Branch**: `004-cobranca-pix-bruno-sofia`
**Created**: 2026-05-11
**Status**: Draft
**Input**: User description: "Spec 004 — Sofia (Agente de Agradecimento pós-pagamento) + Bruno (Agente Preventivo pré-vencimento) + Integração Asaas para geração e tracking de cobranças Pix. Reaproveitar infra da Spec 003 (WhatsApp via Meta, audit_logs, compliance_checks, agent_memories, encryption). Bruno dispara régua D-3/D-1 pré-vencimento via WhatsApp template + gera Pix dinâmico no Asaas e envia QR Code; Sofia dispara mensagem de agradecimento personalizada quando webhook do Asaas confirma pagamento. Ambos passam por Júlia (compliance veto) antes de enviar."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Bruno reduz inadimplência D+0 com lembrete pré-vencimento e Pix pronto (Priority: P1)

Três dias antes do vencimento, Bruno identifica faturas a vencer no portfólio do provedor, gera uma cobrança Pix dinâmica para cada uma, e envia ao cliente final pelo WhatsApp uma mensagem cordial com o QR Code anexado e o código copia-e-cola. Um dia antes do vencimento, repete o envio para quem ainda não pagou. Toda mensagem é validada pelo agente de compliance (Júlia) antes do envio.

**Why this priority**: É a maior alavanca de redução de inadimplência (D+0) e o único entregável que isoladamente já justifica o módulo — converte fatura "esquecida" em pagamento instantâneo com um clique. Sem esta peça, Sofia (P2) não tem volume relevante para agir.

**Independent Test**: Configurar um provedor de teste com uma fatura vencendo em 3 dias e um cliente com número WhatsApp opt-in. Executar o agendador Bruno. Verificar: (a) cobrança Pix criada no gateway, (b) mensagem com QR Code recebida pelo cliente, (c) registro de auditoria com decisão de compliance, (d) idempotência ao rodar o agendador novamente no mesmo dia.

**Acceptance Scenarios**:

1. **Given** uma fatura do cliente vence em 3 dias e o cliente tem opt-in WhatsApp, **When** o agendador Bruno executa no horário diário configurado, **Then** o sistema gera uma cobrança Pix com vencimento na mesma data da fatura, envia template aprovado com QR Code + copia-e-cola pelo WhatsApp, e registra o envio em audit log com a decisão de Júlia anexada.
2. **Given** uma fatura D-3 já recebeu lembrete Bruno hoje, **When** o agendador executa novamente no mesmo dia, **Then** o sistema NÃO gera novo Pix nem reenvia mensagem (idempotência por janela diária).
3. **Given** uma fatura D-1 cujo cliente já pagou (status "paga"), **When** o agendador Bruno D-1 executa, **Then** o sistema pula o cliente e registra o motivo no log de execução.
4. **Given** uma fatura D-3 em horário fora da janela permitida (08:00–20:00 BRT), **When** Bruno tenta enviar, **Then** Júlia veta o envio com motivo "fora_de_horario" e a mensagem fica em quarentena para a próxima janela.
5. **Given** o cliente registrou opt-out de comunicações, **When** Bruno seleciona faturas D-3, **Then** o cliente é excluído da régua e o motivo é auditado.

---

### User Story 2 — Sofia fecha o ciclo emocional com agradecimento imediato pós-pagamento (Priority: P2)

Quando o gateway confirma o pagamento de uma fatura, Sofia envia em até cinco minutos uma mensagem personalizada de agradecimento ao cliente, reforçando o relacionamento e o tom da marca. A mensagem é validada por Júlia antes do envio. Pagamentos duplicados (webhook reentregue) não geram mensagens duplicadas.

**Why this priority**: Sofia é o "remate emocional" da régua — transforma uma transação financeira em momento de marca. Depende de Bruno (P1) para escala. Sozinho não move o KPI principal (inadimplência), mas eleva NPS e justifica o pricing "humanizado" da plataforma.

**Independent Test**: Disparar um webhook simulado de pagamento confirmado do gateway. Verificar: (a) mensagem de Sofia enviada em < 5min, (b) reprocessar o mesmo webhook não gera segunda mensagem, (c) decisão de Júlia registrada, (d) tom da mensagem alinhado a templates aprovados.

**Acceptance Scenarios**:

1. **Given** o gateway envia webhook de pagamento confirmado para uma fatura existente, **When** o sistema valida assinatura e processa o evento, **Then** Sofia compõe a mensagem de agradecimento, submete a Júlia, e envia via WhatsApp em até 5 minutos do recebimento do webhook.
2. **Given** o gateway reenvia o mesmo webhook (retry), **When** o sistema processa novamente, **Then** Sofia NÃO envia segunda mensagem (idempotência por id do pagamento) e o evento duplicado é registrado.
3. **Given** o pagamento corresponde a fatura sem identificação de provedor válido, **When** o webhook é recebido, **Then** o sistema rejeita o evento com log de erro e não dispara Sofia.
4. **Given** Júlia veta a mensagem de Sofia (ex.: cliente em opt-out registrado entre o pagamento e o envio), **When** o veto ocorre, **Then** a mensagem é descartada com motivo auditado e nenhum envio ocorre.

---

### User Story 3 — Provedor controla, observa e prova compliance da régua (Priority: P3)

O administrador do provedor consegue (a) ativar/desativar Bruno e Sofia independentemente, (b) ver no painel a régua pré-vencimento com faturas-alvo, status de Pix e status de envio, (c) baixar dossiê de auditoria para qualquer cliente/data — incluindo decisões de compliance de Júlia — para defesa em Procon/Anatel.

**Why this priority**: É o que protege o provedor juridicamente e dá visibilidade operacional. Sem o painel, o provedor confia "no escuro" — inviável em um setor regulado (Anatel 765/2023, CDC, LGPD). Não bloqueia o MVP de P1/P2 mas é obrigatório antes de cobrar plano pago.

**Independent Test**: Como admin do provedor, alternar Bruno ON/OFF e Sofia ON/OFF em telas separadas; abrir o painel "Régua Pré-Vencimento" e ver lista de faturas com status Pix e envio; gerar e baixar dossiê de auditoria de um cliente em PDF/JSON.

**Acceptance Scenarios**:

1. **Given** o admin desativa Bruno para o seu provedor, **When** o agendador executa, **Then** nenhuma cobrança Pix é gerada nem mensagem enviada para esse provedor, e a UI exibe o estado "desativado".
2. **Given** existem 200 faturas vencendo nos próximos 3 dias, **When** o admin abre o painel "Régua Pré-Vencimento", **Then** vê linha por fatura com: cliente, valor, vencimento, status Pix (pendente/pago/expirado), status envio Bruno (agendado/enviado/vetado/falha) e timestamp.
3. **Given** um cliente alega que recebeu mensagem fora de horário, **When** o admin gera dossiê de auditoria desse cliente, **Then** o sistema entrega em < 30s um relatório com todas as comunicações do agente, decisões de Júlia (aprovado/vetado + motivo), gateway events e timestamps, suficiente para defesa jurídica.

---

### Edge Cases

- **Cliente recém-criado sem opt-in WhatsApp**: Bruno não envia; registra motivo "sem_optin".
- **Provedor sem gateway de pagamento conectado**: Bruno alerta admin no painel, suspende régua para o provedor até resolver; não emite erro para clientes.
- **Pix gerado mas cliente paga por outro meio (boleto antigo, dinheiro presencial)**: ao receber atualização do gateway de que cobrança foi cancelada/expirada e fatura marcada como paga por canal alternativo, Sofia ainda dispara agradecimento; cobrança Pix é cancelada para evitar pagamento duplicado.
- **Pix expira sem pagamento**: a fatura entra na régua pós-vencimento (Marcos, fora de escopo); Sofia não dispara.
- **Provedor revoga template WhatsApp aprovado no Meta**: envios começam a falhar; sistema sinaliza no painel, abre task para admin, não tenta enviar via canal alternativo (escopo).
- **Webhook do gateway atrasa mais de 5 min**: Sofia ainda envia ao receber, mas SLA "5 min" passa a contar do recebimento, não do pagamento real; isso é registrado para análise.
- **Dois agendadores Bruno disparam em paralelo (race condition)**: locking por fatura+dia garante exatamente uma cobrança Pix gerada.
- **Janela 08:00–20:00 cruza meia-noite UTC**: cálculo de janela usa fuso horário do provedor (estado primário), nunca UTC.
- **Júlia indisponível (timeout)**: mensagem fica em fila "aguardando compliance"; não envia até decisão; alerta admin se atrasar > 15 min.
- **Cliente bloqueou número do provedor no WhatsApp**: Meta sinaliza falha de entrega; sistema registra, não gera erro para o admin a cada mensagem, mas mostra taxa de bloqueio agregada no painel.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST executar diariamente, em horário configurável pelo provedor (default 09:00 local), uma varredura de faturas a vencer em 3 dias (D-3) e em 1 dia (D-1) cujo cliente esteja apto a receber comunicações.
- **FR-002**: O sistema MUST gerar, para cada fatura selecionada por Bruno, uma cobrança Pix dinâmica na conta do gateway do próprio provedor, com vencimento igual ao da fatura e valor igual ao da fatura.
- **FR-003**: O sistema MUST enviar a comunicação Bruno via template WhatsApp aprovado, incluindo: nome do cliente, valor, data de vencimento, QR Code (imagem) e código copia-e-cola.
- **FR-004**: O sistema MUST submeter toda mensagem de Bruno e Sofia à decisão de compliance (agente Júlia) antes do envio; envios sem decisão registrada são bloqueados pela arquitetura.
- **FR-005**: O sistema MUST garantir idempotência da régua: para a mesma fatura, mesmo dia e mesmo passo (D-3 ou D-1), no máximo um Pix é gerado e uma mensagem é enviada.
- **FR-006**: O sistema MUST persistir a vinculação cobrança Pix ↔ fatura ↔ cliente ↔ provedor.
- **FR-007**: O sistema MUST processar webhooks de pagamento do gateway com verificação de assinatura/autenticação por provedor; eventos inválidos são rejeitados e auditados.
- **FR-008**: O sistema MUST processar webhooks de pagamento de forma idempotente, deduplicando por identificador do pagamento; nenhuma mensagem de Sofia é enviada duas vezes para o mesmo pagamento.
- **FR-009**: O sistema MUST disparar Sofia em até 5 minutos do processamento bem-sucedido do webhook de confirmação de pagamento.
- **FR-010**: O sistema MUST refletir o estado real da fatura (paga / expirada / cancelada / reembolsada) com base nos eventos do gateway.
- **FR-011**: O sistema MUST excluir da régua, em qualquer passo, clientes que: (a) registraram opt-out, (b) não têm canal WhatsApp opt-in válido, (c) já pagaram a fatura, (d) estão fora da janela de comunicação Anatel/CDC permitida (08:00–20:00 dias úteis, conforme CDC art. 71 e jurisprudência).
- **FR-012**: O sistema MUST registrar em audit log imutável, para cada envio tentado (incluindo vetados): provedor, cliente, fatura, conteúdo da mensagem (ou snapshot do template + variáveis), decisão de Júlia e motivo, timestamp, canal, identificador do gateway.
- **FR-013**: O sistema MUST permitir ao admin do provedor ativar/desativar independentemente Bruno e Sofia para o seu provedor, com efeito imediato no próximo ciclo.
- **FR-014**: O sistema MUST exibir um painel "Régua Pré-Vencimento" para o provedor, listando faturas-alvo dos próximos 3 dias com status de cobrança Pix, status de envio Bruno (agendado/enviado/vetado/falhou), motivo de veto se houver, e timestamp.
- **FR-015**: O sistema MUST permitir geração de dossiê de auditoria por cliente e período, contendo todas as comunicações, decisões de compliance, eventos de pagamento e snapshots, exportável em formato apropriado para defesa jurídica, com geração em até 30 segundos.
- **FR-016**: O sistema MUST isolar execução por provedor: faturas, contas do gateway, webhooks e configurações de um provedor nunca afetam ou são visíveis a outro provedor.
- **FR-017**: O sistema MUST destinar o crédito do Pix gerado por Bruno diretamente à conta do gateway do provedor (não da plataforma); a plataforma jamais segura ou intermedia o dinheiro do cliente final.
- **FR-018**: O sistema MUST alertar o admin do provedor, no painel, quando: gateway não está configurado, template WhatsApp foi revogado, Júlia está indisponível, ou taxa de falha de envio excede limiar configurável.
- **FR-019**: Sofia MUST disparar agradecimento para TODOS os pagamentos confirmados de faturas do provedor, independentemente de a fatura ter passado ou não pela régua Bruno; o objetivo é experiência de marca consistente — todo cliente que paga recebe agradecimento, não só os "lembrados".
- **FR-020**: Quando o envio de template WhatsApp de Bruno falhar por motivo do canal (rejeição, número inválido, sem opt-in), o sistema MUST: (a) registrar falha estruturada no audit log; (b) tentar novamente na próxima janela diária (D-1 se falhou em D-3); (c) após 2 falhas consecutivas para o mesmo cliente/fatura, abrir alerta no painel do admin do provedor para revisão humana; (d) NÃO tentar canal alternativo (SMS/email) — fora do escopo desta spec.
- **FR-021**: As tarifas de transação do gateway (Pix) são absorvidas integralmente pelo provedor; a plataforma jamais intermedia, retém ou repassa o valor — o crédito do Pix vai direto para a conta do gateway do provedor (consistente com FR-017) e a tarifa é cobrada nessa mesma conta pelo gateway.

### Key Entities

- **Fatura (Invoice)**: representa uma cobrança recorrente do provedor para seu cliente. Possui valor, vencimento, status (pendente / paga / vencida / cancelada / reembolsada), referência ao contrato e ao cliente, e — uma vez ativada a régua — referências às cobranças Pix dinâmicas geradas por Bruno.
- **Cobrança Pix Dinâmica (Pix Charge)**: instrumento de pagamento criado no gateway para uma fatura específica. Possui identificador externo, QR Code, código copia-e-cola, valor, expiração, status (pendente / paga / expirada / cancelada). Vinculada a exatamente uma fatura e um provedor.
- **Comunicação Outbound (Outbound Communication)**: mensagem enviada (ou tentada) por Bruno ou Sofia a um cliente final. Possui agente de origem, canal, template/conteúdo, timestamp, decisão de compliance vinculada, status final (enviada / vetada / falhou / em quarentena).
- **Decisão de Compliance (Compliance Decision)**: registro imutável da decisão de Júlia sobre uma comunicação outbound antes do envio. Possui veredito (aprovar/vetar), motivo, regra aplicada, snapshot da mensagem analisada, timestamp.
- **Evento de Pagamento (Payment Event)**: registro do webhook recebido do gateway. Possui identificador do pagamento, tipo do evento, snapshot do payload, status de processamento (processado / duplicado / rejeitado), provedor de origem, timestamp.
- **Configuração de Agente (Agent Toggle)**: por provedor, indica se Bruno e Sofia estão ativados, com horário do agendador e parâmetros locais (janela permitida, templates selecionados).
- **Audit Log**: registro append-only de todas as ações relevantes (envios, vetos, geração de Pix, atualização de status), conforme infra da Spec 003.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em provedores com Bruno ativo por 60 dias, a taxa de pagamento de faturas até a data de vencimento aumenta em pelo menos 15 pontos percentuais comparada à baseline pré-Bruno do mesmo provedor.
- **SC-002**: A inadimplência D+0 (faturas não pagas no vencimento) cai para 6% ou menos do faturamento no terceiro mês de uso ativo da régua Bruno, partindo de uma baseline declarada de 8–12%.
- **SC-003**: 95% dos eventos de pagamento confirmado do gateway resultam em mensagem de Sofia entregue ao cliente em até 5 minutos do recebimento do webhook.
- **SC-004**: 100% das comunicações outbound de Bruno e Sofia possuem uma decisão de compliance de Júlia registrada antes do envio; auditoria automática diária aponta zero envios sem decisão.
- **SC-005**: Zero mensagens duplicadas de Sofia para o mesmo identificador de pagamento, medido sobre 100% dos eventos de webhook do gateway (incluindo retries).
- **SC-006**: Geração de dossiê de auditoria por cliente/período conclui em menos de 30 segundos para janelas de até 12 meses.
- **SC-007**: Zero ocorrências de mensagens enviadas fora da janela 08:00–20:00 local do provedor, em monitoramento contínuo de 90 dias.
- **SC-008**: Zero ocorrências confirmadas de vazamento cross-tenant (envio, visualização ou geração de Pix de um provedor sob contexto de outro) em auditoria de segurança periódica.
- **SC-009**: Tempo médio do admin do provedor para ativar Bruno + Sofia a partir do painel (assumindo gateway e WhatsApp já conectados) inferior a 2 minutos.

## Assumptions

- A integração WhatsApp Business via Meta (Spec 003) já está implantada e operacional para o provedor, com pelo menos um número WABA conectado e templates aprovados de "lembrete pré-vencimento" e "agradecimento de pagamento" disponíveis para uso.
- O agente Júlia (compliance) da Spec 003 está em produção e atende a chamadas síncronas ou near-real-time com latência aceitável (< 5s p95) para decidir aprovação/veto.
- A infraestrutura de audit log imutável, compliance_checks, agent_memories e cifragem em repouso, entregues na Spec 003, é reutilizada sem refatoração.
- Cada provedor já possui ou conectará uma conta no gateway de pagamento Asaas (existente no produto via `creditOrders` e `providerInvoices`), com chave de API ativa e capaz de emitir Pix dinâmico.
- Clientes do provedor passaram pelo opt-in regulatório de WhatsApp em onboarding ou cadastro, conforme a política de privacidade do provedor; sem opt-in válido, a régua não envia.
- A janela horária regulamentar adotada é 08:00–20:00 no fuso do provedor (estado principal cadastrado), em dias úteis; feriados nacionais são tratados como não-úteis. Domingos e sábados podem ser configurados por provedor (default: sábado permitido, domingo não).
- Marcos (régua pós-vencimento D+0+), Helena (negociação) e demais agentes da família cobrança estão fora do escopo desta Spec; integrações entre Bruno/Sofia e esses agentes serão definidas em specs subsequentes.
- Decisões de política aplicadas nesta spec (sobrescrevíveis pelo usuário): (i) Sofia agradece TODO pagamento confirmado, não só os tocados por Bruno (FR-019); (ii) falhas de canal são logadas + retry na próxima janela, sem fallback SMS/email no MVP, abrindo alerta humano após 2 falhas (FR-020); (iii) tarifas do gateway são 100% do provedor (FR-021), coerente com fluxo de fundos da FR-017.
- Multi-tenant absoluto é premissa não-negociável: todo dado, fila, webhook e configuração isola por `provider_id`, seguindo o padrão da plataforma.
