# server/prompts/

**Source-of-truth dos system prompts dos 10 funcionários digitais.**

⚠️ **Estes arquivos NÃO são carregados em runtime.** Os agentes operacionais
são hospedados na **plataforma da Anthropic** (https://platform.claude.com/workspaces/default/agents).
O conteúdo aqui é a versão CANÔNICA dos prompts — copiado/colado na UI da
plataforma quando criamos ou atualizamos um agente.

## Convenção

- Um arquivo `.md` por agente: `marcos.md`, `julia.md`, `bruno.md`, `helena.md`,
  `rafael.md`, `carla.md`, `daniel.md`, `lucas.md`, `sofia.md`, `pedro.md`
- Frontmatter YAML com metadados:
  ```yaml
  ---
  agent_id: agt_negociador_v1
  agent_name: Rafael
  cargo: Negociador
  modelo: claude-sonnet-4-6
  stack: direct-api
  janela: D+1 a D+14
  versao: 1.0.0
  ---
  ```
- Conteúdo do prompt em texto plano (sem markdown extra)
- Versionamento via git: cada mudança = novo commit com mensagem clara

## Workflow

1. Edite o prompt aqui em `server/prompts/<agente>.md`
2. Commit com mensagem `feat(prompts): refinar agente <nome> — <motivo>`
3. Copie o conteúdo (sem frontmatter) e cole na UI Anthropic
4. Salve a nova versão do agente na plataforma
5. (Opcional) Marque o commit com a versão do agente na plataforma

## Referência completa de prompts

Os prompts integrais estão em:
- `C:\Provedor.ai\Ecossistema\provedor-ai-agentes.md` — versão consolidada com prompts dos agentes principais
- `C:\Provedor.ai\Ecossistema\TEAM.md` — personas, SOPs, KPIs, casos críticos de cada agente

Quando popular este diretório, **extrair** dos arquivos acima (não inventar).
