# Subir a instância de demonstração — roteiro operacional

**Data:** 12/09/2026
**Para:** quem for executar isto na VPS, ainda que nunca tenha visto esta feature.
**Contexto:** `docs/superpowers/specs/2026-09-11-demo-sandbox-design.md` (o design) e
`docs/superpowers/plans/2026-09-11-demo-sandbox.md` (o plano, Tarefas 1-10 já
implementadas e commitadas). Este documento cobre só a Tarefa 11: colocar a
instância no ar. Nada aqui pede permissão de novo para o que já foi decidido —
só para o que só pode ser decidido na hora (segredos, DNS).

**O que isto NÃO faz:** não altera a produção em nenhum passo. Banco separado,
checkout separado, processos pm2 separados, domínio separado. Se algo aqui
sair errado, a produção continua no ar — é a razão de existir da instância
separada (design doc §1, §3.1).

---

## 0. Antes de começar — decisões e segredos que só o dono tem

Reúna isto antes de abrir o terminal da VPS. Nenhum comando abaixo funciona
sem estes itens:

| # | O quê | Decisão de quem |
|---|---|---|
| 1 | Uma senha forte para o role `consultaispdemo` do Postgres | gerar na hora (`openssl rand -hex 20`), não precisa guardar em lugar nenhum além do `.env.demo` |
| 2 | Apontar `demo.consultaisp.com.br` (registro A) para o IP desta VPS | **DECISÃO/AÇÃO DO DONO** — DNS de `consultaisp.com.br`. Sem isso o Passo 6 (certbot) falha na validação |
| 3 | Um e-mail para o certbot avisar de expiração de certificado (opcional — sem ele o certificado sai mesmo assim, sem aviso por e-mail) | dono, se quiser |
| 4 | Gerar `SESSION_SECRET` e (opcional) `PARTNER_CODE_SECRET` próprios da demo | comando dado no Passo 3 — não reaproveitar os de produção |
| 5 | Decidir se cria um login de superadmin próprio da demo (`SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`) | recomendado, mas opcional — sem ele a única porta de entrada é o sandbox de 24h de cada visitante |
| 6 | Confirmar que NENHUMA credencial paga (Resend, Asaas, OpenAI, Google Maps, SPC, BigDataCorp, Chat BullQ, ZapSign) vai para o `.env.demo` | é a garantia central desta instância — ver `.env.demo.example`, seção "NUNCA PREENCHER AQUI" |

Não é preciso decidir nada sobre o mundo fictício (os cinco provedores, os
1.500 clientes por sandbox, os CPFs de exemplo): isso já está no código,
semeado automaticamente no Passo 8.

---

## 1. Banco e role próprios

Mesmo padrão de isolamento que os outros produtos já usam nesta VPS (Chat
BullQ tem base e role próprios — CLAUDE.md, `arquiteto-decide`/memória
`producao-vps`). Rode como root:

```bash
GERAR_SENHA=$(openssl rand -hex 20)
echo "Guarde esta senha para o Passo 3 (.env.demo): $GERAR_SENHA"

su postgres -c "psql -c \"CREATE ROLE consultaispdemo LOGIN PASSWORD '$GERAR_SENHA'\""
su postgres -c "psql -c 'CREATE DATABASE consultaispdemo OWNER consultaispdemo'"
```

Role e banco com o mesmo nome, de propósito — mais fácil de auditar depois
qual credencial pertence a qual instância. **Não** copie nenhum dado de
produção para cá: o banco nasce vazio, e as migrações (Passo 4) o preenchem do
zero.

---

## 2. Checkout próprio

Clonar do checkout local de produção é mais rápido que baixar de novo do
GitHub, e depois reaponta para o remote de verdade — assim `git pull` daqui
em diante funciona igual ao de produção:

```bash
cd /var/www
git clone /var/www/consulta-isp consulta-isp-demo
cd /var/www/consulta-isp-demo
git remote set-url origin "$(git -C /var/www/consulta-isp remote get-url origin)"
git fetch origin
git checkout feat/localizacao
git reset --hard origin/feat/localizacao
npm install
```

---

## 3. `.env.demo`

Copie o template versionado e preencha **só** o que ele marca como
obrigatório ou recomendado. **Nunca** preencha a seção final do template
("NUNCA PREENCHER AQUI") — ela existe precisamente para nenhuma credencial
paga chegar aqui por engano.

```bash
cd /var/www/consulta-isp-demo
cp .env.demo.example .env.demo
chmod 600 .env.demo
```

Edite `.env.demo` e preencha:

- `DATABASE_URL=postgresql://consultaispdemo:<senha do Passo 1>@localhost:5432/consultaispdemo`
- `SESSION_SECRET=` — gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Não** reaproveite o de produção.
- `DEMO_MODE=true`
- `PORT=5001`
- (recomendado) `PARTNER_CODE_SECRET=` — mesmo comando acima, 32+ caracteres, **ou deixe vazio**. Nunca um valor curto: com menos de 32 caracteres o processo cai no boot (`server/env.ts:15-23`); vazio é seguro, só gera um aviso no log.
- (recomendado) `LGPD_EMPRESA=` / `LGPD_CNPJ=` — os valores REAIS da empresa (a mesma que opera a produção); sem eles a página `/lgpd` da demo publica um CNPJ de exemplo, sem quebrar o boot.
- (opcional) `SUPERADMIN_EMAIL=` / `SUPERADMIN_PASSWORD=` — se quiser um login de administrador que não seja um sandbox de 24h.

> **Por que `DATABASE_URL` e `SESSION_SECRET` são as únicas linhas que
> realmente travam o boot:** `server/env.ts:3` (`REQUIRED_VARS`) só lista
> estas duas — são as únicas que chamam `process.exit(1)` incondicionalmente.
> Tudo o mais no template é aviso-apenas ou condicional (o comentário de cada
> variável no `.env.demo.example` cita a linha exata). Isto corrige uma
> imprecisão do plano original: `docs/superpowers/plans/2026-09-11-demo-sandbox.md`
> (Tarefa 11) e o design doc §3.1 atribuem a `validateEnv()` a exigência de
> `LGPD_CNPJ`, `LGPD_EMPRESA` e `MAIN_DOMAIN` — nenhuma das três é lida por
> `validateEnv()` de um jeito que derrube o processo; `MAIN_DOMAIN` nem é lida
> por ele, ponto (é consumida em `server/tenant.ts:8`, sempre opcional, com
> default `"consultaisp.com.br"` — que já é o valor certo aqui, então
> **deixe-a vazia**).

---

## 4. Migração do schema — automática, no primeiro boot

Diferente de `script/deploy-vps.sh` (que roda `drizzle-kit push`, um caminho
antigo que `server/migrate.ts` documenta ter derrubado a tabela de sessão de
produção em 26/08/2026 — não repita esse comando aqui), este projeto aplica
migração por **arquivos SQL versionados em `migrations/`**, automaticamente,
todo boot: `server/index.ts:194` chama `prepararSchemaOuCair()`
(`server/migrate.ts:264`), que roda `runMigrations()` e depois
`verifySchema()` — e derruba o processo (`process.exit(1)`) se qualquer um
dos dois falhar. Contra o banco vazio criado no Passo 1, isso aplica as 39
migrações em ordem, de `0000_initial_schema.sql` até `0037_confissao_de_divida_zapsign.sql`,
e cria o schema inteiro do zero. **Não rode `drizzle-kit push` nem `db:push`
contra este banco** — não é assim que este projeto versiona schema, e
`server/migrate.ts:83-88` documenta por quê.

Não há nada para você fazer neste passo além de saber que ele acontece
sozinho quando o processo subir (Passo 7) — é só para você não estranhar o
primeiro boot demorando alguns segundos a mais, e para reconhecer no log
`[migrate] Applying migration: ...` como esperado, não como erro.

---

## 5. Build

```bash
cd /var/www/consulta-isp-demo
npm run build
```

Gera `dist/index.cjs` e `dist/worker.cjs` (`script/build.ts:139,154`) — os
mesmos nomes de arquivo que a produção usa; só o diretório do checkout muda.

---

## 6. nginx — site próprio, sem indexação

Primeiro confirme o DNS (item 2 da seção 0): `dig +short demo.consultaisp.com.br`
deve devolver o IP desta VPS antes de seguir para o certificado.

Crie `/etc/nginx/sites-available/demo-consultaisp`:

```nginx
# Instancia de demonstracao — nao indexar (design doc §3.1, §4).
server {
    listen 80;
    server_name demo.consultaisp.com.br;

    add_header X-Robots-Tag "noindex, nofollow" always;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/demo-consultaisp /etc/nginx/sites-enabled/demo-consultaisp
nginx -t && systemctl reload nginx

certbot --nginx -d demo.consultaisp.com.br --non-interactive --agree-tos \
  --email <e-mail do item 3, ou use --register-unsafely-without-email> --redirect
```

Este bloco segue o MESMO padrão que `script/dominio-whitelabel.sh:152-168` já
usa para todo domínio de marca nesta VPS — não é um formato novo. Os três
cabeçalhos `X-Forwarded-*` não são enfeite: o app roda com
`app.set("trust proxy", 1)` (`server/index.ts:24`) e cookie de sessão
`secure: true` sempre que `NODE_ENV=production` (`server/auth.ts:41-50`, e o
par da demo sobe assim — `ecosystem.demo.config.cjs`). **Sem
`X-Forwarded-Proto`, o Express nunca vê a conexão como HTTPS e o cookie de
sessão do visitante não é gravado** — a demo pareceria deslogar sozinha a
cada clique. **Sem `X-Forwarded-For`, todo visitante cai no mesmo balde do
limitador de `/demo`** (`chaveDoLimite`, `server/middleware/rate-limiter.middleware.ts:26-31`,
que chaveia por `req.ip`) — 2 sandboxes a cada 10 minutos
(`server/routes/demo.routes.ts:33`) **no total, para todo mundo**, em vez de
por visitante. O plano original (Tarefa 11) trazia só `proxy_pass` e `Host`;
os três cabeçalhos acima foram acrescentados aqui por isso.

Não há bloco `/ws` separado (diferente do template de marca white label): não
encontrei nenhum servidor WebSocket ativo neste código (`ws` está no
`package.json` mas sem import em `server/` nem `client/src/` — parece
dependência órfã de uma versão anterior do chat). Se um dia isso voltar,
espelhe o bloco `/ws` de `script/dominio-whitelabel.sh:170-177`.

---

## 7. pm2 — o par da demo

```bash
cd /var/www/consulta-isp-demo
pm2 start ecosystem.demo.config.cjs
pm2 save
```

Confira os dois processos — **os dois, não só o HTTP.** O worker é quem faz
mais coisa sozinho no primeiro boot (ERP sync, retenção e titular LGPD, régua
diária, reconciliação de confissão, chat) e é o único que teria acusado, antes
da correção deste roteiro, um download de censo do IBGE em silêncio:

```bash
pm2 list | grep consulta-isp-demo
pm2 logs consulta-isp-demo --lines 30 --nostream
pm2 logs consulta-isp-demo-worker --lines 40 --nostream
```

No log de `consulta-isp-demo`, espera-se ver `[migrate] Applying migration:
...` (Passo 4) seguido de `Environment validated` e o servidor escutando em
`5001`. No log de `consulta-isp-demo-worker`, espera-se `[Worker] ERP sync
scheduler started`, `[Worker] LGPD retention scheduler started`, `[Worker]
Régua de cobrança scheduler started` e, por já estar em `DEMO_MODE`,
`[Worker] Limpeza de sandboxes da demo scheduler started`. **Não deve
aparecer** nenhuma linha de `Cobertura geo` (`server/worker.ts`,
`iniciarCadeiaDoMapa`) — essa cadeia baixa base de endereço real do IBGE por
cidade e fica desligada em `DEMO_MODE` (corrigido nesta rodada; ver a nota na
seção 7 do design doc). Se aparecer, o worker está sem `DEMO_MODE=true` no
`.env.demo` — confira o Passo 3 antes de continuar.

---

## 8. Primeira carga — semear o mundo base

O plano original citava um script `script/semear-demo.ts` para este passo.
**Ele não existe no repositório** — não foi criado por nenhuma tarefa deste
plano, e este documento não cria um novo arquivo só para isto (o único
trabalho deste passo é uma chamada de função já pronta). Em vez disso:

```bash
cd /var/www/consulta-isp-demo
npx tsx -e "import('dotenv').then(d => d.config({ path: '.env.demo', override: true })).then(() => import('./server/demo/mundo-base')).then(m => m.semearMundoBase()).then(r => console.log('mundo base semeado:', r))"
```

**Por que o comando carrega `.env.demo` explicitamente, com `override: true`,
antes de importar qualquer coisa — e por que isso não é excesso de zelo:**
`server/demo/mundo-base.ts` importa `db` de `server/db.ts`, que lê
`process.env.DATABASE_URL` direto, sem fallback nenhum. Os únicos dois pontos
do projeto que carregam `.env` sozinhos são os entrypoints reais
(`server/index.ts:1` e `server/worker.ts:15`, ambos `import "dotenv/config"`)
— um `npx tsx -e` não passa por nenhum dos dois, e mesmo que passasse,
`dotenv/config` sem argumento procura `.env`, que **não existe** neste
checkout (só `.env.demo`, do Passo 3). Sem carregar nada, `DATABASE_URL` fica
do jeito que a sessão de terminal já a deixou.

**O risco concreto, medido antes de escrever este comando:** se o terminal
que vai rodar isto ainda carregar um `DATABASE_URL` de uma tarefa de produção
anterior (exportado numa sessão de trabalho, por exemplo), o comando ingênuo
`import('dotenv').then(d => d.config({ path: '.env.demo' }))` **não resolve
isso** — o `dotenv.config()` só define uma variável que ainda não existe;
achando `DATABASE_URL` já presente (a de produção), ele a mantém, calado, e
`semearMundoBase()` escreveria os 7.500 clientes fictícios no banco de
PRODUÇÃO. Reproduzi os dois lados exatamente antes de fechar este roteiro:
com `override: true`, `DATABASE_URL` efetivo vira o de `.env.demo` mesmo
havendo um valor de produção pré-exportado no shell (confirmado pela mensagem
de erro de conexão citar o host do `.env.demo`); sem `override`, o mesmo
comando confirma tentativa de conexão no host de produção. **`override: true`
não é opcional aqui — é a única linha entre este comando e escrever no banco
errado.**

**Por que `.then()` em cadeia, e não `await` no topo do arquivo (mais óbvio
à primeira vista):** `tsx -e` transforma o texto do `-e` em CJS por baixo dos
panos, e `await` de topo de arquivo não existe em CJS — o comando falha na
hora com "Top-level await is currently not supported with the cjs output
format". A cadeia de `.then()` (config → SÓ DEPOIS importar `mundo-base` → SÓ
DEPOIS chamar `semearMundoBase()`) garante a mesma coisa que um `await`
garantiria — que `DATABASE_URL` já está correto antes de `server/db.ts` ser
avaliado — sem depender de um recurso de linguagem que este comando não pode
usar. **Não troque a cadeia por duas chamadas `import(...)` soltas**: rodar
o `import('./server/demo/mundo-base')` fora da cadeia (em paralelo com o
`config()`, em vez de depois dele) reabre exatamente o mesmo risco, porque
`server/db.ts` pode ser avaliado antes do `config()` terminar.

**Por que este passo é opcional, mas recomendado mesmo assim:**
`criarSandbox()` (`server/demo/sandbox.service.ts:544`) já chama
`semearMundoBase()` sozinho, sempre, antes de montar a carteira de qualquer
visitante — e a função é idempotente (se `rede-1`..`rede-5` já existem, ela
não faz nada de novo, `server/demo/mundo-base.ts:627`). Ou seja: mesmo que
você pule este passo, o primeiro `GET /demo` de alguém (inclusive o curl do
Passo 9) semeia o mundo base sozinho. A razão para rodar explicitamente aqui,
antes de anunciar o link, é só timing: semear os cinco provedores fictícios
com ~1.500 clientes cada é uma escrita de milhares de linhas contra um
Postgres que acabou de nascer (índices ainda não aquecidos) — rodar isso como
efeito colateral escondido da PRIMEIRA visita real de alguém arrisca fazer
essa pessoa esperar por uma consulta lenta sem saber por quê. Rodando aqui,
você paga esse custo uma vez, sozinho, e todo visitante depois entra num
banco já pronto.

Se o comando acima demorar mais que alguns segundos, não se preocupe — é
contra Postgres de verdade, bem mais lento que o banco de mentira dos
testes (que mede ~1,3s e não significa nada sobre latência real, conforme o
próprio plano registra na Tarefa 3). Não há orçamento de tempo definido para
este passo especificamente; o orçamento de 3 segundos do plano (Tarefa 5) é
para `criarSandbox()` — o sandbox de UM visitante — não para o mundo base
inteiro. Se `criarSandbox()` no Passo 9 passar de 3 segundos contra o banco
real, o plano já autoriza reduzir de 1.500 para 500 clientes por sandbox;
registre a medição antes de decidir.

---

## 9. Conferir no ar

```bash
# Cria um sandbox e redireciona — 302 esperado
curl -s -o /dev/null -w '%{http_code}\n' https://demo.consultaisp.com.br/demo

# Nao indexar
curl -sI https://demo.consultaisp.com.br/ | grep -i x-robots-tag

# Producao continua intacta — outro processo, outro banco, outro nginx
curl -s -o /dev/null -w '%{http_code}\n' https://consultaisp.com.br/api/health
```

O primeiro curl já conta como uma das 2 tentativas por IP a cada 10 minutos
que `server/routes/demo.routes.ts:33` permite — rodar os três curls acima
repetidamente da mesma máquina em teste devolve 429 na terceira vez; isso é o
limitador funcionando, não um defeito.

Para confirmar visualmente que a sessão do visitante realmente persiste
(o item que o Passo 6 corrigiu, sobre `X-Forwarded-Proto`): abra
`https://demo.consultaisp.com.br/demo` num navegador de verdade, confirme que
cai logado dentro do sistema (não na tela de login), navegue para outra
página, e confirme que continua logado.

---

## 10. Deploys seguintes

A demo **não** compartilha checkout, build nem processo com a produção — são
dois diretórios, dois `git pull`, dois `npm run build`, dois pares de pm2.
"Sobe junto com produção" quer dizer repetir os mesmos passos na outra pasta,
não que um único comando atualiza as duas.

```bash
cd /var/www/consulta-isp-demo
git pull origin feat/localizacao
npm install
npm run build

pm2 delete consulta-isp-demo consulta-isp-demo-worker
pm2 start ecosystem.demo.config.cjs
pm2 save
```

**Por que `pm2 delete` + `pm2 start`, nunca `pm2 restart`:** o pm2 congela o
`.env` no momento do `start` — é o próprio cabeçalho de `ecosystem.config.cjs:11-15`
que documenta este padrão para produção, e o comentário de
`ASAAS_WEBHOOK_TOKEN` em `.env.example:52-53` repete a mesma regra
explicitamente. `pm2 restart` reaproveita o ambiente antigo; se você mudou
qualquer linha do `.env.demo` (rotacionou `SESSION_SECRET`, adicionou
`SUPERADMIN_EMAIL` depois), um `restart` não pega o valor novo e o processo
continua rodando com o ambiente de antes, em silêncio. (O design doc §6
original dizia "pm2 restart do par da demo" — corrigido aqui para o padrão
que o próprio repositório já usa e documenta em dois lugares.)

Migrações novas (arquivos `.sql` adicionados a `migrations/` desde o último
deploy) aplicam sozinhas no boot do passo acima, do mesmo jeito que no Passo
4 — não é preciso nenhum comando extra.

---

## 11. Reverter / desligar a demo

```bash
pm2 delete consulta-isp-demo consulta-isp-demo-worker
pm2 save
rm /etc/nginx/sites-enabled/demo-consultaisp
nginx -t && systemctl reload nginx
```

A produção não é tocada em nenhum destes comandos — outro banco, outro
processo, outro domínio. O banco `consultaispdemo` e o checkout
`/var/www/consulta-isp-demo` podem ficar parados indefinidamente sem custo
(nenhum processo os lê); apague-os só se quiser recuperar o espaço em disco.

---

## Referências

| O quê | Onde |
|---|---|
| Chave de comportamento da demo | `server/demo/modo-demo.ts:12` (`emModoDemo`) |
| Quem semeia o mundo base | `server/demo/sandbox.service.ts:544` chama `server/demo/mundo-base.ts:627` |
| Variáveis que realmente derrubam o boot | `server/env.ts:3` (`REQUIRED_VARS`) |
| Migração automática no boot | `server/index.ts:194` → `server/migrate.ts:264` (`prepararSchemaOuCair`) |
| Build (nomes de saída) | `script/build.ts:139,154` |
| Ecosystem de produção (o que este par espelha) | `ecosystem.config.cjs` |
| Padrão real de nginx para subdomínio nesta VPS | `script/dominio-whitelabel.sh:152-178` |
| Padrão real de deploy (delete+start, não restart) | `ecosystem.config.cjs:11-15`, `.env.example:52-53` |
| Limitador de `/demo` | `server/routes/demo.routes.ts:33` (2 / 10 min / IP) |
| Sessão do visitante (5 campos) | `server/routes/demo.routes.ts`, no molde de `server/routes/auth.routes.ts:262-268` |
| Design da instância | `docs/superpowers/specs/2026-09-11-demo-sandbox-design.md` §3.1, §6 |
