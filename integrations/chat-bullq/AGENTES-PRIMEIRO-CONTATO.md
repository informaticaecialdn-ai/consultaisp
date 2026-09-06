# Agentes de primeiro contato

O Consulta ISP mantém três agentes separados por provedor: cobrança de clientes ativos, cobrança de ex-clientes e recuperação de equipamentos. O Painel permite escolher um modelo disponível, salvar preferências de escrita, provisionar cada agente e testar com cliente fictício. A agenda automática só pode ser habilitada para papéis provisionados.

O primeiro contato por texto é gerado pelo modelo no Chat BullQ e depois enviado pela ponte. Conversas existentes são reaproveitadas antes da geração. A primeira resposta continua com a equipe humana; nenhuma tool de negociação, baixa, pagamento ou retirada é executada pelo draft. Integrações que exigem template aprovado precisam usar o template no transporte; texto de IA não substitui essa exigência.

## Patch remoto necessário

Arquivo: `patches/002-agentes-primeiro-contato.patch`.

Base verificada: `10c14f858d500660302e32a07ba60419f885dd27` do fork Chat BullQ.

O upstream tem CRUD de agentes e um runner que envia mensagens; não possuía preparação isolada nem catálogo de modelos. Seu roteador normal substitui modelos antigos por Sakana. O patch cria um caminho separado que exige o modelo exato disponível na credencial e recusa resposta identificada como outro modelo. Não usa o runner, o endpoint de evals, conversas ou filas de envio.

Aplicação no checkout do serviço Chat BullQ, depois de conferir a revisão implantada:

```sh
git apply --check /caminho/002-agentes-primeiro-contato.patch
git apply /caminho/002-agentes-primeiro-contato.patch
```

O patch 002 adiciona seis arquivos/alterações no módulo de agentes/LLM. A ponte geral também precisa dos recursos de plataforma, abertura de conversa com IA desativada e retorno `call_webhook` do patch de compatibilidade. O 002 não instala esses recursos e não faz migrações. Aplique os patches compatíveis antes de reconstruir e publicar o serviço.

Credenciais e serviços ainda necessários: URL/chave de plataforma do Chat BullQ na instalação Consulta ISP; `SAKANA_API_KEY` válida no Chat BullQ e `SAKANA_BASE_URL` quando aplicável; serviço Sakana com catálogo `/models`; canal conectado e webhook de resposta alcançável. Não existe modelo padrão presumido: o operador escolhe um ID da lista retornada pela credencial. A antiga configuração `CHAT_BULLQ_AGENTE_MODELO` não é usada para inventar um modelo nem substituir a escolha do Painel.

## Contrato

- `GET /api/v1/ai-agents/first-contact/models`: `{ configured, models: [{ id }] }`. Consulta real do catálogo, cache de 60 segundos e deduplicação em memória; sem credencial, devolve `configured: false` e lista vazia. Falha remota é explícita.
- `POST /api/v1/ai-agents/:id/first-contact-draft`: `{ context: { nomeCliente, nomeProvedor, tom?, orientacao? } }` → `{ texto, agenteId, modelo, runId }`.
- Ambas exigem JWT, organização e papel OWNER/ADMIN. O agente é buscado com `id + organizationId + deletedAt: null`.
- O draft exige agente exclusivo com capacidade `primeiro_contato_sem_envio`, `isActive: false` e `canRespondDirectly: false`. A criação local desativa os vínculos de canal que o upstream liga automaticamente.
- Uma conclusão, sem tools, até 320 tokens; timeout LLM de 12 segundos e nenhum retry automático. Há deduplicação de requisições idênticas em andamento e limite de uma preparação por organização. A ponte aguarda até 30 segundos, cobrindo a consulta fria do catálogo.
- `runId` é correlação da preparação registrada no log operacional sem conteúdo pessoal; não é uma linha em `AiAgentRun`, cuja tabela exige conversa. Cobranças guardam esse identificador com agente/modelo nos metadados do evento de contato.
- A validação recusa tool calls, resposta truncada, links, números, dívida/valores e saída sem identificação de assistente virtual. Não há fallback de template apresentado como IA. Texto explicitamente escrito pelo operador mantém origem `operador`.

## Perfil do agente no Painel

Cada papel guarda, além do modelo e do liga/desliga, os mesmos campos do `AiAgent` do fork, com limites travados em `shared/chat-agentes.ts` e validados igualmente na tela, na rota e no serviço:

| Campo | Limite | O que é |
|---|---|---|
| `descricao` | 500 | como o provedor apresenta o agente (`description` no `CreateAgentDto`) |
| `instrucoes` | 6.000 | preferências de escrita, subordinadas às regras da casa (`systemPrompt`) |
| `contextoOperacional` | 8.000 | avisos que valem hoje (`operationalContext`) |
| `temperatura` | 0 a 1 | mais apertado que o fork (0 a 2) de propósito: cobrança não improvisa |
| `maxTokens` | 160 a 1.200 | idem, para não escrever tratado |

Campo numérico vazio significa "não definido": o Painel não envia a chave e o valor gravado permanece. Vazio nunca é enviado como zero.

**Onde o contexto operacional realmente entra.** Os dois endpoints que o Consulta ISP usa — `first-contact-draft` (patch 002) e o planejador autônomo (patch 003) — montam a mensagem de sistema APENAS com `agent.systemPrompt`. Nenhum passa pelo runner de conversa do fork, que seria quem leria `operationalContext` na camada de personalidade; o agente é criado `isActive: false`, `canRespondDirectly: false` e DISABLED em todo canal, então o runner nunca roda. Por isso o Consulta ISP grava o contexto DENTRO do `systemPrompt`, num bloco final rotulado `AVISOS DE HOJE (informados pelo provedor…)`, declarado subordinado às regras da casa. O campo `operationalContext` continua sendo enviado pelo contrato do DTO, mas quem garante a entrega ao modelo é o prompt. Sem contexto salvo, nenhum bloco entra. O contexto só chega ao modelo depois de aplicar/provisionar — salvar sozinho não reescreve o agente remoto.

## Rotas do Consulta ISP (Painel)

- `GET /api/chat-bullq/integracao/agentes` — estado e perfil dos três papéis. Operador do provedor.
- `GET /api/chat-bullq/integracao/agentes/:tipo/prompt` — `{ tipo, nomeProvedor, prompt, contextoOperacional, caracteres }`: o texto exato que vai gravado no agente. Operador do provedor, no mesmo nível da rota acima — ela já devolve instruções, descrição e contexto, e o restante do prompt está no nosso próprio fonte; é dado do provedor da sessão, não de outro tenant. A fronteira de admin fica na escrita.
- `GET /api/chat-bullq/integracao/agentes/modelos` — catálogo. Admin.
- `PUT /api/chat-bullq/integracao/agentes/:tipo`, `POST .../provisionar`, `POST .../testar` — admin.

**`configured` é repetido, não deduzido.** O catálogo devolve `configured` exatamente como o Chat BullQ respondeu. Modelos que só o catálogo local conhece continuam listados e marcados, mas não fabricam credencial: com `configured: false` a tela mostra o alerta e bloqueia aplicar e testar, e o serviço recusa o provisionamento. Deduzir `configured` do tamanho da lista escondia o alerta e deixava o card anunciar "pronto para preparar" um agente sem credencial para rodar.

**Origem de cada modelo.** `chat_bullq` é o que o serviço conectado confirmou ao vivo — vale em qualquer linhagem. `openai_vps` é conhecimento local: o fork da VPS foi patchado para OpenAI e aceita `openai/*`, mas a linhagem distribuída neste repositório (patches 000+001+002, `integrations/chat-bullq/local`) recusa esses ids com 400 e o catálogo do patch 002 só lista `fugu*`. A origem viaja com o modelo até o `<select>`, com o aviso; o padrão oferecido é sempre o que o serviço conectado confirmou.

O catálogo e progresso ficam no JSONB `agenteConfig` existente. Uma trava por provedor protege configuração/provisionamento; cada etapa grava seu identificador antes de seguir. Nomes remotos estáveis permitem reencontrar recursos após resposta perdida. Se uma criação sofreu timeout e ainda não apareceu na listagem, a retomada para com erro explícito em vez de criar duplicata. O agente legado de cobrança é reaproveitado e convertido em preparador; agenda e segredo existentes são preservados.

## Verificação local

O patch foi validado com `git apply --cached --check` sobre índice temporário inicializado no SHA base, sem modificar checkout ou índice real.

```sh
node node_modules/vitest/vitest.mjs run --config work/vitest-carteiras.config.mjs server/services/chat/chat-bullq-draft.patch.test.ts server/services/chat/chat-bullq-draft.client.test.ts server/services/chat/chat-agentes.service.test.ts server/services/chat/chat-ponte.service.test.ts server/routes/chat-bullq.routes.test.ts
```

Os testes do patch extraem os novos arquivos completos do próprio patch, transpilem TypeScript e executam o serviço/controller com doubles de Nest, banco e LLM. Cobrem isolamento, autenticação declarada, geração, ausência de ferramentas/transporte, troca de modelo, falha de credencial, validação de saída, deduplicação e catálogo real. A suíte da ponte cobre os três papéis, reaproveitamento antes de gerar, origem do texto, falha sem envio, retomada sem duplicação e preservação da agenda.

Também foram executados `tsc --noEmit` e `nest build` reais no fork com suas dependências e Prisma Client gerado: ambos concluíram sem diagnósticos. O tipo público `Draft` é exportado para que a declaração do controller compile corretamente.

Não foi feita chamada de IA real, criação remota, envio de WhatsApp, implantação ou alteração no banco nesta implementação. Aplicação dos patches no ambiente implantado e teste com credencial real continuam necessários.
