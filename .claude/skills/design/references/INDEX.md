# Design References Index

Quick lookup pra escolher a brand de referencia certa.

## Resumo de cada brand (1 linha)

- **linear.md** — Dark-mode-native B2B SaaS. Achromatic + indigo. Ultra-minimal precision engineering. (367 linhas)
- **vercel.md** — Developer tools, infra dashboards. Dark refined com whites crisp + monospace. (310 linhas)
- **intercom.md** — Customer messaging, chat, suporte. Warm friendly conversational, blue brand. (146 linhas)
- **claude.md** — Produtos de IA, editorial premium. Parchment + serif Anthropic, terracotta accent. (312 linhas)
- **stripe.md** — Fintech, payments, B2B clean. Light-first profissional com gradients vivos. (322 linhas)

## Matriz de selecao

### Por industria

| Industria | Recomendacao primaria | Alternativa |
|---|---|---|
| SaaS B2B / CRM | linear | vercel |
| Developer tools | vercel | linear |
| Fintech / Payments | stripe | linear |
| Customer support / Chat | intercom | claude |
| AI / LLM products | claude | linear |
| E-commerce | stripe | intercom |
| Marketing site | claude | stripe |
| Admin panel | linear | vercel |
| Analytics dashboard | vercel | linear |
| Education platform | claude | intercom |

### Por estilo emocional

| Sensacao desejada | Brand |
|---|---|
| "Engineered, precise, no-bullshit" | linear |
| "Tech, dark, capable" | vercel |
| "Friendly, approachable, human" | intercom |
| "Editorial, warm, premium, thoughtful" | claude |
| "Clean, professional, trustworthy" | stripe |

### Por color mode

| Mode | Melhor opcao |
|---|---|
| Dark-only | linear |
| Dark-first com light support | vercel |
| Light-first com dark support | stripe, intercom |
| Light-only warm | claude |

### Por tipografia

| Familia | Brand |
|---|---|
| Geometric sans (Inter Variable) | linear |
| Standard sans + monospace pra code | vercel |
| Friendly rounded sans | intercom |
| Serif editorial + sans + mono custom | claude |
| Clean sans (system / Inter) | stripe |

### Por densidade

| Densidade visual | Brand |
|---|---|
| Maxima (info-dense, dashboards) | linear, vercel |
| Equilibrada (cards, lists) | stripe, intercom |
| Generosa (editorial, marketing) | claude |

## Misturas comuns que funcionam

| Cenario | Estrutura | Cores | Tipografia |
|---|---|---|---|
| Dashboard B2B com pinch de warmth | linear | linear | claude (sans) |
| Chat embedded num dashboard tech | intercom | linear (dark) | linear |
| Landing de SaaS premium | claude | claude | claude |
| Admin panel de fintech | linear | stripe | stripe |
| Painel interno de IA | linear | claude | linear |

## Misturas que NUNCA funcionam

- Linear (dark precision) + Stripe (light gradients) — paletas conflitantes
- Claude (warm serif) + Vercel (cool tech) — temperaturas opostas
- Mais de 2 brands no mesmo componente — visual chaos garantido

## Como ler cada DESIGN.md eficientemente

Cada arquivo segue mesma estrutura de 9 secoes. Para uma tarefa especifica:

| O que voce quer fazer | Secoes a ler |
|---|---|
| Criar componente novo | 2 (cores), 3 (typography), 4 (components) |
| Refatorar layout | 5 (layout), 6 (depth) |
| Resolver problema de hierarquia | 1 (visual theme), 5 (layout) |
| Adicionar microinteractions | 4 (components), 7 (do/dont) |
| Validar antes de entregar | 7 (do/dont), 8 (responsive) |
| Pegar exemplos prontos pra colar | 9 (agent prompt guide) |

A secao 9 de cada arquivo eh especialmente util — tem prompts paste-ready.
