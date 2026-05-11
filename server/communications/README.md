# server/communications/

**Camada de mensageria multi-canal.**

- `whatsapp/` — cliente Meta WhatsApp Cloud API (Embedded Signup, templates HSM, webhooks inbound)
- `sms/` — cliente Zenvia ou Twilio (fallback)
- `email/` — cliente Resend (transacional, DKIM/SPF, lembretes formais)

**Princípio:** toda mensagem outbound passa por Júlia (Compliance Agent) ANTES de chamar o canal. Esta camada apenas EXECUTA o envio aprovado e registra prova de entrega (`delivered_at`, `read_at`) na tabela `Communication`.

**Webhooks inbound** ficam aqui também:
- `whatsapp/webhook.ts` → recebe mensagem do cliente, identifica tenant via `wabaId`, repassa para orquestrador

Nenhuma decisão de conteúdo é tomada aqui — apenas validação de signature, persistência de evento, e roteamento.
