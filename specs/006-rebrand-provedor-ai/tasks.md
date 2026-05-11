# Tasks — Spec 006 Rebrand

4 batches sequenciais. Cada batch encerra com checkpoint visual antes de seguir.

---

## Batch 1 — Tokens + Spec docs (zero risco, aditivo)

- [ ] T1.1 — `client/src/styles/tokens.css`: adicionar paleta verde-floresta como NOVOS tokens (sem remover navy/gold/cream existentes). Verde da DESIGN.md §3.1.
- [ ] T1.2 — `client/src/styles/tokens.css`: trocar comentário cabeçalho "Consulta ISP" → "Provedor.ai"
- [ ] T1.3 — Criar `client/src/components/brand/wordmark.tsx`: componente `<ProvedorAiWordmark />` em Fraunces. Tamanhos `sm`/`md`/`lg`. Usado como placeholder até logo SVG final.

**Checkpoint:** Visual no `/` (landing) e `/login` continua idêntico (tokens novos não foram aplicados ainda). `npm run check` passa.

---

## Batch 2 — Marca em superfícies públicas (landing, login, sidebar, chat)

- [ ] T2.1 — `client/index.html`: `<title>` = "Provedor.ai — Plataforma de Cobrança Inteligente para ISPs". `<meta name="description">` atualizada.
- [ ] T2.2 — `client/src/pages/public/landingpage.tsx`: header (linha 49), footer (linha 504, 514) → "Provedor.ai". **Mantém** o card de feature "Consulta ISP" (linha 257) — módulo. **Mantém** linha 340/403 (comparativo de features menciona Consulta ISP como produto interno).
- [ ] T2.3 — `client/src/pages/auth/login.tsx`: header (322), referência email (398), footer ano (763) → "Provedor.ai".
- [ ] T2.4 — `client/src/pages/auth/verificar-email.tsx`: header (78) → "Provedor.ai".
- [ ] T2.5 — `client/src/components/app-sidebar.tsx`: header sidebar (289, 335) → "Provedor.ai". **Mantém** item de menu "Consulta ISP" (linha 82) — é o nome do módulo.
- [ ] T2.6 — `client/src/components/chat-widget.tsx`: "Suporte Consulta ISP" (111) → "Suporte Provedor.ai".
- [ ] T2.7 — `client/src/components/landing-chatbot.tsx`: header chat (175) e atendimento (294) → "Provedor.ai".
- [ ] T2.8 — `client/src/pages/admin/admin-sistema.tsx`: mensagem de erro acesso (59) "sistema Consulta ISP" → "plataforma Provedor.ai".

**Checkpoint:** Login + landing + sidebar visualmente já dizem "Provedor.ai". Página `/consulta-isp` continua exibindo "Consulta ISP" (módulo intocado). `npm run check` passa.

---

## Batch 3 — Documentos emitidos (PDF fatura + emails)

- [ ] T3.1 — `client/src/pages/public/invoice-view.tsx`: cabeçalho (108), domínio mostrado (112, 127), descrição (186, 191, 196) → "Provedor.ai". Esses são documentos legais — atenção ao tom.
- [ ] T3.2 — `client/src/pages/financeiro/nfse.tsx`: descrição default (78, 234) "Licenciamento SaaS - Consulta ISP" → "Licenciamento SaaS - Provedor.ai".
- [ ] T3.3 — `client/src/components/consulta/PdfReportGenerator.ts`: título relatório (34), h1 (58), footer (98) → marca "Provedor.ai" como plataforma, **mantém subtítulo "Consulta ISP — Relatório de Crédito"** (nome do produto/módulo gerador do PDF).
- [ ] T3.4 — User-Agent strings: `mapa-calor.tsx:162`, `AddressMapMini.tsx:59,74,89` → `Provedor.ai/1.0` (cosmético, sem impacto funcional).

**Checkpoint:** Gerar PDF de fatura local → cabeçalho diz "Provedor.ai", corpo refere "plataforma Provedor.ai". Gerar PDF de Consulta ISP → cabeçalho diz "Provedor.ai", subtítulo "Consulta ISP — Relatório de Crédito".

---

## Batch 4 — Painel provedor + Servidor (textos diversos)

- [ ] T4.1 — `client/src/pages/provedor/painel-provedor.tsx:1243,1246,1279`: "Seu Subdomínio no Consulta ISP" → "Seu Subdomínio no Provedor.ai", "plataforma Consulta ISP" → "plataforma Provedor.ai", "funcionalidades do Consulta ISP" → "funcionalidades do Provedor.ai". **Mantém** linha 1436 "(Consulta ISP rede colaborativa: 1 crédito)" — fala do produto/módulo.
- [ ] T4.2 — `client/src/pages/provedor/creditos.tsx:223,295`: "para Consulta ISP" mantém (descreve uso do crédito no módulo).
- [ ] T4.3 — `server/services/*` (a pesquisar): se houver textos hardcoded "Consulta ISP" em emails enviados pelo Resend → atualizar.
- [ ] T4.4 — Validação final: `npm run check` (tsc) + `npm run build` passam sem erro. Smoke-test manual: login → dashboard → consulta-isp (módulo) → consulta-spc → /admin-sistema. Capturar 3 screenshots antes/depois.

**Checkpoint final:** Spec encerra. Atualizar plan file mestre marcando Fase 1 como ✅. Commit message: `feat(spec006): rebrand Consulta ISP → Provedor.ai (marca; módulo preservado)`.

---

## Pontos a NÃO tocar nesta spec

- Rota `/consulta-isp` no `App.tsx` (linha 79) — é rota, não marca
- Lazy import `ConsultaISPPage` (App.tsx:20) — nome técnico
- `client/src/lib/subdomain.ts:1` `MAIN_DOMAIN = "consultaisp.com.br"` — domínio real
- `client/src/pages/provedor/painel-provedor.tsx:24` mesmo
- Strings de domínio em UI (`{subdomain}.consultaisp.com.br`) em admin tabs e wizard — é o domínio operacional
- Página `/consulta-isp` (`consulta-isp.tsx`) e seus componentes (`ConsultaInfoTab`, `ConsultaSearchBar`) — esse é o módulo
- Tipos de crédito "ISP" em `/creditos` e admin — categoria de produto, não marca

---

## Risco / Mitigação

| Risco | Mitigação |
|-------|-----------|
| Quebra visual de página devido a token CSS mal aplicado | Batch 1 é ADITIVO — adiciona variáveis novas sem remover antigas |
| Confusão entre marca e módulo gera texto inconsistente | Tasks têm anotação explícita "Mantém" em cada local que se refere ao MÓDULO |
| Build TS falha por algum import quebrado | `npm run check` ao fim de cada batch |
| HSM Meta tem template em nome de "Consulta ISP" | Fora do escopo desta spec — decisão paralela no trilho HSM |
