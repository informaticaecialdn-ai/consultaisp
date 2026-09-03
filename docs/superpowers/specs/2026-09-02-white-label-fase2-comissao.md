# White Label Fase 2 — Revenda por comissão sobre venda direta

**Data:** 2026-09-02
**Status:** aprovado pelo dono em 02/09/2026; em implementação fase a fase
**Desenho completo:** `2026-09-02-white-label-fase2-desenho.md` (mesma pasta)

## Pedido

> o consulta isp... que vender também como white label, para revendedores que
> quiserem montar seu sistema. revise e crie todo gerenciamento para funcionar
> também como white label. (…) terminar white label

## O que já existe (fase 1, não reescrever)

Tabela `marcas`, `providers.marcaId`, resolução host → marca
(`server/services/marca.service.ts`), injeção da marca no HTML, tela
`/admin/marcas` (superadmin), e-mails e LGPD com a marca,
`script/dominio-whitelabel.sh`.

## Decisões do dono (02/09/2026)

Cada linha é uma resposta do dono às perguntas do desenho. Valem sobre o texto
do desenho onde divergirem.

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Schema | **Aprovadas as duas migrações**: `0012` (sequences de pedido e fatura) e `0013` inteira — `users.marca_id` + CHECK bidirecional de papel; em `marcas`: `revenda_ativa`, `status_comercial`, `comissao_percentual`, `repasse_razao_social/cnpj/chave_pix/email`, `cadastro_aberto`, `landing_ativa`, `landing` (jsonb), `og_image_png`; tabelas `marca_precos`, `comissao_fechamentos`, `comissao_lancamentos`, `marca_eventos`; `credit_orders.marca_id` + `preco_unitario_centavos`; `provider_invoices.marca_id`; `visitor_chats.marca_id`; `titular_requests.marca_id`. Tudo nullable/default; nada existente é alterado. |
| 2 | Modelo comercial | **Comissão sobre venda direta.** A plataforma continua a única que cobra o provedor (uma conta Asaas, uma NFS-e), pelo preço da marca; paga X% ao revendedor sobre o que efetivamente entrou. Atacado fica como evolução, com a rota `POST /api/revenda/provedores/:id/creditos` reservada (403). |
| 3 | Percentual e base | **20% sobre o bruto pago**, créditos e mensalidade; percentual negociável por marca (0–50), definido só pelo superadmin. |
| 4 | Piso e teto do preço da marca | **Piso = a própria tabela da plataforma** (a marca só sobe o preço); teto R$ 5,00 por crédito. Rejeitado na gravação, nunca clampado. Motivo: a plataforma fica com preço × (1 − comissão); abaixo da tabela a cadastral (R$ 0,72) dá prejuízo. |
| 5 | Quem edita o preço | **O revendedor, dentro do piso/teto**, com override do superadmin e trava por `status_comercial`. |
| 6 | Pagamento da comissão | **Fechamento mensal**, aprovado pelo superadmin, pago fora do sistema (PIX/TED) contra NF de comissão do revendedor; mínimo R$ 100 (abaixo acumula); prazo até o dia 10. Split Asaas fica como opção futura (`marcas.asaas_wallet_id`). |
| 7 | Retroativo | **Sem retroativo.** Pedidos e faturas anteriores à migração ficam com `marca_id` nulo e continuam da plataforma. |
| 8 | KYC | **100% da plataforma.** O revendedor vê o status, nunca os documentos. |
| 9 | Suspensão pelo revendedor | **Sim**, com motivo (≥ 8 caracteres), confirmação digitada e evento. O login passa a recusar provedor `suspended`, inclusive quando o superadmin suspende. |
| 10 | Entrada do revendedor | **Só pelo domínio próprio da marca**, com HTTPS ativo antes de o superadmin criar o usuário (422 antes). Ordem: domínio → revenda ativa → usuário. |
| 11 | Cadastro self-service | Flag `cadastro_aberto` por marca, **desligada por padrão**. |
| 12 | Preços na landing da marca | **Sim**, `landing.mostrarPrecos` ligado por padrão. |
| 13 | Suporte in-app | **Plataforma continua atendendo** em nome da marca; revendedor não vê threads nesta fase. |
| 14 | Marca suspensa/inadimplente/encerrada | **Provedores seguem operando e pagando a plataforma**; comissão para; preço da marca mantido até o superadmin desvincular; `ativo=false` só derruba a pele. Regra: provedor nunca é punido automaticamente por dívida do revendedor. |
| 15 | Auditoria | **`marca_eventos` obrigatória** desde a fase 1 (append-only, best-effort, com redação). |
| 16 | Jurídico/fiscal | Contador e jurídico antes da fase 4 (aceite com as três partes, "faturado por", contrato de revenda, NF de comissão, retenções). `LGPD_CNPJ`/`LGPD_EMPRESA` reais na VPS já na fase 0 — **pendente: o dono precisa informar o CNPJ e a razão social da plataforma**. |
| 17 | Créditos iniciais | **Padrão da plataforma**, qualquer origem. |
| 18 | Entrega | **Fase a fase até o fim** (0 → 6), cada fase testada, commitada e publicada na VPS. |

## Invariantes (valem em todas as fases)

- Bureau único; isolamento por `providerId` continua absoluto. Toda query de
  revenda filtra por `session.marcaId`; alvo `:id` passa por
  `assertProvedorDaMarca` com **404 uniforme**, nunca 403.
- A marca considerada na comissão é a **foto** gravada no pedido/fatura
  (`credit_orders.marca_id`, `provider_invoices.marca_id`), nunca a marca atual
  do provedor. Estorno gera lançamento negativo; nada é apagado.
- Comissão nasce só quando dinheiro entra: `releaseCreditOrder` e fatura de
  plano marcada `paid` (webhook, `/asaas/sync`, PATCH). Um lançamento por
  origem, `UNIQUE(origem, origem_id)` — idempotente contra reentrega.
- Preço resolvido **sempre no servidor** (`precos.service.ts`, três camadas:
  piso/teto em código → `marca_precos` → tabela padrão em `shared/planos.ts`).
  O client nunca importa a tabela para exibir preço a provedor logado.
- Migrações escritas à mão (`migrations/00NN_*.sql`), `IF NOT EXISTS`,
  idempotentes, sem `ON DELETE CASCADE`; aplicadas por `psql` em transação
  depois do backup. `drizzle-kit push` não é usado (a 0009 provou que ele
  propõe renomear `session`).
- Nunca reaproveitar `getAllProvidersWithStats` (devolve `erpToken`
  descriptografado) nem `GET /api/admin/users` (global) no painel do
  revendedor: storage próprio, colunas nomeadas.
- Português em interface, erros e domínio; tokens do `DESIGN_SYSTEM.md`.

## Fases

Ver a seção "Fases" do desenho. Resumo:

| Fase | Entrega | Schema |
|---|---|---|
| 0 | Defeitos que a fase 2 pisa: compra de créditos quebrada, `releaseCreditOrder` transacional, webhook com token obrigatório em produção, sequences, `requireAuth`/login fail-closed, `requireProvider`, `shared/planos.ts` + `precos.service.ts`, `hostPertenceAMarca`/`resolverMarcaPorId`/`urlDeEntrada`, `/lgpd` pública, reenvio/reset com a marca | só `0012` |
| 1 | Identidade do revendedor: role, sessão, middlewares, login por domínio próprio, equipe e aba comercial em `/admin/marcas`, `marca_eventos`, `/revenda` básico | `0013` |
| 2 | Painel de provedores da marca (`revenda.storage.ts`, lista/detalhe/criação/edição/suspensão/usuários/convite) | — |
| 3 | Preço da marca e foto no pedido/fatura; `/revenda/precos`; fatura "vendido por / emitido por" | — |
| 4 | Comissão: lançamento, fechamento, pagamento; `/admin/comissoes`, `/revenda/comissoes`, relatórios, job mensal | — |
| 5 | Landing e cadastro sob a marca | — |
| 6 | Hardening, auditoria, runbook, CLAUDE.md | — |

## Registro de execução

- 2026-09-02: decisões respondidas; fase 0 iniciada.
