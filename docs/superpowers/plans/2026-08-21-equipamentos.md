# Módulo de Equipamentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Consulta ISP enxergar equipamento não devolvido — puxando do ERP quando existir, aceitando planilha e formulário quando não, e expondo isso na consulta de crédito dentro da política LGPD que já existe.

**Architecture:** O contrato já existe ponta a ponta (mascaramento preserva os campos, score pune a não-devolução, IXC produz `equipmentDetails`), mas nenhum consumidor lê o que o conector produz. O plano liga esse encanamento: uma função pura decide o que o sync faz com cada aparelho, o `EquipmentStorage` executa, o agregado em `customers` alimenta a consulta em rede, e a tela de gestão cobre o caso de ERP sem comodato.

**Tech Stack:** Express 5, Drizzle ORM, PostgreSQL, React 18 + TanStack Query, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-21-equipamentos-design.md`

## Global Constraints

- **NÃO alterar `shared/schema.ts`.** Regra do CLAUDE.md. Todos os campos necessários já existem: `equipment` (type, brand, model, serialNumber, mac, status, inRecoveryProcess, value) e `customers.equipmentCount` / `customers.equipmentEstimatedValue`.
- **Multi-tenant:** toda query filtra por `providerId`. `update` e `remove` levam `providerId` no `WHERE`, nunca só `id`.
- **Testes são de função pura.** O repo não tem teste de integração com banco (ver `server/services/lgpd-masking.test.ts`, `server/routes/antifraude.routes.test.ts`). Lógica arriscada vai para função pura testável; a camada de banco fica fina.
- **LGPD:** série, MAC e modelo **nunca** cruzam provedor. Não adicionar esses campos a `PRESERVED_FIELDS` em `server/services/lgpd-masking.ts`.
- **Português brasileiro** na interface e nas mensagens de erro.
- **Drizzle via storage.** Nada de SQL cru nas rotas.
- Rodar teste: `npm test`. Typecheck: `npm run check` — o baseline é **112 erros pré-existentes**; qualquer número acima disso é regressão sua.

---

### Task 1: Regra de sync como função pura

O ponto de maior risco do módulo. A decisão foi: **manual vence**, com uma exceção estreita — devolução confirmada pelo ERP corrige o registro, porque senão um aparelho já devolvido seguiria penalizando o score de alguém.

**Files:**
- Create: `server/services/equipment-sync-rules.ts`
- Test: `server/services/equipment-sync-rules.test.ts`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: `decidirAcaoSync(existente, entrando): AcaoSync` e os tipos `EquipamentoExistente`, `EquipamentoErp`, `AcaoSync`. A Task 3 chama isso.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// server/services/equipment-sync-rules.test.ts
import { describe, it, expect } from 'vitest';
import { decidirAcaoSync, ehDevolvido } from './equipment-sync-rules';

const erp = (o: Record<string, any> = {}) => ({
  type: 'ONU', brand: 'Huawei', model: 'HG8245',
  serialNumber: 'ABC123', value: '290', inRecoveryProcess: false,
  status: 'retido', ...o,
});

const base = (o: Record<string, any> = {}) => ({
  id: 1, serialNumber: 'ABC123', status: 'installed', ...o,
});

describe('ehDevolvido', () => {
  it.each(['devolvido', 'DEVOLVIDO', 'returned', 'baixa', 'baixado'])(
    'reconhece "%s" como devolvido', (s) => {
      expect(ehDevolvido(s)).toBe(true);
    });

  it.each(['retido', 'em cobranca', 'installed', '', undefined])(
    'nao trata "%s" como devolvido', (s) => {
      expect(ehDevolvido(s)).toBe(false);
    });
});

describe('decidirAcaoSync', () => {
  it('insere quando a serie nao existe na base', () => {
    expect(decidirAcaoSync(undefined, erp())).toBe('inserir');
  });

  it('marca devolvido quando o ERP confirma devolucao — excecao a "manual vence"', () => {
    expect(decidirAcaoSync(base(), erp({ status: 'devolvido' }))).toBe('marcar-devolvido');
  });

  it('nao toca quando o ERP diz retido e a linha ja existe — manual vence', () => {
    expect(decidirAcaoSync(base(), erp({ status: 'retido' }))).toBe('ignorar');
  });

  it('nao remarca o que ja esta devolvido na base', () => {
    expect(decidirAcaoSync(base({ status: 'devolvido' }), erp({ status: 'devolvido' }))).toBe('ignorar');
  });

  it('nao insere equipamento do ERP sem numero de serie', () => {
    expect(decidirAcaoSync(undefined, erp({ serialNumber: '' }))).toBe('ignorar');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run server/services/equipment-sync-rules.test.ts`
Expected: FAIL — `Failed to resolve import "./equipment-sync-rules"`

- [ ] **Step 3: Implementar**

```ts
// server/services/equipment-sync-rules.ts

/**
 * Decide o que o sync de ERP faz com cada equipamento.
 *
 * Regra do produto: MANUAL VENCE. O equipamento digitado a mao existe
 * justamente porque o ERP nao o tinha; sobrescrever destruiria dado real.
 *
 * EXCECAO (unica escrita do sync sobre linha existente): quando o ERP confirma
 * DEVOLUCAO, atualizamos. Sem isso um aparelho ja devolvido seguiria marcado
 * como retido e penalizaria o score de quem devolveu — num bureau isso e
 * acusacao errada. A excecao so corrige para menos, nunca para mais.
 *
 * Para remover a excecao, apague o ramo `marcar-devolvido` abaixo.
 */

export type AcaoSync = 'inserir' | 'marcar-devolvido' | 'ignorar';

export interface EquipamentoExistente {
  id: number;
  serialNumber: string | null;
  status: string;
}

export interface EquipamentoErp {
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  value: string;
  inRecoveryProcess: boolean;
  status?: string;
}

const STATUS_DEVOLVIDO = ['devolvido', 'returned', 'baixa', 'baixado'];

export function ehDevolvido(status?: string | null): boolean {
  if (!status) return false;
  return STATUS_DEVOLVIDO.includes(status.trim().toLowerCase());
}

export function decidirAcaoSync(
  existente: EquipamentoExistente | undefined,
  entrando: EquipamentoErp,
): AcaoSync {
  // Sem serie nao ha como casar com seguranca: nao inserimos duplicata a cada sync.
  if (!entrando.serialNumber?.trim()) return 'ignorar';

  if (!existente) return 'inserir';

  if (ehDevolvido(entrando.status) && !ehDevolvido(existente.status)) {
    return 'marcar-devolvido';
  }

  return 'ignorar';
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run server/services/equipment-sync-rules.test.ts`
Expected: PASS — 10 testes

- [ ] **Step 5: Commit**

```bash
git add server/services/equipment-sync-rules.ts server/services/equipment-sync-rules.test.ts
git commit -m "feat(equipamentos): regra de sync como funcao pura, com excecao de devolucao"
```

---

### Task 2: CRUD no EquipmentStorage

**Files:**
- Modify: `server/storage/equipment.storage.ts`
- Modify: `server/storage/index.ts:88` (interface `IStorage`) e `:320-322` (delegações)

**Interfaces:**
- Consumes: nada
- Produces: `storage.updateEquipment(id, providerId, data)`, `storage.removeEquipment(id, providerId)`, `storage.getEquipmentById(id, providerId)`. As Tasks 7 e 10 chamam.

- [ ] **Step 1: Adicionar os métodos**

```ts
// server/storage/equipment.storage.ts — substituir o arquivo inteiro
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  equipment,
  type Equipment, type InsertEquipment,
} from "@shared/schema";

export class EquipmentStorage {
  async getEquipmentByProvider(providerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.providerId, providerId));
  }

  async getEquipmentByCustomer(customerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.customerId, customerId));
  }

  async createEquipment(eq_data: InsertEquipment): Promise<Equipment> {
    const [created] = await db.insert(equipment).values(eq_data).returning();
    return created;
  }

  /** providerId no WHERE e isolamento multi-tenant, nao conveniencia. */
  async getEquipmentById(id: number, providerId: number): Promise<Equipment | undefined> {
    const [found] = await db.select().from(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .limit(1);
    return found;
  }

  async updateEquipment(
    id: number,
    providerId: number,
    data: Partial<InsertEquipment>,
  ): Promise<Equipment | undefined> {
    const [updated] = await db.update(equipment)
      .set(data)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .returning();
    return updated;
  }

  async removeEquipment(id: number, providerId: number): Promise<boolean> {
    const removed = await db.delete(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .returning();
    return removed.length > 0;
  }
}
```

- [ ] **Step 2: Declarar na interface IStorage**

Em `server/storage/index.ts`, logo abaixo da linha 88 (`createEquipment(...)`), adicionar:

```ts
  getEquipmentById(id: number, providerId: number): Promise<Equipment | undefined>;
  updateEquipment(id: number, providerId: number, data: Partial<InsertEquipment>): Promise<Equipment | undefined>;
  removeEquipment(id: number, providerId: number): Promise<boolean>;
```

- [ ] **Step 3: Delegar na classe**

Em `server/storage/index.ts`, logo abaixo da linha 322 (`createEquipment = ...`), adicionar:

```ts
  getEquipmentById = (id: number, providerId: number) => this._equipment.getEquipmentById(id, providerId);
  updateEquipment = (id: number, providerId: number, data: Partial<InsertEquipment>) => this._equipment.updateEquipment(id, providerId, data);
  removeEquipment = (id: number, providerId: number) => this._equipment.removeEquipment(id, providerId);
```

- [ ] **Step 4: Typecheck**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `112` — o baseline. Acima disso é regressão sua.

- [ ] **Step 5: Commit**

```bash
git add server/storage/equipment.storage.ts server/storage/index.ts
git commit -m "feat(equipamentos): CRUD no EquipmentStorage com isolamento por providerId"
```

---

### Task 3: syncFromErp e contagem agregada

**Files:**
- Modify: `server/storage/equipment.storage.ts`
- Modify: `server/storage/index.ts` (interface + delegação)

**Interfaces:**
- Consumes: `decidirAcaoSync` da Task 1; a classe da Task 2
- Produces: `storage.syncEquipmentFromErp(providerId, customerId, detalhes)` retornando `{ inseridos, devolvidos }`, e `storage.contarEquipamentoRetido(customerIds)` retornando `Map<number, { count: number; value: number }>`. As Tasks 5 e 8 chamam.

- [ ] **Step 1: Adicionar os métodos à classe**

Acrescentar ao `EquipmentStorage` (importar `decidirAcaoSync` e `EquipamentoErp` no topo):

```ts
import { decidirAcaoSync, type EquipamentoErp } from "../services/equipment-sync-rules";
```

```ts
  /**
   * Aplica o resultado do ERP sobre o equipamento de um cliente.
   * A decisao por aparelho vem de decidirAcaoSync (funcao pura, testada) —
   * aqui so executamos.
   */
  async syncEquipmentFromErp(
    providerId: number,
    customerId: number,
    detalhes: EquipamentoErp[],
  ): Promise<{ inseridos: number; devolvidos: number }> {
    if (detalhes.length === 0) return { inseridos: 0, devolvidos: 0 };

    const atuais = await db.select().from(equipment)
      .where(and(eq(equipment.providerId, providerId), eq(equipment.customerId, customerId)));

    const porSerie = new Map<string, typeof atuais[number]>();
    for (const a of atuais) {
      if (a.serialNumber) porSerie.set(a.serialNumber.trim().toLowerCase(), a);
    }

    let inseridos = 0;
    let devolvidos = 0;

    for (const d of detalhes) {
      const chave = d.serialNumber?.trim().toLowerCase() || "";
      const existente = chave ? porSerie.get(chave) : undefined;
      const acao = decidirAcaoSync(
        existente ? { id: existente.id, serialNumber: existente.serialNumber, status: existente.status } : undefined,
        d,
      );

      if (acao === "inserir") {
        await db.insert(equipment).values({
          providerId,
          customerId,
          type: d.type || "Equipamento",
          brand: d.brand || null,
          model: d.model || null,
          serialNumber: d.serialNumber,
          status: "installed",
          inRecoveryProcess: d.inRecoveryProcess,
          value: d.value || "290",
        });
        inseridos++;
      } else if (acao === "marcar-devolvido" && existente) {
        await db.update(equipment)
          .set({ status: "devolvido", inRecoveryProcess: false })
          .where(eq(equipment.id, existente.id));
        devolvidos++;
      }
    }

    return { inseridos, devolvidos };
  }

  /**
   * Contagem e valor de equipamento NAO devolvido, para N clientes numa query.
   * A consulta em rede usa isso; fazer N+1 aqui derrubaria o tempo de resposta.
   */
  async contarEquipamentoRetido(
    customerIds: number[],
  ): Promise<Map<number, { count: number; value: number }>> {
    const mapa = new Map<number, { count: number; value: number }>();
    if (customerIds.length === 0) return mapa;

    const linhas = await db.select({
      customerId: equipment.customerId,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${equipment.value}), 0)::float`,
    })
      .from(equipment)
      .where(and(
        inArray(equipment.customerId, customerIds),
        sql`lower(${equipment.status}) not in ('devolvido', 'returned', 'baixa', 'baixado')`,
      ))
      .groupBy(equipment.customerId);

    for (const l of linhas) {
      if (l.customerId != null) mapa.set(l.customerId, { count: l.count, value: l.total });
    }
    return mapa;
  }
```

- [ ] **Step 2: Declarar e delegar em `server/storage/index.ts`**

Na interface, junto dos outros de equipamento:

```ts
  syncEquipmentFromErp(providerId: number, customerId: number, detalhes: any[]): Promise<{ inseridos: number; devolvidos: number }>;
  contarEquipamentoRetido(customerIds: number[]): Promise<Map<number, { count: number; value: number }>>;
```

Na classe:

```ts
  syncEquipmentFromErp = (providerId: number, customerId: number, detalhes: any[]) => this._equipment.syncEquipmentFromErp(providerId, customerId, detalhes);
  contarEquipamentoRetido = (customerIds: number[]) => this._equipment.contarEquipamentoRetido(customerIds);
```

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `112`

- [ ] **Step 4: Commit**

```bash
git add server/storage/equipment.storage.ts server/storage/index.ts
git commit -m "feat(equipamentos): syncFromErp e contagem agregada sem N+1"
```

---

### Task 4: `upsertFromErp` devolve o cliente e para de gravar default falso

Hoje `upsertFromErp` grava `equipmentCount: 1` e `equipmentEstimatedValue: "290"` fixos em toda inserção. O sistema **presume** que todo cliente tem um equipamento de R$290, e esse número já alimenta o cálculo de prejuízo do Anti-Fraude.

**Files:**
- Modify: `server/storage/customers.storage.ts` (método `upsertFromErp`)
- Modify: `server/storage/index.ts` (assinatura na interface)

**Interfaces:**
- Consumes: nada
- Produces: `upsertFromErp(...)` passa de `Promise<void>` para `Promise<Customer>`. A Task 5 precisa do `id` para associar equipamento.

- [ ] **Step 1: Mudar o retorno e remover os defaults falsos**

Em `server/storage/customers.storage.ts`:

1. Trocar a assinatura `}): Promise<void> {` por `}): Promise<Customer> {`
2. No ramo de **insert**, remover as duas linhas:

```ts
        equipmentCount: 1,
        equipmentEstimatedValue: "290",
```

Elas somem: sem equipamento conhecido, o valor fica no default da coluna e o agregado real é escrito pela Task 5.

3. Capturar e devolver a linha nos dois ramos. No `update`:

```ts
      const [atualizado] = await db.update(customers)
        .set(updateFields)
        .where(eq(customers.id, existing[0].id))
        .returning();
      return atualizado;
```

No `insert`:

```ts
      const [criado] = await db.insert(customers).values({
        // ...campos existentes, sem equipmentCount/equipmentEstimatedValue...
      }).returning();
      return criado;
```

- [ ] **Step 2: Atualizar a interface**

Em `server/storage/index.ts`, trocar o retorno de `upsertFromErp` de `Promise<void>` para `Promise<Customer>`.

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `112`. Chamadores existentes ignoram o retorno — mudar `void` para `Customer` é compatível.

- [ ] **Step 4: Commit**

```bash
git add server/storage/customers.storage.ts server/storage/index.ts
git commit -m "fix(equipamentos): upsertFromErp devolve o cliente e para de gravar equipamento falso

O insert gravava equipmentCount: 1 e equipmentEstimatedValue: 290 fixos, entao
o sistema presumia um equipamento de R$290 por cliente. Esse numero ja alimentava
o calculo de prejuizo do Anti-Fraude."
```

---

### Task 5: Ligar o sync — o encanamento que falta

`equipmentDetails` é produzido pelo conector IXC e **descartado**. Aqui ele passa a ser persistido.

**Files:**
- Modify: `server/services/erp-sync.service.ts` (o `upsertFromErp` do laço de inadimplentes, ~linha 182)

**Interfaces:**
- Consumes: `storage.syncEquipmentFromErp` (Task 3), `upsertFromErp` retornando `Customer` (Task 4)
- Produces: nada de novo — efeito é dado no banco

- [ ] **Step 1: Persistir equipamento e recalcular o agregado**

Em `server/services/erp-sync.service.ts`, trocar `await storage.upsertFromErp({...})` por `const clienteSalvo = await storage.upsertFromErp({...})` e logo depois, antes de `upserted++`:

```ts
      // O conector ja normaliza equipmentDetails (ver server/erp/types.ts).
      // Ate esta versao ninguem lia esse campo — o sync descartava.
      const detalhes = (customer as any).equipmentDetails as any[] | undefined;
      if (clienteSalvo?.id && detalhes?.length) {
        try {
          await storage.syncEquipmentFromErp(providerId, clienteSalvo.id, detalhes);

          const agregado = await storage.contarEquipamentoRetido([clienteSalvo.id]);
          const a = agregado.get(clienteSalvo.id);
          await storage.updateCustomerEquipmentAggregate(
            clienteSalvo.id,
            a?.count ?? 0,
            String(a?.value ?? 0),
          );
        } catch (e: any) {
          // Falha de equipamento nao invalida o upsert do cliente: o dado de
          // divida e mais critico que o de comodato.
          console.warn(`[ERPSync] equipamento ${customer.cpfCnpj}: ${e.message}`);
        }
      }
```

- [ ] **Step 2: Criar `updateCustomerEquipmentAggregate`**

Em `server/storage/customers.storage.ts`:

```ts
  /** Agregado lido pela consulta em rede — evita join de equipamento por busca. */
  async updateCustomerEquipmentAggregate(
    customerId: number,
    count: number,
    value: string,
  ): Promise<void> {
    await db.update(customers)
      .set({ equipmentCount: count, equipmentEstimatedValue: value })
      .where(eq(customers.id, customerId));
  }
```

Declarar na interface e delegar na classe em `server/storage/index.ts`, junto dos demais de customers:

```ts
  updateCustomerEquipmentAggregate(customerId: number, count: number, value: string): Promise<void>;
```

```ts
  updateCustomerEquipmentAggregate = (customerId: number, count: number, value: string) => this._customers.updateCustomerEquipmentAggregate(customerId, count, value);
```

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `112`

- [ ] **Step 4: Commit**

```bash
git add server/services/erp-sync.service.ts server/storage/customers.storage.ts server/storage/index.ts
git commit -m "feat(equipamentos): sync passa a persistir equipmentDetails do conector"
```

---

### Task 6: Capacidade `supportsEquipment` por conector

Quem tiver cadastro de comodato ou de ativos deve ser buscado. Hoje só o IXC busca; a tela precisa dizer isso ao provedor em vez de deixá-lo achar que o ERP vai preencher sozinho.

**Files:**
- Modify: `server/erp/types.ts` (metadata do conector)
- Modify: `server/erp/connectors/ixc.ts` (declarar `true`)
- Modify: `server/routes/erp.routes.ts` (expor em `GET /api/erp-connectors`)

**Interfaces:**
- Consumes: nada
- Produces: `supportsEquipment: boolean` em cada item de `GET /api/erp-connectors`. A Task 10 lê.

- [ ] **Step 1: Adicionar o campo à metadata**

Em `server/erp/types.ts`, na interface de metadata do conector (onde já existem `name`, `label`, `configFields`):

```ts
  /**
   * Se o conector busca comodato/ativos do ERP.
   * false = o provedor precisa usar planilha ou formulario.
   * Ao implementar equipamento para um ERP novo, vire para true aqui e
   * preencha equipmentDetails em NormalizedErpCustomer.
   */
  supportsEquipment?: boolean;
```

- [ ] **Step 2: IXC declara `true`, os demais ficam sem declarar**

Em `server/erp/connectors/ixc.ts`, no objeto de metadata exportado, adicionar `supportsEquipment: true`.

Os outros cinco conectores permanecem sem o campo (`undefined` → tratado como `false`). Isso é o slot documentado: quando alguém mapear o comodato do MK, vira `true` naquele arquivo.

- [ ] **Step 3: Expor na rota**

Em `server/routes/erp.routes.ts`, no handler de `GET /api/erp-connectors`, incluir `supportsEquipment: !!meta.supportsEquipment` no objeto retornado por conector.

- [ ] **Step 4: Verificar**

Run: `curl -s http://localhost:5000/api/erp-connectors | grep -o '"supportsEquipment":[a-z]*' | sort | uniq -c`
Expected: um `true` (IXC) e cinco `false`

- [ ] **Step 5: Commit**

```bash
git add server/erp/types.ts server/erp/connectors/ixc.ts server/routes/erp.routes.ts
git commit -m "feat(equipamentos): capacidade supportsEquipment por conector"
```

---

### Task 7: Rotas — corrigir duplicata e adicionar CRUD

`GET /api/equipment` está registrado **duas vezes**: em `dashboard.routes.ts:75` e `equipamentos.routes.ts:19`. O comentário no segundo arquivo diz que é compatibilidade temporária de migração. Como `registerDashboardRoutes()` é montado antes, o handler do dashboard é o que responde e o de equipamentos é código morto.

**Files:**
- Modify: `server/routes/dashboard.routes.ts:75-83` (remover o handler duplicado)
- Modify: `server/routes/equipamentos.routes.ts` (virar o dono, ganhar CRUD)

**Interfaces:**
- Consumes: `storage.createEquipment`, `updateEquipment`, `removeEquipment`, `getEquipmentById` (Tasks 2 e 3)
- Produces: `POST /api/equipment`, `PATCH /api/equipment/:id`, `DELETE /api/equipment/:id`. A Task 10 consome.

- [ ] **Step 1: Remover o handler duplicado do dashboard**

Em `server/routes/dashboard.routes.ts`, apagar o bloco das linhas 75-83 (`router.get("/api/equipment", ...)` inteiro).

- [ ] **Step 2: Substituir `equipamentos.routes.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";

/**
 * Rotas de equipamento. Dono unico de /api/equipment desde que o handler
 * duplicado saiu de dashboard.routes.ts.
 */

const equipamentoSchema = z.object({
  customerId: z.number().int().positive().optional(),
  type: z.string().min(1, "Informe o tipo do equipamento"),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  mac: z.string().optional(),
  status: z.enum(["installed", "devolvido", "retido", "em_cobranca", "baixado"]).default("installed"),
  inRecoveryProcess: z.boolean().default(false),
  value: z.string().optional(),
});

export function registerEquipamentosRoutes(): Router {
  const router = Router();

  router.get("/api/equipment", requireAuth, async (req, res) => {
    try {
      const eqs = await storage.getEquipmentByProvider(req.session.providerId!);
      return res.json(eqs);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/equipment", requireAuth, async (req, res) => {
    try {
      const parsed = equipamentoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }
      const criado = await storage.createEquipment({
        ...parsed.data,
        providerId: req.session.providerId!,
      } as any);
      return res.status(201).json(criado);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/equipment/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id invalido" });

      const parsed = equipamentoSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }
      const atualizado = await storage.updateEquipment(id, req.session.providerId!, parsed.data as any);
      if (!atualizado) return res.status(404).json({ message: "Equipamento nao encontrado" });
      return res.json(atualizado);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/equipment/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id invalido" });

      const ok = await storage.removeEquipment(id, req.session.providerId!);
      if (!ok) return res.status(404).json({ message: "Equipamento nao encontrado" });
      return res.status(204).end();
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
```

- [ ] **Step 3: Verificar que a rota responde e o isolamento vale**

Run: `curl -s -X PATCH http://localhost:5000/api/equipment/999999 -H "Content-Type: application/json" -d '{"status":"devolvido"}' -w "\n%{http_code}\n"`
Expected: `401` sem sessão; com sessão de outro provedor, `404` — nunca 200.

- [ ] **Step 4: Commit**

```bash
git add server/routes/dashboard.routes.ts server/routes/equipamentos.routes.ts
git commit -m "feat(equipamentos): CRUD de equipamento e remocao da rota GET duplicada"
```

---

### Task 8: Equipamento na consulta

`unreturnedEquipmentCount` está fixo em `0` e `equipmentPendingSummary` nunca é preenchido — apesar de os dois já passarem pelo mascaramento LGPD e o resumo já ser consumido pela análise de IA.

**Files:**
- Modify: `server/routes/consultas.routes.ts:213-215`

**Interfaces:**
- Consumes: `storage.contarEquipamentoRetido` (Task 3)
- Produces: `unreturnedEquipmentCount` e `equipmentPendingSummary` com valor real no resultado da consulta

- [ ] **Step 1: Buscar o agregado antes de montar os detalhes**

Antes do `.map(...)` que monta `providerDetails`, adicionar:

```ts
        // Contagem real de equipamento retido — uma query para todos os clientes.
        const idsClientes = allCustomers.map((c: any) => c.id).filter(Boolean);
        const equipPorCliente = await storage.contarEquipamentoRetido(idsClientes);
```

- [ ] **Step 2: Preencher os campos**

Trocar a linha `unreturnedEquipmentCount: 0,` por:

```ts
            unreturnedEquipmentCount: equipPorCliente.get((c as any).id)?.count ?? 0,
            equipmentPendingSummary: (() => {
              const e = equipPorCliente.get((c as any).id);
              if (!e || e.count === 0) return undefined;
              const valor = e.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              return `${e.count} equipamento${e.count > 1 ? "s" : ""} · R$ ${valor}`;
            })(),
```

E ajustar `hasUnreturnedEquipment` para considerar o dado persistido além do flag do conector:

```ts
            hasUnreturnedEquipment: c.hasUnreturnedEquipment || (equipPorCliente.get((c as any).id)?.count ?? 0) > 0,
```

- [ ] **Step 3: Confirmar que o mascaramento continua correto**

Run: `npx vitest run server/services/lgpd-masking.test.ts`
Expected: PASS. `PRESERVED_FIELDS` já libera os três campos; série, MAC e modelo **não** entram no detalhe cross-provider e não devem ser adicionados.

- [ ] **Step 4: Commit**

```bash
git add server/routes/consultas.routes.ts
git commit -m "feat(equipamentos): consulta passa a expor contagem e resumo reais"
```

---

### Task 9: Grupo Equipamentos e tela de gestão

**Files:**
- Create: `client/src/pages/operacional/equipamentos.tsx`
- Modify: `client/src/components/app-sidebar.tsx` (array `NAV`)
- Modify: `client/src/App.tsx` (rota + lazy import)

**Interfaces:**
- Consumes: `GET /api/equipment` (Task 7)
- Produces: rota `/equipamentos`

- [ ] **Step 1: Criar a página**

```tsx
// client/src/pages/operacional/equipamentos.tsx
import { useQuery } from "@tanstack/react-query";
import { Package, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Equipamento = {
  id: number; customerId: number | null; type: string;
  brand: string | null; model: string | null; serialNumber: string | null;
  status: string; inRecoveryProcess: boolean | null; value: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  installed:   { label: "Em campo",   cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  retido:      { label: "Retido",     cls: "bg-[var(--past-bg)] text-[var(--past)]" },
  em_cobranca: { label: "Em cobrança", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
  devolvido:   { label: "Devolvido",  cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
  baixado:     { label: "Baixado",    cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]" },
};

export default function EquipamentosPage() {
  const { data = [], isLoading } = useQuery<Equipamento[]>({ queryKey: ["/api/equipment"] });

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="equipamentos-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
            Equipamentos
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            Comodato em campo e equipamento não devolvido
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-6 py-12 text-center">
          <Package className="w-8 h-8 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
          <h3 className="font-medium text-base text-[var(--text)]">Nenhum equipamento cadastrado</h3>
          <p className="mt-2 mb-6 mx-auto max-w-[46ch] text-sm text-[var(--text-muted)]">
            Se o seu ERP tem cadastro de comodato, o equipamento aparece aqui após a
            sincronização. Caso contrário, importe por planilha ou cadastre manualmente.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead>
                <tr>
                  {["Tipo", "Marca / Modelo", "Série", "Valor", "Status"].map(h => (
                    <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2 border-b border-[var(--border-faint)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map(e => {
                  const s = STATUS[e.status] ?? STATUS.installed;
                  return (
                    <tr key={e.id} className="border-b border-[var(--border-faint)] last:border-b-0" data-testid={`equipamento-${e.id}`}>
                      <td className="px-4 py-2.5 text-[var(--text)]">{e.type}</td>
                      <td className="px-4 py-2.5 text-[var(--text-2)]">{[e.brand, e.model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-2)]">{e.serialNumber || "—"}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text)]">
                        {e.value ? `R$ ${Number(e.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 rounded ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `client/src/App.tsx`, junto dos outros lazy de operacional:

```tsx
const EquipamentosPage = lazy(() => import("@/pages/operacional/equipamentos"));
```

E no `<Switch>`, junto de `/importacao-equipamentos`:

```tsx
        <Route path="/equipamentos" component={EquipamentosPage} />
```

E adicionar `"/equipamentos"` ao array `PROVIDER_ONLY_PATHS`.

- [ ] **Step 3: Criar o grupo na sidebar**

Em `client/src/components/app-sidebar.tsx`, no array `NAV`, inserir um grupo entre "Financeiro" e "Gestão" e **mover** o item de importação de equipamentos para dentro dele:

```tsx
    {
      grupo: "Equipamentos",
      itens: [
        { label: "Equipamentos", url: "/equipamentos", Icone: Package, testId: "link-equipamentos" },
        { label: "Importar",     url: "/importacao-equipamentos", Icone: Upload, testId: "link-importacao-equipamentos" },
      ],
    },
```

Remover a linha `Importar Equip.` do grupo "Gestão".

- [ ] **Step 4: Verificar no navegador**

Run: abrir `http://localhost:5000/equipamentos`
Expected: grupo "Equipamentos" na sidebar com dois itens; a tela mostra a tabela ou o estado vazio, sem erro no console.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/operacional/equipamentos.tsx client/src/App.tsx client/src/components/app-sidebar.tsx
git commit -m "feat(equipamentos): grupo na sidebar e tela de gestao"
```

---

### Task 10: Formulário de cadastro e aviso de capacidade do ERP

**Files:**
- Modify: `client/src/pages/operacional/equipamentos.tsx`
- Modify: `client/src/pages/operacional/importacao-equipamentos.tsx` (aviso de capacidade)

**Interfaces:**
- Consumes: `POST /api/equipment`, `PATCH /api/equipment/:id`, `DELETE /api/equipment/:id` (Task 7); `GET /api/erp-connectors` com `supportsEquipment` (Task 6)
- Produces: nada

- [ ] **Step 1: Adicionar o formulário em modal**

Em `equipamentos.tsx`, acrescentar botão "Cadastrar equipamento" no cabeçalho e um `Dialog` do shadcn com os campos `type` (obrigatório), `brand`, `model`, `serialNumber`, `value`, `status`. Submeter com `useMutation` para `POST /api/equipment` e invalidar `["/api/equipment"]` no sucesso.

```tsx
  const criar = useMutation({
    mutationFn: async (dados: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/equipment", dados);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Equipamento cadastrado" });
      setAberto(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
```

- [ ] **Step 2: Ação de marcar devolvido**

Em cada linha da tabela, um botão que chama `PATCH /api/equipment/:id` com `{ status: "devolvido", inRecoveryProcess: false }`, invalidando a mesma query.

- [ ] **Step 3: Aviso de capacidade na tela de importação**

Em `importacao-equipamentos.tsx`, consultar `GET /api/erp-connectors` e, se o ERP configurado do provedor tiver `supportsEquipment: false`, mostrar no topo:

```tsx
<div className="rounded-lg bg-[var(--gated-bg)] px-4 py-3 text-[13px] text-[var(--gated)]">
  Seu ERP ainda não sincroniza cadastro de comodato. Importe por planilha ou
  cadastre manualmente em Equipamentos.
</div>
```

- [ ] **Step 4: Verificar no navegador**

Run: abrir `/equipamentos`, cadastrar um equipamento pelo formulário, marcar como devolvido
Expected: a linha aparece na tabela após o cadastro; ao marcar devolvido, o badge muda para verde; nenhum erro no console.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/operacional/equipamentos.tsx client/src/pages/operacional/importacao-equipamentos.tsx
git commit -m "feat(equipamentos): cadastro por formulario e aviso de capacidade do ERP"
```

---

## Verificação final

- [ ] `npm test` — todos passam, incluindo os 10 novos de `equipment-sync-rules`
- [ ] `npm run check 2>&1 | grep -c "error TS"` → `112` (baseline; acima é regressão)
- [ ] `npm run build` → passa
- [ ] `grep -rn 'router.get("/api/equipment"' server/routes/` → **uma** ocorrência
- [ ] `grep -n "equipmentCount: 1" server/storage/customers.storage.ts` → vazio
- [ ] Consulta de um CPF com equipamento retido: o resultado mostra contagem e resumo
- [ ] Consulta cross-provider: **não** expõe série, MAC nem modelo

---

### Task 11: Importação por planilha recalcula o agregado

`bulkImportEquipment` já valida antes de gravar e roda em transação atômica, criando o cliente por CPF quando não existe. O que falta: ele grava em `equipment` mas **não atualiza** `customers.equipmentCount` / `equipmentEstimatedValue`. Sem isso, equipamento importado por planilha não aparece na consulta em rede, que lê o agregado.

**Files:**
- Modify: `server/storage/import.storage.ts` (método `bulkImportEquipment`, após a transação)

**Interfaces:**
- Consumes: `contarEquipamentoRetido` (Task 3), `updateCustomerEquipmentAggregate` (Task 5)
- Produces: nada de novo

- [ ] **Step 1: Coletar os clientes afetados dentro da transação**

Em `bulkImportEquipment`, declarar antes do laço da transação:

```ts
      const clientesAfetados = new Set<number>();
```

E dentro do laço, logo após `customerId` ser resolvido:

```ts
        if (customerId) clientesAfetados.add(customerId);
```

- [ ] **Step 2: Recalcular após a transação**

Depois que a transação retorna (fora do `db.transaction`, para não segurar o lock durante o recálculo):

```ts
    // A consulta em rede le o agregado em customers, nao a tabela de equipamento.
    // Sem este recalculo, equipamento importado por planilha nao apareceria la.
    if (clientesAfetados.size > 0) {
      const ids = [...clientesAfetados];
      const agregado = await this._equipmentStorage.contarEquipamentoRetido(ids);
      for (const id of ids) {
        const a = agregado.get(id);
        await this._customersStorage.updateCustomerEquipmentAggregate(id, a?.count ?? 0, String(a?.value ?? 0));
      }
    }
```

Se `ImportStorage` não tiver acesso a esses storages, injete-os no construtor ou importe as classes diretamente — siga o padrão já usado no arquivo.

- [ ] **Step 3: Verificar de ponta a ponta**

Run: importar um CSV com 2 equipamentos para um CPF existente e depois consultar esse CPF
Expected: a consulta mostra "2 equipamentos" no resultado, e `customers.equipmentCount` do cliente vale 2 — não o default.

- [ ] **Step 4: Commit**

```bash
git add server/storage/import.storage.ts
git commit -m "fix(equipamentos): importacao por planilha recalcula o agregado do cliente"
```

---

## Nota: a tela da consulta já existe

Não construa a exibição de equipamento no resultado da consulta — **ela já está pronta** e só espera o dado:

- `client/src/components/consulta/ConsultaResultDetail.tsx:310-339` — bloco com contagem e `equipmentPendingSummary`
- `client/src/components/consulta/ConsultaResultSummary.tsx:95-98` — badge de equipamento
- `client/src/components/consulta/ConsultaResultSummary.tsx:226` — total somado entre provedores
- `client/src/components/consulta/ProviderDetailModals.tsx:120` — detalhe por provedor

Todos consomem `hasUnreturnedEquipment`, `unreturnedEquipmentCount` e `equipmentPendingSummary`, que são exatamente os campos que a Task 8 passa a preencher. A tela acende sozinha.
