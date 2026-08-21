# Módulo de Equipamentos — design

**Data:** 2026-08-21
**Status:** aprovado, pronto para plano de implementação

## Problema

A não-devolução de equipamento é perda direta para o provedor: a ONU custa entre
R$200 e R$800 e sai em comodato. Quando o assinante migra sem devolver, o
prejuízo soma ao da inadimplência. Hoje o Consulta ISP **não enxerga** esse dado.

O diagnóstico é preciso: **o contrato existe ponta a ponta, o dado nunca chega.**

| Camada | Estado |
|---|---|
| Tabela `equipment` | Existe, com `value`, `status`, `inRecoveryProcess` |
| `EquipmentStorage` | Só `getByProvider`, `getByCustomer`, `create` |
| Mascaramento LGPD | Já preserva `hasUnreturnedEquipment`, `unreturnedEquipmentCount`, `equipmentPendingSummary` |
| Motor de score | Já pune não-devolução (−15) e bonifica devolução (+15) |
| Análise de IA | Já consome `equipmentPendingSummary` |
| Conector IXC | Já produz `equipmentDetails[]` normalizado |
| **Consumidor de `equipmentDetails`** | **Nenhum — o sync descarta** |
| `unreturnedEquipmentCount` na consulta | **Fixo em `0`** |
| `equipmentPendingSummary` | **Nunca preenchido** |
| Outros 5 conectores | **Não produzem equipamento** |
| Cadastro por formulário | **Não existe rota** |

Além disso, `customers.equipmentCount` tem default `1` e
`equipmentEstimatedValue` default `290`: hoje o sistema **presume** que todo
cliente tem um equipamento de R$290. Esse número falso já alimenta o cálculo de
prejuízo do Anti-Fraude.

## Decisões tomadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | Modelo **individual + agregado** | A linha por aparelho serve gestão e cadastro por formulário (precisa de série/modelo); o agregado em `customers` serve a consulta em rede, que por LGPD só pode ver contagem. Ambos os campos já existem — **zero mudança de schema**. |
| 2 | **Manual vence** no conflito com o sync | O dado digitado à mão existe justamente porque o ERP não o tinha. Apagá-lo destruiria informação real. |
| 3 | **Exceção:** devolução confirmada pelo ERP corrige o registro | Sem isso, um aparelho já devolvido seguiria penalizando o score de alguém. Num bureau, isso é acusação errada: atinge o consumidor e expõe o provedor. É a única escrita que o sync faz sobre linha manual, e só corrige **para menos**. |
| 4 | Ponto de extensão por ERP, com sinal de capacidade | Quem tiver cadastro de comodato ou de ativos deve ser buscado. O pipeline nasce genérico; cada ERP é um encaixe documentado, não uma reescrita. |
| 5 | Sem alteração em `shared/schema.ts` | Regra do CLAUDE.md. Todos os campos necessários já existem. |

## Arquitetura

### Fluxo do dado

```
ERP (comodato/ativos)                 Planilha CSV          Formulário
        │                                   │                    │
        └──────────► equipmentDetails[] ◄───┴────────────────────┘
                            │
                     EquipmentStorage
                     (upsert por série)
                            │
                    ┌───────┴────────┐
                    ▼                ▼
             tabela `equipment`   agregado em `customers`
             (detalhe por         (equipmentCount,
              aparelho)            equipmentEstimatedValue)
                    │                     │
                    ▼                     ▼
            tela /equipamentos      consulta em rede
            (gestão do provedor)    (mascarada por LGPD)
```

### Unidades e responsabilidades

**`EquipmentStorage`** — única porta de escrita da tabela.
- `getByProvider(providerId)` — existe
- `getByCustomer(customerId)` — existe
- `create(data)` — existe
- `update(id, providerId, data)` — novo; `providerId` no filtro é isolamento multi-tenant
- `remove(id, providerId)` — novo
- `syncFromErp(providerId, customerId, details[])` — novo; aplica as regras 2 e 3
- `countUnreturnedByCustomer(customerIds[])` — novo; uma query para N clientes, para a consulta não fazer N+1

**`erp-sync.service`** — passa a ler `equipmentDetails` do `NormalizedErpCustomer`
e chamar `syncFromErp`. Depois recalcula o agregado do cliente.

**Conector** — ganha `supportsEquipment: boolean` na metadata. IXC declara `true`;
os demais `false` até mapearem seu cadastro. `GET /api/erp-connectors` expõe.

### Regra de sync (decisões 2 e 3)

Para cada `detail` retornado pelo ERP, casando por `(providerId, serialNumber)`:

| Situação | Ação |
|---|---|
| Série não existe na base | **Insere** |
| Série existe e ERP diz "devolvido" | **Atualiza só o status para devolvido** (exceção da decisão 3) |
| Série existe e ERP diz "retido" | **Não toca** (manual vence) |
| Linha na base que o ERP não retornou | **Não toca** (pode ser cadastro manual) |

Equipamento sem número de série nunca casa, portanto nunca é tocado pelo sync —
consequência aceita da decisão 2.

### Consulta em rede

O mascaramento **não muda**: `PRESERVED_FIELDS` já libera os três campos certos.
O que muda é que eles passam a ter valor real.

- `unreturnedEquipmentCount` — deixa de ser `0` fixo
- `equipmentPendingSummary` — passa a ser preenchido, ex.: `"2 ONUs · R$ 580"`
- Detalhe do aparelho (série, MAC, modelo) **nunca** cruza provedor: não está em
  `PRESERVED_FIELDS` e não será adicionado

O provedor vê o detalhe completo apenas dos **próprios** clientes.

## Escopo desta rodada

**Entra:**
1. Persistência: `EquipmentStorage` completo + `erp-sync` gravando
2. IXC ponta a ponta (é o único que já produz dado)
3. Importação por planilha (rota existe; validar e ligar à nova persistência)
4. Cadastro/edição por formulário (rotas `POST`/`PATCH`/`DELETE` + tela)
5. Grupo "Equipamentos" na sidebar, com gestão e importação
6. Consulta exibindo equipamento retido, com o mascaramento existente
7. Correção do `GET /api/equipment` duplicado (registrado em `dashboard.routes.ts`
   e `equipamentos.routes.ts` — dois handlers no mesmo path)
8. Agregado em `customers` deixando de usar os defaults falsos

**Fica para depois:** fetch de equipamento nos outros 5 conectores. Motivo
declarado: não há credencial nem documentação do cadastro de comodato desses
ERPs; escrever isso agora seria código especulativo, chutando nomes de tabela
como o IXC faz, sem forma de testar. O ponto de extensão e a documentação do que
falta mapear entram nesta rodada para que cada um seja um encaixe.

## Erros e casos de borda

| Caso | Tratamento |
|---|---|
| ERP fora do ar durante o sync | Equipamento não é tocado; o log de sync registra. Nunca zerar o agregado por falha de rede. |
| Equipamento sem série no ERP | Insere sem série; não participa de casamento futuro. |
| Provedor sem nenhum equipamento | Estado vazio com CTA para importar ou cadastrar. |
| ERP sem suporte a comodato | Tela avisa e direciona para planilha/formulário, usando `supportsEquipment`. |
| CSV malformado | Rejeita a linha, relata quais e por quê; não aborta o lote inteiro. |
| Cliente do ERP sem match na base | Equipamento fica sem `customerId`; não entra no agregado nem na consulta. |

## Testes

- `syncFromErp`: os quatro casos da tabela de regra de sync, incluindo a exceção
  de devolução
- Isolamento multi-tenant: `update`/`remove` de outro provedor devem falhar
- `countUnreturnedByCustomer`: uma query para N clientes, sem N+1
- Mascaramento: consulta cross-provider expõe contagem e resumo, **nunca** série,
  MAC ou modelo
- Score: cliente com equipamento retido perde os 15 pontos; sem retido, ganha o
  bônus
- Agregado: após sync, `customers.equipmentCount` reflete o real e não o default

## Riscos

| Risco | Mitigação |
|---|---|
| A exceção de devolução (decisão 3) contraria "manual sempre vence" | Isolada num único ponto do `syncFromErp`, comentada. Reverter é apagar um `if`. |
| Equipamento órfão: some do ERP e fica na base | Aceito. Preferível a apagar dado que pode ser manual. A tela de gestão permite excluir à mão. |
| A consulta em rede ficar lenta com o join | Por isso o agregado denormalizado em `customers`; a consulta lê o agregado, não a tabela de equipamento. |
| Defaults falsos já contaminaram análises passadas | O agregado passa a refletir o real após o primeiro sync ou cadastro. Vale comunicar que números de prejuízo anteriores eram estimativa. |
