# Conversa com WhatsApp, SMS e e-mail

WhatsApp permanece como compositor principal. As ações **Enviar SMS** e **Enviar e-mail** abrem formulários separados. As respostas de todos os canais aparecem na mesma linha do tempo, com o canal identificado. SMS e e-mail não alteram a janela de atendimento do WhatsApp.

O atendente precisa assumir a conversa. O destino vem do cadastro do cliente vinculado ao provedor; não é aceito um destinatário arbitrário. A proposta de e-mail usa a negociação registrada para o mesmo cliente e caso, com prévia e confirmação. O HTML é gerado pelo servidor, sem instruções livres do agente sobre valores. Enviar uma proposta não significa aceite ou pagamento.

## Configuração de recebimento

- SMS: Twilio com número capaz de receber respostas, Account SID, token e URL pública HTTPS exata do webhook indicada no Painel do Provedor.
- E-mail: Resend com domínio de envio verificado, domínio de recebimento/DNS configurado e segredo do webhook `email.received`.
- Respostas de e-mail usam endereço opaco exclusivo da conversa. SMS exige correspondência completa do telefone e uma única conversa com envio anterior. Casos ambíguos não são associados automaticamente.
- Credenciais permanecem cifradas; callbacks são autenticados conforme [Twilio](https://www.twilio.com/docs/usage/security) e [Resend](https://resend.com/docs/webhooks/verify-webhooks-requests).

## Reforços automáticos

São opcionais por conversa, com intervalo de 24 a 720 horas e seleção dos canais complementares. Os canais alternam quando ambos estão disponíveis. A régua da carteira, horário permitido, limite diário do provedor, saldo, não contatar, pausa e atendimento humano impedem envios indevidos. Resposta recebida desliga o reforço e encaminha para atendimento humano. Não há negociação financeira autônoma por SMS/e-mail nesta implementação: os reforços convidam a retomar o atendimento sem revelar valores antes da identificação.

O worker dedicado só envia com `--enviar`; o modo local de ensaio continua sem chamadas externas. Não execute o worker dedicado e o worker completo simultaneamente. Tentativas têm reserva durável e idempotência. Estado “enviado” significa aceite pelo fornecedor, não confirmação de entrega.

## Banco e verificação

Migração aditiva `0041_chat_multicanal.sql`, com mensagens, configuração e chaves por provedor/conversa. Backup anterior em `work/backups/multicanal-before.dump`; migração exercitada na base restaurada antes da base local. Smoke na base restaurada verificou listagem, configuração, recebimento e repetição idempotente sem envio externo.

O funcionamento real dos retornos depende de credenciais, DNS e endpoints HTTPS alcançáveis pelos fornecedores. O endereço local 127.0.0.1 não recebe callbacks externos.
