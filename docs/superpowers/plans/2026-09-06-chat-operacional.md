# Atendimento integrado em cobrança e equipamentos

Pedido autorizado: conversar dentro dos dois módulos, primeiro contato automatizado,
primeira resposta encaminhada ao humano, régua/DNA e dados técnicos no Cliente 360.

## Desenho

- Chat BullQ continua como transporte e histórico; tokens ficam no servidor.
- Duas filas internas, cobrança (com carteira ativo/ex-cliente) e equipamentos.
  A conversa física do cliente pode aparecer nos dois contextos sem perder vínculos.
- Contato inicial por modelo orientado pela régua e tom DNA; continuidade editável pelo atendente.
  IA de resposta desativada desde a abertura. Webhook de mensagem recebida coloca
  o caso na fila humana; assumir pausa IA antes de permitir resposta.
- Réguas não autorizam descontos, negativação, baixa ou retirada automaticamente.
- Histórico paginado, estados de envio reais, falha explícita, sem reenvio cego.
- Autenticação e MAC lidos do ERP sem senhas; cruzamento com inventário distingue
  coincidência, conflito e ausência de evidência. OLT sem leitura permanece ausente.
- Reaproveitar tabelas e vínculos existentes. Sem migração ou envio real nesta tarefa.

## Execução e validação

1. Contratos de mensagens, armazenamento das filas e endpoints protegidos por provedor.
2. Componente compartilhado de conversa, duas páginas e entradas pelo caso/Cliente 360.
3. Primeiro contato, transferência, templates DNA e trilha dos dois módulos.
4. Autenticação/MAC no snapshot e apresentação da evidência técnica.
5. Testes de isolamento, falhas, transferência, classificação, identificação; build
   e verificação de tipos, distinguindo erros anteriores. Verificação visual com dados sintéticos.

## Referências examinadas

- jpasv/chat-bullq-api: conversas, mensagens, agentes WORKER, transferToHuman.
- jpasv/chat-bullq-web: inbox e contratos de paginação; referência de interação.
- jpasv/chat-bullq-mcp: ferramentas de leitura (não transporta o atendimento).
- F:/Provedor.ai: conversas/templates-dna, régua DNA, Cliente 360 e recuperação.

O adaptador existente exige o fork com provisionamento /platform e call_webhook.
O upstream analisado não implementa esses patches e usa modelo Sakana; não é uma
substituição direta do serviço já integrado. Código novo não copia os agentes comerciais
nem pressupõe que o MCP executa cobrança.
