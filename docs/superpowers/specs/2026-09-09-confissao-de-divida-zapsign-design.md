# Confissão de dívida (CPC 784) com assinatura eletrônica via ZapSign — desenho

Data: 09/09/2026 · Autor: Claude (arquiteto) · Aprovação do dono: desenho aprovado em chat ("sim") · Versão 2, depois da revisão adversarial de 09/09/2026 (46 achados de três revisores: código, produto/jurídico, segurança/LGPD) — as mudanças estão marcadas com **[rev]**.

## 1. Objetivo

Dentro do módulo de cobrança, formalizar a dívida de um cliente num **instrumento particular de confissão de dívida** assinado eletronicamente pelo devedor (e, se o provedor quiser, por ele também), com o valor e as parcelas que o sistema já conhece, lidos do acordo ou do ERP **ao vivo**. O documento assinado é título executivo extrajudicial (CPC, art. 784, III e §4º) e fica guardado no Consulta ISP, ligado ao cliente e ao caso.

Hoje o 360 tem só o botão desligado ("GATED: sem assinatura eletrônica nem parecer jurídico do modelo") e um interruptor "Confissão CPC 784" que não grava nada.

## 2. Decisões

### 2.1 Do dono (09/09/2026)

| Pergunta | Decisão |
|---|---|
| De quem é a conta do ZapSign | **Uma por provedor.** O provedor cria e paga a conta dele; o superadmin grava o token no painel, como faz com o ERP. O documento sai em nome do provedor. |
| De onde vem o texto | **Os dois.** Texto padrão nosso, gerado em PDF, com o aviso "modelo padrão, sem parecer jurídico" até um admin marcar como revisado; e o modelo do próprio ZapSign quando o provedor cadastrar o id dele. |
| O que a confissão formaliza | **Os dois.** Com acordo aceito, espelha as parcelas do acordo; sem acordo, o saldo integral do ERP com a data que o operador definir. O operador nunca digita valor. |

### 2.2 Que ficam para o dono confirmar na leitura desta spec **[rev]**

1. **Saldo integral: o que se confessa.** Recomendado: principal **mais** multa e juros até a data da leitura, pela `politica.encargos` do provedor (é o "valor atualizado" que o 360 já mostra), discriminados no Anexo I. Alternativa: só o principal, com a frase "o credor renuncia aos encargos vencidos até esta data".
2. **O provedor assina?** Recomendado: **não** por padrão (`provedor_assina = false`): o título exige a assinatura do devedor; a do credor é dispensável, custa um fluxo a mais e trava o status enquanto ninguém do provedor assina. Liga-se por provedor.
3. **Contato alterado pelo operador** (e-mail/WhatsApp diferentes do cadastro do ERP): a emissão exige `validate_cpf: true` sempre; o dono decide se também exige selfie nesse caso (custa créditos).

Regras da casa que valem aqui: nada inventado (todo número vem do acordo ou do ERP ao vivo); multi-tenant absoluto; ação sensível exige admin; o dono decide dinheiro, dado irreversível e escopo.

## 3. O que o ZapSign oferece (conferido na documentação em 09/09/2026)

- Produção `https://api.zapsign.com.br/api/v1/` (há também `https://br.api.zapsign.com.br/api/v1`); sandbox `https://sandbox.api.zapsign.com.br/api/v1/`, réplica da produção **sem validade jurídica**; o payload do webhook traz o booleano `sandbox`.
- Autenticação: token estático em `Authorization: Bearer {api_token}`, gerado em Configurações > Integrações > API ZAPSIGN da conta do provedor.
- Criar documento: `POST /docs/` com `name`, `base64_pdf` (ou `url_pdf`/`url_docx`), `signers[]`, `lang: "pt-br"`, `external_id`, `folder_path`, `brand_name`, `date_limit_to_sign`, `reminder_every_n_days`, `allow_refuse_signature` (padrão false), `disable_signer_emails`, `signature_order_active`. Resposta: `token` do documento, `status: "pending"`, `signers[].token` e `signers[].sign_url`, `original_file`, `signed_file`.
- Criar por modelo: `POST /models/create-doc/` com `template_id`, `signer_name/email/phone_*`, `data: [{ de: "{{VARIAVEL}}", para: "valor" }]`, `external_id`; o segundo signatário por `POST /docs/{token}/add-signer/`.
- Signatário: `auth_mode` em `assinaturaTela`, `tokenEmail`, `tokenSms`, `tokenWhatsapp`, `certificadoDigital` e combinações `assinaturaTela-token*`; `send_automatic_email`, `send_automatic_whatsapp`, `send_automatic_whatsapp_signed_file`, `cpf`, `require_cpf`, `validate_cpf`, `require_selfie_photo`, `qualification`, `external_id`, `lock_name/email/phone`, `custom_message`, `redirect_link`, `order_group`.
- **Custos** (doc, 09/09/2026): documento consome a cota do plano; `tokenWhatsapp` e `certificadoDigital` 5 créditos por assinatura; `tokenSms` R$ 0,10; `send_automatic_whatsapp` R$ 0,50 por envio; biometria 15 a 50 créditos; tela e e-mail sem custo (1 crédito = R$ 0,10).
- Detalhar: `GET /docs/{token}/` → `status` (`pending` | `signed`), `signers[].status` (`new` | `link-opened` | `signed`), `signed_at`, `signed_file`, `deleted`, `sandbox`. **Os links de arquivo expiram em 60 minutos**; recusa e expiração **não** aparecem no detalhe.
- Excluir: `DELETE /docs/{token}/` (soft delete, sem volta).
- Webhooks: `POST /user/company/webhook/` com `url`, `type` e **`doc_token`** (só os eventos daquele documento); o `id` devolvido é o que liga o cabeçalho personalizado em `POST /user/company/webhook/header/` (`name`, `value`, `id`). Todo envio traz `event_type`. **Não há assinatura HMAC**. O ZapSign espera 200; outra resposta gera reenvio "e/ou requisições desnecessárias" — a retentativa é configuração da conta, não garantia.
- Reenvio de notificação: existe por signatário na doc de signatários (limite de 1 a cada 30 min); o endpoint em massa citado na revisão **não foi confirmado** na doc — o plano confirma antes de expor o botão "Reenviar".

## 4. Arquitetura

```
Painel do Provedor (superadmin) ─Salvar/Ativar─▶ assinatura_integracoes (token cifrado, ambiente, modelo, signatário do provedor, prazo, auth_mode)
                                                        │
Cliente 360 ─"Confissão de dívida"─▶ GET …/base ──▶ ERP AO VIVO (snapshotAoVivoDoCliente) ou acordo aceito ──▶ prévia + bloqueios
                              └──▶ POST …/confissoes (trava por cliente, chave de idempotência)
                                       │ rascunho → PDF (modelo padrão) ou dados do modelo → ZapSign: criar doc + add-signer + webhook POR DOCUMENTO + cabeçalho
                                       ▼
                             cobranca_confissoes (status, ambiente, tokens, parcelas, base canônica + hash, Anexo I do ERP)
                             cobranca_confissoes_pdf (original e assinado, em base64, fora da linha principal)
                                       ▲
POST /api/webhooks/zapsign/:providerId ─cabeçalho secreto─▶ só se `enviada` ─▶ reconsulta GET /docs/{token}/ no host do ambiente DA LINHA ─▶ transição atômica + evento no caso
Worker: reconciliação (reconciliar_em vencido primeiro; as demais `enviada` a cada 6 h; `expirada` quando passa a data limite)
```

| Componente | Onde | Faz | Depende de |
|---|---|---|---|
| Modelo padrão | `shared/cobranca/confissao-modelo.ts` | Texto versionado com variáveis; `renderizarConfissao(base, geradoEm)` determinístico; base canônica e hash | nada (puro) |
| Por extenso | `shared/cobranca/por-extenso.ts` | Valor em reais por extenso | nada |
| Gerador de PDF | `server/assinatura/pdf.ts` | Texto final → PDF (`pdfkit`, dependência nova de produção), corpo 12 pt, cláusulas restritivas em destaque (CDC art. 54, §§3º e 4º), rodapé com versão, hash e avisos | modelo |
| Conector ZapSign | `server/assinatura/zapsign.ts` | Chamadas HTTP no host do ambiente pedido; sem estado; erros mapeados sem vazar corpo | `fetch` nativo |
| Storage | `server/storage/assinatura.storage.ts` (+ fachada) | `assinatura_integracoes`, `cobranca_confissoes`, `cobranca_confissoes_pdf`; sempre por `provider_id`; `getParaAdmin` sem segredos, `getComCredencial` só para o conector | Drizzle |
| Rotas do provedor | `server/routes/confissao.routes.ts` | base, emitir, listar, detalhar, cancelar, reenviar, PDF, estado, marcar modelo revisado | storage, conector, PDF, `exigirAdminDoProvedor` |
| Config do superadmin | `server/routes/admin.routes.ts` (ao lado do ERP) | GET/PUT/ativar da integração, com os limiters `limiteConfigErp`/`limiteTesteErp` que já vivem lá | storage, conector |
| Webhook | `server/routes/webhooks-zapsign.routes.ts` | recebe, autentica pelo cabeçalho, limita, reconsulta, aplica | storage, conector, `createRateLimiter` |
| Reconciliação | `server/services/confissao-reconciliacao.service.ts` (worker) | reconsulta o que não teve retorno; expira; avisa | storage, conector |
| Tela | `client/src/components/cobranca/ConfissaoDeDivida.tsx` + uso no 360, kanban, lista e Painel do Provedor | diálogo de emissão, estados por signatário, PDF, selos, custo | TanStack Query |

## 5. Dados (migração 0037; `shared/schema.ts` ganha as três tabelas)

### 5.1 `assinatura_integracoes`

| Coluna | Tipo | Nota |
|---|---|---|
| id | serial PK | |
| provider_id | integer FK providers; único por (provider_id, fornecedor) | tenant |
| fornecedor | text | só `zapsign` por ora |
| api_token | text | **cifrado** com `encryptField` (server/utils/crypto.ts) |
| ambiente | text | `sandbox` (padrão) ou `producao` |
| template_id | text, null | id do modelo no ZapSign; null = modelo padrão |
| signatario_nome, signatario_cpf, signatario_email, signatario_telefone | text, null | o representante do provedor, usado só quando `provedor_assina` |
| provedor_assina | boolean, padrão false | **[rev]** decisão 2.2-2 |
| auth_mode_cliente | text | padrão `assinaturaTela-tokenWhatsapp`; o Zod **recusa `assinaturaTela` puro** ("sem prova de quem assinou") **[rev]** |
| exigir_selfie | boolean, padrão false | `require_selfie_photo`; ligar exige ler a base legal e o custo na tela |
| prazo_assinatura_dias | integer, padrão 15 | → `date_limit_to_sign` **[rev]** |
| enviar_arquivo_assinado_whatsapp | boolean, padrão false | `send_automatic_whatsapp_signed_file` (R$ 0,50) **[rev]** |
| modelo_revisado_em, modelo_revisado_por_user_id | timestamp/int, null | admin marcou o texto padrão como revisado |
| webhook_secret | text | `crypto.randomBytes(32).toString("base64url")`, gerado no primeiro PUT e **regenerado quando `api_token` ou `ambiente` mudam**; nunca sai por GET **[rev]** |
| is_enabled | boolean, padrão false | só "Ativar" liga |
| ativada_em | timestamp, null | quando o teste do token passou |
| created_at, updated_at | timestamp | |

O webhook é **por documento** (5.2), então a integração não guarda id de webhook de conta. **[rev]**

### 5.2 `cobranca_confissoes`

| Coluna | Tipo | Nota |
|---|---|---|
| id | serial PK | |
| provider_id | integer FK providers | tenant |
| customer_id | integer FK customers | |
| caso_id | integer FK cobranca_casos, **NOT NULL** | a confissão exige caso vivo; sem caso, o diálogo oferece "Abrir caso" antes (regra do botão "Abrir negociação") **[rev]** |
| negociacao_id | integer FK cobranca_negociacoes, null | o acordo, quando a base é ele |
| origem | text | `acordo` ou `saldo_integral` |
| ambiente | text NOT NULL | foto do ambiente na emissão (`sandbox`/`producao`) **[rev]** |
| zapsign_sandbox | boolean, null | o `sandbox` que o ZapSign devolve na reconsulta **[rev]** |
| valor_total | numeric(10,2) | Σ das parcelas confessadas |
| valor_original, desconto_pct | numeric, null | do acordo (`valorOriginal`, `descontoPct`), para a cláusula condicional **[rev]** |
| parcelas | jsonb | `[{ n, rotulo: "entrada" \| "parcela", valor, vencimento }]` |
| erp_source, erp_lido_em, erp_faturas | text, timestamp, jsonb | a leitura ao vivo que virou o Anexo I: `[{ erpRef, descricao, vencimento, valor, classe: "servico" \| "multa" \| "equipamento" \| "indeterminada" }]` **[rev]** |
| modelo, modelo_versao, modelo_revisado | text, text, boolean | `padrao`/`zapsign`; versão do texto ou `template_id`; foto no momento |
| base_canonica | jsonb | o JSON estável que gerou o texto (origem, partes, parcelas, valores, cadastro, plano, início, versão, ambiente) |
| texto_hash | text | SHA-256 de `base_canonica` — **sem data/hora** **[rev]** |
| gerado_em | timestamp | o instante impresso no rodapé; com ele o render é reproduzível |
| status | text | `rascunho` → `enviada` → `assinada` \| `cancelada` \| `expirada`; e `quitada`, `substituida` (ver 6.6) **[rev]** |
| recusa_informada_em, expiracao_informada_em | timestamp, null | o que o webhook informou e a reconsulta não prova **[rev]** |
| reconciliar_em | timestamp, null | próxima reconsulta forçada (falha na reconsulta → +10 min) **[rev]** |
| zapsign_doc_token, webhook_zapsign_id | text, null | o documento e o webhook registrado para ele **[rev]** |
| zapsign_signers | jsonb | `[{ papel: "cliente" \| "provedor", token, sign_url, status, signed_at, auth_mode }]` — **só esses campos** **[rev]** |
| cliente_nome, cliente_cpf_cnpj, cliente_email, cliente_telefone | text | como foram ao ZapSign |
| cliente_email_erp, cliente_telefone_erp, contato_alterado_por_user_id | text, text, int null | o que o ERP tinha e quem mudou **[rev]** |
| representante_nome, representante_cpf | text, null | devedor PJ: quem assina pela empresa **[rev]** |
| data_limite_assinatura | date | emissão + `prazo_assinatura_dias` |
| enviada_em, assinada_em, encerrada_em | timestamp, null | |
| pdf_original_sha256, pdf_assinado_sha256 | text, null | os bytes ficam em 5.3 |
| criada_por_user_id, aprovada_por_user_id | integer | quem pediu; quem aprovou |
| chave_idempotencia | uuid, null | do POST; único por (provider_id, chave) |
| erro_ultimo | text, null | última falha, para a tela |
| created_at, updated_at | timestamp | |

Índices: `(provider_id, customer_id)`, `(provider_id, status)`, único parcial em `zapsign_doc_token`, **único parcial `(provider_id, customer_id) WHERE status IN ('rascunho','enviada')` — uma confissão viva por cliente** **[rev]**, único parcial `(provider_id, chave_idempotencia)`.

### 5.3 `cobranca_confissoes_pdf` **[rev]**

`confissao_id` FK, `provider_id`, `tipo` (`original` | `assinado`), `sha256`, `tamanho_bytes`, `base64`, `baixado_em` (último download), PK `(confissao_id, tipo)`. O storage **nunca seleciona `base64` fora de `obterPdf(providerId, confissaoId, tipo)`**; o `signed_file` acima de 8 MB é recusado com `erro_ultimo`.

### 5.4 Evento do caso

`TIPOS_DE_EVENTO` e `ROTULO_TIPO_DE_EVENTO` (shared/cobranca/estados.ts) ganham `confissao` ("Confissão de dívida"), com a lista pinada em `estados.test.ts` atualizada e a linha `confissao: "Nasce da emissão/retorno da confissão (POST /api/cobranca/clientes/:id/confissoes e webhook)."` em `PORQUE_NAO_DECLARA` (server/routes/cobranca.routes.ts). `metadata`: `{ confissaoId, status, valor, contatoAlterado?, prescricaoRenunciada?, ambiente }`. **[rev]**

## 6. Fluxos

### 6.1 Configurar (superadmin) **[rev]**

Em `server/routes/admin.routes.ts`, ao lado do ERP, e na aba de integrações de `client/src/pages/admin/admin-provedor.tsx`:

- `GET /api/admin/providers/:id/assinatura/zapsign` — **diferente do ERP** (cujo GET devolve a credencial decifrada), devolve `apiTokenGravado`, `apiTokenIlegivel` (decifrar falhou — SESSION_SECRET mudou; redigite) e os 4 últimos caracteres; nunca o token nem o `webhook_secret`.
- `PUT …/assinatura/zapsign` (limiter `limiteConfigErp`) só grava: `api_token` ausente ou vazio = "não mexe" (regra de `preservarSegredosVazios`); com `apiTokenIlegivel`, salvar sem token novo é 400. Trocar token ou ambiente regenera `webhook_secret`, zera `is_enabled` e exige Ativar de novo. `GET/PUT` entram em `ROTAS_SEM_CORPO_NO_LOG`.
- `POST …/assinatura/zapsign/ativar` (limiter `limiteTesteErp`) testa o token no host do ambiente (`GET /docs/?page=1`, resposta não logada) e grava `is_enabled = true` e `ativada_em`; falha → 422 com a mensagem do ZapSign e `is_enabled` continua false. A tela tem "Salvar" e "Ativar" separados, como "Salvar" e "Testar" do ERP.
- A tela mostra a base legal e o custo de cada `auth_mode`, e o aviso "sandbox: sem validade jurídica; nada é enviado ao cliente".

Do provedor (admin): `PUT /api/cobranca/confissoes/modelo/revisado` marca o texto padrão como revisado (afeta emissões futuras). Do operador: `GET /api/cobranca/confissoes/estado` (configurada? ambiente? revisada? `provedor_assina`? custo do `auth_mode`) — o 360 e o Painel do Provedor (só leitura, no molde de `GET provider/erp-integrations`) usam isso.

### 6.2 Emitir (360 → diálogo → ZapSign)

1. `GET /api/cobranca/clientes/:id/confissoes/base` — o servidor monta a base sem digitação: **[rev]**
   - **Acordo**: negociação em `aceita` ou `ativa` → só as linhas de `cobranca_parcelas` em `pendente`, `atrasada` ou `conciliacao_pendente` (nunca `paga`/`cancelada`), a entrada (`numero = 0`) como "entrada" se ainda não recebida; `valor_total` = Σ dessas; guarda `valor_original` e `desconto_pct` para a cláusula condicional; o texto diz "saldo remanescente do acordo, já abatidos R$ Y recebidos". O servidor reconfere **ao vivo** que o saldo no ERP não é menor que o do acordo; se for, bloqueia.
   - **Saldo integral**: o servidor lê o ERP **ao vivo** (`snapshotAoVivoDoCliente`, sem cache) e só monta a base com `ok && encontrado && !leituraParcial`; Anexo I = faturas vencidas do snapshot (`erpRef`, `descricao`, vencimento, valor, classe por `parcelasDaDescricao` de `shared/cobranca/multa.ts`); `valor_total` = Σ do Anexo I, mais multa e juros pela `politica.encargos` até `erp_lido_em` se a decisão 2.2-1 for (a). Se Σ faturas ≠ `dividaAtual` do snapshot, bloqueia e mostra os dois números. Sem leitura ao vivo (ERP fora, parcial, conector sem faturas — Hubsoft, Voalle, RBX), **não se emite**: nunca cai para a base sincronizada. `customers.total_overdue_amount` serve só para o 360 decidir se há o que formalizar.
   - O admin pode **desmarcar** faturas de saída (multa/equipamento) do Anexo I — selecionar não é digitar valor; `valor_total` recalcula. Fatura `indeterminada` acende "mistura mensalidade e multa sem valores — confira no ERP".
   - Vencimento do saldo integral: escolhido pelo operador entre `data_limite_assinatura + 1 dia` e 90 dias.
   - Signatário cliente: nome e CPF/CNPJ do cadastro (travados); e-mail e telefone do cadastro, editáveis. **Devedor PJ**: pede nome e CPF do representante legal; o DEVEDOR sai "razão social, CNPJ, representada por {nome}, CPF {cpf}".
   - A prévia (texto padrão renderizado ou "modelo do ZapSign {template_id}: variáveis …"), o custo desta emissão ("1 documento + N créditos + R$ 0,50 da conta ZapSign do provedor"), os bloqueios (§8) e `baseHash`.
2. `POST /api/cobranca/clientes/:id/confissoes` com `{ origem, vencimento?, faturasExcluidas?, clienteEmail?, clienteTelefone?, representante?, baseHash, chaveIdempotencia, confirmoTeste?, confirmoPrescricao? }`. Permissão: `exigirAdminDoProvedor("emitir a confissão de dívida")` → operador comum recebe 403 `{ message: "Apenas administradores podem emitir a confissão de dívida", code: "APROVACAO_OBRIGATORIA" }`; a tela reaproveita o cadeado do 360. **[rev]**
3. O servidor, sob trava `confissao:{providerId}:{customerId}` (molde de `comTravaDoChat`; ocupada → 409 "emissão em andamento"): recalcula a base e compara com `baseHash` (diferente → 409 "A dívida mudou. Recarregue."); mesma `chaveIdempotencia` → devolve a confissão já criada; o índice único de uma confissão viva por cliente → 409 com a existente. Grava o `rascunho` com a foto completa (base canônica, hash, Anexo I, PDF original em 5.3) e **fora da transação** chama o ZapSign: **[rev]**
   - modelo padrão: `POST /docs/` com `base64_pdf`, `name = "Confissão de dívida — {cliente} — {provedor}"`, `external_id = confissao:{id}`, `folder_path = "consulta-isp/{providerId}"`, `brand_name`, `date_limit_to_sign`, `reminder_every_n_days: 3`, `allow_refuse_signature: true`, `signers = [cliente]` (+ provedor com `order_group` quando `provedor_assina`, `signature_order_active: true`, provedor primeiro com `assinaturaTela-tokenEmail`, sem custo);
   - modelo do ZapSign: `POST /models/create-doc/` com o cliente e `data` das variáveis; depois `add-signer` do provedor quando `provedor_assina`;
   - o cliente vai com `cpf` do cadastro, `require_cpf` e `validate_cpf: true` sempre que o contato usado difere do ERP (e o evento leva `metadata.contatoAlterado = true`); `send_automatic_whatsapp`/`send_automatic_email` **só em produção**;
   - registra o webhook **daquele documento** (`POST /user/company/webhook/` com `doc_token`, `type: ""`) e o cabeçalho `X-Consulta-ISP-Assinatura: {webhook_secret}` pelo `id` devolvido;
   - sucesso: status `enviada`, tokens e `sign_url` gravados, evento `confissao` (enviada) e follow-up do caso (`proximaAcao` "aguardar assinatura", `proximoContatoEm` +3 dias) pelos `registrarEventoDeCobranca`/`atualizarCasoDeCobranca` do storage;
   - falha em qualquer chamada: status permanece `rascunho` com `erro_ultimo`; nada é dito como enviado; documento criado sem webhook registrado é apagado (`DELETE`) para não ficar órfão; a tela mostra o erro e "tentar de novo".
4. Resposta: a confissão com o `sign_url` do cliente. A tela oferece "copiar link" e, quando o Chat BullQ estiver ligado para o provedor e o ambiente for produção, "enviar pelo chat" (mensagem com o link, registrada como contato).

### 6.3 Assinatura e retorno **[rev]**

`POST /api/webhooks/zapsign/:providerId` (público):

1. `createRateLimiter` por IP (120/min) e por `providerId` (60/min).
2. Cabeçalho `X-Consulta-ISP-Assinatura` comparado em tempo constante ao `webhook_secret` do provedor — e contra um segredo fictício quando não há integração, para não vazar por tempo; resposta **uniforme 401** para provedor inexistente, integração desligada ou cabeçalho inválido.
3. `event_type` e `token` do documento. Token que não é de uma confissão deste provedor → **200** `{ ok: true, ignorado: true }`, sem gravar o corpo; o log registra só `providerId`, `event_type` e token.
4. Eventos informativos (`doc_created`, `created_signer`, `signature_notification_sent`, `doc_read_confirmation`, `doc_expiration_alert`, `email_bounce`, `doc_viewed`) → 200 sem reconsulta (só `doc_viewed` atualiza `zapsign_signers[].status` pelo que a próxima reconsulta disser).
5. Confissão fora de `enviada` → 200 sem chamar o ZapSign. Em `enviada`, no máximo **uma reconsulta por confissão a cada 30 s** (eventos dentro da janela respondem 200 e a reconciliação cobre).
6. Reconsulta `GET /docs/{token}/` no host do **`ambiente` da linha** com o token do provedor. Do payload e da reconsulta gravamos **apenas** `token`, `status`, `signed_at`, `auth_mode` por signatário e `sandbox`; `liveness_photo_url`, `geo_*`, `ip`, `answers` são descartados na borda (Zod `.strip()`) e nunca vão ao log.
   - `status: "signed"` e `sandbox` compatível com `ambiente` → baixa `signed_file` (≤ 8 MB) para 5.3, e faz a transição **atômica** `UPDATE … SET status = 'assinada', assinada_em = … WHERE id = $1 AND status = 'enviada' RETURNING id`; só quem recebe a linha de volta grava o evento `confissao` (assinada) e o follow-up "título assinado — acompanhar parcelas". Se o caso fechou no meio, grava a confissão e o log, sem evento.
   - `sandbox: true` numa linha `producao` (ou o inverso) → não aplica; `erro_ultimo = "ambiente divergente"`.
   - `deleted: true` → `cancelada`.
   - `doc_refused` / `doc_expired`: **não confirmáveis** pelo detalhe. O webhook (já autenticado) grava `recusa_informada_em` / `expiracao_informada_em` e `erro_ultimo` com o `event_type`, mantém `enviada`, registra evento `confissao` (recusa informada) com follow-up "cliente recusou — ligar", e a tela diz "o ZapSign informou recusa — confirme na conta"; o admin conclui pelo cancelar (6.4), que prova `deleted`.
7. Reconsulta que falha → 502, `erro_ultimo` e `reconciliar_em = agora + 10 min`. Não se conta com retentativa do ZapSign.

Reconciliação (worker): primeiro as confissões com `reconciliar_em` vencido; depois as `enviada` há mais de 1 h, a cada 6 h; aplica a mesma função do webhook (com a mesma transição atômica, então webhook e worker não duplicam evento). Passada `data_limite_assinatura` sem `signed`, marca `expirada` sozinha. Quando `provedor_assina` e o cliente já assinou, avisa "falta a assinatura do provedor" (evento + follow-up para o admin).

### 6.4 Cancelar **[rev]**

`POST /api/cobranca/confissoes/:id/cancelar` (admin): só em `rascunho` ou `enviada`. Em `enviada`, **reconsulta primeiro**: `signed` → aplica a transição de assinada e responde 409 "o cliente já assinou — não se cancela"; `deleted` → grava `cancelada` sem chamar DELETE; `pending` → `DELETE /docs/{token}/` e, em sucesso, `cancelada` com `encerrada_em` e evento. Reconsulta falhando → nada muda, 502. `assinada` não se cancela: mudou o valor, emite-se outra (a anterior vira `substituida` quando a nova é assinada) e fica no histórico.

### 6.5 Reenviar **[rev]**

`POST /api/cobranca/confissoes/:id/reenviar` (admin): só em `enviada`, no máximo 1 vez a cada 30 min, pelo reenvio de notificação por signatário do ZapSign (a doc de signatários; o endpoint em massa é confirmado no plano antes do botão existir). Em sandbox, o botão não existe.

### 6.6 Acordo × confissão **[rev]**

- Cancelar ou quebrar uma negociação com confissão `enviada` cancela a confissão **na mesma transação** (DELETE no ZapSign antes; se falhar, a negociação não muda e a tela diz).
- Confissão `assinada` não bloqueia a quebra do acordo: o caso passa a mostrar "título executivo assinado em DD/MM — R$ Z" como próximo passo.
- `quitada`: acordo `cumprida`, ou, no saldo integral, Anexo I inteiro `paid`/`baixada_no_erp` na varredura ou pago ao vivo. `substituida`: uma confissão nova assinada pela mesma dívida. "Assinada viva" = `assinada` que não é `quitada` nem `substituida` — é ela que acende o selo.
- Prescrição: com confissão assinada viva, o card "Prescrição" do 360 conta a partir de `assinada_em` e diz "interrompida pela confissão de DD/MM (CC art. 202, VI)".

### 6.7 Consultar

- `GET /api/cobranca/clientes/:id/confissoes`: lista com status, ambiente, valores, datas, estado **por signatário** ("cliente: abriu o link · provedor: assinou"), quem emitiu; **nunca** os PDFs.
- `GET /api/cobranca/confissoes/:id/pdf?tipo=original|assinado`: `requireAuth + requireProvider` (operador do provedor; superadmin só em personificação com suporte), `Content-Disposition: attachment`, grava `baixado_em` e registra no log de acesso quem baixou.
- 360: bloco "Confissão de dívida" no lugar do botão desligado — estado atual por signatário, "Emitir" / "Emitir outra" / "Cancelar" / "Reenviar", "baixar PDF", e o selo "título executivo assinado" ao lado do nome quando há assinada viva; em sandbox o selo é "TESTE — sem validade jurídica" e não há follow-up "título assinado". Do bloco atual saem o `ACriar` e o interruptor local (`setConfissao`), e o Let passa a chamar "Confissão de dívida" (lista `LETS` de `cliente360.test.ts` atualizada).
- Kanban e lista da carteira: o mesmo selo, pequeno, no card.

## 7. O texto do modelo padrão (versão 1.0) **[rev]**

`shared/cobranca/confissao-modelo.ts` exporta a versão, as variáveis, `baseCanonica(entrada)`, `hashDaBase(base)` e `renderizarConfissao(base, geradoEm)` (determinístico). Estrutura:

1. Título: "Instrumento particular de confissão de dívida".
2. Partes: CREDOR (provedor: razão social, CNPJ, endereço e, se `provedor_assina`, o representante) e DEVEDOR (cliente: nome, CPF; ou razão social, CNPJ, "representada por {nome}, CPF {cpf}"; endereço; e-mail e telefone informados).
3. Cláusula 1 — Origem: "a relação de prestação de serviços de internet mantida com o credor (cadastro nº {cadastro_erp} no sistema de gestão do credor, plano {plano}, iniciada em {inicio_contrato}), conforme as faturas relacionadas no Anexo I — mensalidades e, quando ali indicado, multa rescisória e valor de equipamento em comodato não devolvido —, lidas do sistema de gestão do credor em {erp_lido_em}". Trecho cuja variável falte **sai da frase**; nunca "—" nem "0". Não existe número de contrato no sistema: `{{CONTRATO}}` não é variável.
4. Cláusula 2 — Confissão: "o devedor reconhece e confessa dever a quantia certa e determinada de R$ {valor_total} ({por_extenso})". No acordo com desconto: "reconhece dever R$ {valor_original}; o credor concede desconto de R$ {desconto} ({pct}%), condicionado ao pagamento integral e pontual das parcelas abaixo; o inadimplemento de qualquer parcela restabelece o valor original, abatidos os pagamentos efetuados".
5. Cláusula 3 — Pagamento: "em {n} parcela(s), a saber: {lista nº — rótulo — valor — vencimento}", pelo meio de `acordo[carteira].origemDaCobranca` (com `nao_definida`, "boleto ou PIX enviado pelo credor").
6. Cláusula 4 — Mora (**em destaque**): "atraso de qualquer parcela implica vencimento antecipado do saldo, multa de {multaPct}% e juros de {jurosMesPct}% ao mês, com correção pelo IPCA (CC, art. 389, parágrafo único)", percentuais de `cobranca_politica.encargos` (já limitados por `TETOS_LEGAIS`; sem política, 2% e 1%).
7. Cláusula 5 — Título executivo e assinatura eletrônica (**em destaque**): "As partes declaram que este instrumento é constituído por meio eletrônico e assinado por assinatura eletrônica que ambas admitem como válida (MP 2.200-2/2001, art. 10, §2º), com integridade conferida pelo provedor de assinatura ZapSign (relatório de assinatura anexo), constituindo título executivo extrajudicial nos termos do art. 784, III e §4º, do Código de Processo Civil, dispensada a assinatura de testemunhas." Testemunhas: dispensadas pelo §4º (Lei 14.620/2023); o `signed_file` do ZapSign inclui o relatório de assinatura (hash, IP, autenticação) — por isso ele é guardado sempre. (A Lei 14.063/2020 não rege a relação entre particulares e **não** é citada.)
8. Cláusula 6 — Foro (**em destaque**): "Fica eleito o foro da comarca do domicílio do DEVEDOR, sem prejuízo do disposto no art. 781 do Código de Processo Civil" (CDC arts. 51 e 101, I; CPC art. 63, §§1º e 5º).
9. Anexo I: referência no ERP, descrição, vencimento, valor e classe de cada fatura; fatura sem referência não entra.
10. Rodapé: "Consulta ISP · modelo padrão v1.0 · gerado em {gerado_em} · hash {8 primeiros de `texto_hash`}" e, conforme o caso, "MODELO PADRÃO SEM PARECER JURÍDICO — o provedor é responsável por revisar este texto" e "AMBIENTE DE TESTES — SEM VALIDADE JURÍDICA".

PDF: corpo 12 pt no mínimo; cláusulas 4, 5 e 6 em negrito (CDC art. 54, §§3º e 4º).

Variáveis do modelo do ZapSign (mesmos nomes na tela do superadmin): `{{CREDOR_RAZAO_SOCIAL}}`, `{{CREDOR_CNPJ}}`, `{{CREDOR_ENDERECO}}`, `{{DEVEDOR_NOME}}`, `{{DEVEDOR_CPF_CNPJ}}`, `{{DEVEDOR_REPRESENTANTE}}`, `{{DEVEDOR_ENDERECO}}`, `{{VALOR_TOTAL}}`, `{{VALOR_POR_EXTENSO}}`, `{{VALOR_ORIGINAL}}`, `{{DESCONTO}}`, `{{PARCELAS}}`, `{{CADASTRO_ERP}}`, `{{PLANO}}`, `{{INICIO_CONTRATO}}`, `{{ANEXO_FATURAS}}`, `{{ERP_LIDO_EM}}`, `{{MULTA_PCT}}`, `{{JUROS_PCT}}`, `{{DATA}}`.

## 8. Regras, erros, limites

- Sem integração ativa: o botão fica como hoje, com "assinatura eletrônica não configurada — o superadmin cadastra o ZapSign do provedor".
- Sem caso vivo: "abra o caso antes". Sem acordo e sem fatura vencida na leitura ao vivo: "nada a formalizar". Sem leitura ao vivo: "o ERP não respondeu — sem leitura ao vivo não se emite título".
- Cliente sem CPF/CNPJ: bloqueia. Sem e-mail **e** sem telefone: bloqueia até o operador informar um. PJ sem representante: bloqueia.
- **Prescrição**: dívida prescrita pela régua (`prescricaoPorAtraso`, a mesma regra de abrir caso) bloqueia com "dívida prescrita — confessá-la renuncia à prescrição (CC art. 191); decisão do provedor com parecer jurídico"; se um dia for liberado, é opção explícita do admin (`confirmoPrescricao`) gravada no evento. **[rev]**
- Uma confissão viva (`rascunho`/`enviada`) por cliente; emitir outra exige cancelar a existente.
- ZapSign indisponível ou token inválido: 502/422 com a mensagem; `rascunho` com `erro_ultimo`; nada registrado como enviado.
- Documento assinado é imutável no sistema: PDF, hash, valores.
- **Sandbox**: `send_automatic_*` desligados, só "copiar link"; faixa "AMBIENTE DE TESTES — sem validade jurídica" no 360; "enviar pelo chat" desabilitado; o diálogo exige `confirmoTeste`; o selo é "TESTE". **[rev]**
- **Custos** são do provedor (§3); o diálogo mostra o custo desta emissão; o Painel do Provedor mostra o `auth_mode` e seu custo. **[rev]**
- **LGPD** **[rev]**: papéis — provedor = controlador; Consulta ISP = operador; ZapSign = operador contratado pelo provedor (conta e contrato dele). Base legal: art. 7, V (execução de contrato), VI (exercício regular de direitos) e X (proteção do crédito); selfie/biometria: art. 11, II, d — desligada por padrão. Só o necessário vai ao ZapSign (nome, documento, e-mail, telefone, endereço, faturas); do que volta, só o listado em 6.3. O PDF assinado fica no nosso banco por tenant (5.3).
- **Retenção** **[rev]**: `assinada` em produção conserva-se até 5 anos após o último vencimento das parcelas (CC art. 206, §5º, I) ou após `quitada`; pedido de exclusão do titular **não** anonimiza uma assinada dentro desse prazo (LGPD art. 16, I) — a resposta ao titular lista a confissão e a base legal. `rascunho`, `cancelada`, `expirada` e qualquer linha de sandbox: o worker de retenção (`lgpd-retention.ts`) apaga os PDFs e zera `cliente_*`, `parcelas`, `erp_faturas` e `zapsign_signers` após 90 dias, mantendo status, hashes e datas. Pedido de acesso/portabilidade (`lgpd-titular.service.ts`) passa a incluir as confissões do CPF (status, valor, datas, ambiente).

## 9. Testes

- `confissao-modelo.test.ts`: render determinístico dado `gerado_em`; base canônica e hash estáveis (mesma base = mesmo hash, hora diferente = mesmo hash); variáveis ausentes somem da frase; cláusula condicional do desconto; PJ com representante; avisos de não revisado e de sandbox; por extenso (centavos, milhares, "um real", "mil reais").
- `pdf.test.ts`: PDF válido, < 1 MB, corpo 12 pt, cláusulas 4-6 em destaque, texto presente.
- `zapsign.test.ts` (conector, `fetch` simulado): hosts por ambiente, header Bearer, criar por base64 e por modelo + add-signer, `date_limit_to_sign`/`reminder`/`allow_refuse`, detalhar, excluir, webhook por documento + cabeçalho com o `id`, teste de token, mapeamento de erro (401, 402 sem créditos, 5xx) sem vazar corpo.
- `assinatura.storage.test.ts`: tenant em toda consulta; token cifrado no insert; `getParaAdmin` sem `api_token`/`webhook_secret`; PDF só por `obterPdf`; transições permitidas; índice único de confissão viva; transição atômica `WHERE status = 'enviada'`.
- `confissao.routes.test.ts`: base por acordo (parcelas pagas fora, entrada como "entrada", reconferência ao vivo) e por saldo integral (leitura ao vivo obrigatória, Σ ≠ dívida bloqueia, faturas de saída desmarcáveis); permissão (operador 403 `APROVACAO_OBRIGATORIA`, admin 200, superadmin personificando 200); prescrição; PJ; contato alterado → `validate_cpf` e metadata; `baseHash` divergente 409; idempotência; emissão feliz; falha do ZapSign mantém rascunho e apaga documento órfão; cancelar (reconsulta antes: signed → 409, deleted → cancelada, pending → DELETE); reenviar com janela; PDF com registro de download; estado; sandbox sem envio automático.
- `webhooks-zapsign.routes.test.ts`: limiter; 401 uniforme e em tempo constante; token desconhecido → 200 ignorado; eventos informativos → 200; fora de `enviada` → 200 sem reconsulta; janela de 30 s; `signed` só depois da reconsulta e com ambiente compatível; recusa/expiração informadas; reprocessamento idempotente (uma só transição, um só evento); 502 grava `reconciliar_em`.
- `confissao-reconciliacao.test.ts`: `reconciliar_em` primeiro; enviadas > 1 h a cada 6 h; expira pela data limite; "falta a assinatura do provedor".
- `migracao-0037-assinatura.test.ts`: lê o SQL — sem BEGIN/COMMIT, tudo `IF NOT EXISTS`, nomes batem com `shared/schema.ts` (molde de `faturas.migracao.test.ts`).
- `estados.test.ts` (lista pinada) e `cliente360.test.ts` (`LETS`) atualizados; testes de fonte para o bloco do 360, o selo no card e os textos; `lgpd-retention`/`lgpd-titular` cobrindo as confissões.

## 10. Fora do escopo desta entrega

- Cobrança das parcelas confessadas (boleto/PIX): segue a origem da política de acordo; a confissão só as descreve.
- Protesto, negativação e execução judicial.
- Certificado digital (ICP-Brasil) como padrão — fica como opção do `auth_mode`.
- Portal do ex-cliente assinando sozinho, sem o operador emitir.
- Modelos por carteira: um texto padrão só, com as variáveis.

## 11. Entrega em fases (para o plano)

1. **Fundação**: migração 0037 + schema, storage, modelo padrão + por extenso + PDF, conector ZapSign, config do superadmin (Salvar/Ativar) e a tela de integração.
2. **Emissão e retorno**: base ao vivo, emitir, cancelar, reenviar, listar, PDF; webhook por documento + reconciliação no worker; evento, follow-up e as regras acordo × confissão.
3. **Telas**: bloco no 360 (estado por signatário, sandbox), selo no kanban e na lista, Painel do Provedor em só leitura, "enviar pelo chat".
4. **LGPD e produção**: retenção e titular, sandbox da NsLink (conta de testes), documentação (`docs/`, CLAUDE.md com `ASSINATURA_WEBHOOK_URL`), memória.
