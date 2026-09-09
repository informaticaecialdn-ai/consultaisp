# Cobrança — implementação e validação local

Prioridade confirmada pelo usuário: terminar cobrança antes de ampliar equipamentos. Implementação na árvore de trabalho de `F:\ConsultaISP`, sobre a revisão `6bdac79`; sem commit, publicação ou envio a clientes.

## O que mudou

| Frente | Comportamento entregue |
| --- | --- |
| Recebimento de acordos | Entrada é uma parcela própria. Aceite não conta como recebimento; o acordo só termina após os recebíveis serem confirmados. Pagamentos parciais, concorrência e repetição da mesma operação são tratados transacionalmente. |
| Aprovação | A exigência de aprovação nasce na transação da proposta e é conferida novamente no aceite, com a autorização atual do usuário. |
| Faturas e conciliação | Cliente 360 permite ao administrador conferir quitação integral com valor, data e referência. O desaparecimento de um título no ERP não significa pagamento. Reapresentação de título já confirmado preserva o comprovante e exige conciliação antes do contato automático. |
| Indicadores | O recuperado usa recebimentos confirmados. Caso cujo saldo apenas zerou é encerrado sem declarar dinheiro recebido. |
| Reentrada na cobrança | Caso encerrado automaticamente só reabre com evidência de novas faturas vencidas e consistência com o agregado. Títulos antigos reaparecidos e situações ambíguas exigem conferência. |
| Primeiro contato | Abertura controlada e neutra, sem valores, documentos ou chamada ao modelo. Validação também aplicada a modelos de mensagem Datafy. |
| Atendimento autônomo | Identificação persistida, vinculada a cliente, telefone, conversa e provedor; limites de tentativa e validade. Informações financeiras e segunda via ficam condicionadas à confirmação. DNA e vulnerabilidade orientam o tom; a régua continua decidindo o momento. |
| Negociação autônoma | Opções calculadas pela política, seleção e confirmação do cliente, com revalidação antes de gravar. Permissão desligada por padrão e vinculada a administrador vigente. A emissão do acordo continua exigindo operação humana; sem origem de emissão definida, apenas segunda via integral existente no ERP. |
| Pré-aviso | Fila por fatura para D-7, D-3 e D-1, opt-in, sem abrir inadimplência para título a vencer. Deduplicação, janela, pausas e cota incluem envios sem confirmação. Resposta a pré-aviso segue à equipe. |
| Histórico | Régua diária e Cliente 360 usam pagamentos com data disponível. Ausência de histórico continua identificada; desaparecimento de boleto não vira pagamento pontual. |
| Painel | Perfis, primeiros contatos e autonomia reunidos em **Agentes de IA → Operação de cobrança**. Chat mantém os canais e o transporte. |

## Banco e execução local

- Backup PostgreSQL custom criado em `C:\Users\Administrator\AppData\Local\ConsultaISP\backups\consultaisp-cobranca-20260908-2000.dump`, com restauração conferida em `consultaisp_cobranca_restore_20260908`.
- Migrações pendentes 0032–0035 ensaiadas no banco restaurado e aplicadas no local. A 0032 já existia; as novas são 0033, 0034 e 0035. `shared/schema.ts` preservado.
- Consulta ISP reiniciado em `http://127.0.0.1:5000`; fork ChatBullQ reconstruído e reiniciado em `http://127.0.0.1:3002`.
- `RUN_BG_JOBS_IN_API=false`; automação e autonomia desativadas. Nenhum recebimento foi criado em clientes operacionais para os testes.

## Evidências de validação

- **1.890 testes passaram em 86 arquivos**: `work/cobranca-fechamento-tests-final.log`.
- Conferência adicional do painel após ajuste de HTML: **24 testes passaram**, `work/cobranca-painel-final.log`.
- **Build de frontend, API e worker passou**: `work/cobranca-build-final.log`.
- **TypeScript: os mesmos 60 diagnósticos anteriores, zero novos**, comparando mensagem e arquivo sem números de linha. `work/cobranca-fechamento-tsc-final.log` e `work/cobranca-tsc-comparacao.json`. O projeto inteiro ainda não tem typecheck limpo.
- PostgreSQL restaurado: **6 cenários financeiros**, incluindo pagamento concorrente, idempotência, rollback por falha deliberada, autorização e corrida entre quitação e negociação; **13 cenários de reentrada**. Scripts: `work/validar-cobranca-financeiro-db.ts` e `work/validar-regua-reentrada-db.ts`. Dados sintéticos removidos ao encerrar.
- Navegador: menus das carteiras, painel de agentes, resumo do console e Cliente 360. Conferência de fatura abriu com confirmação bloqueada até a declaração de conferência; cancelada sem gravar pagamento. Alerta de divergência entre saldo agregado e títulos mostrado corretamente. Aviso de HTML no carregamento do contador corrigido.
- `git diff --check` sem problemas.

## O que falta homologar

1. Credenciais de IA compatíveis com o fork local e canal WhatsApp conectado. Sem isso, não há validação de respostas reais do modelo, entrega pelos gateways ou retorno de clientes.
2. Emissão financeira e confirmação automática de pagamento no ERP. Não foi inventado um endpoint de histórico pago; hoje há conferência manual e leitura de dados já confirmados.
3. Operação contínua do worker com os canais configurados. Os pré-avisos e agentes têm cobertura automatizada, mas os disparos locais permanecem desativados.
4. O DNA histórico foi conectado à régua diária e à ficha. Listas que classificam diretamente pelo saldo atual ainda podem usar o atraso atual até a atualização do caso; não representam uma importação integral do histórico de todos os ERPs.

Agenda de recuperação e integração OLT ficam para a próxima etapa. Mantidas as decisões: alvos e senhas somente no coletor; recebimento de inventário privado; nenhuma leitura OLT exposta na consulta colaborativa.
