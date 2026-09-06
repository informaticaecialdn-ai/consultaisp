# Chat integrado · Zappfy, Uazapi e Datafy

O Consulta ISP usa o ChatBullQ para o histórico, transporte e recebimento das
conversas de Cobrança e Equipamentos. Cada provedor tem organização própria e
escolhe um canal principal; as três integrações são opções de transporte.

## Configuração no Painel do Provedor → Chat

| Serviço | Credenciais | Conexão | Primeiro contato |
|---|---|---|---|
| Zappfy | Token da instância | QR ou código de pareamento | Texto preparado pelo agente |
| Uazapi | URL HTTPS da instância e token | QR ou código de pareamento | Texto preparado pelo agente |
| Datafy | Token, ID do número e segredo de assinatura `whsec_` | Número conectado no painel Datafy | Template aprovado escolhido por operação |

1. Salve o canal e confira o resultado do teste. Na Zappfy/Uazapi, gere o QR caso
   o número ainda não esteja pareado; depois clique em **Verificar conexão**.
2. Para texto livre, escolha um modelo disponível, salve e provisione os agentes
   de ativos, ex-clientes e equipamentos. **Testar sem enviar** usa cliente fictício.
   Na Datafy, associe os templates aprovados às operações e suas variáveis.
3. Defina as carteiras, dias e limite diário em **Primeiros contatos automáticos**.
   A régua define o momento; o DNA orienta o tom. A primeira resposta vai para a
   fila humana, preservando o contexto no chat integrado.

Os templates de abertura suportam corpo de texto com parâmetros posicionais para
nome do cliente/provedor, cabeçalho de texto e botões estáticos. Mídia de cabeçalho
e parâmetros dinâmicos em botões exigem outro fluxo e não aparecem como templates
compatíveis. A aprovação e a quantidade de parâmetros são verificadas novamente
antes do envio. Na Datafy, texto livre depende da janela de atendimento do canal.

## Instalação do ChatBullQ

Para iniciar os serviços locais, consulte [o ambiente local](local/README.md).
Com o ChatBullQ ativo, execute `integrations/chat-bullq/start-consultaisp-local.ps1`
na raiz do Consulta ISP. O script mantém a régua automática desligada e conecta
as APIs sem alterar o `.env` principal nem mostrar a chave de plataforma.

Base: [jpasv/chat-bullq-api](https://github.com/jpasv/chat-bullq-api), commit
`10c14f858d500660302e32a07ba60419f885dd27`.

Aplicar os patches na ordem em uma cópia desse commit, instalar dependências,
gerar Prisma Client e compilar. O diretório `work/references` é apenas o checkout
local; os artefatos permanentes estão nesta pasta.

- `patches/000-ponte-consultaisp.patch`: organizações, autenticação da ponte,
  retorno assinado e abertura da conversa com IA pausada.
- `patches/001-whatsapp-providers.patch`: conectores Zappfy/Uazapi/Datafy,
  conexão da instância, templates e recebimento de mensagens.
- `patches/002-agentes-primeiro-contato.patch`: catálogo de modelos e preparação
  isolada de primeiro contato, sem ferramentas nem envios durante o teste.
- `patches/003-autonomous-plan.patch`: `POST /ai-agents/:id/autonomous-plan`, o
  endpoint que `planejarAutonomia` (`server/services/chat/chat-bullq.client.ts`)
  chama. O LLM devolve só intenção e índice (`acao`, `resposta`, `data`, `valor`,
  `faturaId`), validados byte a byte no fork; texto, valor e data finais quem
  decide é o motor do Consulta ISP (`chat-autonomia.service.ts`). Sem tools, sem
  envio, sem fallback de modelo, erros do provedor sanitizados
  (`privacySafeErrors`), 20 planejamentos por minuto por organização e
  deduplicação por `requestId`. Exige agente com a capability
  `autonomia_cobranca_controlada`, `isActive=false` e `canRespondDirectly=false`.

### Ordem de aplicação

Os patches são incrementais: cada um foi gerado sobre o estado deixado pelo
anterior e as linhas de contexto dependem disso. A ordem é obrigatória:

```
000-ponte-consultaisp → 001-whatsapp-providers → 002-agentes-primeiro-contato → 003-autonomous-plan
```

Conferência sem banco nem rede, numa cópia limpa do commit base (fora do repo):

```sh
git -c core.autocrlf=false archive 10c14f858d500660302e32a07ba60419f885dd27 src | tar -x -C <copia>
cd <copia>
for p in 000-ponte-consultaisp 001-whatsapp-providers 002-agentes-primeiro-contato 003-autonomous-plan; do
  git apply --check <consulta-isp>/integrations/chat-bullq/patches/$p.patch && git apply <consulta-isp>/integrations/chat-bullq/patches/$p.patch
done
```

Os patches são LF; o checkout do fork no Windows sai CRLF (`core.autocrlf=true`),
por isso a cópia é extraída com `core.autocrlf=false`. Os arquivos que cada patch
adiciona também são executados pelo vitest do Consulta ISP, sem o repositório do
fork: `server/services/chat/chat-bullq-whatsapp.patch.test.ts` (001),
`chat-bullq-draft.patch.test.ts` (002) e `chat-bullq-autonomous-plan.patch.test.ts`
(003).

### A linhagem da VPS é outra

O que roda hoje em `chat-api.consultaisp.com.br` veio de uma sequência própria
("patch 4" da VPS: prompt sem a Bravy, `call_webhook`, transferência completa,
modelos por variável de ambiente). Essa linhagem NÃO é a série 000→003 desta
pasta, e nada aqui afirma que o 003 está aplicado lá. Levar a série para a VPS é
trabalho de deploy, decidido e feito à parte, depois de conferir o `git apply
--check` de cada patch contra o estado real daquele checkout.

Consulte [a configuração da ponte](PONTE-CONSULTAISP.md) e
[a configuração dos agentes](AGENTES-PRIMEIRO-CONTATO.md), além dos
[contratos e webhooks dos três serviços](WHATSAPP-PROVIDERS.md).

O Consulta ISP precisa de `CHAT_BULLQ_URL` e `CHAT_BULLQ_PLATFORM_KEY`; o ChatBullQ
usa o mesmo segredo em `PLATFORM_API_KEY`. A IA usa `SAKANA_API_KEY` e o catálogo
de modelos do serviço configurado. Credenciais de canais são inseridas no painel
e não são devolvidas pela API de estado do Consulta ISP.

Se a URL interna do serviço for diferente da pública, configure
`CHAT_BULLQ_PUBLIC_URL` no Consulta ISP para o painel mostrar o webhook Datafy.

Para receber mensagens externas, publique o webhook do ChatBullQ em HTTPS. O
retorno ChatBullQ → Consulta ISP também precisa da URL HTTPS configurada nos dois
serviços. Endereços `127.0.0.1` permitem revisar e configurar o sistema local,
mas não são alcançáveis pelos gateways de WhatsApp.

## Referências dos transportes

- [Zappfy](https://docs.zappfy.io)
- [Uazapi](https://docs.uazapi.com/openapi-bundled.json)
- [Datafy](https://app.datafyapi.com.br/docs)

A documentação Datafy indicada pelo usuário descreve a API oficial. Ela é
mantida como opção distinta das duas integrações de instância/QR.
