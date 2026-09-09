# Separação operacional das carteiras de cobrança

Solicitação: cada carteira deve tratar exclusivamente seus clientes, sem navegação ou operações misturadas. Implementado localmente em 08/09/2026; equipamentos não ampliados nesta etapa.

## Problemas encontrados e corrigidos

- **Navegação cruzada:** as abas Ativos/Ex-clientes apareciam dentro das carteiras, da esteira e da régua. Substituídas por Visão geral, Esteira, Régua e DNA e Conversas da própria carteira. A troca entre carteiras permanece no menu lateral.
- **Contexto perdido nas consultas:** régua, DNA, indicador de recuperação, ficha 360 e partes do chat consultavam informações sem informar a carteira. As URLs e chaves de cache agora carregam esse contexto.
- **Carteira histórica usada como atual:** os casos guardam a carteira da abertura, mas o ERP pode cancelar ou reativar um cliente. Listas, filas, contagens, indicadores e atendimento passam a usar o status atual do cliente. Ativo/suspenso pertencem a Clientes Ativos; cancelado/inativo pertencem a Ex-Clientes. A carteira da abertura permanece preservada para o histórico e para a regra existente de encerramento do caso.
- **Acesso direto cruzado:** detalhes e operações com contexto explícito recusam cliente, caso, negociação, parcela ou conversa de outra carteira. Contexto inválido retorna 400; divergência retorna 404 antes da operação. Abertura, contato, negociação, pagamento, envio ao chat e cancelamento propagam a carteira.
- **Pré-avisos sem caso:** continuam visíveis no atendimento da carteira correta, mesmo sem caso de inadimplência. Foram incluídos testes específicos para não bloquear esse fluxo.
- **Etapas inadequadas:** Ex-Clientes não oferece pré-aviso nem aviso de suspensão. Remover o pré-aviso não antecipa a cobrança: datas anteriores ao vencimento continuam fora da régua de ex-clientes.
- **Configuração geral dentro da carteira:** os controles locais de pausa/atribuição de etapa alteravam a política do provedor inteiro. A página da carteira agora mostra a régua e seus responsáveis; alterações gerais ficam no Painel do Provedor, com link identificado como configuração do provedor.
- **Formulário mantido ao trocar cliente:** a ficha 360 é remontada ao mudar cliente ou carteira, evitando reaproveitar o estado de um formulário anterior.

## Verificação

- 1.956 testes passaram em 90 arquivos: `work/carteiras-isolamento-tests.log`.
- Build de frontend, API e worker passou: `work/carteiras-isolamento-build.log`.
- Typecheck mantém os mesmos 60 diagnósticos anteriores, sem novos: `work/carteiras-isolamento-tsc.log`.
- PostgreSQL em modo somente leitura: consultas reais de listas, filas, indicadores, recuperação, etapas/DNA e chat executadas em seis recortes de três provedores. Base com 261 ativos e 13 ex-clientes; sem casos e conversas. Assim, o ensaio real validou execução SQL e recortes de clientes; isolamento de casos/conversas e suas operações foi verificado pelos testes automatizados. Script e resultado em `work/validar-isolamento-carteiras-db.ts` e `work/carteiras-db-readonly.log`.
- Navegador: conferidos links internos das duas carteiras, régua exclusiva de cada uma e acesso a cliente ativo pela URL de ex-clientes recusado sem exibir a ficha.
- API local reiniciada; nenhuma migração, alteração de clientes ou envio de mensagem. `shared/schema.ts` preservado.

## Acesso local

- Clientes Ativos: http://127.0.0.1:5000/cobranca/ativos
- Ex-Clientes: http://127.0.0.1:5000/cobranca/ex-clientes

Os canais de comunicação e a política administrativa continuam sendo configurações do provedor; não foram duplicados em serviços independentes. Os atendimentos e operações acessados a partir de cada carteira mantêm o seu recorte exclusivo.
