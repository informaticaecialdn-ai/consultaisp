# Recuperacao do Dashboard - Consulta ISP

Este documento explica **exatamente** o que fazer quando o dashboard em `http://187.127.7.168:3080` nao funciona (menus sem acao, comentarios HTML aparecendo como texto, etc).

## TL;DR - Comando unico para consertar tudo

Na VPS:
```bash
ssh root@187.127.7.168
cd /opt/consulta-isp-agentes
git pull origin main     # pega esta correcao (fix-vps.sh + /api/diagnose + status.html)
bash fix-vps.sh          # deploy limpo
```

Apos ~1 minuto, testar:
- `http://187.127.7.168:3080/status.html` - pagina de diagnostico (deve aparecer em segundos)
- `http://187.127.7.168:3080/api/diagnose` - JSON com status de todos subsistemas
- `http://187.127.7.168:3080/` - dashboard principal

---

## O que foi feito nesta iteracao

### 1. Endpoint `/api/diagnose` (novo)
Retorna um JSON completo com:
- Status do banco de dados + contagem de registros em cada tabela
- Variaveis de ambiente configuradas (ANTHROPIC, Z-API, AGENT_IDs, etc) - sem vazar valores
- **Integridade do index.html** - detecta se os comentarios HTML foram escapados (`<\!--` em vez de `<!--`, que e a causa provavel do bug que voce viu)
- Status do scheduler de follow-ups
- Carregamento dos servicos Claude e Z-API

Arquivo: `agentes-sistema/src/routes/api.js`

### 2. Pagina estatica `/status.html` (nova)
Pagina HTML pura (sem dependencias) que:
- Aparece mesmo se todo o backend estiver quebrado (prova que o Express serve estaticos)
- Tem botoes para testar cada endpoint da API
- Mostra o bruto de `/` (index.html) para voce ver se esta corrompido
- Ideal como "pagina de emergencia"

Arquivo: `agentes-sistema/public/status.html`

### 3. Dashboard com defesas
O `index.html` agora:
- Usa **event delegation** a partir de `document.body` - menus funcionam mesmo se o sidebar foi regenerado dinamicamente ou esta parcialmente quebrado
- Captura erros de JS e Promise rejections e mostra um **banner vermelho no topo** com a mensagem real (sem precisar abrir o console)
- Funcao `api()` tem retry automatico em falha de rede, mostra erros HTTP visivelmente em vez de falhar silenciosamente
- Todas as chamadas de carregamento tem `.catch()` que mostra erro ao usuario

Arquivo: `agentes-sistema/public/index.html` (linhas 419-490)

### 4. Script `fix-vps.sh` (novo)
Substitui o `update-vps.sh` para casos de corrupcao. Faz:
1. Backup do `.env` e `data/`
2. Para os containers
3. Clone **fresco** do GitHub (nao rsync - rsync pode preservar arquivos corrompidos)
4. Limpa a pasta atual (exceto .env, data/, node_modules)
5. Copia arquivos frescos
6. Auto-corrige `<\!--` -> `<!--` no index.html se detectar
7. Rebuild sem cache
8. Restart
9. Valida via `/api/health` e `/api/diagnose`

Arquivo: `agentes-sistema/fix-vps.sh`

---

## Causa raiz provavel (o bug que voce viu)

O screenshot do dashboard mostrava literal `<\!-- TOPBAR -->` como texto na tela. Isso NAO acontece em HTML valido. Isso acontece quando:

1. Alguem editou o arquivo via shell e o shell escapou `!` para `\!`
2. O HTML ficou com `<\!-- TOPBAR -->` (invalido)
3. O browser nao reconhece como comentario, mostra como texto

Como nao ha CI/CD configurado, essa corrupcao persiste na VPS mesmo quando o repo local esta limpo. O `update-vps.sh` usa **rsync** que preserva arquivos ja existentes se os timestamps batem, entao a corrupcao nao e sobreescrita.

O `fix-vps.sh` resolve com clone fresco + auto-correcao `sed` preventiva.

---

## Se ainda nao funcionar apos fix-vps.sh

### Diagnostico passo a passo

1. **Testar se o container esta rodando:**
   ```bash
   docker compose ps
   docker compose logs --tail=50 agentes
   ```

2. **Testar se o Express responde:**
   ```bash
   curl -i http://localhost:3080/api/health
   # esperado: HTTP 200 com JSON {"status":"ok",...}
   ```

3. **Rodar diagnose completo:**
   ```bash
   curl -s http://localhost:3080/api/diagnose | python3 -m json.tool
   ```
   Procure por:
   - `summary.failed > 0` -> tem subsistema quebrado, detalhes em `summary.problemas`
   - `checks.index_html.status != "ok"` -> HTML corrompido
   - `checks.index_html.comentarios_escapados_erro > 0` -> o bug classico

4. **Testar a pagina estatica (prova que Express esta servindo arquivos):**
   Abrir `http://187.127.7.168:3080/status.html` no browser.
   - Se nao abre: Express/Docker quebrado
   - Se abre: Express OK, problema e no `/` ou no JS do dashboard

5. **Inspecionar o proprio index.html na VPS:**
   ```bash
   head -c 500 /opt/consulta-isp-agentes/public/index.html
   grep -c '<\\!--' /opt/consulta-isp-agentes/public/index.html
   # deve retornar 0
   ```

---

## Checklist antes do proximo deploy

- [ ] Rodar `curl .../api/diagnose` e ver `summary.failed == 0`
- [ ] Abrir `/status.html` no browser e clicar em "Rodar /api/diagnose"
- [ ] Abrir `/` e verificar no **DevTools > Network**:
  - `/api/stats` retorna 200 com JSON
  - `/api/leads` retorna 200 com JSON
- [ ] Clicar em cada menu e verificar que ha uma requisicao na aba Network
- [ ] Verificar que nao ha banner vermelho de erro no topo

---

## Proximos passos apos dashboard voltar

Com o sistema 1:1 validado, reabrimos o roadmap do `AUDITORIA-E-PLANO.md`:
- Fase 0: Limpeza do root (14 arquivos orfaos)
- Fase 1: LGPD / Consent management
- Fase 2: Audiencias + Templates HSM
- Fase 3: Broadcast Engine (rate limiter para nao banir o numero)
- Fase 4: Jornadas/nurturing
- Fase 5: Observabilidade (custo de tokens, logs estruturados, backups)
