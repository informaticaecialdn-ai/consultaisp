# Analise Completa da API IXC Soft para Consulta ISP

## Autenticacao

- **Metodo:** Basic Auth — `Base64(userId:token)`
- **Headers obrigatorios:**
  - `Authorization: Basic <base64>`
  - `ixcsoft: listar` (para listar registros)
  - `Content-Type: application/json`
- **userId:** ID numerico do usuario (NAO o login)
- **Token:** Gerado em Configuracoes > Usuarios > campo Token
- **IP Whitelist:** Provedor precisa liberar o IP do servidor em Configuracoes > Usuarios > editar usuario > IPs permitidos

## Formato de Requisicao (padrao para TODOS os endpoints)

```
POST {base}/webservice/v1/{tabela}
Headers:
  Authorization: Basic {base64(userId:token)}
  ixcsoft: listar
  Content-Type: application/json

Body:
{
  "qtype": "{tabela}.{campo}",     // campo para filtrar
  "query": "{valor}",              // valor do filtro
  "oper": "=",                     // operador: =, >, <, >=, <=, !=, like
  "page": "1",                     // pagina atual
  "rp": "200",                     // registros por pagina
  "sortname": "{tabela}.{campo}",  // campo para ordenar
  "sortorder": "asc"               // asc ou desc
}

Resposta:
{
  "page": "1",
  "total": "1523",
  "registros": [ {...}, {...} ]
}
```

## Endpoints Relevantes para Consulta ISP

### 1. fn_areceber (Contas a Receber) — INADIMPLENTES
**Endpoint:** `POST /webservice/v1/fn_areceber`
**Uso:** Buscar faturas em aberto/vencidas para identificar inadimplentes

**Filtros uteis (qtype):**
- `fn_areceber.status` = `A` (aberto), `R` (recebido), `C` (cancelado)
- `fn_areceber.data_vencimento` com oper `<` para vencidas
- `fn_areceber.id_cliente` para faturas de um cliente especifico

**Campos retornados:**
- `id`, `id_cliente`, `cpf_cnpj`, `razao` (nome)
- `data_vencimento`, `valor`, `valor_recebido`, `status`
- `filial_id`, `contrato_id`
- `email`, `fone`, `celular`
- `endereco`, `cidade`, `estado`, `uf`, `cep`

**Estrategia:**
```
1. Buscar TODAS as faturas com status="A" (aberto)
2. Filtrar as que data_vencimento < hoje (vencidas)
3. Agrupar por cpf_cnpj: somar valores, contar faturas, pegar max dias atraso
```

### 2. cliente (Cadastro de Clientes) — DADOS COMPLETOS
**Endpoint:** `POST /webservice/v1/cliente`
**Uso:** Buscar dados completos de clientes, verificar enderecos duplicados

**Filtros uteis (qtype):**
- `cliente.cpf_cnpj` = `{cpf}` — busca por CPF/CNPJ
- `cliente.endereco` like `%rua tal%` — busca por endereco
- `cliente.cep` = `{cep}` — busca por CEP
- `cliente.cidade` = `{cidade}` — busca por cidade
- `cliente.status` = `A` (ativo), `I` (inativo), `D` (desativado)

**Campos retornados:**
- `id`, `razao` (nome), `cpf_cnpj`, `tipo_pessoa` (F/J)
- `email`, `fone`, `celular`
- `endereco`, `numero`, `bairro`, `cidade`, `estado`, `cep`
- `complemento`, `latitude`, `longitude`
- `data_cadastro`, `status`
- `observacao`

**Estrategia para verificacao de endereco:**
```
1. Buscar por CEP: qtype="cliente.cep", query="{cep}", oper="="
2. OU buscar por endereco: qtype="cliente.endereco", query="%{rua}%", oper="like"
3. Retornar todos os clientes naquele endereco
4. Cruzar com inadimplencia para identificar risco do endereco
```

### 3. cliente_contrato (Contratos) — CANCELAMENTOS E MIGRADORES
**Endpoint:** `POST /webservice/v1/cliente_contrato`
**Uso:** Identificar contratos cancelados, tempo de permanencia, padroes de migracao

**Filtros uteis (qtype):**
- `cliente_contrato.status` = `A` (ativo), `I` (inativo), `C` (cancelado), `S` (suspenso)
- `cliente_contrato.id_cliente` = `{id}` — contratos de um cliente
- `cliente_contrato.data_final` — data de cancelamento

**Campos retornados:**
- `id`, `id_cliente`, `id_filial`
- `contrato`, `descricao` (plano)
- `data_inicio`, `data_final`
- `status`, `status_internet`
- `valor_contrato`
- `motivo_cancelamento`

**Estrategia para detectar migradores:**
```
1. Buscar contratos cancelados: qtype="cliente_contrato.status", query="C", oper="="
2. Verificar data_final recente (ultimos 90 dias)
3. Cruzar cpf_cnpj com consultas feitas por outros provedores
4. Se CPF aparece em consulta de outro provedor + contrato cancelado recente = migrador potencial
```

### 4. radusuarios (Conexoes PPPoE/Radius) — VERIFICACAO DE ATIVIDADE
**Endpoint:** `POST /webservice/v1/radusuarios`
**Uso:** Verificar se cliente tem conexao ativa (complementar a analise)

**Filtros uteis (qtype):**
- `radusuarios.id_cliente` = `{id}` — conexoes de um cliente
- `radusuarios.online` = `S` (online), `N` (offline)
- `radusuarios.ativo` = `S` (ativo), `N` (inativo)

**Campos retornados:**
- `id`, `id_cliente`, `id_contrato`
- `login`, `senha`
- `online`, `ativo`
- `ip`, `mac`
- `plano`

### 5. login (Login de Clientes/Portal) — DADOS DO PORTAL
**Endpoint:** `POST /webservice/v1/login`
**Uso:** Verificar dados de login do cliente no portal

## Funcionalidades para o Consulta ISP

### A. Consulta de Inadimplentes (ja implementado)
```typescript
// fn_areceber status="A" + filtrar vencidas + agrupar por CPF
// JA FUNCIONA no conector IXC atual
```

### B. Contratos Cancelados (NOVO — implementar)
```typescript
// cliente_contrato status="C" nos ultimos 90 dias
// Identificar clientes que cancelaram recentemente
// Cruzar com consultas de outros provedores = possivel migrador
```

### C. Verificacao por Endereco (NOVO — implementar)
```typescript
// cliente.cep = {cep} OU cliente.endereco like %{rua}%
// Buscar TODOS os clientes no mesmo endereco
// Se encontrar inadimplente no endereco = risco associado ao local
// Util quando CPF nao encontrado mas endereco sim
```

### D. Deteccao de Migradores Seriais (NOVO — melhorar)
```typescript
// Combinar:
// 1. fn_areceber: tem dividas (inadimplente)
// 2. cliente_contrato status="C": cancelou contrato
// 3. consultationLogs: CPF consultado por outros provedores nos ultimos 30 dias
// Se todos os 3 = MIGRADOR SERIAL (alerta vermelho)
```

### E. Score por Endereco (futuro v2)
```typescript
// Para cada endereco (CEP + numero):
// 1. Buscar historico de todos os clientes nesse endereco
// 2. Quantos inadimplentes? Quantos cancelaram?
// 3. Gerar "score do endereco" (0-100)
// Inspirado no TeiaH
```

## Campos Extras para Adicionar ao Conector IXC

O conector atual busca `fn_areceber` e `cliente`. Precisa adicionar:

1. **fetchCancelledContracts()** — `cliente_contrato` com status="C"
2. **fetchCustomersByAddress()** — `cliente` com filtro por CEP ou endereco
3. **fetchContractHistory()** — `cliente_contrato` por id_cliente (todos os status)

## Limitacoes Conhecidas

- **IP Whitelist:** O provedor PRECISA liberar o IP do servidor no painel IXC
- **Rate Limit:** Nao documentado oficialmente, mas recomendado max 10 req/s
- **Paginacao:** Max 200 registros por pagina (rp=200), paginar ate total
- **Timeout:** Consultas grandes podem demorar 10-30s
- **Dados sensiveis:** Respeitar LGPD — mascarar dados entre provedores
