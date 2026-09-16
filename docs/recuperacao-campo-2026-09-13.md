# Recuperação de equipamentos e app de campo

## Arquitetura implementada

A gestão fica em `/recuperacao/operacao`, acessível pelo kanban de recuperação. O técnico usa a aplicação independente em `technician/`, com HTML, build e implantação próprios. Compartilha a API autenticada e o contrato de dados, sem carregar a navegação do Consulta ISP.

O gestor seleciona casos, informa responsável e saída, confere a sequência por proximidade e distribui a rota. O app mostra somente as atividades atribuídas ao usuário conectado, com atualização a cada 30 segundos. Inclui cliente, endereço, telefone, aparelho, série/MAC/patrimônio, agenda e histórico privado das visitas.

Cada visita registra resultado, relato, até três fotos, data, responsável e coordenadas com precisão ou motivo da indisponibilidade do GPS. A ausência do cliente, endereço incorreto, acesso impedido, recusa e pedido de reagendamento voltam para nova tentativa com próxima ação. Recolhimento exige identificador correspondente ao aparelho e encaminha o ativo para triagem.

## Integridade e acesso

- Escopo de provedor vem da sessão. Usuário comum só acessa os casos atribuídos a ele; distribuição é de administrador.
- Fotografias são entregues por endpoint privado e não entram em cache do PWA nem na listagem geral de eventos.
- A visita e a mudança do caso/equipamento são gravadas na mesma transação, com bloqueio de linha, conferência de versão e chave de reenvio para evitar duplicações.
- Um evento `visita_campo` aparece no acompanhamento operacional e não é usado como tentativa elegível para publicação automática no bureau.
- Os eventos existentes guardam as evidências em JSONB. Não foi adicionada migração para esta funcionalidade. O backup do PostgreSQL inclui as fotografias.

## Limites que ainda precisam de evolução

1. A sequência usa distância em linha reta; não é otimização por ruas, trânsito, horários de clientes ou capacidade diária.
2. O formulário suporta nova tentativa de envio enquanto aberto, mas não há fila offline persistente, sincronização em segundo plano ou notificação push.
3. A recuperação antiga permite fechamento manual sem evidência e contém regra de encerramento automático por prazo. Esses fluxos foram preservados; não devem ser confundidos com a conferência exigida no novo registro de campo.
4. Fotos ficam no PostgreSQL, limitadas a três de 500 KB por visita. Para escala, migrar os bytes para objetos privados e definir retenção/exportação/exclusão junto da política do provedor.
5. A conferência física de entrada em estoque, condição do aparelho e reaproveitamento continuam na triagem. Não há assinatura de recebimento implementada.
6. Cada técnico utiliza uma conta existente do provedor. As novas APIs restringem sua fila; um papel exclusivo de técnico para restringir também os demais módulos do sistema ainda não foi criado.

## Sincronização com GitHub

Em 13/09/2026, a pasta local estava em `4b5adc8`, 118 commits atrás de `origin/feat/localizacao`. Foi atualizada por fast-forward para `3754bea`, a branch que o workflow do repositório usa para publicação. O trabalho de campo foi preservado em stash e reaplicado sem conflitos. A `main` estava mais antiga e não foi usada como origem.

Backup local anterior às migrações da atualização: `work/backups/2026-09-13-github-sync/database.dump`, com manifesto validado por `pg_restore --list`. Isso verifica a leitura do arquivo, não substitui um ensaio completo de restauração. Nenhum dado de produção foi importado.

Para publicar o PWA em domínio próprio, seguir `technician/README.md`. A publicação e o DNS ainda não foram realizados.
