# Consulta Cadastral (BigDataCorp) — design

**Data:** 2026-08-22
**Status:** aprovado, pronto para plano de implementação

## Problema

A consulta ISP responde *"esse CPF deve para algum provedor da rede?"*. Ela é
cega para duas perguntas que vêm antes:

1. **Esse CPF existe e é utilizável?** CPF cancelado, suspenso ou de titular
   falecido passa hoje sem nenhum alerta. É a fraude mais barata que existe:
   não exige montar história, só um número que a Receita já invalidou.
2. **Essa pessoa mora onde disse que mora?** O provedor descobre que não na
   hora em que a equipe chega no endereço — com o custo da visita já gasto.

Nenhuma das duas aparece no histórico da rede, porque não são inadimplência.
São cadastro.

### O que já existe

| Peça | Estado |
|---|---|
| `spc.service.ts` | serviço externo com env vars, circuit breaker, `withResilience`, resultado tipado — **o molde a seguir** |
| `ispConsultations` / `spcConsultations` | duas tabelas, mesmo formato: `result jsonb` + `score` |
| `providers.ispCredits` / `spcCredits` | saldo por tipo de consulta |
| `creditOrders.ispCreditsAdded` / `spcCreditsAdded` | compra de crédito por tipo |
| `consultationLogs` | trilha por CPF com `tipo` (`isp`/`spc`) |
| `baseLegal` / `finalidadeConsulta` no resultado da consulta ISP | padrão LGPD já estabelecido |

O terceiro bureau encaixa nesse molde sem inventar arquitetura nova.

## Decisões

### 1. Consulta separada, não enriquecimento da consulta ISP

A consulta ISP bate ao vivo nos conectores ERP da rede (`source: "erp_direct"`).
A BigData é uma chamada HTTP a um bureau externo, com custo por dataset e
latência própria. Amarrar as duas faria a consulta ISP falhar quando a BigData
cair, e cobrar BigData de quem só queria olhar a rede.

Telas separadas, créditos separados, falhas independentes.

### 2. Schema próprio — autorizado pelo dono em 2026-08-22

Reusar `spcConsultations` misturaria dois bureaus com contratos diferentes na
mesma tabela: o SPC devolve score 0–1000, a BigData não devolve score nenhum.
E sem crédito próprio o provedor não consegue ver quanto gastou com cada
fornecedor — que é exatamente a informação que ele usa para decidir se o bureau
vale o preço.

```
providers.bigdataCredits            integer not null default 0
creditOrders.bigdataCreditsAdded    integer default 0
plans.bigdataCreditsIncluded        integer not null default 0

bigdata_consultations
  id, providerId, userId, cpfCnpj,
  result jsonb, datasets text[], custo, createdAt
```

`datasets text[]` registra **quais** datasets foram chamados naquela consulta.
Sem isso, quando o custo subir ninguém sabe qual dataset é o caro.

### 3. Escolha dos datasets

A BigData oferece dezenas. A maioria não serve para ISP. O corte:

**Entram — decidem a instalação**

| Dataset | Campos que importam | Por quê |
|---|---|---|
| `basic_data` | `TaxIdStatus`, `HasObitIndication`, `Name`, `BirthDate`, `MotherName` | CPF cancelado/suspenso/falecido é veto, não ponderação |
| `addresses_extended` | `IsRatified`, `IsActive`, `EntityLastPassageDate`, `TotalBadAddressPassages`, `ZipCode`, `City` | responde "mora aí?" antes de a equipe sair |
| `financial_data` | `IncomeEstimates.BIGDATA_V2`, `TotalAssets` | renda em faixa de SM, cruzada com o valor do plano |

**Ficam fora — e é decisão, não esquecimento**

- `online_betting_propensity` — negar internet por score de aposta é decisão
  automatizada discriminatória. LGPD Art. 20 dá ao titular direito de revisão, e
  esse critério não se defende numa contestação. **Não usar.**
- `kyc`, `political_involvement`, `election_candidate_data`, `industrial_property`
  — irrelevantes para ISP.
- `government_debtors` e `processes` — sinal real, mas enviesado para PJ e
  autônomo, e mais caro. Ficam para uma fase 2, quando houver volume para medir
  se mudam decisão.

### 4. Não alimenta o score ISP nesta fase

O motor em `server/utils/isp-score.ts` é calibrado sobre inadimplência
observada na rede. Injetar renda presumida e status de CPF nele sem dado real
para calibrar produziria um número pior que o atual, com aparência de melhor.

A Consulta Cadastral entrega **veredito próprio** (`APROVAR` / `ATENÇÃO` /
`RECUSAR`), separado do score 0–1000. Quando houver histórico suficiente para
correlacionar, aí se decide fundir.

### 5. Veredito por regra explícita, não por modelo

```
RECUSAR  — TaxIdStatus != REGULAR, ou HasObitIndication
ATENÇÃO  — endereço não ratificado, ou TotalBadAddressPassages > 0,
           ou renda estimada abaixo do valor do plano informado
APROVAR  — nenhum dos acima
```

Regra escrita é auditável e contestável. É o que a LGPD exige de uma decisão
que nega serviço, e é o que o operador consegue explicar ao cliente no balcão.

## Arquitetura

```
client/src/pages/consulta/consulta-cadastral.tsx
        │  POST /api/bigdata-consultations { cpfCnpj, lgpdAccepted, valorPlano? }
        ▼
server/routes/consultas.routes.ts
        │  requireAuth + rate limit + débito de bigdataCredits
        ▼
server/services/bigdata.service.ts        ← molde: spc.service.ts
        │  POST https://plataforma.bigdatacorp.com.br/pessoas
        │  Headers: AccessToken, TokenId
        │  Body: { Datasets: "basic_data,addresses_extended,financial_data",
        │          q: "doc{CPF}", Limit: 1 }
        ▼
server/services/bigdata-veredito.ts       ← função pura, testável
        │  decide APROVAR / ATENÇÃO / RECUSAR a partir do payload normalizado
        ▼
bigdata_consultations (result jsonb + datasets[])
```

### Variáveis de ambiente

```env
BIGDATA_ACCESS_TOKEN=
BIGDATA_TOKEN_ID=
BIGDATA_BASE_URL=https://plataforma.bigdatacorp.com.br
```

Sem as duas primeiras, o serviço fica desligado e a tela diz isso — mesmo
comportamento de `SPC_ENABLED` em `spc.service.ts`.

## Escopo

**Entra**

- Serviço `bigdata.service.ts` com circuit breaker e resultado normalizado
- Função pura de veredito, com testes
- Tabela `bigdata_consultations` + colunas de crédito
- `POST` e `GET /api/bigdata-consultations`
- Tela `/consulta-cadastral`, item em Principal **abaixo de Consulta ISP**
- Consentimento LGPD no mesmo padrão da consulta ISP (`lgpdAccepted` booleano
  estrito, `baseLegal`, `finalidadeConsulta`, registro em `consultationLogs`)

**Fica fora**

- Fusão com o score ISP (decisão 4)
- `government_debtors` e `processes` (decisão 3)
- Consulta em lote — a ISP tem, esta não precisa antes de haver uso
- Consulta de CNPJ pela API de Empresas — o caso do provedor é PF

## Erros e casos de borda

| Situação | Comportamento |
|---|---|
| Credenciais ausentes | tela mostra "integração não configurada", nenhum crédito debitado |
| CPF sem dígito verificador válido | 400 antes de chamar a BigData, sem custo |
| BigData fora do ar / timeout | circuit breaker abre, 503, **crédito não é debitado** |
| CPF não encontrado na base | resultado válido com `notFound`, crédito **é** debitado — a consulta foi feita |
| Saldo zerado | 402 com link para compra de créditos |
| Dataset retorna `Status.Code != 0` | grava o que veio, marca o dataset como falho no `result`, não invalida os outros |

O caso que mais importa: **falha de rede não cobra, CPF inexistente cobra.** A
diferença é se a BigData executou a busca.

## Testes

Função pura, seguindo a cultura do repo:

- `bigdata-veredito.test.ts` — matriz de status do CPF, óbito, endereço não
  ratificado, `TotalBadAddressPassages`, renda vs valor do plano, e combinações
  onde dois sinais colidem (CPF regular + endereço ruim)
- Normalização do payload da BigData: campos ausentes, `IncomeEstimates` vazio,
  array de endereços vazio

Sem teste de integração com banco — o repo não tem essa camada.

## Riscos

**1. Custo por consulta é desconhecido.** A doc não diz se pedir três datasets
numa chamada cobra uma consulta ou três. Isso muda o preço por CPF e o desenho
de créditos. **Confirmar com o gerente de conta antes de precificar** — o
código deve funcionar dos dois jeitos, gravando `datasets[]` para permitir
auditoria depois.

**2. A conta do provedor pode não ter os datasets liberados.** O painel da
BigData mostra "Nenhum dataset disponível para esta API" quando o admin do
domínio não habilitou. A tela precisa distinguir isso de "CPF não encontrado",
senão o provedor conclui que o bureau é ruim.

**3. Renda presumida erra.** `IncomeEstimates` é estimativa estatística, não
holerite. Usar como `ATENÇÃO` e nunca como `RECUSAR` é proposital — negar
serviço por renda estimada errada é o tipo de decisão que vira processo.
