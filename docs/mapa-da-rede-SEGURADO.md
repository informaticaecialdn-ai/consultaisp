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
server/services/rede-pontos.service.ts.segurado       (novo, não commitado)
server/services/rede-pontos.service.test.ts.segurado  (novo, não commitado)
client/src/components/localizacao/PainelRede.rede.test.tsx.segurado
                                                  (era PainelRede.test.tsx)
docs/rede-mapa-2026-09-08.md                      (o desenho da camada segurada)
```

Os três `.segurado` são renomeações para o typecheck e o vitest não os
coletarem: o painel voltou ao anterior e a assinatura de `agregarRede` mudou
em 09/09 (ganhou o observador), então os arquivos segurados nem compilam mais
contra o código atual. Quem for retomar a camada parte deles como rascunho,
não como base.

## O modo Rede que SUBIU em 09/09/2026 — e o que ele acrescentou ao payload

Com a camada Rede ligada, a fileira de KPIs, os chips e o seletor de carteira
continuavam sendo os da carteira própria (pedido do dono, com print). Subiu em
`82521cf` uma fileira de quatro cards só da rede, chips vindos da área que o
servidor usou, e dois campos novos em `GET /api/localizacao/rede` — desenhados
por um painel de três propostas + juiz, e cada campo submetido a três céticos
tentando provar vazamento (0/3 refutaram, com correções de implementação que
foram honradas):

- `cidades[]` — uma linha por cidade DECLARADA, zeros incluídos: `ocorrencias`
  (Σ das bolhas visíveis), `ocultas` (abaixo do piso), `doObservador` (só as
  linhas do provedor da sessão, contadas DEPOIS do portão de bairro — total
  menos seus nunca fica negativo) e `bairrosSemObservador` (bairros visíveis
  onde ele não tem caso; contagem, nunca nome). É contagem por MUNICÍPIO — o
  grão que a soma das bolhas já entregava.
- `observador` — `foraDaArea` e `cidadesForaDaArea` (até 5): ex-clientes com
  dívida do PRÓPRIO observador em cidades que ele não declarou. Só linhas
  dele; não é dado da rede.

E o rótulo de cidade em `bairros[]`/`pontos[]` passou a ser o declarado, sem
UF: a grafia crua do ERP alheio ("LONDRINA" numa bolha, "Londrina" na outra)
era a única marca de origem que o payload ainda carregava.

Medido em produção pela própria função (`script/medir-rede.ts 1`, NsLink,
09/09/2026): 4.344 ocorrências na rede (4.208 em 205 bairros + 136 abaixo do
piso), 294 suas, 4.050 de outros; **112 bairros sem caso dela** (o SQL cru
dizia 149 de 243 — o agrupador de grafias junta variações antes do piso);
rede com caso em 1 das 47 cidades declaradas; 944 ex-clientes dela fora da
área — 895 em Ibiporã, que ela não declarou.

## Três achados do painel que são DECISÃO DO DONO, não desta entrega

Apareceram na leitura do serviço enquanto o modo Rede era desenhado. Nenhum
foi corrigido: os três mudam o desenho do mapa ou a política de participação
na rede, e isso é política de LGPD num produto de bureau — a mesma razão pela
qual a camada por ponto foi segurada.

1. **O piso de 3 é furado pelo próprio observador.** Bairro com 3 casos, 2
   dele: o terceiro é uma pessoa de outro provedor, e a bolha diz que ela
   existe. O piso deveria valer sobre os casos de OUTROS
   (`ocorrencias − doObservador ≥ 3`). Com o providerId agora em memória, a
   correção é de três linhas em `agregarRede` — mas muda quais bolhas
   aparecem.
2. **Provedor não aprovado alimenta a rede.** `bairrosDaRede` lê `customers`
   de todo tenant, sem `providers.status = 'active'` nem
   `verification_status = 'approved'`. É política de quem alimenta o bureau.
   Os cards dão visibilidade ao 4.050 e o dono vai perguntar de onde vem.
3. **`deslocarPonto` usa o id global de `customers`.** O observador conhece os
   próprios ids (o link do Cliente 360 os entrega), reconstrói os próprios
   pontos deslocados e subtrai de `pontos[]` — sobram os pontos individuais
   dos concorrentes, deslocados mas individuais. Pré-existente; a saída é
   derivar o deslocamento de um segredo do servidor, não do id.

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
