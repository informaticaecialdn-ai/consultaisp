# DESIGN.md Library

Coleção de guidelines de design extraidos de produtos referencia, instalada
via [`getdesign`](https://getdesign.md) (do projeto VoltAgent/awesome-design-md).

## O que sao esses arquivos

Cada `.md` aqui descreve em texto puro o sistema de design de uma marca/produto:
- Cores (com hex codes nomeados)
- Tipografia (font families, hierarquia, weights)
- Componentes (botoes, cards, inputs, modais)
- Spacing, depth, microinteracoes
- "Do's and Don'ts" especificos

Sao referencia — nao codigo. Quando voce pede pra um AI assistant gerar UI,
**aponta o arquivo apropriado** e a UI sai consistente com aquela marca.

## Brands instaladas (5)

| Arquivo | Marca | Quando usar |
|---|---|---|
| [`linear.md`](linear.md) | Linear | UIs ultra-minimalistas, dark-mode-first, projetos de software, productivity SaaS |
| [`vercel.md`](vercel.md) | Vercel | Developer tools, dashboards de infra, dark theme com whites refinados |
| [`intercom.md`](intercom.md) | Intercom | Customer messaging, chat widgets, suporte, conversational UIs |
| [`claude.md`](claude.md) | Claude (Anthropic) | Produtos de IA, conteudo editorial warm/sofisticado, parchment + serif |
| [`stripe.md`](stripe.md) | Stripe | Fintech, dashboards de pagamento, profissional clean light-first |

## Como usar com AI assistant

### Padrao 1: Pedido de pagina nova

```
Crie uma nova pagina de Configuracoes seguindo o sistema descrito em
docs/design-md/linear.md. Aplique exatamente os tokens de cor, typography,
spacing e radius daquele documento.
```

### Padrao 2: Refator de componente existente

```
Refatore o componente public/js/cards/audiencias-list.js seguindo as
guidelines de docs/design-md/vercel.md. Mantenha a logica intacta, mude
apenas estilos: cores, padding, hover states, e elevation.
```

### Padrao 3: Deriva (mistura)

```
Faca um modal seguindo a estrutura/comportamento de docs/design-md/claude.md
(serif headlines, ring shadows, warm tones) MAS usando o dark-mode color
palette de docs/design-md/linear.md.
```

### Padrao 4: Quick reference

Cole no prompt apenas a secao especifica:
- "Use a paleta de cores em [linear.md > secao 2]"
- "Aplique o sistema de spacing em [vercel.md > secao 5]"

## Recomendacao para Consulta ISP

O dashboard atual usa style `Sales Intelligence Dashboard` (dark-first, B2B).
A combinacao mais aderente:

- **Estrutura geral + tokens de cor:** `linear.md` (dark-mode-native, achromatic + accent)
- **Densidade de dados / tabelas / charts:** `vercel.md`
- **Chat/conversas com leads:** `intercom.md`

Plus Jakarta Sans (que ja instalamos) eh um substituto razoavel pra Inter
Variable do Linear quando nao da pra usar fonts custom.

## Atualizar / adicionar novas brands

```bash
cd /caminho/para/projeto
npx getdesign@latest add <brand>     # ex: add notion, add stripe, add raycast
mv DESIGN.md docs/design-md/<brand>.md
```

Lista completa de brands disponiveis: https://getdesign.md/

## Anti-patterns a evitar

- **Nao misture randomicamente** — escolha 1 brand como base e variacoes pontuais
- **Nao copie literais hex sem entender o sistema** — entenda a logica (warm vs cool, achromatic vs vivid)
- **Nao quebre a tipografia** — se escolher Linear (sans-serif geometrico), nao misture Claude (serif editorial)

---

Repo de origem: https://github.com/VoltAgent/awesome-design-md
Servico: https://getdesign.md
