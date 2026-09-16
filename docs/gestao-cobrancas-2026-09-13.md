# Gestão de cobranças — entrega local

## Operação

O menu Esteira passou a Gestão de cobranças. As URLs existentes continuam válidas. O quadro apresenta A iniciar, Aguardando resposta, Em atendimento, Aguardando pagamento, Acordo em acompanhamento e Regularizados. As fases adicionais são projeções dos eventos reais, sem inventar respostas por arrastar cards. Casos encerrados por outros motivos ficam em Outras situações.

Filtros: ações até hoje, contato vencido, sem próxima ação, sem responsável e promessa vencida. Totais financeiros das colunas vêm do servidor, mesmo quando há paginação. Saídas do quadro não são chamadas de pagamentos; baixas no ERP sem confirmação permanecem identificadas como prováveis.

## Configuração por provedor

Painel do Provedor → Políticas de cobrança → Canais e avisos de faturas.

- SMS: Twilio, conta/token/remetente. E-mail: Resend, chave/remetente e caixa de resposta. Credenciais cifradas e não devolvidas pela API.
- Avisos: desligados por padrão; dias de 0 a 30 antes do vencimento, canal e limite diário. A configuração é independente da existência de uma organização WhatsApp.
- Link opcional por SMS/e-mail: só segue se o ERP confirmar a mesma fatura, cliente, origem, vencimento e valor e retornar HTTPS válido. Falta de instrumento não gera link inventado.
- WhatsApp mantém sua confirmação de identidade e o fluxo existente de segunda via no atendimento.
- Cobrança SMS/e-mail: carteira, canal, limite diário e intervalo mínimo. A régua continua impondo os casos de revisão humana.
- Simulação: somente leitura, com motivos de exclusão e sinalização da fonte sincronizada. Não grava contatos e não aciona gateway.

O Diário de comunicação registra aceitação pelo fornecedor, falha, situação incerta ou descarte. Ações do atendente permitem pausar por resposta/pagamento informado, desativar contato automático e retomar. Pagamento informado pausa por 48 horas; nenhuma fatura ou acordo é baixado por essa declaração. O diário acompanha a carteira selecionada.

## Integridade

Migrações aditivas 0039 e 0040. Schema das novas tabelas em shared/schema-comunicacao.ts; shared/schema.ts não foi editado. Backup local em work/backups/2026-09-13-gestao/database.dump, SHA256 6209357D0E4A7D2C8377D7444D6BAF2C08B38137FF12BB4BEC4EDD21CB8EF3EF. Restaurado em banco separado consultaisp_gestao_restore_20260913, onde as duas migrações foram ensaiadas antes do banco principal.

Reservas únicas por provedor/pessoa/dia, trava compartilhada com WhatsApp, rechecagem de pagamento/contrato/pausa/configuração antes do gateway. Envio incerto não é repetido automaticamente. Eventos e último contato são gravados na mesma transação do resultado. A API de preferência não altera registros financeiros.

## Validação e operação

1.799 testes em 88 arquivos passaram no conjunto integrado de cobrança, chat, storage, rotas e interface. Build da aplicação e dos workers passou. Simulação sobre 271 clientes locais executada sem envio, com canais desativados e sem configuração de destinatários válidos para e-mail.

Typecheck global mantém 57 erros anteriores em outros módulos; nenhum diagnóstico nos arquivos novos de comunicação, avisos ou Kanban. Não há script de lint no package.json; git diff --check passou. Esta entrega local não representa validação de produção ou de mensagens entregues por fornecedores externos.

Motor local continua em ensaio (`npm run chat:ensaio`). Envio real exige credenciais válidas, configuração habilitada e worker em modo envio (`npm run chat:worker`). Não executar simultaneamente o worker dedicado e o worker geral para a mesma responsabilidade.

Limites explícitos: não houve envio real; credenciais e remetentes devem ser configurados pelo provedor. Respostas de e-mail vão para a caixa configurada; respostas e recibos de entrega SMS não entram automaticamente no chat. Aceitação pelo gateway não significa entrega. Prévia limita avaliação a 10.000 clientes e informa amostra; envio usa lotes para controlar ritmo. Não há inferência de pagamento sem evidência financeira, nem demonstração com dados fictícios inseridos na carteira.
