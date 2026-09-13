# Demo: todos os recursos simulados — Leva 1

**Data:** 12/09/2026 · **Branch:** `feat/demo-todos-os-recursos` (a partir de `feat/localizacao` 3754bea)
**Pedido do dono:** "faltou bastante coisa... economia do cliente não tem... geo marketing não tem... conversa do
cliente e ex cliente não tem... precisa simular absolutamente todos os recursos". Prints do dono em
demo.consultaisp.com.br: Conversas de cobrança e de equipamentos vazias; Cliente 360 com a Economia "PENDENTE ·
faltam os custos do provedor"; selo "DADOS REAIS" num sandbox fictício.

**Base:** inventário de 81 telas (workflow só-leitura, 10 grupos + verificação adversarial) — diagnósticos com
arquivo:linha. Design original da demo: `docs/superpowers/specs/2026-09-11-demo-sandbox-design.md` (§7 fora de
escopo continua valendo: white label, compra real, importação, **nenhum envio real ao mundo exterior**).

## 0. Regras que valem para toda a leva

1. **Nada sai da demo.** Toda chamada externa alcançável pelo visitante precisa de guarda `emModoDemo()` de
   `server/demo/modo-demo.ts` — o ÚNICO leitor de `process.env.DEMO_MODE`. Nunca ler `DEMO_MODE` direto.
   **Exceção aceita:** o proxy de tiles públicos `GET /api/tiles/:z/:x/:y.png` (`server/routes/heatmap.routes.ts`)
   continua buscando em `tile.openstreetmap.org` também na demo. O pedido leva só as coordenadas do quadro do mapa
   (`z/x/y`) — nenhum dado do visitante, do sandbox ou de cliente — e sem ele o geomarketing e os mapas ficam sem
   fundo. Qualquer outra chamada externa segue a regra.
2. **Produção idêntica fora da demo.** Toda mudança fora de `server/demo/*` fica atrás de `emModoDemo()`; com
   `DEMO_MODE` desligado o comportamento é byte a byte o de antes, com teste provando os dois lados.
3. **Orçamento de `criarSandbox`: ~3 s no banco real** (hoje ~0,6 s local). Medir depois.
4. **Limpeza.** Toda tabela escrita para o sandbox precisa ser apagada por `apagarSandbox`, senão a FK trava a
   varredura de 24 h e o sandbox vira zumbi.
5. **Faixa de índices do sandbox:** 2.000 pessoas por sandbox (`510_000 + (providerId % 200) × 2.000`). Não passar.
6. **Migração:** nenhuma tabela nova nesta leva (evita `server/migracoes-cobrem-o-schema.test.ts`).
7. **Leitura que cruza provedores** usa `server/utils/fora-de-sandbox.ts` (entrou em 3754bea).
8. **Comentários/domínio em pt-BR**, no estilo dos arquivos vizinhos (comentário explica o PORQUÊ).
9. `vitest` verde e `tsc` limpo antes de qualquer commit.

## 1. Frente A — Guardas (arquivos: `server/worker.ts`, `server/routes/ai.routes.ts` e/ou `server/services/ai-analysis.ts`, `server/services/proactive-alert.service.ts`, `server/routes/nfse.routes.ts` e/ou `server/services/focusnfe.ts`, `server/routes/credits.routes.ts`, `server/storage/localizacao.storage.ts` + testes)

- **Worker:** `iniciarPrimeirosContatos()` (worker.ts ~168-169) e o laço `tentarLigarAutonomia` (~240-265) NÃO rodam
  com `emModoDemo?.() === true` (o chat simulado da Frente B deixa a integração "pronta"; sem esta guarda, um PUT
  `/api/chat-bullq/automacao` do visitante liga o envio automático para o sandbox). A detecção de `emModoDemo` hoje é
  feita DEPOIS da linha 168 — reordenar sem perder o padrão de try/catch e o default seguro. Régua, limpeza e o
  resto seguem como estão. Conferir guardas já existentes antes de duplicar.
- **Análise por IA:** `POST /api/ai/analyze-consultation` usa o SDK OpenAI sem guarda. Em demo, NÃO chamar o SDK:
  devolver uma análise simulada determinística montada do próprio resultado da consulta (score, decisão, alertas,
  dívida), no MESMO formato/stream que a tela consome, marcada como simulada.
- **Alerta de fuga:** `enviarWebhookDoAlerta` (proactive-alert.service.ts ~242-272) faz `fetch(webhookUrl)` para URL
  cadastrável pelo visitante. Em demo: não fazer fetch nem envio por WhatsApp; gravar o alerta como hoje e registrar
  (log) que o canal externo foi suprimido. E-mail já é mudo em demo (`email.ts:125`).
- **NFS-e:** `nfse.routes.ts`/`focusnfe.ts` não conferem demo. Em demo: nunca chamar a Focus NFe. `GET /api/nfse/config`
  responde configurado em ambiente de demonstração; emitir/consultar/cancelar respondem sucesso simulado (referência
  `demo-...`, status autorizado/cancelado) sem rede, para a tela funcionar. Se o formato exigir mais, preferir simular
  a recusar.
- **Créditos/PIX:** conferir se o `if (emModoDemo())` de `credits.routes.ts:117` cobre `GET /api/credits/orders/:id/asaas/pix`;
  se não cobrir, recusar em demo (403 com mensagem clara) sem chamar o Asaas.
- **Sede no mapa:** `buscarSede` (localizacao.storage.ts ~189-203) chama `geocodeAddress`/`geocodeCity` (Google /
  Nominatim). Em demo: nunca geocodificar; se o provedor tiver cidade, usar coordenada fixa conhecida da cidade da
  demo (Londrina/PR) sem rede, senão null como hoje.
- Cada guarda: teste com DEMO ligado (nenhuma chamada externa; espião em `fetch`/SDK) e desligado (caminho antigo).

## 2. Frente B — Chat simulado (arquivos: `server/demo/chat-simulado.ts` NOVO, `server/demo/chat-simulado.test.ts` NOVO, `server/services/chat/chat-ponte.service.ts` + teste)

**Desenho:** `ChatBullqClient` (`server/services/chat/chat-bullq.client.ts`) faz TODA chamada por `this.fetchImpl`
(`requisicao`, linhas ~686-728; base normalizada para `.../api/v1`; resposta lida como JSON, `data` desembrulhado se
existir; erro = status não-ok com `message`). Então: em demo, `clienteDoChat()` devolve
`new ChatBullqClient({ baseUrl: "http://chat-simulado.demo.invalid", platformKey: "demo", fetchImpl: fetchDoChatSimulado })`
— o cliente REAL, com um `fetch` local que imita a API do fork. Qualquer método (inclusive os não listados) passa pelo
roteador; rota desconhecida responde 404 JSON local. **Nunca `globalThis.fetch`. Nunca ler `CHAT_BULLQ_*` no caminho demo.**

- `clienteDoChat()` (chat-ponte.service.ts:45-51): ramo `emModoDemo()` ANTES de ler o ambiente; singleton igual.
- Rotas a imitar (prefixo `/api/v1`), com os corpos que os métodos esperam:
  - `POST /platform/organizations` → `{ organizationId, slug, ownerEmail, ... }` (formato `OrganizacaoProvisionada`);
    `POST /platform/organizations/:id/token` → `{ accessToken, refreshToken }`; `POST /auth/refresh` → idem;
    `POST /platform/organizations/:id/owner-password` → `{ ownerUserId, ownerEmail }`.
  - Canais: `GET /channels` → um canal `{ id: "demo-canal", type: "WHATSAPP_ZAPPFY", name: "WhatsApp da Demonstração", ... }`;
    `GET /channels/capabilities`; `GET /channels/:id/connection-status` e `POST .../connect` → conectado;
    `POST /channels/:id/test` → `{ success: true }`; `GET /channels/:id/templates` → `[]`; POST/DELETE de canal → ok.
  - Conversas: `GET /conversations?search=` → `{ conversations: [...] }` (as simuladas daquele telefone, ou vazio);
    `POST /conversations` → `{ id, conversationId, status }` com id novo `demo-conv-<providerId>-n<seq>` e a 1ª mensagem guardada;
    `PATCH /conversations/:id` → `Conversa`; `POST .../ai/engage`, `PATCH .../ai`, `POST .../close` → ok.
  - Mensagens: `GET /messages?conversationId=&page=&limit=` → `{ messages }`; `POST /messages` → `{ id, status: "SENT" }`
    e a mensagem entra no histórico; `GET /messages/:id/media` → 404.
  - Agentes/console/catálogo/automações (`/ai-agents*`, `/ai-catalog/*`, `/automations`): leituras devolvem listas
    plausíveis ou vazias; escritas devolvem `{ id }`; `.../first-contact-draft` devolve rascunho de texto simples;
    `.../autonomous-plan` devolve recusa controlada (a autonomia não roda em demo — Frente A).
- **Histórico determinístico:** para `conversationId` semeado (`demo-conv-<providerId>-<seq>`), ler do banco a linha
  de `chat_bullq_conversas` + cliente (+ caso ou recuperação) e montar um roteiro coerente: abertura (TEMPLATE ou TEXT
  OUTBOUND com a ação da etapa), respostas INBOUND do cliente, OUTBOUND da equipe (`senderName`), status
  SENT/DELIVERED/READ, horários entre `abertaEm` e `ultimoEventoEm`. Roteiros por cena: lembrete de atraso, promessa de
  pagamento, negociação, ex-cliente com dívida, retirada de equipamento, encerrada. **< 40 mensagens** (a tela usa
  `length === 40` como "tem mais"). OPEN/PENDING com INBOUND nas últimas 24 h; WAITING/CLOSED com a última INBOUND há
  mais de 24 h. `direction` só `INBOUND`/`OUTBOUND`. Mensagens do visitante ficam num `Map` em memória por
  `(organizationId, conversationId)` e entram no histórico seguinte.
- Exportar `limparChatSimuladoDoProvedor(providerId: number): void` (esvazia o `Map` daquele provedor) — a Frente C
  chama em `apagarSandbox`. `organizationId` do sandbox = `demo-org-<providerId>`.
- Testes: com demo ligado, TODO método público de `ChatBullqClient` responde sem tocar `globalThis.fetch` (espião falha
  se chamado); `listarMensagens` de conversa semeada < 40 e coerente; `enviarTexto` aparece no histórico; `iniciarConversa`
  cria id; rota desconhecida = `ok:false` local. Com demo desligado, `clienteDoChat()` volta ao caminho do ambiente.

## 3. Frente C — Semeadura (arquivos: `server/demo/sandbox.service.ts`, `server/demo/sandbox.service.test.ts`; NÃO mexer em `mundo-base.ts` nesta leva)

Tudo dentro da transação de `tentarCriarSandbox`, na ordem das FKs.

1. **Política com custos e preço por plano** — 1 linha `cobranca_politica` por sandbox: `economia` com custos plausíveis
   de ISP regional (ex.: `cac` 180, `capexInstalacao` 350, `equipamentoResidual` = `VALOR_DO_EQUIPAMENTO`, `opexLink` 12,
   `opexRedePop` 6, `opexSuporte` 5, `opexManutencaoNoc` 4, `impostoReceitaPct` 9.25, `cicloMeses` 36,
   `confirmado: true`) e `precoPorPlano` = cada `NOMES_DE_PLANO[i]` → `VALORES_DE_PLANO[i]` (o mesmo índice que
   `planoDoContrato`/`valorMensalidade` usam). Demais colunas no default; `pausada: false`. `custosInformados` exige ao
   menos um custo > 0. Resultado esperado: Economia deixa de ser pendente para em dia, inadimplentes e ex-clientes
   (preço cadastrado tem precedência).
2. **Clientes (mesmo insert, sem linha nova):** inadimplentes com `overdueInvoicesCount: 1`; `lastSyncAt: agora` em
   todos; `ispScore`/`riskTier` coerentes (nunca o par 100/'low': em dia ~650-900 'bom'/'excelente'; inadimplente
   ~250-600 'regular'/'baixo' pela idade; cancelado conforme a saída). **Ex-clientes com dívida:** cancelados cuja
   fatura de saída nasce `overdue` (posição ímpar), EXCETO o cursor do caso "baixado" (`INADIMPLENTES_POR_SANDBOX + 1`):
   `totalOverdueAmount` = valor exato daquela fatura, `maxDaysOverdue` = dias desde `cortadoEm`, `overdueInvoicesCount: 1`.
   Continuam `status: 'cancelled'` e `paymentStatus: 'current'` (o teste atual conta 225 `overdue`).
3. **Casos vivos de ex-cliente** (além dos 9 atuais, que ficam): ~10 casos `carteira: 'ex_cliente'` para ex-clientes COM
   dívida (item 2): 3 `aberto`, 3 `em_contato`, 2 `negociando`, 1 `acordo_ativo`, 1 `negativado`. `valorAbertura` =
   `valorAtual` = `totalOverdueAmount` do cliente; `etapaAtual` e DNA/tom pelas funções reais da régua
   (`etapaParaAtraso` em `shared/cobranca/regua.ts`, `dnaDoCaso`/`prioridadeSugerida` em `regua-diaria.service.ts` —
   se não exportadas, reproduzir a mesma regra sem inventar id); no máximo 1 caso vivo por cliente; `proximoContatoEm`
   misturado (passado, hoje, futuro); `ultimoContatoEm` em em_contato/negociando/acordo_ativo. Ajustar a checagem
   `casos.length !== STATUS_DE_CASO.length` para "ao menos um caso por status".
   Negociações só onde forem simples e válidas; se entrarem, parcelas pendentes com vencimento FUTURO (a régua quebra
   acordo com atraso > 5 dias) e valores dentro de `validarNegociacao`/`avaliarPedidoDeAcordo`.
4. **Recuperação de equipamentos** — 13 `equipment_recovery_cases` nos cancelados com ONU retida, com
   `terminationDate = cortadoEm`, `deadlineAt` pela regra real (`calcularPrazoRetirada`), `createdById` = admin:
   5 ABERTOS na coorte de 30 dias (posições 0, 6, 12, 18, 24): `pre_recuperacao`, `agendado` (scheduledAt +2 dias,
   responsável admin), `nova_tentativa`, `notificacao_formal` (prova, protocolo, notificação, sinal validado só se
   `validarSinalBureau` aceitar com os eventos semeados), `contestado`. 4 `concluido` (posições 1, 7, 13, 19),
   2 `baixado_economico` (2, 8), 2 `prazo_expirado` (14, 20), todos com `closedAt`. Status do `equipment` decidido
   ANTES do insert (aberto → `retirada_pendente` + `inRecoveryProcess`; concluído → `recuperado_triagem`; baixado/expirado
   → `baixado`), agregado do cliente coerente com `recalculateCustomerEquipmentAggregate`. Total de equipment continua 120.
   3 a 6 `equipment_recovery_events` por caso (`caso_criado` + transições), `occurredAt` ≤ agora.
5. **Chat:** 1 `chat_bullq_integracoes`: `organizationId: demo-org-<providerId>`, `slug: subdomain`,
   `ownerEmail` = e-mail do admin do sandbox, `canalId: "demo-canal"`, `canalNome: "WhatsApp da Demonstração"`,
   `status: "ativo"`. `chat_bullq_conversas` com `conversationId: demo-conv-<providerId>-<seq>`, `canalId: "demo-canal"`:
   **cobrança ativos ~9** (casos vivos ativos + inadimplentes), **cobrança ex ~8** (casos vivos ex do item 3),
   **equipamentos 5** (casos abertos do item 4, `recuperacaoId`). `status` misturado (OPEN, PENDING, WAITING, BOT e 1-2
   CLOSED por fila), `abertaEm`/`ultimoEventoEm` no passado coerentes com os roteiros da Frente B. Para cada conversa com
   caso: `cobranca_eventos` de `contato` (canal whatsapp, metadata `{ origem: "chat_integrado", conversationId }`) e
   uma `nota`; para recuperação, o evento equivalente em `equipment_recovery_events`.
6. **Limpeza:** `apagarSandbox` passa a apagar também `cobranca_pre_avisos` e `cobranca_quitacoes`
   (`shared/schema-cobranca-faturas.ts`) e `chat_autonomia_autorizacao` (`shared/chat-autonomia-seguranca.ts`) ANTES das
   tabelas pai, e chama `limparChatSimuladoDoProvedor(providerId)` (Frente B). O teste "sem exceção" passa a derivar
   as tabelas também desses dois módulos (recontar os números exatos).
7. Testes: contagens novas, invariantes (soma/contagem das dívidas batem com as faturas; 1 caso vivo por cliente;
   conversas apontam para caso/recuperação do MESMO provedor; nenhum id fora da faixa; política com custos > 0).

## 4. Frente D — Selo "Dados fictícios" (arquivos: `client/src/components/cobranca/IdentificacaoTecnica.tsx`, `client/src/pages/cobranca/cliente360.tsx`, `client/src/components/chat/PerfilDoCliente.tsx` + testes)

- `origemDoDado` ganha a entrada `demonstracao?: boolean`: quando true, rótulo **"Dados fictícios"**, tom neutro/info,
  título explicando que é a demonstração pública e que a leitura "ao vivo" vem do conector de demonstração.
- O sinal é `demoMode` de `GET /api/auth/me` via `useAuth` (`client/src/lib/auth.tsx`), o mesmo da `FaixaDemonstracao`.
  Nunca decidir por `erpSource` no client.
- Fora da demo, nada muda (teste dos dois lados).

## 5. Decisões da implementação

O que a leva 1 decidiu fora do texto acima, registrado para a revisão não tratar como desvio:

- **Tetos do chat simulado** (`server/demo/chat-simulado.ts`): a memória é do processo e a demo é pública, então
  todo `Map` que o visitante enche tem teto — 300 conversas criadas por organização (`MAXIMO_DE_CONVERSAS_CRIADAS`),
  e 100 itens por coleção de agentes/tools/skills/automações (`MAXIMO_DE_REGISTROS_POR_COLECAO`). Passou desses dois
  tetos, a resposta é uma recusa local **429** com mensagem, sem apagar nada. As mensagens do visitante são outro caso:
  janela das últimas 200 por conversa (`MAXIMO_DE_ENVIADAS_POR_CONVERSA`), sem recusa — a mais antiga sai.
- **Varredura de 15 min no processo da API** (`INTERVALO_DA_VARREDURA_MS`): a limpeza de sandboxes roda no worker,
  outro processo, e não alcança o `Map` da API. A cada 15 min a API descarta o estado de toda organização cujo
  provedor não existe mais (`setInterval` com `unref`); `limparChatSimuladoDoProvedor` segue sendo chamado por
  `apagarSandbox` para o caso do mesmo processo.
- **21 conversas semeadas, não ~22** (`conversasPlanejadas` em `server/demo/sandbox.service.ts`): 9 de cobrança de
  ativos, **7 de ex-cliente** e 5 de equipamentos. Ex-cliente tem 7 e não 8 porque caso `aberto` não tem conversa:
  no produto, abrir a conversa do caso é o gesto que registra o contato e move o caso para `em_contato`
  (`iniciarContatoDaCobranca`). A semeadura falha alto se o plano puser conversa em caso aberto.
- **Capabilities do simulado:** `GET /channels/capabilities` responde `uazapi: false` e `datafy: false`
  (e `templateFirstContact: false`). O simulado não tem template aprovado para abrir conversa, então o canal
  Datafy/Uazapi é recusado (`CHAT_SEM_SUPORTE`) antes de gravar qualquer coisa; o canal da demo é o Zappfy.
- **URLs que a ponte grava no chat:** na demo, `urlDaApiDoAgente()` e `urlDoWebhookDeVolta()` são fixas no host do
  chat simulado (`http://chat-simulado.demo.invalid/...`, TLD que nunca resolve), `urlDoInbox()` é vazia e o
  webhook Datafy é `null` — nenhum `CHAT_BULLQ_*` é lido pela ponte no caminho demo.
- **Parecer de IA simulado** (`server/services/ai-analysis.ts`): a análise da consulta é montada do próprio resultado
  e entregue linha a linha pelo mesmo `onChunk` do stream do modelo; a análise anti-fraude por IA é recusada com
  mensagem clara, em vez de simulada.
- **NFS-e com ambiente `demonstracao`** (`server/routes/nfse.routes.ts`, `server/services/focusnfe.ts`): a
  configuração se diz disponível com `environment: "demonstracao"`, a referência nasce `demo-<providerId>-<ts>` e
  emitir/consultar/cancelar respondem pela NFS-e simulada, sem chamar a Focus NFe.
- **CNPJ simulado** (`server/demo/cnpj-simulado.ts`, usado por `server/services/cnpj-publico.service.ts`): o CNPJ do
  sandbox é inventado, então "buscar na Receita" responde um cadastro local e fixo (Provedor Demonstração, Londrina/PR,
  sem telefone e sem sócio com documento) em vez de consultar as fontes públicas de terceiros.

## 6. Fora desta leva (Leva 2)

Histórico de faturas pagas e fatura do mês; carteira completa de casos com eventos e responsáveis; histórico de consultas
ISP/SPC/cadastral; anti-fraude com 15 alertas e regras; ficha do provedor (sócios, documentos, equipe); pedidos de crédito;
logs de sync; suporte; bases públicas do geomarketing no banco da demo (carga operacional com trava de banco);
suspensos; sede no mapa. Achados de produto sem seed: ranking de clientes em risco sem tela; `/inadimplentes`
"Ver rede"/"Notificar LGPD" chamam rotas inexistentes; `resumoDoMes` soma faturas de ex-clientes na carteira de ativos.
