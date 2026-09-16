# Revisão da formalização da negociação

- A conclusão de uma negociação mostra o estado retornado pela API e oferece acesso ao bloco de formalização no Cliente 360. Aceite registrado, assinatura eletrônica e pagamento permanecem eventos distintos.
- Uma proposta pendente não pode produzir silenciosamente um documento pelo saldo integral. A base bloqueia emissão até aceite ou cancelamento da proposta. Mais de um acordo aceito/ativo também bloqueia a escolha ambígua.
- A interface impede emitir quando faltam permissões, caso, configuração, carregamento ou confirmação da lista de documentos. Falha na consulta deixa mensagem de erro, não uma lista vazia enganosa.
- Documentos em preparação/assinatura atualizam o histórico local a cada 15 segundos. O botão Atualizar permite reler o histórico sem reenviar o documento.
- A confirmação continua pelo retorno validado do ZapSign e pelo PDF assinado. Nenhuma assinatura ou envio externo foi realizado nesta revisão. Não houve alteração do modelo jurídico ou migração de banco.

Validação: suíte de confissão, retorno, emissão, reconciliação, rotas, modelo e interface. A integração real depende da configuração de assinatura do provedor.
