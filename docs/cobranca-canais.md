# Canais de cobrança: SMS e e-mail

Cada provedor configura suas credenciais em `GET/PUT /api/cobranca/canais`.
A leitura exige sessão de provedor; a alteração exige administrador ou janela
de suporte autorizada. Tokens nunca são devolvidos. Na edição, segredo vazio
preserva o anterior. A migração `0040` cria a configuração cifrada por provedor,
usando o mesmo AES-256-GCM e `SESSION_SECRET` das integrações ERP.

- **SMS / Twilio:** Account SID, Auth Token e número Twilio habilitado para SMS.
  Remetente e destinatário usam E.164 (`+55…`). Até 1.600 caracteres; o fornecedor
  pode dividir a mensagem em segmentos e cobrar por segmento.
- **E-mail / Resend:** chave de API, endereço em domínio verificado, nome do
  remetente e endereço opcional para receber respostas (`reply_to`). O transporte
  manda texto puro. Não reutiliza a chave de e-mails transacionais da plataforma.

Salvar ou ativar um canal não manda mensagem. O worker é responsável por reservar
a chave de idempotência durável antes de chamar `enviarComunicacaoCobranca`.
O serviço faz uma tentativa com prazo de 15 segundos. Resend também recebe uma
chave de idempotência vinculada ao provedor; a proteção remota dura 24 horas.
Twilio não documenta chave de idempotência para criar uma Message: a reserva no
ledger é indispensável para impedir repetição depois de um timeout ou restart.

`enviado` significa aceito pelo fornecedor, não confirmação de entrega. Falha
de rede, timeout, HTTP 408/5xx ou sucesso sem ID resultam em `incerto`: não
repetir automaticamente. HTTP 4xx restantes resultam em `falhou`. O retorno
guarda `providerMessageId` para conferência no painel do fornecedor.

Não há webhook de **entrega**: `enviado` continua sendo "aceito pelo fornecedor".

## Respostas do cliente (entrada)

Respostas de SMS entram no chat quando a URL de recebimento estiver configurada
na Twilio **e** aqui; senão o canal é só envio. Respostas de e-mail vão para a
caixa indicada em `responderPara`, ou para o chat quando o domínio de
recebimento e o segredo do webhook estiverem configurados. As rotas vivem em
`server/routes/webhooks-canais.routes.ts` e o retorno é gravado por
`persistirRetornoMulticanal` (a conversa sai do assistente, o cliente ganha
pausa de 48 horas e o caso passa a "Responder no chat").

- **SMS:** `POST /api/webhooks/canais/sms/:providerId`, corpo
  `application/x-www-form-urlencoded`. `sms.webhookUrl` é a URL HTTPS exata
  (sem parâmetros) cadastrada no número Twilio em "A message comes in"; a
  assinatura `X-Twilio-Signature` é conferida com o `authToken` sobre essa URL
  mais os parâmetros ordenados. Sem `ativado`, `authToken` ou `webhookUrl`, ou
  com assinatura inválida, a requisição recebe 401; `AccountSid` ou `To`
  diferentes da conta e do `remetente` configurados recebem 400. O texto só entra
  na conversa de um cliente identificado pelo telefone completo (DDI 55) que já
  recebeu um SMS de saída dela; o resto é aceito e descartado.
- **E-mail:** `POST /api/webhooks/canais/email/:providerId`, evento
  `email.received` do Resend, verificado (Svix) com `email.webhookSecret`
  (`whsec_…`) sobre o corpo cru. O reply-to das mensagens do chat é
  `chat+<token>@<receivingDomain>`; a resposta é buscada na API do Resend com
  a `apiKey` e ligada à conversa pelo token. Exige `ativado`, `apiKey`,
  `receivingDomain` e `webhookSecret`.

Os dois segredos (`authToken`, `webhookSecret`) nunca são devolvidos pela API;
`GET /api/cobranca/canais` informa só `recebimentoConfigurado` por canal.

Referências oficiais consultadas:

- [Twilio Messages resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Resend: enviar e-mail](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
