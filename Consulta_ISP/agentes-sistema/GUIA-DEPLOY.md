# Guia de Deploy - Sistema de Agentes Consulta ISP

## Pre-requisitos
- VPS com Ubuntu 22+ (minimo 2GB RAM)
- Docker e Docker Compose instalados
- Dominio apontando para o IP da VPS
- Conta Z-API com instancia ativa
- API Key da Anthropic (Claude)

## Passo 1: Configurar VPS

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Instalar Docker Compose
sudo apt install docker-compose-plugin
```

## Passo 2: Subir o projeto

```bash
# Clonar/copiar o projeto para a VPS
cd /opt
mkdir consulta-isp-agentes
# Copie todos os arquivos para ca

# Configurar variaveis de ambiente
cp .env.example .env
nano .env
# Preencha TODAS as variaveis
```

## Passo 3: Configurar .env

```
ANTHROPIC_API_KEY=sk-ant-sua-chave-aqui

AGENT_SOFIA_ID=agent_011Ca5mPLbzjTfKFnLn3VAkM
AGENT_LEO_ID=agent_011Ca5mcHZYB3Ki3hRphRZVg
AGENT_CARLOS_ID=agent_011Ca5mnFkBMp7ktd2N5c3zN
AGENT_LUCAS_ID=agent_011Ca5n9NNsdPT8D5ttKpd6j
AGENT_RAFAEL_ID=agent_011Ca5nJJ6QSfbx1gLf2ku5N

ZAPI_INSTANCE_ID=sua-instance
ZAPI_TOKEN=seu-token
ZAPI_CLIENT_TOKEN=seu-client-token

WEBHOOK_URL=https://agentes.consultaisp.com.br
PORT=3001
```

## Passo 4: Configurar dominio no Caddyfile

Edite o arquivo `Caddyfile` e coloque seu dominio real.

## Passo 5: Deploy

```bash
docker compose up -d --build
```

## Passo 6: Configurar Webhook do Z-API

Acesse o dashboard e use a API ou execute:

```bash
curl -X POST https://agentes.consultaisp.com.br/api/setup-webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://agentes.consultaisp.com.br"}'
```

Ou configure direto no painel da Z-API:
- URL de webhook: `https://agentes.consultaisp.com.br/webhook/zapi`

## Passo 7: Testar

1. Acesse `https://agentes.consultaisp.com.br` no navegador
2. Clique em "+ Novo Lead"
3. Coloque um numero de teste
4. O Carlos vai gerar e enviar uma mensagem de prospeccao
5. Responda no WhatsApp e veja a magia acontecer

## Endpoints da API

| Metodo | URL | Descricao |
|--------|-----|-----------|
| GET | /api/stats | Estatisticas gerais |
| GET | /api/leads | Lista leads |
| GET | /api/leads/:id | Detalhes do lead |
| POST | /api/send | Envia mensagem |
| POST | /api/prospectar | Prospeccao em massa |
| POST | /api/conteudo | Gera conteudo (Leo) |
| POST | /api/estrategia | Gera estrategia (Sofia) |
| POST | /api/transferir | Transfere lead entre agentes |
| POST | /webhook/zapi | Webhook Z-API |

## Como funciona o fluxo

1. Lead manda mensagem no WhatsApp
2. Z-API envia para o webhook
3. Orquestrador identifica o lead e o agente responsavel
4. Agente (Claude opus-4-6) analisa e responde
5. Resposta e enviada de volta via Z-API
6. Lead scoring e atualizado automaticamente
7. Quando score atinge 61+, lead e transferido para Lucas (Vendas)
8. Quando ha acordo, vai para Rafael (Closer)
9. Leads frios voltam para Sofia (nurturing)
