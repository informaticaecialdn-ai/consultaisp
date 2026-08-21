# DESIGN SYSTEM — Consulta ISP

> Leia este arquivo ANTES de gerar qualquer componente, tela ou estilo.
> Qualquer desvio dos tokens abaixo é inaceitável.

**Versão 3.0** — alinhada ao que está implementado em `client/src/index.css`.

---

## 0. Aviso de versão — leia primeiro

A v2.0 deste documento descrevia um sistema **navy / finança editorial** (`#1A3A5C`, fundo `#F9F7F4`)
que **nunca existiu no código**. A implementação real é um sistema **warm parchment + terracota**,
derivado de `.claude/skills/design/references/claude.md`.

Se você leu a v2.0 e usou navy, o resultado está errado. A tabela abaixo mapeia a correção:

| v2.0 (obsoleto, nunca implementado) | v3.0 (real, no código) |
|---|---|
| Fundo `#F9F7F4` | Parchment `#F5F4ED` |
| Surface `#FFFFFF` | Ivory `#FAF9F5` |
| Primário navy `#1A3A5C` | Terracota `#C96442` |
| Border `#E2DDD6` | Border Cream `#F0EEE6` |
| Ink `#1A1714` | Near Black `#141413` |
| Muted `#6B6560` | Olive Gray `#5E5D59` |
| Danger `#8B1A1A` | Crimson `#B53333` |
| Success `#1A4A2E` | Olive Green `#4A6B3E` |
| Sem dark mode | Dark mode completo (seção 3.2) |
| Raio máximo 6px | Base 8px (`--radius`) — seção 5.1 |
| Sombras drop `shadow-xs` | **Ring shadows** — seção 5.2 |

**Armadilha de nomenclatura:** a variável `--color-navy` **contém terracota**, não navy.
É resquício da migração. Use `--color-brand`; `--color-navy` segue como alias depreciado
apenas para não quebrar os 183 usos existentes.

---

## 1. Identidade Visual

**Conceito:** editorial quente e humano — papel envelhecido, não interface de software.
Pense num ensaio impresso, não num dashboard.
**Palavra-chave:** confiança, sobriedade, calor, precisão.
**NÃO É:** startup colorida, SaaS genérico, dark dashboard com gradiente roxo-azul.

O sistema é um **híbrido deliberado**:

- **Cor e profundidade** vêm de `references/claude.md` (parchment, terracota, ring shadows).
- **Tipografia é própria do projeto** (Fraunces + DM Sans + DM Mono). Não usamos a
  Anthropic Serif do reference — Fraunces cumpre o mesmo papel de "gravidade de título de livro".
- **Raios são mais apertados** que os do reference (que vai até 32px). Somos uma ferramenta
  densa de dados, não uma landing institucional.

Ao consultar `claude.md`, aplique **seções 2 (cor) e 6 (profundidade)**. Ignore a tipografia
e a escala de raio de lá.

---

## 2. Tipografia

Esta seção **não mudou** da v2.0 — a tipografia sempre esteve correta.

```
Display / Títulos grandes:  Fraunces, serif, weight 300 (light) ou 600 (semibold)
                            Use itálico para ênfase emocional: <em>
Headings internos:          Fraunces, weight 600, 14–18px
Body / Parágrafos:          DM Sans, weight 400, 14px, line-height 1.6
Dados / Códigos / Labels:   DM Mono, weight 400 ou 500, 10–13px
```

**Import** (já presente em `client/index.html`):

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,600;1,300&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
```

**Tokens CSS** (já em `index.css`):

```css
--font-sans:    "DM Sans", sans-serif;
--font-display: "Fraunces", serif;
--font-serif:   "Fraunces", serif;
--font-mono:    "DM Mono", monospace;
```

**Regras de hierarquia:**

- Serif (Fraunces) carrega **todo** conteúdo de título. Sans (DM Sans) carrega texto funcional.
- Mono (DM Mono) carrega **todo dado numérico**: scores, valores, CPF, datas, labels de métrica.
- Em display ≥ 32px, aperte o tracking (`-0.02em`). Em labels mono, abra (`0.08em`).

---

## 3. Paleta de Cores

### 3.1 Light (`:root`)

```css
:root {
  /* Superfícies */
  --color-bg:         #F5F4ED;  /* Parchment — creme quente, a alma da paleta */
  --color-surface:    #FAF9F5;  /* Ivory — cards e containers elevados */
  --color-border:     #F0EEE6;  /* Border Cream — borda quente quase invisível */
  --color-tag-bg:     #E8E6DC;  /* Warm Sand — fundo de pills e botões neutros */

  /* Texto */
  --color-ink:        #141413;  /* Near Black — escuro com tinta oliva */
  --color-muted:      #5E5D59;  /* Olive Gray — texto secundário, labels */

  /* Marca */
  --color-brand:      #C96442;  /* Terracota — CTA, links, acento de marca */
  --color-brand-bg:   #FBEFE8;  /* Terracota 10% — fundo de acento suave */
  --color-steel:      #D97757;  /* Coral — hover / variante clara da terracota */

  /* Semânticas */
  --color-gold:       #B8860B;  --color-gold-bg:    #F5EDD4;  /* atenção, pendente */
  --color-danger:     #B53333;  --color-danger-bg:  #F8E7E1;  /* erro, inadimplente */
  --color-success:    #4A6B3E;  --color-success-bg: #EAEEDF;  /* ativo, regularizado */

  /* Ring shadows — assinatura do sistema (seção 5.2) */
  --ring-warm:        #D1CFC5;
  --ring-subtle:      #DEDCD1;
  --ring-deep:        #C2C0B6;

  /* Score semântico — padronizar em TODO o sistema */
  --score-high:       var(--color-success);  /* 701-1000 */
  --score-medium:     var(--color-gold);     /* 401-700  */
  --score-low:        #C45A1A;               /* 201-400  */
  --score-critical:   var(--color-danger);   /* 0-200    */

  /* Alias depreciado — NÃO use em código novo */
  --color-navy:       var(--color-brand);
  --color-navy-bg:    var(--color-brand-bg);
}
```

### 3.2 Dark (`.dark`)

```css
.dark {
  --color-bg:         #141413;  /* Deep Dark — preto quente */
  --color-surface:    #30302E;  /* Dark Surface — carvão quente */
  --color-border:     #30302E;
  --color-tag-bg:     #3D3D3A;

  --color-ink:        #FAF9F5;  /* Ivory sobre escuro */
  --color-muted:      #B0AEA5;  /* Warm Silver */

  --color-brand:      #D97757;  /* Coral — terracota clareada para dark */
  --color-brand-bg:   #2B1E18;
  --color-steel:      #C96442;

  --color-gold:       #D4A72C;  --color-gold-bg:    #2A2518;
  --color-danger:     #D97777;  --color-danger-bg:  #2E1A1A;
  --color-success:    #7FA670;  --color-success-bg: #1E2A1A;
  --score-low:        #E07040;
}
```

**Regra do dark:** as semânticas **clareiam** no dark (crimson `#B53333` → `#D97777`) para manter
contraste AA sobre `#141413`. Nunca reuse o hex do light no dark.

### 3.3 A única cor fria permitida

```css
--ring: 210 83% 57%;  /* Focus Blue #3898EC */
```

Focus Blue é o **único** azul do sistema e existe **só** para foco de teclado (acessibilidade).
Não use para link, ícone, badge ou gráfico. Regra herdada de `claude.md`.

### 3.4 Mapa de uso

| Situação | Token |
|---|---|
| CTA primário, link, acento de marca | `--color-brand` |
| Score alto (701–1000) | `--score-high` |
| Score médio (401–700) | `--score-medium` |
| Score baixo (201–400) | `--score-low` |
| Score crítico (0–200) | `--score-critical` |
| Status: ativo / regularizado | `--color-success` |
| Status: inadimplente / negativado | `--color-danger` |
| Status: pendente / em análise | `--color-gold` |
| Labels, metadata, texto auxiliar | `--color-muted` |
| Foco de teclado | `--ring` (Focus Blue) |

### 3.5 Paleta categórica — identidade, não status

Alguns dados são **identidade categórica**, não estado: qual ERP originou o registro, qual
agente atendeu, qual etapa do pipeline. Precisam ser distinguíveis entre si, mas **não**
significam "bom" ou "ruim". Usar `--color-success`/`--color-danger` aqui é erro semântico —
um ERP marcado de vermelho lê como problema.

```css
--cat-terracotta: #C96442;   --cat-ochre:  #B8860B;
--cat-moss:       #4A6B3E;   --cat-teal:   #3E6B6B;
--cat-indigo:     #4A5480;   --cat-plum:   #7A4A63;
--cat-rust:       #C45A1A;   --cat-olive:  #6B7B3A;
--cat-clay:       #8A5A4A;   --cat-bronze: #96703C;
--cat-wine:       #8B3A4A;   --cat-slate:  #6B6560;
```

Doze matizes da família quente, todos abafados — nenhum neon, nenhum azul-Tailwind.
No `.dark` cada um tem variante clareada para ler sobre `#30302E`.

**Regra de aplicação — chip neutro + dot categórico:**

```html
<span class="... rounded bg-[var(--color-tag-bg)] text-[var(--color-ink)]">
  <span class="w-1.5 h-1.5 rounded-full bg-[var(--cat-indigo)]" />
  iXC Soft
</span>
```

Treze chips coloridos lado a lado viram ruído e brigam com a sobriedade editorial.
O fundo do chip é **sempre neutro**; a cor vive só no dot. Use `--cat-*` em marcador,
borda de 2px ou série de gráfico — **nunca** em fundo de chip ou de card.

**Escalas sequenciais** (heatmap, temperatura de lead) não usam `--cat-*`: precisam de
luminância monotônica. Use a rampa quente
`#A3B370 → #D4A72C → #E07040 → #B53333 → #7A2020` (claro para escuro). Onde a
biblioteca não aceita CSS var (Leaflet.heat, canvas), replique os hexes literalmente
e comente a origem.

---

## 4. Espaçamento e Layout

```
Base unit: 4px
Escala: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64px

Gap entre cards:         16px (1rem)
Padding interno de card: 16px 20px (1rem 1.25rem)
Padding de seção:        32px (2rem)
```

Sem valores fora da escala. Nada de 5px, 13px, 18px.

---

## 5. Bordas, Raios e Profundidade

### 5.1 Raio

O token base é `--radius: .5rem` (**8px**) e alimenta todos os componentes shadcn.
Corresponde ao "comfortably rounded (8px)" de `claude.md`.

```
Cards, botões, containers:  8px  (--radius, padrão)
Inputs, elementos de nav:   8px
Badges, pills de status:    4px  (mais apertado — densidade de dados)
Score bar / progress:       2px  (altura 4px)
Avatares, dots, spinners:   9999px (rounded-full — legítimo)
```

**Proibido:** `rounded-full` em **badge de status**. Badge de status é retangular com raio 4px.
`rounded-full` é só para elementos genuinamente circulares.

> **Divergência resolvida:** a v2.0 exigia "máximo 6px" e raio 2px em botões/inputs.
> Isso conflita com o `--radius: .5rem` implementado e com `claude.md`, que proíbe cantos
> < 6px em botões e cards ("softness is core to the identity"). A v3.0 documenta os 8px reais.
> Se quiser voltar ao visual mais seco de 2px, é decisão de produto — mude `--radius`
> e este documento junto.

### 5.2 Profundidade — ring shadows, não drop shadows

Esta é a **assinatura** do sistema, herdada de `claude.md`. Profundidade se comunica com
um halo de 1px em cinza quente, não com sombra projetada.

```css
/* Nível 0 — plano */
/* sem sombra, sem borda — texto inline sobre Parchment */

/* Nível 1 — ring sutil (card em repouso) */
box-shadow: 0 0 0 1px var(--ring-subtle);

/* Nível 2 — ring quente (card interativo, botão hover) */
box-shadow: 0 0 0 1px var(--ring-warm);

/* Nível 3 — ring profundo (estado ativo/pressionado) */
box-shadow: 0 0 0 1px var(--ring-deep);

/* Nível 4 — flutuante (modal, popover) — ring + lift quase invisível */
box-shadow: 0 0 0 1px var(--ring-warm), 0 24px 48px rgba(20, 20, 19, 0.05);
```

**Proibido:** `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `drop-shadow-*`.
Um card que "flutua" com blur pesado quebra o sistema inteiro.

**Classe pronta** para overlays (modal, popover, dropdown, tooltip):

```
shadow-[0_0_0_1px_var(--ring-warm),0_24px_48px_rgba(20,20,19,0.05)]
```

Controles pequenos (thumb de switch) usam um lift real e mínimo, não o ring de overlay:

```
shadow-[0_0_0_1px_var(--ring-deep),0_1px_2px_rgba(20,20,19,0.12)]
```

> **Resolvido em 2026-08-21:** os 42 usos de `shadow-md/lg/xl/2xl` foram migrados para as
> classes acima, e a escala `--shadow-*` — que usava `hsl(220 13% 91%)`, cinza frio — passou
> a `hsl(48 12% 85%)` no light e `hsl(48 6% 8%)` no dark.

### 5.3 Bordas

```css
border: 1px solid var(--color-border);
```

Sempre 1px. Nunca 0.5px (não renderiza consistente). Em superfícies onde a borda sumiria,
use ring shadow no lugar.

---

## 6. Componentes

### Card de Métrica

```html
<div class="metric-card">
  <span class="metric-label">Score ISP</span>
  <div class="metric-number">742</div>
  <div class="score-bar"><div class="score-fill" style="width: 74.2%"></div></div>
</div>
```

```css
.metric-card {
  background: var(--color-surface);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  box-shadow: 0 0 0 1px var(--ring-subtle);
  transition: box-shadow .2s ease;
}
.metric-card:hover { box-shadow: 0 0 0 1px var(--ring-warm); }

.metric-label {
  font-family: var(--font-mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--color-muted);
}
.metric-number {
  font-family: var(--font-mono); font-size: 24px; font-weight: 500;
  color: var(--color-ink); margin: 8px 0 4px;
}
.score-bar  { height: 4px; background: var(--color-tag-bg); border-radius: 2px; overflow: hidden; }
.score-fill { height: 100%; background: var(--score-high); border-radius: 2px; }
```

O número da métrica é `--color-ink`, **não** terracota. Terracota é para ação, não para dado.
A cor do `.score-fill` vem da faixa do score (seção 3.4).

### Badge de Status

```css
.badge {
  display: inline-flex; align-items: center;
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.06em; font-weight: 500;
  padding: 3px 8px; border-radius: 4px;   /* NÃO rounded-full */
}
.badge-brand   { background: var(--color-brand-bg);   color: var(--color-brand);   }
.badge-gold    { background: var(--color-gold-bg);    color: var(--color-gold);    }
.badge-danger  { background: var(--color-danger-bg);  color: var(--color-danger);  }
.badge-success { background: var(--color-success-bg); color: var(--color-success); }
```

### Botões

```css
.btn {
  font-family: var(--font-mono); font-size: 11px;
  letter-spacing: 0.06em; padding: 8px 16px;
  border-radius: 8px; cursor: pointer; border: none;
  transition: box-shadow .15s ease, background .15s ease, transform .1s ease;
}
.btn:active        { transform: scale(0.97); }
.btn:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }

.btn-primary       { background: var(--color-brand); color: var(--color-surface);
                     box-shadow: 0 0 0 1px var(--color-brand); }
.btn-primary:hover { background: var(--color-steel); }

.btn-secondary       { background: var(--color-surface); color: var(--color-ink);
                       box-shadow: 0 0 0 1px var(--ring-warm); }
.btn-secondary:hover { box-shadow: 0 0 0 1px var(--ring-deep); }

.btn-ghost       { background: transparent; color: var(--color-muted); }
.btn-ghost:hover { background: var(--color-tag-bg); }
```

### Tabela de Dados

```css
.ds-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ds-table th {
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-muted); text-align: left;
  padding: 8px 12px; border-bottom: 1px solid var(--color-border);
}
.ds-table td { padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
.ds-table tr:last-child td { border-bottom: none; }
.ds-table tbody tr:hover { background: var(--color-bg); }
```

### Input

```css
.ds-input {
  font-family: var(--font-sans); font-size: 13px;
  padding: 8px 12px; width: 100%;
  border: 1px solid var(--color-border); border-radius: 8px;
  background: var(--color-surface); color: var(--color-ink);
  outline: none; transition: box-shadow .15s;
}
.ds-input:focus-visible {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.15);   /* Focus Blue — única cor fria */
}
```

### Estado Vazio (obrigatório)

Painel vazio nunca fica em branco. Sempre ícone + título + descrição + CTA.

```html
<div class="empty-state">
  <Icon class="empty-icon" />
  <h3 class="empty-title">Nenhuma consulta hoje</h3>
  <p class="empty-desc">Consulte um CPF para ver score e histórico na rede.</p>
  <button class="btn btn-primary">Consultar CPF</button>
</div>
```

```css
.empty-state { text-align: center; padding: 48px 24px; }
.empty-icon  { width: 32px; height: 32px; color: var(--color-muted); opacity: .5; margin: 0 auto 16px; }
.empty-title { font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--color-ink); }
.empty-desc  { font-family: var(--font-sans); font-size: 13px; color: var(--color-muted); margin: 8px 0 24px; }
```

### Estado de Carregamento

Para carregamentos > 300ms, use **skeleton com shimmer** — nunca spinner centralizado.

```css
.skeleton {
  background: linear-gradient(90deg, var(--color-tag-bg) 25%, var(--color-border) 50%, var(--color-tag-bg) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; background: var(--color-tag-bg); }
}
```

### Section Label

```css
.section-label {
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--color-muted); margin-bottom: 1rem;
  padding-bottom: 0.5rem; border-bottom: 1px solid var(--color-border);
}
```

---

## 7. Tailwind

Já configurado em `tailwind.config.ts`:

```js
fontFamily: {
  display: ['Fraunces', 'serif'],
  body:    ['DM Sans', 'sans-serif'],
  mono:    ['DM Mono', 'monospace'],
}
```

**Classes proibidas:**

- `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `drop-shadow-*` → use ring shadow (5.2)
- `rounded-full` **em badge de status** → use `rounded` (4px)
- Cores default do Tailwind: `emerald-*`, `slate-*`, `indigo-*`, `violet-*`, `blue-*`, `gray-*`
  → use os tokens semânticos (3.4)
- Gradientes roxo→azul, botões com gradiente

**Sempre prefira** `bg-[var(--color-surface)]` a um hex literal.

---

## 8. Anti-Padrões — Lista Negra

```
FONTES PROIBIDAS:
  ✗ Inter, Roboto, Arial, system-ui, -apple-system
  ✗ Space Grotesk, Poppins, Nunito, Outfit

CORES PROIBIDAS:
  ✗ #6366f1 (indigo), #8b5cf6 (violet), #ef4444 (red-500), #64748b (slate-500)
  ✗ Qualquer azul que não seja o Focus Blue #3898EC em anel de foco
  ✗ Qualquer gradiente purple-to-blue
  ✗ Fundo #0f172a (slate-900 genérico) — o dark é #141413, quente

PROFUNDIDADE PROIBIDA:
  ✗ box-shadow com blur > 4px fora de modal/popover
  ✗ shadow-md e acima
  ✗ border: 0.5px

LAYOUT PROIBIDO:
  ✗ Hero com gradiente de fundo
  ✗ Cards flutuando com shadow-xl
  ✗ Botões com gradiente
  ✗ Emoji decorativo inline
  ✗ Progress bar em formato pill
  ✗ Badge de status em formato pill
  ✗ Painel vazio sem empty state
  ✗ Spinner centralizado onde cabe skeleton

SEMÂNTICA PROIBIDA:
  ✗ Verde para algo que não seja sucesso/ativo/positivo
  ✗ Vermelho decorativo
  ✗ Terracota em dado numérico (terracota é ação, não informação)
  ✗ Badge com padding > 4px 10px

ACESSIBILIDADE — NÃO NEGOCIÁVEL:
  ✗ Remover outline de foco sem substituir por anel visível
  ✗ Contraste < 4.5:1 em corpo de texto, < 3:1 em texto grande
  ✗ Alvo de toque < 44x44px no mobile
  ✗ Animação sem fallback prefers-reduced-motion
```

---

## 9. Tom de Voz da Interface

- **Labels de campo:** substantivos diretos em minúsculas — `cpf do assinante`, `score atual`
- **Mensagens de erro:** afirmativas e úteis — `CPF não encontrado no sistema` (não: `Erro 404`)
- **CTAs:** verbos no infinitivo — `Consultar`, `Ver histórico`, `Exportar relatório`
- **Headers de seção:** caixa baixa com separador — `histórico de negativações`
- **NÃO USE:** exclamações (`Dados salvos com sucesso!`), jargão técnico exposto
  (`Error: null reference`), linguagem de startup (`Turbine seus resultados!`)

---

## 10. Uso e dívidas conhecidas

### Como referenciar

```
Crie o componente seguindo @DESIGN_SYSTEM.md.
Não use nada da lista negra da seção 8.
```

Para decisões de cor/profundidade não cobertas aqui, consulte
`.claude/skills/design/references/claude.md` — **seções 2 e 6 apenas**
(tipografia e escala de raio de lá não se aplicam, ver seção 1).

### Dívidas fechadas em 2026-08-21

| # | Dívida | O que foi feito |
|---|---|---|
| 1 | `shadow-md/lg/xl/2xl` (42 usos, 20 arquivos) | Migrados para o ring shadow da seção 5.2 |
| 2 | Escala `--shadow-*` em cinza frio | `hsl(220 13% 91%)` → `hsl(48 12% 85%)` / dark `hsl(48 6% 8%)` |
| 3 | Hex frios hardcoded (15 arquivos) | Mapeados para a família quente; rampa de heatmap refeita com luminância monotônica |
| 4 | Status dots/badges em `emerald-500`/`gray-400` | Trocados por `--color-success`/`--color-muted`; variantes `dark:` removidas (tokens já trocam sozinhos) |
| 5 | `rounded-full` em badge de status (9 badges) | → `rounded` (4px). Os 21 dots circulares foram preservados |
| 6 | `--chart-1..5` em paleta fria | Reescritos na família quente (light + dark) |
| 7 | `--color-navy` (183 ocorrências, 41 arquivos) | Migrado para `--color-brand`; alias removido |

**Removido:** `client/src/styles/tokens.css` — 75 linhas com a paleta navy da v2.0,
não importado em lugar nenhum. Era a origem física da confusão que gerou esta revisão.

Typecheck antes e depois: **112 erros nos dois** — nenhum erro novo introduzido.
(Os 112 são pré-existentes e server-side em sua maioria; ver dívida aberta #2 abaixo.)

### Dívidas abertas

| # | Dívida | Volume |
|---|---|---|
| 1 | Classes da paleta default do Tailwind (`bg-blue-50`, `bg-slate-100`, `text-red-500`…) | **1190 ocorrências, 47 dos 119 arquivos** |
| 2 | Gradientes `from-X-N to-Y-M` (subconjunto de #1) | 278 paradas, 37 call sites `bg-gradient-to-*` |
| 3 | 112 erros de TypeScript pré-existentes (`npm run check`) | maioria em `server/services/*` — `erp-sync`, `heatmap-cache`, `downlevelIteration` |
| 4 | Dark mode definido mas nunca ativado — nada aplica a classe `.dark` | `next-themes` está nas deps mas não há toggle |

> **Correção de auditoria:** a primeira versão desta tabela dizia "11 arquivos" para cores
> frias. Aquele número contava apenas **hex literais** (`#ef4444`); não contava classes
> Tailwind. O número real é o acima. A rodada de 2026-08-21 fechou o subconjunto
> **semântico** (status, score, sucesso/erro/atenção) e os hex literais — que era o que
> causava erro de leitura. O que resta é majoritariamente **decorativo**: caixas de aviso,
> fundos de ícone, gradientes de KPI.

Fechar #1 não é trabalho de `sed`: cada ocorrência precisa de julgamento sobre o papel
(informativo? decorativo? categórico?) e várias mudam de significado conforme o contexto.
Fechar #2 exige tocar **os dois lados** — o mapa de cores e o `className` que consome
(`bg-gradient-to-br ${x}` precisa perder o `bg-gradient-to-br`, senão vira gradiente sem
paradas). Ambas merecem passe próprio, tela a tela.

### Nota sobre o reference

`claude.md` linha 51 lista Ring Subtle como `#dedc01` (um amarelo) — é erro de digitação
no reference. A implementação usa `#DEDCD1`, cinza quente, que é o valor correto.

---

*Versão 3.0 · Consulta ISP · base: `client/src/index.css` + `references/claude.md`*
