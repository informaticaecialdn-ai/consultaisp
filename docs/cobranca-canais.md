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

Não há webhook de entrega ou entrada neste módulo. Respostas a SMS não aparecem
no Consulta ISP; respostas a e-mail vão para a caixa indicada pelo provedor.

Referências oficiais consultadas:

- [Twilio Messages resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Resend: enviar e-mail](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
