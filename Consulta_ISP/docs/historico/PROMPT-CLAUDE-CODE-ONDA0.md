# PROMPT — Claude Code — Onda 0 (Consulta ISP)

**Copie TUDO abaixo da linha `--- COPIAR A PARTIR DAQUI ---` e cole numa sessão nova do Claude Code aberta na pasta `C:\ClaudeCode\Consulta_ISP`.**

---

## Contexto antes de colar

- Abra o Claude Code na pasta raiz: `C:\ClaudeCode\Consulta_ISP`
- Conecte o MCP de SSH pra VPS, ou tenha aberta uma sessão SSH pra `root@187.127.7.168` em terminal separado (Claude Code vai te pedir pra rodar comandos lá)
- Tenha acesso ao repo GitHub `informaticaecialdn-ai/consultaisp` (HTTPS + token ou SSH)
- Dois arquivos de referência devem existir na pasta:
  - `C:\ClaudeCode\Consulta_ISP\AUDITORIA-COMPLETA.md`
  - `C:\ClaudeCode\Consulta_ISP\TOPOLOGIA-SISTEMA.md`

---

--- COPIAR A PARTIR DAQUI ---

# Missão: Onda 0 — Sistema de Agentes de Vendas (Consulta ISP)

## Contexto de produto (leia antes de qualquer ação)

**Dois sistemas convivem sob o nome "Consulta ISP" — não confunda:**

- **Consulta ISP** (produto) = plataforma SaaS de **análise de crédito para provedores de internet (ISPs)**. É o produto comercializado.
- **Sistema de Agentes AI** (este, em `agentes-sistema/`) = ferramenta interna com 7 agentes de IA que **prospectam, qualificam e fecham vendas do Consulta ISP** para ISPs brasileiros.

Sua missão nesta Onda 0 é tornar o **Sistema de Agentes AI** acessível e deployável. Você NÃO vai mexer no produto Consulta ISP em si (que tem outra codebase, fora deste escopo).

Os "leads" no banco deste sistema são donos/decisores de ISPs brasileiros. Campos como `leads.provedor` (nome do ISP), `num_clientes` (assinantes do ISP), `erp` (SGP/IXC/MK-AUTH) se referem ao ISP prospect, não ao cliente final do ISP.

## Situação atual

Sistema Node.js + Express + SQLite com 7 agentes Claude (Sonnet/Opus) integrados ao WhatsApp via Z-API + Instagram DM, rodando em Docker na VPS `187.127.7.168` (Ubuntu 24.04, usuário `root`, host `srv1547310`). O dashboard deveria estar em `http://187.127.7.168/` mas está inacessível. Tem também uma lista de arquivos que existe só local e precisa ir pro GitHub.

## Fontes autoritativas (leia PRIMEIRO, sem pular)

1. `C:\ClaudeCode\Consulta_ISP\AUDITORIA-COMPLETA.md` — auditoria de 13 skills, leia o Sumário Executivo.
2. `C:\ClaudeCode\Consulta_ISP\TOPOLOGIA-SISTEMA.md` — 10 diagramas Mermaid. Leia "Topologia de Infraestrutura" e "Fluxo de Entrada".
3. Repo GitHub: `https://github.com/informaticaecialdn-ai/consultaisp` — subpasta `Consulta_ISP/agentes-sistema/`.
4. Estrutura local do código: `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`.

## Contexto técnico já confirmado

- `docker-compose.yml` define dois serviços: `agentes` (Node, expõe só :3001 interno) e `caddy` (container `caddy-proxy`, mapeia :80 e :443 do host).
- `Caddyfile` aponta `:80 { reverse_proxy agentes:3001 }`.
- A VPS tem **nginx/1.24 do sistema (apt)** ocupando `0.0.0.0:80` antes do Caddy conseguir bindar. Isso derruba tudo — request externa pega nginx primeiro, retorna 404.
- UFW ativo permite só 22/80/443. Não precisa abrir 3080.
- Pasta de deploy: `/opt/consulta-isp-agentes` (já clonada do GitHub, bootstrap já rodou).
- Arquivos que estão **só local** (não pushados pro GitHub):
  - `agentes-sistema/fix-vps.sh`
  - `agentes-sistema/public/status.html`
  - `agentes-sistema/public/index.html` (versão atualizada com event delegation e banner de erro)
  - `agentes-sistema/src/routes/api.js` (com endpoint `/api/diagnose`)
  - `AUDITORIA-COMPLETA.md`
  - `TOPOLOGIA-SISTEMA.md`
  - `RECUPERACAO-DASHBOARD.md`

## Objetivos da Onda 0 (tudo deve estar feito ao final)

1. **Dashboard acessível** em `http://187.127.7.168/` (porta 80, sem TLS por ora).
2. **Menus do dashboard funcionando** — clicar em qualquer item do menu lateral deve trocar a view.
3. **Arquivos locais pushados pro GitHub** na branch `main`, subpasta `Consulta_ISP/`.
4. **Endpoint `/api/diagnose` respondendo 200** com JSON do status do sistema.
5. **Pipeline de deploy repetível** — documentar como re-deployar via `update-vps.sh` (pull + restart) em até 60 segundos.
6. **Smoke test passando** — curl em 5 endpoints retorna 200/expected.

## Regras de operação

- **NÃO destruir dados.** Volumes `./data` (SQLite) e `./skills-ref` devem ser preservados em qualquer rebuild.
- **NÃO** commitar `.env`, `.env.local`, `data/*.db*`, `node_modules/`, logs. Checar `.gitignore`.
- **NÃO** mexer em nada de Onda 1 (segurança/LGPD) nesta rodada — foco é desbloquear acesso.
- **SEMPRE** rodar testes de smoke após cada mudança. Se quebrar, reverter imediatamente.
- **SEMPRE** documentar decisão em commit message no padrão `tipo(escopo): descrição` (feat, fix, chore, docs, refactor).
- Pra comandos na VPS, use a sessão SSH ativa (ou MCP-SSH). Se não tiver, gere um script shell e me peça pra executar.

## Plano de execução (sequencial, não paralelizar)

### Etapa 0 — Inventário (5 min)

- [ ] Liste todos os arquivos modificados localmente que ainda não estão no repo remoto.
- [ ] Confirme o estado do git local: `git status`, `git log --oneline -5`.
- [ ] Confirme qual é o branch atual e se tem commits não pushados.
- [ ] Me mostre o inventário em tabela antes de prosseguir.

### Etapa 1 — Resolver conflito nginx × Caddy na VPS

Execute (ou peça pra eu executar) na VPS, nessa ordem:

```bash
# 1.1 Descobrir o que o nginx do sistema serve
ls -la /etc/nginx/sites-enabled/
nginx -T 2>/dev/null | grep -E "server_name|listen |proxy_pass|root " | head -60
systemctl is-enabled nginx
systemctl status nginx --no-pager | head -15
```

**Decisão baseada no output:**

**CAMINHO A** — se `sites-enabled/` só tem o `default` (nginx não serve nada útil):

```bash
systemctl stop nginx
systemctl disable nginx
cd /opt/consulta-isp-agentes
docker compose restart caddy
sleep 3
ss -tlnp | grep ':80 '
curl -I http://localhost/api/health
curl -I http://localhost/
```

Esperado: `ss` mostra `docker-proxy` (ou vazio pois é iptables DNAT), curl retorna 200 nos dois.

**CAMINHO B** — se nginx serve outros sites que não podem ser parados: migrar pra nginx proxiar direto pro `agentes`:3001 e desligar Caddy.

```bash
# Edit docker-compose.yml: adicionar em agentes:
# ports: ["127.0.0.1:3001:3001"]
# Comentar/remover o bloco do caddy

docker compose stop caddy
docker compose rm -f caddy
docker compose up -d agentes

cat > /etc/nginx/sites-available/consulta-isp <<'EOF'
server {
    listen 80;
    server_name 187.127.7.168;
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/consulta-isp /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
curl -I http://localhost/api/health
```

- [ ] Me diga qual caminho você escolheu e por quê.
- [ ] Confirme que `curl -I http://localhost/` retorna 200 (não mais `nginx/1.24` default 404).
- [ ] Teste externo: `http://187.127.7.168/` deve responder com o HTML do dashboard.

### Etapa 2 — Push dos arquivos locais pro GitHub

Trabalhe na pasta `C:\ClaudeCode\Consulta_ISP`.

```
# 2.1 Confirmar que .gitignore cobre artefatos sensíveis
```

- [ ] Abra `.gitignore` na raiz. Garanta que contenha pelo menos:
  ```
  node_modules/
  **/node_modules/
  .env
  .env.local
  **/data/*.db
  **/data/*.db-*
  **/logs/
  dist/
  *.log
  .DS_Store
  ```

- [ ] Se faltar algum, adicione e rode `git rm --cached` nos que já estavam trackados indevidamente.

```
# 2.2 Adicionar e commitar os arquivos em grupos semanticamente separados
```

- [ ] `docs(audit): adicionar auditoria completa e topologia` — commit apenas:
  - `AUDITORIA-COMPLETA.md`
  - `TOPOLOGIA-SISTEMA.md`
  - `RECUPERACAO-DASHBOARD.md`

- [ ] `fix(dashboard): corrigir event handlers e adicionar banner de erro` — commit apenas:
  - `agentes-sistema/public/index.html`

- [ ] `feat(dashboard): adicionar página de status /status.html` — commit apenas:
  - `agentes-sistema/public/status.html`

- [ ] `feat(api): adicionar endpoint /api/diagnose` — commit apenas:
  - `agentes-sistema/src/routes/api.js`
  - Se precisou modificar `server.js` pra registrar a rota, incluir também.

- [ ] `chore(deploy): adicionar fix-vps.sh com rebuild defensivo` — commit apenas:
  - `agentes-sistema/fix-vps.sh`
  - Torne executável: `chmod +x fix-vps.sh` antes de commitar.

- [ ] `git push origin main` depois de todos os commits.

### Etapa 3 — Deployar as mudanças na VPS

Na VPS (em `/opt/consulta-isp-agentes`):

```bash
git fetch origin
git log HEAD..origin/main --oneline   # mostrar o que vai mudar
git pull --ff-only origin main
docker compose build --no-cache agentes
docker compose up -d agentes
docker compose logs agentes --tail=30
```

- [ ] Verifique que logs mostram "Servidor rodando na porta 3001" sem erros.
- [ ] `curl http://localhost/api/health` retorna `{"status":"ok"}`.
- [ ] `curl http://localhost/api/diagnose` retorna JSON com estado do sistema (sem 404).
- [ ] `curl http://localhost/status.html` retorna HTML (não 404).

### Etapa 4 — Smoke test completo

Rode este script (no Windows usando PowerShell ou no terminal local contra a VPS) — salve como `smoke-test.ps1` ou `smoke-test.sh`:

```bash
#!/usr/bin/env bash
BASE="http://187.127.7.168"
fail=0
check() {
  local name=$1 url=$2 expected=$3
  local got=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [[ "$got" == "$expected" ]]; then
    echo "OK   $name ($got)"
  else
    echo "FAIL $name esperado=$expected got=$got ($url)"
    fail=$((fail+1))
  fi
}

check "Dashboard index"   "$BASE/"                      200
check "Health endpoint"   "$BASE/api/health"            200
check "Stats endpoint"    "$BASE/api/stats"             200
check "Leads endpoint"    "$BASE/api/leads"             200
check "Status page"       "$BASE/status.html"           200
check "Diagnose endpoint" "$BASE/api/diagnose"          200
check "Webhook Z-API GET" "$BASE/webhook/zapi"          404  # GET não é permitido

if (( fail > 0 )); then
  echo "$fail checks falharam"; exit 1
fi
echo "Todos os smoke tests passaram"
```

- [ ] Rode o smoke test e me mostre output.
- [ ] Se falhar algum, pare e investigue antes de prosseguir.

### Etapa 5 — Validar que menus funcionam

- [ ] Abra `http://187.127.7.168/` no navegador (F12 aberto).
- [ ] Clique em cada item do menu lateral. Cada clique deve:
  - Trocar a view principal (mudança visível de conteúdo)
  - Não gerar erro no console do browser
  - Fazer pelo menos 1 fetch pra API (ver em Network)
- [ ] Me envie screenshot se algum menu ainda falhar.

### Etapa 6 — Documentar

Crie `C:\ClaudeCode\Consulta_ISP\agentes-sistema\RUNBOOK-DEPLOY.md` com:

- Como fazer pull + restart em ≤ 60s (`update-vps.sh`)
- Como fazer rebuild full (`fix-vps.sh`)
- Como rollback pro commit anterior (`git reset --hard HEAD~1 && docker compose build --no-cache agentes && docker compose up -d`)
- Procedimento de backup antes de qualquer deploy (copiar `data/agentes.db` com `sqlite3 .backup`)
- Comando pra logs em tempo real (`docker compose logs -f agentes`)
- Endpoints esperados funcionando (lista do smoke test)
- Checklist de "deploy saudável" (5 itens objetivos)

Commit: `docs(ops): runbook de deploy e rollback` → push.

## Definição de pronto (DoD)

- [ ] `http://187.127.7.168/` carrega o dashboard, menus clicam e mudam de view.
- [ ] `curl http://187.127.7.168/api/health` retorna 200.
- [ ] `curl http://187.127.7.168/api/diagnose` retorna JSON válido.
- [ ] `git log origin/main --oneline -10` no GitHub mostra os 6 commits da Etapa 2.
- [ ] Smoke test script retorna "Todos os smoke tests passaram".
- [ ] `RUNBOOK-DEPLOY.md` existe no repo.
- [ ] Última verificação: descrever em uma frase o que foi feito em cada etapa (0-6).

## Relatório final (me entregar ao terminar)

Formato:

```
## Onda 0 - Relatório de Execução

### Etapa 1 - Conflito nginx × Caddy
- Caminho escolhido: [A ou B]
- Justificativa: [1 linha]
- Estado final: [1 linha]

### Etapa 2 - Push pro GitHub
- Commits criados (em ordem): [lista com hash + mensagem]
- Arquivos por commit: [resumo]

### Etapa 3 - Deploy na VPS
- Tempo total do deploy: [Xs]
- Logs mostraram algum warning? [sim/não, se sim qual]

### Etapa 4 - Smoke test
[cole output]

### Etapa 5 - Menus
- Menus testados: [lista]
- Algum ainda falhou? [sim/não]

### Etapa 6 - Runbook
- Arquivo criado em: [path]
- Revisão: [ok/pendente]

### Pendências identificadas pra Onda 1
[lista curta de qualquer débito que virou evidente]
```

## Se encontrar bloqueio

Não improvise em segurança/compliance (Onda 1). Se bater em qualquer um destes, pare e me chame:

- Precisa mexer em `.env` (secrets)
- Precisa abrir uma porta nova no UFW
- Precisa instalar algo no host da VPS (`apt install`)
- Precisa reescrever mais de 50 linhas de código pra fazer algo funcionar
- Descobriu vazamento de dado que já aconteceu em produção

Bora.

--- FIM DO CONTEÚDO A COPIAR ---

---

## Apêndice — notas sobre este prompt

Este prompt foi construído a partir de:

- **AUDITORIA-COMPLETA.md** (13 skills, 11 seções, 5 ondas de ação)
- **TOPOLOGIA-SISTEMA.md** (10 diagramas Mermaid cobrindo deploy, fluxo e dados)
- Diagnóstico real da VPS em 2026-04-16 (conflito nginx × Caddy confirmado)
- Estado do repo GitHub em 2026-04-16 (arquivos divergentes listados)

### Por que esse prompt não faz mais do que Onda 0

Deliberadamente. A auditoria identificou bloqueadores de segurança/LGPD (Onda 1) que exigem decisões arquiteturais e possivelmente jurídicas (consentimento, retenção, DPO). Misturar isso com o desbloqueio de infraestrutura atrapalha. O prompt da Onda 1 virá depois deste ser executado e validado.

### Como medir sucesso do Claude Code nessa tarefa

- **Tempo total:** deve ser ≤ 45 min em sessão com SSH disponível.
- **Erros por etapa:** ≤ 1 retry por comando idealmente.
- **Quality gate:** todos os 7 smoke tests devem passar.
- **Rastreabilidade:** cada mudança tem commit semântico.

### Se você vai rodar isso DEPOIS desta data (16/04/2026)

- Reler AUDITORIA-COMPLETA.md pra ver se algo foi resolvido meanwhile.
- Confirmar que o estado da VPS é o mesmo (rodando `docker compose ps` e `ss -tlnp`).
- Se o estado divergiu muito, me pedir pra gerar um prompt atualizado.
