# Mapa da rede por ponto — SEGURADO, não subiu (08/09/2026)

> **Não commite estes arquivos como estão.** Eles estão na árvore de trabalho,
> fora do commit `4226509`, de propósito.

## O que ficou de fora

```
server/services/rede-pontos.service.ts        (novo)
server/services/rede-pontos.service.test.ts   (novo)
server/routes/localizacao.routes.ts           (a rota /api/localizacao/rede)
server/routes/localizacao.routes.test.ts
client/src/components/localizacao/*           (PainelRede, RaioXBairro, RankingBairros,
                                               metricas, BenchmarkCidades + testes)
client/src/components/maps/MapaCarteira.tsx
client/src/pages/operacional/localizacao.tsx
docs/rede-mapa-2026-09-08.md
docs/revisao-localizacao-2026-09-08.md
```

O resto da entrega de cobrança subiu normalmente. `server/storage/localizacao.storage.ts`
e `server/services/benchmark-bairro.service.ts` **subiram**: filtram por
`providerId` e não fazem `innerJoin(providers)` — são o mapa do próprio provedor,
não têm o problema abaixo.

## Por quê

`pontosDaRede` lê `customers` de **todos os tenants**
(`.innerJoin(providers, …).where(providers.status = 'active')`, sem `providerId`
da sessão e sem `verificationStatus = 'approved'`) e devolve, **por ponto**:

- `divida` — o valor devido **ao centavo** daquele cliente
- `bairroChave` — cidade|UF|bairro
- `grupo` — o código do provedor de origem

Com `carteira` em `"ativo"` por padrão, isso são os **clientes atuais** dos
concorrentes. A rota é `requireAuth + requireProvider` — qualquer operador, sem
admin. O piso de k-anonimato (`MIN_POR_BAIRRO = 3`) só sobreviveu nas bolhas; os
pontos saem sem piso, e o painel diz isso: *"Todos os pontos com coordenada
utilizável entram, inclusive bairros com um caso"*.

Num bairro onde um concorrente tem um devedor, **o ponto é aquela pessoa** — e o
valor que ela deve vai junto.

## A regra que isso quebra

Está escrita no cabeçalho de `server/services/rede-regional.service.ts`, com data,
e é do dono:

> Regra do dono (02/09/2026): *"só mostrar ex-clientes com dívida; dados da rede
> somente o ponto no mapa, **sem informações**, para não infringir a LGPD"*.
>
> - ponto por OCORRÊNCIA: posição deslocada — **sem faixa de valor, sem bairro,
>   sem referência**;
> - Só ex-cliente. **Cliente que ainda é de alguém não entra**: apontar onde mora
>   quem está devendo ao vizinho seria **lista de alvos**, não informação de risco.

E a restrição do próprio CLAUDE.md: *"Dados de inadimplência entre provedores devem
ser mascarados — nome parcial, faixa de valor, endereço sem número. Nenhum dado
pessoal completo exposto entre tenants."*

O deslocamento de ~500m com jitter reduz precisão; não anonimiza — e o comentário
do próprio arquivo admite isso.

## O que precisa acontecer para subir

Uma decisão do dono, e depois o código obedecendo a ela. Se a decisão de 02/09
continua valendo, o ponto da rede volta a ser **só geometria**: sem valor, sem
bairro, sem código de origem, só ex-cliente, e com piso por bairro. Se o dono
quiser mudar a regra, é decisão dele — mas é uma mudança de política de LGPD num
produto de bureau, não um ajuste de tela, e não pode entrar junto com outra
entrega.

O resto do trabalho de Localização (benchmark por cidade, raio-X de bairro,
métricas) não depende do vazamento e pode ser separado.
