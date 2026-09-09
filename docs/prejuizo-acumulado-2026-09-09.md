# Prejuízo acumulado — o card da Economia do cliente somada por período (09/09/2026)

Pedido do dono: *"um card que mostre os valores de prejuízo acumulado que os
clientes ou ex-clientes [dão] baseado na economia do cliente; com filtro por
seleção de mês, acumulado por trimestre, semestre e anual. Esses dados de
economia do cliente não estão sendo calculados em ex-clientes."*

Desenhado por um painel de três propostas + juiz, com cada item verificado por
três céticos contra `computeEconomiaLedger` e a base real. As correções que os
céticos pediram estão todas aqui (fuso do `due_date`, regra de evidência da
mensalidade, duas datas com nomes distintos, população = predicado do KPI,
clique nos dois espaços).

## Onde está

Nos dois espaços de `client/src/pages/cobranca/carteira.tsx`, uma faixa no molde
da Realidade mensal, logo abaixo da Composição da carteira (e da faixa do mês,
em ativos). Seletor **Mês · Trimestre · Semestre · Ano** + ‹ › — `set/26`,
`T3/26`, `S2/26`, `2026` (`shared/cobranca/periodo.ts`). O período viaja na URL
(`?periodo=2026-T3`) de cada espaço — o botão "Limpar" da lista o preserva;
a troca de espaço pela sidebar abre a URL do outro espaço (mês corrente). O
clique no bloco principal
liga `prejuizo=1` e filtra a lista pelos devedores do período — mutuamente
exclusivo com o chip do mês (o servidor recusa os dois).

## O que o número é

Por cliente, **nada novo**: o lucro acumulado do ledger (R24) quando negativo —
`max(0, −lucro_acumulado)`. O card decompõe a partir dos próprios campos do
ledger (`shared/cobranca/prejuizo.ts`):

```
sobra                   = max(0, lucro_acumulado + inadimplencia_aberta)
abatida                 = min(inadimplencia_aberta, sobra)
instalacaoNaoRecuperada = max(0, −(lucro_acumulado + inadimplencia_aberta))
prejuizo                = dividaAvaliada + instalacaoNaoRecuperada − abatida
```

Identidade exata nos dois regimes; derivar de `lucro_acumulado` em vez de
recomputar `investimento − margem × meses` evita a divergência de centavos
(`margem_mes` sai arredondado; 530,03 onde o ledger dá 530,07). Modo "recebida"
(pagamento real sincronizado) tem ramo próprio: o ledger não subtrai a dívida.

**Quem entra:** só devedor — `total_overdue_amount > 0` na carteira, o mesmo
predicado do KPI "Vencido" (`comDivida`, agora exportado). Cliente em dia no
mês 6 tem investimento por recuperar, mas isso é payback em curso, não
prejuízo.

**Os três números na tela:** o principal (Σ prejuízo dos avaliados, com a
cobertura `· 17 de 21` na mesma linha e o selo "≈ parâmetros padrão" enquanto
a Política não estiver confirmada), a **dívida real do recorte segundo o ERP**
(sempre, nunca "—" para quem deve) e a instalação/aquisição não recuperada.
Quem ficou de fora aparece por motivo — o mesmo texto que o 360 escreve em
`economiaPendente`.

## O eixo do período

O cliente cai no mês em que **deve desde**: o vencimento da fatura vencida mais
antiga que o ERP mantém aberta — dado gravado, o mesmo `vencimentoMaisAntigo`
do 360. **Não é** data de cancelamento (`cortado_em` é NULL em todos os
cancelados do MK; só o SGP preenche) nem prova de quando "parou de pagar". O
kicker diz "devem desde"; o `title` explica. Devedor sem fatura vencida gravada
vai ao balde **"sem data"**, visível — nunca uma data inventada
(`hoje − dias de atraso` é proibido pela regra de integridade).

"Acumulado" é a soma **dentro da janela** do resultado de vida inteira de cada
um, como está hoje: o período escolhe QUEM. Invariantes testadas: mês + mês +
mês = trimestre; Σ períodos + sem data = KPI Vencido.

**Fuso:** `due_date` é meia-noite UTC. A janela vai ao SQL como dia em texto
(`janelaDoPeriodoEmDias` + `ts()`), as datas voltam como `to_char(...,
'YYYY-MM-DD')`, e a atribuição ao período é feita em texto — zero `getMonth()`
sobre `due_date`.

## Servidor

`GET /api/cobranca/carteira/prejuizo?carteira=ativo|ex_cliente&periodo=…`
(`server/routes/cobranca.routes.ts`, `prejuizoDaCarteira`). Quatro leituras,
nenhuma por cliente: `devedoresComVencimento` (a população do KPI com as duas
datas), a política, `baseDeFaturas` (live/atualizadoEm) e
`mensalidadesDoProvedor(providerId, ids)` — a moda **só dos devedores**, não da
tabela toda. O ledger roda em Node pelo mesmo `economiaDoCliente` da ficha.

## O que mudou no 360 (e por quê)

O gate da Economia saiu de `montarFicha360` para `economiaDoCliente`
(`shared/cobranca/ficha360.ts`) — uma fórmula, um gate, dois consumidores; o
card é a soma das fichas do servidor por construção. Dois erros que o print do
dono já mostrava foram corrigidos de passagem:

1. **"MRR R$ 2.924,66" era o saldo.** A mensalidade observada é a moda das
   faturas do ERP; ex-cliente com dívida tem, em 97% dos casos, UMA fatura
   aberta e ela é o saldo consolidado do cancelamento. Regra de evidência:
   ex-cliente só tem mensalidade observada com ≥ 2 faturas concordantes e ≥ 1
   `baixada_no_erp` (valor PAGO repetidas vezes). Para quem está vivo a fatura
   aberta é a mensalidade do mês (moda R$ 89,90 ×177) — regra de hoje.
2. **A permanência do ex-cliente ia até hoje.** O fim do ciclo agora é o que o
   ERP provou: `cortado_em` ?? a última fatura emitida
   (`ultimaFaturaEmitidaEm`, o `vencimentoMaisRecente` de `faturasDoCliente`).

## Por que o card de ex-clientes abre com "—" — e o que destrava

Hoje, para 100% dos ex-clientes, a Economia é PENDENTE por **um** motivo: o
gate `situacaoReal === "ex-cliente" && !historicoPagamento` — o produto decidiu
(05/09) não projetar para ex-cliente, só realizado; e realizado não existe
(nunca houve fatura `paid` na base; `cobranca_quitacoes` tem 0 linhas). O card
nasce honesto: "—" com o motivo no principal e, ao lado, **a dívida deixada por
período segundo o ERP** — o churn com dívida em reais, que nenhuma tela
mostrava.

Três decisões do dono, em ordem de custo:

1. **Aceitar projeção para ex-cliente** (abrir o gate com o selo "projeção ·
   assume pago até a última fatura"). Recomendação: sim — "realizada" não
   existe para ninguém e a Economia dos ativos já é projeção; a honestidade
   fica no rótulo. A ordem de implementação já está garantida: a regra de
   evidência e o fim do ciclo entraram ANTES, então abrir o gate não produz
   número inventado.
2. **Autorizar `customers.contract_plan`** (texto, nulo; migração aditiva) —
   o MK já lê o nome do plano e o upsert descarta. Sem ela os 1.198 ex-clientes
   com fatura única não têm ARPU nunca; com ela o admin cadastra o preço por
   nome em Política > Economia. Recomendação: sim.
3. **Ler faturas pagas do ERP** (chamadas a mais por varredura, volume em
   `invoices`) — o único caminho para número sem selo. Recomendação: não
   agora; primeiro 1 e 2, e medir o volume numa varredura de teste.

Sem a 1, o principal dos ex-clientes fica "—" para sempre; sem a 2, só o churn
NOVO (faturas mês a mês vistas pelo sync desde a 0027) se preenche.

## Atualização — 09/09/2026, mais tarde (migração 0036)

O item 3 da lista acima ("ler faturas pagas do ERP") **foi feito**: IXC e SGP em
lote, MK pela API licenciada (pendente de liberação pela MK Solutions). Com fatura
paga sincronizada o ex-cliente entra no card pelo **resultado do contrato**, e o
360 mostra Recebido · Saldo devedor · Ponto de equilíbrio. Tudo em
`docs/faturas-pagas-0036-2026-09-09.md`.
