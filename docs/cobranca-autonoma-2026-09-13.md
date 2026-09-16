# Revisão da cobrança, DNA e atendimento

O código local foi atualizado de `4b5adc8` para `3754bea`, da branch de implantação `origin/feat/localizacao`, antes desta revisão. Alterações locais foram preservadas; não houve push ou implantação remota. O backup PostgreSQL está em `work/backups/2026-09-13-github-sync/database.dump` e a cópia Git anterior permanece no stash da sincronização.

## Carteiras e abordagens

- Ativos e suspensos seguem regularização do contrato vigente. Pré-aviso depende de fatura a vencer identificada.
- Ex-clientes seguem conferência do débito, negociação, conciliação de pendências, quitação de dívida antiga e recuperação prolongada. Não recebem boas-vindas, retenção ou aviso de suspensão.
- Os códigos técnicos das etapas foram preservados para manter configurações existentes. As ações e os textos de ex-clientes são próprios.
- O DNA dos ativos considera a relação atual. O DNA dos ex-clientes usa duração da relação encerrada e pagamentos confirmados daquele período. A idade da dívida decide a etapa, não reescreve o histórico de pagamento.
- A data de encerramento é aceita atualmente quando o conector IXC confirma o cancelamento. Sem essa evidência ou histórico suficiente, ex-clientes ficam **sem DNA**, com abordagem cordial de recuperação. Não inferimos encerramento de suspensão, data de sincronização ou última fatura.
- Vulnerabilidade continua prevalecendo e encaminha a atendimento humano. Negativação, baixa e divergências não são ações autônomas.

O job diário recalcula os snapshots; para atualizar apenas o DNA sem executar outras ações financeiras:

```powershell
npx tsx script/recalcular-dna.ts --provider 1
npx tsx script/recalcular-dna.ts --provider 1 --aplicar
```

O primeiro comando é só uma prévia. Use o ID do provedor correto e confira as contagens antes de aplicar. O script não inicia contatos, não sincroniza ERP e não encerra casos.

## Caminho operacional

1. Configure Zappfy, Uazapi ou Datafy em **Painel do Provedor → WhatsApp e chat**. Em Datafy, associe os templates de abertura aprovados por operação.
2. Confira **Agentes de IA → Operação de cobrança**: processo, conexão WhatsApp, credencial de IA, casos elegíveis de cada carteira e motivos de bloqueio.
3. Configure e provisione os perfis de ativos, ex-clientes e equipamentos. Descrição, preferências e contexto personalizados são preservados nas atualizações parciais.
4. Defina carteiras, limites diários, calendário e primeiro contato automático. Ele respeita a política e a próxima data de contato.
5. Escolha se a primeira resposta vai ao humano ou se o assistente continua. Habilite individualmente segunda via, promessa, negociação e agendamento.
6. Acompanhe conversas e diário de envios. Processo ativo e caso elegível não significam entrega confirmada.

A abertura é neutra. Antes de revelar relação contratual, dívida ou equipamento, o fluxo autônomo confirma identidade. Após a confirmação, a carteira atual deve ser verificada no ERP; divergência entre caso e ERP interrompe a cobrança. Valores e boletos vêm da leitura financeira confirmada, não do modelo. O LLM escolhe entre ações autorizadas; o servidor valida datas, valores, confirmação e textos.

Ex-clientes também podem negociar dívidas antigas após D+360 dentro dos limites configurados. Isso não autoriza ameaças, negativação ou baixa. Pedido de humano, contestação, pagamento informado, identificação insuficiente, tomada pelo atendente e falha ambígua de envio interrompem a autonomia.

## Processo do chat

O worker completo (`server/worker.ts`) continua executando a régua e o atendimento. Há também uma entrada dedicada para instalações que precisam executar somente o chat:

```powershell
npm run chat:ensaio
npm run chat:worker
```

`chat:ensaio` só lê filas e sinaliza presença. `chat:worker` habilita a execução real de primeiro contato e das respostas, mas continua exigindo as configurações habilitadas pelo administrador. Para o bundle de produção: `node dist/chat-worker.cjs --enviar`. Configure o ambiente da instalação com as mesmas conexões e segredos da API; o processo dedicado não substitui a sincronização do ERP nem a régua diária.

A presença usa conexão PostgreSQL dedicada, sem nova tabela ou dado de cliente. O painel informa atividade recente do processo, não promete entrega. A prévia lê até 10 mil casos pendentes por provedor e informa se atingiu esse teto. Paginação por ID impede que os primeiros cem casos em revisão escondam os elegíveis seguintes.

## Ambiente local verificado

- Consulta ISP: `http://127.0.0.1:5000`.
- ChatBullQ: `http://127.0.0.1:3002`, com PostgreSQL e Redis locais.
- Técnico PWA independente: `http://127.0.0.1:5001` (instruções de domínio em `technician/README.md`).
- Motor dedicado iniciado em **ensaio**, sem mensagens reais.

O provedor local ainda precisa conectar um número de WhatsApp, configurar credencial de IA no serviço ChatBullQ e disponibilizar webhook HTTPS público para receber eventos externos. Não foi conectado número real nem testada cobrança contra cliente real. A base local é própria; atualizar o código do GitHub não copia o banco de produção.

A preparação da régua no provedor local gerou 42 casos a partir dos clientes existentes: 31 ativos/suspensos e 11 ex-clientes. Não houve encerramento, alteração de saldo ou envio. A prévia identificou 40 telefones ausentes/inválidos e 2 casos elegíveis pela régua; os impedimentos de canal, agente, calendário e modo de ensaio permanecem visíveis. Esses números descrevem a base local, não a produção.

Validação integrada: 1.183 testes passaram em 66 arquivos. Após os últimos ajustes de abertura e tomada humana, a suíte de chat passou 600 testes em 31 arquivos. Build da aplicação, workers e PWA concluído. O typecheck global ainda apresenta 57 erros em rotas legadas/seed fora desta revisão; nenhum foi apontado nos módulos alterados de cobrança, chat e aplicativo técnico.

Para iniciar os serviços locais, siga `integrations/chat-bullq/local/README.md`. O comando `integrations/chat-bullq/start-chat-worker-local.ps1` sempre inicia ensaio, inclusive se a configuração do provedor estiver ligada.
