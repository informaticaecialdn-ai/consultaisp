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

## Ordem de aplicação na VPS

Base obrigatória: `12d97ae` (linhagem própria da VPS + patch 001). Depois, em
ordem, **`vps/002`, `vps/003` e então `vps/008`** — o 003 edita arquivos que o
002 cria (`agents/first-contact.service.ts`) e o 008 edita arquivos que o 003
cria, por isso nenhum deles aplica sozinho.

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
