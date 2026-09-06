# Zappfy, Uazapi, Datafy, agentes e menus por carteira

Pedido autorizado: Conversas primeiro em Cobrança, dois menus próprios de carteira,
WhatsApp configurável no Painel do Provedor e agentes reais para os primeiros contatos.
Pedido mais recente: implementar as três opções Zappfy, Uazapi e Datafy.
Zappfy/Uazapi usam instância não oficial; Datafy usa seu contrato oficial publicado.

## Arquitetura

- Menus separados preservam carteira em Visão geral, Fila, Kanban e Régua/DNA.
- Zappfy usa a URL publicada; Uazapi permite URL HTTPS da instância conforme
  seu contrato. Datafy usa seu domínio fixo, token e assinatura de webhook.
- O ChatBullQ continua responsável pelo histórico, entrega e recebimento. Patches
  versionados complementam a conexão da instância e a preparação pelos agentes.
- O agente prepara o primeiro contato conforme o contexto e o tom DNA.
  A primeira resposta permanece encaminhada ao humano.
- Datafy inicia por template aprovado configurado por operação e revalidado.
- Três perfis de agentes: ativos, ex-clientes e equipamentos, com instruções de régua
  e DNA, modelo validado e configuração recuperável após falhas de provisionamento.
- Sem alterações em shared/schema.ts. Reaproveitar a integração e o JSONB existentes.
  Teste remoto não envia mensagem. Credenciais não são devolvidas.

## Etapas

- [x] Menus e testes de navegação por carteira.
- [x] Três conectores, endpoints administrativos e testes.
- [x] Patch do ChatBullQ para status, pareamento, templates e webhooks.
- [x] Catálogo/provisionamento de agentes e geração real de rascunho sem ferramentas.
- [x] Painel de configuração, conexão e estado dos agentes.
- [x] Testes, build e revisão visual no sistema real.

Homologação com número e IA reais depende das credenciais do usuário e de
webhook público HTTPS. Nenhuma mensagem externa foi enviada nos testes.

## Referência

Referência Datafy: https://app.datafyapi.com.br/api/openapi.json.
Zappfy: https://docs.zappfy.io. Uazapi: https://docs.uazapi.com/openapi-bundled.json.
ChatBullQ API: commit 10c14f858d500660302e32a07ba60419f885dd27.
Os patches estão em integrations/chat-bullq/patches, aplicáveis ao fork;
nenhuma capacidade remota ausente será anunciada como ativa.
