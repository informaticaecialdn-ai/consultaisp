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

- [ ] **Passo 1: Teste que falha** — `server/demo/limpeza.service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const fake = vi.hoisted(() => ({ expirados: vi.fn(), apagar: vi.fn() }));
vi.mock("./sandbox.service", () => ({
  sandboxesExpirados: fake.expirados,
  apagarSandbox: fake.apagar,
}));
import { limparSandboxesExpirados } from "./limpeza.service";

describe("limpeza da demo", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.DEMO_MODE = "true"; fake.apagar.mockResolvedValue(undefined); });
  afterEach(() => { delete process.env.DEMO_MODE; });

  it("apaga cada sandbox expirado", async () => {
    fake.expirados.mockResolvedValue([11, 12]);
    await expect(limparSandboxesExpirados()).resolves.toEqual({ apagados: 2 });
    expect(fake.apagar).toHaveBeenCalledWith(11);
    expect(fake.apagar).toHaveBeenCalledWith(12);
  });

  it("fora do modo demo nao apaga nada — producao nunca perde provedor", async () => {
    delete process.env.DEMO_MODE;
    await expect(limparSandboxesExpirados()).resolves.toEqual({ apagados: 0 });
    expect(fake.expirados).not.toHaveBeenCalled();
  });

  it("um sandbox que falha nao impede os outros", async () => {
    fake.expirados.mockResolvedValue([11, 12]);
    fake.apagar.mockRejectedValueOnce(new Error("fk"));
    await expect(limparSandboxesExpirados()).resolves.toEqual({ apagados: 1 });
    expect(fake.apagar).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run server/demo/limpeza.service.test.ts
```

Esperado: FAIL — `limparSandboxesExpirados` não existe.

- [ ] **Passo 3: Implementar** — `server/demo/limpeza.service.ts`, no molde da sentinela (`server/services/chat/chat-sentinela.service.ts`): guarda de dupla partida, `passada` em voo que impede sobreposição, `timer.unref()` e parada ordenada.

```ts
export async function limparSandboxesExpirados(agora = new Date()): Promise<{ apagados: number }> {
  if (!emModoDemo()) return { apagados: 0 };
  const ids = await sandboxesExpirados(agora);
  let apagados = 0;
  for (const id of ids) {
    try { await apagarSandbox(id); apagados++; }
    catch (err) { logger.warn({ providerId: id, err }, "demo: sandbox nao apagado"); }
  }
  return { apagados };
}

export function iniciarLimpezaDaDemo(): void { /* setInterval de 1 h + unref, guarda de dupla partida */ }
export function pararLimpezaDaDemo(): Promise<void> { /* limpa o timer e espera a passada em voo */ }
```

- [ ] **Passo 4: Ligar no worker** — em `server/worker.ts`, junto das outras agendas:

```ts
  const { iniciarLimpezaDaDemo } = await import("./demo/limpeza.service");
  iniciarLimpezaDaDemo();
```

e `pararLimpezaDaDemo()` no encerramento, como as vizinhas.

- [ ] **Passo 5: Rodar e ver passar.**

```bash
npx vitest run server/demo && npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Esperado: PASS, saída 0 e **57**.

- [ ] **Passo 6: Commit.**

```bash
git add server/demo/limpeza.service.ts server/demo/limpeza.service.test.ts server/worker.ts
git commit -m "feat(demo): o worker da demo apaga sandbox vencido, e so o da demo"
```

---

## Tarefa 8: Bureaus simulados com selo

**Files:**
- Create: `server/demo/bureaus-simulados.ts` + teste
- Modify: `server/services/spc/spc.service.ts` (entrada `consultarSpc`, ~linha 222)
- Modify: `server/services/bigdata.service.ts` (entrada `consultarCpf`, ~linha 1260)

**Interfaces:**
- Produces: `spcSimulado(documento)`, `cadastralSimulado(documento)`, ambos determinísticos pelo documento e com `simulado: true` no retorno.

- [ ] **Passo 1: Teste que falha** — `server/demo/bureaus-simulados.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spcSimulado, cadastralSimulado } from "./bureaus-simulados";

describe("bureaus simulados", () => {
  it("o mesmo documento devolve sempre o mesmo resultado", () => {
    expect(spcSimulado("99912345607")).toEqual(spcSimulado("99912345607"));
    expect(cadastralSimulado("99912345607")).toEqual(cadastralSimulado("99912345607"));
  });

  it("documentos diferentes produzem situacoes diferentes", () => {
    const varios = ["99900000019", "99911111150", "99922222291", "99933333332"].map(spcSimulado);
    expect(new Set(varios.map(r => r.temRestricao)).size).toBeGreaterThan(1);
    expect(new Set(varios.map(r => r.score)).size).toBeGreaterThan(1);
  });

  it("todo resultado vem marcado como simulado — a tela precisa poder avisar", () => {
    expect(spcSimulado("99912345607").simulado).toBe(true);
    expect(cadastralSimulado("99912345607").simulado).toBe(true);
  });

  it("score fica na faixa do produto (0 a 1000)", () => {
    for (let i = 0; i < 50; i++) {
      const r = spcSimulado(`999${String(i).padStart(8, "0")}`);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1000);
    }
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run server/demo/bureaus-simulados.test.ts
```

Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: Implementar** `server/demo/bureaus-simulados.ts`: um hash determinístico do documento escolhe a situação (limpo, uma restrição, várias), o score e as datas. Sem `Math.random`, sem `new Date()` sem argumento — a demonstração precisa ser reproduzível.

- [ ] **Passo 4: Desviar as duas entradas.** Primeira linha de `consultarSpc` (`server/services/spc/spc.service.ts:222`) e de `consultarCpf` (`server/services/bigdata.service.ts:1260`):

```ts
  if (emModoDemo()) return spcSimulado(documento);      // em consultarSpc
  if (emModoDemo()) return cadastralSimulado(documento); // em consultarCpf
```

- [ ] **Passo 5: Teste de que nada sai pela rede** — acrescente ao arquivo de teste um caso que liga `DEMO_MODE`, espiona `global.fetch` e chama as duas entradas: `expect(fetch).not.toHaveBeenCalled()`.

- [ ] **Passo 6: Rodar e ver passar.**

```bash
npx vitest run server/demo server/services/spc && npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Esperado: PASS, saída 0 e **57**.

- [ ] **Passo 7: Commit.**

```bash
git add server/demo/bureaus-simulados.ts server/demo/bureaus-simulados.test.ts server/services/spc/spc.service.ts server/services/bigdata.service.ts
git commit -m "feat(demo): SPC e cadastral simulados, iguais para o mesmo CPF e sem tocar a rede"
```

---

## Tarefa 9: A tela diz que é demonstração

**Files:**
- Create: `client/src/components/FaixaDemonstracao.tsx` + teste de fonte
- Modify: `client/src/App.tsx` (ao lado de `<FaixaSuporte />`, ~linha 659)
- Modify: `client/src/components/consulta/report-ui.tsx` (selo "dado simulado")

**Interfaces:**
- Consumes: `GET /api/auth/me` (já traz o provedor da sessão).
- Produces: `FaixaDemonstracao`, `SeloSimulado`.

- [ ] **Passo 1: Teste de fonte que falha** — `client/src/components/faixa-demonstracao.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "../../..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const faixa = ler("client/src/components/FaixaDemonstracao.tsx");
const app = ler("client/src/App.tsx");

describe("faixa de demonstracao", () => {
  it("diz que o dado e ficticio, com essas palavras", () => {
    expect(faixa).toContain("Demonstração — dados fictícios");
  });

  it("mostra quanto falta para o sandbox expirar", () => {
    expect(faixa).toMatch(/expira em/i);
  });

  it("leva ao cadastro do site real", () => {
    expect(faixa).toContain("https://consultaisp.com.br/login?mode=register");
    expect(faixa).toContain("Quero no meu provedor");
  });

  it("so tokens do design system — nada de paleta default nem pill", () => {
    expect(faixa).not.toMatch(/\b(bg|text|border)-(slate|gray|blue|emerald|red|amber|zinc)-\d{2,3}\b/);
    expect(faixa).not.toContain("rounded-full");
    expect(faixa).toMatch(/var\(--/);
  });

  it("monta na coluna de conteudo, junto da faixa de suporte", () => {
    expect(app).toContain("<FaixaDemonstracao />");
    expect(app.indexOf("<FaixaDemonstracao />")).toBeGreaterThan(app.indexOf("<FaixaSuporte />") - 400);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run client/src/components/faixa-demonstracao.test.ts
```

Esperado: FAIL — o componente não existe.

- [ ] **Passo 3: Implementar** `FaixaDemonstracao.tsx`: lê o provedor da sessão (`GET /api/auth/me`, TanStack Query como o resto do client), só renderiza quando o subdomínio casa `^sandbox-`, calcula as horas restantes a partir da criação e mostra o CTA. Tokens do `DESIGN_SYSTEM.md`, faixa retangular (raio ≤ 8px).

- [ ] **Passo 4: Montar no shell** — em `client/src/App.tsx`, logo abaixo de `<FaixaSuporte />` (a razão estrutural daquele lugar está comentada ali mesmo).

- [ ] **Passo 5: Selo do dado simulado** — em `client/src/components/consulta/report-ui.tsx`, um `SeloSimulado` reaproveitando a primitiva de selo de proveniência já existente, exibido quando o resultado vier com `simulado: true`.

- [ ] **Passo 6: Rodar e ver passar.**

```bash
npx vitest run client/src/components && npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Esperado: PASS, saída 0 e **57**.

- [ ] **Passo 7: Commit.**

```bash
git add client/src/components/FaixaDemonstracao.tsx client/src/components/faixa-demonstracao.test.ts client/src/App.tsx client/src/components/consulta/report-ui.tsx
git commit -m "feat(demo): a tela inteira avisa que e demonstracao, e o relatorio simulado leva selo"
```

---

## Tarefa 10: O botão na landing

**Files:**
- Modify: `client/src/pages/public/landingpage.tsx` (herói ~246, CTA final ~912)
- Modify: `client/src/pages/public/landingpage.test.ts`

- [ ] **Passo 1: Teste que falha** — acrescente a `client/src/pages/public/landingpage.test.ts`:

```ts
describe("porta da demonstração", () => {
  it("leva ao demo, nos dois blocos de CTA", () => {
    const ocorrencias = fonte.match(/https:\/\/demo\.consultaisp\.com\.br\/demo/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
    expect(fonte).toContain("Ver demonstração");
  });

  it("abre em outra aba, sem entregar a sessao da landing", () => {
    expect(fonte).toMatch(/demo\.consultaisp\.com\.br\/demo"[^>]*target="_blank"[^>]*rel="noopener"/s);
  });

  it("o cadastro continua sendo a acao principal", () => {
    expect(fonte).toContain("Criar conta grátis");
  });
});
```

(`fonte` é a leitura do arquivo que o teste já faz no topo.)

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run client/src/pages/public/landingpage.test.ts
```

Esperado: FAIL — nenhum link para o demo.

- [ ] **Passo 3: Implementar** — no herói (junto de "Criar conta grátis") e no CTA final:

```tsx
<a href="https://demo.consultaisp.com.br/demo" target="_blank" rel="noopener" className="btn btn-secondary on-dark btn-lg">Ver demonstração</a>
```

- [ ] **Passo 4: Rodar e ver passar.**

```bash
npx vitest run client/src/pages/public && npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Esperado: PASS, saída 0 e **57**.

- [ ] **Passo 5: Commit.**

```bash
git add client/src/pages/public/landingpage.tsx client/src/pages/public/landingpage.test.ts
git commit -m "feat(demo): a landing tem porta para a demonstracao, ao lado do cadastro"
```

---

## Tarefa 11: A instância na VPS

**Files:**
- Create: `ecosystem.demo.config.cjs`
- Create: `docs/demo-instancia.md`

> **Quem executa:** o controlador, não um subagente — é operação de produção por ssh (banco, nginx, pm2), como a Tarefa 9 da etapa do WhatsApp. Os dois arquivos abaixo são versionados antes de qualquer comando na VPS.

- [ ] **Passo 1: `ecosystem.demo.config.cjs`** — cópia do atual com quatro mudanças:

```js
const dotenv = require("dotenv");
// O par da demo le o .env DELA. Sem o path explicito o pm2 leria o .env de
// producao e a demo subiria apontando para o banco real — exatamente o que a
// instancia separada existe para impedir.
const env = dotenv.config({ path: ".env.demo" }).parsed || {};

module.exports = {
  apps: [
    {
      name: "consulta-isp-demo",
      script: "dist/index.cjs",
      exec_mode: "fork",
      max_memory_restart: "512M",
      kill_timeout: 35000,
      env: { ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-demo-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-demo-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "consulta-isp-demo-worker",
      script: "dist/worker.cjs",
      exec_mode: "fork",
      // 512M, nao 4G: o worker da demo so roda a limpeza de sandbox e a regua.
      // Ele nao carrega o CNEFE, que e o que obriga producao a ter 4G.
      max_memory_restart: "512M",
      kill_timeout: 35000,
      restart_delay: 10000,
      min_uptime: "60s",
      max_restarts: 5,
      env: { ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-demo-worker-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-demo-worker-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
```

- [ ] **Passo 2: `docs/demo-instancia.md`** — o roteiro completo, com os comandos reais:

```bash
# banco e role proprios (padrao do chatbullq)
su postgres -c "psql -c \"CREATE ROLE demo LOGIN PASSWORD '<gerada na VPS>'\""
su postgres -c "psql -c 'CREATE DATABASE consultaispdemo OWNER demo'"

# checkout proprio, mesma branch de producao
git clone /var/www/consulta-isp /var/www/consulta-isp-demo
cd /var/www/consulta-isp-demo && git remote set-url origin <remote de producao> && git checkout feat/localizacao

# .env.demo (600): DEMO_MODE=true, PORT=5001, DATABASE_URL do consultaispdemo,
# SESSION_SECRET propria, e as obrigatorias do validateEnv (LGPD_CNPJ, LGPD_EMPRESA,
# MAIN_DOMAIN). SEM Resend, WhatsApp, ZapSign, Asaas, SPC e BigDataCorp.

npm install && npm run build
pm2 start ecosystem.demo.config.cjs && pm2 save
npx tsx script/semear-demo.ts        # semeia o mundo base uma vez
```

nginx `demo-consultaisp`, com a linha que mantém a demo fora da busca:

```nginx
server {
  server_name demo.consultaisp.com.br;
  add_header X-Robots-Tag "noindex, nofollow" always;
  location / { proxy_pass http://127.0.0.1:5001; proxy_set_header Host $host; }
}
```

E como se reverte: `pm2 delete consulta-isp-demo consulta-isp-demo-worker`. Produção não é tocada em nenhum passo — outro banco, outro processo, outro domínio.

- [ ] **Passo 3: Conferir no ar.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://demo.consultaisp.com.br/demo     # 302 para /
curl -sI https://demo.consultaisp.com.br/ | grep -i x-robots-tag                  # noindex
curl -s -o /dev/null -w '%{http_code}\n' https://consultaisp.com.br/api/health    # 200 — producao intacta
```

- [ ] **Passo 4: Commit dos dois arquivos.**

```bash
git add ecosystem.demo.config.cjs docs/demo-instancia.md
git commit -m "chore(demo): par de processos e roteiro da instancia de demonstracao"
```

---

## Auto-revisão do plano

**Cobertura da spec:** §3.1 instância → Tarefa 11; §3.2 mundo base → Tarefas 2 e 3; §3.3 sandbox → Tarefas 5 e 6; §3.4 conector → Tarefa 4; §3.5 bureaus → Tarefa 8; §3.6 saídas inertes → Tarefa 1 (e-mail) — **as demais saídas (WhatsApp, webhook, ZapSign) são cobertas pela ausência de credencial no `.env.demo`, documentada na Tarefa 11**; §3.7 faixa → Tarefa 9; §3.8 limpeza → Tarefa 7; §3.9 landing → Tarefa 10.

**Desvio declarado:** a spec fala em guarda explícita nas quatro saídas. O plano implementa a guarda só no e-mail, que é a única com chave (`RESEND_API_KEY`) presente em qualquer ambiente. WhatsApp, webhook e ZapSign já param sozinhos sem credencial, e uma guarda a mais em cada um seria código sem teste possível na demo. Se o revisor discordar, vira tarefa própria.

**Tipos conferidos:** `ErpFetchResult`/`NormalizedErpCustomer` (Tarefa 4) batem com `server/erp/types.ts:151,241`; colunas de `customers`/`invoices`/`equipment`/`erp_integrations` (Tarefa 3) conferidas em `shared/schema.ts`; sessão (Tarefa 6) no molde de `auth.routes.ts:262-268`.
