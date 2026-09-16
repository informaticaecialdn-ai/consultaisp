# Evolução completa da cobrança

Autorização: implementar todas as sete propostas de docs/cobranca-evolucao-2026-09-15.md. Sem novas integrações Asaas/Stripe. Trabalho nesta sessão, preservando alterações existentes.

## Desenho
Estender Gestão de cobranças com um centro de acompanhamento sob demanda: contestação, agenda, diagnóstico, resultados e prevenção. Configurações de contato e simulação econômica no Painel do Provedor. Carteira e provedor filtram todas as leituras. Faturas e pagamentos continuam com suas fontes atuais.

## Execução e critérios
1. Persistência aditiva: contestações por fatura, trilha de decisões, configuração e reservas de contato. Backup PostgreSQL local antes da migração; sem apagar dados.
2. Controle comum de contato: reservas atômicas por cliente, orçamento compartilhado entre canais, bloqueio por contestação/opt-out e pausas da automação por promessa/resposta/comprovante. Integrar aos pontos de saída existentes, mantendo mensagens humanas de atendimento distintas de iniciativas automáticas.
3. Contestação: abrir com motivo, relato, referência de evidência, responsável e prazo; resolver com decisão registrada. Bloqueio não expira silenciosamente. Não modificar baixa nem valor da fatura.
4. Agenda: parcelas aceitas e promessas explícitas, sem duplicar promessa substituída por acordo. Pagamentos confirmados separados. Cumprimento só com evidência financeira vinculada; desconhecido permanece desconhecido.
5. Diagnóstico: divergência agregado/faturas, sincronização antiga/ausente, baixa sem confirmação e pagamento parcial. Navegação ao Cliente 360.
6. Prioridade econômica: simulação com custo/probabilidade/margem informados e premissas visíveis. Não chamar estimativa de score nem gravar dívida estimada como real. Ativos consideram retenção; ex-clientes recuperação líquida.
7. Resultados: coortes maduras de 7/30 dias, pagamentos confirmados, promessas cumpridas quando verificáveis, tempo de conferência e intensidade de contatos. Sem atribuição causal automática.
8. Preventivo: opt-in existente preservado; mostrar configuração, faturas próximas, cobertura de canal, falhas e limites.
9. Testes de cálculos, isolamento, transações e bloqueios; revisão de todas as saídas; build, comparação de erros TypeScript, migração local e conferência no navegador sem envios reais.
