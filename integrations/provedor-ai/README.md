# As funcionárias do Provedor.ai no Consulta ISP

Pedido do dono (16/09/2026): os agentes do chat com *"as mesmas descrição e configurações dos agentes
do provedor.ai… atender como um humano, não como um bot"*. Spec:
`docs/superpowers/specs/2026-09-16-funcionario-digital-design.md` (§8, D1, D2, D3).

| Perfil | Persona de origem | Nome padrão (do dono) |
|---|---|---|
| `cobranca_ativos` | Clara (até D+14) + trechos da Bianca (a partir de D+15) | Clara |
| `cobranca_ex_clientes` | Sofia | Leonora |
| `recuperacao_equipamentos` | Mariana + skill `provedor-recuperacao-ativos` | Eduarda |

Os três em `openai/gpt-4.1`, temperatura 0,3, `maxTokens` 1.000.

## O que tem aqui

- `origem/` — os textos do Provedor.ai **verbatim**, um bloco por arquivo, com cabeçalho
  (`arquivo:linhas`, commit, data). O build nunca lê `F:/Provedor.ai`. Não edite abaixo do marcador
  `==== TEXTO VERBATIM ====`.
- `adaptacoes.json` — a lista de adaptações, aplicada em ordem sobre a origem. Cada item:
  `id`, `persona` (uma ou várias de `clara`/`sofia`/`mariana` — o perfil pela persona de origem),
  `origem` (o bloco), `original` (texto exato, ou `{ "de", "ate" }` para um intervalo, ambos
  inclusos), `novo` **ou** `remocao: true`, `todas` (troca todas as ocorrências — nomes e o
  placeholder do provedor) e `motivo`. `novo` pode usar `$PERSONA` e `$PROVEDOR`.
  Os ids seguem o inventário de 16/09/2026 (C-, S-, M-, E-, W-, J-, L-, R-) e os blocos portados
  (B- Bianca, A- recuperação de ativos, V- voz e estilo, O- objeções, X- recusa, D- descrições,
  N- nomes, P- provedor).
- `personas/<tipo>.md` — **gerados**: descrição e instruções exatamente como a montagem produz, com o
  provedor "Provedor Exemplo". É onde se lê e se revisa a persona; o teste falha se o arquivo não for o
  resultado do build.
- `personas/anteriores/c68c5211.json` — as personas da versão anterior (o script de c68c5211), para a volta.

A montagem é `server/services/chat/personas-provedor-ai.ts` (`montarPersona`, `montarDescricao`).
Um trecho original que não é encontrado — ou aparece mais de uma vez sem `todas` — **falha** a
montagem com o id da adaptação. Depois de montar, a persona é conferida contra o que não pode
sobrar (placeholders, nomes de outros agentes, ferramentas, JSON de saída, percentuais e motor EV,
anúncio de consequência, cobrança de reposição, lembrete e prazo prometidos).

## Comandos

```bash
npx tsx script/configurar-personas-provedor-ai.ts --gerar       # regrava personas/*.md (sem banco)
npx tsx script/configurar-personas-provedor-ai.ts --conferir    # tamanhos e limites no pior caso (sem banco)
npx vitest run server/services/chat/personas-provedor-ai.test.ts
npx tsx script/configurar-personas-provedor-ai.ts <providerId>                                # grava e provisiona
npx tsx script/configurar-personas-provedor-ai.ts <providerId> --nomes clara,sofia,mariana     # os nomes do Provedor.ai
npx tsx script/configurar-personas-provedor-ai.ts <providerId> --versao-anterior              # a volta
```

Mudou a origem ou uma adaptação: rode `--gerar`, leia o diff dos `.md` e rode o teste.
