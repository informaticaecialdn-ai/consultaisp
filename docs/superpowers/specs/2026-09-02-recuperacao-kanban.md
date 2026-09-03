# CRM de recuperação de equipamentos — kanban por idade

**Data:** 2026-09-02
**Status:** implementado em 2026-09-02 (rota `GET /api/equipment/recovery-board`, tela `/recuperacao`)

## Pedido

> criar sistema de recuperação de equipamentos, crie um crm, kanban, com os
> equipamentos por data: até 30 dias, 31–60 dias, até 90 dias e mais de 90
> dias, com cards que possam ser movidos. Cada card do equipamento tem os
> dados do equipamento, valores, cliente etc.

## O que já existe (não reescrever)

- `equipment` (patrimônio: tipo, marca, modelo, série, MAC, patrimônio, valor,
  status) e `equipment_recovery_cases` (caso de recuperação por equipamento:
  status, prioridade, `terminationDate`, `deadlineAt` = rescisão + 60 dias,
  agendamento, responsável, notificação, contestação, `closedAt`) com eventos
  e tentativas (`equipment_recovery_events`). Regras em
  `server/services/equipment-recovery-rules.ts`; rotas em
  `server/routes/equipamentos.routes.ts`; storage em
  `server/storage/equipment.storage.ts`; tela em
  `client/src/pages/operacional/equipamentos.tsx` (abas Patrimônio e
  Recuperação, lista + diálogo de detalhes).
- Estados do caso: `pre_recuperacao`, `aguardando_agendamento`, `agendado`,
  `nova_tentativa`, `devolucao_em_loja`, `notificacao_formal`, `contestado`,
  `concluido`, `baixado_economico`, `prazo_expirado`. Caso encerrado não volta.

**Nenhuma tabela nova e nenhuma coluna nova.** O kanban é uma leitura e uma
forma de mover o que já existe.

## A idade vem da rescisão

A coluna de um card é calculada no servidor a partir de `terminationDate` do
caso aberto (dias corridos até hoje). Não há como "arrastar" um equipamento
para outra idade: a idade é fato, não etapa. Equipamento com retirada
pendente e **sem caso aberto** não tem data de rescisão, então não tem idade —
fica na coluna "sem data", e abrir o caso (informando a rescisão) é o que o
leva para a idade certa. Nunca inventar idade a partir de `createdAt`.

## Colunas

| chave | rótulo | conteúdo |
|---|---|---|
| `sem_data` | Sem data de rescisão | `equipment` com status `retirada_pendente` ou `nao_localizado` (ou `inRecoveryProcess`) sem caso aberto |
| `ate30` | Até 30 dias | caso aberto, 0–30 dias desde a rescisão |
| `31a60` | 31 a 60 dias | caso aberto, 31–60 dias |
| `61a90` | 61 a 90 dias | caso aberto, 61–90 dias |
| `mais90` | Mais de 90 dias | caso aberto, > 90 dias |
| `recuperado` | Recuperados | caso `concluido` com `closedAt` nos últimos 90 dias |
| `baixado` | Baixados | caso `baixado_economico` ou `prazo_expirado`, `closedAt` nos últimos 90 dias |

"Caso aberto" = status fora de {`concluido`, `baixado_economico`,
`prazo_expirado`}. `contestado` continua aberto (fica na idade, com selo).

Ordem dentro da coluna de idade: prioridade (`critica` > `alta` > `normal` >
`baixa`), depois menos dias restantes de prazo, depois maior valor.

## Movimentos permitidos (arrastar e soltar)

| de → para | efeito |
|---|---|
| idade → `recuperado` | `PATCH /api/equipment/recovery-cases/:id` `{ status: "concluido" }` |
| idade → `baixado` | `PATCH … { status: "baixado_economico" }` (confirmação com motivo opcional em `notes`) |
| `sem_data` → qualquer idade | abre o diálogo "Abrir caso" com a rescisão a preencher (a idade real vem do servidor depois) |
| idade → idade | recusado com aviso: "a idade vem da data de rescisão" |
| `recuperado`/`baixado` → qualquer | recusado: caso encerrado não volta (regra existente) |

Mudanças que não são de coluna ficam no próprio card: prioridade (select),
etapa do caso (select entre os status abertos), agendar, registrar contato,
detalhes.

## Contrato da API

`GET /api/equipment/recovery-board` (requireAuth, por `providerId` da sessão)

```ts
type ColunaKanban = "sem_data" | "ate30" | "31a60" | "61a90" | "mais90" | "recuperado" | "baixado";

interface CardKanban {
  chave: string;               // "caso:123" ou "equip:45"
  coluna: ColunaKanban;
  caseId: number | null;       // null só em sem_data
  equipamento: {
    id: number; tipo: string; marca: string | null; modelo: string | null;
    serie: string | null; mac: string | null; patrimonio: string | null;
    valor: number | null;      // reais
    status: string;
  };
  cliente: {
    id: number; nome: string; documento: string;      // formatado 000.000.000-00
    telefone: string | null; whatsapp: string | null;  // só dígitos com 55, para wa.me
    endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null;
    situacao: string;          // customers.status
    dividaEmAberto: number;    // customers.totalOverdueAmount
    diasEmAtraso: number;      // customers.maxDaysOverdue
  };
  caso: null | {
    status: string; prioridade: string;
    rescisaoEm: string;        // ISO
    prazoAt: string;           // ISO (rescisão + 60 d)
    diasRetido: number;        // hoje - rescisão
    diasRestantes: number;     // prazo - hoje (negativo = vencido)
    agendadoEm: string | null; metodo: string | null;
    responsavel: { id: number; nome: string } | null;
    notificadoEm: string | null; bureauStatus: string; contestadoEm: string | null;
    encerradoEm: string | null; notas: string | null;
    tentativas: { total: number; ultima: { canal: string | null; resultado: string | null; em: string } | null };
  };
}

interface BoardKanban {
  geradoEm: string;
  colunas: Array<{ chave: ColunaKanban; rotulo: string; cards: number; valor: number }>;
  cards: CardKanban[];
  kpis: {
    retidos: number;           // cards em sem_data + idades
    valorEmRisco: number;      // soma dos valores dos retidos
    prazoCritico: number;      // casos abertos com diasRestantes <= 10
    recuperados30d: number;    // concluídos nos últimos 30 dias
    valorRecuperado30d: number;
  };
  responsaveis: Array<{ id: number; nome: string }>;   // usuários do provedor, para o filtro e o select
}
```

Tudo é do próprio provedor: nome, documento e telefone do cliente saem
inteiros (é a carteira dele, não a rede). Nada de outro tenant.

## Tela

Rota `/recuperacao` (sidebar, grupo Equipamentos: "Recuperação"), e um atalho
"Ver kanban" na aba Recuperação de `/equipamentos`.

- Cabeçalho: título, KPIs (retidos, valor em risco, prazo crítico,
  recuperados 30 d), filtros (busca por cliente/série/patrimônio, prioridade,
  responsável, cidade) e botão "Novo caso" (abre o mesmo fluxo de abrir caso).
- Kanban horizontal com rolagem, uma coluna por chave, cabeçalho com contagem
  e valor somado; `sem_data` à esquerda, encerradas à direita, visualmente
  separadas (fundo `--surface-2`).
- Card (denso, `--surface`, hairline, raio 8): linha 1 tipo · marca modelo ·
  valor (mono, à direita); linha 2 série / MAC / patrimônio (mono, 11 px);
  bloco cliente: nome, documento, telefone com ícone WhatsApp (link
  `https://wa.me/<whatsapp>`), endereço curto (bairro · cidade); bloco caso:
  selo de etapa, prioridade (select inline), dias retido em mono grande com
  cor por faixa (`--ok` ≤ 30, `--gated` 31–60, `--past` 61–90, `--danger` >
  90), prazo regulatório ("vence em N dias" / "vencido há N dias"),
  responsável, agendamento, última tentativa (canal · resultado · data),
  selos: contestado, sinal validado no bureau. Ações: Registrar contato,
  Agendar, Detalhes (drawer com linha do tempo de eventos, campos editáveis e
  notas). Cards de `sem_data`: botão "Abrir caso".
- Arrastar com `@dnd-kit/core` (já instalado: core, sortable, utilities):
  `DndContext` + `useDraggable` (card) + `useDroppable` (coluna); overlay
  durante o arrasto; teclado suportado pelo dnd-kit; toque OK.
- Estado vazio por coluna ("nenhum equipamento nesta faixa") e geral (sem
  equipamento retido: explicar que a fila nasce do patrimônio + rescisão).
- Skeleton acima de 300 ms; toasts em português; tokens do DESIGN_SYSTEM
  (mono em todo número, tabular-nums, nada de rounded-full em badge, nada de
  paleta Tailwind).

## Testes

- Serviço puro de montagem do board (`server/services/recovery-board.service.ts`):
  classificação por idade (limites 30/60/90 inclusivos), `sem_data`, encerrados
  só nos últimos 90 dias, ordenação, KPIs, cálculo de dias sem fuso (data civil).
- Rota: 401 sem sessão; isolamento por providerId (caso de outro provedor não
  aparece).
- Regras de movimento (função pura no cliente, testável em `client/**/*.test.ts`
  ou `shared/`): tabela de movimentos permitidos/recusados acima.
