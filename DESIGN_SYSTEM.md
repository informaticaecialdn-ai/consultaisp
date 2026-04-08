# DESIGN SYSTEM — Consulta ISP / Produção Fácil
> Leia este arquivo ANTES de gerar qualquer componente, tela ou estilo.
> Qualquer desvio dos tokens abaixo é inaceitável.

---

## 1. Identidade Visual

**Conceito:** Finança editorial europeia. Pense no FT (Financial Times) ou Bloomberg — não no Material Design, não no Tailwind UI padrão.  
**Palavra-chave:** confiança, dados, precisão, sobriedade.  
**NÃO É:** startup colorida, SaaS genérico, dashboard "moderno com gradiente".

---

## 2. Tipografia

```
Display / Títulos grandes:  Fraunces, serif, weight 300 (light) ou 600 (semibold)
                             Use itálico para ênfase emocional: <em>
Headings internos:          Fraunces, weight 600, 14–18px
Body / Parágrafos:          DM Sans, weight 400, 14px, line-height 1.6
Dados / Códigos / Labels:   DM Mono, weight 400 ou 500, 10–13px
```

**Import (Google Fonts):**
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,600;1,300&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
```

**Tailwind (se usando):** Adicione ao `tailwind.config.js`:
```js
fontFamily: {
  display: ['Fraunces', 'serif'],
  body: ['DM Sans', 'sans-serif'],
  mono: ['DM Mono', 'monospace'],
}
```

---

## 3. Paleta de Cores

### CSS Variables (cole no `:root`)
```css
:root {
  --color-bg:         #F9F7F4;  /* fundo geral — quente, não branco puro */
  --color-surface:    #FFFFFF;  /* cards, modais */
  --color-border:     #E2DDD6;  /* bordas — 0.5px solid */
  
  --color-ink:        #1A1714;  /* texto principal */
  --color-muted:      #6B6560;  /* texto secundário, labels */
  --color-tag-bg:     #EEE9E0;  /* fundo de pills neutras */

  --color-navy:       #1A3A5C;  /* primário — CTA, links, scores altos */
  --color-steel:      #2C5F8A;  /* primário claro — hover states */
  --color-gold:       #B8860B;  /* atenção, pendente, aviso */
  --color-danger:     #8B1A1A;  /* erro, inadimplente, negativado */
  --color-success:    #1A4A2E;  /* ativo, regularizado, ok */

  /* Fundos semânticos */
  --color-navy-bg:    #EAF0F8;
  --color-gold-bg:    #F5EDD4;
  --color-danger-bg:  #F5E8E8;
  --color-success-bg: #E4EEE8;
}
```

### Mapa de uso
| Situação              | Cor                          |
|-----------------------|------------------------------|
| Score alto (700–1000) | `--color-navy`               |
| Score médio (400–699) | `--color-gold`               |
| Score baixo (0–399)   | `--color-danger`             |
| Status: ativo         | `--color-success`            |
| Status: inadimplente  | `--color-danger`             |
| Status: pendente      | `--color-gold`               |
| Status: novo          | `--color-navy`               |
| Labels / metadata     | `--color-muted`              |

---

## 4. Espaçamento e Layout

```
Base unit: 4px
Escala: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64px

Gap entre cards:         16px (1rem)
Padding interno de card: 16px 20px (1rem 1.25rem)
Padding de seção:        32px (2rem)
```

---

## 5. Bordas e Cantos

```css
/* Cards e containers */
border: 0.5px solid var(--color-border);
border-radius: 4px;  /* NÃO use rounded-xl (16px+) */

/* Inputs */
border: 0.5px solid var(--color-border);
border-radius: 2px;

/* Buttons */
border-radius: 2px;

/* Score bar / progress */
border-radius: 2px;
height: 4px;

/* Badges */
border-radius: 2px;  /* NÃO use pill/rounded-full para badges de status */
```

---

## 6. Componentes

### Card de Métrica
```html
<div class="metric-card">
  <span class="metric-label">Score ISP</span>
  <div class="metric-number">742</div>
  <div class="score-bar">
    <div class="score-fill" style="width: 74.2%"></div>
  </div>
</div>
```
```css
.metric-card { background: var(--color-surface); border: 0.5px solid var(--color-border); border-radius: 4px; padding: 1rem 1.25rem; }
.metric-label { font-family: 'DM Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); }
.metric-number { font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 500; color: var(--color-navy); margin: 8px 0 4px; }
.score-bar { height: 4px; background: var(--color-tag-bg); border-radius: 2px; overflow: hidden; }
.score-fill { height: 100%; background: var(--color-navy); border-radius: 2px; }
```

### Badge de Status
```css
.badge {
  display: inline-flex; align-items: center;
  font-family: 'DM Mono', monospace; font-size: 10px;
  letter-spacing: 0.06em; font-weight: 500;
  padding: 3px 8px; border-radius: 2px;
}
.badge-navy    { background: var(--color-navy-bg);    color: var(--color-navy);    }
.badge-gold    { background: var(--color-gold-bg);    color: var(--color-gold);    }
.badge-danger  { background: var(--color-danger-bg);  color: var(--color-danger);  }
.badge-success { background: var(--color-success-bg); color: var(--color-success); }
```

### Botões
```css
.btn {
  font-family: 'DM Mono', monospace; font-size: 11px;
  letter-spacing: 0.06em; padding: 8px 16px;
  border-radius: 2px; cursor: pointer; border: 0.5px solid;
  transition: all 0.15s ease;
}
.btn-primary   { background: var(--color-navy);    color: #fff; border-color: var(--color-navy); }
.btn-secondary { background: transparent; color: var(--color-navy); border-color: var(--color-navy); }
.btn-ghost     { background: transparent; color: var(--color-muted); border-color: var(--color-border); }
```

### Tabela de Dados
```css
.ds-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ds-table th {
  font-family: 'DM Mono', monospace; font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-muted); text-align: left;
  padding: 8px 12px; border-bottom: 0.5px solid var(--color-border);
}
.ds-table td { padding: 10px 12px; border-bottom: 0.5px solid var(--color-border); }
.ds-table tr:last-child td { border-bottom: none; }
```

### Input
```css
.ds-input {
  font-family: 'DM Sans', sans-serif; font-size: 13px;
  padding: 8px 12px; width: 100%;
  border: 0.5px solid var(--color-border); border-radius: 2px;
  background: var(--color-surface); color: var(--color-ink);
  outline: none; transition: border-color 0.15s;
}
.ds-input:focus { border-color: var(--color-navy); }
```

### Section Label (separador de seção)
```css
.section-label {
  font-family: 'DM Mono', monospace; font-size: 10px;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--color-muted); margin-bottom: 1rem;
  padding-bottom: 0.5rem; border-bottom: 0.5px solid var(--color-border);
}
```

---

## 7. Tailwind — Customizações obrigatórias

Se o projeto usar Tailwind, adicione ao `tailwind.config.js`:

```js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        navy:    { DEFAULT: '#1A3A5C', light: '#2C5F8A', bg: '#EAF0F8' },
        gold:    { DEFAULT: '#B8860B', bg: '#F5EDD4' },
        danger:  { DEFAULT: '#8B1A1A', bg: '#F5E8E8' },
        success: { DEFAULT: '#1A4A2E', bg: '#E4EEE8' },
        ink:     '#1A1714',
        muted:   '#6B6560',
        border:  '#E2DDD6',
        surface: '#FFFFFF',
        canvas:  '#F9F7F4',
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',
        lg: '6px',   /* máximo permitido */
      },
      borderWidth: {
        DEFAULT: '0.5px',
      },
    },
  },
}
```

**Classes Tailwind proibidas:**
- `rounded-xl`, `rounded-2xl`, `rounded-full` (exceto avatares circulares)
- `shadow-lg`, `shadow-xl`, `drop-shadow-*`
- `font-sans` (use `font-body`), `font-mono` do Tailwind padrão (use `font-mono` customizado)
- Qualquer gradiente com roxo ou azul puro: `from-purple-*`, `from-blue-400`

---

## 8. Anti-Padrões — Lista Negra

```
FONTES PROIBIDAS:
  ✗ Inter, Roboto, Arial, system-ui, -apple-system
  ✗ Space Grotesk, Poppins, Nunito, Outfit

CORES PROIBIDAS:
  ✗ #6366f1 (indigo Tailwind)
  ✗ #8b5cf6 (violet Tailwind)
  ✗ Qualquer gradiente purple-to-blue
  ✗ Fundo #0f172a (slate 900 genérico)

BORDAS/CANTOS PROIBIDOS:
  ✗ border-radius > 6px em cards de dados
  ✗ box-shadow com blur > 4px
  ✗ border: 1px (use 0.5px)

PADRÕES DE LAYOUT PROIBIDOS:
  ✗ "Hero section" com gradiente de fundo
  ✗ Cards flutuando com shadow-xl
  ✗ Botões com gradiente
  ✗ Ícones emoji decorativos inline
  ✗ Progress bars com border-radius arredondado (pill)
  ✗ Avatares com ring colorido (use border 0.5px simples)

SEMÂNTICA PROIBIDA:
  ✗ Usar verde para qualquer coisa diferente de "sucesso/ativo/positivo"
  ✗ Usar vermelho decorativamente
  ✗ Badge com padding excessivo (> 4px 10px)
```

---

## 9. Tom de Voz da Interface

Os textos da UI devem seguir:
- **Labels de campo:** substantivos diretos em minúsculas — `cpf do assinante`, `score atual`, `data de vencimento`
- **Mensagens de erro:** afirmativas e úteis — `CPF não encontrado no sistema` (não: `Erro 404`)
- **CTAs:** verbos no infinitivo — `Consultar`, `Ver histórico`, `Exportar relatório`
- **Headers de seção:** caixa baixa com separador — `histórico de negativações`
- **NÃO USE:** exclamações (`Dados salvos com sucesso!`), jargão técnico exposto (`Error: null reference`), linguagem de startup (`Turbine seus resultados!`)

---

## 10. Como usar este arquivo no Claude Code

1. **Coloque este arquivo na raiz do projeto** como `DESIGN_SYSTEM.md`
2. **No `CLAUDE.md`**, adicione na seção de contexto:
   ```
   ## Design
   Leia @DESIGN_SYSTEM.md antes de criar qualquer componente, página ou estilo.
   Não desvie dos tokens definidos lá.
   ```
3. **Ao pedir um componente**, referencie explicitamente:
   ```
   Crie o componente de card de score seguindo @DESIGN_SYSTEM.md.
   Não use classes Tailwind da lista negra da seção 8.
   ```

---

*Versão: 1.0 · Projeto: Consulta ISP / Produção Fácil · Londrina, PR*
