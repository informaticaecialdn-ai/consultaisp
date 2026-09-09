# Revisão da cobrança — 08/09/2026

Análise do código local, histórico recente e interface em `127.0.0.1:5000`. Referência final: commit `6bdac79`. Não foram alteradas regras, configurações de agentes, registros financeiros ou integrações nesta revisão. Nenhuma mensagem foi enviada a clientes.

## Avaliação

A cobrança evoluiu para uma operação organizada: carteiras separadas, Esteira como lugar do trabalho diário, ficha do caso, negociação e atendimento dentro do sistema. A estrutura pode ser mantida. Os próximos investimentos precisam fechar o recebimento financeiro e a execução dos agentes, antes de ampliar telas ou disparos.

## O que avançou

| Área | Situação encontrada no código atual |
|---|---|
| Navegação | Conversas primeiro; Clientes Ativos e Ex-Clientes com espaços próprios; Visão geral, Esteira e Régua/DNA. Links antigos de fila e kanban redirecionam. |
| Esteira | Quadro/lista, minha fila/equipe/fila geral, filtros de atraso, próxima ação, contato vencido, abertura do caso em painel central e histórico. |
| Cliente 360 | Dívida, boletos, negociação, histórico, mensalidade com origem da evidência e identificação técnica. Economia distingue dados ausentes e estimativas. |
| Política | Configuração no Painel do Provedor, faixas por carteira e exceções de negociação. |
| Chat | Atendimento interno, conectores Zappfy/Uazapi/Datafy e entrega ao humano. |
| Agentes | Três perfis operacionais configuráveis e console de agentes, skills, conexões e execuções dentro do Painel. |
| Execução autônoma | Fila persistente, deduplicação, limite de rodadas, leitura financeira ao vivo, propostas com confirmação e interrupção ao assumir atendimento. |
| Dados ERP | Faturas individuais; baixa provável separada de recebimento confirmado em parte dos relatórios; MAC/login e cruzamento com inventário. |

## Problemas prioritários

### 1. Alta — entrada de acordo não tem confirmação própria de recebimento

**Evidência:** `shared/cobranca/politica.ts:439` desconta a entrada antes de gerar parcelas. `server/storage/cobranca.storage.ts:1321` considera o acordo cumprido quando acabam essas parcelas. A consulta em `server/storage/cobranca.storage.ts:1438` soma entradas de acordos aceitos ao indicador recuperado, usando a data de aceite.

**Exemplo:** acordo de R$ 400 com entrada de R$ 80 gera três parcelas que somam R$ 320. O aceite do cliente já pode acrescentar R$ 80 ao recuperado; a quitação das três parcelas permite concluir o acordo sem uma comprovação separada desses R$ 80. A interface diz “o cliente já aceitou”, não “entrada recebida”.

**Correção:** tratar entrada como recebível com vencimento, status, origem e confirmação, tal como as demais parcelas. Encerrar somente depois de confirmar todos os recebíveis. Somar recuperação pela data e pelo valor efetivamente recebidos.

Há outra inconsistência: `server/services/cobranca/regua-diaria.service.ts:496` encerra como `pago` quando o agregado de dívida zera. O ERP pode ter cancelado ou renegociado títulos. O módulo de faturas já reconhece essa incerteza com `baixada_no_erp`; o caso e o KPI também precisam distinguir baixa provável de dinheiro recebido.

### 2. Alta — a exigência de aprovação pode se perder entre duas gravações

**Evidência:** `server/routes/cobranca.routes.ts:1999` cria e confirma a transação da negociação; só depois, em `:2025`, registra a nota `exigeAprovacao`. O aceite por operador, em `:2081`, depende exclusivamente de encontrar essa nota.

**Impacto:** se a segunda gravação falhar, a proposta excepcional permanece salva sem o bloqueio. Uma chamada posterior de aceite pode tratá-la como proposta comum. Também existe uma janela entre o commit da proposta e a nota.

**Correção:** persistir a exigência de aprovação junto da proposta, na mesma transação, e conferir essa exigência na transação do aceite. Pode ser um campo próprio ou um evento transacional; ausência acidental da nota não pode conceder autorização. Acrescentar teste com falha deliberada na gravação da aprovação e teste de concorrência.

### 3. Alta — confirmação de identidade ainda não é uma condição do executor

**Evidência:** o prompt de abertura pede confirmação antes de expor dívida, mas `server/services/chat/chat-autonomia.service.ts:208`/`:222` não condiciona `informar_divida` e segunda via a um estado persistido de identidade confirmada. `server/services/chat/chat-autonomia-politica.ts:62` monta a resposta com o valor quando recebe a intenção. O teste existente “uma rodada” usa apenas “Olá” seguido de “quanto estou devendo?” para chegar à exposição do saldo.

**Impacto:** uma decisão do modelo pode divulgar informação financeira antes da etapa de confirmação prevista pelo próprio fluxo, especialmente se o número mudou de titular.

**Correção:** implementar etapa explícita de identificação adequada ao canal; liberar dados financeiros e documentos somente depois dela. Guardar evidência e validade dessa confirmação, independentemente da decisão do modelo.

### 4. Média — a régua e o DNA ainda não conduzem toda a conversa autônoma

**Evidência:** o pedido do planejador em `server/services/chat/chat-autonomia.service.ts:208` leva saldo, datas e faturas, mas não leva o tom efetivo, quadrante, vulnerabilidade ou etapa do caso. A mensagem final vem de `respostaControlada` em `server/services/chat/chat-autonomia-politica.ts:60`, com frases fixas. Instruções e modelo configuráveis existem, mas a personalização da resposta é limitada por esse caminho.

**Impacto:** dois clientes com perfis diferentes podem receber a mesma abordagem. O catálogo de agentes parece mais flexível do que o comportamento operacional efetivo.

**Correção:** manter valores, links e ações sob controle do servidor; acrescentar variantes de escrita por tom efetivo ou uma redação validada. Passar etapa, objetivo e tom como dados separados. O DNA deve orientar a linguagem; a régua continua decidindo o momento.

### 5. Média — o agendamento transfere pedidos normais e rejeita datas válidas

Reproduções locais, sem chamada externa:

| Entrada | Resultado atual |
|---|---|
| “Quero agendar a retirada amanhã às 14:00” | Transferência ao humano |
| “Podem retirar amanhã às 14:00?” | Transferência ao humano |
| “Quero devolver amanhã às 14:00” | Não é barrada pelo filtro inicial |
| “Pode ser 09/09 às 14:00” | Data recusada |
| “Pode ser 9/9 às 14:00” | Mesma data aceita |

**Causas:** `exigeHumano` em `server/services/chat/chat-autonomia-politica.ts:13` bloqueia indiscriminadamente “retirar/retirada”. O reconhecimento do dia em `:31` não admite zero à esquerda. A data usada na reprodução foi 09/09/2026, com relógio fixado em 08/09/2026.

**Correção:** distinguir pedido de agendamento de devolução já realizada/contestada; normalizar data civil antes da comparação. O agendamento hoje grava somente uma data local: capacidade da equipe, responsável, endereço confirmado e reserva de horário ainda precisam integrar o fluxo para prometer uma visita operacionalmente confirmada.

## Lacunas para o objetivo original

- **Pré-aviso D-7/D-3/D-1:** continua indisponível em `shared/cobranca/regua.ts:75`, embora já exista armazenamento de faturas a vencer. Falta conectar a régua preventiva aos títulos e deduplicar por fatura e dia de contato.
- **DNA histórico:** o cálculo diário ainda passa `historicoInsuficiente: true` (`regua-diaria.service.ts:211`). A classificação usa atraso atual e tempo de contrato. Ainda não corresponde ao comportamento histórico completo de pagamento. Não transformar desaparecimento de boleto em pagamento pontual.
- **OLT:** há normalização e cruzamento de identificadores, mas a própria ficha informa “OLT: sem leitura integrada” (`IdentificacaoTecnica.tsx:273`). MAC do ERP e coincidência no inventário não confirmam, sozinhos, qual aparelho está atualmente na residência.
- **Negociação autônoma:** o executor permite promessa integral e encaminha desconto/parcelamento ao humano. A política por carteira já existe para o operador, mas ainda precisa fornecer ofertas calculadas ao agente, se esse nível de autonomia for desejado.
- **Configuração:** o console geral fica na aba Agentes de IA, enquanto os três perfis operacionais ficam na aba Chat. Há motivo técnico para a proteção desses perfis, mas convém ter uma entrada única que mostre o vínculo com a carteira, permissões, canal, modelo e estado de ativação.

## Ambiente local e validação

- **1.704 testes passaram, em 72 arquivos**, cobrindo cobrança, chat, agentes, contratos compartilhados e componentes relacionados. Log: `work/analise-cobranca-20260908-tests.log`.
- O TypeScript geral continua com **60 diagnósticos**. A comparação dos erros, sem números de linha, com `work/tsc-whatsapp-final.log` não encontrou diferença. Log atual: `work/analise-cobranca-20260908-tsc.log`. Isso não equivale a uma compilação inteiramente limpa.
- No navegador foram conferidos menu, Esteira e Painel → Agentes de IA. A base local da conta examinada mostrou a Esteira vazia; portanto, não houve validação visual de negociação com casos reais.
- A API local na porta 5000 ainda era o processo iniciado em **06/09/2026 às 11:22:09**, sem modo watch. A interface carregou os arquivos atuais, mas o backend permaneceu anterior às mudanças.
- Confirmado: `GET /api/chat-bullq/console/resumo` retornou **200 text/html**, causando “Unexpected token '<' … is not valid JSON” no console novo. A rota antiga de integração retornou corretamente 401 JSON sem sessão. É necessário alinhar o processo da API, as migrações e o fork para homologar a versão atual; esta revisão não reiniciou serviços nem aplicou migrações.
- Não foram testados envios reais pelos gateways, respostas de modelo com credencial real ou reservas no ERP. As conclusões de comportamento financeiro e de aprovação vêm da inspeção das transações, não de movimentação de dados de clientes.

## Ordem recomendada

1. Corrigir recebimento da entrada, encerramento e indicadores; tornar aprovação transacional.
2. Exigir confirmação de identidade no executor; corrigir reconhecimento de retirada e datas.
3. Alinhar o ambiente local ao código e validar jornadas com clientes sintéticos, inclusive falhas de ERP, retomada humana e envios ambíguos.
4. Completar pré-aviso por fatura e histórico de pagamento para o DNA.
5. Aplicar o tom efetivo nas respostas e integrar agenda/OLT à recuperação física.

A base da operação melhorou. A prioridade agora é fazer cada número representar um fato confirmado e cada ação do agente avançar a mesma Esteira que o atendente utiliza.
