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

- [ ] **Passo 1: Teste que falha** — com a base de teste, verifica as proporções que o dono definiu (medida de provedor real):

```ts
const PROPORCOES = { clientes: 1500, inadimplentes: 225, cancelados: 150, comEquipamento: 120, compartilhados: 150 };

it("cada provedor nasce com a carteira de um provedor real", async () => {
  await semearMundoBase();
  for (const p of PROVEDORES_DA_DEMO) {
    const clientes = await clientesDe(p.subdomain);
    expect(clientes).toHaveLength(PROPORCOES.clientes);
    expect(clientes.filter(c => c.paymentStatus === "overdue")).toHaveLength(PROPORCOES.inadimplentes);
    expect(clientes.filter(c => c.status === "cancelled")).toHaveLength(PROPORCOES.cancelados);
  }
});

it("as faturas vencidas cobrem as quatro idades, para a regua ter o que mostrar", async () => {
  const idades = await idadesDeVencimento("rede-1");
  for (const dias of [10, 45, 120, 300]) expect(idades).toContain(dias);
});

it("8% tem equipamento em comodato", async () => {
  expect(await equipamentosDe("rede-1")).toHaveLength(PROPORCOES.comEquipamento);
});

it("10% da carteira existe em outro provedor — e o que faz a rede aparecer", async () => {
  const compartilhados = await cpfsEmMaisDeUmProvedor();
  expect(compartilhados.length).toBeGreaterThanOrEqual(PROPORCOES.compartilhados);
});

it("cada provedor tem integracao 'demo' habilitada, senao a consulta nunca o chama", async () => {
  for (const p of PROVEDORES_DA_DEMO) {
    expect(await integracaoDe(p.subdomain)).toMatchObject({ erpSource: "demo", isEnabled: true });
  }
});

it("semear duas vezes nao duplica nada", async () => {
  await semearMundoBase();
  await semearMundoBase();
  expect(await totalDeProvedores()).toBe(PROVEDORES_DA_DEMO.length);
});
```

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
- Consumes: `semearMundoBase`, `PROVEDORES_DA_DEMO`, `CPFS_COMPARTILHADOS` (`./mundo-base.ts`); `pessoaFicticia`, `cpfFicticio` (`./pessoas-ficticias.ts`); `hashPassword` (`../password.ts`, verificado abaixo); `storage.createProvider`, `storage.createUser` — os DOIS ÚNICOS criadores da camada de storage que este arquivo chama (`server/storage/providers.storage.ts:161-164` e `server/storage/users.storage.ts:92-96`, ambos um INSERT simples que devolve a linha criada). Clientes, faturas, equipamentos e casos de cobrança vão por `db.insert(...)` direto, no molde de `mundo-base.ts` — nunca `storage.createCustomer` por linha (Passo 3.1), e `contracts` não entra: nenhuma linha do mundo da demo ou do sandbox usa essa tabela. Para o teste do sinal de migrador serial (Passo 1): `detectMigrator` (`../services/migrator-detection.service.ts`), `getConnector`, `buildConnectorConfig` (`../erp/registry.ts`, `../erp/config.ts` — mesmo par já usado por `mundo-base.test.ts`), `FONTE_ERP_DEMO` (`../erp/fonte-demo.ts`).
- Produces: `criarSandbox(): Promise<{ providerId: number; userId: number; subdomain: string; expiraEm: Date }>`, `sandboxesExpirados(agora?: Date): Promise<number[]>`, `apagarSandbox(providerId: number): Promise<void>`, `VIDA_DO_SANDBOX_MS = 24 * 60 * 60 * 1000`, `SALDO_INICIAL = 500`.

> **`SALDO_INICIAL` — para qual coluna, e por quê as duas.** `providers` não tem
> uma coluna "saldo": tem `ispCredits` e `spcCredits`, separadas
> (`shared/schema.ts:167-168`). Mas **hoje só `isp_credits` é lido ou debitado
> por qualquer caminho de consumo real** — confirmado abrindo os dois débitos:
> `debitAndCreateIspConsultation` (`server/storage/consultations.storage.ts:230-238`)
> e `debitAndCreateSpcConsultation` (`server/storage/consultations.storage.ts:213-221`)
> executam o MESMO `UPDATE providers SET isp_credits = isp_credits - ${cost} ...`
> — a consulta SPC também desconta de `isp_credits`, nunca de `spc_credits`. Isso
> não é bug: está documentado no próprio código-fonte —
> `server/routes/consultas.routes.ts:1023` ("Saldo unico: a consulta SPC debita
> de isp_credits") e `:1052-1056` (o próprio gate de saldo insuficiente lê
> `provider.ispCredits`, nunca `provider.spcCredits`). `spc_credits` segue na
> tabela (pode ser lido cru em algum outro canto, ex.: `getProvider()` sem
> passar pelo resumo do dashboard, que zera o campo — `server/storage/dashboard.storage.ts:77-79`),
> mas não é o que impede o visitante de continuar clicando.
>
> **Decisão do dono:** ainda assim, semear os DOIS campos a 500 — não custa
> nada e cobre qualquer leitura direta de `spcCredits` que exista fora do
> caminho de consumo. `criarSandbox()` grava `ispCredits: SALDO_INICIAL,
> spcCredits: SALDO_INICIAL` na criação do provider (via `storage.createProvider`).
> Mata o helper `saldoDe` do teste original (não existe uma única coluna para
> ele ler) — o teste do Passo 1 agora afirma sobre `ispCredits`/`spcCredits`
> pelo nome real.

> **O que `pessoaFicticia(i)` realmente devolve** (`server/demo/pessoas-ficticias.ts:27-46`):
> `{ nome, cpf, email, telefone, cidade, uf, bairro, logradouro, numero, cep, latitude, longitude }`.
> `numero`, `latitude` e `longitude` (este par já em string decimal, o formato de
> `customers.latitude`/`customers.longitude`) existem e são exatamente o que o
> Passo 3.2 (coordenadas) e a coluna `addressNumber` de `customers` (Tarefa 3)
> precisam — nenhum dos dois exige geocodificação sob demanda.

- [ ] **Passo 1: Teste que falha** — `server/demo/sandbox.service.test.ts`:

```ts
it("nasce com a carteira de um provedor de verdade", async () => {
  const s = await criarSandbox();
  expect(s.subdomain).toMatch(/^sandbox-[a-f0-9]{16}$/);
  const clientes = await clientesDe(s.providerId);
  expect(clientes).toHaveLength(1500);
  expect(clientes.filter(c => c.paymentStatus === "overdue")).toHaveLength(225);
  expect(clientes.filter(c => c.status === "cancelled")).toHaveLength(150);
  expect(await equipamentosDe(s.providerId)).toHaveLength(120);
  // Nao existe coluna "saldo" — providers tem ispCredits e spcCredits,
  // separadas (shared/schema.ts:167-168). Os dois nascem em SALDO_INICIAL.
  const provider = await providerDe(s.providerId);
  expect(provider.ispCredits).toBe(SALDO_INICIAL);
  expect(provider.spcCredits).toBe(SALDO_INICIAL);
});

it("150 CPFs da carteira tambem existem na rede — senao a consulta so diz 'nada consta'", async () => {
  const s = await criarSandbox();
  expect(await cpfsTambemNaRede(s.providerId)).toHaveLength(150);
});

it("todo cliente ja nasce com coordenada — o mapa de calor nao espera geocodificacao", async () => {
  const s = await criarSandbox();
  const semCoordenada = (await clientesDe(s.providerId)).filter(c => !c.latitude || !c.longitude);
  expect(semCoordenada).toHaveLength(0);
});

it("tres CPFs de exemplo, um de cada situacao, para a tela sugerir o que testar", async () => {
  const s = await criarSandbox();
  const exemplos = await cpfsDeExemplo(s.providerId);
  expect(exemplos.map(e => e.situacao).sort()).toEqual(["devendo_na_rede", "limpo", "migrador_serial"]);
});

it("expira so o sandbox, nunca o mundo base", async () => {
  const velho = await criarSandbox();
  await envelhecer(velho.providerId, 25 * 60 * 60 * 1000);
  const ids = await sandboxesExpirados();
  expect(ids).toContain(velho.providerId);
  for (const p of PROVEDORES_DA_DEMO) expect(ids).not.toContain(await idDe(p.subdomain));
});

it("apagar leva junto as linhas do provedor", async () => {
  const s = await criarSandbox();
  await apagarSandbox(s.providerId);
  expect(await clientesDe(s.providerId)).toHaveLength(0);
});

// ── Alocação de índices: prova por EXECUÇÃO, não por fórmula reconstruída ──
// (rodada de correção, 11/09/2026 — duas rodadas anteriores erraram a conta
// à mão sobre este gerador). `todosOsCpfsDaBase()` é um helper novo, no
// mesmo espírito de `cpfsEmMaisDeUmProvedor()` em `mundo-base.test.ts`: lê
// os CPFs REALMENTE gravados para os 5 "rede-N" no banco de mentira, sem
// recalcular índice nenhum.

it("os 1.500 clientes do sandbox nao colidem com o mundo base: 150 REAPROVEITAM CPF da rede de proposito, os outros 1.350 sao exclusivos", async () => {
  const s = await criarSandbox();
  const cpfsDoSandbox = (await clientesDe(s.providerId)).map(c => c.cpfCnpj as string);
  expect(new Set(cpfsDoSandbox).size, "CPF repetido dentro do proprio sandbox").toBe(1500);

  const cpfsDaBase = await todosOsCpfsDaBase();
  const compartilhados = cpfsDoSandbox.filter(cpf => cpfsDaBase.has(cpf));
  const exclusivos = cpfsDoSandbox.filter(cpf => !cpfsDaBase.has(cpf));
  expect(compartilhados).toHaveLength(150);
  expect(exclusivos).toHaveLength(1350);
});

it("dois sandboxes concorrentes nunca geram o mesmo CPF exclusivo (prova por execucao contra o gerador real, nao por formula)", async () => {
  const cpfsDaBase = await todosOsCpfsDaBase();
  const exclusivosDe = async (providerId: number) =>
    (await clientesDe(providerId)).map(c => c.cpfCnpj as string).filter(cpf => !cpfsDaBase.has(cpf));

  const a = await criarSandbox();
  const b = await criarSandbox();
  const exclusivosA = await exclusivosDe(a.providerId);
  const exclusivosB = await exclusivosDe(b.providerId);
  expect(exclusivosA).toHaveLength(1350);
  expect(exclusivosB).toHaveLength(1350);
  expect(exclusivosA.filter(cpf => exclusivosB.includes(cpf))).toHaveLength(0);
});

it("cada sandbox nasce com administrador proprio — dois sandboxes seguidos nao colidem em users.email (notNull+unique)", async () => {
  const a = await criarSandbox();
  const b = await criarSandbox();
  expect(a.userId).not.toBe(b.userId);
});

it("o quadro de cobranca ja nasce com um caso em cada uma das 9 colunas do kanban", async () => {
  const s = await criarSandbox();
  const casos = await casosDeCobrancaDe(s.providerId);
  const ORDEM_DO_KANBAN = ["aberto", "em_contato", "negociando", "acordo_ativo", "pago", "cancelamento", "negativado", "baixado", "encerrado"];
  expect(new Set(casos.map(c => c.status))).toEqual(new Set(ORDEM_DO_KANBAN));
});

// ── O sinal de migrador serial: prova pelo CAMINHO REAL, nao pela linha ──
// (rodada de correcao, 11/09/2026). detectMigrator (server/services/migrator-detection.service.ts)
// NAO le nenhuma tabela de "consulta anterior" — ele cruza, ao vivo, os
// clientes que os ERPs de TODOS OS OUTROS provedores devolvem para o mesmo
// CPF. Por isso o teste chama o MESMO conector "demo" que a consulta real usa
// (getConnector(FONTE_ERP_DEMO)), monta o array no formato que
// server/services/realtime-query.service.ts:326-357 (normalizeCustomer)
// produz, e so entao chama detectMigrator de verdade.
it("o CPF de exemplo 'migrador_serial' e detectado pelo caminho real (conector demo + detectMigrator) — nao so por uma linha inserida", async () => {
  const s = await criarSandbox();
  const exemplos = await cpfsDeExemplo(s.providerId);
  const migrador = exemplos.find(e => e.situacao === "migrador_serial")!;

  const conector = getConnector(FONTE_ERP_DEMO)!;
  const erpResults = await Promise.all(
    PROVEDORES_DA_DEMO.map(async (p) => {
      const providerId = await idDe(p.subdomain);
      const config = buildConnectorConfig({
        apiUrl: "demo://mundo-base", apiToken: "x", apiUser: null,
        clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
      });
      config.extra = { ...config.extra, providerId: String(providerId) };
      const r = await conector.fetchCustomerByCpf!(config, migrador.cpf);
      // Mesma reducao que normalizeCustomer faz em producao: `status` vem de
      // `contractStatus` antes do texto livre, `registrationDate` vem de
      // `contractStartDate` antes do proprio `registrationDate`.
      return {
        providerId, providerName: p.nome, erpSource: FONTE_ERP_DEMO, ok: r.ok,
        customers: r.customers.map(c => ({
          ...c,
          status: c.contractStatus ?? (c as any).status,
          registrationDate: c.contractStartDate ?? (c as any).registrationDate,
        })),
      };
    }),
  );

  const resultado = detectMigrator({
    cpfCnpj: migrador.cpf,
    consultingProviderId: s.providerId, // quem consulta e o proprio sandbox — igual ao visitante
    consultingProviderName: "Provedor Demonstração",
    erpResults: erpResults as any,
    recentConsultationsByDistinctProviders: 1,
  });

  expect(resultado?.detected, JSON.stringify(erpResults)).toBe(true);
});
```

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run server/demo/sandbox.service.test.ts
```

- [ ] **Passo 3: Implementar.** Nome do provedor: `Provedor Demonstração`. `criarSandbox()` chama `semearMundoBase()` primeiro (idempotente — garante que rede-1..5 existem antes de calcular sobreposição). Sete exigências:

1. **Inserção em lote.** `db.insert(customers).values(bloco)` em blocos de 500 — nunca `storage.createCustomer` por linha. São ~5 mil linhas por sandbox; uma chamada por registro transformaria a porta da demonstração em tela de espera.
2. **Coordenadas escritas direto**, derivadas do bairro da pessoa fictícia. O mapa de calor lê `latitude`/`longitude` de `customers`; nada de geocodificação sob demanda.
3. **A carteira é gerada, não copiada** de um provedor molde — o sandbox não depende de nenhuma linha viva além do mundo base.

4. **Alocação de índices de `pessoaFicticia`/`cpfFicticio` — disjunta do mundo base, para SEMPRE, não só hoje.** Conferido em `server/demo/mundo-base.ts:49-136`: o mundo base ocupa dois blocos, no PIOR CASO (a folga inteira, não só o uso real):
   - "único": `BASE_UNICO(0) + indiceProvedor(0..4)*PASSO_UNICO(10_000) + cursor(0..9_999)` → ocupa **[0, 49_999]**.
   - "aresta": `BASE_ARESTA(500_000) + aresta(0..3)*PASSO_ARESTA(1_000) + k(0..149)` → ocupa **[500_000, 503_999]**.

   `cpfFicticio` reduz todo índice por `% 999_999` (`pessoas-ficticias.ts:217-219`, período do gerador) — a proposta de uma auditoria anterior (`1_000_000 + providerId*10_000`) já quebrava em `providerId=0`: `1_000_000 % 999_999 = 1`, o MESMO índice que `rede-1` usa para um cliente de verdade. Índice cru × passo, sem redução por módulo fixo, cresce sem limite (o `providerId` é um SERIAL que nunca volta atrás, mesmo depois de o sandbox ser apagado) e eventualmente estoura de volta para dentro das duas faixas acima.

   A conta que fecha é módulo um número FIXO de posições — não `providerId` cru:

   ```ts
   const ZONA_SANDBOX_INICIO = 510_000; // logo depois de BASE_ARESTA + 4*PASSO_ARESTA (503_999)
   const PASSO_POR_SANDBOX = 2_000;     // > 1.350 índices exclusivos por sandbox, com folga
   const SANDBOXES_EM_RODIZIO = 200;    // 510_000 + 199*2_000 + 1_349 = 909_349, nunca chega em 999_998

   function baseDeIndicesDoSandbox(providerId: number): number {
     return ZONA_SANDBOX_INICIO + (providerId % SANDBOXES_EM_RODIZIO) * PASSO_POR_SANDBOX;
   }
   ```

   1.350 dos 1.500 clientes usam `pessoaFicticia(baseDeIndicesDoSandbox(providerId) + cursor)`, `cursor` de 0 a 1.349 — para QUALQUER `providerId`, presente ou futuro, o resultado cai dentro de `[510_000, 909_349]`, fora das duas faixas do mundo base. Os outros 150 REAPROVEITAM `CPFS_COMPARTILHADOS[0..149]` (já exportado por `mundo-base.ts`, sem precisar recalcular índice de aresta nenhum) como `cpfCnpj` — são os mesmos CPFs que já circulam entre dois provedores vizinhos da rede; o sandbox virar um TERCEIRO provedor com aquele CPF é o mesmo mecanismo que já liga rede-1↔rede-2, não uma exceção nova. O resto da linha (nome, endereço, coordenada) desses 150 continua vindo de `pessoaFicticia(baseDeIndicesDoSandbox(providerId) + cursor)` normalmente — só `cpfCnpj` é sobrescrito.

   **Garantia por escrito, e o limite dela:** até 200 sandboxes vivos ao mesmo tempo nunca colidem — cada `providerId` cai num balde de 2.000 índices exclusivo dele enquanto vivo. Acima de 200 sandboxes simultâneos (improvável: rate limit de 5/10min por IP na Tarefa 6, limpeza de hora em hora na Tarefa 7), um balde é reciclado enquanto o dono anterior ainda existe. Aceite isso por escrito em vez de resolver com um formato mais complexo — é a mesma folga que `PASSO_UNICO=10_000` já aceita para o mundo base.

5. **Semear `cobranca_casos`, um caso em cada uma das 9 colunas do kanban.** `GET /api/cobranca/kanban` (`server/routes/cobranca.routes.ts:2375`) só mostra linhas de `cobranca_casos`, e essa tabela só é populada pela régua diária (`server/services/cobranca/regua-diaria.service.ts`, ligada em `server/worker.ts:152-153`: uma passada no boot do worker + uma às 05:00) — que este processo HTTP nunca roda. Sem semear, um visitante que cai no meio do dia vê o quadro vazio, e o kanban é a vitrine da demonstração. As 9 colunas são `ORDEM_DO_KANBAN` (`server/routes/cobranca.routes.ts:1190-1192`, mesmo conjunto de `STATUS_DE_CASO` em `shared/cobranca/estados.ts:45-55`): `aberto`, `em_contato`, `negociando`, `acordo_ativo`, `pago`, `cancelamento`, `negativado`, `baixado`, `encerrado`.

   Escolha 9 dos 1.500 clientes do sandbox — um por status, para nunca ferir o índice único parcial `cobranca_casos_um_aberto_por_cliente` (`shared/schema.ts:1538-1540`, que só proíbe DOIS casos NÃO-terminais no mesmo cliente; um por cliente já satisfaz isso trivialmente) — e grave em bloco com `db.insert(cobrancaCasos).values([...])` (import de `@shared/schema`, tabela `shared/schema.ts:1495-1533`). Colunas reais, sem default ou com default que vale a pena sobrescrever: `providerId`, `customerId`, `status`, `carteira` (`"ativo" | "ex_cliente"` — `shared/cobranca/estados.ts:21`; **sem default no schema, obrigatório**), `etapaAtual` (um de `lembrete_pre_vencimento`, `lembrete_atraso`, `aviso_suspensao`, `negociacao_recuperacao`, `pre_negativacao`, `divida_antiga`, `fim_de_linha` — `ETAPA_IDS`, `shared/cobranca/regua.ts:19-27` — ou `null`), `diasAtrasoAbertura`, `valorAbertura`, `valorAtual`, `prioridade` (`"baixa" | "normal" | "alta" | "critica"`), `proximoContatoEm`. Use clientes que já nasceram `paymentStatus: "overdue"` (a categoria "inadimplente" do Passo 3.3) para os status não-terminais, e qualquer outro cliente do sandbox para os terminais — o kanban filtra por `status`/`etapaAtual`, não por `paymentStatus`.

6. **Credenciais do administrador do sandbox.** `users.email` é `notNull().unique()`, `users.password` e `users.name` são `notNull()` (`shared/schema.ts:229-231`) — um e-mail fixo derrubaria o SEGUNDO `GET /demo` concorrente com violação de unicidade. Gere um e-mail a partir do token do subdomínio (ex.: `${subdomain}@demo.consultaisp.com.br`) e uma senha aleatória (`crypto.randomBytes`), hasheada com `hashPassword` — `server/password.ts:7`, `hashPassword(password: string): Promise<string>`, o MESMO helper que `server/routes/auth.routes.ts:396` chama no cadastro real (`password: await hashPassword(password)`). Use algo como `"Administrador da Demonstração"` para `name`, e `emailVerified: true` — a Tarefa 1 já desliga o envio de e-mail em `DEMO_MODE`, mas a conta não deveria nem depender do fluxo de verificação.

7. **O par migrador-serial, semeado no MUNDO BASE (não no sandbox), uma vez só, para sempre.** O terceiro CPF de exemplo (`"migrador_serial"`) tem de ser DETECTADO pelo mecanismo real, não apenas lido de uma linha inventada. Cadeia real conferida ponta a ponta:
   - `detectMigrator` (`server/services/migrator-detection.service.ts:76-124`) não lê nenhuma tabela de "consulta anterior" — cruza, AO VIVO, os clientes que o ERP de cada OUTRO provedor devolve para o CPF consultado. Ele marca `detected` quando, entre TODOS os provedores ≠ o consulente, existe (a) um cliente com `status` cancelado (ou `maxDaysOverdue > 90`) cuja `registrationDate` caia nos últimos 90 dias, E (b) um cliente (pode ser o MESMO ou outro) com `totalOverdueAmount >= 50` e `maxDaysOverdue >= 15`. `recentConsultationsByDistinctProviders` só afeta a SEVERIDADE, nunca o `detected`.
   - O conector `demo` (`server/erp/connectors/demo.ts:143-144,171,176-177`) calcula `totalOverdueAmount`/`maxDaysOverdue` a partir de FATURAS ABERTAS (nunca das colunas agregadas de `customers`), e expõe `contractStatus` (`"cancelled"` quando `customers.status === "cancelled"`) e `contractStartDate` (repassado cru de `customers.contractStartDate`).
   - `normalizeCustomer` (`server/services/realtime-query.service.ts:326-357`) é quem `queryRegionalErps` usa para transformar isso no formato que `detectMigrator` lê: `status: c.contractStatus || c.status`, `registrationDate: c.contractStartDate || c.registrationDate`. Ou seja, **`registrationDate` é na prática `contractStartDate`** — a data de INÍCIO do contrato, não a data do cancelamento.
   - **Por isso os clientes "cancelado" que o Passo 3.3 já gera (via `mundo-base.ts`) não servem de exemplo confiável**: `contractStartDate` deles é `cortadoEm − tenureMeses`, e `tenureMeses` vai de 2 a 120 meses (`TENURE_MESES_REPRESENTATIVOS`) — quase sempre mais de 90 dias no passado. Contar com a sorte de um cruzamento específico cair dentro da janela é exatamente o tipo de aposta que gerou os defeitos desta rodada.

   **Implementação:** em `criarSandbox()`, ANTES ou DEPOIS de gerar a carteira do sandbox (não depende de ordem), garanta — de forma IDEMPOTENTE, verificando antes se já existe (mesmo padrão de `semearMundoBase()`: uma vez só, para sempre, independente de quantos sandboxes forem criados depois) — duas linhas extras em DOIS provedores do mundo base (ex.: `rede-1` e `rede-2`; NUNCA no sandbox, porque `detectMigrator` pula `erp.providerId === consultingProviderId`, e o consulente aqui É o sandbox):
   - Um índice reservado NOVO e fixo, fora de toda faixa já usada — `INDICE_MIGRADOR_DE_EXEMPLO = 504_000` (logo após o fim da faixa de aresta do mundo base, `503_999`, e bem antes do início da zona do sandbox, `510_000` — Passo 3.4). CPF: `cpfFicticio(504_000)`; demais dados de `pessoaFicticia(504_000)`.
   - Em `rede-1`: um `customer` com esse `cpfCnpj`, `status: "cancelled"`, e **`contractStartDate` recente** (ex.: 45 dias antes de `agora` — não os `cortadoEm − tenureMeses` que `linhaDoCliente` calcularia; sobrescreva explicitamente). `cortadoEm` também pode ser gravado (consistência com outros cancelados), mas quem importa para a detecção é `contractStartDate`.
   - Em `rede-2`: um `customer` com o MESMO `cpfCnpj`, qualquer `status`, e uma `invoice` com `status: "overdue"`, `value >= "50.00"` e `dueDate` pelo menos 15 dias antes de `agora` — é dela que o conector deriva `totalOverdueAmount`/`maxDaysOverdue` (item acima).
   - `cpfsDeExemplo(sandboxProviderId)` devolve este CPF fixo para a entrada `"migrador_serial"` — não um dos 1.500 clientes do próprio sandbox.

   **Se ao implementar isto o comportamento observado divergir do descrito acima** (por exemplo, `fetchCustomerByCpf` não devolver os dois clientes esperados, ou `detectMigrator` não marcar `detected`) — pare e registre no relatório em vez de ajustar o teste até ele passar por outro motivo.

> Os helpers de teste novos usados no Passo 1 (`todosOsCpfsDaBase`, `casosDeCobrancaDe`, `providerDe`) não existem ainda — escreva-os no mesmo estilo dos helpers locais já usados por `server/demo/mundo-base.test.ts` (`clientesDe`, `equipamentosDe`, `cpfsEmMaisDeUmProvedor`, `idDoProvedor`): leitura direta do banco de mentira (`banco.linhas.get("customers")`/`.get("cobranca_casos")`/`.get("providers")`), nunca uma reconstrução da fórmula de índice. O teste do migrador serial não precisa de helper novo nenhum além desses — ele chama `getConnector`/`detectMigrator` de verdade.

- [ ] **Passo 3b: Medir a criação.** Depois de verde, rode uma vez e registre o tempo no relatório:

```bash
npx tsx -e "import('./server/demo/sandbox.service').then(async m => { const t = Date.now(); const s = await m.criarSandbox(); console.log('sandbox em', Date.now() - t, 'ms'); await m.apagarSandbox(s.providerId); })"
```

**Regra do dono:** se passar de **3 segundos**, o volume cai de 1.500 para 500 clientes (ele já autorizou a alternativa) — e o número medido vai no relatório, para a decisão ser tomada com medida e não com palpite.

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
- Modify: `server/routes/index.ts` (registrar o router — **`server/routes.ts` NÃO EXISTE**. Os routers são fábricas `registerXxxRoutes(): Router`, uma por módulo, montadas em `server/routes/index.ts` via `app.use(registerXxxRoutes())` — ver `server/routes/index.ts:57-102`, por exemplo `app.use(registerAuthRoutes())` na linha 57)

**Interfaces:**
- Consumes: `criarSandbox`, `emModoDemo`.
- Produces: `registerDemoRoutes(): Router` (mesmo padrão de `server/routes/auth.routes.ts` e dos demais módulos), montado dentro de `registerRoutes()` via `app.use(registerDemoRoutes())`; a rota `GET /demo` → cria o sandbox, grava a sessão e redireciona para `/`.

- [ ] **Passo 1: Teste que falha** — a rota é registrada SEMPRE (ver Passo 3: quem decide é o handler, não o registro). Fora de `DEMO_MODE` ela responde **404** explícito, escrito pelo próprio handler — não confundir com o catch-all da SPA: `server/static.ts:25` só devolve 404 para `/assets/*` e `/api/*` (`NUNCA_E_ROTA_DO_APP`); qualquer outro caminho não casado por rota nenhuma, `/demo` incluído, cai no `app.use("/{*path}", ...)` de `server/static.ts:102-134` e volta **200** com `index.html` dentro. Um teste que isolasse a rota do handler estaria testando um 404 que a rota NÃO produz sozinha em produção — daí o handler ter de devolvê-lo ele mesmo. Em `DEMO_MODE` a rota responde 302 para `/`, com CINCO campos de sessão preenchidos — `userId`, `providerId`, `role: "admin"`, `hostLogin` e `subdomain` —, no molde exato de `auth.routes.ts:262-268` (que grava esses mesmos cinco campos no login real). `requireAuth` (`server/auth.ts:269-281`) usa `hostLogin`/`subdomain` para o vínculo de host: uma sessão que só grave `userId`/`providerId`/`role` autentica no 302, mas é expulsa com 403 ("Sessao invalida para este endereco") no primeiro acesso seguinte, porque `hostLogin` fica vazio e a checagem falha. `hostLogin` é `normalizarHost(req.hostname)`, igual ao login; `subdomain` é o subdomínio do PRÓPRIO sandbox recém-criado (o que `criarSandbox()` devolve) — a instância de demonstração roda num host único (`demo.consultaisp.com.br`), sem subdomínio real por visitante, e `requireAuth` só cai no ramo que confere `subdomain` quando falta `hostLogin` (que aqui está sempre presente). Um segundo acesso com sessão viva **reaproveita** o mesmo sandbox em vez de criar outro.

- [ ] **Passo 2: Rodar e ver falhar.**

- [ ] **Passo 3: Implementar.** A rota é registrada INCONDICIONALMENTE (nunca pule o registro fora de `DEMO_MODE`) — é o handler que decide, com a primeira linha `if (!emModoDemo()) return res.status(404).json({ message: "Nao encontrado" });`. Isso é o que torna o 404 do Passo 1 verdadeiro nos dois ambientes: como o catch-all de `server/static.ts` devolveria 200 para `/demo` fora da demo (ele só 404 em `/assets/*` e `/api/*`), pular o registro faria a rota "sumir" atrás de um 200 silenciosamente errado em vez de um 404 honesto. Com o rate limiter existente (`createRateLimiter`, `server/middleware/rate-limiter.middleware.ts:33`, ex. `{ windowMs: 600_000, maxRequests: 5 }` — 5 por IP a cada 10 min) para a porta não virar gerador de lixo.

- [ ] **Passo 4: Rodar e ver passar.**

- [ ] **Passo 5: Commit.**

```bash
git add server/routes/demo.routes.ts server/routes/demo.routes.test.ts server/routes/index.ts
git commit -m "feat(demo): um clique entra na demonstracao, com sessao propria"
```

---

## Tarefa 7: Limpeza no worker

**Files:**
- Create: `server/demo/limpeza.service.ts` + teste
- Modify: `server/worker.ts`

**Interfaces:**
- Produces: `iniciarLimpezaDaDemo()` / `pararLimpezaDaDemo()` — o timer roda de hora em hora sempre que `iniciarLimpezaDaDemo()` é chamada; quem decide SE chama é `server/worker.ts` (Passo 4), que só invoca dentro de `if (emModoDemo())`. Um timer que só existe onde pode agir é mais fácil de raciocinar do que um que fica sempre no ar e vira no-op fora da demo.

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

- [ ] **Passo 3: Implementar** — `server/demo/limpeza.service.ts`, no molde de `server/services/chat/chat-primeiro-contato.service.ts:130-150` (`iniciarPrimeirosContatos`/`pararPrimeirosContatos`, já ligado em `server/worker.ts:168-169` e parado em `server/worker.ts:222` — **`chat-sentinela.service.ts` não existe** neste repositório): guarda de dupla partida (`if (timer) return;`), `passada` em voo que impede sobreposição, `timer.unref()` e parada ordenada (`await passada` dentro do `pararXxx`).

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

- [ ] **Passo 4: Ligar no worker, SÓ em modo demo** — em `server/worker.ts`, junto das outras agendas. Ao contrário de `iniciarPrimeirosContatos()` (que roda sempre, produção incluída), esta agenda só faz sentido na instância de demonstração — a chamada é condicionada a `emModoDemo()`, não a função:

```ts
  const { emModoDemo } = await import("./demo/modo-demo");
  if (emModoDemo()) {
    const { iniciarLimpezaDaDemo } = await import("./demo/limpeza.service");
    iniciarLimpezaDaDemo();
  }
```

e, no encerramento (`shutdown`), dentro do MESMO `if (emModoDemo())` — o par início/fim fica visivelmente condicionado à mesma checagem, como as vizinhas condicionam início e fim ao mesmo `try`. (Chamar `pararLimpezaDaDemo()` sem essa guarda também seria seguro — `timer`/`passada` começam `null`, mesmo padrão de `pararPrimeirosContatos` — mas a guarda explícita é mais clara sobre a intenção.)

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
    expect(new Set(varios.map(r => r.restricao)).size).toBeGreaterThan(1);
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

  **As duas interfaces reais são grandes — preencha TODOS os campos abaixo. Não descubra um por vez rodando `tsc`.**

  `SpcResult` (`server/services/spc/spc-parser.ts:96-159`) — 19 campos obrigatórios + 3 opcionais:
  `cpfCnpj`, `protocolo`, `consultadoEm`, `restricao: boolean` (o campo real — **não** `temRestricao`),
  `cadastralData` (objeto: `nome`, `cpfCnpj`, `situacaoRf`, `obitoRegistrado`, `tipo: "PF"|"PJ"` obrigatórios;
  `dataNascimento`/`dataFundacao`/`nomeMae`/`idade`/`endereco`/`cidade`/`uf`/`telefone`/`naturezaJuridica`/`atividadePrincipal` opcionais),
  `score: number | null`, `riskLevel`, `riskLabel`, `recommendation`,
  `status: "clean"|"restricted"`, `restrictions: RestricaoSpc[]`, `totalRestrictions`,
  `resumo` (objeto com exatamente 7 chaves, cada uma `{ quantidade, valor, ultimaOcorrencia }`:
  `spc`, `chequeLojista`, `ccf`, `protesto`, `acao`, `pendenciaFinanceira`, `poderJudiciario`),
  `pendenciasFinanceiras: PendenciaFinanceira[]`,
  `previousConsultations` (objeto: `total`, `last90Days`, `diasConsiderados`, `bySegment`, `lista`),
  `alerts: { type, message, severity }[]`, `rendaPresumida: number | null`,
  `limiteCreditoSugerido: number | null`, `basesInoperantes: string[]`.
  Opcionais: `scoreFonte`, `scoreDetalhe`, `rawXml`. Onde a situação simulada não tiver nada,
  preencha com array/record vazio (`[]`, `{}`) — a interface não aceita `undefined` num campo obrigatório.

  `ResultadoConsulta` (`server/services/bigdata.service.ts:1218-1258`) — 24 campos, todos obrigatórios
  (dois aceitam valor `null`, mas a CHAVE tem de existir): `dados`, `identidade`, `enderecos`, `telefones`,
  `emails`, `renda`, `risco`, `inadimplencia`, `rastro`, `ocupacao`, `perfil`, `mercado`, `domicilio`,
  `cruzamentoDomicilio`, `riscoFamiliar`, `capacidade`, `validacaoTelefone: ValidacaoTelefone | null`,
  `imovel: Imovel | null`, `processos: ProcessoDetalhe[]`, `datasetsIndisponiveis: string[]`, `bruto: any`,
  `datasetsChamados: string[]`, `nivel: NivelConsulta`, `datasetsComFalha: string[]`, `latenciaMs: number`.
  Os doze primeiros (`dados` … `capacidade`) são tipos próprios de `server/services/bigdata.service.ts` —
  leia cada um lá antes de inventar o formato; `{}` não satisfaz o `tsc` quando o tipo tem campos obrigatórios.

  **`simulado?: boolean` é ADITIVO.** Acrescente-o como campo OPCIONAL nas duas interfaces
  (`SpcResult` em `spc-parser.ts`, `ResultadoConsulta` em `bigdata.service.ts`) — não quebra nenhum
  retorno existente, que simplesmente não o define. É esse campo que os testes do Passo 1 leem (`.simulado`).

- [ ] **Passo 4: Desviar as duas entradas.** Primeira linha de `consultarSpc` (`server/services/spc/spc.service.ts:222-223`, parâmetro `documento`) e de `consultarCpf` (`server/services/bigdata.service.ts:1260-1269`, parâmetro `cpf` — **não** `documento`: a assinatura real é `consultarCpf(providerId, cred, cpf, nivel, enderecoInstalacao)`):

```ts
  if (emModoDemo()) return spcSimulado(documento); // em consultarSpc — o parametro dessa funcao É "documento"
  if (emModoDemo()) return cadastralSimulado(cpf);  // em consultarCpf — o parametro dessa funcao É "cpf"
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
- Consumes: `GET /api/auth/me` (já traz o provedor da sessão); `ProvTag` (`client/src/components/consulta/report-ui.tsx:146`, já existe — ver Passo 5).
- Produces: `FaixaDemonstracao`; a extensão de `ProvTag` para `kind: "simulado"` (NÃO um componente novo — ver Passo 5).

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

  it("monta na coluna de conteudo, junto da faixa de suporte REAL (nao nas 3 telas de loading/redirecionamento que tambem tem <FaixaSuporte />)", () => {
    // `<FaixaSuporte />` aparece 4 vezes em App.tsx: 3 sao skeleton dentro de
    // guardas de redirecionamento (early returns antes do shell autenticado);
    // so a QUARTA, dentro do shell (`data-module="consulta"`), fica montada
    // o tempo todo. `indexOf()` sem ancora acha a PRIMEIRA — a errada.
    expect(app).toContain("<FaixaDemonstracao />");
    const ancoraDoShell = app.indexOf('data-module="consulta"');
    expect(ancoraDoShell, "shell autenticado (data-module=\"consulta\") nao encontrado").toBeGreaterThan(-1);
    const posFaixaSuporte = app.indexOf("<FaixaSuporte />", ancoraDoShell);
    expect(posFaixaSuporte, "<FaixaSuporte /> do shell autenticado nao encontrada").toBeGreaterThan(-1);
    const posFaixaDemonstracao = app.indexOf("<FaixaDemonstracao />");
    expect(posFaixaDemonstracao).toBeGreaterThan(posFaixaSuporte);
    expect(posFaixaDemonstracao).toBeLessThan(posFaixaSuporte + 400);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run client/src/components/faixa-demonstracao.test.ts
```

Esperado: FAIL — o componente não existe.

- [ ] **Passo 3: Implementar** `FaixaDemonstracao.tsx`: lê o provedor da sessão (`GET /api/auth/me`, TanStack Query como o resto do client), só renderiza quando o subdomínio casa `^sandbox-`, calcula as horas restantes a partir da criação e mostra o CTA. Tokens do `DESIGN_SYSTEM.md`, faixa retangular (raio ≤ 8px).

- [ ] **Passo 4: Montar no shell** — em `client/src/App.tsx`, logo abaixo da QUARTA ocorrência de `<FaixaSuporte />` (linha 658 — dentro do shell autenticado, `data-module="consulta"`, linha 640; as três ocorrências anteriores, linhas 570/603/623, são skeletons dentro de guardas de redirecionamento e não servem). A razão estrutural daquele lugar está comentada ali mesmo (`client/src/App.tsx:643-657`).

- [ ] **Passo 5: Selo do dado simulado — NÃO crie um componente novo.** `client/src/components/consulta/report-ui.tsx:146` já exporta o selo de proveniência: `export function ProvTag({ kind }: { kind: "real" | "cache" | "sem-rede" })`. Estenda a união para `"real" | "cache" | "sem-rede" | "simulado"` e acrescente o caso `simulado` no mesmo objeto de configuração (linhas 147-151), usando os tokens `--mock`/`--mock-bg` que o `DESIGN_SYSTEM.md` §3.1 já reserva para "dado simulado" (rótulo, por exemplo, "SIMULADO"). Use `<ProvTag kind="simulado" />` onde o resultado da consulta vier com `simulado: true`. Uma primitiva só, estendida — nunca um `SeloSimulado` separado.

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
  /**
   * A URL vive numa constante só (mesma convenção de CADASTRO/WHATSAPP, linhas
   * 35-37): se `/demo` virar outra coisa, as duas cópias andam juntas.
   */
  it("a URL do demo é uma constante, não duas cópias soltas", () => {
    expect(landing).toMatch(/const DEMO = "https:\/\/demo\.consultaisp\.com\.br\/demo";/);
    const usos = landing.match(/href=\{DEMO\}/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Ancorado no CONTÊINER de cada bloco — não basta o par href/target/rel
   * existir em algum lugar da página: precisa estar DENTRO de "hero-ctas" e
   * dentro de "final-cta-buttons", um teste por bloco. Uma versão sem essa
   * âncora passaria mesmo com os dois botões colados no mesmo bloco (a
   * contagem bateria e o primeiro `toMatch` acharia uma ocorrência qualquer);
   * o `(?:(?!<\/div>)[\s\S])*?` proíbe a busca de atravessar o fechamento do
   * próprio contêiner antes de achar o link do demo.
   */
  it("no herói, junto do cadastro — abre em outra aba, sem entregar a sessão da landing", () => {
    expect(landing).toMatch(
      /<div className="hero-ctas">(?:(?!<\/div>)[\s\S])*?<a href=\{DEMO\}[^>]*target="_blank"[^>]*rel="noopener"[^>]*>Ver demonstração<\/a>/
    );
  });

  it("no CTA final — abre em outra aba, sem entregar a sessão da landing", () => {
    expect(landing).toMatch(
      /<div className="final-cta-buttons">(?:(?!<\/div>)[\s\S])*?<a href=\{DEMO\}[^>]*target="_blank"[^>]*rel="noopener"[^>]*>Ver demonstração<\/a>/
    );
  });

  it("o cadastro continua sendo a acao principal", () => {
    expect(landing).toContain("Criar conta grátis");
  });
});
```

(`landing` é a leitura de `landingpage.tsx` SEM comentários, já definida no topo do arquivo — `client/src/pages/public/landingpage.test.ts:22`, `const landing = semComentarios(ler("client/src/pages/public/landingpage.tsx"))`. Não confundir com `css`, linha 23, a leitura crua de `landingpage.css`. **Não existe variável `fonte` neste arquivo.** A âncora no CONTÊINER (`hero-ctas`, `final-cta-buttons`) não é luxo: uma versão que só conta ocorrências e usa `toMatch` sem `/g` passaria igual com os dois botões colados dentro do mesmo bloco de CTA — foi exatamente o defeito que a revisão de tarefa encontrou na primeira entrega deste teste.)

- [ ] **Passo 2: Rodar e ver falhar.**

```bash
npx vitest run client/src/pages/public/landingpage.test.ts
```

Esperado: FAIL — nenhum link para o demo.

- [ ] **Passo 3: Implementar** — uma constante `DEMO` (mesmo padrão de `CADASTRO`/`WHATSAPP`, já no topo do arquivo), consumida por `{DEMO}` no herói (junto de "Criar conta grátis") e no CTA final — nunca a URL literal duplicada nos dois blocos:

```tsx
const DEMO = "https://demo.consultaisp.com.br/demo";
// ...
<a href={DEMO} target="_blank" rel="noopener" className="btn btn-secondary on-dark btn-lg">Ver demonstração</a>
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

---

## Decisões tomadas durante a execução

As tarefas acima ficam como o argumento a partir da spec, corrigido onde citava
nome, arquivo ou comportamento que não existe na árvore. O que muda de rumo só
depois de abrir o código — durante a implementação de cada tarefa, ou na
revisão dela — fica registrado aqui, uma decisão por linha, para não reescrever
silenciosamente o raciocínio acima. Extraído de
`.superpowers/sdd/2026-09-11-demo-sandbox/progress.md` (ledger completo),
ordenado por tarefa.

**Tarefa 1**
- Os trechos de teste do plano foram escritos sem abrir cada arquivo de teste alvo. Regra adotada dali em diante para todo implementador seguinte: adaptar ao helper e à assinatura reais do arquivo (aqui, o espião `resendFalso.chamadas` e a assinatura de 5 argumentos de `sendVerificationEmail`, não os 3 que o plano supunha) e declarar o desvio no relatório, em vez de forçar o snippet do plano (commits `1cf7245..52aaa46`).

**Tarefa 2**
- O gerador de CPF passou a contar em módulo **999.999**, não 1.000.000. O resto "todos os dígitos iguais" caía exatamente em `500.000` — que é o `BASE_ARESTA` que a Tarefa 3 usa para os CPFs compartilhados —, e duas tentativas de desviar essa colisão para um valor fixo (999.998, depois 500.000) escolheram, cada vez, um número que já pertencia a outro índice real do próprio gerador. Reduzir o módulo elimina a classe do problema por construção, em vez de reposicioná-la (commit `40e66ee`).

**Tarefa 3**
- Fidelidade do mundo semeado, três correções: equipamento em comodato nos clientes ATIVOS (não só retido nos cancelados — comodato é o estado do dia a dia, o schema já usa `em_comodato` como padrão); `customers.equipmentCount`/`equipmentEstimatedValue` gravados pelo próprio seed, porque `antifraude.routes.ts:147-148` lê exatamente essas duas colunas; todo ex-cliente ganha fatura de saída (parte paga, parte aberta), com multa e equipamento na descrição no formato que `shared/cobranca/multa.ts` sabe ler. Junto: `semearMundoBase()` inteiro dentro de uma transação, e `contractStartDate` em todo cliente (commit `24c9c54`).
- O conector "demo" estava correto mas inalcançável: `realtime-query.service.ts`, `erp-sync.service.ts`, `heatmap-cache.ts` e `snapshot-ao-vivo.service.ts` exigem `apiUrl`/`apiToken` preenchidos antes de chamar qualquer conector, e as integrações semeadas tinham os dois nulos — a consulta na demo continuaria dizendo "nada consta". Corrigido com credencial de fachada (`apiUrl: "demo://mundo-base"`, `apiToken` cifrado como qualquer credencial real) nas linhas de `erp_integrations` da demo. Para essa credencial não fazer a varredura agendada/manual escrever em cima das mesmas tabelas que a demo lê (um laço sobre si mesma), `erpSource === "demo"` passou a ser pulado nos dois caminhos de ESCRITA (`erp-sync.service.ts`) — nunca nas leituras, e nunca no `heatmap-cache.ts`, que é módulo morto (commit `24c9c54`).
- `paraClienteNormalizado` (conector demo) não mapeava `contractPlan`/`contractStartDate`, que `realtime-query.service.ts:356,359` lê — sem isso, "cliente desde" ficaria em branco na consulta ao vivo para quem tem anos de casa no banco semeado. Corrigido a par com o mesmo tratamento que `ixc.ts`/`sgp.ts` dão ao par (commit `b4612ff`).
- O tempo de `semearMundoBase()` medido nos testes (~1,3 s) é contra um banco falso em memória e não significa nada sobre Postgres real; a medida que importa — a regra dos 3 s da Tarefa 5 — fica adiada para o ciclo real na Tarefa 11.

**Tarefa 4**
- `ErpConnectionConfig` não tem campo `providerId` de primeira classe: a identidade do provedor a servir vem de `config.extra.providerId`, a mesma convenção que os 6 conectores reais já usam. Sem ele o conector recusa, nunca chuta "o primeiro provedor".
- O registro do conector "demo" no registry foi movido para DENTRO de `demo.ts` (guardado por `if (emModoDemo())` no próprio arquivo), e não para o `await import()` condicional do barril `server/erp/index.ts` que o plano propunha — um `await import()` condicional ali quebra o build CJS do esbuild (`script/build.ts`), conferido empiricamente.

**Tarefa 5**
- Alocação de índices do sandbox: `510_000 + (providerId % 200) * 2_000`, para 1.500 clientes por sandbox. O mundo base ocupa `0..49.999` (`BASE_UNICO`/`PASSO_UNICO`, 5 provedores × 1.500 de folga) e `500.000..503.999` (as arestas compartilhadas); o sandbox vive em `510.000..909.500`, disjunto dos dois e abaixo do período 999.999 do gerador. Dois sandboxes só colidem se os `providerId` forem congruentes módulo 200 — com expiração de 24h isso exigiria 200 sandboxes vivos ao mesmo tempo. Não simplificar esse número sem refazer a conta do período: a proposta original de auditoria (`1_000_000 + providerId*10_000`) era falsa (`1.000.000 % 999.999 = 1`, a pessoa de índice 1 do mundo base).
- Só existe UMA moeda de crédito, não duas: `debitAndCreateIspConsultation` e `debitAndCreateSpcConsultation` debitam a MESMA coluna `isp_credits`; `spc_credits` não é lido por nenhum débito nem por nenhum gate. O sandbox nasce com 500 nos dois campos mesmo assim, por decisão do dono — a ação não muda, a razão sim (e confirma o próprio CLAUDE.md: "um crédito vale para qualquer consulta").
- O migrador serial não se detecta por histórico de consultas: `detectMigrator` cruza AO VIVO o que o ERP de cada outro provedor devolve para o CPF (cancelado+recente de um lado, dívida ativa ≥R$50/≥15 dias do outro); `recentConsultationsByDistinctProviders` só afeta a severidade. Como `registrationDate` resolve para `contractStartDate` (data de início do contrato, não de cancelamento), os ex-clientes que a Tarefa 3 já semeia nunca cairiam na janela de 90 dias — por isso um par novo (índice reservado `504_000`) nasce DENTRO de `semearMundoBase()`, no mundo base (`rede-1`/`rede-2`), não no caminho do visitante: uma definição só do mundo, e o visitante não paga a consulta de guarda + duas escritas a cada acesso por uma linha que já devia existir.
- **Critical, achado em revisão:** nenhuma FK do schema tem `ON DELETE CASCADE`, e a limpeza cobria só ~15 das 38 tabelas com FK para `providers` — um sandbox que gravasse linha em qualquer uma das outras (`provider_partners`, `credit_orders`, `anti_fraud_rules`, etc.) travava a transação de apagar por violação de FK e virava zumbi PERMANENTE; e é alcançável por clique comum, porque a sessão do visitante é sessão de admin de verdade, sem nenhuma trava de modo demo no client. Corrigido reaproveitando `storage.deleteProvider` mais um delta transacionado para o resto, provado por um teste que deriva o universo de tabelas do PRÓPRIO `shared/schema.ts` em vez de uma lista escrita à mão que envelhece. Rejeitado explicitamente: resolver por `ON DELETE CASCADE`, que é mudança de migração e tocaria o schema de PRODUÇÃO para resolver um problema da demonstração (commit `6da9159`).
- Atomicidade: `criarSandbox()` passou a gravar `provider` e `user` DENTRO da mesma transação da carteira, com `tx.insert` espelhando os defaults de `storage.createProvider`/`createUser` (que não aceitam executor de transação) — antes, uma falha no meio da criação deixava o par órfão já commitado fora da transação (commit `6da9159`).
- `acessos_suporte` reabria o zumbi: a guarda de LGPD do `storage.deleteProvider` recusa apagar provedor com trilha de acesso de suporte, e o próprio visitante — admin do seu sandbox — pode gerar essa trilha pela própria aba Suporte da tela. Carve-out: apagar `acessos_suporte` só para provedor com prefixo `sandbox-`, dentro do delta de limpeza — o sandbox não tem titular real a proteger, ao contrário de um provedor de verdade (commit `128ff4b`).

**Tarefa 6**
- `GET /demo` é registrada INCONDICIONALMENTE (`app.use(registerDemoRoutes())`, sem `if` em volta) — o 404 mora no handler, porque `server/static.ts:25` só 404-eia `/assets/` e `/api/`, e todo o resto cai no SPA e devolve 200; um registro condicional faria a rota "sumir" atrás desse 200 em vez de responder um 404 honesto. Sessão com os CINCO campos (`userId`, `providerId`, `role`, `hostLogin`, `subdomain`) (commit `9c34f4f`).
- **Important, achado em revisão:** o cookie de sessão não herdava o TTL do sandbox — sem limitar `maxAge` ao `expiraEm`, um visitante que voltasse ao link entre 25h e 48h depois reaproveitava uma sessão com cookie ainda válido apontando para um provedor já apagado pela limpeza horária, e caía num app quebrado. Quatro consertos no mesmo commit: (a) `maxAge` do cookie limitado ao `expiraEm` do sandbox; (b) conferir no servidor que o sandbox ainda existe antes de reaproveitar a sessão, com queda para criar um novo se não existir — é o (b) que garante a promessa, o (a) sozinho depende do relógio do navegador; (c) teto de requisições da rota reduzido para 2 por 10 min (dois toques concorrentes — duplo clique, prefetch do navegador — criavam dois sandboxes de ~5.000 linhas cada antes de o cookie ser gravado); (d) o prefixo `sandbox-` passou a ser RESERVADO em `/api/auth/register` e `/api/auth/check-subdomain` (achado numa revisão da Tarefa 5: nada impedia um provedor pagante de se cadastrar como `sandbox-algo`, e a limpeza da demo, depois do carve-out de `acessos_suporte`, apagaria essa conta inteira em silêncio) (commit `6e73e6d`).

**Tarefa 7**
- `iniciarLimpezaDaDemo()` só liga quando `emModoDemo()`, e a guarda mora no CHAMADOR (`server/worker.ts`), não dentro do próprio timer (commit `1db35c3`).
- Achado do harness de teste, deferido para a revisão final do ramo (não corrigido nesta tarefa): o banco falso (`pg-proxy`) usado pelos testes nunca simula `defaultNow()`, então `providers.createdAt` volta nulo/época-zero para qualquer provedor inserido sem valor explícito — risco de confusão para o PRÓXIMO teste que venha a afirmar contagem exata sobre esse campo no mesmo arquivo cumulativo, não erro presente hoje.

**Tarefa 8**
- `SpcResult` (15+ campos obrigatórios) e `ResultadoConsulta` (24+) não tinham campo `simulado` — acrescentado como `simulado?: boolean`, aditivo, nas duas interfaces, para não derrubar o portão de 57 erros do `tsc` (achado da auditoria pré-implementação).
- **Important, achado em revisão:** o atalho `if (emModoDemo())` era a PRIMEIRA linha de `consultarSpc`, pulando a validação de CPF/CNPJ que vinha depois — um CPF inválido receberia resultado simulado plausível onde produção devolveria erro de validação, quebrando a premissa de que a demo roda o MESMO caminho e só o dado muda. Corrigido movendo o guard para depois do bloco de validação; `consultarCpf` não tinha o problema, porque a validação da cadastral vive fora da função, em `bigdata.routes.ts` (commit `740bf92`).
- **Important:** `risco.score`/`nivel` do cadastral simulado eram sorteados independentes de `situacao`/dívida — medido em 2.000 documentos, 13,7% dos que tinham cobrança ativa + dívida ≥R$2.000 + execução judicial saíam com `score ≥850`, nível A ("maior e melhor"). Corrigido fazendo o risco concordar com a dívida, espelhando o que `scoreSpc()` já fazia certo no lado do SPC (commit `740bf92`).
- **Important:** `dados.buscaCredito`/`consultas30d` e `rastro.buscaCredito`/`consultas30d` vinham de sorteios independentes — 89,6% de divergência medida em 500 documentos —, quando no serviço real são o mesmo valor escrito duas vezes. Corrigido calculando `rastro` primeiro e fazendo `dados` copiar dele, como produção faz (commit `740bf92`).
- As datas simuladas estavam presas a uma âncora fixa (`2026-09-01`), que envelheceria a demonstração a cada dia que passasse depois dela. Viraram deslocamentos derivados do documento (ex.: "dívida há 47 dias" é sempre 47 dias antes de agora, nunca uma data fixa no passado) — determinístico pelo documento e nunca velho (commit `6e263bd`).
- **Achado na revisão da Tarefa 9:** as rotas de SPC e cadastral rejeitavam a consulta ANTES de alcançar o código simulado desta tarefa, porque a instância de demonstração não tem credencial desses bureaus por desenho da própria Tarefa 11 — o trabalho inteiro da Tarefa 8 era inalcançável no ambiente onde ia rodar, mesma classe do achado de reachability da Tarefa 4. Corrigido na camada de rota (`GET /api/bigdata-integration` devolve `configurado: true` em modo demo), travado por `emModoDemo()`, com teste por caminho (commit `55d7f5c`).

**Tarefa 9**
- O selo do dado simulado não nasceu como componente novo: estende o `ProvTag` já existente com `kind: "simulado"`, nos tokens `--mock`/`--mock-bg` (achado da auditoria pré-implementação).
- Nenhuma tarefa neutralizava o Asaas: em `DEMO_MODE`, `POST /api/credits/purchase` não pode chamar o Asaas nem gravar pedido — responde mensagem clara que a tela mostra, com teste provando que nenhuma linha é escrita. Ruling nascido na revisão da Tarefa 5 (achado que nenhuma tarefa cobria as superfícies que não podem funcionar na demonstração), implementado aqui porque esta já é a tarefa dona de "a tela diz que é demonstração" (commit `30f558d`).

**Tarefa 10**
- O bloco de teste original (contagem de ocorrências + `toMatch` sem `/g`) passaria mesmo com os dois botões de demonstração colados dentro do mesmo bloco de CTA — defeito do brief, não do implementador, que copiou o snippet como mandado. Corrigido para: uma constante `DEMO` só (em vez da URL literal duplicada nos dois blocos) e dois testes ANCORADOS no contêiner de cada bloco (`hero-ctas`, `final-cta-buttons`) — provado por contra-exemplo: duplicar o link dentro de um bloco só faz a suíte ANTIGA continuar toda verde no mesmo estado quebrado; a nova pega (commit `d4728e6`).

**Tarefa 11**
- Dois portões se somaram aos desta tarefa, porque nenhum teste de unidade consegue medi-los: o tempo de `semearMundoBase()`/`criarSandbox()` contra Postgres REAL (o mock em memória não significa nada sobre latência real), e um ciclo completo criar→apagar sandbox contra o banco real, onde as FKs existem de verdade e a ordem topológica dos deletes do delta de limpeza finalmente é posta à prova — o banco falso dos testes não impõe integridade referencial, então uma edição futura que quebrasse essa ordem só apareceria aqui.
