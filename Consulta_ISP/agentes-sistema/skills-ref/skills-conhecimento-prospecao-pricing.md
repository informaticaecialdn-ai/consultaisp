# Base de Conhecimento: Prospecao de Leads e Estrategia de Pricing

> Referencia para CARLOS (SDR), LUCAS (closer), RAFAEL (consultor) e SOFIA (estrategia). Extraido e adaptado de skills MIT (aitmpl.com).

---

## CARLOS — Pesquisa e Qualificacao de Leads

### Framework de Pesquisa de Leads para ISPs

**Etapa 1: Entender o ICP (Ideal Customer Profile)**
- Setor: Provedores de internet (ISPs regionais e locais)
- Tamanho: 500 a 50.000 assinantes
- Localizacao: Brasil, com foco em regioes com alta densidade de ISPs
- Dores primarias: Inadimplencia alta, analise de credito manual, perda de receita
- Stack tecnologico: ERPs de ISP (MK Solutions, IXC Soft, SGP, Hubsoft), billing, CRM
- Estagio: ISPs em crescimento ou consolidacao

**Etapa 2: Sinais de Compra (Triggers)**
| Sinal | Onde encontrar | Como usar |
|-------|---------------|-----------|
| Expansao de cobertura | Site, redes sociais, Anatel | "Vi que estao expandindo para [cidade]" |
| Alta inadimplencia reportada | Comunidades ISP, foruns | "Muitos ISPs nessa fase enfrentam [problema]" |
| Contratacao de equipe financeira | LinkedIn | "Notei que estao estruturando a area financeira" |
| Troca de ERP/billing | Comunidades | "Vi que migraram para [sistema] — boa hora para otimizar credito" |
| Crescimento de base >20%/ano | Anatel, noticias | "Parabens pelo crescimento — geralmente isso aumenta inadimplencia" |
| Postagem sobre desafios | LinkedIn, Instagram | Referencia direta ao conteudo |
| Participacao em eventos ISP | Abrint, encontros regionais | Contexto de networking |

**Etapa 3: Priorizacao de Leads (Fit Score 1-10)**
Criterios de pontuacao:
- Tamanho da base (500-5k: 6pts, 5k-20k: 8pts, 20k+: 10pts)
- Inadimplencia estimada (>5%: +2pts, >8%: +3pts)
- Sinal de compra identificado: +2pts
- Decisor acessivel no LinkedIn: +1pt
- Usa ERP integravel: +1pt
- Regiao com alta densidade ISP: +1pt

**Etapa 4: Estrategia de Contato por Lead**
Para cada lead priorizado, definir:
- **Decisor-alvo**: Cargo ideal (dono/socio, diretor financeiro, gerente comercial)
- **Canal primario**: Email, LinkedIn, WhatsApp, telefone
- **Angulo de abordagem**: Qual dor especifica atacar baseado nos sinais
- **Proposta de valor personalizada**: Como Consulta ISP resolve o problema especifico deles
- **Conversation starters**: 2-3 pontos especificos para mencionar na abordagem

### Template de Output de Pesquisa
```
## Lead: [Nome do ISP]
**Site**: [URL]
**Fit Score**: [X/10]
**Base estimada**: [assinantes]
**Regiao**: [cidade/estado]
**ERP**: [sistema]
**Decisor**: [Nome, Cargo]
**LinkedIn**: [URL]

**Por que e um bom lead**:
- [Razao 1 baseada em sinais]
- [Razao 2]

**Estrategia de abordagem**:
- Canal: [email/LinkedIn/WhatsApp]
- Angulo: [dor especifica]
- Mensagem-chave: [1 frase de valor]

**Conversation starters**:
1. [Ponto especifico 1]
2. [Ponto especifico 2]
```

---

## LUCAS + RAFAEL + SOFIA — Estrategia de Pricing SaaS

### Fundamentos de Pricing B2B SaaS

**Os 3 Eixos de Pricing:**
1. **Packaging** — O que esta incluido em cada plano (features, limites, suporte)
2. **Metrica de Valor** — Pelo que voce cobra (por usuario, por consulta, por assinante)
3. **Ponto de Preco** — Quanto voce cobra (o valor em reais)

**Pricing Baseado em Valor (nao em custo):**
- Valor percebido pelo cliente (quanto inadimplencia reduz) = teto
- Seu preco = captura parcial desse valor
- Melhor alternativa (analise manual, planilha) = piso
- Seu custo de servir = referencia minima

### Metrica de Valor para Consulta ISP
A metrica ideal deve escalar com o valor entregue:
- **Por assinante analisado**: Escala com a base do ISP, alinha com valor
- **Por consulta de credito**: Pay-per-use, baixa barreira de entrada
- **Por usuario da plataforma**: Simples, previsivel, mas nao escala com valor
- **Flat fee + uso**: Base fixa + excedente por volume

**Recomendacao**: Hibrido — mensalidade base por faixa de assinantes + consultas inclusas. Excedente por consulta adicional.

### Estrutura de Tiers (Good-Better-Best)

| | Starter | Pro | Enterprise |
|--|---------|-----|-----------|
| **Para quem** | ISPs ate 2.000 assinantes | ISPs 2.000-15.000 | ISPs 15.000+ |
| **Consultas/mes** | 500 | 3.000 | Ilimitado |
| **Usuarios** | 3 | 10 | Ilimitado |
| **Integracao ERP** | 1 sistema | 3 sistemas | Custom |
| **Relatorios** | Basico | Avancado | Custom + BI |
| **Suporte** | Email | Prioritario | Dedicado |
| **SLA** | — | 99.5% | 99.9% |
| **API** | Nao | Sim | Sim + webhooks |
| **SSO** | Nao | Nao | Sim |
| **Onboarding** | Self-service | Guiado | Dedicado |

### Pesquisa de Pricing (Van Westendorp)
Perguntas para pesquisa com ISPs:
1. "A que preco mensal voce consideraria [Consulta ISP] tao caro que nao compraria?"
2. "A que preco voce acharia tao barato que questionaria a qualidade?"
3. "A que preco comeca a ficar caro mas voce ainda consideraria?"
4. "A que preco voce acharia que e uma barganha?"

Interpretar:
- PMC (Marginal Cheapness): "Muito barato" cruza com "Caro"
- PME (Marginal Expensiveness): "Muito caro" cruza com "Barato"
- OPP (Optimal Price Point): "Muito barato" cruza com "Muito caro"
- IDP (Indifference Price Point): "Caro" cruza com "Barato"
- Faixa aceitavel: PMC ate PME

### Freemium vs Free Trial para Consulta ISP
**Free Trial (recomendado para B2B SaaS de nicho):**
- 14 dias de acesso completo
- Sem cartao de credito obrigatorio (para volume)
- Com limite de consultas (50 consultas no trial)
- Onboarding guiado com checklist
- Countdown + reminders nos dias 7, 10, 12, 14
- Trial-to-paid conversion meta: 15-25%

**Por que nao Freemium:**
- Mercado de ISPs e finito (~15.000 ISPs no Brasil)
- Custo de servir consultas de credito nao e zero
- B2B SaaS de nicho se beneficia mais de trials bem executados

### Quando Aumentar Precos
**Sinais:**
- Taxa de conversao >40% (preco esta baixo demais)
- Churn <3% mensal (clientes acham que vale muito mais)
- Feedback "e muito barato para o que entrega"
- Adicionou features significativas desde ultimo ajuste
- Competidores cobrando mais

**Estrategias de aumento:**
1. **Grandfather**: Clientes existentes mantem preco antigo. Novo preco so para novos.
2. **Aumento programado**: Aviso com 3 meses de antecedencia. Oferta de lock-in anual.
3. **Tied to value**: Novo plano com features adicionais justifica o aumento.
4. **Reestruturacao**: Mudar planos inteiramente. Mapear clientes para o mais proximo.

### LUCAS — Handling de Objecoes de Preco

**"Esta caro":**
→ Ancorar no custo da inadimplencia: "Quanto voces perdem por mes com inadimplencia? Se sao R$X, nosso investimento de R$Y se paga em [prazo]."
→ Comparar com alternativa: "Uma analista dedicada custaria R$3-5k/mes sem contar encargos. Consulta ISP custa uma fracao."

**"O concorrente e mais barato":**
→ Explorar diferenciacao: "O que exatamente eles incluem nesse preco?"
→ TCO (Total Cost of Ownership): "Alem do preco mensal, considere integracao, suporte, tempo de implementacao."

**"Preciso de desconto":**
→ Trocar por compromisso: "Posso oferecer [X]% se fecharmos com contrato anual."
→ Remover escopo: "Podemos ajustar o plano — qual feature voce abriria mao?"

**"Vou pensar" (sobre preco):**
→ Identificar o real bloqueio: "Entendo. O que especificamente voce precisa avaliar?"
→ Criar urgencia genuina: "Temos a implementacao disponivel para comecar [data]. Se fecharmos ate [prazo], consigo incluir [bonus]."

### RAFAEL — Pricing em Propostas Consultivas

**Estrutura de proposta com pricing:**
1. Resumo do diagnostico (dores identificadas)
2. Solucao proposta (features e configuracao)
3. ROI estimado (reducao de inadimplencia projetada)
4. Investimento (preco com context de valor, nao isolado)
5. Opcoes (2-3 planos para dar sensacao de escolha)
6. Proximos passos e timeline

**Psicologia de pricing em propostas:**
- Anchoring: Mostrar o plano mais caro primeiro
- Decoy effect: O plano do meio deve ser obviamente o melhor custo-beneficio
- Contexto de valor: Sempre apresentar preco ao lado do ROI estimado
- Opcoes: 3 opcoes (evitar paralysis com mais de 4)

### SOFIA — Metricas de Pricing

| Metrica | Formula | Meta |
|---------|---------|------|
| ARPU | MRR total / Clientes ativos | Crescente MoM |
| ACV | Valor medio de contrato anual | >R$15.000 |
| Conversion Rate | Trials convertidos / Total trials | >20% |
| Expansion Revenue | Upsells + cross-sells / MRR | >10% MRR |
| Price Sensitivity | Churn apos aumento / Total afetados | <5% |
| Discount Rate | Deals com desconto / Total deals | <30% |
