# Evolucao da gestao de cobrancas — 15/09/2026

## Referencias pesquisadas
- HighRadius, Managing Collections: fila priorizada, promessas de pagamento, correspondencia e gestao de disputas. https://cloud5g.highradius.com/RRDMSProject/help/global/Content/Order%20to%20Cash/Collections%20Management/Updated%20Collections%20Cloud/Managing%20Collections.htm
- Chaser, Stop or pause chasing: interromper lembretes ate a data esperada de pagamento. https://help.chaserhq.com/stop-or-pause-chasing
- Chaser, Advanced chase criteria: suprimir lembretes de faturas em disputa. https://help.chaserhq.com/configuring-advanced-chase-criteria

A aplicacao ao ISP e uma proposta de produto; nao e prova de aumento de recuperacao.

## Implementado nesta entrega
1. Atendimento guiado opt-in no quadro/lista. Sugere um caso de cada vez, explica o motivo e abre o painel existente. Prioriza data do contato, prioridade operacional e valor; sem score de IA inventado. Ignora contatos ja feitos no dia de Sao Paulo, horarios futuros, saldos nao positivos e datas invalidas. Promessas em acompanhamento e acordos ativos ficam fora dessa sugestao de novo contato.
2. Pular/reincluir na sessao: nao muda o caso nem a agenda. A lista reinicia quando o recorte muda. A sugestao declara que usa os casos carregados e avisa sobre paginacao.
3. Fila de pagamentos informados: nova condicao no servidor, antes de paginar, usando a evidencia relevante mais recente. Leva o operador a conferir o pagamento; nao encerra o caso e nao cria baixa. Usa eventos ja registrados pelo Diario de comunicacao.
4. Fila de telefones ausentes/incompletos (menos de dez digitos). Orienta corrigir no ERP; nao afirma que email tambem esta ausente.
5. Atalhos de trabalho: acoes ate hoje, promessas vencidas, conferir pagamentos, corrigir telefones e distribuir casos. Mantem a carteira, a busca e demais filtros.
6. Promessa: sugestao de follow-up no dia seguinte as 9h, preservando todo o dia prometido. O operador pode ajustar. Esta entrega nao altera sozinha as pausas do motor autonomo.

## Proximas evolucoes propostas (nao implementadas aqui)
- Contestacao estruturada por fatura, com motivo, evidencias, responsavel, prazo e pausa automatica de todos os canais; retomada auditada. Valor disputado separado do elegivel para cobrar.
- Prioridade economica: comparar recuperacao esperada, custo do contato e margem futura. Ativos priorizam regularizacao/retencao; ex-clientes, recuperacao liquida. Exibir premissas, custos conhecidos e incerteza.
- Agenda de recebimentos: somar valor e data das promessas/parcelas aceitas, separar previsto de confirmado e acompanhar cumprimento por coorte.
- Orcamento unico de contatos por cliente entre WhatsApp, SMS, email, agentes e humanos, com pausa por resposta, comprovante e promessa. Aproveitar os controles existentes; auditar cobertura antes de ampliar envios.
- Diagnostico do ERP: divergencia entre agregado e faturas, data da ultima sincronizacao, pagamento parcial e comprovantes pendentes em uma fila de conciliacao.
- Medicao de resultado: taxa de regularizacao em 7/30 dias, promessas cumpridas, tempo de conciliacao, contatos por pagamento confirmado e margem preservada. Nao atribuir toda baixa a uma mensagem anterior.
- Preventivo opt-in: melhorar o monitoramento de cobertura da regua ja existente, disponibilidade de boleto/PIX, opt-out e falhas de canal antes de aumentar disparos.

## Restricoes da entrega
Nenhum envio externo foi realizado. Sem migration ou alteracao de politica de desconto. As filas respeitam provider_id e carteira; testes de SQL e rota verificam esses vinculos. A recomendacao e apoio ao operador, nao uma ordem autonoma de cobrar.
