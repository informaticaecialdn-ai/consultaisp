# Spec 006 — Rebrand Cosmético `Consulta ISP → Provedor.ai`

**Status:** Draft → In Progress
**Duração estimada:** 1-2 semanas
**Depende de:** Nada (pode rodar isolado)
**Bloqueia:** Spec 007 (sidebar nova com nova marca)

## Objetivo

Trocar identidade visual de "Consulta ISP" para "Provedor.ai" **sem mexer em arquitetura, rotas ou domínio**. Resolve o gap entre a marca canônica documentada em `C:\Provedor.ai\Ecossistema\{TEAM.md, DESIGN.md}` e o código atual que ainda exibe "Consulta ISP" em ~50 locais do `client/src/`.

## Distinção fundamental (regra que rege todas as decisões)

| Termo | Refere a | Decisão de rebrand |
|-------|---------|-------------------|
| **Provedor.ai** | Plataforma SaaS / marca-mãe / produto vendido a ISPs | **Aparece em**: header sidebar, login, landing, footer, emails transacionais, PDFs de fatura, og:title, chat de suporte |
| **Consulta ISP** | Módulo interno: rede colaborativa de credit bureau ISP. Um dos módulos da plataforma Provedor.ai. | **Mantém o nome** em: rota `/consulta-isp`, página da consulta, tipo de crédito (créditos ISP), nome do produto interno em comparativos, footer mencionando "rede colaborativa Consulta ISP" |
| **`consultaisp.com.br`** | Domínio de produção atual (subdomínios dos tenants) | **Mantém em uso** — migração para `provedor.ai` é decisão fora desta spec |

## Não-objetivos (fora de escopo)

- Mudança de rotas (`/consulta-isp` continua existindo)
- Mudança de domínio (`{tenant}.consultaisp.com.br` continua válido)
- Reorganização de sidebar (isso é Spec 007)
- Schema de banco (nenhuma migration nesta spec)
- Refactor visual de componentes shadcn (mantém base color neutral)
- Renomeação de tabelas, services, types TypeScript no servidor

## User Stories

**US-001 — Visitante na landing page** vê marca "Provedor.ai" como produto principal, com "Consulta ISP" mencionado apenas como módulo dentro do catálogo de features.

**US-002 — Operador faz login** vê "Provedor.ai" no header do formulário e no email de verificação. Footer mostra "Provedor.ai" como nome da plataforma.

**US-003 — Operador autenticado** vê "Provedor.ai" no header da sidebar e como wordmark superior. Item de menu "Consulta ISP" (módulo) continua presente apontando para `/consulta-isp`.

**US-004 — Cliente final recebe PDF de fatura** com cabeçalho "Provedor.ai" e descrição "Licenciamento SaaS — Provedor.ai".

**US-005 — Admin/superadmin** vê textos do `/admin-sistema` referenciando "Provedor.ai" como nome da plataforma (não mais "Consulta ISP").

**US-006 — Operador acessa página do módulo Consulta ISP** continua vendo título "Consulta ISP" + descrição "rede colaborativa de risco". Esse é o NOME do módulo, mantém.

## Sucesso (critérios mensuráveis)

- [ ] `grep -r "Consulta ISP" client/src/pages/auth client/src/pages/public/landingpage.tsx client/src/components/{app-sidebar,chat-widget,landing-chatbot}.tsx` retorna **0 ocorrências** (essas áreas falam da marca)
- [ ] `grep -r "Consulta ISP" client/src/pages/consulta/ client/src/components/consulta/` retorna **mantém ocorrências** (essas áreas falam do módulo — devem manter)
- [ ] `client/index.html` `<title>` = "Provedor.ai — Plataforma de Cobrança Inteligente para ISPs"
- [ ] `client/src/styles/tokens.css` tem paleta verde-floresta adicionada (`--color-green-700`, `--color-green-500`, `--color-green-100`) mantendo navy/gold/cream antigos como ALIAS
- [ ] Login em ambiente local → screenshot mostra "Provedor.ai" no header
- [ ] Sidebar abre → header diz "Provedor.ai"; item de menu "Consulta ISP" continua presente
- [ ] PDF de fatura (`invoice-view.tsx`) gera cabeçalho "Provedor.ai"
- [ ] Nenhum teste e2e/typescheck regride

## Edge cases

- **EC-1:** Subdomínio do tenant mostra "{nome}.consultaisp.com.br" em painel admin — manter (domínio real). Apenas mudar quando migração de domínio formal acontecer.
- **EC-2:** Email transacional Resend usa template HTML separado — incluir nessa spec se templates estiverem no repo, senão deixar como tarefa de follow-up.
- **EC-3:** Logo SVG — não temos final ainda. Usar **placeholder wordmark Fraunces** "Provedor.ai" com cor `--color-green-700`. Quando logo final chegar, troca o arquivo SVG sem mudar código.
- **EC-4:** Páginas `/consulta-isp`, `/consulta-spc`, `/anti-fraude` mantêm seus títulos atuais — são nomes de módulos/features, não da marca.

## Referências canônicas

- DESIGN.md §3.1 — paleta de cores verde-floresta + navy + ambar + cream
- DESIGN.md §3.2 — tipografia Fraunces (display) + DM Sans (body) — **já carregada** em `client/index.html:11`
- TEAM.md §1.4 — pitch "Provedor.ai" + identidade verbal
- CLAUDE.md §1 — Pivot 2026-05-11 confirmado para Provedor.ai

## Plano de execução

Ver [tasks.md](./tasks.md). 4 batches sequenciais com critério de aprovação entre cada.
