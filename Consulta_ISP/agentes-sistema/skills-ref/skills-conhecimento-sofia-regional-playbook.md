# SOFIA — Playbook de Conquista Regional (Mesorregiao por Mesorregiao)

Skill CORE pra Sofia. O produto Consulta ISP e uma **base colaborativa regional**
de inadimplencia entre provedores. Valor = densidade na regiao.
Prospectar ISPs espalhados pelo Brasil NAO funciona — migracao serial de
cliente inadimplente e LOCAL (cliente de Londrina vai pra Maringa, nao pra
Curitiba). Estrategia: **conquistar 1 mesorregiao IBGE por vez**, nao espalhar.

---

## Por que regionalizar importa (fundamento do negocio)

**Migracao serial de calote = fenomeno local.** Cliente que calota em um ISP
da Norte Central Paranaense vai contratar OUTRO ISP da mesma regiao (Maringa,
Apucarana, Londrina estao a 40-80km uns dos outros). Nunca vai pra Curitiba
(400km+).

Logo, a base colaborativa de dados de inadimplencia so tem valor REAL quando
temos **cobertura densa** numa mesorregiao. Com 1 ISP num estado a base nao
detecta nada. Com 5 ISPs numa mesma mesorregiao, detecta 60-80% das migracoes.

Resumo: **1 estado x 10 ISPs espalhados < 1 mesorregiao x 5 ISPs densos.**

---

## Fases de conquista por mesorregiao

### Fase 1 — Scout (descoberta + dimensionamento)

Objetivo: entender quantos ISPs existem na regiao e quem lidera.

Acoes da Sofia:
- query_leads com filtro mesorregiao, conta total + quentes + ganhos
- Se ja tem leads, pedir pro Marcos analisar taxa de resposta na regiao
- Se NAO tem leads, prospector_auto vai rodar e trazer ~30-80 cidades

Criterio de avanco: ter ao menos 15-30 leads prospectados na mesorregiao.

### Fase 2 — Ancora (primeiros 2-3 ISPs)

Objetivo: fechar 2-3 clientes-ancora na regiao. Eles sao a prova social
pro resto da conquista.

Ideal: pegar os maiores/mais conhecidos (Lucas qualifica por num_clientes).

Pitch com ancora:
> "A [NomeDoAncora] ja topou. Voce seria o segundo provedor da regiao
>  norte central a entrar. Quer ser antes dos concorrentes?"

Acoes da Sofia:
- Identificar top 3 ISPs por porte (num_clientes ou rating Google)
- Delegar pro Carla/Lucas pra pitch VIP com desconto de pioneiro
- Uma vez fechado, usar nome (com autorizacao) nos proximos pitches

### Fase 3 — Snowball (densidade critica)

Objetivo: chegar em ~40% dos ISPs da mesorregiao (densidade minima pra
network effect funcionar).

Cold outbound padrao do Carla menciona:
> "Ja temos 5 provedores na [mesorregiao] — voce seria o 6o. A base
>  regional comeca a detectar calotes com esse volume."

Cada novo fechamento reforca o pitch: "agora somos 7, 8, 9...".

Acoes da Sofia:
- Monitorar cobertura via GET /api/regioes/cobertura
- Quando atingir 30% cobertura, liberar verba maior pra outbound na regiao
- Quando atingir 50%, iniciar marketing local (Meta Ads segmentado por municipio)

### Fase 4 — Saturacao + Proxima regiao

Objetivo: quando conseguiu 60-70% dos ISPs da mesorregiao, migrar esforco
pra proxima regiao adjacente (geografia importa — cliente migra pra regiao
vizinha quando esgota a atual).

Regioes adjacentes recomendadas:
- Norte Central Paranaense -> Noroeste Paranaense OU Norte Pioneiro Paranaense
- Sul de Minas -> Campo das Vertentes OU Vale do Paraiba Paulista
- Grande Porto Alegre -> Vale do Rio dos Sinos OU Vale do Jacui
- Metropolitana de Belo Horizonte -> Vale do Rio Doce OU Zona da Mata

Acoes da Sofia:
- Ativar prospector_config com a nova mesorregiao
- Nao desligar a anterior (continua captando 30-40% restante)
- Mensagem pra ancoras antigas: "agora estamos entrando em [nova regiao],
  os dados da [regiao antiga] ja ajudam voces"

---

## Selecao de mesorregioes iniciais (ICP — Ideal Customer Profile)

Criterios pra escolher a PRIMEIRA mesorregiao-alvo:

**Favoraveis:**
- Alta densidade de ISPs (>20 provedores pequenos/medios)
- Media de fibra optica >50% (tipo norte PR, interior SP, sul MG)
- Pouca concorrencia de Serasa/SPC local
- Cidade de referencia conhecida (Londrina, Ribeirao Preto, Pouso Alegre)
- Populacao entre 500k-2M (equilibra volume e atencao)

**Evitar (inicialmente):**
- Regioes metropolitanas muito grandes (Sao Paulo, Rio) - dominadas por grandes
  operadoras, ISPs pequenos nao representam o mercado
- Regioes Norte/Nordeste com baixa penetracao fibra
- Regioes com 1-2 ISPs dominantes (efeito rede nao se forma)

**Mesorregioes iniciais recomendadas (tier 1):**
1. Norte Central Paranaense (Londrina, Maringa, Apucarana)
2. Ribeirao Preto SP
3. Sul/Sudoeste de Minas (Pouso Alegre, Varginha, Pocos de Caldas)
4. Vale do Itajai SC (Blumenau, Itajai, Brusque)
5. Vale do Rio dos Sinos RS (Novo Hamburgo, Sao Leopoldo)

---

## KPIs por mesorregiao

Metricas que Sofia monitora (via query_leads + GET /api/regioes/cobertura):

| KPI | Alvo fase 2 (ancora) | Alvo fase 3 (snowball) | Alvo fase 4 (saturacao) |
|-----|----------------------|------------------------|-------------------------|
| Cobertura | 10% ISPs | 30% ISPs | 60% ISPs |
| Densidade absoluta | 2 clientes | 5 clientes | 10+ clientes |
| Taxa qualificacao | 15% | 20% | 25% |
| CAC regional | <R$800 | <R$500 | <R$300 |
| Tempo medio fechamento | 30d | 20d | 10d |

Quando CAC cai abaixo de R$300 e cobertura >60%, a regiao virou "self-propelling"
— novos ISPs entram porque concorrentes ja estao dentro.

---

## Comunicacao regional — frases pra Sofia delegar

### Pro Leo (Copywriter)
> "Leo, preciso de 3 variantes de cold cobrir a conquista da mesorregiao
>  [X]. Uma com foco em medo (migracao serial), uma em social proof
>  (N provedores ja), uma em urgencia (primeiros tem vantagem)."

### Pro Marcos (Midia paga)
> "Marcos, quando atingirmos 30% cobertura em [mesorregiao], ative
>  campanha Meta Ads segmentada pelos municipios dela. Objetivo: lead
>  inbound local. Budget inicial R$500/semana."

### Pro Carla (SDR)
> "Carla, no cold pra leads da mesorregiao [X], SEMPRE mencione quantos
>  provedores dessa regiao ja estao. Se ainda for <3, posicione como
>  'oportunidade pioneira'. Se for >5, posicione como 'network effect'."

### Pra Iani (caso precise reporte)
> "Iani, me passe o 3P da mesorregiao [X]: quanto prospectamos, quanto
>  qualificamos, quanto fechamos na ultima semana."

---

## Anti-padroes (o que NAO fazer)

- ❌ Prospectar por UF inteira ("todas ISPs de SP") — densidade dispersa
- ❌ Pegar 1 cliente em cada estado — pior caso possivel pra network
  effect
- ❌ Mesorregiao sem dados IBGE consistentes (ex: Distrito Federal so
  tem 1 municipio, nao funciona como mesorregiao tipica)
- ❌ Atacar 2 mesorregioes nao-adjacentes simultaneamente com mesma
  verba — divide esforco
- ❌ Pular Fase 2 (ancora) e ir direto pra outbound em massa —
  proof social e necessario
