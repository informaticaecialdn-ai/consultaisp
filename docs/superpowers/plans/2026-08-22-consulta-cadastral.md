# Consulta Cadastral (BigDataCorp) — plano de implementação

**Spec:** `docs/superpowers/specs/2026-08-22-consulta-cadastral-design.md`

**Goal:** Consulta de dados cadastrais na BigDataCorp, com credencial e custo por
provedor, veredito auditável e tela própria abaixo de Consulta ISP.

## Mudança em relação à spec: credencial por tenant

A spec previa credencial única em `.env`. O dono decidiu **um usuário de
integração por provedor**, para que consumo e custo apareçam separados também do
lado da BigData.

Consequências:

- Credencial sai do `.env` e vai para `bigdata_integrations`, uma linha por
  provedor — espelhando `erp_integrations`.
- `login` e `password` gravados com `encryptField` (AES-256-GCM, chave derivada
  do `SESSION_SECRET`), igual ao `erp.storage.ts`.
- O cache de token passa a ser **por provedor**, não global.
- `.env` mantém só `BIGDATA_BASE_URL`. Sem segredo global.

**Defeito encontrado no levantamento, que não vamos repetir:**
`GET /api/provider/erp-integrations` devolve as integrações descriptografadas ao
navegador — o `apiToken` do ERP trafega para o front. A rota da BigData devolve
a senha **mascarada**; o valor real nunca sai do servidor.

## Global Constraints

- Alteração de `shared/schema.ts` **autorizada pelo dono em 2026-08-22** para
  este módulo — e só para o que está descrito aqui.
- Multi-tenant: toda query filtra por `providerId`; nunca só por `id`.
- Testes de função pura. Sem teste de integração com banco — o repo não tem.
- Português BR na interface e nos erros.
- Drizzle via storage. Sem SQL cru nas rotas.
- Typecheck: baseline **112**. Acima disso é regressão.

---

### Task 1: Schema

**Files:** `shared/schema.ts`

```ts
export const bigdataIntegrations = pgTable("bigdata_integrations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  login: text("login"),                    // encryptField
  password: text("password"),              // encryptField
  isEnabled: boolean("is_enabled").notNull().default(false),
  lastCheckAt: timestamp("last_check_at"),
  lastCheckStatus: text("last_check_status"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bigdataConsultations = pgTable("bigdata_consultations", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  userId: integer("user_id").notNull().references(() => users.id),
  cpfCnpj: text("cpf_cnpj").notNull(),
  result: jsonb("result"),
  datasets: text("datasets").array(),      // quais foram chamados
  veredito: text("veredito"),              // APROVAR | ATENCAO | RECUSAR
  createdAt: timestamp("created_at").defaultNow(),
});
```

Mais `providers.bigdataCredits`, `creditOrders.bigdataCreditsAdded`,
`plans.bigdataCreditsIncluded` — todos `integer default 0`.

- [ ] Adicionar as tabelas e colunas
- [ ] `npm run db:push`
- [ ] Typecheck → 112

---

### Task 2: Veredito como função pura

**Files:** `server/services/bigdata-veredito.ts` + `.test.ts`

Primeiro o teste, depois a implementação.

Regras (spec, decisão 5) — e a tradução do `-1200`:

```
CPF_NAO_ENCONTRADO — basic_data Code -1200 e demais datasets zerados
RECUSAR            — TaxIdStatus != REGULAR, ou HasObitIndication
ATENCAO            — nenhum endereço ratificado
                   | TotalBadAddressPassages > 0
                   | renda estimada abaixo do valor do plano
                   | NumberOfFullNameNamesakes alto (homônimo)
APROVAR            — nenhum dos acima
```

Cada veredito carrega `motivos: string[]` — a razão em português, para a tela
mostrar e o operador explicar ao cliente. Veredito sem motivo é inauditável.

**Casos que o teste tem que cobrir:** CPF regular e endereço bom; CPF suspenso;
óbito; endereço não ratificado; bad passages; renda abaixo do plano; dois sinais
colidindo (CPF regular + endereço ruim); payload com campos ausentes;
`IncomeEstimates` todo "SEM INFORMACAO"; array de endereços vazio.

- [ ] Teste falha
- [ ] Implementar
- [ ] Teste passa
- [ ] Commit

---

### Task 3: Serviço BigData

**Files:** `server/services/bigdata.service.ts`

Molde: `spc.service.ts` (env, circuit breaker, `withResilience`, tipos).

```ts
// Cache de token POR PROVEDOR. Global vazaria credencial entre tenants.
const tokenCache = new Map<number, { token: string; tokenId: string; exp: number }>();
```

- `obterToken(providerId)` — usa cache; renova quando faltar < 24h para expirar
- `consultar(providerId, cpf)` — uma requisição com os três datasets
- Traduz `basic_data: -1200` + demais zerados → `CPF_NAO_ENCONTRADO`
- Normaliza o payload para a forma que o veredito consome

- [ ] Implementar
- [ ] Typecheck → 112
- [ ] Commit

---

### Task 4: Storage

**Files:** `server/storage/bigdata.storage.ts`, `server/storage/index.ts`

- `getIntegration(providerId)` / `upsertIntegration(providerId, dados)` — com
  `encryptField` / `decryptField`, seguindo `erp.storage.ts`
- `createConsultation(...)` / `getConsultations(providerId)`
- `debitarCredito(providerId)` — decremento atômico, retorna false se saldo 0

- [ ] Implementar, declarar em `IStorage`, delegar
- [ ] Typecheck → 112
- [ ] Commit

---

### Task 5: Rotas

**Files:** `server/routes/bigdata.routes.ts`, `server/routes/index.ts`

```
GET   /api/bigdata-integration      → { configurado, login, senhaMascarada, isEnabled }
PATCH /api/bigdata-integration      → grava login/senha cifrados
POST  /api/bigdata-integration/test → valida credencial sem consumir consulta
GET   /api/bigdata-consultations    → histórico do provedor
POST  /api/bigdata-consultations    → a consulta
```

Regras de cobrança (spec):

| Situação | Debita? |
|---|---|
| credencial ausente / inválida | não |
| CPF com DV inválido | não (400 antes de chamar) |
| BigData fora do ar, timeout, circuit aberto | **não** |
| CPF não encontrado | **sim** — a busca foi executada |
| sucesso | sim |

**A senha nunca sai do servidor.** O GET devolve `senhaMascarada: "••••••"`.

- [ ] Implementar
- [ ] Verificar isolamento com sessão de outro provedor
- [ ] Commit

---

### Task 6: Tela

**Files:** `client/src/pages/consulta/consulta-cadastral.tsx`, `App.tsx`,
`app-sidebar.tsx`

- Item **Consulta Cadastral** em Principal, entre Consulta ISP e Consulta SPC
- Sem credencial → estado de configuração com formulário de login/senha e botão
  testar, no lugar da busca
- Com credencial → busca por CPF, aceite LGPD, e resultado com:
  veredito grande + `motivos[]`, bloco de identidade, bloco de endereços
  (ratificado / ativo / última passagem), bloco financeiro (faixa de renda)
- Estado vazio conforme DESIGN_SYSTEM: ícone + título + descrição + CTA

- [ ] Implementar
- [ ] Verificar no navegador com credencial real
- [ ] Commit

---

## Verificação final

- [ ] `npm test` — os novos de veredito passam
- [ ] `npm run check` → 112
- [ ] Consulta com CPF real → veredito coerente com os dados
- [ ] Consulta com CPF inexistente → "CPF não encontrado", **não** erro de sistema
- [ ] Provedor sem credencial → tela de configuração, sem débito
- [ ] Senha não aparece em nenhuma resposta de API
