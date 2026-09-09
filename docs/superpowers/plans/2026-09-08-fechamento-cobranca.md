# Fechamento da cobrança — plano de execução

**Objetivo:** executar primeiro a cobrança, conforme a última prioridade do usuário, preservando dados e entregando a versão local verificável. Equipamentos serão tratados na etapa seguinte.

**Arquitetura:** o Consulta ISP continua dono da política e das transações; ChatBullQ planeja e transporta mensagens. Recebíveis e aprovações são transacionais. Para a etapa futura de equipamentos, o coletor guardará sozinho alvos e credenciais OLT e somente enviará inventário privado.

**Stack:** TypeScript, Express, Drizzle/PostgreSQL, React/TanStack, Vitest.

## Restrições

- Não modificar `shared/schema.ts`; novas tabelas em módulos separados.
- Migrações aditivas; backup e verificação antes de aplicar no banco local.
- Não iniciar envios reais nem ativar agentes sem configuração existente explícita.
- OLT só inventário próprio: nunca atualizar sinal compartilhado de dívida, equipamento retido ou consulta colaborativa a partir da leitura OLT.
- Sem alvos ou senhas de OLT na aplicação. Token de ingestão aleatório, armazenado somente como hash; servidor não comanda varredura.
- Seguir DESIGN_SYSTEM.md v5 nos componentes novos.

## Execução

- [x] Financeiro: entrada recebível, pagamentos com concorrência/idempotência, KPI pelo recebido, aprovação na transação. Migração 0033.
- [x] Agentes: identidade com expiração/tentativas, tom DNA efetivo, normalização de datas, propostas da política. Migração 0034. Abertura da cobrança neutra, sem valores ou documentos.
- [x] Régua: pré-aviso por fatura/dia, histórico de pagamentos confirmados, baixa provável em conciliação. Migração 0035. Reentrada exige evidência de novas faturas vencidas.
- Adiado: agenda de recuperação e OLT. As credenciais e os alvos permanecerão no coletor; leituras somente para inventário privado, sem exposição na consulta colaborativa.
- [x] Painel: configuração dos perfis e autonomia reunidas em Agentes de IA; Chat para transporte/canais. Cliente 360 com conferência de recebimento e alerta de divergência.
- [x] Local: backup restaurado em banco separado, migrações ensaiadas e aplicadas, API/fork atualizados sem disparos, teste das telas.
- [x] Verificação local: 1.890 testes de regressão, build, 19 cenários no PostgreSQL restaurado e conferência no navegador. Typecheck mantém os mesmos 60 diagnósticos anteriores, sem novos erros.
- [ ] Homologação externa: configurar credenciais de IA, canal WhatsApp e testar mensagens reais, emissão/retorno financeiro do ERP e operação do worker. Não executada sem essas conexões.

## Critérios de aceite

Entrada não paga impede quitação; aprovação não se perde com falha; nenhuma dívida/segunda via antes da confirmação de identidade; o mesmo pré-aviso não dispara duas vezes; desaparecimento de título não vira recibo; confirmação preservada não se perde quando o ERP reapresenta o título; pagamento e aceite concorrentes não duplicam valores. Ausência de credenciais aparece como pendência, não como integração homologada.

Agenda e leituras OLT não são critérios desta entrega de cobrança: ficaram adiadas por decisão do usuário. As decisões de manter credenciais no coletor e inventário privado permanecem registradas para essa etapa.
