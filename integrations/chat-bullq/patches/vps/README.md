# Patches para a linhagem da VPS

> A chave da OpenAI esteve VAZIA na VPS de 06/09 a 16/09/2026 (o valor de
> `OPENAI_API_KEY` tinha comprimento zero, no `.env.api` e dentro do container):
> os endpoints subiam, mas o catálogo devolvia `configured:false` e a
> preparação/planejamento davam 503. O dono preencheu a chave em 16/09/2026.
> Confira com `npx tsx script/diagnostico-chat.ts <providerId>` no Consulta ISP:
> a linha "credencial de IA configurada" responde por este ponto.

## Existem duas linhagens do Chat BullQ

O fork do Chat BullQ divergiu em dois caminhos, e **os patches não são
intercambiáveis**:

| | Linhagem do REPOSITÓRIO | Linhagem da VPS |
|---|---|---|
| Onde vive | `integrations/chat-bullq/patches/*.patch` | `/var/www/chat-bullq/chat-bullq-api`, HEAD `12d97ae` |
| `LlmService` | **só Sakana** — `private readonly client: OpenAI` + `hasApiKey` | **multi-provider** — `clients: Record<LlmProvider, OpenAI \| null>`, `resolveLlmModel()`, `calculateModelCost()` |
| Erro do provedor | `handleSakanaError(...)` | `handleProviderError(err, provider, ...)` |
| Modelos em uso | `fugu`, `fugu-ultra-*` | `openai/gpt-4o-mini` — a VPS declara só `OPENAI_API_KEY`; `SAKANA_API_KEY` **não existe** no `.env.api` |
| Provedores de WhatsApp (patch 001) | aplicado | aplicado |

Os patches `002` e `003` da raiz foram escritos contra a linhagem do
repositório. Aplicá-los na VPS dá **conflito real** em
`src/modules/ai-agents/llm/llm.service.ts` — e, mesmo resolvido o conflito à
mão, o catálogo de modelos ficaria **vazio** na VPS, porque o filtro de lá é
`/^(sakana\/)?fugu/` e nenhum modelo da OpenAI passa por ele.

## Qual patch usar

| Patch | Serve para |
|---|---|
| `../000-ponte-consultaisp.patch` | as duas (já aplicado na VPS) |
| `../001-whatsapp-providers.patch` | as duas (já aplicado na VPS, em `12d97ae`) |
| `../002-agentes-primeiro-contato.patch` | **só** a linhagem do repositório |
| `../003-autonomous-plan.patch` | **só** a linhagem do repositório |
| `vps/002-agentes-primeiro-contato.patch` | **só** a linhagem da VPS |
| `vps/003-autonomous-plan.patch` | **só** a linhagem da VPS |
| `vps/008-planejador-so-repassa.patch` | **só** a linhagem da VPS (`git format-patch` do commit `827abce`; aplica com `git am` ou `git apply`) |
| `vps/009-planejador-escreve.patch` | **só** a linhagem da VPS (`git format-patch` do commit `f849515`, feito sobre o `827abce`; aplica com `git am`) |
| `vps/010-mensagens-como-agente.patch` | **só** a linhagem da VPS — mensagens como agente e "digitando…" (`POST /messages/agent-batch`; `git format-patch` do commit `c15ad6f`, feito sobre o `f849515`; aplica com `git am`) |

## Ordem de aplicação na VPS

Base obrigatória: `12d97ae` (linhagem própria da VPS + patch 001). Depois, em
ordem, **`vps/002` → `vps/003` → `vps/008` → `vps/009` → `vps/010`** — o 003
edita arquivos que o 002 cria (`agents/first-contact.service.ts`), o 008 e o
009 editam arquivos que o 003 cria, e o 010 foi gerado sobre o commit do 009;
por isso nenhum deles aplica sozinho. O 009 não aplica sobre o 003 cru: exige o
008 antes (o teste do repositório confere isso).

Entre o 003 e o 008 a VPS recebeu três correções que **não** viraram patch aqui
porque não tocam o módulo `ai-agents` — estão no git do fork, com tag
`antes-00N-*`/`patch-00N-*` e imagem `chat-bullq-api:antes-00N` para voltar:
`d3b3039` (005: corpo JSON do webhook até 10 MB — a Evolution manda o
`jpegThumbnail` em bytes e estourava os 100 KB padrão), `ea25b4b` (006: a
máquina de estados aceita OPEN/WAITING → BOT, o "devolver ao assistente") e
`9af6a24` (007: OPEN/WAITING → PENDING, a volta à fila humana). Quem reconstruir
o fork a partir de `12d97ae` precisa delas também (`git cherry-pick` das tags).

## O que muda em relação aos patches originais

Princípio da adaptação: **não desfazer nada que a VPS já tem**. Nenhuma linha
do multi-provider foi removida; o catálogo passou a *ler* dos provedores que
já existem.

1. **`llm/first-contact-models.ts` — multi-provider.**
   Recebe o mapa `clients` inteiro em vez de um cliente único, pergunta a cada
   provedor **configurado** o que a credencial oferece e devolve os IDs já
   prefixados (`sakana/…`, `openai/…`) — o mesmo formato gravado em
   `AiAgent.modelId`.

2. **Filtro do catálogo: `resolveLlmModel`, não `fugu`.**
   Entra no catálogo só o ID que o **próprio resolvedor deste deploy** aceita
   como modelo de agente (`fugu`, `fugu-*` na Sakana; `gpt-*` na OpenAI). É a
   regra que já existe em `llm.constants.ts`, então o catálogo nunca oferece um
   modelo que o `complete()` recusaria — e embedding, tts, whisper e dall-e
   ficam de fora sem lista negra escrita à mão.

3. **Falha parcial de listagem tem nome.**
   O catálogo devolve um campo novo, `indisponiveis: LlmProvider[]`. Se a
   listagem do provedor **daquele agente** falhou, a preparação/planejamento
   para com *"Não foi possível confirmar o modelo na credencial agora"* — e
   não com *"modelo não disponível"*, que seria mentira. Só quando **todas** as
   credenciais falham é que vale o erro original (`listar`), e falha parcial
   nunca entra em cache. Comportamento novo, exigido pelo fato de haver mais de
   um provedor; a versão de um provedor só não tinha esse caso.

4. **Comparação de modelo tolera o snapshot datado.**
   *(decisão de produto — o caminho que preserva o comportamento atual)*
   A trava contra troca de modelo do patch original é
   `rawModelId.replace(/^sakana\//,'') !== modelId.replace(/^sakana\//,'')`.
   Na OpenAI ela reprovaria **toda** chamada: pede-se `gpt-4o-mini` e a API
   responde `gpt-4o-mini-2024-07-18`. `answeredWithSameModel()` aceita o ID
   pedido **ou** o mesmo ID com um sufixo que seja **só uma data**
   (`-2024-07-18`, `-20240718`) — a mesma tolerância que `llm-pricing.ts` já
   usa para cobrar o preço do modelo base. Nada além de uma data passa:
   `fugu` continua diferente de `fugu-ultra-20260615`, então a trava
   permanece de pé.

5. **`sameModel()` no lugar de igualdade de string.**
   `modelId` pode estar gravado com ou sem prefixo (`gpt-4o-mini` e
   `openai/gpt-4o-mini` são o mesmo modelo para o `resolveLlmModel` da VPS). A
   comparação passou a ser por provedor + modelo resolvido, em vez de `===`.

6. **`llm.service.ts` — anexado, não substituído.**
   `firstContactModels()` novo, `callOptions` (`timeout`/`maxRetries`) aplicado
   às **duas** chamadas `create()` (a principal e o retry sem imagem — o
   original só tratava a primeira), e as duas guardas de `privacySafeErrors`
   penduradas em `handleProviderError`, que é o nome do método na VPS.

7. **Specs adaptados.** `autonomous-plan.service.spec.ts` e
   `autonomous-plan-privacy.spec.ts` passaram a usar `openai/gpt-4o-mini`
   (o modelo real da VPS) e `OPENAI_API_KEY`, e ganharam casos para o snapshot
   datado e para o provedor indisponível.

8. **008 — o planejador só repassa o que o Consulta ISP lê (16/09/2026).**
   Medido em produção com o `gpt-4o` e a persona real: em **5 de 6** planos de
   `responder` o modelo escrevia a mensagem ao cliente em `texto` (com o valor,
   "R$ 189,90") ou ecoava `valor`/`faturaId` do contexto numa ação que não os
   usa — e o `parsePlan` do 003 recusava o plano inteiro (503 *"A IA não
   produziu um plano válido"*), então toda conversa ia ao atendente. Nada disso
   é decisão: `respostaControlada` (Consulta ISP) redige o texto final a partir
   da categoria `resposta` e do saldo que o próprio servidor leu; `valor` só é
   lido em `promessa` e `faturaId` só em `segunda_via`. O 008 faz o `parsePlan`
   **manter só os campos que cada ação usa** (`texto` nunca sai; `motivo` fora
   do limite é descartado) e **continuar recusando** o que seria decisão errada:
   ação fora de `allowedActions`, `resposta` fora do catálogo, data/valor/fatura
   malformados. O prompt do planejador deixou de oferecer o campo `texto`. O
   contrato `PlanoRespostaSchema` do Consulta ISP não mudou (`texto` continua
   opcional lá, só nunca chega).

9. **009 — o planejador escreve as mensagens (16/09/2026, funcionária digital).**
   Por que: o texto que o cliente lia era frase fixa do servidor ("O ERP informa
   R$ 150,00 em aberto na leitura de agora…") e soava a robô. Com o 009 o
   planejador decide a ação E escreve os balões na voz da persona, na mesma
   chamada. Spec: `docs/superpowers/specs/2026-09-16-funcionario-digital-design.md`
   §4 e §5. Tudo está em `agents/autonomous-plan.*` e `llm/llm-pricing.ts`:
   - **Pedido:** `escrever?: boolean` (outro tipo dá 400). **Ausente ou `false`,
     a requisição ao modelo e a resposta são as do 008, byte a byte** — o
     `PlanoRespostaSchema` antigo (`.strict()`, sem `mensagens`) continua
     aceitando tudo que sai. O 008 recusa a chave com 400 *"Contexto do
     planejamento inválido"*: é esse 400 que o Consulta ISP reconhece para
     repetir sem `escrever` se o fork voltar para antes do 009.
   - **Com `escrever`:** `messages[0]` = SYSTEM próprio de redação (sem o "não
     escreva"; balões curtos de WhatsApp, 1ª pessoa da empresa, número só do
     context ou do que o cliente escreveu, sem link, sem prometer ação ou prazo,
     confirmar atendimento automatizado se perguntado e nunca negar);
     `messages[1]` = a persona do agente, rotulada como subordinada às regras;
     `messages[2]` = os dados, com as chaves em ordem fixa `operation,
     allowedActions (ordem canônica), escrever, context, history` — o prefixo
     regras + persona é o mesmo em toda rodada do agente e entra no cache de
     prompt (`cacheKey: plano:<agentId>`). `response_format: json_object` só
     na OpenAI. Timeout de **25 s** (12 s sem `escrever`); teto do conteúdo 8.000
     (3.000 sem).
   - **Saída:** `mensagens?: string[]` em todas as ações — 1 a 3, 1..600
     caracteres cada, 1.200 no total (o teto do verificador do Consulta ISP).
     Link, domínio, e-mail, `{{ }}`, `[[ ]]`, `<…>` e meta-talk (os padrões do
     `runner/text-guards.ts` mais prompt/JSON/ERP/GPT…) **descartam as
     mensagens e o plano segue** — tudo ou nada, para um balão que caiu não
     mudar o sentido dos outros. Só ação, data, valor e fatura malformados
     recusam. `resposta` vira opcional (padrão `acolher`). As frases de
     "sou um atendimento automatizado" passam: a persona tem de dizê-las.
   - **Limites:** `AGENT_PROMPT_MAX = 80.000` (constante única; era 8.000 e as
     personas do Provedor.ai têm 24 a 33 mil caracteres); até **3 planos
     simultâneos por organização** (teto global 100; era 1); **40 por minuto**
     (era 20).
   - **Custo:** preço do `gpt-4.1` (entrada 2, cache 0,50, saída 8 USD por
     milhão). O snapshot passou a ser **só data** (`gpt-4.1-2025-04-14`), para
     `gpt-4.1-mini` não herdar o preço do `gpt-4.1`. O log `autonomous_plan`
     ganhou `cachedTokens` e, com `escrever`, `mensagens` (quantas saíram) e
     `mensagensDescartadas` — contagens, nunca o texto.
   - **Contrato com o Consulta ISP:** um `requestId` reusado com outro
     conteúdo dá 409 — a repetição sem `escrever` precisa de `requestId` novo.

10. **010 — mensagens como agente, em ordem, com "digitando…" (16/09/2026).**
    Por que: o `POST /messages` fala como o usuário do token — assina
    `*NsLink Provedor*`, atribui a conversa ao dono, pausa a IA, não mostra
    "digitando…" — e a fila `outbound-messages` roda com concorrência 5, então
    dois balões seguidos podiam chegar trocados. Nada em `ai-agents` muda
    (só o `containsMetaTalk` é importado); o patch toca `messaging`, a porta de
    saída e a Evolution.
    - **`POST /messages/agent-batch`** `{ conversationId, aiAgentId, textos:
      string[1..4] }` (cada texto até 4.000), só **OWNER/ADMIN**. O agente tem
      de ser da organização, não apagado, com `autonomia_cobranca_controlada`,
      `!isActive && !canRespondDirectly` (a regra do planejador; senão 400).
      Conversa atribuída a um usuário **diferente de quem chama** → **409**.
      Meta-talk em qualquer balão → 400, lote inteiro recusado. Resposta:
      `{ loteId, mensagens: [{ id, status: "QUEUED" }] }`.
    - **As mensagens** nascem como as da tool `replyToConversation`:
      `senderName` = nome do agente, `metadata.aiAgentId`, sem `senderId`,
      **sem assinatura, sem pausar a IA, sem atribuir, sem marcar lida**. Novo:
      `metadata.enviadoPorUserId` (o autor real) e `metadata.lote {id, indice,
      total}`; `createdAt` crescente para a ordem no inbox. A autoria sobrevive
      ao SENT (o envio comum continua trocando a metadata por
      `{providerResponse}`) e passa para a linha do eco do webhook.
    - **UM job** (`send-agent-batch`, `attempts: 1`) envia em sequência. Para
      cada balão: a conversa mudou de mãos? → "digitando…" (**800 ms + 35 ms
      por caractere, teto 4 s**) → confere de novo → envia. "Mudou de mãos" é
      `assignedToId` de outro usuário **ou IA desligada depois do lote**
      (`aiDisabledAt` > aceite): o "assumir" e o "transferir" do Consulta ISP
      usam o mesmo token do lote, e só o `aiDisabledAt` os denuncia. O
      `status` não entra — o próprio fork troca WAITING → OPEN quando o cliente
      responde. Parou, falhou ou o worker reiniciou no meio: o balão e os
      seguintes ficam **FAILED** com `metadata.loteInterrompido`
      (`conversa_com_humano`, `conversa_indisponivel`, `envio_incerto`,
      `balao_anterior_nao_saiu`) e **nada é reenviado** (o balão que estava
      saindo ganha `metadata.envioIniciadoEm` antes do adapter).
    - **Evolution:** `sendPresence` = `POST /chat/sendPresence/{instance}`
      `{ number, presence: "composing", delay }`, timeout `delay + 2 s`. O
      adapter só manda presença quando recebe a espera (3º argumento opcional
      da porta) e nunca deixa erro escapar. A IA do próprio fork (sem espera)
      segue sem presença e com a fórmula antiga (900 ms + 28 ms, 1–6 s): nada
      muda para as outras organizações. O lote espera a espera **e** a presença,
      com teto de espera + 2 s.
    - **Para quem escreve o lado do Consulta ISP:**
      1. Desligar a IA (`desligarIa`) **interrompe o lote em voo**. Na rodada
         que responde E transfere (acordo aceito que precisa de emissão), a
         transferência só depois de os balões saírem de `QUEUED`; o aviso de
         transferência (§3.4) sai **depois** do `desligarIa`, como o
         `transferir` atual já faz, e por isso não é cortado.
      2. O lote é assíncrono: a resposta 201 só diz que entrou na fila. O que
         saiu se lê em `GET /messages?conversationId=` (status por id); um id
         pode sumir se o eco do webhook chegou antes (a linha que fica é a do
         eco, com a mesma autoria) — comportamento antigo de toda mensagem.
      3. Fork sem o 010 responde **404** `Cannot POST /api/v1/messages/agent-batch`
         (a rota não existe; o `ValidationPipe` nem roda) — só esse caso vai ao
         `enviarTexto` com os balões juntos (§5). Com o 010, **400** é recusa
         (meta-talk, agente fora da regra, formato) e **404** com outra mensagem é
         conversa/agente não encontrado: cair no `enviarTexto` nesses casos
         mandaria assinado o texto que o fork acabou de recusar. **409** = a
         conversa está com um atendente: não reenviar por outro caminho.
      4. Um lote ocupa um dos 5 trabalhadores da fila por 4 a 6 s por balão, mais
         o envio (até ~25 s com 4 balões).

## Como foi validado

Tudo num **clone descartável**, nunca em `/var/www/chat-bullq`:

- `git apply --check` + `git apply` sobre `12d97ae` limpo — local e em
  `/tmp/bullq-teste` na VPS: os dois patches aplicam sem conflito, nesta ordem.
- `docker build -t chat-bullq-api:teste-003 .` na VPS: **compila**
  (`nest build` concluído, imagem gerada). Nenhum `docker compose up`, nenhum
  toque no container em produção.
- `npx tsc --noEmit` dentro do estágio `builder`: **exit 0**.
- `npx jest src/modules/ai-agents` dentro do `builder`: **8 suítes, 61 testes,
  todos verdes** — inclusive o `llm.service.spec.ts` que já existia no fork.
- No repositório, `server/services/chat/chat-bullq-vps-patches.test.ts` executa
  de verdade os arquivos novos dos dois patches (22 testes).
- **008** (16/09/2026): aplicado direto em `/var/www/chat-bullq/chat-bullq-api`
  (commit `827abce`, tags `antes-008-planejador`/`patch-008-planejador`, imagem
  `chat-bullq-api:antes-008` para voltar) com o mesmo roteiro guardado: `docker
  build --target builder` (o `nest build` é o tsc) e `jest` dos specs do
  planejador dentro do builder (**2 suítes, 17 testes**), só então a imagem de
  produção e o `--force-recreate`. Depois, pelo MESMO cliente da ponte
  (`planejarAutonomia`), 8 pedidos de 8 voltaram plano válido (informar dívida,
  promessa com data e valor, transferir com motivo). No repositório o teste
  aplica os hunks do 008 sobre o texto do 003 antes de executar — contexto que
  não casa derruba o teste, como o `git apply --check`.
- **009** (16/09/2026): **não aplicado em produção.** Feito num clone
  descartável (`/tmp/fork-funcionaria`, `git clone` de
  `/var/www/chat-bullq/chat-bullq-api` com `checkout -B funcionaria 827abce`),
  commit `f849515`, patch por `git format-patch -1` (LF). Na VPS, sem tocar a
  imagem de produção nem as tags `antes-00N`:
  ```sh
  cd /tmp/fork-funcionaria
  docker build --target builder -t chat-bullq-api:builder-funcionaria . > /tmp/fork-funcionaria-build.log 2>&1   # nest build = tsc, exit 0
  docker run --rm chat-bullq-api:builder-funcionaria npx jest src/modules/ai-agents                             # 8 suítes, 95 testes, exit 0
  ```
  No repositório, `chat-bullq-vps-patches.test.ts` carrega o schema e o
  serviço como rodam depois do 009 (003 + 008 + 009) e compara com o 008
  sozinho: sem `escrever`, a requisição ao modelo e o plano saem iguais byte a
  byte (`JSON.stringify`); com `escrever`, confere persona em `messages[1]`,
  ordem do envelope, 25 s, mensagens válidas e descartadas, `resposta`
  opcional, 80 mil caracteres e 3 planos simultâneos. Para aplicar em
  produção, o roteiro do 008 com `antes-009` (spec §11.1), depois do 010.
- **010** (16/09/2026): **não aplicado em produção.** No mesmo clone, commit
  `c15ad6f` sobre o `f849515`, patch por `git format-patch -1` (LF, 0 CR,
  sha256 `ae26ba63…27409049`); `git apply --check` num worktree limpo em
  `f849515` passa. Na VPS:
  ```sh
  cd /tmp/fork-funcionaria
  docker build --target builder -t chat-bullq-api:builder-funcionaria . > /tmp/fork-funcionaria-build.log 2>&1   # nest build = tsc, exit 0
  docker run --rm chat-bullq-api:builder-funcionaria npx jest src/modules/ai-agents src/modules/messaging src/modules/channel-hub   # 32 suítes, 304 testes, exit 0
  docker run --rm chat-bullq-api:builder-funcionaria npx jest                                                                          # suíte inteira: 37 suítes, 342 testes, exit 0
  ```
  Os specs novos cobrem: guardas e rota (OWNER/ADMIN), DTO (1–4, 4.000, sem
  campo extra), agente fora da regra, conversa de outra organização/apagada/
  sem acesso ao canal, atribuída a outro usuário (409), meta-talk, fila fora
  (nada preso em QUEUED); ordem exata `digitando → envio` balão a balão e o
  balão só sai depois da espera inteira; atendente assume no meio do
  "digitando…"; IA desligada depois (para) e antes (segue); falha no 2º balão;
  job reprocessado (nada reenviado); presença que rejeita, que lança e que
  nunca responde (sem rejeição solta; teto espera + 2 s); eco do webhook; e o
  envio comum igual ao de antes. No repositório, `chat-bullq-vps-patches.test.ts`
  confere a forma do 010 (arquivos, linhas removidas, nada em `ai-agents`) e
  executa as regras puras (`digitandoMs`, `motivoParaParar`) direto do patch.
  Para aplicar em produção: tag `antes-010`, imagem guardada, `git am` do 009 e
  do 010, builder + jest, imagem, recreate (spec §11.1).
