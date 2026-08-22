# Localização — design

**Data:** 2026-08-22
**Status:** aprovado, pronto para plano de implementação

## Problema

O provedor precisa ver onde a inadimplência dele está no território. O sistema
já tem quase tudo para isso — e nada disso chega numa tela coerente.

### O que existe e onde

| Peça | Estado |
|---|---|
| `/mapa-calor` | Leaflet, heatmap, ranking por cidade, cache 24h — **órfã no menu** |
| `/benchmark-regional` | consome `map-points` e `neighborhood-stats`, já lista bairros |
| `getNeighborhoodStats` | retorna bairro, total, inadimplentes, %, R$, dias — sobre a carteira inteira |
| `getMapPoints` / `getDefaultersMapPoints` / `getCepRanking` | com rota em `benchmark.routes.ts` |
| `providers.cidadesAtendidas` / `mesorregioes` | preenchidos (NsLink: 46 cidades, 1 meso) |
| `shared/data/cidades-brasil.json` | 5571 cidades com UF, IBGE e mesorregião |

O dado está pronto. A interface está partida em duas telas, uma delas
inalcançável pelo menu.

### Três defeitos encontrados no levantamento

**1. O filtro regional não funciona.** As três queries de território filtram por
`providers.addressState`:

```ts
const providerState = provRows[0]?.state?.toUpperCase() || null;
const rows = providerState ? allRows.filter(...) : allRows;
```

A NsLink tem `address_state` **NULL**. Sem UF, nenhum filtro é aplicado — ela vê
tudo. E tem 46 cidades atendidas configuradas que ninguém lê.

**2. Dois vocabulários na mesma coluna.** Os valores reais de `customers`:

```
status:         active | inactive
payment_status: current | 31-60 | 61-90 | 90+
```

Mas `getMapPoints` e `getDefaultersMapPoints` filtram
`eq(customers.paymentStatus, "overdue")` — valor que **nenhuma linha possui**.
O `upsertFromErp` grava `current`/`overdue`; o seed grava faixas. Duas fontes,
dois vocabulários. Hoje essas queries retornam zero ponto para dado semeado.

**3. `cidades-brasil.json` não tem coordenada.** Só `nome`, `uf`, `ibge`,
`mesorregiao`, `mesorregiao_id`. Não dá para enquadrar o mapa por centroide de
cidade a partir dele.

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| 1 | Universo = `cidadesAtendidas`, com cascata de reserva | O sistema é regional e o dado de aderência regional já existe. Precisão para quem configurou, sem tela vazia para quem não. |
| 2 | Estado do ponto derivado de **valor**, não de string de status | `payment_status` tem dois vocabulários. `totalOverdueAmount > 0` é verdade única, independente de quem escreveu a linha. |
| 3 | Enquadramento pelo *bounding box* dos pontos | O JSON de cidades não tem coordenada. Os pontos já são geocodificados; o mapa se enquadra sozinho e se corrige conforme a carteira muda. |
| 4 | Consolidar numa tela só, com redirect das duas antigas | Duas telas para o mesmo assunto, uma órfã. Redirect preserva link salvo. |
| 5 | Camada de rede desligada por padrão, com toggle | É o diferencial do bureau colaborativo — nenhum concorrente tem. Mas a leitura do dia a dia é a carteira própria. |
| 6 | Sem penetração / HPs / UCs | Exigem IBGE CNEFE 2022 e ANEEL BDGD 2024, que este projeto não possui. Omitir o campo, nunca estimar. |
| 7 | Sem alteração em `shared/schema.ts` | Regra do CLAUDE.md. Todos os campos necessários existem. |

## Arquitetura

### Cascata regional

```
providers.cidadesAtendidas  →  não vazio?  →  filtra por essas cidades
        ↓ vazio
providers.mesorregioes      →  não vazio?  →  filtra pelas cidades da meso
        ↓ vazio                                (via cidades-brasil.json)
providers.addressState      →  não nula?   →  filtra pela UF
        ↓ nula
sem filtro + aviso na tela convidando a configurar Regionalização
```

O resultado da cascata é uma unidade só — `resolverAreaAtendida(providerId)` —
consumida por todas as queries de território. Uma função, um lugar para mudar.

### Estado do ponto

```ts
function estadoDoPonto(c) {
  const temDivida = Number(c.totalOverdueAmount || 0) > 0;
  const inativo = c.status === 'inactive' || c.status === 'cancelled';
  if (inativo && temDivida) return 'ex_divida';
  if (c.status === 'suspended') return 'suspenso';
  return temDivida ? 'em_cobranca' : 'em_dia';
}
```

Função pura, testável, espelhando o `estadoDoPonto` da referência. Nunca lê
`paymentStatus` — a coluna tem dois vocabulários e não é confiável.

Cores das quatro faixas usam os tokens semânticos da pele: `--ok`, `--gated`,
`--brand`, `--danger`. Alto contraste entre si, como a referência exige.

### Unidades

**`server/services/area-atendida.ts`** — a cascata. `resolverAreaAtendida(providerId)`
devolve `{ cidades: string[] | null, origem: 'cidades'|'meso'|'uf'|'nenhuma' }`.
`null` em cidades significa "sem filtro"; `origem` alimenta o aviso na tela.

**`server/services/estado-ponto.ts`** — a derivação do estado. Função pura.

**`server/routes/localizacao.routes.ts`** — `GET /api/localizacao` devolve tudo
que a tela precisa numa chamada: `{ pontos, bairros, cidades, semCoordenada, origemArea }`.
Uma requisição em vez de quatro, porque os quatro conjuntos vêm da mesma varredura.

**`client/src/pages/operacional/localizacao.tsx`** — a tela. Filtros são estado
local sobre os dados já carregados; não geram requisição nova.

### Contrato de `GET /api/localizacao`

```ts
{
  origemArea: 'cidades' | 'meso' | 'uf' | 'nenhuma',
  semCoordenada: number,
  cidades: Array<{ cidade: string; clientes: number }>,
  pontos: Array<{
    id: number; lat: number; lon: number;
    estado: 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';
    emAberto: number; atraso: number;
    bairro: string | null; cidade: string;
  }>,
  bairros: Array<{
    bairro: string; cidade: string;
    clientes: number; inadimplentes: number; exComDivida: number;
    pctInadimplencia: number; dividaTotal: number;
  }>,
}
```

**LGPD:** o ponto não carrega nome nem CPF. É a carteira própria do provedor,
então poderia — mas a tela não precisa, e menos dado trafegando é menos risco.
A camada de rede continua usando os endpoints anonimizados que já existem.

## Escopo

**Entra:**
1. `resolverAreaAtendida` e aplicação nas três queries de território
2. `estadoDoPonto` como função pura, com teste
3. `GET /api/localizacao`
4. Tela `/localizacao`: KPIs, mapa, filtros, legenda, ranking de bairros
5. Item "Localização" no menu apontando para a nova tela
6. Redirect de `/mapa-calor` e `/benchmark-regional`
7. Toggle da camada de rede, usando `/api/heatmap/regional` que já existe

**Fica de fora:** penetração, HPs, UCs vivas e benchmark de mercado por bairro —
dependem de IBGE CNEFE e ANEEL BDGD. Onde a referência mostra "penetração 13,9%",
a nossa omite o campo.

## Erros e casos de borda

| Caso | Tratamento |
|---|---|
| Provedor sem regionalização e sem UF | Mostra tudo, com aviso e link para Regionalização. Nunca tela vazia sem explicação. |
| Nenhum cliente geocodificado | Mapa enquadra na cidade do provedor via `geocodeCity`; KPI "sem coordenada" mostra o total. |
| Cliente sem bairro | Agrupa como "Sem bairro" no ranking, como `getNeighborhoodStats` já faz. |
| Cidade atendida sem nenhum cliente | Não vira chip de filtro — os chips saem do dado, não da configuração. |
| Camada de rede sem provedores vizinhos | Toggle fica desabilitado com explicação, em vez de ligar e não mostrar nada. |

## Testes

- `resolverAreaAtendida`: os quatro degraus da cascata, incluindo UF nula
- `estadoDoPonto`: as quatro combinações, mais o caso de `payment_status` em
  faixa (`90+`) que hoje quebraria um filtro por string
- Isolamento multi-tenant: `/api/localizacao` só devolve cliente do provedor da sessão
- Ranking: bairro sem cliente não aparece; `pctInadimplencia` bate com o cálculo manual

## Riscos

| Risco | Mitigação |
|---|---|
| Mudar o universo das queries afeta `/benchmark-regional` | A tela vira redirect na mesma entrega, então não há consumidor antigo sobrando. |
| Provedor estranha ver menos dado que antes | É o efeito pretendido — antes via a UF inteira ou tudo. O aviso de origem da área explica o recorte na tela. |
| Base local tem 7 clientes | O mapa funciona mas fica esparso. Não é defeito da tela; validar com dado sincronizado antes de julgar densidade. |
| Corrigir o filtro `paymentStatus === "overdue"` pode mudar número em outras telas | O filtro hoje retorna zero para dado semeado. Qualquer tela que dependa dele já está errada; a correção aparece como número novo, não como regressão. |
