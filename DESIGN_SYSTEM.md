# DESIGN SYSTEM — Consulta ISP

> Leia este arquivo ANTES de gerar qualquer componente, tela ou estilo.
> Qualquer desvio dos tokens abaixo é inaceitável.

**Versão 5.0 — "Provedor.AI · pele Razão · voz do módulo Consulta"**
· alinhada a `client/src/index.css`, que é a fonte da verdade.

---

## 0. Por que a v5.0 existe

A v4.0 documentava a paleta do Stripe: ground `#F7F9FC`, navy `#061B31`, roxo
`#533AFD`. **Nada disso está no código.** O `index.css` implementa outro sistema —
o handoff **Provedor.AI**, pele *Razão*, voz do módulo *Consulta*: fundo
cinza-violeta `#F6F6F9`, tinta `#1F1D29`, marca **berinjela `#4A4670`**.

O documento tinha drifted de novo, e da mesma forma que a v3.0: descrevendo uma
intenção em vez do que existe. A v5.0 corrige os fatos.

| v4.0 (documentada, nunca implementada) | v5.0 (o que o código faz) |
|---|---|
| Ground `#F7F9FC` — neutro frio azul | Ground `#F6F6F9` — neutro frio **violeta** |
| Texto Deep Navy `#061B31` | Tinta `#1F1D29` — quase-preto violeta |
| Marca Stripe Purple `#533AFD` | Marca **berinjela `#4A4670`** |
| Borda `#E5EDF5` | Borda `#EAEAF0` |
| Semânticas Stripe | `--ok` `#1F7A4C` · `--gated` `#A9741B` · `--past` `#8C2F39` · `--danger` `#B3261E` |

**O que NÃO mudou:** tipografia (Inter + IBM Plex Mono, `tabular-nums` em todo
número), a geometria seca, profundidade por hairline de 1px, e a lista negra da
seção 7. A v5.0 troca os hexes, não a filosofia.

**Dois vocabulários de token convivem, de propósito:**
- `--color-*` — a API antiga, consumida por 100+ arquivos. Mantida.
- `--bg` `--surface` `--text` `--brand` `--ok` `--past`… — os nomes canônicos do
  handoff. **Use estes em código novo.** Os `--color-*` apontam para eles.

**Armadilha real:** `--muted` NÃO é cor de texto. Dentro do `:root` ele é a ponte
HSL do shadcn (`240 17% 95%`), e a última declaração vence. Para texto auxiliar
use `--text-muted`.

---

## 1. Identidade Visual

**Conceito:** instrumento de medição. Painel de dados denso, alinhado e frio.
**Palavra-chave:** confiança, rigor, organização, precisão.
**NÃO É:** papel envelhecido, ensaio editorial, SaaS colorido, dashboard com gradiente.

A referência é **um handoff só**: o design system **Provedor.AI**, na pele
**Razão** (fintech densa, número é o herói) com a voz do módulo **Consulta**
(verbo: *Decidir*, cor-herói berinjela).

O handoff vive em `Redesign Consulta ISP SaaS/handoff-consulta-isp/`:
`Consulta ISP.dc.html` é a referência viva da tela de Consulta ISP — HTML com
estilo inline por token, legível como spec. `SPEC-consulta-isp.md` é o texto.

Não misture uma segunda referência. As antigas (`stripe.md`, `intercom.md`,
`claude.md`) descrevem sistemas que este produto não usa mais.

### Duas derivações declaradas

Nem tudo saiu literal do handoff. Estas duas foram **derivadas**:

1. **Os valores são os do projeto, não os do handoff.** O handoff traz um neutro
   frio *azul* (família `--n-*`); o `index.css` usa um neutro frio *violeta*, que
   é o que ancora a berinjela como cor de marca em vez de acidente. Adotamos os
   **nomes** do handoff, não os hexes.
2. `--info` / `--now` `#3B6E96` — o azure do handoff (`#205AB8`) colidiria com
   `--wire`, o selo de proveniência "dado real do ERP". Escurecido e dessaturado
   para a família do projeto.

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
  apertado, não do peso.
- Label mono em caixa alta com tracking aberto — use o token `var(--track-wide)`
  (`0.06em`), 10px. Não crave o valor: kicker, pill e cabeçalho de tabela têm que
  abrir na mesma medida, senão dois estilos de label convivem no mesmo card.

> **Nota de fidelidade:** a pele Razão do handoff especifica **Inter** + **IBM Plex
> Mono**, e é exatamente o que o projeto carrega. A pele Linha (Manrope + JetBrains
> Mono) existe no handoff mas NÃO é usada aqui. Não troque de família sem revisar
> este documento.

---

## 3. Paleta

Uma cor de marca só (berinjela). Saturação apenas quando significa risco.
Os nomes curtos (`--brand`, `--ok`, `--past`…) são os canônicos; os `--color-*`
apontam para eles e existem só por compatibilidade.

### 3.1 Light (`:root`)

```css
:root {
  /* Superfícies — quatro níveis */
  --bg:             #F6F6F9;  /* canvas */
  --surface:        #FFFFFF;  /* card */
  --surface-2:      #FAFAFC;  /* card aninhado, cabeçalho de tabela */
  --surface-3:      #EAEAF0;  /* botão desabilitado, poço dentro de poço */
  --surface-inset:  #F1F1F5;  /* campo, poço, trilha de barra */

  /* Hairlines */
  --border-faint:   #F2F2F6;  /* separador interno */
  --border:         #EAEAF0;  /* estrutural */
  --border-strong:  #D9D9E2;  /* só input — precisa ler como área editável */

  /* Texto */
  --text:           #1F1D29;  /* quase-preto violeta */
  --text-2:         #45414F;
  --text-muted:     #6B6878;
  --text-faint:     #918EA0;  /* rótulo de grupo, metadata */
  --text-on-brand:  #FFFFFF;

  /* Marca / ação — berinjela, a cor-herói do módulo Consulta */
  --brand:          #4A4670;
  --action:         #4A4670;
  --action-hover:   #3C3860;
  --brand-soft:     #EDECF3;  /* item ativo de nav, chip de marca */
  --brand-ink:      #3A3658;  /* texto/ícone SOBRE --brand-soft */

  /* Semânticas — cada uma com par -bg e -border, todas AA sobre branco */
  --ok:      #1F7A4C;  --ok-bg:      #E6F3EC;  --ok-border:      #B9DECB;
  --gated:   #A9741B;  --gated-bg:   #FBF1DF;  --gated-border:   #E8D2A3;
  --past:    #8C2F39;  --past-bg:    #F9E8EA;  --past-border:    #E4BCC1;
  --danger:  #B3261E;  --danger-bg:  #FBE7E5;  --danger-border:  #F0C4BF;
  --info:    #3B6E96;  --info-bg:    #E9EFF5;  --info-border:    #C3D5E4;
  --now:     #3B6E96;  --now-bg:     #E9EFF5;  --now-border:     #C3D5E4;

  /* Proveniência do dado */
  --mock:    #6B6878;  --mock-bg:    #F1F1F5;  /* simulado */
  --wire:    #1F6F7A;  --wire-bg:    #E4F1F3;  /* real, vindo do ERP */

  /* Sinal de valor */
  --money-neg:      #8C2F39;  /* = --past. Todo número negativo. */

  /* Score — faixas espelhadas de server/utils/isp-score.ts */
  --score-high:     #1F7A4C;  /* 701-1000 */
  --score-medium:   #A9741B;  /* 501-700  */
  --score-low:      #8C2F39;  /* 301-500  */
  --score-critical: #B3261E;  /* 0-300    */

  /* Tracking e foco, por nome */
  --track-wide:     0.06em;   /* kicker, pill, label mono */
  --track-tight:    -0.02em;  /* título e nome de card */
  --overlay:        rgba(20, 19, 26, .48);
  --focus-ring:     0 0 0 3px rgba(74, 70, 112, .30);
}
```

> **Armadilha herdada:** os tokens `--ring-*` ainda se chamam *warm*, mas os
> valores são neutros. Leia o valor, não deduza pelo nome.

### 3.2 Dark (`.dark`)

Escuro com fundo violeta (`#131219`), não cinza neutro — é o que mantém a
berinjela coerente nos dois temas.

```css
.dark {
  --bg: #131219;  --surface: #1A1922;  --surface-2: #201F2A;  --surface-3: #2F2D3A;
  --border: #2F2D3A;  --border-strong: #423F51;  --border-faint: #24222D;
  --text: #ECEBF1;  --text-2: #C3C0CE;  --text-muted: #918DA1;  --text-faint: #78748A;
  --brand: #A9A2D8;  --action: #A9A2D8;  --brand-soft: #2A2740;  --brand-ink: #C5BFEA;
  --text-on-brand: #1A1922;  /* a marca clareia: o texto sobre ela escurece */
  --ok:     #58C48C;  --ok-bg:     #14301F;  --ok-border:     #235539;
  --gated:  #D9A441;  --gated-bg:  #332711;  --gated-border:  #57431D;
  --past:   #DE8A93;  --past-bg:   #331A1D;  --past-border:   #572E32;
  --danger: #F0716A;  --danger-bg: #351917;  --danger-border: #5A2C28;
  --info:   #7FA9CC;  --info-bg:   #1B2634;  --info-border:   #2C3E52;
  --overlay: rgba(0,0,0,.62);
  --focus-ring: 0 0 0 3px rgba(169, 162, 216, .38);
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
Escurecida e dessaturada para a família violeta do projeto e para passar AA sobre branco.

```css
--cat-blue:  #3B6E96;   --cat-indigo: #4A4670;  --cat-violet: #6A5C86;
--cat-teal:  #1F6F7A;   --cat-green:  #1F7A4C;  --cat-lime:   #63783A;
--cat-amber: #A9741B;   --cat-orange: #A85A2A;  --cat-red:    #B3261E;
--cat-pink:  #97456A;   --cat-slate:  #6B6878;  --cat-navy:   #35405C;
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
Escala: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80

Gap entre cards:         10–16px
Padding de card:         12px 14px  (denso) · 16px 20px (padrão)
Padding de seção:        24–32px
```

Densidade é uma decisão de produto: o operador escaneia muitas linhas por dia. Card
espaçoso demais reduz quantas linhas cabem na tela e piora o trabalho.

---

## 5. Geometria e Profundidade

### 5.1 Raio

```
Botões, inputs, badges:   4px   (rounded / rounded-sm)
Itens de navegação:       6px   (rounded-md)
Cards e containers:       8px   (rounded-lg)
Avatares, dots, spinners: 9999px (rounded-full — círculo real)
```

Canto seco é a identidade: *"near-rectangular, industrial and precise"*. Nada acima
de 8px. `rounded-full` em **badge de status** continua proibido.

### 5.2 Profundidade — borda, não sombra

Sombra mínima. Profundidade por cor de borda e tint de superfície.

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

.btn-primary { background: var(--color-brand); color: #fff; border: none; }
.btn-neutral { background: var(--color-ink); color: var(--color-surface); border: none; }
.btn-ghost   { background: var(--color-surface); color: var(--color-ink);
               box-shadow: 0 0 0 1px var(--ring-warm); }
```

Botão primário é **berinjela** (`--action`, mesmo valor de `--brand`). Uma cor só
ancora ação, link e estado ativo — é a voz do módulo Consulta no handoff. O token
`--primary` do shadcn aponta para ela, então todo `<Button>` já sai correto sem
classe extra.

`.btn-neutral` (navy) existe para ação secundária forte — exportar, sincronizar —
onde o roxo roubaria atenção do CTA principal da tela.

> **Correção da v4.0 inicial:** a primeira redação desta seção dizia "botão primário é
> navy, não roxo". Era regra inventada, não estava em nenhuma referência, e contradizia
> o `--primary` do próprio `index.css` — o app sempre renderizou roxo. Corrigido aqui.

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
| 1 | Classes da paleta default do Tailwind ainda espalhadas | 424 ocorrências em 29 arquivos |
| 2 | Gradientes `from-X to-Y` (subconjunto de #1) | ver `grep -rn "from-.* to-"` |
| 3 | ~110 erros de TypeScript pré-existentes | maioria em `server/*`, nenhum no client de consulta |
| 4 | Dark mode definido mas nunca ativado — falta o toggle | `next-themes` está nas deps |
| 5 | `CLAUDE.md` documenta `isp_consultations.score` como 0–100; é **0–1000** | corrigir na fonte |
| 6 | `consulta-spc.tsx` ainda no visual antigo (cards coloridos, abas em pill) | 1 tela |
| 7 | `utils.ts` da pasta consulta devolve classe Tailwind crua em 5 helpers | `getPaymentStatusColor`, `riskDecisionBadge`, `scoreColor`, `scoreBg`, `decisionCardStyle` |

A #1 não é trabalho de `sed`: cada ocorrência precisa de julgamento sobre o papel
(informativo, decorativo ou categórico). Deve ser feita tela a tela.

**Já quitado nesta versão:** a Consulta ISP inteira (formulário, estado ocioso,
loading, modal LGPD, relatório e as 5 abas) foi reescrita em token puro contra o
handoff. As primitivas vivem em `client/src/components/consulta/report-ui.tsx` —
reaproveite-as antes de escrever card, pill ou kicker novo.

---

*Versão 5.0 · Consulta ISP · base: `client/src/index.css` + handoff Provedor.AI (pele Razão · voz Consulta)*
