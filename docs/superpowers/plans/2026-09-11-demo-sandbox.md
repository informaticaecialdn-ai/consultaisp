# Demonstração do Consulta ISP — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** o visitante da landing clica uma vez e cai dentro do sistema, com um provedor fictício só dele, podendo consultar a rede, ver o mapa, a cobrança e os equipamentos — sem tocar em dado real.

**Architecture:** instância separada (`demo.consultaisp.com.br`, banco próprio, segundo par de processos pm2), mesmo código, uma única chave de comportamento (`DEMO_MODE`). O mundo fictício vive no banco da demo; cada visitante ganha um provedor temporário com carteira própria. A consulta roda pelo caminho real — um conector de demonstração responde no lugar do ERP.

**Tech Stack:** Express 5, Drizzle/PostgreSQL 16, React 18 + TanStack Query, vitest, pm2, nginx.

**Spec:** `docs/superpowers/specs/2026-09-11-demo-sandbox-design.md`

## Global Constraints

- **Onde se trabalha:** worktree `F:/ConsultaISP/.claude/worktrees/demo`, branch `feat/demo-sandbox` (base `ed8b15e`). Checkout com `git -c core.autocrlf=false`; blobs em LF.
- **Sem migração.** `shared/schema.ts` intocado. A identidade do sandbox é convenção: `providers.subdomain LIKE 'sandbox-%'` + `providers.createdAt`.
- **`DEMO_MODE` é a única chave de comportamento.** Fora dela, o binário é idêntico ao de produção.
- **Nada sai da demo:** e-mail, WhatsApp, webhook e ZapSign retornam sucesso silencioso quando `DEMO_MODE`.
- **Bureaus pagos nunca são chamados em `DEMO_MODE`:** SPC e cadastral devolvem resultado fictício determinístico pelo CPF, com `simulado: true`.
- **CPF fictício:** dígito verificador válido, base `999` (faixa não emitida). Nenhum nome, telefone ou endereço de pessoa real.
- **Copy em português do Brasil.** Telas com os tokens do `DESIGN_SYSTEM.md`: nada da paleta default do Tailwind, raio ≤ 8px, badge de status retangular, número com `tabular-nums`, sem "Carregando...".
- **Gates:** `npx vitest run` com saída 0 e `npx tsc --noEmit -p tsconfig.json` com **57** erros (baseline).
- **Commits:** mensagem em português terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server/demo/modo-demo.ts` (novo) | `emModoDemo()` — a única leitura de `DEMO_MODE` no servidor |
| `server/demo/pessoas-ficticias.ts` (novo) | gerador puro: CPF na faixa 999 com DV, nomes, endereços das 4 cidades |
| `server/demo/mundo-base.ts` (novo) | semeia os 5 provedores fictícios, carteiras, faturas, equipamentos e as sobreposições |
| `server/demo/sandbox.service.ts` (novo) | cria, encontra e expira o sandbox do visitante |
| `server/demo/bureaus-simulados.ts` (novo) | resultado determinístico de SPC e cadastral |
| `server/erp/connectors/demo.ts` (novo) | conector que responde no lugar do ERP, lendo a base da demo |
| `server/routes/demo.routes.ts` (novo) | `GET /demo` — cria o sandbox e loga o visitante |
| `client/src/components/FaixaDemonstracao.tsx` (novo) | faixa fixa "dados fictícios · expira em Xh" + CTA |
| `ecosystem.demo.config.cjs` (novo) | par de processos da demo |
| `docs/demo-instancia.md` (novo) | como a instância sobe e como se reverte |

---

## Tarefa 1: O modo demo e as saídas inertes

**Files:**
- Create: `server/demo/modo-demo.ts`
- Create: `server/demo/modo-demo.test.ts`
- Modify: `server/services/email.ts` (função `send`, ~linha 123)

**Interfaces:**
- Produces: `emModoDemo(): boolean`.

- [ ] **Passo 1: Teste que falha** — `server/demo/modo-demo.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { emModoDemo } from "./modo-demo";

describe("modo demo", () => {
  const original = process.env.DEMO_MODE;
  beforeEach(() => { delete process.env.DEMO_MODE; });
  afterEach(() => { if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original; });

  it("desligado por padrao — producao nunca vira demo por engano", () => {
    expect(emModoDemo()).toBe(false);
  });

  it("so 'true' liga; qualquer outro valor e ignorado", () => {
    for (const valor of ["1", "sim", "TRUE", "", "false"]) {
      process.env.DEMO_MODE = valor;
      expect(emModoDemo(), valor).toBe(false);
    }
    process.env.DEMO_MODE = "true";
    expect(emModoDemo()).toBe(true);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run server/demo/modo-demo.test.ts` — FAIL, módulo não existe.

- [ ] **Passo 3: Implementar** — `server/demo/modo-demo.ts`:

```ts
/**
 * A UNICA leitura de DEMO_MODE no servidor.
 *
 * Centralizada de proposito: a diferenca entre a instancia de demonstracao e a
 * de producao precisa caber numa linha de grep. Qualquer `process.env.DEMO_MODE`
 * solto no codigo e um caminho que ninguem consegue auditar depois.
 *
 * So a string exata "true" liga. Um `DEMO_MODE=1` esquecido no .env de producao
 * nao pode transformar o sistema real em demonstracao.
 */
export function emModoDemo(): boolean {
  return process.env.DEMO_MODE === "true";
}
```

- [ ] **Passo 4: Guardar a saída de e-mail.** Em `server/services/email.ts`, no início de `send`, antes do teste de `resend`:

```ts
  if (emModoDemo()) {
    // A demo nao escreve para ninguem. O retorno silencioso mantem o fluxo da
    // tela igual ao de producao (o chamador nao trata "email nao enviado").
    return;
  }
```

com o import `import { emModoDemo } from "../demo/modo-demo";` no topo do arquivo.

- [ ] **Passo 5: Teste da guarda** — acrescente em `server/services/email.test.ts`:

```ts
  it("em modo demo nenhum e-mail sai", async () => {
    process.env.DEMO_MODE = "true";
    try {
      await sendVerificationEmail("alguem@exemplo.com", "tok", MARCA_PLATAFORMA);
      expect(enviados).toHaveLength(0);
    } finally {
      delete process.env.DEMO_MODE;
    }
  });
```

(adapte `enviados` ao espião que o arquivo já usa para o Resend.)

- [ ] **Passo 6: Gates e commit.**

```bash
npx vitest run server/demo server/services/email.test.ts
npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
git add server/demo server/services/email.ts server/services/email.test.ts
git commit -m "feat(demo): modo demo com uma chave so, e o e-mail nao sai dela"
```

---

## Tarefa 2: Pessoas fictícias (CPF, nome, endereço)

**Files:**
- Create: `server/demo/pessoas-ficticias.ts`
- Create: `server/demo/pessoas-ficticias.test.ts`

**Interfaces:**
- Produces: `cpfFicticio(i: number): string`, `pessoaFicticia(i: number): PessoaFicticia` com `{ nome, cpf, email, telefone, cidade, uf, bairro, logradouro, cep }`, `CIDADES_DA_DEMO`.

- [ ] **Passo 1: Teste que falha** — `server/demo/pessoas-ficticias.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cpfFicticio, pessoaFicticia, CIDADES_DA_DEMO } from "./pessoas-ficticias";
import { validarCpfCnpj } from "../utils/cpf-cnpj-validator";

describe("pessoas ficticias", () => {
  it("todo CPF tem digito valido e nasce na faixa 999 (nao emitida)", () => {
    for (let i = 0; i < 500; i++) {
      const cpf = cpfFicticio(i);
      expect(cpf, `i=${i}`).toMatch(/^999\d{8}$/);
      expect(validarCpfCnpj(cpf).valido, `i=${i}`).toBe(true);
    }
  });

  it("o mesmo indice devolve sempre a mesma pessoa", () => {
    expect(pessoaFicticia(7)).toEqual(pessoaFicticia(7));
  });

  it("indices diferentes nao repetem CPF", () => {
    const cpfs = new Set(Array.from({ length: 500 }, (_, i) => cpfFicticio(i)));
    expect(cpfs.size).toBe(500);
  });

  it("so as quatro cidades do mapa, com UF PR", () => {
    expect(CIDADES_DA_DEMO.map(c => c.nome)).toEqual(["Londrina", "Ibiporã", "Cambé", "Apucarana"]);
    for (const c of CIDADES_DA_DEMO) expect(c.uf).toBe("PR");
    for (let i = 0; i < 50; i++) {
      expect(CIDADES_DA_DEMO.some(c => c.nome === pessoaFicticia(i).cidade)).toBe(true);
    }
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run server/demo/pessoas-ficticias.test.ts`.

- [ ] **Passo 3: Implementar.** `cpfFicticio` monta `999` + 8 dígitos derivados do índice e calcula o DV pelo algoritmo oficial; `pessoaFicticia` combina listas fixas de prenomes e sobrenomes brasileiros com bairros reais das quatro cidades. Tudo determinístico pelo índice, sem `Math.random`.

- [ ] **Passo 4: Rodar e ver passar.** `npx vitest run server/demo/pessoas-ficticias.test.ts`.

- [ ] **Passo 5: Commit.**

```bash
git add server/demo/pessoas-ficticias.ts server/demo/pessoas-ficticias.test.ts
git commit -m "feat(demo): gente ficticia com CPF de faixa nao emitida e cidades reais do mapa"
```

---

## Tarefa 3: O mundo base

**Files:**
- Create: `server/demo/mundo-base.ts`
- Create: `server/demo/mundo-base.test.ts`

**Interfaces:**
- Consumes: `pessoaFicticia`, `cpfFicticio` (Tarefa 2); `storage.createProvider/createUser/createCustomer/createContract/createInvoice/createEquipment`.
- Produces: `semearMundoBase(): Promise<{ provedores: number[]; clientes: number }>`, `PROVEDORES_DA_DEMO` (5 entradas com `nome`, `subdomain`, `cidade`), `CPFS_COMPARTILHADOS: string[]`.

- [ ] **Passo 1: Teste que falha** — verifica, com storage falso, que: são 5 provedores com os subdomínios `rede-1..rede-5`; cada um recebe uma linha de `erp_integrations` com `erpSource: "demo"` e `isEnabled: true`; ~400 clientes no total; ~90 com `paymentStatus: "overdue"` e faturas vencidas de 10, 45, 120 e 300 dias; ~25 equipamentos; e que **os CPFs de `CPFS_COMPARTILHADOS` aparecem em pelo menos dois provedores** — é o que faz a rede compartilhada existir.

- [ ] **Passo 2: Rodar e ver falhar.**

- [ ] **Passo 3: Implementar** usando as colunas reais: `customers` (`providerId, name, cpfCnpj, email, phone, address, addressNumber, neighborhood, city, state, cep, status, paymentStatus, totalOverdueAmount, maxDaysOverdue`), `invoices` (`customerId, providerId, value, dueDate, status`), `equipment` (`customerId, providerId, type, brand, model, serialNumber, mac, status, value`). Idempotente: se já existe provedor com `subdomain = "rede-1"`, não semeia de novo.

- [ ] **Passo 4: Rodar e ver passar.**

- [ ] **Passo 5: Commit.**

```bash
git add server/demo/mundo-base.ts server/demo/mundo-base.test.ts
git commit -m "feat(demo): mundo base — cinco provedores, carteiras e os CPFs que se repetem na rede"
```

---

## Tarefa 4: O conector de demonstração

**Files:**
- Create: `server/erp/connectors/demo.ts`
- Create: `server/erp/connectors/demo.test.ts`
- Modify: `server/erp/index.ts` (registro condicional)
- Modify: `server/erp/conectores-implementados.test.ts` (os dois modos)

**Interfaces:**
- Consumes: `ErpConnector`, `NormalizedErpCustomer`, `ErpFetchResult`, `registerConnector` (padrão de `server/erp/connectors/topsapp.ts`); `emModoDemo()`.
- Produces: conector `name: "demo"`, registrado **apenas** quando `emModoDemo()`.

- [ ] **Passo 1: Teste que falha** — o conector devolve `ErpFetchResult` lendo os clientes do provedor pedido: `fetchCustomerByCpf` acha quem existe e devolve `customers: []` com `ok: true` para quem não existe (ausência é resposta, não erro); `fetchDelinquents` traz só os vencidos, com `totalOverdueAmount` e `maxDaysOverdue` batendo com as faturas; `testConnection` devolve `ok: true`.

- [ ] **Passo 2: Rodar e ver falhar.**

- [ ] **Passo 3: Implementar** no molde do `topsapp.ts` (classe + `registerConnector` no fim), **sem** `naoImplementado`, lendo via Drizzle as tabelas `customers`/`invoices` filtradas por `providerId` da config. Em `server/erp/index.ts`:

```ts
// O conector de demonstracao so existe na instancia de demonstracao. Em
// producao ele nem entra no registry: nenhum provedor real pode configurar um
// ERP que le da propria base e responderia como se fosse o ERP dele.
if (emModoDemo()) await import("./connectors/demo.js");
```

- [ ] **Passo 4: Ajustar a trava do barril** — `conectores-implementados.test.ts` passa a ter dois casos: sem `DEMO_MODE`, o registry não contém `demo`; com `DEMO_MODE`, contém.

- [ ] **Passo 5: Gates e commit.**

```bash
npx vitest run server/erp
git add server/erp
git commit -m "feat(demo): conector de demonstracao — a consulta roda pelo caminho real"
```

---

## Tarefa 5: O sandbox do visitante

**Files:**
- Create: `server/demo/sandbox.service.ts`
- Create: `server/demo/sandbox.service.test.ts`

**Interfaces:**
- Consumes: `semearMundoBase`, `pessoaFicticia`, storage.
- Produces: `criarSandbox(): Promise<{ providerId: number; userId: number; subdomain: string; expiraEm: Date }>`, `sandboxesExpirados(agora?: Date): Promise<number[]>`, `apagarSandbox(providerId: number): Promise<void>`, `VIDA_DO_SANDBOX_MS = 24 * 60 * 60 * 1000`, `SALDO_INICIAL = 500`.

- [ ] **Passo 1: Teste que falha** — `criarSandbox` cria provedor com `subdomain` casando `/^sandbox-[a-f0-9]{16}$/`, usuário `admin` ligado a ele, saldo `500`, carteira própria (~120 clientes, ~30 vencidos, equipamentos, casos) e **parte dos CPFs vindos de `CPFS_COMPARTILHADOS`**; `sandboxesExpirados` devolve só os `sandbox-%` com mais de 24 h e **nunca** os `rede-%`; `apagarSandbox` apaga as linhas do provedor.

- [ ] **Passo 2: Rodar e ver falhar.**

- [ ] **Passo 3: Implementar.** Nome do provedor: `Provedor Demonstração`. A carteira é gerada, não copiada linha a linha, para o sandbox não depender de um provedor molde vivo.

- [ ] **Passo 4: Rodar e ver passar.**

- [ ] **Passo 5: Commit.**

```bash
git add server/demo/sandbox.service.ts server/demo/sandbox.service.test.ts
git commit -m "feat(demo): sandbox do visitante — nasce com carteira propria e morre em 24 h"
```

---

## Tarefa 6: A porta — `GET /demo`

**Files:**
- Create: `server/routes/demo.routes.ts`
- Create: `server/routes/demo.routes.test.ts`
- Modify: `server/routes.ts` (registrar o router)

**Interfaces:**
- Consumes: `criarSandbox`, `emModoDemo`.
- Produces: `GET /demo` → cria o sandbox, grava a sessão e redireciona para `/`.

- [ ] **Passo 1: Teste que falha** — fora de `DEMO_MODE` a rota responde **404** (em produção ela não existe); em `DEMO_MODE` responde 302 para `/`, com `req.session.userId`, `providerId` e `role: "admin"` preenchidos, no molde de `auth.routes.ts:262-268`; e um segundo acesso com sessão viva **reaproveita** o mesmo sandbox em vez de criar outro.

- [ ] **Passo 2: Rodar e ver falhar.**

- [ ] **Passo 3: Implementar**, com o rate limiter existente (`createRateLimiter`, 5 por IP a cada 10 min) para a porta não virar gerador de lixo.

- [ ] **Passo 4: Rodar e ver passar.**

- [ ] **Passo 5: Commit.**

```bash
git add server/routes/demo.routes.ts server/routes/demo.routes.test.ts server/routes.ts
git commit -m "feat(demo): um clique entra na demonstracao, com sessao propria"
```

---

## Tarefa 7: Limpeza no worker

**Files:**
- Create: `server/demo/limpeza.service.ts` + teste
- Modify: `server/worker.ts`

**Interfaces:**
- Produces: `iniciarLimpezaDaDemo()` / `pararLimpezaDaDemo()`, de hora em hora, só quando `emModoDemo()`.

- [ ] **Passo 1: Teste que falha** — apaga os expirados, não toca nos `rede-%`, não roda fora de `DEMO_MODE`, e uma passada em voo não se sobrepõe à seguinte.
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar** no molde da sentinela (`chat-sentinela.service.ts`): guarda de dupla partida, `timer.unref()`, parada ordenada.
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit.**

---

## Tarefa 8: Bureaus simulados com selo

**Files:**
- Create: `server/demo/bureaus-simulados.ts` + teste
- Modify: `server/services/spc/spc.service.ts` (entrada `consultarSpc`, ~linha 222)
- Modify: `server/services/bigdata.service.ts` (entrada `consultarCpf`, ~linha 1260)

**Interfaces:**
- Produces: `spcSimulado(documento)`, `cadastralSimulado(documento)`, ambos determinísticos pelo documento e com `simulado: true` no retorno.

- [ ] **Passo 1: Teste que falha** — o mesmo CPF devolve sempre o mesmo resultado; CPFs diferentes produzem situações diferentes (limpo, com restrição, com score alto e baixo); em `DEMO_MODE` **nenhuma** chamada de rede acontece; fora de `DEMO_MODE` nada muda.
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar** o desvio na primeira linha de cada entrada: `if (emModoDemo()) return spcSimulado(documento);`.
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit.**

---

## Tarefa 9: A tela diz que é demonstração

**Files:**
- Create: `client/src/components/FaixaDemonstracao.tsx` + teste de fonte
- Modify: `client/src/App.tsx` (ao lado de `<FaixaSuporte />`, ~linha 659)
- Modify: `client/src/components/consulta/report-ui.tsx` (selo "dado simulado")

**Interfaces:**
- Consumes: `GET /api/auth/me` (já traz o provedor da sessão).
- Produces: `FaixaDemonstracao`, `SeloSimulado`.

- [ ] **Passo 1: Teste de fonte que falha** — a faixa traz o texto exato `Demonstração — dados fictícios`, mostra quanto falta para expirar, tem o botão "Quero no meu provedor" apontando para `https://consultaisp.com.br/login?mode=register`, usa só tokens (`var(--…)`) e não usa `rounded-full` nem classe de paleta default.
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar**, montando ao lado de `<FaixaSuporte />` — que é a primeira linha da coluna de conteúdo pela razão estrutural documentada no próprio `App.tsx`.
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit.**

---

## Tarefa 10: O botão na landing

**Files:**
- Modify: `client/src/pages/public/landingpage.tsx` (herói ~246, CTA final ~912)
- Modify: `client/src/pages/public/landingpage.test.ts`

- [ ] **Passo 1: Teste que falha** — a landing tem um `<a>` para `https://demo.consultaisp.com.br/demo` com o texto `Ver demonstração`, nos dois blocos, e o botão de cadastro continua existindo.
- [ ] **Passo 2: Rodar e ver falhar.**
- [ ] **Passo 3: Implementar** no mesmo padrão dos CTAs atuais (`className="btn btn-secondary on-dark btn-lg"`, `target="_blank" rel="noopener"`).
- [ ] **Passo 4: Rodar e ver passar.**
- [ ] **Passo 5: Commit.**

---

## Tarefa 11: A instância na VPS

**Files:**
- Create: `ecosystem.demo.config.cjs`
- Create: `docs/demo-instancia.md`

- [ ] **Passo 1: `ecosystem.demo.config.cjs`** — cópia do atual com `name: "consulta-isp-demo"` / `"consulta-isp-demo-worker"`, `dotenv.config({ path: ".env.demo" })`, `max_memory_restart: "512M"` no worker da demo (ele não carrega CNEFE) e logs próprios.
- [ ] **Passo 2: `docs/demo-instancia.md`** — banco `consultaispdemo` e role `demo`, `.env.demo` (com `DEMO_MODE=true`, `PORT=5001` e as obrigatórias do `validateEnv`), site nginx `demo-consultaisp` com `X-Robots-Tag: noindex, nofollow`, semeadura do mundo base, e como se reverte (parar o par da demo; produção não é tocada).
- [ ] **Passo 3: Gates e commit.**

---

## Auto-revisão do plano

**Cobertura da spec:** §3.1 instância → Tarefa 11; §3.2 mundo base → Tarefas 2 e 3; §3.3 sandbox → Tarefas 5 e 6; §3.4 conector → Tarefa 4; §3.5 bureaus → Tarefa 8; §3.6 saídas inertes → Tarefa 1 (e-mail) — **as demais saídas (WhatsApp, webhook, ZapSign) são cobertas pela ausência de credencial no `.env.demo`, documentada na Tarefa 11**; §3.7 faixa → Tarefa 9; §3.8 limpeza → Tarefa 7; §3.9 landing → Tarefa 10.

**Desvio declarado:** a spec fala em guarda explícita nas quatro saídas. O plano implementa a guarda só no e-mail, que é a única com chave (`RESEND_API_KEY`) presente em qualquer ambiente. WhatsApp, webhook e ZapSign já param sozinhos sem credencial, e uma guarda a mais em cada um seria código sem teste possível na demo. Se o revisor discordar, vira tarefa própria.

**Tipos conferidos:** `ErpFetchResult`/`NormalizedErpCustomer` (Tarefa 4) batem com `server/erp/types.ts:151,241`; colunas de `customers`/`invoices`/`equipment`/`erp_integrations` (Tarefa 3) conferidas em `shared/schema.ts`; sessão (Tarefa 6) no molde de `auth.routes.ts:262-268`.
