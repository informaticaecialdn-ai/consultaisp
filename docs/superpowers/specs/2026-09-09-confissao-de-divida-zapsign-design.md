# Confissão de dívida (CPC 784) com assinatura eletrônica via ZapSign — desenho

Data: 09/09/2026 · Autor: Claude (arquiteto) · Aprovação do dono: desenho aprovado em chat ("sim"); esta spec é a versão escrita para revisão antes do plano.

## 1. Objetivo

Dentro do módulo de cobrança, formalizar a dívida de um cliente num **instrumento particular de confissão de dívida** assinado eletronicamente por ele e pelo provedor, com o valor e as parcelas que o sistema já conhece. O documento assinado é título executivo extrajudicial (CPC, art. 784, III) e fica guardado no Consulta ISP, ligado ao cliente e ao caso.

Hoje o 360 tem só o botão desligado ("GATED: sem assinatura eletrônica nem parecer jurídico do modelo") e um interruptor "Confissão CPC 784" que não grava nada.

## 2. Decisões do dono (09/09/2026)

| Pergunta | Decisão |
|---|---|
| De quem é a conta do ZapSign | **Uma por provedor.** O provedor cria e paga a conta dele; o superadmin grava o token no painel, como faz com o ERP. O documento sai em nome do provedor. |
| De onde vem o texto | **Os dois.** Texto padrão nosso, gerado em PDF, com o aviso "modelo padrão, sem parecer jurídico" até um admin marcar como revisado; e o modelo do próprio ZapSign quando o provedor cadastrar o id dele. |
| O que a confissão formaliza | **Os dois.** Com acordo aceito, espelha as parcelas do acordo; sem acordo, o saldo integral do ERP com a data que o operador definir. O operador nunca digita valor. |

Regras da casa que valem aqui: nada inventado (todo número vem do acordo ou do ERP); multi-tenant absoluto; ação sensível exige admin; o dono decide dinheiro, dado irreversível e escopo.

## 3. O que o ZapSign oferece (conferido na documentação em 09/09/2026)

- Produção `https://api.zapsign.com.br/api/v1/` (há também `https://br.api.zapsign.com.br/api/v1`); sandbox `https://sandbox.api.zapsign.com.br/api/v1/`, réplica da produção **sem validade jurídica**. Conta de sandbox em `sandbox.app.zapsign.com.br`.
- Autenticação: token estático em `Authorization: Bearer {api_token}`, gerado em Configurações > Integrações > API ZAPSIGN da conta do provedor.
- Criar documento: `POST /docs/` com `name`, `base64_pdf` (ou `url_pdf`/`url_docx`), `signers[]`, `lang: "pt-br"`, `external_id`, `folder_path`, `brand_name`. Resposta: `token` do documento, `status: "pending"`, `signers[].token` e `signers[].sign_url`, `original_file`, `signed_file` (null até assinar).
- Criar por modelo: `POST /models/create-doc/` com `template_id`, `signer_name/email/phone_*`, `data: [{ de: "{{VARIAVEL}}", para: "valor" }]`, `external_id`. O modelo é um .docx com variáveis `{{...}}`. O segundo signatário entra por `POST /docs/{token}/add-signer/`.
- Signatário: `auth_mode` em `assinaturaTela`, `tokenEmail`, `tokenSms`, `tokenWhatsapp`, `certificadoDigital` e combinações `assinaturaTela-token*`; `send_automatic_email`, `send_automatic_whatsapp` (R$ 0,50 por envio), `cpf`, `require_cpf`, `validate_cpf`, `require_selfie_photo`, `qualification`, `external_id`, `lock_name/email/phone`, `custom_message`, `redirect_link`. `tokenWhatsapp` e `certificadoDigital` consomem créditos da conta do provedor.
- Detalhar: `GET /docs/{token}/` → `status` (`pending` | `signed`), `signers[].status` (`new` | `link-opened` | `signed`), `signed_at`, `signed_file`, `deleted`. **Os links de arquivo expiram em 60 minutos**: o assinado tem de ser baixado e guardado por nós.
- Excluir: `DELETE /docs/{token}/` (soft delete, sem volta).
- Webhooks: `POST /user/company/webhook/` com `url`, `type` (`doc_signed`, `doc_refused`, `doc_deleted`, `doc_expired`, `doc_viewed`, `signer_authentication_failed`, … ou `""` para todos) e `doc_token` opcional; cabeçalhos personalizados por `POST /user/company/webhook/header/`. Todo envio traz `event_type`. **Não há assinatura HMAC**: a origem se prova reconsultando o documento pelo token na conta do provedor.

## 4. Arquitetura

```
Painel do Provedor (superadmin) ──grava──▶ assinatura_integracoes (token cifrado, ambiente, modelo, signatário do provedor, webhook secret)
                                                    │
Cliente 360 ──"Confissão de dívida"──▶ POST /api/cobranca/clientes/:id/confissoes
                                                    │  monta a base (acordo ou saldo) → texto/PDF ou dados do modelo
                                                    ▼
                                    ZapSignConnector (server/assinatura/zapsign.ts)
                                       criar doc (base64_pdf | models/create-doc + add-signer) · detalhar · excluir · registrar webhook
                                                    │
                                    cobranca_confissoes (status, tokens, parcelas, hash do texto, PDF assinado em base64)
                                                    ▲
POST /api/webhooks/zapsign/:providerId ──cabeçalho secreto──▶ reconsulta GET /docs/{token}/ ──▶ atualiza status + evento no caso
Worker: reconciliação a cada 6 h dos documentos "enviada" há mais de 1 h sem retorno
```

Componentes, cada um com uma responsabilidade:

| Componente | Onde | Faz | Depende de |
|---|---|---|---|
| Modelo padrão | `shared/cobranca/confissao-modelo.ts` | Texto versionado com variáveis; renderiza o texto final a partir da base; calcula o hash | nada (puro) |
| Gerador de PDF | `server/assinatura/pdf.ts` | Texto final → PDF (biblioteca `pdfkit`, dependência nova de produção; hoje o projeto não tem gerador de PDF), com rodapé de versão e o aviso "modelo padrão — sem parecer jurídico" quando não revisado | modelo |
| Conector ZapSign | `server/assinatura/zapsign.ts` | Chamadas HTTP (produção/sandbox), mapeamento de erros, sem estado | `fetch` nativo |
| Storage | `server/storage/assinatura.storage.ts` (+ fachada) | `assinatura_integracoes` e `cobranca_confissoes`, sempre por `provider_id` | Drizzle |
| Rotas | `server/routes/confissao.routes.ts` | emitir, listar, detalhar, cancelar, baixar PDF; webhook; config do superadmin | storage, conector, PDF, `podeAdministrarOProvedor` |
| Reconciliação | `server/services/confissao-reconciliacao.service.ts` (worker) | reconsulta documentos enviados sem retorno | storage, conector |
| Tela | `client/src/components/cobranca/ConfissaoDeDivida.tsx` + uso no 360 e no kanban | diálogo de emissão, status, PDF, selo | TanStack Query |

## 5. Dados

### 5.1 `assinatura_integracoes` (migração 0037)

| Coluna | Tipo | Nota |
|---|---|---|
| id | serial PK | |
| provider_id | integer FK providers, único por (provider_id, fornecedor) | tenant |
| fornecedor | text | só `zapsign` por ora |
| api_token | text | **cifrado** com `encryptField` (server/utils/crypto.ts), como o token do ERP |
| ambiente | text | `sandbox` (padrão) ou `producao` |
| template_id | text, null | id do modelo no ZapSign; null = usa o modelo padrão |
| signatario_nome, signatario_cpf, signatario_email, signatario_telefone | text | o representante do provedor que assina |
| auth_mode_cliente | text | padrão `assinaturaTela-tokenWhatsapp`; opções da doc |
| exigir_selfie | boolean, padrão false | `require_selfie_photo` |
| modelo_revisado_em, modelo_revisado_por_user_id | timestamp/int, null | o admin marcou o texto padrão como revisado juridicamente |
| webhook_secret | text | segredo aleatório por provedor, enviado ao ZapSign como cabeçalho personalizado |
| webhook_registrado_em | timestamp, null | quando registramos o webhook na conta |
| is_enabled | boolean, padrão false | |
| created_at, updated_at | timestamp | |

### 5.2 `cobranca_confissoes` (migração 0037)

| Coluna | Tipo | Nota |
|---|---|---|
| id | serial PK | |
| provider_id | integer FK providers | tenant |
| customer_id | integer FK customers | |
| caso_id | integer FK cobranca_casos, null | o caso aberto, quando há |
| negociacao_id | integer FK cobranca_negociacoes, null | o acordo aceito, quando a base é ele |
| origem | text | `acordo` ou `saldo_integral` |
| valor_total | numeric(10,2) | Σ das parcelas |
| parcelas | jsonb | `[{ n, valor, vencimento: "AAAA-MM-DD" }]` |
| modelo | text | `padrao` ou `zapsign` |
| modelo_versao | text | versão do texto padrão (ex.: `1.0`) ou o `template_id` |
| modelo_revisado | boolean | foto do estado no momento da emissão |
| texto_hash | text | SHA-256 do texto final renderizado (ou dos `data` enviados ao modelo) |
| status | text | `rascunho` → `enviada` → `assinada` \| `recusada` \| `cancelada` \| `expirada` |
| zapsign_doc_token | text, null | |
| zapsign_signers | jsonb | `[{ papel: "cliente" \| "provedor", token, sign_url, status, signed_at }]` |
| cliente_nome, cliente_cpf_cnpj, cliente_email, cliente_telefone | text | como foram ao ZapSign (foto) |
| enviada_em, assinada_em, encerrada_em | timestamp, null | |
| pdf_assinado | text, null | base64 do PDF assinado, baixado do ZapSign (o link deles expira em 60 min) — mesmo padrão dos documentos KYC |
| pdf_assinado_sha256 | text, null | |
| criada_por_user_id, aprovada_por_user_id | integer | quem pediu; quem aprovou (admin) |
| erro_ultimo | text, null | última falha (envio ou reconciliação), para a tela |
| created_at, updated_at | timestamp | |

Índices: `(provider_id, customer_id)`, `(provider_id, status)`, único parcial em `zapsign_doc_token`.

`shared/schema.ts` ganha as duas tabelas (o dono aprovou o desenho com elas). Migração idempotente, sem BEGIN/COMMIT.

Evento novo em `TIPOS_DE_EVENTO` (shared/cobranca/estados.ts): `confissao` — com `metadata.status` (`enviada`, `assinada`, `recusada`, `cancelada`, `expirada`) e `metadata.confissaoId`. Rótulo "Confissão de dívida".

## 6. Fluxos

### 6.1 Configurar (superadmin)

`GET/PUT /api/admin/providers/:id/assinatura/zapsign` (requireSuperAdmin, mesmo rate limit da config de ERP, em `server/routes/admin.routes.ts`). A tela é uma seção nova na aba de integrações do provedor em `client/src/pages/admin/admin-provedor.tsx`, ao lado do ERP, com o mesmo tratamento de campo sensível (o token nunca volta decifrado ao navegador depois de gravado; a tela mostra "gravado" e um campo para trocar). Ao salvar com `is_enabled`: o servidor testa o token (`GET /docs/?page=1` ou equivalente barato), registra o webhook na conta (`POST /user/company/webhook/` com `url = {base}/api/webhooks/zapsign/{providerId}` e `type: ""`, sendo `{base}` a mesma base pública do webhook do Chat BullQ — padrão `https://consultaisp.com.br`, sobrescrevível pela variável `ASSINATURA_WEBHOOK_URL`) e o cabeçalho `X-Consulta-ISP-Assinatura: {webhook_secret}` por `POST /user/company/webhook/header/`. Falha em qualquer passo → 422 com a mensagem do ZapSign; nada fica "ligado" pela metade. Religar não recria o webhook se `webhook_registrado_em` já existe para a mesma URL.

`PUT /api/cobranca/confissoes/modelo/revisado` (admin do provedor): marca `modelo_revisado_em`. Só afeta emissões futuras.

`GET /api/cobranca/confissoes/estado` (operador): diz se a assinatura está configurada e revisada, sem credencial — o 360 usa isso para o botão.

### 6.2 Emitir (360 → diálogo → ZapSign)

1. `GET /api/cobranca/clientes/:id/confissoes/base`: o servidor monta a base sem digitação:
   - há negociação em `aceita` ou `ativa` para o cliente → `origem: "acordo"`, parcelas de `cobranca_parcelas`;
   - senão, saldo integral: `valor_total = customers.total_overdue_amount`, uma parcela, `vencimento` a ser escolhido pelo operador (mínimo: amanhã; máximo: 90 dias);
   - o signatário cliente: nome e CPF/CNPJ do cadastro (travados), e-mail e telefone do cadastro (editáveis, porque o ERP muitas vezes não tem);
   - a prévia: texto padrão renderizado, ou "modelo do ZapSign {template_id}: variáveis X, Y, Z";
   - os bloqueios (ver §8).
2. `POST /api/cobranca/clientes/:id/confissoes` com `{ origem, vencimento?, clienteEmail?, clienteTelefone?, autorizacao }`. Ação sensível: exige `podeAdministrarOProvedor(req.session)`; para operador comum, 403 com "exige aprovação do administrador" — a tela mostra o cadeado que já existe.
3. O servidor, em transação: grava a confissão como `rascunho` com a foto completa (valores, parcelas, texto, hash); depois chama o ZapSign:
   - modelo padrão: `POST /docs/` com `base64_pdf`, `name = "Confissão de dívida — {cliente} — {provedor}"`, `external_id = confissao:{id}`, `folder_path = "consulta-isp/{providerId}"`, `brand_name = provedor.tradeName`, `signers = [cliente, provedor]`;
   - modelo do ZapSign: `POST /models/create-doc/` com o cliente como signatário e `data` das variáveis, depois `POST /docs/{token}/add-signer/` com o provedor;
   - sucesso: status `enviada`, tokens e `sign_url` gravados, evento `confissao` no caso, follow-up do caso preenchido ("aguardar assinatura", +3 dias);
   - falha: status permanece `rascunho` com `erro_ultimo`; nada é dito como enviado; a tela mostra o erro e "tentar de novo".
4. Resposta: a confissão com o `sign_url` do cliente. A tela oferece "copiar link" e, quando o Chat BullQ estiver ligado para o provedor, "enviar pelo chat" (mensagem com o link, registrada como contato).

O cliente signatário recebe o link também pelo próprio ZapSign (`send_automatic_whatsapp` quando há telefone; `send_automatic_email` quando há e-mail), com `custom_message` curta em nome do provedor.

### 6.3 Assinatura e retorno

- `POST /api/webhooks/zapsign/:providerId` (público): confere o cabeçalho `X-Consulta-ISP-Assinatura` contra o `webhook_secret` do provedor (comparação em tempo constante); lê `event_type` e o `token` do documento; acha a confissão por `(provider_id, zapsign_doc_token)`; **reconsulta** `GET /docs/{token}/` com o token do provedor; só então aplica:
  - `status: "signed"` → baixa `signed_file`, guarda `pdf_assinado` + sha256, `assinada_em`, status `assinada`, evento `confissao` (assinada) no caso, follow-up "título assinado — acompanhar parcelas";
  - `doc_refused` → `recusada`; `doc_deleted` → `cancelada`; `doc_expired` → `expirada`; `doc_viewed`/`link-opened` → só atualiza `zapsign_signers[].status`.
  - Idempotente: reprocessar o mesmo evento não duplica evento nem muda `assinada_em`.
  - Responde 200 sempre que a confissão foi localizada e a reconsulta funcionou; 401 sem cabeçalho válido; 404 sem confissão; 502 quando a reconsulta falhar (o ZapSign reenvia).
- Reconciliação (worker, a cada 6 h): para cada confissão `enviada` há mais de 1 h, `GET /docs/{token}/` e aplica a mesma função do webhook. Cobre webhook perdido e o dia em que o ZapSign não avisar.

### 6.4 Cancelar

`POST /api/cobranca/confissoes/:id/cancelar` (admin): só em `rascunho` ou `enviada`. Em `enviada`, chama `DELETE /docs/{token}/` no ZapSign antes de gravar `cancelada`; se o ZapSign falhar, nada muda e a tela diz. `assinada` não se cancela: mudou o valor, emite-se outra, e a anterior fica no histórico.

### 6.5 Consultar

- `GET /api/cobranca/clientes/:id/confissoes`: lista com status, valores, datas, quem emitiu.
- `GET /api/cobranca/confissoes/:id/pdf`: o PDF assinado (ou o original, antes da assinatura), `Content-Disposition: attachment`.
- 360: bloco "Confissão de dívida" no lugar do botão desligado — estado atual (nenhuma / enviada em DD/MM, aguardando o cliente / assinada em DD/MM, baixar PDF), o botão "Emitir" (ou "Emitir outra"), e o selo "título executivo assinado" ao lado do nome quando há assinada viva.
- Kanban e lista da carteira: o mesmo selo, pequeno, no card.

## 7. O texto do modelo padrão (versão 1.0)

`shared/cobranca/confissao-modelo.ts` exporta a versão, as variáveis e `renderizarConfissao(base)`. Estrutura:

1. Título: "Instrumento particular de confissão de dívida".
2. Partes: CREDOR (provedor: razão social, CNPJ, endereço, representante) e DEVEDOR (cliente: nome, CPF/CNPJ, endereço, e-mail e telefone informados).
3. Cláusula 1 — Origem: os serviços de internet prestados sob o contrato nº {contrato}, plano {plano}, com faturas vencidas e não pagas relacionadas no Anexo I (número, vencimento, valor), conforme registros do sistema de gestão do credor.
4. Cláusula 2 — Confissão: o devedor reconhece e confessa dever a quantia certa e determinada de R$ {valor_total} ({valor_por_extenso}).
5. Cláusula 3 — Pagamento: em {n} parcela(s) de R$ {valor}, com vencimentos em {datas}, pelo meio indicado pelo credor (o meio de cobrança vem da política de acordo do provedor; sem ele, "boleto ou PIX enviado pelo credor").
6. Cláusula 4 — Mora: atraso implica vencimento antecipado do saldo, correção pelo IPCA, juros de 1% ao mês e multa de 2% (valores editáveis na política de acordo quando existirem; senão estes).
7. Cláusula 5 — Título executivo: as partes reconhecem que este instrumento, assinado eletronicamente, constitui título executivo extrajudicial nos termos do art. 784, III, do Código de Processo Civil, e que a assinatura eletrônica é válida nos termos da Lei 14.063/2020 e da MP 2.200-2/2001.
8. Cláusula 6 — Foro: comarca do endereço do credor.
9. Anexo I: tabela de faturas (do ERP) que compõem a dívida.
10. Rodapé: "Consulta ISP · modelo padrão v1.0 · gerado em DD/MM/AAAA HH:MM · hash {8 primeiros do SHA-256}" e, quando não revisado, "MODELO PADRÃO SEM PARECER JURÍDICO — o provedor é responsável por revisar este texto".

O modelo do ZapSign do provedor recebe as mesmas variáveis por nome: `{{CREDOR_RAZAO_SOCIAL}}`, `{{CREDOR_CNPJ}}`, `{{DEVEDOR_NOME}}`, `{{DEVEDOR_CPF_CNPJ}}`, `{{VALOR_TOTAL}}`, `{{VALOR_POR_EXTENSO}}`, `{{PARCELAS}}` (texto), `{{VENCIMENTOS}}`, `{{ORIGEM}}`, `{{CONTRATO}}`, `{{PLANO}}`, `{{DATA}}`. A tela do superadmin lista essas variáveis para quem for montar o .docx.

Valor por extenso: função pura própria (`shared/cobranca/por-extenso.ts`), testada, sem dependência.

## 8. Regras, erros e limites

- Sem integração configurada e ligada: o botão fica como hoje, com o motivo "assinatura eletrônica não configurada — o superadmin cadastra o ZapSign do provedor".
- Sem acordo aceito e sem saldo vencido no ERP: "nada a formalizar".
- Cliente sem CPF/CNPJ: bloqueia ("o cadastro no ERP não tem documento"); sem e-mail **e** sem telefone: bloqueia até o operador informar um dos dois.
- Já existe confissão `enviada` ou `assinada` para o mesmo cliente com a mesma base (mesmo `texto_hash`): não duplica; mostra a existente.
- ZapSign indisponível ou token inválido: 502/422 com a mensagem; a confissão fica `rascunho` com `erro_ultimo`; nada é registrado como enviado.
- Documento assinado é imutável no sistema: PDF, hash, valores. Nova confissão só com cancelamento da anterior quando ela ainda não foi assinada.
- Custos são do provedor (créditos e envios por WhatsApp do ZapSign); a tela do superadmin diz isso ao lado do `auth_mode`.
- LGPD: só o necessário vai ao ZapSign (nome, documento, e-mail, telefone, endereço e as faturas); o PDF assinado fica no nosso banco por tenant; o superadmin vê a configuração, nunca o documento de outro tenant fora da personificação com suporte.
- Sandbox por padrão na configuração nova; passar a produção é uma escolha explícita do superadmin, e o rodapé do PDF diz "AMBIENTE DE TESTES — SEM VALIDADE JURÍDICA" quando for sandbox.

## 9. Testes

- `confissao-modelo.test.ts`: render com todas as variáveis, hash estável, por extenso (centavos, milhares, "um real", "mil reais"), aviso quando não revisado, rodapé de sandbox.
- `pdf.test.ts`: gera um PDF válido (cabeçalho `%PDF`), tamanho < 1 MB, texto presente.
- `zapsign.test.ts` (conector, `fetch` simulado): hosts de sandbox/produção, header Bearer, criação por base64 e por modelo + add-signer, detalhar, excluir, registrar webhook e cabeçalho, mapeamento de erro (401, 402 sem créditos, 5xx).
- `assinatura.storage.test.ts`: tenant em toda consulta, token cifrado no insert e decifrado na leitura, transições de status permitidas.
- `confissao.routes.test.ts`: base (acordo × saldo), permissão (operador 403, admin 200, superadmin personificando 200), emissão feliz com ZapSign simulado, falha do ZapSign mantém rascunho, cancelar, PDF, estado; webhook: cabeçalho errado 401, evento reprocessado idempotente, `signed` só depois da reconsulta, `refused/deleted/expired`.
- `confissao-reconciliacao.test.ts`: reconsulta só as enviadas há mais de 1 h; aplica a mesma função do webhook.
- Telas: `.test.ts` de fonte para os estados do bloco no 360, o selo no card, os textos.
- Migração 0037 no teste de migrações idempotentes.

## 10. Fora do escopo desta entrega

- Cobrança das parcelas confessadas (boleto/PIX): segue a origem escolhida na política de acordo; a confissão só as descreve.
- Protesto, negativação e execução judicial.
- Assinatura com certificado digital (ICP-Brasil) como padrão — fica como opção do `auth_mode`.
- Portal do ex-cliente assinando sozinho, sem o operador emitir.
- Modelos por carteira (ativos × ex-clientes): um texto padrão só, com as variáveis.

## 11. Entrega em fases (para o plano)

1. **Fundação**: migração 0037 + schema, storage, modelo padrão + por extenso + PDF, conector ZapSign, rotas de configuração do superadmin e a tela de integração.
2. **Emissão e retorno**: rotas de base/emitir/cancelar/listar/PDF, webhook + reconciliação no worker, evento e follow-up no caso.
3. **Telas**: bloco no 360, selo no kanban e na lista, "enviar pelo chat".
4. **Produção**: sandbox da NsLink (conta de testes), documentação (`docs/`, CLAUDE.md), memória.
