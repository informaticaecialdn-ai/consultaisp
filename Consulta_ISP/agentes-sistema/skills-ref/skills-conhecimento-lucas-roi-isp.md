# LUCAS — ROI Calculator ISP (playbook)

Skill pra calcular e comunicar ROI do Consulta ISP na conversa com lead.
Framework: inadimplencia evitada x custo plano. Todos os numeros refletem
market BR medio em 2026.

---

## Numeros de referencia (mercado ISP BR)

Use estes como base quando lead nao fornece proprios dados:

| Metrica | Valor medio | Fonte |
|---------|-------------|-------|
| % inadimplencia/ano (ISP pequeno <500 clientes) | 3-5% | Obs mercado |
| % inadimplencia/ano (ISP medio 500-2000) | 2-4% | Obs mercado |
| % inadimplencia/ano (ISP grande 2000+) | 1.5-3% | Obs mercado |
| Ticket medio residencial fibra | R$ 89-149/mes | Anatel 2025 |
| Custo equipamento (ONT+router) | R$ 250-500 | Catalogo 2025 |
| Custo instalacao | R$ 150-300 | Tecnico + material |
| Perda por calote (mensalidades + equip + instal) | R$ 690 medio | Somatoria |
| Calote que Serasa NAO detecta | 30-40% | Nao tem divida formal |

---

## Formula simplificada (pra falar com lead)

```
Perda anual SEM Consulta ISP =
  (num_clientes) x (% inadim/ano) x R$690 por calote

Perda com Consulta ISP (reduz 40%) =
  Perda anual x 0.6

Economia anual =
  Perda anual x 0.4

Payback (meses) =
  (plano mensal) / (economia mensal)
```

---

## Exemplo real — ISP 800 clientes

```
num_clientes = 800
% inadim/ano = 3% = 24 calotes/ano
perda_atual = 24 × R$690 = R$16.560/ano

plano_recomendado = Profissional R$349/mes = R$4.188/ano
reducao_40% = R$16.560 × 0.4 = R$6.624/ano economizado

resultado_ano1 = R$6.624 - R$4.188 = R$2.436 de economia liquida ANO 1
payback = 7 meses

Mensagem WhatsApp (Lucas):
> Fiz a conta rapida com seus 800 clientes: se seu % de inadimplencia bate
> na media do mercado (3%), voce perde uns R$16k/ano so em calotes. Nosso
> plano Profissional custa R$349/mes e reduz isso em ~40%, ou seja,
> economia de R$2.4k no primeiro ano ja descontado o plano. Payback 7 meses.
> Faz sentido pra voce?
```

---

## Exemplo — ISP pequeno 200 clientes

```
num_clientes = 200
% inadim/ano = 4% = 8 calotes
perda_atual = R$5.520/ano

plano = Basico R$149/mes = R$1.788/ano
reducao_40% = R$2.208/ano

resultado_ano1 = R$2.208 - R$1.788 = R$420 economia liquida
payback = 14 meses (apertado)

Mensagem Lucas:
> Com 200 clientes voce ta no limite entre Gratuito e Basico. Gratuito da
> 30 consultas/mes — no ritmo de instalacoes novas que voce faz, cobre?
> Se cobrir, comeca gratis, ve o resultado, e sobe pro Basico só quando
> sentir que aperta.
```

---

## Exemplo — ISP enterprise 5000 clientes

```
num_clientes = 5000
% inadim/ano = 2% = 100 calotes
perda_atual = R$69.000/ano

plano = Enterprise R$690/mes = R$8.280/ano
reducao_40% = R$27.600/ano

resultado_ano1 = R$19.320 economia liquida
payback = 3.6 meses
ROI ano 1 = 333%

Mensagem Lucas:
> No seu porte (5mil clientes), conta simples: 2% de inadim media = 100
> calotes/ano ≈ R$69k perdidos. Enterprise reduz 40% = R$27k recuperados.
> Desconta o plano de R$8k/ano e sobra R$19k liquidos no ano 1. Payback
> de ~3 meses. Agendo uma call de 15min pra voce conhecer o time tecnico?
```

---

## Quando o lead DÁ os numeros dele

Sempre preferir usar OS DADOS DELE. Pergunte direto:

> "Voce tem ideia de quantos casos de inadimplencia voce tem por mes? Ou
>  o prejuizo medio?"

Se ele diz "tenho uns 10 calotes por mes", use isso:
```
10 × 12 = 120 calotes/ano
120 × R$690 = R$82.800/ano perdidos

Plano Profissional R$349 → R$4.188/ano
Reducao 40% = R$33.120/ano economia
Liquido ano 1 = R$28.932

Payback: <1 mes
```

---

## Regras de comunicacao

1. **Sempre conta com nome do lead** ("voce perde", nao "empresas perdem")
2. **Numeros redondos** quando nao souber: R$690 medio por calote, 40% reducao
3. **Payback em meses, nao em %** (dono de ISP pensa em fluxo de caixa)
4. **Plano recomendado = proporcional ao porte**, nao empurra Enterprise
   pra lead pequeno
5. **Honesto nos limites** — se ISP pequeno tem payback de 14 meses, fala.
   Nao mente que e 3 meses.

---

## Objecoes especificas sobre ROI

### "A reducao e mesmo 40%?"
Resposta: "40% e nossa media em provedores com >6 meses. Primeiro mes
pode ser menor (base ainda carregando). Posso te mostrar dashboard real
de um cliente da sua regiao?"

### "E se eu contratar e nao der ROI?"
Resposta: "Plano e mensal, cancela a hora que quiser. Se em 60 dias voce
nao ver valor, cancela e ta tranquilo. Nao tem fidelidade."

### "Seus concorrentes cobram mais barato"
Resposta: "Qual concorrente voce ta olhando? Se for base genérica tipo
Serasa, preco e diferente porque servico e diferente. Se for outro
colaborativo de ISP, me passa que comparo."

---

## Tools relevantes

- `query_lead_detail` pra pegar num_clientes salvo
- `enrich_lead({num_clientes, porte, valor_estimado})` quando descobrir
- `create_proposal({plano, valor_customizado, roi_resumo})` com roi_resumo
  contendo o calculo feito acima
- `handoff_to_agent(rafael)` quando lead aceita a proposta em principio
