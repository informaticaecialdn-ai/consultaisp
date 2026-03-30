# Phase 1: Security & Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 01-security-cleanup
**Areas discussed:** Secrets handling, Replit cleanup scope, Build validation

---

## Secrets Handling

### Q1: N8N URLs hardcoded — what to do now?

| Option | Description | Selected |
|--------|-------------|----------|
| Mover para env var | Criar N8N_PROXY_URL como env var. Funciona como fallback ate Phase 5. | ✓ (interpreted) |
| Remover agora | Deletar as refs N8N ja nesta fase. Heatmap via N8N para de funcionar. | |
| Comentar com TODO | Comentar URLs com TODO: remove in Phase 5 | |

**User's choice:** "quero trocar o N8N por uma integracao nativa no sistema, substituir o N8N por codigo proprietario do sistema, nao sei como vai fazer isso mas preciso que nao use mais o N8N"
**Notes:** User wants full N8N replacement (Phases 4-5). For Phase 1, interpreted as move to env var as interim security fix.

### Q2: Other hardcoded secrets?

| Option | Description | Selected |
|--------|-------------|----------|
| So N8N que eu saiba | Pesquisar o codigo para encontrar outros | |
| Sim, tem mais | Deixa eu listar | |
| You decide | Claude pesquisa e resolve | ✓ |

**User's choice:** You decide
**Notes:** Claude will scan for additional hardcoded secrets.

---

## Replit Cleanup Scope

### Q1: Which Replit artifact layers to clean?

| Option | Description | Selected |
|--------|-------------|----------|
| client/replit_integrations/ | Audio, chat integracoes Replit frontend | ✓ (voce decide) |
| server/replit_integrations/ | Audio, batch, chat, image backend | ✓ (voce decide) |
| .local/ e .config/replit/ | Skills, semgrep, artifacts Replit Agent | ✓ (voce decide) |
| attached_assets/ | Prompts e assets colados no Replit | ✓ (voce decide) |

**User's choice:** "voce decide" — Claude has discretion on full scope
**Notes:** User deferred to Claude for exact cleanup scope.

### Q2: Remove Replit packages from package.json?

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, remover tudo | Remove 3 @replit packages + vite.config.ts refs | ✓ |
| Manter por seguranca | Nao mexer nas deps | |

**User's choice:** Sim, remover tudo (Recommended)

---

## Build Validation

### Q1: How to validate cleanup?

| Option | Description | Selected |
|--------|-------------|----------|
| tsc + build | npm run check + npm run build | ✓ |
| Apenas tsc | So verificar tipagem | |
| Build + smoke test | Build + verificar paginas no browser | |

**User's choice:** tsc + build (Recommended)

---

## Claude's Discretion

- Exact Replit artifact removal scope
- Additional hardcoded secrets scan
- Price unification strategy (not discussed — deferred to Claude)

## Deferred Ideas

None
