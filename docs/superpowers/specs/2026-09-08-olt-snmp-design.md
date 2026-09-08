# Coletor de OLT por SNMP — design

**Data:** 2026-09-08
**Status:** desenho, com três decisões do dono tomadas e uma pendente
**Pedido:** *"precisamos acessar a olt, ler via snmp os equipamentos que estão nela, cruzar o
mac de cada ont/onu da olt com o mac da conexão do cliente. se o mac estiver em 2 clientes,
manter o cliente que estiver o cadastro mais recente de autenticação."*

---

## 1. O achado que muda o desenho: cruza-se por SERIAL, não por MAC

O pedido diz "cruzar o MAC da ONU com o MAC da conexão". **Os dois MACs são de camadas
diferentes, e na maioria das OLTs o primeiro nem existe.**

**Levantamento de nove fabricantes, cada ficha refutada por um segundo leitor que baixou a
MIB e conferiu OID por OID:**

| Fabricante | Serial da ONU | MAC da ONU | Confiança |
|---|---|---|---|
| Huawei (MA5600T/MA5800) | **sim** | **NÃO** — só `MacCount` | alta |
| ZTE (C300/C320/C6xx) | **sim** | **NÃO** | alta |
| Nokia (ISAM 7360/7362) | **não confirmado** | não | média |
| Fiberhome (AN5516) | **sim** | sim | alta |
| V-Solution (V1600G) | **sim** | não | alta |
| Parks (Fiberlink) | **sim** | sim | alta |
| CDATA (FD16xx GPON) | **sim** | sim | alta |
| TP-Link (DeltaStream) | **sim** | sim | alta |
| Furukawa/Lightera 3508/3516 | **sim** | **NÃO** | alta |
| Furukawa/Lightera LightDrive | sim | sim | média |

**Oito dos nove expõem o serial. Só cinco expõem MAC — e Huawei e ZTE, os dois mais comuns
no Brasil, não expõem.** Em GPON a ONT é identificada pelo serial (padrão ITU-T G.984.3:
4 bytes ASCII de vendor + 4 bytes binários), e é isso que a OLT tem para dar.

Do outro lado, o MAC que o RADIUS registra é o de **quem autentica no PPPoE** — com a ONU em
bridge, é o roteador do assinante, não a ONU.

**Prova no nosso próprio repositório** (`server/erp/connectors/mk-conexoes.test.ts`, fixture
tirada da NsLink): a mesma conexão tem `login: ALCLFC65623D-000`, `mac: 64DBF7ED1D24` e
`serial: ALCLFC65623D`. O serial casa com a OLT; o MAC não.

> **Decisão de desenho:** a chave do cruzamento é o **SERIAL**. O MAC entra como reforço
> quando os dois lados o tiverem. `serialDeOnuMk()` já extrai o serial do login FTTH do MK, e
> `cruzarIdentificadores()` já aceita serial e MAC juntos.

Consequência prática: nas OLTs sem MAC (Huawei, ZTE, Furukawa 3508/3516), **serial é a única
chave** — não há reforço nenhum, e um serial que não casa é `nao_localizado`, não "aparelho de
outro cliente".

---

## 2. Decisões do dono (08/09/2026)

| # | Pergunta | Resposta | O que decorre |
|---|---|---|---|
| 1 | Fabricantes | Nokia, Fiberhome, ZTE, Huawei, V-Solution, Parks, CDATA, TP-Link, Furukawa | Nove dialetos de MIB. Precisa de registry por fabricante com marca `naoImplementado`, igual ao dos ERPs. |
| 2 | A senha SNMP fica no nosso banco? | **Só no coletor** | Nosso banco não guarda community, host nem alvo. **Nunca dizemos ao coletor o que varrer.** |
| 3 | O dado da OLT vale como bureau? | **Só inventário interno** | Não entra no score que outro provedor lê. Trava testável, no molde do `sem-importacao-manual`. |
| 4 | Autoriza as tabelas novas? | **pendente** | Sem isso o coletor não tem onde gravar. |

### O que a decisão 2 elimina

A apuração tinha levantado como risco: *"se a credencial ficar aqui, viramos o depósito da
senha de leitura de OLT de dezenas de provedores"* e *"um admin comprometido do nosso lado
manda o coletor varrer a rede interna do provedor por nós"*.

Com a credencial **e o alvo** morando no coletor, os dois riscos somem juntos: não há o que
roubar do nosso lado, e não há como mandar o coletor escanear nada. **O coletor só empurra o
que leu.** A rota de ingestão é *write-only* — o coletor não lê nada nosso.

### O que a decisão 3 elimina

O risco de "inventário forjado entre tenants": a regra *"fica o cadastro mais recente"*
significa que **quem escreve por último ganha o cliente**. Se o dado da OLT não vale para o
bureau, um coletor comprometido não consegue reivindicar aparelho de outro provedor nem
limpar a ficha de ninguém na rede — o estrago fica dentro do próprio provedor.

Continua valendo a trava existente: `mac`, `serialNumber`, `model` e `assetTag` estão em
`STRIPPED_FIELDS` de `server/services/lgpd-masking.ts` e nunca cruzam tenant.

---

## 3. Arquitetura que decorre

```
  rede do provedor                        │        nós
  ─────────────────────────────────────── │ ────────────────────────────
  OLT ──SNMP v2c (RO)──> coletor          │
     (community e host só aqui)   │       │
                                  └─HTTPS─┼──> POST ingestão (write-only)
                                          │      chave por INSTALAÇÃO
                                          │      provider_id vem da chave
                                          │      corpo NUNCA diz o provedor
```

**Padrão de autenticação:** o que já existe e está testado —
`server/routes/chat-bullq-agente.routes.ts`: chave por máquina no header, só o SHA-256
guardado, índice único, `timingSafeEqual`. **Não** usar `providers.webhook_token`, que está em
texto puro, sem consumidor, e anuncia uma rota (`/api/webhooks/erp-sync`) que não existe.

**Diferença obrigatória em relação ao chat:** a chave lá é **por provedor**; aqui tem que ser
**por instalação** — um provedor tem uma OLT por POP e precisa poder revogar uma sem derrubar
as outras. E a chave é de **escrita apenas**: um coletor roubado não pode baixar carteira.

**Falta no padrão atual, e aqui importa:** o webhook do chat assina só o corpo, sem timestamp
nem nonce — um lote capturado pode ser reenviado, e para inventário isso ressuscita ONU já
retirada. A assinatura do coletor precisa de janela de tempo.

---

## 4. Armadilhas por fabricante (todas verificadas em fonte primária)

**A classe de falha que se repete em sete dos nove: o walk na árvore errada volta VAZIO, sem
erro.** O operador conclui "a OLT não tem ONU". É a mesma falha silenciosa que já custou caro
aqui — a leitura vazia do IXC que zerou a dívida dos ativos da NG em 31/08.

> **Regra inegociável do coletor:** leitura vazia **nunca** apaga inventário. Só uma leitura
> comprovadamente completa pode marcar ONU como sumida.

- **Duas árvores incompatíveis no mesmo fabricante:** ZTE (`3902.1012` vs `3902.1082`),
  Furukawa (`10428.9` vs `10428.10.2`), VSOL (EPON `.5.12` vs GPON `.6.1`), CDATA (três
  árvores), TP-Link (normal `6.100` vs easy `6.107`).
- **CDATA FD1104/1108/1216 são EPON, não GPON.** Em EPON não existe serial — a ONU é MAC.
  Procurar serial numa FD1108 devolve vazio.
- **Huawei/ZTE/Parks: o serial são 8 bytes binários**, não ASCII. A conversão certa é
  `ascii(bytes[0:4]) + hex(bytes[4:8]).upper()`. Decodificar os 8 como ASCII dá lixo; hex dos
  8 dá a forma de 16 dígitos, que não casa com o ERP.
- **Fiberhome: o serial vem no campo chamado `MAC`.** Um parser que trate `authOnuListMac`
  como MAC de 6 bytes corrompe o serial em silêncio.
- **Furukawa: o enum de status é invertido entre as duas famílias.** LightDrive `2 = active`;
  3508/3516 `2 = activationPending`. Um mapa só marca ONU ativa como inativa.
- **TP-Link: o OID do serial mudou entre firmwares** (coluna `.4` no 1.0.x; entrou `omSlotId`
  no 1.1.0 e o índice mudou).
- **Nokia: o walk completo de `.1.3.6.1.4.1.637` dá timeout** em 7360 FX. Para Nokia a via
  principal provavelmente é CLI por SSH, não SNMP.
- **Índice composto em todos.** Nunca é um inteiro: é `<ifIndex da PON>.<ontId>`, e o ifIndex
  costuma ser empacotado por aritmética de bits (Huawei: `(125<<25)+(F<<19)+(S<<13)+(P<<8)`).
- **Sinal óptico é inteiro positivo representando dBm negativo** (Parks `2045 = -20,45 dBm`;
  Huawei `0.01 dBm`). Aplicar o sinal errado publica "+20 dBm" e o operador conclui que a rede
  está ótima.
- **SNMP vem desligado de fábrica** na Furukawa (as duas famílias) — pré-requisito
  operacional, como o IP liberado no IXC.

---

## 5. O que falta antes de escrever código

1. **O sim das tabelas** (decisão 4). O mínimo são duas, e nenhuma guarda credencial:
   - leitura de ONU por instalação (serial, MAC quando houver, PON, sinal, modelo, visto_em)
   - conexão/MAC por cliente — **hoje o MAC do cliente não é persistido em lugar nenhum**
2. **Persistir o MAC/serial de conexão.** Já está meio caminho: `cadastradaEm` e `conexaoId`
   passaram a ser lidos em 08/09/2026 (commit `6bdac79`) — eram descartados e são o que a
   regra de desempate exige. Falta onde gravar.
3. **Medir antes de construir.** A base para cruzar está quase vazia: **324 linhas de
   `equipment` para 33.239 clientes**. E o SGP apaga o MAC ao cancelar (0 de 327 encerrados o
   têm) — justo o ex-cliente de quem se quer a ONU.
4. **Primeira rodada só relatório**, sem escrever nada — como a régua de cobrança fez quando
   abriu 7.196 casos sem notificar ninguém.

### Build vs buy, que ainda não foi posto na mesa

Se a NsLink ou a Amplinet já pagam **SmartOLT** ou têm **Zabbix**, consumir a API deles entrega
ONU + serial + sinal **sem escrever nove dialetos de MIB e sem colocar um coletor novo dentro
da rede do cliente**. Vale perguntar antes de construir.

---

## 6. O que NÃO existe (verificado, não presumido)

- **Não há coletor de OLT no Provedor.ai.** `services/noc-ingester/` é um README de uma linha;
  `.planning/noc/` está marcado *OBSOLETO · futuro*. O que funciona lá com MK é a leitura do
  MAC por cliente via webservice — e o Consulta ISP já está à frente nisso.
- **Não há uma linha de SNMP no Consulta ISP** — só comentários antecipando esta fase.
- **`WSMKConexoesPorClienteV2`**, nomeada na decisão de 05/09 como fonte do MAC, está **medida
  como HTTP 500 na NsLink**. Quem responde é a V1, que já usamos.
