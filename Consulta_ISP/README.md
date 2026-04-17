# Consulta ISP

Workspace do ecossistema Consulta ISP. Contem atualmente o subprojeto de agentes
de IA de vendas; documentacao historica e configuracoes dos agentes ficam em `docs/`.

## Layout

```
Consulta_ISP/
|-- agentes-sistema/        # Servico de agentes (Node + SQLite + Docker)
|-- docs/
|   |-- historico/          # Prompts, auditorias e planos antigos
|   `-- agentes-config/     # JSONs de configuracao por agente
`-- dist/                   # Artefatos legados (vai sumir quando pipeline novo rodar)
```

## Subprojeto: agentes-sistema

Sistema multi-agente (Sofia, Leo, Carlos, Lucas, Rafael, Marcos, Diana) que opera
o funil comercial via WhatsApp / Instagram / Email. Stack: Node.js, Express,
better-sqlite3, Anthropic SDK, Z-API.

### Dev rapido

```bash
cd agentes-sistema
cp .env.modelo .env      # preencher credenciais
npm install
node src/server.js       # sobe em http://localhost:3001
```

Deploy em producao e containerizado com Docker Compose + Caddy; consulte
`agentes-sistema/RUNBOOK-DEPLOY.md` para o passo a passo.

## Referencias

- Planos recentes: `../docs/superpowers/plans/`
- Especificacoes de design: `../docs/superpowers/specs/`
- Documentacao historica (pre-refactor): `docs/historico/`
