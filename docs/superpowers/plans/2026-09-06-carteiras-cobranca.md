# Separação das carteiras de cobrança

**Objetivo:** manter clientes ativos e ex-clientes separados na carteira, indicadores, fila, Kanban e navegação de retorno.

**Autorização:** pedido do dono nesta tarefa, seguido de “executar”. Implementação no checkout indicado, sem alterações de schema, pagamentos ou regras de negociação.

**Arquitetura:** aproveitar as rotas existentes de ativos/ex-clientes. Propagar `carteira` nas consultas e links da operação; filtrar os indicadores no armazenamento por provedor e carteira. Os contatos e recebimentos ficam associados à carteira do caso de origem. A situação atual no ERP continua definindo ativos/suspensos versus ex-clientes.

**Stack:** React, Wouter, TanStack Query, Express, Drizzle, PostgreSQL, Vitest. Interface conforme DESIGN_SYSTEM.md v5.

- [x] Provar regressões: indicadores e fila sem recorte, navegação que perde a carteira.
- [x] Aplicar o recorte aos indicadores, bairros e fila, preservando o isolamento por provedor.
- [x] Manter a carteira escolhida na navegação, no Kanban, na fila e na ficha; melhorar a identificação das duas áreas.
- [x] Executar testes afetados, verificar tipos/build e revisar apresentação com dados fictícios.

**Critérios de aceite:** a carteira de ativos não mostra totais de ex-clientes; a de ex-clientes não mostra a faixa mensal de ativos; limpar filtros não troca a carteira; fila e Kanban mantêm o recorte; voltar da ficha preserva o contexto; links antigos continuam utilizáveis. Não alterar status de clientes para obter separação visual.

## Validação executada

- Vitest 4.1.2: 632 testes aprovados em 23 arquivos, cobrindo cobrança no cliente, rotas, armazenamento, navegação e regras compartilhadas. As novas regressões foram observadas falhando antes da implementação.
- Build do frontend com Vite 7.3.0: concluído. Permanecem avisos de tamanho de bundles e da ferramenta de CSS.
- TypeScript (`tsc --noEmit --incremental false`): 60 erros em arquivos fora desta alteração; nenhum diagnóstico nos arquivos modificados. Exemplos: propriedades de ícones no painel do provedor, propriedade onNavigate na landing page, parâmetros de rotas e campos antigos do seed. A checagem geral do repositório continua pendente.
- Navegador: interface real com API sintética local, sem banco ou ERP. Conferidos ativos → ex-clientes → fila → Kanban → ficha; alternância e botão Voltar; link antigo com busca e filtro mensal; limpeza dos filtros; carteira escolhida na régua e no menu. Fila com 145 casos e uma linha carregada exibiu os totais do servidor.
- Apresentação conferida em 1280×720 e 390×844; sem erros de console após a correção da fixture de alertas.
- Isolamento por providerId preservado nas consultas e subconsultas. Sem migrations ou alteração de dados operacionais. Sem publicação.

A classificação de contratos continua a já existente: ativos e suspensos são clientes atuais; cancelados e inativos são ex-clientes. O histórico financeiro permanece ligado à carteira registrada no caso. A rotina existente de cancelamento e abertura de casos não foi modificada.
