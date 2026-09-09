# Revisão do antifraude — 08/09/2026

## Comportamento entregue

- A central Anti-Fraude mostra cards compactos em grade: indicadores, busca, prioridade, ordenação e situações separadas. Cada card abre os detalhes e ações em um diálogo, com rolagem interna; nenhum aviso se expande automaticamente na página.
- Configurações ficam no Painel do Provedor → Equipe e segurança → Proteção antifraude.
- Critérios combináveis por E (todos) ou OU (qualquer). Modelo pronto: contrato de até 90 dias e inadimplência, com valor e dias ajustáveis. Preferências anteriores mantêm o comportamento OU.
- Simulador local usa o mesmo motor do servidor, sem consultar pessoas nem enviar mensagens. Modelos só mudam a operação após salvar.
- Data de início do contrato sincronizada passa a chegar ao motor quando o ERP ao vivo não responde. Data ausente, impossível ou futura não qualifica como contrato novo.
- Ex-clientes, vínculo desconhecido e consultas do próprio provedor não disparam. O valor financeiro deve ser positivo e finito.
- Motivos e idade do contrato no momento do disparo ficam no registro. Registros anteriores sem idade não ganham idade inventada.
- Dívida do resumo deduplicada por cliente; usa situação atual quando disponível. Removida instalação presumida de R$150 e apresentação como prejuízo certo.
- Desativar avisos externos preserva o registro na central. Falha na leitura de regras suspende aquela avaliação em vez de usar preferências padrão; webhook não-2xx deixa de contar como envio bem-sucedido.
- Critérios e combinação são gravados juntos em transação, sem alteração de schema.
- A ação Analisar cliente preenche o documento na consulta, sem executá-la automaticamente.

## Validação

323 testes em seis arquivos passaram (motor, seleção de donos, canais mockados, anonimização, e-mail, indicadores). Build de produção passou. Typecheck permanece com os mesmos 58 diagnósticos existentes no baseline, sem novos diagnósticos desta revisão.

Conferência local: central, filtros e estado vazio; painel e modelo combinado. Não foram enviados avisos reais, alteradas preferências do provedor nem resolvidos alertas reais durante os testes.

## Limites atuais

A janela de consultas distintas continua em 30 dias e o controle de repetição continua em 24 horas por cliente/provedor. Não há inferência de intenção de cancelamento ou prova de fraude. A qualidade do vínculo, dívida e data depende dos dados recebidos do ERP. O envio externo depende dos canais disponíveis; WhatsApp está indisponível na instalação local usada na validação.
