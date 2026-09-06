# Patches para a linhagem da VPS

> **A chave da OpenAI está VAZIA na VPS (medido em 06/09/2026: o valor de
> `OPENAI_API_KEY` tem comprimento zero, no `.env.api` e dentro do container).**
> Os dois endpoints sobem e respondem, mas o catálogo devolve `configured:false`
> e a preparação/planejamento devolvem 503 até alguém preencher a chave — isso é
> decisão de dinheiro do dono, não uma falha do patch. Confira com
> `npx tsx script/diagnostico-chat.ts <providerId>` no Consulta ISP: a linha
> "credencial de IA configurada" responde por este ponto.

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

## Ordem de aplicação na VPS

Base obrigatória: `12d97ae` (linhagem própria da VPS + patch 001). Depois, em
ordem, **`vps/002` e então `vps/003`** — o 003 edita arquivos que o 002 cria
(`agents/first-contact.service.ts`) e por isso não aplica sozinho.

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
