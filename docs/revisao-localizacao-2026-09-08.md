# Revisão do módulo Localização — 08/09/2026

> **Correção de 09/09/2026 — o padrão da carteira.** Este documento nasceu
> dizendo que a API assume **ativos** sem parâmetro. Assim foi por um dia, e
> derrubou o mapa em produção: a rota que estava no ar chama
> `getLocalizacao(providerId)` sem argumento, então o filtro entrou sem
> ninguém pedir e o mapa da NsLink perdeu **1.239 dos 1.260 devedores** — todos
> ex-clientes com dívida, que é o caso mais caro da carteira e a razão de o mapa
> existir. A taxa por bairro zerou junto, porque o numerador saía e o
> denominador ficava.
>
> O padrão agora é **base completa**, nos três lugares que precisam concordar:
> `LocalizacaoStorage.getLocalizacao`, a rota `GET /api/localizacao` e
> `carteiraDaUrl` na tela. Recorte é para quem PEDE.
>
> **O que ficou de fora desta entrega:** a camada **Rede por ponto**
> (`rede-pontos.service.ts`, o painel de origens coloridas e o ranking de
> bairros da rede) — ver `docs/mapa-da-rede-SEGURADO.md`. O mapa da rede
> continua no comportamento anterior: bolha por bairro, só ex-cliente, sem valor
> e sem origem. Tudo o mais abaixo está no ar.

## O que mudou

- Carteiras explícitas: clientes ativos (inclui suspensos), ex-clientes e base completa. A API valida o parâmetro, usa o provedor da sessão e, **sem parâmetro, devolve a base completa**.
- Clientes sem coordenadas continuam nos cálculos financeiros e nos denominadores. O mapa exibe somente devedores com posição utilizável.
- Ex-clientes sem dívida também integram a base de ex-clientes; a taxa não fica artificialmente em 100% por excluir os adimplentes.
- Cada bairro passa a mostrar separadamente taxa de inadimplência, participação na base e impacto dos seus devedores na base do provedor.
- Comparativo por cidade com quantidade de clientes, devedores, taxa própria, benchmark, diferença em pontos percentuais, dívida e cobertura do mapa.
- Filtros de atraso de 30, 90 e 360 dias; seleção de bairro por cidade + nome; link para Cliente 360 preservando a carteira.
- Penetração comercial não é apresentada como zero na carteira de ex-clientes: aparece como não aplicável.

## Fórmulas

Todas respeitam a carteira selecionada e os dados do provedor autenticado:

| Indicador | Cálculo |
| --- | --- |
| Inadimplência do bairro | Clientes com dívida vencida no bairro / todos os clientes do bairro |
| Participação na base do provedor | Clientes do bairro / todos os clientes do provedor, antes do recorte territorial |
| Impacto na base | Devedores do bairro / todos os clientes do provedor, antes do recorte territorial |
| Participação na cidade | Clientes do bairro / clientes da cidade |
| Taxa das cidades selecionadas | Soma dos devedores / soma dos clientes; não é média simples dos percentuais |

Exemplo conferido na base local: Jardim Pérola, Ibiporã, carteira ativa, tem 12 clientes e 5 devedores. O provedor tem 260 clientes ativos. Logo: inadimplência do bairro **41,7%**, participação **4,6%**, impacto **1,9%**.

## Benchmark

A referência é uma amostra de outros provedores participantes na mesma carteira e território; não mede toda a população da cidade. O provedor observador é excluído antes de avaliar a amostra mínima. Exige pelo menos três outros provedores elegíveis, cada um com dez clientes, e trinta clientes no agregado. O percentual é ponderado pela quantidade de clientes.

Comparações exigem UF confirmada. Dados sem UF ou cidades com UF ambígua não são combinados para produzir benchmark. Sem amostra suficiente, a interface informa indisponibilidade, sem fabricar uma taxa zero. O benchmark municipal independe de correspondência com bairros nas bases públicas. Caches são separados por carteira.

## Conferência local

Base do provedor usada na sessão: 260 ativos, 11 ex-clientes, 271 no total. A configuração territorial existente inclui 258 ativos e 9 ex-clientes nas três cidades principais. Os totais antes desse recorte permanecem visíveis. A elegibilidade mínima de cidade usa a base global do provedor, para uma cidade não desaparecer apenas por selecionar uma carteira menor.

| Carteira | Clientes nas cidades incluídas | Devedores | Taxa | Dívida vencida |
| --- | ---: | ---: | ---: | ---: |
| Ativos | 258 | 31 | 12,0% | R$ 12.711,00 |
| Ex-clientes | 9 | 9 | 100,0% | R$ 8.284,00 |
| Base completa | 267 | 40 | 15,0% | R$ 20.995,00 |

A taxa de 100% dos ex-clientes desta base local corresponde aos registros presentes; testes separados cobrem ex-clientes sem dívida no denominador.

Navegação verificada no navegador: troca das três carteiras, fórmulas do Jardim Pérola e seleção de Centro em Ibiporã com somente seus três devedores, sem misturar Centro em Cambé. A base local não possui amostra elegível para benchmark municipal. Nenhuma mensagem foi enviada, nenhuma migração foi executada e nenhum cadastro foi alterado nesta revisão.

## Validação

- 149 testes passaram em 12 arquivos: cálculos, rotas, isolamento, benchmark, serviços territoriais e componentes da interface.
- Build de frontend, API e worker concluído.
- Typecheck global ainda apresenta os mesmos 60 erros preexistentes, sem diagnóstico novo nesta revisão; não está totalmente aprovado.
- Logs de erros do navegador vazios na sessão de validação.
- `shared/schema.ts` preservado.

Endereço local: http://127.0.0.1:5000/localizacao?carteira=ativo

## Modo Rede — 09/09/2026

Com a camada Rede ligada, tudo ACIMA do mapa descrevia a carteira própria. Agora
cada modo tem a sua fileira; a da rede responde ao que só a rede responde:

| Card | Cálculo | NsLink (medido em produção) |
| --- | --- | --- |
| Casos de outros provedores | Σ (ocorrências + ocultas) − Σ doObservador, no recorte do chip | 4.050 (4.344 na rede · 294 seus · 6,8%) |
| Bairros sem caso seu | Σ bairrosSemObservador ÷ bairros visíveis, no recorte do chip | 112 de 205 |
| Cidades atendidas com caso na rede | cidades com ocorrências + ocultas > 0 ÷ cidades declaradas — sempre da área inteira | 1 de 47 |
| Seus ex-clientes fora da área | observador.foraDaArea, com a maior cidade nomeada — sempre da área inteira | 944 (895 em Ibiporã · 49 noutras · 294 na área) |

Os dois lados de cada conta vivem no MESMO universo da rede (ex-cliente com
dívida e com bairro no cadastro); por isso o 294 "seus" pode ficar abaixo do
que a carteira própria mostra para a mesma cidade.

Os chips do modo Rede vêm de `cidades[]` (a área declarada que o servidor usou)
e contam o que o mapa desenha; cidade sem bolha é dita em texto, nunca vira
chip — e a cidade com massa própria fora da área (Ibiporã) é nomeada com o
número e o caminho para a Regionalização. A tela não estende a área sozinha:
é a área declarada que autoriza ver dado de terceiros numa praça, e declarar
é decisão do provedor.

Escondidos no modo Rede: seletor de carteira, faixa de plotagem, diagnóstico de
endereços, selo "ERP · data" e o rodapé de cidades sem cliente. A função pura
é `kpisDaRede` em `client/src/components/localizacao/metricas.ts`; a medição,
`script/medir-rede.ts`. O que o payload ganhou, e os três achados de LGPD que
ficaram como decisão do dono, estão em `docs/mapa-da-rede-SEGURADO.md`.
