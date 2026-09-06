# Chat BullQ local real

Este ambiente usa o backend NestJS real, PostgreSQL com pgvector e Redis próprios.
Não possui canais, clientes ou agentes de demonstração. Todas as portas publicadas
ficam em `127.0.0.1`; o PostgreSQL do Consulta ISP na porta 5432 não é utilizado.

## Preparar do zero

Requisitos: Docker com Compose, Node.js compatível com o Chat BullQ, checkout da
API no commit documentado e patches `000`, `001` e `002` aplicados em ordem.
O destino padrão da API é `work/references/chat-bullq-api`; outro checkout pode ser
informado com `--api-dir CAMINHO_ABSOLUTO`.

Na raiz do checkout do Chat BullQ API:

```powershell
npm ci --ignore-scripts
npx prisma generate
```

Na raiz do Consulta ISP:

```powershell
node integrations/chat-bullq/local/manage.mjs start
node integrations/chat-bullq/local/manage.mjs status
```

O início gera segredos em `work/chat-bullq-local/.env.local`, limita as permissões
do arquivo, compila a API, cria os containers e aplica as migrações somente quando
o banco dedicado está vazio. Um banco existente passa por `prisma migrate status`;
o comando nunca faz reset nem aplica migração nova implicitamente sobre seus dados.
Não há execução de seed.

Se uma porta estiver ocupada, ajuste `PORT`, `POSTGRES_PORT` ou `REDIS_PORT` no
arquivo privado antes de iniciar. Ao mudar a porta PostgreSQL, atualize também
`DATABASE_URL`. Mantenha nomes e hosts do banco dedicados; 5432 é recusada.

## Endereços e estado

| Serviço | Endereço padrão |
|---|---|
| API | `http://127.0.0.1:3002` |
| Documentação da API | `http://127.0.0.1:3002/docs` |
| PostgreSQL Chat BullQ | `127.0.0.1:5544`, banco/usuário `chat_bullq_local` |
| Redis Chat BullQ | `127.0.0.1:6382` |

`work/chat-bullq-local.json` registra PID, URL, containers, volumes e caminhos dos
logs. Não contém valores de segredos. Os arquivos de runtime são ignorados pelo Git.

Para conectar o Consulta ISP, use `CHAT_BULLQ_URL=http://127.0.0.1:3002` e copie
localmente `PLATFORM_API_KEY` do arquivo privado para `CHAT_BULLQ_PLATFORM_KEY`.
Não cole essa chave em mensagens, commits ou comandos que a imprimam. O iniciador
não altera o `.env` do Consulta ISP.

O serviço sobe sem chaves LLM. O catálogo de modelos informa `configured: false`;
preparar primeiro contato depende de configurar a credencial real. Nenhum texto
fictício substitui a chamada ao modelo.

As filas internas do Chat BullQ permanecem operacionais para o atendimento manual
após conectar credenciais reais. A régua automática é controlada separadamente pelo
Consulta ISP: manter `RUN_BG_JOBS_IN_API=false` e não iniciar seu worker enquanto
essa automação local não for desejada. Criar/conectar canais com credenciais reais
pode iniciar sincronização do provedor; faça isso somente quando for intencional.

O retorno interno do Chat BullQ usa
`CONSULTA_ISP_WEBHOOK_URL=http://127.0.0.1:5000/api/webhooks/chat-bullq`.
Configure `CHAT_BULLQ_WEBHOOK_URL` com a mesma URL no Consulta ISP. Essa exceção
HTTP é restrita a esse endereço exato com `NODE_ENV=development`; os demais
ambientes e destinos exigem HTTPS.

Webhooks externos precisam de um túnel HTTPS configurado depois. O loopback sozinho
não recebe eventos de Datafy, Meta ou Uazapi. Para a configuração automática de
webhook do Uazapi/Zappfy, ajuste `APP_URL=https://SEU_HOST_PUBLICO_BULLQ` (sem barra
final) no arquivo privado do Chat BullQ e reinicie a API: o destino gerado é
`APP_URL/api/v1/webhooks/WHATSAPP_ZAPPFY`. O retorno interno pode continuar em
loopback; não há exposição pública automática neste iniciador.

## Parar e preservar dados

```powershell
node integrations/chat-bullq/local/manage.mjs stop
```

O comando confere o PID do iniciador antes de parar a API e usa `docker compose stop`.
Os volumes `consultaisp-chat-local-postgres` e `consultaisp-chat-local-redis` são
preservados. Para reiniciar, execute `start` novamente.

Não use `down -v`, reset do Prisma ou exclusão dos volumes para resolver falha de
startup. Leia os logs em `work/chat-bullq-local/`. Antes de uma migração adicional,
faça backup do banco dedicado com `pg_dump` e valide a mudança separadamente.
