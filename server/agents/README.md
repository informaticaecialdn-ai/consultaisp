# server/agents/

**Camada de orquestração para os 10 funcionários digitais do Provedor.ai.**

Os agentes operacionais são hospedados na **plataforma da Anthropic** (https://platform.claude.com/workspaces/default/agents). Este diretório NÃO contém os prompts em runtime — contém:

- **Orquestrador stateless** (`orchestrator.ts`): roteia eventos para o agente certo, executa pre-flight checks, gates regulatórios, escalação humana
- **Integração com Anthropic API**: clientes para invocar agentes e tools
- **Webhook handlers de agentes**: recebem callbacks da plataforma quando agente finaliza ação
- **Pre-flight checks**: óbito (via Unitfour), VIP, vulnerabilidade, ticket aberto, horário CDC, etc.
- **Schema de mensagens** entre orquestrador e agentes

## Os 10 Funcionários (canônico TEAM.md)

| # | Nome | Cargo | Modelo | Stack |
|---|---|---|---|---|
| 1 | **Marcos** | Gerente de Operações (Score & Decisão) | Opus 4.7 | Managed Agents |
| 2 | **Júlia** | Analista de Conformidade (Compliance) | Haiku 4.5 | Direct API (<500ms) |
| 3 | **Bruno** | Lembrador Sênior (Preventivo D-7→D0) | Haiku 4.5 | Direct API |
| 4 | **Helena** | Atendente Master (Reativo 24/7 inbound) | Sonnet 4.6 | Direct API |
| 5 | **Rafael** | Negociador (D+1→D+14) | Sonnet 4.6 | Direct API |
| 6 | **Carla** | Especialista Suspensão & Reconexão (D+15→D+60) | Sonnet 4.6 | Direct API |
| 7 | **Daniel** | Cobrador Sênior (Recuperação D+60+) | Opus 4.7 | Managed Agents |
| 8 | **Lucas** | Logística Reversa (Equipamentos) | Sonnet 4.6 | Managed Agents |
| 9 | **Sofia** | Customer Care (Agradecimento pós-pagamento) | Haiku 4.5 | Direct API |
| 10 | **Pedro** | Pesquisa & Insights (NPS) | Sonnet 4.6 | Managed Agents |

System prompts versionados em [`../prompts/`](../prompts/) como source-of-truth.

Veja `docs/TEAM.md` (a copiar para `docs/`) ou referência completa em `C:\Provedor.ai\Ecossistema\TEAM.md`.
