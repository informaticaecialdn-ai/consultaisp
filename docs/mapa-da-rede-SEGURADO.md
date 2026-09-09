# Mapa da rede por ponto — SEGURADO, não subiu (08/09, revisado 09/09/2026)

> **Não commite estes arquivos como estão.** Eles estão na árvore de trabalho,
> fora dos commits, de propósito.

## O bloco encolheu — o resto da Localização subiu em 09/09

A primeira versão desta nota segurou **17 arquivos**, e isso foi corte demais:
levou junto o trabalho de percentuais, que não tem nada a ver com o vazamento e
era o que o dono estava pedindo. A tela ficou pior do que antes — e o padrão
`"ativo"` que veio no meio do bloco derrubou os ex-clientes com dívida do mapa.

Subiu em 09/09/2026: as três carteiras (`?carteira=`), a taxa por bairro escrita
como fórmula na tela (`N inadimplentes ÷ M clientes`), participação e impacto na
base, o comparativo por cidade (`BenchmarkCidades`), a taxa agregada do recorte
(razão entre totais, não média de percentuais), o filtro de atraso, o desempate
de bairros homônimos por cidade (`chaveBairro`) e o link para o Cliente 360 no
popup do ponto. Nada disso lê dado de outro tenant por cliente.

## O que continua fora

```
server/services/rede-pontos.service.ts            (novo, não commitado)
server/services/rede-pontos.service.test.ts       (novo, não commitado)
client/src/components/localizacao/PainelRede.rede.test.tsx.segurado
                                                  (era PainelRede.test.tsx; renomeado
                                                   para não quebrar o typecheck do
                                                   painel que voltou ao anterior)
docs/rede-mapa-2026-09-08.md                      (o desenho da camada segurada)
```

E, dentro de arquivos que subiram, ficaram de fora estas partes:

- `server/routes/localizacao.routes.ts` — `/api/localizacao/rede` continua em
  `bairrosDaRede`, não em `pontosDaRede`.
- `client/src/components/localizacao/PainelRede.tsx` — o painel anterior, que
  explica o que a camada é e não lista nada.
- `client/src/components/maps/MapaCarteira.tsx` — `PontoRedeItem` continua sendo
  só `{cidade, lat, lon}`; sem popup de valor, sem cor por origem, sem calor
  ponderado pela dívida da rede.
- `client/src/pages/operacional/localizacao.tsx` — sem ranking de bairros da
  rede, sem legenda de origens, e `redePorPonto` volta a nascer desligada.

## Por quê

`pontosDaRede` lê `customers` de **todos os tenants**
(`.innerJoin(providers, …).where(providers.status = 'active')`, sem `providerId`
da sessão e sem `verificationStatus = 'approved'`) e devolve, **por ponto**:

- `divida` — o valor devido **ao centavo** daquele cliente
- `bairroChave` — cidade|UF|bairro
- `grupo` — o código do provedor de origem

Com `carteira` em `"ativo"`, isso são os **clientes atuais** dos concorrentes. A
rota é `requireAuth + requireProvider` — qualquer operador, sem admin. O piso de
k-anonimato (`MIN_POR_BAIRRO = 3`) só sobreviveu nas bolhas; os pontos saem sem
piso, e o painel diz isso: *"Todos os pontos com coordenada utilizável entram,
inclusive bairros com um caso"*.

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
