# Ponte do Consulta ISP com o Chat BullQ

O patch `patches/000-ponte-consultaisp.patch` foi construído para o commit
`10c14f858d500660302e32a07ba60419f885dd27` do Chat BullQ API. Aplicar antes dos
patches `001` (canais), `002` (agentes) e `003` (planejamento autônomo,
`POST /ai-agents/:id/autonomous-plan`). Não altera schema nem executa migração.
A ordem completa e a nota sobre a linhagem da VPS estão no [README](README.md).

## Configuração no Chat BullQ API

- `PLATFORM_API_KEY`: segredo aleatório de pelo menos 32 caracteres, igual a
  `CHAT_BULLQ_PLATFORM_KEY` no Consulta ISP. Ausente ou curto desabilita `/platform`.
- `CONSULTA_ISP_WEBHOOK_URL`: URL HTTPS exata do retorno. O padrão é
  `https://consultaisp.com.br/api/webhooks/chat-bullq`; uma URL diferente precisa
  coincidir com `CHAT_BULLQ_WEBHOOK_URL` do Consulta ISP. Redirecionamentos,
  credenciais na URL, query e fragmento são recusados.
  Somente com `NODE_ENV=development`, também é aceita a URL exata
  `http://127.0.0.1:5000/api/webhooks/chat-bullq`, quando configurada nessa variável.
  Outros destinos HTTP e esse mesmo loopback fora de desenvolvimento são recusados.
- Manter `JWT_SECRET` e `JWT_REFRESH_SECRET` do serviço de autenticação existente.

## Contratos

Todas as rotas abaixo usam prefixo `/api/v1`, header `x-platform-key` e o envelope
existente `{ data, meta }`.

| Operação | Corpo | Resposta `data` |
|---|---|---|
| `POST /platform/organizations` | `name`, `ownerName`, `ownerEmail`; `externalId` ou `slug`; opcionais `ownerPassword`, `slug` | `organizationId`, `slug`, `ownerUserId`, `ownerEmail`, `created` |
| `POST /platform/organizations/:id/token` | sem corpo | `accessToken`, `refreshToken` |
| `POST /platform/organizations/:id/owner-password` | `password` de 12 a 128 caracteres | `ownerUserId`, `ownerEmail` |

O ID determinístico da organização usa a chave primária existente para impedir
duplicação por chamadas simultâneas. Metadados ficam em `Organization.settings`.
Repetir o mesmo `externalId` retorna a organização existente, sem redefinir senha.
Colisões de slug, e-mail ou dono são recusadas. O owner precisa ser uma conta
exclusiva daquela organização, ativa e com papel OWNER; contas de outras
organizações não são reutilizadas nem têm a senha alterada pela ponte.

Tokens vêm do `AuthService` existente e continuam sujeitos a JWT, vínculo de
organização e acesso aos canais. O cliente usa Bearer + `x-organization-id` para
as operações e `/auth/refresh` para renovação.

`POST /conversations` aceita `aiEnabled: false`. A conversa nova nasce pausada;
uma conversa reaproveitada é pausada e perde o agente fixado antes do envio.
`aiEnabled: true` e `activeAgentId` não são admitidos por esse contrato de primeiro
contato. A transição OPEN/WAITING → PENDING libera o owner técnico para a fila humana.

A ação de automação `call_webhook` recebe `{ url, secret }`, com segredo de 16 a
200 caracteres. O evento é conferido contra a organização, conversa e mensagem
INBOUND antes da entrega. O corpo contém IDs e o gatilho, sem o texto da mensagem;
`x-signature-256` é HMAC-SHA256 do JSON exato. Há até três tentativas, timeout de
5 segundos por tentativa e nenhuma navegação por redirecionamento. Falhas
permanecem visíveis no histórico da automação. Listar, ler e testar a automação
requer OWNER/ADMIN, pois sua configuração contém o segredo.

## Verificação local

Sem banco, credenciais ou requisições remotas:

```sh
npx jest --runInBand --testPathPatterns 'platform.spec.ts|call-webhook.handler.spec.ts|consulta-isp-bridge.spec.ts'
npx tsc --noEmit --incremental false
git apply --check integrations/chat-bullq/patches/000-ponte-consultaisp.patch
```

Com a série inteira aplicada, os specs do 003 entram no mesmo jest:
`autonomous-plan.service.spec.ts|autonomous-plan-privacy.spec.ts`.

O último comando deve usar o caminho real do patch e ser executado na raiz de
uma cópia do Chat BullQ API ainda sem o patch (os seguintes, 001→003, cada um
sobre a cópia com o anterior já aplicado). Os testes usam repositórios e
transporte simulados; não comprovam a entrega no ambiente implantado.
