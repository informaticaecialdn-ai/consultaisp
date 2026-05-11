# Consulta ISP

## What This Is

SaaS multi-tenant de analise de credito colaborativa para provedores regionais de internet (ISPs) no Brasil. Funciona como um bureau de credito especializado em telecom — provedores compartilham dados de inadimplencia (mascarados por LGPD) para minimizar calotes, fraudes por migracao serial e perdas de equipamentos. Similar ao Serasa/SPC, mas focado exclusivamente no setor ISP.

## Core Value

Permitir que um provedor consulte o CPF/CNPJ de um potencial cliente e receba em 2 segundos um score de risco baseado no historico colaborativo de toda a rede de provedores — evitando o calote antes que aconteca.

## Requirements

### Validated

- ✓ Motor de score ISP (0-100) com penalidades e bonus — existing
- ✓ Consulta ISP com historico de rede e recomendacao Aprovar/Rejeitar — existing
- ✓ Consulta SPC integrada (score 0-1000) — existing
- ✓ Consulta em lote (ate 500 CPFs via CSV) — existing
- ✓ Sistema anti-fraude com 4 tipos de alerta — existing
- ✓ Deteccao de migradores seriais — existing
- ✓ Dashboard com KPIs (inadimplentes, valor em aberto, equipamentos) — existing
- ✓ Mapa de calor geografico de inadimplencia (Leaflet) — existing
- ✓ Gestao de clientes com importacao CSV — existing
- ✓ Controle de equipamentos retidos/recuperados — existing
- ✓ Sistema de creditos ISP/SPC com pacotes de compra — existing
- ✓ Pagamento via Asaas (PIX/Boleto) — existing
- ✓ Auth multi-tenant com sessoes (providers como tenants) — existing
- ✓ 3 roles: user, admin, superadmin — existing
- ✓ Mascaramento LGPD de dados entre provedores (nome parcial, faixa de valor, rua sem numero) — existing
- ✓ Analise IA de risco com streaming (OpenAI gpt-4o-mini) — existing
- ✓ Landing page com proposta de valor e planos — existing
- ✓ Suporte via chat provedor ↔ admin — existing
- ✓ Chatbot para visitantes da landing page — existing
- ✓ Verificacao de email e KYC de documentos — existing
- ✓ Painel superadmin com gestao de provedores, financeiro, creditos — existing
- ✓ Integracao ERP parcial via N8N (IXC Soft) — existing
- ✓ Scheduler de auto-sync ERP (30 min) — existing
- ✓ Notificacoes (WhatsApp, email, SMS, push) — existing
- ✓ Gestao de socios/parceiros — existing
- ✓ Subdominio por provedor — existing
- ✓ Planos: Gratuito, Basico (R$149), Profissional (R$349) — existing

### Active (Milestone v2.0 — Consulta Tempo Real Regional)

- [ ] Redesenhar consulta ISP para busca em tempo real nos ERPs regionais
- [ ] Adicionar campo de regiao/cidades atendidas no cadastro de provedores
- [ ] Busca paralela em multiplos ERPs por regiao ao consultar CPF
- [ ] Remover scheduler de sync e armazenamento centralizado de clientes
- [ ] Implementar cache curto (5-10 min) por CPF consultado
- [ ] Busca por endereco em tempo real (CEP/logradouro) cruzando ERPs regionais
- [ ] Deteccao de migradores seriais em tempo real (CPF consultado + contrato cancelado)
- [ ] Manter layout de resultado igual ao Replit (score, LGPD mask, condicoes, analise IA)
- [ ] Refinar UI admin de integracoes ERP (remover N8N completamente)

### Out of Scope

- API publica documentada para integracoes customizadas — v2, foco atual e estabilizar o core
- App mobile nativo — web responsivo e suficiente por enquanto
- Integracao com bureaus de credito alem do SPC — complexidade regulatoria
- Multi-idioma — publico e exclusivamente brasileiro

## Context

- **Origem:** Sistema construido no Replit com IA, funcional mas com codigo monolitico e dependencias de plataforma
- **Estagio:** Beta com provedores em teste, nenhum em producao real ainda
- **Dominio:** Bureau de credito telecom — regulado por LGPD, dados sensiveis de inadimplencia
- **Mercado:** ~15.000 ISPs regionais no Brasil, dor real de calote por migracao serial
- **Monetizacao:** Creditos por consulta (ISP R$0,70-1,00/un, SPC R$3,50-4,99/un) + assinatura mensal
- **Stack:** Express 5 + React 18 + PostgreSQL + Drizzle ORM + Tailwind/shadcn + Vite 7
- **Integracao atual:** N8N como proxy para ERPs (especialmente IXC) — precisa ser eliminado
- **Mascaramento LGPD existente:** Nome parcial (Eduardo xxxx), valor em faixa (R$100-R$120), endereco sem numero, provedor credor visivel
- **ERPs do mercado ISP:** IXC Soft (maior), MK Solutions, SGP, Hubsoft, Voalle, RBX ISP, TopSApp, RadiusNet, Gere, Receita Net, entre outros

## Constraints

- **LGPD:** Dados de inadimplencia entre provedores devem ser mascarados — nome parcial, faixa de valor, endereco sem numero. Nenhum dado pessoal completo exposto entre tenants.
- **Multi-tenant:** Isolamento absoluto por providerId em toda query e toda tabela.
- **Schema:** Nao modificar shared/schema.ts sem autorizacao explicita.
- **Qualidade > Velocidade:** Sem deadline, fazer direito. Mudancas incrementais, uma feature por vez.
- **Portugues BR:** Interface, erros e nomes de dominio em portugues.
- **Padrao existente:** Usar mesmos patterns do codebase (Drizzle via storage, TanStack Query, shadcn/ui).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Substituir N8N por conectores ERP diretos | N8N e ponto de falha unico e adiciona latencia. Chamadas diretas dao mais controle e confiabilidade | — Pending |
| Modularizar routes.ts por dominio | 4350 linhas e inmantenivel. Modulos: auth, consultas, erp, admin, financeiro, etc. | — Pending |
| Migrar para VPS/Docker | Replit limita controle de infra, IP fixo para ERPs, e caro em escala | — Pending |
| Manter mascaramento LGPD no estilo bureau de credito | Mostrar score + dados parciais equilibra utilidade vs privacidade. Modelo similar ao Serasa | — Pending |
| Cobrir todos os ERPs de ISP do mercado brasileiro | Quanto mais ERPs suportados, maior a rede colaborativa e o valor do produto | ✓ Good |
| Consultas em tempo real, sem armazenamento centralizado | Provedores nao confiam em base externa. Volume inviavel. Negocio e regional | — Pending |
| Regionalizacao por cidade/area de cobertura | Clientes migram dentro da regiao, nao nacionalmente. Busca regional e o que faz sentido | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-29 after initialization*
