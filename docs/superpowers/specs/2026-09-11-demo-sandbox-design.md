# Demonstração do Consulta ISP — sandbox por visitante

**Data:** 11/09/2026
**Dono:** pedido dele, nas palavras dele: *"preciso que crie um provedor demonstração com todos os dados, para disponibilizar no site, está difícil fazer os provedores entender o que o sistema [faz]... dados mockup que possibilite usar todas as funções do sistema... colocar acesso ao demo na landingpage."*

O problema é de venda: o provedor não entende o produto lendo a landing. A demonstração existe para ele **usar** o sistema — consulta na rede, SPC, cadastral, mapa de calor, cobrança, equipamentos — com dados que parecem os dele, sem tocar em dado real de ninguém.

---

## 1. O que foi medido antes de decidir

| Fato | Onde | Consequência para a demo |
|---|---|---|
| A consulta varre **todos** os provedores da rede | `server/routes/consultas.routes.ts:916` (`storage.getAllProviders()`), comentário nas linhas 200-214 | Um provedor de demo dentro da base real faria o visitante ver inadimplente REAL (LGPD), e faria dado falso entrar no score de quem paga |
| A varredura ao vivo é dirigida por `erp_integrations` | `queryRegionalErps(erpIntegrations, …)`, mesma rota | Provedor sem integração nunca é chamado: na demo, sem um conector próprio, **toda consulta voltaria limpa** e a tela principal não demonstraria nada |
| Consulta positiva debita crédito de verdade | `debitAndCreateIspConsultation`, `creditsCost` | O sandbox precisa nascer com saldo, e o débito precisa acontecer para o visitante entender a cobrança |
| SPC e cadastral são chamadas pagas | `server/services/spc/spc.service.ts`, `server/services/bigdata.service.ts` | Não podem ser chamadas por visitante anônimo: custo por clique e dado de pessoa real |
| Já existe um seed | `server/seed.ts` (509 linhas; cobre providers, customers, contracts, invoices, equipment, erp_integrations) | É ponto de partida do gerador do mundo, não folha em branco. Hoje é bloqueado por `NODE_ENV=production` e `SEED_DEMO_DATA` |
| Registry de conectores aceita auto-registro | `server/erp/registry.ts`, barril `server/erp/index.ts` (duas convenções), trava em `conectores-implementados.test.ts` | Um conector de demonstração cabe no padrão, mas a trava do barril precisa saber dele |
| pm2 declara dois processos e congela o `.env` no start | `ecosystem.config.cjs` | A demo sobe como **outro par** de processos, com `.env` próprio |
| nginx já hospeda vários sites; Postgres já tem base e role por produto | VPS: sites `consultaisp`, `chat-consultaisp`; bancos `consultaisp`, `chatbullq` | Instância separada é o padrão da casa, não invenção |
| `validateEnv()` derruba o boot por variável faltando | `server/env.ts:5`, chamado em `server/index.ts:183` | O `.env` da demo precisa das obrigatórias, senão os dois processos entram em laço de restart |
| Todo CTA da landing é `<a href={CADASTRO} className="btn …" onClick={irPara(…)}>` | `client/src/pages/public/landingpage.tsx:223,246,912` | O botão da demo entra no mesmo padrão, sem CSS novo |

---

## 2. Decisões do dono (11/09/2026)

1. **Sandbox por visitante**, não um provedor de demonstração único.
2. **Instância separada** (`demo.consultaisp.com.br`, banco próprio).
3. **Entrada em um clique**, sem formulário. O lead se captura dentro da demo, não na porta.
4. **24 horas** de vida por sandbox.
5. **SPC e cadastral com resultado simulado e selo visível**; a consulta ISP na rede roda de verdade dentro do mundo fictício.
6. **Saldo cheio e o débito acontece** — o visitante aprende como se cobra.
7. **Cidades reais** (Londrina, Ibiporã, Cambé, Apucarana) e **nomes brasileiros comuns**; os clientes são 100% fictícios.

Regra permanente que continua valendo: [integridade do dado] só dado real e verificável **no produto**. A demo é a exceção declarada — e por isso ela vive em outro banco, em outro domínio, com selo em toda tela.

---

## 3. Arquitetura

### 3.1 A instância

Mesmo código, mesma branch de produção. Na VPS:

- checkout em `/var/www/consulta-isp-demo`;
- `.env.demo` com `DATABASE_URL` do banco `consultaispdemo` (role `demo`), `DEMO_MODE=true`, porta `5001`, e as obrigatórias do `validateEnv`;
- pm2: `consulta-isp-demo` e `consulta-isp-demo-worker` (segundo arquivo de ecosystem);
- nginx: site `demo-consultaisp` → `127.0.0.1:5001`, com `add_header X-Robots-Tag "noindex, nofollow"` (a demo não indexa);
- **sem** credencial de Resend, WhatsApp, ZapSign, Asaas, SPC, BigDataCorp, Google Maps pago.

`DEMO_MODE` é a única chave que muda comportamento no código. Fora dela, o binário é idêntico ao de produção — é isso que impede a demo de virar um produto paralelo que envelhece sozinho.

### 3.2 O mundo base (semeado uma vez)

Cinco provedores fictícios, criados pelo gerador e **nunca apagados**:

| Provedor | Cidade | Papel na história |
|---|---|---|
| Rede Norte Telecom | Londrina | tem clientes em comum com os outros — é o que prova a rede |
| Ibiporã Conecta | Ibiporã | idem |
| Cambé Fibra | Cambé | idem |
| Apucarana Link | Apucarana | idem |
| Vale Net | Londrina | provedor pequeno, poucos registros |

Cada um com integração de ERP `demo` habilitada, para responder à varredura ao vivo.

Volume do mundo base: ~400 clientes, ~90 inadimplentes com faturas de idades variadas (10, 45, 120, 300 dias), ~25 equipamentos retidos, ex-clientes com contrato encerrado, e **~30 CPFs presentes em dois ou três provedores** — é o que faz a consulta mostrar "Provedor Parceiro ISP-XXX-XXX" de verdade.

**Identidade dos fictícios:** nomes brasileiros comuns; CPFs com dígito verificador válido gerados a partir de uma base `999.xxx.xxx` (faixa não emitida pela Receita), documentada no gerador. Endereços reais de bairro/cidade, sem número existente.

### 3.3 O sandbox do visitante

- `GET /demo` (só no host da demo) cria: um provedor `Provedor Demonstração`, `subdomain = sandbox-<token>`, um usuário admin, e a **carteira dele** — cópia de um molde (~120 clientes, ~30 inadimplentes, equipamentos, casos de cobrança em todas as etapas do kanban, ex-clientes), com parte dos CPFs coincidindo com os provedores do mundo base.
- A sessão é criada no servidor e o visitante cai logado em `/`. Um clique, sem formulário.
- **Nenhuma migração:** a identidade do sandbox é convenção — `subdomain LIKE 'sandbox-%'` + `createdAt`. Nada muda em `shared/schema.ts`.
- Saldo: 500 créditos.
- Limite de criação por IP (rate limiter existente), para a porta não virar gerador de lixo.

### 3.4 O conector de demonstração

`server/erp/connectors/demo.ts`, nome `demo`, **registrado apenas quando `DEMO_MODE`**. Responde o contrato `ErpConnector` lendo do próprio banco da demo (tabelas `customers`/`invoices` do provedor fictício), como se fosse o ERP dele: `testConnection`, `fetchCustomers`, `fetchDelinquents`, `fetchCustomerByCpf`, `fetchCustomersByCep`, `fetchCustomersByAddress`.

É o que mantém a consulta rodando pelo **caminho real** — varredura, máscara LGPD, score, débito de crédito — em vez de um atalho só para a demo. `conectores-implementados.test.ts` ganha o caso dos dois modos (com e sem `DEMO_MODE`).

### 3.5 Bureaus simulados

Em `DEMO_MODE`, SPC e cadastral não chamam rede nenhuma: devolvem payload fictício **determinístico pelo CPF** (o mesmo documento devolve sempre o mesmo resultado, para a demonstração ser reproduzível), com `simulado: true` no contrato. A tela mostra o selo **"dado simulado"** no topo do relatório, no mesmo lugar em que hoje aparece a proveniência do dado. O crédito do SPC é debitado normalmente.

### 3.6 Nada sai da demo

Em `DEMO_MODE`, e-mail, WhatsApp, webhook de saída e ZapSign retornam sucesso silencioso sem chamar nada — guarda explícita no serviço, além da ausência de credencial. Anti-fraude e régua de cobrança rodam e aparecem na tela; o disparo externo é inerte.

### 3.7 A tela diz que é demonstração

Faixa fixa no topo, em todas as telas do host da demo: **"Demonstração — dados fictícios · seu sandbox expira em Xh"**, com um botão "Quero no meu provedor" que leva ao cadastro do site real. Tokens do `DESIGN_SYSTEM.md`, sem paleta nova.

### 3.8 Limpeza

O worker da demo apaga, uma vez por hora, todo provedor `sandbox-%` com mais de 24 h e as linhas dele. Os cinco do mundo base nunca entram nessa varredura.

### 3.9 Entrada na landing

Botão **"Ver demonstração"** ao lado de "Criar conta grátis", no herói e no bloco final, apontando para `https://demo.consultaisp.com.br/demo` — mesmo padrão visual dos CTAs atuais.

---

## 4. Segurança e LGPD

- Dado real e dado de demo **nunca** se encontram: bancos, domínios e processos diferentes.
- A demo não indexa (`X-Robots-Tag`), para não competir com o site nem virar resultado de busca.
- Sem credencial paga no `.env.demo`: mesmo um bug não gasta dinheiro nem consulta pessoa real.
- CPF fictício de faixa não emitida; nenhum nome, telefone ou endereço de pessoa real.
- O visitante é anônimo: nada é pedido, nada é guardado além do sandbox descartável.

## 5. Testes

- Gerador do mundo: teste de que o volume e as sobreposições saem como especificado, e de que todo CPF gerado tem DV válido e está na faixa reservada.
- Sandbox: criação, expiração, limpeza (o que apaga e o que nunca apaga).
- Conector de demonstração: responde o contrato lendo da base; registrado só em `DEMO_MODE`.
- Bureaus simulados: determinismo por CPF, selo no contrato, zero chamada de rede.
- Saídas inertes: e-mail/WhatsApp/webhook/ZapSign não disparam em `DEMO_MODE`.
- Gates do projeto: `npx vitest run` com saída 0 e `npx tsc --noEmit` em 57.

## 6. Deploy

Segundo par de processos na VPS, criado uma vez (banco, role, `.env.demo`, nginx, pm2, seed do mundo base). Depois disso, a demo sobe junto com produção: mesmo `git pull` e `npm run build`, `pm2 restart` do par da demo.

## 7. Fora de escopo

White label na demo, pagamento/compra de créditos de verdade, importação, edição do mundo base pela tela, e qualquer envio real ao mundo exterior.

## 8. Riscos

1. **A demo envelhecer.** Mitigação: mesmo código, uma única chave de comportamento; o que muda é dado, não caminho.
2. **O visitante achar que o número é real.** Mitigação: selo em toda tela e nos relatórios simulados.
3. **Custo de um segundo par de processos** na mesma VPS (memória). Mitigação: `max_memory_restart` menor na demo; o worker da demo só roda limpeza e régua.
4. **Alguém compartilhar o link do sandbox.** É inofensivo: expira em 24 h e não contém nada real.
