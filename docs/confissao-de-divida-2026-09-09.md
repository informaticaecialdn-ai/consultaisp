# Confissão de dívida com assinatura eletrônica via ZapSign (migração 0037, 09/09/2026)

Dentro do módulo de Cobrança, formaliza a dívida de um cliente num **instrumento
particular de confissão de dívida** assinado eletronicamente pelo devedor, com
o valor e as parcelas que o sistema já conhece — nunca digitados. Desenho
aprovado pelo dono em chat ("sim") em 09/09/2026, depois de uma revisão
adversarial de três revisores (código, produto/jurídico, segurança/LGPD) com
46 achados incorporados. Spec completa:
`docs/superpowers/specs/2026-09-09-confissao-de-divida-zapsign-design.md`.

Antes desta entrega o 360 só tinha um botão desligado ("GATED: sem assinatura
eletrônica nem parecer jurídico do modelo") e um interruptor "Confissão CPC
784" que não gravava nada.

---

## 1. O que é

Um **instrumento particular de confissão de dívida**: o devedor (e, se o
provedor ligar essa opção, o próprio provedor) assina eletronicamente um
documento em que reconhece dever uma quantia certa, parcelada ou não. Assinado,
o documento é **título executivo extrajudicial**.

**Base legal, tal como o texto do modelo a imprime** (`shared/cobranca/confissao-modelo.ts`):

- **Título executivo** — CPC, art. 784, III e §4º. O §4º dispensa a assinatura
  de testemunhas quando o título é formado eletronicamente com assinatura
  eletrônica na forma da lei — dispensa viabilizada pela Lei 14.620/2023, que
  alterou o artigo.
- **Validade da assinatura eletrônica entre as partes** — MP 2.200-2/2001, art.
  10, §2º: documentos particulares com assinatura eletrônica que as partes
  admitem como válida valem entre elas, sem depender de certificação ICP-Brasil
  (Cláusula 5ª do modelo).
- **Mora** — multa e juros de mora, com correção pelo IPCA, citando CC art.
  389, parágrafo único (Cláusula 4ª).
- **Foro** — a Cláusula 6ª elege **o foro da comarca do domicílio do DEVEDOR**,
  citando expressamente o art. 781 do CPC (a execução corre no foro de
  domicílio do executado, entre outras opções do exequente). A escolha do foro
  do devedor — em vez do foro do credor, mais cômodo para o provedor — segue a
  proteção do CDC (art. 51, cláusula abusiva em contrato de adesão; art. 101,
  I, ação contra o fornecedor no domicílio do consumidor) e do CPC (art. 63,
  §§1º e 5º: cláusula de eleição de foro em contrato de adesão é ineficaz de
  ofício quando dificulta o acesso à Justiça).
- **A Lei 14.063/2020 não é citada.** Ela rege assinaturas eletrônicas em
  interações com o Poder Público (níveis ICP-Brasil/AWS para o setor público);
  não rege a relação entre dois particulares — provedor e cliente.

O texto completo (todas as cláusulas) está na seção 6 deste documento e no
código-fonte de `shared/cobranca/confissao-modelo.ts`.

---

## 2. Como funciona

```
Superadmin (Ficha do provedor → aba Integração ERP)
    │ Salvar / Ativar
    ▼
assinatura_integracoes   (token cifrado, ambiente, auth_mode, prazo, provedor_assina…)

Cliente 360 → bloco "Confissão de dívida" → "Emitir confissão"
    │ GET  .../confissoes/base   → acordo aceito OU ERP AO VIVO (snapshotAoVivoDoCliente)
    │                                → prévia + custo + bloqueios + baseHash
    │ POST .../confissoes        → trava por cliente, confere baseHash, grava RASCUNHO
    │                                → PDF do modelo padrão OU variáveis do modelo do ZapSign
    │                                → ZapSign: cria documento + signatário(s) + webhook DAQUELE documento
    ▼
cobranca_confissoes         (status, parcelas, Anexo I, signatários, hash da base…)
cobranca_confissoes_pdf     (bytes original/assinado, fora da linha principal)
    ▲
POST /api/webhooks/zapsign/:providerId   (cabeçalho X-Consulta-ISP-Assinatura)
    │ só confissão "enviada"; no máximo 1 reconsulta a cada 30 s
    ▼
GET /docs/{token}/  no host do AMBIENTE da linha  →  transição atômica (WHERE status = 'enviada')
    → evento "confissao" no caso + follow-up

Worker (server/worker.ts): a cada 10 min reconsulta o que falhou e expira as vencidas;
a cada 6 h a passada também reconsulta TODA "enviada" há mais de 1 h; quitação e
retenção correm no mesmo processo.
```

### Componentes (caminhos reais neste branch)

| Componente | Caminho | Faz |
|---|---|---|
| Vocabulário puro | `shared/cobranca/confissao.ts` | status, transições, `auth_mode`, custo por emissão, tipos do contrato base↔tela |
| Modelo do texto | `shared/cobranca/confissao-modelo.ts` | `baseCanonica`, `serializarBase`, `renderizarConfissao` e `textoDaConfissao` (determinísticos), variáveis do modelo do ZapSign |
| Por extenso | `shared/cobranca/por-extenso.ts` | valor em reais por extenso |
| Base + hash | `server/services/confissao/confissao-base.service.ts` | monta a base (acordo ou ERP ao vivo), `hashDaBase` (SHA-256 da base canônica **sem** `erpLidoEm` — sobrevive ao GET→POST) |
| Gerador de PDF | `server/assinatura/pdf.ts` | texto renderizado → PDF (`pdfkit`), corpo 12 pt, cláusulas 4-6 em negrito |
| Conector ZapSign | `server/assinatura/zapsign.ts` | chamadas HTTP no host do ambiente pedido; zod com `strip` no que volta |
| Erros | `server/assinatura/erro.ts` | `ErroDeConfissao` — um código estável por falha, mapeado uma vez nas rotas |
| Storage | `server/storage/assinatura.storage.ts` (classe `AssinaturaStorage`) + fachada em `server/storage/index.ts` | as três tabelas, sempre por `provider_id`; token só decifrado em `getIntegracaoComCredencial` |
| Emissão | `server/services/confissao/confissao-emissao.service.ts` | trava por cliente, grava rascunho, fala com o ZapSign, registra webhook |
| Retorno | `server/services/confissao/confissao-retorno.service.ts` | `aplicarRetorno` (reconsulta + transição atômica), `cancelarConfissao`, `reenviarNotificacoes`, `expirarSeVencida` |
| Reconciliação | `server/services/confissao/confissao-reconciliacao.service.ts` | o worker: reconsulta, expira, quita, avisa |
| LGPD | `server/services/lgpd-confissoes.ts` | retenção sem título e relatório do titular, chamados por `lgpd-retention.ts` e `lgpd-titular.service.ts`, já existentes |
| Rotas do provedor | `server/routes/confissao.routes.ts` | base, emitir, listar, cancelar, reenviar, pdf, estado, modelo/revisado |
| Rotas do superadmin | `server/routes/admin-assinatura.routes.ts` | GET/PUT/ativar da conta ZapSign do provedor (router próprio) |
| Webhook | `server/routes/webhooks-zapsign.routes.ts` | recebe, autentica, limita, reconsulta, aplica |
| Tela do superadmin | `client/src/components/assinatura/FormularioZapSign.tsx` | dentro de `admin-provedor.tsx`, aba Integração ERP |
| Tela do provedor (só leitura) | `client/src/components/assinatura/EstadoDaAssinatura.tsx` | dentro de `painel-provedor.tsx`, aba Integração |
| Tela do operador | `client/src/components/cobranca/ConfissaoDeDivida.tsx` | bloco + diálogo de emissão no Cliente 360 |
| Selo | `client/src/components/cobranca/SeloConfissao.tsx` | 360, kanban (via `CardCliente.tsx`) e lista da carteira |

Uma nota sobre o desenho original: a spec (§4) previa a configuração do
superadmin dentro de `admin.routes.ts` e a reconciliação solta em
`server/services/`. O que subiu usa um router próprio
(`admin-assinatura.routes.ts`, com os mesmos limites do ERP) e agrupa os
quatro serviços da confissão em `server/services/confissao/` — mais fácil de
achar do que espalhados. Comportamento, não estrutura, é o que a spec garante.

---

## 3. Configurar um provedor

Quem configura é **sempre o superadmin** — o mesmo modelo do ERP. O provedor só
enxerga o estado (seção "Emitir" e o card `EstadoDaAssinatura`).

1. O provedor cria a própria conta em zapsign.com.br e gera o token em
   **Configurações › Integrações › API ZapSign**.
2. Superadmin abre **Ficha do provedor → aba Integração ERP** — o card
   "Assinatura eletrônica · ZapSign" fica logo abaixo do bloco de ERP na mesma
   aba.
3. Escolhe o **ambiente** (`sandbox` por padrão — comece sempre por ele:
   `https://sandbox.api.zapsign.com.br`, réplica idêntica da produção **sem
   validade jurídica**), cola o **token**, e ajusta o que quiser: modelo do
   ZapSign (`template_id`, opcional — vazio usa o modelo padrão do Consulta
   ISP), prazo para assinar (padrão 15 dias, máximo 90), `auth_mode` do
   cliente (padrão `assinaturaTela-tokenWhatsapp`), exigir selfie (desligado),
   enviar o PDF assinado por WhatsApp (desligado), e se o **provedor também
   assina** (desligado por padrão — quando ligado, exige nome, CPF e e-mail do
   representante).
4. **Salvar** (`PUT /api/admin/providers/:id/assinatura/zapsign`): token vazio
   = "não mexe" no token gravado. Trocar o **token OU o ambiente** regenera o
   `webhook_secret` e zera `is_enabled` — a integração some do ar até o
   próximo Ativar.
5. **Ativar** (`POST .../assinatura/zapsign/ativar`): testa o token chamando
   `GET /docs/?page=1` no host do ambiente escolhido; sucesso grava
   `is_enabled = true` e `ativada_em`; falha devolve 422 com a mensagem do
   ZapSign (ex.: `ZAPSIGN_CREDENCIAL`) e nada muda.
6. O GET **nunca** devolve o token: só se está gravado, se abre neste servidor
   (`apiTokenIlegivel`) e os 4 últimos caracteres. Essas três rotas estão em
   `ROTAS_SEM_CORPO_NO_LOG` (`server/utils/sanitize-log.ts`) — nem o PUT nem o
   GET aparecem no log de acesso.

### Custos (conta do provedor no ZapSign, 1 crédito = R$ 0,10; tabela lida em 09/09/2026)

| `auth_mode` | Prova | Créditos | R$ |
|---|---|---|---|
| `assinaturaTela-tokenWhatsapp` (padrão) | código enviado ao WhatsApp do devedor | 5 | — |
| `assinaturaTela-tokenEmail` | código enviado ao e-mail do devedor | 0 | — |
| `assinaturaTela-tokenSms` | código enviado por SMS ao devedor | 0 | 0,10 |
| `tokenWhatsapp` | idem, sem assinatura na tela | 5 | — |
| `tokenEmail` | idem, sem assinatura na tela | 0 | — |
| `tokenSms` | idem, sem assinatura na tela | 0 | 0,10 |
| `certificadoDigital` | certificado digital do devedor | 5 | — |
| `assinaturaTela-certificadoDigital` | certificado digital do devedor | 5 | — |

Mais: **selfie** (`require_selfie_photo`) soma **15 créditos** por assinatura
— a calculadora do sistema usa o piso da faixa que o ZapSign cobra (15 a 50,
conforme o nível de verificação); **enviar o PDF assinado por WhatsApp**
automaticamente soma **R$ 0,50** por envio; o documento também consome a cota
de documentos do plano ZapSign do provedor. `auth_mode` puro
`assinaturaTela` (sem token nenhum) **não existe** na lista — o Zod recusa: ele
assina sem provar quem assinou. Em **sandbox** nada disso é cobrado: nenhuma
chamada de custo é feita e nada é enviado ao cliente.

---

## 4. Emitir

No Cliente 360, o bloco "Confissão de dívida" mostra o botão **"Emitir
confissão"** (ou "Emitir outra", quando já existe uma assinada). O botão fica
desabilitado sem integração ativa ou com uma confissão viva (`rascunho`/
`enviada`) em curso — só uma por cliente; para emitir outra é preciso cancelar
a existente.

### O que o operador vê

Ao abrir o diálogo, o servidor monta a base — **o operador nunca digita
valor**:

- **Com acordo aceito ou ativo**: só as parcelas de `cobranca_parcelas` ainda
  `pendente`/`atrasada`/`conciliacao_pendente` (nunca as pagas); o servidor
  reconfere ao vivo que o saldo no ERP não é menor que o do acordo.
- **Sem acordo (saldo integral)**: lê o ERP **ao vivo**, sem cache
  (`snapshotAoVivoDoCliente`, forçado); o Anexo I são as faturas vencidas, com
  multa/equipamento de valor conhecido separados em linha própria
  (`shared/cobranca/multa.ts`); a soma tem de bater com o saldo que o ERP
  informa. **Sem leitura ao vivo não se emite** — nunca cai para a base
  sincronizada (`customers.total_overdue_amount`).
- O admin pode **desmarcar** as linhas de saída (multa/equipamento) do Anexo
  I — nunca digitar um valor.
- A prévia do texto (ou das variáveis do modelo do ZapSign), o **custo desta
  emissão**, os bloqueios e avisos, e o `baseHash` que o POST vai reconferir.

### Bloqueios (a emissão não segue com nenhum destes)

Cadastro e configuração: cliente não encontrado nesta carteira; sem
integração ativa; provedor assina mas falta o representante; cliente sem
CPF/CNPJ; cliente sem e-mail **e** sem telefone; devedor PJ sem representante
informado; sem caso de cobrança aberto ("abra o caso antes").

Leitura do ERP: ERP não respondeu (sem leitura ao vivo); soma das faturas
vencidas diferente do saldo que o ERP informa; nada a formalizar (acordo sem
parcela aberta, ou sem fatura vencida no saldo integral); no acordo, saldo no
ERP menor que o do acordo ("confira antes de formalizar"); todas as faturas
foram desmarcadas.

Prescrição: dívida prescrita pela régua de cobrança bloqueia sempre, citando
CC art. 191 — o campo `confirmoPrescricao` já existe no schema da API e é
gravado no evento quando marcado, mas **hoje não desbloqueia nada**; é o
gancho para o dia em que essa decisão for liberada pelo dono, com parecer
jurídico.

Avisos que não bloqueiam: contato diferente do cadastro do ERP (a emissão
passa a exigir `validate_cpf` do ZapSign); fatura que mistura mensalidade e
multa sem valores separados ("confira no ERP").

### Permissão e emissão

`POST /api/cobranca/clientes/:id/confissoes` exige admin do provedor (ou
superadmin personificando) — operador comum recebe 403
`{ code: "APROVACAO_OBRIGATORIA" }`. O corpo carrega `baseHash` (o servidor
recalcula e recusa com 409 "a dívida mudou" se diferir) e `chaveIdempotencia`
(UUID — reenviar a mesma chave devolve a confissão já criada, nunca duplica).
Sob uma trava por cliente, o servidor grava o **rascunho** com a foto completa
(base canônica, hash, Anexo I, PDF original) e só então, fora da transação,
fala com o ZapSign: cria o documento (por PDF ou por `template_id`), registra
o webhook **daquele documento** com o cabeçalho secreto, e só marca `enviada`
depois de tudo dar certo. A falha em qualquer chamada ao ZapSign **encerra o
rascunho como `cancelada`**, grava o motivo em `erro_ultimo` e **libera a
chave de idempotência** — a próxima tentativa não precisa cancelar nada, e um
documento criado sem webhook registrado é apagado no ZapSign para não ficar
órfão. A passagem para `enviada` é o ponto sem volta: o evento no caso e o
follow-up vêm depois dela, e se um deles falhar a emissão continua valendo (o
cliente pode já ter o link) — a falha vira um aviso no log, nunca o documento
apagado.

### O que o sandbox não faz

Em `sandbox`: nenhum envio automático (`send_automatic_email`/
`send_automatic_whatsapp` sempre `false`), o diálogo exige marcar "confirmo
que é um TESTE", o selo vira "TESTE — sem validade jurídica" em vez de "título
executivo assinado", e o botão **"Enviar pelo chat" não aparece** (a condição
é `ambiente !== "sandbox"` — só "copiar link" fica disponível).

### Depois de emitida

"Copiar link" (`sign_url` do cliente) fica disponível sempre que a confissão
está `enviada`. "Enviar pelo chat" só aparece quando **todas** estas
condições valem: o Chat BullQ está ligado para o provedor e em produção
(`GET /api/cobranca/confissoes/estado` → `chatDisponivel`), há um caso de
cobrança ligado ao chat, e o ambiente da confissão não é sandbox.

---

## 5. Retorno

`POST /api/webhooks/zapsign/:providerId` — rota pública (o ZapSign não assina
os próprios webhooks por HMAC).

**Autenticação:** o cabeçalho `X-Consulta-ISP-Assinatura` é comparado em
tempo constante (`timingSafeEqual`) ao `webhook_secret` do provedor — e a um
segredo fictício gerado no boot quando não há integração, para o tempo de
resposta não denunciar se o provedor existe. Provedor inexistente, integração
desligada ou cabeçalho errado devolvem o **mesmo 401**. Limites: 120
requisições/min por IP (`createRateLimiter`) e 60/min por provedor (contador em
memória do processo).

**O que o corpo decide:** só `event_type` e o `token` (ou `doc_token`) do
documento. Token que não pertence a uma confissão deste provedor → 200
`{ ok: true, ignorado: true }`, sem gravar nada do corpo. Eventos
informativos — `doc_created`, `created_signer`, `signature_notification_sent`,
`doc_read_confirmation`, `doc_expiration_alert`, `email_bounce`, `doc_viewed`,
`request_signature`, `reading_confirmation`, `authentication_failure` — voltam
200 sem reconsultar o ZapSign. Confissão fora de `enviada` → 200 sem
reconsulta. `doc_refused` e `doc_expired` **não são confirmáveis** pelo
detalhe do documento: o webhook grava `recusaInformadaEm`/
`expiracaoInformadaEm` e um evento no caso ("cliente recusou — ligar"), mas a
confissão continua `enviada` até o admin cancelar (que prova `deleted`) ou o
prazo vencer de fato.

**A reconsulta:** no máximo uma por confissão a cada 30 segundos (eventos
dentro da janela respondem 200 e a reconciliação cobre depois). Quando dispara,
chama `GET /docs/{token}/` no host do **ambiente gravado na linha** — nunca no
ambiente atual da integração, que pode ter mudado — com o token do provedor.
Do payload só entram `token`, `status`, `signed_at`, `auth_mode` por
signatário e `sandbox`; tudo o mais (`liveness_photo_url`, `geo_*`, `ip`,
`answers`) é descartado na borda por um `.strip()` do Zod. `sandbox`
divergente do `ambiente` da linha → nada aplica, `erroUltimo = "ambiente
divergente"`. `deleted: true` → `cancelada`. `status: "signed"` → baixa o
`signed_file` (até 8 MB) para `cobranca_confissoes_pdf` e faz a transição
**atômica** `UPDATE … SET status = 'assinada' WHERE status = 'enviada'` — só
quem recebe a linha de volta grava o evento e o follow-up, então webhook e
worker chegando juntos não duplicam nada. Reconsulta que falha → 502,
`erroUltimo` e `reconciliarEm = agora + 10 min`.

### Reconciliação (worker, `server/services/confissao/confissao-reconciliacao.service.ts`)

Roda **só no worker** (`server/worker.ts`), a cada **10 minutos**
(`PASSADA_CURTA_MS`), primeira passada 1 minuto depois do boot:

1. **Reconsulta**: normalmente só as `enviada` com `reconciliarEm` vencido
   (uma reconsulta anterior falhou). A cada **6 horas** a mesma passada
   **também** reconsulta toda confissão `enviada` há mais de 1 hora, mesmo
   sem falha registrada — cobre um webhook que nunca chegou.
2. **Expiração**: em toda passada (a cada 10 min), reconsulta e marca
   `expirada` quem passou de `dataLimiteAssinatura` sem assinar.
3. **Quitação**: só na passada **completa** (a cada 6 h), verifica até 500
   `assinada`: origem `acordo` com a negociação `cumprida`, ou origem
   `saldo_integral` com todas as faturas do Anexo I `paid`/`baixada_no_erp` —
   nesses casos vira `quitada`. A janela gira: cada linha conferida é
   carimbada em `quitacao_verificada_em`, e a passada seguinte começa pelas
   nunca conferidas e pelas conferidas há mais tempo — um título que nunca
   quita (pagamento parcial, abandonado) não prende a fila.
4. Quando `provedor_assina` está ligado e o cliente já assinou mas o
   representante do provedor não, registra um evento "falta a assinatura do
   provedor" e um follow-up para o admin — uma vez por confissão, marcada em
   `aviso_provedor_em` (caso fechado não recebe evento, nem follow-up, nem a
   marca).

### Cancelar

`POST /api/cobranca/confissoes/:id/cancelar` (admin). Em `rascunho`, cancela
direto. Em `enviada`, **reconsulta primeiro**: `signed` → aplica a assinatura
e devolve 409 "o cliente já assinou"; `deleted` → `cancelada` sem chamar
`DELETE` de novo; `pending` → `DELETE /docs/{token}/` e `cancelada`. Uma
confissão `assinada` **não se cancela** — para valor novo, emite-se outra (a
anterior vira `substituida` quando a nova é assinada).

Reconsulta em **404** (o documento não existe mais no ZapSign — o token foi
trocado para outra conta, ou o ZapSign expurgou): o cancelar é a saída. A
confissão vai para `cancelada` localmente, com `erro_ultimo` explicando, o
`DELETE` ainda é tentado (o 404 dele é tolerado; qualquer outra falha deixa
tudo como está) e o evento vai para o caso — a vaga de "uma confissão viva por
cliente" fica livre. **Nenhum caminho automático faz isso:** a reconciliação e
a expiração só registram a falha e tentam de novo, porque depois de uma troca
de token o 404 não prova que o cliente não assinou na conta antiga, e abrir
mão do título é decisão de quem cancela.

### Reenviar

`POST /api/cobranca/confissoes/:id/reenviar` (admin), só em `enviada`, no
máximo uma vez a cada 30 minutos, chamando
`POST /docs/{token}/resend-notifications-bulk/` no ZapSign — o endpoint em
massa que a spec original marcava como "não confirmado" **foi confirmado** e é
o que o conector usa. Em sandbox o botão não existe (nada é enviado ao
cliente).

---

## 6. Dados (migração 0037, três tabelas)

### `assinatura_integracoes`

Uma linha por `(provider_id, fornecedor)` — hoje só `fornecedor = 'zapsign'`.
Colunas: `api_token` (cifrado com `encryptField`, AES-256-GCM com chave
derivada do `SESSION_SECRET`), `ambiente` (`sandbox`/`producao`),
`template_id`, `signatario_nome/cpf/email/telefone` (o representante do
provedor, só usado quando `provedor_assina`), `provedor_assina`,
`auth_mode_cliente`, `exigir_selfie`, `prazo_assinatura_dias`,
`enviar_arquivo_assinado_whatsapp`, `modelo_revisado_em`/
`modelo_revisado_por_user_id`, `webhook_secret` (gerado com
`crypto.randomBytes(32)`, regenerado quando token ou ambiente mudam, **nunca**
sai por GET), `is_enabled`, `ativada_em`. Índice único
`assinatura_integracoes_provider_fornecedor`.

### `cobranca_confissoes`

A confissão em si — sempre com `provider_id`, `customer_id` e `caso_id`
(`NOT NULL`: exige caso vivo). Campos notáveis:

- `origem` (`acordo`/`saldo_integral`), `negociacao_id` (quando é o acordo).
- `ambiente` (a foto do ambiente na emissão) e `zapsign_sandbox` (o que o
  ZapSign devolveu na última reconsulta — os dois podem divergir, e aí nada se
  aplica).
- `valor_total`, `valor_original`, `desconto_pct` (do acordo, para a cláusula
  condicional de desconto).
- `parcelas` (jsonb) — `ParcelaConfessada[]`: `{ n, rotulo: "entrada" |
  "parcela", valor, vencimento }`.
- `erp_source`, `erp_lido_em`, `erp_faturas` (jsonb) — o Anexo I, um array de
  `FaturaDoAnexo`: `{ chave, erpRef, descricao, vencimento, valor, classe:
  "servico" | "multa" | "equipamento" | "indeterminada", diasAtraso, multa,
  juros }`. `chave` é `erpRef`, ou `erpRef#multa`/`erpRef#equipamento` quando
  uma fatura foi dividida em duas linhas — é essa chave que o admin desmarca
  no Anexo I, e o índice que junta a linha ao texto renderizado.
- `modelo` (`padrao`/`zapsign`), `modelo_versao`, `modelo_revisado`,
  `base_canonica` (jsonb — o JSON estável que gerou o texto), `texto_hash`
  (SHA-256 **sem** `erp_lido_em`), `gerado_em`.
- `status`: `rascunho → enviada → assinada | cancelada | expirada`, e a
  partir de `assinada`: `quitada` ou `substituida` (as transições permitidas
  vivem em `TRANSICOES_DE_CONFISSAO`, `shared/cobranca/confissao.ts`).
- `recusa_informada_em`, `expiracao_informada_em` — o que o webhook informou
  sem confirmação do detalhe.
- `reconciliar_em` — próxima reconsulta forçada depois de uma falha.
- `zapsign_doc_token`, `webhook_zapsign_id`, `zapsign_signers` (jsonb) — um
  array de `SignatarioDaConfissao`: `{ papel: "cliente" | "provedor", token,
  signUrl, status: "new" | "link-opened" | "signed", signedAt, authMode }` —
  só esses campos, nunca o que o ZapSign manda a mais.
- `cliente_nome/cpf_cnpj/email/telefone` (como foram ao ZapSign) e
  `cliente_email_erp/telefone_erp` + `contato_alterado_por_user_id` (o que o
  ERP tinha e quem mudou).
- `representante_nome/cpf` (devedor PJ).
- `data_limite_assinatura`, `enviada_em`, `assinada_em`, `encerrada_em`.
- `pdf_original_sha256`, `pdf_assinado_sha256` (os bytes ficam na outra
  tabela).
- `criada_por_user_id`, `aprovada_por_user_id`, `chave_idempotencia` (uuid),
  `erro_ultimo`.
- `quitacao_verificada_em` — o cursor da varredura de quitação do worker
  (quando a assinada foi conferida pela última vez). Não é `updated_at`: esse
  continua sendo "última alteração", e é dele que a retenção de 90 dias conta.
- `aviso_provedor_em` — quando o worker avisou "falta a assinatura do
  provedor" (nulo = ainda não avisou). Não é `erro_ultimo`: esse é o canal de
  erro da tela, e a reconsulta o zera.

Índices: `(provider_id, customer_id)`, `(provider_id, status)`,
`(status, reconciliar_em)`, único parcial em `zapsign_doc_token` (quando não
nulo), **único parcial `(provider_id, customer_id) WHERE status IN
('rascunho', 'enviada')`** — a garantia de "uma confissão viva por cliente" no
próprio banco, não só na aplicação — e único parcial em
`(provider_id, chave_idempotencia)`.

### `cobranca_confissoes_pdf`

Os bytes, fora da linha principal: `confissao_id`, `provider_id`, `tipo`
(`original`/`assinado`), `sha256`, `tamanho_bytes`, `base64`, `baixado_em` (o
último download), PK `(confissao_id, tipo)`. O storage **nunca** seleciona
`base64` fora de `obterPdf(providerId, confissaoId, tipo)`; um `signed_file`
acima de 8 MB é recusado com `erro_ultimo`, não gravado.

---

## 7. LGPD

**Papéis:** o **provedor** é o controlador dos dados do próprio cliente; o
**Consulta ISP** é operador; o **ZapSign** é operador contratado pelo
provedor — a conta, o contrato e o pagamento são dele, não nossos.

**Base legal** (LGPD art. 7): V (execução de contrato), VI (exercício regular
de direitos) e X (proteção do crédito). Selfie/biometria, quando ligada:
art. 11, II, d — desligada por padrão em todo provedor.

**O que vai ao ZapSign:** só o necessário para o documento e para provar quem
assina — nome, documento, e-mail, telefone, endereço, as faturas do Anexo I.
**O que volta e é gravado:** só os seis campos da seção 6 (`token`, `status`,
`signed_at`, `auth_mode` por signatário, `sandbox`, o arquivo assinado);
qualquer outra coisa que o ZapSign mande — geolocalização, IP, foto de
liveness, respostas de formulário — é descartada na borda e nunca chega ao
banco nem ao log.

**Retenção** (`server/services/lgpd-confissoes.ts`):

- Uma confissão `assinada` **em produção** é título executivo: fica guardada
  até **5 anos** depois do último vencimento das parcelas ou da quitação (CC
  art. 206, §5º, I — prazo prescricional de cobrança de dívida líquida em
  instrumento particular). Pedido de exclusão do titular **não** a anonimiza
  dentro desse prazo (LGPD art. 16, I) — a resposta ao titular lista a
  confissão preservada e a base legal (`BASE_LEGAL_DA_PRESERVACAO`).
- Tudo o que **não** é título — `rascunho`, `cancelada`, `expirada`, e
  **qualquer linha de sandbox** (mesmo `assinada`, porque não tem validade
  jurídica) — perde o PDF e os dados pessoais **90 dias** depois da última
  atualização: `anonimizarConfissao` apaga as duas linhas de
  `cobranca_confissoes_pdf` e zera nome, CPF/CNPJ, e-mail, telefone (do
  cadastro e do ERP), representante, `parcelas`, `erp_faturas` e
  `zapsign_signers`, mantendo status, hashes e datas. Roda dentro do mesmo
  scheduler de retenção que já existia para consultas ISP/SPC
  (`server/services/lgpd-retention.ts`, 24 h, primeira passada 30 s depois do
  boot) — **no worker**, não na API, a menos que `RUN_BG_JOBS_IN_API=true`.

**Direitos do titular** (`server/services/lgpd-titular.service.ts`, processado
de hora em hora): o relatório de **acesso** e o de **portabilidade** passam a
incluir `confissoesDeDivida` (id, provedor, status, valor, ambiente, datas). O
processamento de **exclusão** não anonimiza nenhuma confissão na hora — quem
limpa o que não é título são os 90 dias da retenção automática acima,
independente de haver pedido —; a resposta ao titular só informa
`confissoesPreservadas` (assinada + produção) junto com a base legal de cada
uma.

---

## 8. Operação

**`ASSINATURA_WEBHOOK_URL`** (opcional): a base do webhook que o ZapSign
chama de volta. Padrão `https://consultaisp.com.br/api/webhooks/zapsign`. O
caminho final é sempre `/{providerId}` (`urlDoWebhookDeAssinatura`,
`server/services/confissao/confissao-emissao.service.ts`). Só precisa ser
definida se o domínio de produção não for `consultaisp.com.br`.

**Conferir um webhook na conta do ZapSign:** o webhook é registrado **por
documento**, na hora da emissão (`POST /user/company/webhook/` com
`doc_token`), não como um webhook único de conta — então não existe uma tela
"o webhook está certo?" no Consulta ISP. Para conferir, entre na conta ZapSign
do provedor e abra o documento da confissão: ele deve ter um webhook próprio
apontando para `{ASSINATURA_WEBHOOK_URL}/{providerId}`, com o cabeçalho
`X-Consulta-ISP-Assinatura`. Se a emissão terminou em erro antes de registrar
o webhook, o documento já foi apagado do ZapSign (o código não deixa
documento órfão sem webhook).

**Quando o token para de abrir (`apiTokenIlegivel: true`):** o token é cifrado
com AES-256-GCM usando uma chave derivada do `SESSION_SECRET` (mesmo
mecanismo dos tokens de ERP, `server/utils/crypto.ts`). Se o `SESSION_SECRET`
mudar depois que o token foi salvo, a decifragem falha. Não tem conserto
automático: o superadmin **redigita o token** na Ficha do provedor e salva —
`PUT` com `apiTokenIlegivel = true` e token vazio é recusado com 400
justamente para não deixar essa situação passar batido.

**Sondar o token manualmente** (o mesmo teste que o botão Ativar roda):

```bash
curl -H "Authorization: Bearer SEU_TOKEN" "https://sandbox.api.zapsign.com.br/api/v1/docs/?page=1"
```

Troque o host para `https://api.zapsign.com.br/api/v1/...` em produção. Um
401/403 aqui é exatamente o que o botão Ativar reporta como
`ZAPSIGN_CREDENCIAL`.

**Limites de taxa:** configurar a integração, 60/min; ativar, 20/min
(`server/routes/admin-assinatura.routes.ts`, os mesmos limiares do ERP).
Webhook: 120/min por IP e 60/min por provedor. As rotas do provedor
(`confissao.routes.ts` — base, emitir, listar, cancelar, reenviar, pdf,
estado) não têm limiter próprio, só autenticação e a checagem de admin nas
sensíveis.

**Processo que roda a reconciliação e a retenção:** o **worker**
(`consulta-isp-worker` no `ecosystem.config.cjs`), não a API. No boot do
worker aparece a linha `[Worker] Reconciliação de confissões started`
(`server/worker.ts`); se ela não aparecer, a confissão fica presa em
`enviada` até o próximo webhook — que ainda funciona, só a reconciliação de
fundo é que não roda.

---

## 9. Fora do escopo desta entrega

- Cobrança das parcelas confessadas (boleto/PIX): segue a origem já
  configurada na política de acordo do provedor; a confissão só as descreve.
- Protesto, negativação e execução judicial do título.
- Certificado digital (ICP-Brasil) como padrão — continua existindo como
  opção de `auth_mode`, não como obrigatório.
- Portal do ex-cliente assinando sozinho, sem o operador emitir.
- Modelos por carteira: existe um único texto padrão, com variáveis; carteiras
  diferentes não têm textos diferentes.
