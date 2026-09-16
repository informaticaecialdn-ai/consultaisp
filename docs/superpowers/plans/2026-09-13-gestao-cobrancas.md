# Gestão de cobranças e comunicação — plano de implementação

**Objetivo:** executar a proposta aprovada de gestão por quadro/lista, avisos opcionais e comunicação por WhatsApp, SMS e e-mail.

**Arquitetura:** preservar casos, acordos e pagamentos existentes. Agregar configurações e diário de comunicação por provedor em tabelas novas; cada envio exige reserva idempotente e nova leitura das condições. As mensagens aceitas pelo gateway não representam entrega ou pagamento.

**Restrições:** não alterar manualmente shared/schema.ts; preservar dados e mudanças locais; sem envio real durante os testes; credenciais cifradas; nenhuma baixa financeira por declaração de pagamento. Configuração desativada por padrão, por provedor.

- [x] Renomear navegação para Gestão de cobranças e corrigir valores/indicadores paginados; aprimorar filtros operacionais.
- [x] Avisos de faturas com dias/canal/limite próprios, configuração independente do WhatsApp e simulação sem envio.
- [x] Conectores Twilio SMS e Resend e-mail, configuração protegida e diagnóstico.
- [x] Diário de comunicação e automação SMS/e-mail com cadência, exclusões, escopo por carteira e pausa humana.
- [x] Montar configurações no Painel do Provedor, acompanhar diário e motivos na operação.
- [x] Backup local, migrações aditivas, testes de isolamento/deduplicação/pagamento e validação no navegador.

Validação: testes de regras puras e SQL/mock transporte, build, leitura das telas locais, nenhuma mensagem externa. Relatar separadamente limitações de conectores e credenciais ausentes.
