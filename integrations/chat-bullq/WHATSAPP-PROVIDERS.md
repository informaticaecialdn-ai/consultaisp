# Zappfy, Uazapi e Datafy no Chat BullQ

Patch `patches/001-whatsapp-providers.patch`, baseado no upstream
`10c14f858d500660302e32a07ba60419f885dd27`. Não altera o schema do banco.
Aplicar no fork real, depois de revisar seu diff:

```sh
git apply --check /caminho/001-whatsapp-providers.patch
git apply /caminho/001-whatsapp-providers.patch
npm ci --ignore-scripts
npx prisma generate
npm run typecheck
npm test -- --runInBand --testPathPatterns='datafy|uazapi-config|zappfy-connection|channels-connection|whatsapp-official-inbound|zappfy-reply'
npm run build
```

O patch 000 da ponte acrescenta autenticação da plataforma; o patch 002 acrescenta
modelos e rascunhos de primeiro contato. Este patch funciona sobre a base acima
e não substitui esses dois.

## Configuração dos canais

Todos os endpoints abaixo têm prefixo `/api/v1` e usam a sessão JWT da organização
com `x-organization-id`. Nunca enviar tokens de instância para o navegador.

| Opção | `type` do canal | `config` |
|---|---|---|
| Zappfy | `WHATSAPP_ZAPPFY` | `{provider:"ZAPPFY",token:"<token da instância>"}` |
| Uazapi | `WHATSAPP_ZAPPFY` | `{provider:"UAZAPI",token:"<token da instância>",baseUrl:"https://sua-instancia.uazapi.com"}` |
| Datafy | `WHATSAPP_OFFICIAL` | `{provider:"DATAFY",accessToken:"<token>",phoneNumberId:"<ID do número>",businessAccountId:"<WABA opcional>"}` |

Na Datafy, `webhookSecret` no objeto do canal é obrigatório e começa com `whsec_`.
Habilite a assinatura na aba Webhooks do número, no painel da Datafy.
O secret é por número. Ao trocar esse secret no painel, atualize o canal junto.

Zappfy usa somente `https://api.zappfy.io`. Uazapi aceita origens HTTPS em
`*.uazapi.com`, sem caminho, query, fragmento, credenciais ou porta alternativa.
Uma instalação própria pode ser liberada pelo administrador do deployment em
`UAZAPI_ALLOWED_HOSTS=wa.exemplo.com`, uma lista de hostnames exatos separados por
vírgula. Somente adicione hosts controlados e confiáveis. O painel não altera essa
allowlist. Nenhuma chamada autenticada segue redirecionamentos.

## Contratos administrativos

`GET /channels/capabilities`, registrado antes de `:id`, anuncia:

```json
{"whatsappUnofficial":true,"instanceConnect":true,"instanceStatus":true,"provider":"ZAPPFY","uazapi":true,"datafy":true,"templateFirstContact":true,"providers":["ZAPPFY","UAZAPI","DATAFY"]}
```

O Consulta ISP verifica capabilities antes de transmitir novas credenciais.
Os endpoints `GET /channels/:id/connection-status` e `POST /channels/:id/connect`
exigem OWNER/ADMIN, organização correta e grant de canal quando ele é restrito.
As respostas têm `Cache-Control: no-store` e somente estes campos:

```json
{"provider":"ZAPPFY","status":"connecting","connected":false,"loggedIn":false,"phone":null,"qrCode":null,"pairCode":null}
```

`provider` também pode ser `UAZAPI` ou `DATAFY`; `status` é `connected`,
`connecting`, `disconnected` ou `unknown`. Para Zappfy/Uazapi, `POST .../connect`
aceita `{}` para QR ou `{"phone":"5511999999999"}` para pareamento. Consulte status
para obter o QR atualizado. QR só aceita PNG em base64 e só aparece enquanto
`connecting`. O objeto bruto `instance` contém tokens e nunca é devolvido.
A Datafy conecta pelo próprio painel: `GET .../connection-status` valida `/me` e
`/numbers`; `POST .../connect` devolve um erro explicando esse fluxo, sem criar QR.

`GET /channels/:id/templates` retorna um array com somente templates aprovados.
O client do Consulta ISP converte o array para `{data:[...]}` e informa status
`APPROVED`, inclusive para o contrato anterior que não expunha esse campo.

## Datafy: envio e recebimento

Descoberta de conta, números e templates usa a raiz
`https://cloud.datafyapi.com.br` (`/me`, `/numbers`, `/templates`). O envio usa
`POST /v1/{phoneNumberId}/messages`. Token somente em `Authorization: Bearer`.
`subscribed_apps` nunca é chamado para Datafy. Mídia usa `/media/{id}` e somente
arquivos em `https://files.datafyapi.com.br`, sem encaminhar Bearer ao storage.

O início real é `POST /conversations`, pelo pipeline normal. Para primeiro contato
Datafy use `message:{type:"TEMPLATE",content:{name,language:{code},components?}}`.
O token precisa listar esse template como aprovado no mesmo idioma. O worker
revalida a aprovação antes do envio e bloqueia texto/mídia livre quando não existe
mensagem recebida desse contato nesse canal/organização nas últimas 24 horas.

Cadastre o webhook `https://<seu-chat-api>/api/v1/webhooks/WHATSAPP_OFFICIAL` na
Datafy. O payload é o original da Meta. Validamos `x-datafy-signature-256` com
HMAC-SHA256 de `timestamp + "." + rawBody`, segredo por número, comparação constante
e janela de ±300 segundos de `x-datafy-timestamp`. `x-datafy-delivery-id` precisa
ser UUID e acompanha o job de processamento. O corpo cru é obrigatório.

A fila usa IDs determinísticos por canal, bytes assinados e tipo/ID do evento;
jobs concluídos permanecem sete dias e falhas ficam na fila para retry. Assim,
reentregas simultâneas não disparam duas execuções e alterar o header de delivery
(que não faz parte do HMAC) não contorna o bloqueio. A deduplicação existente por
mensagem/canal e a restrição única do banco continuam no pipeline. Transições de
status também são limitadas ao canal da mensagem.

## Validação e limites

Fixtures falsas cobrem os três contratos, assinatura/timestamp, bytes alterados,
replay, múltiplos status no mesmo lote, isolamento de organização/grants, URLs,
redação de credenciais, QR/pareamento, templates e janela de 24h. O teste de replay
verifica os IDs/retensão configurados da fila; não envia webhooks a um Redis real.
A aplicação do patch é conferida sobre arquivos extraídos do SHA base, comparando
o resultado com as fontes locais. Conexão e envio a contas reais dependem das
credenciais de cada provedor e não foram realizados por estes testes.

Documentação pública consultada:

- [Zappfy: conectar instância](https://docs.zappfy.io/pt-BR/instancia/conectar-inst%C3%A2ncia-ao-whatsapp)
- [Zappfy: status da instância](https://docs.zappfy.io/pt-BR/instancia/verificar-status-da-inst%C3%A2ncia)
- [Uazapi: OpenAPI](https://docs.uazapi.com/openapi-bundled.json)
- [Datafy: OpenAPI e assinatura dos webhooks](https://app.datafyapi.com.br/api/openapi.json)

A prosa Zappfy orienta omitir `phone` para QR, embora seu schema público ainda o
marque como obrigatório. A implementação segue a descrição do fluxo; o schema
atual da Uazapi confirma explicitamente que esse campo é opcional.
