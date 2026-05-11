# Submissão HSM Templates ao Meta Business Manager

**Templates a submeter:** 2

1. `lembrete_prevencimento_v1` — Bruno (UTILITY, IMAGE header com QR Code)
2. `agradecimento_pagamento_v1` — Sofia (UTILITY, texto puro)

**WABA do Vertical Fibra:** já conectada via Spec 003 (Embedded Signup).

**Tempo esperado de aprovação:** 24-72h por template.

---

## Passo 1 — Acessar Meta Business Manager

1. Abrir [business.facebook.com](https://business.facebook.com)
2. Selecionar a Business Account do Vertical Fibra
3. Menu lateral → **WhatsApp Manager**
4. Selecionar o WABA (número de telefone do Vertical Fibra)
5. Abrir **Account Tools → Message templates**

## Passo 2 — Criar template Bruno (`lembrete_prevencimento_v1`)

Source de verdade: `drafts/template-lembrete-prevencimento-v1.json`.

Na UI:

- **Nome:** `lembrete_prevencimento_v1`
- **Categoria:** Utility
- **Idioma:** Portuguese (BR) — pt_BR
- **Header:**
  - Tipo: **Media → Image**
  - Sample: subir um PNG genérico (256×256px) de exemplo de QR Code (qualquer QR funciona pra aprovação — o real virá em runtime)
- **Body:**
  ```
  Olá, {{1}}! Passando para lembrar que sua fatura de {{2}} vence em {{3}}. Para facilitar, segue o QR Code do Pix — basta abrir o app do banco, ir em Pix → Pagar com QR Code e apontar a câmera. Em caso de dúvida, é só responder esta mensagem que a gente ajuda.
  ```
- **Sample values:**
  - {{1}}: `João`
  - {{2}}: `R$ 149,90`
  - {{3}}: `14/05/2026`
- **Footer:** `Mensagem automática — responda para falar com atendimento`

**Submeter para aprovação.**

### Fallback se Meta rejeitar IMAGE

Algumas categorias UTILITY exigem header texto. Body alternativo (mesmas variáveis):

```
Olá, {{1}}! Sua fatura de {{2}} vence em {{3}}. Para pagar via Pix, use o código copia-e-cola que enviaremos logo após esta mensagem ou responda aqui que a gente passa a 2ª via.
```

## Passo 3 — Criar template Sofia (`agradecimento_pagamento_v1`)

Source: `drafts/template-agradecimento-pagamento-v1.json`.

Na UI:

- **Nome:** `agradecimento_pagamento_v1`
- **Categoria:** Utility
- **Idioma:** Portuguese (BR) — pt_BR
- **Header:** nenhum
- **Body:**
  ```
  Obrigado, {{1}}! Pagamento de {{2}} confirmado em {{3}}. Está tudo certo por aqui — qualquer coisa, é só responder esta mensagem.
  ```
- **Sample values:**
  - {{1}}: `João`
  - {{2}}: `R$ 149,90`
  - {{3}}: `14/05/2026`
- **Footer:** `Mensagem automática — Provedor.ai`

**Submeter para aprovação.**

## Passo 4 — Acompanhar status

- Aprovação típica: 24-72h
- Notificação chega no email do admin Business Manager
- Status pode ser visto em **WhatsApp Manager → Templates**

## Passo 5 — Após aprovação, atualizar `agent_toggles`

No painel admin do Vertical Fibra (`/configuracoes/agentes`):

1. Campo "Template Bruno (D-3/D-1)": digite o nome **exato** aprovado pelo Meta (deve ser `lembrete_prevencimento_v1`).
2. Campo "Template Sofia (agradecimento)": `agradecimento_pagamento_v1`.
3. Salvar.

OU via SQL direto na VPS:

```sql
UPDATE agent_toggles
SET
  template_bruno_nome = 'lembrete_prevencimento_v1',
  template_sofia_nome = 'agradecimento_pagamento_v1',
  updated_at = NOW()
WHERE provider_id = <vertical_fibra_id>;
```

## Passo 6 — Validar com 1 envio de teste

Após aprovação + atualização:

1. Disparar Bruno scheduler manualmente (ver SMOKE-TEST-RESULT.md Etapa 5)
2. Verificar mensagem chega no celular do owner com o conteúdo do template real (não texto livre fallback)

## Notas

- **Renomear template** (alterar texto após submit) **invalida o nome** — você precisa criar `lembrete_prevencimento_v2` em vez de editar v1. Por isso o sufixo `_v1` no nome.
- **Categoria errada (Marketing em vez de Utility)** dobra o custo por mensagem e exige opt-in explícito. Lembrete pré-vencimento é Utility (transacional, parte da execução do contrato).
- **Caracteres especiais (acentos)** funcionam normalmente em pt_BR.
- **Variáveis sem default sample** são rejeitadas — sempre incluir sample na UI.

## Templates submetidos — registro

| Template | Submetido em | Status atual | Aprovado em | Nome final no Meta |
|---|---|---|---|---|
| lembrete_prevencimento_v1 | ___________ | ⬜ Pending · ⬜ Approved · ⬜ Rejected | ___________ | ___________ |
| agradecimento_pagamento_v1 | ___________ | ⬜ Pending · ⬜ Approved · ⬜ Rejected | ___________ | ___________ |

## Custo Meta WhatsApp Cloud API (referência)

- UTILITY (BR): ~R$ 0,032 por conversa de 24h iniciada por business
- Conversa inclui múltiplas mensagens dentro da janela 24h
- Mensagens iniciadas pelo cliente (inbound) = grátis (free-form 24h)

Estimativa Vertical Fibra: 140 envios Bruno/dia + 30 Sofia/dia = 170 conversas/dia = ~R$ 5,44/dia/provider = ~R$ 163/mês/provider.
