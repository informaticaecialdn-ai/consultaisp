# DESIGN SYSTEM — Consulta ISP

> Leia este arquivo ANTES de gerar qualquer componente, tela ou estilo.
> Qualquer desvio dos tokens abaixo é inaceitável.

**Versão 4.0 — "Bureau"** · alinhada a `client/src/index.css`.

---

## 0. Por que a v4.0 existe

A v3.0 documentava um sistema **warm parchment + terracota**, derivado de
`references/claude.md`: fundo bege, título em serifa, sombras em anel quente.
Estava fielmente implementado — o problema não era coerência, era **adequação**.

O produto é um **bureau de crédito**. O trabalho dele é transmitir rigor, dado e
autoridade. A v3.0 se descrevia como *"editorial quente e humano — papel envelhecido,
pense num ensaio impresso"*. Isso é estética de revista numa ferramenta de análise de
risco. Bege e serifa leem como acolhimento; o produto precisa ler como **medição**.

| v3.0 (Claude / parchment) | v4.0 (Bureau) |
|---|---|
| Fundo Parchment `#F5F4ED` | Ground `#F7F9FC` — neutro frio |
| Surface Ivory `#FAF9F5` | Pure White `#FFFFFF` |
| Texto Near Black `#141413` | Deep Navy `#061B31` |
| Marca Terracota `#C96442` | Purple `#533AFD` |
| Título Fraunces serifa | Inter, tracking −0.02em |
| Dado em DM Mono | IBM Plex Mono, `tabular-nums` |
| Profundidade: ring shadow quente | Borda de 1px, neutro frio |
| Botão 8px | Botão 4px |

**A v2.0 estava certa e foi descartada por engano.** Ela dizia *"Finança editorial
europeia — pense no FT ou Bloomberg"*. Aquela intuição servia ao produto. O código
tinha derivado para a paleta quente e a v3.0 alinhou o documento ao código, em vez de
perguntar qual dos dois estava certo. A v4.0 retoma a intenção da v2.0 com referências
melhores.

**Migração sem quebra:** os **nomes** das variáveis foram mantidos. `--color-brand`
continua sendo o acento; só o valor mudou de terracota para roxo. Nenhum dos 100+
arquivos consumidores precisou de edição de cor.

---

## 1. Identidade Visual

**Conceito:** instrumento de medição. Painel de dados denso, alinhado e frio.
**Palavra-chave:** confiança, rigor, organização, precisão.
**NÃO É:** papel envelhecido, ensaio editorial, SaaS colorido, dashboard com gradiente.

O sistema é um **híbrido de duas referências**:

- **Neutros, semânticas e hierarquia tipográfica** de `references/stripe.md`
  (fintech, B2B profissional, light-first).
- **Geometria e profundidade** de `references/intercom.md` — 4px seco em botão,
  sombra praticamente ausente, profundidade por borda.

Ao consultar as referências: cor e tipografia em `stripe.md`, raio e elevação em
`intercom.md`. Não misture uma terceira.

### Duas derivações declaradas

Nem tudo saiu literal das referências. Estas duas foram **derivadas**, e é
intencional que estejam registradas:

1. `--color-bg: #F7F9FC` — tint da família da borda Stripe (`#E5EDF5`). O Stripe usa
   branco puro de fundo; aqui um ground levemente tingido separa o canvas do card.
2. `--score-low: #C43D02` — Intercom Report Orange (`#fe4c02`) escurecido para passar
   AA sobre branco. O valor original é vivo demais para texto.

---

## 2. Tipografia

```
Display / Títulos:  Inter, weight 300 (grande) ou 500 (interno)
                    Tracking negativo: -0.028em em display, -0.02em em heading
Body:               Inter, weight 400, 15px, line-height 1.5
Dados / Labels:     IBM Plex Mono, weight 400-600
                    SEMPRE com font-variant-numeric: tabular-nums
```

**Import** (em `client/index.html`):

```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

**Tokens** (em `index.css`):

```css
--font-sans:    "Inter", ui-sans-serif, system-ui, sans-serif;
--font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono:    "IBM Plex Mono", ui-monospace, monospace;
```

**Regras:**

- **Não existe serifa neste sistema.** Serifa lê editorial; o produto lê medição.
- **Todo número é mono e tabular.** Score, valor, CPF, data, contagem, percentual.
  Sem `tabular-nums` as colunas desalinham e a tela parece descuidada.
- Display grande usa peso **300**, não bold. Autoridade vem do tamanho e do tracking
  apertado, não do peso — é o gesto de `stripe.md`.
- Label mono em caixa alta com tracking aberto (`0.1em`), 10px.

> **Nota de fidelidade:** `stripe.md` especifica **Sohne** e `intercom.md` especifica
> **Saans**. Ambas são proprietárias e não existem no Google Fonts. Inter é o
> substituto padrão da Sohne e preserva a silhueta (neo-grotesca, tracking negativo,
> pesos leves). Não troque por outra sem revisar este documento.

---

## 3. Paleta

### 3.1 Light (`:root`)

```css
:root {
  /* Superfícies */
  --color-bg:         #F7F9FC;  /* Ground — tint da borda Stripe (derivado) */
  --color-surface:    #FFFFFF;  /* Stripe Pure White */
  --color-border:     #E5EDF5;  /* Stripe Border Default */
  --color-tag-bg:     #EFF4F9;  /* Tint neutro — chip e botão neutro */

  /* Texto */
  --color-ink:        #061B31;  /* Stripe Deep Navy */
  --color-muted:      #64748D;  /* Stripe Body */

  /* Marca */
  --color-brand:      #533AFD;  /* Stripe Purple — CTA, link, ativo */
  --color-steel:      #4434D4;  /* Stripe Purple Hover */
  --color-brand-bg:   #EEECFF;

  /* Semânticas — todas com contraste AA sobre branco */
  --color-success:    #108C3D;  --color-success-bg: #E4F6EA;
  --color-gold:       #9B6829;  --color-gold-bg:    #FBF1E2;
  --color-danger:     #C41C1C;  --color-danger-bg:  #FDE9E9;

  /* Anéis de 1px — nome herdado, valor agora neutro frio */
  --ring-warm:        #D3DFEC;
  --ring-subtle:      #E5EDF5;
  --ring-deep:        #C2D2E3;

  /* Score — faixas espelhadas de server/utils/isp-score.ts */
  --score-high:       var(--color-success);  /* 701-1000 */
  --score-medium:     var(--color-gold);     /* 501-700  */
  --score-low:        #C43D02;               /* 301-500  */
  --score-critical:   var(--color-danger);   /* 0-300    */
}
```

> **Armadilha herdada:** os tokens `--ring-*` ainda se chamam *warm*, mas os valores
> são neutros frios. O nome sobreviveu para não quebrar os consumidores. Não deduza
> a cor pelo nome — leia o valor.

### 3.2 Dark (`.dark`)

Base: Stripe Dark Navy `#0D253D`.

```css
.dark {
  --color-bg:         #071726;
  --color-surface:    #0D253D;
  --color-border:     #1E3B58;
  --color-tag-bg:     #12304C;
  --color-ink:        #EAF2FA;
  --color-muted:      #8AA2BC;
  --color-brand:      #8B7CFF;  /* clareado para AA sobre escuro */
  --color-steel:      #A197FF;
  --color-success:    #4FD07E;  --color-success-bg: #10331F;
  --color-gold:       #D8A24A;  --color-gold-bg:    #33270F;
  --color-danger:     #FF6E6E;  --color-danger-bg:  #3A1616;
  --score-low:        #F0763A;
  --ring-warm:        #2A4C6E;
  --ring-subtle:      #1E3B58;
  --ring-deep:        #3A628A;
}
```

**Regra do dark:** semânticas **clareiam**. Nunca reuse o hex do light.

### 3.3 Foco

```css
--ring: 249 97% 61%;  /* = --color-brand */
```

Na v3.0 o foco era um azul isolado, única cor fria de um sistema quente. Agora o
sistema inteiro é frio, então o foco usa o **próprio acento da marca** — mais coerente
e um token a menos.

### 3.4 Mapa de uso

| Situação | Token |
|---|---|
| CTA, link, aba ativa, item de nav selecionado | `--color-brand` |
| Score 701–1000 · Aprovar · ativo | `--score-high` / `--color-success` |
| Score 501–700 · Revisar · pendente | `--score-medium` / `--color-gold` |
| Score 301–500 | `--score-low` |
| Score 0–300 · Rejeitar · inadimplente | `--score-critical` / `--color-danger` |
| Label, metadata, texto auxiliar | `--color-muted` |
| Foco de teclado | `--ring` |

### 3.5 Paleta categórica — identidade, não status

Para dados que são **identidade** (qual ERP, qual agente, qual etapa) e não estado.
Derivada da report palette do `intercom.md`, escurecida para AA sobre branco.

```css
--cat-blue:  #1E6FBF;   --cat-indigo: #533AFD;  --cat-violet: #6B4FD8;
--cat-teal:  #10707A;   --cat-green:  #0B8A32;  --cat-lime:   #6E8A0F;
--cat-amber: #9B6829;   --cat-orange: #C43D02;  --cat-red:    #C41C1C;
--cat-pink:  #C4155A;   --cat-slate:  #64748D;  --cat-navy:   #273951;
```

**Regra:** chip neutro + dot categórico. O fundo do chip é sempre
`--color-tag-bg`; a cor vive só no marcador. Treze chips coloridos lado a lado viram
ruído e destroem a leitura de organização.

Use `--cat-*` em dot, borda de 2px ou série de gráfico. **Nunca** em fundo de chip,
e **nunca** para significar bom/ruim — isso é papel das semânticas.

---

## 4. Espaçamento

```
Base: 4px
Escala: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80   (intercom.md)

Gap entre cards:         10–16px
Padding de card:         12px 14px  (denso) · 16px 20px (padrão)
Padding de seção:        24–32px
```

Densidade é uma decisão de produto: o operador escaneia muitas linhas por dia. Card
espaçoso demais reduz quantas linhas cabem na tela e piora o trabalho.

---

## 5. Geometria e Profundidade

### 5.1 Raio — `intercom.md`

```
Botões, inputs, badges:   4px   (rounded / rounded-sm)
Itens de navegação:       6px   (rounded-md)
Cards e containers:       8px   (rounded-lg)
Avatares, dots, spinners: 9999px (rounded-full — círculo real)
```

Canto seco é a identidade: *"near-rectangular, industrial and precise"*. Nada acima
de 8px. `rounded-full` em **badge de status** continua proibido.

### 5.2 Profundidade — borda, não sombra

`intercom.md`: *"Minimal shadows. Depth through warm border colors and surface tints."*

```css
/* Repouso */          box-shadow: 0 0 0 1px var(--ring-subtle);
/* Interativo/hover */ box-shadow: 0 0 0 1px var(--ring-warm);
/* Ativo */            box-shadow: 0 0 0 1px var(--ring-deep);
/* Flutuante (modal, popover) — único caso com lift */
box-shadow: 0 0 0 1px var(--ring-warm), 0 12px 32px -14px hsl(209 92% 11% / .20);
```

A escala `--shadow-*` foi neutralizada de propósito: de `--shadow-2xs` a `--shadow-md`
tudo é apenas o anel de 1px. Só `lg`/`xl`/`2xl` carregam um lift, e apenas para
overlay. **Nada flutua fora da grade** — é isso que produz a sensação de organização.

---

## 6. Componentes

### Card de métrica

```css
.metric {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
}
.metric-label {
  font-family: var(--font-mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: .11em;
  color: var(--color-muted);
}
.metric-value {
  font-family: var(--font-mono); font-size: 21px; font-weight: 500;
  letter-spacing: -.02em; font-variant-numeric: tabular-nums;
  color: var(--color-ink);
}
```

O número é `--color-ink`, nunca o acento. Acento é ação; dado é dado.

### Badge de status

```css
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-mono); font-size: 10px; font-weight: 500;
  letter-spacing: .04em; padding: 3px 7px;
  border-radius: 4px;   /* NUNCA pill */
}
```

Pares: `--color-success-bg` + `--color-success`, e assim por diante.

### Botão

```css
.btn {
  border-radius: 4px; padding: 9px 16px;
  font-size: 13px; font-weight: 500; letter-spacing: -.005em;
  transition: background .15s, box-shadow .15s, transform .1s;
}
.btn:active { transform: scale(0.97); }
.btn:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }

.btn-primary { background: var(--color-ink); color: var(--color-surface); border: none; }
.btn-accent  { background: var(--color-brand); color: #fff; border: none; }
.btn-ghost   { background: var(--color-surface); color: var(--color-ink);
               box-shadow: 0 0 0 1px var(--ring-warm); }
```

Botão primário é **navy**, não roxo. O roxo é reservado para navegação e link — assim
o CTA não compete com o estado ativo da interface.

### Tabela

```css
.ds-table th {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 500;
  letter-spacing: .1em; text-transform: uppercase;
  color: var(--color-muted); text-align: left;
  padding: 9px 14px; border-bottom: 1px solid var(--color-border);
}
.ds-table td { padding: 10px 14px; border-bottom: 1px solid var(--color-border); }
.ds-table td.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

Toda coluna numérica leva `.num`. É o detalhe que mais carrega organização.

### Estado vazio (obrigatório)

Ícone + título + descrição + CTA. Ver `ConsultaIdleState.tsx` como referência viva.

### Estado de carregamento

Skeleton para carga acima de 300ms. Nunca spinner centralizado, nunca
"Carregando...". Respeite `prefers-reduced-motion`.

---

## 7. Anti-Padrões

```
TIPOGRAFIA
  ✗ Qualquer serifa (Fraunces, Georgia) — o sistema não tem serifa
  ✗ Número sem tabular-nums
  ✗ Bold em display grande (use peso 300 + tracking apertado)

COR
  ✗ Paleta default do Tailwind: slate-*, blue-*, emerald-*, red-*, gray-*
  ✗ --cat-* significando bom/ruim
  ✗ Acento roxo em dado numérico
  ✗ Gradiente em botão, card ou hero

GEOMETRIA
  ✗ Raio acima de 8px
  ✗ rounded-full em badge de status
  ✗ shadow-md/lg/xl do Tailwind — use os anéis da seção 5.2
  ✗ border 0.5px

ACESSIBILIDADE — NÃO NEGOCIÁVEL
  ✗ Foco sem anel visível
  ✗ Contraste < 4.5:1 em corpo, < 3:1 em texto grande
  ✗ Alvo de toque < 44x44px
  ✗ Animação sem fallback prefers-reduced-motion
```

---

## 8. Tom de Voz

- **Labels:** substantivos diretos em minúsculas — `cpf do assinante`, `score atual`
- **Erros:** afirmativos e úteis — `CPF não encontrado` (não: `Erro 404`)
- **CTAs:** verbos no infinitivo — `Consultar`, `Exportar relatório`
- **NÃO USE:** exclamação, jargão técnico exposto, linguagem de startup

---

## 9. Dívidas abertas

| # | Dívida | Volume |
|---|---|---|
| 1 | Classes da paleta default do Tailwind ainda espalhadas | ~1190 ocorrências, 47 dos 119 arquivos |
| 2 | Gradientes `from-X to-Y` (subconjunto de #1) | 278 paradas, 37 call sites |
| 3 | 112 erros de TypeScript pré-existentes | maioria em `server/services/*` |
| 4 | Dark mode definido mas nunca ativado — falta o toggle | `next-themes` está nas deps |
| 5 | `CLAUDE.md` documenta `isp_consultations.score` como 0–100; é **0–1000** | corrigir na fonte |

A #1 não é trabalho de `sed`: cada ocorrência precisa de julgamento sobre o papel
(informativo, decorativo ou categórico). Deve ser feita tela a tela.

---

*Versão 4.0 · Consulta ISP · base: `client/src/index.css` + `stripe.md` + `intercom.md`*
